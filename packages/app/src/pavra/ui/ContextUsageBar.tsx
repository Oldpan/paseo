import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/shallow";
import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import type { Assistant, Turn } from "../../../../../extensions/pavra/shared/contracts";
import {
  type ContextUsageMetrics,
  type ContextUsageTone,
  type TokenUsageSnapshot,
  formatContextPercent,
  formatTokenCount,
  getContextUsageMetrics,
  resolveLatestAssistantTurnExecution,
} from "../token-usage";
import { useTheme } from "./ThemeProvider";
import { ctrlShadow, text as type } from "./theme";

export interface ContextUsageBarProps {
  usage?: TokenUsageSnapshot | AgentUsage | null;
  variant?: "compact" | "full";
  showUnavailable?: boolean;
  onRequestCompact?: () => void;
}

function toneBarColor(
  tone: ContextUsageTone,
  success: string,
  warning: string,
  destructive: string,
): string {
  if (tone === "warning") return warning;
  if (tone === "critical") return destructive;
  return success;
}

function UsageDetail({ label, value }: { label: string; value: number | undefined }) {
  const { palette: t } = useTheme();
  const formatted = formatTokenCount(value);
  if (formatted == null) return null;
  return (
    <Text style={type(t.textSecondary, 10)}>
      <Text style={type(t.textMuted, 10)}>{label} </Text>
      <Text style={type(t.textPrimary, 10, { fontWeight: "700", fontVariant: ["tabular-nums"] })}>
        {formatted}
      </Text>
    </Text>
  );
}

function UnavailableUsageCard({ variant }: { variant: "compact" | "full" }) {
  const { palette: t } = useTheme();
  const isFull = variant === "full";
  return (
    <View
      testID="context-usage-unavailable"
      style={[
        isFull ? s.fullCard : s.compactWrap,
        isFull && {
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfaceSecondary,
        },
      ]}
    >
      <Text style={type(t.textMuted, 11)}>
        Context usage unavailable · provider has not reported usage yet
      </Text>
    </View>
  );
}

function CompactActionButton({ onPress }: { onPress: () => void }) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID="context-usage-compact-btn"
      accessibilityRole="button"
      accessibilityLabel="Compact / New Thread"
      onPress={onPress}
      style={({ pressed }) => [
        s.compactChip,
        {
          borderColor: t.retroBorder,
          backgroundColor: t.brandAccent,
          opacity: pressed ? 0.85 : 1,
        },
        ctrlShadow(t, name),
      ]}
    >
      <Text style={type(t.onAccent, 10, { fontWeight: "800" })}>Compact / New Thread</Text>
    </Pressable>
  );
}

function FullUsageDetailsRow({
  remaining,
  snapshot,
}: {
  remaining: string;
  snapshot: TokenUsageSnapshot | null | undefined;
}) {
  const { palette: t } = useTheme();
  const hasCumulative =
    formatTokenCount(snapshot?.inputTokens) != null ||
    formatTokenCount(snapshot?.outputTokens) != null ||
    formatTokenCount(snapshot?.cachedInputTokens) != null;

  return (
    <View style={s.detailsRow}>
      <Text style={type(t.textSecondary, 10)}>
        <Text style={type(t.textMuted, 10)}>Remaining </Text>
        <Text style={type(t.textPrimary, 10, { fontWeight: "700", fontVariant: ["tabular-nums"] })}>
          {remaining}
        </Text>
      </Text>
      {hasCumulative ? (
        <>
          <UsageDetail label="Input" value={snapshot?.inputTokens} />
          <UsageDetail label="Cached" value={snapshot?.cachedInputTokens} />
          <UsageDetail label="Output" value={snapshot?.outputTokens} />
        </>
      ) : null}
    </View>
  );
}

function formatSummaryLine(metrics: ContextUsageMetrics): {
  summaryLine: string;
  percent: string;
  remaining: string;
} {
  const used = formatTokenCount(metrics.usedTokens) ?? "0";
  const window = formatTokenCount(metrics.windowTokens) ?? "0";
  const remaining = formatTokenCount(metrics.remainingTokens) ?? "0";
  const percent = formatContextPercent(metrics.usedPercent);
  return {
    summaryLine: `Context · ${used} / ${window} · ${percent}`,
    percent,
    remaining,
  };
}

/**
 * Resolves live token/context usage for an assistant from Paseo's native `useSessionStore`
 * (`agents.get(agentId)?.lastUsage` / `agentDetails.get(agentId)?.lastUsage`).
 */
export function useAssistantContextUsage(params: {
  turns: readonly Turn[];
  assistant?: Pick<Assistant, "id" | "serverId"> | null;
  conversationId?: string | null;
  threadId?: string | null;
  coordinatorId: string;
}): TokenUsageSnapshot | null {
  const { turns, assistant, conversationId, threadId, coordinatorId } = params;
  const execution = useMemo(
    () =>
      resolveLatestAssistantTurnExecution({
        turns,
        assistantId: assistant?.id ?? null,
        conversationId,
        threadId,
        assistantServerId: assistant?.serverId ?? null,
        coordinatorId,
      }),
    [turns, assistant?.id, assistant?.serverId, conversationId, threadId, coordinatorId],
  );

  const latestTurnStatus = useMemo(() => {
    if (!execution) return null;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (turns[index]?.agentId === execution.agentId) return turns[index]?.status ?? null;
    }
    return null;
  }, [execution, turns]);

  const hasClient = useSessionStore((state) =>
    Boolean(execution && state.sessions[execution.serverId]?.client),
  );

  useEffect(() => {
    if (!execution || !hasClient) return;
    const client = getHostRuntimeStore().getClient(execution.serverId);
    if (!client) return;
    let cancelled = false;
    void client
      .fetchAgent({ agentId: execution.agentId })
      .then((result) => {
        if (!cancelled && result?.agent) {
          getHostRuntimeStore().acceptAgentSnapshot(
            execution.serverId,
            normalizeAgentSnapshot(result.agent, execution.serverId),
          );
        }
        return null;
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [execution, hasClient, latestTurnStatus]);

  return useSessionStore(
    useShallow((state) => {
      if (!execution) return null;
      const session = state.sessions[execution.serverId];
      if (!session) return null;
      const agent =
        session.agents.get(execution.agentId) ?? session.agentDetails.get(execution.agentId);
      const lastUsage = agent?.lastUsage;
      if (!lastUsage) return null;
      return {
        contextWindowUsedTokens: lastUsage.contextWindowUsedTokens,
        contextWindowMaxTokens: lastUsage.contextWindowMaxTokens,
        inputTokens: lastUsage.inputTokens,
        cachedInputTokens: lastUsage.cachedInputTokens,
        outputTokens: lastUsage.outputTokens,
        totalCostUsd: lastUsage.totalCostUsd,
      };
    }),
  );
}

export function ContextUsageBar({
  usage,
  variant = "full",
  showUnavailable = false,
  onRequestCompact,
}: ContextUsageBarProps) {
  const { palette: t, name } = useTheme();
  const metrics = getContextUsageMetrics(usage);

  if (!metrics) {
    return showUnavailable ? <UnavailableUsageCard variant={variant} /> : null;
  }

  const isFull = variant === "full";
  const { summaryLine, percent, remaining } = formatSummaryLine(metrics);
  const barColor = toneBarColor(metrics.tone, t.success, t.warning, t.destructive);
  const borderColor = metrics.tone === "critical" ? t.destructive : t.retroBorder;
  const backgroundColor = isFull ? t.surfaceSecondary : t.surfacePrimary;

  return (
    <View
      testID="context-usage-bar"
      accessibilityLabel="Context window usage"
      style={[
        isFull ? s.fullCard : s.compactCard,
        { borderColor, backgroundColor },
        isFull && ctrlShadow(t, name),
      ]}
    >
      <View style={s.headerRow}>
        <Text
          testID="context-usage-summary"
          numberOfLines={1}
          style={type(t.textPrimary, 11, {
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
            flexShrink: 1,
          })}
        >
          {summaryLine}
        </Text>
        <View style={s.rightGroup}>
          <Text
            style={type(barColor, 11, {
              fontWeight: "800",
              fontVariant: ["tabular-nums"],
            })}
          >
            {percent}
          </Text>
          {metrics.shouldSuggestCompact && onRequestCompact ? (
            <CompactActionButton onPress={onRequestCompact} />
          ) : null}
        </View>
      </View>

      <View
        testID="context-usage-progress"
        style={[
          s.track,
          {
            height: isFull ? 8 : 6,
            borderColor: t.retroBorder,
            backgroundColor: t.surfacePrimary,
          },
        ]}
      >
        <View style={[s.fill, { width: `${metrics.barPercent}%`, backgroundColor: barColor }]} />
      </View>

      {isFull ? (
        <FullUsageDetailsRow
          remaining={remaining}
          snapshot={usage as TokenUsageSnapshot | null | undefined}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  fullCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  compactCard: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginHorizontal: 12,
    marginBottom: 4,
    gap: 4,
  },
  compactWrap: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  rightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
  },
  compactChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  track: {
    width: "100%",
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
  },
  detailsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingTop: 2,
  },
});
