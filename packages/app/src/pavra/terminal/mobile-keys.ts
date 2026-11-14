// Migrated from Bigbang apps/app/src/mobileTerminalKeys.ts
export interface MobileTerminalModifiers {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const EMPTY_MOBILE_TERMINAL_MODIFIERS: MobileTerminalModifiers = {
  ctrl: false,
  shift: false,
  alt: false,
};

const ARROW_FINAL: Record<string, string> = {
  "\x1b[A": "A",
  "\x1b[B": "B",
  "\x1b[C": "C",
  "\x1b[D": "D",
};

const SHIFT_SYMBOL: Record<string, string> = {
  "/": "?",
  "-": "_",
  "|": "\\",
};

export function mobileTerminalModifierParam(mods: MobileTerminalModifiers): number | null {
  const value = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
  return value === 1 ? null : value;
}

export function anyMobileTerminalModifier(mods: MobileTerminalModifiers): boolean {
  return mods.ctrl || mods.shift || mods.alt;
}

export function encodeMobileTerminalKey(data: string, mods: MobileTerminalModifiers): string {
  if (!anyMobileTerminalModifier(mods)) return data;
  const arrow = ARROW_FINAL[data];
  if (arrow) {
    const mod = mobileTerminalModifierParam(mods);
    return mod ? `\x1b[1;${mod}${arrow}` : data;
  }
  if (data === "\x1b[3~") {
    const mod = mobileTerminalModifierParam(mods);
    return mod ? `\x1b[3;${mod}~` : data;
  }
  if (data === "\t") {
    if (mods.shift && !mods.ctrl && !mods.alt) return "\x1b[Z";
    return data;
  }
  if (data === "\x1b") return mods.alt ? "\x1b\x1b" : data;
  if (data.length !== 1) return data;
  return encodePrintableKey(data, mods);
}

function encodePrintableKey(data: string, mods: MobileTerminalModifiers): string {
  let ch = data;
  if (mods.shift && SHIFT_SYMBOL[ch]) ch = SHIFT_SYMBOL[ch]!;
  if (mods.ctrl) {
    const code = ch.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) ch = String.fromCharCode(code & 0x1f);
  }
  if (mods.alt) {
    let payload = ch;
    if (!mods.ctrl && /[A-Za-z]/.test(data)) payload = data.toLowerCase();
    return `\x1b${payload}`;
  }
  return ch;
}

export function encodeMobileTerminalDomKey(
  key: string,
  mods: MobileTerminalModifiers,
): string | null {
  switch (key) {
    case "ArrowUp":
      return encodeMobileTerminalKey("\x1b[A", mods);
    case "ArrowDown":
      return encodeMobileTerminalKey("\x1b[B", mods);
    case "ArrowRight":
      return encodeMobileTerminalKey("\x1b[C", mods);
    case "ArrowLeft":
      return encodeMobileTerminalKey("\x1b[D", mods);
    case "Tab":
      return encodeMobileTerminalKey("\t", mods);
    case "Escape":
      return encodeMobileTerminalKey("\x1b", mods);
    case "Delete":
      return encodeMobileTerminalKey("\x1b[3~", mods);
    case "Enter":
      return "\r";
    case "Backspace":
      return mods.ctrl ? "\x17" : "\x7f";
    default:
      if (key.length === 1) return encodeMobileTerminalKey(key, mods);
      return null;
  }
}
