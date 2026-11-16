import { describe, expect, it } from "vitest";
import {
  ASSISTANT_TOOL_FAMILIES,
  formatContextPercent,
  formatEnvVarsText,
  formatProviderUsageSummary,
  formatTokenCount,
  getContextUsageMetrics,
  isAssistantToolEnabled,
  normalizeDisabledTools,
  parseEnvVarsText,
  resolveLatestAssistantTurnExecution,
  toggleAssistantToolFamily,
} from "./token-usage";

describe("pavra token-usage engine", () => {
  it("computes context usage metrics from Paseo AgentUsage fields", () => {
    const normal = getContextUsageMetrics({
      contextWindowUsedTokens: 56_200,
      contextWindowMaxTokens: 200_000,
      inputTokens: 82_000,
      outputTokens: 4_100,
    });
    expect(normal).toEqual({
      usedTokens: 56_200,
      windowTokens: 200_000,
      remainingTokens: 143_800,
      usedPercent: 28.1,
      barPercent: 28.1,
      ratio: 0.281,
      tone: "normal",
      shouldSuggestCompact: false,
    });

    const warning = getContextUsageMetrics({
      contextWindowUsedTokens: 130_000,
      contextWindowMaxTokens: 200_000,
    });
    expect(warning?.tone).toBe("warning");
    expect(warning?.shouldSuggestCompact).toBe(false);

    const critical = getContextUsageMetrics({
      contextWindowUsedTokens: 164_000,
      contextWindowMaxTokens: 200_000,
    });
    expect(critical?.tone).toBe("critical");
    expect(critical?.shouldSuggestCompact).toBe(true);
    expect(critical?.ratio).toBeCloseTo(0.82, 5);
  });

  it("supports legacy Bigbang usage fields and returns null when window is missing", () => {
    const legacy = getContextUsageMetrics({
      currentInputTokens: 700,
      modelContextWindow: 1_000,
    });
    expect(legacy).toMatchObject({
      usedTokens: 700,
      windowTokens: 1_000,
      remainingTokens: 300,
      usedPercent: 70,
      tone: "warning",
      shouldSuggestCompact: false,
    });

    expect(getContextUsageMetrics(null)).toBeNull();
    expect(getContextUsageMetrics({ inputTokens: 500, outputTokens: 200 })).toBeNull();
    expect(
      getContextUsageMetrics({ contextWindowUsedTokens: 500, contextWindowMaxTokens: 0 }),
    ).toBeNull();
  });

  it("formats compact token counts and percentages", () => {
    expect(formatTokenCount(undefined)).toBeNull();
    expect(formatTokenCount(-10)).toBeNull();
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(850)).toBe("850");
    expect(formatTokenCount(1_200)).toBe("1.2k");
    expect(formatTokenCount(56_200)).toBe("56.2k");
    expect(formatTokenCount(200_000)).toBe("200k");
    expect(formatTokenCount(1_500_000)).toBe("1.5m");

    expect(formatContextPercent(0)).toBe("0%");
    expect(formatContextPercent(0.4)).toBe("<1%");
    expect(formatContextPercent(28.1)).toBe("28%");
    expect(formatContextPercent(84.6)).toBe("85%");

    expect(
      formatProviderUsageSummary({
        contextWindowUsedTokens: 56_200,
        contextWindowMaxTokens: 200_000,
      }),
    ).toBe("Context · 56.2k / 200k · 28%");
  });

  it("parses and formats assistant environment variables (KEY=VALUE and export KEY=VALUE)", () => {
    const raw = [
      "# API configuration",
      "API_URL=https://api.example.com/v1",
      "export RUST_LOG='debug'",
      'GREETING="hello world"',
      "not a valid line",
      "123_INVALID=bad",
      "",
    ].join("\n");

    const parsed = parseEnvVarsText(raw);
    expect(parsed.envVars).toEqual({
      API_URL: "https://api.example.com/v1",
      GREETING: "hello world",
      RUST_LOG: "debug",
    });
    expect(parsed.ignoredLines).toEqual(["not a valid line", "123_INVALID=bad"]);
    expect(parsed.invalidLines).toEqual(["not a valid line", "123_INVALID=bad"]);

    const formatted = formatEnvVarsText(parsed.envVars);
    expect(formatted).toBe(
      ["API_URL=https://api.example.com/v1", "GREETING=hello world", "RUST_LOG=debug"].join("\n"),
    );
    expect(parseEnvVarsText(formatted).envVars).toEqual(parsed.envVars);
  });

  it("toggles and normalizes assistant tool family permissions", () => {
    expect(ASSISTANT_TOOL_FAMILIES.map((item) => item.id)).toEqual([
      "mailbox",
      "tasks",
      "routines",
      "browser",
      "phone",
    ]);
    expect(ASSISTANT_TOOL_FAMILIES.find((item) => String(item.id) === "phone")).toMatchObject({
      id: "phone",
      label: "Phone Control",
      description:
        "Operate Android apps on a background virtual display with floating mini-window monitoring",
    });
    expect(normalizeDisabledTools(undefined)).toBeUndefined();
    expect(normalizeDisabledTools(["mailbox", "invalid", "mailbox", "browser", "phone"])).toEqual([
      "mailbox",
      "browser",
      "phone",
    ]);

    expect(isAssistantToolEnabled("mailbox", undefined)).toBe(true);
    expect(isAssistantToolEnabled("mailbox", ["mailbox"])).toBe(false);
    expect(isAssistantToolEnabled("tasks", ["mailbox"])).toBe(true);
    expect(isAssistantToolEnabled("phone", undefined)).toBe(true);
    expect(isAssistantToolEnabled("phone", ["phone"])).toBe(false);

    const disabledOne = toggleAssistantToolFamily("browser", undefined);
    expect(disabledOne).toEqual(["browser"]);
    const disabledTwo = toggleAssistantToolFamily("mailbox", disabledOne);
    expect(disabledTwo).toEqual(["browser", "mailbox"]);
    const disabledThree = toggleAssistantToolFamily("phone", disabledTwo);
    expect(disabledThree).toEqual(["browser", "mailbox", "phone"]);
    const reenabledPhone = toggleAssistantToolFamily("phone", disabledThree);
    expect(reenabledPhone).toEqual(["browser", "mailbox"]);
    const reenabled = toggleAssistantToolFamily("browser", reenabledPhone);
    expect(reenabled).toEqual(["mailbox"]);
    expect(toggleAssistantToolFamily("mailbox", reenabled)).toBeUndefined();
  });

  it("resolves the latest non-task assistant turn execution for a lane or assistant", () => {
    const turns = [
      {
        id: "t-1",
        conversationId: "conv-1",
        threadId: null,
        assistantId: "a-1",
        prompt: "hi",
        status: "completed" as const,
        agentId: "agent-root-1",
        serverId: "spark",
        error: null,
      },
      {
        id: "t-task",
        conversationId: "conv-1",
        threadId: null,
        assistantId: "a-1",
        taskId: "task-99",
        prompt: "task",
        status: "running" as const,
        agentId: "agent-task-99",
        serverId: "spark",
        error: null,
      },
      {
        id: "t-2",
        conversationId: "conv-1",
        threadId: "thread-1",
        assistantId: "a-1",
        prompt: "in thread",
        status: "completed" as const,
        agentId: "agent-thread-1",
        error: null,
      },
    ];

    expect(
      resolveLatestAssistantTurnExecution({
        turns,
        assistantId: "a-1",
        conversationId: "conv-1",
        threadId: null,
        coordinatorId: "mac",
      }),
    ).toEqual({ serverId: "spark", agentId: "agent-root-1" });

    expect(
      resolveLatestAssistantTurnExecution({
        turns,
        assistantId: "a-1",
        conversationId: "conv-1",
        threadId: "thread-1",
        assistantServerId: "spark",
        coordinatorId: "mac",
      }),
    ).toEqual({ serverId: "spark", agentId: "agent-thread-1" });
  });
});
