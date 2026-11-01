import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { Message } from "../../../../extensions/bigbang/shared/contracts";
import {
  addStudioColumn,
  EMPTY_CHAT_STATE,
  isNoteMessage,
  machineRoleLabel,
  mergeChatState,
  OPENED_GROUP,
  sortMessages,
  studioColumnFor,
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

  it("merges Studios and peer messages, and accepts a coordinator that sends neither", () => {
    const studio = { id: "s1", name: "Lab", status: "active", workspaces: [], createdAt: 0 };
    const first = mergeChatState(EMPTY_CHAT_STATE, {
      ...EMPTY_CHAT_STATE,
      cursor: 1,
      studios: [studio],
    });
    const old = { ...EMPTY_CHAT_STATE, cursor: 2 };
    delete (old as Partial<typeof old>).studios;
    delete (old as Partial<typeof old>).peerMessages;
    const next = mergeChatState(first, old);
    expect(next.studios).toEqual([studio]);
    expect(next.peerMessages).toEqual([]);
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

describe("studioColumnFor", () => {
  const workspace = (fields: Partial<WorkspaceDescriptor>) => fields as WorkspaceDescriptor;
  it("names the column after the workspace and files it under the opened group", () => {
    const workspaces = new Map([["w1", workspace({ title: "Fix login", name: "main" })]]);
    expect(studioColumnFor({ serverId: "mac", workspaceId: "w1" }, workspaces)).toEqual({
      serverId: "mac",
      workspaceId: "w1",
      name: "Fix login",
      group: OPENED_GROUP,
    });
  });

  it("falls back to the workspace name, then its id, before the session store knows it", () => {
    const named = new Map([["w1", workspace({ title: null, name: "main" })]]);
    expect(studioColumnFor({ serverId: "mac", workspaceId: "w1" }, named).name).toBe("main");
    expect(studioColumnFor({ serverId: "mac", workspaceId: "w2" }, undefined)).toMatchObject({
      workspaceId: "w2",
      name: "w2",
    });
  });
});

describe("machineRoleLabel", () => {
  it("names each Bigbang role the coordinator reports", () => {
    const machine = (role: string, reason?: string) => ({
      serverId: "s",
      label: "Spark",
      role,
      reason,
    });
    expect(machineRoleLabel(machine("coordinator"))).toBe("Chat coordinator");
    expect(machineRoleLabel(machine("member"))).toBe("Member");
    expect(machineRoleLabel(machine("unavailable", "plugin missing"))).toBe(
      "Unavailable · plugin missing",
    );
    expect(machineRoleLabel(undefined)).toBe("Studio only");
  });
});
