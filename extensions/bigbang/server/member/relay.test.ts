import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberRelay, NOT_LINKED, UNKNOWN_OUTCOME } from "./relay";

const relays: MemberRelay[] = [];
afterEach(() => {
  for (const open of relays.splice(0)) open.close();
  vi.useRealTimers();
});
function relay(options: Partial<ConstructorParameters<typeof MemberRelay>[0]> = {}) {
  const created = new MemberRelay({ coordinatorServerId: () => "srv_coord", ...options });
  relays.push(created);
  return created;
}
const poll = (target: MemberRelay, ackThrough = 0, waitMs = 0) =>
  target.poll({ coordinatorServerId: "srv_coord", ackThrough, waitMs });

describe("MemberRelay", () => {
  it("hands a tool call to the coordinator's poll and resolves with its answer", async () => {
    const target = relay();
    const result = target.call("agent-1", "start_task", { prompt: "hi" });
    const { items } = await poll(target);
    expect(items).toMatchObject([
      { type: "call", agentId: "agent-1", tool: "start_task", input: { prompt: "hi" } },
    ]);
    const callId = items[0]?.type === "call" ? items[0].callId : "";
    expect(target.respond(callId, { ok: true, output: { taskId: "t" } })).toEqual({
      accepted: true,
    });
    await expect(result).resolves.toEqual({ taskId: "t" });
  });

  it("wakes a waiting poll when a call arrives", async () => {
    const target = relay();
    const waiting = poll(target, 0, 10_000);
    void target.call("agent-1", "task_status", {}).catch(() => {});
    expect((await waiting).items).toHaveLength(1);
  });

  it("delivers items again until a later poll acknowledges them", async () => {
    const target = relay();
    target.event({ name: "agent.turn_ended", agentId: "a", workspaceId: null });
    const first = await poll(target);
    expect((await poll(target)).items).toEqual(first.items);
    expect((await poll(target, first.items[0]?.seq ?? 0)).items).toEqual([]);
  });

  it("reports an unknown outcome and withdraws the call when the coordinator does not answer", async () => {
    vi.useFakeTimers();
    const target = relay({ callTimeoutMs: 1_000 });
    const result = target.call("agent-1", "start_task", {});
    const assertion = expect(result).rejects.toThrow(UNKNOWN_OUTCOME);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect((await poll(target)).items).toEqual([]);
  });

  it("ignores an answer that arrives after the call timed out", async () => {
    vi.useFakeTimers();
    const target = relay({ callTimeoutMs: 1_000 });
    const result = target.call("agent-1", "start_task", {}).catch(() => "timed out");
    const { items } = await poll(target);
    await vi.advanceTimersByTimeAsync(1_000);
    const callId = items[0]?.type === "call" ? items[0].callId : "";
    expect(target.respond(callId, { ok: true, output: {} })).toEqual({ accepted: false });
    await expect(result).resolves.toBe("timed out");
  });

  it("passes the coordinator's refusal to the agent", async () => {
    const target = relay();
    const result = target.call("agent-1", "start_task", {});
    const { items } = await poll(target);
    const callId = items[0]?.type === "call" ? items[0].callId : "";
    target.respond(callId, { ok: false, error: "Not a chat assistant." });
    await expect(result).rejects.toThrow("Not a chat assistant.");
  });

  it("answers only the coordinator it is configured for", async () => {
    await expect(
      relay().poll({ coordinatorServerId: "srv_other", ackThrough: 0, waitMs: 0 }),
    ).rejects.toThrow("srv_coord");
    const unlinked = relay({ coordinatorServerId: () => null });
    await expect(unlinked.call("agent-1", "start_task", {})).rejects.toThrow(NOT_LINKED);
  });

  it("keeps the newest events when they pile up, but never drops a call", async () => {
    const target = relay({ maxEvents: 2 });
    void target.call("agent-1", "task_status", {}).catch(() => {});
    for (const agentId of ["a", "b", "c"])
      target.event({ name: "agent.turn_ended", agentId, workspaceId: null });
    const { items } = await poll(target);
    expect(items.map((item) => item.agentId)).toEqual(["agent-1", "b", "c"]);
  });
});
