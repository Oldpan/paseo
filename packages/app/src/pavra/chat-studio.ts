import type { Turn } from "../../../../extensions/pavra/shared/contracts";

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
  rootMessage?: { content: string } | null,
  conversationId?: string,
): string {
  if (conversationId?.startsWith("mailbox:")) return `${assistantName} · Mailbox`;
  const excerpt = rootMessage?.content.replace(/\s+/g, " ").trim().slice(0, 20) ?? "";
  if (conversation?.kind === "group") {
    const channel = conversation.name.startsWith("#")
      ? conversation.name.slice(1)
      : conversation.name;
    if (threadId) return `${assistantName} · #${channel} › ${excerpt || "Thread"}`;
    return `${assistantName} · #${channel}`;
  }
  if (threadId) {
    return excerpt ? `${assistantName} · Thread: ${excerpt}` : `${assistantName} · Thread`;
  }
  if (conversation?.kind === "dm") return `${assistantName} · DM`;
  return `${assistantName} · Chat`;
}
