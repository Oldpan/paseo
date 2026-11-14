import { describe, expect, it } from "vitest";
import { isMemoryConflict } from "./memory";

describe("memory conflicts", () => {
  it("recognises the coordinator's stale-mtime rejection", () => {
    expect(
      isMemoryConflict(
        new Error("The memory changed since it was loaded. Reload it and try again."),
      ),
    ).toBe(true);
    expect(isMemoryConflict(new Error("The Chat coordinator is offline."))).toBe(false);
    expect(isMemoryConflict("changed since it was loaded")).toBe(false);
  });
});
