// Roundtable: an ordered discussion in the thread rooted at a user message. Each user message in
// the thread starts a new epoch; within an epoch the members speak one at a time, round after
// round, until a limit is hit or a whole round passes. The state is persisted, and `advance` is
// idempotent, so it runs after every settled turn and again on recovery.
import { randomUUID } from "node:crypto";
import type { Assistant, Conversation, Message } from "../shared/contracts";
import { CHANNEL_ALL_MENTION_NAME, extractMentionedNames } from "../shared/mentions";
import { findMentionedAgents, mentionable } from "../shared/member-mentions";
import { laneMessages, queueTurn } from "./chat-sessions";
import type { ChatStore } from "./store";

export const ROUNDTABLE_MIN_MEMBERS = 2;
export const ROUNDTABLE_MAX_MEMBERS = 6;
export const ROUNDTABLE_MAX_ROUNDS = 3;
export const ROUNDTABLE_MAX_VISIBLE_MESSAGES = 10;
export const ROUNDTABLE_HISTORY_LIMIT = 24;

export type EpochEnd = "max_rounds" | "max_messages" | "all_passed";
export interface Epoch {
  id: string;
  conversationId: string;
  /** The root message the roundtable runs under; its turns run in this thread. */
  threadId: string;
  /** The user message that started this epoch. */
  triggerId: string;
  generation: number;
  /** The fixed participants, in the order they were mentioned. */
  members: string[];
  status: "running" | "ended" | "superseded";
  reason?: EpochEnd;
  round: number;
  /** This round's speakers in speaking order; null until the round starts. */
  responders: string[] | null;
  /** Index of the next speaker in `responders`. */
  next: number;
  /** Visible messages when this round began, to tell a silent round from an active one. */
  roundStartVisible: number;
}

const LIVE = new Set(["queued", "creating", "running", "attention", "unknown"]);
const ENDED_TEXT: Record<EpochEnd, string> = {
  max_rounds: `reached the limit of ${ROUNDTABLE_MAX_ROUNDS} rounds`,
  max_messages: `reached the limit of ${ROUNDTABLE_MAX_VISIBLE_MESSAGES} messages`,
  all_passed: "everyone passed",
};

export function rotateRoundtableOrder<T>(members: readonly T[], round: number): T[] {
  if (members.length === 0) return [];
  const offset = ((Math.floor(round) % members.length) + members.length) % members.length;
  return [...members.slice(offset), ...members.slice(0, offset)];
}

/**
 * Who speaks in the next round: the members named by the last message that names any since the
 * latest user message, everyone when that message says @all or nobody is named.
 */
export function resolveRoundtableResponderIds(
  messages: ReadonlyArray<{ senderId: string; content: string }>,
  members: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const latestUser = messages.findLastIndex((message) => message.senderId === "user");
  const relevant = latestUser >= 0 ? messages.slice(latestUser) : messages;
  const everyone = members.map((member) => member.id);
  if (
    relevant.some((message) =>
      extractMentionedNames(message.content).includes(CHANNEL_ALL_MENTION_NAME),
    )
  )
    return everyone;
  let mentioned: Set<string> | null = null;
  for (const message of relevant) {
    const ids = new Set(
      findMentionedAgents(message.content, mentionable(members)).map((member) => member.id),
    );
    if (ids.size > 0) mentioned = ids;
  }
  return mentioned ? everyone.filter((id) => mentioned.has(id)) : everyone;
}

/** The members a root message starts a roundtable with; throws a user-facing error otherwise. */
export function roundtableStartMembers(params: {
  conversation: Conversation;
  threadId: string | null;
  content: string;
  members: Assistant[];
}): Assistant[] {
  const { conversation, threadId, content, members } = params;
  if (conversation.kind !== "group") throw new Error("A roundtable needs a group chat.");
  if (threadId)
    throw new Error("A roundtable starts from a message in the chat, not inside a thread.");
  if (extractMentionedNames(content).includes(CHANNEL_ALL_MENTION_NAME))
    throw new Error("A roundtable needs explicit members; @all is not supported.");
  const mentioned = findMentionedAgents(content, mentionable(members)).map(
    (named) => members.find((member) => member.id === named.id)!,
  );
  if (mentioned.length < ROUNDTABLE_MIN_MEMBERS)
    throw new Error(`Mention at least ${ROUNDTABLE_MIN_MEMBERS} assistants to start a roundtable.`);
  if (mentioned.length > ROUNDTABLE_MAX_MEMBERS)
    throw new Error(`A roundtable supports at most ${ROUNDTABLE_MAX_MEMBERS} assistants.`);
  return mentioned;
}

export class Roundtable {
  constructor(
    private readonly store: ChatStore,
    private readonly now: () => number,
  ) {}

  /** Opens the first epoch of the roundtable rooted at `root`. */
  start(conversation: Conversation, root: Message, members: Assistant[]): Epoch {
    const epoch: Epoch = {
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: root.id,
      triggerId: root.id,
      generation: 0,
      members: members.map((member) => member.id),
      status: "running",
      round: 0,
      responders: null,
      next: 0,
      roundStartVisible: 0,
    };
    this.store.putEpoch(epoch);
    return epoch;
  }
  /** A new user message in the thread supersedes the running epoch and opens the next one. */
  restart(latest: Epoch, trigger: Message): Epoch {
    if (latest.status === "running") this.store.putEpoch({ ...latest, status: "superseded" });
    const epoch: Epoch = {
      ...latest,
      id: randomUUID(),
      triggerId: trigger.id,
      generation: latest.generation + 1,
      status: "running",
      reason: undefined,
      round: 0,
      responders: null,
      next: 0,
      roundStartVisible: 0,
    };
    this.store.putEpoch(epoch);
    return epoch;
  }
  /** A turn of a superseded or ended epoch must not keep running. */
  isStale(epochId: string | undefined): boolean {
    return Boolean(epochId) && this.store.getEpoch(epochId!)?.status !== "running";
  }
  advanceAll(): void {
    for (const epoch of this.store.runningEpochs()) this.advance(epoch.id);
  }

  /** Queues the next speaker's turn, or ends the epoch. Safe to call at any time, any number of times. */
  advance(epochId: string): void {
    this.store.transaction(() => {
      for (let step = 0; step < 100; step++) {
        let epoch = this.store.getEpoch(epochId);
        if (!epoch || epoch.status !== "running") return;
        if (this.store.latestEpoch(epoch.conversationId, epoch.threadId)?.id !== epoch.id) {
          this.store.putEpoch({ ...epoch, status: "superseded" });
          return;
        }
        const state = this.store.snapshot();
        if (state.turns.some((turn) => turn.epochId === epoch!.id && LIVE.has(turn.status))) return;
        const visible = state.messages.filter(
          (message) => message.epochId === epoch!.id && message.kind === "final",
        ).length;
        if (visible >= ROUNDTABLE_MAX_VISIBLE_MESSAGES) return this.end(epoch, "max_messages");
        if (epoch.round >= ROUNDTABLE_MAX_ROUNDS) return this.end(epoch, "max_rounds");
        if (!epoch.responders) {
          const members = epoch.members.flatMap(
            (id) => state.assistants.find((item) => item.id === id) ?? [],
          );
          const shared = laneMessages(
            state.messages,
            epoch.conversationId,
            epoch.threadId,
            epoch.threadId,
          );
          const chosen = new Set(resolveRoundtableResponderIds(shared, members));
          epoch = {
            ...epoch,
            responders: rotateRoundtableOrder(members, epoch.round)
              .filter((member) => chosen.has(member.id))
              .map((member) => member.id),
            next: 0,
            roundStartVisible: visible,
          };
          this.store.putEpoch(epoch);
        }
        const responders = epoch.responders!;
        if (epoch.next >= responders.length) {
          if (visible === epoch.roundStartVisible) return this.end(epoch, "all_passed");
          this.store.putEpoch({ ...epoch, round: epoch.round + 1, responders: null, next: 0 });
          continue;
        }
        const assistant = state.assistants.find((item) => item.id === responders[epoch!.next]);
        this.store.putEpoch({ ...epoch, next: epoch.next + 1 });
        if (!assistant) continue;
        const id = `roundtable:${epoch.id}:${epoch.round}:${assistant.id}`;
        if (this.store.get("turns", id)) continue;
        queueTurn(this.store, {
          id,
          conversationId: epoch.conversationId,
          threadId: epoch.threadId,
          assistant,
          kind: "roundtable",
          triggerId: epoch.triggerId,
          rootTriggerId: epoch.triggerId,
          epochId: epoch.id,
          round: epoch.round,
          prompt: "",
        });
        return;
      }
    });
  }

  private end(epoch: Epoch, reason: EpochEnd): void {
    this.store.putEpoch({ ...epoch, status: "ended", reason });
    this.store.putMessage({
      id: `system:${epoch.id}`,
      conversationId: epoch.conversationId,
      threadId: epoch.threadId,
      senderId: "system",
      content: `Roundtable ended: ${ENDED_TEXT[reason]}. Send a message to continue.`,
      createdAt: this.now(),
      taskId: null,
      kind: "system",
      epochId: epoch.id,
      event: { type: "roundtable_ended", detail: reason },
    });
  }
}
