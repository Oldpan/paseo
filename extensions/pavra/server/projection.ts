// Reads one Chat turn's result out of an execution's native timeline. The user_message whose
// messageId equals the Chat turn id anchors the turn, so a later turn or a message typed in
// Studio can never be mistaken for it.

/** The slice of an agent timeline entry this projection reads. */
export interface ProjectionEntry {
  item: { type: string; text?: string; message?: string; messageId?: string };
}
export interface TurnProjection {
  /** Final assistant text of the turn, boundary marker removed. Empty when it produced none. */
  text: string;
  /** A later user_message exists, so the turn can no longer be growing. */
  closed: boolean;
  /** The turn's last item is an error. */
  error: string | null;
}

// Codex prepends this to a new assistant item that follows an earlier one in the same turn.
const ASSISTANT_MESSAGE_BOUNDARY = "\n\n---\n\n";

/** `null` means the anchor is not in `entries`: unknown, never guessed. */
export function finalTextAfter(
  entries: readonly ProjectionEntry[],
  messageId: string,
): TurnProjection | null {
  const anchor = entries.findIndex(
    ({ item }) => item.type === "user_message" && item.messageId === messageId,
  );
  if (anchor < 0) return null;
  const after = entries.slice(anchor + 1);
  const next = after.findIndex(({ item }) => item.type === "user_message");
  const segment = (next < 0 ? after : after.slice(0, next)).map(({ item }) => item);
  const last = segment.findLastIndex((item) => item.type === "assistant_message");
  const lastItem = segment.at(-1);
  const error = lastItem?.type === "error" ? (lastItem.message ?? "The turn failed.") : null;
  if (last < 0) return { text: "", closed: next >= 0, error };
  // Trailing run of one message: stops at a tool call, reasoning, or another messageId. Providers
  // without ids (all undefined) fall back to the last contiguous assistant segment.
  const messageIdOfLast = segment[last].messageId;
  let first = last;
  while (
    first > 0 &&
    segment[first - 1].type === "assistant_message" &&
    segment[first - 1].messageId === messageIdOfLast
  )
    first--;
  let text = segment
    .slice(first, last + 1)
    .map((item) => item.text ?? "")
    .join("");
  if (text.startsWith(ASSISTANT_MESSAGE_BOUNDARY))
    text = text.slice(ASSISTANT_MESSAGE_BOUNDARY.length);
  return { text, closed: next >= 0, error };
}

export function isPass(text: string): boolean {
  return /^\(?pass\)?$/i.test(text.trim());
}
