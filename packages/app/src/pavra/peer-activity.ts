import type {
  Assistant,
  Message,
  Peer,
  PeerMessage,
  Studio,
  Takeover,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { TURN_STATUS_LABEL } from "./live-turn";
import { taskTitle } from "./task-view";

const OPEN = new Set(["queued", "delivered", "acked"]);

export interface OpenExchange {
  id: string;
  /** "Ada → Sa · Spark" */
  route: string;
  state: string;
  text: string;
}

function peerLabel(peer: PeerMessage["recipient"]): string {
  return peer.machine ? `${peer.name} · ${peer.machine}` : peer.name;
}
function excerpt(text: string, max = 140): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Mailbox requests asked from this chat lane that are still open: not answered yet, or answered
 * and waiting for the asking assistant to be free. Settled exchanges live in the assistant's reply.
 */
export function openExchanges(
  messages: readonly PeerMessage[],
  conversationId: string,
  threadId: string | null,
): OpenExchange[] {
  const replies = new Map(
    messages.filter((row) => row.kind === "reply" && row.replyTo).map((row) => [row.replyTo!, row]),
  );
  return messages
    .filter(
      (row) =>
        row.ledger === "mailbox" &&
        (row.kind === "request" || row.kind === "info") &&
        row.conversationId === conversationId &&
        (row.threadId ?? null) === threadId,
    )
    .flatMap((row) => {
      const reply = replies.get(row.id);
      if (reply && reply.status !== "queued") return [];
      if (!reply && !OPEN.has(row.status)) return [];
      if (row.kind === "info" && row.status === "acked") return [];
      return [
        {
          id: row.id,
          route: `${row.sender?.name ?? "?"} → ${peerLabel(row.recipient)}`,
          state: exchangeState(row, reply),
          text: excerpt(reply ? reply.text : row.text),
        },
      ];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function exchangeState(request: PeerMessage, reply: PeerMessage | undefined): string {
  if (reply)
    return reply.detail === "failed" ? "Could not help; telling the assistant" : "Answered";
  if (request.status === "queued") return "Waiting to be delivered";
  if (request.status === "delivered") return "Waiting for a free moment";
  return request.recipient.kind === "agent" ? "Delivered" : "Working on it";
}

export interface RecordRow {
  id: string;
  depth: number;
  route: string;
  kind: string;
  status: string;
  detail: string;
  text: string;
  createdAt: number;
}

/** A Studio's records, oldest first, with replies under the message they answer. */
export function studioRecords(messages: readonly PeerMessage[], studio: Studio): RecordRow[] {
  const own = messages
    .filter((row) => row.ledger === "studio" && row.studioId === studio.id)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const ids = new Set(own.map((row) => row.id));
  const children = new Map<string, PeerMessage[]>();
  for (const row of own)
    if (row.replyTo && ids.has(row.replyTo))
      children.set(row.replyTo, [...(children.get(row.replyTo) ?? []), row]);
  const rows: RecordRow[] = [];
  const visit = (row: PeerMessage, depth: number) => {
    rows.push({
      id: row.id,
      depth,
      route: `${row.sender ? peerLabel(row.sender) : "Studio"} → ${peerLabel(row.recipient)}`,
      kind: row.kind,
      status: row.status,
      detail: row.code ?? "",
      text: excerpt(row.text, 240),
      createdAt: row.createdAt,
    });
    for (const child of children.get(row.id) ?? []) visit(child, depth + 1);
  };
  for (const row of own) if (!row.replyTo || !ids.has(row.replyTo)) visit(row, 0);
  return rows;
}

/** The active Studio that collaborates for a Studio tab group, by name. */
export function studioForGroup(studios: readonly Studio[], group: string): Studio | undefined {
  return studios.find((studio) => studio.status === "active" && studio.name === group);
}

export type PeerConsultationStatus = "pending" | "replied" | "cancelled";
export type PeerConsultationKind = "ask" | "reply" | "share";

export interface PeerMailboxActivity {
  id: string;
  kind: PeerConsultationKind;
  status: PeerConsultationStatus;
  rawStatus: string;
  outcome: "ok" | "failed" | null;
  senderId: string;
  senderName: string;
  peerId: string;
  peerName: string;
  peerMachine?: string;
  /** Formatted route, e.g. "Ada → Cy · Spark" */
  route: string;
  /** Full question or shared text */
  question: string;
  /** Compact snippet of the question or shared text */
  questionSnippet: string;
  /** Full reply text when answered, or null */
  answer: string | null;
  /** Compact snippet of the reply when answered, or null */
  answerSnippet: string | null;
  replyId: string | null;
  createdAt: number;
  repliedAt: number | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: Task["status"];
  statusLabel: string;
  prompt: string;
  serverId: string;
  directory: string;
  provider: string;
  isolation: Task["isolation"];
  createdAt: number;
  error: string | null;
  task: Task;
}

export interface BrowserTakeover {
  id: string;
  kind: Takeover["kind"];
  status: Takeover["status"];
  reason: string;
  url: string | null;
  title: string | null;
  domain: string | null;
  displayLabel: string;
  createdAt: number;
  updatedAt: number;
  takeover: Takeover;
}

export interface ConsultedPeer {
  id: string;
  name: string;
}

export interface TurnProvenanceSummary {
  consultedPeers: ConsultedPeer[];
  taskCount: number;
  takeoverCount: number;
}

export interface TurnLineage {
  turnId: string | null;
  messageId: string | null;
  assistantId: string | null;
  conversationId: string | null;
  threadId: string | null;
  consultations: PeerMailboxActivity[];
  tasks: TaskSummary[];
  takeovers: BrowserTakeover[];
  provenance: TurnProvenanceSummary;
  consultedPeers: ConsultedPeer[];
  taskCount: number;
  takeoverCount: number;
  hasLineage: boolean;
}

export interface BuildTurnLineageInput {
  turn?: Turn | null;
  message?: Message | null;
  assistantId?: string | null;
  conversationId?: string | null;
  threadId?: string | null;
  executionId?: string | null;
  windowStartMs?: number;
  windowEndMs?: number;
  turns?: readonly Turn[];
  messages?: readonly Message[];
  peerMessages?: readonly PeerMessage[];
  tasks?: readonly Task[];
  takeovers?: readonly Takeover[];
  assistants?: readonly Assistant[];
}

interface ExtendedPeerMessage extends PeerMessage {
  turnId?: string | null;
  senderTurnId?: string | null;
  executionId?: string | null;
}

interface LineageContext {
  turn: Turn | null;
  message: Message | null;
  rawAssistantId: string;
  preservePrefix: boolean;
  normalizedAssistantId: string;
  assistantName: string | undefined;
  conversationId: string;
  threadId: string | null;
  relatedTurnIds: ReadonlySet<string>;
  executionIds: ReadonlySet<string>;
  wakeupRequestIds: ReadonlySet<string>;
  windowStartMs: number;
  windowEndMs: number;
  hasWindowBounds: boolean;
  turns: readonly Turn[] | undefined;
}

function normalizePeerId(rawId: string | null | undefined): string {
  if (!rawId) return "";
  return rawId.startsWith("assistant:") ? rawId.slice("assistant:".length) : rawId;
}

function formatPeerId(peerKey: string, preservePrefix: boolean): string {
  if (preservePrefix) return peerKey;
  return normalizePeerId(peerKey);
}

function peerMatchesAssistant(
  peer: Peer | null | undefined,
  normalizedAssistantId: string,
  assistantName: string | undefined,
): boolean {
  if (!peer) return false;
  if (normalizePeerId(peer.key) === normalizedAssistantId) return true;
  if (assistantName && peer.kind === "assistant" && peer.name === assistantName) return true;
  return false;
}

function parseUrlDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

function extractWakeupRequestIds(turn: Turn): string[] {
  const ids = new Set<string>();
  if (turn.triggerId) ids.add(turn.triggerId);
  if (turn.mailboxId) ids.add(turn.mailboxId);
  for (const match of turn.prompt.matchAll(/\b(?:request|mailbox)\s+([A-Za-z0-9_:-]+)\]/g)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

function resolveConsultationStatus(
  request: PeerMessage,
  reply: PeerMessage | undefined,
): PeerConsultationStatus {
  if (request.status === "cancelled" || reply?.status === "cancelled") {
    return "cancelled";
  }
  if (reply) {
    return "replied";
  }
  if ((request.kind === "info" || request.kind === "share") && request.status === "acked") {
    return "replied";
  }
  return "pending";
}

function resolveConsultationOutcome(
  request: PeerMessage,
  reply: PeerMessage | undefined,
): "ok" | "failed" | null {
  if (reply) {
    return reply.detail === "failed" || reply.status === "failed" ? "failed" : "ok";
  }
  if (request.status === "failed") {
    return "failed";
  }
  return null;
}

function resolveConsultationKind(
  requestKind: string,
  isSender: boolean,
  isRecipient: boolean,
  hasReply: boolean,
): PeerConsultationKind {
  if (requestKind === "info" || requestKind === "share") {
    return "share";
  }
  if (!isSender && isRecipient && hasReply) {
    return "reply";
  }
  return "ask";
}

/**
 * Formats a compact Neo-brutalist badge label for a turn's provenance summary,
 * e.g. "Consulted @Cy · 1 task" or "Consulted @Cy, @Sa · 2 tasks · 1 takeover".
 */
export function formatProvenanceLabel(
  summary:
    | Pick<TurnProvenanceSummary, "consultedPeers" | "taskCount" | "takeoverCount">
    | null
    | undefined,
): string {
  if (!summary) return "";
  const parts: string[] = [];
  if (summary.consultedPeers.length > 0) {
    const visible = summary.consultedPeers.slice(0, 3).map((peer) => {
      const trimmed = peer.name.trim();
      return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
    });
    const extra = summary.consultedPeers.length - visible.length;
    const peersText = extra > 0 ? `${visible.join(", ")} +${extra}` : visible.join(", ");
    parts.push(`Consulted ${peersText}`);
  }
  if (summary.taskCount > 0) {
    parts.push(`${summary.taskCount} ${summary.taskCount === 1 ? "task" : "tasks"}`);
  }
  if (summary.takeoverCount > 0) {
    parts.push(
      `${summary.takeoverCount} ${summary.takeoverCount === 1 ? "takeover" : "takeovers"}`,
    );
  }
  return parts.join(" · ");
}

function resolveTurnAndMessage(input: BuildTurnLineageInput): {
  turn: Turn | null;
  message: Message | null;
} {
  let turn = input.turn ?? null;
  let message = input.message ?? null;
  if (turn && !message && input.messages) {
    message =
      input.messages.find(
        (m) =>
          m.id === turn!.finalMessageId || m.turnId === turn!.id || m.id === `final:${turn!.id}`,
      ) ?? null;
  }
  if (message && !turn && input.turns) {
    turn =
      input.turns.find(
        (t) =>
          t.finalMessageId === message!.id ||
          t.id === message!.turnId ||
          `final:${t.id}` === message!.id,
      ) ?? null;
  }
  return { turn, message };
}

function resolveWindowEndMs(explicitEndMs: number | undefined, message: Message | null): number {
  if (explicitEndMs !== undefined) return explicitEndMs;
  if (message) return message.createdAt;
  return Number.POSITIVE_INFINITY;
}

function computeTurnWindow(input: {
  explicitStartMs: number | undefined;
  explicitEndMs: number | undefined;
  turn: Turn | null;
  message: Message | null;
  messages: readonly Message[] | undefined;
  conversationId: string;
  threadId: string | null;
  normalizedAssistantId: string;
}): { windowStartMs: number; windowEndMs: number; hasWindowBounds: boolean } {
  const {
    explicitStartMs,
    explicitEndMs,
    turn,
    message,
    messages,
    conversationId,
    threadId,
    normalizedAssistantId,
  } = input;
  const hasExplicitWindow = explicitStartMs !== undefined || explicitEndMs !== undefined;
  const windowEndMs = resolveWindowEndMs(explicitEndMs, message);

  if (explicitStartMs !== undefined) {
    return { windowStartMs: explicitStartMs, windowEndMs, hasWindowBounds: true };
  }

  if (!messages || messages.length === 0) {
    return {
      windowStartMs: 0,
      windowEndMs,
      hasWindowBounds: hasExplicitWindow || message !== null,
    };
  }

  const laneMessages = messages
    .filter((m) => m.conversationId === conversationId && (m.threadId ?? null) === threadId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  const priorMessages = message
    ? laneMessages.filter((m) => m.id !== message.id && m.createdAt <= message.createdAt)
    : laneMessages;

  let lastSameAssistantAt = 0;
  let lastUserAt = 0;
  for (const m of priorMessages) {
    if (normalizePeerId(m.senderId) === normalizedAssistantId) {
      if (m.createdAt > lastSameAssistantAt) lastSameAssistantAt = m.createdAt;
    } else if (m.senderId === "user" && m.createdAt > lastUserAt) {
      lastUserAt = m.createdAt;
    }
  }

  const triggerId = turn?.rootTriggerId ?? turn?.triggerId;
  const triggerMsg = triggerId ? laneMessages.find((m) => m.id === triggerId) : undefined;
  const triggerAt =
    triggerMsg && triggerMsg.createdAt <= windowEndMs ? triggerMsg.createdAt : lastUserAt;

  return {
    windowStartMs: Math.max(lastSameAssistantAt, triggerAt),
    windowEndMs,
    hasWindowBounds: true,
  };
}

function resolveAssistantId(
  explicitId: string | null | undefined,
  turn: Turn | null,
  message: Message | null,
): string | null {
  if (explicitId) return explicitId;
  if (turn?.assistantId) return turn.assistantId;
  if (message && message.senderId !== "user" && message.senderId !== "system") {
    return message.senderId;
  }
  return null;
}

function resolveThreadId(
  explicitThreadId: string | null | undefined,
  turn: Turn | null,
  message: Message | null,
): string | null {
  if (explicitThreadId !== undefined) return explicitThreadId;
  if (turn) return turn.threadId ?? null;
  if (message) return message.threadId ?? null;
  return null;
}

function collectRelatedTurns(
  turn: Turn | null,
  turns: readonly Turn[] | undefined,
  conversationId: string,
  threadId: string | null,
  normalizedAssistantId: string,
  messageId: string | null,
): Turn[] {
  if (!turn) return [];
  const related: Turn[] = [turn];
  const rootTriggerId = turn.rootTriggerId;
  if (!turns || !rootTriggerId) return related;

  for (const candidate of turns) {
    if (candidate.id === turn.id) continue;
    const sameRoot = candidate.rootTriggerId === rootTriggerId;
    const sameLane =
      candidate.conversationId === conversationId && (candidate.threadId ?? null) === threadId;
    const sameAssistant = normalizePeerId(candidate.assistantId) === normalizedAssistantId;
    const compatibleFinal = !candidate.finalMessageId || candidate.finalMessageId === messageId;
    if (sameRoot && sameLane && sameAssistant && compatibleFinal) {
      related.push(candidate);
    }
  }
  return related;
}

function createLineageContext(input: BuildTurnLineageInput): LineageContext | null {
  const { turn, message } = resolveTurnAndMessage(input);
  const rawAssistantId = resolveAssistantId(input.assistantId, turn, message);
  const normalizedAssistantId = normalizePeerId(rawAssistantId);
  const conversationId =
    input.conversationId ?? turn?.conversationId ?? message?.conversationId ?? null;
  const threadId = resolveThreadId(input.threadId, turn, message);

  if (!rawAssistantId || !normalizedAssistantId || !conversationId) {
    return null;
  }

  const preservePrefix = rawAssistantId.startsWith("assistant:");
  const assistantName = input.assistants?.find(
    (a) => normalizePeerId(a.id) === normalizedAssistantId,
  )?.name;

  const relatedTurns = collectRelatedTurns(
    turn,
    input.turns,
    conversationId,
    threadId,
    normalizedAssistantId,
    message?.id ?? null,
  );
  const relatedTurnIds = new Set<string>(relatedTurns.map((t) => t.id));
  if (message?.turnId) relatedTurnIds.add(message.turnId);

  const executionIds = new Set<string>();
  if (input.executionId) executionIds.add(input.executionId);
  for (const t of relatedTurns) {
    if (t.agentId) executionIds.add(t.agentId);
  }

  const wakeupRequestIds = new Set<string>();
  for (const t of relatedTurns) {
    for (const reqId of extractWakeupRequestIds(t)) {
      wakeupRequestIds.add(reqId);
    }
  }

  const { windowStartMs, windowEndMs, hasWindowBounds } = computeTurnWindow({
    explicitStartMs: input.windowStartMs,
    explicitEndMs: input.windowEndMs,
    turn,
    message,
    messages: input.messages,
    conversationId,
    threadId,
    normalizedAssistantId,
  });

  return {
    turn,
    message,
    rawAssistantId,
    preservePrefix,
    normalizedAssistantId,
    assistantName,
    conversationId,
    threadId,
    relatedTurnIds,
    executionIds,
    wakeupRequestIds,
    windowStartMs,
    windowEndMs,
    hasWindowBounds,
    turns: input.turns,
  };
}

function isPeerRowDirectlyLinked(
  row: ExtendedPeerMessage,
  reply: ExtendedPeerMessage | undefined,
  ctx: LineageContext,
): boolean {
  const rowTurnId = row.turnId ?? row.senderTurnId ?? reply?.turnId ?? reply?.senderTurnId;
  const rowExecId = row.executionId ?? reply?.executionId;
  if (rowTurnId && ctx.relatedTurnIds.has(rowTurnId)) return true;
  if (rowExecId && ctx.executionIds.has(rowExecId)) return true;
  if (ctx.wakeupRequestIds.has(row.id)) return true;
  if (row.replyTo && ctx.wakeupRequestIds.has(row.replyTo)) return true;
  return false;
}

function hasConflictingPeerRowLink(
  row: ExtendedPeerMessage,
  reply: ExtendedPeerMessage | undefined,
  ctx: LineageContext,
): boolean {
  const rowTurnId = row.turnId ?? row.senderTurnId ?? reply?.turnId ?? reply?.senderTurnId;
  if (rowTurnId && ctx.relatedTurnIds.size > 0 && !ctx.relatedTurnIds.has(rowTurnId)) {
    return true;
  }
  const rowExecId = row.executionId ?? reply?.executionId;
  if (rowExecId && ctx.executionIds.size > 0 && !ctx.executionIds.has(rowExecId)) {
    return true;
  }
  return false;
}

function isTimestampInWindow(ts: number, ctx: LineageContext): boolean {
  return ts >= ctx.windowStartMs && ts <= ctx.windowEndMs;
}

function matchesConsultationRow(
  row: ExtendedPeerMessage,
  reply: ExtendedPeerMessage | undefined,
  ctx: LineageContext,
): { matched: boolean; isSender: boolean; isRecipient: boolean } {
  const isSender = peerMatchesAssistant(row.sender, ctx.normalizedAssistantId, ctx.assistantName);
  const isRecipient = peerMatchesAssistant(
    row.recipient,
    ctx.normalizedAssistantId,
    ctx.assistantName,
  );
  if (isPeerRowDirectlyLinked(row, reply, ctx)) {
    return { matched: true, isSender, isRecipient };
  }
  if (hasConflictingPeerRowLink(row, reply, ctx)) {
    return { matched: false, isSender, isRecipient };
  }
  if (row.conversationId !== ctx.conversationId || (row.threadId ?? null) !== ctx.threadId) {
    return { matched: false, isSender, isRecipient };
  }
  if (!isSender && !isRecipient) {
    return { matched: false, isSender, isRecipient };
  }
  if (!ctx.hasWindowBounds) {
    return { matched: true, isSender, isRecipient };
  }
  const inWindow =
    isTimestampInWindow(row.createdAt, ctx) ||
    Boolean(reply && isTimestampInWindow(reply.createdAt, ctx));
  return { matched: inWindow, isSender, isRecipient };
}

function buildRequestConsultation(
  row: ExtendedPeerMessage,
  reply: ExtendedPeerMessage | undefined,
  isSender: boolean,
  isRecipient: boolean,
  ctx: LineageContext,
): PeerMailboxActivity {
  const otherPeer = isSender ? row.recipient : (row.sender ?? row.recipient);
  const senderName = row.sender?.name ?? ctx.assistantName ?? "Assistant";
  const senderId = row.sender
    ? formatPeerId(row.sender.key, ctx.preservePrefix)
    : ctx.rawAssistantId;
  const peerId = formatPeerId(otherPeer.key, ctx.preservePrefix);
  const kind = resolveConsultationKind(row.kind, isSender, isRecipient, Boolean(reply));
  const status = resolveConsultationStatus(row, reply);
  const outcome = resolveConsultationOutcome(row, reply);
  const answerText = reply ? reply.text : null;

  return {
    id: row.id,
    kind,
    status,
    rawStatus: reply ? reply.status : row.status,
    outcome,
    senderId,
    senderName,
    peerId,
    peerName: otherPeer.name,
    ...(otherPeer.machine ? { peerMachine: otherPeer.machine } : {}),
    route: `${senderName} → ${peerLabel(row.recipient)}`,
    question: row.text,
    questionSnippet: excerpt(row.text),
    answer: answerText,
    answerSnippet: answerText ? excerpt(answerText) : null,
    replyId: reply?.id ?? null,
    createdAt: row.createdAt,
    repliedAt: reply?.createdAt ?? null,
  };
}

function buildOrphanReplyConsultation(
  row: ExtendedPeerMessage,
  isSender: boolean,
  ctx: LineageContext,
): PeerMailboxActivity {
  const otherPeer = isSender ? row.recipient : (row.sender ?? row.recipient);
  const senderName = row.sender?.name ?? "Peer";
  return {
    id: row.id,
    kind: "reply",
    status: row.status === "cancelled" ? "cancelled" : "replied",
    rawStatus: row.status,
    outcome: row.detail === "failed" || row.status === "failed" ? "failed" : "ok",
    senderId: row.sender ? formatPeerId(row.sender.key, ctx.preservePrefix) : "",
    senderName,
    peerId: formatPeerId(otherPeer.key, ctx.preservePrefix),
    peerName: otherPeer.name,
    ...(otherPeer.machine ? { peerMachine: otherPeer.machine } : {}),
    route: `${senderName} → ${peerLabel(row.recipient)}`,
    question: "",
    questionSnippet: "",
    answer: row.text,
    answerSnippet: excerpt(row.text),
    replyId: row.id,
    createdAt: row.createdAt,
    repliedAt: row.createdAt,
  };
}

function collectConsultations(
  rawMessages: readonly PeerMessage[] | undefined,
  ctx: LineageContext,
): PeerMailboxActivity[] {
  const peerMessages = (rawMessages ?? []) as readonly ExtendedPeerMessage[];
  const repliesByRequestId = new Map<string, ExtendedPeerMessage>();
  const requestIds = new Set<string>();

  for (const row of peerMessages) {
    if (row.kind === "reply") {
      if (row.replyTo) {
        const prev = repliesByRequestId.get(row.replyTo);
        if (!prev || row.createdAt >= prev.createdAt) {
          repliesByRequestId.set(row.replyTo, row);
        }
      }
    } else if (row.kind !== "notice") {
      requestIds.add(row.id);
    }
  }

  const consultations: PeerMailboxActivity[] = [];
  for (const row of peerMessages) {
    if (row.kind === "reply" || row.kind === "notice") continue;
    const reply = repliesByRequestId.get(row.id);
    const match = matchesConsultationRow(row, reply, ctx);
    if (!match.matched) continue;
    consultations.push(
      buildRequestConsultation(row, reply, match.isSender, match.isRecipient, ctx),
    );
  }

  for (const row of peerMessages) {
    if (row.kind !== "reply") continue;
    if (row.replyTo && requestIds.has(row.replyTo)) continue;
    const match = matchesConsultationRow(row, undefined, ctx);
    if (!match.matched) continue;
    consultations.push(buildOrphanReplyConsultation(row, match.isSender, ctx));
  }

  consultations.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return consultations;
}

function isTaskDirectlyLinked(task: Task, ctx: LineageContext): boolean {
  if (task.requestedByTurnId && ctx.relatedTurnIds.has(task.requestedByTurnId)) return true;
  if (ctx.turn?.taskId && ctx.turn.taskId === task.id) return true;
  if (ctx.message?.taskId && ctx.message.taskId === task.id) return true;
  if (ctx.message?.event?.taskId && ctx.message.event.taskId === task.id) return true;
  if (task.execution?.agentId && ctx.executionIds.has(task.execution.agentId)) return true;
  return false;
}

function isTurnOwnedByDifferentMessage(turnId: string, ctx: LineageContext): boolean {
  if (ctx.relatedTurnIds.size === 0) return false;
  if (!ctx.hasWindowBounds) return true;
  const requestingTurn = ctx.turns?.find((t) => t.id === turnId);
  return Boolean(
    requestingTurn?.finalMessageId && requestingTurn.finalMessageId !== ctx.message?.id,
  );
}

function matchesTaskForLineage(task: Task, ctx: LineageContext): boolean {
  if (isTaskDirectlyLinked(task, ctx)) return true;
  if (task.conversationId !== ctx.conversationId) return false;
  if (normalizePeerId(task.assistantId) !== ctx.normalizedAssistantId) return false;
  if (task.origin === "user") return false;
  if (
    ctx.threadId !== null &&
    task.sourceThreadId !== undefined &&
    (task.sourceThreadId ?? null) !== ctx.threadId
  ) {
    return false;
  }
  if (ctx.hasWindowBounds && !isTimestampInWindow(task.createdAt, ctx)) {
    return false;
  }
  if (task.requestedByTurnId && isTurnOwnedByDifferentMessage(task.requestedByTurnId, ctx)) {
    return false;
  }
  return true;
}

function collectSpawnedTasks(
  rawTasks: readonly Task[] | undefined,
  ctx: LineageContext,
): TaskSummary[] {
  const tasks: TaskSummary[] = [];
  for (const task of rawTasks ?? []) {
    if (!matchesTaskForLineage(task, ctx)) continue;
    tasks.push({
      id: task.id,
      title: taskTitle(task),
      status: task.status,
      statusLabel: TURN_STATUS_LABEL[task.status] ?? task.status,
      prompt: task.prompt,
      serverId: task.serverId,
      directory: task.directory,
      provider: task.provider,
      isolation: task.isolation,
      createdAt: task.createdAt,
      error: task.error,
      task,
    });
  }
  tasks.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return tasks;
}

function matchesTakeoverForLineage(takeover: Takeover, ctx: LineageContext): boolean {
  if (takeover.turnId && ctx.relatedTurnIds.has(takeover.turnId)) return true;
  if (takeover.conversationId !== ctx.conversationId) return false;
  if (normalizePeerId(takeover.assistantId) !== ctx.normalizedAssistantId) return false;
  if ((takeover.threadId ?? null) !== ctx.threadId) return false;
  if (ctx.hasWindowBounds && !isTimestampInWindow(takeover.createdAt, ctx)) {
    return false;
  }
  if (takeover.turnId && isTurnOwnedByDifferentMessage(takeover.turnId, ctx)) {
    return false;
  }
  return true;
}

function collectBrowserTakeovers(
  rawTakeovers: readonly Takeover[] | undefined,
  ctx: LineageContext,
): BrowserTakeover[] {
  const takeovers: BrowserTakeover[] = [];
  for (const takeover of rawTakeovers ?? []) {
    if (!matchesTakeoverForLineage(takeover, ctx)) continue;
    const domain = parseUrlDomain(takeover.url);
    const displayLabel =
      takeover.title || domain || takeover.url || takeover.reason || "Browser takeover";
    takeovers.push({
      id: takeover.id,
      kind: takeover.kind,
      status: takeover.status,
      reason: takeover.reason,
      url: takeover.url ?? null,
      title: takeover.title ?? null,
      domain,
      displayLabel,
      createdAt: takeover.createdAt,
      updatedAt: takeover.updatedAt,
      takeover,
    });
  }
  takeovers.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return takeovers;
}

function deriveConsultedPeers(consultations: readonly PeerMailboxActivity[]): ConsultedPeer[] {
  const consultedPeers: ConsultedPeer[] = [];
  const seenPeerIds = new Set<string>();
  for (const item of consultations) {
    const key = item.peerId || item.peerName;
    if (!key || seenPeerIds.has(key)) continue;
    seenPeerIds.add(key);
    consultedPeers.push({
      id: item.peerId,
      name: item.peerName,
    });
  }
  return consultedPeers;
}

/**
 * Aggregates collaboration and execution lineage for a given assistant turn or message:
 * - Peer mailbox consultations (ask / reply / share)
 * - Spawned tasks in the conversation
 * - Browser takeovers requested in the conversation
 * - Compact provenance summary (`consultedPeers`, `taskCount`, `takeoverCount`)
 */
export function buildTurnLineage(input: BuildTurnLineageInput): TurnLineage {
  const ctx = createLineageContext(input);
  if (!ctx) {
    const { turn, message } = resolveTurnAndMessage(input);
    const emptyProvenance: TurnProvenanceSummary = {
      consultedPeers: [],
      taskCount: 0,
      takeoverCount: 0,
    };
    return {
      turnId: turn?.id ?? null,
      messageId: message?.id ?? null,
      assistantId: resolveAssistantId(input.assistantId, turn, message),
      conversationId:
        input.conversationId ?? turn?.conversationId ?? message?.conversationId ?? null,
      threadId: resolveThreadId(input.threadId, turn, message),
      consultations: [],
      tasks: [],
      takeovers: [],
      provenance: emptyProvenance,
      consultedPeers: [],
      taskCount: 0,
      takeoverCount: 0,
      hasLineage: false,
    };
  }

  const consultations = collectConsultations(input.peerMessages, ctx);
  const tasks = collectSpawnedTasks(input.tasks, ctx);
  const takeovers = collectBrowserTakeovers(input.takeovers, ctx);
  const consultedPeers = deriveConsultedPeers(consultations);
  const taskCount = tasks.length;
  const takeoverCount = takeovers.length;
  const provenance: TurnProvenanceSummary = {
    consultedPeers,
    taskCount,
    takeoverCount,
  };
  const hasLineage =
    consultations.length > 0 || consultedPeers.length > 0 || taskCount > 0 || takeoverCount > 0;

  return {
    turnId: ctx.turn?.id ?? null,
    messageId: ctx.message?.id ?? null,
    assistantId: ctx.rawAssistantId,
    conversationId: ctx.conversationId,
    threadId: ctx.threadId,
    consultations,
    tasks,
    takeovers,
    provenance,
    consultedPeers,
    taskCount,
    takeoverCount,
    hasLineage,
  };
}
