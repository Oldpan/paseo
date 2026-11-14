import { describe, expect, it } from "vitest";
import {
  isPlaybookConflict,
  normalizePlaybookSlug,
  playbookTemplate,
  titleFromSlug,
} from "./playbooks";

describe("playbook helpers", () => {
  it("normalizes raw playbook slugs to lowercase alphanumeric and hyphens", () => {
    expect(normalizePlaybookSlug("Daily Health Check")).toBe("daily-health-check");
    expect(normalizePlaybookSlug("  daily_health.md  ")).toBe("daily-health");
    expect(normalizePlaybookSlug("---Release__Check---")).toBe("release-check");
    expect(normalizePlaybookSlug("...")).toBe("");
  });

  it("derives human titles and initial markdown templates from slugs", () => {
    expect(titleFromSlug("daily-health-check")).toBe("Daily Health Check");
    expect(playbookTemplate("daily-health")).toBe("# Daily Health\n\n## Goal\n\n## Steps\n1. \n");
  });

  it("recognizes stale-mtime rejections on playbook writes", () => {
    expect(
      isPlaybookConflict(
        new Error("The playbook changed since it was loaded. Reload it and try again."),
      ),
    ).toBe(true);
    expect(isPlaybookConflict(new Error("The Chat coordinator is offline."))).toBe(false);
    expect(isPlaybookConflict("changed since it was loaded")).toBe(false);
  });
});
