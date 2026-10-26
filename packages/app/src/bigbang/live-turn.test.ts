import { describe, expect, it } from "vitest";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { selectLiveTurn } from "./live-turn";

const at = new Date("2026-10-27T00:00:00Z");
const user = (messageId: string | undefined, id = `u:${messageId}`): StreamItem => ({
  kind: "user_message",
  id,
  ...(messageId ? { messageId } : {}),
  text: "hi",
  timestamp: at,
});
const assistant = (text: string, messageId?: string, id = `a:${text}`): StreamItem => ({
  kind: "assistant_message",
  id,
  ...(messageId ? { messageId } : {}),
  text,
  timestamp: at,
});
const tool = (name: string, status: "running" | "completed" = "running"): ToolCallItem => ({
  kind: "tool_call",
  id: `t:${name}`,
  timestamp: at,
  payload: {
    source: "agent",
    data: {
      provider: "codex",
      callId: name,
      name,
      status,
      error: null,
      detail: { type: "unknown", input: null, output: null },
    },
  },
});
const thought = (status: "loading" | "ready"): StreamItem => ({
  kind: "thought",
  id: "th",
  text: "hmm",
  status,
  timestamp: at,
});

describe("selectLiveTurn", () => {
  it("reports an unknown turn instead of guessing when the anchor is missing", () => {
    expect(selectLiveTurn([user("studio"), assistant("Studio answer", "m")], "turn-1")).toEqual({
      found: false,
      commentary: "",
      text: "",
      activity: null,
    });
    expect(selectLiveTurn([], "turn-1").found).toBe(false);
  });

  it("finds the anchor with no reply yet", () => {
    expect(selectLiveTurn([user("turn-1")], "turn-1")).toEqual({
      found: true,
      commentary: "",
      text: "",
      activity: null,
    });
  });

  it("returns the streaming assistant text after the anchor", () => {
    const items = [user("turn-1"), assistant("Hel", "m1"), assistant("lo", "m1", "a2")];
    expect(selectLiveTurn(items, "turn-1")).toMatchObject({ text: "Hello", commentary: "" });
  });

  it("splits Codex commentary from the final answer at the boundary marker", () => {
    const items = [
      user("turn-1"),
      assistant("I will check the repository.", "item-1"),
      tool("shell", "completed"),
      assistant("\n\n---\n\nThe answer", "item-2"),
      assistant(" is 42.", "item-2", "a3"),
    ];
    expect(selectLiveTurn(items, "turn-1")).toEqual({
      found: true,
      commentary: "I will check the repository.",
      text: "The answer is 42.",
      activity: null,
    });
  });

  it("separates adjacent assistant messages that carry different ids", () => {
    const items = [user("t"), assistant("One", "a"), assistant("\n\n---\n\nTwo", "b")];
    expect(selectLiveTurn(items, "t")).toMatchObject({ commentary: "One", text: "Two" });
  });

  it("falls back to the last contiguous assistant segment when providers send no ids", () => {
    const items = [user("t"), assistant("Looking."), tool("grep", "completed"), assistant("Done")];
    expect(selectLiveTurn(items, "t")).toMatchObject({ commentary: "Looking.", text: "Done" });
  });

  it("reads only the anchored turn when several turns share one stream", () => {
    const items = [
      user("old"),
      assistant("Old answer", "o"),
      user("ours"),
      assistant("Our answer", "m"),
      user("studio-typed"),
      assistant("Studio answer", "s"),
    ];
    expect(selectLiveTurn(items, "old").text).toBe("Old answer");
    expect(selectLiveTurn(items, "ours").text).toBe("Our answer");
    expect(selectLiveTurn(items, "studio-typed").text).toBe("Studio answer");
  });

  it("shows the running tool as activity and clears it once the agent speaks again", () => {
    const working = [user("t"), assistant("Checking", "a"), tool("read_file")];
    expect(selectLiveTurn(working, "t").activity).toBe("read_file");
    expect(selectLiveTurn([...working, assistant("Found it", "b")], "t").activity).toBeNull();
    expect(selectLiveTurn([user("t"), tool("shell", "completed")], "t").activity).toBeNull();
  });

  it("shows an open thought as activity", () => {
    expect(selectLiveTurn([user("t"), thought("loading")], "t").activity).toBe("Thinking");
    expect(selectLiveTurn([user("t"), thought("ready")], "t").activity).toBeNull();
  });
});
