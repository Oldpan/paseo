import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Assistant, Message, Task, Turn } from "../shared/contracts";
import { DEFAULT_TASK_LIMITS } from "../shared/settings";
import { fixture, closeFixtures } from "./chat-fixture";
import {
  callAgentTool,
  startTaskHandler,
  startTaskTool,
  taskStatusHandler,
  taskStatusTool,
} from "./agent-tools";
import { TASK_RECEIPT_LEAD, taskBrief } from "./prompts";
import { deterministicTaskId } from "./task-events";

afterEach(closeFixtures);

const LOCAL = { serverId: "local", directory: "/work/app", isolation: "directory" as const };
const REMOTE = {
  serverId: "remote",
  directory: "/work/remote",
  isolation: "worktree" as const,
  label: "Spark",
};

// Ada may start tasks on two projects; Bob may not. Both chat privately with the user.
function setup(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture({ names: ["Ada", "Bob"], ...options });
  const ada = f.coordinator.saveAssistant({
    ...f.ada,
    autonomy: { enabled: true, targets: [LOCAL, REMOTE] },
  });
  const dm = f.group({ kind: "dm", name: "Ada", members: [ada.id] });
  const start = startTaskHandler(f.coordinator);
  const status = taskStatusHandler(f.coordinator);
  // Opens a reply from Ada: the tool call happens inside it.
  async function reply(text = "Please look at the app", conversationId = dm.id): Promise<Turn> {
    await f.say(text, { conversationId });
    const turn = f.store.snapshot().turns.findLast((item) => item.status === "running");
    if (!turn) throw new Error("No running reply");
    return turn;
  }
  const call = (turn: Turn, input: Partial<Parameters<typeof start>[0]> = {}) =>
    start({ prompt: "Fix the flaky test in app", ...input } as Parameters<typeof start>[0], {
      caller: { agentId: turn.agentId },
    });
  const rows = (taskId: string): Message[] =>
    f.store
      .snapshot()
      .messages.filter((message) => message.kind === "task_event" && message.taskId === taskId)
      .toSorted((a, b) => a.seq! - b.seq!);
  const types = (taskId: string) => rows(taskId).map((row) => row.event?.type);
  // Assistant replies in the chat; a task's root and result messages are final messages too.
  const replies = () => f.finals().filter((message) => message.taskId === null);
  const receipts = () => f.store.snapshot().turns.filter((turn) => turn.kind === "task_receipt");
  async function finishTask(taskId: string, text = "Done") {
    f.execution.say(taskId, text, `m-${taskId}`);
    f.execution.finish(taskId);
    f.coordinator.onTurnEnded({ agent: { id: taskId }, outcome: { kind: "completed" } });
    await f.coordinator.idle();
  }
  async function endReply(turn: Turn, text: string) {
    f.execution.say(turn.agentId, text, `m-${turn.id}`);
    f.execution.finish(turn.agentId);
    f.coordinator.onTurnEnded({ agent: { id: turn.agentId }, outcome: { kind: "completed" } });
    await f.coordinator.idle();
  }
  return {
    ...f,
    ada,
    dm,
    start,
    status,
    reply,
    call,
    rows,
    types,
    receipts,
    replies,
    finishTask,
    endReply,
    task: (id: string) => f.store.get("tasks", id)!,
  };
}

describe("agent tool schemas", () => {
  it("names the tools and rejects an empty brief", () => {
    expect(startTaskTool.name).toBe("start_task");
    expect(taskStatusTool.name).toBe("task_status");
    expect(startTaskTool.input.safeParse({ prompt: "  " }).success).toBe(false);
    expect(startTaskTool.input.safeParse({ prompt: "Do it" }).success).toBe(true);
  });
  it("derives one task id from a turn and a brief", () => {
    const id = deterministicTaskId("turn-1", "Fix it");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicTaskId("turn-1", "Fix it")).toBe(id);
    expect(deterministicTaskId("turn-2", "Fix it")).not.toBe(id);
    expect(deterministicTaskId("turn-1", "Fix that")).not.toBe(id);
  });
});

describe("authorization", () => {
  it("rejects an agent that is not a chat execution", async () => {
    const f = setup();
    await f.reply();
    expect(() => f.start({ prompt: "Do it" }, { caller: { agentId: randomUUID() } })).toThrow(
      "only available to a Chat assistant",
    );
  });

  it("rejects a task executor", async () => {
    const f = setup();
    const turn = await f.reply();
    const task = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    expect(() => f.start({ prompt: "Do more" }, { caller: { agentId: task.taskId } })).toThrow(
      "Task agents cannot start tasks",
    );
  });

  it("rejects an assistant that left the chat", async () => {
    const f = setup();
    const turn = await f.reply();
    // There is no membership edit yet; change the ledger as one would.
    f.store.transaction(() => f.store.put("conversations", { ...f.dm, members: [f.bob.id] }));
    expect(() => f.call(turn)).toThrow("no longer a member");
    expect(f.store.snapshot().tasks).toHaveLength(0);
  });

  it("rejects an assistant without autonomy and follows a change of mind", async () => {
    const f = setup();
    const turn = await f.reply();
    f.coordinator.saveAssistant({ ...f.ada, autonomy: { enabled: false, targets: [LOCAL] } });
    expect(() => f.call(turn)).toThrow("not allowed to start tasks");
    f.coordinator.saveAssistant({ ...f.ada, autonomy: undefined });
    expect(() => f.call(turn)).toThrow("not allowed to start tasks");
  });

  it("only starts tasks on an authorized target and lists the choices otherwise", async () => {
    const f = setup();
    const turn = await f.reply();
    expect(() => f.call(turn)).toThrow("Choose a target");
    expect(() => f.call(turn, { target: { serverId: "local", directory: "/work/other" } })).toThrow(
      /not authorized for you.*\/work\/app on serverId local.*\/work\/remote on Spark \(serverId remote\)/,
    );
    expect(() =>
      f.call(turn, { target: { serverId: "elsewhere", directory: "/work/app" } }),
    ).toThrow("not authorized");
    // A trailing slash is the same directory.
    expect(f.call(turn, { target: { serverId: "local", directory: "/work/app/" } })).toMatchObject({
      target: LOCAL,
    });
    expect(f.store.snapshot().tasks).toHaveLength(1);
  });

  it("defaults the only target, never loosens isolation and tightens it on request", async () => {
    const f = setup();
    f.coordinator.saveAssistant({ ...f.ada, autonomy: { enabled: true, targets: [LOCAL] } });
    const turn = await f.reply();
    expect(f.call(turn).target).toEqual(LOCAL);
    expect(f.call(turn, { prompt: "Isolated", isolation: "worktree" }).target.isolation).toBe(
      "worktree",
    );
    f.coordinator.saveAssistant({ ...f.ada, autonomy: { enabled: true, targets: [REMOTE] } });
    expect(() => f.call(turn, { prompt: "Loose", isolation: "directory" })).toThrow(
      "separate worktree",
    );
  });

  it("refuses a call outside a reply", async () => {
    const f = setup();
    const turn = await f.reply();
    await f.endReply(turn, "Done");
    expect(() => f.call(turn, { target: LOCAL })).toThrow("while you are replying");
  });
});

describe("starting a task", () => {
  it("creates an assistant task with its root message, a started row and the brief", async () => {
    const f = setup();
    const turn = await f.reply();
    const out = f.call(turn, { target: LOCAL, title: "Fix flaky test" });
    await f.coordinator.idle();
    const task = f.task(out.taskId);
    expect(task).toMatchObject({
      origin: "assistant",
      assistantId: f.ada.id,
      conversationId: f.dm.id,
      requestedByTurnId: turn.id,
      sourceThreadId: null,
      title: "Fix flaky test",
      prompt: "Fix the flaky test in app",
      serverId: "local",
      directory: "/work/app",
      provider: f.ada.provider,
      isolation: "directory",
      status: "running",
      accepted: true,
    });
    expect(f.store.get("messages", `task:${task.id}`)).toMatchObject({
      senderId: f.ada.id,
      threadId: null,
      taskId: task.id,
      content: "Fix flaky test\n\nFix the flaky test in app",
    });
    expect(f.execution.sent.some((item) => item.agentId === task.id)).toBe(false);
    expect(f.execution.agents.has(task.id)).toBe(true);
    expect(f.types(task.id)).toEqual(["task_started"]);
    expect(out).toMatchObject({ taskId: task.id, title: "Fix flaky test" });
    expect(out.message).toContain("Started");
  });

  it("returns the same task for the same turn and brief", async () => {
    const f = setup();
    const turn = await f.reply();
    const first = f.call(turn, { target: LOCAL });
    const again = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    expect(again.taskId).toBe(first.taskId);
    expect(again.message).toContain("already started");
    expect(f.store.snapshot().tasks).toHaveLength(1);
    expect(f.types(first.taskId)).toEqual(["task_started"]);
    const other = f.call(turn, { target: LOCAL, prompt: "A different brief" });
    expect(other.taskId).not.toBe(first.taskId);
    await f.coordinator.idle();
    expect(f.store.snapshot().tasks).toHaveLength(2);
  });

  it("lets a later turn start the same brief again", async () => {
    const f = setup();
    const first = await f.reply();
    const one = f.call(first, { target: LOCAL });
    await f.finishTask(one.taskId);
    await f.endReply(first, "Started");
    const second = await f.reply("Again please");
    const two = f.call(second, { target: LOCAL });
    expect(two.taskId).not.toBe(one.taskId);
  });

  it("records the thread the assistant was asked in", async () => {
    const f = setup();
    const root = await f.say("Look at this", { conversationId: f.dm.id });
    await f.run({ Ada: "Looking" });
    const turn = await f.reply("Threaded", f.dm.id);
    // A lane in a thread has its own chat session and execution.
    f.coordinator.send({
      id: randomUUID(),
      conversationId: f.dm.id,
      threadId: root,
      content: "Inside the thread",
    });
    await f.coordinator.idle();
    const inThread = f.store.snapshot().turns.findLast((item) => item.threadId === root)!;
    expect(inThread.agentId).not.toBe(turn.agentId);
    const out = f.call(inThread, { target: LOCAL });
    await f.coordinator.idle();
    expect(f.task(out.taskId).sourceThreadId).toBe(root);
    expect(f.store.get("messages", `task:${out.taskId}`)?.threadId).toBe(root);
    expect(f.rows(out.taskId)[0].threadId).toBe(root);
  });
});

describe("task thread and receipts", () => {
  it("puts the result in the task thread and one receipt row per outcome", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL, title: "Fix flaky test" });
    await f.coordinator.idle();
    f.execution.say(taskId, "Fixed it by waiting for the server", "m1");
    f.execution.finish(taskId);
    for (let i = 0; i < 3; i++) {
      f.coordinator.onTurnEnded({ agent: { id: taskId }, outcome: { kind: "completed" } });
      await f.coordinator.sweep();
    }
    await f.coordinator.idle();
    expect(f.task(taskId).status).toBe("completed");
    expect(f.store.get("messages", `result:${taskId}`)).toMatchObject({
      threadId: `task:${taskId}`,
      senderId: f.ada.id,
      content: "Fixed it by waiting for the server",
      kind: "final",
    });
    // The chat root has no copy of the result.
    expect(
      f.store
        .snapshot()
        .messages.filter(
          (message) => message.threadId === null && message.id.startsWith("result:"),
        ),
    ).toHaveLength(0);
    expect(f.types(taskId)).toEqual(["task_started", "task_completed"]);
    expect(f.rows(taskId)[1]).toMatchObject({
      threadId: null,
      senderId: "system",
      content: '"Fix flaky test" completed.',
      event: {
        type: "task_completed",
        taskId,
        detail: "Fixed it by waiting for the server",
        notifyAssistantId: f.ada.id,
      },
    });
    expect(f.rows(taskId)[0].seq!).toBeLessThan(f.rows(taskId)[1].seq!);
  });

  it("enqueues one receipt turn that tells the assistant the outcome after its reply ends", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL, title: "Fix flaky test" });
    await f.coordinator.idle();
    await f.finishTask(taskId, "All 12 tests pass now");
    await f.finishTask(taskId, "All 12 tests pass now");
    expect(f.receipts()).toHaveLength(1);
    expect(f.receipts()[0]).toMatchObject({
      id: `receipt:${taskId}`,
      kind: "task_receipt",
      assistantId: f.ada.id,
      conversationId: f.dm.id,
      threadId: null,
      status: "queued",
    });
    // The reply that started the task is still running; the receipt waits behind it.
    expect(f.execution.sent.some((item) => item.messageId === `receipt:${taskId}`)).toBe(false);
    await f.endReply(turn, "I started a task for it.");
    const sent = f.execution.sent.find((item) => item.messageId === `receipt:${taskId}`)!;
    expect(sent.agentId).toBe(turn.agentId);
    expect(sent.text).toContain(TASK_RECEIPT_LEAD);
    expect(sent.text).toContain('"Fix flaky test" completed.');
    expect(sent.text).toContain("All 12 tests pass now");
    // The task's own root message is already in the assistant's history and is not repeated.
    expect(sent.text).not.toContain("Fix the flaky test in app");
    f.execution.say(turn.agentId, "The flaky test is fixed.", "m-receipt");
    f.execution.finish(turn.agentId);
    f.coordinator.onTurnEnded({ agent: { id: turn.agentId }, outcome: { kind: "completed" } });
    await f.coordinator.idle();
    expect(f.replies().map((message) => message.content)).toEqual([
      "I started a task for it.",
      "The flaky test is fixed.",
    ]);
    expect(f.receipts()).toHaveLength(1);
    expect(f.store.get("turns", `receipt:${taskId}`)?.status).toBe("completed");
  });

  it("lets the assistant answer a receipt with (pass)", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    await f.endReply(turn, "On it");
    await f.finishTask(taskId, "Done");
    const receipt = f.receipts()[0];
    expect(f.execution.sent.some((item) => item.messageId === receipt.id)).toBe(true);
    await f.endReply(receipt, "(pass)");
    expect(f.store.get("turns", receipt.id)).toMatchObject({ status: "completed" });
    expect(f.replies().map((message) => message.content)).toEqual(["On it"]);
  });

  it("does not drop a queued receipt when the user writes meanwhile", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    await f.finishTask(taskId, "Done");
    await f.say("And one more thing", { conversationId: f.dm.id });
    expect(f.store.get("turns", `receipt:${taskId}`)?.status).not.toBe("cancelled");
  });

  it("reports a failure and a cancellation as receipts too", async () => {
    const f = setup();
    const turn = await f.reply();
    const failing = f.call(turn, { target: LOCAL, prompt: "Failing job" });
    const stopped = f.call(turn, { target: LOCAL, prompt: "Stopped job" });
    await f.coordinator.idle();
    f.execution.finish(failing.taskId);
    f.coordinator.onTurnEnded({
      agent: { id: failing.taskId },
      outcome: { kind: "failed", error: { message: "tests crashed" } },
    });
    await f.coordinator.cancel(stopped.taskId);
    await f.coordinator.idle();
    expect(f.rows(failing.taskId).at(-1)).toMatchObject({
      event: { type: "task_failed", detail: "tests crashed" },
    });
    expect(f.rows(stopped.taskId).at(-1)?.event?.type).toBe("task_cancelled");
    expect(
      f
        .receipts()
        .map((item) => item.id)
        .toSorted(),
    ).toEqual([`receipt:${failing.taskId}`, `receipt:${stopped.taskId}`].toSorted());
    // Cancelling again adds nothing.
    await f.coordinator.cancel(stopped.taskId);
    expect(f.types(stopped.taskId).filter((type) => type === "task_cancelled")).toHaveLength(1);
  });

  it("posts rows but no receipt for a task the user started", async () => {
    const f = setup();
    const task = f.coordinator.task({
      id: randomUUID(),
      conversationId: f.dm.id,
      assistantId: f.ada.id,
      prompt: "Run checks",
      serverId: "local",
      directory: "/work/app",
      provider: f.ada.provider,
      isolation: "directory",
    });
    await f.coordinator.idle();
    await f.finishTask(task.id, "Checks passed");
    expect(f.types(task.id)).toEqual(["task_started", "task_completed"]);
    expect(f.rows(task.id)[1].event?.notifyAssistantId).toBeUndefined();
    expect(f.receipts()).toHaveLength(0);
    expect(f.store.get("messages", `result:${task.id}`)?.threadId).toBe(`task:${task.id}`);
  });

  it("shows only the notified assistant its own outcome", async () => {
    const f = setup();
    const group = f.group({ members: [f.ada.id, f.bob.id] });
    const turn = await f.reply("@Ada can you look at it?", group.id);
    const { taskId } = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    await f.endReply(turn, "On it");
    await f.finishTask(taskId, "Finished");
    const receipt = f.receipts()[0];
    expect(receipt.conversationId).toBe(group.id);
    expect(f.execution.sent.find((item) => item.messageId === receipt.id)?.text).toContain(
      "Finished",
    );
    expect(f.store.snapshot().turns.filter((item) => item.assistantId === f.bob.id)).toHaveLength(
      0,
    );
  });

  it("continues the same executor from the thread and reopens the task with a fresh budget", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    await f.finishTask(taskId, "First pass done");
    const before = f.task(taskId);
    f.store.transaction(() => f.store.put("tasks", { ...before, deadline: Date.now() + 1000 }));
    f.coordinator.send({
      id: randomUUID(),
      conversationId: f.dm.id,
      threadId: `task:${taskId}`,
      content: "Also cover the retry path",
    });
    await f.coordinator.idle();
    const reopened = f.task(taskId);
    expect(reopened.status).toBe("running");
    expect(reopened.deadline).toBeGreaterThan(Date.now() + 29 * 60_000);
    const followup = f.execution.sent.findLast((item) => item.agentId === taskId)!;
    expect(followup.text).toContain("Also cover the retry path");
    // The same executor: no second task agent exists.
    expect(f.store.snapshot().tasks).toHaveLength(1);
    f.execution.say(taskId, "Retry path covered", "m2");
    f.execution.finish(taskId);
    f.coordinator.onTurnEnded({ agent: { id: taskId }, outcome: { kind: "completed" } });
    await f.coordinator.idle();
    expect(
      f.store
        .snapshot()
        .messages.filter((item) => item.threadId === `task:${taskId}`)
        .map((item) => item.content),
    ).toEqual(["First pass done", "Also cover the retry path", "Retry path covered"]);
    // A second completion is a second row, and the assistant is not asked to report it again.
    expect(f.types(taskId)).toEqual(["task_started", "task_completed", "task_completed"]);
    expect(f.receipts()).toHaveLength(1);
  });
});

describe("limits and queueing", () => {
  it("queues past the parallel limit, says so once and starts the task when a slot frees", async () => {
    const f = setup();
    const turn = await f.reply();
    const tasks = ["one", "two", "three"].map((name) =>
      f.call(turn, { target: LOCAL, prompt: `Job ${name}` }),
    );
    await f.coordinator.idle();
    expect(tasks.map((task) => task.message.split(":")[0].split(".")[0])).toEqual([
      "Started",
      "Started",
      "Queued",
    ]);
    expect(tasks.map((task) => f.task(task.taskId).status)).toEqual([
      "running",
      "running",
      "queued",
    ]);
    expect(f.types(tasks[2].taskId)).toEqual(["task_queued"]);
    expect(f.rows(tasks[2].taskId)[0].content).toContain("2 of 2 task slots are busy");
    await f.coordinator.sweep();
    expect(f.types(tasks[2].taskId)).toEqual(["task_queued"]);
    await f.finishTask(tasks[0].taskId);
    expect(f.task(tasks[2].taskId)).toMatchObject({ status: "running", accepted: true });
    expect(f.types(tasks[2].taskId)).toEqual(["task_queued", "task_started"]);
    expect(f.rows(tasks[2].taskId).map((row) => row.seq!)).toEqual(
      f
        .rows(tasks[2].taskId)
        .map((row) => row.seq!)
        .toSorted((a, b) => a - b),
    );
  });

  it("follows a raised limit from the settings", async () => {
    const f = setup();
    const turn = await f.reply();
    const tasks = [1, 2, 3].map((n) => f.call(turn, { target: LOCAL, prompt: `Job ${n}` }));
    await f.coordinator.idle();
    expect(f.task(tasks[2].taskId).status).toBe("queued");
    f.coordinator.setLimits({ ...DEFAULT_TASK_LIMITS, maxParallelTasks: 3 });
    await f.coordinator.idle();
    expect(f.task(tasks[2].taskId).status).toBe("running");
  });

  it("stops a task that ran out of budget and continues it on a reply", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL, title: "Long job" });
    await f.coordinator.idle();
    f.store.transaction(() =>
      f.store.put("tasks", { ...f.task(taskId), deadline: Date.now() - 1 }),
    );
    await f.coordinator.sweep();
    expect(f.task(taskId)).toMatchObject({
      status: "cancelled",
      stopReason: "budget",
      cancelPending: false,
    });
    expect(f.execution.cancelled).toEqual([taskId]);
    expect(f.rows(taskId).at(-1)).toMatchObject({
      event: { type: "task_budget" },
      content: expect.stringContaining("Reply in the task thread to continue"),
    });
    // Running out of budget is not an outcome the assistant reports.
    expect(f.receipts()).toHaveLength(0);
    await f.coordinator.sweep();
    expect(f.types(taskId).filter((type) => type === "task_budget")).toHaveLength(1);

    f.coordinator.send({
      id: randomUUID(),
      conversationId: f.dm.id,
      threadId: `task:${taskId}`,
      content: "Keep going",
    });
    await f.coordinator.idle();
    expect(f.task(taskId)).toMatchObject({ status: "running", error: null });
    expect(f.task(taskId).stopReason).toBeUndefined();
    expect(f.task(taskId).deadline).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(f.execution.sent.findLast((item) => item.agentId === taskId)?.text).toContain(
      "Keep going",
    );
    await f.finishTask(taskId, "Finished after the reply");
    expect(f.task(taskId).status).toBe("completed");
    // The first outcome the assistant has not heard about.
    expect(f.receipts()).toHaveLength(1);
  });

  it("keeps a task the user cancelled closed", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    await f.coordinator.cancel(taskId);
    expect(() =>
      f.coordinator.send({
        id: randomUUID(),
        conversationId: f.dm.id,
        threadId: `task:${taskId}`,
        content: "Please continue",
      }),
    ).toThrow("cannot accept a follow-up");
  });

  it("uses the configured budget", async () => {
    const f = setup({ limits: { ...DEFAULT_TASK_LIMITS, autonomousBudgetMinutes: 5 } });
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL });
    expect(f.task(taskId).deadline - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    expect(f.task(taskId).deadline - Date.now()).toBeGreaterThan(4 * 60_000);
  });

  it("stops work agents beyond the per-task limit, newest first, and says so once", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    const child = (id: string, createdAt: string, active = true) => ({ id, createdAt, active });
    f.execution.children.set(taskId, [
      child("w1", "2026-01-01T00:00:01Z"),
      child("w2", "2026-01-01T00:00:02Z"),
      child("w3", "2026-01-01T00:00:03Z"),
      child("w4", "2026-01-01T00:00:04Z"),
      child("w5", "2026-01-01T00:00:05Z"),
      child("done", "2026-01-01T00:00:00Z", false),
    ]);
    await f.coordinator.sweep();
    await f.coordinator.sweep();
    expect(f.execution.cancelled.filter((id) => id.startsWith("w"))).toEqual([
      "w4",
      "w5",
      "w4",
      "w5",
    ]);
    expect(f.types(taskId).filter((type) => type === "task_workers_capped")).toHaveLength(2);
  });
});

describe("approvals", () => {
  it("posts an approval row and answers it through the RPC", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: REMOTE });
    await f.coordinator.idle();
    f.execution.askPermission(taskId, { requestId: "r1", title: "Run npm test" });
    f.execution.emit(taskId);
    await f.coordinator.idle();
    expect(f.task(taskId)).toMatchObject({
      status: "attention",
      pendingPermission: { requestId: "r1", title: "Run npm test" },
    });
    const row = f.rows(taskId).find((item) => item.event?.type === "task_attention")!;
    expect(row).toMatchObject({
      id: expect.stringContaining("attention:r1"),
      event: { requestId: "r1", detail: "Run npm test" },
    });
    expect(row.content).toContain("Run npm test");
    f.execution.emit(taskId);
    await f.coordinator.idle();
    expect(f.rows(taskId).filter((item) => item.event?.type === "task_attention")).toHaveLength(1);

    await expect(
      f.coordinator.respondPermission({ taskId, requestId: "old", behavior: "allow" }),
    ).rejects.toThrow("no longer pending");
    await expect(
      f.coordinator.respondPermission({ taskId: "missing", requestId: "r1", behavior: "allow" }),
    ).rejects.toThrow("no longer exists");
    expect(f.execution.permissionResponses).toHaveLength(0);

    await f.coordinator.respondPermission({ taskId, requestId: "r1", behavior: "allow" });
    await f.coordinator.respondPermission({
      taskId,
      requestId: "r1",
      behavior: "deny",
      message: "Not now",
    });
    expect(f.execution.permissionResponses).toEqual([
      { agentId: taskId, requestId: "r1", serverId: "remote", response: { behavior: "allow" } },
      {
        agentId: taskId,
        requestId: "r1",
        serverId: "remote",
        response: { behavior: "deny", message: "Not now" },
      },
    ]);
  });

  it("refuses an approval for a task that is not waiting", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL });
    await f.coordinator.idle();
    await expect(
      f.coordinator.respondPermission({ taskId, requestId: "r1", behavior: "allow" }),
    ).rejects.toThrow("no longer pending");
    await f.finishTask(taskId);
    await expect(
      f.coordinator.respondPermission({ taskId, requestId: "r1", behavior: "allow" }),
    ).rejects.toThrow("not waiting for an approval");
  });
});

describe("task status", () => {
  it("reports this assistant's tasks, results and authorized targets", async () => {
    const f = setup();
    const turn = await f.reply();
    const { taskId } = f.call(turn, { target: LOCAL, title: "Fix flaky test" });
    await f.coordinator.idle();
    const caller = { caller: { agentId: turn.agentId } };
    let report = f.status({}, caller);
    expect(report.targets).toEqual([LOCAL, REMOTE]);
    expect(report.limits).toEqual(DEFAULT_TASK_LIMITS);
    expect(report.tasks).toEqual([
      expect.objectContaining({
        taskId,
        title: "Fix flaky test",
        status: "running",
        result: null,
        thread: `task:${taskId}`,
        stoppedByBudget: false,
      }),
    ]);
    await f.finishTask(taskId, "Everything passes");
    report = f.status({ taskId }, caller);
    expect(report.tasks[0]).toMatchObject({ status: "completed", result: "Everything passes" });
    expect(() => f.status({ taskId: randomUUID() }, caller)).toThrow("did not start that task");
  });

  it("does not show another chat's or a user's tasks", async () => {
    const f = setup();
    const turn = await f.reply();
    f.coordinator.task({
      id: randomUUID(),
      conversationId: f.dm.id,
      assistantId: f.ada.id,
      prompt: "User job",
      serverId: "local",
      directory: "/work/app",
      provider: f.ada.provider,
      isolation: "directory",
    });
    expect(f.status({}, { caller: { agentId: turn.agentId } }).tasks).toEqual([]);
  });
});

describe("tool callers", () => {
  it("lets every chat execution call the tools; autonomy is checked per call", async () => {
    const f = setup();
    const bobDm = f.group({ kind: "dm", name: "Bob", members: [f.bob.id] });
    await f.say("Hi Bob", { conversationId: bobDm.id });
    const bobTurn = f.store.snapshot().turns.findLast((item) => item.assistantId === f.bob.id)!;
    expect(() =>
      f.start({ prompt: "Do it" } as never, { caller: { agentId: bobTurn.agentId } }),
    ).toThrow("not allowed to start tasks on your own");
  });

  it("refuses an execution's id when another machine relays it", async () => {
    const f = setup();
    const turn = await f.reply();
    expect(() =>
      f.start({ prompt: "Do it", target: LOCAL } as never, {
        caller: { agentId: turn.agentId, serverId: "srv_spark" },
      }),
    ).toThrow("only available to a Chat assistant");
    expect(f.call(turn, { target: LOCAL }).status).toBeDefined();
  });

  it("runs a relayed call by name and validates its input", async () => {
    const f = setup();
    const turn = await f.reply();
    await expect(
      callAgentTool(f.coordinator, { agentId: turn.agentId, serverId: "srv_spark" }, "nope", {}),
    ).rejects.toThrow("Unknown Bigbang tool nope");
    await expect(
      callAgentTool(
        f.coordinator,
        { agentId: turn.agentId, serverId: "srv_spark" },
        "start_task",
        {},
      ),
    ).rejects.toThrow();
  });
});

describe("agent tool output", () => {
  it("returns the shape the tool declares", async () => {
    const f = setup();
    const turn = await f.reply();
    const out = f.call(turn, { target: LOCAL });
    expect(startTaskTool.output.safeParse(out).success).toBe(true);
    const report = f.status({}, { caller: { agentId: turn.agentId } });
    expect(taskStatusTool.output.safeParse(report).success).toBe(true);
    const task: Task = f.task(out.taskId);
    expect(task.id).toBe(out.taskId);
    const assistant: Assistant = f.ada;
    expect(assistant.autonomy?.enabled).toBe(true);
  });
});

describe("task brief", () => {
  it("keeps a worktree task inside its worktree even when the brief names the source path", () => {
    const brief = taskBrief({
      prompt: "In /work/app, create hello.py.",
      directory: "/work/app",
      isolation: "worktree",
    });
    expect(brief).toContain("never modify /work/app itself");
    expect(brief.endsWith("In /work/app, create hello.py.")).toBe(true);
    expect(taskBrief({ prompt: "Fix it.", directory: "/work/app", isolation: "directory" })).toBe(
      "Fix it.",
    );
  });
});
