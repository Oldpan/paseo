import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  MailboxError,
  MailboxLedger,
  mailboxPayloadFingerprint,
  type CreateOutgoingInput,
  type MailboxErrorCode,
  type MailboxStatus,
} from "./mailbox-ledger";
import { ChatStore } from "./store";

// Ported from Bigbang Core's agentMailboxService.test.ts. Owner scoping, access checks and payload
// references do not exist in Paseo, so their cases are gone; the rest keep their names.

const ALICE = "assistant:alice";
const BOB = "assistant:bob";
const CAROL = "agent:srv_spark:carol";

const stores: ChatStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function createLedger(options?: { maxNewPeersPerRoot?: number; now?: () => number }) {
  const store = new ChatStore(":memory:");
  stores.push(store);
  return { store, db: store.database, ledger: new MailboxLedger(store, options) };
}
function fingerprint(kind: string, payloadText: string): string {
  return createHash("sha256").update(`${kind}\n${payloadText}\n`).digest("hex");
}
function expectMailboxError(fn: () => unknown, code: MailboxErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MailboxError);
    expect((error as MailboxError).code).toBe(code);
    return;
  }
  throw new Error(`expected MailboxError ${code}`);
}
function count(db: ChatStore["database"], originRootId?: string) {
  const where = originRootId ? " WHERE origin_root_id = ?" : "";
  const params = originRootId ? [originRootId] : [];
  return {
    messages: (
      db.prepare(`SELECT COUNT(*) AS n FROM mailbox_messages${where}`).get(...params) as {
        n: number;
      }
    ).n,
    wakeups: (
      db.prepare(`SELECT COUNT(*) AS n FROM mailbox_wakeups${where}`).get(...params) as {
        n: number;
      }
    ).n,
  };
}
function outgoing(ledger: MailboxLedger, overrides: Partial<CreateOutgoingInput> = {}) {
  return ledger.createOutgoing({
    senderKey: ALICE,
    recipientKey: BOB,
    kind: "request",
    originConversationId: "conv-parent",
    originRootId: "root-1",
    payloadText: "please review",
    idempotencyKey: "key-1",
    ...overrides,
  });
}

const STATUSES: readonly MailboxStatus[] = ["queued", "delivered", "acked", "failed", "cancelled"];
const ALLOWED = new Set([
  "queued->delivered",
  "queued->failed",
  "queued->cancelled",
  "delivered->acked",
  "delivered->failed",
  "delivered->cancelled",
  "acked->failed",
]);
function seedStatus(ledger: MailboxLedger, status: MailboxStatus, key: string) {
  const created = outgoing(ledger, {
    originRootId: `root-${key}`,
    idempotencyKey: key,
    payloadText: key,
  });
  const id = created.record.mailboxId;
  if (status === "queued") return created.record;
  if (status === "delivered") return ledger.markDelivered(id, { targetSessionId: `s-${key}` });
  if (status === "acked") {
    ledger.markDelivered(id, { targetSessionId: `s-${key}` });
    return ledger.markAcked(id, { targetTurnId: `t-${key}` });
  }
  if (status === "failed") return ledger.markFailed(id, `seed-fail-${key}`);
  return ledger.cancel(id);
}
function transition(ledger: MailboxLedger, mailboxId: string, to: MailboxStatus) {
  if (to === "delivered") return ledger.markDelivered(mailboxId, { targetSessionId: "s-to" });
  if (to === "acked") return ledger.markAcked(mailboxId, { targetTurnId: "t-to" });
  if (to === "failed") return ledger.markFailed(mailboxId, "fail-to");
  return ledger.cancel(mailboxId);
}

describe("MailboxLedger", () => {
  it("createOutgoing queues a projected row and honors idempotency", () => {
    const { ledger } = createLedger();
    const first = outgoing(ledger, { senderTurnId: "turn-sender", originThreadId: "thread-1" });
    expect(first.created).toBe(true);
    expect(first.record).toMatchObject({
      status: "queued",
      kind: "request",
      senderKey: ALICE,
      recipientKey: BOB,
      originConversationId: "conv-parent",
      originThreadId: "thread-1",
      originRootId: "root-1",
      senderTurnId: "turn-sender",
      payloadText: "please review",
      idempotencyKey: "key-1",
      replyToMailboxId: null,
      outcome: null,
      deliveredAt: null,
    });
    expect(first.record.correlationId).toBeTruthy();
    expect(first.record.payloadFingerprint).toBe(fingerprint("request", "please review"));
    expect(first.record.payloadFingerprint).toBe(
      mailboxPayloadFingerprint("request", "please review"),
    );
    expect(first.record.queuedAt).toBe(first.record.createdAt);
    expect(first.record.updatedAt).toBe(first.record.createdAt);

    const replay = outgoing(ledger, { senderTurnId: "turn-sender" });
    expect(replay.created).toBe(false);
    expect(replay.record.mailboxId).toBe(first.record.mailboxId);
    expectMailboxError(
      () => outgoing(ledger, { payloadText: "different body" }),
      "idempotency_conflict",
    );
    expect(ledger.listByRoot("root-1")).toHaveLength(1);
  });

  it("rejects a self recipient and an empty payload", () => {
    const { ledger } = createLedger();
    expectMailboxError(
      () => outgoing(ledger, { recipientKey: ALICE, idempotencyKey: "self" }),
      "self_recipient",
    );
    expectMailboxError(
      () => outgoing(ledger, { payloadText: "   ", idempotencyKey: "empty" }),
      "empty_payload",
    );
  });

  it("enforces fan-out of one new peer per root regardless of status", () => {
    const { store, ledger } = createLedger();
    const toBob = outgoing(ledger);
    expectMailboxError(
      () => outgoing(ledger, { recipientKey: CAROL, idempotencyKey: "to-carol" }),
      "fanout_limit",
    );
    const againToBob = outgoing(ledger, {
      idempotencyKey: "to-bob-again",
      payloadText: "second ask",
    });
    expect(againToBob.created).toBe(true);
    ledger.cancel(toBob.record.mailboxId);
    expectMailboxError(
      () => outgoing(ledger, { recipientKey: CAROL, idempotencyKey: "to-carol-after-cancel" }),
      "fanout_limit",
    );
    expect(ledger.peersOfRoot("root-1")).toEqual(new Set([BOB]));
    expect(
      outgoing(ledger, {
        originRootId: "root-2",
        recipientKey: CAROL,
        idempotencyKey: "other-root",
      }).created,
    ).toBe(true);

    const wide = new MailboxLedger(store, { maxNewPeersPerRoot: 2 });
    const base = { senderKey: ALICE, originRootId: "root-wide" };
    wide.createOutgoing({
      ...base,
      recipientKey: BOB,
      kind: "info",
      payloadText: "b",
      idempotencyKey: "w-b",
    });
    wide.createOutgoing({
      ...base,
      recipientKey: CAROL,
      kind: "request",
      payloadText: "c",
      idempotencyKey: "w-c",
    });
    expect(wide.peersOfRoot("root-wide").size).toBe(2);
  });

  it("allows queued→delivered→acked and rejects illegal cancel / skip-ack", () => {
    const { ledger } = createLedger();
    const created = outgoing(ledger);
    expectMailboxError(
      () => ledger.markAcked(created.record.mailboxId, { targetTurnId: "too-soon" }),
      "invalid_transition",
    );
    const delivered = ledger.markDelivered(created.record.mailboxId, {
      targetSessionId: "session-hidden",
      targetTurnId: "mailbox-turn",
    });
    expect(delivered).toMatchObject({
      status: "delivered",
      targetSessionId: "session-hidden",
      targetTurnId: "mailbox-turn",
    });
    expect(delivered.deliveredAt).toBeTypeOf("number");
    const acked = ledger.markAcked(delivered.mailboxId, { targetTurnId: "turn-target" });
    expect(acked).toMatchObject({ status: "acked", targetTurnId: "turn-target" });
    expect(acked.ackedAt).toBeTypeOf("number");
    expectMailboxError(() => ledger.cancel(acked.mailboxId), "not_cancellable");
    const failed = ledger.markFailed(acked.mailboxId, "target finished without reply");
    expect(failed).toMatchObject({
      status: "failed",
      failureReason: "target finished without reply",
    });

    const cancellable = outgoing(ledger, {
      idempotencyKey: "cancel-delivered",
      payloadText: "later",
    });
    ledger.markDelivered(cancellable.record.mailboxId, { targetSessionId: "session-2" });
    expect(ledger.cancel(cancellable.record.mailboxId).status).toBe("cancelled");
  });

  it("createReply writes reply+wakeup and rejects illegal reply targets", () => {
    const { db, ledger } = createLedger();
    const request = outgoing(ledger, { originThreadId: "thread-1" });
    const reply = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      targetTurnId: "turn-bob",
      outcome: "ok",
      payloadText: "reviewed",
    });
    expect(reply.created).toBe(true);
    expect(reply.record).toMatchObject({
      kind: "reply",
      status: "queued",
      senderKey: BOB,
      recipientKey: ALICE,
      replyToMailboxId: request.record.mailboxId,
      correlationId: request.record.correlationId,
      originRootId: "root-1",
      outcome: "ok",
      senderTurnId: "turn-bob",
      idempotencyKey: `reply:${request.record.mailboxId}`,
    });
    expect(reply.wakeup).toMatchObject({
      status: "pending",
      parentKey: ALICE,
      parentConversationId: "conv-parent",
      parentThreadId: "thread-1",
      requestMailboxId: request.record.mailboxId,
      replyMailboxId: reply.record.mailboxId,
    });
    expect(ledger.listPendingWakeups({ parentKey: ALICE })).toHaveLength(1);

    const replay = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "reviewed",
    });
    expect(replay.created).toBe(false);
    expect(replay.record.mailboxId).toBe(reply.record.mailboxId);
    expect(replay.wakeup?.wakeupId).toBe(reply.wakeup?.wakeupId);

    const info = outgoing(ledger, {
      kind: "info",
      originRootId: "root-info",
      idempotencyKey: "info-1",
      payloadText: "fyi",
    });
    expectMailboxError(
      () =>
        ledger.createReply({
          replyToMailboxId: info.record.mailboxId,
          replierKey: BOB,
          outcome: "ok",
          payloadText: "should fail",
        }),
      "reply_target_not_request",
    );
    expectMailboxError(
      () =>
        ledger.createReply({
          replyToMailboxId: reply.record.mailboxId,
          replierKey: ALICE,
          outcome: "ok",
          payloadText: "loop",
        }),
      "reply_to_reply",
    );
    const other = outgoing(ledger, {
      originRootId: "root-wrong",
      idempotencyKey: "wrong",
      payloadText: "ask",
    });
    expectMailboxError(
      () =>
        ledger.createReply({
          replyToMailboxId: other.record.mailboxId,
          replierKey: ALICE,
          outcome: "ok",
          payloadText: "not bob",
        }),
      "reply_wrong_agent",
    );
    const fenced = outgoing(ledger, {
      originRootId: "root-fence-reply",
      idempotencyKey: "fence-reply",
      payloadText: "x",
    });
    ledger.fenceRoot("root-fence-reply");
    const before = count(db, "root-fence-reply");
    expectMailboxError(
      () =>
        ledger.createReply({
          replyToMailboxId: fenced.record.mailboxId,
          replierKey: BOB,
          outcome: "ok",
          payloadText: "too late",
        }),
      "reply_root_fenced",
    );
    expect(count(db, "root-fence-reply")).toEqual(before);
  });

  it("fenceRoot cancels open outgoing, keeps acked, and fences pending wakeups", () => {
    const { db, ledger } = createLedger();
    const queued = outgoing(ledger, { idempotencyKey: "mix-queued", payloadText: "q" });
    const delivered = outgoing(ledger, { idempotencyKey: "mix-delivered", payloadText: "d" });
    ledger.markDelivered(delivered.record.mailboxId, { targetSessionId: "s" });
    const acked = outgoing(ledger, { idempotencyKey: "mix-acked", payloadText: "a" });
    ledger.markDelivered(acked.record.mailboxId, { targetSessionId: "s-ack" });
    ledger.markAcked(acked.record.mailboxId, { targetTurnId: "t-ack" });
    const replied = ledger.createReply({
      replyToMailboxId: acked.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "done",
    });
    const result = ledger.fenceRoot("root-1");
    expect(result.cancelledMailboxIds.toSorted()).toEqual(
      [queued.record.mailboxId, delivered.record.mailboxId].toSorted(),
    );
    expect(result.ackedMailboxIds).toEqual([acked.record.mailboxId]);
    expect(result.fencedWakeupIds).toEqual([replied.wakeup?.wakeupId]);
    expect(ledger.get(acked.record.mailboxId)?.status).toBe("acked");
    expect(ledger.get(queued.record.mailboxId)?.status).toBe("cancelled");
    expect(ledger.get(replied.record.mailboxId)?.status).toBe("cancelled");
    expect(
      (
        db
          .prepare("SELECT status FROM mailbox_wakeups WHERE wakeup_id = ?")
          .get(replied.wakeup!.wakeupId) as { status: string }
      ).status,
    ).toBe("fenced");
    expect(ledger.isRootFenced("root-1")).toBe(true);
    expect(ledger.isRootFenced("root-other")).toBe(false);
    expect(ledger.fenceRoot("root-empty")).toEqual({
      cancelledMailboxIds: [],
      ackedMailboxIds: [],
      fencedWakeupIds: [],
    });
    expect(ledger.isRootFenced("root-empty")).toBe(true);
  });

  it("markWakeupDelivered and markWakeupFailed update reply + wakeup together", () => {
    const { ledger } = createLedger();
    const request = outgoing(ledger);
    const reply = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "first reply",
    });
    const wakeup = ledger.markWakeupDelivered(reply.wakeup!.wakeupId, { turnId: "turn-parent" });
    expect(wakeup).toMatchObject({ status: "delivered", deliveredTurnId: "turn-parent" });
    expect(wakeup.deliveredAt).toBeTypeOf("number");
    expect(ledger.get(reply.record.mailboxId)).toMatchObject({
      status: "delivered",
      targetTurnId: "turn-parent",
    });
    expect(ledger.listWakeupsDeliveredBy("turn-parent").map((row) => row.wakeupId)).toEqual([
      wakeup.wakeupId,
    ]);

    const retryRequest = outgoing(ledger, { idempotencyKey: "retry-req", payloadText: "again" });
    const retryReply = ledger.createReply({
      replyToMailboxId: retryRequest.record.mailboxId,
      replierKey: BOB,
      outcome: "failed",
      payloadText: "will retry",
    });
    const retried = ledger.markWakeupFailed(retryReply.wakeup!.wakeupId, "transient");
    expect(retried).toMatchObject({ status: "pending", attempts: 1, lastError: "transient" });
    expect(ledger.get(retryReply.record.mailboxId)?.status).toBe("queued");
    const terminal = ledger.markWakeupFailed(retryReply.wakeup!.wakeupId, "give up", {
      terminal: true,
    });
    expect(terminal).toMatchObject({ status: "failed", attempts: 2, lastError: "give up" });
    expect(ledger.get(retryReply.record.mailboxId)).toMatchObject({
      status: "failed",
      failureReason: "give up",
    });
  });

  it("counts cancelled and failed first peers, and info then request, toward fan-out", () => {
    const { ledger } = createLedger();
    const failedFirst = outgoing(ledger, {
      originRootId: "root-failed",
      idempotencyKey: "fail-b",
      payloadText: "b",
    });
    ledger.markFailed(failedFirst.record.mailboxId, "dispatch failed");
    expectMailboxError(
      () =>
        outgoing(ledger, {
          originRootId: "root-failed",
          recipientKey: CAROL,
          idempotencyKey: "fail-c",
          payloadText: "c",
        }),
      "fanout_limit",
    );
    outgoing(ledger, {
      kind: "info",
      originRootId: "root-info-fanout",
      idempotencyKey: "info-b",
      payloadText: "fyi",
    });
    expectMailboxError(
      () =>
        outgoing(ledger, {
          originRootId: "root-info-fanout",
          recipientKey: CAROL,
          idempotencyKey: "req-c",
          payloadText: "ask",
        }),
      "fanout_limit",
    );
    const shared = outgoing(ledger, {
      originRootId: "root-reply",
      idempotencyKey: "r-b",
      payloadText: "b",
    });
    ledger.createReply({
      replyToMailboxId: shared.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "reply must not add a peer",
    });
    expect(ledger.peersOfRoot("root-reply")).toEqual(new Set([BOB]));
    expectMailboxError(
      () =>
        outgoing(ledger, {
          originRootId: "root-reply",
          recipientKey: CAROL,
          idempotencyKey: "r-c",
          payloadText: "c",
        }),
      "fanout_limit",
    );
  });

  it("allows only the documented (from,to) mailbox transitions", () => {
    const { ledger } = createLedger();
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (to === "queued") continue;
        const seeded = seedStatus(ledger, from, `${from}-to-${to}`);
        if (ALLOWED.has(`${from}->${to}`)) {
          expect(transition(ledger, seeded.mailboxId, to).status).toBe(to);
          continue;
        }
        expectMailboxError(
          () => transition(ledger, seeded.mailboxId, to),
          to === "cancelled" ? "not_cancellable" : "invalid_transition",
        );
        expect(ledger.get(seeded.mailboxId)?.status).toBe(from);
      }
    }
  });

  it("rejects reply to a cancelled request without inserting rows", () => {
    const { db, ledger } = createLedger();
    const request = outgoing(ledger, {
      originRootId: "root-cancelled-reply",
      idempotencyKey: "cancel-req",
    });
    ledger.cancel(request.record.mailboxId);
    const before = count(db, "root-cancelled-reply");
    expectMailboxError(
      () =>
        ledger.createReply({
          replyToMailboxId: request.record.mailboxId,
          replierKey: BOB,
          outcome: "ok",
          payloadText: "too late",
        }),
      "reply_root_fenced",
    );
    expect(count(db, "root-cancelled-reply")).toEqual(before);
  });

  it("answers a requester without a chat lane (a Studio agent) with no wakeup", () => {
    const { db, ledger } = createLedger();
    const request = outgoing(ledger, {
      senderKey: CAROL,
      recipientKey: BOB,
      originConversationId: null,
      originRootId: "root-no-origin",
      idempotencyKey: "no-origin",
    });
    const reply = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "answered natively",
    });
    expect(reply.created).toBe(true);
    expect(reply.wakeup).toBeNull();
    expect(reply.record.recipientKey).toBe(CAROL);
    expect(count(db, "root-no-origin")).toEqual({ messages: 2, wakeups: 0 });
  });

  it("fenceRoot on an empty root is sticky and a second call is idempotent", () => {
    const { db, ledger } = createLedger();
    const first = ledger.fenceRoot("root-empty-again");
    expect(ledger.fenceRoot("root-empty-again")).toEqual(first);
    expect(ledger.isRootFenced("root-empty-again")).toBe(true);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM mailbox_root_fences WHERE origin_root_id = ?")
          .get("root-empty-again") as { n: number }
      ).n,
    ).toBe(1);
  });

  it("lists by recipient status filter and by root created_at order", () => {
    let now = 1_700_000_000_000;
    const { ledger } = createLedger({ now: () => now });
    const first = outgoing(ledger, { idempotencyKey: "list-q", payloadText: "q" });
    now += 10;
    const second = outgoing(ledger, { idempotencyKey: "list-d", payloadText: "d" });
    ledger.markDelivered(second.record.mailboxId, { targetSessionId: "s-d" });
    now += 10;
    const third = outgoing(ledger, { idempotencyKey: "list-a", payloadText: "a" });
    ledger.markDelivered(third.record.mailboxId, { targetSessionId: "s-a" });
    ledger.markAcked(third.record.mailboxId, { targetTurnId: "t-a" });
    expect(ledger.listForRecipient(BOB, ["queued"]).map((row) => row.mailboxId)).toEqual([
      first.record.mailboxId,
    ]);
    expect(
      ledger.listForRecipient(BOB, ["delivered", "acked"]).map((row) => row.mailboxId),
    ).toEqual([second.record.mailboxId, third.record.mailboxId]);
    expect(ledger.listByRoot("root-1").map((row) => row.createdAt)).toEqual([
      first.record.createdAt,
      second.record.createdAt,
      third.record.createdAt,
    ]);
    expect(ledger.listForPeer({ peerKey: BOB, limit: 2 }).map((row) => row.mailboxId)).toEqual([
      third.record.mailboxId,
      second.record.mailboxId,
    ]);
  });

  it("enforces the idempotency unique index at the SQL layer", () => {
    const { db, ledger } = createLedger();
    const created = outgoing(ledger);
    const now = Date.now();
    expect(() =>
      db
        .prepare(
          `INSERT INTO mailbox_messages(mailbox_id, sender_key, recipient_key, kind, status,
             origin_root_id, correlation_id, payload_text, idempotency_key, payload_fingerprint,
             created_at, queued_at, updated_at)
           VALUES ('dup', ?, ?, 'request', 'queued', ?, 'corr', 'raw', ?, 'fp', ?, ?, ?)`,
        )
        .run(
          created.record.senderKey,
          created.record.recipientKey,
          created.record.originRootId,
          created.record.idempotencyKey,
          now,
          now,
          now,
        ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects new outgoing after fenceRoot and still replays a pre-fence row", () => {
    const { db, ledger } = createLedger();
    const created = outgoing(ledger, {
      originRootId: "root-block-out",
      idempotencyKey: "pre-fence",
      payloadText: "before",
    });
    ledger.fenceRoot("root-block-out");
    const afterFence = count(db, "root-block-out");
    expectMailboxError(
      () =>
        outgoing(ledger, {
          originRootId: "root-block-out",
          idempotencyKey: "post-fence",
          payloadText: "after",
        }),
      "root_fenced",
    );
    expect(count(db, "root-block-out")).toEqual(afterFence);
    const replay = outgoing(ledger, {
      originRootId: "root-block-out",
      idempotencyKey: "pre-fence",
      payloadText: "before",
    });
    expect(replay.created).toBe(false);
    expect(replay.record.mailboxId).toBe(created.record.mailboxId);
  });

  it("replays an existing reply after fenceRoot and after cancel(request)", () => {
    const { ledger } = createLedger();
    const reply = (mailboxId: string, payloadText: string) =>
      ledger.createReply({
        replyToMailboxId: mailboxId,
        replierKey: BOB,
        outcome: "ok",
        payloadText,
      });
    const fencedReq = outgoing(ledger, {
      originRootId: "root-replay-fence",
      idempotencyKey: "rf",
      payloadText: "ask",
    });
    const fencedReply = reply(fencedReq.record.mailboxId, "done fence");
    ledger.fenceRoot("root-replay-fence");
    const fencedReplay = reply(fencedReq.record.mailboxId, "done fence");
    expect(fencedReplay.created).toBe(false);
    expect(fencedReplay.record.mailboxId).toBe(fencedReply.record.mailboxId);
    expect(fencedReplay.wakeup?.wakeupId).toBe(fencedReply.wakeup?.wakeupId);

    const cancelReq = outgoing(ledger, {
      originRootId: "root-replay-cancel",
      idempotencyKey: "rc",
      payloadText: "ask",
    });
    const cancelReply = reply(cancelReq.record.mailboxId, "done cancel");
    ledger.cancel(cancelReq.record.mailboxId);
    const cancelReplay = reply(cancelReq.record.mailboxId, "done cancel");
    expect(cancelReplay.created).toBe(false);
    expect(cancelReplay.record.mailboxId).toBe(cancelReply.record.mailboxId);
  });

  it("conflicts on a reused reply key and allows a second reply with an explicit key", () => {
    const { ledger } = createLedger();
    const request = outgoing(ledger, { originRootId: "root-two-replies", idempotencyKey: "two" });
    const first = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "first answer",
    });
    expectMailboxError(
      () =>
        ledger.createReply({
          replyToMailboxId: request.record.mailboxId,
          replierKey: BOB,
          outcome: "ok",
          payloadText: "different answer",
        }),
      "idempotency_conflict",
    );
    const second = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "second answer",
      idempotencyKey: "reply-alt",
    });
    expect(second.created).toBe(true);
    expect(second.wakeup?.wakeupId).not.toBe(first.wakeup?.wakeupId);
    expect(ledger.listPendingWakeups({ parentKey: ALICE })).toHaveLength(2);
  });

  it("cancel(request) after createReply fences the wakeup and cancels the reply", () => {
    const { db, ledger } = createLedger();
    const request = outgoing(ledger, { originRootId: "root-cancel-retract", idempotencyKey: "cr" });
    const reply = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "will retract",
    });
    expect(ledger.cancel(request.record.mailboxId).status).toBe("cancelled");
    expect(ledger.get(reply.record.mailboxId)?.status).toBe("cancelled");
    expect(
      (
        db
          .prepare("SELECT status FROM mailbox_wakeups WHERE wakeup_id = ?")
          .get(reply.wakeup!.wakeupId) as { status: string }
      ).status,
    ).toBe("fenced");
  });

  it("cancel(info) is not_cancellable", () => {
    const { ledger } = createLedger();
    const info = outgoing(ledger, {
      kind: "info",
      originRootId: "root-info-cancel",
      idempotencyKey: "ic",
      payloadText: "fyi",
    });
    expectMailboxError(() => ledger.cancel(info.record.mailboxId), "not_cancellable");
    expect(ledger.get(info.record.mailboxId)?.status).toBe("queued");
  });

  it("rejects empty originRootId and idempotencyKey as invalid_input", () => {
    const { db, ledger } = createLedger();
    for (const [originRootId, idempotencyKey] of [
      ["", "has-key"],
      ["   ", "has-key-2"],
      ["root-empty-key", ""],
      ["root-empty-key", "  "],
    ])
      expectMailboxError(() => outgoing(ledger, { originRootId, idempotencyKey }), "invalid_input");
    expect(count(db).messages).toBe(0);
  });

  it("markWakeupDelivered twice is a no-op replay", () => {
    const { ledger } = createLedger();
    const request = outgoing(ledger, { originRootId: "root-wakeup-replay", idempotencyKey: "wr" });
    const reply = ledger.createReply({
      replyToMailboxId: request.record.mailboxId,
      replierKey: BOB,
      outcome: "ok",
      payloadText: "deliver me",
    });
    const first = ledger.markWakeupDelivered(reply.wakeup!.wakeupId, { turnId: "turn-first" });
    const second = ledger.markWakeupDelivered(reply.wakeup!.wakeupId, { turnId: "turn-second" });
    expect(second).toMatchObject({ status: "delivered", deliveredTurnId: "turn-first" });
    expect(second.deliveredAt).toBe(first.deliveredAt);
  });

  it("keeps the admission deferral time from the first wait", () => {
    let now = 1_000;
    const { ledger } = createLedger({ now: () => now });
    const request = outgoing(ledger);
    expect(ledger.markDeferred(request.record.mailboxId).firstDeferredAt).toBe(1_000);
    now = 5_000;
    expect(ledger.markDeferred(request.record.mailboxId).firstDeferredAt).toBe(1_000);
    expect(ledger.listOpenOutgoing().map((row) => row.mailboxId)).toEqual([
      request.record.mailboxId,
    ]);
  });
});
