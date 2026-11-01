import { describe, expect, it } from "vitest";
import { isPageItem, railActive } from "./rail";

describe("railActive", () => {
  it("highlights the hosted Paseo page", () => {
    expect(railActive("/sessions", "studio", "members")).toBe("history");
    expect(railActive("/schedules", "chat", "chat")).toBe("schedules");
  });

  it("highlights Studios over the sidebar section while Studio is open", () => {
    expect(railActive("/bigbang", "studio", "search")).toBe("studio");
    expect(railActive("/bigbang", "chat", "search")).toBe("search");
    expect(railActive("/bigbang", "chat", "chat")).toBe("chat");
  });

  it("highlights nothing on a page the rail does not name", () => {
    expect(railActive("/new", "chat", "chat")).toBeNull();
  });
});

describe("isPageItem", () => {
  it("separates Paseo pages from Bigbang screen items", () => {
    expect(isPageItem("history")).toBe(true);
    expect(isPageItem("schedules")).toBe(true);
    expect(isPageItem("studio")).toBe(false);
    expect(isPageItem("chat")).toBe(false);
  });
});
