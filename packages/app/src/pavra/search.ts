import type {
  Assistant,
  Conversation,
  Message,
  Routine,
  Studio,
  Task,
} from "../../../../extensions/pavra/shared/contracts";
import { isNoteMessage } from "./model";
import { titleFromSlug } from "./playbooks";
import { formatRoutineCadence, routineKindLabel, routineTargetLabel } from "./routines";
import { taskTitle } from "./task-view";

export type SearchMessageInput = Message & {
  savedAt?: string | number | null;
  saved?: boolean;
};

export type ChatMessage = SearchMessageInput;

export interface SearchPlaybookInput {
  slug: string;
  title?: string;
  content?: string;
  mtimeMs?: number;
  assistantId?: string;
  assistantName?: string;
  conversationId?: string;
}

export const SEARCH_CATEGORIES = [
  "all",
  "messages",
  "saved",
  "assistants",
  "conversations",
  "tasks",
  "routines",
  "playbooks",
  "studios",
] as const;

export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

/** UI filter pill categories, including the combined `routines_playbooks` pill. */
export type SearchFilterCategory = SearchCategory | "routines_playbooks";

export type SearchResultKind =
  | "message"
  | "saved"
  | "assistant"
  | "conversation"
  | "task"
  | "routine"
  | "playbook"
  | "studio";

export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

export interface SnippetHighlight {
  before: string;
  match: string;
  after: string;
  text: string;
  segments: SnippetSegment[];
}

export interface SearchResultItem {
  id: string;
  kind: SearchResultKind;
  category: Exclude<SearchCategory, "all">;
  title: string;
  subtitle: string;
  badge?: string;
  snippet: SnippetHighlight;
  timestamp?: number | string | null;
  relativeTime: string;
  score: number;
  conversationId?: string;
  messageId?: string;
  threadId?: string | null;
  assistantId?: string;
  assistantName?: string;
  taskId?: string;
  routineId?: string;
  playbookSlug?: string;
  studioId?: string;
}

export interface SearchSnapshot {
  conversations?: readonly Conversation[];
  messages?: readonly SearchMessageInput[];
  assistants?: readonly Assistant[];
  tasks?: readonly Task[];
  routines?: readonly Routine[];
  playbooks?: readonly SearchPlaybookInput[];
  studios?: readonly Studio[];
  serverMessages?: readonly SearchMessageInput[];
  hostLabels?: Record<string, string>;
}

export interface EmptyQuerySections {
  savedMessages: SearchResultItem[];
  recentConversations: SearchResultItem[];
  activeTasks: SearchResultItem[];
  recentMessages: SearchResultItem[];
}

export interface SearchOutput {
  query: string;
  terms: string[];
  isEmptyQuery: boolean;
  category: SearchFilterCategory;
  results: SearchResultItem[];
  emptySections: EmptyQuerySections;
  counts: Record<SearchFilterCategory, number>;
}

export interface SearchOptions {
  category?: SearchFilterCategory;
  limit?: number;
  now?: number;
}

interface SearchIndexContext {
  query: string;
  terms: readonly string[];
  isEmptyQuery: boolean;
  now: number;
  conversations: readonly Conversation[];
  assistants: readonly Assistant[];
  tasks: readonly Task[];
  routines: readonly Routine[];
  playbooks: readonly SearchPlaybookInput[];
  studios: readonly Studio[];
  allMessages: readonly SearchMessageInput[];
  hostLabels: Record<string, string>;
  conversationsById: ReadonlyMap<string, Conversation>;
  assistantsById: ReadonlyMap<string, Assistant>;
  dmByAssistantId: ReadonlyMap<string, Conversation>;
  latestMessageByConvId: ReadonlyMap<string, SearchMessageInput>;
}

const ACTIVE_TASK_STATUSES = new Set(["queued", "creating", "running", "attention"]);
const DEFAULT_SNIPPET_MAX_LENGTH = 140;
const DEFAULT_EMPTY_SECTION_LIMIT = 5;
const DEFAULT_RESULT_LIMIT = 60;

/**
 * Splits a search query into normalized lowercase terms for space-separated `AND` matching.
 * Supports English words, code identifiers, numbers, and Chinese/CJK substrings.
 */
export function tokenizeSearchQuery(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const rawTokens = trimmed.split(/\s+/u).filter(Boolean);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of rawTokens) {
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

export function normalizeCompactText(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface TextRange {
  start: number;
  end: number;
}

/**
 * Finds all character ranges in `text` that match `term` case-insensitively,
 * falling back to cross-whitespace compact matching (e.g. `vllm服务` matching `vllm 服务`).
 */
export function findTermRanges(text: string, term: string): TextRange[] {
  const needle = term.trim().toLowerCase();
  if (!needle || !text) return [];
  const lower = text.toLowerCase();
  const ranges: TextRange[] = [];

  let cursor = 0;
  while (cursor < lower.length) {
    const idx = lower.indexOf(needle, cursor);
    if (idx === -1) break;
    ranges.push({ start: idx, end: idx + needle.length });
    cursor = idx + Math.max(1, needle.length);
  }
  if (ranges.length > 0) return ranges;

  const compactNeedle = normalizeCompactText(needle);
  if (compactNeedle.length < 2) return [];
  const pattern = [...compactNeedle].map((ch) => escapeRegExp(ch)).join("\\s*");
  const regex = new RegExp(pattern, "giu");
  for (const match of text.matchAll(regex)) {
    if (match.index !== undefined && match[0].length > 0) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  if (ranges.length <= 1) return [...ranges];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TextRange[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}

/**
 * Checks whether a single normalized query term matches inside `text`.
 */
export function matchesSearchTerm(text: string, term: string): boolean {
  if (!term) return true;
  if (!text) return false;
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  if (lowerText.includes(lowerTerm)) return true;
  const compactTerm = normalizeCompactText(lowerTerm);
  if (compactTerm.length >= 2 && normalizeCompactText(lowerText).includes(compactTerm)) {
    return true;
  }
  return false;
}

/**
 * Multi-term `AND` matcher: every space-separated term in `query` must match
 * across at least one of the provided text fields.
 */
export function matchesAllSearchTerms(
  fields: readonly (string | null | undefined)[],
  queryOrTerms: string | readonly string[],
): boolean {
  const terms = typeof queryOrTerms === "string" ? tokenizeSearchQuery(queryOrTerms) : queryOrTerms;
  if (terms.length === 0) return true;
  const combined = fields.filter(Boolean).join("\n");
  if (!combined) return false;
  return terms.every((term) => matchesSearchTerm(combined, term));
}

function isWordBoundaryChar(ch: string | undefined): boolean {
  if (!ch) return true;
  return /[\s/\\._\-:()[\]{}"',;!?#@]/u.test(ch);
}

function scoreTermInText(
  term: string,
  lowerPrimary: string,
  compactPrimary: string,
  lowerSecondary: string,
): number {
  const idx = lowerPrimary.indexOf(term);
  if (idx !== -1) {
    if (idx === 0) return 70;
    if (isWordBoundaryChar(lowerPrimary[idx - 1])) return 60;
    return 40;
  }
  if (term.length >= 2 && compactPrimary.includes(normalizeCompactText(term))) {
    return 25;
  }
  if (lowerSecondary.includes(term)) {
    return 15;
  }
  return 8;
}

/**
 * Computes a relevance score for a candidate record that already satisfies `matchesAllSearchTerms`.
 */
export function scoreSearchMatch(
  primaryText: string,
  secondaryTexts: readonly (string | null | undefined)[],
  terms: readonly string[],
  fullQuery: string,
): number {
  if (terms.length === 0) return 0;
  const cleanPrimary = primaryText.replace(/\s+/g, " ").trim();
  const lowerPrimary = cleanPrimary.toLowerCase();
  const compactPrimary = normalizeCompactText(cleanPrimary);
  const lowerSecondary = secondaryTexts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const normalizedFull = fullQuery.trim().toLowerCase();

  let score = 0;
  if (normalizedFull) {
    if (lowerPrimary === normalizedFull) {
      score += 200;
    } else if (lowerPrimary.startsWith(normalizedFull)) {
      score += 140;
    } else if (lowerPrimary.includes(normalizedFull)) {
      score += 100;
    }
  }

  for (const term of terms) {
    score += scoreTermInText(term, lowerPrimary, compactPrimary, lowerSecondary);
  }
  return score;
}

function computeSnippetWindow(
  cleanLength: number,
  firstMatch: TextRange,
  maxLength: number,
): { winStart: number; winEnd: number } {
  if (cleanLength <= maxLength) {
    return { winStart: 0, winEnd: cleanLength };
  }
  const matchLen = firstMatch.end - firstMatch.start;
  const leadingContext = Math.max(16, Math.floor((maxLength - matchLen) / 3));
  let winStart = Math.max(0, firstMatch.start - leadingContext);
  const winEnd = Math.min(cleanLength, winStart + maxLength);
  if (winEnd - winStart < maxLength) {
    winStart = Math.max(0, winEnd - maxLength);
  }
  return { winStart, winEnd };
}

function attachWindowEllipsis(
  segments: SnippetSegment[],
  prefixEllipsis: string,
  suffixEllipsis: string,
): void {
  if (prefixEllipsis) {
    if (segments[0] && !segments[0].highlight) {
      segments[0] = { text: `${prefixEllipsis}${segments[0].text}`, highlight: false };
    } else {
      segments.unshift({ text: prefixEllipsis, highlight: false });
    }
  }
  if (suffixEllipsis) {
    const lastIdx = segments.length - 1;
    if (lastIdx >= 0 && !segments[lastIdx]!.highlight) {
      segments[lastIdx] = {
        text: `${segments[lastIdx]!.text}${suffixEllipsis}`,
        highlight: false,
      };
    } else {
      segments.push({ text: suffixEllipsis, highlight: false });
    }
  }
}

function buildWindowSegments(
  clean: string,
  merged: readonly TextRange[],
  winStart: number,
  winEnd: number,
  prefixEllipsis: string,
  suffixEllipsis: string,
): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let cursor = winStart;
  for (const range of merged) {
    if (range.end <= winStart || range.start >= winEnd) continue;
    const start = Math.max(winStart, range.start);
    const end = Math.min(winEnd, range.end);
    if (start > cursor) {
      segments.push({ text: clean.slice(cursor, start), highlight: false });
    }
    if (end > start) {
      segments.push({ text: clean.slice(start, end), highlight: true });
    }
    cursor = end;
  }
  if (cursor < winEnd) {
    segments.push({ text: clean.slice(cursor, winEnd), highlight: false });
  }
  attachWindowEllipsis(segments, prefixEllipsis, suffixEllipsis);
  return segments;
}

/**
 * Builds a windowed snippet and `{ before, match, after, text, segments }` highlight structure.
 */
export function buildSnippetHighlight(
  rawText: string,
  query: string,
  maxLength = DEFAULT_SNIPPET_MAX_LENGTH,
): SnippetHighlight {
  const clean = rawText.replace(/\s+/g, " ").trim();
  if (!clean) {
    return { before: "", match: "", after: "", text: "", segments: [] };
  }

  const terms = tokenizeSearchQuery(query);
  const allRanges: TextRange[] = [];
  for (const term of terms) {
    allRanges.push(...findTermRanges(clean, term));
  }

  if (allRanges.length === 0) {
    const truncated =
      clean.length > maxLength ? `${clean.slice(0, Math.max(1, maxLength - 1))}…` : clean;
    return {
      before: truncated,
      match: "",
      after: "",
      text: truncated,
      segments: [{ text: truncated, highlight: false }],
    };
  }

  const sortedIndividual = [...allRanges].sort((a, b) => a.start - b.start || a.end - b.end);
  const firstMatch = sortedIndividual[0]!;
  const merged = mergeRanges(allRanges);
  const { winStart, winEnd } = computeSnippetWindow(clean.length, firstMatch, maxLength);

  const prefixEllipsis = winStart > 0 ? "…" : "";
  const suffixEllipsis = winEnd < clean.length ? "…" : "";
  const clampedFirstStart = Math.max(winStart, Math.min(winEnd, firstMatch.start));
  const clampedFirstEnd = Math.max(clampedFirstStart, Math.min(winEnd, firstMatch.end));

  const before = `${prefixEllipsis}${clean.slice(winStart, clampedFirstStart)}`;
  const match = clean.slice(clampedFirstStart, clampedFirstEnd);
  const after = `${clean.slice(clampedFirstEnd, winEnd)}${suffixEllipsis}`;
  const text = `${before}${match}${after}`;
  const segments = buildWindowSegments(
    clean,
    merged,
    winStart,
    winEnd,
    prefixEllipsis,
    suffixEllipsis,
  );

  return { before, match, after, text, segments };
}

export function parseTimestampMs(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Formats a timestamp (epoch ms or ISO string) into a concise relative time label.
 * Avoids `Intl.RelativeTimeFormat` so Hermes builds without Intl extensions remain safe.
 */
export function formatRelativeTime(
  value: number | string | null | undefined,
  now = Date.now(),
): string {
  const ts = parseTimestampMs(value);
  if (ts === null) return "";
  const diffMs = ts - now;
  const absSeconds = Math.round(Math.abs(diffMs) / 1000);
  if (absSeconds < 45) return "just now";
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) {
    return diffMs < 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return diffMs < 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }
  const absDays = Math.round(absHours / 24);
  if (absDays < 30) {
    return diffMs < 0 ? `${absDays}d ago` : `in ${absDays}d`;
  }
  const absMonths = Math.max(1, Math.round(absDays / 30));
  if (absDays < 365) {
    return diffMs < 0 ? `${absMonths}mo ago` : `in ${absMonths}mo`;
  }
  const absYears = Math.max(1, Math.round(absDays / 365));
  return diffMs < 0 ? `${absYears}y ago` : `in ${absYears}y`;
}

export const formatSearchRelativeTime = formatRelativeTime;

export function isSavedMessage(message: SearchMessageInput): boolean {
  if (message.saved === true) return true;
  if (typeof message.savedAt === "number") {
    return Number.isFinite(message.savedAt) && message.savedAt > 0;
  }
  if (typeof message.savedAt === "string") return message.savedAt.trim().length > 0;
  return false;
}

export function matchesCategoryFilter(
  itemCategory: Exclude<SearchCategory, "all">,
  filter: SearchFilterCategory,
): boolean {
  if (filter === "all") return true;
  if (filter === "routines_playbooks") {
    return itemCategory === "routines" || itemCategory === "playbooks";
  }
  return itemCategory === filter;
}

function resolveSenderName(
  senderId: string,
  assistantsById: ReadonlyMap<string, Assistant>,
): string {
  if (senderId === "user") return "You";
  if (senderId === "system") return "System";
  return assistantsById.get(senderId)?.name ?? senderId;
}

function formatConversationTitle(conv: Conversation, dmAssistant: Assistant | undefined): string {
  if (conv.kind === "dm") {
    return dmAssistant?.name ?? conv.name;
  }
  return conv.name.startsWith("#") ? conv.name : `#${conv.name}`;
}

function resolveConversationDisplayName(
  conversation: Conversation | undefined,
  assistantsById: ReadonlyMap<string, Assistant>,
  fallbackId: string,
): string {
  if (!conversation) return fallbackId;
  if (conversation.kind === "dm") {
    const member = conversation.members[0]
      ? assistantsById.get(conversation.members[0])
      : undefined;
    return member ? `@${member.name}` : conversation.name;
  }
  return conversation.name.startsWith("#") ? conversation.name : `#${conversation.name}`;
}

function buildMessageBadge(
  conversation: Conversation | undefined,
  message: SearchMessageInput,
): string {
  if (message.taskId || (message.threadId && message.threadId.startsWith("task:"))) {
    return "Task thread";
  }
  if (message.threadId) return "Thread";
  if (conversation?.kind === "group") return "Group";
  return "DM";
}

function deduplicateMessages(
  localMessages: readonly SearchMessageInput[],
  serverMessages: readonly SearchMessageInput[],
): SearchMessageInput[] {
  if (serverMessages.length === 0) return [...localMessages];
  const byId = new Map<string, SearchMessageInput>();
  for (const msg of localMessages) {
    byId.set(msg.id, msg);
  }
  for (const msg of serverMessages) {
    const existing = byId.get(msg.id);
    if (!existing) {
      byId.set(msg.id, msg);
    } else if (isSavedMessage(msg) && !isSavedMessage(existing)) {
      byId.set(msg.id, { ...existing, savedAt: msg.savedAt, saved: msg.saved });
    }
  }
  return [...byId.values()];
}

function toMessageResultItem(
  message: SearchMessageInput,
  kind: "message" | "saved",
  conversationsById: ReadonlyMap<string, Conversation>,
  assistantsById: ReadonlyMap<string, Assistant>,
  query: string,
  score: number,
  now: number,
): SearchResultItem {
  const conversation = conversationsById.get(message.conversationId);
  const senderName = resolveSenderName(message.senderId, assistantsById);
  const locationLabel = resolveConversationDisplayName(
    conversation,
    assistantsById,
    message.conversationId,
  );
  const badge = kind === "saved" ? "Saved" : buildMessageBadge(conversation, message);
  const timestamp =
    kind === "saved" && message.savedAt != null ? message.savedAt : message.createdAt;
  const assistantId =
    message.senderId !== "user" && message.senderId !== "system" ? message.senderId : undefined;
  return {
    id: `${kind}:${message.id}`,
    kind,
    category: kind === "saved" ? "saved" : "messages",
    title: `${senderName} · ${locationLabel}`,
    subtitle: senderName,
    badge,
    snippet: buildSnippetHighlight(message.content, query),
    timestamp,
    relativeTime: formatRelativeTime(timestamp, now),
    score,
    conversationId: message.conversationId,
    messageId: message.id,
    threadId: message.threadId,
    assistantId,
    assistantName: senderName,
  };
}

function formatRecentConversationPreview(
  conv: Conversation,
  latest: SearchMessageInput | undefined,
  dmAssistant: Assistant | undefined,
  assistantsById: ReadonlyMap<string, Assistant>,
): string {
  if (latest) {
    return `${resolveSenderName(latest.senderId, assistantsById)}: ${latest.content}`;
  }
  if (conv.kind === "group") {
    return `${conv.members.length} assistants`;
  }
  return dmAssistant?.provider ?? "Direct message";
}

function buildEmptyQuerySections(ctx: SearchIndexContext): EmptyQuerySections {
  const {
    allMessages,
    conversations,
    tasks,
    conversationsById,
    assistantsById,
    latestMessageByConvId,
    now,
  } = ctx;

  const savedMessages = allMessages
    .filter((msg) => isSavedMessage(msg))
    .sort((a, b) => {
      const aSaved = parseTimestampMs(a.savedAt) ?? a.createdAt;
      const bSaved = parseTimestampMs(b.savedAt) ?? b.createdAt;
      return bSaved - aSaved || b.createdAt - a.createdAt;
    })
    .slice(0, DEFAULT_EMPTY_SECTION_LIMIT)
    .map((msg) =>
      toMessageResultItem(msg, "saved", conversationsById, assistantsById, "", 100, now),
    );

  const recentConversations = [...conversations]
    .sort((a, b) => {
      const aTime = latestMessageByConvId.get(a.id)?.createdAt ?? 0;
      const bTime = latestMessageByConvId.get(b.id)?.createdAt ?? 0;
      return bTime - aTime || a.name.localeCompare(b.name);
    })
    .slice(0, DEFAULT_EMPTY_SECTION_LIMIT)
    .map((conv): SearchResultItem => {
      const latest = latestMessageByConvId.get(conv.id);
      const dmAssistant =
        conv.kind === "dm" && conv.members[0] ? assistantsById.get(conv.members[0]) : undefined;
      const displayTitle = formatConversationTitle(conv, dmAssistant);
      const latestText = formatRecentConversationPreview(conv, latest, dmAssistant, assistantsById);
      const subtitle =
        conv.kind === "group" ? "Group chat" : (dmAssistant?.provider ?? "Private chat");
      return {
        id: `conversation:${conv.id}`,
        kind: "conversation",
        category: "conversations",
        title: displayTitle,
        subtitle,
        badge: conv.kind === "group" ? "Group" : "DM",
        snippet: buildSnippetHighlight(latestText, ""),
        timestamp: latest?.createdAt ?? null,
        relativeTime: formatRelativeTime(latest?.createdAt, now),
        score: 90,
        conversationId: conv.id,
        assistantId: dmAssistant?.id,
        assistantName: dmAssistant?.name,
      };
    });

  const activeTasks = [...tasks]
    .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, DEFAULT_EMPTY_SECTION_LIMIT)
    .map((task): SearchResultItem => {
      const assistantName = assistantsById.get(task.assistantId)?.name ?? "Assistant";
      const conv = conversationsById.get(task.conversationId);
      const convLabel = resolveConversationDisplayName(conv, assistantsById, task.conversationId);
      return {
        id: `task:${task.id}`,
        kind: "task",
        category: "tasks",
        title: taskTitle(task),
        subtitle: `${assistantName} · ${convLabel}`,
        badge: `Task · ${task.status.replace(/_/g, " ")}`,
        snippet: buildSnippetHighlight(task.prompt, ""),
        timestamp: task.createdAt,
        relativeTime: formatRelativeTime(task.createdAt, now),
        score: 85,
        conversationId: task.conversationId,
        taskId: task.id,
        assistantId: task.assistantId,
        assistantName,
      };
    });

  const recentMessages = allMessages
    .filter((msg) => !isNoteMessage(msg) && msg.content.trim().length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, DEFAULT_EMPTY_SECTION_LIMIT)
    .map((msg) =>
      toMessageResultItem(msg, "message", conversationsById, assistantsById, "", 80, now),
    );

  return {
    savedMessages,
    recentConversations,
    activeTasks,
    recentMessages,
  };
}

function collectMessageAndSavedCandidates(ctx: SearchIndexContext): SearchResultItem[] {
  const { allMessages, conversationsById, assistantsById, isEmptyQuery, terms, query, now } = ctx;
  const items: SearchResultItem[] = [];

  for (const msg of allMessages) {
    const saved = isSavedMessage(msg);
    const conv = conversationsById.get(msg.conversationId);
    const senderName = resolveSenderName(msg.senderId, assistantsById);
    const convName = conv?.name ?? "";

    if (saved) {
      const savedFields = [msg.content, senderName, convName];
      if (isEmptyQuery || matchesAllSearchTerms(savedFields, terms)) {
        const savedScore = isEmptyQuery
          ? 100
          : scoreSearchMatch(msg.content, [senderName, convName], terms, query) + 15;
        items.push(
          toMessageResultItem(
            msg,
            "saved",
            conversationsById,
            assistantsById,
            query,
            savedScore,
            now,
          ),
        );
      }
    }

    if (isNoteMessage(msg) || !msg.content.trim()) continue;
    const msgFields = [msg.content, senderName, convName, msg.routineName];
    if (!isEmptyQuery && !matchesAllSearchTerms(msgFields, terms)) continue;
    const msgScore = isEmptyQuery
      ? 70
      : scoreSearchMatch(msg.content, [senderName, convName, msg.routineName], terms, query) +
        (saved ? 5 : 0);
    items.push(
      toMessageResultItem(msg, "message", conversationsById, assistantsById, query, msgScore, now),
    );
  }
  return items;
}

function collectAssistantCandidates(ctx: SearchIndexContext): SearchResultItem[] {
  const { assistants, hostLabels, dmByAssistantId, isEmptyQuery, terms, query } = ctx;
  const items: SearchResultItem[] = [];

  for (const assistant of assistants) {
    const machineName = assistant.serverId
      ? (hostLabels[assistant.serverId] ?? assistant.serverId)
      : undefined;
    const fields = [assistant.name, assistant.persona, assistant.provider, machineName];
    if (!isEmptyQuery && !matchesAllSearchTerms(fields, terms)) continue;
    const score = isEmptyQuery
      ? 85
      : scoreSearchMatch(
          assistant.name,
          [assistant.persona, assistant.provider, machineName],
          terms,
          query,
        ) + 20;
    const dmConv = dmByAssistantId.get(assistant.id);
    const subtitleParts = [machineName, assistant.provider].filter(Boolean).join(" · ");
    const snippetSource = assistant.persona.trim() || subtitleParts || "Assistant";
    items.push({
      id: `assistant:${assistant.id}`,
      kind: "assistant",
      category: "assistants",
      title: assistant.name,
      subtitle: subtitleParts || "Assistant",
      badge: "Assistant",
      snippet: buildSnippetHighlight(snippetSource, query),
      timestamp: null,
      relativeTime: "",
      score,
      assistantId: assistant.id,
      assistantName: assistant.name,
      conversationId: dmConv?.id,
    });
  }

  return items;
}

function collectConversationCandidates(ctx: SearchIndexContext): SearchResultItem[] {
  const { conversations, assistantsById, latestMessageByConvId, isEmptyQuery, terms, query, now } =
    ctx;
  const items: SearchResultItem[] = [];

  for (const conv of conversations) {
    const memberNames = conv.members
      .map((id) => assistantsById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    const latest = latestMessageByConvId.get(conv.id);
    const fields = [conv.name, ...memberNames, conv.kind];
    if (!isEmptyQuery && !matchesAllSearchTerms(fields, terms)) continue;
    const score = isEmptyQuery ? 80 : scoreSearchMatch(conv.name, memberNames, terms, query) + 18;
    const dmAssistant =
      conv.kind === "dm" && conv.members[0] ? assistantsById.get(conv.members[0]) : undefined;
    const displayTitle = formatConversationTitle(conv, dmAssistant);
    const snippetSource =
      memberNames.length > 0
        ? `Members: ${memberNames.join(", ")}${latest ? ` · ${latest.content}` : ""}`
        : (latest?.content ?? "Conversation");
    items.push({
      id: `conversation:${conv.id}`,
      kind: "conversation",
      category: "conversations",
      title: displayTitle,
      subtitle: conv.kind === "group" ? `${conv.members.length} assistants` : "Direct message",
      badge: conv.kind === "group" ? "Group" : "DM",
      snippet: buildSnippetHighlight(snippetSource, query),
      timestamp: latest?.createdAt ?? null,
      relativeTime: formatRelativeTime(latest?.createdAt, now),
      score,
      conversationId: conv.id,
      assistantId: dmAssistant?.id,
      assistantName: dmAssistant?.name,
    });
  }

  return items;
}

function computeTaskCandidateScore(
  task: Task,
  title: string,
  assistantName: string,
  convName: string | undefined,
  ctx: SearchIndexContext,
): number {
  const isActive = ACTIVE_TASK_STATUSES.has(task.status);
  if (ctx.isEmptyQuery) {
    return isActive ? 85 : 60;
  }
  const base = scoreSearchMatch(
    `${title} ${task.prompt}`,
    [task.directory, task.status, assistantName, convName],
    ctx.terms,
    ctx.query,
  );
  return base + (isActive ? 10 : 0);
}

function collectTaskAndRoutineCandidates(ctx: SearchIndexContext): SearchResultItem[] {
  const {
    tasks,
    routines,
    assistants,
    conversations,
    assistantsById,
    conversationsById,
    isEmptyQuery,
    terms,
    query,
    now,
  } = ctx;
  const items: SearchResultItem[] = [];

  for (const task of tasks) {
    const assistantName = assistantsById.get(task.assistantId)?.name ?? "Assistant";
    const conv = conversationsById.get(task.conversationId);
    const title = taskTitle(task);
    const fields = [title, task.prompt, task.directory, task.status, assistantName, conv?.name];
    if (!isEmptyQuery && !matchesAllSearchTerms(fields, terms)) continue;
    const score = computeTaskCandidateScore(task, title, assistantName, conv?.name, ctx);
    const convLabel = resolveConversationDisplayName(conv, assistantsById, task.conversationId);
    items.push({
      id: `task:${task.id}`,
      kind: "task",
      category: "tasks",
      title,
      subtitle: `${assistantName} · ${convLabel} · ${task.directory}`,
      badge: `Task · ${task.status.replace(/_/g, " ")}`,
      snippet: buildSnippetHighlight(task.prompt, query),
      timestamp: task.createdAt,
      relativeTime: formatRelativeTime(task.createdAt, now),
      score,
      conversationId: task.conversationId,
      taskId: task.id,
      assistantId: task.assistantId,
      assistantName,
    });
  }

  for (const routine of routines) {
    const targetLabel = routineTargetLabel(routine, assistants, conversations);
    const cadenceLabel = formatRoutineCadence(routine.cadence);
    const kindLabel = routineKindLabel(routine);
    const fields = [
      routine.name,
      routine.prompt,
      targetLabel,
      cadenceLabel,
      routine.status,
      kindLabel,
    ];
    if (!isEmptyQuery && !matchesAllSearchTerms(fields, terms)) continue;
    const score = isEmptyQuery
      ? 75
      : scoreSearchMatch(
          `${routine.name} ${routine.prompt}`,
          [targetLabel, cadenceLabel, routine.status],
          terms,
          query,
        ) + 12;
    const timestamp = routine.updatedAt ?? routine.createdAt;
    items.push({
      id: `routine:${routine.id}`,
      kind: "routine",
      category: "routines",
      title: routine.name,
      subtitle: `${targetLabel} · ${cadenceLabel}`,
      badge: `${kindLabel} · ${routine.status}`,
      snippet: buildSnippetHighlight(routine.prompt, query),
      timestamp,
      relativeTime: formatRelativeTime(timestamp, now),
      score,
      routineId: routine.id,
      conversationId: routine.conversationId,
      assistantId: routine.assistantId,
      assistantName: assistantsById.get(routine.assistantId)?.name,
    });
  }

  return items;
}

function resolvePlaybookConversation(
  playbook: SearchPlaybookInput,
  assistant: Assistant | undefined,
  conversationsById: ReadonlyMap<string, Conversation>,
  dmByAssistantId: ReadonlyMap<string, Conversation>,
): Conversation | undefined {
  if (playbook.conversationId) {
    return conversationsById.get(playbook.conversationId);
  }
  if (assistant) {
    return dmByAssistantId.get(assistant.id);
  }
  return undefined;
}

function formatStudioSnippetSource(
  studio: Studio,
  workspaceNames: readonly string[],
  assistantNames: readonly string[],
): string {
  if (workspaceNames.length > 0) {
    return `Workspaces: ${workspaceNames.join(", ")}`;
  }
  if (assistantNames.length > 0) {
    return `Assistants: ${assistantNames.join(", ")}`;
  }
  return `Studio (${studio.status})`;
}

function collectPlaybookCandidates(ctx: SearchIndexContext): SearchResultItem[] {
  const {
    playbooks,
    assistantsById,
    conversationsById,
    dmByAssistantId,
    isEmptyQuery,
    terms,
    query,
    now,
  } = ctx;
  const items: SearchResultItem[] = [];

  for (const playbook of playbooks) {
    const title = playbook.title?.trim() || titleFromSlug(playbook.slug);
    const assistant = playbook.assistantId ? assistantsById.get(playbook.assistantId) : undefined;
    const assistantName = playbook.assistantName ?? assistant?.name;
    const dmConv = resolvePlaybookConversation(
      playbook,
      assistant,
      conversationsById,
      dmByAssistantId,
    );
    const fields = [title, playbook.slug, playbook.content, assistantName];
    if (!isEmptyQuery && !matchesAllSearchTerms(fields, terms)) continue;
    const score = isEmptyQuery
      ? 72
      : scoreSearchMatch(
          `${title} ${playbook.slug}`,
          [playbook.content, assistantName],
          terms,
          query,
        ) + 12;
    const snippetSource = playbook.content?.trim() || `playbooks/${playbook.slug}.md`;
    const subtitle = assistantName
      ? `${assistantName} · playbooks/${playbook.slug}.md`
      : `playbooks/${playbook.slug}.md`;
    items.push({
      id: `playbook:${playbook.assistantId ?? "default"}:${playbook.slug}`,
      kind: "playbook",
      category: "playbooks",
      title,
      subtitle,
      badge: "Playbook",
      snippet: buildSnippetHighlight(snippetSource, query),
      timestamp: playbook.mtimeMs || null,
      relativeTime: playbook.mtimeMs ? formatRelativeTime(playbook.mtimeMs, now) : "",
      score,
      playbookSlug: playbook.slug,
      assistantId: playbook.assistantId ?? assistant?.id,
      assistantName,
      conversationId: dmConv?.id,
    });
  }

  return items;
}

function collectStudioCandidates(ctx: SearchIndexContext): SearchResultItem[] {
  const { studios, assistantsById, isEmptyQuery, terms, query, now } = ctx;
  const items: SearchResultItem[] = [];

  for (const studio of studios) {
    const workspaceNames = studio.workspaces.map((w) => w.name);
    const assistantNames = (studio.assistantIds ?? [])
      .map((id) => assistantsById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    const fields = [studio.name, studio.status, ...workspaceNames, ...assistantNames];
    if (!isEmptyQuery && !matchesAllSearchTerms(fields, terms)) continue;
    const score = isEmptyQuery
      ? 70
      : scoreSearchMatch(studio.name, [...workspaceNames, ...assistantNames], terms, query) + 15;
    const snippetSource = formatStudioSnippetSource(studio, workspaceNames, assistantNames);
    items.push({
      id: `studio:${studio.id}`,
      kind: "studio",
      category: "studios",
      title: studio.name,
      subtitle: `${studio.workspaces.length} workspace${studio.workspaces.length === 1 ? "" : "s"} · ${studio.status}`,
      badge: "Studio",
      snippet: buildSnippetHighlight(snippetSource, query),
      timestamp: studio.createdAt,
      relativeTime: formatRelativeTime(studio.createdAt, now),
      score,
      studioId: studio.id,
    });
  }

  return items;
}

function computeCategoryCounts(
  candidates: readonly SearchResultItem[],
): Record<SearchFilterCategory, number> {
  const counts: Record<SearchFilterCategory, number> = {
    all: candidates.length,
    messages: 0,
    saved: 0,
    assistants: 0,
    conversations: 0,
    tasks: 0,
    routines: 0,
    playbooks: 0,
    studios: 0,
    routines_playbooks: 0,
  };
  for (const item of candidates) {
    counts[item.category] += 1;
    if (item.category === "routines" || item.category === "playbooks") {
      counts.routines_playbooks += 1;
    }
  }
  return counts;
}

function buildSearchIndexContext(
  snapshot: SearchSnapshot,
  rawQuery: string,
  now: number,
): SearchIndexContext {
  const query = rawQuery.trim();
  const terms = tokenizeSearchQuery(query);
  const conversations = snapshot.conversations ?? [];
  const assistants = snapshot.assistants ?? [];
  const allMessages = deduplicateMessages(snapshot.messages ?? [], snapshot.serverMessages ?? []);
  const conversationsById = new Map(conversations.map((c) => [c.id, c]));
  const assistantsById = new Map(assistants.map((a) => [a.id, a]));
  const dmByAssistantId = new Map<string, Conversation>();
  for (const conv of conversations) {
    if (conv.kind === "dm" && conv.members[0]) {
      dmByAssistantId.set(conv.members[0], conv);
    }
  }
  const latestMessageByConvId = new Map<string, SearchMessageInput>();
  for (const msg of allMessages) {
    if (isNoteMessage(msg)) continue;
    const prev = latestMessageByConvId.get(msg.conversationId);
    if (!prev || msg.createdAt > prev.createdAt) {
      latestMessageByConvId.set(msg.conversationId, msg);
    }
  }
  return {
    query,
    terms,
    isEmptyQuery: terms.length === 0,
    now,
    conversations,
    assistants,
    tasks: snapshot.tasks ?? [],
    routines: snapshot.routines ?? [],
    playbooks: snapshot.playbooks ?? [],
    studios: snapshot.studios ?? [],
    allMessages,
    hostLabels: snapshot.hostLabels ?? {},
    conversationsById,
    assistantsById,
    dmByAssistantId,
    latestMessageByConvId,
  };
}

/**
 * Pure search & ranking engine over a Pavra state snapshot.
 * Instantaneously searches across messages, saved messages, assistants, conversations,
 * tasks, routines, playbooks, and studios, and computes empty-query sections.
 */
export function searchPavraState(
  snapshot: SearchSnapshot,
  rawQuery: string,
  options: SearchOptions = {},
): SearchOutput {
  const category: SearchFilterCategory = options.category ?? "all";
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT;
  const now = options.now ?? Date.now();
  const ctx = buildSearchIndexContext(snapshot, rawQuery, now);
  const emptySections = buildEmptyQuerySections(ctx);

  const allCandidates: SearchResultItem[] = [
    ...collectMessageAndSavedCandidates(ctx),
    ...collectAssistantCandidates(ctx),
    ...collectConversationCandidates(ctx),
    ...collectTaskAndRoutineCandidates(ctx),
    ...collectPlaybookCandidates(ctx),
    ...collectStudioCandidates(ctx),
  ];
  const counts = computeCategoryCounts(allCandidates);

  if (ctx.isEmptyQuery && category === "all") {
    const combinedEmpty: SearchResultItem[] = [
      ...emptySections.savedMessages,
      ...emptySections.recentConversations,
      ...emptySections.activeTasks,
      ...emptySections.recentMessages,
    ];
    return {
      query: ctx.query,
      terms: [...ctx.terms],
      isEmptyQuery: true,
      category,
      results: combinedEmpty.slice(0, limit),
      emptySections,
      counts,
    };
  }

  const filtered = allCandidates
    .filter((item) => matchesCategoryFilter(item.category, category))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = parseTimestampMs(a.timestamp) ?? 0;
      const bTime = parseTimestampMs(b.timestamp) ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);

  return {
    query: ctx.query,
    terms: [...ctx.terms],
    isEmptyQuery: ctx.isEmptyQuery,
    category,
    results: filtered,
    emptySections,
    counts,
  };
}
