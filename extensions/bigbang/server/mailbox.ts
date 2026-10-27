import { createHash } from "node:crypto";
import type { Assistant, Turn } from "../shared/contracts";
import { isMailboxLane, mailboxLaneId, queueTurn } from "./chat-sessions";
import {
  MailboxError,
  MailboxLedger,
  type MailboxMessage,
  type MailboxOutcome,
  type MailboxOutgoingKind,
  type MailboxStatus,
  type MailboxWakeup,
} from "./mailbox-ledger";
import {
  ADMISSION_TIMEOUT_TEXT,
  NO_REPLY_TEXT,
  mailboxActivationPrompt,
  mailboxWakeupPrompt,
  runErrorText,
} from "./mailbox-prompts";
import { agentOfKey, assistantIdOfKey, assistantPeerKey } from "./peers";
import type { BoundMember, Member, StudioMessage } from "./studio";
import { isPass } from "./projection";
import type { ChatStore } from "./store";

// The Direct Agent Mailbox on Paseo executions, ported from Bigbang Core's agentMailboxRuntime.
// A request to an assistant becomes a turn in that assistant's private mailbox lane (its own
// execution, on its own machine); the turn's final answer is the reply. A reply leaves a wakeup,
// delivered as one turn per idle lane with up to five replies. Admission waits while the recipient
// is busy elsewhere, and cancelling the asking turn fences its root.

const DEFAULT_ADMISSION_MAX_WAIT_MS = 10 * 60 * 1000;
const WAKEUP_BATCH_SIZE = 5;
const LIST_MAX = 50;
const LIVE = new Set<Turn["status"]>(["creating", "running", "attention", "unknown"]);
const OPEN = new Set<Turn["status"]>(["queued", ...LIVE]);

export interface MailboxDeps {
  now?: () => number;
  admissionMaxWaitMs?: number;
  /** Stops a running mailbox turn whose request was fenced or cancelled. */
  cancelTurn(turn: Turn): void;
  /** Studio collaboration, for messages between assistants and agents in linked Studios. */
  studio?: StudioBridge;
  /** Runs background coordination where the coordinator waits for it (its queue). */
  background?(work: () => Promise<void>): void;
}
/** What the mailbox needs from the Studio to cross between Chat and Studio. */
export interface StudioBridge {
  memberForAssistant(
    assistantId: string,
    ref: string,
  ): Promise<{ studioId: string; member: Member; sender: BoundMember } | null>;
  deliverFromAssistant(input: {
    studioId: string;
    sender: BoundMember;
    recipient: Member;
    kind: "message" | "reply";
    replyTo: string | null;
    text: string;
    mailboxId: string;
    recipientToken?: string | null;
  }): Promise<StudioMessage>;
  assistantMember(studioId: string, assistantId: string): BoundMember | null;
  recordOfMailbox(mailboxId: string): { message: StudioMessage; senderToken: string | null } | null;
  addressOf(key: string): string | null;
}

/** A chat assistant sending from a live reply in one of its lanes. */
export interface AssistantSender {
  assistant: Assistant;
  turn: Turn;
}
export interface SendInput {
  to: string;
  text: string;
  kind?: MailboxOutgoingKind;
  idempotencyKey?: string;
}

export interface SendResult {
  mailboxId: string;
  status: string;
  correlationId: string;
  created: boolean;
  recipient: string;
  messages?: Array<{
    messageId: string;
    recipient: string;
    status: string;
    code: string;
    detail: string;
  }>;
}

export function mailboxTurnId(mailboxId: string): string {
  return `mailbox:${mailboxId}`;
}
function wakeupTurnId(wakeup: MailboxWakeup): string {
  return `wakeup:${wakeup.wakeupId}`;
}
function defaultIdempotencyKey(kind: string, recipientKey: string, text: string): string {
  return createHash("sha256")
    .update(`${kind}\n${recipientKey}\n${text}`)
    .digest("hex")
    .slice(0, 32);
}
function truncate(text: string, max = 500): string {
  return text.length <= max ? text : text.slice(0, max);
}
function laneKey(conversationId: string, threadId: string | null): string {
  return JSON.stringify([conversationId, threadId]);
}

export class Mailbox {
  readonly ledger: MailboxLedger;
  private readonly now: () => number;
  private readonly admissionMaxWaitMs: number;

  constructor(
    private readonly store: ChatStore,
    private readonly deps: MailboxDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.admissionMaxWaitMs = deps.admissionMaxWaitMs ?? DEFAULT_ADMISSION_MAX_WAIT_MS;
    this.ledger = new MailboxLedger(store, { now: this.now });
  }

  /** Resolves an assistant by id, key or unique name (an optional leading @ is ignored). */
  resolveAssistant(to: string): Assistant {
    const raw = to.trim();
    const id = assistantIdOfKey(raw) ?? raw;
    const byId = this.store.get("assistants", id);
    if (byId) return byId;
    const name = raw.replace(/^@+/, "").trim().toLowerCase();
    const matches = this.store
      .snapshot()
      .assistants.filter((assistant) => assistant.name.trim().toLowerCase() === name);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1)
      throw new MailboxError(
        "invalid_input",
        `Several assistants are named ${raw}; use one of: ${matches.map((item) => assistantPeerKey(item.id)).join(", ")}.`,
      );
    throw new MailboxError(
      "not_found",
      `No assistant named ${raw}. Call bigbang-peers to see who you can reach.`,
    );
  }

  async send(sender: AssistantSender, input: SendInput): Promise<SendResult> {
    if (isMailboxLane(sender.turn.conversationId))
      throw new MailboxError(
        "invalid_input",
        "You are answering a mailbox request. Put what you found in your reply instead of asking someone else.",
      );
    let recipient: Assistant;
    try {
      recipient = this.resolveAssistant(input.to);
    } catch (error) {
      if (!(error instanceof MailboxError && error.code === "not_found") || !this.deps.studio)
        throw error;
      const target = await this.deps.studio.memberForAssistant(sender.assistant.id, input.to);
      if (!target) throw error;
      return this.sendToMember(sender, target, input);
    }
    return this.sendToAssistant(sender, recipient, input);
  }

  private sendToAssistant(
    sender: AssistantSender,
    recipient: Assistant,
    input: SendInput,
  ): SendResult {
    const kind = input.kind ?? "request";
    const senderKey = assistantPeerKey(sender.assistant.id);
    const recipientKey = assistantPeerKey(recipient.id);
    const record = this.store.transaction(() => {
      const created = this.ledger.createOutgoing({
        senderKey,
        recipientKey,
        kind,
        originConversationId: sender.turn.conversationId,
        originThreadId: sender.turn.threadId,
        originRootId: sender.turn.rootTriggerId ?? sender.turn.triggerId ?? sender.turn.id,
        senderTurnId: sender.turn.id,
        payloadText: input.text,
        idempotencyKey:
          input.idempotencyKey?.trim() || defaultIdempotencyKey(kind, recipientKey, input.text),
      });
      if (created.created) this.deliver(created.record, sender.assistant.name, recipient);
      return { ...this.ledger.get(created.record.mailboxId)!, created: created.created };
    });
    return {
      mailboxId: record.mailboxId,
      status: record.status,
      correlationId: record.correlationId,
      created: record.created,
      recipient: recipient.name,
    };
  }

  // An assistant messages an agent in a Studio linked to it. The mailbox row keeps the fan-out,
  // fences and the wakeup; the Studio record carries the delivery and its receipt.
  private async sendToMember(
    sender: AssistantSender,
    target: { studioId: string; member: Member; sender: BoundMember },
    input: SendInput,
  ): Promise<SendResult> {
    const kind = input.kind ?? "request";
    const created = this.store.transaction(() => {
      const outgoing = this.ledger.createOutgoing({
        senderKey: assistantPeerKey(sender.assistant.id),
        recipientKey: target.member.key,
        kind,
        originConversationId: sender.turn.conversationId,
        originThreadId: sender.turn.threadId,
        originRootId: sender.turn.rootTriggerId ?? sender.turn.triggerId ?? sender.turn.id,
        senderTurnId: sender.turn.id,
        payloadText: input.text,
        idempotencyKey:
          input.idempotencyKey?.trim() ||
          defaultIdempotencyKey(kind, target.member.key, input.text),
        studioId: target.studioId,
        senderBindingToken: target.sender.bindingToken,
      });
      if (outgoing.created)
        this.ledger.markDelivered(outgoing.record.mailboxId, { targetSessionId: target.studioId });
      return outgoing;
    });
    const result = {
      mailboxId: created.record.mailboxId,
      correlationId: created.record.correlationId,
      created: created.created,
      recipient: target.member.address,
    };
    if (!created.created) return { ...result, status: created.record.status };
    const message = await this.deps.studio!.deliverFromAssistant({
      studioId: target.studioId,
      sender: target.sender,
      recipient: target.member,
      kind: "message",
      replyTo: null,
      text: input.text,
      mailboxId: created.record.mailboxId,
    });
    this.recordReceipt(created.record, message);
    return {
      ...result,
      status: this.ledger.get(created.record.mailboxId)!.status,
      messages: [
        {
          messageId: message.messageId,
          recipient: message.recipient.address,
          status: message.receipt.status,
          code: message.receipt.code,
          detail: message.receipt.message,
        },
      ],
    };
  }

  // The agent has it (acked), it never will (failed, and a request is answered as failed), or the
  // outcome is unknown (left delivered, never resent).
  private recordReceipt(record: MailboxMessage, message: StudioMessage): void {
    const { status, code } = message.receipt;
    if (status === "accepted" || status === "queued")
      this.ledger.markAcked(record.mailboxId, { targetTurnId: message.messageId });
    else if (status === "rejected" || status === "not_attempted")
      this.store.transaction(() => {
        this.ledger.markFailed(record.mailboxId, code);
        if (record.kind === "request")
          this.syntheticReply(
            record,
            message.messageId,
            `Not delivered: ${message.receipt.message}`,
          );
      });
  }

  /** A Studio member asks an assistant; a fresh root per message. Runs in the Studio's transaction. */
  receiveFromMember(input: {
    studioId: string;
    sender: BoundMember;
    assistantId: string;
    text: string;
    messageId: string;
  }): string {
    const recipient = this.store.get("assistants", input.assistantId);
    if (!recipient) throw new MailboxError("not_found", "That assistant no longer exists.");
    const created = this.ledger.createOutgoing({
      senderKey: input.sender.key,
      recipientKey: assistantPeerKey(recipient.id),
      kind: "request",
      originRootId: `studio:${input.messageId}`,
      payloadText: input.text,
      idempotencyKey: input.messageId,
      studioId: input.studioId,
      senderBindingToken: input.sender.bindingToken,
    });
    if (created.created) this.deliver(created.record, input.sender.address, recipient);
    return created.record.mailboxId;
  }

  /** A Studio member answers what an assistant asked it; the assistant's lane is woken. */
  replyFromMember(input: { mailboxId: string; replierKey: string; text: string }): void {
    this.ledger.createReply({
      replyToMailboxId: input.mailboxId,
      replierKey: input.replierKey,
      outcome: "ok",
      payloadText: input.text,
    });
  }

  // An assistant's answer to a Studio member goes back through the Studio, while the member's
  // binding is the one it asked from.
  private answerMember(
    request: MailboxMessage,
    reply: { text: string; outcome: MailboxOutcome },
  ): void {
    const studio = this.deps.studio;
    const assistantId = assistantIdOfKey(request.recipientKey);
    const asked = studio?.recordOfMailbox(request.mailboxId);
    if (!studio || !assistantId || !asked?.message.sender || !request.studioId) return;
    const sender = studio.assistantMember(request.studioId, assistantId);
    if (!sender) return;
    const work = async () => {
      await studio
        .deliverFromAssistant({
          studioId: request.studioId!,
          sender,
          recipient: asked.message.sender!,
          kind: "reply",
          replyTo: asked.message.messageId,
          text: reply.outcome === "ok" ? reply.text : `(failed) ${reply.text}`,
          mailboxId: request.mailboxId,
          recipientToken: request.senderBindingToken,
        })
        .catch((error: unknown) =>
          console.error("Bigbang could not answer a Studio member", error),
        );
    };
    if (this.deps.background) this.deps.background(work);
    else void work();
  }

  // Queues the request as a turn in the recipient's mailbox lane, in the sender's transaction.
  private deliver(record: MailboxMessage, senderName: string, recipient: Assistant): void {
    const turn = queueTurn(this.store, {
      id: mailboxTurnId(record.mailboxId),
      conversationId: mailboxLaneId(recipient.id),
      threadId: null,
      assistant: recipient,
      kind: "reply",
      triggerId: record.mailboxId,
      rootTriggerId: record.originRootId,
      prompt: mailboxActivationPrompt({
        kind: record.kind === "info" ? "info" : "request",
        mailboxId: record.mailboxId,
        correlationId: record.correlationId,
        senderName,
        payloadText: record.payloadText,
      }),
      mailboxId: record.mailboxId,
    });
    this.ledger.markDelivered(record.mailboxId, {
      targetSessionId: turn.chatSessionId ?? "",
      targetTurnId: turn.id,
    });
  }

  /** An explicit reply from the mailbox lane handling the request. */
  reply(
    replier: AssistantSender,
    input: { mailboxId: string; text: string; outcome?: MailboxOutcome },
  ) {
    const target = this.ledger.get(input.mailboxId);
    if (!target) throw new MailboxError("not_found", `mailbox ${input.mailboxId} not found`);
    if (replier.turn.mailboxId !== target.mailboxId)
      throw new MailboxError("reply_wrong_agent", "Reply from the session handling that request.");
    const created = this.ledger.createReply({
      replyToMailboxId: target.mailboxId,
      replierKey: assistantPeerKey(replier.assistant.id),
      targetTurnId: replier.turn.id,
      outcome: input.outcome ?? "ok",
      payloadText: input.text,
    });
    return {
      replyMailboxId: created.record.mailboxId,
      status: created.record.status,
      created: created.created,
    };
  }

  /** The sender withdraws a request the recipient has not started on. */
  cancel(senderKey: string, mailboxId: string) {
    const record = this.ledger.get(mailboxId);
    if (!record) throw new MailboxError("not_found", `mailbox ${mailboxId} not found`);
    if (record.senderKey !== senderKey)
      throw new MailboxError("not_cancellable", "Only the sender can cancel this request.");
    const cancelled = this.store.transaction(() => {
      const row = this.ledger.cancel(mailboxId);
      this.dropQueuedTurn(mailboxId);
      return row;
    });
    return { mailboxId: cancelled.mailboxId, status: cancelled.status };
  }

  records(
    peerKey: string,
    input: { originRootId?: string; status?: MailboxStatus; limit?: number },
  ) {
    return this.ledger
      .listForPeer({
        peerKey,
        ...(input.originRootId ? { originRootId: input.originRootId } : {}),
        ...(input.status ? { statuses: [input.status] } : {}),
        limit: input.limit ?? LIST_MAX,
      })
      .map((row) => Object.assign(row, { payloadText: truncate(row.payloadText) }));
  }

  /**
   * Whether a mailbox turn may start. It waits while its assistant runs another turn (a chat reply
   * or an approval), and gives up after the admission timeout.
   */
  admit(turn: Turn): boolean {
    if (!turn.mailboxId) return true;
    const record = this.ledger.get(turn.mailboxId);
    if (!record || record.status === "cancelled" || record.status === "failed") {
      this.store.transaction(() =>
        this.store.put("turns", {
          ...turn,
          status: "cancelled",
          error: "The request was withdrawn.",
        }),
      );
      return false;
    }
    const busy = this.store
      .snapshot()
      .turns.some(
        (other) =>
          other.id !== turn.id &&
          other.assistantId === turn.assistantId &&
          !other.taskId &&
          !isMailboxLane(other.conversationId) &&
          LIVE.has(other.status),
      );
    if (!busy) return true;
    const deferred = this.ledger.markDeferred(record.mailboxId);
    if (this.now() - (deferred.firstDeferredAt ?? this.now()) <= this.admissionMaxWaitMs)
      return false;
    this.store.transaction(() => {
      this.store.put("turns", { ...turn, status: "failed", error: "admission_timeout" });
      this.ledger.markFailed(record.mailboxId, "admission_timeout");
      if (record.kind === "request") this.syntheticReply(record, turn.id, ADMISSION_TIMEOUT_TEXT);
    });
    return false;
  }

  /** The recipient's execution accepted the request: it has it, not yet answered. */
  accepted(turn: Turn): void {
    if (!turn.mailboxId) return;
    const record = this.ledger.get(turn.mailboxId);
    if (record?.status === "delivered")
      this.ledger.markAcked(record.mailboxId, { targetTurnId: turn.id });
  }

  /**
   * A mailbox turn ended. Its final answer is the reply; silence, a failure or an interruption
   * answers with a synthetic failed reply, so the sender is never left waiting.
   */
  turnEnded(turn: Turn, text: string): void {
    if (!turn.mailboxId) return;
    const record = this.ledger.get(turn.mailboxId);
    if (!record || record.kind !== "request" || this.ledger.hasReply(record.mailboxId)) return;
    if (record.status === "cancelled") return;
    const answer = this.store.transaction(() => {
      if (turn.status === "completed" && text && !isPass(text)) {
        this.ledger.createReply({
          replyToMailboxId: record.mailboxId,
          replierKey: record.recipientKey,
          targetTurnId: turn.id,
          outcome: "ok",
          payloadText: text,
        });
        return { text, outcome: "ok" as const };
      }
      const failed = turn.status === "failed" || turn.status === "unknown";
      if (record.status !== "failed")
        this.ledger.markFailed(record.mailboxId, failed ? "run_error" : "no_reply");
      const payload = failed ? runErrorText(turn.error ?? "unknown error") : NO_REPLY_TEXT;
      this.syntheticReply(record, turn.id, payload);
      return { text: payload, outcome: "failed" as const };
    });
    // A Studio member has no chat lane to wake: it is answered through the Studio.
    if (agentOfKey(record.senderKey)) this.answerMember(record, answer);
  }

  private syntheticReply(record: MailboxMessage, turnId: string, payloadText: string): void {
    try {
      this.ledger.createReply({
        replyToMailboxId: record.mailboxId,
        replierKey: record.recipientKey,
        targetTurnId: turnId,
        outcome: "failed",
        payloadText,
      });
    } catch (error) {
      if (!(error instanceof MailboxError && error.code === "reply_root_fenced")) throw error;
    }
  }

  /** The asking turn was cancelled: fence what it started and stop the requests in progress. */
  senderTurnCancelled(turn: Turn): void {
    for (const root of this.ledger.rootsSentBy(turn.id)) {
      const fenced = this.store.transaction(() => {
        const result = this.ledger.fenceRoot(root);
        for (const mailboxId of result.cancelledMailboxIds) this.dropQueuedTurn(mailboxId);
        return result;
      });
      for (const mailboxId of fenced.ackedMailboxIds) {
        const target = this.store.get("turns", mailboxTurnId(mailboxId));
        if (target && LIVE.has(target.status)) this.deps.cancelTurn(target);
      }
    }
  }

  private dropQueuedTurn(mailboxId: string): void {
    const turn = this.store.get("turns", mailboxTurnId(mailboxId));
    if (turn?.status === "queued")
      this.store.put("turns", {
        ...turn,
        status: "cancelled",
        error: "The request was withdrawn.",
      });
  }

  /** Delivers pending replies to the lanes that asked, once each lane is idle. */
  drain(): void {
    this.reconcileWakeups();
    const turns = this.store.snapshot().turns;
    const busy = new Set(
      turns
        .filter((turn) => OPEN.has(turn.status))
        .map((turn) => laneKey(turn.conversationId, turn.threadId)),
    );
    const lanes = new Map<string, MailboxWakeup[]>();
    for (const wakeup of this.ledger.listPendingWakeups()) {
      if (this.ledger.isRootFenced(wakeup.originRootId)) {
        this.ledger.fenceRoot(wakeup.originRootId);
        continue;
      }
      const key = laneKey(wakeup.parentConversationId, wakeup.parentThreadId);
      if (busy.has(key)) continue;
      lanes.set(key, [...(lanes.get(key) ?? []), wakeup]);
    }
    for (const pending of lanes.values()) this.deliverWakeups(pending.slice(0, WAKEUP_BATCH_SIZE));
  }

  private deliverWakeups(batch: MailboxWakeup[]): void {
    const first = batch[0]!;
    const assistant = this.store.get("assistants", assistantIdOfKey(first.parentKey) ?? "");
    if (!assistant) {
      for (const wakeup of batch)
        this.ledger.markWakeupFailed(wakeup.wakeupId, "The asking assistant no longer exists.", {
          terminal: true,
        });
      return;
    }
    const replies = batch.map((wakeup) => {
      const reply = this.ledger.get(wakeup.replyMailboxId);
      const sender = this.store.get("assistants", assistantIdOfKey(reply?.senderKey ?? "") ?? "");
      return {
        senderName:
          sender?.name ??
          (reply && this.deps.studio?.addressOf(reply.senderKey)) ??
          reply?.senderKey ??
          "peer",
        outcome: reply?.outcome ?? "ok",
        correlationId: reply?.correlationId ?? "",
        requestMailboxId: wakeup.requestMailboxId,
        payloadText: reply?.payloadText ?? "",
      };
    });
    this.store.transaction(() => {
      const turn = queueTurn(this.store, {
        id: wakeupTurnId(first),
        conversationId: first.parentConversationId,
        threadId: first.parentThreadId,
        assistant,
        kind: "reply",
        triggerId: first.requestMailboxId,
        rootTriggerId: first.originRootId,
        prompt: mailboxWakeupPrompt(replies),
        mailboxWakeupIds: batch.map((wakeup) => wakeup.wakeupId),
      });
      for (const wakeup of batch)
        this.ledger.markWakeupDelivered(wakeup.wakeupId, { turnId: turn.id });
    });
  }

  // A wakeup turn and its delivered marks are written together; this repairs a ledger whose
  // wakeups are still pending although a turn already carries them.
  private reconcileWakeups(): void {
    const pending = new Set(this.ledger.listPendingWakeups().map((wakeup) => wakeup.wakeupId));
    if (pending.size === 0) return;
    for (const turn of this.store.snapshot().turns)
      for (const wakeupId of turn.mailboxWakeupIds ?? [])
        if (pending.has(wakeupId)) this.ledger.markWakeupDelivered(wakeupId, { turnId: turn.id });
  }

  /** Repairs requests the last process left between steps, then delivers pending replies. */
  recover(): void {
    for (const record of this.ledger.listOpenOutgoing()) {
      if (this.ledger.isRootFenced(record.originRootId)) {
        if (record.status !== "acked") this.cancelIfOpen(record.mailboxId);
        continue;
      }
      const turn = this.store.get("turns", mailboxTurnId(record.mailboxId));
      if (!turn) continue;
      if (record.status === "delivered" && turn.accepted) this.accepted(turn);
      if (!OPEN.has(turn.status)) {
        const final = this.store.get("messages", `final:${turn.id}`);
        this.turnEnded(turn, final?.content ?? "");
      }
    }
    this.drain();
  }

  private cancelIfOpen(mailboxId: string): void {
    try {
      this.store.transaction(() => {
        this.ledger.cancel(mailboxId);
        this.dropQueuedTurn(mailboxId);
      });
    } catch (error) {
      if (!(error instanceof MailboxError && error.code === "not_cancellable")) throw error;
    }
  }
}
