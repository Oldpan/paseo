import { describe, expect, it } from "vitest";
import type { Message, Task } from "../../../../extensions/bigbang/shared/contracts";
import {
  followUpState,
  isLiveTask,
  isTaskRoot,
  pendingApproval,
  taskCardState,
  taskDetail,
  taskEventNote,
  taskIdOfThread,
  taskThreadId,
  taskTitle,
} from "./task-view";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    conversationId: "c",
    assistantId: "a",
    prompt: "Fix the build\nIt fails on CI.",
    serverId: "spark",
    directory: "/work/app",
    provider: "codex/default",
    isolation: "worktree",
    status: "running",
    execution: { serverId: "spark", workspaceId: "w", agentId: "x" },
    accepted: true,
    error: null,
    createdAt: 1,
    deadline: 2,
    ...overrides,
  };
}
function row(overrides: Partial<Message> = {}): Message {
  return {
    id: "event:t1:attention:r1",
    conversationId: "c",
    threadId: null,
    senderId: "system",
    content: 'Needs your approval: "npm test"',
    createdAt: 1,
    taskId: "t1",
    kind: "task_event",
    event: { type: "task_attention", taskId: "t1", requestId: "r1" },
    ...overrides,
  };
}

describe("task identity", () => {
  it("maps task ids to their thread and back", () => {
    expect(taskThreadId("t1")).toBe("task:t1");
    expect(taskIdOfThread("task:t1")).toBe("t1");
    expect(taskIdOfThread("some-message")).toBeNull();
    expect(taskIdOfThread(null)).toBeNull();
  });
  it("only the task:<id> message is the card's root", () => {
    expect(isTaskRoot({ id: "task:t1", taskId: "t1" })).toBe(true);
    expect(isTaskRoot({ id: "result:t1", taskId: "t1" })).toBe(false);
    expect(isTaskRoot({ id: "m", taskId: null })).toBe(false);
  });
  it("titles from the explicit title, else the first line of the prompt", () => {
    expect(taskTitle(task({ title: " Build fix " }))).toBe("Build fix");
    expect(taskTitle(task())).toBe("Fix the build");
    expect(taskTitle(task({ prompt: "x".repeat(80) }))).toHaveLength(60);
    expect(taskDetail(task({ prompt: "one line" }))).toBeNull();
    expect(taskDetail(task())).toBe("Fix the build\nIt fails on CI.");
  });
});

describe("task card state", () => {
  const base = { hostLabel: "Spark", inThread: false };
  it("describes a live user task with its target and cancel action", () => {
    const state = taskCardState({ ...base, task: task() });
    expect(state).toMatchObject({
      title: "Fix the build",
      statusLabel: "Running",
      tone: "live",
      live: true,
      origin: null,
      target: "Spark · /work/app · new worktree",
      canCancel: true,
      canOpenStudio: true,
      canOpenThread: true,
      approval: null,
      budgetStopped: false,
    });
  });
  it("badges assistant-origin tasks with the assistant name", () => {
    const state = taskCardState({
      ...base,
      task: task({ origin: "assistant" }),
      assistantName: "Ada",
    });
    expect(state.origin).toBe("Ada");
  });
  it("offers an approval only while the task is live", () => {
    const pendingPermission = { requestId: "r1", title: "Run npm test" };
    expect(
      taskCardState({ ...base, task: task({ status: "attention", pendingPermission }) }).approval,
    ).toEqual({
      requestId: "r1",
      title: "Run npm test",
    });
    expect(pendingApproval(task({ status: "completed", pendingPermission }))).toBeNull();
    expect(pendingApproval(task({ pendingPermission: null }))).toBeNull();
  });
  it("marks a budget stop and keeps the thread continuable", () => {
    const stopped = task({ status: "cancelled", stopReason: "budget" });
    const state = taskCardState({ ...base, task: stopped });
    expect(state).toMatchObject({
      budgetStopped: true,
      statusLabel: "Budget reached",
      live: false,
      canCancel: false,
    });
    expect(followUpState(stopped).allowed).toBe(true);
  });
  it("disables Studio before an execution exists and hides Open thread inside the thread", () => {
    const state = taskCardState({
      ...base,
      inThread: true,
      task: task({ status: "queued", execution: null }),
    });
    expect(state.canOpenStudio).toBe(false);
    expect(state.canOpenThread).toBe(false);
  });
  it("does not offer a second cancel while one is pending, and colours outcomes", () => {
    expect(taskCardState({ ...base, task: task({ cancelPending: true }) }).canCancel).toBe(false);
    expect(taskCardState({ ...base, task: task({ status: "completed" }) }).tone).toBe("ok");
    expect(
      taskCardState({ ...base, task: task({ status: "failed", error: "boom" }) }),
    ).toMatchObject({
      tone: "bad",
      error: "boom",
    });
    expect(isLiveTask(task({ status: "unknown" }))).toBe(true);
  });
  it("blocks follow-ups before start and after a user cancel", () => {
    expect(followUpState(task({ execution: null })).allowed).toBe(false);
    expect(followUpState(task({ status: "cancelled" })).allowed).toBe(false);
    expect(followUpState(task({ status: "completed" })).allowed).toBe(true);
  });
});

describe("task event rows", () => {
  it("gives each lifecycle event a glyph and keeps the row text", () => {
    const completed = taskEventNote(
      row({ content: '"Fix" completed.', event: { type: "task_completed", taskId: "t1" } }),
      task({ status: "completed" }),
    );
    expect(completed).toMatchObject({
      glyph: "✓",
      tone: "ok",
      text: '"Fix" completed.',
      taskId: "t1",
    });
    const failed = taskEventNote(row({ event: { type: "task_failed", taskId: "t1" } }), undefined);
    expect(failed).toMatchObject({ glyph: "✕", tone: "bad" });
  });
  it("renders event types a newer daemon adds", () => {
    expect(taskEventNote(row({ event: { type: "task_paused" } }), undefined)).toMatchObject({
      glyph: "•",
      tone: "muted",
      taskId: "t1",
    });
  });
  it("shows approval controls only while that request is the task's pending one", () => {
    const pending = task({
      status: "attention",
      pendingPermission: { requestId: "r1", title: "Run npm test" },
    });
    expect(taskEventNote(row(), pending).approval).toEqual({
      requestId: "r1",
      title: "Run npm test",
    });
    // A newer request replaced it, the task moved on, or the task is gone: plain text.
    expect(
      taskEventNote(
        row(),
        task({ status: "attention", pendingPermission: { requestId: "r2", title: "x" } }),
      ).approval,
    ).toBeNull();
    expect(
      taskEventNote(row(), task({ status: "running", pendingPermission: null })).approval,
    ).toBeNull();
    expect(
      taskEventNote(
        row(),
        task({ status: "completed", pendingPermission: { requestId: "r1", title: "x" } }),
      ).approval,
    ).toBeNull();
    expect(taskEventNote(row(), undefined).approval).toBeNull();
    expect(
      taskEventNote(
        row({ event: { type: "task_started", taskId: "t1", requestId: "r1" } }),
        pending,
      ).approval,
    ).toBeNull();
  });
});
