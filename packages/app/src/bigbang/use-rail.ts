import { useCallback } from "react";
import { router, usePathname } from "expo-router";
import { buildSettingsRoute } from "@/utils/host-routes";
import { returnToBigbang } from "./navigation";
import { BIGBANG_ROUTE, isPageItem, PAGE_ROUTES, railActive, type RailItem } from "./rail";
import { useBigbangView } from "./store";

const MAIN_AREA: Partial<Record<RailItem, "chat" | "studio">> = { chat: "chat", studio: "studio" };

/**
 * Rail navigation for every page of the Bigbang shell. /bigbang stays at the bottom of the stack
 * so Chat and Studio keep their retained panels; hosted pages replace one another above it.
 */
export function useRailNavigation(): {
  active: RailItem | null;
  select(item: RailItem): void;
  settings(): void;
} {
  const pathname = usePathname();
  const mode = useBigbangView((state) => state.mode);
  const section = useBigbangView((state) => state.section);
  const onBigbang = pathname === BIGBANG_ROUTE;
  const select = useCallback(
    (item: RailItem) => {
      if (isPageItem(item)) {
        if (onBigbang) router.push(PAGE_ROUTES[item]);
        else router.replace(PAGE_ROUTES[item]);
        return;
      }
      const view = useBigbangView.getState();
      if (item !== "studio") view.setSection(item);
      // Member and Search change the sidebar list only; Chat and Studios also switch the main area.
      const nextMode = MAIN_AREA[item];
      if (!onBigbang) returnToBigbang(nextMode);
      else if (nextMode) view.setMode(nextMode);
    },
    [onBigbang],
  );
  const settings = useCallback(() => router.push(buildSettingsRoute()), []);
  return { active: railActive(pathname, mode, section), select, settings };
}
