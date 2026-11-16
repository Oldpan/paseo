import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Assistant, Conversation } from "../../../../extensions/pavra/shared/contracts";
import {
  filterAndGroupGlobalTasks,
  formatTaskBudgetOrDeadline,
  mapTaskToColumn,
  type GlobalTaskRecord,
} from "./global-tasks";

const pavraDir = path.dirname(fileURLToPath(import.meta.url));

const SKY_ID = "11111111-1111-4111-8111-111111111111";
const MAX_ID = "22222222-2222-4222-8222-222222222222";

const assistants: Assistant[] = [
  {
    id: SKY_ID,
    name: "Sky",
    provider: "anthropic/claude-sonnet-4-5",
    persona: "Spark builder",
    serverId: "srv-spark",
  },
  {
    id: MAX_ID,
    name: "Max",
    provider: "openai/gpt-5",
    persona: "Mac verifier",
    serverId: "srv-mac",
  },
];

const conversations: Conversation[] = [
  {
    id: "conv-dm-sky",
    name: "Sky",
    members: [SKY_ID],
    kind: "dm",
    roundtable: false,
  },
  {
    id: "conv-group-core",
    name: "Core Release",
    members: [SKY_ID, MAX_ID],
    kind: "group",
    roundtable: true,
  },
];

const hostLabels: Record<string, string> = {
  "srv-spark": "Spark",
  "srv-mac": "Mac Studio",
};

function makeTask(overrides: Partial<GlobalTaskRecord> & { id: string }): GlobalTaskRecord {
  return {
    conversationId: "conv-dm-sky",
    assistantId: SKY_ID,
    prompt: "Default task prompt",
    serverId: "srv-spark",
    directory: "/home/dev/paseo",
    provider: "anthropic/claude-sonnet-4-5",
    isolation: "worktree",
    status: "queued",
    execution: null,
    accepted: true,
    error: null,
    createdAt: 1_000,
    deadline: 3_601_000,
    ...overrides,
  };
}

describe("mapTaskToColumn", () => {
  it("maps each task status to the expected board column", () => {
    expect(mapTaskToColumn({ status: "queued" })).toBe("queued");
    expect(mapTaskToColumn({ status: "running" })).toBe("running");
    expect(mapTaskToColumn({ status: "creating" })).toBe("running");
    expect(mapTaskToColumn({ status: "unknown" })).toBe("running");
    expect(mapTaskToColumn({ status: "waiting_permission" })).toBe("needs_action");
    expect(mapTaskToColumn({ status: "attention" })).toBe("needs_action");
    expect(
      mapTaskToColumn({
        status: "running",
        pendingPermission: { requestId: "req-1", title: "Allow git push" },
      }),
    ).toBe("needs_action");
    expect(mapTaskToColumn({ status: "completed" })).toBe("done");
    expect(mapTaskToColumn({ status: "failed" })).toBe("done");
    expect(mapTaskToColumn({ status: "cancelled" })).toBe("done");
    expect(
      mapTaskToColumn({
        status: "completed",
        pendingPermission: { requestId: "stale", title: "Old request" },
      }),
    ).toBe("done");
  });
});

describe("filterAndGroupGlobalTasks", () => {
  const sampleTasks: GlobalTaskRecord[] = [
    makeTask({
      id: "task-queued-old",
      title: "Audit dependency tree",
      prompt: "Audit dependency tree and remove unused packages",
      status: "queued",
      createdAt: 1_000,
      updatedAt: 1_500,
      conversationId: "conv-dm-sky",
      assistantId: SKY_ID,
      serverId: "srv-spark",
      directory: "/srv/paseo",
    }),
    makeTask({
      id: "task-queued-new",
      title: "Prepare release notes",
      goal: "Draft changelog for v0.17",
      summary: "Scanning git commits since last tag",
      status: "queued",
      createdAt: 2_000,
      updatedAt: 5_000,
      conversationId: "conv-group-core",
      assistantId: MAX_ID,
      serverId: "srv-mac",
      directory: "/Users/oldpan/paseo",
    }),
    makeTask({
      id: "task-running-1",
      title: "Run Playwright E2E suite",
      prompt: "Run Playwright E2E suite on Spark",
      status: "running",
      execution: { serverId: "srv-spark", workspaceId: "ws-1", agentId: "ag-1" },
      createdAt: 3_000,
      updatedAt: 6_000,
      conversationId: "conv-group-core",
      assistantId: SKY_ID,
      serverId: "srv-spark",
      directory: "/srv/paseo-e2e",
    }),
    makeTask({
      id: "task-perm-1",
      title: "Deploy preview worker",
      prompt: "Deploy preview worker to staging",
      status: "waiting_permission",
      pendingPermission: { requestId: "perm-99", title: "Execute deploy script" },
      createdAt: 4_000,
      updatedAt: 7_000,
      conversationId: "conv-dm-sky",
      assistantId: SKY_ID,
      serverId: "srv-spark",
      directory: "/srv/deploy",
    }),
    makeTask({
      id: "task-done-completed",
      title: "Migrate SQLite schema",
      summary: "All tables migrated cleanly",
      status: "completed",
      createdAt: 1_200,
      updatedAt: 4_000,
      conversationId: "conv-dm-sky",
      assistantId: SKY_ID,
      serverId: "srv-spark",
    }),
    makeTask({
      id: "task-done-failed",
      title: "Fix Android APK signing",
      error: "Keystore password missing",
      status: "failed",
      createdAt: 2_500,
      updatedAt: 8_000,
      conversationId: "conv-group-core",
      assistantId: MAX_ID,
      serverId: "srv-mac",
      directory: "/Users/oldpan/android",
    }),
    makeTask({
      id: "task-done-cancelled",
      title: "Benchmark WebSocket throughput",
      status: "cancelled",
      stopReason: "budget",
      createdAt: 1_800,
      updatedAt: 3_000,
      conversationId: "conv-group-core",
      assistantId: SKY_ID,
      serverId: "srv-spark",
    }),
  ];

  it("groups tasks into 4 columns, sorts each column by updatedAt/createdAt desc, and computes counts", () => {
    const result = filterAndGroupGlobalTasks({
      tasks: sampleTasks,
      assistants,
      conversations,
      hostLabels,
    });

    expect(result.queuedCount).toBe(2);
    expect(result.runningCount).toBe(1);
    expect(result.needsActionCount).toBe(1);
    expect(result.doneCount).toBe(3);
    expect(result.openCount).toBe(4);
    expect(result.totalCount).toBe(7);

    expect(result.columns.queued.map((t) => t.id)).toEqual(["task-queued-new", "task-queued-old"]);
    expect(result.columns.running.map((t) => t.id)).toEqual(["task-running-1"]);
    expect(result.columns.needs_action.map((t) => t.id)).toEqual(["task-perm-1"]);
    expect(result.columns.done.map((t) => t.id)).toEqual([
      "task-done-failed",
      "task-done-completed",
      "task-done-cancelled",
    ]);
  });

  it("enriches sourceLabel (DM @Sky / #Group), hostLabel, action flags, and threadId", () => {
    const result = filterAndGroupGlobalTasks({
      tasks: sampleTasks,
      assistants,
      conversations,
      hostLabels,
    });

    const dmTask = result.items.find((t) => t.id === "task-perm-1")!;
    expect(dmTask.sourceType).toBe("dm");
    expect(dmTask.sourceLabel).toBe("DM @Sky");
    expect(dmTask.hostLabel).toBe("Spark");
    expect(dmTask.canApprove).toBe(true);
    expect(dmTask.canCancel).toBe(false);
    expect(dmTask.threadId).toBe("task:task-perm-1");

    const groupTask = result.items.find((t) => t.id === "task-running-1")!;
    expect(groupTask.sourceType).toBe("group");
    expect(groupTask.sourceLabel).toBe("#Core Release");
    expect(groupTask.canCancel).toBe(true);
    expect(groupTask.canOpenStudio).toBe(true);
  });

  it("filters by sourceType (dm vs group), assistantId, serverId, and column", () => {
    const dmOnly = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { sourceType: "dm" },
    );
    expect(dmOnly.totalCount).toBe(3);
    expect(dmOnly.items.every((t) => t.sourceType === "dm")).toBe(true);

    const groupOnly = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { sourceType: "group" },
    );
    expect(groupOnly.totalCount).toBe(4);
    expect(groupOnly.items.every((t) => t.sourceType === "group")).toBe(true);

    const maxOnly = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { assistantId: MAX_ID },
    );
    expect(maxOnly.items.map((t) => t.id)).toEqual(["task-done-failed", "task-queued-new"]);

    const macOnly = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { serverId: "srv-mac" },
    );
    expect(macOnly.items.map((t) => t.id)).toEqual(["task-done-failed", "task-queued-new"]);

    const needsActionOnly = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { column: "needs_action" },
    );
    expect(needsActionOnly.totalCount).toBe(1);
    expect(needsActionOnly.needsActionCount).toBe(1);
    expect(needsActionOnly.queuedCount).toBe(0);
    expect(needsActionOnly.items[0]?.id).toBe("task-perm-1");
  });

  it("supports case-insensitive multi-term search across title, goal, summary, directory, assistant name, and conversation title", () => {
    const byGoalAndAssistant = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { query: "max v0.17 changelog" },
    );
    expect(byGoalAndAssistant.items.map((t) => t.id)).toEqual(["task-queued-new"]);

    const bySummaryAndDirectory = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { query: "keystore /Users/oldpan/android" },
    );
    expect(bySummaryAndDirectory.items.map((t) => t.id)).toEqual(["task-done-failed"]);

    const byConversationAndTitle = filterAndGroupGlobalTasks(
      { tasks: sampleTasks, assistants, conversations, hostLabels },
      { query: "core playwright spark" },
    );
    expect(byConversationAndTitle.items.map((t) => t.id)).toEqual(["task-running-1"]);
  });

  it("stays Hermes-compatible when Array.prototype.toSorted is absent", () => {
    const originalToSorted = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    Reflect.deleteProperty(Array.prototype, "toSorted");
    try {
      const result = filterAndGroupGlobalTasks({
        tasks: sampleTasks,
        assistants,
        conversations,
        hostLabels,
      });
      expect(result.totalCount).toBe(7);
      expect(result.columns.queued[0]?.id).toBe("task-queued-new");
    } finally {
      if (originalToSorted) {
        Reflect.defineProperty(Array.prototype, "toSorted", originalToSorted);
      }
    }
  });

  it("formats budget and deadline labels cleanly", () => {
    expect(
      formatTaskBudgetOrDeadline({
        createdAt: 1_000,
        deadline: 1_000 + 60 * 60_000,
        status: "running",
      }),
    ).toBe("1h budget");
    expect(
      formatTaskBudgetOrDeadline({
        createdAt: 1_000,
        deadline: 1_000 + 30 * 60_000,
        status: "cancelled",
        stopReason: "budget",
      }),
    ).toBe("Budget reached");
  });

  it("wires GlobalTasksPane with all required testIDs, RPC actions, and zero useUnistyles calls", () => {
    const paneSource = readFileSync(path.join(pavraDir, "ui", "GlobalTasksPane.tsx"), "utf8");
    expect(paneSource).not.toContain("useUnistyles");
    expect(paneSource).toContain('testID="global-tasks-pane"');
    expect(paneSource).toContain('testID="global-tasks-view-board"');
    expect(paneSource).toContain('testID="global-tasks-view-list"');
    expect(paneSource).toContain('testID="global-tasks-new-btn"');
    expect(paneSource).toContain('testID="global-tasks-search"');
    expect(paneSource).toContain('testID="global-tasks-toggle-done"');
    expect(paneSource).toContain("`global-task-card-${item.id}`");
    expect(paneSource).toContain("`global-task-approve-${item.id}`");
    expect(paneSource).toContain("`global-task-deny-${item.id}`");
    expect(paneSource).toContain("`global-task-cancel-${item.id}`");
    expect(paneSource).toContain("`global-task-open-${item.id}`");
    expect(paneSource).toContain("`global-task-chat-${item.id}`");
    expect(paneSource).toContain("`global-task-studio-${item.id}`");
    expect(paneSource).toContain("respondTaskPermission");
    expect(paneSource).toContain("cancelTask");
    expect(paneSource).toContain("PromoteToTaskModal");
  });
});
