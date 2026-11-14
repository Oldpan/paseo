import { createHash, randomUUID } from "node:crypto";
import type { ChatStore } from "./store";

// Direct Agent Mailbox ledger, ported from Bigbang Core's agentMailboxService. A request or info
// message goes from one peer to another; a reply answers a request and leaves a wakeup for the
// requester. Peers are keys: `assistant:<id>` or `agent:<serverId>:<agentId>`. Paseo has one
// owner, so the old owner scoping is gone; everything else (state machine, idempotency, fan-out
// limit, root fences) is kept as it was.

export type MailboxKind = "request" | "info" | "reply";
export type MailboxOutgoingKind = "request" | "info";
export type MailboxStatus = "queued" | "delivered" | "acked" | "failed" | "cancelled";
export type MailboxWakeupStatus = "pending" | "delivered" | "fenced" | "failed";
export type MailboxOutcome = "ok" | "failed";
export type MailboxErrorCode =
  | "invalid_kind"
  | "invalid_input"
  | "self_recipient"
  | "fanout_limit"
  | "idempotency_conflict"
  | "not_found"
  | "not_cancellable"
  | "invalid_transition"
  | "reply_target_not_request"
  | "reply_to_reply"
  | "reply_wrong_agent"
  | "reply_root_fenced"
  | "root_fenced"
  | "empty_payload";

export class MailboxError extends Error {
  constructor(
    readonly code: MailboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

export interface MailboxMessage {
  mailboxId: string;
  senderKey: string;
  recipientKey: string;
  kind: MailboxKind;
  status: MailboxStatus;
  /** The chat lane the sender asked from; a reply wakes the sender there. Null for Studio agents. */
  originConversationId: string | null;
  originThreadId: string | null;
  originRootId: string;
  senderTurnId: string | null;
  correlationId: string;
  replyToMailboxId: string | null;
  outcome: MailboxOutcome | null;
  payloadText: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  /** The Studio a Studio agent sent from or is reached through. */
  studioId: string | null;
  /** The sender's Studio binding token when it sent; a reply checks it is still current. */
  senderBindingToken: string | null;
  targetSessionId: string | null;
  targetTurnId: string | null;
  firstDeferredAt: number | null;
  failureReason: string | null;
  createdAt: number;
  queuedAt: number;
  deliveredAt: number | null;
  ackedAt: number | null;
  failedAt: number | null;
  cancelledAt: number | null;
  updatedAt: number;
}

export interface MailboxWakeup {
  wakeupId: string;
  replyMailboxId: string;
  requestMailboxId: string;
  originRootId: string;
  parentKey: string;
  parentConversationId: string;
  parentThreadId: string | null;
  status: MailboxWakeupStatus;
  attempts: number;
  lastError: string | null;
  deliveredTurnId: string | null;
  createdAt: number;
  updatedAt: number;
  deliveredAt: number | null;
}

export interface CreateOutgoingInput {
  senderKey: string;
  recipientKey: string;
  kind: MailboxOutgoingKind;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originRootId: string;
  senderTurnId?: string | null;
  correlationId?: string;
  payloadText: string;
  idempotencyKey: string;
  studioId?: string | null;
  senderBindingToken?: string | null;
}

export interface CreateReplyInput {
  replyToMailboxId: string;
  replierKey: string;
  targetTurnId?: string | null;
  outcome: MailboxOutcome;
  payloadText: string;
  idempotencyKey?: string;
}

const MESSAGE_COLUMNS = `
  mailbox_id AS mailboxId, sender_key AS senderKey, recipient_key AS recipientKey, kind, status,
  origin_conversation_id AS originConversationId, origin_thread_id AS originThreadId,
  origin_root_id AS originRootId, sender_turn_id AS senderTurnId, correlation_id AS correlationId,
  reply_to_mailbox_id AS replyToMailboxId, outcome, payload_text AS payloadText,
  idempotency_key AS idempotencyKey, payload_fingerprint AS payloadFingerprint,
  studio_id AS studioId, sender_binding_token AS senderBindingToken,
  target_session_id AS targetSessionId, target_turn_id AS targetTurnId,
  first_deferred_at AS firstDeferredAt, failure_reason AS failureReason, created_at AS createdAt,
  queued_at AS queuedAt, delivered_at AS deliveredAt, acked_at AS ackedAt, failed_at AS failedAt,
  cancelled_at AS cancelledAt, updated_at AS updatedAt`;

const WAKEUP_COLUMNS = `
  wakeup_id AS wakeupId, reply_mailbox_id AS replyMailboxId,
  request_mailbox_id AS requestMailboxId, origin_root_id AS originRootId, parent_key AS parentKey,
  parent_conversation_id AS parentConversationId, parent_thread_id AS parentThreadId, status,
  attempts, last_error AS lastError, delivered_turn_id AS deliveredTurnId,
  created_at AS createdAt, updated_at AS updatedAt, delivered_at AS deliveredAt`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mailbox_messages (
  mailbox_id TEXT PRIMARY KEY,
  sender_key TEXT NOT NULL,
  recipient_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  origin_conversation_id TEXT,
  origin_thread_id TEXT,
  origin_root_id TEXT NOT NULL,
  sender_turn_id TEXT,
  correlation_id TEXT NOT NULL,
  reply_to_mailbox_id TEXT,
  outcome TEXT,
  payload_text TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  studio_id TEXT,
  sender_binding_token TEXT,
  target_session_id TEXT,
  target_turn_id TEXT,
  first_deferred_at INTEGER,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  delivered_at INTEGER,
  acked_at INTEGER,
  failed_at INTEGER,
  cancelled_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(sender_key, recipient_key, origin_root_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS mailbox_messages_root ON mailbox_messages(origin_root_id);
CREATE INDEX IF NOT EXISTS mailbox_messages_recipient ON mailbox_messages(recipient_key, status);
CREATE TABLE IF NOT EXISTS mailbox_wakeups (
  wakeup_id TEXT PRIMARY KEY,
  reply_mailbox_id TEXT NOT NULL UNIQUE,
  request_mailbox_id TEXT NOT NULL,
  origin_root_id TEXT NOT NULL,
  parent_key TEXT NOT NULL,
  parent_conversation_id TEXT NOT NULL,
  parent_thread_id TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_error TEXT,
  delivered_turn_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS mailbox_wakeups_pending ON mailbox_wakeups(status, parent_key);
CREATE TABLE IF NOT EXISTS mailbox_root_fences (
  origin_root_id TEXT PRIMARY KEY,
  fenced_at INTEGER NOT NULL
);`;

function fail(code: MailboxErrorCode, message: string): never {
  throw new MailboxError(code, message);
}
function requireNonEmpty(value: string | null | undefined, field: string): void {
  if (!value?.trim()) fail("invalid_input", `${field} must be non-empty`);
}
export function mailboxPayloadFingerprint(kind: string, payloadText: string): string {
  return createHash("sha256").update(`${kind}\n${payloadText}\n`).digest("hex");
}
function isUniqueConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}
/** Recipients a root reached with request or info messages, for fan-out across ledgers. */
export function newPeers(rows: ReadonlyArray<{ recipientKey: string }>): Set<string> {
  return new Set(rows.map((row) => row.recipientKey));
}

export class MailboxLedger {
  private readonly maxNewPeersPerRoot: number;
  private readonly now: () => number;

  private readonly onChange: ((record: MailboxMessage) => void) | undefined;

  constructor(
    private readonly store: ChatStore,
    options: {
      maxNewPeersPerRoot?: number;
      now?: () => number;
      /** Called for every row a write changes, inside the write's transaction. */
      onChange?: (record: MailboxMessage) => void;
    } = {},
  ) {
    this.maxNewPeersPerRoot = options.maxNewPeersPerRoot ?? 1;
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange;
    store.database.exec(SCHEMA);
  }

  private get db() {
    return this.store.database;
  }

  createOutgoing(input: CreateOutgoingInput): { record: MailboxMessage; created: boolean } {
    return this.store.transaction(() => {
      if (!input.payloadText.trim())
        fail("empty_payload", "mailbox payload_text must be non-empty");
      if (input.kind !== "request" && input.kind !== "info")
        fail("invalid_kind", `outgoing kind must be request or info, got ${String(input.kind)}`);
      requireNonEmpty(input.senderKey, "senderKey");
      requireNonEmpty(input.recipientKey, "recipientKey");
      requireNonEmpty(input.originRootId, "originRootId");
      requireNonEmpty(input.idempotencyKey, "idempotencyKey");
      if (input.senderKey === input.recipientKey)
        fail("self_recipient", "sender cannot equal recipient");

      const fingerprint = mailboxPayloadFingerprint(input.kind, input.payloadText);
      const existing = this.findByIdempotency(
        input.senderKey,
        input.recipientKey,
        input.originRootId,
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint)
          fail(
            "idempotency_conflict",
            "idempotency key reused with a different payload fingerprint",
          );
        return { record: existing, created: false };
      }
      if (this.isRootFenced(input.originRootId))
        fail("root_fenced", "root is fenced; new outgoing is not inserted");
      this.assertFanoutAllowed(input.originRootId, input.recipientKey);

      const now = this.now();
      const mailboxId = randomUUID();
      try {
        this.db
          .prepare(
            `INSERT INTO mailbox_messages(
               mailbox_id, sender_key, recipient_key, kind, status, origin_conversation_id,
               origin_thread_id, origin_root_id, sender_turn_id, correlation_id, payload_text,
               idempotency_key, payload_fingerprint, studio_id, sender_binding_token, created_at,
               queued_at, updated_at
             ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            mailboxId,
            input.senderKey,
            input.recipientKey,
            input.kind,
            input.originConversationId ?? null,
            input.originThreadId ?? null,
            input.originRootId,
            input.senderTurnId ?? null,
            input.correlationId?.trim() ? input.correlationId : randomUUID(),
            input.payloadText,
            input.idempotencyKey,
            fingerprint,
            input.studioId ?? null,
            input.senderBindingToken ?? null,
            now,
            now,
            now,
          );
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        const raced = this.findByIdempotency(
          input.senderKey,
          input.recipientKey,
          input.originRootId,
          input.idempotencyKey,
        );
        if (raced?.payloadFingerprint === fingerprint) return { record: raced, created: false };
        fail("idempotency_conflict", "idempotency key reused with a different payload fingerprint");
      }
      return { record: this.notify(mailboxId), created: true };
    });
  }

  /**
   * Answers a request. A requester that asked from a chat lane gets a wakeup there; a Studio agent
   * has no lane (`wakeup` is null) and is answered natively by the caller.
   */
  createReply(input: CreateReplyInput): {
    record: MailboxMessage;
    wakeup: MailboxWakeup | null;
    created: boolean;
  } {
    return this.store.transaction(() => {
      const target = this.replyTarget(input);

      const idempotencyKey = input.idempotencyKey ?? `reply:${target.mailboxId}`;
      const fingerprint = mailboxPayloadFingerprint("reply", input.payloadText);
      const existing = this.findByIdempotency(
        input.replierKey,
        target.senderKey,
        target.originRootId,
        idempotencyKey,
      );
      if (existing) {
        if (existing.payloadFingerprint !== fingerprint)
          fail(
            "idempotency_conflict",
            "idempotency key reused with a different payload fingerprint",
          );
        return {
          record: existing,
          wakeup: this.findWakeupByReply(existing.mailboxId),
          created: false,
        };
      }
      if (target.status === "cancelled" || this.isRootFenced(target.originRootId))
        fail(
          "reply_root_fenced",
          "root is fenced or the request was cancelled; reply not inserted",
        );

      const now = this.now();
      const mailboxId = randomUUID();
      const wakeupId = target.originConversationId ? randomUUID() : null;
      try {
        this.db
          .prepare(
            `INSERT INTO mailbox_messages(
               mailbox_id, sender_key, recipient_key, kind, status, origin_conversation_id,
               origin_thread_id, origin_root_id, sender_turn_id, correlation_id,
               reply_to_mailbox_id, outcome, payload_text, idempotency_key, payload_fingerprint,
               studio_id, created_at, queued_at, updated_at
             ) VALUES (?, ?, ?, 'reply', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            mailboxId,
            input.replierKey,
            target.senderKey,
            target.originConversationId,
            target.originThreadId,
            target.originRootId,
            input.targetTurnId ?? null,
            target.correlationId,
            target.mailboxId,
            input.outcome,
            input.payloadText,
            idempotencyKey,
            fingerprint,
            target.studioId,
            now,
            now,
            now,
          );
        if (wakeupId)
          this.db
            .prepare(
              `INSERT INTO mailbox_wakeups(
                 wakeup_id, reply_mailbox_id, request_mailbox_id, origin_root_id, parent_key,
                 parent_conversation_id, parent_thread_id, status, attempts, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
            )
            .run(
              wakeupId,
              mailboxId,
              target.mailboxId,
              target.originRootId,
              target.senderKey,
              target.originConversationId,
              target.originThreadId,
              now,
              now,
            );
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        const raced = this.findByIdempotency(
          input.replierKey,
          target.senderKey,
          target.originRootId,
          idempotencyKey,
        );
        if (raced?.payloadFingerprint === fingerprint)
          return { record: raced, wakeup: this.findWakeupByReply(raced.mailboxId), created: false };
        fail("idempotency_conflict", "idempotency key reused with a different payload fingerprint");
      }
      return {
        record: this.notify(mailboxId),
        wakeup: wakeupId ? this.requireWakeup(wakeupId) : null,
        created: true,
      };
    });
  }

  private replyTarget(input: CreateReplyInput): MailboxMessage {
    if (!input.payloadText.trim()) fail("empty_payload", "mailbox payload_text must be non-empty");
    if (input.outcome !== "ok" && input.outcome !== "failed")
      fail("invalid_kind", "reply outcome must be ok or failed");
    const target = this.get(input.replyToMailboxId);
    if (!target) fail("not_found", `mailbox ${input.replyToMailboxId} not found`);
    if (target.kind === "reply") fail("reply_to_reply", "cannot reply to a reply");
    if (target.kind !== "request") fail("reply_target_not_request", "can only reply to a request");
    if (input.replierKey !== target.recipientKey)
      fail("reply_wrong_agent", "replier must be the request recipient");
    return target;
  }

  markDelivered(
    mailboxId: string,
    input: { targetSessionId: string; targetTurnId?: string | null },
  ): MailboxMessage {
    return this.store.transaction(() => {
      this.assertTransition(this.requireMessage(mailboxId).status, "delivered");
      const now = this.now();
      this.db
        .prepare(
          `UPDATE mailbox_messages SET status='delivered', target_session_id=?, target_turn_id=?,
             delivered_at=?, updated_at=? WHERE mailbox_id=?`,
        )
        .run(input.targetSessionId, input.targetTurnId ?? null, now, now, mailboxId);
      return this.notify(mailboxId);
    });
  }

  markAcked(mailboxId: string, input: { targetTurnId: string }): MailboxMessage {
    return this.store.transaction(() => {
      this.assertTransition(this.requireMessage(mailboxId).status, "acked");
      const now = this.now();
      this.db
        .prepare(
          `UPDATE mailbox_messages SET status='acked', target_turn_id=?, acked_at=?, updated_at=?
             WHERE mailbox_id=?`,
        )
        .run(input.targetTurnId, now, now, mailboxId);
      return this.notify(mailboxId);
    });
  }

  markFailed(mailboxId: string, reason: string): MailboxMessage {
    return this.store.transaction(() => {
      this.assertTransition(this.requireMessage(mailboxId).status, "failed");
      const now = this.now();
      this.db
        .prepare(
          `UPDATE mailbox_messages SET status='failed', failure_reason=?, failed_at=?, updated_at=?
             WHERE mailbox_id=?`,
        )
        .run(reason, now, now, mailboxId);
      return this.notify(mailboxId);
    });
  }

  /** Records when admission first had to wait, so the admission timeout survives restarts. */
  markDeferred(mailboxId: string): MailboxMessage {
    const now = this.now();
    this.db
      .prepare(
        `UPDATE mailbox_messages SET first_deferred_at=COALESCE(first_deferred_at, ?), updated_at=?
           WHERE mailbox_id=?`,
      )
      .run(now, now, mailboxId);
    return this.notify(mailboxId);
  }

  cancel(mailboxId: string): MailboxMessage {
    return this.store.transaction(() => {
      const current = this.requireMessage(mailboxId);
      if (current.kind !== "request")
        fail("not_cancellable", `${current.kind} cannot be cancelled`);
      if (current.status !== "queued" && current.status !== "delivered")
        fail("not_cancellable", `mailbox in status ${current.status} cannot be cancelled`);
      const now = this.now();
      this.applyCancel(mailboxId, now);
      this.fencePendingWakeupsForRequest(mailboxId, now);
      return this.notify(mailboxId);
    });
  }

  fenceRoot(originRootId: string): {
    cancelledMailboxIds: string[];
    ackedMailboxIds: string[];
    fencedWakeupIds: string[];
  } {
    return this.store.transaction(() => {
      const now = this.now();
      this.db
        .prepare(
          "INSERT OR IGNORE INTO mailbox_root_fences(origin_root_id, fenced_at) VALUES (?, ?)",
        )
        .run(originRootId, now);
      const outgoing = this.db
        .prepare(
          `SELECT mailbox_id AS mailboxId, status FROM mailbox_messages
             WHERE origin_root_id=? AND kind IN ('request','info')
             ORDER BY created_at ASC, mailbox_id ASC`,
        )
        .all(originRootId) as Array<{ mailboxId: string; status: MailboxStatus }>;
      const cancelledMailboxIds: string[] = [];
      const ackedMailboxIds: string[] = [];
      for (const row of outgoing) {
        if (row.status === "queued" || row.status === "delivered") {
          this.applyCancel(row.mailboxId, now);
          cancelledMailboxIds.push(row.mailboxId);
        } else if (row.status === "acked") ackedMailboxIds.push(row.mailboxId);
      }
      const pending = this.db
        .prepare(
          `SELECT wakeup_id AS wakeupId, reply_mailbox_id AS replyMailboxId FROM mailbox_wakeups
             WHERE origin_root_id=? AND status='pending' ORDER BY created_at ASC, wakeup_id ASC`,
        )
        .all(originRootId) as Array<{ wakeupId: string; replyMailboxId: string }>;
      for (const wakeup of pending)
        this.fenceWakeupAndCancelReply(wakeup.wakeupId, wakeup.replyMailboxId, now);
      return {
        cancelledMailboxIds,
        ackedMailboxIds,
        fencedWakeupIds: pending.map((wakeup) => wakeup.wakeupId),
      };
    });
  }

  isRootFenced(originRootId: string): boolean {
    if (
      this.db
        .prepare("SELECT 1 FROM mailbox_root_fences WHERE origin_root_id=? LIMIT 1")
        .get(originRootId)
    )
      return true;
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM mailbox_wakeups WHERE origin_root_id=? AND status='fenced' LIMIT 1")
        .get(originRootId),
    );
  }

  get(mailboxId: string): MailboxMessage | null {
    return (
      (this.db
        .prepare(`SELECT ${MESSAGE_COLUMNS} FROM mailbox_messages WHERE mailbox_id=?`)
        .get(mailboxId) as MailboxMessage | undefined) ?? null
    );
  }

  /** Newest first, at most 50, for a peer's own records. */
  listForPeer(input: {
    peerKey: string;
    originRootId?: string;
    statuses?: MailboxStatus[];
    limit: number;
  }): MailboxMessage[] {
    const limit = Math.min(50, Math.max(1, Math.floor(input.limit)));
    const clauses = ["(sender_key=? OR recipient_key=?)"];
    const params: Array<string | number> = [input.peerKey, input.peerKey];
    if (input.originRootId) {
      clauses.push("origin_root_id=?");
      params.push(input.originRootId);
    }
    if (input.statuses) {
      if (input.statuses.length === 0) return [];
      clauses.push(`status IN (${input.statuses.map(() => "?").join(",")})`);
      params.push(...input.statuses);
    }
    params.push(limit);
    return this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM mailbox_messages WHERE ${clauses.join(" AND ")}
           ORDER BY created_at DESC, mailbox_id DESC LIMIT ?`,
      )
      .all(...params) as unknown as MailboxMessage[];
  }

  listByRoot(originRootId: string): MailboxMessage[] {
    return this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM mailbox_messages WHERE origin_root_id=?
           ORDER BY created_at ASC, mailbox_id ASC`,
      )
      .all(originRootId) as unknown as MailboxMessage[];
  }

  listForRecipient(recipientKey: string, statuses?: MailboxStatus[]): MailboxMessage[] {
    if (statuses?.length === 0) return [];
    const filter = statuses ? ` AND status IN (${statuses.map(() => "?").join(",")})` : "";
    return this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM mailbox_messages WHERE recipient_key=?${filter}
           ORDER BY created_at ASC, mailbox_id ASC`,
      )
      .all(recipientKey, ...(statuses ?? [])) as unknown as MailboxMessage[];
  }

  /** Every request or info message that is not settled yet, oldest first. */
  listOpenOutgoing(): MailboxMessage[] {
    return this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM mailbox_messages
           WHERE kind IN ('request','info') AND status IN ('queued','delivered','acked')
           ORDER BY created_at ASC, mailbox_id ASC`,
      )
      .all() as unknown as MailboxMessage[];
  }

  /** Whether a request already has a reply (real or synthetic). */
  hasReply(requestMailboxId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM mailbox_messages WHERE reply_to_mailbox_id=? LIMIT 1")
        .get(requestMailboxId),
    );
  }

  /** Roots a sender turn opened with request or info messages. */
  rootsSentBy(senderTurnId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT origin_root_id AS originRootId FROM mailbox_messages
             WHERE sender_turn_id=? AND kind IN ('request','info')`,
        )
        .all(senderTurnId) as Array<{ originRootId: string }>
    ).map((row) => row.originRootId);
  }

  /** Recipients a root has reached with request or info messages. */
  peersOfRoot(originRootId: string): Set<string> {
    return newPeers(
      this.db
        .prepare(
          `SELECT DISTINCT recipient_key AS recipientKey FROM mailbox_messages
             WHERE origin_root_id=? AND kind IN ('request','info')`,
        )
        .all(originRootId) as Array<{ recipientKey: string }>,
    );
  }

  listPendingWakeups(filter: { parentKey?: string } = {}): MailboxWakeup[] {
    const clause = filter.parentKey ? " AND parent_key=?" : "";
    return this.db
      .prepare(
        `SELECT ${WAKEUP_COLUMNS} FROM mailbox_wakeups WHERE status='pending'${clause}
           ORDER BY created_at ASC, wakeup_id ASC`,
      )
      .all(...(filter.parentKey ? [filter.parentKey] : [])) as unknown as MailboxWakeup[];
  }

  findWakeupByReply(replyMailboxId: string): MailboxWakeup | null {
    return (
      (this.db
        .prepare(`SELECT ${WAKEUP_COLUMNS} FROM mailbox_wakeups WHERE reply_mailbox_id=? LIMIT 1`)
        .get(replyMailboxId) as MailboxWakeup | undefined) ?? null
    );
  }

  /** Wakeups a turn delivered, for recovery after a crash between queueing and settling. */
  listWakeupsDeliveredBy(turnId: string): MailboxWakeup[] {
    return this.db
      .prepare(
        `SELECT ${WAKEUP_COLUMNS} FROM mailbox_wakeups WHERE delivered_turn_id=?
           ORDER BY created_at ASC, wakeup_id ASC`,
      )
      .all(turnId) as unknown as MailboxWakeup[];
  }

  markWakeupDelivered(wakeupId: string, input: { turnId: string }): MailboxWakeup {
    return this.store.transaction(() => {
      const wakeup = this.requireWakeup(wakeupId);
      if (wakeup.status === "delivered") return wakeup;
      if (wakeup.status !== "pending")
        fail("invalid_transition", `cannot deliver wakeup in status ${wakeup.status}`);
      const reply = this.requireMessage(wakeup.replyMailboxId);
      if (reply.status !== "queued")
        fail("invalid_transition", `cannot deliver reply in status ${reply.status}`);
      const now = this.now();
      this.db
        .prepare(
          `UPDATE mailbox_wakeups SET status='delivered', delivered_turn_id=?, delivered_at=?,
             updated_at=? WHERE wakeup_id=?`,
        )
        .run(input.turnId, now, now, wakeupId);
      this.db
        .prepare(
          `UPDATE mailbox_messages SET status='delivered', target_turn_id=?, delivered_at=?,
             updated_at=? WHERE mailbox_id=?`,
        )
        .run(input.turnId, now, now, reply.mailboxId);
      this.notify(reply.mailboxId);
      return this.requireWakeup(wakeupId);
    });
  }

  markWakeupFailed(
    wakeupId: string,
    error: string,
    options: { terminal?: boolean } = {},
  ): MailboxWakeup {
    return this.store.transaction(() => {
      const wakeup = this.requireWakeup(wakeupId);
      if (wakeup.status !== "pending")
        fail("invalid_transition", `cannot fail wakeup in status ${wakeup.status}`);
      const now = this.now();
      this.db
        .prepare(
          `UPDATE mailbox_wakeups SET status=?, attempts=?, last_error=?, updated_at=?
             WHERE wakeup_id=?`,
        )
        .run(options.terminal ? "failed" : "pending", wakeup.attempts + 1, error, now, wakeupId);
      if (options.terminal) {
        const reply = this.requireMessage(wakeup.replyMailboxId);
        if (reply.status === "queued" || reply.status === "delivered")
          this.db
            .prepare(
              `UPDATE mailbox_messages SET status='failed', failure_reason=?, failed_at=?,
                 updated_at=? WHERE mailbox_id=?`,
            )
            .run(error, now, now, reply.mailboxId);
        this.notify(reply.mailboxId);
      }
      return this.requireWakeup(wakeupId);
    });
  }

  private findByIdempotency(
    senderKey: string,
    recipientKey: string,
    originRootId: string,
    idempotencyKey: string,
  ): MailboxMessage | null {
    return (
      (this.db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM mailbox_messages WHERE sender_key=? AND recipient_key=?
             AND origin_root_id=? AND idempotency_key=?`,
        )
        .get(senderKey, recipientKey, originRootId, idempotencyKey) as
        | MailboxMessage
        | undefined) ?? null
    );
  }

  private assertFanoutAllowed(originRootId: string, recipientKey: string): void {
    const peers = this.peersOfRoot(originRootId);
    if (peers.has(recipientKey)) return;
    if (peers.size >= this.maxNewPeersPerRoot)
      fail(
        "fanout_limit",
        `root already contacted ${peers.size} new peer(s); default limit is ${this.maxNewPeersPerRoot}`,
      );
  }

  private assertTransition(from: MailboxStatus, to: MailboxStatus): void {
    const allowed =
      (from === "queued" && to === "delivered") ||
      (from === "delivered" && to === "acked") ||
      ((from === "queued" || from === "delivered" || from === "acked") && to === "failed") ||
      ((from === "queued" || from === "delivered") && to === "cancelled");
    if (!allowed) fail("invalid_transition", `cannot transition mailbox from ${from} to ${to}`);
  }

  private applyCancel(mailboxId: string, now: number): void {
    this.db
      .prepare(
        "UPDATE mailbox_messages SET status='cancelled', cancelled_at=?, updated_at=? WHERE mailbox_id=?",
      )
      .run(now, now, mailboxId);
    this.notify(mailboxId);
  }

  private fenceWakeupAndCancelReply(wakeupId: string, replyMailboxId: string, now: number): void {
    this.db
      .prepare("UPDATE mailbox_wakeups SET status='fenced', updated_at=? WHERE wakeup_id=?")
      .run(now, wakeupId);
    const reply = this.get(replyMailboxId);
    if (reply && (reply.status === "queued" || reply.status === "delivered"))
      this.applyCancel(reply.mailboxId, now);
  }

  private fencePendingWakeupsForRequest(requestMailboxId: string, now: number): void {
    const pending = this.db
      .prepare(
        `SELECT wakeup_id AS wakeupId, reply_mailbox_id AS replyMailboxId FROM mailbox_wakeups
           WHERE request_mailbox_id=? AND status='pending'`,
      )
      .all(requestMailboxId) as Array<{ wakeupId: string; replyMailboxId: string }>;
    for (const wakeup of pending)
      this.fenceWakeupAndCancelReply(wakeup.wakeupId, wakeup.replyMailboxId, now);
  }

  // Tells the owner a row changed, inside the same transaction, so a projection stays atomic.
  private notify(mailboxId: string): MailboxMessage {
    const record = this.requireMessage(mailboxId);
    this.onChange?.(record);
    return record;
  }

  private requireMessage(mailboxId: string): MailboxMessage {
    return this.get(mailboxId) ?? fail("not_found", `mailbox ${mailboxId} not found`);
  }

  private requireWakeup(wakeupId: string): MailboxWakeup {
    return (
      (this.db
        .prepare(`SELECT ${WAKEUP_COLUMNS} FROM mailbox_wakeups WHERE wakeup_id=?`)
        .get(wakeupId) as MailboxWakeup | undefined) ??
      fail("not_found", `wakeup ${wakeupId} not found`)
    );
  }
}
