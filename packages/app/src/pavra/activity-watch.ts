// Pure, deterministic Global Activity Monitor engine. Aggregates active and recent
// Turns, Tasks, BrowserTakeovers, and PeerMailbox exchanges across all conversations and machines.
import type {
  Assistant,
  ChatState,
  Conversation,
  MachineInfo,
  Message,
  PeerMessage,
  Takeover,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { TURN_STATUS_LABEL } from "./live-turn";
import { buildTurnLineage, openExchanges, type BrowserTakeover } from "./peer-activity";
import { isLiveTask, pendingApproval, taskThreadId, taskTitle } from "./task-view";

export type ActivityWatchKind = "turn" | "task";

export type ActivityWatchStatus =
  | "queued"
  | "running"
  | "waiting_action"
  | "completed"
  | "failed"
  | "cancelled";

export type ActivityWatchStatusFilter = "all" | "running" | "waiting_action";

export interface ActivityWatchFilters {
  status?: ActivityWatchStatusFilter;
  assistantId?: string;
  serverId?: string;
  query?: string;
}

export interface ActivityWatchItem {
  id: string;
  kind: ActivityWatchKind;
  status: ActivityWatchStatus;
  statusLabel: string;
  isActive: boolean;
  canSteer: boolean;
  assistantId: string;
  assistantName: string;
  serverId: string;
  hostLabel: string;
  conversationId: string;
  conversationTitle: string;
  threadId: string | null;
  promptPreview: string;
  tags: string[];
  mailboxCount: number;
  startedAt: number;
  elapsedLabel: string;
  error: string | null;
  turn?: Turn;
  task?: Task;
  pendingTakeover?: BrowserTakeover;
  pendingPermission?: { requestId: string; title: string } | null;
}

export interface BuildGlobalActivitySnapshotInput {
  state?: Partial<ChatState>;
  turns?: readonly Turn[];
  tasks?: readonly Task[];
  takeovers?: readonly Takeover[];
  peerMessages?: readonly PeerMessage[];
  messages?: readonly Message[];
  assistants?: readonly Assistant[];
  conversations?: readonly Conversation[];
  machines?: readonly MachineInfo[];
  coordinatorId?: string;
  hostLabels?: Record<string, string>;
  filters?: ActivityWatchFilters;
  status?: ActivityWatchStatusFilter;
  statusFilter?: ActivityWatchStatusFilter;
  assistantId?: string;
  serverId?: string;
  query?: string;
  now?: number;
}

export interface GlobalActivitySnapshot {
  items: ActivityWatchItem[];
  allItems: ActivityWatchItem[];
  activeRunCount: number;
  runningCount: number;
  waitingActionCount: number;
  queuedCount: number;
  completedCount: number;
}

const ACTIVE_WATCH_STATUSES = new Set<ActivityWatchStatus>(["queued", "running", "waiting_action"]);

const WATCH_STATUS_LABELS: Record<ActivityWatchStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting_action: "Waiting Action",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function normalizeAssistantKey(rawId: string | null | undefined): string {
  if (!rawId) return "";
  return rawId.startsWith("assistant:") ? rawId.slice("assistant:".length) : rawId;
}

function firstLinePreview(text: string | null | undefined, maxLength = 140): string {
  if (!text) return "";
  const line =
    text
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 1)}…`;
}

function parseDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

export function toBrowserTakeover(takeover: Takeover): BrowserTakeover {
  const domain = parseDomain(takeover.url);
  const displayLabel =
    takeover.title || domain || takeover.url || takeover.reason || "Browser takeover";
  return {
    id: takeover.id,
    kind: takeover.kind,
    status: takeover.status,
    reason: takeover.reason,
    url: takeover.url ?? null,
    title: takeover.title ?? null,
    domain,
    displayLabel,
    createdAt: takeover.createdAt,
    updatedAt: takeover.updatedAt,
    takeover,
  };
}

export function formatActivityElapsed(startedAt: number, now = Date.now()): string {
  if (!startedAt || !Number.isFinite(startedAt) || startedAt <= 0) return "0s";
  const elapsedMs = Math.max(0, now - startedAt);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return remSeconds > 0 ? `${totalMinutes}m ${remSeconds}s` : `${totalMinutes}m`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  return `${days}d`;
}

export const formatElapsedDuration = formatActivityElapsed;

export function isActiveWatchStatus(status: ActivityWatchStatus): boolean {
  return ACTIVE_WATCH_STATUSES.has(status);
}

function resolveTurnWatchStatus(turn: Turn, hasPendingTakeover: boolean): ActivityWatchStatus {
  const rawStatus = turn.status as string;
  if (rawStatus === "completed" || rawStatus === "failed" || rawStatus === "cancelled") {
    return rawStatus;
  }
  if (
    hasPendingTakeover ||
    rawStatus === "attention" ||
    rawStatus === "waiting_action" ||
    rawStatus === "awaiting_approval" ||
    rawStatus === "waiting_permission"
  ) {
    return "waiting_action";
  }
  if (rawStatus === "queued") {
    return "queued";
  }
  return "running";
}

function resolveTaskWatchStatus(task: Task, hasPendingTakeover: boolean): ActivityWatchStatus {
  const rawStatus = task.status as string;
  if (rawStatus === "completed" || rawStatus === "failed" || rawStatus === "cancelled") {
    return rawStatus;
  }
  if (
    hasPendingTakeover ||
    rawStatus === "attention" ||
    rawStatus === "waiting_action" ||
    rawStatus === "awaiting_approval" ||
    rawStatus === "waiting_permission" ||
    (isLiveTask(task) && task.pendingPermission != null)
  ) {
    return "waiting_action";
  }
  if (rawStatus === "queued") {
    return "queued";
  }
  return "running";
}

interface ActivityContext {
  turns: readonly Turn[];
  tasks: readonly Task[];
  takeovers: readonly Takeover[];
  peerMessages: readonly PeerMessage[];
  messages: readonly Message[];
  assistants: readonly Assistant[];
  conversations: readonly Conversation[];
  assistantsById: ReadonlyMap<string, Assistant>;
  conversationsById: ReadonlyMap<string, Conversation>;
  messagesById: ReadonlyMap<string, Message>;
  messagesByLane: ReadonlyMap<string, Message[]>;
  machineLabelsById: ReadonlyMap<string, string>;
  coordinatorId: string;
  now: number;
}

function buildAssistantsMap(assistants: readonly Assistant[]): Map<string, Assistant> {
  const assistantsById = new Map<string, Assistant>();
  for (const assistant of assistants) {
    assistantsById.set(assistant.id, assistant);
    assistantsById.set(normalizeAssistantKey(assistant.id), assistant);
  }
  return assistantsById;
}

function buildMessageLookups(messages: readonly Message[]): {
  messagesById: Map<string, Message>;
  messagesByLane: Map<string, Message[]>;
} {
  const messagesById = new Map<string, Message>();
  const messagesByLane = new Map<string, Message[]>();
  for (const message of messages) {
    messagesById.set(message.id, message);
    const key = `${message.conversationId}\0${message.threadId ?? ""}`;
    const bucket = messagesByLane.get(key);
    if (bucket) bucket.push(message);
    else messagesByLane.set(key, [message]);
  }
  for (const [key, list] of messagesByLane.entries()) {
    messagesByLane.set(
      key,
      [...list].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    );
  }
  return { messagesById, messagesByLane };
}

function buildMachineLabelsMap(
  machines: readonly MachineInfo[],
  hostLabels: Record<string, string> | undefined,
): Map<string, string> {
  const machineLabelsById = new Map<string, string>();
  for (const machine of machines) {
    if (machine.serverId && machine.label) {
      machineLabelsById.set(machine.serverId, machine.label);
    }
  }
  if (hostLabels) {
    for (const [serverId, label] of Object.entries(hostLabels)) {
      if (label) machineLabelsById.set(serverId, label);
    }
  }
  return machineLabelsById;
}

function resolveLedgerCollections(input: BuildGlobalActivitySnapshotInput) {
  const s = input.state ?? {};
  return {
    turns: input.turns ?? s.turns ?? [],
    tasks: input.tasks ?? s.tasks ?? [],
    takeovers: input.takeovers ?? s.takeovers ?? [],
    peerMessages: input.peerMessages ?? s.peerMessages ?? [],
  };
}

function resolveDirectoryCollections(input: BuildGlobalActivitySnapshotInput) {
  const s = input.state ?? {};
  return {
    messages: input.messages ?? s.messages ?? [],
    assistants: input.assistants ?? s.assistants ?? [],
    conversations: input.conversations ?? s.conversations ?? [],
    machines: input.machines ?? [],
  };
}

function createActivityContext(input: BuildGlobalActivitySnapshotInput): ActivityContext {
  const ledger = resolveLedgerCollections(input);
  const dir = resolveDirectoryCollections(input);
  const { messagesById, messagesByLane } = buildMessageLookups(dir.messages);

  return {
    ...ledger,
    messages: dir.messages,
    assistants: dir.assistants,
    conversations: dir.conversations,
    assistantsById: buildAssistantsMap(dir.assistants),
    conversationsById: new Map(dir.conversations.map((item) => [item.id, item])),
    messagesById,
    messagesByLane,
    machineLabelsById: buildMachineLabelsMap(dir.machines, input.hostLabels),
    coordinatorId: input.coordinatorId ?? "",
    now: input.now ?? Date.now(),
  };
}

function resolveAssistantInfo(
  assistantId: string,
  ctx: ActivityContext,
): { assistant: Assistant | undefined; assistantName: string } {
  const assistant =
    ctx.assistantsById.get(assistantId) ??
    ctx.assistantsById.get(normalizeAssistantKey(assistantId));
  return {
    assistant,
    assistantName: assistant?.name ?? "Assistant",
  };
}

function resolveServerAndHostLabel(
  explicitServerId: string | undefined,
  assistant: Assistant | undefined,
  ctx: ActivityContext,
): { serverId: string; hostLabel: string } {
  const serverId = explicitServerId || assistant?.serverId || ctx.coordinatorId || "local";
  const hostLabel = ctx.machineLabelsById.get(serverId) ?? serverId;
  return { serverId, hostLabel };
}

function resolveConversationTitle(
  conversationId: string,
  assistantName: string,
  ctx: ActivityContext,
): string {
  const conversation = ctx.conversationsById.get(conversationId);
  if (conversation) {
    return conversation.name || assistantName;
  }
  if (conversationId.startsWith("mailbox:")) {
    return "Peer Mailbox";
  }
  return conversationId;
}

function resolveTurnStartedAt(
  turn: Turn,
  takeovers: readonly BrowserTakeover[],
  consultationCreatedAt: number | undefined,
  ctx: ActivityContext,
): number {
  const withTimestamps = turn as Turn & { startedAt?: number; createdAt?: number };
  if (typeof withTimestamps.startedAt === "number" && Number.isFinite(withTimestamps.startedAt)) {
    return withTimestamps.startedAt;
  }
  if (typeof withTimestamps.createdAt === "number" && Number.isFinite(withTimestamps.createdAt)) {
    return withTimestamps.createdAt;
  }
  const triggerIds = [turn.triggerId, turn.seenUserId, turn.rootTriggerId, turn.finalMessageId];
  for (const id of triggerIds) {
    if (!id) continue;
    const msg = ctx.messagesById.get(id);
    if (msg) return msg.createdAt;
  }
  if (takeovers.length > 0 && takeovers[0]) {
    return takeovers[0].createdAt;
  }
  if (consultationCreatedAt !== undefined && Number.isFinite(consultationCreatedAt)) {
    return consultationCreatedAt;
  }
  const laneKey = `${turn.conversationId}\0${turn.threadId ?? ""}`;
  const laneMessages = ctx.messagesByLane.get(laneKey) ?? [];
  const matchingPrompt = laneMessages.findLast(
    (msg) => msg.senderId === "user" && msg.content === turn.prompt,
  );
  if (matchingPrompt) return matchingPrompt.createdAt;
  const lastInLane = laneMessages.at(-1);
  if (lastInLane) return lastInLane.createdAt;
  return ctx.now;
}

function buildTags(input: {
  mailboxCount: number;
  hasTakeover: boolean;
  hasTask: boolean;
}): string[] {
  const tags: string[] = [];
  if (input.mailboxCount > 0) {
    tags.push(`Mailbox · ${input.mailboxCount}`);
  }
  if (input.hasTakeover) {
    tags.push("Takeover");
  }
  if (input.hasTask) {
    tags.push("Task");
  }
  return tags;
}

function collectTurnTakeovers(
  turn: Turn,
  lineageTakeovers: readonly BrowserTakeover[],
  ctx: ActivityContext,
  claimedTakeoverIds: Set<string>,
): { allTakeovers: BrowserTakeover[]; pendingTakeover: BrowserTakeover | undefined } {
  const byId = new Map<string, BrowserTakeover>();
  for (const item of lineageTakeovers) {
    byId.set(item.id, item);
  }
  const normalizedTurnAssistant = normalizeAssistantKey(turn.assistantId);
  for (const raw of ctx.takeovers) {
    if (byId.has(raw.id)) continue;
    if (raw.turnId === turn.id) {
      byId.set(raw.id, toBrowserTakeover(raw));
      continue;
    }
    if (raw.turnId) continue;
    const sameLane =
      raw.conversationId === turn.conversationId &&
      (raw.threadId ?? null) === (turn.threadId ?? null);
    const sameAssistant =
      !raw.assistantId || normalizeAssistantKey(raw.assistantId) === normalizedTurnAssistant;
    if (sameLane && sameAssistant && !claimedTakeoverIds.has(raw.id)) {
      byId.set(raw.id, toBrowserTakeover(raw));
    }
  }
  const allTakeovers = [...byId.values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  for (const item of allTakeovers) {
    claimedTakeoverIds.add(item.id);
  }
  const pendingTakeover = allTakeovers.findLast((item) => item.status === "pending");
  return { allTakeovers, pendingTakeover };
}

function countTurnMailboxActivity(
  turn: Turn,
  lineageConsultationCount: number,
  ctx: ActivityContext,
): number {
  if (lineageConsultationCount > 0) return lineageConsultationCount;
  const openLaneExchanges = openExchanges(
    ctx.peerMessages,
    turn.conversationId,
    turn.threadId ?? null,
  );
  if (openLaneExchanges.length > 0) return openLaneExchanges.length;
  const laneMailboxRequests = ctx.peerMessages.filter(
    (row) =>
      row.ledger === "mailbox" &&
      row.kind !== "reply" &&
      row.kind !== "notice" &&
      row.conversationId === turn.conversationId &&
      (row.threadId ?? null) === (turn.threadId ?? null),
  );
  if (laneMailboxRequests.length > 0) return laneMailboxRequests.length;
  if (turn.inboxMessageIds && turn.inboxMessageIds.length > 0) {
    return turn.inboxMessageIds.length;
  }
  if (turn.mailboxWakeupIds && turn.mailboxWakeupIds.length > 0) {
    return turn.mailboxWakeupIds.length;
  }
  if (turn.mailboxId || turn.kind === "peer_inbox") {
    return 1;
  }
  return 0;
}

function buildTurnWatchItem(
  turn: Turn,
  ctx: ActivityContext,
  claimedTakeoverIds: Set<string>,
): ActivityWatchItem {
  const { assistant, assistantName } = resolveAssistantInfo(turn.assistantId, ctx);
  const { serverId, hostLabel } = resolveServerAndHostLabel(turn.serverId, assistant, ctx);
  const conversationTitle = resolveConversationTitle(turn.conversationId, assistantName, ctx);

  const lineage = buildTurnLineage({
    turn,
    turns: ctx.turns,
    messages: ctx.messages,
    peerMessages: ctx.peerMessages,
    tasks: ctx.tasks,
    takeovers: ctx.takeovers,
    assistants: ctx.assistants,
  });

  const { allTakeovers, pendingTakeover } = collectTurnTakeovers(
    turn,
    lineage.takeovers,
    ctx,
    claimedTakeoverIds,
  );
  const mailboxCount = countTurnMailboxActivity(turn, lineage.consultations.length, ctx);
  const hasLinkedTask =
    lineage.taskCount > 0 ||
    Boolean(turn.taskId) ||
    turn.kind === "task_followup" ||
    turn.kind === "task_receipt" ||
    ctx.tasks.some((task) => task.requestedByTurnId === turn.id);

  const status = resolveTurnWatchStatus(turn, Boolean(pendingTakeover));
  const isActive = isActiveWatchStatus(status);
  const startedAt = resolveTurnStartedAt(
    turn,
    allTakeovers,
    lineage.consultations[0]?.createdAt,
    ctx,
  );
  const tags = buildTags({
    mailboxCount,
    hasTakeover: allTakeovers.length > 0 || Boolean(pendingTakeover),
    hasTask: hasLinkedTask,
  });

  const promptPreview =
    firstLinePreview(turn.prompt) ||
    (turn.routineName ? `Routine: ${turn.routineName}` : "") ||
    TURN_STATUS_LABEL[turn.status] ||
    "Turn";

  return {
    id: turn.id,
    kind: "turn",
    status,
    statusLabel: WATCH_STATUS_LABELS[status],
    isActive,
    canSteer: isActive && !turn.conversationId.startsWith("mailbox:"),
    assistantId: turn.assistantId,
    assistantName,
    serverId,
    hostLabel,
    conversationId: turn.conversationId,
    conversationTitle,
    threadId: turn.threadId ?? null,
    promptPreview,
    tags,
    mailboxCount,
    startedAt,
    elapsedLabel: formatActivityElapsed(startedAt, ctx.now),
    error: turn.error ?? null,
    turn,
    ...(pendingTakeover ? { pendingTakeover } : {}),
  };
}

function buildTaskWatchItem(
  task: Task,
  ctx: ActivityContext,
  usedIds: ReadonlySet<string>,
  claimedTakeoverIds: Set<string>,
): ActivityWatchItem {
  const { assistant, assistantName } = resolveAssistantInfo(task.assistantId, ctx);
  const { serverId, hostLabel } = resolveServerAndHostLabel(
    task.serverId || task.execution?.serverId,
    assistant,
    ctx,
  );
  const conversationTitle = resolveConversationTitle(task.conversationId, assistantName, ctx);
  const resolvedThreadId =
    (task as Task & { threadId?: string | null }).threadId !== undefined
      ? ((task as Task & { threadId?: string | null }).threadId ?? null)
      : (task.sourceThreadId ?? taskThreadId(task.id));

  const matchingTakeovers = ctx.takeovers
    .filter((raw) => {
      if (claimedTakeoverIds.has(raw.id)) return false;
      const taskThread = taskThreadId(task.id);
      return (
        raw.conversationId === task.conversationId &&
        (raw.threadId === taskThread || (raw.threadId ?? null) === (task.sourceThreadId ?? null)) &&
        normalizeAssistantKey(raw.assistantId) === normalizeAssistantKey(task.assistantId)
      );
    })
    .map(toBrowserTakeover);

  for (const item of matchingTakeovers) {
    claimedTakeoverIds.add(item.id);
  }
  const pendingTakeover = matchingTakeovers.findLast((item) => item.status === "pending");

  const status = resolveTaskWatchStatus(task, Boolean(pendingTakeover));
  const isActive = isActiveWatchStatus(status);
  const approval = pendingApproval(task);
  const tags = buildTags({
    mailboxCount: 0,
    hasTakeover: matchingTakeovers.length > 0 || Boolean(pendingTakeover),
    hasTask: true,
  });

  const itemId = usedIds.has(task.id) ? `task:${task.id}` : task.id;

  return {
    id: itemId,
    kind: "task",
    status,
    statusLabel: WATCH_STATUS_LABELS[status],
    isActive,
    canSteer: false,
    assistantId: task.assistantId,
    assistantName,
    serverId,
    hostLabel,
    conversationId: task.conversationId,
    conversationTitle,
    threadId: resolvedThreadId,
    promptPreview: taskTitle(task) || firstLinePreview(task.prompt) || "Task",
    tags,
    mailboxCount: 0,
    startedAt: task.createdAt,
    elapsedLabel: formatActivityElapsed(task.createdAt, ctx.now),
    error: task.error ?? null,
    task,
    ...(pendingTakeover ? { pendingTakeover } : {}),
    ...(approval ? { pendingPermission: approval } : {}),
  };
}

function buildOrphanTakeoverWatchItem(
  rawTakeover: Takeover,
  ctx: ActivityContext,
): ActivityWatchItem {
  const takeover = toBrowserTakeover(rawTakeover);
  const { assistant, assistantName } = resolveAssistantInfo(rawTakeover.assistantId, ctx);
  const { serverId, hostLabel } = resolveServerAndHostLabel(rawTakeover.serverId, assistant, ctx);
  const conversationTitle = resolveConversationTitle(
    rawTakeover.conversationId,
    assistantName,
    ctx,
  );
  const syntheticTurn: Turn = {
    id: rawTakeover.turnId ?? `takeover:${rawTakeover.id}`,
    conversationId: rawTakeover.conversationId,
    threadId: rawTakeover.threadId ?? null,
    assistantId: rawTakeover.assistantId,
    serverId,
    prompt: rawTakeover.reason,
    status: "attention",
    agentId: "",
    error: null,
  };

  return {
    id: syntheticTurn.id,
    kind: "turn",
    status: "waiting_action",
    statusLabel: WATCH_STATUS_LABELS.waiting_action,
    isActive: true,
    canSteer: !rawTakeover.conversationId.startsWith("mailbox:"),
    assistantId: rawTakeover.assistantId,
    assistantName,
    serverId,
    hostLabel,
    conversationId: rawTakeover.conversationId,
    conversationTitle,
    threadId: rawTakeover.threadId ?? null,
    promptPreview: firstLinePreview(rawTakeover.title || rawTakeover.reason) || "Browser takeover",
    tags: ["Takeover"],
    mailboxCount: 0,
    startedAt: rawTakeover.createdAt,
    elapsedLabel: formatActivityElapsed(rawTakeover.createdAt, ctx.now),
    error: null,
    turn: syntheticTurn,
    pendingTakeover: takeover,
  };
}

function matchesSearchQuery(item: ActivityWatchItem, rawQuery: string | undefined): boolean {
  const trimmed = rawQuery?.trim().toLowerCase() ?? "";
  if (!trimmed) return true;
  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [
    item.id,
    item.kind,
    item.status,
    item.statusLabel,
    item.assistantName,
    item.assistantId,
    item.serverId,
    item.hostLabel,
    item.conversationTitle,
    item.conversationId,
    item.threadId ?? "",
    item.promptPreview,
    item.turn?.prompt ?? "",
    item.task?.prompt ?? "",
    item.task?.directory ?? "",
    item.pendingTakeover?.displayLabel ?? "",
    item.pendingTakeover?.reason ?? "",
    item.pendingTakeover?.url ?? "",
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

export function filterActivityWatchItems(
  items: readonly ActivityWatchItem[],
  filters?: ActivityWatchFilters,
): ActivityWatchItem[] {
  if (!filters) return [...items];
  const statusFilter = filters.status ?? "all";
  const assistantFilter = filters.assistantId?.trim() ?? "";
  const serverFilter = filters.serverId?.trim() ?? "";
  const query = filters.query;

  return items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) {
      return false;
    }
    if (
      assistantFilter &&
      assistantFilter !== "all" &&
      normalizeAssistantKey(item.assistantId) !== normalizeAssistantKey(assistantFilter)
    ) {
      return false;
    }
    if (serverFilter && serverFilter !== "all" && item.serverId !== serverFilter) {
      return false;
    }
    if (!matchesSearchQuery(item, query)) {
      return false;
    }
    return true;
  });
}

const STATUS_PRIORITY: Record<ActivityWatchStatus, number> = {
  waiting_action: 0,
  running: 1,
  queued: 2,
  failed: 3,
  completed: 4,
  cancelled: 5,
};

function sortActivityWatchItems(items: readonly ActivityWatchItem[]): ActivityWatchItem[] {
  return [...items].sort((a, b) => {
    if (a.isActive !== b.isActive) {
      return a.isActive ? -1 : 1;
    }
    const prioDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (prioDiff !== 0) {
      return prioDiff;
    }
    if (b.startedAt !== a.startedAt) {
      return b.startedAt - a.startedAt;
    }
    return a.id.localeCompare(b.id);
  });
}

function countActivityStatuses(items: readonly ActivityWatchItem[]) {
  let activeRunCount = 0;
  let runningCount = 0;
  let waitingActionCount = 0;
  let queuedCount = 0;
  let completedCount = 0;

  for (const item of items) {
    if (item.status === "running") {
      runningCount += 1;
      activeRunCount += 1;
    } else if (item.status === "queued") {
      queuedCount += 1;
      activeRunCount += 1;
    } else if (item.status === "waiting_action") {
      waitingActionCount += 1;
      activeRunCount += 1;
    } else {
      completedCount += 1;
    }
  }

  return {
    activeRunCount,
    runningCount,
    waitingActionCount,
    queuedCount,
    completedCount,
  };
}

function resolveSnapshotFilters(input: BuildGlobalActivitySnapshotInput): ActivityWatchFilters {
  return {
    status: input.filters?.status ?? input.status ?? input.statusFilter ?? "all",
    assistantId: input.filters?.assistantId ?? input.assistantId,
    serverId: input.filters?.serverId ?? input.serverId,
    query: input.filters?.query ?? input.query,
  };
}

export function buildGlobalActivitySnapshot(
  input: BuildGlobalActivitySnapshotInput = {},
): GlobalActivitySnapshot {
  const ctx = createActivityContext(input);
  const claimedTakeoverIds = new Set<string>();
  const usedIds = new Set<string>();
  const rawItems: ActivityWatchItem[] = [];

  for (const turn of ctx.turns) {
    const item = buildTurnWatchItem(turn, ctx, claimedTakeoverIds);
    usedIds.add(item.id);
    rawItems.push(item);
  }

  for (const task of ctx.tasks) {
    const item = buildTaskWatchItem(task, ctx, usedIds, claimedTakeoverIds);
    usedIds.add(item.id);
    rawItems.push(item);
  }

  for (const takeover of ctx.takeovers) {
    if (takeover.status !== "pending") continue;
    if (claimedTakeoverIds.has(takeover.id)) continue;
    const item = buildOrphanTakeoverWatchItem(takeover, ctx);
    if (!usedIds.has(item.id)) {
      usedIds.add(item.id);
      rawItems.push(item);
    }
  }

  const allItems = sortActivityWatchItems(rawItems);
  const counts = countActivityStatuses(allItems);
  const items = filterActivityWatchItems(allItems, resolveSnapshotFilters(input));

  return {
    items,
    allItems,
    ...counts,
  };
}
