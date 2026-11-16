import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { PavraKeepaliveNativeModule } from "../../modules/pavra-keepalive";
import {
  CAPSULE_EMERGENCY_LONG_PRESS_MS,
  createNativePhoneBridge,
  createSimulatedPhoneBridge,
  parseWirelessPairingInput,
  type PhoneOverlayActionEvent,
  type PhonePrivilegeStatus,
  WIRELESS_PAIRING_REMOTE_INPUT_LABEL,
} from "./native-phone-bridge";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const keepaliveModuleDir = path.resolve(currentDir, "../../modules/pavra-keepalive");
const kotlinDir = path.join(
  keepaliveModuleDir,
  "android/src/main/java/expo/modules/pavrakeepalive",
);

describe("parseWirelessPairingInput", () => {
  it("parses 6-digit code, code:port, and host:port:code formats", () => {
    expect(parseWirelessPairingInput("123456", "127.0.0.1", 37891)).toEqual({
      code: "123456",
      host: "127.0.0.1",
      port: 37891,
    });
    expect(parseWirelessPairingInput("  654321:41234  ")).toEqual({
      code: "654321",
      host: "127.0.0.1",
      port: 41234,
    });
    expect(parseWirelessPairingInput("192.168.0.88:39001:908172")).toEqual({
      code: "908172",
      host: "192.168.0.88",
      port: 39001,
    });
  });

  it("rejects invalid pairing codes and out-of-range ports", () => {
    expect(parseWirelessPairingInput("")).toBeNull();
    expect(parseWirelessPairingInput("12345")).toBeNull();
    expect(parseWirelessPairingInput("1234567")).toBeNull();
    expect(parseWirelessPairingInput("abcdef")).toBeNull();
    expect(parseWirelessPairingInput("123456:70000")).toBeNull();
    expect(parseWirelessPairingInput("123456:0")).toBeNull();
  });
});

describe("Simulated NativePhoneBridge (Web / Test deterministic engine)", () => {
  it("supports both Method B (Shizuku) and Method A (Wireless Debugging 6-digit pairing)", async () => {
    const bridge = createSimulatedPhoneBridge({ now: () => 1700000000000 });
    const statusUpdates: PhonePrivilegeStatus[] = [];
    const unsubscribe = bridge.addPrivilegeChangedListener((status) => {
      statusUpdates.push(status);
    });

    const initial = await bridge.getPrivilegeStatus();
    expect(initial.ready).toBe(false);
    expect(initial.activeChannel).toBe("none");

    // Method A: Wireless Debugging NSD discovery + 6-digit pairing
    await bridge.openWirelessDebuggingWithPairingNotification();
    const invalidAttempt = await bridge.submitWirelessAdbPairingCode("999");
    expect(invalidAttempt.wirelessAdbPaired).toBe(false);
    expect(invalidAttempt.lastError).toContain("6 digits");

    const wirelessPaired = await bridge.submitWirelessAdbPairingCode("123456:37891");
    expect(wirelessPaired.ready).toBe(true);
    expect(wirelessPaired.activeChannel).toBe("wireless_adb");
    expect(wirelessPaired.wirelessAdbPaired).toBe(true);
    expect(wirelessPaired.wirelessAdbPort).toBe(37891);

    const shellViaWireless = await bridge.executePrivilegedShell("input -d 2 keyevent 4");
    expect(shellViaWireless.ok).toBe(true);
    expect(shellViaWireless.channel).toBe("wireless_adb");

    // Method B: Shizuku one-click authorization takes priority in "auto" mode
    const shizukuAuthed = await bridge.requestShizukuPermission();
    expect(shizukuAuthed.ready).toBe(true);
    expect(shizukuAuthed.shizukuAuthorized).toBe(true);
    expect(shizukuAuthed.activeChannel).toBe("shizuku");

    const forcedWireless = await bridge.getPrivilegeStatus("wireless_adb");
    expect(forcedWireless.activeChannel).toBe("wireless_adb");

    expect(statusUpdates.length).toBeGreaterThanOrEqual(3);
    unsubscribe.remove();
  });

  it("manages background VirtualDisplay, JPEG capture, FLAG_SECURE detection, takeover, and all 8 display actions", async () => {
    const bridge = createSimulatedPhoneBridge({ now: () => 1700000005000 });
    await bridge.requestShizukuPermission();

    const display = await bridge.ensureVirtualDisplay(1080, 2400, 420);
    expect(display.ok).toBe(true);
    expect(display.displayId).toBe(2);

    const apps = await bridge.listInstalledApps();
    expect(apps.some((app) => app.packageName === "com.tencent.mm")).toBe(true);

    expect(await bridge.launchAppOnVirtualDisplay("com.tencent.mm")).toBe(true);

    // Downscaled JPEG frame capture (2400 -> 1080 long edge => 486x1080)
    const frame = await bridge.captureFrameJpegBase64(1080, 72);
    expect(frame.ok).toBe(true);
    expect(frame.displayId).toBe(2);
    expect(frame.width).toBe(486);
    expect(frame.height).toBe(1080);
    expect(frame.mimeType).toBe("image/jpeg");
    expect(frame.base64).toBeTruthy();
    const rawBytes = Buffer.from(frame.base64!, "base64");
    expect(rawBytes[0]).toBe(0xff);
    expect(rawBytes[1]).toBe(0xd8);

    // Tap by elementId records (lastTapX, lastTapY) for mini-window red dot
    const tapRes = await bridge.executeDisplayAction({ type: "tap", elementId: "e4" });
    expect(tapRes.ok).toBe(true);
    expect(tapRes.lastTapX).toBe(950);
    expect(tapRes.lastTapY).toBe(2240);

    // Type, scroll, swipe, back, clipboard, intent, observe
    const typeRes = await bridge.executeDisplayAction({
      type: "type",
      text: "你好，文件传输助手",
      submit: true,
    });
    expect(typeRes.ok).toBe(true);
    expect(typeRes.submitted).toBe(true);

    const scrollRes = await bridge.executeDisplayAction({ type: "scroll", direction: "down" });
    expect(scrollRes.ok).toBe(true);

    const swipeRes = await bridge.executeDisplayAction({
      type: "swipe",
      startX: 540,
      startY: 1800,
      endX: 540,
      endY: 700,
      durationMs: 260,
    });
    expect(swipeRes.ok).toBe(true);

    const backRes = await bridge.executeDisplayAction({ type: "back" });
    expect(backRes.ok).toBe(true);

    await bridge.executeDisplayAction({
      type: "clipboard",
      mode: "set",
      text: "copied-token",
    });
    const clipGet = await bridge.executeDisplayAction({ type: "clipboard", mode: "get" });
    expect(clipGet.text).toBe("copied-token");

    const observeRes = await bridge.executeDisplayAction({
      type: "observe",
      includeScreenshot: true,
    });
    expect(observeRes.ok).toBe(true);
    expect(observeRes.packageName).toBe("com.tencent.mm");
    expect(observeRes.screenshotBase64).toBeTruthy();
    expect(observeRes.elements?.some((el) => el.text.includes("你好，文件传输助手"))).toBe(true);

    // Human-in-the-loop takeover to physical main screen (displayId = 0) and return
    expect(await bridge.moveAppToMainScreenForTakeover("com.tencent.mm")).toBe(true);
    const overlayDuringTakeover = await bridge.showFloatingOverlay({
      mode: "mini_window",
      assistantName: "Sky",
      appName: "微信",
      packageName: "com.tencent.mm",
      stepText: "等待用户接管",
    });
    expect(overlayDuringTakeover.onMainScreenTakeover).toBe(true);

    expect(await bridge.returnAppToVirtualDisplay("com.tencent.mm")).toBe(true);
    const overlayReturned = await bridge.updateFloatingOverlay({ stepText: "继续后台执行" });
    expect(overlayReturned.onMainScreenTakeover).toBe(false);

    // FLAG_SECURE payment screen omits screenshot bytes
    await bridge.launchAppOnVirtualDisplay("com.eg.android.AlipayGphone");
    const secureObs = await bridge.executeDisplayAction({
      type: "observe",
      includeScreenshot: true,
    });
    expect(secureObs.isSecureFlag).toBe(true);
    expect(secureObs.screenshotBase64).toBeNull();
  });

  it("supports floating capsule -> mini-window transitions and 1000ms long-press Hardware Emergency Stop", async () => {
    const bridge = createSimulatedPhoneBridge({ now: () => 1700000010000 });
    await bridge.ensureVirtualDisplay();

    const events: PhoneOverlayActionEvent[] = [];
    const sub = bridge.addOverlayActionListener((event) => {
      events.push(event);
    });

    const shown = await bridge.showFloatingOverlay({
      mode: "capsule",
      assistantName: "Sky",
      appName: "微信",
      packageName: "com.tencent.mm",
      stepText: "读取群消息",
    });
    expect(shown.visible).toBe(true);
    expect(shown.mode).toBe("capsule");

    // Expand to mini-window and test pause / resume
    const expanded = await bridge.simulateOverlayControl("expand");
    expect(expanded.mode).toBe("mini_window");

    await bridge.simulateOverlayControl("pause");
    const blockedWhilePaused = await bridge.executeDisplayAction({ type: "back" });
    expect(blockedWhilePaused.ok).toBe(false);
    expect(blockedWhilePaused.error).toContain("ERR_PAUSED");

    await bridge.simulateOverlayControl("resume");
    expect((await bridge.executeDisplayAction({ type: "back" })).ok).toBe(true);

    // Sub-second press (< 1000ms) does NOT trigger emergency stop
    const shortHold = await bridge.simulateCapsuleLongPress(CAPSULE_EMERGENCY_LONG_PRESS_MS - 150);
    expect(shortHold.visible).toBe(true);

    // 1000ms long-press triggers Hardware Emergency Stop immediately
    const stopped = await bridge.simulateCapsuleLongPress(CAPSULE_EMERGENCY_LONG_PRESS_MS);
    expect(stopped.visible).toBe(false);
    expect(events.some((e) => e.action === "emergency_stop")).toBe(true);

    const blockedAfterEmergency = await bridge.executeDisplayAction({
      type: "tap",
      x: 200,
      y: 400,
    });
    expect(blockedAfterEmergency.ok).toBe(false);
    expect(blockedAfterEmergency.error).toContain("ERR_EMERGENCY_STOPPED");

    await bridge.clearEmergencyStop();
    expect((await bridge.executeDisplayAction({ type: "back" })).ok).toBe(true);
    sub();
  });
});

describe("Native Expo Module Bridge Wiring", () => {
  it("delegates to PavraKeepaliveNativeModule methods and forwards native events", async () => {
    const listeners = new Map<string, (payload: Record<string, unknown>) => void>();

    const fakeNative: PavraKeepaliveNativeModule = {
      startKeepalive: () => true,
      stopKeepalive: () => true,
      getPhonePrivilegeStatusAsync: vi.fn(async () => ({
        ready: true,
        activeChannel: "shizuku",
        preferredChannel: "auto",
        shizukuInstalled: true,
        shizukuAvailable: true,
        shizukuAuthorized: true,
        wirelessAdbPaired: false,
        wirelessAdbHost: "127.0.0.1",
        wirelessAdbPort: null,
        virtualDisplayId: 3,
        overlayPermissionGranted: true,
        lastError: null,
      })),
      ensurePhoneVirtualDisplayAsync: vi.fn(async () => ({
        ok: true,
        displayId: 3,
        width: 1080,
        height: 2400,
        dpi: 420,
      })),
      executePhoneDisplayActionAsync: vi.fn(async (action) => ({
        ok: true,
        action: String(action.type),
        displayId: 3,
        lastTapX: 512,
        lastTapY: 1024,
      })),
      showPhoneFloatingOverlayAsync: vi.fn(async (state) => ({
        visible: true,
        mode: state.mode ?? "capsule",
        overlayPermissionGranted: true,
        assistantName: state.assistantName ?? "Sky",
        appName: state.appName ?? "微信",
        packageName: state.packageName ?? "com.tencent.mm",
        stepText: state.stepText ?? "Step 1",
        paused: false,
        onMainScreenTakeover: false,
        displayId: 3,
        lastTapX: 512,
        lastTapY: 1024,
      })),
      addListener: vi.fn((eventName, cb) => {
        listeners.set(eventName, cb);
        return {
          remove: () => {
            listeners.delete(eventName);
          },
        };
      }),
    };

    const bridge = createNativePhoneBridge({ nativeModule: fakeNative });
    expect(bridge.isSimulated).toBe(false);

    const status = await bridge.getPrivilegeStatus();
    expect(status.activeChannel).toBe("shizuku");
    expect(status.virtualDisplayId).toBe(3);

    const vd = await bridge.ensureVirtualDisplay();
    expect(vd.displayId).toBe(3);

    const tap = await bridge.executeDisplayAction({ type: "tap", x: 512, y: 1024 });
    expect(tap.ok).toBe(true);
    expect(tap.lastTapX).toBe(512);

    const receivedEvents: PhoneOverlayActionEvent[] = [];
    const sub = bridge.addOverlayActionListener((evt) => receivedEvents.push(evt));
    listeners.get("onPhoneOverlayAction")?.({
      action: "emergency_stop",
      mode: "capsule",
      paused: false,
      onMainScreenTakeover: false,
      packageName: "com.tencent.mm",
      source: "capsule_long_press",
      timestamp: 12345,
    });
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]?.action).toBe("emergency_stop");
    sub.remove();
  });
});

describe("Android Native Kotlin & Manifest Source Verification", () => {
  function skipNonCodeToken(source: string, index: number): number | null {
    const ch = source[index]!;
    const next = source[index + 1] ?? "";
    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", index + 2);
      return nl === -1 ? source.length : nl + 1;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      return end === -1 ? source.length : end + 2;
    }
    if (ch === "'") {
      const step = source[index + 1] === "\\" ? 4 : 3;
      return index + step;
    }
    return null;
  }

  function stepInsideString(
    source: string,
    index: number,
    state: { braces: number; inString: boolean; stack: number[] },
  ): number {
    const ch = source[index]!;
    if (ch === "\\") return index + 2;
    if (ch === "$" && source[index + 1] === "{") {
      state.stack.push(state.braces);
      state.braces += 1;
      state.inString = false;
      return index + 2;
    }
    if (ch === '"') state.inString = false;
    return index + 1;
  }

  function assertBalancedDelimiters(source: string, fileName: string) {
    const state = { braces: 0, inString: false, stack: [] as number[] };
    let parens = 0;
    let i = 0;

    while (i < source.length) {
      if (state.inString) {
        i = stepInsideString(source, i, state);
        continue;
      }
      const jumped = skipNonCodeToken(source, i);
      if (jumped !== null) {
        i = jumped;
        continue;
      }
      const ch = source[i]!;
      if (ch === '"') {
        state.inString = true;
      } else if (ch === "{") {
        state.braces += 1;
      } else if (ch === "}") {
        state.braces -= 1;
        expect(state.braces, `${fileName} has unmatched '}' at offset ${i}`).toBeGreaterThanOrEqual(
          0,
        );
        if (state.stack.length > 0 && state.stack[state.stack.length - 1] === state.braces) {
          state.stack.pop();
          state.inString = true;
        }
      } else if (ch === "(") {
        parens += 1;
      } else if (ch === ")") {
        parens -= 1;
        expect(parens, `${fileName} has unmatched ')' at offset ${i}`).toBeGreaterThanOrEqual(0);
      }
      i += 1;
    }

    expect(state.inString, `${fileName} has unclosed string literal`).toBe(false);
    expect(state.braces, `${fileName} unclosed '{'`).toBe(0);
    expect(parens, `${fileName} unclosed '('`).toBe(0);
  }

  it("declares SYSTEM_ALERT_WINDOW, Shizuku package visibility, and PairingReceiver in AndroidManifest.xml", () => {
    const manifest = readFileSync(
      path.join(keepaliveModuleDir, "android/src/main/AndroidManifest.xml"),
      "utf8",
    );
    expect(manifest).toContain("android.permission.SYSTEM_ALERT_WINDOW");
    expect(manifest).toContain("moe.shizuku.privileged.api");
    expect(manifest).toContain("expo.modules.pavrakeepalive.PavraWirelessAdbPairingReceiver");
  });

  it("contains complete, syntax-balanced Kotlin implementations for Privilege, VirtualDisplay, and FloatingOverlay", () => {
    const privilegeKt = readFileSync(path.join(kotlinDir, "PavraPhonePrivilegeEngine.kt"), "utf8");
    const virtualDisplayKt = readFileSync(
      path.join(kotlinDir, "PavraVirtualDisplayController.kt"),
      "utf8",
    );
    const overlayKt = readFileSync(
      path.join(kotlinDir, "PavraFloatingOverlayController.kt"),
      "utf8",
    );
    const moduleKt = readFileSync(path.join(kotlinDir, "PavraKeepaliveModule.kt"), "utf8");
    const serviceKt = readFileSync(path.join(kotlinDir, "PavraKeepaliveService.kt"), "utf8");

    assertBalancedDelimiters(privilegeKt, "PavraPhonePrivilegeEngine.kt");
    assertBalancedDelimiters(virtualDisplayKt, "PavraVirtualDisplayController.kt");
    assertBalancedDelimiters(overlayKt, "PavraFloatingOverlayController.kt");
    assertBalancedDelimiters(moduleKt, "PavraKeepaliveModule.kt");
    assertBalancedDelimiters(serviceKt, "PavraKeepaliveService.kt");

    expect(privilegeKt).toContain(WIRELESS_PAIRING_REMOTE_INPUT_LABEL);
    expect(privilegeKt).toContain("_adb-tls-pairing._tcp.");
    expect(privilegeKt).toContain("_adb-tls-connect._tcp.");
    expect(privilegeKt).toContain("ACTION_APPLICATION_DEVELOPMENT_SETTINGS");

    expect(virtualDisplayKt).toContain("PavraAssistantDisplay");
    expect(virtualDisplayKt).toContain("ensureVirtualDisplay");
    expect(virtualDisplayKt).toContain("captureFrameJpegBase64");
    expect(virtualDisplayKt).toContain("launchAppOnVirtualDisplay");
    expect(virtualDisplayKt).toContain("moveAppToMainScreenForTakeover");
    expect(virtualDisplayKt).toContain("returnAppToVirtualDisplay");
    expect(virtualDisplayKt).toContain("executeDisplayAction");

    expect(overlayKt).toContain("TYPE_APPLICATION_OVERLAY");
    expect(overlayKt).toContain("EMERGENCY_LONG_PRESS_MS = 1000L");
    expect(overlayKt).toContain("MINI_WINDOW_WIDTH_DP = 160");
    expect(overlayKt).toContain("MINI_WINDOW_HEIGHT_DP = 340");

    expect(moduleKt).toContain("onPhoneOverlayAction");
    expect(moduleKt).toContain("onPhonePrivilegeChanged");
  });
});
