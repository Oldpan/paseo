import { describe, expect, it } from "vitest";
import { allowEditorNavigation, editorScript, parseEditorMessage } from "./bridge";

describe("native editor bridge", () => {
  it("accepts only newer changes from the current document", () => {
    const change = {
      type: "change",
      sessionId: "file-a",
      revision: 2,
      sourceRevision: 1,
      content: "你好",
    };
    expect(parseEditorMessage(JSON.stringify(change), "file-a", 1)).toEqual(change);
    expect(parseEditorMessage(JSON.stringify(change), "file-b", 1)).toBeNull();
    expect(parseEditorMessage(JSON.stringify(change), "file-a", 2)).toBeNull();
    expect(
      parseEditorMessage(JSON.stringify({ ...change, content: null }), "file-a", 1),
    ).toBeNull();
  });
  it("rejects malformed data and invalid cursor positions", () => {
    for (const raw of [
      "null",
      "[]",
      "{",
      "42",
      JSON.stringify({ type: "state", sessionId: "a", revision: 0, line: 0, column: 1 }),
    ]) {
      expect(parseEditorMessage(raw, "a", 0)).toBeNull();
    }
  });
  it("keeps document content inside a JSON value", () => {
    const content = "</script>\u2028${secret}";
    const script = editorScript({ content });
    expect(script).not.toContain("</script>");
    const captured: unknown[] = [];
    new Function("window", script)({
      paseoEditorReceive: (message: unknown) => captured.push(message),
    });
    expect(captured).toEqual([{ content }]);
  });
  it("blocks navigation outside the local editor", () => {
    expect(allowEditorNavigation("about:blank")).toBe(true);
    for (const url of [
      "https://example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "about:blank#other",
    ])
      expect(allowEditorNavigation(url)).toBe(false);
  });
});
