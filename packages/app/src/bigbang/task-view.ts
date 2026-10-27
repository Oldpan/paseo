// Client-side task presentation: card state, lifecycle row labels and the approval an inline
// control may answer. Pure so it is unit tested; the coordinator owns every fact it reads.
import type { Message, Task } from "../../../../extensions/bigbang/shared/contracts";

const LIVE = new Set<Task["status"]>(["queued", "creating", "running", "attention", "unknown"]);
const TITLE_CHARS = 60;

/** The thread a task's result and follow-ups live in; its root message is `task:<id>`. */
export function taskThreadId(taskId: string): string {
  return `task:${taskId}`;
}
/** The task id a thread belongs to, or null for any other thread. */
export function taskIdOfThread(threadId: string | null): string | null {
  return threadId?.startsWith("task:") ? threadId.slice("task:".length) : null;
}
/** Whether a message is the root of its task's thread (the one that shows the task card). */
export function isTaskRoot(message: Pick<Message, "id" | "taskId">): boolean {
  return Boolean(message.taskId) && message.id === taskThreadId(message.taskId!);
}

export function isLiveTask(task: Pick<Task, "status">): boolean {
  return LIVE.has(task.status);
}

/** Mirrors the coordinator's title rule: the explicit title, else the first line of the prompt. */
export function taskTitle(task: Pick<Task, "title" | "prompt">): string {
  const named = task.title?.trim();
  if (named) return named;
  const line = task.prompt.trim().split("\n", 1)[0] ?? "";
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}
/** The prompt under the title; absent when the title already is the whole prompt. */
export function taskDetail(task: Pick<Task, "title" | "prompt">): string | null {
  const prompt = task.prompt.trim();
  return prompt && prompt !== taskTitle(task) ? prompt : null;
}

export type Tone = "live" | "ok" | "bad" | "muted";

export interface TaskApproval {
  requestId: string;
  title: string;
}
/** The approval the task is waiting on, only while the task can still receive an answer. */
export function pendingApproval(
  task: Pick<Task, "status" | "pendingPermission">,
): TaskApproval | null {
  if (!isLiveTask(task) || !task.pendingPermission) return null;
  return { requestId: task.pendingPermission.requestId, title: task.pendingPermission.title };
}

const STATUS_LABEL: Record<Task["status"], string> = {
  queued: "Queued",
  creating: "Starting",
  running: "Running",
  attention: "Needs approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Reconnecting",
};
function taskTone(task: Pick<Task, "status" | "stopReason">): Tone {
  if (isLiveTask(task)) return "live";
  if (task.status === "completed") return "ok";
  if (task.status === "failed") return "bad";
  return "muted";
}

export interface TaskCardState {
  title: string;
  detail: string | null;
  statusLabel: string;
  tone: Tone;
  live: boolean;
  /** The assistant's name when the assistant started the task on its own. */
  origin: string | null;
  /** "Machine · directory · isolation". */
  target: string;
  provider: string;
  error: string | null;
  /** The task stopped because its time budget ran out; a reply in the thread continues it. */
  budgetStopped: boolean;
  approval: TaskApproval | null;
  canCancel: boolean;
  canOpenStudio: boolean;
  /** The task's thread has a root message to open; cards inside that thread do not offer it. */
  canOpenThread: boolean;
}
export function taskCardState(input: {
  task: Task;
  assistantName?: string;
  hostLabel?: string;
  inThread: boolean;
}): TaskCardState {
  const { task, inThread } = input;
  const live = isLiveTask(task);
  const budgetStopped = task.status === "cancelled" && task.stopReason === "budget";
  return {
    title: taskTitle(task),
    detail: taskDetail(task),
    statusLabel: budgetStopped ? "Budget reached" : STATUS_LABEL[task.status],
    tone: budgetStopped ? "muted" : taskTone(task),
    live,
    origin: task.origin === "assistant" ? (input.assistantName ?? "Assistant") : null,
    target: [
      input.hostLabel ?? task.serverId,
      task.directory,
      task.isolation === "worktree" ? "new worktree" : "existing directory",
    ].join(" · "),
    provider: task.provider,
    error: task.error,
    budgetStopped,
    approval: pendingApproval(task),
    canCancel: live && !task.cancelPending,
    canOpenStudio: Boolean(task.execution),
    canOpenThread: !inThread,
  };
}

/** Whether a reply in the task thread can continue the task (the coordinator checks the same). */
export function followUpState(task: Task | undefined): { allowed: boolean; hint: string } {
  if (!task) return { allowed: true, hint: "Replies in this thread go to the task." };
  if (!task.execution)
    return { allowed: false, hint: "The task has not started yet. Replies open once it does." };
  if (task.status === "cancelled" && task.stopReason !== "budget")
    return { allowed: false, hint: "This task was cancelled and cannot take a follow-up." };
  if (task.status === "cancelled")
    return { allowed: true, hint: "Budget reached. Reply to continue the task." };
  return { allowed: true, hint: "Replies in this thread go to the task." };
}

const EVENT_GLYPH: Record<string, { glyph: string; tone: Tone }> = {
  task_started: { glyph: "▶", tone: "live" },
  task_attention: { glyph: "!", tone: "live" },
  task_completed: { glyph: "✓", tone: "ok" },
  task_failed: { glyph: "✕", tone: "bad" },
  task_cancelled: { glyph: "⊘", tone: "muted" },
  task_queued: { glyph: "…", tone: "muted" },
  task_budget: { glyph: "◷", tone: "muted" },
  task_workers_capped: { glyph: "▲", tone: "muted" },
};
const UNKNOWN_EVENT = { glyph: "•", tone: "muted" as Tone };

export interface TaskEventNote {
  glyph: string;
  tone: Tone;
  text: string;
  taskId: string | null;
  /** Set only while this row's approval is still the task's pending one. */
  approval: TaskApproval | null;
}
/** A `task_event` row as a compact note. A newer daemon's unknown event types still render. */
export function taskEventNote(
  message: Pick<Message, "content" | "event" | "taskId">,
  task: Pick<Task, "status" | "pendingPermission"> | undefined,
): TaskEventNote {
  const type = message.event?.type ?? "";
  const style = EVENT_GLYPH[type] ?? UNKNOWN_EVENT;
  const requestId = message.event?.requestId;
  // Only the task's current request can still be answered.
  const current = Boolean(task && requestId && task.pendingPermission?.requestId === requestId);
  const approval = type === "task_attention" && current && task ? pendingApproval(task) : null;
  return {
    glyph: style.glyph,
    tone: style.tone,
    text: message.content,
    taskId: message.event?.taskId ?? message.taskId,
    approval,
  };
}
