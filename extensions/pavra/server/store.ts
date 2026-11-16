import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  assistantToolFamilyValues,
  stateSchema,
  type Assistant,
  type AssistantToolFamily,
  type ChatState,
  type Message,
  type Turn,
} from "../shared/contracts";
import type { ChatSession } from "./chat-sessions";
import type { Epoch } from "./roundtable";

const VALID_TOOL_FAMILIES = new Set<string>(assistantToolFamilyValues);
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAILBOX_INSTRUCTION_LINE =
  "To ask another assistant privately (it may run on another machine), use pavra-send; pavra-peers lists who you can reach. Its answer comes back to you in a later turn, so tell the user you asked and end your reply.";
const ROUTINES_INSTRUCTION_LINE =
  "To manage scheduled routines and one-time reminders in this chat, use pavra-routine_list, pavra-routine_save (pass maxRuns: 1 for a one-time reminder, or reference playbooks/<slug>.md for recurring inspections; reply (pass) during a routine turn when everything is normal), and pavra-routine_delete.";

export function normalizeAssistantEnvVars(
  envVars: Record<string, unknown> | null | undefined,
): Record<string, string> | undefined {
  if (!envVars || typeof envVars !== "object" || Array.isArray(envVars)) return undefined;
  const entries = Object.entries(envVars)
    .map(([rawKey, rawValue]) => [rawKey.trim(), rawValue] as const)
    .filter(
      ([key, value]) =>
        ENV_KEY_PATTERN.test(key) && (typeof value === "string" || typeof value === "number"),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
}

export function normalizeAssistantDisabledTools(
  disabledTools: readonly unknown[] | null | undefined,
): AssistantToolFamily[] | undefined {
  if (!Array.isArray(disabledTools)) return undefined;
  const seen = new Set<AssistantToolFamily>();
  for (const item of disabledTools) {
    if (typeof item === "string" && VALID_TOOL_FAMILIES.has(item)) {
      seen.add(item as AssistantToolFamily);
    }
  }
  return seen.size > 0 ? [...seen] : undefined;
}

export function sanitizeAssistantRecord(raw: unknown): Assistant {
  if (!raw || typeof raw !== "object") return raw as Assistant;
  const record = { ...(raw as Record<string, unknown>) };
  const envVars = normalizeAssistantEnvVars(
    record.envVars as Record<string, unknown> | null | undefined,
  );
  const disabledTools = normalizeAssistantDisabledTools(
    record.disabledTools as readonly unknown[] | null | undefined,
  );
  if (envVars) record.envVars = envVars;
  else delete record.envVars;
  if (disabledTools) record.disabledTools = disabledTools;
  else delete record.disabledTools;
  return record as Assistant;
}

function quoteShellEnvValue(value: string): string {
  if (value === "") return '""';
  if (/^[A-Za-z0-9_./:@%-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function formatAssistantEnvPreamble(
  envVars: Record<string, string> | null | undefined,
): string {
  const normalized = normalizeAssistantEnvVars(envVars);
  if (!normalized) return "";
  const lines = Object.entries(normalized).map(
    ([key, value]) => `export ${key}=${quoteShellEnvValue(value)}`,
  );
  return `[Assistant Environment Variables]\n${lines.join("\n")}`;
}

export function applyAssistantSystemPromptPolicy(
  systemPrompt: string,
  assistant: Pick<Assistant, "envVars" | "disabledTools"> | null | undefined,
): string {
  if (!assistant || !systemPrompt) return systemPrompt;
  const disabled = new Set(normalizeAssistantDisabledTools(assistant.disabledTools) ?? []);
  let next = systemPrompt;
  if (disabled.has("mailbox")) {
    next = next
      .split("\n")
      .filter((line) => line.trim() !== MAILBOX_INSTRUCTION_LINE)
      .join("\n");
  }
  if (disabled.has("routines")) {
    next = next
      .split("\n")
      .filter((line) => line.trim() !== ROUTINES_INSTRUCTION_LINE)
      .join("\n");
  }
  if (disabled.has("tasks")) {
    next = next
      .split("\n")
      .filter((line) => !line.includes("pavra-start_task"))
      .join("\n");
  }
  if (disabled.has("browser")) {
    next = next
      .split("\n")
      .filter((line) => !line.includes("pavra-browser_open"))
      .join("\n");
  }
  if (disabled.size > 0) {
    const disabledNote = `Disabled tool families for you (do not call these tools): ${[...disabled].join(", ")}.`;
    if (!next.includes(disabledNote)) {
      next = `${next.trimEnd()}\n${disabledNote}`;
    }
  }
  const envPreamble = formatAssistantEnvPreamble(assistant.envVars);
  if (envPreamble && !next.includes("[Assistant Environment Variables]")) {
    next = `${next.trimEnd()}\n\n${envPreamble}`;
  }
  return next;
}

type Collection = Exclude<keyof ChatState, "cursor" | "generation">;
/** A peer message waiting to be batched into one peer_inbox turn for `assistantId`. */
export interface InboxItem {
  assistantId: string;
  conversationId: string;
  threadId: string | null;
  messageId: string;
  senderId: string;
  rootTriggerId: string;
  createdAt: number;
}
export interface AssistantHome {
  assistantId: string;
  workspaceId: string;
  directory: string;
}

export interface SnapshotOptions {
  /** Per-conversation message window applied to a full (`after = 0`) snapshot. */
  messageLimit?: number;
}

function windowMessages(messages: readonly Message[], limit: number): Message[] {
  const byConversation = new Map<string, Message[]>();
  for (const message of messages) {
    let list = byConversation.get(message.conversationId);
    if (!list) {
      list = [];
      byConversation.set(message.conversationId, list);
    }
    list.push(message);
  }
  const kept = new Set<string>();
  for (const list of byConversation.values()) {
    const ordered = [...list].sort((a, b) => (a.seq ?? a.createdAt) - (b.seq ?? b.createdAt));
    const tail = ordered.length > limit ? ordered.slice(-limit) : ordered;
    for (const message of tail) {
      kept.add(message.id);
      if (message.threadId) kept.add(message.threadId);
    }
    for (const message of ordered) {
      if (message.savedAt) {
        kept.add(message.id);
        if (message.threadId) kept.add(message.threadId);
      }
    }
  }
  return messages.filter((message) => kept.has(message.id));
}

function cloneSnapshot(state: ChatState, messageLimit?: number): ChatState {
  return {
    generation: state.generation,
    cursor: state.cursor,
    assistants: [...state.assistants],
    conversations: [...state.conversations],
    messages:
      messageLimit !== undefined
        ? windowMessages(state.messages, messageLimit)
        : [...state.messages],
    tasks: [...state.tasks],
    turns: [...state.turns],
    ...(state.studios ? { studios: [...state.studios] } : {}),
    ...(state.peerMessages ? { peerMessages: [...state.peerMessages] } : {}),
    ...(state.routines ? { routines: [...state.routines] } : {}),
    ...(state.takeovers ? { takeovers: [...state.takeovers] } : {}),
  };
}

export class ChatStore {
  private readonly db: DatabaseSync;
  private readonly generation: string;
  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Set<{ after: number; resolve: (changed: boolean) => void }>();
  private snapshotCache: ChatState | null = null;
  private depth = 0;
  private dirty = false;
  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(collection,id)); CREATE INDEX IF NOT EXISTS records_seq ON records(seq); CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, id TEXT NOT NULL);",
    );
    this.db.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS assistants (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    this.indexAssistantsTable();
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    this.indexChatSessionsByAgent();
    // Server-only tables: never part of the synced snapshot.
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS roundtable_epochs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL, generation INTEGER NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS roundtable_epochs_thread ON roundtable_epochs(conversation_id, thread_id, generation);",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS mention_cooldowns (key TEXT PRIMARY KEY, at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS peer_inbox (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, thread_id TEXT, assistant_id TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS assistant_homes (assistant_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, directory TEXT NOT NULL);",
    );
    this.db
      .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES ('generation',?)")
      .run(randomUUID());
    this.generation = (
      this.db.prepare("SELECT value FROM metadata WHERE key='generation'").get() as {
        value: string;
      }
    ).value;
  }
  /** The ledger file, for server-only ledgers that share its transactions (mailbox, Studio). */
  get database(): DatabaseSync {
    return this.db;
  }
  get currentGeneration(): string {
    return this.generation;
  }
  snapshot(after = 0, generation = this.generation, options?: SnapshotOptions): ChatState {
    if (generation !== this.generation) after = 0;
    if (after === 0 && this.snapshotCache) {
      return cloneSnapshot(this.snapshotCache, options?.messageLimit);
    }
    const result: Record<string, unknown> = {
      generation: this.generation,
      cursor: this.cursor(),
      assistants: [],
      conversations: [],
      messages: [],
      tasks: [],
      turns: [],
      studios: [],
      peerMessages: [],
      routines: [],
      takeovers: [],
    };
    const rows = this.db
      .prepare("SELECT collection, value FROM records WHERE seq > ? ORDER BY seq")
      .all(after) as Array<{ collection: Collection; value: string }>;
    for (const row of rows) {
      const parsedValue = JSON.parse(row.value);
      (result[row.collection] as unknown[]).push(
        row.collection === "assistants" ? sanitizeAssistantRecord(parsedValue) : parsedValue,
      );
    }
    const parsed = stateSchema.parse(result);
    if (after === 0) {
      this.snapshotCache = parsed;
      return cloneSnapshot(parsed, options?.messageLimit);
    }
    return parsed;
  }
  get<K extends Collection>(collection: K, id: string): NonNullable<ChatState[K]>[number] | null {
    const row = this.db
      .prepare("SELECT value FROM records WHERE collection=? AND id=?")
      .get(collection, id) as { value: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.value);
    return (collection === "assistants" ? sanitizeAssistantRecord(parsed) : parsed) as NonNullable<
      ChatState[K]
    >[number];
  }
  put<K extends Collection>(collection: K, value: NonNullable<ChatState[K]>[number]): void {
    this.snapshotCache = null;
    let storedValue: NonNullable<ChatState[K]>[number] = value;
    if (collection === "assistants") {
      const sanitized = sanitizeAssistantRecord(value);
      storedValue = sanitized as NonNullable<ChatState[K]>[number];
      this.upsertAssistantRow(sanitized);
    } else if (collection === "turns") {
      const turn = value as Turn;
      if (turn.systemPrompt) {
        const assistant = this.get("assistants", turn.assistantId);
        storedValue = {
          ...turn,
          systemPrompt: applyAssistantSystemPromptPolicy(turn.systemPrompt, assistant),
        } as NonNullable<ChatState[K]>[number];
      }
    }
    const event = this.db
      .prepare("INSERT INTO changes(collection,id) VALUES (?,?)")
      .run(collection, storedValue.id);
    this.db.prepare("DELETE FROM changes WHERE seq < ?").run(event.lastInsertRowid);
    this.db
      .prepare(
        "INSERT INTO records(collection,id,value,seq) VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value,seq=excluded.seq",
      )
      .run(collection, storedValue.id, JSON.stringify(storedValue), event.lastInsertRowid);
    this.markChanged();
  }
  delete<K extends Collection>(collection: K, id: string): boolean {
    this.snapshotCache = null;
    const removed = this.db
      .prepare("DELETE FROM records WHERE collection=? AND id=?")
      .run(collection, id);
    if (collection === "assistants") {
      this.db.prepare("DELETE FROM assistants WHERE id=?").run(id);
    }
    if (removed.changes === 0) return false;
    const event = this.db
      .prepare("INSERT INTO changes(collection,id) VALUES (?,?)")
      .run(collection, id);
    this.db.prepare("DELETE FROM changes WHERE seq < ?").run(event.lastInsertRowid);
    this.markChanged();
    return true;
  }
  /** Stores a message, stamping the next monotonic `seq` unless it already has one. */
  putMessage(message: Message): Message {
    const stamped =
      message.seq === undefined ? { ...message, seq: this.nextMessageSeq() } : message;
    this.put("messages", stamped);
    return stamped;
  }
  /** Toggles `actorId` on an emoji reaction for a message and bumps the ledger cursor. */
  reactToMessage(input: {
    conversationId: string;
    messageId: string;
    emoji: string;
    actorId?: string;
  }): Message {
    const emoji = input.emoji.trim();
    if (!emoji) throw new Error("Reaction emoji is required.");
    const actorId = input.actorId ?? "user";
    return this.transaction(() => {
      const existing = this.get("messages", input.messageId);
      if (!existing || existing.conversationId !== input.conversationId) {
        throw new Error("Message no longer exists.");
      }
      const nextReactions: Record<string, string[]> = {};
      for (const [key, actors] of Object.entries(existing.reactions ?? {})) {
        if (actors.length > 0) nextReactions[key] = [...actors];
      }
      const currentActors = nextReactions[emoji] ?? [];
      if (currentActors.includes(actorId)) {
        const filtered = currentActors.filter((id) => id !== actorId);
        if (filtered.length > 0) nextReactions[emoji] = filtered;
        else delete nextReactions[emoji];
      } else {
        nextReactions[emoji] = [...currentActors, actorId];
      }
      const { reactions: _removed, ...rest } = existing;
      const updated: Message =
        Object.keys(nextReactions).length > 0 ? { ...rest, reactions: nextReactions } : rest;
      return this.putMessage(updated);
    });
  }
  /** Sets or clears a message's saved bookmark timestamp (`savedAt`) and bumps the ledger cursor. */
  saveMessage(input: {
    messageId: string;
    saved: boolean;
    conversationId?: string;
    savedAt?: string;
  }): Message {
    return this.transaction(() => {
      const existing = this.get("messages", input.messageId);
      if (
        !existing ||
        (input.conversationId !== undefined && existing.conversationId !== input.conversationId)
      ) {
        throw new Error("Message no longer exists.");
      }
      const { savedAt: _removed, ...rest } = existing;
      const updated: Message = input.saved
        ? { ...rest, savedAt: input.savedAt ?? new Date().toISOString() }
        : rest;
      return this.putMessage(updated);
    });
  }
  private nextMessageSeq(): number {
    const row = this.db
      .prepare(
        "INSERT INTO metadata(key,value) VALUES ('message_seq','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1 RETURNING value",
      )
      .get() as { value: string };
    return Number(row.value);
  }
  cursor(): number {
    return Number(
      (
        this.db.prepare("SELECT COALESCE(MAX(seq),0) AS cursor FROM changes").get() as {
          cursor: number;
        }
      ).cursor,
    );
  }
  /** Runs after every commit that changed the synced snapshot. Listener errors are contained. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  /** Resolves true as soon as the cursor passes `after`, false when `waitMs` elapses first. */
  waitForChange(after: number, waitMs: number): Promise<boolean> {
    if (this.cursor() > after) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter = { after, resolve };
      this.waiters.add(waiter);
      setTimeout(() => {
        if (this.waiters.delete(waiter)) resolve(false);
      }, waitMs).unref();
    });
  }
  private markChanged(): void {
    if (this.depth > 0) this.dirty = true;
    else this.notify();
  }
  private notify(): void {
    const cursor = this.cursor();
    for (const waiter of this.waiters)
      if (cursor > waiter.after && this.waiters.delete(waiter)) waiter.resolve(true);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("Pavra store listener failed", error);
      }
    }
  }
  private indexAssistantsTable(): void {
    const columns = this.db.prepare("PRAGMA table_info(assistants)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "env_vars")) {
      this.db.exec("ALTER TABLE assistants ADD COLUMN env_vars TEXT");
    }
    if (!columns.some((column) => column.name === "disabled_tools")) {
      this.db.exec("ALTER TABLE assistants ADD COLUMN disabled_tools TEXT");
    }
    const existingRows = this.db
      .prepare("SELECT id, value FROM records WHERE collection='assistants'")
      .all() as Array<{ id: string; value: string }>;
    for (const row of existingRows) {
      try {
        const sanitized = sanitizeAssistantRecord(JSON.parse(row.value));
        this.upsertAssistantRow(sanitized);
      } catch {
        // Ignore unparseable legacy rows during index backfill.
      }
    }
  }
  private upsertAssistantRow(assistant: Assistant): void {
    this.db
      .prepare(
        "INSERT INTO assistants(id,value,env_vars,disabled_tools) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,env_vars=excluded.env_vars,disabled_tools=excluded.disabled_tools",
      )
      .run(
        assistant.id,
        JSON.stringify(assistant),
        assistant.envVars ? JSON.stringify(assistant.envVars) : null,
        assistant.disabledTools ? JSON.stringify(assistant.disabledTools) : null,
      );
  }
  private indexChatSessionsByAgent(): void {
    const columns = this.db.prepare("PRAGMA table_info(chat_sessions)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "agent_id"))
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN agent_id TEXT");
    const missing = this.db
      .prepare("SELECT id, value FROM chat_sessions WHERE agent_id IS NULL")
      .all() as Array<{ id: string; value: string }>;
    const backfill = this.db.prepare("UPDATE chat_sessions SET agent_id=? WHERE id=?");
    for (const row of missing) backfill.run((JSON.parse(row.value) as ChatSession).agentId, row.id);
    this.db.exec("CREATE INDEX IF NOT EXISTS chat_sessions_agent ON chat_sessions(agent_id)");
  }
  getChatSession(id: string): ChatSession | null {
    const row = this.db.prepare("SELECT value FROM chat_sessions WHERE id=?").get(id) as
      | { value: string }
      | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  getChatSessionByAgent(agentId: string): ChatSession | null {
    const row = this.db
      .prepare("SELECT value FROM chat_sessions WHERE agent_id=? LIMIT 1")
      .get(agentId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  listChatSessions(): ChatSession[] {
    return (
      this.db.prepare("SELECT value FROM chat_sessions").all() as Array<{ value: string }>
    ).map((row) => JSON.parse(row.value));
  }
  putChatSession(session: ChatSession): void {
    const assistant = this.get("assistants", session.assistantId);
    const systemPrompt = applyAssistantSystemPromptPolicy(session.systemPrompt, assistant);
    session.systemPrompt = systemPrompt;
    this.db
      .prepare(
        "INSERT INTO chat_sessions(id,value,agent_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,agent_id=excluded.agent_id",
      )
      .run(session.id, JSON.stringify(session), session.agentId);
  }
  getEpoch(id: string): Epoch | null {
    const row = this.db.prepare("SELECT value FROM roundtable_epochs WHERE id=?").get(id) as
      | { value: string }
      | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  putEpoch(epoch: Epoch): void {
    this.db
      .prepare(
        "INSERT INTO roundtable_epochs(id,conversation_id,thread_id,generation,status,value) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,value=excluded.value",
      )
      .run(
        epoch.id,
        epoch.conversationId,
        epoch.threadId,
        epoch.generation,
        epoch.status,
        JSON.stringify(epoch),
      );
  }
  /** The newest epoch of a roundtable thread; a thread without one is not a roundtable. */
  latestEpoch(conversationId: string, threadId: string): Epoch | null {
    const row = this.db
      .prepare(
        "SELECT value FROM roundtable_epochs WHERE conversation_id=? AND thread_id=? ORDER BY generation DESC LIMIT 1",
      )
      .get(conversationId, threadId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  runningEpochs(): Epoch[] {
    return (
      this.db
        .prepare("SELECT value FROM roundtable_epochs WHERE status='running' ORDER BY generation")
        .all() as Array<{ value: string }>
    ).map((row) => JSON.parse(row.value));
  }
  /** When `key` (one direction in one lane) last woke someone by mention, or null. */
  getMentionCooldown(key: string): number | null {
    const row = this.db.prepare("SELECT at FROM mention_cooldowns WHERE key=?").get(key) as
      | { at: number }
      | undefined;
    return row ? row.at : null;
  }
  putMentionCooldown(key: string, at: number): void {
    this.db
      .prepare(
        "INSERT INTO mention_cooldowns(key,at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET at=excluded.at",
      )
      .run(key, at);
  }
  addInboxItem(item: InboxItem): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO peer_inbox(id,conversation_id,thread_id,assistant_id,value,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        `${item.assistantId}:${item.messageId}`,
        item.conversationId,
        item.threadId,
        item.assistantId,
        JSON.stringify(item),
        item.createdAt,
      );
  }
  inboxItems(): InboxItem[] {
    return (
      this.db.prepare("SELECT value FROM peer_inbox ORDER BY created_at, rowid").all() as Array<{
        value: string;
      }>
    ).map((row) => JSON.parse(row.value));
  }
  deleteInboxItems(items: readonly InboxItem[]): void {
    const remove = this.db.prepare("DELETE FROM peer_inbox WHERE id=?");
    for (const item of items) remove.run(`${item.assistantId}:${item.messageId}`);
  }
  /** Drops every pending peer message of a lane: a newer user message supersedes them. */
  clearInbox(conversationId: string, threadId: string | null): void {
    this.db
      .prepare("DELETE FROM peer_inbox WHERE conversation_id=? AND thread_id IS ?")
      .run(conversationId, threadId);
  }
  getAssistantHome(assistantId: string): AssistantHome | null {
    const row = this.db
      .prepare(
        "SELECT assistant_id AS assistantId, workspace_id AS workspaceId, directory FROM assistant_homes WHERE assistant_id=?",
      )
      .get(assistantId) as AssistantHome | undefined;
    return row ? { ...row } : null;
  }
  putAssistantHome(home: AssistantHome): void {
    this.db
      .prepare(
        "INSERT INTO assistant_homes(assistant_id,workspace_id,directory) VALUES (?,?,?) ON CONFLICT(assistant_id) DO UPDATE SET workspace_id=excluded.workspace_id,directory=excluded.directory",
      )
      .run(home.assistantId, home.workspaceId, home.directory);
  }
  transaction<T>(operation: () => T): T {
    if (this.depth > 0) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const result = operation();
      this.db.exec("COMMIT");
      this.depth--;
      if (this.dirty) {
        this.dirty = false;
        this.notify();
      }
      return result;
    } catch (error) {
      this.depth--;
      this.dirty = false;
      this.snapshotCache = null;
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    for (const waiter of this.waiters) waiter.resolve(false);
    this.waiters.clear();
    this.db.close();
  }
}
