// The Bigbang shell around a Paseo page (History, Schedules, a new workspace). The page keeps its
// own content; Bigbang's rail replaces Paseo's left sidebar, and a phone opens the rail as a drawer.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { SidebarMenuHostContext } from "@/components/headers/sidebar-menu-host";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useIsCompactFormFactor } from "@/constants/layout";
import { UsageSidebarRoot, useOpenSidebarUsage } from "@/usage/sidebar-item";
import { IS_BIGBANG } from "./build";
import type { RailItem } from "./rail";
import { useRailNavigation } from "./use-rail";
import { Rail } from "./ui/Rail";
import { BigbangTheme, useBigbangDark, useTheme } from "./ui/ThemeProvider";

const ROW = { flex: 1, minHeight: 0, flexDirection: "row" } as const;
const FILL = { flex: 1, minWidth: 0, minHeight: 0 } as const;
const OVERLAY = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 100,
  flexDirection: "row",
} as const;
const BACKDROP = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0.45)",
} as const;

/** Hosts a Paseo page in the Bigbang shell in the Bigbang build, and leaves it alone otherwise. */
export function BigbangPage({ children }: { children: ReactNode }) {
  if (!IS_BIGBANG) return children;
  return <BigbangPageFrame>{children}</BigbangPageFrame>;
}

function BigbangPageFrame({ children }: { children: ReactNode }) {
  const dark = useBigbangDark();
  return (
    <BigbangTheme name={dark ? "dark" : "light"}>
      <UsageSidebarRoot>
        <PageShell>{children}</PageShell>
      </UsageSidebarRoot>
    </BigbangTheme>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  const compact = useIsCompactFormFactor();
  const { palette: t } = useTheme();
  const [drawer, setDrawer] = useState(false);
  const host = useMemo(() => ({ onMenu: () => setDrawer(true) }), []);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const frame = useMemo(() => [ROW, { backgroundColor: t.surfacePrimary }], [t.surfacePrimary]);
  return (
    <SidebarMenuHostContext.Provider value={host}>
      <View style={frame} testID="bigbang-page">
        {!compact ? <PageRail onDone={closeDrawer} /> : null}
        <View style={FILL}>{children}</View>
        {compact && drawer ? (
          <View style={OVERLAY}>
            <PressHighlight
              accessibilityLabel="Close navigation"
              onPress={closeDrawer}
              style={BACKDROP}
            />
            <PageRail onDone={closeDrawer} />
          </View>
        ) : null}
      </View>
    </SidebarMenuHostContext.Provider>
  );
}

function PageRail({ onDone }: { onDone(): void }) {
  const { active, select: go, settings: openSettings } = useRailNavigation();
  const openUsage = useOpenSidebarUsage();
  const select = useCallback(
    (item: RailItem) => {
      onDone();
      go(item);
    },
    [go, onDone],
  );
  const usage = useCallback(() => {
    onDone();
    openUsage();
  }, [onDone, openUsage]);
  const settings = useCallback(() => {
    onDone();
    openSettings();
  }, [onDone, openSettings]);
  return <Rail active={active} onSelect={select} onUsage={usage} onSettings={settings} />;
}
