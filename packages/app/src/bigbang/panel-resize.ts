export const SIDEBAR_RAIL_WIDTH = 56;
export const SIDEBAR_DEFAULT_WIDTH = 308;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 460;
export const SIDEBAR_COLLAPSE_THRESHOLD = 140;

export const THREAD_DEFAULT_WIDTH = 440;
export const THREAD_MIN_WIDTH = 320;
export const THREAD_MAX_WIDTH = 920;
export const MAIN_CHAT_MIN_WIDTH = 360;

export type PixelColGrow = "left" | "right";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

export function maxAllowedThreadWidth(containerWidth?: number): number {
  if (!containerWidth || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return THREAD_MAX_WIDTH;
  }
  return Math.max(
    THREAD_MIN_WIDTH,
    Math.min(THREAD_MAX_WIDTH, Math.floor(containerWidth - MAIN_CHAT_MIN_WIDTH)),
  );
}

export function clampThreadWidth(width: number, containerWidth?: number): number {
  if (!Number.isFinite(width)) {
    return clampThreadWidth(THREAD_DEFAULT_WIDTH, containerWidth);
  }
  return Math.round(
    Math.min(maxAllowedThreadWidth(containerWidth), Math.max(THREAD_MIN_WIDTH, width)),
  );
}

export function rawPixelColWidth(
  startWidth: number,
  startX: number,
  clientX: number,
  grow: PixelColGrow,
): number {
  const delta = grow === "left" ? clientX - startX : startX - clientX;
  return startWidth + delta;
}

export function nextPixelColWidth(
  startWidth: number,
  startX: number,
  clientX: number,
  grow: PixelColGrow,
  minWidth: number,
  maxWidth: number,
): number {
  const upper = Math.max(minWidth, maxWidth);
  const raw = rawPixelColWidth(startWidth, startX, clientX, grow);
  return Math.round(Math.min(upper, Math.max(minWidth, raw)));
}

/** Coalesce pointermove widths to one emit per frame; flush the last value on release. */
export function createPixelColWidthGate(publish: (width: number) => void) {
  let frame = 0;
  let pending: number | null = null;
  const emit = () => {
    const width = pending;
    pending = null;
    if (width != null) publish(width);
  };
  return {
    schedule(width: number) {
      pending = width;
      if (frame) return;
      if (typeof requestAnimationFrame !== "function") {
        emit();
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        emit();
      });
    },
    cancel() {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
    },
    flush() {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
      if (pending != null) emit();
    },
  };
}
