import { describe, expect, it } from "vitest";
import type {
  Assistant,
  Conversation,
  Message,
} from "../../../../extensions/pavra/shared/contracts";
import {
  ensureCoreNotes,
  groupNotesByCategory,
  normalizeNoteSlug,
  resolveNewNotePath,
} from "./memory";
import {
  filterSavedMessages,
  formatSavedMessagePreview,
  inferSavedMessageSourceType,
  parseSavedTimestampMs,
} from "./saved-messages";

const ASSISTANTS: Assistant[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Sky",
    provider: "codex/gpt-5",
    persona: "Coordinator assistant",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Max",
    provider: "claude/sonnet",
    persona: "Mac assistant",
  },
];

const CONVERSATIONS: Conversation[] = [
  {
    id: "dm:sky",
    name: "Sky",
    kind: "dm",
    members: [ASSISTANTS[0]!.id],
    roundtable: false,
  },
  {
    id: "group:eng",
    name: "Engineering",
    kind: "group",
    members: [ASSISTANTS[0]!.id, ASSISTANTS[1]!.id],
    roundtable: true,
  },
];

const MESSAGES: Message[] = [
  {
    id: "m-unsaved",
    conversationId: "dm:sky",
    threadId: null,
    senderId: "user",
    content: "Not bookmarked",
    createdAt: 1_000,
    taskId: null,
  },
  {
    id: "m-dm-1",
    conversationId: "dm:sky",
    threadId: null,
    senderId: ASSISTANTS[0]!.id,
    content: "Deploy checklist for Spark production server",
    createdAt: 2_000,
    savedAt: "2026-11-16T01:00:00.000Z",
    taskId: null,
  },
  {
    id: "m-group-1",
    conversationId: "group:eng",
    threadId: null,
    senderId: ASSISTANTS[1]!.id,
    content: "Mac build passed all unit and E2E checks",
    createdAt: 3_000,
    savedAt: "2026-11-16T03:00:00.000Z",
    taskId: null,
  },
  {
    id: "m-thread-1",
    conversationId: "group:eng",
    threadId: "m-group-1",
    senderId: "user",
    content: "Follow up in thread on release tagging",
    createdAt: 4_000,
    savedAt: "2026-11-16T02:00:00.000Z",
    taskId: null,
  },
];

describe("saved-messages helpers", () => {
  it("extracts saved messages, enriches metadata, and sorts by savedAt descending", () => {
    const all = filterSavedMessages({
      messages: MESSAGES,
      conversations: CONVERSATIONS,
      assistants: ASSISTANTS,
    });

    expect(all.map((item) => item.messageId)).toEqual(["m-group-1", "m-thread-1", "m-dm-1"]);
    expect(all[0]).toMatchObject({
      messageId: "m-group-1",
      senderName: "Max",
      conversationTitle: "Engineering",
      sourceType: "group",
    });
    expect(all[1]).toMatchObject({
      messageId: "m-thread-1",
      senderName: "You",
      conversationTitle: "Engineering",
      sourceType: "thread",
    });
    expect(all[2]).toMatchObject({
      messageId: "m-dm-1",
      senderName: "Sky",
      conversationTitle: "Sky",
      sourceType: "dm",
    });
  });

  it("filters saved messages by sourceType (dm, group, thread) and search query", () => {
    expect(
      filterSavedMessages({
        messages: MESSAGES,
        conversations: CONVERSATIONS,
        assistants: ASSISTANTS,
        filterType: "dm",
      }).map((item) => item.messageId),
    ).toEqual(["m-dm-1"]);

    expect(
      filterSavedMessages({
        messages: MESSAGES,
        conversations: CONVERSATIONS,
        assistants: ASSISTANTS,
        filterType: "group",
      }).map((item) => item.messageId),
    ).toEqual(["m-group-1"]);

    expect(
      filterSavedMessages({
        messages: MESSAGES,
        conversations: CONVERSATIONS,
        assistants: ASSISTANTS,
        filterType: "thread",
      }).map((item) => item.messageId),
    ).toEqual(["m-thread-1"]);

    expect(
      filterSavedMessages({
        messages: MESSAGES,
        conversations: CONVERSATIONS,
        assistants: ASSISTANTS,
        query: "spark production",
      }).map((item) => item.messageId),
    ).toEqual(["m-dm-1"]);

    expect(
      filterSavedMessages({
        messages: MESSAGES,
        conversations: CONVERSATIONS,
        assistants: ASSISTANTS,
        query: "engineering",
      }).map((item) => item.messageId),
    ).toEqual(["m-group-1", "m-thread-1"]);
  });

  it("parses timestamps, infers sourceType, and truncates long previews", () => {
    expect(parseSavedTimestampMs("1700000000000", 100)).toBe(1700000000000);
    expect(parseSavedTimestampMs("invalid-date", 555)).toBe(555);
    expect(inferSavedMessageSourceType({ threadId: "root-1" }, { kind: "dm" })).toBe("thread");
    expect(inferSavedMessageSourceType({ threadId: null }, { kind: "group" })).toBe("group");
    expect(inferSavedMessageSourceType({ threadId: null }, { kind: "dm" })).toBe("dm");
    expect(formatSavedMessagePreview("abcdefghij", 5)).toBe("abcde…");
  });
});

describe("memory notes tree helpers", () => {
  it("normalizes slugs and resolves new note paths across categories", () => {
    expect(normalizeNoteSlug("  QA Note.md ")).toBe("qa-note");
    expect(resolveNewNotePath("qa-note", "general")).toEqual({
      path: "notes/general/qa-note.md",
      category: "general",
      slug: "qa-note",
      title: "Qa Note",
    });
    expect(resolveNewNotePath("notes/general/qa-note.md")).toEqual({
      path: "notes/general/qa-note.md",
      category: "general",
      slug: "qa-note",
      title: "Qa Note",
    });
    expect(resolveNewNotePath("notes/custom-top.md")).toEqual({
      path: "notes/custom-top.md",
      category: "general",
      slug: "custom-top",
      title: "Custom Top",
    });
    expect(resolveNewNotePath("channels/eng-sync")).toEqual({
      path: "notes/channels/eng-sync.md",
      category: "channels",
      slug: "eng-sync",
      title: "Eng Sync",
    });
  });

  it("Always ensures MEMORY.md and notes/user-preferences.md and groups notes by category", () => {
    const ensured = ensureCoreNotes([
      {
        path: "notes/general/qa-note.md",
        category: "general",
        title: "QA Note",
        mtimeMs: 100,
        sizeBytes: 24,
      },
    ]);
    expect(ensured.map((n) => n.path)).toEqual([
      "MEMORY.md",
      "notes/user-preferences.md",
      "notes/general/qa-note.md",
    ]);

    const groups = groupNotesByCategory(ensured);
    expect(groups.map((g) => [g.category, g.notes.length])).toEqual([
      ["index", 1],
      ["preferences", 1],
      ["channels", 0],
      ["work-log", 0],
      ["general", 1],
      ["archive", 0],
    ]);
  });
});
