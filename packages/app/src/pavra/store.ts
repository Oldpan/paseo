import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  addStudioColumn,
  listStudioGroups,
  moveStudioColumnToGroup,
  renameStudioGroup,
  reorderStudioColumn,
  studioKey,
  type StudioColumn,
} from "./model";
import {
  clampSidebarWidth,
  clampThreadWidth,
  SIDEBAR_DEFAULT_WIDTH,
  THREAD_DEFAULT_WIDTH,
} from "./panel-resize";

export type SidebarSection =
  | "chat"
  | "inbox"
  | "tasks"
  | "activity"
  | "saved"
  | "members"
  | "search";

interface PavraViewState {
  coordinatorId: string;
  chatId: string;
  threadId: string | null;
  mode: "chat" | "studio" | "assistants";
  /** What the sidebar lists in Chat; a rail choice, so it is not persisted. */
  section: SidebarSection;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  threadWidth: number;
  columns: StudioColumn[];
  activeColumn: string | null;
  extraGroups: string[];
  activeGroup: string | null;
  drafts: Record<string, string>;
  selectCoordinator(id: string): void;
  selectChat(id: string): void;
  setMode(mode: PavraViewState["mode"]): void;
  setSection(section: SidebarSection): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setSidebarWidth(width: number): void;
  setThreadWidth(width: number): void;
  setThread(id: string | null): void;
  draft(key: string, value: string): void;
  openColumn(column: StudioColumn): void;
  focusColumn(key: string): void;
  removeColumn(key: string): void;
  addGroup(group: string): void;
  focusGroup(group: string): void;
  renameGroup(oldGroup: string, newGroup: string): void;
  renameStudioGroup(oldGroup: string, newGroup: string): void;
  moveColumnToGroup(key: string, targetGroup: string): void;
  moveStudioColumnToGroup(key: string, targetGroup: string): void;
  reorderColumn(key: string, direction: "left" | "right"): void;
  reorderStudioColumn(key: string, direction: "left" | "right"): void;
}
export const usePavraView = create<PavraViewState>()(
  persist(
    (set, get) => ({
      coordinatorId: "",
      chatId: "",
      threadId: null,
      mode: "chat",
      section: "chat",
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      threadWidth: THREAD_DEFAULT_WIDTH,
      columns: [],
      activeColumn: null,
      extraGroups: [],
      activeGroup: null,
      drafts: {},
      selectCoordinator: (coordinatorId) => set({ coordinatorId, chatId: "", threadId: null }),
      selectChat: (chatId) =>
        set((state) => ({
          chatId,
          threadId: null,
          mode: "chat",
          section:
            state.section === "inbox" ||
            state.section === "tasks" ||
            state.section === "activity" ||
            state.section === "saved"
              ? "chat"
              : state.section,
        })),
      setMode: (mode) => set({ mode }),
      setSection: (section) => set({ section, sidebarCollapsed: false }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setThreadWidth: (width) => set({ threadWidth: clampThreadWidth(width) }),
      setThread: (threadId) => set({ threadId }),
      draft: (key, value) => set((state) => ({ drafts: { ...state.drafts, [key]: value } })),
      openColumn: (column) =>
        set((state) => ({
          columns: addStudioColumn(state.columns, column),
          activeColumn: studioKey(column),
          activeGroup: column.group.trim() || state.activeGroup,
          mode: "studio",
        })),
      focusColumn: (activeColumn) =>
        set((state) => {
          const matched = state.columns.find((col) => studioKey(col) === activeColumn);
          return {
            activeColumn,
            activeGroup: matched ? matched.group : state.activeGroup,
          };
        }),
      removeColumn: (key) =>
        set((state) => {
          const columns = state.columns.filter((column) => studioKey(column) !== key);
          const firstKey = columns[0] ? studioKey(columns[0]) : null;
          const nextActive = state.activeColumn === key ? firstKey : state.activeColumn;
          const activeCol = columns.find((col) => studioKey(col) === nextActive);
          return {
            columns,
            activeColumn: nextActive,
            activeGroup: activeCol ? activeCol.group : state.activeGroup,
          };
        }),
      addGroup: (group) =>
        set((state) => {
          const trimmed = group.trim();
          if (!trimmed) return state;
          const extraGroups = listStudioGroups([], [...state.extraGroups, trimmed]);
          const firstInGroup = state.columns.find((col) => col.group === trimmed);
          return {
            extraGroups,
            activeGroup: trimmed,
            ...(firstInGroup ? { activeColumn: studioKey(firstInGroup) } : {}),
          };
        }),
      focusGroup: (group) =>
        set((state) => {
          const trimmed = group.trim();
          if (!trimmed) return state;
          const currentActive = state.columns.find((col) => studioKey(col) === state.activeColumn);
          const firstInGroup = state.columns.find((col) => col.group === trimmed);
          let nextActiveColumn = state.activeColumn;
          if (currentActive?.group !== trimmed && firstInGroup) {
            nextActiveColumn = studioKey(firstInGroup);
          }
          return {
            activeGroup: trimmed,
            activeColumn: nextActiveColumn,
          };
        }),
      renameGroup: (oldGroup, newGroup) =>
        set((state) => {
          const from = oldGroup.trim();
          const to = newGroup.trim();
          if (!from || !to || from === to) return state;
          const columns = renameStudioGroup(state.columns, from, to);
          const mappedExtras = state.extraGroups.map((g) => (g.trim() === from ? to : g));
          const hadInExtrasOrEmpty =
            mappedExtras.includes(to) || !columns.some((col) => col.group === to);
          const extraGroups = listStudioGroups(
            [],
            hadInExtrasOrEmpty ? [...mappedExtras, to] : mappedExtras,
          );
          return {
            columns,
            extraGroups,
            activeGroup: state.activeGroup === from ? to : state.activeGroup,
          };
        }),
      renameStudioGroup: (oldGroup, newGroup) => get().renameGroup(oldGroup, newGroup),
      moveColumnToGroup: (key, targetGroup) =>
        set((state) => {
          const target = targetGroup.trim();
          if (!target) return state;
          const columns = moveStudioColumnToGroup(state.columns, key, target);
          const extraGroups = listStudioGroups([], [...state.extraGroups, target]);
          return {
            columns,
            extraGroups,
            activeColumn: key,
            activeGroup: target,
          };
        }),
      moveStudioColumnToGroup: (key, targetGroup) => get().moveColumnToGroup(key, targetGroup),
      reorderColumn: (key, direction) =>
        set((state) => ({
          columns: reorderStudioColumn(state.columns, key, direction),
        })),
      reorderStudioColumn: (key, direction) => get().reorderColumn(key, direction),
    }),
    {
      name: "pavra-view-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({
        coordinatorId,
        chatId,
        sidebarCollapsed,
        sidebarWidth,
        threadWidth,
        columns,
        activeColumn,
        extraGroups,
        activeGroup,
        drafts,
      }) => ({
        coordinatorId,
        chatId,
        sidebarCollapsed,
        sidebarWidth,
        threadWidth,
        columns,
        activeColumn,
        extraGroups,
        activeGroup,
        drafts,
      }),
    },
  ),
);
