import type { StreamItem } from "@/types/stream";
export { turnColumnName } from "./chat-studio";

export interface LiveTurnView {
  /** The turn's anchoring user_message is in the stream. Otherwise the other fields are empty. */
  found: boolean;
  /** Assistant text from earlier messages of the turn (what the agent said while it worked). */
  commentary: string;
  /** The message that becomes the turn's final reply, boundary marker removed. */
  text: string;
  /** Name of the tool or step the agent is running right now, if any. */
  activity: string | null;
}

export interface TurnStreamSlice {
  /** The turn's anchoring user_message is in the stream. */
  found: boolean;
  /** Retained stream items belonging to this turn (after its prompt anchor). */
  tail: StreamItem[];
  /** Live streaming head items belonging to this turn. */
  head: StreamItem[];
}

export const TURN_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  creating: "Starting…",
  running: "Thinking…",
  attention: "Waiting for you",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Reconnecting…",
};

// Codex prepends this to a new assistant item that follows an earlier one in the same turn.
// Keep in step with extensions/pavra/server/projection.ts, which commits the same text.
const ASSISTANT_MESSAGE_BOUNDARY = "\n\n---\n\n";
const NOT_FOUND: LiveTurnView = { found: false, commentary: "", text: "", activity: null };
const EMPTY_STREAM_ITEMS: StreamItem[] = [];

function stripBoundary(text: string): string {
  return text.startsWith(ASSISTANT_MESSAGE_BOUNDARY)
    ? text.slice(ASSISTANT_MESSAGE_BOUNDARY.length)
    : text;
}

function activityOf(item: StreamItem | undefined): string | null {
  if (!item) return null;
  if (item.kind === "thought") return item.status === "loading" ? "Thinking" : null;
  if (item.kind !== "tool_call") return null;
  const { payload } = item;
  if (payload.source === "agent")
    return payload.data.status === "running" ? payload.data.name : null;
  return payload.data.status === "executing" ? payload.data.toolName : null;
}

/** The latest running tool or open thought since the agent last spoke. */
function currentActivity(segment: readonly StreamItem[]): string | null {
  for (let index = segment.length - 1; index >= 0; index -= 1) {
    const item = segment[index];
    if (item.kind === "assistant_message") return null;
    const activity = activityOf(item);
    if (activity) return activity;
  }
  return null;
}

/**
 * Reads one Chat turn out of an agent's stream (`agentStreamTail` followed by `agentStreamHead`).
 * The user_message whose messageId equals the turn id anchors the turn, so a later turn or a
 * message typed in Studio is never mistaken for it. The final text follows the same rule as the
 * coordinator's projection: the trailing run of one assistant messageId.
 */
export function selectLiveTurn(items: readonly StreamItem[], turnId: string): LiveTurnView {
  // The anchor sits near the end of a long history, and a turn id is unique.
  const anchor = items.findLastIndex(
    (item) => item.kind === "user_message" && item.messageId === turnId,
  );
  if (anchor < 0) return NOT_FOUND;
  const after = items.slice(anchor + 1);
  const next = after.findIndex((item) => item.kind === "user_message");
  const segment = next < 0 ? after : after.slice(0, next);
  const last = segment.findLastIndex((item) => item.kind === "assistant_message");
  const activity = currentActivity(segment);
  if (last < 0) return { found: true, commentary: "", text: "", activity };
  const lastItem = segment[last];
  if (lastItem.kind !== "assistant_message") return NOT_FOUND;
  let first = last;
  while (first > 0) {
    const previous = segment[first - 1];
    if (previous.kind !== "assistant_message" || previous.messageId !== lastItem.messageId) break;
    first -= 1;
  }
  const textOf = (from: number, to: number) =>
    segment
      .slice(from, to)
      .map((item) => (item.kind === "assistant_message" ? item.text : ""))
      .join("");
  const commentary = segment
    .slice(0, first)
    .filter((item) => item.kind === "assistant_message")
    .map((item) => stripBoundary(item.text).trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
  return {
    found: true,
    commentary,
    text: stripBoundary(textOf(first, last + 1)),
    activity,
  };
}

// An awareness turn may answer "(pass)"; the coordinator commits nothing for it, so its first
// characters must not flash either.
const PASS = "(pass)";
export function isPassPrefix(text: string): boolean {
  const value = text.trim().toLowerCase();
  return value.length > 0 && (PASS.startsWith(value) || value === "pass");
}
/**
 * An awareness turn is a peer deciding whether to speak up. It earns a bubble only once it has
 * real text or needs an approval, so a pass leaves nothing behind.
 */
export function isSilentAwareness(input: {
  kind: string | undefined;
  text: string;
  hasPermissions: boolean;
}): boolean {
  return (
    input.kind === "awareness" &&
    !input.hasPermissions &&
    (input.text.trim() === "" || isPassPrefix(input.text))
  );
}

/**
 * Extracts a single-line summary of the latest commentary block so the chat bubble can show one
 * real-time status line while the full process stays folded inside the Process Drawer.
 */
export function summarizeCommentary(commentary: string): string | null {
  const blocks = commentary
    .split("\n\n")
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0);
  return blocks.at(-1) ?? null;
}

/**
 * Formats the single-line status indicator for an in-flight turn:
 * `activity` if present, otherwise a single-line summary of `commentary`, otherwise `statusLabel`.
 */
export function formatLiveTurnStatus(input: {
  sender: string;
  activity: string | null;
  commentary: string;
  statusLabel: string;
}): string {
  const activity = input.activity?.trim();
  if (activity) return `${input.sender} · ${activity}…`;
  const note = summarizeCommentary(input.commentary);
  if (note) return `${input.sender} · ${note}`;
  return `${input.sender} · ${input.statusLabel}`;
}

/**
 * Slices an execution agent's `tail` and `head` stream items to the segment belonging to `turnId`
 * (everything after the anchoring `user_message` up to the next `user_message`). Excluding the
 * synthetic `user_message` prompt keeps `AgentStreamView` from folding completed turns behind a
 * collapsed summary row inside the Process Drawer.
 */
export function selectTurnStream(
  tail: readonly StreamItem[],
  head: readonly StreamItem[],
  turnId: string,
): TurnStreamSlice {
  const tailAnchor = tail.findLastIndex(
    (item) => item.kind === "user_message" && item.messageId === turnId,
  );
  if (tailAnchor >= 0) {
    const nextInTail = tail.findIndex(
      (item, index) => index > tailAnchor && item.kind === "user_message",
    );
    if (nextInTail >= 0) {
      return {
        found: true,
        tail: tail.slice(tailAnchor + 1, nextInTail),
        head: EMPTY_STREAM_ITEMS,
      };
    }
    const nextInHead = head.findIndex((item) => item.kind === "user_message");
    return {
      found: true,
      tail: tail.slice(tailAnchor + 1),
      head: nextInHead < 0 ? (head as StreamItem[]) : head.slice(0, nextInHead),
    };
  }

  const headAnchor = head.findLastIndex(
    (item) => item.kind === "user_message" && item.messageId === turnId,
  );
  if (headAnchor >= 0) {
    const nextInHead = head.findIndex(
      (item, index) => index > headAnchor && item.kind === "user_message",
    );
    return {
      found: true,
      tail: EMPTY_STREAM_ITEMS,
      head: nextInHead < 0 ? head.slice(headAnchor + 1) : head.slice(headAnchor + 1, nextInHead),
    };
  }

  if (tail.length === 0 && head.length === 0) {
    return { found: false, tail: EMPTY_STREAM_ITEMS, head: EMPTY_STREAM_ITEMS };
  }
  const lastUser = tail.findLastIndex((item) => item.kind === "user_message");
  if (lastUser >= 0 && (lastUser + 1 < tail.length || head.length > 0)) {
    return {
      found: false,
      tail: tail.slice(lastUser + 1),
      head: head as StreamItem[],
    };
  }
  return {
    found: false,
    tail: tail as StreamItem[],
    head: head as StreamItem[],
  };
}
