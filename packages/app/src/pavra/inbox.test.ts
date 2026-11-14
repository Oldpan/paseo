import { describe, expect, it } from "vitest";
import type {
  Assistant,
  ChatState,
  Conversation,
  Message,
  Routine,
  RoutineRun,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { deriveInboxState } from "./inbox";

const SKY: Assistant = {
  id: "3a60bb8e-3065-44f1-81ec-d3ce929fded2",
  name: "Sky",
  provider: "grok/grok-4.7",
  persona: "",
};

const MAX: Assistant = {
  id: "6e8ca543-8e2c-41e0-91dd-587d52dce8ed",
  name: "Max",
  provider: "codex/gpt-6-luna",
  persona: "",
  serverId: "srv_khQ9DQI8Ym0h",
};

const CONVERSATIONS: Conversation[] = [
  {
    id: "conv-sky",
    name: "Sky",
    kind: "dm",
    members: [SKY.id],
    roundtable: false,
  },
  {
    id: "conv-general",
    name: "General",
    kind: "group",
    members: [SKY.id, MAX.id],
    roundtable: true,
  },
];

function baseState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    generation: "gen-1",
    cursor: 10,
    assistants: [SKY, MAX],
    conversations: CONVERSATIONS,
    messages: [],
    tasks: [],
    turns: [],
    routines: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    conversationId: "conv-sky",
    assistantId: SKY.id,
    prompt: "Audit repository dependencies\nCheck security advisories",
    serverId: "srv_tGAs1l4XHjbH",
    directory: "/ai/code/paseo-bigbang",
    provider: "grok/grok-4.7",
    isolation: "worktree",
    status: "running",
    execution: {
      serverId: "srv_tGAs1l4XHjbH",
      workspaceId: "ws-1",
      agentId: "ag-1",
    },
    accepted: true,
    error: null,
    createdAt: 1_000,
    deadline: 2_000,
    ...overrides,
  };
}

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    conversationId: "conv-general",
    threadId: null,
    assistantId: MAX.id,
    prompt: "Run deployment dry-run\nWith verbose output",
    status: "running",
    agentId: "ag-turn-1",
    error: null,
    ...overrides,
  };
}

function makeRoutineRun(overrides: Partial<RoutineRun> = {}): RoutineRun {
  return {
    id: "run-1",
    scheduledFor: 1_000,
    startedAt: 1_000,
    endedAt: 1_500,
    status: "succeeded",
    outcome: "passed",
    turnId: "turn-r1",
    summary: "Silent ((pass))",
    error: null,
    ...overrides,
  };
}

function makeRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "routine-1",
    name: "Morning workspace check",
    prompt: "Check git status and disk usage",
    assistantId: SKY.id,
    conversationId: "conv-sky",
    threadId: null,
    cadence: { type: "every", everyMs: 3_600_000 },
    status: "active",
    maxRuns: null,
    expiresAt: null,
    createdAt: 500,
    updatedAt: 500,
    nextRunAt: 5_000,
    lastRunAt: 1_500,
    pausedAt: null,
    runs: [],
    ...overrides,
  };
}

describe("deriveInboxState", () => {
  it("collects task permissions, attention turns, and budget-stopped tasks sorted by createdAt descending", () => {
    const permTask = makeTask({
      id: "task-perm-1",
      createdAt: 2_000,
      status: "attention",
      pendingPermission: {
        requestId: "req-42",
        title: "Allow running npm publish",
      },
    });
    const budgetTask = makeTask({
      id: "task-budget-1",
      assistantId: MAX.id,
      conversationId: "conv-general",
      title: "Refactor auth flow",
      createdAt: 1_000,
      deadline: 4_000,
      status: "cancelled",
      stopReason: "budget",
    });
    const triggerMessage: Message = {
      id: "msg-trigger-1",
      conversationId: "conv-general",
      threadId: "thread-9",
      senderId: "user",
      content: "Approve MCP send",
      createdAt: 3_000,
      taskId: null,
      kind: "user",
    };
    const attnTurn = makeTurn({
      id: "turn-attn-1",
      conversationId: "conv-general",
      threadId: "thread-9",
      assistantId: MAX.id,
      triggerId: triggerMessage.id,
      prompt: "Approve MCP send\nSecond line",
      status: "attention",
    });

    const inbox = deriveInboxState(
      baseState({
        tasks: [permTask, budgetTask],
        messages: [triggerMessage],
        turns: [attnTurn],
      }),
      10_000,
    );

    expect(inbox.needsAction.map((item) => item.id)).toEqual([
      "task-budget:task-budget-1",
      "turn-attn:turn-attn-1",
      "task-perm:task-perm-1:req-42",
    ]);

    expect(inbox.needsAction[0]).toMatchObject({
      id: "task-budget:task-budget-1",
      kind: "task_budget",
      taskId: "task-budget-1",
      title: "Refactor auth flow",
      conversationId: "conv-general",
      conversationName: "General",
      threadId: "task:task-budget-1",
      assistantId: MAX.id,
      assistantName: "Max",
      createdAt: 4_000,
    });

    expect(inbox.needsAction[1]).toMatchObject({
      id: "turn-attn:turn-attn-1",
      kind: "turn_attention",
      turnId: "turn-attn-1",
      title: "Approve MCP send",
      conversationId: "conv-general",
      conversationName: "General",
      threadId: "thread-9",
      assistantId: MAX.id,
      assistantName: "Max",
      createdAt: 3_000,
    });

    expect(inbox.needsAction[2]).toMatchObject({
      id: "task-perm:task-perm-1:req-42",
      kind: "task_permission",
      taskId: "task-perm-1",
      requestId: "req-42",
      permissionTitle: "Allow running npm publish",
      title: "Audit repository dependencies",
      conversationId: "conv-sky",
      conversationName: "Sky",
      threadId: "task:task-perm-1",
      assistantId: SKY.id,
      assistantName: "Sky",
      createdAt: 2_000,
    });
  });

  it("immediately removes items once permissions are answered, budget tasks resume, or turns leave attention", () => {
    const resolvedPermTask = makeTask({
      id: "task-perm-1",
      status: "running",
      pendingPermission: null,
    });
    const resumedBudgetTask = makeTask({
      id: "task-budget-1",
      status: "running",
      stopReason: undefined,
    });
    const cancelledTurn = makeTurn({
      id: "turn-attn-1",
      status: "cancelled",
    });

    const inbox = deriveInboxState(
      baseState({
        tasks: [resolvedPermTask, resumedBudgetTask],
        turns: [cancelledTurn],
      }),
      2_000,
    );

    expect(inbox.needsAction).toEqual([]);
  });

  it("merges finished routine runs and task lifecycle receipts in descending timestamp order", () => {
    const routine = makeRoutine({
      id: "routine-daily",
      name: "Daily check",
      runs: [
        makeRoutineRun({
          id: "run-running",
          startedAt: 9_000,
          endedAt: null,
          status: "running",
          outcome: null,
        }),
        makeRoutineRun({
          id: "run-pass",
          startedAt: 1_000,
          endedAt: 1_200,
          status: "succeeded",
          outcome: "passed",
          summary: "Silent ((pass))",
        }),
        makeRoutineRun({
          id: "run-reply",
          startedAt: 3_000,
          endedAt: 3_500,
          status: "succeeded",
          outcome: "replied",
          summary: "2 outdated packages found",
        }),
      ],
    });
    const reminder = makeRoutine({
      id: "routine-reminder",
      name: "Ping release",
      assistantId: MAX.id,
      conversationId: "conv-general",
      maxRuns: 1,
      status: "completed",
      nextRunAt: null,
      runs: [
        makeRoutineRun({
          id: "run-skip",
          startedAt: 2_000,
          endedAt: 2_100,
          status: "succeeded",
          outcome: "skipped",
          summary: "Skipped: host_offline",
        }),
        makeRoutineRun({
          id: "run-fail",
          startedAt: 4_000,
          endedAt: 4_200,
          status: "failed",
          outcome: "failed",
          summary: null,
          error: "Execution interrupted",
        }),
      ],
    });
    const task = makeTask({
      id: "task-99",
      title: "Build ARM64 APK",
      assistantId: MAX.id,
      conversationId: "conv-general",
      status: "completed",
    });
    const receiptCompleted: Message = {
      id: "msg-ev-completed",
      conversationId: "conv-general",
      threadId: null,
      senderId: "system",
      content: "Task completed: Build ARM64 APK",
      createdAt: 3_800,
      taskId: task.id,
      kind: "task_event",
      event: {
        type: "task_completed",
        taskId: task.id,
        detail: "APK written to artifacts/paseo-dogfood-arm64.apk",
      },
    };
    const ignoredStartedEvent: Message = {
      id: "msg-ev-started",
      conversationId: "conv-general",
      threadId: null,
      senderId: "system",
      content: "Task started",
      createdAt: 5_000,
      taskId: task.id,
      kind: "task_event",
      event: {
        type: "task_started",
        taskId: task.id,
      },
    };

    const inbox = deriveInboxState(
      baseState({
        routines: [routine, reminder],
        tasks: [task],
        messages: [receiptCompleted, ignoredStartedEvent],
      }),
      6_000,
    );

    expect(inbox.recentActivity.map((item) => item.id)).toEqual([
      "routine-run:routine-reminder:run-fail",
      "task-event:msg-ev-completed",
      "routine-run:routine-daily:run-reply",
      "routine-run:routine-reminder:run-skip",
      "routine-run:routine-daily:run-pass",
    ]);

    expect(inbox.recentActivity[0]).toMatchObject({
      kind: "routine_run",
      routineId: "routine-reminder",
      routineName: "Ping release",
      isReminder: true,
      outcome: "failed",
      summary: "Execution interrupted",
      timestamp: 4_200,
      assistantName: "Max",
      conversationName: "General",
    });

    expect(inbox.recentActivity[1]).toMatchObject({
      kind: "task_receipt",
      taskId: "task-99",
      eventType: "task_completed",
      title: "Build ARM64 APK",
      summary: "APK written to artifacts/paseo-dogfood-arm64.apk",
      timestamp: 3_800,
      assistantId: MAX.id,
      assistantName: "Max",
      conversationId: "conv-general",
      conversationName: "General",
      threadId: "task:task-99",
    });
  });

  it("lists only active routines with non-null nextRunAt sorted ascending", () => {
    const laterRoutine = makeRoutine({
      id: "r-later",
      name: "Evening digest",
      nextRunAt: 9_000,
      cadence: { type: "cron", expression: "0 18 * * *", timezone: "Asia/Shanghai" },
    });
    const soonerReminder = makeRoutine({
      id: "r-sooner",
      name: "Call back in 15m",
      assistantId: MAX.id,
      conversationId: "conv-general",
      maxRuns: 1,
      nextRunAt: 3_000,
      cadence: { type: "every", everyMs: 900_000 },
    });
    const pausedRoutine = makeRoutine({
      id: "r-paused",
      status: "paused",
      nextRunAt: 2_000,
    });
    const completedReminder = makeRoutine({
      id: "r-completed",
      status: "completed",
      nextRunAt: null,
    });

    const inbox = deriveInboxState(
      baseState({
        routines: [laterRoutine, pausedRoutine, soonerReminder, completedReminder],
      }),
      1_000,
    );

    expect(inbox.upcoming.map((item) => item.routineId)).toEqual(["r-sooner", "r-later"]);
    expect(inbox.upcoming[0]).toMatchObject({
      id: "upcoming:r-sooner",
      routineId: "r-sooner",
      routineName: "Call back in 15m",
      isReminder: true,
      cadenceLabel: "Every 15m",
      nextRunAt: 3_000,
      assistantName: "Max",
      conversationName: "General",
    });
    expect(inbox.upcoming[1]).toMatchObject({
      id: "upcoming:r-later",
      routineId: "r-later",
      routineName: "Evening digest",
      isReminder: false,
      cadenceLabel: "Cron 0 18 * * * (Asia/Shanghai)",
      nextRunAt: 9_000,
      assistantName: "Sky",
      conversationName: "Sky",
    });
  });

  it("scans stale/failed tasks, failed latest turns, paused routines, and failing routines without model calls", () => {
    const now = 10 * 60 * 60 * 1000;
    const staleRunningTask = makeTask({
      id: "task-stale",
      title: "Long migration",
      status: "running",
      createdAt: now - 3 * 60 * 60 * 1000,
    });
    const freshRunningTask = makeTask({
      id: "task-fresh",
      title: "Recent job",
      status: "running",
      createdAt: now - 15 * 60 * 1000,
    });
    const unfollowedFailedTask = makeTask({
      id: "task-failed-unfollowed",
      title: "Broken build",
      status: "failed",
      error: "Exit code 1",
      createdAt: 2_000,
    });
    const followedUpFailedTask = makeTask({
      id: "task-failed-followed",
      title: "Retried build",
      status: "failed",
      createdAt: 2_000,
    });
    const followUpUserMsg: Message = {
      id: "msg-task-followup",
      conversationId: "conv-sky",
      threadId: "task:task-failed-followed",
      senderId: "user",
      content: "Please retry with clean cache",
      createdAt: 3_000,
      taskId: "task-failed-followed",
      kind: "user",
    };

    const triggerMsg1: Message = {
      id: "msg-u1",
      conversationId: "conv-sky",
      threadId: null,
      senderId: "user",
      content: "Summarize logs",
      createdAt: 4_000,
      taskId: null,
      kind: "user",
    };
    const failedLatestTurn = makeTurn({
      id: "turn-failed-latest",
      conversationId: "conv-sky",
      threadId: null,
      assistantId: SKY.id,
      triggerId: triggerMsg1.id,
      prompt: "Summarize logs",
      status: "failed",
      error: "Interrupted",
    });

    const triggerMsg2: Message = {
      id: "msg-u2",
      conversationId: "conv-general",
      threadId: null,
      senderId: "user",
      content: "First try",
      createdAt: 4_000,
      taskId: null,
      kind: "user",
    };
    const newerUserMsgInGeneral: Message = {
      id: "msg-u3",
      conversationId: "conv-general",
      threadId: null,
      senderId: "user",
      content: "Second try after failure",
      createdAt: 5_000,
      taskId: null,
      kind: "user",
    };
    const supersededFailedTurn = makeTurn({
      id: "turn-failed-superseded",
      conversationId: "conv-general",
      threadId: null,
      assistantId: MAX.id,
      triggerId: triggerMsg2.id,
      prompt: "First try",
      status: "failed",
      error: "Timeout",
    });

    const pausedRoutine = makeRoutine({
      id: "routine-paused",
      name: "Weekly cleanup",
      status: "paused",
      pausedAt: 6_000,
      nextRunAt: null,
    });
    const failingRoutine = makeRoutine({
      id: "routine-failing",
      name: "Nightly backup check",
      status: "active",
      runs: [
        makeRoutineRun({
          id: "run-ok",
          startedAt: 1_000,
          endedAt: 1_100,
          status: "succeeded",
          outcome: "passed",
        }),
        makeRoutineRun({
          id: "run-bad",
          startedAt: 7_000,
          endedAt: 7_200,
          status: "failed",
          outcome: "failed",
          error: "SSH timeout",
        }),
      ],
    });

    const inbox = deriveInboxState(
      baseState({
        tasks: [staleRunningTask, freshRunningTask, unfollowedFailedTask, followedUpFailedTask],
        messages: [followUpUserMsg, triggerMsg1, triggerMsg2, newerUserMsgInGeneral],
        turns: [failedLatestTurn, supersededFailedTurn],
        routines: [pausedRoutine, failingRoutine],
      }),
      now,
    );

    expect(inbox.suggestions.map((item) => item.id)).toEqual([
      "suggestion:stale-task:task-stale",
      "suggestion:stale-task:task-failed-unfollowed",
      "suggestion:failed-turn:turn-failed-latest",
      "suggestion:paused-routine:routine-paused",
      "suggestion:failing-routine:routine-failing",
    ]);

    expect(inbox.suggestions[0]).toMatchObject({
      kind: "stale_task",
      taskId: "task-stale",
      isLive: true,
      title: "Long migration",
    });
    expect(inbox.suggestions[1]).toMatchObject({
      kind: "stale_task",
      taskId: "task-failed-unfollowed",
      isLive: false,
      title: "Broken build",
    });
    expect(inbox.suggestions[2]).toMatchObject({
      kind: "failed_turn",
      turnId: "turn-failed-latest",
      title: "Summarize logs",
    });
    expect(inbox.suggestions[3]).toMatchObject({
      kind: "paused_routine",
      routineId: "routine-paused",
      routineName: "Weekly cleanup",
    });
    expect(inbox.suggestions[4]).toMatchObject({
      kind: "failing_routine",
      routineId: "routine-failing",
      routineName: "Nightly backup check",
    });
  });
});
