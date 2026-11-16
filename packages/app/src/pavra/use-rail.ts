import { useCallback } from "react";
import { router, usePathname } from "expo-router";
import { buildSettingsRoute, buildSettingsSectionRoute } from "@/utils/host-routes";
import { returnToPavra } from "./navigation";
import { PAVRA_ROUTE, isPageItem, PAGE_ROUTES, railActive, type RailItem } from "./rail";
import { usePavraView } from "./store";
import { usePavraApkUpdaterStore } from "./use-pavra-apk-updater";

const MAIN_AREA: Partial<Record<RailItem, "chat" | "studio">> = {
  chat: "chat",
  inbox: "chat",
  tasks: "chat",
  activity: "chat",
  saved: "chat",
  studio: "studio",
};

/**
 * Rail navigation for every page of the Pavra shell. /pavra stays at the bottom of the stack
 * so Chat and Studio keep their retained panels; hosted pages replace one another above it.
 */
export function useRailNavigation(): {
  active: RailItem | null;
  select(item: RailItem): void;
  settings(): void;
} {
  const pathname = usePathname();
  const mode = usePavraView((state) => state.mode);
  const section = usePavraView((state) => state.section);
  const onPavra = pathname === PAVRA_ROUTE;
  const select = useCallback(
    (item: RailItem) => {
      if (isPageItem(item)) {
        if (onPavra) router.push(PAGE_ROUTES[item]);
        else router.replace(PAGE_ROUTES[item]);
        return;
      }
      const view = usePavraView.getState();
      if (item !== "studio") view.setSection(item);
      // Member and Search change the sidebar list only; Chat and Studios also switch the main area.
      const nextMode = MAIN_AREA[item];
      if (!onPavra) returnToPavra(nextMode);
      else if (nextMode) view.setMode(nextMode);
    },
    [onPavra],
  );
  const settings = useCallback(() => {
    const hasUpdate = Boolean(usePavraApkUpdaterStore.getState().availableRelease);
    router.push(hasUpdate ? buildSettingsSectionRoute("about") : buildSettingsRoute());
  }, []);
  return { active: railActive(pathname, mode, section), select, settings };
}
