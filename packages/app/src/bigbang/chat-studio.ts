import type { Turn } from "../../../../extensions/bigbang/shared/contracts";

/** Latest non-task execution for an assistant. `scope` keeps Chat -> Studio on that lane. */
export function findLatestNonTaskTurn(
  turns: readonly Turn[],
  assistantId: string,
  scope?: { conversationId: string; threadId: string | null },
): Turn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.taskId || turn.assistantId !== assistantId) continue;
    if (scope && (turn.conversationId !== scope.conversationId || turn.threadId !== scope.threadId))
      continue;
    return turn;
  }
  return undefined;
}

export function turnColumnName(
  assistantName: string,
  conversation: { kind: string; name: string } | undefined,
  threadId: string | null | undefined,
): string {
  if (threadId) return `${assistantName} · Thread`;
  if (conversation?.kind === "group") return `${assistantName} · ${conversation.name}`;
  return `${assistantName} · Chat`;
}
