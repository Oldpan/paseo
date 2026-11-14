// Adapted from the Bigbang Workspace.tsx rail. Each item is a Bigbang view or a Paseo page that the
// Bigbang shell hosts; the host supplies navigation through useRailNavigation.
import type { ReactNode } from "react";
import { Image, Pressable, View } from "react-native";
import { CalendarClock, CircleGauge, History } from "lucide-react-native";
import type { RailItem } from "../rail";
import { BoxesIcon, ChatIcon, SearchIcon, SettingsIcon, UsersIcon } from "./icons";
import { RailNavButton } from "./SidebarControls";
import { useTheme } from "./ThemeProvider";

interface RailEntry {
  item: RailItem;
  label: string;
  icon(color: string): ReactNode;
}
const ENTRIES: RailEntry[] = [
  { item: "chat", label: "Chat", icon: (color) => <ChatIcon color={color} size={20} /> },
  { item: "members", label: "Member", icon: (color) => <UsersIcon color={color} size={20} /> },
  {
    item: "search",
    label: "Search chats",
    icon: (color) => <SearchIcon color={color} size={20} />,
  },
  { item: "studio", label: "Studios", icon: (color) => <BoxesIcon color={color} size={20} /> },
  { item: "history", label: "History", icon: (color) => <History color={color} size={20} /> },
  {
    item: "schedules",
    label: "Schedules",
    icon: (color) => <CalendarClock color={color} size={20} />,
  },
];

export function Rail({
  active,
  onSelect,
  onUsage,
  onSettings,
  expand,
}: {
  active: RailItem | null;
  onSelect(item: RailItem): void;
  onUsage(): void;
  onSettings(): void;
  /** Shown above the items while the sidebar panel beside the rail is collapsed. */
  expand?: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  const ink = (on: boolean) => (on && name === "dark" ? t.onAccent : t.textSecondary);
  return (
    <View
      testID="sidebar-rail"
      style={{
        width: 56,
        height: "100%",
        minHeight: 0,
        backgroundColor: t.sidebarSurface,
        alignItems: "center",
        paddingVertical: 8,
        borderRightWidth: 1,
        borderColor: t.retroBorder,
      }}
    >
      <Pressable
        role="button"
        accessibilityLabel="Bigbang Chat"
        onPress={() => onSelect("chat")}
        style={{ height: 40, width: 40, alignItems: "center", justifyContent: "center" }}
      >
        <Image
          source={require("../../../assets/images/bigbang-icon.png")}
          style={{ width: 32, height: 32, borderRadius: 8 }}
        />
      </Pressable>
      <View
        style={{
          height: 2,
          width: "100%",
          backgroundColor: t.black,
          marginTop: 6,
          marginBottom: 4,
        }}
      />
      <View style={{ gap: 6, alignItems: "center", paddingVertical: 4 }}>
        {expand}
        {ENTRIES.map((entry) => (
          <RailNavButton
            key={entry.item}
            label={entry.label}
            active={active === entry.item}
            onPress={() => onSelect(entry.item)}
            t={t}
            name={name}
            icon={entry.icon(ink(active === entry.item))}
          />
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ gap: 6, alignItems: "center" }}>
        <RailNavButton
          label="Usage"
          active={false}
          onPress={onUsage}
          t={t}
          name={name}
          icon={<CircleGauge color={t.textSecondary} size={20} />}
        />
        <RailNavButton
          label="Settings"
          active={false}
          onPress={onSettings}
          t={t}
          name={name}
          icon={<SettingsIcon color={t.textSecondary} size={20} />}
        />
      </View>
    </View>
  );
}
