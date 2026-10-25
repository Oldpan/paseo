import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { encodeTerminalBytes } from "./bridge";
import { encodeMobileTerminalDomKey } from "./mobile-keys";
import { copyShortcutShouldSuppressPty } from "./copy-keys";

describe("Bigbang terminal input and transport", () => {
  it("preserves bytes when a Chinese code point is split between PTY frames", () => {
    const original = new TextEncoder().encode("A你好🙂Z");
    const first = Buffer.from(encodeTerminalBytes(original.subarray(0, 3)), "base64");
    const second = Buffer.from(encodeTerminalBytes(original.subarray(3)), "base64");
    expect(new Uint8Array(Buffer.concat([first, second]))).toEqual(original);
  });
  it("encodes mobile control and modified arrow keys", () => {
    const ctrl = { ctrl: true, shift: false, alt: false };
    expect(encodeMobileTerminalDomKey("c", ctrl)).toBe("\x03");
    expect(encodeMobileTerminalDomKey("ArrowUp", ctrl)).toBe("\x1b[1;5A");
    expect(encodeMobileTerminalDomKey("Backspace", ctrl)).toBe("\x17");
    expect(encodeMobileTerminalDomKey("Tab", { ...ctrl, ctrl: false, shift: true })).toBe("\x1b[Z");
  });
  it("copies selected text while preserving Ctrl+C as SIGINT without a selection", () => {
    expect(copyShortcutShouldSuppressPty({ key: "c", ctrlKey: true }, true)).toBe(true);
    expect(copyShortcutShouldSuppressPty({ key: "c", ctrlKey: true }, false)).toBe(false);
    expect(copyShortcutShouldSuppressPty({ key: "c", ctrlKey: true, shiftKey: true }, true)).toBe(
      false,
    );
  });
});
