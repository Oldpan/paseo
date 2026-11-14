// Pure, deterministic Inbox derivation and ledger scan. Reads `ChatState` with zero model calls
// to produce the four Inbox sections: Needs your action, Recent activity, Upcoming, and Suggestions.
import type {
  Assistant,
  ChatState,
  Conversation,
  Message,
  Routine,
  RoutineRun,
  RoutineRunOutcome,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { formatRoutineCadence } from "./routines";
import { isLiveTask, taskThreadId, taskTitle } from "./task-view";

export const DEFAULT_STALE_TASK_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_MAX_RECENT_ACTIVITY = 30;

export const RECEIPT_TASK_EVENT_TYPES = new Set([
  "task_completed",
  "task_failed",
  "task_cancelled",
  "task_budget",
  "task_workers_capped",
]);

export const formatCadence = formatRoutineCadence;

export function firstLine(text: string, maxLength = 80): string {
  const line =
    text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0) ?? "";
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 1)}…`;
}

export interface InboxTaskPermissionItem {
  id: string;
  kind: "task_permission";
  taskId: string;
  requestId: string | null;
  permissionTitle: string;
  title: string;
  conversationId: string;
  conversationName: string;
  threadId: string;
  assistantId: string;
  assistantName: string;
  createdAt: number;
  task: Task;
}

export interface InboxTurnAttentionItem {
  id: string;
  kind: "turn_attention";
  turnId: string;
  title: string;
  conversationId: string;
  conversationName: string;
  threadId: string | null;
  assistantId: string;
  assistantName: string;
  createdAt: number;
  turn: Turn;
}

export interface InboxTaskBudgetItem {
  id: string;
  kind: "task_budget";
  taskId: string;
  title: string;
  conversationId: string;
  conversationName: string;
  threadId: string;
  assistantId: string;
  assistantName: string;
  createdAt: number;
  task: Task;
}

export type InboxActionItem =
  | InboxTaskPermissionItem
  | InboxTurnAttentionItem
  | InboxTaskBudgetItem;

export interface InboxRoutineRunActivityItem {
  id: string;
  kind: "routine_run";
  routineId: string;
  routineName: string;
  isReminder: boolean;
  outcome: RoutineRunOutcome;
  summary: string;
  timestamp: number;
  assistantId: string;
  assistantName: string;
  conversationId: string;
  conversationName: string;
  threadId: string | null;
  turnId: string | null;
}

export interface InboxTaskReceiptActivityItem {
  id: string;
  kind: "task_receipt";
  taskId: string | null;
  eventType: string;
  title: string;
  summary: string;
  timestamp: number;
  assistantId: string | null;
  assistantName: string;
  conversationId: string;
  conversationName: string;
  threadId: string | null;
  task: Task | null;
}

export type InboxActivityItem = InboxRoutineRunActivityItem | InboxTaskReceiptActivityItem;

export interface InboxUpcomingItem {
  id: string;
  routine: Routine;
  routineId: string;
  routineName: string;
  isReminder: boolean;
  cadenceLabel: string;
  nextRunAt: number;
  assistantId: string;
  assistantName: string;
  conversationId: string;
  conversationName: string;
  threadId: string | null;
}

export interface InboxStaleTaskSuggestion {
  id: string;
  kind: "stale_task";
  taskId: string;
  title: string;
  reason: string;
  isLive: boolean;
  conversationId: string;
  conversationName: string;
  threadId: string;
  assistantId: string;
  assistantName: string;
  timestamp: number;
  task: Task;
}

export interface InboxFailedTurnSuggestion {
  id: string;
  kind: "failed_turn";
  turnId: string;
  title: string;
  reason: string;
  conversationId: string;
  conversationName: string;
  threadId: string | null;
  assistantId: string;
  assistantName: string;
  timestamp: number;
  turn: Turn;
}

export interface InboxPausedRoutineSuggestion {
  id: string;
  kind: "paused_routine";
  routineId: string;
  routineName: string;
  isReminder: boolean;
  title: string;
  reason: string;
  conversationId: string;
  conversationName: string;
  threadId: string | null;
  assistantId: string;
  assistantName: string;
  timestamp: number;
  routine: Routine;
}

export interface InboxFailingRoutineSuggestion {
  id: string;
  kind: "failing_routine";
  routineId: string;
  routineName: string;
  isReminder: boolean;
  title: string;
  reason: string;
  conversationId: string;
  conversationName: string;
  threadId: string | null;
  assistantId: string;
  assistantName: string;
  timestamp: number;
  routine: Routine;
  lastRun: RoutineRun;
}

export type InboxSuggestionItem =
  | InboxStaleTaskSuggestion
  | InboxFailedTurnSuggestion
  | InboxPausedRoutineSuggestion
  | InboxFailingRoutineSuggestion;

export interface InboxState {
  needsAction: InboxActionItem[];
  recentActivity: InboxActivityItem[];
  upcoming: InboxUpcomingItem[];
  suggestions: InboxSuggestionItem[];
}

export interface DeriveInboxOptions {
  staleTaskMs?: number;
  maxRecentActivity?: number;
}

interface LedgerLookups {
  assistantsById: ReadonlyMap<string, Assistant>;
  conversationsById: ReadonlyMap<string, Conversation>;
  messagesById: ReadonlyMap<string, Message>;
  tasksById: ReadonlyMap<string, Task>;
  messagesByLane: ReadonlyMap<string, Message[]>;
}

function buildLedgerLookups(state: ChatState): LedgerLookups {
  const assistantsById = new Map(state.assistants.map((item) => [item.id, item]));
  const conversationsById = new Map(state.conversations.map((item) => [item.id, item]));
  const messagesById = new Map(state.messages.map((item) => [item.id, item]));
  const tasksById = new Map(state.tasks.map((item) => [item.id, item]));

  const messagesByLane = new Map<string, Message[]>();
  for (const message of state.messages) {
    const key = `${message.conversationId}\0${message.threadId ?? ""}`;
    const list = messagesByLane.get(key);
    if (list) list.push(message);
    else messagesByLane.set(key, [message]);
  }
  for (const list of messagesByLane.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
  }

  return {
    assistantsById,
    conversationsById,
    messagesById,
    tasksById,
    messagesByLane,
  };
}

function resolveAssistantName(
  assistantsById: ReadonlyMap<string, Assistant>,
  assistantId: string | null | undefined,
): string {
  if (!assistantId) return "Assistant";
  return assistantsById.get(assistantId)?.name ?? "Assistant";
}

function resolveConversationName(
  conversationsById: ReadonlyMap<string, Conversation>,
  conversationId: string,
): string {
  const conversation = conversationsById.get(conversationId);
  if (!conversation) return conversationId;
  return conversation.name;
}

function resolveTurnTimestamp(
  turn: Turn,
  messagesById: ReadonlyMap<string, Message>,
  laneMessages: readonly Message[],
): number {
  const explicit = (turn as { createdAt?: number }).createdAt;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  const triggerIds = [turn.triggerId, turn.seenUserId, turn.rootTriggerId, turn.finalMessageId];
  for (const id of triggerIds) {
    if (!id) continue;
    const message = messagesById.get(id);
    if (message) return message.createdAt;
  }
  const matchingPrompt = laneMessages.findLast(
    (msg) => msg.senderId === "user" && msg.content === turn.prompt,
  );
  if (matchingPrompt) return matchingPrompt.createdAt;
  const lastInLane = laneMessages.at(-1);
  return lastInLane?.createdAt ?? 0;
}

function hasNewerUserMessageInTurnLane(
  turn: Turn,
  messagesById: ReadonlyMap<string, Message>,
  laneMessages: readonly Message[],
): boolean {
  const userMessages = laneMessages.filter((msg) => msg.senderId === "user" || msg.kind === "user");
  if (userMessages.length === 0) return false;

  const triggerId = turn.triggerId ?? turn.seenUserId ?? turn.rootTriggerId;
  const triggerMsg = triggerId ? messagesById.get(triggerId) : undefined;
  if (triggerMsg) {
    const triggerIndex = laneMessages.findIndex((msg) => msg.id === triggerMsg.id);
    return userMessages.some((msg) => {
      if (msg.id === triggerMsg.id) return false;
      if (msg.createdAt > triggerMsg.createdAt) return true;
      if (msg.createdAt === triggerMsg.createdAt && triggerIndex >= 0) {
        return laneMessages.findIndex((item) => item.id === msg.id) > triggerIndex;
      }
      return false;
    });
  }

  const explicitCreatedAt = (turn as { createdAt?: number }).createdAt;
  if (typeof explicitCreatedAt === "number" && Number.isFinite(explicitCreatedAt)) {
    return userMessages.some((msg) => msg.createdAt > explicitCreatedAt);
  }

  const promptMatchIndex = userMessages.findLastIndex((msg) => msg.content === turn.prompt);
  if (promptMatchIndex >= 0) {
    return promptMatchIndex < userMessages.length - 1;
  }

  return true;
}

function findMostRecentFinishedRun(runs: readonly RoutineRun[]): RoutineRun | undefined {
  let latest: RoutineRun | undefined;
  let latestTimestamp = -Infinity;
  for (const run of runs) {
    if (run.status === "running") continue;
    const timestamp = run.endedAt ?? run.startedAt ?? run.scheduledFor;
    if (!latest || timestamp > latestTimestamp) {
      latest = run;
      latestTimestamp = timestamp;
    }
  }
  return latest;
}

function formatElapsedHours(ms: number): string {
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function formatStaleTaskReason(task: Task, isStaleActive: boolean, now: number): string {
  if (isStaleActive) {
    return `Task has been ${task.status} for ${formatElapsedHours(now - task.createdAt)}.`;
  }
  if (task.status === "failed") {
    return task.error
      ? `Task failed (${task.error}) with no follow-up in thread.`
      : "Task failed with no follow-up in thread.";
  }
  return "Task connection state is unknown with no follow-up in thread.";
}

function deriveNeedsAction(state: ChatState, lookups: LedgerLookups): InboxActionItem[] {
  const { assistantsById, conversationsById, messagesById, messagesByLane } = lookups;
  const needsAction: InboxActionItem[] = [];

  for (const task of state.tasks) {
    if (isLiveTask(task) && (task.pendingPermission != null || task.status === "attention")) {
      const requestId = task.pendingPermission?.requestId ?? null;
      needsAction.push({
        id: `task-perm:${task.id}:${requestId ?? "attention"}`,
        kind: "task_permission",
        taskId: task.id,
        requestId,
        permissionTitle: task.pendingPermission?.title ?? "Permission required",
        title: taskTitle(task),
        conversationId: task.conversationId,
        conversationName: resolveConversationName(conversationsById, task.conversationId),
        threadId: taskThreadId(task.id),
        assistantId: task.assistantId,
        assistantName: resolveAssistantName(assistantsById, task.assistantId),
        createdAt: task.createdAt,
        task,
      });
      continue;
    }
    if (task.status === "cancelled" && task.stopReason === "budget") {
      needsAction.push({
        id: `task-budget:${task.id}`,
        kind: "task_budget",
        taskId: task.id,
        title: taskTitle(task),
        conversationId: task.conversationId,
        conversationName: resolveConversationName(conversationsById, task.conversationId),
        threadId: taskThreadId(task.id),
        assistantId: task.assistantId,
        assistantName: resolveAssistantName(assistantsById, task.assistantId),
        createdAt: task.deadline || task.createdAt,
        task,
      });
    }
  }

  for (const turn of state.turns) {
    if (turn.status !== "attention" || turn.conversationId.startsWith("mailbox:")) continue;
    const laneKey = `${turn.conversationId}\0${turn.threadId ?? ""}`;
    const laneMessages = messagesByLane.get(laneKey) ?? [];
    needsAction.push({
      id: `turn-attn:${turn.id}`,
      kind: "turn_attention",
      turnId: turn.id,
      title: firstLine(turn.prompt) || "Turn waiting for attention",
      conversationId: turn.conversationId,
      conversationName: resolveConversationName(conversationsById, turn.conversationId),
      threadId: turn.threadId,
      assistantId: turn.assistantId,
      assistantName: resolveAssistantName(assistantsById, turn.assistantId),
      createdAt: resolveTurnTimestamp(turn, messagesById, laneMessages),
      turn,
    });
  }

  needsAction.sort((a, b) => b.createdAt - a.createdAt);
  return needsAction;
}

function resolveMessageTaskAssistantId(message: Message, task: Task | null): string | null {
  if (task?.assistantId) return task.assistantId;
  if (message.event?.notifyAssistantId) return message.event.notifyAssistantId;
  if (message.senderId !== "system" && message.senderId !== "user") return message.senderId;
  return null;
}

function collectRoutineRunActivity(
  routines: readonly Routine[],
  lookups: LedgerLookups,
): InboxRoutineRunActivityItem[] {
  const { assistantsById, conversationsById } = lookups;
  const items: InboxRoutineRunActivityItem[] = [];
  for (const routine of routines) {
    const assistantName = resolveAssistantName(assistantsById, routine.assistantId);
    const conversationName = resolveConversationName(conversationsById, routine.conversationId);
    const isReminder = routine.maxRuns === 1;
    for (const run of routine.runs) {
      if (run.status === "running") continue;
      const outcome: RoutineRunOutcome =
        run.outcome ?? (run.status === "failed" ? "failed" : "passed");
      items.push({
        id: `routine-run:${routine.id}:${run.id}`,
        kind: "routine_run",
        routineId: routine.id,
        routineName: routine.name,
        isReminder,
        outcome,
        summary: run.summary ?? run.error ?? firstLine(routine.prompt),
        timestamp: run.endedAt ?? run.startedAt,
        assistantId: routine.assistantId,
        assistantName,
        conversationId: routine.conversationId,
        conversationName,
        threadId: routine.threadId,
        turnId: run.turnId,
      });
    }
  }
  return items;
}

function collectTaskReceiptActivity(
  messages: readonly Message[],
  lookups: LedgerLookups,
): InboxTaskReceiptActivityItem[] {
  const { assistantsById, conversationsById, tasksById } = lookups;
  const items: InboxTaskReceiptActivityItem[] = [];
  for (const message of messages) {
    if (message.kind !== "task_event") continue;
    const eventType = message.event?.type ?? "";
    if (!RECEIPT_TASK_EVENT_TYPES.has(eventType)) continue;
    const taskId = message.taskId ?? message.event?.taskId ?? null;
    const task = taskId ? (tasksById.get(taskId) ?? null) : null;
    const assistantId = resolveMessageTaskAssistantId(message, task);
    items.push({
      id: `task-event:${message.id}`,
      kind: "task_receipt",
      taskId,
      eventType,
      title: task ? taskTitle(task) : firstLine(message.content) || "Task update",
      summary: message.event?.detail || message.content,
      timestamp: message.createdAt,
      assistantId,
      assistantName: resolveAssistantName(assistantsById, assistantId),
      conversationId: message.conversationId,
      conversationName: resolveConversationName(conversationsById, message.conversationId),
      threadId: taskId ? taskThreadId(taskId) : message.threadId,
      task,
    });
  }
  return items;
}

function deriveRecentActivity(
  state: ChatState,
  lookups: LedgerLookups,
  maxRecentActivity: number,
): InboxActivityItem[] {
  const recentActivity: InboxActivityItem[] = [
    ...collectRoutineRunActivity(state.routines ?? [], lookups),
    ...collectTaskReceiptActivity(state.messages, lookups),
  ];
  recentActivity.sort((a, b) => b.timestamp - a.timestamp);
  return recentActivity.slice(0, maxRecentActivity);
}

function deriveUpcoming(state: ChatState, lookups: LedgerLookups): InboxUpcomingItem[] {
  const { assistantsById, conversationsById } = lookups;
  const upcoming: InboxUpcomingItem[] = [];
  for (const routine of state.routines ?? []) {
    if (routine.status !== "active" || routine.nextRunAt === null) continue;
    upcoming.push({
      id: `upcoming:${routine.id}`,
      routine,
      routineId: routine.id,
      routineName: routine.name,
      isReminder: routine.maxRuns === 1,
      cadenceLabel: formatCadence(routine.cadence),
      nextRunAt: routine.nextRunAt,
      assistantId: routine.assistantId,
      assistantName: resolveAssistantName(assistantsById, routine.assistantId),
      conversationId: routine.conversationId,
      conversationName: resolveConversationName(conversationsById, routine.conversationId),
      threadId: routine.threadId,
    });
  }
  upcoming.sort((a, b) => a.nextRunAt - b.nextRunAt);
  return upcoming;
}

function scanTaskSuggestions(
  tasks: readonly Task[],
  lookups: LedgerLookups,
  now: number,
  staleTaskMs: number,
): InboxStaleTaskSuggestion[] {
  const { assistantsById, conversationsById, messagesByLane } = lookups;
  const results: InboxStaleTaskSuggestion[] = [];
  for (const task of tasks) {
    if (task.pendingPermission != null || task.status === "attention") continue;
    const threadId = taskThreadId(task.id);
    const laneMessages = messagesByLane.get(`${task.conversationId}\0${threadId}`) ?? [];
    const isStaleActive =
      (task.status === "queued" || task.status === "creating" || task.status === "running") &&
      now - task.createdAt >= staleTaskMs;
    const hasNewerUserFollowUp = laneMessages.some(
      (msg) => (msg.senderId === "user" || msg.kind === "user") && msg.createdAt > task.createdAt,
    );
    const isUnfollowedFailure =
      (task.status === "failed" || task.status === "unknown") && !hasNewerUserFollowUp;
    if (!isStaleActive && !isUnfollowedFailure) continue;

    results.push({
      id: `suggestion:stale-task:${task.id}`,
      kind: "stale_task",
      taskId: task.id,
      title: taskTitle(task),
      reason: formatStaleTaskReason(task, isStaleActive, now),
      isLive: isLiveTask(task),
      conversationId: task.conversationId,
      conversationName: resolveConversationName(conversationsById, task.conversationId),
      threadId,
      assistantId: task.assistantId,
      assistantName: resolveAssistantName(assistantsById, task.assistantId),
      timestamp: task.createdAt,
      task,
    });
  }
  return results;
}

function scanTurnSuggestions(
  turns: readonly Turn[],
  lookups: LedgerLookups,
): InboxFailedTurnSuggestion[] {
  const { assistantsById, conversationsById, messagesById, messagesByLane } = lookups;
  const latestTurnByLane = new Map<string, Turn>();
  for (const turn of turns) {
    if (turn.conversationId.startsWith("mailbox:") || turn.taskId) continue;
    latestTurnByLane.set(`${turn.conversationId}\0${turn.threadId ?? ""}`, turn);
  }
  const results: InboxFailedTurnSuggestion[] = [];
  for (const [laneKey, turn] of latestTurnByLane.entries()) {
    if (turn.status !== "failed") continue;
    const laneMessages = messagesByLane.get(laneKey) ?? [];
    if (hasNewerUserMessageInTurnLane(turn, messagesById, laneMessages)) continue;
    results.push({
      id: `suggestion:failed-turn:${turn.id}`,
      kind: "failed_turn",
      turnId: turn.id,
      title: firstLine(turn.prompt) || "Failed chat turn",
      reason: turn.error ? `Turn failed: ${turn.error}` : "Latest turn in this chat failed.",
      conversationId: turn.conversationId,
      conversationName: resolveConversationName(conversationsById, turn.conversationId),
      threadId: turn.threadId,
      assistantId: turn.assistantId,
      assistantName: resolveAssistantName(assistantsById, turn.assistantId),
      timestamp: resolveTurnTimestamp(turn, messagesById, laneMessages),
      turn,
    });
  }
  return results;
}

function scanRoutineSuggestions(
  routines: readonly Routine[],
  lookups: LedgerLookups,
): Array<InboxPausedRoutineSuggestion | InboxFailingRoutineSuggestion> {
  const { assistantsById, conversationsById } = lookups;
  const results: Array<InboxPausedRoutineSuggestion | InboxFailingRoutineSuggestion> = [];
  for (const routine of routines) {
    const assistantName = resolveAssistantName(assistantsById, routine.assistantId);
    const conversationName = resolveConversationName(conversationsById, routine.conversationId);
    const isReminder = routine.maxRuns === 1;
    if (routine.status === "paused") {
      results.push({
        id: `suggestion:paused-routine:${routine.id}`,
        kind: "paused_routine",
        routineId: routine.id,
        routineName: routine.name,
        isReminder,
        title: routine.name,
        reason: "Routine is paused.",
        conversationId: routine.conversationId,
        conversationName,
        threadId: routine.threadId,
        assistantId: routine.assistantId,
        assistantName,
        timestamp: routine.pausedAt ?? routine.updatedAt ?? routine.createdAt,
        routine,
      });
      continue;
    }
    if (routine.status !== "active") continue;
    const lastRun = findMostRecentFinishedRun(routine.runs);
    if (!lastRun || (lastRun.outcome !== "failed" && lastRun.status !== "failed")) continue;
    results.push({
      id: `suggestion:failing-routine:${routine.id}`,
      kind: "failing_routine",
      routineId: routine.id,
      routineName: routine.name,
      isReminder,
      title: routine.name,
      reason: lastRun.error
        ? `Most recent run failed: ${lastRun.error}`
        : (lastRun.summary ?? "Most recent routine run failed."),
      conversationId: routine.conversationId,
      conversationName,
      threadId: routine.threadId,
      assistantId: routine.assistantId,
      assistantName,
      timestamp: lastRun.endedAt ?? lastRun.startedAt,
      routine,
      lastRun,
    });
  }
  return results;
}

export function deriveInboxState(
  state: ChatState,
  now = Date.now(),
  options?: DeriveInboxOptions,
): InboxState {
  const staleTaskMs = options?.staleTaskMs ?? DEFAULT_STALE_TASK_MS;
  const maxRecentActivity = options?.maxRecentActivity ?? DEFAULT_MAX_RECENT_ACTIVITY;
  const lookups = buildLedgerLookups(state);

  return {
    needsAction: deriveNeedsAction(state, lookups),
    recentActivity: deriveRecentActivity(state, lookups, maxRecentActivity),
    upcoming: deriveUpcoming(state, lookups),
    suggestions: [
      ...scanTaskSuggestions(state.tasks, lookups, now, staleTaskMs),
      ...scanTurnSuggestions(state.turns, lookups),
      ...scanRoutineSuggestions(state.routines ?? [], lookups),
    ],
  };
}
