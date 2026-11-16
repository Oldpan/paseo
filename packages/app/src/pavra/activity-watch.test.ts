import { describe, expect, it } from "vitest";
import type {
  Assistant,
  Conversation,
  Message,
  PeerMessage,
  Takeover,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import {
  buildGlobalActivitySnapshot,
  filterActivityWatchItems,
  formatActivityElapsed,
} from "./activity-watch";

const SKY: Assistant = {
  id: "3a60bb8e-3065-44f1-81ec-d3ce929fded2",
  name: "Sky",
  provider: "grok/grok-4.7",
  persona: "",
  serverId: "srv-mac",
};

const MAX: Assistant = {
  id: "6e8ca543-8e2c-41e0-91dd-587d52dce8ed",
  name: "Max",
  provider: "codex/gpt-5.4",
  persona: "",
  serverId: "srv-spark",
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

const HOST_LABELS: Record<string, string> = {
  "srv-mac": "Mac Studio",
  "srv-spark": "DGX Spark",
};

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    conversationId: "conv-general",
    threadId: null,
    assistantId: SKY.id,
    serverId: "srv-mac",
    prompt: "Coordinate release verification\nCheck Spark logs",
    status: "running",
    agentId: "ag-turn-1",
    error: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    conversationId: "conv-general",
    assistantId: MAX.id,
    prompt: "Run E2E browser harness on Spark\nCapture screenshots",
    title: "Run E2E browser harness",
    serverId: "srv-spark",
    directory: "/ai/code/paseo",
    provider: "codex/gpt-5.4",
    isolation: "worktree",
    status: "running",
    execution: {
      serverId: "srv-spark",
      workspaceId: "ws-spark-1",
      agentId: "ag-task-1",
    },
    accepted: true,
    error: null,
    createdAt: 10_000,
    deadline: 60_000,
    ...overrides,
  };
}

function makeTakeover(overrides: Partial<Takeover> = {}): Takeover {
  return {
    id: "takeover-1",
    kind: "browser",
    status: "pending",
    assistantId: SKY.id,
    conversationId: "conv-general",
    threadId: null,
    turnId: "turn-1",
    serverId: "srv-mac",
    reason: "Complete GitHub 2FA verification",
    url: "https://github.com/sessions/two-factor",
    title: "Two-factor authentication · GitHub",
    screenshotDataUrl: null,
    createdAt: 12_000,
    updatedAt: 12_000,
    ...overrides,
  };
}

function makeMailboxRequest(overrides: Partial<PeerMessage> = {}): PeerMessage {
  return {
    id: "pm-1",
    ledger: "mailbox",
    kind: "request",
    studioId: null,
    sender: {
      key: `assistant:${SKY.id}`,
      kind: "assistant",
      name: SKY.name,
      machine: "Mac Studio",
    },
    recipient: {
      key: `assistant:${MAX.id}`,
      kind: "assistant",
      name: MAX.name,
      machine: "DGX Spark",
    },
    text: "Is port 6778 listening on Spark?",
    replyTo: null,
    status: "acked",
    conversationId: "conv-general",
    threadId: null,
    createdAt: 11_000,
    ...overrides,
  };
}

describe("activity-watch", () => {
  it("aggregates turns, tasks, takeovers, and peerMessages into unified ActivityWatchItem entries", () => {
    const now = 40_000;
    const triggerMsg: Message = {
      id: "msg-trigger-1",
      conversationId: "conv-general",
      threadId: null,
      senderId: "user",
      content: "Coordinate release verification",
      createdAt: 10_000,
      taskId: null,
      kind: "user",
    };
    const turnWithAllLineage = makeTurn({
      id: "turn-1",
      triggerId: triggerMsg.id,
      status: "running",
    });
    const spawnedTask = makeTask({
      id: "task-1",
      requestedByTurnId: "turn-1",
      origin: "assistant",
      status: "queued",
      createdAt: 15_000,
    });
    const pendingTakeover = makeTakeover({
      id: "takeover-1",
      turnId: "turn-1",
      status: "pending",
      createdAt: 12_000,
    });
    const mailboxMsg = makeMailboxRequest({
      id: "pm-1",
      conversationId: "conv-general",
      threadId: null,
      createdAt: 11_000,
    });
    const completedTurn = makeTurn({
      id: "turn-done",
      conversationId: "conv-sky",
      assistantId: SKY.id,
      prompt: "Earlier finished turn",
      status: "completed",
    });

    const snapshot = buildGlobalActivitySnapshot({
      turns: [turnWithAllLineage, completedTurn],
      tasks: [spawnedTask],
      takeovers: [pendingTakeover],
      peerMessages: [mailboxMsg],
      messages: [triggerMsg],
      assistants: [SKY, MAX],
      conversations: CONVERSATIONS,
      hostLabels: HOST_LABELS,
      coordinatorId: "srv-mac",
      now,
    });

    expect(snapshot.activeRunCount).toBe(2);
    expect(snapshot.waitingActionCount).toBe(1);
    expect(snapshot.queuedCount).toBe(1);
    expect(snapshot.completedCount).toBe(1);
    expect(snapshot.items.map((item) => item.id)).toEqual(["turn-1", "task-1", "turn-done"]);

    const turnItem = snapshot.items.find((item) => item.id === "turn-1")!;
    expect(turnItem).toMatchObject({
      id: "turn-1",
      kind: "turn",
      status: "waiting_action",
      assistantId: SKY.id,
      assistantName: "Sky",
      serverId: "srv-mac",
      hostLabel: "Mac Studio",
      conversationId: "conv-general",
      conversationTitle: "General",
      threadId: null,
      promptPreview: "Coordinate release verification",
      tags: ["Mailbox · 1", "Takeover", "Task"],
      startedAt: 10_000,
      elapsedLabel: "30s",
    });
    expect(turnItem.turn).toEqual(turnWithAllLineage);
    expect(turnItem.pendingTakeover?.id).toBe("takeover-1");
    expect(turnItem.pendingTakeover?.domain).toBe("github.com");

    const taskItem = snapshot.items.find((item) => item.id === "task-1")!;
    expect(taskItem).toMatchObject({
      id: "task-1",
      kind: "task",
      status: "queued",
      assistantId: MAX.id,
      assistantName: "Max",
      serverId: "srv-spark",
      hostLabel: "DGX Spark",
      conversationId: "conv-general",
      conversationTitle: "General",
      threadId: "task:task-1",
      promptPreview: "Run E2E browser harness",
      tags: ["Task"],
      startedAt: 15_000,
      elapsedLabel: "25s",
    });
    expect(taskItem.task).toEqual(spawnedTask);
  });

  it("computes activeRunCount across running, queued, and waiting_action items while excluding terminal ones", () => {
    const runningTurn = makeTurn({ id: "t-run", status: "running" });
    const queuedTask = makeTask({ id: "k-queue", status: "queued" });
    const permTask = makeTask({
      id: "k-perm",
      status: "running",
      pendingPermission: { requestId: "req-1", title: "Allow bash command" },
    });
    const completedTask = makeTask({ id: "k-done", status: "completed" });
    const failedTurn = makeTurn({ id: "t-fail", status: "failed", error: "Network error" });
    const cancelledTask = makeTask({ id: "k-cancel", status: "cancelled" });

    const snapshot = buildGlobalActivitySnapshot({
      turns: [runningTurn, failedTurn],
      tasks: [queuedTask, permTask, completedTask, cancelledTask],
      assistants: [SKY, MAX],
      conversations: CONVERSATIONS,
      hostLabels: HOST_LABELS,
      now: 20_000,
    });

    expect(snapshot.activeRunCount).toBe(3);
    expect(snapshot.runningCount).toBe(1);
    expect(snapshot.queuedCount).toBe(1);
    expect(snapshot.waitingActionCount).toBe(1);
    expect(snapshot.completedCount).toBe(3);

    const permItem = snapshot.allItems.find((item) => item.id === "k-perm")!;
    expect(permItem.status).toBe("waiting_action");
    expect(permItem.pendingPermission).toEqual({
      requestId: "req-1",
      title: "Allow bash command",
    });
  });

  it("filters items by status, assistantId, serverId, and multi-term search query", () => {
    const skyRunning = makeTurn({
      id: "turn-sky",
      assistantId: SKY.id,
      serverId: "srv-mac",
      conversationId: "conv-sky",
      prompt: "Inspect Unistyles shadow registry",
      status: "running",
    });
    const maxWaiting = makeTurn({
      id: "turn-max",
      assistantId: MAX.id,
      serverId: "srv-spark",
      conversationId: "conv-general",
      prompt: "Deploy relay worker to production",
      status: "attention",
    });
    const maxTask = makeTask({
      id: "task-max",
      assistantId: MAX.id,
      serverId: "srv-spark",
      conversationId: "conv-general",
      title: "Benchmark terminal latency",
      prompt: "Benchmark terminal latency",
      status: "running",
    });

    const baseInput = {
      turns: [skyRunning, maxWaiting],
      tasks: [maxTask],
      assistants: [SKY, MAX],
      conversations: CONVERSATIONS,
      hostLabels: HOST_LABELS,
      now: 50_000,
    };

    const runningOnly = buildGlobalActivitySnapshot({
      ...baseInput,
      status: "running",
    });
    expect(runningOnly.items.map((item) => item.id)).toEqual(["turn-sky", "task-max"]);
    expect(runningOnly.activeRunCount).toBe(3);

    const waitingOnly = buildGlobalActivitySnapshot({
      ...baseInput,
      status: "waiting_action",
    });
    expect(waitingOnly.items.map((item) => item.id)).toEqual(["turn-max"]);

    const byAssistant = buildGlobalActivitySnapshot({
      ...baseInput,
      assistantId: SKY.id,
    });
    expect(byAssistant.items.map((item) => item.id)).toEqual(["turn-sky"]);

    const byMachine = buildGlobalActivitySnapshot({
      ...baseInput,
      serverId: "srv-spark",
    });
    expect(byMachine.items.map((item) => item.id)).toEqual(["turn-max", "task-max"]);

    const byQuery = filterActivityWatchItems(runningOnly.allItems, {
      query: "dgx terminal",
    });
    expect(byQuery.map((item) => item.id)).toEqual(["task-max"]);
  });

  it("surfaces orphan pending takeovers and keeps resolved takeover tags without forcing waiting_action", () => {
    const resolvedTakeover = makeTakeover({
      id: "to-resolved",
      turnId: "turn-running",
      status: "resolved",
    });
    const orphanTakeover = makeTakeover({
      id: "to-orphan",
      turnId: "turn-missing",
      assistantId: MAX.id,
      serverId: "srv-spark",
      conversationId: "conv-general",
      status: "pending",
      reason: "Solve CAPTCHA on staging login",
      createdAt: 18_000,
    });
    const runningTurn = makeTurn({
      id: "turn-running",
      status: "running",
      inboxMessageIds: ["pm-a", "pm-b"],
    });

    const snapshot = buildGlobalActivitySnapshot({
      turns: [runningTurn],
      takeovers: [resolvedTakeover, orphanTakeover],
      assistants: [SKY, MAX],
      conversations: CONVERSATIONS,
      hostLabels: HOST_LABELS,
      now: 30_000,
    });

    expect(snapshot.activeRunCount).toBe(2);
    const orphanItem = snapshot.allItems.find((item) => item.id === "turn-missing")!;
    expect(orphanItem).toMatchObject({
      id: "turn-missing",
      kind: "turn",
      status: "waiting_action",
      assistantName: "Max",
      hostLabel: "DGX Spark",
      tags: ["Takeover"],
    });
    expect(orphanItem.pendingTakeover?.id).toBe("to-orphan");

    const runningItem = snapshot.allItems.find((item) => item.id === "turn-running")!;
    expect(runningItem.status).toBe("running");
    expect(runningItem.pendingTakeover).toBeUndefined();
    expect(runningItem.tags).toEqual(["Mailbox · 2", "Takeover"]);
  });

  it("formats elapsed durations cleanly across seconds, minutes, hours, and days", () => {
    const start = 1_000;
    expect(formatActivityElapsed(start, start + 42_000)).toBe("42s");
    expect(formatActivityElapsed(start, start + 120_000)).toBe("2m");
    expect(formatActivityElapsed(start, start + 155_000)).toBe("2m 35s");
    expect(formatActivityElapsed(start, start + 3_600_000)).toBe("1h");
    expect(formatActivityElapsed(start, start + 5_400_000)).toBe("1h 30m");
    expect(formatActivityElapsed(start, start + 2 * 86_400_000)).toBe("2d");
  });
});
