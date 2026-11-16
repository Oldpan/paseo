import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import {
  cancelTask,
  respondTaskPermission,
  type Assistant,
  type Conversation,
  type MachineInfo,
  type Message,
  type Task,
} from "../../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "../data";
import {
  GLOBAL_TASK_COLUMNS,
  filterAndGroupGlobalTasks,
  type GlobalTaskColumn,
  type GlobalTaskItem,
  type GlobalTaskRecord,
  type GlobalTaskSourceFilter,
  type GlobalTasksResult,
} from "../global-tasks";
import { AgentAvatar } from "./avatars";
import { HeaderIconButton } from "./ChatChrome";
import { BriefcaseIcon, ChevronIcon, MenuIcon, PlusIcon } from "./icons";
import { OptionSelect } from "./OptionSelect";
import { PromoteToTaskModal } from "./PromoteToTaskModal";
import {
  compactBreakpoint,
  ctrlShadow,
  phoneHeaderBreakpoint,
  selectedFillProps,
  text as type,
  webTransition,
  type Palette,
} from "./theme";
import { useTheme } from "./ThemeProvider";

const EMPTY_TASKS: readonly GlobalTaskRecord[] = [];
const EMPTY_ASSISTANTS: readonly Assistant[] = [];
const EMPTY_CONVERSATIONS: readonly Conversation[] = [];
const EMPTY_MACHINES: readonly MachineInfo[] = [];
const EMPTY_HOST_LABELS: Record<string, string> = {};

const COLUMN_META: Record<GlobalTaskColumn, { label: string; emptyLabel: string }> = {
  queued: { label: "Queued", emptyLabel: "No queued tasks." },
  running: { label: "Running", emptyLabel: "No running tasks." },
  needs_action: { label: "Needs Action", emptyLabel: "No tasks waiting for approval." },
  done: { label: "Done", emptyLabel: "No completed or closed tasks." },
};

const TABLET_COLUMN_PAIRS: ReadonlyArray<readonly [GlobalTaskColumn, GlobalTaskColumn]> = [
  ["queued", "running"],
  ["needs_action", "done"],
];

const SOURCE_PILLS: ReadonlyArray<{ id: GlobalTaskSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "dm", label: "DM" },
  { id: "group", label: "Group" },
];

const COLUMN_FILTER_OPTIONS = [
  { value: "all", label: "All columns" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "needs_action", label: "Needs Action" },
  { value: "done", label: "Done" },
];

export interface GlobalTasksPaneProps {
  data?: Pick<PavraData, "call" | "connected"> & {
    state?: {
      tasks?: readonly GlobalTaskRecord[];
      assistants?: readonly Assistant[];
      conversations?: readonly Conversation[];
    };
  };
  tasks?: readonly GlobalTaskRecord[];
  assistants?: readonly Assistant[];
  conversations?: readonly Conversation[];
  machines?: readonly MachineInfo[];
  hostLabels?: Record<string, string>;
  activeConversationId?: string;
  defaultDirectory?: string;
  compact?: boolean;
  onSidebar?(): void;
  onOpenSidebar?(): void;
  onCreateTask?(): void;
  onOpenTask?(task: Task): void;
  onOpenChat?(conversationId: string, threadId: string | null): void;
  onOpenConversation?(conversationId: string, threadId: string | null): void;
  onOpenInStudio?(task: Task): void;
  onRespondPermission?(
    taskId: string,
    requestId: string,
    behavior: "allow" | "deny",
  ): Promise<unknown> | unknown;
  onCancelTask?(taskId: string): Promise<unknown> | unknown;
}

function columnBadgeColors(
  column: GlobalTaskColumn,
  t: Palette,
  dark: boolean,
): { bg: string; fg: string } {
  switch (column) {
    case "queued":
      return dark ? { bg: "#3a352d", fg: "#cfc7b2" } : { bg: "#e8e4d8", fg: "#3f3f46" };
    case "running":
      return dark ? { bg: "#2c4a5e", fg: "#cfe3f5" } : { bg: "#b8d4ee", fg: "#1d5c8a" };
    case "needs_action":
      return { bg: t.badgePink, fg: t.onPink };
    case "done":
      return dark ? { bg: "#3a5c42", fg: "#b9e6c2" } : { bg: "#9ed0a2", fg: "#1d5c2a" };
  }
}

function statusBadgeColors(
  item: GlobalTaskItem,
  t: Palette,
  dark: boolean,
): { bg: string; fg: string } {
  if (item.column === "needs_action") {
    return { bg: t.badgePink, fg: t.onPink };
  }
  if (item.status === "failed") {
    return { bg: t.badgeRed, fg: t.textPrimary };
  }
  if (item.budgetStopped || item.status === "cancelled") {
    return { bg: t.badgeAmber, fg: t.textPrimary };
  }
  return columnBadgeColors(item.column, t, dark);
}

function resolveActionPillColors(
  t: Palette,
  hovered: boolean,
  accent: boolean,
  danger: boolean,
): { bg: string; fg: string; border: string } {
  if (accent) {
    return {
      bg: hovered ? t.brandAccentHover : t.brandAccent,
      fg: t.onAccent,
      border: t.retroBorder,
    };
  }
  if (danger) {
    return {
      bg: t.badgeRed,
      fg: t.destructive,
      border: t.destructive,
    };
  }
  return {
    bg: hovered ? t.surfaceHover : t.surfacePrimary,
    fg: t.textPrimary,
    border: t.retroBorder,
  };
}

function ActionPill({
  testID,
  label,
  accent = false,
  danger = false,
  disabled = false,
  onPress,
  children,
}: {
  testID?: string;
  label: string;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress(): void;
  children: ReactNode;
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
        const colors = resolveActionPillColors(t, hovered, accent, danger);
        return [
          {
            minHeight: 28,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.bg,
            paddingHorizontal: 10,
            justifyContent: "center",
            alignItems: "center",
            opacity: disabled ? 0.45 : 1,
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
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

export interface GlobalTaskCardHandlers {
  onApprove(item: GlobalTaskItem): void;
  onDeny(item: GlobalTaskItem): void;
  onCancel(item: GlobalTaskItem): void;
  onOpenTask(item: GlobalTaskItem): void;
  onOpenChat(item: GlobalTaskItem): void;
  onOpenInStudio(item: GlobalTaskItem): void;
}

function GlobalTaskCard({
  item,
  busyKey,
  handlers,
}: {
  item: GlobalTaskItem;
  busyKey: string | null;
  handlers: GlobalTaskCardHandlers;
}) {
  const { palette: t, name } = useTheme();
  const dark = name === "dark";
  const statusColors = statusBadgeColors(item, t, dark);
  const busyApprove = busyKey === `perm:${item.id}:allow` || busyKey === `perm:${item.id}:deny`;
  const busyCancel = busyKey === `cancel:${item.id}` || Boolean(item.cancelPending);
  const borderColor = item.column === "needs_action" ? t.warning : t.retroBorder;
  const sourceBg = item.sourceType === "dm" ? t.badgeBlue : t.surfacePrimary;

  return (
    <View
      testID={`global-task-card-${item.id}`}
      style={[
        {
          borderRadius: 12,
          borderWidth: 1,
          borderColor,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 8,
        },
        ctrlShadow(t, name),
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <View
          testID={`global-task-source-${item.id}`}
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: sourceBg,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={type(t.textPrimary, 10, { fontWeight: "700" })}>{item.sourceLabel}</Text>
        </View>
        <View
          testID={`global-task-status-${item.id}`}
          style={{
            borderRadius: 8,
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
      </View>

      <Text
        testID={`global-task-title-${item.id}`}
        style={type(t.textPrimary, 13, { fontWeight: "800" })}
      >
        {item.title}
      </Text>

      {item.summary ? (
        <Text numberOfLines={2} style={type(t.textSecondary, 12)}>
          {item.summary}
        </Text>
      ) : null}

      {item.error && item.error !== item.summary ? (
        <Text accessibilityRole="alert" style={type(t.destructive, 11, { fontWeight: "600" })}>
          {item.error}
        </Text>
      ) : null}

      {item.canApprove && item.approval ? (
        <View
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.warning,
            backgroundColor: t.surfacePrimary,
            padding: 8,
            gap: 4,
          }}
        >
          <Text style={type(t.textMuted, 10, { fontWeight: "800", textTransform: "uppercase" })}>
            Approval needed
          </Text>
          <Text style={type(t.textPrimary, 12)}>{item.approval.title}</Text>
        </View>
      ) : null}

      <GlobalTaskCardMeta item={item} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
        {item.canApprove ? (
          <>
            <ActionPill
              testID={`global-task-approve-${item.id}`}
              label="Approve task permission"
              accent
              disabled={busyApprove}
              onPress={() => handlers.onApprove(item)}
            >
              Approve
            </ActionPill>
            <ActionPill
              testID={`global-task-deny-${item.id}`}
              label="Deny task permission"
              danger
              disabled={busyApprove}
              onPress={() => handlers.onDeny(item)}
            >
              Deny
            </ActionPill>
          </>
        ) : null}

        {item.canCancel ? (
          <ActionPill
            testID={`global-task-cancel-${item.id}`}
            label="Cancel task"
            danger
            disabled={busyCancel}
            onPress={() => handlers.onCancel(item)}
          >
            {busyCancel ? "Cancelling…" : "Cancel"}
          </ActionPill>
        ) : null}

        <ActionPill
          testID={`global-task-open-${item.id}`}
          label="View Process / Details"
          onPress={() => handlers.onOpenTask(item)}
        >
          View Process
        </ActionPill>

        <ActionPill
          testID={`global-task-chat-${item.id}`}
          label="Open Chat"
          onPress={() => handlers.onOpenChat(item)}
        >
          Open Chat
        </ActionPill>

        <ActionPill
          testID={`global-task-studio-${item.id}`}
          label="Open in Studio"
          onPress={() => handlers.onOpenInStudio(item)}
        >
          Open in Studio
        </ActionPill>
      </View>
    </View>
  );
}

function GlobalTaskCardMeta({ item }: { item: GlobalTaskItem }) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <AgentAvatar
          seed={`${item.assistantId}:${item.assistantName}`}
          label={item.assistantName}
          size={20}
          theme={t}
          name={name}
        />
        <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
          {`@${item.assistantName}`}
        </Text>
      </View>

      <View
        style={{
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfacePrimary,
          paddingHorizontal: 6,
          paddingVertical: 2,
          maxWidth: "100%",
        }}
      >
        <Text numberOfLines={1} style={type(t.textSecondary, 10, { fontWeight: "600" })}>
          {`${item.hostLabel} · ${item.directory}`}
        </Text>
      </View>

      {item.budgetLabel ? (
        <View
          style={{
            borderRadius: 6,
            borderWidth: 1,
            borderColor: item.budgetStopped ? t.warning : t.retroBorderLight,
            backgroundColor: item.budgetStopped ? t.badgeAmber : t.surfacePrimary,
            paddingHorizontal: 6,
            paddingVertical: 2,
          }}
        >
          <Text style={type(t.textSecondary, 10, { fontWeight: "700" })}>{item.budgetLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ViewToggleButton({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityLabel={`${label} view`}
      accessibilityState={{ selected }}
      onPress={onPress}
      {...selectedFillProps(selected)}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        const bg = selected
          ? hovered
            ? t.surfaceHover
            : t.brandAccentSoft
          : hovered
            ? t.surfaceHover
            : t.surfaceSecondary;
        return [
          {
            height: 30,
            borderRadius: 10,
            borderWidth: selected ? 1 : 0,
            borderColor: selected ? t.retroBorder : "transparent",
            backgroundColor: bg,
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

function GlobalTasksHeader({
  compact,
  grouped,
  view,
  onViewChange,
  onNewTask,
  onSidebar,
}: {
  compact: boolean;
  grouped: GlobalTasksResult;
  view: "board" | "list";
  onViewChange(view: "board" | "list"): void;
  onNewTask(): void;
  onSidebar?(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      testID="global-tasks-header"
      style={{
        minHeight: 56,
        backgroundColor: t.surfacePrimary,
        paddingHorizontal: compact ? 10 : 14,
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 160 }}>
        {onSidebar ? (
          <HeaderIconButton label="Open sidebar" onPress={onSidebar} size={34}>
            <MenuIcon color={t.textSecondary} size={16} />
          </HeaderIconButton>
        ) : null}
        <View
          style={[
            {
              width: 34,
              height: 34,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              alignItems: "center",
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <BriefcaseIcon color={t.textPrimary} size={16} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text role="heading" style={type(t.textPrimary, 16, { fontWeight: "800" })}>
              Tasks
            </Text>
            <View
              testID="global-tasks-counts-badge"
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: grouped.openCount > 0 ? t.brandAccentSoft : t.surfaceElevated,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
                {`${grouped.openCount} active · ${grouped.totalCount} total`}
              </Text>
            </View>
            {grouped.needsActionCount > 0 ? (
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.badgePink,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text style={type(t.onPink, 10, { fontWeight: "800" })}>
                  {`${grouped.needsActionCount} needs action`}
                </Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={1} style={type(t.textSecondary, 11, { marginTop: 1 })}>
            {`${grouped.queuedCount} queued · ${grouped.runningCount} running · ${grouped.needsActionCount} needs action · ${grouped.doneCount} done`}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <ViewToggleButton
          testID="global-tasks-view-board"
          label="Board"
          selected={view === "board"}
          onPress={() => onViewChange("board")}
        />
        <ViewToggleButton
          testID="global-tasks-view-list"
          label="List"
          selected={view === "list"}
          onPress={() => onViewChange("list")}
        />
        <Pressable
          testID="global-tasks-new-btn"
          role="button"
          accessibilityLabel="New Task"
          onPress={onNewTask}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              {
                height: 30,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.brandAccentHover : t.brandAccent,
                paddingHorizontal: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                ...webTransition("background-color 120ms ease"),
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <PlusIcon color={t.onAccent} size={12} />
          <Text style={type(t.onAccent, 11, { fontWeight: "800" })}>+ New Task</Text>
        </Pressable>
      </View>
    </View>
  );
}

function GlobalTasksFilterBar({
  compact,
  query,
  onQueryChange,
  sourceType,
  onSourceTypeChange,
  assistantId,
  onAssistantIdChange,
  assistantOptions,
  serverId,
  onServerIdChange,
  machineOptions,
  columnFilter,
  onColumnFilterChange,
}: {
  compact: boolean;
  query: string;
  onQueryChange(value: string): void;
  sourceType: GlobalTaskSourceFilter;
  onSourceTypeChange(value: GlobalTaskSourceFilter): void;
  assistantId: string;
  onAssistantIdChange(value: string): void;
  assistantOptions: Array<{ value: string; label: string }>;
  serverId: string;
  onServerIdChange(value: string): void;
  machineOptions: Array<{ value: string; label: string }>;
  columnFilter: "all" | GlobalTaskColumn;
  onColumnFilterChange(value: "all" | GlobalTaskColumn): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: t.dividerLine,
        backgroundColor: t.surfacePrimary,
        paddingHorizontal: compact ? 10 : 14,
        paddingVertical: 8,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <EditingTextInput
            testID="global-tasks-search"
            accessibilityLabel="Search tasks"
            placeholder="Search tasks, goals, directories, @assistant, #chat…"
            placeholderTextColor={t.textSubtle}
            initialValue={query}
            onChangeText={onQueryChange}
            style={[
              type(t.textPrimary, 12),
              {
                minHeight: 32,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.surfaceElevated,
                paddingHorizontal: 10,
                paddingVertical: 5,
              },
            ]}
          />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {SOURCE_PILLS.map((pill) => {
            const selected = sourceType === pill.id;
            return (
              <Pressable
                key={pill.id}
                testID={`global-tasks-source-${pill.id}`}
                role="button"
                accessibilityLabel={`Filter source ${pill.label}`}
                accessibilityState={{ selected }}
                onPress={() => onSourceTypeChange(pill.id)}
                {...selectedFillProps(selected)}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  const bg = selected
                    ? hovered
                      ? t.surfaceHover
                      : t.brandAccentSoft
                    : hovered
                      ? t.surfaceHover
                      : t.surfaceSecondary;
                  return [
                    {
                      minHeight: 32,
                      borderRadius: 999,
                      borderWidth: selected ? 1 : 0,
                      borderColor: selected ? t.retroBorder : "transparent",
                      backgroundColor: bg,
                      paddingHorizontal: 11,
                      justifyContent: "center",
                      ...webTransition("background-color 120ms ease"),
                    },
                    selected ? ctrlShadow(t, name) : null,
                  ];
                }}
              >
                <Text
                  style={type(selected ? t.textPrimary : t.textSecondary, 11, {
                    fontWeight: "700",
                  })}
                >
                  {pill.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ minWidth: 150 }}>
          <OptionSelect
            testID="global-tasks-filter-assistant"
            label="Assistant"
            value={assistantId}
            options={assistantOptions}
            onSelect={onAssistantIdChange}
          />
        </View>

        <View style={{ minWidth: 150 }}>
          <OptionSelect
            testID="global-tasks-filter-machine"
            label="Machine"
            value={serverId}
            options={machineOptions}
            onSelect={onServerIdChange}
          />
        </View>

        <View style={{ minWidth: 140 }}>
          <OptionSelect
            testID="global-tasks-filter-column"
            label="Column"
            value={columnFilter}
            options={COLUMN_FILTER_OPTIONS}
            onSelect={(val) => onColumnFilterChange(val as "all" | GlobalTaskColumn)}
          />
        </View>
      </View>
    </View>
  );
}

function GlobalTaskColumnView({
  col,
  items,
  stacked,
  canToggleDone,
  doneCollapsed,
  onToggleDone,
  busyKey,
  handlers,
}: {
  col: GlobalTaskColumn;
  items: GlobalTaskItem[];
  stacked: boolean;
  canToggleDone: boolean;
  doneCollapsed: boolean;
  onToggleDone(): void;
  busyKey: string | null;
  handlers: GlobalTaskCardHandlers;
}) {
  const { palette: t, name } = useTheme();
  const dark = name === "dark";
  const meta = COLUMN_META[col];
  const badge = columnBadgeColors(col, t, dark);
  const isCollapsed = canToggleDone && doneCollapsed;
  const preview = items.slice(0, 3);

  return (
    <View
      testID={`global-tasks-col-${col}`}
      style={[
        {
          flex: stacked ? undefined : 1,
          minWidth: 0,
          minHeight: stacked || isCollapsed ? undefined : 0,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfacePrimary,
          overflow: "hidden",
        },
        ctrlShadow(t, name),
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfaceElevated,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <View
            style={{
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: badge.bg,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text
              style={type(badge.fg, 10, {
                fontWeight: "800",
                textTransform: "uppercase",
              })}
            >
              {meta.label}
            </Text>
          </View>
          <Text style={type(t.textMuted, 11, { fontWeight: "700" })}>{`${items.length}`}</Text>
        </View>

        {canToggleDone ? (
          <Pressable
            testID="global-tasks-toggle-done"
            role="button"
            accessibilityLabel={doneCollapsed ? "Show Done" : "Hide Done"}
            accessibilityState={{ expanded: !doneCollapsed }}
            onPress={onToggleDone}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return {
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.surfaceHover : t.surfacePrimary,
                paddingHorizontal: 8,
                paddingVertical: 3,
              };
            }}
          >
            <ChevronIcon color={t.textSecondary} size={10} down={!doneCollapsed} />
            <Text
              style={type(t.textSecondary, 10, {
                fontWeight: "800",
                textTransform: "uppercase",
              })}
            >
              {doneCollapsed ? "Show" : "Hide"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isCollapsed ? (
        <View
          testID="global-tasks-done-collapsed"
          style={{
            margin: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: t.retroBorder,
            padding: 10,
            gap: 4,
          }}
        >
          <Text style={type(t.textSecondary, 12, { fontWeight: "700" })}>
            {`${items.length} ${items.length === 1 ? "task" : "tasks"} hidden`}
          </Text>
          {preview.map((taskItem) => (
            <Text key={taskItem.id} numberOfLines={1} style={type(t.textMuted, 11)}>
              {`${taskItem.sourceLabel} · ${taskItem.title}`}
            </Text>
          ))}
        </View>
      ) : (
        <ColumnCardList
          items={items}
          emptyLabel={meta.emptyLabel}
          stacked={stacked}
          busyKey={busyKey}
          handlers={handlers}
        />
      )}
    </View>
  );
}

function ColumnCardList({
  items,
  emptyLabel,
  stacked,
  busyKey,
  handlers,
}: {
  items: GlobalTaskItem[];
  emptyLabel: string;
  stacked: boolean;
  busyKey: string | null;
  handlers: GlobalTaskCardHandlers;
}) {
  const { palette: t } = useTheme();
  const body =
    items.length === 0 ? (
      <Text style={type(t.textSubtle, 11, { padding: 4 })}>{emptyLabel}</Text>
    ) : (
      items.map((item) => (
        <GlobalTaskCard key={item.id} item={item} busyKey={busyKey} handlers={handlers} />
      ))
    );

  if (stacked) {
    return <View style={{ padding: 8, gap: 8 }}>{body}</View>;
  }
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: t.surfacePrimary }}>
      <ScrollView contentContainerStyle={{ padding: 8, gap: 8, flexGrow: 1 }}>{body}</ScrollView>
    </View>
  );
}

function GlobalTasksBody({
  view,
  phoneBoard,
  desktopBoard,
  columnFilter,
  visibleColumns,
  grouped,
  doneCollapsed,
  onToggleDone,
  busyKey,
  handlers,
}: {
  view: "board" | "list";
  phoneBoard: boolean;
  desktopBoard: boolean;
  columnFilter: "all" | GlobalTaskColumn;
  visibleColumns: readonly GlobalTaskColumn[];
  grouped: GlobalTasksResult;
  doneCollapsed: boolean;
  onToggleDone(): void;
  busyKey: string | null;
  handlers: GlobalTaskCardHandlers;
}) {
  const { palette: t } = useTheme();
  const renderCol = (col: GlobalTaskColumn, stacked: boolean) => (
    <GlobalTaskColumnView
      key={col}
      col={col}
      items={grouped.columns[col]}
      stacked={stacked}
      canToggleDone={col === "done" && columnFilter === "all"}
      doneCollapsed={doneCollapsed}
      onToggleDone={onToggleDone}
      busyKey={busyKey}
      handlers={handlers}
    />
  );

  if (view === "list") {
    return (
      <View
        testID="global-tasks-list"
        style={{ flex: 1, minHeight: 0, backgroundColor: t.chatSurface }}
      >
        <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
          {grouped.items.length === 0 ? (
            <Text style={type(t.textMuted, 13, { textAlign: "center", paddingVertical: 24 })}>
              No tasks match the current filters.
            </Text>
          ) : (
            grouped.items.map((item) => (
              <GlobalTaskCard key={item.id} item={item} busyKey={busyKey} handlers={handlers} />
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  if (phoneBoard) {
    return (
      <View
        testID="global-tasks-board"
        style={{ flex: 1, minHeight: 0, backgroundColor: t.chatSurface }}
      >
        <ScrollView contentContainerStyle={{ padding: 10, gap: 10 }}>
          {visibleColumns.map((col) => renderCol(col, true))}
        </ScrollView>
      </View>
    );
  }

  if (!desktopBoard && columnFilter === "all") {
    return (
      <View
        testID="global-tasks-board"
        style={{
          flex: 1,
          minHeight: 0,
          padding: 10,
          gap: 10,
          backgroundColor: t.chatSurface,
        }}
      >
        {TABLET_COLUMN_PAIRS.map((pair) => (
          <View
            key={pair.join("-")}
            style={{ flex: 1, minHeight: 0, flexDirection: "row", gap: 10 }}
          >
            {pair.map((col) => renderCol(col, false))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View
      testID="global-tasks-board"
      style={{
        flex: 1,
        minHeight: 0,
        flexDirection: "row",
        gap: 10,
        padding: 10,
        backgroundColor: t.chatSurface,
      }}
    >
      {visibleColumns.map((col) => renderCol(col, false))}
    </View>
  );
}

function buildMachineOptions(
  machines: readonly MachineInfo[],
  hostLabels: Record<string, string>,
  tasks: readonly GlobalTaskRecord[],
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const machine of machines) {
    seen.set(machine.serverId, machine.label || hostLabels[machine.serverId] || machine.serverId);
  }
  for (const [id, label] of Object.entries(hostLabels)) {
    if (!seen.has(id)) seen.set(id, label || id);
  }
  for (const task of tasks) {
    if (task.serverId && !seen.has(task.serverId)) {
      seen.set(task.serverId, hostLabels[task.serverId] ?? task.serverId);
    }
  }
  return [
    { value: "all", label: "All machines" },
    ...[...seen.entries()].map(([id, label]) => ({
      value: id,
      label,
    })),
  ];
}

function resolveDefaultModalConversation(
  conversations: readonly Conversation[],
  assistants: readonly Assistant[],
  activeConversationId?: string,
): Conversation | null {
  if (activeConversationId) {
    const found = conversations.find((c) => c.id === activeConversationId);
    if (found) return found;
  }
  if (conversations[0]) return conversations[0];
  if (assistants[0]) {
    return {
      id: `dm:${assistants[0].id}`,
      name: assistants[0].name,
      members: [assistants[0].id],
      kind: "dm",
      roundtable: false,
    };
  }
  return null;
}

function resolvePaneCollections(props: GlobalTasksPaneProps) {
  const state = props.data?.state;
  return {
    tasks: props.tasks ?? state?.tasks ?? EMPTY_TASKS,
    assistants: props.assistants ?? state?.assistants ?? EMPTY_ASSISTANTS,
    conversations: props.conversations ?? state?.conversations ?? EMPTY_CONVERSATIONS,
    machines: props.machines ?? EMPTY_MACHINES,
    hostLabels: props.hostLabels ?? EMPTY_HOST_LABELS,
    sidebarHandler: props.onSidebar ?? props.onOpenSidebar,
  };
}

function resolveBoardLayout(width: number, compactProp?: boolean) {
  const compact = compactProp ?? width < phoneHeaderBreakpoint;
  const phoneBoard = width < phoneHeaderBreakpoint || Boolean(compactProp);
  const desktopBoard = width >= compactBreakpoint && !compactProp;
  return { compact, phoneBoard, desktopBoard };
}

export function GlobalTasksPane(props: GlobalTasksPaneProps) {
  const {
    data,
    activeConversationId,
    defaultDirectory,
    onCreateTask,
    onOpenTask,
    onOpenChat,
    onOpenConversation,
    onOpenInStudio,
    onRespondPermission,
    onCancelTask,
  } = props;
  const { palette: t } = useTheme();
  const { width } = useWindowDimensions();
  const { compact, phoneBoard, desktopBoard } = resolveBoardLayout(width, props.compact);
  const { tasks, assistants, conversations, machines, hostLabels, sidebarHandler } =
    resolvePaneCollections(props);

  const [view, setView] = useState<"board" | "list">("board");
  const [sourceType, setSourceType] = useState<GlobalTaskSourceFilter>("all");
  const [assistantId, setAssistantId] = useState<string>("all");
  const [serverId, setServerId] = useState<string>("all");
  const [columnFilter, setColumnFilter] = useState<"all" | GlobalTaskColumn>("all");
  const [query, setQuery] = useState<string>("");
  const [doneCollapsed, setDoneCollapsed] = useState<boolean>(false);
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(
    () =>
      filterAndGroupGlobalTasks(
        {
          tasks,
          assistants,
          conversations,
          hostLabels,
        },
        {
          sourceType,
          assistantId,
          serverId,
          column: columnFilter,
          query,
        },
      ),
    [
      assistantId,
      assistants,
      columnFilter,
      conversations,
      hostLabels,
      query,
      serverId,
      sourceType,
      tasks,
    ],
  );

  const assistantOptions = useMemo(
    () => [
      { value: "all", label: "All assistants" },
      ...assistants.map((assistant) => ({
        value: assistant.id,
        label: `@${assistant.name}`,
      })),
    ],
    [assistants],
  );

  const machineOptions = useMemo(
    () => buildMachineOptions(machines, hostLabels, tasks),
    [hostLabels, machines, tasks],
  );

  const runAction = useCallback(async (key: string, action: () => Promise<unknown>) => {
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusyKey((current) => (current === key ? null : current));
    }
  }, []);

  const handleRespondPermission = useCallback(
    (item: GlobalTaskItem, behavior: "allow" | "deny") => {
      const requestId = item.approval?.requestId ?? item.pendingPermission?.requestId ?? item.id;
      void runAction(`perm:${item.id}:${behavior}`, async () => {
        if (onRespondPermission) {
          await onRespondPermission(item.id, requestId, behavior);
          return;
        }
        if (data?.call) {
          await data.call(respondTaskPermission, {
            taskId: item.id,
            requestId,
            behavior,
          });
        }
      });
    },
    [data, onRespondPermission, runAction],
  );

  const handleCancel = useCallback(
    (item: GlobalTaskItem) => {
      void runAction(`cancel:${item.id}`, async () => {
        if (onCancelTask) {
          await onCancelTask(item.id);
          return;
        }
        if (data?.call) {
          await data.call(cancelTask, { id: item.id });
        }
      });
    },
    [data, onCancelTask, runAction],
  );

  const cardHandlers = useMemo<GlobalTaskCardHandlers>(
    () => ({
      onApprove: (item) => handleRespondPermission(item, "allow"),
      onDeny: (item) => handleRespondPermission(item, "deny"),
      onCancel: handleCancel,
      onOpenTask: (item) => {
        const handler = onOpenTask ?? onOpenInStudio;
        if (handler) {
          handler(item.task as Task);
          return;
        }
        (onOpenChat ?? onOpenConversation)?.(item.conversationId, item.threadId);
      },
      onOpenChat: (item) => {
        (onOpenChat ?? onOpenConversation)?.(item.conversationId, item.threadId);
      },
      onOpenInStudio: (item) => {
        (onOpenInStudio ?? onOpenTask)?.(item.task as Task);
      },
    }),
    [
      handleCancel,
      handleRespondPermission,
      onOpenChat,
      onOpenConversation,
      onOpenInStudio,
      onOpenTask,
    ],
  );

  const handleNewTaskPress = useCallback(() => {
    if (onCreateTask) {
      onCreateTask();
      return;
    }
    setCreateModalOpen(true);
  }, [onCreateTask]);

  const targetConversation = useMemo(
    () => resolveDefaultModalConversation(conversations, assistants, activeConversationId),
    [activeConversationId, assistants, conversations],
  );

  const syntheticMessage = useMemo<Message>(
    () => ({
      id: "global-tasks-new-draft",
      conversationId: targetConversation?.id ?? "default",
      threadId: null,
      senderId: "user",
      content: "",
      createdAt: 0,
      taskId: null,
    }),
    [targetConversation?.id],
  );

  const visibleColumns = useMemo(
    () =>
      columnFilter === "all"
        ? GLOBAL_TASK_COLUMNS
        : GLOBAL_TASK_COLUMNS.filter((col) => col === columnFilter),
    [columnFilter],
  );

  const toggleDone = useCallback(() => setDoneCollapsed((prev) => !prev), []);

  return (
    <View
      testID="global-tasks-pane"
      style={{ flex: 1, minHeight: 0, overflow: "hidden", backgroundColor: t.chatSurface }}
    >
      <GlobalTasksHeader
        compact={compact}
        grouped={grouped}
        view={view}
        onViewChange={setView}
        onNewTask={handleNewTaskPress}
        onSidebar={sidebarHandler}
      />

      <GlobalTasksFilterBar
        compact={compact}
        query={query}
        onQueryChange={setQuery}
        sourceType={sourceType}
        onSourceTypeChange={setSourceType}
        assistantId={assistantId}
        onAssistantIdChange={setAssistantId}
        assistantOptions={assistantOptions}
        serverId={serverId}
        onServerIdChange={setServerId}
        machineOptions={machineOptions}
        columnFilter={columnFilter}
        onColumnFilterChange={setColumnFilter}
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

      <GlobalTasksBody
        view={view}
        phoneBoard={phoneBoard}
        desktopBoard={desktopBoard}
        columnFilter={columnFilter}
        visibleColumns={visibleColumns}
        grouped={grouped}
        doneCollapsed={doneCollapsed}
        onToggleDone={toggleDone}
        busyKey={busyKey}
        handlers={cardHandlers}
      />

      {createModalOpen && targetConversation ? (
        <PromoteToTaskModal
          message={syntheticMessage}
          conversation={targetConversation}
          assistants={assistants}
          machines={machines}
          defaultDirectory={defaultDirectory}
          data={data}
          onClose={() => setCreateModalOpen(false)}
        />
      ) : null}
    </View>
  );
}
