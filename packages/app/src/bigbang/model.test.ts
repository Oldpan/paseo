import { describe, expect, it } from "vitest";
import { addStudioColumn, EMPTY_CHAT_STATE, mergeChatState, studioKey } from "./model";

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
});
