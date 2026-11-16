import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import {
  assistantToolFamilyValues,
  type AssistantToolFamily,
  type Turn,
} from "../../../../extensions/pavra/shared/contracts";

export const CONTEXT_WARNING_PERCENT = 65;
export const CONTEXT_CRITICAL_PERCENT = 80;

export type ContextUsageTone = "normal" | "warning" | "critical";

export interface TokenUsageSnapshot extends AgentUsage {
  /** Legacy/Bigbang aliases supported alongside Paseo's native AgentUsage fields. */
  currentInputTokens?: number;
  currentCachedInputTokens?: number;
  modelContextWindow?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  createdAt?: number;
}

export interface ContextUsageMetrics {
  usedTokens: number;
  windowTokens: number;
  remainingTokens: number;
  usedPercent: number;
  barPercent: number;
  ratio: number;
  tone: ContextUsageTone;
  shouldSuggestCompact: boolean;
}

export interface ParsedEnvText {
  envVars: Record<string, string>;
  ignoredLines: string[];
  invalidLines: string[];
}

export interface AssistantToolFamilyMeta {
  id: AssistantToolFamily;
  label: string;
  shortLabel: string;
  description: string;
}

export const ASSISTANT_TOOL_FAMILIES: readonly AssistantToolFamilyMeta[] = [
  {
    id: "mailbox",
    label: "Mailbox & Peer Messaging",
    shortLabel: "Mailbox",
    description: "Ask and reply to other assistants across machines via pavra-send / pavra-peers.",
  },
  {
    id: "tasks",
    label: "Autonomous Tasks",
    shortLabel: "Tasks",
    description: "Start background coding tasks in authorized workspaces via pavra-start_task.",
  },
  {
    id: "routines",
    label: "Routines & Reminders",
    shortLabel: "Routines",
    description: "Manage scheduled checks and one-time reminders via pavra-routine_*.",
  },
  {
    id: "browser",
    label: "Browser Control",
    shortLabel: "Browser",
    description: "Operate persistent Chromium tabs and request user takeover.",
  },
  {
    id: "phone" as AssistantToolFamily,
    label: "Phone Control",
    shortLabel: "Phone",
    description:
      "Operate Android apps on a background virtual display with floating mini-window monitoring",
  },
] as const;

const VALID_TOOL_FAMILY_SET = new Set<string>([...assistantToolFamilyValues, "phone"]);
const ENV_LINE_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function providerNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function resolveContextTone(usedPercent: number): ContextUsageTone {
  if (usedPercent >= CONTEXT_CRITICAL_PERCENT) return "critical";
  if (usedPercent >= CONTEXT_WARNING_PERCENT) return "warning";
  return "normal";
}

export function getContextUsageMetrics(
  usage?: TokenUsageSnapshot | AgentUsage | null,
): ContextUsageMetrics | null {
  if (!usage) return null;
  const snapshot = usage as TokenUsageSnapshot;
  const usedTokens = providerNumber(
    snapshot.contextWindowUsedTokens ?? snapshot.currentInputTokens,
  );
  const windowTokens = providerNumber(
    snapshot.contextWindowMaxTokens ?? snapshot.modelContextWindow,
  );
  if (usedTokens == null || windowTokens == null || windowTokens <= 0) return null;

  const rawRatio = usedTokens / windowTokens;
  const ratio = Math.min(1, Math.max(0, rawRatio));
  const usedPercent = rawRatio * 100;
  const barPercent = Math.min(100, Math.max(0, usedPercent));

  return {
    usedTokens,
    windowTokens,
    remainingTokens: Math.max(0, windowTokens - usedTokens),
    usedPercent,
    barPercent,
    ratio,
    tone: resolveContextTone(usedPercent),
    shouldSuggestCompact: usedPercent >= CONTEXT_CRITICAL_PERCENT,
  };
}

export function formatTokenCount(value: number | null | undefined): string | null {
  const normalized = providerNumber(value);
  if (normalized == null) return null;
  if (normalized >= 1_000_000) {
    const roundedM = Math.round((normalized / 1_000_000) * 10) / 10;
    return `${Number.isInteger(roundedM) ? roundedM.toFixed(0) : roundedM.toFixed(1)}m`;
  }
  if (normalized >= 1_000) {
    const roundedK = Math.round((normalized / 1_000) * 10) / 10;
    if (roundedK >= 1_000) return "1m";
    return `${Number.isInteger(roundedK) ? roundedK.toFixed(0) : roundedK.toFixed(1)}k`;
  }
  return Math.round(normalized).toString();
}

export function formatContextPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

export function formatProviderUsageSummary(
  usage?: TokenUsageSnapshot | AgentUsage | null,
): string | null {
  const metrics = getContextUsageMetrics(usage);
  if (metrics) {
    const used = formatTokenCount(metrics.usedTokens);
    const window = formatTokenCount(metrics.windowTokens);
    const percent = formatContextPercent(metrics.usedPercent);
    return `Context · ${used} / ${window} · ${percent}`;
  }
  const snapshot = usage as TokenUsageSnapshot | null | undefined;
  const total = formatTokenCount(
    snapshot?.totalTokens ??
      (snapshot?.inputTokens != null || snapshot?.outputTokens != null
        ? (snapshot?.inputTokens ?? 0) + (snapshot?.outputTokens ?? 0)
        : undefined),
  );
  return total ? `Tokens · ${total}` : null;
}

function parseDoubleQuotedEnvValue(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Fall back to stripping outer quotes.
  }
  return value.slice(1, -1);
}

function unwrapEnvValue(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first !== last) return value;
  if (first === '"') return parseDoubleQuotedEnvValue(value);
  if (first === "'") return value.slice(1, -1);
  return value;
}

function formatEnvValue(value: string): string {
  if (value === "") return "";
  if (/[\r\n"']/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export function parseEnvVarsText(raw: string): ParsedEnvText {
  const envVars: Record<string, string> = {};
  const ignoredLines: string[] = [];

  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(ENV_LINE_RE);
    if (!match) {
      ignoredLines.push(sourceLine);
      continue;
    }
    const key = match[1];
    const valueRaw = match[2] ?? "";
    if (!key) {
      ignoredLines.push(sourceLine);
      continue;
    }
    envVars[key] = unwrapEnvValue(valueRaw.trim());
  }

  return {
    envVars,
    ignoredLines,
    invalidLines: [...ignoredLines],
  };
}

export function formatEnvVarsText(envVars?: Record<string, string> | null): string {
  if (!envVars) return "";
  const entries = Object.entries(envVars).filter(([key]) => Boolean(key.trim()));
  if (entries.length === 0) return "";
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${key.trim()}=${formatEnvValue(value)}`).join("\n");
}

export function normalizeDisabledTools(
  disabledTools?: readonly string[] | null,
): AssistantToolFamily[] | undefined {
  if (!disabledTools || disabledTools.length === 0) return undefined;
  const seen = new Set<AssistantToolFamily>();
  for (const item of disabledTools) {
    if (VALID_TOOL_FAMILY_SET.has(item)) {
      seen.add(item as AssistantToolFamily);
    }
  }
  return seen.size > 0 ? [...seen] : undefined;
}

export function isAssistantToolEnabled(
  family: AssistantToolFamily | "phone",
  disabledTools?: readonly (AssistantToolFamily | "phone")[] | null,
): boolean {
  if (!disabledTools || disabledTools.length === 0) return true;
  return !(disabledTools as readonly string[]).includes(family);
}

export function toggleAssistantToolFamily(
  family: AssistantToolFamily | "phone",
  disabledTools?: readonly (AssistantToolFamily | "phone")[] | null,
): AssistantToolFamily[] | undefined {
  const next = new Set<AssistantToolFamily>(normalizeDisabledTools(disabledTools) ?? []);
  const target = family as AssistantToolFamily;
  if (next.has(target)) next.delete(target);
  else next.add(target);
  return next.size > 0 ? [...next] : undefined;
}

function matchesTurnExecutionFilter(
  turn: Turn | undefined,
  filter: {
    assistantId?: string | null;
    conversationId?: string | null;
    threadId?: string | null;
  },
): turn is Turn {
  if (!turn || turn.taskId || !turn.agentId) return false;
  if (filter.assistantId && turn.assistantId !== filter.assistantId) return false;
  if (filter.conversationId && turn.conversationId !== filter.conversationId) return false;
  if (filter.threadId !== undefined && (turn.threadId ?? null) !== (filter.threadId ?? null)) {
    return false;
  }
  return true;
}

function findLastMatchingTurn(
  turns: readonly Turn[],
  filter: {
    assistantId?: string | null;
    conversationId?: string | null;
    threadId?: string | null;
  },
): Turn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (matchesTurnExecutionFilter(turn, filter)) return turn;
  }
  return null;
}

export function resolveLatestAssistantTurnExecution(params: {
  turns: readonly Turn[];
  assistantId?: string | null;
  conversationId?: string | null;
  threadId?: string | null;
  assistantServerId?: string | null;
  coordinatorId: string;
}): { serverId: string; agentId: string } | null {
  const { turns, assistantId, conversationId, threadId, assistantServerId, coordinatorId } = params;
  if (!assistantId && !conversationId) return null;

  const exact = findLastMatchingTurn(turns, { assistantId, conversationId, threadId });
  const fallback = !exact && assistantId ? findLastMatchingTurn(turns, { assistantId }) : null;
  const matched = exact ?? fallback;
  if (!matched) return null;

  return {
    serverId: matched.serverId ?? assistantServerId ?? coordinatorId,
    agentId: matched.agentId,
  };
}
