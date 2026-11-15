import { describe, expect, it } from "vitest";
import type {
  Assistant,
  ChatState,
  Conversation,
  Message,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import {
  collectPavraNotificationKeys,
  createPavraNotificationTracker,
  diffPavraNotifications,
} from "./notifications";

const ASSISTANT_SKY: Assistant = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sky",
  provider: "codex/gpt-5",
  persona: "Helpful assistant",
};

const ASSISTANT_MAX: Assistant = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Max",
  provider: "codex/gpt-5",
  persona: "Builder",
};

const CONV_SKY: Conversation = {
  id: "conv-sky",
  name: "Sky",
  members: [ASSISTANT_SKY.id],
  kind: "dm",
  roundtable: false,
};

const CONV_GROUP: Conversation = {
  id: "conv-group",
  name: "Core Team",
  members: [ASSISTANT_SKY.id, ASSISTANT_MAX.id],
  kind: "group",
  roundtable: true,
};

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    generation: "gen-1",
    cursor: 1,
    assistants: [ASSISTANT_SKY, ASSISTANT_MAX],
    conversations: [CONV_SKY, CONV_GROUP],
    messages: [],
    tasks: [],
    turns: [],
    studios: [],
    peerMessages: [],
    routines: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    conversationId: CONV_SKY.id,
    assistantId: ASSISTANT_SKY.id,
    prompt: "Deploy relay to Spark\nVerify TLS",
    serverId: "srv_spark",
    directory: "/repo",
    provider: "codex/gpt-5",
    isolation: "worktree",
    status: "running",
    execution: { serverId: "srv_spark", workspaceId: "ws-1", agentId: "ag-1" },
    accepted: true,
    error: null,
    createdAt: 1000,
    deadline: 2000,
    pendingPermission: null,
    ...overrides,
  };
}

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    conversationId: CONV_SKY.id,
    threadId: null,
    assistantId: ASSISTANT_SKY.id,
    prompt: "Check production logs\nAnd summarize errors",
    status: "running",
    agentId: "ag-turn-1",
    error: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    conversationId: CONV_SKY.id,
    threadId: null,
    senderId: ASSISTANT_SKY.id,
    content: "All checks passed.\nDetails follow.",
    createdAt: 1500,
    taskId: null,
    kind: "final",
    ...overrides,
  };
}

describe("pavra notifications", () => {
  it("seeds seenKeys and emits 0 notifications on cold start (prev === null)", () => {
    const initial = makeState({
      cursor: 5,
      tasks: [
        makeTask({
          id: "t-initial",
          pendingPermission: { requestId: "req-1", title: "Run shell command" },
        }),
      ],
      turns: [makeTurn({ id: "turn-initial", status: "attention" })],
      messages: [
        makeMessage({ id: "m-initial", kind: "final", content: "Old reply" }),
        makeMessage({
          id: "m-routine-initial",
          kind: "final",
          routineId: "rt-1",
          routineName: "Morning check",
          content: "Old routine",
        }),
      ],
    });

    const seenKeys = new Set<string>();
    const emitted = diffPavraNotifications(null, initial, seenKeys, {
      coordinatorId: "srv_spark",
      appActive: false,
    });

    expect(emitted).toEqual([]);
    expect(seenKeys).toEqual(
      new Set([
        "perm:t-initial:req-1",
        "turn-attn:turn-initial",
        "msg:m-initial",
        "msg:m-routine-initial",
      ]),
    );
    expect(collectPavraNotificationKeys(initial)).toEqual(seenKeys);
  });

  it("re-seeds seenKeys and emits 0 notifications when coordinator or generation changes", () => {
    const tracker = createPavraNotificationTracker({
      coordinatorId: "srv_spark",
      appActive: false,
    });

    const gen1 = makeState({
      generation: "gen-1",
      cursor: 2,
      messages: [makeMessage({ id: "m-1", content: "First gen" })],
    });
    expect(tracker.update(gen1)).toEqual([]);

    const gen2 = makeState({
      generation: "gen-2",
      cursor: 10,
      tasks: [
        makeTask({
          id: "t-gen2",
          pendingPermission: { requestId: "req-2", title: "Approve edit" },
        }),
      ],
      messages: [makeMessage({ id: "m-gen2", content: "Second gen historical reply" })],
    });
    expect(tracker.update(gen2)).toEqual([]);
    expect(tracker.seenKeys.has("perm:t-gen2:req-2")).toBe(true);
    expect(tracker.seenKeys.has("msg:m-gen2")).toBe(true);
    expect(tracker.seenKeys.has("msg:m-1")).toBe(false);

    // Switching coordinatorId with same generation also resets and seeds without emitting
    const otherCoordState = makeState({
      generation: "gen-2",
      cursor: 20,
      messages: [makeMessage({ id: "m-other-coord", content: "On Mac coordinator" })],
    });
    expect(
      tracker.update(otherCoordState, {
        coordinatorId: "srv_mac",
        appActive: false,
      }),
    ).toEqual([]);
    expect(tracker.seenKeys.has("msg:m-other-coord")).toBe(true);
  });

  it("detects new task_permission, turn_attention, task_event, routine_reply, and chat_reply on cursor advance", () => {
    const tracker = createPavraNotificationTracker({
      coordinatorId: "srv_spark",
      appActive: false,
    });

    const base = makeState({ cursor: 1 });
    expect(tracker.update(base)).toEqual([]);

    const next = makeState({
      cursor: 6,
      tasks: [
        makeTask({
          id: "task-perm",
          title: "Upgrade database",
          pendingPermission: { requestId: "req-99", title: "Execute migration.sql" },
        }),
        makeTask({
          id: "task-done",
          title: "Build APK",
          assistantId: ASSISTANT_MAX.id,
          status: "completed",
        }),
        makeTask({
          id: "task-over-budget",
          title: "Long benchmark",
          assistantId: ASSISTANT_SKY.id,
          status: "cancelled",
          stopReason: "budget",
        }),
      ],
      turns: [
        makeTurn({
          id: "turn-attn-1",
          assistantId: ASSISTANT_MAX.id,
          conversationId: CONV_GROUP.id,
          threadId: "thread-root-1",
          prompt: "Should we use port 6778?\nExtra context",
          status: "attention",
        }),
      ],
      messages: [
        makeMessage({
          id: "evt-completed",
          kind: "task_event",
          conversationId: CONV_GROUP.id,
          taskId: "task-done",
          content: "Build APK completed",
          event: {
            type: "task_completed",
            taskId: "task-done",
            detail: "APK built and verified",
          },
        }),
        makeMessage({
          id: "evt-budget",
          kind: "task_event",
          conversationId: CONV_SKY.id,
          taskId: "task-over-budget",
          content: "Task reached 30m limit",
          event: {
            type: "task_budget",
            taskId: "task-over-budget",
            detail: "30 minute autonomous budget reached",
          },
        }),
        makeMessage({
          id: "msg-routine-1",
          kind: "final",
          senderId: ASSISTANT_SKY.id,
          conversationId: CONV_SKY.id,
          threadId: null,
          routineId: "routine-daily",
          routineName: "Daily Standup",
          content: "All services on Spark are healthy.\nUptime 14d.",
        }),
        makeMessage({
          id: "msg-chat-1",
          kind: "final",
          senderId: ASSISTANT_MAX.id,
          conversationId: CONV_GROUP.id,
          threadId: "thread-42",
          content: "I pushed the fix to the branch.\nLet me know.",
        }),
      ],
    });

    const events = tracker.update(next);
    expect(events).toEqual([
      {
        key: "perm:task-perm:req-99",
        kind: "task_permission",
        title: "Approval needed · Sky",
        body: "Upgrade database — Execute migration.sql",
        target: {
          serverId: "srv_spark",
          pavraSection: "inbox",
          pavraConversationId: CONV_SKY.id,
          pavraThreadId: "task:task-perm",
        },
      },
      {
        key: "turn-attn:turn-attn-1",
        kind: "turn_attention",
        title: "Attention needed · Max",
        body: "Should we use port 6778?",
        target: {
          serverId: "srv_spark",
          pavraSection: "inbox",
          pavraConversationId: CONV_GROUP.id,
          pavraThreadId: "thread-root-1",
        },
      },
      {
        key: "msg:evt-completed",
        kind: "task_event",
        title: "Task completed · Max",
        body: "APK built and verified",
        target: {
          serverId: "srv_spark",
          pavraSection: "chat",
          pavraConversationId: CONV_GROUP.id,
          pavraThreadId: "task:task-done",
        },
      },
      {
        key: "msg:evt-budget",
        kind: "task_event",
        title: "Task paused (budget) · Sky",
        body: "30 minute autonomous budget reached",
        target: {
          serverId: "srv_spark",
          pavraSection: "inbox",
          pavraConversationId: CONV_SKY.id,
          pavraThreadId: "task:task-over-budget",
        },
      },
      {
        key: "msg:msg-routine-1",
        kind: "routine_reply",
        title: "Sky · Daily Standup",
        body: "All services on Spark are healthy.",
        target: {
          serverId: "srv_spark",
          pavraSection: "chat",
          pavraConversationId: CONV_SKY.id,
          pavraThreadId: null,
        },
      },
      {
        key: "msg:msg-chat-1",
        kind: "chat_reply",
        title: "Max · Core Team",
        body: "I pushed the fix to the branch.",
        target: {
          serverId: "srv_spark",
          pavraSection: "chat",
          pavraConversationId: CONV_GROUP.id,
          pavraThreadId: "thread-42",
        },
      },
    ]);

    // Deduplication: re-polling with the same cursor or an advancing cursor does not re-emit
    expect(tracker.update(next)).toEqual([]);
    expect(tracker.update({ ...next, cursor: 7 })).toEqual([]);
  });

  it("suppresses chat_reply, routine_reply, and non-budget task_event only when actively viewing the exact chat and thread in foreground", () => {
    const tracker = createPavraNotificationTracker();
    const base = makeState({ cursor: 1 });
    tracker.update(base, {
      coordinatorId: "srv_spark",
      appActive: true,
      activeMode: "chat",
      activeSection: "chat",
      activeChatId: CONV_SKY.id,
      activeThreadId: null,
    });

    // 1. User is actively viewing CONV_SKY main lane (threadId: null) in foreground
    const step2 = makeState({
      cursor: 2,
      tasks: [
        makeTask({
          id: "t-1",
          pendingPermission: { requestId: "r-1", title: "Allow write" },
        }),
      ],
      turns: [
        makeTurn({
          id: "turn-1",
          status: "attention",
          prompt: "Confirm deployment?",
        }),
      ],
      messages: [
        // Suppressed: viewing CONV_SKY + threadId: null
        makeMessage({
          id: "m-fg-chat",
          kind: "final",
          conversationId: CONV_SKY.id,
          threadId: null,
          content: "Foreground reply in active chat",
        }),
        // Suppressed: viewing CONV_SKY + threadId: null
        makeMessage({
          id: "m-fg-routine",
          kind: "final",
          conversationId: CONV_SKY.id,
          threadId: null,
          routineId: "rt-1",
          routineName: "Check",
          content: "Foreground routine reply in active chat",
        }),
        // Emitted: same chat, but in a sub-thread (threadId: "sub-1" !== null)
        makeMessage({
          id: "m-other-thread",
          kind: "final",
          conversationId: CONV_SKY.id,
          threadId: "sub-1",
          content: "Reply in sub-thread",
        }),
        // Emitted: different chat (CONV_GROUP)
        makeMessage({
          id: "m-other-chat",
          kind: "final",
          senderId: ASSISTANT_MAX.id,
          conversationId: CONV_GROUP.id,
          threadId: null,
          content: "Reply in group chat",
        }),
        // Emitted even when viewing task thread if it's task_budget
        makeMessage({
          id: "m-budget-fg",
          kind: "task_event",
          conversationId: CONV_SKY.id,
          taskId: "t-1",
          content: "Budget reached",
          event: { type: "task_budget", taskId: "t-1", detail: "Budget limit hit" },
        }),
      ],
    });

    const fgEvents = tracker.update(step2, {
      coordinatorId: "srv_spark",
      appActive: true,
      activeMode: "chat",
      activeSection: "chat",
      activeChatId: CONV_SKY.id,
      activeThreadId: null,
    });

    expect(fgEvents.map((e) => e.key)).toEqual([
      "perm:t-1:r-1",
      "turn-attn:turn-1",
      "msg:m-other-thread",
      "msg:m-other-chat",
      "msg:m-budget-fg",
    ]);

    // 2. If user later backgrounds the app, previously suppressed messages are NOT re-emitted
    const step3 = makeState({
      ...step2,
      cursor: 3,
      messages: [
        ...step2.messages,
        makeMessage({
          id: "m-bg-chat",
          kind: "final",
          conversationId: CONV_SKY.id,
          threadId: null,
          content: "Reply while app is in background",
        }),
      ],
    });

    const bgEvents = tracker.update(step3, {
      coordinatorId: "srv_spark",
      appActive: false,
      activeMode: "chat",
      activeSection: "chat",
      activeChatId: CONV_SKY.id,
      activeThreadId: null,
    });

    expect(bgEvents).toEqual([
      {
        key: "msg:m-bg-chat",
        kind: "chat_reply",
        title: "Sky · Sky",
        body: "Reply while app is in background",
        target: {
          serverId: "srv_spark",
          pavraSection: "chat",
          pavraConversationId: CONV_SKY.id,
          pavraThreadId: null,
        },
      },
    ]);
  });

  it("suppresses non-budget task_event when actively viewing the task thread in foreground, but notifies for task_budget", () => {
    const tracker = createPavraNotificationTracker();
    const base = makeState({
      cursor: 1,
      tasks: [makeTask({ id: "t-9", assistantId: ASSISTANT_SKY.id })],
    });
    tracker.update(base, {
      coordinatorId: "srv_spark",
      appActive: true,
      activeMode: "chat",
      activeSection: "chat",
      activeChatId: CONV_SKY.id,
      activeThreadId: "task:t-9",
    });

    const step2 = makeState({
      cursor: 2,
      tasks: base.tasks,
      messages: [
        makeMessage({
          id: "evt-done-active-thread",
          kind: "task_event",
          conversationId: CONV_SKY.id,
          taskId: "t-9",
          content: "Completed",
          event: { type: "task_completed", taskId: "t-9", detail: "Done" },
        }),
        makeMessage({
          id: "evt-budget-active-thread",
          kind: "task_event",
          conversationId: CONV_SKY.id,
          taskId: "t-9",
          content: "Paused on budget",
          event: { type: "task_budget", taskId: "t-9", detail: "Paused on budget" },
        }),
      ],
    });

    const events = tracker.update(step2, {
      coordinatorId: "srv_spark",
      appActive: true,
      activeMode: "chat",
      activeSection: "chat",
      activeChatId: CONV_SKY.id,
      activeThreadId: "task:t-9",
    });

    expect(events).toEqual([
      {
        key: "msg:evt-budget-active-thread",
        kind: "task_event",
        title: "Task paused (budget) · Sky",
        body: "Paused on budget",
        target: {
          serverId: "srv_spark",
          pavraSection: "inbox",
          pavraConversationId: CONV_SKY.id,
          pavraThreadId: "task:t-9",
        },
      },
    ]);
  });
});
