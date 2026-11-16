import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChatIcon } from "./icons";
import { bubbleShadow, ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface LongMessageCollapseResult {
  collapsible: boolean;
  lineCount: number;
  charCount: number;
  previewContent: string;
}

export function shouldCollapseLongMessage(
  content: string,
  thresholdChars = 1200,
  thresholdLines = 22,
): LongMessageCollapseResult {
  const safeThresholdChars = Math.max(1, thresholdChars);
  const safeThresholdLines = Math.max(1, thresholdLines);
  const charCount = content.length;
  const lines = content.length === 0 ? [] : content.split("\n");
  const lineCount = lines.length;
  const collapsible = charCount > safeThresholdChars || lineCount > safeThresholdLines;

  if (!collapsible) {
    return {
      collapsible: false,
      lineCount,
      charCount,
      previewContent: content,
    };
  }

  let preview = lines.slice(0, safeThresholdLines).join("\n");
  if (preview.length > safeThresholdChars) {
    preview = preview.slice(0, safeThresholdChars);
  }
  const previewContent = `${preview.trimEnd()}…`;

  return {
    collapsible: true,
    lineCount,
    charCount,
    previewContent,
  };
}

export interface PavraEmptyStateAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

export interface PavraEmptyStateProps {
  testID?: string;
  icon?: ReactNode;
  eyebrow?: string;
  title?: string;
  description?: string;
  subtitle?: string;
  primaryAction?: PavraEmptyStateAction;
  secondaryAction?: PavraEmptyStateAction;
  compact?: boolean;
}

function ActionChip({
  action,
  accent = false,
}: {
  action: PavraEmptyStateAction;
  accent?: boolean;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID={action.testID}
      role="button"
      accessibilityLabel={action.label}
      disabled={action.disabled}
      onPress={action.onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            minHeight: 28,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: accent
              ? hovered && !action.disabled
                ? t.brandAccentHover
                : t.brandAccent
              : hovered && !action.disabled
                ? t.surfaceHover
                : t.surfaceElevated,
            paddingHorizontal: 12,
            justifyContent: "center",
            opacity: action.disabled ? 0.45 : 1,
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <Text style={type(accent ? t.onAccent : t.textSecondary, 11, { fontWeight: "700" })}>
        {action.label}
      </Text>
    </Pressable>
  );
}

export function PavraEmptyState({
  testID = "pavra-empty-state",
  icon,
  eyebrow = "Ready",
  title = "No messages yet",
  description,
  subtitle,
  primaryAction,
  secondaryAction,
  compact = false,
}: PavraEmptyStateProps) {
  const { palette: t, name } = useTheme();
  const bodyText =
    description ?? subtitle ?? "Send a message or @mention an assistant to start collaborating.";

  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: compact ? 16 : 24,
      }}
    >
      <View
        style={[
          {
            width: "100%",
            maxWidth: 420,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
            padding: compact ? 16 : 22,
            alignItems: "center",
            gap: 10,
          },
          bubbleShadow(t, name),
        ]}
      >
        <View
          testID={`${testID}-icon`}
          style={[
            {
              width: 40,
              height: 40,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.brandAccentSoft,
              alignItems: "center",
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          {icon ?? <ChatIcon color={t.textPrimary} size={18} />}
        </View>
        {eyebrow ? (
          <Text
            style={type(t.textMuted, 10, {
              fontWeight: "800",
              letterSpacing: 1.2,
              textTransform: "uppercase",
              textAlign: "center",
            })}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text style={type(t.textPrimary, 17, { fontWeight: "700", textAlign: "center" })}>
          {title}
        </Text>
        {bodyText ? (
          <Text style={type(t.textSecondary, 13, { textAlign: "center", lineHeight: 19 })}>
            {bodyText}
          </Text>
        ) : null}
        {primaryAction || secondaryAction ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            {primaryAction ? <ActionChip action={primaryAction} accent /> : null}
            {secondaryAction ? <ActionChip action={secondaryAction} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export interface PavraSkeletonListProps {
  rows?: number;
  count?: number;
  compact?: boolean;
  testID?: string;
}

export function PavraSkeletonList({
  rows,
  count,
  compact = false,
  testID = "pavra-skeleton-list",
}: PavraSkeletonListProps) {
  const { palette: t } = useTheme();
  const rowCount = Math.max(1, rows ?? count ?? 3);
  const indices = Array.from({ length: rowCount }, (_, index) => index);

  return (
    <View
      testID={testID}
      accessibilityLabel="Loading content"
      style={{
        gap: compact ? 8 : 10,
        paddingVertical: compact ? 6 : 10,
      }}
    >
      {indices.map((index) => (
        <View
          key={index}
          testID={`${testID}-row-${index}`}
          style={{
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            borderRadius: 12,
            backgroundColor: t.surfaceSecondary,
            padding: compact ? 10 : 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              width: compact ? 26 : 32,
              height: compact ? 26 : 32,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorderLight,
              backgroundColor: t.surfaceElevated,
            }}
          />
          <View style={{ flex: 1, gap: 6 }}>
            <View
              style={{
                height: 11,
                width: index % 2 === 0 ? "52%" : "68%",
                borderRadius: 6,
                backgroundColor: t.surfaceElevated,
              }}
            />
            <View
              style={{
                height: 9,
                width: index % 2 === 0 ? "84%" : "72%",
                borderRadius: 6,
                backgroundColor: t.surfaceTertiary,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
