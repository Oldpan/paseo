import { randomUUID } from "node:crypto";
import type { Peer, PeerMessage, Studio as StudioRecord } from "../shared/contracts";
import { errorMessage, failureStatus } from "./dispatcher";
import type { ExecutionPort } from "./execution";
import { agentOfKey, agentPeerKey } from "./peers";
import type { ChatStore } from "./store";

// Studio collaboration between agents in bound workspaces, ported from Bigbang Core's
// studioHerdrService. A Studio binds workspaces on any machine; the agents in them are its
// members. A message is one recorded attempt with an honest receipt: never resent when unknown,
// not_attempted when the recipient's machine is offline. A reply goes to the original sender only
// while both bindings are unchanged. Paseo's per-agent MCP identity replaces herdr's process
// proofs, and agents.send replaces the native submit.

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_TARGETS = 8;
const MAX_TEXT = 20_000;
const RECORDS_LIMIT = 100;

export type ReceiptStatus = "accepted" | "queued" | "rejected" | "not_attempted" | "unknown";
export interface Receipt {
  status: ReceiptStatus;
  code: string;
  message: string;
  observedAt: number;
}

/** An agent in a bound workspace, as the other members address it. */
export interface Member {
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string;
  name: string;
  workspace: string;
  machine: string;
  address: string;
}
export interface BoundMember extends Member {
  studioId: string;
  bindingToken: string;
}
export interface StudioMessage {
  messageId: string;
  studioId: string;
  kind: "message" | "reply" | "notice";
  replyTo: string | null;
  sender: Member | null;
  recipient: Member;
  text: string;
  createdAt: number;
  receipt: Receipt;
}

export class StudioError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StudioError";
  }
}

export interface StudioDeps {
  port(): ExecutionPort | null;
  /** This coordinator's serverId, so its own workspaces have a qualified address. */
  selfId(): string;
  machineLabel(serverId: string): string;
  /** Whether a machine is reachable now; an unreachable recipient is never attempted. */
  online(serverId: string): Promise<boolean>;
  /** Bigbang's own executions (chat lanes, mailbox lanes, tasks) are never Studio members. */
  isExecution(agentId: string): boolean;
  now?: () => number;
  deliveryTimeoutMs?: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS studios (
  studio_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_bindings (
  server_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  studio_id TEXT NOT NULL,
  name TEXT NOT NULL,
  binding_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(server_id, workspace_id)
);
CREATE TABLE IF NOT EXISTS studio_records (
  message_id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reply_to TEXT,
  sender_key TEXT,
  sender_json TEXT,
  sender_binding_token TEXT,
  recipient_key TEXT NOT NULL,
  recipient_json TEXT NOT NULL,
  recipient_binding_token TEXT NOT NULL,
  notice_key TEXT,
  origin_json TEXT,
  text TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  receipt_code TEXT NOT NULL,
  receipt_message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_records_studio ON studio_records(studio_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS studio_records_notice ON studio_records(studio_id, notice_key)
  WHERE kind = 'notice';`;

interface RecordRow {
  message_id: string;
  studio_id: string;
  kind: StudioMessage["kind"];
  reply_to: string | null;
  sender_key: string | null;
  sender_json: string | null;
  sender_binding_token: string | null;
  recipient_key: string;
  recipient_json: string;
  recipient_binding_token: string;
  text: string;
  delivery_status: ReceiptStatus | "attempting";
  receipt_code: string;
  receipt_message: string;
  created_at: number;
  observed_at: number;
}
interface BindingRow {
  studioId: string;
  bindingToken: string;
  name: string;
}

function addressSegment(value: string): string {
  return value.trim().replace(/[/\s]+/g, "-") || "-";
}
function memberMatches(member: Member, ref: string): boolean {
  const name = ref.replace(/^@+/, "").trim().toLowerCase();
  return (
    member.key === ref ||
    member.address.toLowerCase() === name ||
    member.name.toLowerCase() === name ||
    member.agentId === ref
  );
}
function forbidden(): StudioError {
  return new StudioError(
    "studio_member_changed",
    "That member's workspace is no longer bound to your Studio, or was bound again since.",
  );
}

export class Studio {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly noticing = new Set<string>();

  constructor(
    private readonly store: ChatStore,
    private readonly deps: StudioDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.deliveryTimeoutMs ?? DELIVERY_TIMEOUT_MS;
    store.database.exec(SCHEMA);
    // An attempt the last process did not finish has no receipt; it is never resent.
    const stranded = this.db
      .prepare("SELECT message_id AS id FROM studio_records WHERE delivery_status='attempting'")
      .all() as Array<{ id: string }>;
    for (const { id } of stranded)
      this.setReceipt(id, {
        status: "unknown",
        code: "coordinator_restarted",
        message:
          "The coordinator restarted before a receipt was recorded. This message will not be resent.",
        observedAt: this.now(),
      });
  }

  private get db() {
    return this.store.database;
  }

  // ---- Studios and bindings (from the app) ----

  save(input: { id: string; name: string }): StudioRecord {
    this.store.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO studios(studio_id, name, status, created_at) VALUES (?, ?, 'active', ?)
             ON CONFLICT(studio_id) DO UPDATE SET name=excluded.name`,
        )
        .run(input.id, input.name.trim() || "Studio", this.now());
      this.project(input.id);
    });
    return this.studio(input.id)!;
  }

  archive(studioId: string): StudioRecord {
    this.requireActive(studioId);
    this.store.transaction(() => {
      this.db.prepare("UPDATE studios SET status='archived' WHERE studio_id=?").run(studioId);
      this.db.prepare("DELETE FROM studio_bindings WHERE studio_id=?").run(studioId);
      this.project(studioId);
    });
    return this.studio(studioId)!;
  }

  /** Binds a workspace; a workspace belongs to one Studio at a time. A new binding gets a new token. */
  bind(input: {
    studioId: string;
    serverId: string;
    workspaceId: string;
    name: string;
  }): StudioRecord {
    this.requireActive(input.studioId);
    this.store.transaction(() => {
      const existing = this.binding(input.serverId, input.workspaceId);
      if (existing && existing.studioId !== input.studioId)
        throw new StudioError(
          "studio_workspace_taken",
          "That workspace already belongs to another Studio. Remove it there first.",
        );
      if (!existing)
        this.db
          .prepare(
            `INSERT INTO studio_bindings(server_id, workspace_id, studio_id, name, binding_token, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.serverId,
            input.workspaceId,
            input.studioId,
            input.name,
            randomUUID(),
            this.now(),
          );
      else
        this.db
          .prepare("UPDATE studio_bindings SET name=? WHERE server_id=? AND workspace_id=?")
          .run(input.name, input.serverId, input.workspaceId);
      this.project(input.studioId);
    });
    void this.noticeWorkspace(input.serverId, input.workspaceId).catch((error: unknown) =>
      console.error("Bigbang Studio notice failed", error),
    );
    return this.studio(input.studioId)!;
  }

  unbind(input: { serverId: string; workspaceId: string }): StudioRecord | null {
    const existing = this.binding(input.serverId, input.workspaceId);
    if (!existing) return null;
    this.store.transaction(() => {
      this.db
        .prepare("DELETE FROM studio_bindings WHERE server_id=? AND workspace_id=?")
        .run(input.serverId, input.workspaceId);
      this.project(existing.studioId);
    });
    return this.studio(existing.studioId);
  }

  studio(studioId: string): StudioRecord | null {
    const row = this.db
      .prepare(
        "SELECT studio_id AS id, name, status, created_at AS createdAt FROM studios WHERE studio_id=?",
      )
      .get(studioId) as Omit<StudioRecord, "workspaces"> | undefined;
    if (!row) return null;
    const workspaces = this.db
      .prepare(
        `SELECT server_id AS serverId, workspace_id AS workspaceId, name FROM studio_bindings
           WHERE studio_id=? ORDER BY created_at, server_id, workspace_id`,
      )
      .all(studioId) as StudioRecord["workspaces"];
    return { ...row, workspaces };
  }

  private requireActive(studioId: string): void {
    if (this.studio(studioId)?.status !== "active")
      throw new StudioError("studio_not_found", "That Studio does not exist or is archived.");
  }

  private binding(serverId: string, workspaceId: string): BindingRow | null {
    return (
      (this.db
        .prepare(
          `SELECT b.studio_id AS studioId, b.binding_token AS bindingToken, b.name AS name
             FROM studio_bindings b JOIN studios s ON s.studio_id=b.studio_id
             WHERE b.server_id=? AND b.workspace_id=? AND s.status='active'`,
        )
        .get(serverId, workspaceId) as BindingRow | undefined) ?? null
    );
  }

  // ---- Members ----

  private member(
    serverId: string,
    workspaceId: string,
    workspace: string,
    agent: { id: string; title: string | null },
  ): Member {
    const machine = this.deps.machineLabel(serverId);
    const name = agent.title?.trim() || agent.id.slice(0, 8);
    return {
      key: agentPeerKey(serverId, agent.id),
      serverId,
      agentId: agent.id,
      workspaceId,
      name,
      workspace,
      machine,
      address: [machine, workspace, name].map(addressSegment).join("/"),
    };
  }

  /** The Studio member behind a verified caller, or null when it belongs to no Studio. */
  async callerMember(caller: { agentId: string; serverId?: string }): Promise<BoundMember | null> {
    if (this.deps.isExecution(caller.agentId)) return null;
    const serverId = caller.serverId ?? this.deps.selfId();
    const port = this.requirePort();
    const info = await port.agentInfo(caller.serverId, caller.agentId);
    if (!info?.workspaceId || info.archived) return null;
    const binding = this.binding(serverId, info.workspaceId);
    if (!binding) return null;
    return {
      ...this.member(serverId, info.workspaceId, binding.name, info),
      studioId: binding.studioId,
      bindingToken: binding.bindingToken,
    };
  }

  /** Current members of a Studio, read from each bound workspace; unreachable machines are listed. */
  async members(studioId: string): Promise<{
    members: Member[];
    unavailable: Array<{ machine: string; workspace: string; reason: string }>;
  }> {
    const port = this.requirePort();
    const studio = this.studio(studioId);
    const members: Member[] = [];
    const unavailable: Array<{ machine: string; workspace: string; reason: string }> = [];
    await Promise.all(
      (studio?.workspaces ?? []).map(async (workspace) => {
        try {
          const agents = await port.listWorkspaceAgents(
            this.local(workspace.serverId),
            workspace.workspaceId,
          );
          for (const agent of agents)
            if (!this.deps.isExecution(agent.id))
              members.push(
                this.member(workspace.serverId, workspace.workspaceId, workspace.name, agent),
              );
        } catch (error) {
          unavailable.push({
            machine: this.deps.machineLabel(workspace.serverId),
            workspace: workspace.name,
            reason: errorMessage(error),
          });
        }
      }),
    );
    members.sort((a, b) => a.address.localeCompare(b.address));
    return { members, unavailable };
  }

  private local(serverId: string): string | undefined {
    return serverId === this.deps.selfId() ? undefined : serverId;
  }

  /** Resolves 1-8 references (key, address or unique name) to current members of the Studio. */
  async resolve(studioId: string, refs: readonly string[]): Promise<Member[]> {
    if (refs.length === 0 || refs.length > MAX_TARGETS || new Set(refs).size !== refs.length)
      throw new StudioError("invalid_request", `Name 1-${MAX_TARGETS} different members.`);
    const { members } = await this.members(studioId);
    return refs.map((ref) => {
      const matches = members.filter((member) => memberMatches(member, ref));
      if (matches.length > 1)
        throw new StudioError(
          "studio_member_ambiguous",
          `"${ref}" matches several members: ${matches.map((member) => `${member.address} [${member.key}]`).join(", ")}. Use a full address or key.`,
        );
      if (matches.length === 1) return matches[0]!;
      // A member on an offline machine, named by key, still gets an honest not_attempted receipt.
      const agent = agentOfKey(ref);
      const known = agent ? this.knownMember(studioId, ref) : null;
      if (known) return known;
      throw new StudioError(
        "studio_member_not_found",
        `No current member "${ref}". Call bigbang-peers to see who is in your Studio.`,
      );
    });
  }

  private knownMember(studioId: string, key: string): Member | null {
    const row = this.db
      .prepare(
        `SELECT recipient_json AS json FROM studio_records WHERE studio_id=? AND recipient_key=?
           UNION ALL SELECT sender_json AS json FROM studio_records WHERE studio_id=? AND sender_key=?
           LIMIT 1`,
      )
      .get(studioId, key, studioId, key) as { json: string } | undefined;
    const member = row ? (JSON.parse(row.json) as Member) : null;
    return member && this.binding(member.serverId, member.workspaceId)?.studioId === studioId
      ? member
      : null;
  }

  // ---- Messages ----

  /** Sends one message per recipient, in order, each with its own receipt. */
  async send(sender: BoundMember, refs: readonly string[], text: string): Promise<StudioMessage[]> {
    validateText(text);
    const recipients = await this.resolve(sender.studioId, refs);
    const sent: StudioMessage[] = [];
    for (const recipient of recipients)
      sent.push(
        await this.deliver({
          studioId: sender.studioId,
          sender,
          recipient,
          kind: "message",
          replyTo: null,
          text,
        }),
      );
    return sent;
  }

  /** Replies to a message the caller received; it reaches the original sender while both bindings hold. */
  async reply(replier: BoundMember, messageId: string, text: string): Promise<StudioMessage> {
    validateText(text);
    const row = this.row(messageId);
    if (!row || row.studio_id !== replier.studioId)
      throw new StudioError("studio_message_not_found", "Message not found in your Studio.");
    const original = this.map(row);
    if (
      !original.sender ||
      row.recipient_key !== replier.key ||
      row.recipient_binding_token !== replier.bindingToken
    )
      throw forbidden();
    const sender = original.sender;
    const binding = this.binding(sender.serverId, sender.workspaceId);
    if (binding?.studioId !== replier.studioId || binding.bindingToken !== row.sender_binding_token)
      throw forbidden();
    return this.deliver({
      studioId: replier.studioId,
      sender: replier,
      recipient: sender,
      kind: "reply",
      replyTo: original.messageId,
      text,
    });
  }

  records(
    studioId: string,
    filter: { since?: string; with?: string; replyTo?: string } = {},
  ): StudioMessage[] {
    let sql = "SELECT * FROM studio_records WHERE studio_id=?";
    const params: Array<string | number> = [studioId];
    if (filter.since) {
      const anchor = this.db
        .prepare(
          "SELECT created_at AS createdAt, rowid FROM studio_records WHERE message_id=? AND studio_id=?",
        )
        .get(filter.since, studioId) as { createdAt: number; rowid: number } | undefined;
      if (!anchor)
        throw new StudioError("studio_message_not_found", "Message not found in your Studio.");
      sql += " AND (created_at > ? OR (created_at = ? AND rowid > ?))";
      params.push(anchor.createdAt, anchor.createdAt, anchor.rowid);
    }
    if (filter.replyTo) {
      sql += " AND reply_to=?";
      params.push(filter.replyTo);
    }
    // A member filter matches stored peers, so it also covers members that left or went offline.
    const limit = filter.with ? 1000 : RECORDS_LIMIT;
    const rows = (
      this.db
        .prepare(`${sql} ORDER BY created_at DESC, rowid DESC LIMIT ${limit}`)
        .all(...params) as unknown as RecordRow[]
    )
      .map((row) => this.map(row))
      .filter(
        (message) =>
          !filter.with ||
          memberMatches(message.recipient, filter.with) ||
          (message.sender !== null && memberMatches(message.sender, filter.with)),
      );
    return rows.slice(0, RECORDS_LIMIT).toReversed();
  }

  private async deliver(input: {
    studioId: string;
    sender: BoundMember | null;
    recipient: Member;
    kind: StudioMessage["kind"];
    replyTo: string | null;
    text: string;
    noticeKey?: string;
  }): Promise<StudioMessage> {
    const { recipient, sender } = input;
    const binding = this.binding(recipient.serverId, recipient.workspaceId);
    if (binding?.studioId !== input.studioId) throw forbidden();
    if (sender) {
      const current = this.binding(sender.serverId, sender.workspaceId);
      if (current?.studioId !== input.studioId || current.bindingToken !== sender.bindingToken)
        throw forbidden();
    }
    let receipt: Receipt | undefined;
    if (!(await this.deps.online(recipient.serverId)))
      receipt = {
        status: "not_attempted",
        code: "host_offline",
        message: "The recipient's machine is offline. This message will not be sent later.",
        observedAt: this.now(),
      };
    const messageId = randomUUID();
    const createdAt = this.now();
    // This synchronous insert is the attempt's ordering point relative to unbinding.
    const inserted = this.store.transaction(() => {
      const again = this.binding(recipient.serverId, recipient.workspaceId);
      if (again?.studioId !== input.studioId || again.bindingToken !== binding.bindingToken)
        throw forbidden();
      if (input.noticeKey) {
        const previous = this.db
          .prepare(
            "SELECT message_id AS id FROM studio_records WHERE studio_id=? AND notice_key=? AND kind='notice'",
          )
          .get(input.studioId, input.noticeKey) as { id: string } | undefined;
        if (previous) return previous.id;
      }
      this.db
        .prepare(
          `INSERT INTO studio_records(message_id, studio_id, kind, reply_to, sender_key, sender_json,
             sender_binding_token, recipient_key, recipient_json, recipient_binding_token, notice_key,
             text, delivery_status, receipt_code, receipt_message, created_at, observed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          messageId,
          input.studioId,
          input.kind,
          input.replyTo,
          sender?.key ?? null,
          sender ? JSON.stringify(stripBinding(sender)) : null,
          sender?.bindingToken ?? null,
          recipient.key,
          JSON.stringify(stripBinding(recipient)),
          binding.bindingToken,
          input.noticeKey ?? null,
          input.text,
          receipt?.status ?? "attempting",
          receipt?.code ?? "delivery_in_progress",
          receipt?.message ??
            "A single delivery is in progress. Do not resend while the receipt is unknown.",
          createdAt,
          receipt?.observedAt ?? createdAt,
        );
      this.projectRecord(messageId);
      return messageId;
    });
    if (inserted !== messageId) return this.map(this.row(inserted)!);
    if (!receipt) {
      receipt = await this.attempt(input, messageId);
      this.setReceipt(messageId, receipt);
    }
    return this.map(this.row(messageId)!);
  }

  private async attempt(
    input: {
      sender: BoundMember | null;
      recipient: Member;
      kind: string;
      replyTo: string | null;
      text: string;
    },
    messageId: string,
  ): Promise<Receipt> {
    const { sender, recipient } = input;
    const header = sender
      ? `From ${sender.name} on ${sender.machine} (${sender.address}). To reply, call bigbang-reply with messageId ${messageId}.`
      : "Studio collaboration notice.";
    const text = `[Studio ${input.kind} ${messageId}${input.replyTo ? `; reply to ${input.replyTo}` : ""}]\n${header}\n\n${input.text}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.requirePort().deliverMessage(this.local(recipient.serverId), recipient.agentId, text, {
          messageId,
          ...(sender ? { sourceAgentId: sender.agentId } : {}),
          ...(sender && sender.serverId !== recipient.serverId
            ? { sourceAgentServerId: sender.serverId }
            : {}),
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(new Error("delivery timed out"), {
                  code: "delivery_outcome_unknown",
                }),
              ),
            this.timeoutMs,
          );
        }),
      ]);
      return {
        status: "accepted",
        code: "delivered",
        message: "The recipient's session accepted the message.",
        observedAt: this.now(),
      };
    } catch (error) {
      return failureStatus(error) === "unknown"
        ? {
            status: "unknown",
            code: "delivery_outcome_unknown",
            message: "No definitive receipt was recorded. This message will not be resent.",
            observedAt: this.now(),
          }
        : {
            status: "rejected",
            code: "delivery_rejected",
            message: errorMessage(error),
            observedAt: this.now(),
          };
    } finally {
      clearTimeout(timer);
    }
  }

  private setReceipt(messageId: string, receipt: Receipt): void {
    this.store.transaction(() => {
      this.db
        .prepare(
          "UPDATE studio_records SET delivery_status=?, receipt_code=?, receipt_message=?, observed_at=? WHERE message_id=?",
        )
        .run(receipt.status, receipt.code, receipt.message, receipt.observedAt, messageId);
      this.projectRecord(messageId);
    });
  }

  // ---- Notices ----

  /** Tells each member of a newly bound workspace, once per binding, how to collaborate. */
  async noticeWorkspace(serverId: string, workspaceId: string): Promise<void> {
    const binding = this.binding(serverId, workspaceId);
    if (!binding) return;
    const agents = await this.requirePort().listWorkspaceAgents(this.local(serverId), workspaceId);
    for (const agent of agents) await this.noticeAgent(serverId, workspaceId, agent);
  }

  /** An agent appeared in a workspace: if the workspace is bound, the agent hears about its Studio. */
  async noticeAgent(
    serverId: string,
    workspaceId: string,
    agent: { id: string; title: string | null },
  ): Promise<void> {
    const binding = this.binding(serverId, workspaceId);
    if (!binding || this.deps.isExecution(agent.id)) return;
    const recipient = this.member(serverId, workspaceId, binding.name, agent);
    const noticeKey = `${binding.bindingToken}:${recipient.key}`;
    if (this.noticing.has(noticeKey)) return;
    this.noticing.add(noticeKey);
    try {
      const studio = this.studio(binding.studioId);
      await this.deliver({
        studioId: binding.studioId,
        sender: null,
        recipient,
        kind: "notice",
        replyTo: null,
        noticeKey,
        text: `Your workspace now belongs to Studio ${JSON.stringify(studio?.name ?? "Studio")}. Agents in other bound workspaces, on this or other machines, can message you, and you them: bigbang-peers lists members, bigbang-send messages one or more, bigbang-reply answers a message, bigbang-records shows the history. A receipt of unknown means do not resend; check bigbang-records first.`,
      });
    } catch (error) {
      if (!(error instanceof StudioError)) throw error;
    } finally {
      this.noticing.delete(noticeKey);
    }
  }

  // ---- Projection to clients ----

  private project(studioId: string): void {
    const studio = this.studio(studioId);
    if (studio) this.store.put("studios", studio);
  }

  private projectRecord(messageId: string): void {
    const row = this.row(messageId);
    if (row) this.store.put("peerMessages", toPeerMessage(this.map(row)));
  }

  private row(messageId: string): RecordRow | null {
    return (
      (this.db.prepare("SELECT * FROM studio_records WHERE message_id=?").get(messageId) as
        | RecordRow
        | undefined) ?? null
    );
  }

  private map(row: RecordRow): StudioMessage {
    return {
      messageId: row.message_id,
      studioId: row.studio_id,
      kind: row.kind,
      replyTo: row.reply_to,
      sender: row.sender_json ? (JSON.parse(row.sender_json) as Member) : null,
      recipient: JSON.parse(row.recipient_json) as Member,
      text: row.text,
      createdAt: row.created_at,
      receipt: {
        status: row.delivery_status === "attempting" ? "unknown" : row.delivery_status,
        code: row.receipt_code,
        message: row.receipt_message,
        observedAt: row.observed_at,
      },
    };
  }

  private requirePort(): ExecutionPort {
    const port = this.deps.port();
    if (!port)
      throw new StudioError(
        "studio_unavailable",
        "Bigbang Chat is starting. Try again in a moment.",
      );
    return port;
  }
}

function validateText(text: string): void {
  if (!text.trim() || text.length > MAX_TEXT)
    throw new StudioError("invalid_request", `Write 1-${MAX_TEXT} characters.`);
}
function stripBinding(member: Member | BoundMember): Member {
  const { key, serverId, agentId, workspaceId, name, workspace, machine, address } = member;
  return { key, serverId, agentId, workspaceId, name, workspace, machine, address };
}
function peerOf(member: Member): Peer {
  return {
    key: member.key,
    kind: "agent",
    name: member.name,
    serverId: member.serverId,
    machine: member.machine,
    address: member.address,
  };
}
export function toPeerMessage(message: StudioMessage): PeerMessage {
  return {
    id: message.messageId,
    ledger: "studio",
    kind: message.kind,
    studioId: message.studioId,
    sender: message.sender ? peerOf(message.sender) : null,
    recipient: peerOf(message.recipient),
    text: message.text,
    replyTo: message.replyTo,
    status: message.receipt.status,
    code: message.receipt.code,
    detail: message.receipt.message,
    createdAt: message.createdAt,
  };
}
