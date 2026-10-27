import { describe, expect, it } from "vitest";
import {
  EMPTY_AUTONOMY,
  normalizeAutonomy,
  parseAutonomy,
  serializeAutonomy,
  validateAutonomy,
  type Autonomy,
} from "./autonomy";

const target = { serverId: "mac", directory: "/work/app", isolation: "worktree" } as const;

describe("assistant autonomy form value", () => {
  it("round-trips through the form's string value", () => {
    const autonomy: Autonomy = { enabled: true, targets: [target] };
    expect(parseAutonomy(serializeAutonomy(autonomy))).toEqual(autonomy);
    expect(parseAutonomy(serializeAutonomy(undefined))).toEqual(EMPTY_AUTONOMY);
    expect(parseAutonomy("not json")).toEqual(EMPTY_AUTONOMY);
    expect(parseAutonomy(undefined)).toEqual(EMPTY_AUTONOMY);
  });
});

describe("autonomy target validation", () => {
  const hosts = ["mac", "spark"];
  it("accepts known hosts with a directory", () => {
    expect(validateAutonomy({ enabled: true, targets: [target] }, hosts)).toBeNull();
    expect(validateAutonomy(EMPTY_AUTONOMY, hosts)).toBeNull();
  });
  it("rejects an unknown host and names the row", () => {
    expect(
      validateAutonomy(
        { enabled: true, targets: [target, { ...target, serverId: "gone" }] },
        hosts,
      ),
    ).toBe("Task target 2: choose a machine from your hosts.");
  });
  it("rejects a blank directory even while the toggle is off", () => {
    expect(
      validateAutonomy(
        { enabled: false, targets: [{ ...target, directory: "   " }] },
        hosts,
        () => "Mac",
      ),
    ).toBe("Task target 1: enter the project directory on Mac.");
  });
  it("requires a target when starting tasks is on", () => {
    expect(validateAutonomy({ enabled: true, targets: [] }, hosts)).toMatch(/at least one/);
  });
});

describe("autonomy save payload", () => {
  it("omits unused settings and trims and dedupes targets", () => {
    expect(normalizeAutonomy(EMPTY_AUTONOMY)).toBeUndefined();
    expect(
      normalizeAutonomy({
        enabled: true,
        targets: [
          target,
          { ...target, directory: " /work/app " },
          { ...target, isolation: "directory" },
        ],
      }),
    ).toEqual({ enabled: true, targets: [target, { ...target, isolation: "directory" }] });
  });
  it("records each target's machine name so the assistant can choose it by name", () => {
    const labels: Record<string, string> = { [target.serverId]: "Spark" };
    expect(
      normalizeAutonomy({ enabled: true, targets: [target] }, (serverId) => labels[serverId]),
    ).toEqual({ enabled: true, targets: [{ ...target, label: "Spark" }] });
  });
  it("keeps targets while the toggle is off so they are not lost", () => {
    expect(normalizeAutonomy({ enabled: false, targets: [target] })).toEqual({
      enabled: false,
      targets: [target],
    });
  });
});
