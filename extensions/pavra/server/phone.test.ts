import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  phoneEmergencyStop,
  phonePollCommand,
  phoneRegisterDevice,
  phoneReportCommandResult,
} from "../shared/contracts";
import {
  PHONE_PASSWORD_MASK,
  PHONE_REDACTED_CARD,
  PHONE_REDACTED_ID,
  evaluatePhoneSafetyGate,
  isBlockedPhonePackage,
  redactPhoneUiTreeText,
  sanitizePhoneObservation,
} from "../shared/phone-safety";
import { Coordinator } from "./coordinator";
import { FakeExecution } from "./execution.fake";
import {
  AssistantPhoneManager,
  VIRTUAL_DISPLAY_JPEG_BASE64,
  callPhoneAgentTool,
  parseAndroidUiAutomatorXml,
  phoneAgentTools,
  phoneObserveTool,
} from "./phone";
import { ChatStore } from "./store";

const SKY_ID = "3a60bb8e-3065-44f1-81ec-d3ce929fded2";

describe("SafetyGate & Local PII Redaction Engine (phone-safety.ts)", () => {
  it("hard-blocks banking, securities, permission controllers, lockscreen, and Pavra itself unless unlocked", () => {
    expect(isBlockedPhonePackage("com.icbc")).toBe(true);
    expect(isBlockedPhonePackage("com.chinamworld.main")).toBe(true);
    expect(isBlockedPhonePackage("com.cmbchina.ccd.pluto.cmbActivity")).toBe(true);
    expect(isBlockedPhonePackage("com.futu.futubull")).toBe(true);
    expect(isBlockedPhonePackage("com.android.permissioncontroller")).toBe(true);
    expect(isBlockedPhonePackage("com.google.android.permissioncontroller")).toBe(true);
    expect(isBlockedPhonePackage("com.android.systemui")).toBe(true);
    expect(isBlockedPhonePackage("com.oldpan.pavra")).toBe(true);

    // Explicit unlock permits Pavra self-inspection in developer tests
    expect(
      isBlockedPhonePackage("com.oldpan.pavra", { unlockedPackages: ["com.oldpan.pavra"] }),
    ).toBe(false);

    // Normal social & system utility apps are allowed
    expect(isBlockedPhonePackage("com.tencent.mm")).toBe(false);
    expect(isBlockedPhonePackage("com.xingin.xhs")).toBe(false);
    expect(isBlockedPhonePackage("com.android.settings")).toBe(false);
  });

  it("triggers require_takeover on FLAG_SECURE, payment confirmation screens/buttons, and password fields", () => {
    expect(
      evaluatePhoneSafetyGate({
        action: "observe",
        observation: {
          packageName: "com.tencent.mm",
          isSecureFlag: true,
          elements: [],
        },
      }),
    ).toMatchObject({
      decision: "require_takeover",
      category: "secure_flag",
    });

    for (const label of [
      "立即支付",
      "确认支付",
      "确认转账",
      "输入密码",
      "Pay Now",
      "Confirm Payment",
    ]) {
      expect(
        evaluatePhoneSafetyGate({
          action: "tap",
          targetRef: "@e1",
          observation: {
            packageName: "com.demo.shop",
            elements: [{ ref: "@e1", text: label, clickable: true }],
          },
        }),
      ).toMatchObject({
        decision: "require_takeover",
        category: "payment",
      });
    }

    expect(
      evaluatePhoneSafetyGate({
        action: "type",
        targetRef: "@e2",
        observation: {
          packageName: "com.demo.app",
          elements: [{ ref: "@e2", hint: "Account password", isPassword: true, editable: true }],
        },
      }),
    ).toMatchObject({
      decision: "require_takeover",
      category: "password",
    });
  });

  it("enforces outward social confirmation tiers (always_ask, once_per_task, always_allow)", () => {
    const wechatSendObs = {
      packageName: "com.tencent.mm",
      elements: [{ ref: "@e3", text: "发送", clickable: true }],
    };

    expect(
      evaluatePhoneSafetyGate({
        action: "tap",
        targetRef: "@e3",
        observation: wechatSendObs,
        outwardConfirmTier: "always_ask",
      }),
    ).toMatchObject({
      decision: "require_confirmation",
      category: "outward_social",
    });

    expect(
      evaluatePhoneSafetyGate({
        action: "tap",
        targetRef: "@e3",
        observation: wechatSendObs,
        outwardConfirmTier: "always_ask",
        confirmedAction: true,
      }),
    ).toMatchObject({
      decision: "allow",
    });

    expect(
      evaluatePhoneSafetyGate({
        action: "tap",
        targetRef: "@e3",
        observation: wechatSendObs,
        outwardConfirmTier: "once_per_task",
        taskConfirmedPackages: [],
      }).decision,
    ).toBe("require_confirmation");

    expect(
      evaluatePhoneSafetyGate({
        action: "tap",
        targetRef: "@e3",
        observation: wechatSendObs,
        outwardConfirmTier: "once_per_task",
        taskConfirmedPackages: ["com.tencent.mm"],
      }).decision,
    ).toBe("allow");

    expect(
      evaluatePhoneSafetyGate({
        action: "tap",
        targetRef: "@e1",
        observation: {
          packageName: "com.xingin.xhs",
          elements: [{ ref: "@e1", text: "发布", clickable: true }],
        },
        outwardConfirmTier: "always_allow",
      }).decision,
    ).toBe("allow");
  });

  it("redacts 18-digit Chinese IDs, 16-19 digit bank cards, and masks password nodes with ••••", () => {
    const sample =
      "实名信息：110101199003071234（备用 44030519951224001X），收款卡 6222021234567890123 或 6222 0212 3456 7890";
    const redactedText = redactPhoneUiTreeText(sample);
    expect(redactedText).toBe(
      `实名信息：${PHONE_REDACTED_ID}（备用 ${PHONE_REDACTED_ID}），收款卡 ${PHONE_REDACTED_CARD} 或 ${PHONE_REDACTED_CARD}`,
    );

    const sanitized = sanitizePhoneObservation({
      packageName: "com.demo.bankform",
      summary: "绑卡身份证 110101199003071234",
      elements: [
        {
          ref: "@e1",
          text: "储蓄卡 6222021234567890123",
          contentDescription: "持卡人证件 110101199003071234",
        },
        {
          ref: "@e2",
          text: "mySuperSecret888",
          hint: "交易密码",
          password: true,
        },
      ],
    });

    expect(sanitized.summary).toBe(`绑卡身份证 ${PHONE_REDACTED_ID}`);
    expect(sanitized.elements[0]?.text).toBe(`储蓄卡 ${PHONE_REDACTED_CARD}`);
    expect(sanitized.elements[0]?.contentDescription).toBe(`持卡人证件 ${PHONE_REDACTED_ID}`);
    expect(sanitized.elements[1]?.text).toBe(PHONE_PASSWORD_MASK);
  });
});

describe("Coordinator Phone Control 14-Tool Suite, Long-Poll Queue & Takeover Lifecycle", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pavra-phone-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupCoordinator() {
    const root = makeTempDir();
    let now = 50_000;
    const store = new ChatStore(":memory:");
    const execution = new FakeExecution();
    const phoneManager = new AssistantPhoneManager({
      now: () => now,
      outwardMinIntervalMs: 0,
    });
    const coordinator = new Coordinator(store, root, {
      execution,
      now: () => now,
      phoneManager,
    });
    coordinator.attach();

    const assistant = coordinator.saveAssistant({
      id: SKY_ID,
      name: "Sky",
      provider: "codex/gpt-5",
      persona: "Helpful mobile assistant",
    });
    const conversation = coordinator.createConversation({
      id: "conv-phone",
      name: "Sky",
      kind: "dm",
      members: [assistant.id],
      roundtable: false,
    });
    coordinator.send({
      id: "22222222-2222-4222-8222-222222222222",
      conversationId: conversation.id,
      threadId: null,
      content: "Check my WeChat group messages and summarize them",
    });

    return {
      store,
      execution,
      phoneManager,
      coordinator,
      assistant,
      conversation,
      advanceTime: (ms: number) => {
        now += ms;
      },
    };
  }

  it("registers all 14 pavra-phone_* tools and enforces disabledTools: ['phone']", async () => {
    expect(phoneAgentTools.map((entry) => entry.tool.name)).toEqual([
      "phone_devices",
      "phone_observe",
      "phone_tap",
      "phone_type",
      "phone_scroll",
      "phone_swipe",
      "phone_back",
      "phone_launch_app",
      "phone_list_apps",
      "phone_intent",
      "phone_clipboard",
      "phone_steps",
      "phone_collect",
      "phone_hand_to_user",
    ]);

    const ctx = setupCoordinator();
    await ctx.coordinator.idle();
    const turn = ctx.store.snapshot().turns[0]!;

    ctx.coordinator.saveAssistant({
      ...ctx.assistant,
      disabledTools: ["phone"],
    });

    await expect(
      callPhoneAgentTool(ctx.coordinator, { agentId: turn.agentId }, "phone_devices", {}),
    ).rejects.toThrow(/Phone Control is disabled/i);

    await ctx.coordinator.close();
    ctx.store.close();
  });

  it("executes virtual phone tools: _images JPEG block, PII redaction, phone_collect deduplication, and payment takeover", async () => {
    const ctx = setupCoordinator();
    await ctx.coordinator.idle();
    const turn = ctx.store.snapshot().turns[0]!;
    const caller = { agentId: turn.agentId };

    ctx.coordinator.phoneRegisterDevice({
      deviceId: "pixel-virtual",
      deviceName: "Pixel 9 Pro",
      mode: "virtual",
      outwardConfirmTier: "once_per_task",
    });

    const devicesOut = (await callPhoneAgentTool(ctx.coordinator, caller, "phone_devices", {})) as {
      devices: Array<{ deviceId: string; effectiveReady: boolean }>;
    };
    expect(devicesOut.devices).toHaveLength(1);
    expect(devicesOut.devices[0]).toMatchObject({
      deviceId: "pixel-virtual",
      effectiveReady: true,
    });

    const appsOut = (await callPhoneAgentTool(ctx.coordinator, caller, "phone_list_apps", {})) as {
      apps: Array<{ packageName: string; blocked?: boolean }>;
    };
    expect(appsOut.apps.find((a) => a.packageName === "com.icbc")?.blocked).toBe(true);

    // Hard-blocked bank package is rejected by SafetyGate
    await expect(
      callPhoneAgentTool(ctx.coordinator, caller, "phone_launch_app", {
        packageName: "com.icbc",
      }),
    ).rejects.toThrow(/hard-locked banking/i);

    // Launch WeChat and observe with screenshot -> _images preserved across contract.output.parse and converted by toToolResult
    await callPhoneAgentTool(ctx.coordinator, caller, "phone_launch_app", {
      packageName: "com.tencent.mm",
    });

    const rawObserveOutput = await callPhoneAgentTool(ctx.coordinator, caller, "phone_observe", {
      includeScreenshot: true,
    });
    const parsedAcrossIpc = await phoneObserveTool.output.parseAsync(rawObserveOutput);
    expect(parsedAcrossIpc._images).toEqual([
      { data: VIRTUAL_DISPLAY_JPEG_BASE64, mimeType: "image/jpeg" },
    ]);
    // Verify PII redaction on observed UI tree and zero raw base64 duplication outside _images
    const { _images: extractedImages, ...sanitizedJsonCopy } = parsedAcrossIpc;
    expect(extractedImages).toHaveLength(1);
    expect(JSON.stringify(sanitizedJsonCopy)).not.toContain(VIRTUAL_DISPLAY_JPEG_BASE64);
    const texts = parsedAcrossIpc.elements.map((e) => e.text ?? "").join("\n");
    expect(texts).toContain(PHONE_REDACTED_ID);
    expect(texts).toContain(PHONE_REDACTED_CARD);
    expect(texts).not.toContain("110101199003071234");
    expect(texts).not.toContain("6222021234567890123");

    // phone_collect scrolls across all WeChat screens and deduplicates overlapping boundary items
    const collected = (await callPhoneAgentTool(ctx.coordinator, caller, "phone_collect", {
      maxPages: 5,
      direction: "down",
    })) as {
      pagesRead: number;
      reachedEnd: boolean;
      items: string[];
    };
    expect(collected.pagesRead).toBeGreaterThanOrEqual(3);
    expect(collected.reachedEnd).toBe(true);
    const shizukuMatches = collected.items.filter((line) =>
      line.includes("Shizuku 与无线调试双通道已经调通"),
    );
    expect(shizukuMatches).toHaveLength(1);
    expect(collected.items.some((line) => line.includes("今晚合入主分支后在 Spark 验收"))).toBe(
      true,
    );

    // Clipboard PII redaction
    await callPhoneAgentTool(ctx.coordinator, caller, "phone_clipboard", {
      action: "set",
      text: "卡号 6222021234567890123",
    });
    const clipGet = (await callPhoneAgentTool(ctx.coordinator, caller, "phone_clipboard", {
      action: "get",
    })) as { text: string };
    expect(clipGet.text).toBe(`卡号 ${PHONE_REDACTED_CARD}`);

    // Multi-step batching into Shop checkout -> Cashier payment screen triggers SafetyGate require_takeover & ledger Takeover!
    const stepsRes = (await callPhoneAgentTool(ctx.coordinator, caller, "phone_steps", {
      steps: [
        { action: "launch_app", packageName: "com.demo.shop" },
        { action: "tap", ref: "@e2" },
      ],
    })) as {
      completedSteps: number;
      stoppedEarlyReason?: string;
      observation: {
        status?: string;
        takeoverId?: string;
        elements: Array<{ ref: string; text?: string }>;
      };
    };

    expect(stepsRes.stoppedEarlyReason).toBe("handed_to_user");
    expect(stepsRes.observation.status).toBe("handed_to_user");
    expect(stepsRes.observation.takeoverId).toBeTruthy();
    // Password field on cashier screen is masked with ••••
    expect(stepsRes.observation.elements.find((e) => e.ref === "@e2")?.text).toBe(
      PHONE_PASSWORD_MASK,
    );

    const pendingTakeover = ctx.store
      .snapshot()
      .takeovers?.find((t) => t.id === stepsRes.observation.takeoverId);
    expect(pendingTakeover).toMatchObject({
      kind: "phone",
      status: "pending",
      assistantId: SKY_ID,
      deviceId: "pixel-virtual",
      packageName: "com.demo.shop",
    });

    // Resolve takeover -> marks takeover resolved and queues continuation turn
    ctx.execution.say(turn.agentId, "Please confirm payment on your phone.");
    ctx.execution.finish(turn.agentId);
    ctx.coordinator.onTurnEnded({
      agent: { id: turn.agentId },
      outcome: { kind: "completed" },
    });
    await ctx.coordinator.idle();

    const resolved = ctx.coordinator.resolveTakeover({
      id: pendingTakeover!.id,
      note: "Paid successfully",
    });
    expect(resolved.status).toBe("resolved");
    await ctx.coordinator.idle();

    const turns = ctx.store.snapshot().turns;
    expect(turns).toHaveLength(2);
    expect(turns[1]?.prompt).toContain("Paid successfully");

    await ctx.coordinator.close();
    ctx.store.close();
  });

  it("handles reverse long-poll queue, relay block, mika unknown_outcome non-retry rule, and emergency_stop cancelling Chat turn", async () => {
    const ctx = setupCoordinator();
    await ctx.coordinator.idle();
    const turn = ctx.store.snapshot().turns[0]!;
    const caller = { agentId: turn.agentId };

    ctx.coordinator.phoneRegisterDevice({
      deviceId: "s24-app",
      deviceName: "Galaxy S24",
      mode: "app",
      activeChannel: "shizuku",
      effectiveReady: true,
      virtualDisplayId: 2,
      allowRelayControl: false,
      connectedViaRelay: true,
    });

    // Relay blocked when allowRelayControl === false
    const relayPoll = await ctx.coordinator.phonePollCommand({
      deviceId: "s24-app",
      waitMs: 0,
      isRelay: true,
    });
    expect(relayPoll).toEqual({ command: null, relayBlocked: true });
    await expect(
      callPhoneAgentTool(ctx.coordinator, caller, "phone_observe", { device: "s24-app" }),
    ).rejects.toThrow(/Relay/i);

    // Enable Relay control and run long-poll command round-trip
    ctx.coordinator.phoneConfigureDevice({
      deviceId: "s24-app",
      allowRelayControl: true,
    });

    const pollPromise = ctx.coordinator.phonePollCommand({
      deviceId: "s24-app",
      waitMs: 5_000,
    });
    const observeCallPromise = callPhoneAgentTool(ctx.coordinator, caller, "phone_observe", {
      device: "s24-app",
      includeScreenshot: true,
    }) as Promise<{ packageName: string; hasScreenshot?: boolean }>;

    const polled = await pollPromise;
    expect(polled.command).toBeTruthy();
    expect(polled.command?.kind).toBe("observe");

    const report1 = ctx.coordinator.phoneReportCommandResult({
      deviceId: "s24-app",
      commandId: polled.command!.commandId,
      ok: true,
      observation: {
        packageName: "com.android.settings",
        appName: "Settings",
        elements: [{ ref: "@e1", text: "Battery 94%", x: 500, y: 400, clickable: true }],
        screenshotBase64: VIRTUAL_DISPLAY_JPEG_BASE64,
      },
    });
    expect(report1).toEqual({ accepted: true, duplicate: false });

    // Duplicate commandId report is deduplicated cleanly
    const reportDup = ctx.coordinator.phoneReportCommandResult({
      deviceId: "s24-app",
      commandId: polled.command!.commandId,
      ok: true,
    });
    expect(reportDup).toEqual({ accepted: true, duplicate: true });

    const observed = await observeCallPromise;
    expect(observed.packageName).toBe("com.android.settings");
    expect(observed.hasScreenshot).toBe(true);

    const liveState = ctx.coordinator.phoneGetLiveState({ deviceId: "s24-app" });
    expect(liveState.packageName).toBe("com.android.settings");
    expect(liveState.screenshotBase64).toBe(VIRTUAL_DISPLAY_JPEG_BASE64);
    expect(liveState.recentSteps.length).toBeGreaterThan(0);

    // mika unknown_outcome rule: mutating tap command picked up by poll, then device disconnects mid-execution
    const tapPromise = callPhoneAgentTool(ctx.coordinator, caller, "phone_tap", {
      device: "s24-app",
      ref: "@e1",
    }) as Promise<{ status?: string; warning?: string }>;

    const tapPolled = await ctx.coordinator.phonePollCommand({
      deviceId: "s24-app",
      waitMs: 1_000,
    });
    expect(tapPolled.command?.kind).toBe("tap");

    ctx.phoneManager.markDeviceDisconnected("s24-app", "Wi-Fi lost mid-tap");
    const tapOutcome = await tapPromise;
    expect(tapOutcome.status).toBe("unknown_outcome");
    expect(tapOutcome.warning).toContain("DO NOT blindly repeat");

    // Reconnect and trigger hardware Emergency Stop while a command & active Chat turn are running
    ctx.coordinator.phoneConfigureDevice({
      deviceId: "s24-app",
      online: true,
    });
    const pendingBack = callPhoneAgentTool(ctx.coordinator, caller, "phone_back", {
      device: "s24-app",
    });
    // Attach handler before emergencyStop rejects it
    const pendingBackSettled = pendingBack.catch((err: Error) => err.message);

    const stopRes = await ctx.coordinator.phoneEmergencyStop({
      deviceId: "s24-app",
      reason: "1s capsule long-press emergency stop",
    });

    expect(stopRes.stopped).toBe(true);
    expect(stopRes.cancelledCommandIds).toHaveLength(1);
    expect(stopRes.cancelledTurnIds).toContain(turn.id);
    expect(await pendingBackSettled).toContain("emergency stop");
    expect(ctx.store.get("turns", turn.id)?.status).toBe("cancelled");

    await ctx.coordinator.close();
    ctx.store.close();
  });

  it("parses Android uiautomator XML hierarchies into @eN refs and center coordinates", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
      <hierarchy rotation="0">
        <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.tencent.mm" content-desc="" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" checkable="false" checked="false" password="false" bounds="[0,0][1080,2400]">
          <node index="1" text="文件传输助手" resource-id="com.tencent.mm:id/title" class="android.widget.TextView" package="com.tencent.mm" content-desc="" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" checkable="false" checked="false" password="false" bounds="[120,100][520,180]" />
          <node index="2" text="123456" resource-id="com.tencent.mm:id/pwd" class="android.widget.EditText" package="com.tencent.mm" content-desc="" clickable="true" enabled="true" focusable="true" focused="true" scrollable="false" checkable="false" checked="false" password="true" bounds="[100,800][980,920]" />
        </node>
      </hierarchy>`;
    const parsed = parseAndroidUiAutomatorXml(xml);
    expect(parsed.packageName).toBe("com.tencent.mm");
    expect(parsed.treeQuality).toBe("good");
    expect(parsed.elements).toHaveLength(2);
    expect(parsed.elements[0]).toMatchObject({
      ref: "@e1",
      text: "文件传输助手",
      x: 320,
      y: 140,
      clickable: true,
    });
    expect(parsed.elements[1]).toMatchObject({
      ref: "@e2",
      password: true,
      editable: true,
      x: 540,
      y: 860,
    });
  });

  it("validates exact client worker RPC payloads (activeChannel: auto, waitMs: 12000, status: completed)", () => {
    const regPayload = phoneRegisterDevice.input.parse({
      id: "pavra-android-local",
      deviceId: "pavra-android-local",
      name: "Pixel 9 Pro · Android 15",
      deviceName: "Pixel 9 Pro · Android 15",
      enabled: true,
      online: true,
      mode: "app",
      platform: "android",
      privilegeChannel: "auto",
      activeChannel: "auto",
      effectiveReady: false,
      privilegeStatus: {
        ready: false,
        activeChannel: "none",
        shizukuAvailable: true,
        shizukuAuthorized: false,
        wirelessAdbPaired: false,
        wirelessAdbPort: null,
        virtualDisplayId: 2,
        overlayPermissionGranted: false,
        lastError: null,
      },
      virtualDisplayId: 2,
      overlayPermissionGranted: false,
      allowRelayControl: true,
      connectedViaRelay: false,
      isRelay: false,
      paused: false,
      onMainScreenTakeover: false,
      outwardConfirmTier: "always_ask",
      ready: false,
      screenWidth: 1080,
      screenHeight: 2400,
      lastError: null,
    });

    const mgr = new AssistantPhoneManager();
    const registered = mgr.registerDevice(regPayload);
    expect(registered.activeChannel).toBe("none");
    expect(registered.effectiveReady).toBe(false);

    const pollInput = phonePollCommand.input.parse({
      deviceId: "pavra-android-local",
      waitMs: 12000,
      isRelay: false,
      paused: false,
      allowRelayControl: true,
    });
    expect(pollInput.waitMs).toBe(12000);

    const reportInput = phoneReportCommandResult.input.parse({
      deviceId: "pavra-android-local",
      id: "cmd-1",
      commandId: "cmd-1",
      ok: true,
      status: "completed",
      result: { ok: true },
      observation: {
        deviceId: "pavra-android-local",
        displayId: 2,
        packageName: "com.tencent.mm",
        appName: "WeChat",
        elements: [],
      },
    });
    expect(reportInput.commandId).toBe("cmd-1");

    const stopInput = phoneEmergencyStop.input.parse({
      deviceId: "pavra-android-local",
      reason: "Hardware emergency stop triggered by user",
    });
    expect(stopInput.deviceId).toBe("pavra-android-local");
    mgr.close();
  });

  it("clears phoneGetLiveState().active when a phone turn completes normally and scopes deviceId emergency_stop to that device", async () => {
    const ctx = setupCoordinator();
    await ctx.coordinator.idle();
    const skyTurn = ctx.store.snapshot().turns[0]!;

    ctx.coordinator.phoneRegisterDevice({
      deviceId: "pixel-active-test",
      deviceName: "Pixel Active Test",
      mode: "virtual",
    });
    ctx.coordinator.phoneRegisterDevice({
      deviceId: "idle-secondary-phone",
      deviceName: "Secondary Idle Phone",
      mode: "virtual",
    });

    await callPhoneAgentTool(ctx.coordinator, { agentId: skyTurn.agentId }, "phone_observe", {
      device: "pixel-active-test",
    });

    // During the live turn, live_state.active is true for pixel-active-test
    const duringTurn = ctx.coordinator.phoneGetLiveState({ deviceId: "pixel-active-test" });
    expect(duringTurn.active).toBe(true);
    expect(duringTurn.activeTurnId).toBe(skyTurn.id);

    // Emergency stop on an unrelated idle phone does NOT cancel Sky's live turn!
    const unrelatedStop = await ctx.coordinator.phoneEmergencyStop({
      deviceId: "idle-secondary-phone",
      reason: "Idle device test stop",
    });
    expect(unrelatedStop.cancelledTurnIds).toEqual([]);
    expect(ctx.store.get("turns", skyTurn.id)?.status).toBe("running");

    // Finish Sky's turn normally (no pending takeover) -> live_state.active transitions back to false!
    ctx.execution.say(skyTurn.agentId, "Battery and home screen look healthy.");
    ctx.execution.finish(skyTurn.agentId);
    ctx.coordinator.onTurnEnded({
      agent: { id: skyTurn.agentId },
      outcome: { kind: "completed" },
    });
    await ctx.coordinator.idle();

    expect(ctx.store.get("turns", skyTurn.id)?.status).toBe("completed");
    const afterTurn = ctx.coordinator.phoneGetLiveState({ deviceId: "pixel-active-test" });
    expect(afterTurn.active).toBe(false);
    expect(afterTurn.activeTurnId).toBeNull();

    await ctx.coordinator.close();
    ctx.store.close();
  });
});
