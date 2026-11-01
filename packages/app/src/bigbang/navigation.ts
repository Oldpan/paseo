// Where Paseo's navigation lands in the Bigbang build: one shell at /bigbang, and Studio columns
// own the workspaces Paseo would otherwise open at /h/<serverId>/workspace/<workspaceId>.
import { router } from "expo-router";
import { useSessionStore } from "@/stores/session-store";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { studioColumnFor } from "./model";
import { BIGBANG_ROUTE } from "./rail";
import { useBigbangView } from "./store";

export function openStudioWorkspace(selection: { serverId: string; workspaceId: string }): void {
  const workspaces = useSessionStore.getState().sessions[selection.serverId]?.workspaces;
  useBigbangView.getState().openColumn(studioColumnFor(selection, workspaces));
}

/** Return to the Bigbang screen, popping back to it when it is already in the stack. */
export function returnToBigbang(mode?: "chat" | "studio"): void {
  if (mode) useBigbangView.getState().setMode(mode);
  router.dismissTo(BIGBANG_ROUTE);
}

/** `navigateToWorkspace`'s route step in the Bigbang build. */
export function navigateToStudioWorkspaceRoute(route: string): void {
  const selection = parseHostWorkspaceRouteFromPathname(route);
  if (selection) openStudioWorkspace(selection);
  returnToBigbang("studio");
}
