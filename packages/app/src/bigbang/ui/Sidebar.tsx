// Adapted from Bigbang Workspace.tsx Sidebar. Data and navigation are supplied by the Paseo host.
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import type {
  Assistant,
  Conversation,
  Message,
} from "../../../../../extensions/bigbang/shared/contracts";
import { AgentAvatar, UserAvatar } from "./avatars";
import {
  ChatIcon,
  UsersIcon,
  BoxesIcon,
  SettingsIcon,
  SearchIcon,
  PlusIcon,
  ChevronIcon,
  PanelLeftOpenIcon,
} from "./icons";
import {
  RailNavButton,
  SidebarChannelRow,
  SidebarPanelToggle,
  SectionHeader,
} from "./SidebarControls";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

interface SidebarProps {
  compact: boolean;
  mode: string;
  chatId: string;
  coordinator: string;
  connected: boolean;
  conversations: Conversation[];
  assistants: Assistant[];
  messages: Message[];
  onChat(): void;
  onStudio(): void;
  onSelect(id: string): void;
  onAssistant(): void;
  onEdit(id: string): void;
  onGroup(): void;
  onWorkspaces(): void;
  onHosts(): void;
  onSettings(): void;
}
export function Sidebar(props: SidebarProps) {
  const { palette: t, name } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [section, setSection] = useState<"chat" | "members" | "search">("chat");
  const [filter, setFilter] = useState("");
  const [groupsOpen, setGroupsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const [membersOpen, setMembersOpen] = useState(true);
  const chats = props.conversations.filter((item) =>
    item.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = chats.filter((item) => item.kind === "group"),
    dms = chats.filter((item) => item.kind === "dm");
  const ink = (active: boolean) => (active && name === "dark" ? t.onAccent : t.textSecondary);
  const chatActive = section === "chat" && props.mode === "chat";
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
          onPress={props.onChat}
          style={{ height: 40, width: 40, alignItems: "center", justifyContent: "center" }}
        >
          <Image
            source={require("../../../assets/images/bigbang-icon.png")}
            style={{ width: 32, height: 32, borderRadius: 8 }}
          />
        </Pressable>
        <View style={{ height: 2, width: "100%", backgroundColor: t.black, marginVertical: 4 }} />
        <View style={{ gap: 6, alignItems: "center", paddingVertical: 4 }}>
          {collapsed ? (
            <SidebarPanelToggle
              mode="expand"
              onPress={() => setCollapsed(false)}
              t={t}
              name={name}
            />
          ) : null}
          <RailNavButton
            label="Chat"
            active={chatActive}
            onPress={() => {
              setSection("chat");
              props.onChat();
              setCollapsed(false);
            }}
            t={t}
            name={name}
            icon={<ChatIcon color={ink(chatActive)} size={20} />}
          />
          <RailNavButton
            label="Member"
            active={section === "members"}
            onPress={() => {
              setSection("members");
              setCollapsed(false);
            }}
            t={t}
            name={name}
            icon={<UsersIcon color={ink(section === "members")} size={20} />}
          />
          <RailNavButton
            label="Search chats"
            active={section === "search"}
            onPress={() => {
              setSection("search");
              setCollapsed(false);
            }}
            t={t}
            name={name}
            icon={<SearchIcon color={ink(section === "search")} size={20} />}
          />
          <RailNavButton
            label="Studios"
            active={props.mode === "studio"}
            onPress={props.onStudio}
            t={t}
            name={name}
            icon={<BoxesIcon color={ink(props.mode === "studio")} size={20} />}
          />
        </View>
        <View style={{ flex: 1 }} />
        <RailNavButton
          label="Settings"
          active={false}
          onPress={props.onSettings}
          t={t}
          name={name}
          icon={<SettingsIcon color={t.textSecondary} size={20} />}
        />
      </View>
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
              <>
                <SectionHeader
                  label="Members"
                  count={props.assistants.length}
                  expanded={membersOpen}
                  onToggle={() => setMembersOpen(!membersOpen)}
                  actionLabel="New assistant"
                  onAction={props.onAssistant}
                />
                {membersOpen
                  ? props.assistants.map((item) => (
                      <DmRow
                        key={item.id}
                        id={item.id}
                        label={item.name}
                        description={item.provider}
                        selected={false}
                        onOpen={() => props.onEdit(item.id)}
                      />
                    ))
                  : null}
              </>
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
                      return (
                        <DmRow
                          key={item.id}
                          id={assistant?.id ?? item.id}
                          label={assistant?.name ?? item.name}
                          description={last?.content ?? "Private chat"}
                          selected={item.id === props.chatId}
                          onOpen={() => props.onSelect(item.id)}
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
            onPress={props.onWorkspaces}
            accessibilityLabel="Add workspace"
            style={{
              padding: 12,
              borderTopWidth: 1,
              borderTopColor: t.dividerLine,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <PanelLeftOpenIcon color={t.textMuted} size={16} />
            <Text style={type(t.textSecondary, 12, { flex: 1 })}>Workspaces</Text>
            <PlusIcon color={t.textMuted} size={14} />
          </Pressable>
          <Pressable
            role="button"
            onPress={props.onSettings}
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
  selected,
  onOpen,
}: {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onOpen(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={`Chat with ${label}`}
      accessibilityState={{ selected }}
      onPress={onOpen}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
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
          {description}
        </Text>
      </View>
    </Pressable>
  );
}
