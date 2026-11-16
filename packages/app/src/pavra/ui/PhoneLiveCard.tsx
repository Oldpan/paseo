import { useCallback } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Takeover } from "../../../../../extensions/pavra/shared/contracts";
import {
  DEMO_PHONE_SCREENSHOT_BASE64,
  formatPhoneStepStatusLabel,
  formatVirtualDisplayBadge,
  toPhoneScreenshotUri,
  usePhoneControlStore,
  type PhoneExecutionHistoryEntry,
  type PhoneLiveExecution,
} from "../phone-control";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface PhoneLiveCardProps {
  execution?: PhoneLiveExecution | null;
  takeover?: Takeover | null;
  assistantName?: string;
  conversationName?: string;
  displayId?: number | null;
  busy?: boolean;
  testID?: string;
  onOpenMiniWindow?: () => void;
  onTakeover?: (takeover?: Takeover | null) => void;
  onResolveTakeover?: (takeoverId: string) => void;
  onCancelTakeover?: (takeoverId: string) => void;
  onOpenSettings?: () => void;
}

function resolveRecentSteps(
  execution: PhoneLiveExecution | null | undefined,
  takeover: Takeover | null,
  resolvedAppName: string,
  displayBadge: string,
): PhoneExecutionHistoryEntry[] {
  if (execution?.history && execution.history.length > 0) {
    return execution.history.slice(-3);
  }
  return [
    {
      step: 1,
      label:
        takeover?.reason ??
        execution?.stepText ??
        `Operating ${resolvedAppName} on ${displayBadge}`,
      timestamp: takeover?.createdAt ?? 1,
    },
  ];
}

function PhoneLiveCardBadges({
  takeover,
  resolvedAssistantName,
  resolvedAppName,
  conversationName,
  onMainScreenTakeover,
  displayBadge,
}: {
  takeover: Takeover | null;
  resolvedAssistantName: string;
  resolvedAppName: string;
  conversationName?: string;
  onMainScreenTakeover: boolean;
  displayBadge: string;
}) {
  const { palette: t } = useTheme();
  const contextText = conversationName
    ? `🤖 ${resolvedAssistantName} · ${conversationName}`
    : `🤖 ${resolvedAssistantName} · ${resolvedAppName}`;
  return (
    <View style={s.topBadgeRow}>
      <View
        style={[
          s.badge,
          {
            borderColor: t.retroBorder,
            backgroundColor: takeover ? t.badgePink : t.brandAccent,
          },
        ]}
      >
        <Text style={type(takeover ? t.onPink : t.onAccent, 10, { fontWeight: "800" })}>
          {takeover ? "Phone Takeover Needed" : "Live Phone Session"}
        </Text>
      </View>

      <View
        style={[
          s.badge,
          {
            borderColor: t.retroBorder,
            backgroundColor: t.badgeBlue,
          },
        ]}
      >
        <Text style={type(t.textPrimary, 10, { fontWeight: "700" })}>{contextText}</Text>
      </View>

      <View
        style={[
          s.badge,
          {
            borderColor: t.retroBorder,
            backgroundColor: onMainScreenTakeover ? t.badgePink : t.surfacePrimary,
          },
        ]}
      >
        <Text
          style={type(onMainScreenTakeover ? t.onPink : t.textPrimary, 10, {
            fontWeight: "700",
          })}
        >
          {onMainScreenTakeover ? "Main Screen #0" : displayBadge}
        </Text>
      </View>
    </View>
  );
}

function PhoneLiveCardActions({
  busy,
  onMainScreenTakeover,
  takeover,
  onOpenMiniWindow,
  onTakeoverPress,
  onResolveTakeover,
  onCancelTakeover,
  onOpenSettings,
}: {
  busy: boolean;
  onMainScreenTakeover: boolean;
  takeover: Takeover | null;
  onOpenMiniWindow: () => void;
  onTakeoverPress: () => void;
  onResolveTakeover?: (takeoverId: string) => void;
  onCancelTakeover?: (takeoverId: string) => void;
  onOpenSettings?: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View style={s.actionsRow}>
      <Pressable
        testID="phone-live-card-open-mini"
        role="button"
        accessibilityLabel="Open Floating Mini-Window"
        disabled={busy}
        onPress={onOpenMiniWindow}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          return [
            s.actionBtn,
            {
              borderColor: t.retroBorder,
              backgroundColor: hovered ? t.brandAccentHover : t.brandAccent,
              opacity: busy ? 0.5 : 1,
              ...webTransition("background-color 120ms ease"),
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <Text style={type(t.onAccent, 11, { fontWeight: "800" })}>Open Floating Mini-Window</Text>
      </Pressable>

      <Pressable
        testID="phone-live-card-takeover"
        role="button"
        accessibilityLabel={
          onMainScreenTakeover ? "Return App to Background Display" : "Take Over on Main Screen"
        }
        disabled={busy}
        onPress={onTakeoverPress}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          const bg = onMainScreenTakeover
            ? t.badgePink
            : hovered
              ? t.surfaceHover
              : t.surfacePrimary;
          return [
            s.actionBtn,
            {
              borderColor: t.retroBorder,
              backgroundColor: bg,
              opacity: busy ? 0.5 : 1,
              ...webTransition("background-color 120ms ease"),
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <Text
          style={type(onMainScreenTakeover ? t.onPink : t.textPrimary, 11, {
            fontWeight: "700",
          })}
        >
          {onMainScreenTakeover
            ? "Return to Background Display · 放回后台屏"
            : "Take Over on Main Screen · 切到主屏处理"}
        </Text>
      </Pressable>

      {takeover && onResolveTakeover ? (
        <Pressable
          testID="phone-live-card-resolve"
          role="button"
          accessibilityLabel="Done, continue"
          disabled={busy}
          onPress={() => onResolveTakeover(takeover.id)}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.actionBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.surfaceHover : t.badgeGreen,
                opacity: busy ? 0.5 : 1,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text style={type(t.textPrimary, 11, { fontWeight: "800" })}>
            Done, continue · 处理完成，继续
          </Text>
        </Pressable>
      ) : null}

      {takeover && onCancelTakeover ? (
        <Pressable
          testID="phone-live-card-cancel"
          role="button"
          accessibilityLabel="Cancel takeover"
          disabled={busy}
          onPress={() => onCancelTakeover(takeover.id)}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.actionBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.surfaceHover : t.surfacePrimary,
                opacity: busy ? 0.5 : 1,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Cancel · 取消</Text>
        </Pressable>
      ) : null}

      {onOpenSettings ? (
        <Pressable
          testID="phone-live-card-settings"
          role="button"
          accessibilityLabel="Phone Control Settings"
          disabled={busy}
          onPress={onOpenSettings}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.actionBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.surfaceHover : t.surfacePrimary,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Phone Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function resolveCardLabels(input: {
  execution: PhoneLiveExecution | null | undefined;
  takeover: Takeover | null;
  assistantNameProp?: string;
  displayIdProp?: number | null;
  storeDisplayId: number | null;
  paused: boolean;
  onMainScreenTakeover: boolean;
}) {
  const {
    execution,
    takeover,
    assistantNameProp,
    displayIdProp,
    storeDisplayId,
    paused,
    onMainScreenTakeover,
  } = input;
  const resolvedAssistantName = assistantNameProp || execution?.assistantName || "Assistant";
  const resolvedAppName = execution?.appName || takeover?.title || "Android App";
  const resolvedPackageName = execution?.packageName || takeover?.url || "com.tencent.mm";
  const displayBadge = formatVirtualDisplayBadge(
    displayIdProp !== undefined ? displayIdProp : storeDisplayId,
  );
  const screenshotUri = toPhoneScreenshotUri(
    execution?.screenshotBase64 ?? takeover?.screenshotDataUrl ?? DEMO_PHONE_SCREENSHOT_BASE64,
  );
  const statusHeadline = takeover
    ? `Takeover requested · ${takeover.reason}`
    : formatPhoneStepStatusLabel(execution, { paused, onMainScreenTakeover });
  return {
    resolvedAssistantName,
    resolvedAppName,
    resolvedPackageName,
    displayBadge,
    screenshotUri,
    statusHeadline,
  };
}

export function PhoneLiveCard({
  execution: executionProp,
  takeover = null,
  assistantName: assistantNameProp,
  conversationName,
  displayId: displayIdProp,
  busy = false,
  testID = "phone-live-card",
  onOpenMiniWindow,
  onTakeover,
  onResolveTakeover,
  onCancelTakeover,
  onOpenSettings,
}: PhoneLiveCardProps) {
  const { palette: t } = useTheme();

  const storeExecution = usePhoneControlStore((state) => state.liveExecution);
  const storeDisplayId = usePhoneControlStore((state) => state.privilegeStatus.virtualDisplayId);
  const paused = usePhoneControlStore((state) => state.paused);
  const onMainScreenTakeover = usePhoneControlStore((state) => state.onMainScreenTakeover);
  const setOverlayMode = usePhoneControlStore((state) => state.setOverlayMode);
  const launchDemoBackgroundTask = usePhoneControlStore((state) => state.launchDemoBackgroundTask);
  const toggleMainScreenTakeover = usePhoneControlStore((state) => state.toggleMainScreenTakeover);

  const execution = executionProp !== undefined ? executionProp : storeExecution;
  const {
    resolvedAssistantName,
    resolvedAppName,
    resolvedPackageName,
    displayBadge,
    screenshotUri,
    statusHeadline,
  } = resolveCardLabels({
    execution,
    takeover,
    assistantNameProp,
    displayIdProp,
    storeDisplayId,
    paused,
    onMainScreenTakeover,
  });

  const handleOpenMiniWindow = useCallback(() => {
    const current = usePhoneControlStore.getState().liveExecution;
    if (!current || !current.active) {
      launchDemoBackgroundTask({
        assistantName: resolvedAssistantName,
        appName: resolvedAppName,
        packageName: resolvedPackageName,
        mode: "mini_window",
      });
    } else {
      setOverlayMode("mini_window");
    }
    onOpenMiniWindow?.();
  }, [
    launchDemoBackgroundTask,
    onOpenMiniWindow,
    resolvedAppName,
    resolvedAssistantName,
    resolvedPackageName,
    setOverlayMode,
  ]);

  const handleTakeoverPress = useCallback(() => {
    toggleMainScreenTakeover();
    onTakeover?.(takeover);
  }, [onTakeover, takeover, toggleMainScreenTakeover]);

  const recentSteps = resolveRecentSteps(execution, takeover, resolvedAppName, displayBadge);

  return (
    <View
      testID={testID}
      style={[
        s.card,
        {
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
        },
      ]}
    >
      <PhoneLiveCardBadges
        takeover={takeover}
        resolvedAssistantName={resolvedAssistantName}
        resolvedAppName={resolvedAppName}
        conversationName={conversationName}
        onMainScreenTakeover={onMainScreenTakeover}
        displayBadge={displayBadge}
      />

      <View style={s.contentRow}>
        {screenshotUri ? (
          <View
            style={[
              s.thumbFrame,
              {
                borderColor: t.retroBorder,
                backgroundColor: t.codeBackground,
              },
            ]}
          >
            <Image
              testID="phone-live-card-thumb"
              source={{ uri: screenshotUri }}
              style={s.thumbImage}
              resizeMode="cover"
            />
            <View
              style={[
                s.thumbCornerTag,
                {
                  borderColor: t.retroBorder,
                  backgroundColor: "rgba(15, 14, 13, 0.85)",
                },
              ]}
            >
              <Text style={type("#f2ecdb", 8, { fontWeight: "700" })}>{resolvedAppName}</Text>
            </View>
          </View>
        ) : null}

        <View style={s.detailsCol}>
          <Text style={type(t.textPrimary, 13, { fontWeight: "800" })}>
            {`${resolvedAppName} (${resolvedPackageName})`}
          </Text>
          <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>{statusHeadline}</Text>

          <View
            style={[
              s.stepsBox,
              {
                borderColor: t.retroBorderLight,
                backgroundColor: t.surfaceSecondary,
              },
            ]}
          >
            {recentSteps.map((entry) => (
              <Text
                key={`${entry.step}:${entry.timestamp}`}
                numberOfLines={1}
                style={type(t.textMuted, 10)}
              >
                {`#${entry.step} · ${entry.label}`}
              </Text>
            ))}
          </View>
        </View>
      </View>

      <PhoneLiveCardActions
        busy={busy}
        onMainScreenTakeover={onMainScreenTakeover}
        takeover={takeover}
        onOpenMiniWindow={handleOpenMiniWindow}
        onTakeoverPress={handleTakeoverPress}
        onResolveTakeover={onResolveTakeover}
        onCancelTakeover={onCancelTakeover}
        onOpenSettings={onOpenSettings}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    gap: 10,
  },
  topBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  contentRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch",
  },
  thumbFrame: {
    width: 68,
    height: 124,
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: "hidden",
    position: "relative",
    flexShrink: 0,
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbCornerTag: {
    position: "absolute",
    bottom: 4,
    left: 4,
    right: 4,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: "center",
  },
  detailsCol: {
    flex: 1,
    minWidth: 160,
    gap: 4,
    justifyContent: "space-between",
  },
  stepsBox: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 3,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    alignItems: "center",
  },
  actionBtn: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
