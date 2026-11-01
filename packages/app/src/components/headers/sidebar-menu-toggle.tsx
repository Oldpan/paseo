import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PanelLeft } from "lucide-react-native";
import { HeaderToggleButton, headerIconSlotStyle } from "./header-toggle-button";
import { type SidebarMenuHost, useSidebarMenuHost } from "./sidebar-menu-host";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useHasWindowChromeObstruction, useOwnsWindowChromeCorner } from "@/utils/desktop-window";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";

const ThemedPanelLeft = withUnistyles(PanelLeft);

interface SidebarMenuToggleProps {
  style?: StyleProp<ViewStyle>;
  tooltipSide?: "left" | "right" | "top" | "bottom";
  testID?: string;
  nativeID?: string;
}

const MOBILE_MENU_LINE_WIDTH = 16;
const MOBILE_MENU_LINE_SHORT_WIDTH = 8;
const MOBILE_MENU_LINE_HEIGHT = 1.5;

function MobileMenuIcon({ extraMuted }: { extraMuted: boolean }) {
  const color = extraMuted ? styles.mobileMenuLineExtraMuted : styles.mobileMenuLineMuted;
  const lineStyle = useMemo(() => [styles.mobileMenuLine, color], [color]);
  const shortLineStyle = useMemo(
    () => [styles.mobileMenuLine, styles.mobileMenuLineShort, color],
    [color],
  );
  return (
    <View style={styles.mobileMenuIcon} pointerEvents="none">
      <View style={lineStyle} />
      <View style={lineStyle} />
      <View style={shortLineStyle} />
    </View>
  );
}

function SidebarMenuToggleButton({
  isMobile,
  extraMutedIdleIcon = false,
  resolvedStyle,
  tooltipSide = "right",
  testID = "menu-button",
  nativeID = "menu-button",
}: Omit<SidebarMenuToggleProps, "style"> & {
  isMobile: boolean;
  extraMutedIdleIcon?: boolean;
  resolvedStyle: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact: isMobile }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggleShortcutKeys = useMemo(
    () => (getShortcutOs() === "mac" ? ["mod", "B"] : ["mod", "."]),
    [],
  );

  const handlePress = useCallback(() => {
    toggleAgentListForLayout({ isCompact: isMobile });
  }, [toggleAgentListForLayout, isMobile]);

  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);

  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel={t("shell.menu.toggleSidebar")}
      tooltipKeys={toggleShortcutKeys}
      tooltipSide={tooltipSide}
      testID={testID}
      nativeID={nativeID}
      style={resolvedStyle}
      accessible
      accessibilityRole="button"
      accessibilityLabel={isOpen ? t("shell.menu.close") : t("shell.menu.open")}
      accessibilityState={accessibilityState}
    >
      {isMobile ? (
        <MobileMenuIcon extraMuted={extraMutedIdleIcon} />
      ) : (
        <ThemedPanelLeft
          size={iconButtonChromeGlyphSize("large")}
          strokeWidth={1.5}
          uniProps={extraMutedIdleIcon ? extraMutedIconColorMapping : mutedIconColorMapping}
        />
      )}
    </HeaderToggleButton>
  );
}

const NO_SHORTCUT: ShortcutKey[] = [];

function HostMenuButton({
  host,
  resolvedStyle,
  testID = "menu-button",
}: {
  host: SidebarMenuHost;
  resolvedStyle: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <HeaderToggleButton
      onPress={host.onMenu}
      tooltipLabel={t("shell.menu.open")}
      tooltipKeys={NO_SHORTCUT}
      tooltipSide="right"
      testID={testID}
      style={resolvedStyle}
      accessible
      accessibilityRole="button"
      accessibilityLabel={t("shell.menu.open")}
    >
      <MobileMenuIcon extraMuted={false} />
    </HeaderToggleButton>
  );
}

export function SidebarMenuToggle({ style, ...props }: SidebarMenuToggleProps = {}) {
  const isMobile = useIsCompactFormFactor();
  const host = useSidebarMenuHost();
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const hasTopLeftWindowControls = useHasWindowChromeObstruction("top-left");
  const resolvedStyle = useMemo(() => [styles.leadingToggle, style], [style]);
  const placeholderStyle = useMemo(
    () => [headerIconSlotStyle.slot, resolvedStyle],
    [resolvedStyle],
  );

  if (host) {
    return isMobile ? (
      <HostMenuButton host={host} resolvedStyle={resolvedStyle} testID={props.testID} />
    ) : null;
  }

  if (!isMobile && !ownsTopLeft) {
    return null;
  }

  if (!isMobile && hasTopLeftWindowControls) {
    return (
      <View pointerEvents="none" style={placeholderStyle}>
        <View style={styles.desktopMenuIconSpace} />
      </View>
    );
  }

  return <SidebarMenuToggleButton {...props} isMobile={isMobile} resolvedStyle={resolvedStyle} />;
}

export function WindowSidebarMenuToggle({ style, ...props }: SidebarMenuToggleProps = {}) {
  const resolvedStyle = useMemo(() => [styles.leadingToggle, style], [style]);
  return (
    <SidebarMenuToggleButton
      {...props}
      isMobile={false}
      extraMutedIdleIcon
      resolvedStyle={resolvedStyle}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  leadingToggle: {
    marginLeft: {
      xs: 0,
      md: -theme.spacing[2],
    },
  },
  mobileMenuIcon: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  desktopMenuIconSpace: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
  },
  mobileMenuLine: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: MOBILE_MENU_LINE_HEIGHT,
    borderRadius: theme.borderRadius.full,
  },
  mobileMenuLineMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  mobileMenuLineExtraMuted: {
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  mobileMenuLineShort: {
    width: MOBILE_MENU_LINE_SHORT_WIDTH,
  },
}));
