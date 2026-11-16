import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import {
  cancelTakeover,
  cancelTask,
  cancelTurn,
  resolveTakeover,
  respondTaskPermission,
  sendMessage,
  type Assistant,
  type MachineInfo,
  type Takeover,
  type Task,
  type Turn,
} from "../../../../../extensions/pavra/shared/contracts";
import {
  buildGlobalActivitySnapshot,
  type ActivityWatchItem,
  type ActivityWatchStatusFilter,
} from "../activity-watch";
import type { PavraData } from "../data";
import { formatLiveTurnStatus, selectLiveTurn, TURN_STATUS_LABEL } from "../live-turn";
import { AgentAvatar, StatusDot } from "./avatars";
import { BrowserTakeoverModal } from "./BrowserTakeoverModal";
import { HeaderIconButton } from "./ChatChrome";
import {
  ActivityIcon,
  BriefcaseIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  ExternalLinkIcon,
  MenuIcon,
  MessagesSquareIcon,
  MonitorIcon,
  SearchIcon,
  SendIcon,
  StopIcon,
} from "./icons";
import {
  ctrlShadow,
  runStatusColor,
  selectedFillProps,
  text as type,
  webTransition,
  type Palette,
} from "./theme";
import { useTheme } from "./ThemeProvider";

const EMPTY_STREAM_ITEMS: StreamItem[] = [];

export interface GlobalActivityPaneProps {
  data: Pick<PavraData, "state" | "call" | "connected">;
  coordinatorId?: string;
  hostLabels?: Record<string, string>;
  machines?: readonly MachineInfo[];
  compact?: boolean;
  focusRunId?: string | null;
  onOpenConversation?(conversationId: string, threadId: string | null): void;
  onOpenChat?(conversationId: string, threadId: string | null): void;
  onOpenTurn?(turn: Turn): void;
  onOpenTask?(task: Task): void;
  onOpenTakeover?(takeover: Takeover): void;
  onSteer?(item: ActivityWatchItem, text: string): Promise<void> | void;
  onSidebar?(): void;
}

function statusToneColors(
  status: ActivityWatchItem["status"],
  t: Palette,
): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "waiting_action":
      return { bg: t.badgePink, fg: t.onPink, dot: runStatusColor("awaiting_approval", t) };
    case "running":
      return { bg: t.badgeAmber, fg: t.textPrimary, dot: runStatusColor("active", t) };
    case "queued":
      return { bg: t.badgeBlue, fg: t.textPrimary, dot: runStatusColor("queued", t) };
    case "completed":
      return { bg: t.badgeGreen, fg: t.textPrimary, dot: t.success };
    case "failed":
      return { bg: t.badgeRed, fg: t.textPrimary, dot: t.destructive };
    case "cancelled":
      return { bg: t.surfacePrimary, fg: t.textMuted, dot: t.textMuted };
  }
}

function FilterPill({
  testID,
  label,
  selected,
  onPress,
}: {
  testID?: string;
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      {...selectedFillProps(selected)}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            height: 28,
            borderRadius: 999,
            borderWidth: selected ? 1 : 0,
            borderColor: selected ? t.retroBorder : "transparent",
            backgroundColor: selected
              ? hovered
                ? t.surfaceHover
                : t.brandAccentSoft
              : hovered
                ? t.surfaceHover
                : t.surfaceSecondary,
            paddingHorizontal: 10,
            justifyContent: "center",
            ...webTransition("background-color 120ms ease"),
          },
          selected ? ctrlShadow(t, name) : null,
        ];
      }}
    >
      <Text style={type(selected ? t.textPrimary : t.textSecondary, 11, { fontWeight: "700" })}>
        {label}
      </Text>
    </Pressable>
  );
}

function CardActionButton({
  testID,
  label,
  accent = false,
  danger = false,
  disabled = false,
  icon,
  children,
  onPress,
}: {
  testID?: string;
  label: string;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onPress(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        const bg = accent
          ? hovered
            ? t.brandAccentHover
            : t.brandAccent
          : danger
            ? hovered
              ? t.badgeRed
              : t.surfacePrimary
            : hovered
              ? t.surfaceHover
              : t.surfacePrimary;
        return [
          {
            minHeight: 28,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: danger ? t.destructive : t.retroBorder,
            backgroundColor: bg,
            paddingHorizontal: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            opacity: disabled ? 0.45 : 1,
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      {icon}
      <Text
        style={type(accent ? t.onAccent : danger ? t.destructive : t.textPrimary, 11, {
          fontWeight: "700",
        })}
      >
        {children}
      </Text>
    </Pressable>
  );
}

function LiveTurnActivityLine({ item }: { item: ActivityWatchItem }) {
  const { palette: t } = useTheme();
  const turn = item.turn;
  const serverId = item.serverId;
  const agentId = turn?.agentId ?? "";

  const tail = useSessionStore((state) =>
    serverId && agentId
      ? (state.sessions[serverId]?.agentStreamTail.get(agentId) ?? EMPTY_STREAM_ITEMS)
      : EMPTY_STREAM_ITEMS,
  );
  const head = useSessionStore((state) =>
    serverId && agentId
      ? (state.sessions[serverId]?.agentStreamHead.get(agentId) ?? EMPTY_STREAM_ITEMS)
      : EMPTY_STREAM_ITEMS,
  );

  const liveStatus = useMemo(() => {
    if (!turn || !item.isActive || (tail.length === 0 && head.length === 0)) return null;
    const view = selectLiveTurn(head.length > 0 ? [...tail, ...head] : tail, turn.id);
    if (!view.found && !view.activity && !view.commentary) return null;
    return formatLiveTurnStatus({
      sender: item.assistantName,
      activity: view.activity,
      commentary: view.commentary,
      statusLabel: TURN_STATUS_LABEL[turn.status] ?? item.statusLabel,
    });
  }, [head, item.assistantName, item.isActive, item.statusLabel, tail, turn]);

  if (!liveStatus) return null;

  return (
    <Text numberOfLines={1} style={type(t.liveTool, 11, { fontWeight: "700" })}>
      {liveStatus}
    </Text>
  );
}

function ActivityTagChip({ itemId, tag }: { itemId: string; tag: string }) {
  const { palette: t } = useTheme();
  const isTakeover = tag === "Takeover";
  const isMailbox = tag.startsWith("Mailbox");
  const bg = isTakeover ? t.badgePink : isMailbox ? t.badgeAmber : t.badgeBlue;
  const fg = isTakeover ? t.onPink : t.textPrimary;

  return (
    <View
      testID={`activity-tag-${itemId}-${tag}`}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: bg,
        paddingHorizontal: 8,
        paddingVertical: 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      {isTakeover ? (
        <MonitorIcon color={fg} size={11} />
      ) : isMailbox ? (
        <MessagesSquareIcon color={fg} size={11} />
      ) : (
        <BriefcaseIcon color={fg} size={11} />
      )}
      <Text style={type(fg, 10, { fontWeight: "700" })}>{tag}</Text>
    </View>
  );
}

function ActivitySteerBar({
  item,
  busy,
  onSendSteer,
}: {
  item: ActivityWatchItem;
  busy: boolean;
  onSendSteer(item: ActivityWatchItem, text: string): Promise<boolean>;
}) {
  const { palette: t, name } = useTheme();
  const [draft, setDraft] = useState("");
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    const ok = await onSendSteer(item, trimmed);
    if (ok) {
      setDraft("");
      setInputKey((prev) => prev + 1);
    }
  }, [busy, draft, item, onSendSteer]);

  const canSubmit = !busy && draft.trim().length > 0;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingTop: 4,
      }}
    >
      <EditingTextInput
        key={`steer:${item.id}:${inputKey}`}
        testID={`activity-steer-input-${item.id}`}
        accessibilityLabel={`Steer ${item.assistantName}`}
        initialValue={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => void handleSubmit()}
        editable={!busy}
        placeholder={`Steer ${item.assistantName} mid-turn…`}
        placeholderTextColor={t.textSubtle}
        style={[
          type(t.textPrimary, 12),
          {
            flex: 1,
            minHeight: 34,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfacePrimary,
            paddingHorizontal: 10,
            paddingVertical: 6,
          },
        ]}
      />
      <Pressable
        testID={`activity-steer-send-${item.id}`}
        role="button"
        accessibilityLabel="Send steer instruction"
        disabled={!canSubmit}
        onPress={() => void handleSubmit()}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          return [
            {
              height: 34,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: hovered && canSubmit ? t.brandAccentHover : t.brandAccent,
              paddingHorizontal: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              opacity: canSubmit ? 1 : 0.45,
              ...webTransition("background-color 120ms ease"),
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <SendIcon color={t.onAccent} size={12} />
        <Text style={type(t.onAccent, 11, { fontWeight: "800" })}>Steer</Text>
      </Pressable>
    </View>
  );
}

function ActivityWaitingActionControls({
  item,
  busy,
  onApprove,
  onDeny,
  onOpenTakeover,
}: {
  item: ActivityWatchItem;
  busy: boolean;
  onApprove(item: ActivityWatchItem): void;
  onDeny(item: ActivityWatchItem): void;
  onOpenTakeover(item: ActivityWatchItem): void;
}) {
  const { palette: t } = useTheme();
  if (item.status !== "waiting_action") return null;

  const hasPermission = Boolean(item.pendingPermission);
  const hasTakeover = Boolean(item.pendingTakeover);
  const reasonText =
    item.pendingPermission?.title ??
    item.pendingTakeover?.reason ??
    "Waiting for your confirmation or input";

  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: t.warning,
        backgroundColor: t.surfacePrimary,
        padding: 10,
        gap: 8,
      }}
    >
      <Text numberOfLines={2} style={type(t.textPrimary, 12, { fontWeight: "600" })}>
        {reasonText}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {hasTakeover ? (
          <CardActionButton
            testID={`activity-open-takeover-${item.id}`}
            label="Open browser takeover"
            accent
            disabled={busy}
            icon={<MonitorIcon color={t.onAccent} size={12} />}
            onPress={() => onOpenTakeover(item)}
          >
            Open Takeover
          </CardActionButton>
        ) : null}
        {hasPermission || hasTakeover ? (
          <>
            <CardActionButton
              testID={`activity-approve-${item.id}`}
              label="Approve"
              accent={!hasTakeover}
              disabled={busy}
              icon={<CheckIcon color={!hasTakeover ? t.onAccent : t.textPrimary} size={12} />}
              onPress={() => onApprove(item)}
            >
              {hasTakeover ? "Done, Continue" : "Approve"}
            </CardActionButton>
            <CardActionButton
              testID={`activity-deny-${item.id}`}
              label="Deny"
              danger
              disabled={busy}
              icon={<CloseIcon color={t.destructive} size={12} />}
              onPress={() => onDeny(item)}
            >
              {hasTakeover ? "Cancel Takeover" : "Deny"}
            </CardActionButton>
          </>
        ) : null}
      </View>
    </View>
  );
}

function ActivityRunCard({
  item,
  focused,
  busy,
  onOpenProcess,
  onOpenChat,
  onStop,
  onApprove,
  onDeny,
  onOpenTakeover,
  onSendSteer,
}: {
  item: ActivityWatchItem;
  focused: boolean;
  busy: boolean;
  onOpenProcess(item: ActivityWatchItem): void;
  onOpenChat(item: ActivityWatchItem): void;
  onStop(item: ActivityWatchItem): void;
  onApprove(item: ActivityWatchItem): void;
  onDeny(item: ActivityWatchItem): void;
  onOpenTakeover(item: ActivityWatchItem): void;
  onSendSteer(item: ActivityWatchItem, text: string): Promise<boolean>;
}) {
  const { palette: t, name } = useTheme();
  const statusColors = statusToneColors(item.status, t);
  const seed = `${item.assistantId}:${item.assistantName}`;
  const laneChipLabel = item.threadId
    ? `${item.conversationTitle} · Thread`
    : item.conversationTitle;

  return (
    <View
      testID={`activity-run-card-${item.id}`}
      style={[
        {
          borderRadius: 12,
          borderWidth: 1,
          borderColor: focused ? t.brandAccent : t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 10,
        },
        ctrlShadow(t, name),
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ position: "relative" }}>
          <AgentAvatar seed={seed} label={item.assistantName} size={36} theme={t} name={name} />
          <View style={{ position: "absolute", right: -2, bottom: -2 }}>
            <StatusDot color={statusColors.dot} border={t.surfaceElevated} pulse={item.isActive} />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              <Text
                numberOfLines={1}
                style={type(t.textPrimary, 14, { fontWeight: "800", flexShrink: 1 })}
              >
                {item.assistantName}
              </Text>
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.surfacePrimary,
                  paddingHorizontal: 7,
                  paddingVertical: 1,
                }}
              >
                <Text style={type(t.textSecondary, 10, { fontWeight: "700" })}>
                  {item.hostLabel}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: statusColors.bg,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text
                  style={type(statusColors.fg, 10, {
                    fontWeight: "800",
                    textTransform: "uppercase",
                  })}
                >
                  {item.statusLabel}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <ClockIcon color={t.textMuted} size={11} />
                <Text style={type(t.textMuted, 11, { fontWeight: "700" })}>
                  {item.elapsedLabel}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <View
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.badgeBlue,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text numberOfLines={1} style={type(t.textPrimary, 10, { fontWeight: "700" })}>
                {laneChipLabel}
              </Text>
            </View>
            {item.tags.map((tag) => (
              <ActivityTagChip key={tag} itemId={item.id} tag={tag} />
            ))}
          </View>

          <LiveTurnActivityLine item={item} />

          <Text numberOfLines={2} style={type(t.textSecondary, 12)}>
            {item.promptPreview}
          </Text>
          {item.error ? (
            <Text numberOfLines={2} style={type(t.destructive, 11, { fontWeight: "600" })}>
              {item.error}
            </Text>
          ) : null}
        </View>
      </View>

      <ActivityWaitingActionControls
        item={item}
        busy={busy}
        onApprove={onApprove}
        onDeny={onDeny}
        onOpenTakeover={onOpenTakeover}
      />

      {item.canSteer ? (
        <ActivitySteerBar item={item} busy={busy} onSendSteer={onSendSteer} />
      ) : null}

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          paddingTop: 2,
        }}
      >
        <CardActionButton
          testID={`activity-open-process-${item.id}`}
          label="View Process"
          accent={item.status !== "waiting_action"}
          onPress={() => onOpenProcess(item)}
        >
          View Process
        </CardActionButton>
        <CardActionButton
          testID={`activity-open-chat-${item.id}`}
          label="Open Chat"
          icon={<ExternalLinkIcon color={t.textPrimary} size={11} />}
          onPress={() => onOpenChat(item)}
        >
          Open Chat
        </CardActionButton>
        {item.isActive ? (
          <CardActionButton
            testID={`activity-stop-${item.id}`}
            label="Stop or cancel run"
            danger
            disabled={busy}
            icon={<StopIcon color={t.destructive} size={11} />}
            onPress={() => onStop(item)}
          >
            Stop
          </CardActionButton>
        ) : null}
      </View>
    </View>
  );
}

function ActivityHeader({
  compact,
  connected,
  activeRunCount,
  statusFilter,
  onSelectStatusFilter,
  onSidebar,
}: {
  compact: boolean;
  connected: boolean;
  activeRunCount: number;
  statusFilter: ActivityWatchStatusFilter;
  onSelectStatusFilter(filter: ActivityWatchStatusFilter): void;
  onSidebar?(): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        minHeight: 56,
        backgroundColor: t.surfacePrimary,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: t.dividerLine,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 180 }}>
        {compact && onSidebar ? (
          <HeaderIconButton label="Open sidebar" onPress={onSidebar} size={34}>
            <MenuIcon color={t.textSecondary} size={16} />
          </HeaderIconButton>
        ) : null}
        <ActivityIcon color={t.warning} size={18} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              role="heading"
              numberOfLines={1}
              style={type(t.textPrimary, 15, { fontWeight: "800" })}
            >
              Activity
            </Text>
            <View
              testID="activity-active-count"
              style={{
                minWidth: 22,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: activeRunCount > 0 ? t.brandAccent : t.surfaceElevated,
                paddingHorizontal: 7,
                paddingVertical: 1,
                alignItems: "center",
              }}
            >
              <Text
                style={type(activeRunCount > 0 ? t.onAccent : t.textSecondary, 11, {
                  fontWeight: "800",
                })}
              >
                {activeRunCount}
              </Text>
            </View>
          </View>
          <Text
            numberOfLines={1}
            style={type(t.textMuted, 10, {
              fontWeight: "700",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              marginTop: 1,
            })}
          >
            {`${connected ? "Live" : "Reconnecting"} · ${activeRunCount} active`}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <FilterPill
          testID="activity-filter-all"
          label="All"
          selected={statusFilter === "all"}
          onPress={() => onSelectStatusFilter("all")}
        />
        <FilterPill
          testID="activity-filter-running"
          label="Running"
          selected={statusFilter === "running"}
          onPress={() => onSelectStatusFilter("running")}
        />
        <FilterPill
          testID="activity-filter-waiting"
          label="Waiting Action"
          selected={statusFilter === "waiting_action"}
          onPress={() => onSelectStatusFilter("waiting_action")}
        />
      </View>
    </View>
  );
}

function ActivityFilterBar({
  query,
  onQueryChange,
  assistants,
  assistantFilter,
  onSelectAssistant,
  machineOptions,
  serverFilter,
  onSelectServer,
}: {
  query: string;
  onQueryChange(value: string): void;
  assistants: readonly Assistant[];
  assistantFilter: string;
  onSelectAssistant(id: string): void;
  machineOptions: ReadonlyArray<{ serverId: string; label: string }>;
  serverFilter: string;
  onSelectServer(serverId: string): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surfacePrimary,
        borderBottomWidth: 1,
        borderBottomColor: t.dividerLine,
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          paddingHorizontal: 10,
          minHeight: 34,
        }}
      >
        <SearchIcon color={t.textMuted} size={14} />
        <EditingTextInput
          testID="activity-search-input"
          accessibilityLabel="Search activity"
          initialValue={query}
          onChangeText={onQueryChange}
          placeholder="Search runs, assistants, machines, or conversations…"
          placeholderTextColor={t.textSubtle}
          style={[
            type(t.textPrimary, 12),
            {
              flex: 1,
              minHeight: 32,
              paddingVertical: 4,
            },
          ]}
        />
      </View>

      {assistants.length > 0 || machineOptions.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {assistants.length > 0 ? (
            <>
              <FilterPill
                testID="activity-assistant-filter-all"
                label="All Assistants"
                selected={assistantFilter === "all"}
                onPress={() => onSelectAssistant("all")}
              />
              {assistants.map((assistant) => (
                <FilterPill
                  key={assistant.id}
                  testID={`activity-assistant-filter-${assistant.id}`}
                  label={`@${assistant.name}`}
                  selected={assistantFilter === assistant.id}
                  onPress={() =>
                    onSelectAssistant(assistantFilter === assistant.id ? "all" : assistant.id)
                  }
                />
              ))}
            </>
          ) : null}
          {machineOptions.length > 1 ? (
            <>
              <FilterPill
                testID="activity-machine-filter-all"
                label="All Machines"
                selected={serverFilter === "all"}
                onPress={() => onSelectServer("all")}
              />
              {machineOptions.map((machine) => (
                <FilterPill
                  key={machine.serverId}
                  testID={`activity-machine-filter-${machine.serverId}`}
                  label={machine.label}
                  selected={serverFilter === machine.serverId}
                  onPress={() =>
                    onSelectServer(serverFilter === machine.serverId ? "all" : machine.serverId)
                  }
                />
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function GlobalActivityPane({
  data,
  coordinatorId = "",
  hostLabels,
  machines,
  compact = false,
  focusRunId = null,
  onOpenConversation,
  onOpenChat,
  onOpenTurn,
  onOpenTask,
  onOpenTakeover,
  onSteer,
  onSidebar,
}: GlobalActivityPaneProps) {
  const { palette: t } = useTheme();
  const hosts = useHosts();
  const [statusFilter, setStatusFilter] = useState<ActivityWatchStatusFilter>("all");
  const [assistantFilter, setAssistantFilter] = useState<string>("all");
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [activeTakeoverModal, setActiveTakeoverModal] = useState<{
    takeover: Takeover;
    assistantName: string;
  } | null>(null);

  const mergedHostLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const host of hosts) {
      map[host.serverId] = host.label;
    }
    for (const machine of machines ?? []) {
      map[machine.serverId] = machine.label;
    }
    if (hostLabels) {
      for (const [k, v] of Object.entries(hostLabels)) {
        map[k] = v;
      }
    }
    return map;
  }, [hostLabels, hosts, machines]);

  const snapshot = useMemo(
    () =>
      buildGlobalActivitySnapshot({
        state: data.state,
        machines,
        coordinatorId,
        hostLabels: mergedHostLabels,
        filters: {
          status: statusFilter,
          assistantId: assistantFilter,
          serverId: serverFilter,
          query,
        },
        now,
      }),
    [
      assistantFilter,
      coordinatorId,
      data.state,
      machines,
      mergedHostLabels,
      now,
      query,
      serverFilter,
      statusFilter,
    ],
  );

  useEffect(() => {
    if (snapshot.activeRunCount === 0) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [snapshot.activeRunCount]);

  const machineOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of snapshot.allItems) {
      if (item.serverId) {
        byId.set(item.serverId, item.hostLabel);
      }
    }
    for (const [serverId, label] of Object.entries(mergedHostLabels)) {
      if (serverId && label) {
        byId.set(serverId, label);
      }
    }
    return [...byId.entries()].map(([serverId, label]) => ({ serverId, label }));
  }, [mergedHostLabels, snapshot.allItems]);

  const runAction = useCallback(async (id: string, work: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusyId((current) => (current === id ? null : current));
    }
  }, []);

  const handleOpenProcess = useCallback(
    (item: ActivityWatchItem) => {
      if (item.turn) {
        onOpenTurn?.(item.turn);
        return;
      }
      if (item.task) {
        onOpenTask?.(item.task);
      }
    },
    [onOpenTask, onOpenTurn],
  );

  const handleOpenChat = useCallback(
    (item: ActivityWatchItem) => {
      const navigate = onOpenConversation ?? onOpenChat;
      navigate?.(item.conversationId, item.threadId);
    },
    [onOpenChat, onOpenConversation],
  );

  const handleStop = useCallback(
    (item: ActivityWatchItem) => {
      void runAction(item.id, async () => {
        if (item.kind === "turn" && item.turn) {
          await data.call(cancelTurn, { id: item.turn.id });
          return;
        }
        if (item.kind === "task" && item.task) {
          await data.call(cancelTask, { id: item.task.id });
        }
      });
    },
    [data, runAction],
  );

  const handleApprove = useCallback(
    (item: ActivityWatchItem) => {
      void runAction(item.id, async () => {
        if (item.pendingPermission && item.task) {
          await data.call(respondTaskPermission, {
            taskId: item.task.id,
            requestId: item.pendingPermission.requestId,
            behavior: "allow",
          });
          return;
        }
        if (item.pendingTakeover) {
          await data.call(resolveTakeover, { id: item.pendingTakeover.id });
        }
      });
    },
    [data, runAction],
  );

  const handleDeny = useCallback(
    (item: ActivityWatchItem) => {
      void runAction(item.id, async () => {
        if (item.pendingPermission && item.task) {
          await data.call(respondTaskPermission, {
            taskId: item.task.id,
            requestId: item.pendingPermission.requestId,
            behavior: "deny",
          });
          return;
        }
        if (item.pendingTakeover) {
          await data.call(cancelTakeover, { id: item.pendingTakeover.id });
        }
      });
    },
    [data, runAction],
  );

  const handleOpenTakeover = useCallback(
    (item: ActivityWatchItem) => {
      if (!item.pendingTakeover) return;
      onOpenTakeover?.(item.pendingTakeover.takeover);
      setActiveTakeoverModal({
        takeover: item.pendingTakeover.takeover,
        assistantName: item.assistantName,
      });
    },
    [onOpenTakeover],
  );

  const handleSendSteer = useCallback(
    (item: ActivityWatchItem, text: string) =>
      runAction(item.id, async () => {
        if (onSteer) {
          await onSteer(item, text);
          return;
        }
        await data.call(sendMessage, {
          id: randomUUID(),
          conversationId: item.conversationId,
          threadId: item.threadId,
          content: text,
          delivery: "steer",
        });
      }),
    [data, onSteer, runAction],
  );

  return (
    <View
      testID="global-activity-pane"
      style={{ flex: 1, minHeight: 0, backgroundColor: t.chatSurface }}
    >
      <ActivityHeader
        compact={compact}
        connected={data.connected}
        activeRunCount={snapshot.activeRunCount}
        statusFilter={statusFilter}
        onSelectStatusFilter={setStatusFilter}
        onSidebar={onSidebar}
      />

      <ActivityFilterBar
        query={query}
        onQueryChange={setQuery}
        assistants={data.state.assistants}
        assistantFilter={assistantFilter}
        onSelectAssistant={setAssistantFilter}
        machineOptions={machineOptions}
        serverFilter={serverFilter}
        onSelectServer={setServerFilter}
      />

      {error ? (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            backgroundColor: t.surfaceElevated,
            borderBottomWidth: 1,
            borderBottomColor: t.destructive,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text accessibilityRole="alert" style={type(t.destructive, 12, { flex: 1 })}>
            {error}
          </Text>
          <Pressable
            role="button"
            accessibilityLabel="Dismiss error"
            onPress={() => setError(null)}
          >
            <Text style={type(t.textSecondary, 11, { fontWeight: "700", marginLeft: 8 })}>
              Dismiss
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ padding: compact ? 12 : 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {snapshot.items.length === 0 ? (
          <View
            testID="activity-empty-state"
            style={{
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceSecondary,
              padding: 28,
              alignItems: "center",
              gap: 6,
            }}
          >
            <ActivityIcon color={t.textMuted} size={22} />
            <Text style={type(t.textPrimary, 14, { fontWeight: "800" })}>
              No matching agent activity
            </Text>
            <Text style={type(t.textSecondary, 12, { textAlign: "center" })}>
              Active and recent turns, tasks, browser takeovers, and mailbox consultations appear
              here in real time.
            </Text>
          </View>
        ) : (
          snapshot.items.map((item) => (
            <ActivityRunCard
              key={`${item.kind}:${item.id}`}
              item={item}
              focused={focusRunId === item.id}
              busy={busyId === item.id}
              onOpenProcess={handleOpenProcess}
              onOpenChat={handleOpenChat}
              onStop={handleStop}
              onApprove={handleApprove}
              onDeny={handleDeny}
              onOpenTakeover={handleOpenTakeover}
              onSendSteer={handleSendSteer}
            />
          ))
        )}
      </ScrollView>

      {activeTakeoverModal ? (
        <BrowserTakeoverModal
          takeover={activeTakeoverModal.takeover}
          assistantName={activeTakeoverModal.assistantName}
          data={data}
          onClose={() => setActiveTakeoverModal(null)}
        />
      ) : null}
    </View>
  );
}
