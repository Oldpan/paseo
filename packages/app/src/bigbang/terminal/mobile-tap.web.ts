// Migrated from Bigbang apps/app/src/mobileTerminalTap.ts
export const MOBILE_TERMINAL_DOUBLE_TAP_MS = 400;
export const MOBILE_TERMINAL_DOUBLE_TAP_SLOP_PX = 32;

export type MobileTerminalTapKind = "click" | "keyboard";

export function createMobileTerminalTapController(options?: {
  windowMs?: number;
  slopPx?: number;
  now?: () => number;
}) {
  const windowMs = options?.windowMs ?? MOBILE_TERMINAL_DOUBLE_TAP_MS;
  const slopPx = options?.slopPx ?? MOBILE_TERMINAL_DOUBLE_TAP_SLOP_PX;
  const now = options?.now ?? Date.now;
  let lastAt = 0;
  let lastX = 0;
  let lastY = 0;
  const reset = () => {
    lastAt = 0;
  };
  const recognize = (x: number, y: number): MobileTerminalTapKind => {
    const at = now();
    const dt = at - lastAt;
    const dx = x - lastX;
    const dy = y - lastY;
    const isDouble = lastAt > 0 && dt > 0 && dt <= windowMs && dx * dx + dy * dy <= slopPx * slopPx;
    if (isDouble) {
      lastAt = 0;
      return "keyboard";
    }
    lastAt = at;
    lastX = x;
    lastY = y;
    return "click";
  };
  return { recognize, reset };
}

export function findMobileTerminalTextarea(host: HTMLElement): HTMLTextAreaElement | null {
  const node = host.querySelector("textarea");
  return node instanceof HTMLTextAreaElement ? node : null;
}

export function lockMobileTerminalKeyboard(host: HTMLElement): void {
  const textarea = findMobileTerminalTextarea(host);
  if (!textarea) return;
  textarea.readOnly = true;
  textarea.inputMode = "none";
}

export function unlockMobileTerminalKeyboard(host: HTMLElement): void {
  const textarea = findMobileTerminalTextarea(host);
  if (!textarea) return;
  textarea.readOnly = false;
  textarea.inputMode = "text";
  textarea.focus({ preventScroll: true });
}

export function dismissMobileTerminalKeyboard(host: HTMLElement): void {
  const textarea = findMobileTerminalTextarea(host);
  if (!textarea) return;
  if (document.activeElement === textarea) textarea.blur();
  textarea.readOnly = true;
  textarea.inputMode = "none";
}
