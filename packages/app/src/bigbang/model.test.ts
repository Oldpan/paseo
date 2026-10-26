import { describe, expect, it } from "vitest";
import type { Message } from "../../../../extensions/bigbang/shared/contracts";
import {
  addStudioColumn,
  EMPTY_CHAT_STATE,
  isNoteMessage,
  mergeChatState,
  sortMessages,
  studioKey,
} from "./model";

describe("Bigbang data ownership", () => {
  it("keeps identically named workspaces on different machines distinct", () => {
    const a = { serverId: "mac", workspaceId: "w", name: "project", group: "General" };
    const b = { ...a, serverId: "spark" };
    const columns = addStudioColumn(addStudioColumn([], a), b);
    expect(columns).toEqual([a, b]);
    expect(addStudioColumn(columns, a)).toBe(columns);
    expect(studioKey(a)).not.toBe(studioKey(b));
  });
  it("merges incremental changes without losing history and ignores old responses", () => {
    const assistant = { id: "a", name: "Ada", provider: "codex/default", persona: "", memory: "" };
    const first = mergeChatState(EMPTY_CHAT_STATE, {
      ...EMPTY_CHAT_STATE,
      cursor: 1,
      assistants: [assistant],
    });
    const next = mergeChatState(first, {
      ...EMPTY_CHAT_STATE,
      cursor: 2,
      assistants: [{ ...assistant, name: "Grace" }],
    });
    expect(next.assistants).toEqual([{ ...assistant, name: "Grace" }]);
    expect(mergeChatState(next, first)).toBe(next);
    expect(mergeChatState(next, { ...EMPTY_CHAT_STATE, cursor: 2 }).assistants).toEqual(
      next.assistants,
    );
  });

  it("orders messages by seq, with rows that predate seq first by time", () => {
    const row = (id: string, createdAt: number, seq?: number): Message => ({
      id,
      conversationId: "c",
      threadId: null,
      senderId: "user",
      content: id,
      createdAt,
      taskId: null,
      ...(seq === undefined ? {} : { seq }),
    });
    const sorted = sortMessages([
      row("late", 300, 7),
      row("clock-skewed", 100, 9),
      row("old-b", 20),
      row("old-a", 10),
      row("early", 400, 3),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([
      "old-a",
      "old-b",
      "early",
      "late",
      "clock-skewed",
    ]);
  });
  it("renders system and task_event rows as notes", () => {
    expect(isNoteMessage({ kind: "system" })).toBe(true);
    expect(isNoteMessage({ kind: "task_event" })).toBe(true);
    expect(isNoteMessage({ kind: "final" })).toBe(false);
    expect(isNoteMessage({})).toBe(false);
  });
});
