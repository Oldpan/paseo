import { isWeb } from "@/constants/platform";
// Migrated from Bigbang apps/app/src/Workspace.tsx. Keep presentation changes reviewable against that source.
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { HashIcon, ChevronIcon, PlusIcon, PanelLeftOpenIcon, PanelLeftCloseIcon } from "./icons";
import { ctrlShadow, text as type, webTransition, type Palette, type ThemeName } from "./theme";
import { useTheme } from "./ThemeProvider";
interface ChannelInfo {
  name: string;
}

export function RailNavButton({
  label,
  active,
  onPress,
  icon,
  badge,
  t,
  name,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: ReactNode;
  badge?: number;
  t: Palette;
  name: ThemeName;
}) {
  const [hover, setHover] = useState(false);
  const unread = (badge ?? 0) > 0;
  return (
    <Pressable
      role="button"
      accessibilityLabel={unread ? `${label} (${badge} unread)` : label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      {...(isWeb
        ? {
            dataSet: {
              selectedFill: active && !unread && name === "dark" ? "accent" : "idle",
              railUnread: unread ? "true" : "false",
            },
          }
        : null)}
      style={[
        {
          width: 34,
          height: 34,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: unread ? t.retroBorder : "transparent",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: unread
            ? t.badgePink
            : active
              ? name === "dark"
                ? t.brandAccent
                : t.sidebarSelected
              : hover
                ? t.sidebarSelected
                : "transparent",
          ...(isWeb ? { transition: "background-color 700ms cubic-bezier(0.4, 0, 0.2, 1)" } : null),
        },
        unread ? ctrlShadow(t, name) : null,
      ]}
    >
      {icon}
      {unread ? (
        <View
          testID="rail-unread-dot"
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            width: 10,
            height: 10,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.badgePink,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function SidebarPanelToggle({
  mode,
  onPress,
  t,
  name,
}: {
  mode: "expand" | "collapse";
  onPress: () => void;
  t: Palette;
  name: ThemeName;
}) {
  const [hovered, setHovered] = useState(false);
  const expand = mode === "expand";
  const hoverFill = expand
    ? t.sidebarSelected
    : name === "dark"
      ? "rgba(255,255,255,0.1)"
      : "rgba(0,0,0,0.1)";
  const size = expand ? 32 : 28;
  return (
    <Pressable
      role="button"
      accessibilityLabel={expand ? "Expand sidebar" : "Collapse sidebar"}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...(isWeb ? { dataSet: { sidebarPanelToggle: expand ? "expand" : "collapse" } } : null)}
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hovered ? hoverFill : "transparent",
        ...webTransition(
          "background-color 150ms cubic-bezier(0.4, 0, 0.2, 1), color 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        ),
      }}
    >
      {expand ? (
        <PanelLeftOpenIcon color={hovered ? t.textPrimary : t.textSecondary} size={20} />
      ) : (
        <PanelLeftCloseIcon color={hovered ? t.textPrimary : t.textSecondary} size={14} />
      )}
    </Pressable>
  );
}

export function SidebarChannelRow({
  channel,
  selected,
  unreadCount,
  compact,
  onOpen,
}: {
  channel: ChannelInfo;
  selected: boolean;
  unreadCount: number;
  compact: boolean;
  onOpen: () => void;
}) {
  const { palette: t, name } = useTheme();
  const [hovered, setHovered] = useState(false);
  const dark = name === "dark";
  const raised = selected || hovered;
  const gap = compact ? 6 : 12;
  const pad = compact ? 6 : 8;
  const fontSize = compact ? 12 : 13;
  const lineHeight = compact ? 16 : 13 * (16 / 12);
  const ink = selected && dark ? t.onAccent : t.textPrimary;
  return (
    <Pressable
      role="button"
      accessibilityLabel={`#${channel.name}`}
      accessibilityState={{ selected }}
      onPress={onOpen}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...(isWeb
        ? { dataSet: { sidebarChannel: "true", channelChrome: raised ? "raised" : "idle" } }
        : null)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap,
        width: "100%",
        alignSelf: "stretch",
        borderRadius: 12,
        borderWidth: 1,
        paddingLeft: pad,
        paddingRight: pad,
        paddingTop: pad,
        paddingBottom: pad,
        borderColor: raised ? t.retroBorder : "transparent",
        backgroundColor: selected
          ? dark
            ? t.brandAccent
            : t.sidebarSelected
          : hovered
            ? t.sidebarSelected
            : "transparent",
        ...(raised ? ctrlShadow(t, name) : null),
        ...webTransition(
          "background-color 150ms cubic-bezier(0.4, 0, 0.2, 1), border-color 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        ),
      }}
    >
      <HashIcon color={ink} size={compact ? 16 : 20} />
      <Text
        numberOfLines={1}
        style={[type(ink, fontSize, { fontWeight: "600", flex: 1, lineHeight })]}
      >
        {channel.name}
      </Text>
      <UnreadBadge count={unreadCount} />
    </Pressable>
  );
}

export function UnreadBadge({ count }: { count: number }) {
  const { palette: t, name } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      testID="unread-badge"
      style={[
        {
          minWidth: 20,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.badgePink,
          paddingHorizontal: 6,
          paddingVertical: 2,
          alignItems: "center",
          justifyContent: "center",
        },
        ctrlShadow(t, name),
      ]}
    >
      <Text style={type("#fff", 10, { fontWeight: "600", lineHeight: 10 })}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}

export function SectionHeader({
  label,
  count,
  expanded,
  onToggle,
  actionLabel,
  onAction,
  testID,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 2,
        marginBottom: 4,
        marginTop: 8,
      }}
    >
      <Pressable
        testID={testID}
        role="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={{ flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 }}
      >
        <ChevronIcon color={t.textSecondary} down={expanded} />
        <Text
          numberOfLines={1}
          style={type(t.textPrimary, 11, {
            fontWeight: "700",
            letterSpacing: 0.8,
            textTransform: "uppercase",
            flexShrink: 1,
          })}
        >
          {label}
        </Text>
        <Text style={type(t.textMuted, 11, { fontWeight: "600", flexShrink: 0 })}>{count}</Text>
      </Pressable>
      {actionLabel && onAction ? (
        <Pressable
          role="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={[
            {
              width: 22,
              height: 22,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              alignItems: "center",
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <PlusIcon color={t.textMuted} size={12} />
        </Pressable>
      ) : null}
    </View>
  );
}
