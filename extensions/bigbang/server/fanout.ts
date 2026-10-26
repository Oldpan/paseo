// Free collaboration in group chats (Bigbang ADR 0009): who a user message wakes, how assistants
// wake each other by mention, and how unaddressed peer replies are batched into a Peer Inbox.
// Everything here runs inside the caller's store transaction; nothing awaits.
import type { Assistant, Conversation, Message, Turn } from "../shared/contracts";
import { CHANNEL_ALL_MENTION_NAME, extractMentionedNames } from "../shared/mentions";
import { findMentionedAgents, mentionable } from "../shared/member-mentions";
import { previewRoute } from "../shared/routing-preview";
import { chatSessionKey, laneMessages, queueTurn } from "./chat-sessions";
import type { ChatStore, InboxItem } from "./store";

export const RECENT_WINDOW_MS = 60 * 60 * 1000;
export const RECENT_MAX = 20;
export const MENTION_COOLDOWN_MS = 60_000;
export const PEER_INBOX_WINDOW_MS = 60_000;
export const PEER_INBOX_FLUSH_COUNT = 5;
/** Agent-triggered turns (mention + peer_inbox) one user message may cause, however they chain. */
export const AGENT_TURN_BUDGET = 8;

const isAgentTriggered = (turn: Turn) => turn.kind === "mention" || turn.kind === "peer_inbox";
const rootOf = (turn: Turn) => turn.rootTriggerId ?? turn.triggerId;
const cooldownKey = (conversationId: string, threadId: string | null, from: string, to: string) =>
  JSON.stringify([conversationId, threadId, from, to]);

/** Assistants with a visible final in this lane within the last hour, most recent first, max 20. */
export function recentParticipants(
  messages: readonly Message[],
  conversation: Conversation,
  threadId: string | null,
  now: number,
): string[] {
  const members = new Set(conversation.members);
  const seen = new Set<string>();
  const recent: string[] = [];
  for (const message of laneMessages([...messages], conversation.id, threadId).toReversed()) {
    if (
      !members.has(message.senderId) ||
      message.taskId ||
      (message.kind !== undefined && message.kind !== "final") ||
      message.createdAt < now - RECENT_WINDOW_MS ||
      seen.has(message.senderId)
    )
      continue;
    seen.add(message.senderId);
    recent.push(message.senderId);
    if (recent.length >= RECENT_MAX) break;
  }
  return recent;
}
function membersOf(store: ChatStore, conversation: Conversation): Assistant[] {
  return conversation.members.flatMap((id) => store.get("assistants", id) ?? []);
}
function agentTurnCount(turns: readonly Turn[], root: string): number {
  return turns.filter((turn) => isAgentTriggered(turn) && rootOf(turn) === root).length;
}
/** Named mentions only: an @all in an assistant's reply is a broadcast, not a wake-up. */
function namedMentions(content: string, others: Assistant[]): Assistant[] {
  if (extractMentionedNames(content).includes(CHANNEL_ALL_MENTION_NAME)) return [];
  return findMentionedAgents(content, mentionable(others)).map(
    (named) => others.find((other) => other.id === named.id)!,
  );
}

export class Fanout {
  constructor(
    private readonly store: ChatStore,
    private readonly now: () => number,
  ) {}

  /** Queues the turns a user message in a group chat wakes. A DM has one assistant and no fanout. */
  wakeForUserMessage(conversation: Conversation, message: Message): Turn[] {
    const state = this.store.snapshot();
    const members = membersOf(this.store, conversation);
    const quoted = message.quoteOf
      ? state.messages.find((item) => item.id === message.quoteOf)
      : undefined;
    const preview = previewRoute({
      members,
      content: message.content,
      quotedSenderId: quoted?.conversationId === conversation.id ? quoted.senderId : null,
      recentParticipantIds:
        conversation.kind === "dm"
          ? []
          : recentParticipants(state.messages, conversation, message.threadId, this.now()),
      defaultResponderId: conversation.defaultResponderId,
    });
    if (!preview) return [];
    const turn = (assistantId: string, kind: "reply" | "awareness") =>
      queueTurn(this.store, {
        conversationId: conversation.id,
        threadId: message.threadId,
        assistant: members.find((member) => member.id === assistantId)!,
        kind,
        triggerId: message.id,
        rootTriggerId: message.id,
        prompt: message.content,
      });
    // preview already holds each assistant once, so one user message wakes everyone at most once.
    return [
      ...preview.explicitIds.map((id) => turn(id, "reply")),
      ...preview.recentOnlyIds.map((id) => turn(id, "awareness")),
    ];
  }

  /**
   * An assistant's final just committed. Named mentions wake the others (cooldown, budget, same
   * batch); a final that names nobody goes to the Peer Inbox of the other recent participants.
   */
  onFinal(turn: Turn, message: Message): void {
    const kind = turn.kind ?? "reply";
    if (turn.taskId || !["reply", "awareness", "mention", "peer_inbox"].includes(kind)) return;
    const conversation = this.store.get("conversations", turn.conversationId);
    const root = rootOf(turn);
    if (!conversation || conversation.kind !== "group" || !root) return;
    const state = this.store.snapshot();
    const others = membersOf(this.store, conversation).filter(
      (member) => member.id !== message.senderId,
    );
    const budget = AGENT_TURN_BUDGET - agentTurnCount(state.turns, root);
    const named = namedMentions(message.content, others);
    if (named.length > 0) this.wakeMentioned(turn, message, conversation, root, named, budget);
    else if (budget > 0) this.queueForPeers(turn, message, conversation, root);
    this.flushDue();
  }
  private wakeMentioned(
    turn: Turn,
    message: Message,
    conversation: Conversation,
    root: string,
    named: Assistant[],
    budget: number,
  ): void {
    const turns = this.store.snapshot().turns;
    const now = this.now();
    // Everyone the root user message woke directly must not wake each other from those replies.
    const direct = (item: Turn) => ["reply", "awareness"].includes(item.kind ?? "reply");
    const wokenTogether = new Set(
      turns
        .filter((item) => item.triggerId === root && direct(item))
        .map((item) => item.assistantId),
    );
    const suppress = direct(turn) && turn.triggerId === root;
    for (const target of named) {
      if (budget <= 0) break;
      if (suppress && wokenTogether.has(target.id)) continue;
      const key = cooldownKey(conversation.id, turn.threadId, message.senderId, target.id);
      const last = this.store.getMentionCooldown(key);
      if (last !== null && now - last < MENTION_COOLDOWN_MS) continue;
      // One queued turn per assistant is enough: its prompt carries every unseen message.
      if (this.hasQueuedTurn(turns, conversation.id, turn.threadId, target.id)) continue;
      queueTurn(this.store, {
        conversationId: conversation.id,
        threadId: turn.threadId,
        assistant: target,
        kind: "mention",
        triggerId: message.id,
        rootTriggerId: root,
        wokenBy: message.senderId,
        prompt: message.content,
      });
      this.store.putMentionCooldown(key, now);
      budget--;
    }
  }
  private queueForPeers(
    turn: Turn,
    message: Message,
    conversation: Conversation,
    root: string,
  ): void {
    const recent = recentParticipants(
      this.store.snapshot().messages,
      conversation,
      turn.threadId,
      this.now(),
    );
    for (const assistantId of recent)
      if (assistantId !== message.senderId && conversation.members.includes(assistantId))
        this.store.addInboxItem({
          assistantId,
          conversationId: conversation.id,
          threadId: turn.threadId,
          messageId: message.id,
          senderId: message.senderId,
          rootTriggerId: root,
          createdAt: this.now(),
        });
  }
  private hasQueuedTurn(
    turns: readonly Turn[],
    conversationId: string,
    threadId: string | null,
    assistantId: string,
  ): boolean {
    return turns.some(
      (turn) =>
        turn.status === "queued" &&
        turn.conversationId === conversationId &&
        turn.threadId === threadId &&
        turn.assistantId === assistantId,
    );
  }

  /** When the earliest pending peer batch is due, or null when the inbox is empty. */
  nextDeadline(): number | null {
    const items = this.store.inboxItems();
    return items.length === 0
      ? null
      : Math.min(...items.map((item) => item.createdAt)) + PEER_INBOX_WINDOW_MS;
  }
  /** Turns every batch that reached 5 messages or 60 seconds into one peer_inbox turn. */
  flushDue(): Turn[] {
    const groups = new Map<string, InboxItem[]>();
    for (const item of this.store.inboxItems()) {
      const key = JSON.stringify([item.assistantId, item.conversationId, item.threadId]);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const now = this.now();
    const flushed: Turn[] = [];
    this.store.transaction(() => {
      for (const group of groups.values()) {
        if (
          group.length < PEER_INBOX_FLUSH_COUNT &&
          group[0].createdAt + PEER_INBOX_WINDOW_MS > now
        )
          continue;
        this.store.deleteInboxItems(group);
        const turn = this.deliver(group);
        if (turn) flushed.push(turn);
      }
    });
    return flushed;
  }
  private deliver(group: InboxItem[]): Turn | null {
    const { assistantId, conversationId, threadId } = group[0];
    const conversation = this.store.get("conversations", conversationId);
    const assistant = this.store.get("assistants", assistantId);
    if (!conversation?.members.includes(assistantId) || !assistant) return null;
    const state = this.store.snapshot();
    // Anything the assistant's execution already read, or a turn about to read, needs no wake-up.
    if (this.hasQueuedTurn(state.turns, conversationId, threadId, assistantId)) return null;
    const session = this.store.getChatSession(
      chatSessionKey(conversationId, threadId, assistantId),
    );
    const cursor = session?.lastMessageId
      ? this.store.get("messages", session.lastMessageId)
      : null;
    const fresh = group.filter((item) => {
      const message = this.store.get("messages", item.messageId);
      return message && (message.seq ?? 0) > (cursor?.seq ?? 0);
    });
    const last = fresh.at(-1);
    if (!last || agentTurnCount(state.turns, last.rootTriggerId) >= AGENT_TURN_BUDGET) return null;
    return queueTurn(this.store, {
      conversationId,
      threadId,
      assistant,
      kind: "peer_inbox",
      triggerId: last.messageId,
      rootTriggerId: last.rootTriggerId,
      inboxMessageIds: fresh.map((item) => item.messageId),
      prompt: "",
    });
  }
}
