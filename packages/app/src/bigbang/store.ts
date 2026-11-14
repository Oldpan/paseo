import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { addStudioColumn, studioKey, type StudioColumn } from "./model";
import {
  clampSidebarWidth,
  clampThreadWidth,
  SIDEBAR_DEFAULT_WIDTH,
  THREAD_DEFAULT_WIDTH,
} from "./panel-resize";

export type SidebarSection = "chat" | "members" | "search";

interface BigbangViewState {
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
  drafts: Record<string, string>;
  selectCoordinator(id: string): void;
  selectChat(id: string): void;
  setMode(mode: BigbangViewState["mode"]): void;
  setSection(section: SidebarSection): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setSidebarWidth(width: number): void;
  setThreadWidth(width: number): void;
  setThread(id: string | null): void;
  draft(key: string, value: string): void;
  openColumn(column: StudioColumn): void;
  focusColumn(key: string): void;
  removeColumn(key: string): void;
}
export const useBigbangView = create<BigbangViewState>()(
  persist(
    (set) => ({
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
      drafts: {},
      selectCoordinator: (coordinatorId) => set({ coordinatorId, chatId: "", threadId: null }),
      selectChat: (chatId) => set({ chatId, threadId: null, mode: "chat" }),
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
          mode: "studio",
        })),
      focusColumn: (activeColumn) => set({ activeColumn }),
      removeColumn: (key) =>
        set((state) => {
          const columns = state.columns.filter((column) => studioKey(column) !== key);
          const firstKey = columns[0] ? studioKey(columns[0]) : null;
          return {
            columns,
            activeColumn: state.activeColumn === key ? firstKey : state.activeColumn,
          };
        }),
    }),
    {
      name: "bigbang-view-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({
        coordinatorId,
        chatId,
        sidebarCollapsed,
        sidebarWidth,
        threadWidth,
        columns,
        activeColumn,
        drafts,
      }) => ({
        coordinatorId,
        chatId,
        sidebarCollapsed,
        sidebarWidth,
        threadWidth,
        columns,
        activeColumn,
        drafts,
      }),
    },
  ),
);
