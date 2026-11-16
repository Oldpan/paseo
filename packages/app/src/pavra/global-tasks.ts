import type { Assistant, Conversation, Task } from "../../../../extensions/pavra/shared/contracts";
import {
  isLiveTask,
  pendingApproval,
  taskDetail,
  taskThreadId,
  taskTitle,
  type TaskApproval,
  type Tone,
} from "./task-view";

export const GLOBAL_TASK_COLUMNS = ["queued", "running", "needs_action", "done"] as const;
export type GlobalTaskColumn = (typeof GLOBAL_TASK_COLUMNS)[number];
export type GlobalTaskSourceFilter = "all" | "dm" | "group";
export type GlobalTaskStatus = Task["status"] | "waiting_permission";

export type GlobalTaskRecord = Omit<Task, "status"> & {
  status: GlobalTaskStatus;
  updatedAt?: number;
  goal?: string;
  summary?: string | null;
  threadId?: string | null;
};

export interface GlobalTaskFilters {
  sourceType?: GlobalTaskSourceFilter;
  assistantId?: string;
  serverId?: string;
  column?: "all" | GlobalTaskColumn;
  query?: string;
}

export interface GlobalTasksInput extends GlobalTaskFilters {
  tasks: readonly GlobalTaskRecord[];
  assistants?: readonly Assistant[];
  conversations?: readonly Conversation[];
  hostLabels?: Record<string, string>;
  filters?: GlobalTaskFilters;
}

export interface GlobalTaskItem extends GlobalTaskRecord {
  taskId: string;
  task: GlobalTaskRecord;
  column: GlobalTaskColumn;
  title: string;
  goal: string;
  summary: string | null;
  statusLabel: string;
  tone: Tone;
  live: boolean;
  budgetStopped: boolean;
  budgetLabel: string | null;
  assistant: Assistant | undefined;
  assistantName: string;
  conversation: Conversation | undefined;
  conversationTitle: string;
  sourceType: "dm" | "group";
  sourceLabel: string;
  hostLabel: string;
  targetLabel: string;
  threadId: string | null;
  sortTimestamp: number;
  approval: TaskApproval | null;
  canApprove: boolean;
  canCancel: boolean;
  canOpenStudio: boolean;
}

export interface GlobalTaskColumnCounts {
  queued: number;
  running: number;
  needs_action: number;
  done: number;
  total: number;
  open: number;
}

export interface GlobalTasksResult {
  items: GlobalTaskItem[];
  tasks: GlobalTaskItem[];
  columns: Record<GlobalTaskColumn, GlobalTaskItem[]>;
  grouped: Record<GlobalTaskColumn, GlobalTaskItem[]>;
  queued: GlobalTaskItem[];
  running: GlobalTaskItem[];
  needs_action: GlobalTaskItem[];
  needsAction: GlobalTaskItem[];
  done: GlobalTaskItem[];
  queuedCount: number;
  runningCount: number;
  needsActionCount: number;
  doneCount: number;
  totalCount: number;
  openCount: number;
  counts: GlobalTaskColumnCounts;
}

const STATUS_LABELS: Record<GlobalTaskStatus, string> = {
  queued: "Queued",
  creating: "Starting",
  running: "Running",
  attention: "Needs approval",
  waiting_permission: "Needs approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Reconnecting",
};

const LIVE_FOR_PERMISSION = new Set<GlobalTaskStatus>(["queued", "creating", "running", "unknown"]);

const LIVE_FOR_BUDGET = new Set<GlobalTaskStatus>([
  "queued",
  "creating",
  "running",
  "attention",
  "waiting_permission",
]);

export function mapTaskToColumn(
  task: Pick<GlobalTaskRecord, "status" | "pendingPermission">,
): GlobalTaskColumn {
  if (
    task.status === "waiting_permission" ||
    task.status === "attention" ||
    (LIVE_FOR_PERMISSION.has(task.status) && Boolean(task.pendingPermission))
  ) {
    return "needs_action";
  }
  if (task.status === "queued") {
    return "queued";
  }
  if (LIVE_FOR_PERMISSION.has(task.status)) {
    return "running";
  }
  return "done";
}

export const resolveGlobalTaskColumn = mapTaskToColumn;

function resolveTone(
  column: GlobalTaskColumn,
  status: GlobalTaskStatus,
  budgetStopped: boolean,
): Tone {
  if (budgetStopped) return "muted";
  if (column !== "done") return "live";
  if (status === "completed") return "ok";
  if (status === "failed") return "bad";
  return "muted";
}

function formatTotalBudgetLabel(totalMinutes: number): string | null {
  if (totalMinutes >= 60 && totalMinutes % 60 === 0) {
    return `${totalMinutes / 60}h budget`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m budget`;
  }
  return null;
}

export function formatTaskBudgetOrDeadline(
  task: Pick<GlobalTaskRecord, "createdAt" | "deadline" | "stopReason" | "status">,
  now?: number,
): string | null {
  if (task.status === "cancelled" && task.stopReason === "budget") {
    return "Budget reached";
  }
  if (typeof task.deadline !== "number" || !Number.isFinite(task.deadline) || task.deadline <= 0) {
    return null;
  }
  if (
    typeof task.createdAt === "number" &&
    Number.isFinite(task.createdAt) &&
    task.deadline > task.createdAt
  ) {
    const totalMinutes = Math.round((task.deadline - task.createdAt) / 60_000);
    if (typeof now === "number" && Number.isFinite(now) && LIVE_FOR_BUDGET.has(task.status)) {
      const remainingMinutes = Math.max(0, Math.ceil((task.deadline - now) / 60_000));
      return `${remainingMinutes}m left (${totalMinutes}m budget)`;
    }
    const label = formatTotalBudgetLabel(totalMinutes);
    if (label) return label;
  }
  const date = new Date(task.deadline);
  if (Number.isNaN(date.getTime())) return null;
  return `Due ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function resolveConversationDisplayTitle(
  conversation: Pick<Conversation, "name" | "kind" | "members"> | null | undefined,
  assistants: readonly Pick<Assistant, "id" | "name">[],
): string {
  if (!conversation) return "Chat";
  const trimmed = conversation.name.trim();
  if (trimmed) return trimmed;
  if (conversation.kind === "dm") {
    const member = assistants.find((assistant) => assistant.id === conversation.members[0]);
    if (member) return member.name;
  }
  return conversation.kind === "group" ? "Group Chat" : "Direct Message";
}

function resolveConversationTitle(
  task: GlobalTaskRecord,
  sourceType: "dm" | "group",
  conversation: Conversation | undefined,
  assistant: Assistant | undefined,
  assistants: readonly Assistant[],
): string {
  if (conversation) {
    return resolveConversationDisplayTitle(conversation, assistants);
  }
  if (sourceType === "dm") {
    return assistant?.name ?? task.conversationId.replace(/^dm:/, "");
  }
  return task.conversationId;
}

function resolveSourceInfo(
  task: GlobalTaskRecord,
  conversation: Conversation | undefined,
  assistant: Assistant | undefined,
  assistants: readonly Assistant[],
): {
  sourceType: "dm" | "group";
  conversationTitle: string;
  sourceLabel: string;
} {
  const sourceType: "dm" | "group" =
    conversation?.kind ?? (task.conversationId.startsWith("dm:") ? "dm" : "group");
  const conversationTitle = resolveConversationTitle(
    task,
    sourceType,
    conversation,
    assistant,
    assistants,
  );

  if (sourceType === "dm") {
    const dmMember = conversation
      ? assistants.find((item) => item.id === conversation.members[0])
      : assistant;
    const rawHandle = (dmMember?.name ?? conversationTitle).replace(/^@+/, "");
    return {
      sourceType,
      conversationTitle,
      sourceLabel: `DM @${rawHandle}`,
    };
  }

  const rawGroup = (conversation?.name?.trim() || conversationTitle || "group").replace(/^#+/, "");
  return {
    sourceType,
    conversationTitle,
    sourceLabel: `#${rawGroup}`,
  };
}

function resolveSortTimestamp(task: GlobalTaskRecord): number {
  if (typeof task.updatedAt === "number" && Number.isFinite(task.updatedAt)) {
    return task.updatedAt;
  }
  return typeof task.createdAt === "number" && Number.isFinite(task.createdAt) ? task.createdAt : 0;
}

function resolveThreadId(task: GlobalTaskRecord): string | null {
  if (task.threadId !== undefined) {
    return task.threadId;
  }
  if (task.sourceThreadId !== undefined && task.sourceThreadId !== null) {
    return task.sourceThreadId;
  }
  return taskThreadId(task.id);
}

function nonEmptyTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveTaskSummary(
  task: GlobalTaskRecord,
  normalizedTask: Pick<Task, "title" | "prompt">,
): string | null {
  return nonEmptyTrimmed(task.summary) ?? nonEmptyTrimmed(task.error) ?? taskDetail(normalizedTask);
}

function resolveTaskApproval(
  task: GlobalTaskRecord,
  column: GlobalTaskColumn,
  normalizedTask: Pick<Task, "status" | "pendingPermission">,
): TaskApproval | null {
  const existing = pendingApproval(normalizedTask);
  if (existing) return existing;
  if (column !== "needs_action") return null;
  return {
    requestId: task.pendingPermission?.requestId ?? task.id,
    title: task.pendingPermission?.title ?? "Permission approval required",
  };
}

function resolveStatusLabel(task: GlobalTaskRecord, budgetStopped: boolean): string {
  if (budgetStopped) return "Budget reached";
  return STATUS_LABELS[task.status] ?? task.status;
}

export function enrichGlobalTask(
  task: GlobalTaskRecord,
  context: {
    assistantsById: ReadonlyMap<string, Assistant>;
    assistants: readonly Assistant[];
    conversationsById: ReadonlyMap<string, Conversation>;
    hostLabels: Record<string, string>;
  },
): GlobalTaskItem {
  const column = mapTaskToColumn(task);
  const assistant = context.assistantsById.get(task.assistantId);
  const assistantName = assistant?.name ?? "Assistant";
  const conversation = context.conversationsById.get(task.conversationId);
  const { sourceType, conversationTitle, sourceLabel } = resolveSourceInfo(
    task,
    conversation,
    assistant,
    context.assistants,
  );
  const hostLabel = context.hostLabels[task.serverId] ?? task.serverId;
  const normalizedTaskForView: Pick<Task, "title" | "prompt" | "status" | "pendingPermission"> = {
    title: task.title,
    prompt: task.prompt || task.goal || "",
    status: task.status === "waiting_permission" ? "attention" : task.status,
    pendingPermission: task.pendingPermission,
  };
  const title = taskTitle(normalizedTaskForView);
  const goal = nonEmptyTrimmed(task.goal) ?? nonEmptyTrimmed(task.prompt) ?? title;
  const summary = resolveTaskSummary(task, normalizedTaskForView);
  const budgetStopped = task.status === "cancelled" && task.stopReason === "budget";
  const live = column !== "done" && isLiveTask(normalizedTaskForView);
  const approval = resolveTaskApproval(task, column, normalizedTaskForView);
  const statusLabel = resolveStatusLabel(task, budgetStopped);
  const tone = resolveTone(column, task.status, budgetStopped);
  const isolationLabel = task.isolation === "worktree" ? "worktree" : "directory";
  const targetLabel = [hostLabel, task.directory, isolationLabel].filter(Boolean).join(" · ");

  return {
    ...task,
    taskId: task.id,
    task,
    column,
    title,
    goal,
    summary,
    statusLabel,
    tone,
    live,
    budgetStopped,
    budgetLabel: formatTaskBudgetOrDeadline(task),
    assistant,
    assistantName,
    conversation,
    conversationTitle,
    sourceType,
    sourceLabel,
    hostLabel,
    targetLabel,
    threadId: resolveThreadId(task),
    sortTimestamp: resolveSortTimestamp(task),
    approval,
    canApprove: column === "needs_action",
    canCancel: (column === "queued" || column === "running") && !task.cancelPending,
    canOpenStudio: Boolean(task.execution),
  };
}

function matchesSearchQuery(item: GlobalTaskItem, queryTerms: readonly string[]): boolean {
  if (queryTerms.length === 0) return true;
  const haystack = [
    item.title,
    item.task.title ?? "",
    item.goal,
    item.prompt,
    item.summary ?? "",
    item.error ?? "",
    item.directory,
    item.assistantName,
    item.conversationTitle,
    item.sourceLabel,
    item.hostLabel,
    item.serverId,
    item.provider,
  ]
    .join(" ")
    .toLowerCase();

  return queryTerms.every((term) => haystack.includes(term));
}

function compareGlobalTasksDesc(left: GlobalTaskItem, right: GlobalTaskItem): number {
  if (right.sortTimestamp !== left.sortTimestamp) {
    return right.sortTimestamp - left.sortTimestamp;
  }
  if (right.createdAt !== left.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return left.id.localeCompare(right.id);
}

function normalizeGlobalTaskFilters(
  input: GlobalTasksInput,
  explicitFilters?: GlobalTaskFilters,
): Required<GlobalTaskFilters> {
  const merged: GlobalTaskFilters = {
    ...input,
    ...input.filters,
    ...explicitFilters,
  };
  return {
    sourceType: merged.sourceType ?? "all",
    assistantId: merged.assistantId ?? "all",
    serverId: merged.serverId ?? "all",
    column: merged.column ?? "all",
    query: merged.query ?? "",
  };
}

function isSpecificFilter(value: string): boolean {
  return value !== "all" && value !== "";
}

function matchesGlobalTaskFilters(
  item: GlobalTaskItem,
  filters: Required<GlobalTaskFilters>,
  queryTerms: readonly string[],
): boolean {
  if (filters.sourceType !== "all" && item.sourceType !== filters.sourceType) {
    return false;
  }
  if (isSpecificFilter(filters.assistantId) && item.assistantId !== filters.assistantId) {
    return false;
  }
  if (isSpecificFilter(filters.serverId) && item.serverId !== filters.serverId) {
    return false;
  }
  if (filters.column !== "all" && item.column !== filters.column) {
    return false;
  }
  return matchesSearchQuery(item, queryTerms);
}

export function filterAndGroupGlobalTasks(
  input: GlobalTasksInput,
  explicitFilters?: GlobalTaskFilters,
): GlobalTasksResult {
  const assistants = input.assistants ?? [];
  const conversations = input.conversations ?? [];
  const hostLabels = input.hostLabels ?? {};
  const mergedFilters = normalizeGlobalTaskFilters(input, explicitFilters);

  const assistantsById = new Map(assistants.map((item) => [item.id, item]));
  const conversationsById = new Map(conversations.map((item) => [item.id, item]));
  const queryTerms = mergedFilters.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  const columns: Record<GlobalTaskColumn, GlobalTaskItem[]> = {
    queued: [],
    running: [],
    needs_action: [],
    done: [],
  };

  for (const rawTask of input.tasks) {
    const item = enrichGlobalTask(rawTask, {
      assistantsById,
      assistants,
      conversationsById,
      hostLabels,
    });
    if (matchesGlobalTaskFilters(item, mergedFilters, queryTerms)) {
      columns[item.column].push(item);
    }
  }

  const sortedColumns: Record<GlobalTaskColumn, GlobalTaskItem[]> = {
    queued: [...columns.queued].sort(compareGlobalTasksDesc),
    running: [...columns.running].sort(compareGlobalTasksDesc),
    needs_action: [...columns.needs_action].sort(compareGlobalTasksDesc),
    done: [...columns.done].sort(compareGlobalTasksDesc),
  };

  const items = [
    ...sortedColumns.queued,
    ...sortedColumns.running,
    ...sortedColumns.needs_action,
    ...sortedColumns.done,
  ].sort(compareGlobalTasksDesc);

  const queuedCount = sortedColumns.queued.length;
  const runningCount = sortedColumns.running.length;
  const needsActionCount = sortedColumns.needs_action.length;
  const doneCount = sortedColumns.done.length;
  const openCount = queuedCount + runningCount + needsActionCount;
  const totalCount = items.length;

  return {
    items,
    tasks: items,
    columns: sortedColumns,
    grouped: sortedColumns,
    queued: sortedColumns.queued,
    running: sortedColumns.running,
    needs_action: sortedColumns.needs_action,
    needsAction: sortedColumns.needs_action,
    done: sortedColumns.done,
    queuedCount,
    runningCount,
    needsActionCount,
    doneCount,
    totalCount,
    openCount,
    counts: {
      queued: queuedCount,
      running: runningCount,
      needs_action: needsActionCount,
      done: doneCount,
      total: totalCount,
      open: openCount,
    },
  };
}
