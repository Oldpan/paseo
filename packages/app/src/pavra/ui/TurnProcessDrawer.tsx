import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { shallow, useShallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AgentStreamView } from "@/agent-stream/view";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { createPaneFocusContextValue, PaneFocusProvider } from "@/panels/pane-context";
import { getHostRuntimeStore, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { selectAgentTimelineTurnPresentation, useSessionStore } from "@/stores/session-store";
import type { TurnPresentation } from "@/timeline/turn-liveness";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import type { Takeover, Task, Turn } from "../../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "../data";
import {
  selectLiveTurn,
  selectTurnStream,
  TURN_STATUS_LABEL,
  type TurnStreamSlice,
} from "../live-turn";
import {
  buildTurnLineage,
  formatProvenanceLabel,
  type BrowserTakeover,
  type PeerConsultationStatus,
  type PeerMailboxActivity,
  type TaskSummary,
  type TurnLineage,
} from "../peer-activity";
import { AnimatedDrawer, usePresenceId } from "./AnimatedDrawer";
import { AgentAvatar } from "./avatars";
import { HeaderIconButton, StudioButton } from "./ChatChrome";
import {
  ArrowLeftIcon,
  BriefcaseIcon,
  ChevronIcon,
  CloseIcon,
  MessagesSquareIcon,
  MonitorIcon,
} from "./icons";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

const DRAWER_WIDTH = 480;
const LIVE_STATUSES = new Set(["queued", "creating", "running", "attention", "unknown"]);
const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const EMPTY_PERMISSION_LIST: PendingPermission[] = [];
const EMPTY_PERMISSIONS = new Map<string, PendingPermission>();
const EMPTY_SLICE: TurnStreamSlice = {
  found: false,
  tail: EMPTY_STREAM_ITEMS,
  head: EMPTY_STREAM_ITEMS,
};
const IDLE_TURN_PRESENTATION: TurnPresentation = {
  isActive: false,
  isCancelling: false,
  startedAt: null,
  turnId: null,
};

const PANEL_CONTAINER = {
  flex: 1,
  minHeight: 0,
} as const;

const HEADER_ROW = {
  minHeight: 56,
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderBottomWidth: 2,
  flexDirection: "row",
  gap: 10,
  alignItems: "center",
} as const;

const HEADER_TITLE_COL = {
  flex: 1,
  minWidth: 0,
} as const;

const ERROR_CALLOUT = {
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderBottomWidth: 1,
} as const;

const STREAM_BODY = {
  flex: 1,
  minHeight: 0,
} as const;

const LINEAGE_CONTAINER = {
  borderBottomWidth: 2,
} as const;

const LINEAGE_TOGGLE_ROW = {
  minHeight: 38,
  paddingHorizontal: 14,
  paddingVertical: 8,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
} as const;

const LINEAGE_TOGGLE_LEFT = {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  flex: 1,
  minWidth: 0,
} as const;

const LINEAGE_SCROLL = {
  maxHeight: 240,
} as const;

const LINEAGE_SCROLL_CONTENT = {
  paddingHorizontal: 14,
  paddingBottom: 12,
  gap: 8,
} as const;

const CONSULTATION_CARD = {
  borderRadius: 10,
  borderWidth: 1,
  padding: 10,
  gap: 6,
} as const;

const CONSULTATION_HEADER = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
} as const;

const CONSULTATION_ROUTE = {
  flexDirection: "row",
  alignItems: "center",
  gap: 5,
  flexShrink: 1,
} as const;

const STATUS_BADGE = {
  borderRadius: 999,
  borderWidth: 1,
  paddingHorizontal: 7,
  paddingVertical: 1,
} as const;

const QA_BLOCK = {
  borderLeftWidth: 2,
  paddingLeft: 8,
  gap: 2,
} as const;

const PILLS_GROUP = {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
} as const;

const LINEAGE_PILL = {
  minHeight: 28,
  borderRadius: 999,
  borderWidth: 1,
  paddingHorizontal: 10,
  paddingVertical: 4,
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  maxWidth: "100%",
} as const;

function useProcessTurnDemand(input: {
  open: boolean;
  turnId: string | null;
  serverId: string;
  agentId: string;
}) {
  const { open, turnId, serverId, agentId } = input;
  const sync = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.viewedTimelineSync : undefined,
  );

  useEffect(() => {
    if (!open || !serverId || !agentId) return;
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, agentId)
      .catch(() => undefined);
  }, [agentId, open, serverId]);

  useLayoutEffect(() => {
    if (!open || !turnId || !serverId || !agentId) return;
    const owner = `pavra:process-drawer:${turnId}`;
    sync?.replaceVisibleAgentIds(owner, [agentId]);
    return () => {
      sync?.replaceVisibleAgentIds(owner, []);
    };
  }, [agentId, open, serverId, sync, turnId]);
}

function buildSubtitle(input: {
  turn: Turn;
  activity: string | null;
  hostLabel: string | undefined;
}): string {
  const { turn, activity, hostLabel } = input;
  const isLive = LIVE_STATUSES.has(turn.status) && !turn.finalMessageId;
  const statusText =
    isLive && activity ? `${activity}…` : (TURN_STATUS_LABEL[turn.status] ?? turn.status);
  return hostLabel ? `${statusText} · ${hostLabel}` : statusText;
}

function resolveHostLabel(
  serverId: string,
  hostLabels: Record<string, string> | undefined,
  hosts: readonly { serverId: string; label: string }[],
): string | undefined {
  if (!serverId) return undefined;
  return (
    hostLabels?.[serverId] ?? hosts.find((host) => host.serverId === serverId)?.label ?? serverId
  );
}

function buildStreamContext(input: {
  serverId: string;
  agentId: string;
  agent: Partial<AgentScreenAgent> | null;
  fallbackProvider: AgentScreenAgent["provider"];
  isTurnLive: boolean;
  turnError: string | null | undefined;
}): AgentScreenAgent {
  const { serverId, agentId, agent, fallbackProvider, isTurnLive, turnError } = input;
  const base: AgentScreenAgent = {
    serverId,
    id: agentId || "turn-agent",
    provider: fallbackProvider,
    status: isTurnLive ? "running" : "idle",
    cwd: ".",
    lastError: turnError ?? null,
    projectPlacement: null,
  };
  if (!agent) return base;
  return {
    ...base,
    ...agent,
    serverId,
    id: agentId || "turn-agent",
    provider: agent.provider ?? fallbackProvider,
    status: agent.status ?? base.status,
    cwd: agent.cwd ?? ".",
    lastError: agent.lastError ?? turnError ?? null,
    projectPlacement: agent.projectPlacement ?? null,
  };
}

function buildTurnPresentation(
  activeTurn: Turn | null,
  isTurnLive: boolean,
  sessionTurnPresentation: TurnPresentation,
): TurnPresentation {
  if (!isTurnLive || !activeTurn) return IDLE_TURN_PRESENTATION;
  const isTurnRunning =
    activeTurn.status === "running" ||
    activeTurn.status === "creating" ||
    activeTurn.status === "queued";
  return {
    isActive: sessionTurnPresentation.isActive || isTurnRunning,
    isCancelling: sessionTurnPresentation.isCancelling,
    startedAt: sessionTurnPresentation.startedAt,
    turnId: sessionTurnPresentation.turnId ?? activeTurn.id,
  };
}

function useTurnProcessSession(serverId: string, agentId: string, isTurnLive: boolean) {
  const isConnected = useHostRuntimeIsConnected(serverId);
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
  const agent = useSessionStore((state) => {
    if (!serverId || !agentId) return null;
    const session = state.sessions[serverId];
    return session?.agents.get(agentId) ?? session?.agentDetails.get(agentId) ?? null;
  });
  const sessionTurnPresentation = useSessionStore(
    useShallow((state) =>
      serverId && agentId
        ? selectAgentTimelineTurnPresentation(state.sessions[serverId], agentId)
        : IDLE_TURN_PRESENTATION,
    ),
  );
  const pendingPermissionList = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!isTurnLive || !serverId || !agentId) return EMPTY_PERMISSION_LIST;
      const all = state.sessions[serverId]?.pendingPermissions;
      if (!all) return EMPTY_PERMISSION_LIST;
      const matching: PendingPermission[] = [];
      for (const permission of all.values()) {
        if (permission.agentId === agentId) matching.push(permission);
      }
      return matching.length > 0 ? matching : EMPTY_PERMISSION_LIST;
    },
    shallow,
  );
  const pendingPermissions = useMemo(() => {
    if (pendingPermissionList.length === 0) return EMPTY_PERMISSIONS;
    return new Map(pendingPermissionList.map((permission) => [permission.key, permission]));
  }, [pendingPermissionList]);

  return {
    isConnected,
    tail,
    head,
    agent,
    sessionTurnPresentation,
    pendingPermissions,
  };
}

function TurnProcessHeader({
  compact,
  assistantName,
  seed,
  subtitle,
  onClose,
  onOpenStudio,
}: {
  compact: boolean;
  assistantName: string;
  seed: string;
  subtitle: string;
  onClose(): void;
  onOpenStudio(): void;
}) {
  const { palette: t, name } = useTheme();
  const headerStyle = useMemo(
    () => [
      HEADER_ROW,
      {
        backgroundColor: t.surfacePrimary,
        borderBottomColor: t.black,
      },
    ],
    [t.black, t.surfacePrimary],
  );
  return (
    <View style={headerStyle}>
      {compact ? (
        <HeaderIconButton label="Back to chat" onPress={onClose} size={32}>
          <ArrowLeftIcon color={t.textPrimary} size={15} />
        </HeaderIconButton>
      ) : (
        <AgentAvatar seed={seed} label={assistantName} size={32} theme={t} name={name} />
      )}
      <View style={HEADER_TITLE_COL}>
        <Text
          role="heading"
          numberOfLines={1}
          style={type(t.textPrimary, 14, { fontWeight: "700" })}
        >
          {assistantName}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={type(t.textSecondary, 11, { marginTop: 1 })}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <StudioButton label="Open in Studio" onPress={onOpenStudio} />
      <HeaderIconButton label="Close process" onPress={onClose} size={32}>
        <CloseIcon color={t.textPrimary} size={15} />
      </HeaderIconButton>
    </View>
  );
}

function TurnProcessCallouts({
  error,
  disconnectedEmpty,
}: {
  error: string | null | undefined;
  disconnectedEmpty: boolean;
}) {
  const { palette: t } = useTheme();
  return (
    <>
      {error ? (
        <View
          style={[
            ERROR_CALLOUT,
            {
              backgroundColor: t.surfaceElevated,
              borderBottomColor: t.destructive,
            },
          ]}
        >
          <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
            {error}
          </Text>
        </View>
      ) : null}
      {disconnectedEmpty ? (
        <View
          style={[
            ERROR_CALLOUT,
            {
              backgroundColor: t.surfaceElevated,
              borderBottomColor: t.retroBorder,
            },
          ]}
        >
          <Text style={type(t.textSecondary, 12)}>
            That assistant&apos;s machine is not connected in this app. Add it as a host first.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function consultationBadgeColors(
  status: PeerConsultationStatus,
  outcome: "ok" | "failed" | null,
  t: ReturnType<typeof useTheme>["palette"],
): { bg: string; fg: string; label: string } {
  if (status === "cancelled") {
    return { bg: t.badgeRed, fg: t.onAccent, label: "cancelled" };
  }
  if (outcome === "failed") {
    return { bg: t.badgeRed, fg: t.onAccent, label: "failed" };
  }
  if (status === "replied") {
    return { bg: t.badgeGreen, fg: t.onAccent, label: "replied" };
  }
  return { bg: t.badgeAmber, fg: t.onAccent, label: "pending" };
}

function ConsultationCard({ item }: { item: PeerMailboxActivity }) {
  const { palette: t } = useTheme();
  const badge = consultationBadgeColors(item.status, item.outcome, t);
  const questionLabel = item.kind === "share" ? "Shared" : "Asked";
  return (
    <View
      testID={`lineage-consultation-${item.id}`}
      style={[
        CONSULTATION_CARD,
        {
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
        },
      ]}
    >
      <View style={CONSULTATION_HEADER}>
        <View style={CONSULTATION_ROUTE}>
          <MessagesSquareIcon color={t.textSecondary} size={12} />
          <Text numberOfLines={1} style={type(t.textPrimary, 12, { fontWeight: "700" })}>
            {item.route}
          </Text>
        </View>
        <View
          style={[
            STATUS_BADGE,
            {
              borderColor: t.retroBorder,
              backgroundColor: badge.bg,
            },
          ]}
        >
          <Text style={type(badge.fg, 10, { fontWeight: "700" })}>{badge.label}</Text>
        </View>
      </View>
      {item.question ? (
        <View style={[QA_BLOCK, { borderLeftColor: t.retroBorder }]}>
          <Text style={type(t.textMuted, 10, { fontWeight: "700" })}>{questionLabel}</Text>
          <Text selectable style={type(t.textPrimary, 12)}>
            {item.question}
          </Text>
        </View>
      ) : null}
      {item.answer ? (
        <View style={[QA_BLOCK, { borderLeftColor: t.brandAccent }]}>
          <Text style={type(t.textMuted, 10, { fontWeight: "700" })}>
            {`Reply from ${item.peerName}`}
          </Text>
          <Text selectable style={type(t.textSecondary, 12)}>
            {item.answer}
          </Text>
        </View>
      ) : null}
      {!item.answer && item.kind === "ask" && item.status === "pending" ? (
        <Text style={type(t.textMuted, 11, { fontStyle: "italic" })}>
          Waiting for reply from {item.peerName}…
        </Text>
      ) : null}
    </View>
  );
}

function TaskLineagePill({
  item,
  onSelectTask,
}: {
  item: TaskSummary;
  onSelectTask?: (task: Task) => void;
}) {
  const { palette: t, name } = useTheme();
  const handlePress = useCallback(() => {
    onSelectTask?.(item.task);
  }, [item.task, onSelectTask]);
  return (
    <Pressable
      testID={`lineage-task-${item.id}`}
      role="button"
      accessibilityLabel={`Task ${item.title}, status ${item.statusLabel}`}
      disabled={!onSelectTask}
      onPress={handlePress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          LINEAGE_PILL,
          {
            borderColor: t.retroBorder,
            backgroundColor: hovered && onSelectTask ? t.surfaceHover : t.surfaceElevated,
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <BriefcaseIcon color={t.textSecondary} size={12} />
      <Text numberOfLines={1} style={type(t.textPrimary, 11, { fontWeight: "600", flexShrink: 1 })}>
        {item.title}
      </Text>
      <View
        style={[
          STATUS_BADGE,
          {
            borderColor: t.retroBorder,
            backgroundColor: t.badgeBlue,
          },
        ]}
      >
        <Text style={type(t.onAccent, 10, { fontWeight: "700" })}>{item.status}</Text>
      </View>
    </Pressable>
  );
}

function takeoverBadgeColors(
  status: Takeover["status"],
  t: ReturnType<typeof useTheme>["palette"],
): { bg: string; fg: string } {
  if (status === "resolved") return { bg: t.badgeGreen, fg: t.onAccent };
  if (status === "cancelled") return { bg: t.badgeRed, fg: t.onAccent };
  return { bg: t.badgePink, fg: t.onPink };
}

function TakeoverLineagePill({
  item,
  onOpenTakeover,
}: {
  item: BrowserTakeover;
  onOpenTakeover?: (takeover: Takeover) => void;
}) {
  const { palette: t, name } = useTheme();
  const handlePress = useCallback(() => {
    onOpenTakeover?.(item.takeover);
  }, [item.takeover, onOpenTakeover]);
  const badge = takeoverBadgeColors(item.status, t);
  return (
    <Pressable
      testID={`lineage-takeover-${item.id}`}
      role="button"
      accessibilityLabel={`Browser takeover ${item.displayLabel}, status ${item.status}`}
      disabled={!onOpenTakeover}
      onPress={handlePress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          LINEAGE_PILL,
          {
            borderColor: t.retroBorder,
            backgroundColor: hovered && onOpenTakeover ? t.surfaceHover : t.surfaceElevated,
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <MonitorIcon color={t.textSecondary} size={12} />
      <Text numberOfLines={1} style={type(t.textPrimary, 11, { fontWeight: "600", flexShrink: 1 })}>
        {item.displayLabel}
      </Text>
      <View
        style={[
          STATUS_BADGE,
          {
            borderColor: t.retroBorder,
            backgroundColor: badge.bg,
          },
        ]}
      >
        <Text style={type(badge.fg, 10, { fontWeight: "700" })}>{item.status}</Text>
      </View>
    </Pressable>
  );
}

function TurnLineageSection({
  lineage,
  onSelectTask,
  onOpenTakeover,
}: {
  lineage: TurnLineage;
  onSelectTask?: (task: Task) => void;
  onOpenTakeover?: (takeover: Takeover) => void;
}) {
  const { palette: t } = useTheme();
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setExpanded(true);
  }, [lineage.turnId, lineage.messageId]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  if (!lineage.hasLineage) return null;

  const summaryLabel = formatProvenanceLabel(lineage.provenance);

  return (
    <View
      testID="turn-collaboration-lineage"
      style={[
        LINEAGE_CONTAINER,
        {
          backgroundColor: t.surfacePrimary,
          borderBottomColor: t.black,
        },
      ]}
    >
      <Pressable
        testID="turn-lineage-toggle"
        role="button"
        accessibilityLabel="Collaboration & Evidence Lineage"
        accessibilityState={{ expanded }}
        onPress={toggleExpanded}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          return [
            LINEAGE_TOGGLE_ROW,
            {
              backgroundColor: hovered ? t.surfaceHover : t.surfacePrimary,
              ...webTransition("background-color 120ms ease"),
            },
          ];
        }}
      >
        <View style={LINEAGE_TOGGLE_LEFT}>
          <ChevronIcon color={t.textSecondary} size={13} down={expanded} />
          <Text numberOfLines={1} style={type(t.textPrimary, 12, { fontWeight: "700" })}>
            Collaboration &amp; Evidence Lineage
          </Text>
        </View>
        {summaryLabel ? (
          <Text numberOfLines={1} style={type(t.textMuted, 11, { fontWeight: "600" })}>
            {summaryLabel}
          </Text>
        ) : null}
      </Pressable>
      {expanded ? (
        <ScrollView style={LINEAGE_SCROLL} contentContainerStyle={LINEAGE_SCROLL_CONTENT}>
          {lineage.consultations.map((item) => (
            <ConsultationCard key={item.id} item={item} />
          ))}
          {lineage.tasks.length > 0 ? (
            <View style={PILLS_GROUP}>
              {lineage.tasks.map((item) => (
                <TaskLineagePill key={item.id} item={item} onSelectTask={onSelectTask} />
              ))}
            </View>
          ) : null}
          {lineage.takeovers.length > 0 ? (
            <View style={PILLS_GROUP}>
              {lineage.takeovers.map((item) => (
                <TakeoverLineagePill key={item.id} item={item} onOpenTakeover={onOpenTakeover} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

function useRetainedTurn(turn: Turn | null) {
  const { activeId: renderedTurnId, open } = usePresenceId(turn?.id ?? null);
  const [retainedTurn, setRetainedTurn] = useState<Turn | null>(turn);

  useEffect(() => {
    if (turn) {
      setRetainedTurn(turn);
      return;
    }
    if (!renderedTurnId) {
      setRetainedTurn(null);
    }
  }, [renderedTurnId, turn]);

  const activeTurn = turn ?? (renderedTurnId ? retainedTurn : null);
  return { open, activeTurn };
}

function deriveHeaderMetadata(input: {
  activeTurn: Turn | null;
  assistants: PavraData["state"]["assistants"];
  serverId: string;
  hostLabels: Record<string, string> | undefined;
  hosts: readonly { serverId: string; label: string }[];
  activity: string | null;
}) {
  const { activeTurn, assistants, serverId, hostLabels, hosts, activity } = input;
  const assistant = activeTurn
    ? assistants.find((item) => item.id === activeTurn.assistantId)
    : undefined;
  const assistantName = assistant?.name ?? "Assistant";
  const seed = `${assistant?.id ?? activeTurn?.assistantId ?? "assistant"}:${assistantName}`;
  const hostLabel = resolveHostLabel(serverId, hostLabels, hosts);
  const subtitle = activeTurn
    ? buildSubtitle({
        turn: activeTurn,
        activity,
        hostLabel,
      })
    : "";
  return {
    assistant,
    assistantName,
    seed,
    subtitle,
  };
}

export interface TurnProcessDrawerProps {
  turn: Turn | null;
  data: PavraData;
  coordinatorId: string;
  hostLabels?: Record<string, string>;
  compact: boolean;
  /** Optional precomputed lineage from `buildTurnLineage`; derived from `turn` + `data.state` when omitted. */
  lineage?: TurnLineage | null;
  onClose(): void;
  onOpenStudio(turn: Turn): void;
  /** Invoked when a spawned task pill is clicked in the Collaboration & Evidence Lineage section. */
  onSelectTask?(task: Task): void;
  /** Invoked when a browser takeover pill is clicked in the Collaboration & Evidence Lineage section. */
  onOpenTakeover?(takeover: Takeover): void;
}

export function TurnProcessDrawer({
  turn,
  data,
  coordinatorId,
  hostLabels,
  compact,
  lineage,
  onClose,
  onOpenStudio,
  onSelectTask,
  onOpenTakeover,
}: TurnProcessDrawerProps) {
  const { palette: t } = useTheme();
  const hosts = useHosts();
  const { open, activeTurn } = useRetainedTurn(turn);

  const serverId = activeTurn ? (activeTurn.serverId ?? coordinatorId) : "";
  const agentId = activeTurn?.agentId ?? "";
  const isTurnLive = Boolean(
    activeTurn && LIVE_STATUSES.has(activeTurn.status) && !activeTurn.finalMessageId,
  );

  useProcessTurnDemand({
    open,
    turnId: activeTurn?.id ?? null,
    serverId,
    agentId,
  });

  const { isConnected, tail, head, agent, sessionTurnPresentation, pendingPermissions } =
    useTurnProcessSession(serverId, agentId, isTurnLive);

  const turnSlice = useMemo(
    () => (activeTurn ? selectTurnStream(tail, head, activeTurn.id) : EMPTY_SLICE),
    [activeTurn, head, tail],
  );

  const liveView = useMemo(
    () =>
      activeTurn
        ? selectLiveTurn(head.length > 0 ? [...tail, ...head] : tail, activeTurn.id)
        : null,
    [activeTurn, head, tail],
  );

  const { assistant, assistantName, seed, subtitle } = useMemo(
    () =>
      deriveHeaderMetadata({
        activeTurn,
        assistants: data.state.assistants,
        serverId,
        hostLabels,
        hosts,
        activity: liveView?.activity ?? null,
      }),
    [activeTurn, data.state.assistants, hostLabels, hosts, liveView?.activity, serverId],
  );

  const resolvedLineage = useMemo<TurnLineage | null>(() => {
    if (lineage !== undefined) return lineage;
    if (!activeTurn) return null;
    return buildTurnLineage({
      turn: activeTurn,
      turns: data.state.turns,
      messages: data.state.messages,
      peerMessages: data.state.peerMessages,
      tasks: data.state.tasks,
      takeovers: data.state.takeovers,
      assistants: data.state.assistants,
    });
  }, [
    activeTurn,
    data.state.assistants,
    data.state.messages,
    data.state.peerMessages,
    data.state.tasks,
    data.state.takeovers,
    data.state.turns,
    lineage,
  ]);

  const streamContext = useMemo<AgentScreenAgent>(
    () =>
      buildStreamContext({
        serverId,
        agentId,
        agent,
        fallbackProvider: assistant?.provider,
        isTurnLive,
        turnError: activeTurn?.error,
      }),
    [activeTurn?.error, agent, agentId, assistant?.provider, isTurnLive, serverId],
  );

  const turnPresentation = useMemo<TurnPresentation>(
    () => buildTurnPresentation(activeTurn, isTurnLive, sessionTurnPresentation),
    [activeTurn, isTurnLive, sessionTurnPresentation],
  );

  const handleOpenStudio = useCallback(() => {
    if (activeTurn) onOpenStudio(activeTurn);
  }, [activeTurn, onOpenStudio]);

  const panelStyle = useMemo(
    () => [
      PANEL_CONTAINER,
      {
        backgroundColor: t.surfaceSecondary,
        borderLeftWidth: compact ? 0 : 2,
        borderLeftColor: t.black,
      },
    ],
    [compact, t.black, t.surfaceSecondary],
  );

  const disconnectedEmpty =
    !isConnected && turnSlice.tail.length === 0 && turnSlice.head.length === 0;

  const paneFocusValue = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused: open,
        isPaneFocused: open,
      }),
    [open],
  );

  return (
    <AnimatedDrawer
      testID="turn-process-drawer"
      open={open}
      side="right"
      drawerWidth={DRAWER_WIDTH}
      fullWidth={compact}
      backdrop={compact}
      zIndex={30}
      closeLabel="Close process"
      onClose={onClose}
    >
      <View style={panelStyle}>
        <TurnProcessHeader
          compact={compact}
          assistantName={assistantName}
          seed={seed}
          subtitle={subtitle}
          onClose={onClose}
          onOpenStudio={handleOpenStudio}
        />
        <TurnProcessCallouts error={activeTurn?.error} disconnectedEmpty={disconnectedEmpty} />
        {resolvedLineage && resolvedLineage.hasLineage ? (
          <TurnLineageSection
            lineage={resolvedLineage}
            onSelectTask={onSelectTask}
            onOpenTakeover={onOpenTakeover}
          />
        ) : null}
        {activeTurn ? (
          <View style={STREAM_BODY}>
            <PaneFocusProvider value={paneFocusValue}>
              <AgentStreamView
                agentId={activeTurn.agentId}
                serverId={serverId}
                context={streamContext}
                streamItems={turnSlice.tail}
                streamHead={turnSlice.head}
                pendingPermissions={pendingPermissions}
                turnPresentation={turnPresentation}
                isAuthoritativeHistoryReady
                readOnly
              />
            </PaneFocusProvider>
          </View>
        ) : null}
      </View>
    </AnimatedDrawer>
  );
}
