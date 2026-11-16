import { useCallback } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  computeMiniWindowTapDotPosition,
  formatPhoneCapsuleTitle,
  formatPhoneStepStatusLabel,
  formatVirtualDisplayBadge,
  toPhoneScreenshotUri,
  usePhoneControlStore,
  type PhoneLiveExecution,
  type PhoneOverlayMode,
} from "../phone-control";
import { cardShadow, ctrlShadow, text as type, webTransition, type Palette } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface PhoneFloatingMiniWindowProps {
  visible?: boolean;
  mode?: PhoneOverlayMode;
  execution?: PhoneLiveExecution | null;
  displayId?: number | null;
  paused?: boolean;
  onMainScreenTakeover?: boolean;
  onModeChange?: (mode: PhoneOverlayMode) => void;
  onTogglePause?: () => void;
  onToggleTakeover?: () => void;
  onEmergencyStop?: () => void;
}

const MINI_WINDOW_WIDTH = 188;
const MINI_WINDOW_HEIGHT = 360;
const VIEWPORT_WIDTH = 184;
const VIEWPORT_HEIGHT = 248;

function resolveDotColor(palette: Palette, onMainScreenTakeover: boolean, paused: boolean): string {
  if (onMainScreenTakeover) return palette.badgePink;
  if (paused) return palette.warning;
  return palette.success;
}

function PhoneCapsuleView({
  capsuleTitle,
  stepStatusLabel,
  paused,
  onMainScreenTakeover,
  onExpand,
  onEmergencyStop,
}: {
  capsuleTitle: string;
  stepStatusLabel: string;
  paused: boolean;
  onMainScreenTakeover: boolean;
  onExpand: () => void;
  onEmergencyStop: () => void;
}) {
  const { palette: t, name } = useTheme();
  const dotColor = resolveDotColor(t, onMainScreenTakeover, paused);
  return (
    <View
      testID="phone-floating-capsule"
      pointerEvents="box-none"
      style={[
        s.floatingAnchor,
        s.capsuleContainer,
        {
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
        },
        cardShadow(t),
      ]}
    >
      <Pressable
        testID="phone-capsule-expand-btn"
        role="button"
        accessibilityLabel={`Expand phone mini-window: ${capsuleTitle}. Long-press 1 second for emergency stop.`}
        delayLongPress={950}
        onPress={onExpand}
        onLongPress={onEmergencyStop}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          return [
            s.capsuleMainBtn,
            {
              backgroundColor: hovered ? t.surfaceHover : "transparent",
              ...webTransition("background-color 120ms ease"),
            },
          ];
        }}
      >
        <View
          style={[
            s.statusDot,
            {
              backgroundColor: dotColor,
              borderColor: t.retroBorder,
            },
          ]}
        />
        <View style={s.capsuleTextCol}>
          <Text numberOfLines={1} style={type(t.textPrimary, 11, { fontWeight: "800" })}>
            {capsuleTitle}
          </Text>
          <Text numberOfLines={1} style={type(t.textSecondary, 10)}>
            {stepStatusLabel}
          </Text>
        </View>
      </Pressable>

      <Pressable
        testID="phone-capsule-emergency-stop"
        role="button"
        accessibilityLabel="Emergency Stop phone control"
        onPress={onEmergencyStop}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          return [
            s.capsuleStopBtn,
            {
              borderColor: t.retroBorder,
              backgroundColor: hovered ? t.destructive : t.badgeRed,
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <Text style={type(t.textPrimary, 10, { fontWeight: "800" })}>STOP</Text>
      </Pressable>
    </View>
  );
}

function MiniWindowControlBar({
  paused,
  onMainScreenTakeover,
  onPauseToggle,
  onTakeoverToggle,
  onEmergencyStop,
}: {
  paused: boolean;
  onMainScreenTakeover: boolean;
  onPauseToggle: () => void;
  onTakeoverToggle: () => void;
  onEmergencyStop: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={[
        s.miniControlBar,
        {
          borderTopColor: t.dividerLine,
          borderColor: t.dividerLine,
          backgroundColor: t.surfaceSecondary,
        },
      ]}
    >
      <Pressable
        testID="phone-mini-window-pause"
        role="button"
        accessibilityLabel={paused ? "Resume phone task" : "Pause phone task"}
        onPress={onPauseToggle}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          const bg = paused ? t.brandAccent : hovered ? t.surfaceHover : t.surfacePrimary;
          return [
            s.miniCtrlBtn,
            {
              borderColor: t.retroBorder,
              backgroundColor: bg,
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <Text
          numberOfLines={1}
          style={type(paused ? t.onAccent : t.textPrimary, 9, { fontWeight: "800" })}
        >
          {paused ? "Resume" : "Pause"}
        </Text>
      </Pressable>

      <Pressable
        testID="phone-mini-window-takeover"
        role="button"
        accessibilityLabel={
          onMainScreenTakeover
            ? "Return app to background virtual display"
            : "Takeover app on main screen"
        }
        onPress={onTakeoverToggle}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          const bg = onMainScreenTakeover
            ? t.badgePink
            : hovered
              ? t.surfaceHover
              : t.surfacePrimary;
          return [
            s.miniCtrlBtn,
            {
              borderColor: t.retroBorder,
              backgroundColor: bg,
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <Text
          numberOfLines={1}
          style={type(onMainScreenTakeover ? t.onPink : t.textPrimary, 9, {
            fontWeight: "800",
          })}
        >
          {onMainScreenTakeover ? "Return BG" : "Takeover"}
        </Text>
      </Pressable>

      <Pressable
        testID="phone-mini-window-stop"
        role="button"
        accessibilityLabel="Emergency Stop"
        onPress={onEmergencyStop}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          return [
            s.miniCtrlBtn,
            {
              borderColor: t.retroBorder,
              backgroundColor: hovered ? t.destructive : t.badgeRed,
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <Text numberOfLines={1} style={type(t.textPrimary, 9, { fontWeight: "800" })}>
          Stop
        </Text>
      </Pressable>
    </View>
  );
}

function PhoneMiniWindowExpanded({
  execution,
  displayBadge,
  stepStatusLabel,
  screenshotUri,
  tapDot,
  paused,
  onMainScreenTakeover,
  onCollapse,
  onPauseToggle,
  onTakeoverToggle,
  onEmergencyStop,
}: {
  execution: PhoneLiveExecution;
  displayBadge: string;
  stepStatusLabel: string;
  screenshotUri: string | null;
  tapDot: { x: number; y: number } | null;
  paused: boolean;
  onMainScreenTakeover: boolean;
  onCollapse: () => void;
  onPauseToggle: () => void;
  onTakeoverToggle: () => void;
  onEmergencyStop: () => void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      testID="phone-floating-mini-window"
      pointerEvents="auto"
      style={[
        s.floatingAnchor,
        s.miniWindowContainer,
        {
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
        },
        cardShadow(t),
      ]}
    >
      <View
        style={[
          s.miniHeader,
          {
            borderBottomColor: t.dividerLine,
            borderColor: t.dividerLine,
            backgroundColor: t.brandAccent,
          },
        ]}
      >
        <View style={s.miniHeaderTitleCol}>
          <Text numberOfLines={1} style={type(t.onAccent, 11, { fontWeight: "800" })}>
            {execution.appName || "Android"}
          </Text>
          <View
            style={[
              s.displayBadge,
              {
                borderColor: t.retroBorder,
                backgroundColor: t.surfacePrimary,
              },
            ]}
          >
            <Text style={type(t.textPrimary, 9, { fontWeight: "700" })}>
              {onMainScreenTakeover ? "Main Screen #0" : displayBadge}
            </Text>
          </View>
        </View>
        <Pressable
          testID="phone-mini-window-collapse"
          role="button"
          accessibilityLabel="Collapse to edge capsule"
          onPress={onCollapse}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.collapseBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.surfaceHover : t.surfacePrimary,
              },
            ];
          }}
        >
          <Text style={type(t.textPrimary, 10, { fontWeight: "800" })}>—</Text>
        </Pressable>
      </View>

      <View
        testID="phone-mini-window-screen"
        style={[
          s.screenViewport,
          {
            backgroundColor: t.codeBackground,
            borderColor: t.retroBorder,
          },
        ]}
      >
        {screenshotUri ? (
          <Image source={{ uri: screenshotUri }} style={s.screenImage} resizeMode="cover" />
        ) : null}

        <View pointerEvents="none" style={s.screenHudOverlay}>
          <View
            style={[
              s.hudTopPill,
              {
                borderColor: t.retroBorder,
                backgroundColor: "rgba(15, 14, 13, 0.84)",
              },
            ]}
          >
            <Text numberOfLines={1} style={type("#f2ecdb", 9, { fontWeight: "700" })}>
              {`🤖 ${execution.assistantName} · ${execution.packageName}`}
            </Text>
          </View>

          <View
            style={[
              s.hudBottomCard,
              {
                borderColor: t.retroBorder,
                backgroundColor: "rgba(15, 14, 13, 0.88)",
              },
            ]}
          >
            <Text numberOfLines={2} style={type("#f2ecdb", 10, { fontWeight: "700" })}>
              {stepStatusLabel}
            </Text>
          </View>
        </View>

        {tapDot ? (
          <View
            testID="phone-mini-window-tap-dot"
            pointerEvents="none"
            style={[
              s.tapDotOuter,
              {
                left: tapDot.x - 9,
                top: tapDot.y - 9,
              },
            ]}
          >
            <View style={s.tapDotInner} />
          </View>
        ) : null}
      </View>

      <MiniWindowControlBar
        paused={paused}
        onMainScreenTakeover={onMainScreenTakeover}
        onPauseToggle={onPauseToggle}
        onTakeoverToggle={onTakeoverToggle}
        onEmergencyStop={onEmergencyStop}
      />
    </View>
  );
}

export function PhoneFloatingMiniWindow(props: PhoneFloatingMiniWindowProps = {}) {
  const {
    visible: visibleProp,
    mode: modeProp,
    execution: executionProp,
    displayId: displayIdProp,
    paused: pausedProp,
    onMainScreenTakeover: takeoverProp,
    onModeChange,
    onTogglePause,
    onToggleTakeover,
    onEmergencyStop,
  } = props;

  const storeVisible = usePhoneControlStore((state) => state.overlayVisible);
  const storeMode = usePhoneControlStore((state) => state.overlayMode);
  const storeExecution = usePhoneControlStore((state) => state.liveExecution);
  const storeDisplayId = usePhoneControlStore((state) => state.privilegeStatus.virtualDisplayId);
  const storePaused = usePhoneControlStore((state) => state.paused);
  const storeTakeover = usePhoneControlStore((state) => state.onMainScreenTakeover);
  const setOverlayMode = usePhoneControlStore((state) => state.setOverlayMode);
  const togglePaused = usePhoneControlStore((state) => state.togglePaused);
  const toggleMainScreenTakeover = usePhoneControlStore((state) => state.toggleMainScreenTakeover);
  const triggerEmergencyStop = usePhoneControlStore((state) => state.triggerEmergencyStop);

  const visible = visibleProp ?? storeVisible;
  const mode = modeProp ?? storeMode;
  const execution = executionProp !== undefined ? executionProp : storeExecution;
  const displayId = displayIdProp !== undefined ? displayIdProp : storeDisplayId;
  const paused = pausedProp ?? storePaused;
  const onMainScreenTakeover = takeoverProp ?? storeTakeover;

  const handleExpand = useCallback(() => {
    setOverlayMode("mini_window");
    onModeChange?.("mini_window");
  }, [onModeChange, setOverlayMode]);

  const handleCollapse = useCallback(() => {
    setOverlayMode("capsule");
    onModeChange?.("capsule");
  }, [onModeChange, setOverlayMode]);

  const handlePauseToggle = useCallback(() => {
    togglePaused();
    onTogglePause?.();
  }, [onTogglePause, togglePaused]);

  const handleTakeoverToggle = useCallback(() => {
    toggleMainScreenTakeover();
    onToggleTakeover?.();
  }, [onToggleTakeover, toggleMainScreenTakeover]);

  const handleEmergencyStop = useCallback(() => {
    triggerEmergencyStop();
    onEmergencyStop?.();
  }, [onEmergencyStop, triggerEmergencyStop]);

  if (!visible || !execution || !execution.active) {
    return null;
  }

  const capsuleTitle = formatPhoneCapsuleTitle(execution);
  const stepStatusLabel = formatPhoneStepStatusLabel(execution, {
    paused,
    onMainScreenTakeover,
  });
  const displayBadge = formatVirtualDisplayBadge(displayId);
  const screenshotUri = toPhoneScreenshotUri(execution.screenshotBase64);
  const tapDot = computeMiniWindowTapDotPosition({
    lastTapX: execution.lastTapX,
    lastTapY: execution.lastTapY,
    screenWidth: execution.screenWidth || 1080,
    screenHeight: execution.screenHeight || 2400,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
  });

  if (mode === "capsule") {
    return (
      <PhoneCapsuleView
        capsuleTitle={capsuleTitle}
        stepStatusLabel={stepStatusLabel}
        paused={paused}
        onMainScreenTakeover={onMainScreenTakeover}
        onExpand={handleExpand}
        onEmergencyStop={handleEmergencyStop}
      />
    );
  }

  return (
    <PhoneMiniWindowExpanded
      execution={execution}
      displayBadge={displayBadge}
      stepStatusLabel={stepStatusLabel}
      screenshotUri={screenshotUri}
      tapDot={tapDot}
      paused={paused}
      onMainScreenTakeover={onMainScreenTakeover}
      onCollapse={handleCollapse}
      onPauseToggle={handlePauseToggle}
      onTakeoverToggle={handleTakeoverToggle}
      onEmergencyStop={handleEmergencyStop}
    />
  );
}

const s = StyleSheet.create({
  floatingAnchor: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 90,
    elevation: 90,
  },
  capsuleContainer: {
    maxWidth: 320,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  capsuleMainBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  capsuleTextCol: {
    flex: 1,
    minWidth: 110,
    gap: 1,
  },
  capsuleStopBtn: {
    minHeight: 28,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  miniWindowContainer: {
    width: MINI_WINDOW_WIDTH,
    height: MINI_WINDOW_HEIGHT,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    flexDirection: "column",
  },
  miniHeader: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  miniHeaderTitleCol: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  displayBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  collapseBtn: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  screenViewport: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  screenImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
  },
  screenHudOverlay: {
    flex: 1,
    justifyContent: "space-between",
    padding: 8,
  },
  hudTopPill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  hudBottomCard: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  tapDotOuter: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "rgba(239, 68, 68, 0.35)",
    borderWidth: 1,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  tapDotInner: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#ef4444",
  },
  miniControlBar: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  miniCtrlBtn: {
    flex: 1,
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
