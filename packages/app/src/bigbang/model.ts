import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type {
  ChatState,
  MachineInfo,
  Message,
} from "../../../../extensions/bigbang/shared/contracts";

export interface StudioColumn {
  serverId: string;
  workspaceId: string;
  name: string;
  group: string;
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
  return {
    generation: incoming.generation,
    cursor: incoming.cursor,
    assistants: merge(previous.assistants, incoming.assistants),
    conversations: merge(previous.conversations, incoming.conversations),
    messages: merge(previous.messages, incoming.messages),
    tasks: merge(previous.tasks, incoming.tasks),
    turns: merge(previous.turns, incoming.turns),
    // Optional on the wire: coordinators before Studio collaboration send neither collection.
    studios: merge(previous.studios ?? [], incoming.studios ?? []),
    peerMessages: merge(previous.peerMessages ?? [], incoming.peerMessages ?? []),
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

/** A saved host's Bigbang role as the Chat coordinator reports it; absent hosts only serve Studio. */
export function machineRoleLabel(machine: MachineInfo | undefined): string {
  if (!machine) return "Studio only";
  if (machine.role === "coordinator") return "Chat coordinator";
  if (machine.role === "member") return "Member";
  return machine.reason ? `Unavailable · ${machine.reason}` : "Unavailable";
}
