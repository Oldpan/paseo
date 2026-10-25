"use dom";

import { encodeTerminalBytes, type EncodedTerminalFile } from "@/bigbang/terminal/bridge";

import {
  createMobileTerminalTapController,
  lockMobileTerminalKeyboard,
  unlockMobileTerminalKeyboard,
} from "@/bigbang/terminal/mobile-tap.web";

import type {
  TerminalFindHandle,
  TerminalFindResult,
} from "../terminal/runtime/terminal-emulator-runtime";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import type { DOMProps } from "expo/dom";
import { useDOMImperativeHandle, type DOMImperativeFactory } from "expo/dom";
import "@xterm/xterm/css/xterm.css";
import type { ITheme } from "@xterm/xterm";
import type { TerminalState } from "@getpaseo/protocol/messages";
import type { TerminalInputModeState } from "@getpaseo/protocol/terminal-input-mode";
import type { PendingTerminalModifiers } from "../utils/terminal-keys";
import {
  TerminalEmulatorRuntime,
  type TerminalOutputData,
} from "../terminal/runtime/terminal-emulator-runtime";
import { encodeTerminalPaste } from "../terminal/runtime/terminal-paste";
import type { TerminalFile } from "../terminal/file-paste";
import type {
  TerminalLocalFileLinkSource,
  TerminalLocalFileLinkTarget,
} from "../terminal/local-links/terminal-local-link-provider";
import type { TerminalClipboardWriter } from "../terminal/native-renderer/terminal-selection";
import type { TerminalRendererReadyChange } from "../utils/terminal-renderer-readiness";
import { openExternalUrl } from "../utils/open-external-url";
import { focusWithRetries } from "../utils/web-focus";

export interface TerminalEmulatorHandle {
  find?: TerminalFindHandle;
  writeOutput: (data: TerminalOutputData) => void;
  restoreOutput: (data: TerminalOutputData) => void;
  renderSnapshot: (state: TerminalState | null) => void;
  paste: (text: string) => void;
  copySelection: (clipboard: TerminalClipboardWriter) => Promise<string>;
  clear: () => void;
  claimSize: () => void;
  showKeyboard: () => void;
  blur: () => void;
}

const HOST_DIV_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  overscrollBehavior: "none",
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  paddingRight: 0,
};

function decodeTerminalBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function buildXtermThemeKey(theme: ITheme): string {
  const values: Array<string> = [
    theme.background,
    theme.foreground,
    theme.cursor,
    theme.cursorAccent,
    theme.selectionBackground,
    theme.selectionForeground,
    theme.black,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
    theme.white,
    theme.brightBlack,
    theme.brightRed,
    theme.brightGreen,
    theme.brightYellow,
    theme.brightBlue,
    theme.brightMagenta,
    theme.brightCyan,
    theme.brightWhite,
  ].map((value) => (typeof value === "string" ? value : ""));

  return values.join("|");
}

interface TerminalEmulatorProps {
  dom?: DOMProps;
  ref: Ref<TerminalEmulatorHandle>;
  streamKey: string;
  supportsTerminalInputModeReplay: boolean;
  testId?: string;
  xtermTheme?: ITheme;
  scrollbackLines: number;
  fontFamily?: string;
  fontSize?: number;
  keyboardInset?: number;
  isKeyboardVisible?: boolean;
  swipeGesturesEnabled?: boolean;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  initialSnapshot?: TerminalState | null;
  onFindRequest?: () => void;
  onFindResult?: (result: TerminalFindResult) => void;
  onInput?: (data: string) => Promise<void> | void;
  onFocus?: () => Promise<void> | void;
  onResize?: (input: {
    rows: number;
    cols: number;
    shouldClaim: boolean;
    forceClaim?: boolean;
  }) => Promise<void> | void;
  onTerminalKey?: (input: {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
  }) => Promise<void> | void;
  onPendingModifiersConsumed?: () => Promise<void> | void;
  onInputModeChange?: (state: TerminalInputModeState) => Promise<void> | void;
  onSelectionChange?: (hasSelection: boolean) => void;
  onResolveLocalFileLink?: (
    source: TerminalLocalFileLinkSource,
  ) => Promise<TerminalLocalFileLinkTarget | null> | TerminalLocalFileLinkTarget | null;
  onOpenLocalFileLink?: (
    target: TerminalLocalFileLinkTarget,
    disposition: "main" | "side",
  ) => Promise<void> | void;
  onRendererReadyChange?: (change: TerminalRendererReadyChange) => void;
  onFilePaste?: (file: Promise<TerminalFile | null>) => void;
  onEncodedFilePaste?: (file: EncodedTerminalFile) => Promise<void>;
  onOpenExternalUrl?: (url: string) => Promise<void> | void;
  onScopedInput?: (streamKey: string, data: string) => Promise<void>;
  pendingModifiers?: PendingTerminalModifiers;
  focusRequestToken?: number;
  resizeRequestToken?: number;
}

declare global {
  interface Window {}
}

function isTerminalState(value: unknown): value is TerminalState {
  return (
    typeof value === "object" &&
    value !== null &&
    "rows" in value &&
    "cols" in value &&
    "grid" in value
  );
}

export default function TerminalEmulator({
  ref,
  streamKey,
  testId = "terminal-surface",
  xtermTheme = {
    background: "#0b0b0b",
    foreground: "#e6e6e6",
    cursor: "#e6e6e6",
  },
  scrollbackLines,
  fontFamily,
  fontSize,
  swipeGesturesEnabled = false,
  onSwipeLeft,
  onSwipeRight,
  initialSnapshot = null,
  onFindRequest,
  onFindResult,
  onInput,
  onFocus,
  onResize,
  onTerminalKey,
  onPendingModifiersConsumed,
  onInputModeChange,
  onResolveLocalFileLink,
  onOpenLocalFileLink,
  onRendererReadyChange,
  onFilePaste,
  onEncodedFilePaste,
  onScopedInput,
  onOpenExternalUrl = openExternalUrl,
  pendingModifiers = { ctrl: false, shift: false, alt: false },
  focusRequestToken = 0,
  resizeRequestToken = 0,
}: TerminalEmulatorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<TerminalEmulatorRuntime | null>(null);
  const mountedThemeRef = useRef<ITheme>(xtermTheme);
  const fontFamilyRef = useRef(fontFamily);
  const fontSizeRef = useRef(fontSize);
  const scrollbackLinesRef = useRef(scrollbackLines);
  scrollbackLinesRef.current = scrollbackLines;
  fontFamilyRef.current = fontFamily;
  fontSizeRef.current = fontSize;
  const themeKey = useMemo(() => buildXtermThemeKey(xtermTheme), [xtermTheme]);
  const xtermThemeRef = useRef(xtermTheme);
  xtermThemeRef.current = xtermTheme;
  const streamKeyRef = useRef(streamKey);
  streamKeyRef.current = streamKey;
  const scopedInput = useCallback(
    (data: string) => {
      if (onScopedInput) void onScopedInput(streamKey, data);
      else void onInput?.(data);
    },
    [onInput, onScopedInput, streamKey],
  );
  const scopedFilePaste = useCallback(
    (file: Promise<TerminalFile | null>) => {
      if (!onEncodedFilePaste) {
        onFilePaste?.(file);
        return;
      }
      void file
        .then((value) =>
          onEncodedFilePaste({
            streamKey,
            file: value
              ? {
                  fileName: value.fileName,
                  mimeType: value.mimeType,
                  base64: encodeTerminalBytes(value.bytes),
                }
              : null,
          }),
        )
        .catch((error: unknown) => onEncodedFilePaste({ streamKey, error: String(error) }));
    },
    [onEncodedFilePaste, onFilePaste, streamKey],
  );
  const onRendererReadyChangeRef = useRef(onRendererReadyChange);
  onRendererReadyChangeRef.current = onRendererReadyChange;
  const mountCallbacksRef = useRef({
    onFindRequest,
    onFindResult,
    onInput: scopedInput,
    onResize,
    onTerminalKey,
    onPendingModifiersConsumed,
    onInputModeChange,
    onResolveLocalFileLink,
    onOpenLocalFileLink,
    onFilePaste: scopedFilePaste,
    onOpenExternalUrl,
  });
  mountCallbacksRef.current = {
    onFindRequest,
    onFindResult,
    onInput: scopedInput,
    onResize,
    onTerminalKey,
    onPendingModifiersConsumed,
    onInputModeChange,
    onResolveLocalFileLink,
    onOpenLocalFileLink,
    onFilePaste: scopedFilePaste,
    onOpenExternalUrl,
  };
  const initialSnapshotRef = useRef(initialSnapshot);
  initialSnapshotRef.current = initialSnapshot;
  const pendingModifiersRef = useRef(pendingModifiers);
  pendingModifiersRef.current = pendingModifiers;

  const domBridgeRef = useRef<DOMImperativeFactory | null>(null);
  const pasteText = useCallback((text: string) => {
    if (text.length === 0) {
      return;
    }
    mountCallbacksRef.current.onInput?.(
      encodeTerminalPaste({
        text,
        bracketedPaste: runtimeRef.current?.getInputModeState().bracketedPaste ?? false,
      }),
    );
  }, []);

  useDOMImperativeHandle(
    domBridgeRef,
    (): DOMImperativeFactory => ({
      writeEncodedOutput: (...args) => {
        if (args[0] !== streamKeyRef.current) return;
        if (typeof args[1] === "string")
          runtimeRef.current?.write({ data: decodeTerminalBytes(args[1] as string) });
      },
      restoreEncodedOutput: (...args) => {
        if (args[0] !== streamKeyRef.current) return;
        if (typeof args[1] === "string")
          runtimeRef.current?.restoreOutput({ data: decodeTerminalBytes(args[1] as string) });
      },
      findSearch: (...args) => {
        if (typeof args[0] === "string")
          runtimeRef.current?.find.search(args[0], args[1] === "previous" ? "previous" : "next");
      },
      findClear: () => runtimeRef.current?.find.clear(),
      findSize: (...args) => {
        if (typeof args[0] === "number" && typeof args[1] === "number")
          runtimeRef.current?.find.setWidgetSize({ width: args[0], height: args[1] });
      },
      readSelection: () => runtimeRef.current?.selectionText() ?? "",
      writeOutput: (...args) => {
        const data = args[0];
        if (data instanceof Uint8Array) runtimeRef.current?.write({ data });
      },
      restoreOutput: (...args) => {
        const data = args[0];
        if (data instanceof Uint8Array) runtimeRef.current?.restoreOutput({ data });
      },
      renderSnapshot: (...args) => {
        const state = args[0];
        if (state === null) {
          runtimeRef.current?.renderSnapshot({ state: null });
        } else if (isTerminalState(state)) {
          runtimeRef.current?.renderSnapshot({ state });
        }
      },
      paste: (...args) => {
        const text = args[0];
        if (typeof text === "string" && text.length > 0) {
          pasteText(text);
        }
      },
      copySelection: async () => "",
      clear: () => {
        runtimeRef.current?.clear();
      },
      claimSize: () => {
        runtimeRef.current?.resize({ forceClaim: true, shouldClaim: true });
      },
      showKeyboard: () => {
        if (hostRef.current) unlockMobileTerminalKeyboard(hostRef.current);
        runtimeRef.current?.resize({ forceClaim: true, shouldClaim: true });
        runtimeRef.current?.focus();
      },
      blur: () => {
        if (hostRef.current && window.ReactNativeWebView)
          lockMobileTerminalKeyboard(hostRef.current);
        runtimeRef.current?.blur();
      },
    }),
    [pasteText],
  );
  useImperativeHandle(
    ref,
    (): TerminalEmulatorHandle => ({
      find: {
        setWidgetSize: (size) => runtimeRef.current?.find.setWidgetSize(size),
        search: (query, direction) => runtimeRef.current?.find.search(query, direction),
        clear: () => runtimeRef.current?.find.clear(),
      },
      writeOutput: (data: TerminalOutputData) => {
        runtimeRef.current?.write({ data });
      },
      restoreOutput: (data: TerminalOutputData) => {
        runtimeRef.current?.restoreOutput({ data });
      },
      renderSnapshot: (state: TerminalState | null) => {
        runtimeRef.current?.renderSnapshot({ state });
      },
      paste: (text: string) => {
        pasteText(text);
      },
      copySelection: async () => "",
      clear: () => {
        runtimeRef.current?.clear();
      },
      claimSize: () => {
        runtimeRef.current?.resize({ forceClaim: true, shouldClaim: true });
      },
      showKeyboard: () => {
        if (hostRef.current) unlockMobileTerminalKeyboard(hostRef.current);
        runtimeRef.current?.resize({ forceClaim: true, shouldClaim: true });
        runtimeRef.current?.focus();
      },
      blur: () => {
        if (hostRef.current && window.ReactNativeWebView)
          lockMobileTerminalKeyboard(hostRef.current);
        runtimeRef.current?.blur();
      },
    }),
    [pasteText],
  );

  useEffect(() => {
    const nextTheme = xtermThemeRef.current;
    mountedThemeRef.current = nextTheme;
    runtimeRef.current?.setTheme({ theme: nextTheme });
  }, [themeKey]);

  useEffect(() => {
    runtimeRef.current?.setScrollback({ lines: scrollbackLines });
  }, [scrollbackLines]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !swipeGesturesEnabled) {
      return () => {};
    }

    const SWIPE_MIN_PX = 22;
    const VERTICAL_CANCEL_PX = 12;
    const HORIZONTAL_DOMINANCE_RATIO = 1.2;

    let tracking = false;
    let activePointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let fired = false;

    const reset = () => {
      tracking = false;
      activePointerId = null;
      startX = 0;
      startY = 0;
      fired = false;
    };

    const shouldTreatAsVertical = (dx: number, dy: number) => {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDy < VERTICAL_CANCEL_PX) {
        return false;
      }
      return absDy > absDx;
    };

    const shouldTreatAsHorizontal = (dx: number, dy: number) => {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < SWIPE_MIN_PX) {
        return false;
      }
      if (absDy === 0) {
        return true;
      }
      return absDx / absDy >= HORIZONTAL_DOMINANCE_RATIO;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) {
        return;
      }
      tracking = true;
      fired = false;
      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking || fired) {
        return;
      }
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (shouldTreatAsVertical(dx, dy)) {
        reset();
        return;
      }

      if (!shouldTreatAsHorizontal(dx, dy)) {
        return;
      }

      fired = true;

      if (dx > 0) {
        onSwipeRight?.();
      } else {
        onSwipeLeft?.();
      }

      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      reset();
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      reset();
    };

    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    root.addEventListener("pointermove", onPointerMove, { passive: false });
    root.addEventListener("pointerup", onPointerUp, { passive: true });
    root.addEventListener("pointercancel", onPointerCancel, { passive: true });

    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [onSwipeLeft, onSwipeRight, swipeGesturesEnabled]);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) {
      return () => {};
    }

    const runtime = new TerminalEmulatorRuntime();
    runtimeRef.current = runtime;
    runtime.setCallbacks({
      callbacks: {
        ...mountCallbacksRef.current,
      },
    });
    runtime.setPendingModifiers({ pendingModifiers: pendingModifiersRef.current });
    runtime.mount({
      root,
      host,
      initialSnapshot: initialSnapshotRef.current,
      scrollback: scrollbackLinesRef.current,
      theme: mountedThemeRef.current,
      fontFamily: fontFamilyRef.current,
      fontSize: fontSizeRef.current,
    });
    const removeMobileKeyboard = installBigbangMobileKeyboard(host, () => runtime.focus());
    onRendererReadyChangeRef.current?.({ streamKey, isReady: true });

    return () => {
      removeMobileKeyboard();
      runtime.unmount();
      onRendererReadyChangeRef.current?.({ streamKey, isReady: false });
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [streamKey]);

  useEffect(() => {
    runtimeRef.current?.setCallbacks({
      callbacks: {
        onFindRequest,
        onFindResult,
        onInput: scopedInput,
        onResize,
        onTerminalKey,
        onPendingModifiersConsumed,
        onInputModeChange,
        onResolveLocalFileLink,
        onOpenLocalFileLink,
        onFilePaste: scopedFilePaste,
        onOpenExternalUrl,
      },
    });
  }, [
    onFindRequest,
    scopedFilePaste,
    onFindResult,
    scopedInput,
    onInputModeChange,
    onOpenLocalFileLink,
    onPendingModifiersConsumed,
    onResolveLocalFileLink,
    onResize,
    onTerminalKey,
    onOpenExternalUrl,
  ]);

  useEffect(() => {
    runtimeRef.current?.setPendingModifiers({ pendingModifiers });
  }, [pendingModifiers]);

  useEffect(() => {
    runtimeRef.current?.setFont({ fontFamily, fontSize });
  }, [fontFamily, fontSize]);

  useEffect(() => {
    if (focusRequestToken <= 0) {
      return () => {};
    }
    runtimeRef.current?.resize({ forceClaim: true, shouldClaim: true });
    return focusWithRetries({
      focus: () => {
        runtimeRef.current?.focus();
      },
      isFocused: () => {
        const root = rootRef.current;
        if (!root) {
          return false;
        }
        const active = typeof document !== "undefined" ? document.activeElement : null;
        return active instanceof HTMLElement && root.contains(active);
      },
    });
  }, [focusRequestToken]);

  useEffect(() => {
    if (resizeRequestToken <= 0) {
      return;
    }
    runtimeRef.current?.resize({ forceClaim: false, shouldClaim: false });
  }, [resizeRequestToken]);

  const showTerminalContextMenu = useCallback(() => {
    const showContextMenu = window.paseoDesktop?.menu?.showContextMenu;
    if (typeof showContextMenu !== "function") {
      return;
    }

    const hasSelection = Boolean(window.getSelection()?.toString());
    void showContextMenu({
      kind: "terminal",
      hasSelection,
    });
  }, []);

  const handleRootPointerDown = useCallback(() => {
    onFocus?.();
    runtimeRef.current?.focus();
  }, [onFocus]);

  const handleRootContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      showTerminalContextMenu();
    },
    [showTerminalContextMenu],
  );

  const rootDivStyle = useMemo<CSSProperties>(
    () => ({
      position: "relative",
      display: "flex",
      width: "100%",
      height: "100%",
      minHeight: 0,
      minWidth: 0,
      backgroundColor: xtermTheme.background ?? "#0b0b0b",
      overflow: "hidden",
      overscrollBehavior: "none",
      touchAction: "pan-y",
    }),
    [xtermTheme.background],
  );
  return (
    <div
      ref={rootRef}
      data-testid={testId}
      data-terminal-scrollbar-root="true"
      style={rootDivStyle}
      onPointerDown={handleRootPointerDown}
      onContextMenu={handleRootContextMenu}
    >
      <div ref={hostRef} style={HOST_DIV_STYLE} />
    </div>
  );
}

function installBigbangMobileKeyboard(host: HTMLElement, focus: () => void): () => void {
  if (process.env.EXPO_PUBLIC_BIGBANG !== "true" || !window.ReactNativeWebView) return () => {};
  const taps = createMobileTerminalTapController();
  let origin: { x: number; y: number } | null = null;
  lockMobileTerminalKeyboard(host);
  const down = (event: PointerEvent) => {
    if (event.pointerType === "touch") origin = { x: event.clientX, y: event.clientY };
  };
  const up = (event: PointerEvent) => {
    if (!origin) return;
    const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    origin = null;
    if (distance > 32) {
      taps.reset();
      return;
    }
    if (taps.recognize(event.clientX, event.clientY) === "keyboard") {
      unlockMobileTerminalKeyboard(host);
      focus();
    }
  };
  host.addEventListener("pointerdown", down, { passive: true });
  host.addEventListener("pointerup", up, { passive: true });
  return () => {
    host.removeEventListener("pointerdown", down);
    host.removeEventListener("pointerup", up);
  };
}
