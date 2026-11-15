import type {
  Assistant,
  ChatState,
  Conversation,
  Message,
  Routine,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { firstLine } from "./inbox";
import { mergeChatState } from "./model";
import type { SidebarSection } from "./store";
import { taskThreadId, taskTitle } from "./task-view";

export interface PavraNotificationTarget {
  serverId: string;
  pavraSection: "inbox" | "chat";
  pavraConversationId?: string;
  pavraThreadId?: string | null;
}

export interface PavraNotificationEvent {
  key: string;
  kind: "task_permission" | "turn_attention" | "task_event" | "routine_reply" | "chat_reply";
  title: string;
  body: string;
  target: PavraNotificationTarget;
}

export interface PavraNotificationContext {
  coordinatorId: string;
  appActive?: boolean;
  activeMode?: "chat" | "studio" | "assistants";
  activeSection?: SidebarSection | string;
  activeChatId?: string;
  activeThreadId?: string | null;
}

const NOTIFY_TASK_EVENT_TYPES = new Set(["task_completed", "task_failed", "task_budget"]);

export function collectPavraNotificationKeys(state: ChatState): Set<string> {
  const keys = new Set<string>();
  for (const task of state.tasks) {
    if (task.pendingPermission != null) {
      keys.add(`perm:${task.id}:${task.pendingPermission.requestId}`);
    }
  }
  for (const turn of state.turns) {
    if (turn.status === "attention") {
      keys.add(`turn-attn:${turn.id}`);
    }
  }
  for (const message of state.messages) {
    keys.add(`msg:${message.id}`);
  }
  return keys;
}

function normalizeContext(
  input: Partial<PavraNotificationContext> | string | undefined,
  fallbackCoordinatorId = "",
): PavraNotificationContext {
  if (typeof input === "string") {
    return { coordinatorId: input, appActive: false };
  }
  return {
    coordinatorId: input?.coordinatorId ?? fallbackCoordinatorId,
    appActive: input?.appActive ?? false,
    activeMode: input?.activeMode,
    activeSection: input?.activeSection,
    activeChatId: input?.activeChatId,
    activeThreadId: input?.activeThreadId,
  };
}

function isViewingChatLane(
  context: PavraNotificationContext,
  conversationId: string,
  threadId: string | null | undefined,
): boolean {
  return (
    Boolean(context.appActive) &&
    (context.activeMode ?? "chat") === "chat" &&
    (context.activeSection ?? "chat") === "chat" &&
    (context.activeChatId ?? "") === conversationId &&
    (context.activeThreadId ?? null) === (threadId ?? null)
  );
}

interface NotificationLookups {
  assistantsById: ReadonlyMap<string, Assistant>;
  conversationsById: ReadonlyMap<string, Conversation>;
  tasksById: ReadonlyMap<string, Task>;
  routinesById: ReadonlyMap<string, Routine>;
}

function buildLookups(prev: ChatState | null, next: ChatState): NotificationLookups {
  const assistantsById = new Map<string, Assistant>();
  const conversationsById = new Map<string, Conversation>();
  const tasksById = new Map<string, Task>();
  const routinesById = new Map<string, Routine>();

  if (prev && prev.generation === next.generation) {
    for (const item of prev.assistants) assistantsById.set(item.id, item);
    for (const item of prev.conversations) conversationsById.set(item.id, item);
    for (const item of prev.tasks) tasksById.set(item.id, item);
    for (const item of prev.routines ?? []) routinesById.set(item.id, item);
  }
  for (const item of next.assistants) assistantsById.set(item.id, item);
  for (const item of next.conversations) conversationsById.set(item.id, item);
  for (const item of next.tasks) tasksById.set(item.id, item);
  for (const item of next.routines ?? []) routinesById.set(item.id, item);

  return { assistantsById, conversationsById, tasksById, routinesById };
}

function resolveTaskEventAssistantName(
  message: Message,
  task: Task | null,
  assistantsById: ReadonlyMap<string, Assistant>,
): string {
  const assistantId =
    task?.assistantId ??
    message.event?.notifyAssistantId ??
    (message.senderId !== "system" && message.senderId !== "user" ? message.senderId : null);
  if (!assistantId) return "Assistant";
  return assistantsById.get(assistantId)?.name ?? "Assistant";
}

function formatTaskEventTitle(eventType: string, assistantName: string): string {
  if (eventType === "task_completed") {
    return `Task completed · ${assistantName}`;
  }
  if (eventType === "task_budget") {
    return `Task paused (budget) · ${assistantName}`;
  }
  return `Task failed · ${assistantName}`;
}

function collectTaskPermissionEvents(
  tasks: readonly Task[],
  seenKeys: Set<string>,
  lookups: NotificationLookups,
  coordinatorId: string,
): PavraNotificationEvent[] {
  const events: PavraNotificationEvent[] = [];
  for (const task of tasks) {
    if (task.pendingPermission == null) continue;
    const key = `perm:${task.id}:${task.pendingPermission.requestId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const assistantName = lookups.assistantsById.get(task.assistantId)?.name ?? "Assistant";
    events.push({
      key,
      kind: "task_permission",
      title: `Approval needed · ${assistantName}`,
      body: `${taskTitle(task)} — ${task.pendingPermission.title}`,
      target: {
        serverId: coordinatorId,
        pavraSection: "inbox",
        pavraConversationId: task.conversationId,
        pavraThreadId: taskThreadId(task.id),
      },
    });
  }
  return events;
}

function collectTurnAttentionEvents(
  turns: readonly Turn[],
  seenKeys: Set<string>,
  lookups: NotificationLookups,
  coordinatorId: string,
): PavraNotificationEvent[] {
  const events: PavraNotificationEvent[] = [];
  for (const turn of turns) {
    if (turn.status !== "attention") continue;
    const key = `turn-attn:${turn.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const assistantName = lookups.assistantsById.get(turn.assistantId)?.name ?? "Assistant";
    events.push({
      key,
      kind: "turn_attention",
      title: `Attention needed · ${assistantName}`,
      body: firstLine(turn.prompt) || "Waiting for your input",
      target: {
        serverId: coordinatorId,
        pavraSection: "inbox",
        pavraConversationId: turn.conversationId,
        pavraThreadId: turn.threadId,
      },
    });
  }
  return events;
}

function toTaskEventNotification(
  key: string,
  message: Message,
  lookups: NotificationLookups,
  context: PavraNotificationContext,
): PavraNotificationEvent | null {
  const eventType = message.event?.type ?? "";
  if (!NOTIFY_TASK_EVENT_TYPES.has(eventType)) return null;
  const taskId = message.taskId ?? message.event?.taskId ?? null;
  const task = taskId ? (lookups.tasksById.get(taskId) ?? null) : null;
  const targetThreadId = taskId ? taskThreadId(taskId) : message.threadId;
  const shouldNotify =
    !context.appActive ||
    eventType === "task_budget" ||
    !isViewingChatLane(context, message.conversationId, targetThreadId);
  if (!shouldNotify) return null;

  const assistantName = resolveTaskEventAssistantName(message, task, lookups.assistantsById);
  return {
    key,
    kind: "task_event",
    title: formatTaskEventTitle(eventType, assistantName),
    body: message.event?.detail || message.content,
    target: {
      serverId: context.coordinatorId,
      pavraSection: eventType === "task_budget" ? "inbox" : "chat",
      pavraConversationId: message.conversationId,
      pavraThreadId: targetThreadId,
    },
  };
}

function toFinalMessageNotification(
  key: string,
  message: Message,
  lookups: NotificationLookups,
  context: PavraNotificationContext,
): PavraNotificationEvent | null {
  if (isViewingChatLane(context, message.conversationId, message.threadId)) {
    return null;
  }
  if (message.routineId) {
    const routine = lookups.routinesById.get(message.routineId);
    const assistantName =
      lookups.assistantsById.get(message.senderId)?.name ??
      (routine ? lookups.assistantsById.get(routine.assistantId)?.name : undefined) ??
      "Assistant";
    const routineName = message.routineName ?? routine?.name ?? "Routine";
    return {
      key,
      kind: "routine_reply",
      title: `${assistantName} · ${routineName}`,
      body: firstLine(message.content),
      target: {
        serverId: context.coordinatorId,
        pavraSection: "chat",
        pavraConversationId: message.conversationId,
        pavraThreadId: message.threadId,
      },
    };
  }
  const assistantName = lookups.assistantsById.get(message.senderId)?.name ?? "Assistant";
  const conversationName =
    lookups.conversationsById.get(message.conversationId)?.name ?? message.conversationId;
  return {
    key,
    kind: "chat_reply",
    title: `${assistantName} · ${conversationName}`,
    body: firstLine(message.content),
    target: {
      serverId: context.coordinatorId,
      pavraSection: "chat",
      pavraConversationId: message.conversationId,
      pavraThreadId: message.threadId,
    },
  };
}

export function diffPavraNotifications(
  prev: ChatState | null,
  next: ChatState,
  seenKeys: Set<string>,
  contextInput: Partial<PavraNotificationContext> | string,
): PavraNotificationEvent[] {
  const context = normalizeContext(contextInput);

  if (prev === null || prev.generation !== next.generation) {
    if (prev !== null) {
      seenKeys.clear();
    }
    for (const key of collectPavraNotificationKeys(next)) {
      seenKeys.add(key);
    }
    return [];
  }

  if (next.cursor <= prev.cursor) {
    return [];
  }

  const lookups = buildLookups(prev, next);
  const events: PavraNotificationEvent[] = [
    ...collectTaskPermissionEvents(next.tasks, seenKeys, lookups, context.coordinatorId),
    ...collectTurnAttentionEvents(next.turns, seenKeys, lookups, context.coordinatorId),
  ];

  for (const message of next.messages) {
    const key = `msg:${message.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    if (message.kind === "task_event") {
      const event = toTaskEventNotification(key, message, lookups, context);
      if (event) events.push(event);
      continue;
    }

    if (message.kind === "final") {
      const event = toFinalMessageNotification(key, message, lookups, context);
      if (event) events.push(event);
    }
  }

  return events;
}

export interface PavraNotificationTracker {
  readonly seenKeys: ReadonlySet<string>;
  readonly previousState: ChatState | null;
  update(
    next: ChatState,
    context?: Partial<PavraNotificationContext> | string,
  ): PavraNotificationEvent[];
  push(
    next: ChatState,
    context?: Partial<PavraNotificationContext> | string,
  ): PavraNotificationEvent[];
  reset(): void;
}

function isEmptyPlaceholderState(state: ChatState): boolean {
  return (
    !state.generation &&
    state.cursor === 0 &&
    state.messages.length === 0 &&
    state.tasks.length === 0 &&
    state.turns.length === 0
  );
}

export function createPavraNotificationTracker(
  defaultContext?: Partial<PavraNotificationContext> | string,
): PavraNotificationTracker {
  const seenKeys = new Set<string>();
  let prev: ChatState | null = null;
  let prevCoordinatorId =
    typeof defaultContext === "string" ? defaultContext : (defaultContext?.coordinatorId ?? "");

  function update(
    next: ChatState,
    contextInput?: Partial<PavraNotificationContext> | string,
  ): PavraNotificationEvent[] {
    if (isEmptyPlaceholderState(next)) {
      return [];
    }

    const baseContext = normalizeContext(defaultContext, prevCoordinatorId);
    const context =
      contextInput === undefined
        ? baseContext
        : normalizeContext(
            typeof contextInput === "string"
              ? { ...baseContext, coordinatorId: contextInput }
              : { ...baseContext, ...contextInput },
            baseContext.coordinatorId,
          );

    if (context.coordinatorId && prevCoordinatorId && context.coordinatorId !== prevCoordinatorId) {
      prev = null;
      seenKeys.clear();
    }
    if (context.coordinatorId) {
      prevCoordinatorId = context.coordinatorId;
    }

    const events = diffPavraNotifications(prev, next, seenKeys, context);
    prev = prev && prev.generation === next.generation ? mergeChatState(prev, next) : next;
    return events;
  }

  return {
    get seenKeys() {
      return seenKeys;
    },
    get previousState() {
      return prev;
    },
    update,
    push: update,
    reset() {
      prev = null;
      seenKeys.clear();
    },
  };
}
