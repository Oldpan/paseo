import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { stateSchema, type ChatState, type Message } from "../shared/contracts";
import type { ChatSession } from "./chat-sessions";

type Collection = Exclude<keyof ChatState, "cursor" | "generation">;
export interface AssistantHome {
  assistantId: string;
  workspaceId: string;
  directory: string;
}

export class ChatStore {
  private readonly db: DatabaseSync;
  private readonly generation: string;
  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Set<{ after: number; resolve: (changed: boolean) => void }>();
  private depth = 0;
  private dirty = false;
  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY(collection,id)); CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, id TEXT NOT NULL);",
    );
    this.db.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    this.indexChatSessionsByAgent();
    // Server-only tables: never part of the synced snapshot. mention_cooldowns and peer_inbox are
    // reserved for the group routing milestone and stay empty until then.
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
  get currentGeneration(): string {
    return this.generation;
  }
  snapshot(after = 0, generation = this.generation): ChatState {
    if (generation !== this.generation) after = 0;
    const result: Record<string, unknown> = {
      generation: this.generation,
      cursor: this.cursor(),
      assistants: [],
      conversations: [],
      messages: [],
      tasks: [],
      turns: [],
    };
    const rows = this.db
      .prepare("SELECT collection, value FROM records WHERE seq > ? ORDER BY seq")
      .all(after) as Array<{ collection: Collection; value: string }>;
    for (const row of rows) (result[row.collection] as unknown[]).push(JSON.parse(row.value));
    return stateSchema.parse(result);
  }
  get<K extends Collection>(collection: K, id: string): ChatState[K][number] | null {
    const row = this.db
      .prepare("SELECT value FROM records WHERE collection=? AND id=?")
      .get(collection, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  put<K extends Collection>(collection: K, value: ChatState[K][number]): void {
    const event = this.db
      .prepare("INSERT INTO changes(collection,id) VALUES (?,?)")
      .run(collection, value.id);
    this.db
      .prepare(
        "INSERT INTO records(collection,id,value,seq) VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value,seq=excluded.seq",
      )
      .run(collection, value.id, JSON.stringify(value), event.lastInsertRowid);
    this.markChanged();
  }
  /** Stores a message, stamping the next monotonic `seq` unless it already has one. */
  putMessage(message: Message): Message {
    const stamped =
      message.seq === undefined ? { ...message, seq: this.nextMessageSeq() } : message;
    this.put("messages", stamped);
    return stamped;
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
        console.error("Bigbang store listener failed", error);
      }
    }
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
  putChatSession(session: ChatSession): void {
    this.db
      .prepare(
        "INSERT INTO chat_sessions(id,value,agent_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,agent_id=excluded.agent_id",
      )
      .run(session.id, JSON.stringify(session), session.agentId);
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
