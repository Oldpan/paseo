import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
import type {
  Assistant,
  PeerMessage,
  Studio,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import {
  buildStudioGroupSummary,
  listStudioGroups,
  moveStudioColumnToGroup,
  renameStudioGroup,
  reorderStudioColumn,
  studioKey,
  type StudioColumn,
} from "./model";
import { studioRecords } from "./peer-activity";
import { usePavraView } from "./store";

const colA: StudioColumn = {
  serverId: "mac",
  workspaceId: "ws-1",
  name: "Frontend App",
  group: "General",
};
const colB: StudioColumn = {
  serverId: "spark",
  workspaceId: "ws-2",
  name: "CUDA Kernel",
  group: "General",
};
const colC: StudioColumn = {
  serverId: "spark",
  workspaceId: "ws-3",
  name: "Worker Service",
  group: "Tasks",
};
const colD: StudioColumn = {
  serverId: "mac",
  workspaceId: "ws-4",
  name: "Docs Site",
  group: "General",
};

describe("listStudioGroups", () => {
  it("lists unique group names in order from columns and extraGroups", () => {
    expect(listStudioGroups([colA, colB, colC], ["Staging", "General", "  ", "Ops"])).toEqual([
      "General",
      "Tasks",
      "Staging",
      "Ops",
    ]);
  });

  it("returns empty array when both columns and extraGroups are empty", () => {
    expect(listStudioGroups([])).toEqual([]);
    expect(listStudioGroups([], ["", "   "])).toEqual([]);
  });
});

describe("renameStudioGroup", () => {
  it("renames all columns in oldGroup to newGroup while preserving other groups", () => {
    const renamed = renameStudioGroup([colA, colB, colC], "General", "Core");
    expect(renamed.map((c) => c.group)).toEqual(["Core", "Core", "Tasks"]);
  });

  it("ignores empty or identical target group names", () => {
    const original = [colA, colC];
    expect(renameStudioGroup(original, "General", "   ")).toEqual(original);
    expect(renameStudioGroup(original, "General", "General")).toEqual(original);
  });
});

describe("moveStudioColumnToGroup", () => {
  it("moves only the matching column key to the target group", () => {
    const moved = moveStudioColumnToGroup([colA, colB, colC], studioKey(colB), "Research");
    expect(moved).toEqual([colA, { ...colB, group: "Research" }, colC]);
  });

  it("leaves columns unchanged when key does not exist or targetGroup is blank", () => {
    const original = [colA, colB];
    expect(moveStudioColumnToGroup(original, '["unknown","id"]', "Research")).toEqual(original);
    expect(moveStudioColumnToGroup(original, studioKey(colA), "   ")).toEqual(original);
  });
});

describe("reorderStudioColumn", () => {
  it("reorders columns left and right within the same group", () => {
    const initial = [colA, colB, colD];
    const movedLeft = reorderStudioColumn(initial, studioKey(colB), "left");
    expect(movedLeft.map((c) => c.workspaceId)).toEqual(["ws-2", "ws-1", "ws-4"]);

    const movedRight = reorderStudioColumn(initial, studioKey(colB), "right");
    expect(movedRight.map((c) => c.workspaceId)).toEqual(["ws-1", "ws-4", "ws-2"]);
  });

  it("handles group boundaries and interleaved groups without scrambling other groups", () => {
    const interleaved = [colA, colC, colB, colD];
    expect(reorderStudioColumn(interleaved, studioKey(colA), "left")).toEqual(interleaved);
    expect(reorderStudioColumn(interleaved, studioKey(colD), "right")).toEqual(interleaved);

    const swappedAcrossInterleaved = reorderStudioColumn(interleaved, studioKey(colB), "left");
    expect(swappedAcrossInterleaved.map((c) => c.workspaceId)).toEqual([
      "ws-2",
      "ws-3",
      "ws-1",
      "ws-4",
    ]);
  });
});

describe("buildStudioGroupSummary", () => {
  const studio: Studio = {
    id: "studio-general",
    name: "General",
    status: "active",
    workspaces: [
      { serverId: "mac", workspaceId: "ws-1", name: "Frontend App" },
      { serverId: "spark", workspaceId: "ws-bound-only", name: "Model Trainer" },
    ],
    assistantIds: ["11111111-1111-4111-8111-111111111111"],
    createdAt: 1000,
  };

  const assistants: Assistant[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Ada",
      provider: "claude/sonnet",
      persona: "Lead engineer",
      serverId: "mac",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Grace",
      provider: "codex/default",
      persona: "Systems",
      serverId: "spark",
    },
  ];

  const tasks: Task[] = [
    {
      id: "task-1",
      conversationId: "conv-1",
      assistantId: "11111111-1111-4111-8111-111111111111",
      prompt: "Optimize bundle size",
      title: "Optimize bundle size",
      serverId: "mac",
      directory: "/repo/frontend",
      provider: "claude/sonnet",
      isolation: "worktree",
      status: "running",
      execution: { serverId: "mac", workspaceId: "ws-1", agentId: "ag-1" },
      accepted: true,
      error: null,
      createdAt: 1100,
      deadline: 5000,
    },
    {
      id: "task-2",
      conversationId: "conv-1",
      assistantId: "11111111-1111-4111-8111-111111111111",
      prompt: "Add unit tests for group summary",
      title: "Add unit tests",
      serverId: "spark",
      directory: "/repo/trainer",
      provider: "claude/sonnet",
      isolation: "directory",
      status: "completed",
      execution: { serverId: "spark", workspaceId: "ws-bound-only", agentId: "ag-2" },
      accepted: true,
      error: null,
      createdAt: 1200,
      deadline: 5000,
    },
  ];

  const turns: Turn[] = [
    {
      id: "turn-1",
      conversationId: "conv-1",
      threadId: null,
      assistantId: "11111111-1111-4111-8111-111111111111",
      prompt: "Check progress",
      status: "running",
      agentId: "ag-turn-1",
      error: null,
    },
  ];

  const peerMessages: PeerMessage[] = [
    {
      id: "pm-1",
      ledger: "studio",
      kind: "message",
      studioId: "studio-general",
      sender: { key: "agent:ag-1", kind: "agent", name: "Frontend Agent", machine: "Mac" },
      recipient: { key: "agent:ag-2", kind: "agent", name: "Trainer Agent", machine: "Spark" },
      text: "API schema v2 is ready for training pipeline.",
      replyTo: null,
      status: "accepted",
      createdAt: 1500,
    },
  ];

  it("synthesizes workspaces, assistants, task counts, records, highlights, and markdownDigest", () => {
    const records = studioRecords(peerMessages, studio);
    const summary = buildStudioGroupSummary({
      group: "General",
      columns: [colA, colB, colC],
      studio,
      assistants,
      tasks,
      turns,
      studioRecords: records,
      hostLabels: { mac: "MacBook Pro", spark: "DGX Spark" },
      generatedAt: 1700000000000,
    });

    expect(summary.group).toBe("General");
    expect(summary.generatedAt).toBe(1700000000000);
    expect(summary.workspaceCount).toBe(3);
    expect(summary.workspaces.map((w) => `${w.name}@${w.machineLabel}`)).toEqual([
      "Frontend App@MacBook Pro",
      "CUDA Kernel@DGX Spark",
      "Model Trainer@DGX Spark",
    ]);
    expect(summary.assistantCount).toBe(1);
    expect(summary.assistants[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Ada",
      activeTurnCount: 1,
    });
    expect(summary.activeTaskCount).toBe(1);
    expect(summary.completedTaskCount).toBe(1);
    expect(summary.recordCount).toBe(1);
    expect(summary.highlights.some((h) => h.includes("API schema v2 is ready"))).toBe(true);
    expect(summary.highlights.some((h) => h.includes("Optimize bundle size"))).toBe(true);
    expect(summary.markdownDigest).toContain("# Studio Summary · General");
    expect(summary.markdownDigest).toContain("**Workspaces (3):**");
    expect(summary.markdownDigest).toContain("**Collaborating Assistants (1):** Ada");
    expect(summary.markdownDigest).toContain("**Tasks:** 1 active · 1 completed");
    expect(summary.markdownDigest).toContain("**Peer Records:** 1");
  });

  it("handles unbound groups with open columns and derives records from peerMessages when studioRecords is omitted", () => {
    const unboundSummary = buildStudioGroupSummary({
      group: "Tasks",
      columns: [colA, colC],
      generatedAt: 1700000001000,
    });
    expect(unboundSummary.workspaceCount).toBe(1);
    expect(unboundSummary.workspaces[0]?.name).toBe("Worker Service");
    expect(unboundSummary.highlights[0]).toContain("Workspaces in Tasks: Worker Service (spark)");

    const fromPeerMessages = buildStudioGroupSummary({
      group: "General",
      columns: [colA],
      studio,
      peerMessages,
      generatedAt: 1700000002000,
    });
    expect(fromPeerMessages.recordCount).toBe(1);
  });
});

describe("usePavraView studio group actions", () => {
  beforeEach(() => {
    usePavraView.setState({
      columns: [colA, colB, colC],
      activeColumn: studioKey(colA),
      extraGroups: [],
      activeGroup: "General",
    });
  });

  it("supports adding, focusing, and renaming groups and moving/reordering columns", () => {
    usePavraView.getState().addGroup("Backend");
    expect(usePavraView.getState().extraGroups).toContain("Backend");
    expect(usePavraView.getState().activeGroup).toBe("Backend");

    usePavraView.getState().focusGroup("Tasks");
    expect(usePavraView.getState().activeGroup).toBe("Tasks");
    expect(usePavraView.getState().activeColumn).toBe(studioKey(colC));

    usePavraView.getState().moveColumnToGroup(studioKey(colB), "Backend");
    expect(
      usePavraView.getState().columns.find((c) => studioKey(c) === studioKey(colB))?.group,
    ).toBe("Backend");

    usePavraView.getState().renameGroup("Backend", "Platform");
    expect(
      usePavraView.getState().columns.find((c) => studioKey(c) === studioKey(colB))?.group,
    ).toBe("Platform");
    expect(usePavraView.getState().activeGroup).toBe("Platform");

    usePavraView.getState().openColumn(colD);
    usePavraView.getState().reorderColumn(studioKey(colD), "left");
    const generalCols = usePavraView
      .getState()
      .columns.filter((c) => c.group === "General")
      .map((c) => c.workspaceId);
    expect(generalCols).toEqual(["ws-4", "ws-1"]);
  });
});

describe("StudioChrome and CollaborationPanel UI contracts", () => {
  const pavraDir = path.dirname(fileURLToPath(import.meta.url));

  it("exposes group pills, + Group, Rename Group, Port Preview, and column move/reorder actions in StudioChrome", () => {
    const chromeSource = readFileSync(path.join(pavraDir, "ui", "StudioChrome.tsx"), "utf8");
    expect(chromeSource).toContain("studio-group-pill-${group}");
    expect(chromeSource).toContain('testID="studio-add-group-btn"');
    expect(chromeSource).toContain('testID="studio-rename-group-btn"');
    expect(chromeSource).toContain('testID="studio-port-preview-btn"');
    expect(chromeSource).toContain('accessibilityLabel="Move left"');
    expect(chromeSource).toContain('accessibilityLabel="Move right"');
    expect(chromeSource).toContain('accessibilityLabel="Move to group"');
    expect(chromeSource).not.toContain("useUnistyles(");
  });

  it("exposes Summary and Activity & Peers tabs, refresh, and copy digest in CollaborationPanel", () => {
    const collabSource = readFileSync(path.join(pavraDir, "ui", "CollaborationPanel.tsx"), "utf8");
    expect(collabSource).toContain('testID="studio-collab-tab-summary"');
    expect(collabSource).toContain('testID="studio-collab-tab-activity"');
    expect(collabSource).toContain('testID="studio-summary-panel"');
    expect(collabSource).toContain('testID="studio-summary-refresh"');
    expect(collabSource).toContain('testID="studio-summary-copy"');
    expect(collabSource).not.toContain("useUnistyles(");
  });
});
