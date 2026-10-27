// Client-side group chat helpers: the composer's responder hint, @-mention suggestions, the
// roundtable toggle and the roundtable thread header. They mirror what the coordinator does with
// the same message (`shared/routing-preview.ts` is the shared source for routing), so a hint can
// never promise a reply the server will not send.
import type {
  Assistant,
  Conversation,
  Message,
  Turn,
} from "../../../../extensions/bigbang/shared/contracts";
import {
  CHANNEL_ALL_MENTION_NAME,
  extractMentionedNames,
} from "../../../../extensions/bigbang/shared/mentions";
import {
  findMentionedAgents,
  mentionable,
} from "../../../../extensions/bigbang/shared/member-mentions";
import {
  formatResponderHint,
  formatRouteHint,
  previewRoute,
  type PreviewMember,
} from "../../../../extensions/bigbang/shared/routing-preview";
import { sortMessages } from "./model";

// Mirrors extensions/bigbang/server/fanout.ts (recent participants) and roundtable.ts (limits).
// Those modules import node and store code, so the numbers are repeated here.
export const RECENT_WINDOW_MS = 60 * 60 * 1000;
export const RECENT_MAX = 20;
export const ROUNDTABLE_MIN_MEMBERS = 2;
export const ROUNDTABLE_MAX_MEMBERS = 6;
export const ROUNDTABLE_MAX_ROUNDS = 3;
const MENTION_OPTION_LIMIT = 8;
const QUOTE_PREVIEW_CHARS = 140;
const LIVE_TURN = new Set(["queued", "creating", "running", "attention", "unknown"]);

/** The conversation's members in membership order; members whose assistant is gone are dropped. */
export function membersOf(
  conversation: Pick<Conversation, "members"> | undefined,
  assistants: readonly Assistant[],
): PreviewMember[] {
  if (!conversation) return [];
  return conversation.members.flatMap((id) => {
    const assistant = assistants.find((item) => item.id === id);
    return assistant ? [{ id: assistant.id, name: assistant.name }] : [];
  });
}

/**
 * Assistants with a visible final in this lane within the last hour, most recent first, at most
 * 20, current members only; task results do not count. Same rule as the coordinator's.
 */
export function recentParticipantIds(
  messages: readonly Message[],
  conversation: Pick<Conversation, "id" | "members">,
  threadId: string | null,
  now: number,
): string[] {
  const members = new Set(conversation.members);
  const seen = new Set<string>();
  const recent: string[] = [];
  const lane = messages.filter(
    (message) =>
      message.conversationId === conversation.id &&
      message.kind !== "system" &&
      message.threadId === threadId,
  );
  for (const message of sortMessages(lane).toReversed()) {
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

export interface RoundtableEligibility {
  eligible: boolean;
  /** The members the draft names explicitly, in mention order. */
  mentioned: PreviewMember[];
}
/**
 * The roundtable toggle shows in a group chat's root composer when the draft names 2-6 members
 * explicitly. `@all` never qualifies, and a thread continues its roundtable on its own.
 */
export function roundtableEligibility(input: {
  conversation: Pick<Conversation, "kind"> | undefined;
  threadId: string | null;
  draft: string;
  members: readonly PreviewMember[];
}): RoundtableEligibility {
  const none = { eligible: false, mentioned: [] };
  if (input.conversation?.kind !== "group" || input.threadId) return none;
  if (extractMentionedNames(input.draft).includes(CHANNEL_ALL_MENTION_NAME)) return none;
  const mentioned = findMentionedAgents(input.draft, mentionable(input.members)).map(
    ({ id, name }) => ({ id, name }),
  );
  return {
    eligible:
      mentioned.length >= ROUNDTABLE_MIN_MEMBERS && mentioned.length <= ROUNDTABLE_MAX_MEMBERS,
    mentioned,
  };
}

/** A group chat's assistant replies can be quoted; user text, system rows and task cards cannot. */
export function canQuote(
  message: Pick<Message, "senderId" | "kind" | "taskId">,
  conversation: Pick<Conversation, "kind"> | undefined,
): boolean {
  return (
    conversation?.kind === "group" &&
    message.senderId !== "user" &&
    message.senderId !== "system" &&
    !message.taskId &&
    (message.kind === undefined || message.kind === "final")
  );
}
/** One line of the quoted message, for the composer chip and the quote block. */
export function quotePreview(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text.length > QUOTE_PREVIEW_CHARS ? `${text.slice(0, QUOTE_PREVIEW_CHARS - 1)}…` : text;
}

/**
 * "@X will reply; N active assistants may also respond", from the same route the coordinator will
 * take. A roundtable thread has no route of its own, so it names who the draft addresses.
 */
export function responderHint(input: {
  conversation: Conversation | undefined;
  members: readonly PreviewMember[];
  messages: readonly Message[];
  threadId: string | null;
  draft: string;
  quotedSenderId?: string | null;
  inRoundtable: boolean;
  roundtableOn: boolean;
  now: number;
}): string | null {
  const { conversation, members } = input;
  if (!conversation || conversation.kind !== "group" || members.length === 0) return null;
  if (input.inRoundtable) {
    const named = findMentionedAgents(input.draft, mentionable(members));
    const explicit = extractMentionedNames(input.draft).includes(CHANNEL_ALL_MENTION_NAME)
      ? []
      : named.map((member) => member.name);
    if (explicit.length === 0) return "The roundtable continues with everyone.";
    return (
      formatResponderHint({
        explicitNames: explicit,
        recentNames: [],
        discussInOrder: true,
      }) ?? null
    );
  }
  const preview = previewRoute({
    members,
    content: input.draft,
    quotedSenderId: input.quotedSenderId,
    recentParticipantIds: recentParticipantIds(
      input.messages,
      conversation,
      input.threadId,
      input.now,
    ),
    defaultResponderId: conversation.defaultResponderId,
  });
  const discussInOrder =
    input.roundtableOn &&
    roundtableEligibility({ conversation, threadId: input.threadId, draft: input.draft, members })
      .eligible;
  return formatRouteHint(preview, members, { discussInOrder });
}

const TRAILING_MENTION = /(^|\s)@([^\n]*)$/;
/** Members whose name starts what follows the draft's trailing `@`, for the suggestion list. */
export function mentionSuggestions(
  draft: string,
  members: readonly PreviewMember[],
): PreviewMember[] {
  const match = TRAILING_MENTION.exec(draft);
  if (!match) return [];
  const query = match[2].toLowerCase();
  return members
    .filter((member) => member.name.toLowerCase().startsWith(query))
    .slice(0, MENTION_OPTION_LIMIT);
}
/** Completes the trailing `@query` to `@Name `, the encoding `findMentionedAgents` reads. */
export function applyMention(draft: string, name: string): string {
  return draft.replace(TRAILING_MENTION, (_whole, lead: string) => `${lead}@${name} `);
}

const ENDED_REASON: Record<string, string> = {
  max_rounds: `reached the limit of ${ROUNDTABLE_MAX_ROUNDS} rounds`,
  max_messages: "reached the message limit",
  all_passed: "everyone passed",
};
/** The text of a centred ledger note. The roundtable end gets a friendly label. */
export function noteLabel(message: Pick<Message, "content" | "event">): string {
  if (message.event?.type !== "roundtable_ended") return message.content;
  const reason = ENDED_REASON[message.event.detail ?? ""];
  return reason
    ? `Roundtable ended: ${reason}. Send a message to continue.`
    : "Roundtable ended. Send a message to continue.";
}

export interface RoundtableProgress {
  /** 1-based, never past `of`. */
  round: number;
  of: number;
  ended: boolean;
}
/**
 * Where the roundtable in this thread stands: the epoch of the live turn, else of the newest
 * message that carries one. Rounds are 0-based on the wire; a passing speaker's turn still counts.
 * Null when the thread has no roundtable.
 */
export function roundtableProgress(
  messages: readonly Message[],
  turns: readonly Turn[],
  conversationId: string,
  threadId: string | null,
): RoundtableProgress | null {
  if (!threadId) return null;
  const inThread = messages.filter(
    (message) => message.conversationId === conversationId && message.threadId === threadId,
  );
  const threadTurns = turns.filter(
    (turn) => turn.conversationId === conversationId && turn.threadId === threadId,
  );
  const epochId =
    threadTurns.findLast((turn) => turn.epochId && LIVE_TURN.has(turn.status))?.epochId ??
    sortMessages(inThread.filter((message) => message.epochId)).at(-1)?.epochId ??
    threadTurns.findLast((turn) => turn.epochId)?.epochId;
  if (!epochId) return null;
  const rounds = [
    ...inThread.filter((message) => message.epochId === epochId).map((message) => message.round),
    ...threadTurns.filter((turn) => turn.epochId === epochId).map((turn) => turn.round),
  ].filter((round): round is number => typeof round === "number");
  const latest = rounds.length ? Math.max(...rounds) : 0;
  return {
    round: Math.min(latest + 1, ROUNDTABLE_MAX_ROUNDS),
    of: ROUNDTABLE_MAX_ROUNDS,
    ended: inThread.some(
      (message) =>
        message.epochId === epochId &&
        message.kind === "system" &&
        message.event?.type === "roundtable_ended",
    ),
  };
}
export function roundtableTitle(progress: RoundtableProgress | null): string {
  if (!progress) return "Thread";
  const label = `Roundtable · round ${progress.round} of ${progress.of}`;
  return progress.ended ? `${label} · ended` : label;
}
