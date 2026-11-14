import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampSidebarWidth,
  clampThreadWidth,
  createPixelColWidthGate,
  MAIN_CHAT_MIN_WIDTH,
  maxAllowedThreadWidth,
  nextPixelColWidth,
  rawPixelColWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  THREAD_DEFAULT_WIDTH,
  THREAD_MAX_WIDTH,
  THREAD_MIN_WIDTH,
} from "./panel-resize";
import { useBigbangView } from "./store";

describe("panel-resize helpers", () => {
  it("clamps sidebar widths within [min, max] and guards non-finite input", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 50)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 80)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(342.6)).toBe(343);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("bounds thread width by both absolute limits and container remaining chat width", () => {
    expect(maxAllowedThreadWidth(undefined)).toBe(THREAD_MAX_WIDTH);
    expect(maxAllowedThreadWidth(1400)).toBe(THREAD_MAX_WIDTH);
    expect(maxAllowedThreadWidth(1000)).toBe(1000 - MAIN_CHAT_MIN_WIDTH);
    expect(maxAllowedThreadWidth(500)).toBe(THREAD_MIN_WIDTH);

    expect(clampThreadWidth(200, 1200)).toBe(THREAD_MIN_WIDTH);
    expect(clampThreadWidth(900, 1000)).toBe(1000 - MAIN_CHAT_MIN_WIDTH);
    expect(clampThreadWidth(Number.POSITIVE_INFINITY, 1000)).toBe(THREAD_DEFAULT_WIDTH);
    expect(clampThreadWidth(500, 620)).toBe(THREAD_MIN_WIDTH);
  });

  it("computes raw and clamped pixel deltas for left and right grow directions", () => {
    expect(rawPixelColWidth(308, 300, 350, "left")).toBe(358);
    expect(rawPixelColWidth(440, 800, 740, "right")).toBe(500);

    expect(nextPixelColWidth(308, 300, 100, "left", SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)).toBe(
      SIDEBAR_MIN_WIDTH,
    );
    expect(nextPixelColWidth(308, 300, 600, "left", SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)).toBe(
      SIDEBAR_MAX_WIDTH,
    );
    expect(nextPixelColWidth(440, 800, 740, "right", THREAD_MIN_WIDTH, 700)).toBe(500);
    expect(nextPixelColWidth(440, 800, 1200, "right", THREAD_MIN_WIDTH, 700)).toBe(
      THREAD_MIN_WIDTH,
    );
  });

  it("coalesces rapid updates per animation frame and flushes on release", () => {
    const published: number[] = [];
    const callbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        callbacks.push(cb);
        return callbacks.length;
      });
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    try {
      const gate = createPixelColWidthGate((width) => published.push(width));
      gate.schedule(450);
      gate.schedule(465);
      gate.schedule(482);
      expect(published).toEqual([]);
      expect(callbacks).toHaveLength(1);

      callbacks[0]?.(16);
      expect(published).toEqual([482]);

      gate.schedule(510);
      gate.schedule(525);
      gate.flush();
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(published).toEqual([482, 525]);

      gate.schedule(540);
      gate.cancel();
      gate.flush();
      expect(published).toEqual([482, 525]);
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });
});

describe("useBigbangView layout persistence state", () => {
  beforeEach(() => {
    useBigbangView.setState({
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      threadWidth: THREAD_DEFAULT_WIDTH,
      section: "chat",
    });
  });

  it("clamps sidebar and thread widths and expands sidebar when selecting a section", () => {
    const store = useBigbangView.getState();
    store.setSidebarWidth(999);
    expect(useBigbangView.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);

    store.setThreadWidth(100);
    expect(useBigbangView.getState().threadWidth).toBe(THREAD_MIN_WIDTH);

    store.setSidebarCollapsed(true);
    expect(useBigbangView.getState().sidebarCollapsed).toBe(true);

    store.setSection("members");
    expect(useBigbangView.getState().section).toBe("members");
    expect(useBigbangView.getState().sidebarCollapsed).toBe(false);
  });
});
