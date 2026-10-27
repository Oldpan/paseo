import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// An assistant's home lives on the machine its executions run on: `<bigbang>/assistants/<id>`,
// with MEMORY.md and notes/. The coordinator and member plugins both use these helpers on their
// own disk, so the ledger never needs remote file access.

export interface MemoryFile {
  content: string;
  /** 0 when the file does not exist yet. */
  mtimeMs: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The home of an assistant; `subdirectory` is the private home a reused visible workspace forces. */
export function assistantRoot(bigbangHome: string, assistantId: string, subdirectory = false) {
  if (!UUID.test(assistantId)) throw new Error("Invalid assistant id.");
  const root = path.join(bigbangHome, "assistants", assistantId);
  return subdirectory ? path.join(root, "home") : root;
}

/** Creates the home and seeds MEMORY.md once; the agent owns the file afterwards. */
export function prepareHome(directory: string, seed: string): void {
  mkdirSync(path.join(directory, "notes"), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path.join(directory, "MEMORY.md"), seed, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
}

export function readMemory(directory: string): MemoryFile {
  const file = path.join(directory, "MEMORY.md");
  try {
    return { content: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { content: "", mtimeMs: 0 };
    throw error;
  }
}

export function writeMemory(directory: string, content: string, expectedMtimeMs: number) {
  if (readMemory(directory).mtimeMs !== expectedMtimeMs)
    throw new Error("The memory changed since it was loaded. Reload it and try again.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "MEMORY.md");
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, file);
  return readMemory(directory);
}
