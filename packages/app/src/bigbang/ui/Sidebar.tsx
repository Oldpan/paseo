// Adapted from Bigbang Workspace.tsx Sidebar. Data and navigation are supplied by the Paseo host.
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import { useOpenSidebarUsage } from "@/usage/sidebar-item";
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
import { SettingsIcon, PlusIcon, ChevronIcon } from "./icons";
import { Rail } from "./Rail";
import { SidebarChannelRow, SidebarPanelToggle, SectionHeader } from "./SidebarControls";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

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
  const [collapsed, setCollapsed] = useState(false);
  const section = useBigbangView((state) => state.section);
  const rail = useRailNavigation();
  const openUsage = useOpenSidebarUsage();
  const select = (item: RailItem) => {
    rail.select(item);
    if (item === "chat" || item === "members" || item === "search") setCollapsed(false);
  };
  const [filter, setFilter] = useState("");
  const [groupsOpen, setGroupsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const chats = props.conversations.filter((item) =>
    item.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = chats.filter((item) => item.kind === "group"),
    dms = chats.filter((item) => item.kind === "dm");
  return (
    <View
      style={{
        flexDirection: "row",
        flexShrink: 0,
        width: collapsed ? 56 : props.compact ? 290 : 312,
        minHeight: 0,
        borderRightWidth: 1,
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
          collapsed ? (
            <SidebarPanelToggle
              mode="expand"
              onPress={() => setCollapsed(false)}
              t={t}
              name={name}
            />
          ) : null
        }
      />
      {!collapsed ? (
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <View
            style={{
              height: 54,
              paddingHorizontal: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderBottomWidth: 2,
              borderBottomColor: t.black,
            }}
          >
            <Text style={type(t.textPrimary, 15, { fontWeight: "800", flex: 1 })}>Bigbang</Text>
            <SidebarPanelToggle
              mode="collapse"
              onPress={() => setCollapsed(true)}
              t={t}
              name={name}
            />
          </View>
          <Pressable
            role="button"
            accessibilityLabel="Coordinator"
            onPress={props.onHosts}
            style={{
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: t.dividerLine,
            }}
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
          <ScrollView contentContainerStyle={{ padding: 10, gap: 4 }}>
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
          <Pressable
            role="button"
            onPress={rail.settings}
            accessibilityLabel="Your settings"
            style={{
              padding: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderTopWidth: 1,
              borderTopColor: t.retroBorder,
              backgroundColor: t.surfaceSecondary,
            }}
          >
            <UserAvatar label="You" size={28} theme={t} name={name} />
            <Text style={type(t.textPrimary, 12, { fontWeight: "600", flex: 1 })}>You</Text>
            <SettingsIcon color={t.textMuted} size={15} />
          </Pressable>
        </View>
      ) : null}
    </View>
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
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderColor: selected ? t.retroBorder : "transparent",
        backgroundColor: selected
          ? name === "dark"
            ? t.brandAccent
            : t.sidebarSelected
          : "transparent",
        ...(selected ? ctrlShadow(t, name) : null),
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
          style={[
            {
              borderRadius: 8,
              width: 26,
              height: 26,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
            },
            ctrlShadow(t, name),
          ]}
        >
          <SettingsIcon color={t.textSecondary} size={13} />
        </Pressable>
      ) : null}
    </View>
  );
}
