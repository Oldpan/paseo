import type { ChatState } from "../../../../extensions/bigbang/shared/contracts";

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
};
export function mergeChatState(previous: ChatState, incoming: ChatState): ChatState {
  if (incoming.generation !== previous.generation) return incoming;
  if (incoming.cursor < previous.cursor) return previous;
  const merge = <T extends { id: string }>(left: T[], right: T[]): T[] => {
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
  };
}
export function studioKey(column: Pick<StudioColumn, "serverId" | "workspaceId">): string {
  return JSON.stringify([column.serverId, column.workspaceId]);
}
export function addStudioColumn(columns: StudioColumn[], column: StudioColumn): StudioColumn[] {
  return columns.some((item) => studioKey(item) === studioKey(column))
    ? columns
    : [...columns, column];
}
