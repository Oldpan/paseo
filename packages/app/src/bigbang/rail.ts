// The Bigbang rail is the shell's one navigation column. Chat, Member, Search and Studios live in
// the /bigbang screen; History and Schedules are Paseo pages hosted in the same shell.
import type { SidebarSection } from "./store";

export type RailItem = SidebarSection | "studio" | "history" | "schedules";
export type PageItem = "history" | "schedules";

export const BIGBANG_ROUTE = "/bigbang";
export const PAGE_ROUTES = {
  history: "/sessions",
  schedules: "/schedules",
} as const satisfies Record<PageItem, string>;

export function isPageItem(item: RailItem): item is PageItem {
  return item === "history" || item === "schedules";
}

/** The highlighted rail item for a route. Pages without an item (a new workspace) highlight none. */
export function railActive(
  pathname: string,
  mode: "chat" | "studio" | "assistants",
  section: SidebarSection,
): RailItem | null {
  if (pathname === PAGE_ROUTES.history) return "history";
  if (pathname === PAGE_ROUTES.schedules) return "schedules";
  if (pathname !== BIGBANG_ROUTE) return null;
  return mode === "studio" ? "studio" : section;
}
