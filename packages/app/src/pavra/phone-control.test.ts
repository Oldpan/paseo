import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_PHONE_SCREENSHOT_BASE64,
  buildPhoneRegistrationPayload,
  canAcceptPhoneCommand,
  computeMiniWindowTapDotPosition,
  describePhoneNetworkGate,
  formatPhoneCapsuleTitle,
  formatPhoneStepStatusLabel,
  formatVirtualDisplayBadge,
  handleNativePhoneOverlayActionEvent,
  normalizePhoneObservation,
  parseWirelessPairingInput,
  phonePollCommandRpc,
  phoneReportCommandResultRpc,
  resolveCommandStepDescription,
  runPhoneWorkerIteration,
  subscribeNativePhoneOverlayEvents,
  subscribePhoneEmergencyStop,
  toPhoneScreenshotUri,
  usePhoneControlStore,
} from "./phone-control";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

describe("pavra phone-control helpers & store", () => {
  beforeEach(() => {
    usePhoneControlStore.getState().reset();
  });

  it("validates 6-digit wireless debugging pairing inputs with optional port", () => {
    expect(parseWirelessPairingInput("123456")).toEqual({
      valid: true,
      ok: true,
      code: "123456",
      port: null,
      error: null,
    });

    expect(parseWirelessPairingInput(" 123456:37891 ")).toEqual({
      valid: true,
      ok: true,
      code: "123456",
      port: 37891,
      error: null,
    });

    expect(parseWirelessPairingInput("")).toMatchObject({
      valid: false,
      ok: false,
      code: null,
      port: null,
    });

    expect(parseWirelessPairingInput("12345")).toMatchObject({
      valid: false,
      ok: false,
      code: null,
      port: null,
    });

    expect(parseWirelessPairingInput("123456:0")).toMatchObject({
      valid: false,
      ok: false,
      code: null,
      port: null,
    });

    expect(parseWirelessPairingInput("123456:70000")).toMatchObject({
      valid: false,
      ok: false,
      code: null,
      port: null,
    });

    expect(parseWirelessPairingInput("123456:abc")).toMatchObject({
      valid: false,
      ok: false,
      code: null,
      port: null,
    });
  });

  it("enforces LAN vs 5G Encrypted Relay network scope gate", () => {
    expect(canAcceptPhoneCommand({ isRelay: false, allowRelayControl: false })).toBe(true);
    expect(canAcceptPhoneCommand({ isRelay: false, allowRelayControl: true })).toBe(true);
    expect(canAcceptPhoneCommand({ isRelay: true, allowRelayControl: true })).toBe(true);
    expect(canAcceptPhoneCommand({ isRelay: true, allowRelayControl: false })).toBe(false);
    expect(canAcceptPhoneCommand({ isRelay: false, allowRelayControl: true, enabled: false })).toBe(
      false,
    );
    expect(canAcceptPhoneCommand({ isRelay: false, allowRelayControl: true, paused: true })).toBe(
      false,
    );

    const blockedRelay = describePhoneNetworkGate({
      isRelay: true,
      allowRelayControl: false,
      enabled: true,
      paused: false,
    });
    expect(blockedRelay.allowed).toBe(false);
    expect(blockedRelay.reason).toContain("Relay");
  });

  it("formats step status labels, virtual display badges, and tap dot coordinates", () => {
    expect(formatVirtualDisplayBadge(null)).toBe("BG Display #2");
    expect(formatVirtualDisplayBadge(3)).toBe("BG Display #3");

    const sampleExec = {
      assistantName: "Sky",
      appName: "WeChat",
      stepText: "Tap 'Send' button",
      stepIndex: 2,
    };
    expect(formatPhoneCapsuleTitle(sampleExec)).toBe("🤖 Sky · WeChat");
    expect(formatPhoneStepStatusLabel(sampleExec)).toBe("Step 2: Tap 'Send' button");
    expect(formatPhoneStepStatusLabel(sampleExec, { paused: true })).toBe(
      "Paused · Tap 'Send' button",
    );
    expect(formatPhoneStepStatusLabel(sampleExec, { onMainScreenTakeover: true })).toBe(
      "Main Screen Takeover · Tap 'Send' button",
    );

    expect(toPhoneScreenshotUri(DEMO_PHONE_SCREENSHOT_BASE64)).toBe(
      `data:image/png;base64,${DEMO_PHONE_SCREENSHOT_BASE64}`,
    );
    expect(toPhoneScreenshotUri("data:image/jpeg;base64,/9j/4AAQ")).toBe(
      "data:image/jpeg;base64,/9j/4AAQ",
    );

    const dot = computeMiniWindowTapDotPosition({
      lastTapX: 540,
      lastTapY: 1200,
      screenWidth: 1080,
      screenHeight: 2400,
      viewportWidth: 180,
      viewportHeight: 260,
    });
    expect(dot).toEqual({ x: 90, y: 130 });
  });

  it("manages Shizuku authorization, Wireless ADB pairing, demo task, and Emergency Stop in usePhoneControlStore", async () => {
    const store = usePhoneControlStore.getState();
    expect(store.enabled).toBe(false);
    expect(store.allowRelayControl).toBe(true);
    expect(store.outwardConfirmTier).toBe("always_ask");

    await store.authorizeShizuku();
    expect(usePhoneControlStore.getState().enabled).toBe(true);
    expect(usePhoneControlStore.getState().privilegeStatus).toMatchObject({
      ready: true,
      activeChannel: "shizuku",
      shizukuAuthorized: true,
      virtualDisplayId: 2,
    });

    const badPair = await usePhoneControlStore.getState().pairWirelessAdb("bad");
    expect(badPair.valid).toBe(false);
    expect(usePhoneControlStore.getState().privilegeStatus.lastError).toBeTruthy();

    const goodPair = await usePhoneControlStore.getState().pairWirelessAdb("654321:37891");
    expect(goodPair).toEqual({
      valid: true,
      ok: true,
      code: "654321",
      port: 37891,
      error: null,
    });
    expect(usePhoneControlStore.getState().privilegeStatus).toMatchObject({
      ready: true,
      activeChannel: "wireless_adb",
      wirelessAdbPaired: true,
      wirelessAdbPort: 37891,
      lastError: null,
    });

    const demo = usePhoneControlStore.getState().launchDemoBackgroundTask({
      assistantName: "Sky",
      appName: "WeChat",
      mode: "capsule",
    });
    expect(demo.active).toBe(true);
    expect(usePhoneControlStore.getState().overlayVisible).toBe(true);
    expect(usePhoneControlStore.getState().overlayMode).toBe("capsule");

    usePhoneControlStore.getState().setOverlayMode("mini_window");
    expect(usePhoneControlStore.getState().overlayMode).toBe("mini_window");

    usePhoneControlStore.getState().togglePaused();
    expect(usePhoneControlStore.getState().paused).toBe(true);

    usePhoneControlStore.getState().toggleMainScreenTakeover();
    expect(usePhoneControlStore.getState().onMainScreenTakeover).toBe(true);

    const onEmergencyStop = vi.fn();
    const unsub = subscribePhoneEmergencyStop(onEmergencyStop);
    usePhoneControlStore.getState().triggerEmergencyStop();
    unsub();

    expect(onEmergencyStop).toHaveBeenCalledTimes(1);
    expect(usePhoneControlStore.getState().overlayVisible).toBe(false);
    expect(usePhoneControlStore.getState().paused).toBe(false);
    expect(usePhoneControlStore.getState().onMainScreenTakeover).toBe(false);
    expect(usePhoneControlStore.getState().liveExecution?.active).toBe(false);
  });

  it("polls coordinator commands and reports results in runPhoneWorkerIteration while respecting Relay gate", async () => {
    await usePhoneControlStore.getState().authorizeShizuku();
    usePhoneControlStore.getState().setDeviceId("pixel-9-pro");
    usePhoneControlStore.getState().setDeviceName("Pixel 9 Pro");

    const regPayload = buildPhoneRegistrationPayload(usePhoneControlStore.getState(), false);
    expect(regPayload).toMatchObject({
      deviceId: "pixel-9-pro",
      deviceName: "Pixel 9 Pro",
      activeChannel: "shizuku",
      virtualDisplayId: 2,
      allowRelayControl: true,
      outwardConfirmTier: "always_ask",
    });

    // When allowRelayControl is false and connection is over Relay, worker refuses to poll.
    usePhoneControlStore.getState().setAllowRelayControl(false);
    const blockedInvoke = vi.fn();
    const blockedOutcome = await runPhoneWorkerIteration({
      invokeRpc: blockedInvoke,
      isRelay: true,
    });
    expect(blockedOutcome.status).toBe("relay_blocked");
    expect(blockedInvoke).not.toHaveBeenCalled();

    // When allowRelayControl is true, Relay commands are accepted and reported.
    usePhoneControlStore.getState().setAllowRelayControl(true);
    const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const invokeRpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      if (name === phonePollCommandRpc.name) {
        return {
          command: {
            commandId: "cmd-42",
            action: "phone_tap",
            assistantName: "Sky",
            appName: "WeChat",
            packageName: "com.tencent.mm",
            stepText: "Tap 'File Transfer'",
            x: 520,
            y: 880,
          },
        };
      }
      return { ok: true };
    });

    const executed = await runPhoneWorkerIteration({
      invokeRpc,
      isRelay: true,
    });
    expect(executed).toEqual({
      status: "executed",
      commandId: "cmd-42",
      reason: null,
    });
    expect(calls.map((c) => c.name)).toEqual([
      phonePollCommandRpc.name,
      phoneReportCommandResultRpc.name,
    ]);
    expect(calls[1]?.payload).toMatchObject({
      deviceId: "pixel-9-pro",
      commandId: "cmd-42",
      ok: true,
      status: "completed",
    });

    const live = usePhoneControlStore.getState().liveExecution;
    expect(live).toMatchObject({
      active: true,
      assistantName: "Sky",
      appName: "WeChat",
      packageName: "com.tencent.mm",
      stepText: "Tap 'File Transfer'",
      lastTapX: 520,
      lastTapY: 880,
    });
  });

  it("aligns with coordinator command.kind/stepLabel, normalizes observations, deduplicates commandId, and syncs native overlay actions", async () => {
    await usePhoneControlStore.getState().authorizeShizuku();

    const stepDesc = resolveCommandStepDescription({
      commandId: "cmd-kind-1",
      kind: "tap",
      stepLabel: "Tap WeChat search bar",
      payload: { packageName: "com.tencent.mm", x: 300, y: 180 },
    });
    expect(stepDesc).toMatchObject({
      kind: "tap",
      packageName: "com.tencent.mm",
      appName: "WeChat",
      stepText: "Tap WeChat search bar",
      tapX: 300,
      tapY: 180,
    });

    const normalizedObs = normalizePhoneObservation(
      {
        elements: [
          {
            id: "e1",
            text: "Search",
            contentDesc: "Search button",
            clickable: true,
            bounds: { left: 10, top: 20, right: 110, bottom: 80, centerX: 60, centerY: 50 },
          },
        ],
      },
      {
        deviceId: "pavra-android-local",
        displayId: 2,
        packageName: "com.tencent.mm",
        appName: "WeChat",
        screenshotBase64: DEMO_PHONE_SCREENSHOT_BASE64,
        lastTapX: 60,
        lastTapY: 50,
        screenWidth: 1080,
        screenHeight: 2400,
      },
    );
    expect(normalizedObs).toMatchObject({
      deviceId: "pavra-android-local",
      displayId: 2,
      packageName: "com.tencent.mm",
      appName: "WeChat",
      elements: [
        {
          ref: "@e1",
          text: "Search",
          contentDescription: "Search button",
          clickable: true,
          x: 60,
          y: 50,
          bounds: { left: 10, top: 20, right: 110, bottom: 80 },
        },
      ],
    });

    // Deduplication: executing the same commandId twice only calls executeCommand once.
    const executeCommand = vi.fn(async () => ({
      ok: true,
      kind: "tap" as const,
      appName: "WeChat",
      packageName: "com.tencent.mm",
      stepText: "Tap search",
      screenshotBase64: DEMO_PHONE_SCREENSHOT_BASE64,
      lastTapX: 300,
      lastTapY: 180,
      screenWidth: 1080,
      screenHeight: 2400,
    }));
    const invokeRpc = vi.fn(async (name: string) => {
      if (name === phonePollCommandRpc.name) {
        return {
          command: {
            commandId: "cmd-dedup-99",
            kind: "tap",
            stepLabel: "Tap search",
            payload: { packageName: "com.tencent.mm", x: 300, y: 180 },
          },
        };
      }
      return { accepted: true };
    });

    const firstRun = await runPhoneWorkerIteration({
      invokeRpc,
      isRelay: false,
      executeCommand,
    });
    expect(firstRun.status).toBe("executed");
    expect(firstRun.deduplicated).toBeUndefined();
    expect(executeCommand).toHaveBeenCalledTimes(1);

    const secondRun = await runPhoneWorkerIteration({
      invokeRpc,
      isRelay: false,
      executeCommand,
    });
    expect(secondRun.status).toBe("executed");
    expect(secondRun.deduplicated).toBe(true);
    expect(executeCommand).toHaveBeenCalledTimes(1);

    // Native overlay event synchronization (ignoring js_bridge echo)
    let capturedListener: ((event: Record<string, unknown>) => void) | null = null;
    const unsubOverlay = subscribeNativePhoneOverlayEvents({
      addListener: (_name, cb) => {
        capturedListener = cb;
        return { remove: () => {} };
      },
    });
    expect(capturedListener).toBeTypeOf("function");

    handleNativePhoneOverlayActionEvent({ action: "pause", source: "js_bridge" });
    expect(usePhoneControlStore.getState().paused).toBe(false);

    handleNativePhoneOverlayActionEvent({ action: "pause", source: "native_overlay" });
    expect(usePhoneControlStore.getState().paused).toBe(true);

    handleNativePhoneOverlayActionEvent({ action: "takeover", source: "native_overlay" });
    expect(usePhoneControlStore.getState().onMainScreenTakeover).toBe(true);

    handleNativePhoneOverlayActionEvent({
      action: "mode_changed",
      mode: "mini_window",
      source: "native_overlay",
    });
    expect(usePhoneControlStore.getState().overlayMode).toBe("mini_window");

    handleNativePhoneOverlayActionEvent({ action: "emergency_stop", source: "native_overlay" });
    expect(usePhoneControlStore.getState().overlayVisible).toBe(false);
    unsubOverlay();
  });

  it("exposes all required testIDs in PhoneFloatingMiniWindow, PhoneControlModal, and PhoneLiveCard with zero useUnistyles()", () => {
    const miniWindowSrc = readFileSync(
      path.join(currentDir, "ui", "PhoneFloatingMiniWindow.tsx"),
      "utf8",
    );
    const modalSrc = readFileSync(path.join(currentDir, "ui", "PhoneControlModal.tsx"), "utf8");
    const liveCardSrc = readFileSync(path.join(currentDir, "ui", "PhoneLiveCard.tsx"), "utf8");

    expect(miniWindowSrc).not.toContain("useUnistyles");
    expect(modalSrc).not.toContain("useUnistyles");
    expect(liveCardSrc).not.toContain("useUnistyles");

    for (const id of [
      "phone-floating-capsule",
      "phone-capsule-expand-btn",
      "phone-capsule-emergency-stop",
      "phone-floating-mini-window",
      "phone-mini-window-collapse",
      "phone-mini-window-screen",
      "phone-mini-window-tap-dot",
      "phone-mini-window-pause",
      "phone-mini-window-takeover",
      "phone-mini-window-stop",
    ]) {
      expect(miniWindowSrc).toContain(id);
    }

    for (const id of [
      "phone-control-modal",
      "phone-master-toggle",
      "phone-device-name-input",
      "phone-auth-shizuku-btn",
      "phone-open-wireless-settings-btn",
      "phone-pairing-code-input",
      "phone-pairing-submit-btn",
      "phone-overlay-perm-btn",
      "phone-demo-mini-window-btn",
      "phone-allow-relay-toggle",
      "phone-confirm-tier-",
    ]) {
      expect(modalSrc).toContain(id);
    }

    for (const id of ["phone-live-card", "phone-live-card-open-mini", "phone-live-card-takeover"]) {
      expect(liveCardSrc).toContain(id);
    }
  });
});
