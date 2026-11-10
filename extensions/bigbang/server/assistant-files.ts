import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// An assistant's home lives on the machine its executions run on: `<bigbang>/assistants/<id>`,
// with MEMORY.md and notes/. The coordinator and member plugins both use these helpers on their
// own disk, so the ledger never needs remote file access.

export const MAX_MEMORY_INDEX_LINES = 200;
export const MAX_USER_PREFERENCES_CHARS = 8000;
export const MAX_CHANNEL_OUTCOMES_CHARS = 2000;

export interface MemoryFile {
  content: string;
  /** 0 when the file does not exist yet. */
  mtimeMs: number;
}

export interface MemorySnapshot {
  memoryIndex: string;
  userPreferences: string;
  channelOutcomes: string;
}

export interface TaskOutcomeNoteInput {
  taskId: string;
  anchor: string;
  title: string;
  status: "completed" | "failed" | "cancelled";
  directory: string;
  conversationId: string;
  conversationName?: string;
  summary: string;
  timestampMs: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Single path segment for notes/channels/<slug>.md and notes/work-log/<week>.md. */
export const NOTE_SEGMENT_MAX = 80;
const NOTE_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

export function isSafeNoteSegment(value: string): boolean {
  return value.length <= NOTE_SEGMENT_MAX && NOTE_SEGMENT.test(value);
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function containedFile(root: string, filename: string): string {
  if (path.basename(filename) !== filename || filename === "." || filename === "..")
    throw new Error("Invalid note file name.");
  const directory = path.resolve(root);
  const file = path.resolve(directory, filename);
  const relative = path.relative(directory, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Invalid note file name.");
  return file;
}

function noteFile(root: string, stem: string): string {
  if (!isSafeNoteSegment(stem)) throw new Error("Invalid note file name.");
  return containedFile(root, `${stem}.md`);
}

function writeAtomic(file: string, content: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, file);
}

/** The home of an assistant; `subdirectory` is the private home a reused visible workspace forces. */
export function assistantRoot(bigbangHome: string, assistantId: string, subdirectory = false) {
  if (!UUID.test(assistantId)) throw new Error("Invalid assistant id.");
  const root = path.join(bigbangHome, "assistants", assistantId);
  return subdirectory ? path.join(root, "home") : root;
}

/** Creates the home and seeds MEMORY.md once; the agent owns the file afterwards. */
export function prepareHome(directory: string, seed: string): void {
  mkdirSync(path.join(directory, "notes"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(directory, "notes", "channels"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(directory, "notes", "work-log"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(directory, "notes", "archive"), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path.join(directory, "MEMORY.md"), seed, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
}

export function channelSlug(conversationId: string, conversationName?: string): string {
  const idSuffix = conversationId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  const namePart = sanitizeSegment(conversationName ?? "");
  let slug: string;
  if (namePart) {
    if (idSuffix) {
      const budget = NOTE_SEGMENT_MAX - idSuffix.length - 1;
      const trimmed = budget > 0 ? namePart.slice(0, budget).replace(/-$/, "") : "";
      slug = trimmed ? `${trimmed}-${idSuffix}` : idSuffix;
    } else slug = namePart.slice(0, NOTE_SEGMENT_MAX).replace(/-$/, "");
  } else slug = sanitizeSegment(conversationId) || idSuffix;
  if (slug.length > NOTE_SEGMENT_MAX) slug = slug.slice(0, NOTE_SEGMENT_MAX).replace(/-$/, "");
  if (isSafeNoteSegment(slug)) return slug;
  if (idSuffix && isSafeNoteSegment(idSuffix)) return idSuffix;
  return "channel";
}

export function isoWeekKey(timestampMs: number): { week: string; date: string } {
  if (!Number.isFinite(timestampMs)) throw new Error("Invalid timestamp.");
  const d = new Date(timestampMs);
  const date = d.toISOString().slice(0, 10);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNumber = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  const week = `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
  return { week, date };
}

export function readMemorySnapshot(directory: string, slug?: string): MemorySnapshot {
  let memoryIndex = "";
  try {
    const raw = readFileSync(path.join(directory, "MEMORY.md"), "utf8");
    const lines = raw.split(/\r?\n/, MAX_MEMORY_INDEX_LINES);
    memoryIndex = lines.join("\n").trim();
  } catch {}

  let userPreferences = "";
  try {
    const raw = readFileSync(path.join(directory, "notes", "user-preferences.md"), "utf8");
    userPreferences = raw.slice(0, MAX_USER_PREFERENCES_CHARS).trim();
  } catch {}

  let channelOutcomes = "";
  if (slug && isSafeNoteSegment(slug)) {
    try {
      const raw = readFileSync(noteFile(path.join(directory, "notes", "channels"), slug), "utf8");
      const match =
        raw.match(/(## Recent Durable Outcomes[\s\S]*?<!-- recent-durable-outcomes:end -->)/i) ??
        raw.match(
          /(<!-- recent-durable-outcomes:start -->[\s\S]*?<!-- recent-durable-outcomes:end -->)/i,
        );
      channelOutcomes = (match ? match[1] : raw).slice(0, MAX_CHANNEL_OUTCOMES_CHARS).trim();
    } catch {}
  }

  return { memoryIndex, userPreferences, channelOutcomes };
}

const OUTCOMES_START = "<!-- recent-durable-outcomes:start -->";
const OUTCOMES_END = "<!-- recent-durable-outcomes:end -->";
const OUTCOMES_HEADER = "## Recent Durable Outcomes";

function managedOutcomesSection(bullets: string[]): string {
  return `${OUTCOMES_HEADER}\n${OUTCOMES_START}\n${bullets.join("\n")}\n${OUTCOMES_END}`;
}

function upsertWorkLog(workLogDir: string, week: string, marker: string, bullet: string): void {
  const workLogPath = noteFile(workLogDir, week);
  let content = `# Work Log (${week})\n\n${bullet}\n`;
  try {
    const existing = readFileSync(workLogPath, "utf8");
    if (existing.includes(marker)) {
      const lines = existing.split("\n");
      const index = lines.findIndex((line) => line.includes(marker));
      if (index >= 0) lines[index] = bullet;
      content = lines.join("\n");
    } else {
      const trimmed = existing.trimEnd();
      content = trimmed ? `${trimmed}\n${bullet}\n` : content;
    }
  } catch {}
  writeAtomic(workLogPath, content);
}

function prefixBeforeOutcomesHeader(beforeStart: string): string {
  const headerMatch = beforeStart.match(/(?:^|\n)## Recent Durable Outcomes[ \t]*\n*$/);
  if (!headerMatch) return beforeStart;
  let cut = headerMatch.index ?? 0;
  if (headerMatch[0].startsWith("\n")) cut += 1;
  return beforeStart.slice(0, cut);
}

function upsertChannelNotes(
  channelsDir: string,
  slug: string,
  conversationName: string | undefined,
  taskMarker: string,
  bullet: string,
): void {
  const channelPath = noteFile(channelsDir, slug);
  let content = "";
  try {
    const existing = readFileSync(channelPath, "utf8");
    const startIndex = existing.indexOf(OUTCOMES_START);
    const endIndex = existing.indexOf(OUTCOMES_END);
    if (startIndex >= 0 && endIndex > startIndex) {
      const inside = existing.slice(startIndex + OUTCOMES_START.length, endIndex);
      const prior = inside
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- ") && !line.includes(taskMarker));
      const section = managedOutcomesSection([bullet, ...prior].slice(0, 5));
      const leading = prefixBeforeOutcomesHeader(existing.slice(0, startIndex)).trimEnd();
      const trailing = existing.slice(endIndex + OUTCOMES_END.length).trimStart();
      content = `${leading ? `${leading}\n\n` : ""}${section}${trailing ? `\n\n${trailing}` : "\n"}`;
    } else {
      const section = managedOutcomesSection([bullet]);
      const trimmed = existing.trim();
      content = trimmed ? `${section}\n\n${trimmed}\n` : `${section}\n`;
    }
  } catch {
    const heading = (conversationName ?? slug).replace(/[\r\n]+/g, " ").trim() || slug;
    content = `# Channel: #${heading}\n\n${managedOutcomesSection([bullet])}\n`;
  }
  writeAtomic(channelPath, content);
}

export function syncTaskOutcomeToNotes(directory: string, input: TaskOutcomeNoteInput): void {
  const workLogDir = path.join(directory, "notes", "work-log");
  const channelsDir = path.join(directory, "notes", "channels");
  mkdirSync(workLogDir, { recursive: true, mode: 0o700 });
  mkdirSync(channelsDir, { recursive: true, mode: 0o700 });

  const { week, date } = isoWeekKey(input.timestampMs);
  const normalizedSummary =
    input.summary.replace(/[\r\n]+/g, " ").trim() ||
    (input.status === "completed" ? "Completed successfully." : input.status);
  const normalizedTitle = input.title.replace(/[\r\n]+/g, " ").trim() || "Untitled task";
  const workLogMarker = `<!-- task-outcome:${input.taskId}:${input.anchor} -->`;
  upsertWorkLog(
    workLogDir,
    week,
    workLogMarker,
    `- [${date}] **${normalizedTitle}** (${input.status} in ${input.directory}): ${normalizedSummary} ${workLogMarker}`,
  );

  const slug = channelSlug(input.conversationId, input.conversationName);
  const taskMarker = `<!-- task-id:${input.taskId} -->`;
  upsertChannelNotes(
    channelsDir,
    slug,
    input.conversationName,
    taskMarker,
    `- [${date}] **${normalizedTitle}** (${input.status}): ${normalizedSummary} ${taskMarker}`,
  );
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
  writeAtomic(path.join(directory, "MEMORY.md"), content);
  return readMemory(directory);
}
