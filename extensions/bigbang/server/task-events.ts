import { createHash } from "node:crypto";
import type { Message, Task } from "../shared/contracts";

/** The most result text a lifecycle row (and the receipt prompt built from it) carries. */
export const RESULT_EXCERPT_CHARS = 3000;
const TITLE_CHARS = 60;

export type TaskEventType =
  | "task_started"
  | "task_attention"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "task_queued"
  | "task_budget"
  | "task_workers_capped";

export const taskThreadId = (taskId: string) => `task:${taskId}`;
export const resultMessageId = (taskId: string) => `result:${taskId}`;
export const receiptTurnId = (taskId: string) => `receipt:${taskId}`;

export function taskTitle(task: Pick<Task, "title" | "prompt">): string {
  const named = task.title?.trim();
  if (named) return named;
  const line = task.prompt.trim().split("\n", 1)[0] ?? "";
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}
export function excerpt(text: string, limit = RESULT_EXCERPT_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit)}\n[Truncated. The full result is in the task thread.]`
    : trimmed;
}

/** A lifecycle row has a stable id, so posting it twice leaves one row. */
export function eventMessageId(taskId: string, type: TaskEventType, key?: string): string {
  return `event:${taskId}:${type.replace("task_", "")}${key ? `:${key}` : ""}`;
}

interface EventOptions {
  /** Distinguishes repeatable events of one task (a run, an approval request). */
  key?: string;
  detail?: string;
  requestId?: string;
  createdAt: number;
  /** Why the task is queued: how many slots are busy of how many. */
  slots?: { busy: number; limit: number };
  budgetMinutes?: number;
}

function eventContent(type: TaskEventType, title: string, options: EventOptions): string {
  const label = `"${title}"`;
  switch (type) {
    case "task_started":
      return `Started ${label}. Work continues in the task thread.`;
    case "task_attention":
      return `${label} needs your approval${options.detail ? `: ${options.detail}` : "."}`;
    case "task_completed":
      return `${label} completed.`;
    case "task_failed":
      return `${label} failed.`;
    case "task_cancelled":
      return `${label} was cancelled.`;
    case "task_queued":
      return options.slots
        ? `${label} is queued: ${options.slots.busy} of ${options.slots.limit} task slots are busy. It starts when one frees up.`
        : `${label} is queued until a task slot frees up.`;
    case "task_budget":
      return `${label} stopped after its ${options.budgetMinutes ?? 30} minute budget. Reply in the task thread to continue.`;
    case "task_workers_capped":
      return `${label} is limited in how many work agents it may run at once; the extra ones were stopped.`;
  }
}

/** The `task_event` row for a task in the lane it was requested from. */
export function taskEventMessage(task: Task, type: TaskEventType, options: EventOptions): Message {
  return {
    id: eventMessageId(task.id, type, options.key),
    conversationId: task.conversationId,
    threadId: task.sourceThreadId ?? null,
    senderId: "system",
    content: eventContent(type, taskTitle(task), options),
    createdAt: options.createdAt,
    taskId: task.id,
    kind: "task_event",
    event: {
      type,
      taskId: task.id,
      ...(options.detail ? { detail: options.detail } : {}),
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(task.origin === "assistant" ? { notifyAssistantId: task.assistantId } : {}),
    },
  };
}

/** What the requesting assistant is told when its task reaches an outcome. */
export function receiptText(message: Message): string {
  return `${message.content}${message.event?.detail ? `\n${message.event.detail}` : ""}`;
}

/** A UUID derived from the caller's turn and the brief: the same call always names the same task. */
export function deterministicTaskId(turnId: string, prompt: string): string {
  const digest = createHash("sha256")
    .update(turnId)
    .update("\0")
    .update(createHash("sha256").update(prompt).digest("hex"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
