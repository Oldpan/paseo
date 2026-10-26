import { describe, expect, it } from "vitest";
import type { ChatState } from "../../../../extensions/bigbang/shared/contracts";
import { EMPTY_CHAT_STATE, mergeChatState } from "./model";
import { backoffMs, LONG_POLL_MS, runChatSyncLoop, type SyncLoopPorts } from "./sync";

function harness(responses: Array<ChatState | Error>, elapsedMs = 0) {
  let state = EMPTY_CHAT_STATE;
  let clock = 0;
  let cancelled = false;
  const reads: Array<{ after: number; generation: string; waitMs: number }> = [];
  const sleeps: number[] = [];
  const errors: string[] = [];
  let legacy = 0;
  const ports: SyncLoopPorts = {
    read: async (input) => {
      reads.push(input);
      const next = responses.shift();
      if (!next) {
        cancelled = true;
        return state;
      }
      clock += elapsedMs;
      if (next instanceof Error) throw next;
      return next;
    },
    current: () => state,
    apply: (next) => {
      state = mergeChatState(state, next);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => clock,
    isCancelled: () => cancelled,
    onError: (error) => errors.push(error.message),
    onLegacyCoordinator: () => {
      legacy += 1;
    },
  };
  return { ports, reads, sleeps, errors, legacy: () => legacy, state: () => state };
}
const at = (cursor: number, generation = "g"): ChatState => ({
  ...EMPTY_CHAT_STATE,
  generation,
  cursor,
});

describe("Chat sync loop", () => {
  it("long-polls from the merged cursor and generation", async () => {
    const h = harness([at(3), at(5)], 20000);
    await runChatSyncLoop(h.ports);
    expect(h.reads[0]).toEqual({ after: 0, generation: "", waitMs: LONG_POLL_MS });
    expect(h.reads[1]).toEqual({ after: 3, generation: "g", waitMs: LONG_POLL_MS });
    expect(h.reads[2]).toEqual({ after: 5, generation: "g", waitMs: LONG_POLL_MS });
    expect(h.sleeps).toEqual([]);
  });

  it("does not pause after a full-length poll that saw no change", async () => {
    const h = harness([at(2), at(2)], 20000);
    await runChatSyncLoop(h.ports);
    expect(h.sleeps).toEqual([]);
    expect(h.legacy()).toBe(0);
  });

  it("paces a coordinator that ignores waitMs instead of spinning", async () => {
    const h = harness([at(2), at(2), at(2)], 5);
    await runChatSyncLoop(h.ports);
    expect(h.sleeps).toEqual([1500, 1500]);
    expect(h.legacy()).toBe(2);
  });

  it("backs off exponentially on errors and resets after a success", async () => {
    const h = harness([new Error("a"), new Error("b"), at(1), new Error("c")]);
    await runChatSyncLoop(h.ports);
    expect(h.errors).toEqual(["a", "b", "c"]);
    expect(h.sleeps).toEqual([1000, 2000, 1000]);
  });

  it("caps the backoff", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(20)).toBe(30000);
  });

  it("drops a response that arrives after cancellation", async () => {
    const h = harness([at(4)]);
    const read = h.ports.read;
    let cancelled = false;
    const applied: ChatState[] = [];
    await runChatSyncLoop({
      ...h.ports,
      isCancelled: () => cancelled,
      read: async (input) => {
        const result = await read(input);
        cancelled = true;
        return result;
      },
      apply: (next) => applied.push(next),
    });
    expect(applied).toEqual([]);
  });
});
