import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  Assistant,
  Conversation,
  Routine,
  Studio,
  Task,
} from "../../../../extensions/pavra/shared/contracts";
import {
  buildSnippetHighlight,
  formatRelativeTime,
  isSavedMessage,
  matchesAllSearchTerms,
  SEARCH_CATEGORIES,
  searchPavraState,
  tokenizeSearchQuery,
  type SearchMessageInput,
  type SearchPlaybookInput,
  type SearchSnapshot,
} from "./search";

const NOW = 1_760_000_000_000;

const ASSISTANTS: Assistant[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "OpsBot",
    provider: "anthropic/claude-sonnet-4",
    persona: "Maintains GPU clusters, vllm服务, and Spark deployments.",
    serverId: "spark",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "ReviewBot",
    provider: "openai/gpt-5",
    persona: "Audits TypeScript architecture and security rules.",
    serverId: "mac",
  },
];

const CONVERSATIONS: Conversation[] = [
  {
    id: "conv-ops",
    name: "OpsBot",
    members: [ASSISTANTS[0]!.id],
    kind: "dm",
    roundtable: false,
  },
  {
    id: "conv-infra",
    name: "infra-alerts",
    members: [ASSISTANTS[0]!.id, ASSISTANTS[1]!.id],
    kind: "group",
    roundtable: true,
  },
];

const MESSAGES: SearchMessageInput[] = [
  {
    id: "msg-1",
    conversationId: "conv-ops",
    threadId: null,
    senderId: ASSISTANTS[0]!.id,
    content: "The vllm engine on 127.0.0.1:8000 loaded checkpoint-400000 for qwen3.6-27b.",
    createdAt: NOW - 5 * 60_000,
    taskId: null,
    kind: "final",
    savedAt: "2026-11-15T16:00:00.000Z",
  },
  {
    id: "msg-2",
    conversationId: "conv-infra",
    threadId: null,
    senderId: "user",
    content: "请检查 Spark 节点上的 vllm 服务是否已经在 8000 端口正常启动。",
    createdAt: NOW - 2 * 60_000,
    taskId: null,
    kind: "user",
  },
  {
    id: "msg-3",
    conversationId: "conv-infra",
    threadId: "thread-1",
    senderId: ASSISTANTS[1]!.id,
    content: "Verified foo_bar_handler in /bigdeploy/model_output/logs.txt.",
    createdAt: NOW - 60 * 60_000,
    taskId: null,
    kind: "final",
  },
  {
    id: "msg-system",
    conversationId: "conv-infra",
    threadId: null,
    senderId: "system",
    content: "Task started in background",
    createdAt: NOW - 30_000,
    taskId: "task-1",
    kind: "task_event",
  },
];

const TASKS: Task[] = [
  {
    id: "task-1",
    conversationId: "conv-ops",
    assistantId: ASSISTANTS[0]!.id,
    prompt: "Benchmark vllm throughput on Spark GPU cluster\nCollect latency p99 metrics.",
    title: "Benchmark vllm throughput",
    serverId: "spark",
    directory: "/home/oldpan/bigdeploy",
    provider: "anthropic/claude-sonnet-4",
    isolation: "worktree",
    status: "running",
    execution: { serverId: "spark", workspaceId: "ws-1", agentId: "ag-1" },
    accepted: true,
    error: null,
    createdAt: NOW - 10 * 60_000,
    deadline: NOW + 50 * 60_000,
  },
  {
    id: "task-2",
    conversationId: "conv-infra",
    assistantId: ASSISTANTS[1]!.id,
    prompt: "Archive legacy logs",
    title: "Archive legacy logs",
    serverId: "mac",
    directory: "/Users/oldpan/project",
    provider: "openai/gpt-5",
    isolation: "directory",
    status: "completed",
    execution: null,
    accepted: true,
    error: null,
    createdAt: NOW - 3 * 86_400_000,
    deadline: NOW - 2 * 86_400_000,
  },
];

const ROUTINES: Routine[] = [
  {
    id: "routine-1",
    name: "Nightly GPU Health Check",
    prompt: "Inspect nvidia-smi and vllm port 8000 every hour; reply (pass) if healthy.",
    assistantId: ASSISTANTS[0]!.id,
    conversationId: "conv-ops",
    threadId: null,
    cadence: { type: "every", everyMs: 3_600_000 },
    status: "active",
    maxRuns: null,
    expiresAt: null,
    createdAt: NOW - 86_400_000,
    updatedAt: NOW - 3_600_000,
    nextRunAt: NOW + 3_600_000,
    lastRunAt: NOW - 3_600_000,
    pausedAt: null,
    runs: [],
  },
];

const PLAYBOOKS: SearchPlaybookInput[] = [
  {
    slug: "restart-vllm-service",
    title: "Restart Vllm Service",
    content: "# Restart Vllm Service\n\n1. Check port 8000\n2. Restart systemd unit",
    mtimeMs: NOW - 7_200_000,
    assistantId: ASSISTANTS[0]!.id,
    assistantName: "OpsBot",
    conversationId: "conv-ops",
  },
];

const STUDIOS: Studio[] = [
  {
    id: "studio-spark",
    name: "Spark Deployment Studio",
    status: "active",
    workspaces: [{ serverId: "spark", workspaceId: "ws-1", name: "bigdeploy-main" }],
    assistantIds: [ASSISTANTS[0]!.id],
    createdAt: NOW - 2 * 86_400_000,
  },
];

const SNAPSHOT: SearchSnapshot = {
  conversations: CONVERSATIONS,
  messages: MESSAGES,
  assistants: ASSISTANTS,
  tasks: TASKS,
  routines: ROUTINES,
  playbooks: PLAYBOOKS,
  studios: STUDIOS,
  hostLabels: { spark: "Spark", mac: "MacBook Pro" },
};

describe("pavra global search engine", () => {
  it("exposes all required search categories", () => {
    expect(SEARCH_CATEGORIES).toEqual([
      "all",
      "messages",
      "saved",
      "assistants",
      "conversations",
      "tasks",
      "routines",
      "playbooks",
      "studios",
    ]);
  });

  it("tokenizes space-separated queries and matches multi-term AND across English, code identifiers, numbers, and Chinese substrings", () => {
    expect(tokenizeSearchQuery("  vllm   8000  vllm ")).toEqual(["vllm", "8000"]);
    expect(tokenizeSearchQuery("")).toEqual([]);

    // English + code identifiers + numbers + IP:port
    expect(
      matchesAllSearchTerms(
        ["The vllm engine on 127.0.0.1:8000 loaded checkpoint-400000 for qwen3.6-27b."],
        "vllm checkpoint-400000 127.0.0.1:8000 qwen3.6",
      ),
    ).toBe(true);

    // Fails when any AND term is missing
    expect(
      matchesAllSearchTerms(
        ["The vllm engine on 127.0.0.1:8000 loaded checkpoint-400000."],
        "vllm 9999",
      ),
    ).toBe(false);

    // Chinese substring AND matching
    expect(
      matchesAllSearchTerms(
        ["请检查 Spark 节点上的 vllm 服务是否已经在 8000 端口正常启动。"],
        "服务 启动 8000",
      ),
    ).toBe(true);

    // Mixed CJK + ASCII without space (`vllm服务`) matches text with space (`vllm 服务`)
    expect(
      matchesAllSearchTerms(
        ["请检查 Spark 节点上的 vllm 服务是否已经在 8000 端口正常启动。"],
        "vllm服务 端口",
      ),
    ).toBe(true);

    // Path + underscore identifier
    expect(
      matchesAllSearchTerms(
        ["Verified foo_bar_handler in /bigdeploy/model_output/logs.txt."],
        "foo_bar /bigdeploy/model_output",
      ),
    ).toBe(true);
  });

  it("produces snippet highlights with before, match, after and multi-term segments", () => {
    const simple = buildSnippetHighlight("The vllm engine on port 8000 is healthy.", "vllm 8000");
    expect(simple.before).toBe("The ");
    expect(simple.match).toBe("vllm");
    expect(simple.after).toBe(" engine on port 8000 is healthy.");
    expect(simple.before + simple.match + simple.after).toBe(simple.text);
    expect(simple.segments.filter((s) => s.highlight).map((s) => s.text)).toEqual(["vllm", "8000"]);

    // Compact cross-space CJK + ASCII highlight
    const cjk = buildSnippetHighlight("节点上的 vllm 服务已经启动", "vllm服务");
    expect(cjk.before).toBe("节点上的 ");
    expect(cjk.match).toBe("vllm 服务");
    expect(cjk.after).toBe("已经启动");

    // Windowed truncation with ellipsis on long text
    const longPrefix = "A".repeat(120);
    const longSuffix = "B".repeat(120);
    const windowed = buildSnippetHighlight(
      `${longPrefix} target_token ${longSuffix}`,
      "target_token",
      60,
    );
    expect(windowed.before.startsWith("…")).toBe(true);
    expect(windowed.match).toBe("target_token");
    expect(windowed.after.endsWith("…")).toBe(true);
  });

  it("formats relative time for past, future, ISO strings, and invalid values", () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW - 4 * 86_400_000, NOW)).toBe("4d ago");
    expect(formatRelativeTime(NOW + 15 * 60_000, NOW)).toBe("in 15m");
    expect(formatRelativeTime(new Date(NOW - 120_000).toISOString(), NOW)).toBe("2m ago");
    expect(formatRelativeTime(null, NOW)).toBe("");
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });

  it("returns Saved Messages, Recent Conversations, Active Tasks, and Recent Messages on empty query", () => {
    const out = searchPavraState(SNAPSHOT, "   ", { now: NOW });
    expect(out.isEmptyQuery).toBe(true);

    // 1. Saved Messages (only messages with savedAt / saved)
    expect(out.emptySections.savedMessages.map((item) => item.messageId)).toEqual(["msg-1"]);
    expect(isSavedMessage(MESSAGES[0]!)).toBe(true);
    expect(isSavedMessage(MESSAGES[1]!)).toBe(false);

    // 2. Recent Conversations (sorted by latest non-note message timestamp: conv-infra has msg-2 at -2m, conv-ops has msg-1 at -5m)
    expect(out.emptySections.recentConversations.map((item) => item.conversationId)).toEqual([
      "conv-infra",
      "conv-ops",
    ]);

    // 3. Active Tasks (only running/queued/creating/attention tasks, so task-1 is included and completed task-2 is excluded)
    expect(out.emptySections.activeTasks.map((item) => item.taskId)).toEqual(["task-1"]);

    // 4. Recent Messages (excludes system/task_event notes like msg-system)
    expect(out.emptySections.recentMessages.map((item) => item.messageId)).toEqual([
      "msg-2",
      "msg-1",
      "msg-3",
    ]);
  });

  it("filters and ranks across all categories and supports routines_playbooks combined filter", () => {
    const allHit = searchPavraState(SNAPSHOT, "vllm 8000", { now: NOW });
    expect(allHit.isEmptyQuery).toBe(false);
    expect(allHit.counts.messages).toBe(2);
    expect(allHit.counts.saved).toBe(1);
    expect(allHit.counts.routines).toBe(1);
    expect(allHit.counts.playbooks).toBe(1);
    expect(allHit.counts.routines_playbooks).toBe(2);

    const messagesOnly = searchPavraState(SNAPSHOT, "vllm 8000", {
      category: "messages",
      now: NOW,
    });
    expect(messagesOnly.results.every((item) => item.category === "messages")).toBe(true);
    expect(messagesOnly.results.map((item) => item.messageId)).toEqual(["msg-1", "msg-2"]);

    const savedOnly = searchPavraState(SNAPSHOT, "checkpoint-400000", {
      category: "saved",
      now: NOW,
    });
    expect(savedOnly.results.map((item) => item.messageId)).toEqual(["msg-1"]);

    const assistantsOnly = searchPavraState(SNAPSHOT, "OpsBot Spark", {
      category: "assistants",
      now: NOW,
    });
    expect(assistantsOnly.results.map((item) => item.assistantId)).toEqual([ASSISTANTS[0]!.id]);
    expect(assistantsOnly.results[0]?.conversationId).toBe("conv-ops");

    const conversationsOnly = searchPavraState(SNAPSHOT, "infra ReviewBot", {
      category: "conversations",
      now: NOW,
    });
    expect(conversationsOnly.results.map((item) => item.conversationId)).toEqual(["conv-infra"]);

    const tasksOnly = searchPavraState(SNAPSHOT, "throughput p99", {
      category: "tasks",
      now: NOW,
    });
    expect(tasksOnly.results.map((item) => item.taskId)).toEqual(["task-1"]);

    const routinesAndPlaybooks = searchPavraState(SNAPSHOT, "vllm 8000", {
      category: "routines_playbooks",
      now: NOW,
    });
    expect(routinesAndPlaybooks.results.map((item) => item.kind).sort()).toEqual([
      "playbook",
      "routine",
    ]);

    const studiosOnly = searchPavraState(SNAPSHOT, "bigdeploy-main Spark", {
      category: "studios",
      now: NOW,
    });
    expect(studiosOnly.results.map((item) => item.studioId)).toEqual(["studio-spark"]);
  });

  it("merges and deduplicates deep server messages with local state messages", () => {
    const serverMessages: SearchMessageInput[] = [
      // Duplicate of msg-1 already in local state
      MESSAGES[0]!,
      // Deep history message not in local state
      {
        id: "msg-deep-99",
        conversationId: "conv-ops",
        threadId: null,
        senderId: ASSISTANTS[0]!.id,
        content: "Deep history: migrated database schema v42 on Spark.",
        createdAt: NOW - 14 * 86_400_000,
        taskId: null,
        kind: "final",
      },
    ];

    const out = searchPavraState({ ...SNAPSHOT, serverMessages }, "schema v42", {
      category: "messages",
      now: NOW,
    });
    expect(out.results.map((item) => item.messageId)).toEqual(["msg-deep-99"]);

    const dupCheck = searchPavraState({ ...SNAPSHOT, serverMessages }, "checkpoint-400000", {
      category: "messages",
      now: NOW,
    });
    expect(dupCheck.results.map((item) => item.messageId)).toEqual(["msg-1"]);
  });

  it("GlobalSearchModal reuses Paseo keyboard overlay registration and obeys Unistyles & Hover standards", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const modalSource = readFileSync(path.join(dir, "ui", "GlobalSearchModal.tsx"), "utf8");
    const searchSource = readFileSync(path.join(dir, "search.ts"), "utf8");

    // Reuses Paseo keyboard overlay registration & global overlay layer
    expect(modalSource).toContain("useOverlayRegistration");
    expect(modalSource).toContain("useGlobalOverlayLayer");
    expect(modalSource).toContain('keys: ["Escape", "Enter", "ArrowUp", "ArrowDown"]');

    // Obeys docs/unistyles.md (no useUnistyles)
    expect(modalSource).not.toContain("useUnistyles");
    expect(searchSource).not.toContain("useUnistyles");

    // Obeys docs/hover.md (hover on plain View via onPointerEnter, not onHoverIn on Pressable)
    expect(modalSource).toContain("onPointerEnter");
    expect(modalSource).not.toContain("onHoverIn");

    // Includes all required category filter pills and navigation callbacks
    expect(modalSource).toContain("Routines & Playbooks");
    expect(modalSource).toContain("onSelectConversation");
    expect(modalSource).toContain("onSelectTask");
    expect(modalSource).toContain("onSelectRoutine");
    expect(modalSource).toContain("onSelectPlaybook");
    expect(modalSource).toContain("onSelectStudio");
  });
});
