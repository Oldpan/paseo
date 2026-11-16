import { randomUUID } from "expo-crypto";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRetainedPanelActive } from "@/components/retained-panel";
import {
  cancelTakeover,
  cancelTask,
  cancelTurn,
  deleteRoutine,
  pauseRoutine,
  resolveTakeover,
  respondTaskPermission,
  resumeRoutine,
  runRoutineOnce,
  sendMessage,
  type Takeover,
  type Task,
  type Turn,
} from "../../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "../data";
import type {
  InboxActionItem,
  InboxActivityItem,
  InboxState,
  InboxSuggestionItem,
  InboxUpcomingItem,
} from "../inbox";
import { filterSavedMessages } from "../saved-messages";
import { BrowserTakeoverModal, TakeoverCard } from "./BrowserTakeoverModal";
import { HeaderIconButton } from "./ChatChrome";
import { MenuIcon } from "./icons";
import { SavedMessagesPane } from "./SavedMessagesPane";
import { ctrlShadow, selectedFillProps, text as type, webTransition, type Palette } from "./theme";
import { useTheme } from "./ThemeProvider";

type InboxFilter = "all" | "needs_action" | "activity" | "upcoming" | "suggestions" | "saved";

export interface InboxPaneProps {
  data: Pick<PavraData, "call" | "connected"> & Partial<Pick<PavraData, "state">>;
  inbox: InboxState;
  compact?: boolean;
  onOpenConversation(conversationId: string, threadId: string | null, messageId?: string): void;
  onOpenTask(task: Task): void;
  onOpenTurn(turn: Turn): void;
  onSidebar?(): void;
}

function formatShortTime(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function taskEventBadgeLabel(eventType: string): string {
  switch (eventType) {
    case "task_completed":
      return "completed";
    case "task_failed":
      return "failed";
    case "task_cancelled":
      return "cancelled";
    case "task_budget":
      return "budget";
    case "task_workers_capped":
      return "workers capped";
    default:
      return eventType.replace(/^task_/, "");
  }
}

function badgeColors(
  tone: "urgent" | "ok" | "bad" | "amber" | "blue" | "neutral",
  t: Palette,
): { bg: string; fg: string } {
  switch (tone) {
    case "urgent":
      return { bg: t.badgePink, fg: t.onPink };
    case "ok":
      return { bg: t.badgeGreen, fg: t.textPrimary };
    case "bad":
      return { bg: t.badgeRed, fg: t.textPrimary };
    case "amber":
      return { bg: t.badgeAmber, fg: t.textPrimary };
    case "blue":
      return { bg: t.badgeBlue, fg: t.textPrimary };
    default:
      return { bg: t.surfacePrimary, fg: t.textSecondary };
  }
}

function InboxBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "urgent" | "ok" | "bad" | "amber" | "blue" | "neutral";
}) {
  const { palette: t } = useTheme();
  const colors = badgeColors(tone, t);
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: colors.bg,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={type(colors.fg, 10, { fontWeight: "700" })}>{label}</Text>
    </View>
  );
}

function InboxActionButton({
  children,
  label,
  testID,
  accent = false,
  disabled = false,
  onPress,
}: {
  children: ReactNode;
  label?: string;
  testID?: string;
  accent?: boolean;
  disabled?: boolean;
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
        return [
          {
            minHeight: 28,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: accent
              ? hovered
                ? t.brandAccentHover
                : t.brandAccent
              : hovered
                ? t.surfaceHover
                : t.surfacePrimary,
            paddingHorizontal: 11,
            justifyContent: "center",
            opacity: disabled ? 0.45 : 1,
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <Text style={type(accent ? t.onAccent : t.textPrimary, 11, { fontWeight: "600" })}>
        {children}
      </Text>
    </Pressable>
  );
}

function SectionFrame({
  testID,
  title,
  count,
  emptyText,
  children,
}: {
  testID: string;
  title: string;
  count: number;
  emptyText: string;
  children: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          borderRadius: 14,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceSecondary,
          padding: 14,
          gap: 10,
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
        }}
      >
        <Text style={type(t.textPrimary, 14, { fontWeight: "800" })}>{title}</Text>
        <View
          style={{
            minWidth: 22,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: count > 0 ? t.brandAccent : t.surfaceElevated,
            paddingHorizontal: 7,
            paddingVertical: 1,
            alignItems: "center",
          }}
        >
          <Text style={type(count > 0 ? t.onAccent : t.textSecondary, 11, { fontWeight: "700" })}>
            {count}
          </Text>
        </View>
      </View>
      {count === 0 ? (
        <Text style={type(t.textMuted, 12)}>{emptyText}</Text>
      ) : (
        <View style={{ gap: 10 }}>{children}</View>
      )}
    </View>
  );
}

export function InboxPane({
  data,
  inbox,
  compact = false,
  onOpenConversation,
  onOpenTask,
  onOpenTurn,
  onSidebar,
}: InboxPaneProps) {
  const { palette: t, name } = useTheme();
  const panelActive = useRetainedPanelActive();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTakeover, setActiveTakeover] = useState<{
    takeover: Takeover;
    assistantName: string;
  } | null>(null);

  const runAction = useCallback(async (key: string, work: () => Promise<unknown>) => {
    setBusyKey(key);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusyKey((current) => (current === key ? null : current));
    }
  }, []);

  const handleRespondPermission = useCallback(
    (taskId: string, requestId: string | null, behavior: "allow" | "deny") => {
      if (!requestId) return;
      void runAction(`perm:${taskId}:${behavior}`, () =>
        data.call(respondTaskPermission, { taskId, requestId, behavior }),
      );
    },
    [data, runAction],
  );

  const handleCancelTurn = useCallback(
    (turnId: string) => {
      void runAction(`turn-cancel:${turnId}`, () => data.call(cancelTurn, { id: turnId }));
    },
    [data, runAction],
  );

  const handleResolveTakeover = useCallback(
    (takeoverId: string) => {
      void runAction(`takeover-resolve:${takeoverId}`, () =>
        data.call(resolveTakeover, { id: takeoverId }),
      );
    },
    [data, runAction],
  );

  const handleCancelTakeover = useCallback(
    (takeoverId: string) => {
      void runAction(`takeover-cancel:${takeoverId}`, () =>
        data.call(cancelTakeover, { id: takeoverId }),
      );
    },
    [data, runAction],
  );

  const handleOpenTakeover = useCallback((takeover: Takeover, assistantName: string) => {
    setActiveTakeover({ takeover, assistantName });
  }, []);

  const handleContinueBudgetTask = useCallback(
    (item: Extract<InboxActionItem, { kind: "task_budget" }>) => {
      void runAction(`budget-continue:${item.taskId}`, () =>
        data.call(sendMessage, {
          id: randomUUID(),
          conversationId: item.conversationId,
          threadId: item.threadId,
          content: "Continue.",
        }),
      );
    },
    [data, runAction],
  );

  const handleCancelTask = useCallback(
    (taskId: string) => {
      void runAction(`task-cancel:${taskId}`, () => data.call(cancelTask, { id: taskId }));
    },
    [data, runAction],
  );

  const handleRunRoutine = useCallback(
    (routineId: string) => {
      void runAction(`routine-run:${routineId}`, () =>
        data.call(runRoutineOnce, { id: routineId }),
      );
    },
    [data, runAction],
  );

  const handlePauseRoutine = useCallback(
    (routineId: string) => {
      void runAction(`routine-pause:${routineId}`, () =>
        data.call(pauseRoutine, { id: routineId }),
      );
    },
    [data, runAction],
  );

  const handleResumeRoutine = useCallback(
    (routineId: string) => {
      void runAction(`routine-resume:${routineId}`, () =>
        data.call(resumeRoutine, { id: routineId }),
      );
    },
    [data, runAction],
  );

  const handleDeleteRoutine = useCallback(
    (routineId: string) => {
      void runAction(`routine-delete:${routineId}`, () =>
        data.call(deleteRoutine, { id: routineId }),
      );
    },
    [data, runAction],
  );

  const savedCount = useMemo(
    () =>
      data.state
        ? filterSavedMessages({
            messages: data.state.messages,
            conversations: data.state.conversations,
            assistants: data.state.assistants,
          }).length
        : 0,
    [data.state],
  );

  const filters: Array<{ id: InboxFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "needs_action", label: `Needs action (${inbox.needsAction.length})` },
    { id: "activity", label: `Activity (${inbox.recentActivity.length})` },
    { id: "upcoming", label: `Upcoming (${inbox.upcoming.length})` },
    { id: "suggestions", label: `Suggestions (${inbox.suggestions.length})` },
    { id: "saved", label: `Saved (${savedCount})` },
  ];

  const showNeedsAction = filter === "all" || filter === "needs_action";
  const showActivity = filter === "all" || filter === "activity";
  const showUpcoming = filter === "all" || filter === "upcoming";
  const showSuggestions = filter === "all" || filter === "suggestions";

  return (
    <View
      testID="pavra-inbox-pane"
      style={{ flex: 1, minHeight: 0, backgroundColor: t.chatSurface }}
    >
      <View
        style={{
          minHeight: 56,
          backgroundColor: t.surfacePrimary,
          paddingHorizontal: 14,
          paddingVertical: 9,
          borderBottomWidth: 2,
          borderBottomColor: t.black,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          {compact && onSidebar ? (
            <HeaderIconButton label="Open sidebar" onPress={onSidebar} size={34}>
              <MenuIcon color={t.textSecondary} size={16} />
            </HeaderIconButton>
          ) : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              role="heading"
              numberOfLines={1}
              style={type(t.textPrimary, 15, { fontWeight: "800" })}
            >
              Inbox · 收件箱
            </Text>
            <Text numberOfLines={1} style={type(t.textSecondary, 11, { marginTop: 1 })}>
              Needs your action, recent activity, upcoming routines, and ledger suggestions
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {filters.map((item) => {
            const selected = filter === item.id;
            return (
              <Pressable
                key={item.id}
                testID={`inbox-filter-${item.id}`}
                role="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => setFilter(item.id)}
                {...selectedFillProps(selected)}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  return [
                    {
                      height: 30,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: t.retroBorder,
                      backgroundColor: selected
                        ? hovered
                          ? t.brandAccentHover
                          : t.brandAccent
                        : hovered
                          ? t.surfaceHover
                          : t.surfaceElevated,
                      paddingHorizontal: 10,
                      justifyContent: "center",
                      ...webTransition("background-color 120ms ease"),
                    },
                    ctrlShadow(t, name),
                  ];
                }}
              >
                <Text
                  style={type(selected ? t.onAccent : t.textSecondary, 11, {
                    fontWeight: "600",
                  })}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <View
          style={{
            paddingHorizontal: 16,
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
            <Text style={type(t.textSecondary, 11, { fontWeight: "600", marginLeft: 8 })}>
              Dismiss
            </Text>
          </Pressable>
        </View>
      ) : null}

      {filter === "saved" && data.state && panelActive ? (
        <SavedMessagesPane
          data={{ state: data.state, call: data.call, connected: data.connected }}
          compact={compact}
          embedded
          onJumpToMessage={onOpenConversation}
          onSidebar={onSidebar}
        />
      ) : (
        <ScrollView
          style={{ flex: 1, minHeight: 0 }}
          contentContainerStyle={{ padding: 16, gap: 16 }}
        >
          {showNeedsAction ? (
            <SectionFrame
              testID="inbox-section-needs-action"
              title="Needs your action · 待你处理"
              count={inbox.needsAction.length}
              emptyText="Nothing waiting on you right now."
            >
              {inbox.needsAction.map((item) => (
                <NeedsActionCard
                  key={item.id}
                  item={item}
                  busyKey={busyKey}
                  onRespondPermission={handleRespondPermission}
                  onCancelTurn={handleCancelTurn}
                  onContinueBudgetTask={handleContinueBudgetTask}
                  onOpenTakeover={handleOpenTakeover}
                  onResolveTakeover={handleResolveTakeover}
                  onCancelTakeover={handleCancelTakeover}
                  onOpenConversation={onOpenConversation}
                  onOpenTask={onOpenTask}
                  onOpenTurn={onOpenTurn}
                />
              ))}
            </SectionFrame>
          ) : null}

          {showActivity ? (
            <SectionFrame
              testID="inbox-section-recent-activity"
              title="Recent activity · 最近动态"
              count={inbox.recentActivity.length}
              emptyText="No recent routine runs or task receipts yet."
            >
              {inbox.recentActivity.map((item) => (
                <RecentActivityCard
                  key={item.id}
                  item={item}
                  onOpenConversation={onOpenConversation}
                  onOpenTask={onOpenTask}
                />
              ))}
            </SectionFrame>
          ) : null}

          {showUpcoming ? (
            <SectionFrame
              testID="inbox-section-upcoming"
              title="Upcoming · 即将运行"
              count={inbox.upcoming.length}
              emptyText="No active routines or reminders scheduled."
            >
              {inbox.upcoming.map((item) => (
                <UpcomingRoutineCard
                  key={item.id}
                  item={item}
                  busyKey={busyKey}
                  onRunNow={handleRunRoutine}
                  onPause={handlePauseRoutine}
                  onOpenConversation={onOpenConversation}
                />
              ))}
            </SectionFrame>
          ) : null}

          {showSuggestions ? (
            <SectionFrame
              testID="inbox-section-suggestions"
              title="Suggestions · 建议"
              count={inbox.suggestions.length}
              emptyText="No stale tasks, failed turns, or paused routines found in the ledger."
            >
              {inbox.suggestions.map((item) => (
                <SuggestionCard
                  key={item.id}
                  item={item}
                  busyKey={busyKey}
                  onCancelTask={handleCancelTask}
                  onResumeRoutine={handleResumeRoutine}
                  onDeleteRoutine={handleDeleteRoutine}
                  onRunRoutine={handleRunRoutine}
                  onPauseRoutine={handlePauseRoutine}
                  onOpenConversation={onOpenConversation}
                  onOpenTurn={onOpenTurn}
                />
              ))}
            </SectionFrame>
          ) : null}
        </ScrollView>
      )}
      {activeTakeover ? (
        <BrowserTakeoverModal
          takeover={activeTakeover.takeover}
          assistantName={activeTakeover.assistantName}
          data={data}
          onClose={() => setActiveTakeover(null)}
        />
      ) : null}
    </View>
  );
}

function NeedsActionCard({
  item,
  busyKey,
  onRespondPermission,
  onCancelTurn,
  onContinueBudgetTask,
  onOpenTakeover,
  onResolveTakeover,
  onCancelTakeover,
  onOpenConversation,
  onOpenTask,
  onOpenTurn,
}: {
  item: InboxActionItem;
  busyKey: string | null;
  onRespondPermission(taskId: string, requestId: string | null, behavior: "allow" | "deny"): void;
  onCancelTurn(turnId: string): void;
  onContinueBudgetTask(item: Extract<InboxActionItem, { kind: "task_budget" }>): void;
  onOpenTakeover(takeover: Takeover, assistantName: string): void;
  onResolveTakeover(takeoverId: string): void;
  onCancelTakeover(takeoverId: string): void;
  onOpenConversation(conversationId: string, threadId: string | null): void;
  onOpenTask(task: Task): void;
  onOpenTurn(turn: Turn): void;
}) {
  const { palette: t } = useTheme();
  const contextLabel = `${item.assistantName} · ${item.conversationName}`;

  if (item.kind === "takeover") {
    const busy =
      busyKey === `takeover-resolve:${item.takeoverId}` ||
      busyKey === `takeover-cancel:${item.takeoverId}`;
    return (
      <TakeoverCard
        testID={`inbox-item-${item.id}`}
        takeover={item.takeover}
        assistantName={item.assistantName}
        conversationName={item.conversationName}
        busy={busy}
        onOpenTakeover={(takeover) => onOpenTakeover(takeover, item.assistantName)}
        onResolve={onResolveTakeover}
        onCancel={onCancelTakeover}
        onOpenConversation={onOpenConversation}
      />
    );
  }

  if (item.kind === "task_permission") {
    const busy = busyKey === `perm:${item.taskId}:allow` || busyKey === `perm:${item.taskId}:deny`;
    return (
      <View
        testID={`inbox-item-${item.id}`}
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <InboxBadge label="Approval required" tone="urgent" />
          <InboxBadge label={contextLabel} tone="blue" />
          <Text style={type(t.textMuted, 11, { marginLeft: "auto" })}>
            {formatShortTime(item.createdAt)}
          </Text>
        </View>
        <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.title}</Text>
        <Text style={type(t.textSecondary, 12)}>{item.permissionTitle}</Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {item.requestId ? (
            <>
              <InboxActionButton
                testID={`inbox-allow-${item.taskId}`}
                label="Allow permission"
                accent
                disabled={busy}
                onPress={() => onRespondPermission(item.taskId, item.requestId, "allow")}
              >
                Allow
              </InboxActionButton>
              <InboxActionButton
                testID={`inbox-deny-${item.taskId}`}
                label="Deny permission"
                disabled={busy}
                onPress={() => onRespondPermission(item.taskId, item.requestId, "deny")}
              >
                Deny
              </InboxActionButton>
            </>
          ) : null}
          <InboxActionButton
            label="Open task thread"
            onPress={() => onOpenConversation(item.conversationId, item.threadId)}
          >
            Open thread
          </InboxActionButton>
          {item.task.execution ? (
            <InboxActionButton label="Open task in Studio" onPress={() => onOpenTask(item.task)}>
              Studio
            </InboxActionButton>
          ) : null}
        </View>
      </View>
    );
  }

  if (item.kind === "turn_attention") {
    const busy = busyKey === `turn-cancel:${item.turnId}`;
    return (
      <View
        testID={`inbox-item-${item.id}`}
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <InboxBadge label="Turn waiting" tone="amber" />
          <InboxBadge label={contextLabel} tone="blue" />
          <Text style={type(t.textMuted, 11, { marginLeft: "auto" })}>
            {formatShortTime(item.createdAt)}
          </Text>
        </View>
        <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.title}</Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <InboxActionButton label="View process" accent onPress={() => onOpenTurn(item.turn)}>
            View process
          </InboxActionButton>
          <InboxActionButton
            label="Open chat"
            onPress={() => onOpenConversation(item.conversationId, item.threadId)}
          >
            Open chat
          </InboxActionButton>
          <InboxActionButton
            label="Cancel turn"
            disabled={busy}
            onPress={() => onCancelTurn(item.turnId)}
          >
            Cancel
          </InboxActionButton>
        </View>
      </View>
    );
  }

  const busy = busyKey === `budget-continue:${item.taskId}`;
  return (
    <View
      testID={`inbox-item-${item.id}`}
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceElevated,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <InboxBadge label="Budget reached" tone="amber" />
        <InboxBadge label={contextLabel} tone="blue" />
        <Text style={type(t.textMuted, 11, { marginLeft: "auto" })}>
          {formatShortTime(item.createdAt)}
        </Text>
      </View>
      <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.title}</Text>
      <Text style={type(t.textSecondary, 12)}>
        Time budget reached — reply in thread to continue
      </Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <InboxActionButton
          testID={`inbox-continue-${item.taskId}`}
          label="Continue task (+30m)"
          accent
          disabled={busy}
          onPress={() => onContinueBudgetTask(item)}
        >
          Continue (+30m)
        </InboxActionButton>
        <InboxActionButton
          label="Open task thread"
          onPress={() => onOpenConversation(item.conversationId, item.threadId)}
        >
          Open thread
        </InboxActionButton>
      </View>
    </View>
  );
}

function RecentActivityCard({
  item,
  onOpenConversation,
  onOpenTask,
}: {
  item: InboxActivityItem;
  onOpenConversation(conversationId: string, threadId: string | null): void;
  onOpenTask(task: Task): void;
}) {
  const { palette: t } = useTheme();
  const contextLabel = `${item.assistantName} · ${item.conversationName}`;

  if (item.kind === "routine_run") {
    const outcomeTone =
      item.outcome === "failed"
        ? "bad"
        : item.outcome === "replied"
          ? "ok"
          : item.outcome === "skipped"
            ? "amber"
            : "neutral";
    return (
      <View
        testID={`inbox-item-${item.id}`}
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <InboxBadge label={item.isReminder ? "Reminder" : "Routine"} tone="blue" />
          <InboxBadge label={item.outcome} tone={outcomeTone} />
          <InboxBadge label={contextLabel} />
          <Text style={type(t.textMuted, 11, { marginLeft: "auto" })}>
            {formatShortTime(item.timestamp)}
          </Text>
        </View>
        <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.routineName}</Text>
        <Text numberOfLines={3} style={type(t.textSecondary, 12)}>
          {item.summary}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <InboxActionButton
            label="Open chat"
            onPress={() => onOpenConversation(item.conversationId, item.threadId)}
          >
            Open chat
          </InboxActionButton>
        </View>
      </View>
    );
  }

  const eventLabel = taskEventBadgeLabel(item.eventType);
  const eventTone =
    item.eventType === "task_completed"
      ? "ok"
      : item.eventType === "task_failed"
        ? "bad"
        : item.eventType === "task_budget" || item.eventType === "task_workers_capped"
          ? "amber"
          : "neutral";
  return (
    <View
      testID={`inbox-item-${item.id}`}
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceElevated,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <InboxBadge label="Task" tone="blue" />
        <InboxBadge label={eventLabel} tone={eventTone} />
        <InboxBadge label={contextLabel} />
        <Text style={type(t.textMuted, 11, { marginLeft: "auto" })}>
          {formatShortTime(item.timestamp)}
        </Text>
      </View>
      <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.title}</Text>
      <Text numberOfLines={3} style={type(t.textSecondary, 12)}>
        {item.summary}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <InboxActionButton
          label="Open task thread"
          onPress={() => onOpenConversation(item.conversationId, item.threadId)}
        >
          Open thread
        </InboxActionButton>
        {item.task?.execution ? (
          <InboxActionButton label="Open task in Studio" onPress={() => onOpenTask(item.task!)}>
            Studio
          </InboxActionButton>
        ) : null}
      </View>
    </View>
  );
}

function UpcomingRoutineCard({
  item,
  busyKey,
  onRunNow,
  onPause,
  onOpenConversation,
}: {
  item: InboxUpcomingItem;
  busyKey: string | null;
  onRunNow(routineId: string): void;
  onPause(routineId: string): void;
  onOpenConversation(conversationId: string, threadId: string | null): void;
}) {
  const { palette: t } = useTheme();
  const busy =
    busyKey === `routine-run:${item.routineId}` || busyKey === `routine-pause:${item.routineId}`;
  const contextLabel = `${item.assistantName} · ${item.conversationName}`;

  return (
    <View
      testID={`inbox-item-${item.id}`}
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceElevated,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <InboxBadge label={item.isReminder ? "Reminder" : "Routine"} tone="blue" />
        <InboxBadge label={item.cadenceLabel} />
        <InboxBadge label={contextLabel} />
        <Text style={type(t.textMuted, 11, { marginLeft: "auto" })}>
          {`Next: ${formatShortTime(item.nextRunAt)}`}
        </Text>
      </View>
      <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.routineName}</Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <InboxActionButton
          testID={`inbox-routine-run-${item.routineId}`}
          label={`Run ${item.routineName} now`}
          accent
          disabled={busy}
          onPress={() => onRunNow(item.routineId)}
        >
          Run now
        </InboxActionButton>
        <InboxActionButton
          testID={`inbox-routine-pause-${item.routineId}`}
          label={`Pause ${item.routineName}`}
          disabled={busy}
          onPress={() => onPause(item.routineId)}
        >
          Pause
        </InboxActionButton>
        <InboxActionButton
          label="Open chat"
          onPress={() => onOpenConversation(item.conversationId, item.threadId)}
        >
          Open chat
        </InboxActionButton>
      </View>
    </View>
  );
}

function SuggestionCard({
  item,
  busyKey,
  onCancelTask,
  onResumeRoutine,
  onDeleteRoutine,
  onRunRoutine,
  onPauseRoutine,
  onOpenConversation,
  onOpenTurn,
}: {
  item: InboxSuggestionItem;
  busyKey: string | null;
  onCancelTask(taskId: string): void;
  onResumeRoutine(routineId: string): void;
  onDeleteRoutine(routineId: string): void;
  onRunRoutine(routineId: string): void;
  onPauseRoutine(routineId: string): void;
  onOpenConversation(conversationId: string, threadId: string | null): void;
  onOpenTurn(turn: Turn): void;
}) {
  const { palette: t } = useTheme();
  const contextLabel = `${item.assistantName} · ${item.conversationName}`;

  if (item.kind === "stale_task") {
    const busy = busyKey === `task-cancel:${item.taskId}`;
    return (
      <View
        testID={`inbox-item-${item.id}`}
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <InboxBadge label={item.isLive ? "Stale task" : "Unfollowed task"} tone="amber" />
          <InboxBadge label={contextLabel} tone="blue" />
        </View>
        <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.title}</Text>
        <Text style={type(t.textSecondary, 12)}>{item.reason}</Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <InboxActionButton
            label="Open task thread"
            accent
            onPress={() => onOpenConversation(item.conversationId, item.threadId)}
          >
            Open thread
          </InboxActionButton>
          {item.isLive ? (
            <InboxActionButton
              testID={`inbox-cancel-task-${item.taskId}`}
              label="Cancel task"
              disabled={busy}
              onPress={() => onCancelTask(item.taskId)}
            >
              Cancel task
            </InboxActionButton>
          ) : null}
        </View>
      </View>
    );
  }

  if (item.kind === "failed_turn") {
    return (
      <View
        testID={`inbox-item-${item.id}`}
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <InboxBadge label="Failed turn" tone="bad" />
          <InboxBadge label={contextLabel} tone="blue" />
        </View>
        <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.title}</Text>
        <Text style={type(t.textSecondary, 12)}>{item.reason}</Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <InboxActionButton
            label="Open chat"
            accent
            onPress={() => onOpenConversation(item.conversationId, item.threadId)}
          >
            Open chat
          </InboxActionButton>
          <InboxActionButton label="View process" onPress={() => onOpenTurn(item.turn)}>
            View process
          </InboxActionButton>
        </View>
      </View>
    );
  }

  if (item.kind === "paused_routine") {
    const busy =
      busyKey === `routine-resume:${item.routineId}` ||
      busyKey === `routine-delete:${item.routineId}`;
    return (
      <View
        testID={`inbox-item-${item.id}`}
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 12,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <InboxBadge label="Paused routine" tone="neutral" />
          <InboxBadge label={contextLabel} tone="blue" />
        </View>
        <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.routineName}</Text>
        <Text style={type(t.textSecondary, 12)}>{item.reason}</Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <InboxActionButton
            testID={`inbox-routine-resume-${item.routineId}`}
            label={`Resume ${item.routineName}`}
            accent
            disabled={busy}
            onPress={() => onResumeRoutine(item.routineId)}
          >
            Resume
          </InboxActionButton>
          <InboxActionButton
            testID={`inbox-routine-delete-${item.routineId}`}
            label={`Delete ${item.routineName}`}
            disabled={busy}
            onPress={() => onDeleteRoutine(item.routineId)}
          >
            Delete
          </InboxActionButton>
          <InboxActionButton
            label="Open chat"
            onPress={() => onOpenConversation(item.conversationId, item.threadId)}
          >
            Open chat
          </InboxActionButton>
        </View>
      </View>
    );
  }

  const busy =
    busyKey === `routine-run:${item.routineId}` || busyKey === `routine-pause:${item.routineId}`;
  return (
    <View
      testID={`inbox-item-${item.id}`}
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceElevated,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <InboxBadge label="Failing routine" tone="bad" />
        <InboxBadge label={contextLabel} tone="blue" />
      </View>
      <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{item.routineName}</Text>
      <Text style={type(t.textSecondary, 12)}>{item.reason}</Text>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <InboxActionButton
          testID={`inbox-routine-retry-${item.routineId}`}
          label={`Retry ${item.routineName} now`}
          accent
          disabled={busy}
          onPress={() => onRunRoutine(item.routineId)}
        >
          Retry now
        </InboxActionButton>
        <InboxActionButton
          testID={`inbox-routine-pause-failing-${item.routineId}`}
          label={`Pause ${item.routineName}`}
          disabled={busy}
          onPress={() => onPauseRoutine(item.routineId)}
        >
          Pause
        </InboxActionButton>
        <InboxActionButton
          label="Open chat"
          onPress={() => onOpenConversation(item.conversationId, item.threadId)}
        >
          Open chat
        </InboxActionButton>
      </View>
    </View>
  );
}
