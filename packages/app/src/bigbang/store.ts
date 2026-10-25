import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { addStudioColumn, studioKey, type StudioColumn } from "./model";

interface BigbangViewState {
  coordinatorId: string;
  chatId: string;
  threadId: string | null;
  mode: "chat" | "studio" | "assistants";
  columns: StudioColumn[];
  activeColumn: string | null;
  drafts: Record<string, string>;
  selectCoordinator(id: string): void;
  selectChat(id: string): void;
  setMode(mode: BigbangViewState["mode"]): void;
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
      columns: [],
      activeColumn: null,
      drafts: {},
      selectCoordinator: (coordinatorId) => set({ coordinatorId, chatId: "", threadId: null }),
      selectChat: (chatId) => set({ chatId, threadId: null, mode: "chat" }),
      setMode: (mode) => set({ mode }),
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
      partialize: ({ coordinatorId, chatId, columns, activeColumn, drafts }) => ({
        coordinatorId,
        chatId,
        columns,
        activeColumn,
        drafts,
      }),
    },
  ),
);
