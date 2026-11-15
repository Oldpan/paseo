// Where Paseo's navigation lands in the Pavra build: one shell at /pavra, and Studio columns
// own the workspaces Paseo would otherwise open at /h/<serverId>/workspace/<workspaceId>.
import { router } from "expo-router";
import { useSessionStore } from "@/stores/session-store";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { studioColumnFor } from "./model";
import { PAVRA_ROUTE } from "./rail";
import { usePavraView, type SidebarSection } from "./store";

export function openStudioWorkspace(selection: { serverId: string; workspaceId: string }): void {
  const workspaces = useSessionStore.getState().sessions[selection.serverId]?.workspaces;
  usePavraView.getState().openColumn(studioColumnFor(selection, workspaces));
}

/** Return to the Pavra screen, popping back to it when it is already in the stack. */
export function returnToPavra(mode?: "chat" | "studio"): void {
  if (mode) usePavraView.getState().setMode(mode);
  router.dismissTo(PAVRA_ROUTE);
}

/** Open a specific Pavra section or conversation/thread (e.g. from a notification or link). */
export function openPavraLocation(target: {
  serverId?: string;
  section?: SidebarSection;
  chatId?: string;
  threadId?: string | null;
}): void {
  const view = usePavraView.getState();
  if (target.serverId && target.serverId !== view.coordinatorId) {
    view.selectCoordinator(target.serverId);
  }
  if (target.chatId) {
    view.selectChat(target.chatId);
  }
  if (target.threadId !== undefined) {
    view.setThread(target.threadId);
  }
  if (target.section) {
    view.setSection(target.section);
  }
  returnToPavra("chat");
}

/** `navigateToWorkspace`'s route step in the Pavra build. */
export function navigateToStudioWorkspaceRoute(route: string): void {
  const selection = parseHostWorkspaceRouteFromPathname(route);
  if (selection) openStudioWorkspace(selection);
  returnToPavra("studio");
}
