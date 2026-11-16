import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type {
  Assistant,
  ChatStatePayload as ChatState,
  MachineInfo,
  Message,
  PeerMessage,
  Studio,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { studioRecords, type RecordRow } from "./peer-activity";
import { isLiveTask, taskTitle } from "./task-view";

export interface StudioColumn {
  serverId: string;
  workspaceId: string;
  name: string;
  group: string;
}

export interface StudioSummaryWorkspace {
  key: string;
  serverId: string;
  workspaceId: string;
  name: string;
  machineLabel: string;
  bound: boolean;
  openInGroup: boolean;
}

export interface StudioSummaryAssistant {
  id: string;
  name: string;
  provider?: string;
  serverId?: string;
  activeTurnCount: number;
}

export interface StudioGroupSummary {
  group: string;
  workspaceCount: number;
  workspaces: StudioSummaryWorkspace[];
  assistantCount: number;
  assistants: StudioSummaryAssistant[];
  activeTaskCount: number;
  completedTaskCount: number;
  recordCount: number;
  highlights: string[];
  markdownDigest: string;
  generatedAt: number;
}

export interface BuildStudioGroupSummaryInput {
  group: string;
  columns?: readonly StudioColumn[];
  studio?: Studio | null;
  assistants?: readonly Assistant[];
  tasks?: readonly Task[];
  turns?: readonly Turn[];
  studioRecords?: readonly RecordRow[];
  records?: readonly RecordRow[];
  peerMessages?: readonly PeerMessage[];
  hostLabels?: Readonly<Record<string, string>>;
  generatedAt?: number;
}
export const EMPTY_CHAT_STATE: ChatState = {
  generation: "",
  cursor: 0,
  assistants: [],
  conversations: [],
  messages: [],
  tasks: [],
  turns: [],
  studios: [],
  peerMessages: [],
  routines: [],
  takeovers: [],
};
export function mergeChatState(previous: ChatState, incoming: ChatState): ChatState {
  if (incoming.generation !== previous.generation) return incoming;
  if (incoming.cursor < previous.cursor) return previous;
  const merge = <T extends { id: string }>(left: T[], right: T[]): T[] => {
    if (right.length === 0) return left;
    if (left.length === 0) return right;
    const entries = new Map(left.map((item) => [item.id, item]));
    for (const item of right) entries.set(item.id, item);
    return [...entries.values()];
  };
  const coordinatorVersion = incoming.coordinatorVersion ?? previous.coordinatorVersion;
  return {
    generation: incoming.generation,
    cursor: incoming.cursor,
    ...(coordinatorVersion ? { coordinatorVersion } : {}),
    assistants: merge(previous.assistants, incoming.assistants),
    conversations: merge(previous.conversations, incoming.conversations),
    messages: merge(previous.messages, incoming.messages),
    tasks: merge(previous.tasks, incoming.tasks),
    turns: merge(previous.turns, incoming.turns),
    // Optional on the wire: coordinators before Studio collaboration send neither collection.
    studios: merge(previous.studios ?? [], incoming.studios ?? []),
    peerMessages: merge(previous.peerMessages ?? [], incoming.peerMessages ?? []),
    routines: merge(previous.routines ?? [], incoming.routines ?? []),
    takeovers: merge(previous.takeovers ?? [], incoming.takeovers ?? []),
  };
}
export function studioKey(column: Pick<StudioColumn, "serverId" | "workspaceId">): string {
  return JSON.stringify([column.serverId, column.workspaceId]);
}
/** The Studio tab group for workspaces opened from Paseo surfaces; Chat tasks use "Tasks". */
export const OPENED_GROUP = "Workspaces";

/** The Studio column for a workspace Paseo navigation opens, keyed the way the session store is. */
export function studioColumnFor(
  selection: { serverId: string; workspaceId: string },
  workspaces: Map<string, WorkspaceDescriptor> | null | undefined,
): StudioColumn {
  const workspaceId =
    resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId: selection.workspaceId }) ??
    selection.workspaceId;
  const workspace = workspaces?.get(workspaceId);
  const name = workspace?.title || workspace?.name || workspaceId;
  return { serverId: selection.serverId, workspaceId, name, group: OPENED_GROUP };
}

export function addStudioColumn(columns: StudioColumn[], column: StudioColumn): StudioColumn[] {
  const key = studioKey(column);
  const index = columns.findIndex((item) => studioKey(item) === key);
  if (index < 0) return [...columns, column];
  const existing = columns[index]!;
  if (existing.name === column.name && existing.group === column.group) return columns;
  const next = columns.slice();
  next[index] = column;
  return next;
}

export function resolveActiveStudioKey(
  columns: readonly StudioColumn[],
  activeKey: string | null,
): string | null {
  if (!columns.length) return null;
  if (activeKey && columns.some((column) => studioKey(column) === activeKey)) {
    return activeKey;
  }
  return studioKey(columns[0]!);
}

export function listStudioGroups(
  columns: readonly StudioColumn[],
  extraGroups?: readonly string[],
): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const column of columns) {
    const trimmed = column.group.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      groups.push(trimmed);
    }
  }
  if (extraGroups) {
    for (const raw of extraGroups) {
      const trimmed = raw.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        groups.push(trimmed);
      }
    }
  }
  return groups;
}

export function renameStudioGroup(
  columns: readonly StudioColumn[],
  oldGroup: string,
  newGroup: string,
): StudioColumn[] {
  const from = oldGroup.trim();
  const to = newGroup.trim();
  if (!from || !to || from === to) return columns.slice();
  return columns.map((column) =>
    column.group === oldGroup || column.group.trim() === from ? { ...column, group: to } : column,
  );
}

export function moveStudioColumnToGroup(
  columns: readonly StudioColumn[],
  key: string,
  targetGroup: string,
): StudioColumn[] {
  const target = targetGroup.trim();
  if (!target) return columns.slice();
  return columns.map((column) => {
    if (studioKey(column) !== key) return column;
    return column.group === target ? column : { ...column, group: target };
  });
}

export function reorderStudioColumn(
  columns: readonly StudioColumn[],
  key: string,
  direction: "left" | "right",
): StudioColumn[] {
  const index = columns.findIndex((column) => studioKey(column) === key);
  if (index < 0) return columns.slice();
  const current = columns[index]!;
  let swapIndex = -1;
  if (direction === "left") {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (columns[i]!.group === current.group) {
        swapIndex = i;
        break;
      }
    }
  } else {
    for (let i = index + 1; i < columns.length; i += 1) {
      if (columns[i]!.group === current.group) {
        swapIndex = i;
        break;
      }
    }
  }
  if (swapIndex < 0) return columns.slice();
  const next = columns.slice();
  next[index] = next[swapIndex]!;
  next[swapIndex] = current;
  return next;
}

const ACTIVE_TURN_STATUSES = new Set<Turn["status"]>([
  "queued",
  "creating",
  "running",
  "attention",
]);

function collectSummaryWorkspaces(
  group: string,
  columns: readonly StudioColumn[],
  studio: Studio | null | undefined,
  hostLabels: Readonly<Record<string, string>> | undefined,
): StudioSummaryWorkspace[] {
  const groupColumns = columns.filter((col) => col.group === group);
  const studioWorkspaces = studio?.workspaces ?? [];
  const boundKeys = new Set(studioWorkspaces.map((item) => studioKey(item)));
  const openKeys = new Set(groupColumns.map((item) => studioKey(item)));
  const byKey = new Map<string, StudioSummaryWorkspace>();

  for (const col of groupColumns) {
    const key = studioKey(col);
    byKey.set(key, {
      key,
      serverId: col.serverId,
      workspaceId: col.workspaceId,
      name: col.name,
      machineLabel: hostLabels?.[col.serverId] ?? col.serverId,
      bound: boundKeys.has(key),
      openInGroup: true,
    });
  }
  for (const ws of studioWorkspaces) {
    const key = studioKey(ws);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      serverId: ws.serverId,
      workspaceId: ws.workspaceId,
      name: ws.name,
      machineLabel: hostLabels?.[ws.serverId] ?? ws.serverId,
      bound: true,
      openInGroup: openKeys.has(key),
    });
  }
  return [...byKey.values()];
}

function collectSummaryAssistants(
  studio: Studio | null | undefined,
  assistants: readonly Assistant[],
  tasks: readonly Task[],
  turns: readonly Turn[],
  workspaceKeySet: ReadonlySet<string>,
): StudioSummaryAssistant[] {
  const linkedIds = new Set<string>(studio?.assistantIds ?? []);
  for (const task of tasks) {
    if (task.execution && workspaceKeySet.has(studioKey(task.execution))) {
      linkedIds.add(task.assistantId);
    }
  }
  const byId = new Map<string, StudioSummaryAssistant>();
  const countActiveTurns = (assistantId: string) =>
    turns.filter((t) => t.assistantId === assistantId && ACTIVE_TURN_STATUSES.has(t.status)).length;

  if (studio != null) {
    for (const assistant of assistants) {
      if (!linkedIds.has(assistant.id)) continue;
      byId.set(assistant.id, {
        id: assistant.id,
        name: assistant.name,
        provider: assistant.provider,
        serverId: assistant.serverId,
        activeTurnCount: countActiveTurns(assistant.id),
      });
    }
    for (const id of linkedIds) {
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        name: id,
        activeTurnCount: countActiveTurns(id),
      });
    }
    return [...byId.values()];
  }

  for (const assistant of assistants) {
    byId.set(assistant.id, {
      id: assistant.id,
      name: assistant.name,
      provider: assistant.provider,
      serverId: assistant.serverId,
      activeTurnCount: countActiveTurns(assistant.id),
    });
  }
  return [...byId.values()];
}

function selectGroupTasks(
  tasks: readonly Task[],
  workspaceKeySet: ReadonlySet<string>,
  assistantIdSet: ReadonlySet<string>,
  hasStudio: boolean,
): Task[] {
  const matched = tasks.filter(
    (task) =>
      Boolean(task.execution && workspaceKeySet.has(studioKey(task.execution))) ||
      assistantIdSet.has(task.assistantId),
  );
  if (matched.length > 0 || hasStudio) return matched;
  return [...tasks];
}

function buildSummaryHighlights(input: {
  group: string;
  workspaces: readonly StudioSummaryWorkspace[];
  assistants: readonly StudioSummaryAssistant[];
  tasks: readonly Task[];
  records: readonly RecordRow[];
}): string[] {
  const highlights: string[] = [];
  const recentRecords = input.records.slice(-4);
  for (const row of recentRecords) {
    highlights.push(`${row.route} (${row.kind} · ${row.status}): ${row.text}`);
  }
  for (const task of input.tasks) {
    if (isLiveTask(task) && highlights.length < 7) {
      highlights.push(`Active task: ${taskTitle(task)} (${task.status})`);
    }
  }
  for (const task of input.tasks) {
    if (task.status === "completed" && highlights.length < 9) {
      highlights.push(`Completed task: ${taskTitle(task)}`);
    }
  }
  for (const assistant of input.assistants) {
    if (assistant.activeTurnCount > 0 && highlights.length < 10) {
      highlights.push(
        `${assistant.name} has ${assistant.activeTurnCount} active ${assistant.activeTurnCount === 1 ? "turn" : "turns"}`,
      );
    }
  }
  if (highlights.length === 0 && input.workspaces.length > 0) {
    const names = input.workspaces.map((w) => `${w.name} (${w.machineLabel})`).join(", ");
    highlights.push(`Workspaces in ${input.group}: ${names}`);
  }
  return highlights;
}

export function buildStudioGroupSummary(input: BuildStudioGroupSummaryInput): StudioGroupSummary {
  const group = input.group.trim() || "General";
  const generatedAt = input.generatedAt ?? Date.now();
  const columns = input.columns ?? [];
  const rawAssistants = input.assistants ?? [];
  const rawTasks = input.tasks ?? [];
  const rawTurns = input.turns ?? [];
  const resolvedRecords =
    input.studioRecords ??
    input.records ??
    (input.studio && input.peerMessages ? studioRecords(input.peerMessages, input.studio) : []);

  const workspaces = collectSummaryWorkspaces(group, columns, input.studio, input.hostLabels);
  const workspaceKeySet = new Set(workspaces.map((w) => w.key));
  const assistants = collectSummaryAssistants(
    input.studio,
    rawAssistants,
    rawTasks,
    rawTurns,
    workspaceKeySet,
  );
  const assistantIdSet = new Set(assistants.map((a) => a.id));
  const groupTasks = selectGroupTasks(
    rawTasks,
    workspaceKeySet,
    assistantIdSet,
    Boolean(input.studio),
  );

  const activeTaskCount = groupTasks.filter((t) => isLiveTask(t)).length;
  const completedTaskCount = groupTasks.filter((t) => t.status === "completed").length;
  const recordCount = resolvedRecords.length;
  const highlights = buildSummaryHighlights({
    group,
    workspaces,
    assistants,
    tasks: groupTasks,
    records: resolvedRecords,
  });

  const workspaceSummary =
    workspaces.length > 0
      ? workspaces.map((w) => `${w.name} (${w.machineLabel})`).join(", ")
      : "None";
  const assistantSummary =
    assistants.length > 0 ? assistants.map((a) => a.name).join(", ") : "None";
  const highlightSection =
    highlights.length > 0
      ? highlights.map((line) => `- ${line}`).join("\n")
      : "- No recent peer exchanges or tasks.";

  const markdownDigest = [
    `# Studio Summary · ${group}`,
    "",
    `- **Workspaces (${workspaces.length}):** ${workspaceSummary}`,
    `- **Collaborating Assistants (${assistants.length}):** ${assistantSummary}`,
    `- **Tasks:** ${activeTaskCount} active · ${completedTaskCount} completed`,
    `- **Peer Records:** ${recordCount}`,
    "",
    "## Highlights",
    highlightSection,
  ].join("\n");

  return {
    group,
    workspaceCount: workspaces.length,
    workspaces,
    assistantCount: assistants.length,
    assistants,
    activeTaskCount,
    completedTaskCount,
    recordCount,
    highlights,
    markdownDigest,
    generatedAt,
  };
}

/**
 * Ledger order. Rows written before the ledger assigned `seq` have none; they predate every row
 * that does, so they come first by `createdAt`, then the rest by `seq`. A strict total order
 * keeps the sort stable when one conversation holds both.
 */
export function compareMessages(a: Message, b: Message): number {
  if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq || a.id.localeCompare(b.id);
  if (a.seq !== undefined) return 1;
  if (b.seq !== undefined) return -1;
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}
export function sortMessages(messages: readonly Message[]): Message[] {
  return [...messages].sort(compareMessages);
}
/** System and task_event rows are ledger notes, not speech: they render as compact centred rows. */
export function isNoteMessage(message: Pick<Message, "kind">): boolean {
  return message.kind === "system" || message.kind === "task_event";
}

/** A saved host's Pavra role as the Chat coordinator reports it; absent hosts only serve Studio. */
export function machineRoleLabel(machine: MachineInfo | undefined): string {
  if (!machine) return "Studio only";
  if (machine.role === "coordinator") return "Chat coordinator";
  if (machine.role === "member") return "Member";
  return machine.reason ? `Unavailable · ${machine.reason}` : "Unavailable";
}

/**
 * Picks a valid coordinator host when none is selected yet (or when the persisted coordinatorId
 * is no longer among saved hosts). Preserves the current `coordinatorId` while `hosts` is empty
 * so cold hydration does not wipe a persisted selection.
 */
export function resolveDefaultCoordinatorId(
  coordinatorId: string,
  hosts: readonly { serverId: string }[],
  machines?: readonly MachineInfo[],
): string {
  if (hosts.length === 0) return coordinatorId;
  if (coordinatorId && hosts.some((host) => host.serverId === coordinatorId)) {
    return coordinatorId;
  }
  const coordinatorMachine = machines?.find(
    (machine) =>
      machine.role === "coordinator" && hosts.some((host) => host.serverId === machine.serverId),
  );
  if (coordinatorMachine) return coordinatorMachine.serverId;
  return hosts[0]!.serverId;
}

/**
 * Picks the first conversation when no chat is selected yet (or when the persisted chatId
 * does not exist on the active coordinator). Preserves `chatId` while `conversations` is empty.
 */
export function resolveDefaultChatId(
  chatId: string,
  conversations: readonly { id: string }[],
): string {
  if (conversations.length === 0) return chatId;
  if (chatId && conversations.some((conversation) => conversation.id === chatId)) {
    return chatId;
  }
  return conversations[0]!.id;
}
