import { describe, expect, it } from "vitest";
import { finalTextAfter, isPass, type ProjectionEntry } from "./projection";

const user = (messageId: string, text = "hi"): ProjectionEntry => ({
  item: { type: "user_message", text, messageId },
});
const assistant = (text: string, messageId?: string): ProjectionEntry => ({
  item: { type: "assistant_message", text, ...(messageId ? { messageId } : {}) },
});
const tool: ProjectionEntry = { item: { type: "tool_call" } };

describe("finalTextAfter", () => {
  it("returns the assistant text after the anchoring user message", () => {
    expect(finalTextAfter([user("turn-1"), assistant("Hello", "m1")], "turn-1")).toEqual({
      text: "Hello",
      closed: false,
      error: null,
    });
  });

  it("keeps only the last assistant message of a Codex turn and strips its boundary marker", () => {
    const entries = [
      user("turn-1"),
      assistant("I will check the repository.", "item-1"),
      tool,
      assistant("\n\n---\n\nThe answer", "item-2"),
      assistant(" is 42.", "item-2"),
    ];
    expect(finalTextAfter(entries, "turn-1")?.text).toBe("The answer is 42.");
  });

  it("separates adjacent assistant messages that carry different ids", () => {
    const entries = [user("t"), assistant("Commentary", "a"), assistant("\n\n---\n\nFinal", "b")];
    expect(finalTextAfter(entries, "t")?.text).toBe("Final");
  });

  it("falls back to the last contiguous assistant segment when providers send no ids", () => {
    const entries = [user("t"), assistant("Looking."), tool, assistant("Done "), assistant("now.")];
    expect(finalTextAfter(entries, "t")?.text).toBe("Done now.");
  });

  it("reads only the anchored turn, never an earlier or later one", () => {
    const entries = [
      user("old"),
      assistant("Old answer", "o"),
      user("ours"),
      assistant("Our answer", "m"),
      user("studio-typed"),
      assistant("Studio answer", "s"),
    ];
    expect(finalTextAfter(entries, "ours")).toEqual({
      text: "Our answer",
      closed: true,
      error: null,
    });
  });

  it("reports an unknown turn instead of guessing when the anchor is missing", () => {
    expect(finalTextAfter([user("studio"), assistant("Answer", "m")], "turn-1")).toBeNull();
    expect(finalTextAfter([], "turn-1")).toBeNull();
  });

  it("yields empty text for a turn with only tool calls and surfaces a trailing error", () => {
    expect(finalTextAfter([user("t"), tool], "t")).toEqual({
      text: "",
      closed: false,
      error: null,
    });
    const failed = finalTextAfter(
      [user("t"), assistant("Trying", "m"), { item: { type: "error", message: "boom" } }],
      "t",
    );
    expect(failed?.error).toBe("boom");
  });
});

describe("isPass", () => {
  it("accepts (pass) in any case with surrounding whitespace", () => {
    for (const text of ["(pass)", " (PASS)\n", "pass", "(Pass"]) expect(isPass(text)).toBe(true);
  });
  it("rejects text that merely contains the word", () => {
    for (const text of ["I will pass on that", "(pass) because I agree", "", "passes"])
      expect(isPass(text)).toBe(false);
  });
});
