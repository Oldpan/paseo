import { describe, expect, it } from "vitest";
import {
  formatMessageRoutineBadge,
  formatRoutineCadence,
  formatRoutineOutcome,
  routineKindLabel,
  routineTargetLabel,
} from "./routines";

describe("Pavra routine UI helpers", () => {
  it("formats interval and cron cadences", () => {
    expect(formatRoutineCadence({ type: "every", everyMs: 60_000 })).toBe("Every minute");
    expect(formatRoutineCadence({ type: "every", everyMs: 900_000 })).toBe("Every 15m");
    expect(formatRoutineCadence({ type: "every", everyMs: 3_600_000 })).toBe("Every hour");
    expect(formatRoutineCadence({ type: "every", everyMs: 7_200_000 })).toBe("Every 2h");
    expect(formatRoutineCadence({ type: "every", everyMs: 86_400_000 })).toBe("Every day");
    expect(formatRoutineCadence({ type: "cron", expression: "0 9 * * *" })).toBe("Cron 0 9 * * *");
    expect(
      formatRoutineCadence({
        type: "cron",
        expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
      }),
    ).toBe("Cron 0 9 * * * (Asia/Shanghai)");
  });

  it("formats routine run outcomes", () => {
    expect(formatRoutineOutcome(undefined)).toBe("Never run");
    expect(
      formatRoutineOutcome({
        id: "r1",
        scheduledFor: 1,
        startedAt: 1,
        endedAt: null,
        status: "running",
        outcome: null,
        turnId: "t1",
        summary: null,
        error: null,
      }),
    ).toBe("Running…");
    expect(
      formatRoutineOutcome({
        id: "r2",
        scheduledFor: 1,
        startedAt: 1,
        endedAt: 2,
        status: "succeeded",
        outcome: "passed",
        turnId: "t1",
        summary: "Silent ((pass))",
        error: null,
      }),
    ).toBe("Silent ((pass))");
    expect(
      formatRoutineOutcome({
        id: "r3",
        scheduledFor: 1,
        startedAt: 1,
        endedAt: 2,
        status: "succeeded",
        outcome: "replied",
        turnId: "t2",
        summary: "Disk usage at 91%",
        error: null,
      }),
    ).toBe("Replied · Disk usage at 91%");
    expect(
      formatRoutineOutcome({
        id: "r4",
        scheduledFor: 1,
        startedAt: 1,
        endedAt: 2,
        status: "succeeded",
        outcome: "skipped",
        turnId: null,
        summary: "Skipped: host_offline",
        error: null,
      }),
    ).toBe("Skipped: host_offline");
    expect(
      formatRoutineOutcome({
        id: "r5",
        scheduledFor: 1,
        startedAt: 1,
        endedAt: 2,
        status: "failed",
        outcome: "failed",
        turnId: "t3",
        summary: "Timeout",
        error: "Timeout",
      }),
    ).toBe("Failed · Timeout");
  });

  it("distinguishes one-time reminders from recurring routines and formats target and message badges", () => {
    expect(routineKindLabel({ maxRuns: 1 })).toBe("Reminder");
    expect(routineKindLabel({ maxRuns: null })).toBe("Routine");
    expect(routineKindLabel({ maxRuns: 5 })).toBe("Routine");

    const assistants = [{ id: "a1", name: "Sky", provider: "codex/default", persona: "" }];
    const conversations = [
      { id: "c1", name: "General", kind: "group" as const, members: ["a1"], roundtable: false },
      { id: "c2", name: "Sky", kind: "dm" as const, members: ["a1"], roundtable: false },
    ];
    expect(
      routineTargetLabel({ assistantId: "a1", conversationId: "c1" }, assistants, conversations),
    ).toBe("Sky · #General");
    expect(
      routineTargetLabel({ assistantId: "a1", conversationId: "c2" }, assistants, conversations),
    ).toBe("Sky · Sky");

    expect(formatMessageRoutineBadge({ routineId: "r1", routineName: "早间汇总" })).toBe(
      "Routine · 早间汇总",
    );
    expect(formatMessageRoutineBadge({}, { kind: "routine", routineName: "Daily check" })).toBe(
      "Routine · Daily check",
    );
    expect(formatMessageRoutineBadge({}, { kind: "reply" })).toBeUndefined();
  });
});
