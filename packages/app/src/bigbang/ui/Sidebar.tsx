// Adapted from Bigbang Workspace.tsx Sidebar. Data and navigation are supplied by the Paseo host.
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { EditingTextInput } from "@/components/ui/text-input";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { useOpenSidebarUsage } from "@/usage/sidebar-item";
import {
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from "../panel-resize";
import type { RailItem } from "../rail";
import { useBigbangView } from "../store";
import { useRailNavigation } from "../use-rail";
import type {
  Assistant,
  Conversation,
  MachineInfo,
  Message,
} from "../../../../../extensions/bigbang/shared/contracts";
import { MachinesSection } from "../machines";
import { AgentAvatar, UserAvatar } from "./avatars";
import { ColResizeHandle } from "./ColResizeHandle";
import { SettingsIcon, PlusIcon, ChevronIcon } from "./icons";
import { Rail } from "./Rail";
import { SidebarChannelRow, SidebarPanelToggle, SectionHeader } from "./SidebarControls";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

const COMPACT_SIDEBAR_WIDTH = 290;
const SIDEBAR_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const SECTION_TITLES: Record<string, string> = {
  members: "Member",
  search: "Search",
  chat: "Chat",
};

interface SidebarProps {
  compact: boolean;
  chatId: string;
  coordinator: string;
  coordinatorId: string;
  connected: boolean;
  conversations: Conversation[];
  assistants: Assistant[];
  machines: MachineInfo[];
  messages: Message[];
  hostLabels: Record<string, string>;
  onSelect(id: string): void;
  onAssistant(): void;
  onEdit(id: string): void;
  onOpenAssistant(assistantId: string): void;
  onAssistantForMachine(serverId: string): void;
  onGroup(): void;
  onHosts(): void;
}
export function Sidebar(props: SidebarProps) {
  const { palette: t, name } = useTheme();
  const collapsed = useBigbangView((state) => state.sidebarCollapsed);
  const setCollapsed = useBigbangView((state) => state.setSidebarCollapsed);
  const sidebarWidth = useBigbangView((state) => state.sidebarWidth);
  const setSidebarWidth = useBigbangView((state) => state.setSidebarWidth);
  const section = useBigbangView((state) => state.section);
  const rail = useRailNavigation();
  const openUsage = useOpenSidebarUsage();

  const select = (item: RailItem) => {
    rail.select(item);
    if (item === "chat" || item === "members" || item === "search") setCollapsed(false);
  };

  const isCollapsed = !props.compact && collapsed;
  const expandedPanelWidth = props.compact
    ? COMPACT_SIDEBAR_WIDTH - SIDEBAR_RAIL_WIDTH
    : Math.max(164, sidebarWidth - SIDEBAR_RAIL_WIDTH);
  const targetPanelWidth = isCollapsed ? 0 : expandedPanelWidth;

  const panelWidthSV = useSharedValue(targetPanelWidth);
  const panelOpacitySV = useSharedValue(isCollapsed ? 0 : 1);
  const prevCollapsedRef = useRef(isCollapsed);

  useEffect(() => {
    if (prevCollapsedRef.current !== isCollapsed) {
      prevCollapsedRef.current = isCollapsed;
      panelWidthSV.value = withTiming(targetPanelWidth, {
        duration: 200,
        easing: SIDEBAR_EASING,
      });
      panelOpacitySV.value = withTiming(isCollapsed ? 0 : 1, {
        duration: isCollapsed ? 140 : 200,
        easing: SIDEBAR_EASING,
      });
      return;
    }
    if (!isCollapsed) {
      panelWidthSV.value = targetPanelWidth;
      panelOpacitySV.value = 1;
    }
  }, [isCollapsed, panelOpacitySV, panelWidthSV, targetPanelWidth]);

  const clipAnimatedStyle = useAnimatedStyle(() => ({
    width: panelWidthSV.value,
    opacity: panelOpacitySV.value,
  }));

  return (
    <View
      style={{
        flexDirection: "row",
        flexShrink: 0,
        height: "100%",
        minHeight: 0,
        borderRightWidth: props.compact ? 1 : 0,
        borderColor: t.retroBorder,
        backgroundColor: t.surfacePrimary,
      }}
      testID="bigbang-sidebar"
    >
      <Rail
        active={rail.active}
        onSelect={select}
        onUsage={openUsage}
        onSettings={rail.settings}
        expand={
          isCollapsed ? (
            <SidebarPanelToggle
              mode="expand"
              onPress={() => setCollapsed(false)}
              t={t}
              name={name}
            />
          ) : null
        }
      />
      <Animated.View
        pointerEvents={isCollapsed ? "none" : "auto"}
        style={[
          {
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            flexShrink: 0,
          },
          clipAnimatedStyle,
        ]}
      >
        <View
          style={[
            {
              flex: 1,
              minHeight: 0,
              backgroundColor: t.surfacePrimary,
            },
            inlineUnistylesStyle({ width: expandedPanelWidth }),
          ]}
        >
          <View
            style={{
              height: 56,
              paddingHorizontal: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderBottomWidth: 2,
              borderBottomColor: t.black,
            }}
          >
            <Text role="heading" style={type(t.textPrimary, 16, { fontWeight: "800", flex: 1 })}>
              {SECTION_TITLES[section] ?? "Chat"}
            </Text>
            {!props.compact ? (
              <SidebarPanelToggle
                mode="collapse"
                onPress={() => setCollapsed(true)}
                t={t}
                name={name}
              />
            ) : null}
          </View>
          <Pressable
            role="button"
            accessibilityLabel="Coordinator"
            onPress={props.onHosts}
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: t.dividerLine,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: props.connected ? t.success : t.destructive,
              }}
            />
            <Text
              numberOfLines={1}
              style={type(t.textSecondary, 11, { flex: 1, fontWeight: "600" })}
            >
              {props.coordinator}
            </Text>
            <ChevronIcon color={t.textMuted} size={12} />
          </Pressable>
          <SidebarBody props={props} section={section} />
          <Pressable
            role="button"
            onPress={rail.settings}
            accessibilityLabel="Your settings"
            style={({ pressed }) => ({
              padding: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderTopWidth: 1,
              borderTopColor: t.retroBorder,
              backgroundColor: pressed ? t.surfaceHover : t.surfaceSecondary,
              ...webTransition("background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)"),
            })}
          >
            <UserAvatar label="You" size={28} theme={t} name={name} />
            <Text style={type(t.textPrimary, 12, { fontWeight: "600", flex: 1 })}>You</Text>
            <SettingsIcon color={t.textMuted} size={15} />
          </Pressable>
        </View>
      </Animated.View>
      {!props.compact && !isCollapsed ? (
        <ColResizeHandle
          testID="sidebar-resize-handle"
          accessibilityLabel="Resize sidebar"
          grow="left"
          width={sidebarWidth}
          minWidth={SIDEBAR_MIN_WIDTH}
          maxWidth={SIDEBAR_MAX_WIDTH}
          defaultWidth={SIDEBAR_DEFAULT_WIDTH}
          collapseBelow={SIDEBAR_COLLAPSE_THRESHOLD}
          onCollapse={() => setCollapsed(true)}
          onWidthChange={setSidebarWidth}
          ruleWidth={1}
          ruleColor={t.retroBorder}
        />
      ) : null}
    </View>
  );
}

function SidebarBody({ props, section }: { props: SidebarProps; section: string }) {
  const { palette: t, name } = useTheme();
  const [filter, setFilter] = useState("");
  const [groupsOpen, setGroupsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const chats = props.conversations.filter((item) =>
    item.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = chats.filter((item) => item.kind === "group");
  const dms = chats.filter((item) => item.kind === "dm");

  return (
    <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: 10, gap: 4 }}>
      {section === "search" ? (
        <EditingTextInput
          accessibilityLabel="Search chats"
          placeholder="Find a conversation…"
          onChangeText={setFilter}
          initialValue={filter}
          style={{
            color: t.textPrimary,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            padding: 8,
            borderRadius: 8,
          }}
        />
      ) : null}
      {section === "members" ? (
        <MachinesSection
          machines={props.machines}
          assistants={props.assistants}
          coordinatorId={props.coordinatorId}
          onOpenAssistant={props.onOpenAssistant}
          onEditAssistant={props.onEdit}
          onCreateAssistant={props.onAssistantForMachine}
        />
      ) : (
        <>
          <SectionHeader
            label="Channels"
            count={groups.length}
            expanded={groupsOpen}
            onToggle={() => setGroupsOpen(!groupsOpen)}
            actionLabel="Create group"
            onAction={props.onGroup}
          />
          {groupsOpen
            ? groups.map((item) => (
                <SidebarChannelRow
                  key={item.id}
                  channel={item}
                  selected={item.id === props.chatId}
                  compact={false}
                  unreadCount={0}
                  onOpen={() => props.onSelect(item.id)}
                />
              ))
            : null}
          {groupsOpen && !groups.length ? (
            <Text style={type(t.textMuted, 11, { paddingHorizontal: 6, paddingVertical: 8 })}>
              Create a shared room for your assistants.
            </Text>
          ) : null}
          <SectionHeader
            label="Direct Messages"
            count={dms.length}
            expanded={dmsOpen}
            onToggle={() => setDmsOpen(!dmsOpen)}
            actionLabel="New assistant"
            onAction={props.onAssistant}
          />
          {dmsOpen
            ? dms.map((item) => {
                const assistant = props.assistants.find((a) => a.id === item.members[0]);
                const last = props.messages
                  .filter((m) => m.conversationId === item.id && !m.threadId)
                  .sort((a, b) => b.createdAt - a.createdAt)[0];
                const machineLabel = assistant
                  ? (props.hostLabels[assistant.serverId ?? props.coordinatorId] ??
                    assistant.serverId)
                  : undefined;
                return (
                  <DmRow
                    key={item.id}
                    id={assistant?.id ?? item.id}
                    label={assistant?.name ?? item.name}
                    badge={machineLabel}
                    description={last?.content ?? assistant?.provider ?? "Private chat"}
                    selected={item.id === props.chatId}
                    onOpen={() => props.onSelect(item.id)}
                    onEdit={assistant ? () => props.onEdit(assistant.id) : undefined}
                  />
                );
              })
            : null}
          {!dms.length ? (
            <Pressable
              role="button"
              accessibilityLabel="Create your first assistant"
              onPress={props.onAssistant}
              style={[
                {
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.brandAccentSoft,
                  padding: 12,
                  marginTop: 8,
                  gap: 8,
                },
                ctrlShadow(t, name),
              ]}
            >
              <PlusIcon color={t.onAccent} size={20} />
              <Text style={type(t.onAccent, 12, { fontWeight: "600" })}>
                Add your first assistant
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
function DmRow({
  id,
  label,
  description,
  badge,
  selected,
  onOpen,
  onEdit,
}: {
  id: string;
  label: string;
  description: string;
  badge?: string;
  selected: boolean;
  onOpen(): void;
  onEdit?: () => void;
}) {
  const { palette: t, name } = useTheme();
  const [hovered, setHovered] = useState(false);
  const raised = selected || hovered;
  return (
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderColor: raised ? t.retroBorder : "transparent",
        backgroundColor: selected
          ? name === "dark"
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
      <Pressable
        role="button"
        accessibilityLabel={`Chat with ${label}`}
        accessibilityState={{ selected }}
        onPress={onOpen}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <AgentAvatar seed={`${id}:${label}`} label={label} size={28} theme={t} name={name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={type(selected && name === "dark" ? t.onAccent : t.textPrimary, 13, {
              fontWeight: "600",
            })}
          >
            {label}
          </Text>
          <Text
            numberOfLines={1}
            style={type(selected && name === "dark" ? "rgba(19,16,7,0.7)" : t.textSecondary, 10)}
          >
            {badge ? `${badge} · ${description}` : description}
          </Text>
        </View>
      </Pressable>
      {onEdit ? (
        <Pressable
          role="button"
          accessibilityLabel={`Edit ${label}`}
          onPress={onEdit}
          style={(state) => {
            const buttonHovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              {
                borderRadius: 8,
                width: 26,
                height: 26,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: buttonHovered ? t.surfaceHover : t.surfaceElevated,
                ...webTransition("background-color 120ms ease"),
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <SettingsIcon color={t.textSecondary} size={13} />
        </Pressable>
      ) : null}
    </View>
  );
}
