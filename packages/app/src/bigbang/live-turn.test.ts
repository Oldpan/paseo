import { describe, expect, it } from "vitest";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import {
  formatLiveTurnStatus,
  isPassPrefix,
  isSilentAwareness,
  selectLiveTurn,
  selectTurnStream,
  summarizeCommentary,
} from "./live-turn";

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

describe("awareness turns that pass", () => {
  it("recognises the start of a pass", () => {
    for (const text of ["(", "(pa", "(pass)", " pass ", "Pass"])
      expect(isPassPrefix(text)).toBe(true);
    for (const text of ["", "Passing thought", "(passing)", "Sure"])
      expect(isPassPrefix(text)).toBe(false);
  });

  it("keeps a silent awareness turn out of the transcript until it has something to say", () => {
    const silent = (kind: string | undefined, text: string, hasPermissions = false) =>
      isSilentAwareness({ kind, text, hasPermissions });
    expect(silent("awareness", "")).toBe(true);
    expect(silent("awareness", "(pass")).toBe(true);
    expect(silent("awareness", "I would add that")).toBe(false);
    expect(silent("awareness", "", true)).toBe(false);
    // Only awareness turns are silent; a reply or roundtable turn always shows its status.
    expect(silent("reply", "")).toBe(false);
    expect(silent("roundtable", "")).toBe(false);
    expect(silent(undefined, "")).toBe(false);
  });
});

describe("single-line bubble status and process stream slicing", () => {
  it("summarizes multi-line commentary to its latest single-line block", () => {
    expect(summarizeCommentary("")).toBeNull();
    expect(summarizeCommentary("   \n\n  ")).toBeNull();
    expect(summarizeCommentary("Checking files.")).toBe("Checking files.");
    expect(summarizeCommentary("First step.\n\nSecond step\nwith extra   whitespace.")).toBe(
      "Second step with extra whitespace.",
    );
  });

  it("formats live turn status preferring activity, then commentary summary, then statusLabel", () => {
    expect(
      formatLiveTurnStatus({
        sender: "Atlas",
        activity: "read_file",
        commentary: "Checking files.",
        statusLabel: "Thinking…",
      }),
    ).toBe("Atlas · read_file…");

    expect(
      formatLiveTurnStatus({
        sender: "Atlas",
        activity: null,
        commentary: "Step one.\n\nInspecting config\nnow.",
        statusLabel: "Thinking…",
      }),
    ).toBe("Atlas · Inspecting config now.");

    expect(
      formatLiveTurnStatus({
        sender: "Atlas",
        activity: null,
        commentary: "",
        statusLabel: "Starting…",
      }),
    ).toBe("Atlas · Starting…");
  });

  it("slices tail and head to the anchored turn for the process drawer", () => {
    const tail = [
      user("turn-1"),
      thought("ready"),
      tool("read_file", "completed"),
      assistant("First turn answer", "m1"),
      user("turn-2"),
      tool("shell", "running"),
    ];
    const head = [assistant("Streaming second answer", "m2")];

    const firstSlice = selectTurnStream(tail, head, "turn-1");
    expect(firstSlice.found).toBe(true);
    expect(firstSlice.tail).toEqual([
      thought("ready"),
      tool("read_file", "completed"),
      assistant("First turn answer", "m1"),
    ]);
    expect(firstSlice.head).toEqual([]);

    const secondSlice = selectTurnStream(tail, head, "turn-2");
    expect(secondSlice.found).toBe(true);
    expect(secondSlice.tail).toEqual([tool("shell", "running")]);
    expect(secondSlice.head).toEqual(head);
  });

  it("falls back to the latest turn segment when provider history has no messageId anchors", () => {
    const tail = [
      user(undefined, "u-old"),
      assistant("Old reply"),
      user(undefined, "u-latest"),
      tool("grep", "completed"),
      assistant("Latest reply"),
    ];
    const slice = selectTurnStream(tail, [], "missing-anchor");
    expect(slice.found).toBe(false);
    expect(slice.tail).toEqual([tool("grep", "completed"), assistant("Latest reply")]);
    expect(slice.head).toEqual([]);
  });
});
