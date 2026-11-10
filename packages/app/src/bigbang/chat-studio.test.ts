import { describe, expect, it } from "vitest";
import type { Turn } from "../../../../extensions/bigbang/shared/contracts";
import { findLatestNonTaskTurn, turnColumnName } from "./chat-studio";

function turn(overrides: Partial<Turn>): Turn {
  return {
    id: "t",
    conversationId: "chat",
    threadId: null,
    assistantId: "ada",
    prompt: "",
    status: "completed",
    agentId: "agent",
    error: null,
    ...overrides,
  };
}

describe("findLatestNonTaskTurn", () => {
  it("returns the latest non-task turn for an assistant in a conversation root", () => {
    const turns = [
      turn({ id: "old", assistantId: "ada" }),
      turn({ id: "task", assistantId: "ada", taskId: "task-1" }),
      turn({ id: "other", assistantId: "grace" }),
      turn({ id: "latest", assistantId: "ada" }),
    ];
    expect(
      findLatestNonTaskTurn(turns, "ada", { conversationId: "chat", threadId: null })?.id,
    ).toBe("latest");
  });

  it("does not fall back from a thread to the conversation root or another chat", () => {
    const turns = [
      turn({ id: "root", conversationId: "chat", threadId: null }),
      turn({ id: "elsewhere", conversationId: "other", threadId: null }),
    ];
    expect(
      findLatestNonTaskTurn(turns, "ada", { conversationId: "chat", threadId: "thread-1" }),
    ).toBeUndefined();
  });

  it("finds a thread turn without using later root turns", () => {
    const turns = [
      turn({ id: "thread", threadId: "thread-1" }),
      turn({ id: "later-root", threadId: null }),
    ];
    expect(
      findLatestNonTaskTurn(turns, "ada", { conversationId: "chat", threadId: "thread-1" })?.id,
    ).toBe("thread");
  });

  it("without scope, returns the assistant's latest chat execution anywhere", () => {
    const turns = [
      turn({ id: "dm", conversationId: "dm" }),
      turn({ id: "group", conversationId: "group" }),
    ];
    expect(findLatestNonTaskTurn(turns, "ada")?.id).toBe("group");
  });
});

describe("turnColumnName", () => {
  it("names DM, group, and thread columns", () => {
    expect(turnColumnName("Ada", { kind: "dm", name: "Ada" }, null)).toBe("Ada · Chat");
    expect(turnColumnName("Ada", { kind: "group", name: "Lab" }, null)).toBe("Ada · Lab");
    expect(turnColumnName("Ada", { kind: "group", name: "Lab" }, "thread-1")).toBe("Ada · Thread");
  });
});
