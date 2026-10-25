import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { stateSchema, type ChatState } from "../shared/contracts";
import type { ChatSession } from "./chat-sessions";

type Collection = Exclude<keyof ChatState, "cursor" | "generation">;

export class ChatStore {
  private readonly db: DatabaseSync;
  private readonly generation: string;
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
    this.db
      .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES ('generation',?)")
      .run(randomUUID());
    this.generation = (
      this.db.prepare("SELECT value FROM metadata WHERE key='generation'").get() as {
        value: string;
      }
    ).value;
  }
  snapshot(after = 0, generation = this.generation): ChatState {
    if (generation !== this.generation) after = 0;
    const result: Record<string, unknown> = {
      generation: this.generation,
      cursor: Number(
        (
          this.db.prepare("SELECT COALESCE(MAX(seq),0) AS cursor FROM changes").get() as {
            cursor: number;
          }
        ).cursor,
      ),
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
  }
  getChatSession(id: string): ChatSession | null {
    const row = this.db.prepare("SELECT value FROM chat_sessions WHERE id=?").get(id) as
      | { value: string }
      | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  putChatSession(session: ChatSession): void {
    this.db
      .prepare(
        "INSERT INTO chat_sessions(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(session.id, JSON.stringify(session));
  }
  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
}
