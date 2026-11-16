import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  defineAgentTool,
  type PluginAgentToolContract,
  type RpcInput,
  type RpcOutput,
} from "@getpaseo/plugin";
import { z } from "zod";
import {
  type Assistant,
  type PhoneActiveChannel,
  type PhoneAppInfo,
  type PhoneCommand,
  type PhoneCommandKind,
  type PhoneDevice,
  type PhoneDeviceMode,
  type PhoneLiveState,
  type PhoneObservation,
  type PhonePrivilegeChannel,
  type PhoneStep,
  type PhoneStepTrailItem,
  type PhoneStepWait,
  type PhoneUiElement,
  phoneAppInfoSchema,
  phoneConfigureDevice,
  phoneGetLiveState,
  phonePollCommand,
  phoneRegisterDevice,
  phoneReportCommandResult,
  phoneStepSchema,
  phoneUiElementSchema,
} from "../shared/contracts";
import {
  type PhoneOutwardConfirmTier,
  type PhoneUiElementLike,
  checkPhonePackagePolicy,
  evaluatePhoneSafetyGate,
  findPhoneElementByRef,
  isBlockedPhonePackage,
  isOutwardSocialAction,
  redactPhoneUiTreeText,
  sanitizePhoneObservation,
} from "../shared/phone-safety";
import type { AgentToolEntry, ToolCaller } from "./agent-tools";
import type { Coordinator } from "./coordinator";

const execFileAsync = promisify(execFile);

export const PHONE_POLL_DEFAULT_WAIT_MS = 20_000;
export const PHONE_COMMAND_TIMEOUT_MS = 25_000;
export const PHONE_STEPS_MAX_DURATION_MS = 25_000;
export const PHONE_MAX_RECENT_STEPS = 40;
export const PHONE_DEFAULT_OUTWARD_INTERVAL_MS = 1_000;

// Valid tiny 1x1 JPEG image (base64) for deterministic virtual display frame tests.
export const VIRTUAL_DISPLAY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

export const phoneToolImageBlockSchema = z.object({
  data: z.string().min(1),
  mimeType: z.enum(["image/jpeg", "image/png"]),
});

export const phoneToolObservationOutputSchema = z.object({
  status: z.enum(["ok", "handed_to_user", "confirmation_required", "unknown_outcome"]).optional(),
  deviceId: z.string(),
  displayId: z.number().int().nullable().optional(),
  packageName: z.string(),
  appName: z.string().optional(),
  activityName: z.string().nullable().optional(),
  isSecureFlag: z.boolean().optional(),
  screenWidth: z.number().int().positive().optional(),
  screenHeight: z.number().int().positive().optional(),
  treeQuality: z.enum(["good", "sparse", "empty"]).optional(),
  summary: z.string().optional(),
  elements: z.array(phoneUiElementSchema),
  hasScreenshot: z.boolean().optional(),
  screenshotMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
  lastTapX: z.number().nullable().optional(),
  lastTapY: z.number().nullable().optional(),
  capturedAt: z.number(),
  commandId: z.string().optional(),
  takeoverId: z.string().nullable().optional(),
  safetyReason: z.string().nullable().optional(),
  instruction: z.string().optional(),
  warning: z.string().optional(),
  _images: z.array(phoneToolImageBlockSchema).optional(),
});
export type PhoneToolObservationOutput = z.infer<typeof phoneToolObservationOutputSchema>;

function stripDataUrlPrefix(raw: string): {
  base64: string;
  mimeType: "image/jpeg" | "image/png";
} {
  const trimmed = raw.trim();
  const match = trimmed.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/i);
  if (match) {
    const mime = match[1]!.toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
    return { base64: match[2]!.trim(), mimeType: mime };
  }
  return { base64: trimmed, mimeType: "image/jpeg" };
}

function toScreenshotDataUrl(
  base64: string | null | undefined,
  mimeType: "image/jpeg" | "image/png" = "image/jpeg",
): string | null {
  if (!base64) return null;
  if (base64.startsWith("data:image/")) return base64;
  return `data:${mimeType};base64,${base64}`;
}

function computeTreeQuality(elements: readonly PhoneUiElement[]): "good" | "sparse" | "empty" {
  if (elements.length === 0) return "empty";
  const labeledCount = elements.filter((el) =>
    Boolean((el.text && el.text.trim()) || (el.contentDescription && el.contentDescription.trim())),
  ).length;
  if (elements.length <= 2 && labeledCount === 0) return "sparse";
  return "good";
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&amp;/g, "&");
}

function readXmlAttr(attrs: string, name: string): string {
  const attrMatch = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return attrMatch ? decodeXmlEntities(attrMatch[1]!) : "";
}

function parseXmlBounds(boundsRaw: string): {
  bounds?: PhoneUiElement["bounds"];
  x?: number;
  y?: number;
} {
  const match = boundsRaw.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (!match) return {};
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (right <= left || bottom <= top) return {};
  return {
    bounds: { left, top, right, bottom },
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2),
  };
}

function parseXmlNodeElement(
  attrs: string,
  ref: string,
): { pkg: string; element: PhoneUiElement | null } {
  const pkg = readXmlAttr(attrs, "package");
  const text = readXmlAttr(attrs, "text");
  const contentDesc = readXmlAttr(attrs, "content-desc");
  const hint = readXmlAttr(attrs, "hint");
  const resourceId = readXmlAttr(attrs, "resource-id");
  const className = readXmlAttr(attrs, "class");
  const clickable = readXmlAttr(attrs, "clickable") === "true";
  const scrollable = readXmlAttr(attrs, "scrollable") === "true";
  const checkable = readXmlAttr(attrs, "checkable") === "true";
  const checked = readXmlAttr(attrs, "checked") === "true";
  const focused = readXmlAttr(attrs, "focused") === "true";
  const enabled = readXmlAttr(attrs, "enabled") !== "false";
  const password = readXmlAttr(attrs, "password") === "true";
  const editable = password || /EditText|AutoCompleteTextView/i.test(className);

  const hasText = Boolean(text.trim() || contentDesc.trim() || hint.trim());
  const isInteractive = clickable || editable || scrollable || password;
  if (!hasText && !isInteractive) {
    return { pkg, element: null };
  }

  const geometry = parseXmlBounds(readXmlAttr(attrs, "bounds"));
  const element: PhoneUiElement = {
    ref,
    clickable,
    editable,
    scrollable,
    checkable,
    checked,
    focused,
    enabled,
    password,
    isPassword: password,
  };
  if (text) element.text = text;
  if (contentDesc) element.contentDescription = contentDesc;
  if (hint) element.hint = hint;
  if (className) element.className = className;
  if (resourceId) element.resourceId = resourceId;
  if (pkg) element.packageName = pkg;
  if (geometry.bounds) element.bounds = geometry.bounds;
  if (geometry.x !== undefined) element.x = geometry.x;
  if (geometry.y !== undefined) element.y = geometry.y;
  return { pkg, element };
}

export function parseAndroidUiAutomatorXml(
  xml: string,
  fallbackPackage = "android",
): { packageName: string; elements: PhoneUiElement[]; treeQuality: "good" | "sparse" | "empty" } {
  const elements: PhoneUiElement[] = [];
  let detectedPackage = fallbackPackage;
  const nodeRegex = /<node\b([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = nodeRegex.exec(xml)) !== null) {
    if (elements.length >= 80) break;
    const ref = `@e${elements.length + 1}`;
    const parsed = parseXmlNodeElement(match[1]!, ref);
    if (parsed.pkg && detectedPackage === fallbackPackage) {
      detectedPackage = parsed.pkg;
    }
    if (parsed.element) {
      elements.push(parsed.element);
    }
  }

  return {
    packageName: detectedPackage,
    elements,
    treeQuality: computeTreeQuality(elements),
  };
}

interface VirtualDeviceState {
  packageName: string;
  appName: string;
  activityName: string | null;
  scrollPage: number;
  draftText: string;
  sentMessages: string[];
  clipboard: string;
  lastTapX: number | null;
  lastTapY: number | null;
  customObservation: Partial<PhoneObservation> | null;
}

const VIRTUAL_INSTALLED_APPS: readonly PhoneAppInfo[] = [
  { packageName: "com.tencent.mm", appName: "微信", systemApp: false },
  { packageName: "com.xingin.xhs", appName: "小红书", systemApp: false },
  { packageName: "com.demo.shop", appName: "示例商城", systemApp: false },
  { packageName: "com.google.android.apps.messaging", appName: "Messages", systemApp: true },
  { packageName: "com.android.settings", appName: "设置", systemApp: true },
  { packageName: "com.icbc", appName: "中国工商银行", systemApp: false, blocked: true },
];

const WECHAT_FEED_PAGES: readonly (readonly string[])[] = [
  [
    "张伟: 今天下午三点评审 R7 手机虚拟屏方案",
    "群公告: 报销核对身份证 110101199003071234，打款卡号 6222021234567890123",
    "李娜: Shizuku 与无线调试双通道已经调通",
  ],
  [
    "李娜: Shizuku 与无线调试双通道已经调通",
    "王强: 悬浮小窗的长按 1 秒急停也测过了",
    "陈晨: 记得确认银行类 App 默认硬拦截",
  ],
  ["陈晨: 记得确认银行类 App 默认硬拦截", "张伟: 好的，今晚合入主分支后在 Spark 验收"],
];

function buildWeChatVirtualTree(state: VirtualDeviceState): {
  elements: PhoneUiElement[];
  summary: string;
} {
  const pageIndex = Math.max(0, Math.min(WECHAT_FEED_PAGES.length - 1, state.scrollPage));
  const extra = pageIndex === WECHAT_FEED_PAGES.length - 1 ? state.sentMessages : [];
  const rows = [...WECHAT_FEED_PAGES[pageIndex]!, ...extra];
  const elements: PhoneUiElement[] = [
    {
      ref: "@e1",
      text: "研发群 (8)",
      className: "android.widget.TextView",
      x: 540,
      y: 140,
      clickable: false,
    },
    ...rows.map((msg, idx) => ({
      ref: `@e${idx + 2}`,
      text: msg,
      className: "android.widget.TextView",
      x: 540,
      y: 340 + idx * 220,
      clickable: true,
      scrollable: true,
    })),
    {
      ref: `@e${rows.length + 2}`,
      text: state.draftText,
      hint: "发送消息",
      className: "android.widget.EditText",
      resourceId: "com.tencent.mm:id/chat_input",
      x: 420,
      y: 2220,
      clickable: true,
      editable: true,
    },
    {
      ref: `@e${rows.length + 3}`,
      text: "发送",
      className: "android.widget.Button",
      resourceId: "com.tencent.mm:id/send_btn",
      x: 960,
      y: 2220,
      clickable: true,
    },
  ];
  return {
    elements,
    summary: `微信 · 研发群 (第 ${pageIndex + 1}/${WECHAT_FEED_PAGES.length} 屏)`,
  };
}

function buildShopVirtualTree(state: VirtualDeviceState): {
  elements: PhoneUiElement[];
  summary: string;
} {
  if (state.activityName === "com.demo.shop.CashierActivity") {
    return {
      summary: "收银台 · 待确认支付",
      elements: [
        {
          ref: "@e1",
          text: "收银台 · ¥199.00",
          className: "android.widget.TextView",
          x: 540,
          y: 300,
        },
        {
          ref: "@e2",
          text: "654321",
          hint: "请输入支付密码",
          className: "android.widget.EditText",
          x: 540,
          y: 960,
          clickable: true,
          editable: true,
          password: true,
          isPassword: true,
        },
        {
          ref: "@e3",
          text: "立即支付",
          className: "android.widget.Button",
          x: 540,
          y: 1460,
          clickable: true,
        },
      ],
    };
  }
  return {
    summary: "示例商城 · 商品详情",
    elements: [
      {
        ref: "@e1",
        text: "机械键盘 Pro · ¥199.00",
        className: "android.widget.TextView",
        x: 540,
        y: 420,
      },
      {
        ref: "@e2",
        text: "去结算",
        className: "android.widget.Button",
        x: 860,
        y: 2180,
        clickable: true,
      },
    ],
  };
}

function buildStandardVirtualTree(state: VirtualDeviceState): {
  elements: PhoneUiElement[];
  summary: string;
} {
  if (state.packageName === "com.tencent.mm") {
    return buildWeChatVirtualTree(state);
  }
  if (state.packageName === "com.xingin.xhs") {
    return {
      summary: "小红书 · 笔记编辑页",
      elements: [
        {
          ref: "@e1",
          text: "小红书创作笔记",
          className: "android.widget.TextView",
          x: 540,
          y: 160,
        },
        {
          ref: "@e2",
          text: state.draftText || "记录今日开发日常",
          hint: "填写正文",
          className: "android.widget.EditText",
          x: 540,
          y: 720,
          clickable: true,
          editable: true,
        },
        {
          ref: "@e3",
          text: "发布",
          className: "android.widget.Button",
          resourceId: "com.xingin.xhs:id/publish_btn",
          x: 900,
          y: 2200,
          clickable: true,
        },
      ],
    };
  }
  if (state.packageName === "com.demo.shop") {
    return buildShopVirtualTree(state);
  }
  if (state.packageName === "com.android.settings") {
    return {
      summary: "设置 · 系统概览",
      elements: [
        {
          ref: "@e1",
          text: "电池电量 88% · 正常",
          className: "android.widget.TextView",
          x: 540,
          y: 420,
          clickable: true,
        },
        {
          ref: "@e2",
          text: "WLAN · 已连接 Office-5G",
          className: "android.widget.TextView",
          x: 540,
          y: 720,
          clickable: true,
        },
      ],
    };
  }
  return {
    summary: "Pixel Launcher · 后台虚拟桌面",
    elements: [
      {
        ref: "@e1",
        text: "微信",
        className: "android.widget.TextView",
        x: 240,
        y: 620,
        clickable: true,
      },
      {
        ref: "@e2",
        text: "小红书",
        className: "android.widget.TextView",
        x: 540,
        y: 620,
        clickable: true,
      },
      {
        ref: "@e3",
        text: "示例商城",
        className: "android.widget.TextView",
        x: 840,
        y: 620,
        clickable: true,
      },
      {
        ref: "@e4",
        text: "设置",
        className: "android.widget.TextView",
        x: 240,
        y: 960,
        clickable: true,
      },
    ],
  };
}

function buildCustomVirtualObservation(
  device: PhoneDevice,
  state: VirtualDeviceState,
  custom: Partial<PhoneObservation>,
  now: number,
  includeScreenshot: boolean,
): PhoneObservation {
  const customElements = custom.elements ?? [];
  const rawShot = custom.screenshotBase64 ?? VIRTUAL_DISPLAY_JPEG_BASE64;
  const obs: PhoneObservation = {
    deviceId: device.deviceId,
    displayId: custom.displayId ?? device.virtualDisplayId ?? 2,
    packageName: custom.packageName ?? state.packageName,
    appName: custom.appName ?? state.appName,
    activityName: custom.activityName ?? state.activityName,
    isSecureFlag: custom.isSecureFlag ?? false,
    screenWidth: custom.screenWidth ?? device.screenWidth,
    screenHeight: custom.screenHeight ?? device.screenHeight,
    treeQuality: custom.treeQuality ?? computeTreeQuality(customElements),
    elements: customElements,
    screenshotBase64: includeScreenshot ? rawShot : null,
    screenshotMimeType: custom.screenshotMimeType ?? "image/jpeg",
    lastTapX: custom.lastTapX ?? state.lastTapX,
    lastTapY: custom.lastTapY ?? state.lastTapY,
    capturedAt: now,
  };
  if (custom.summary) obs.summary = custom.summary;
  return obs;
}

function buildVirtualObservation(
  device: PhoneDevice,
  state: VirtualDeviceState,
  now: number,
  includeScreenshot: boolean,
): PhoneObservation {
  if (state.customObservation) {
    return buildCustomVirtualObservation(
      device,
      state,
      state.customObservation,
      now,
      includeScreenshot,
    );
  }
  const { elements, summary } = buildStandardVirtualTree(state);
  return {
    deviceId: device.deviceId,
    displayId: device.virtualDisplayId ?? 2,
    packageName: state.packageName,
    appName: state.appName,
    activityName: state.activityName,
    isSecureFlag: false,
    screenWidth: device.screenWidth,
    screenHeight: device.screenHeight,
    treeQuality: computeTreeQuality(elements),
    summary,
    elements,
    screenshotBase64: includeScreenshot ? VIRTUAL_DISPLAY_JPEG_BASE64 : null,
    screenshotMimeType: "image/jpeg",
    lastTapX: state.lastTapX,
    lastTapY: state.lastTapY,
    capturedAt: now,
  };
}

export interface AdbCommandRunner {
  (
    args: readonly string[],
    options?: { encoding?: "utf8" | "buffer"; timeoutMs?: number },
  ): Promise<{
    stdout: string | Buffer;
    stderr: string;
  }>;
}

async function defaultAdbRunner(
  args: readonly string[],
  options?: { encoding?: "utf8" | "buffer"; timeoutMs?: number },
): Promise<{ stdout: string | Buffer; stderr: string }> {
  const timeout = options?.timeoutMs ?? 15_000;
  if (options?.encoding === "buffer") {
    const res = await execFileAsync("adb", [...args], {
      encoding: "buffer",
      timeout,
      maxBuffer: 12 * 1024 * 1024,
    });
    return { stdout: res.stdout, stderr: res.stderr.toString("utf8") };
  }
  const res = await execFileAsync("adb", [...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: res.stdout, stderr: res.stderr };
}

interface InternalCommandOutcome {
  ok: boolean;
  unknownOutcome?: boolean;
  commandId: string;
  error?: string;
  apps?: PhoneAppInfo[];
  clipboardText?: string | null;
  observation?: PhoneObservation | null;
  data?: Record<string, unknown>;
}

interface PendingCommandEntry {
  command: PhoneCommand;
  mutating: boolean;
  dispatched: boolean;
  resolve: (outcome: InternalCommandOutcome) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PollWaiter {
  resolve: (result: RpcOutput<typeof phonePollCommand>) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface DeviceRuntimeRecord {
  device: PhoneDevice;
  virtual: VirtualDeviceState;
  latestRawObservation: PhoneObservation | null;
  latestSanitizedObservation: PhoneObservation | null;
  queue: PendingCommandEntry[];
  inFlight: Map<string, PendingCommandEntry>;
  completedOutcomes: Map<string, InternalCommandOutcome>;
  pollWaiters: Set<PollWaiter>;
  activeTurnId: string | null;
  activeAssistantId: string | null;
  activeAssistantName: string | null;
}

export interface AssistantPhoneManagerOptions {
  now?: () => number;
  commandTimeoutMs?: number;
  stepsBudgetMs?: number;
  outwardMinIntervalMs?: number;
  adbRunner?: AdbCommandRunner;
}

const MUTATING_COMMANDS: ReadonlySet<PhoneCommandKind> = new Set([
  "tap",
  "type",
  "scroll",
  "swipe",
  "back",
  "launch_app",
  "intent",
  "clipboard",
]);

function isMutatingCommand(kind: PhoneCommandKind, payload: Record<string, unknown>): boolean {
  if (kind === "clipboard") {
    return payload.action === "set";
  }
  return MUTATING_COMMANDS.has(kind);
}

function defaultActiveChannelForMode(mode: PhoneDeviceMode): PhoneActiveChannel {
  if (mode === "virtual") return "virtual";
  if (mode === "adb") return "adb";
  return "none";
}

function defaultPrivilegeChannelForMode(mode: PhoneDeviceMode): PhonePrivilegeChannel {
  if (mode === "virtual") return "virtual";
  if (mode === "adb") return "adb";
  return "auto";
}

function createDefaultPhoneDevice(
  deviceId: string,
  mode: PhoneDeviceMode,
  now: number,
): PhoneDevice {
  const activeChannel = defaultActiveChannelForMode(mode);
  return {
    deviceId,
    deviceName: deviceId,
    enabled: true,
    online: true,
    mode,
    platform: "android",
    privilegeChannel: defaultPrivilegeChannelForMode(mode),
    activeChannel,
    effectiveReady: mode !== "app",
    virtualDisplayId: mode === "virtual" ? 2 : null,
    overlayPermissionGranted: false,
    allowRelayControl: true,
    connectedViaRelay: false,
    paused: false,
    onMainScreenTakeover: false,
    outwardConfirmTier: "always_ask",
    unlockedPackages: [],
    screenWidth: 1080,
    screenHeight: 2400,
    lastSeenAt: now,
    lastError: null,
  };
}

function applyDisplayAndErrorMutation(
  base: PhoneDevice,
  input: RpcInput<typeof phoneRegisterDevice>,
): void {
  const priv = input.privilegeStatus;
  const nextDisplay =
    input.virtualDisplayId !== undefined ? input.virtualDisplayId : priv?.virtualDisplayId;
  if (nextDisplay !== undefined) base.virtualDisplayId = nextDisplay;

  const nextOverlay = input.overlayPermissionGranted ?? priv?.overlayPermissionGranted;
  if (nextOverlay !== undefined) base.overlayPermissionGranted = nextOverlay;

  const nextErr = input.lastError !== undefined ? input.lastError : priv?.lastError;
  if (nextErr !== undefined) base.lastError = nextErr;
}

function applyPrivilegeMutation(
  base: PhoneDevice,
  input: RpcInput<typeof phoneRegisterDevice>,
): void {
  const priv = input.privilegeStatus;
  if (input.privilegeChannel !== undefined) base.privilegeChannel = input.privilegeChannel;
  const rawActive = priv?.activeChannel ?? input.activeChannel;
  if (rawActive !== undefined) {
    base.activeChannel = rawActive === "auto" ? "none" : rawActive;
    if (base.mode === "app") base.effectiveReady = base.activeChannel !== "none";
  }
  const nextReady = input.effectiveReady ?? input.ready ?? priv?.ready;
  if (nextReady !== undefined) base.effectiveReady = nextReady;
  applyDisplayAndErrorMutation(base, input);
}

function applyRuntimeMutation(
  base: PhoneDevice,
  input: RpcInput<typeof phoneRegisterDevice>,
): void {
  const nameCandidate = input.deviceName?.trim() || input.name?.trim();
  if (nameCandidate) base.deviceName = nameCandidate;
  if (input.enabled !== undefined) base.enabled = input.enabled;
  if (input.online !== undefined) base.online = input.online;
  else base.online = true;
  if (input.platform !== undefined) base.platform = input.platform;
  if (input.allowRelayControl !== undefined) base.allowRelayControl = input.allowRelayControl;
  const relayFlag = input.connectedViaRelay ?? input.isRelay;
  if (relayFlag !== undefined) base.connectedViaRelay = relayFlag;
  if (input.paused !== undefined) base.paused = input.paused;
  if (input.onMainScreenTakeover !== undefined) {
    base.onMainScreenTakeover = input.onMainScreenTakeover;
  }
  if (input.outwardConfirmTier !== undefined) base.outwardConfirmTier = input.outwardConfirmTier;
  if (input.unlockedPackages !== undefined) base.unlockedPackages = [...input.unlockedPackages];
  if (input.adbSerial !== undefined) base.adbSerial = input.adbSerial;
  if (input.screenWidth !== undefined) base.screenWidth = input.screenWidth;
  if (input.screenHeight !== undefined) base.screenHeight = input.screenHeight;
}

function buildUpdatedPhoneDevice(
  input: RpcInput<typeof phoneRegisterDevice>,
  existing: PhoneDevice | undefined,
  now: number,
): PhoneDevice {
  const mode = input.mode ?? existing?.mode ?? "app";
  const base: PhoneDevice = existing
    ? { ...existing, mode, unlockedPackages: [...existing.unlockedPackages], lastSeenAt: now }
    : createDefaultPhoneDevice(input.deviceId, mode, now);
  applyPrivilegeMutation(base, input);
  applyRuntimeMutation(base, input);
  return base;
}

function outcomeToStepStatus(outcome: InternalCommandOutcome): PhoneStepTrailItem["status"] {
  if (outcome.unknownOutcome) return "unknown_outcome";
  return outcome.ok ? "succeeded" : "failed";
}

function annotateAppsBlocked(
  apps: readonly PhoneAppInfo[],
  unlockedPackages: readonly string[],
): PhoneAppInfo[] {
  const result: PhoneAppInfo[] = [];
  for (const app of apps) {
    const item: PhoneAppInfo = {
      packageName: app.packageName,
      appName: app.appName,
      blocked: isBlockedPhonePackage(app.packageName, unlockedPackages),
    };
    if (app.systemApp !== undefined) {
      item.systemApp = app.systemApp;
    }
    result.push(item);
  }
  return result;
}

function resolveScrollSwipeCoords(
  w: number,
  h: number,
  dir: string,
): [number, number, number, number] {
  const cx = Math.round(w / 2);
  if (dir === "up") return [cx, Math.round(h * 0.3), cx, Math.round(h * 0.75)];
  if (dir === "left") {
    return [Math.round(w * 0.8), Math.round(h * 0.5), Math.round(w * 0.2), Math.round(h * 0.5)];
  }
  if (dir === "right") {
    return [Math.round(w * 0.2), Math.round(h * 0.5), Math.round(w * 0.8), Math.round(h * 0.5)];
  }
  return [cx, Math.round(h * 0.75), cx, Math.round(h * 0.3)];
}

function applyVirtualLauncherTap(state: VirtualDeviceState, label: string): void {
  if (label === "微信") {
    state.packageName = "com.tencent.mm";
    state.appName = "微信";
    state.activityName = "com.tencent.mm.ui.LauncherUI";
    state.scrollPage = 0;
  } else if (label === "小红书") {
    state.packageName = "com.xingin.xhs";
    state.appName = "小红书";
    state.activityName = "com.xingin.xhs.index.v2.IndexActivityV2";
  } else if (label === "示例商城") {
    state.packageName = "com.demo.shop";
    state.appName = "示例商城";
    state.activityName = "com.demo.shop.ProductActivity";
  } else if (label === "设置") {
    state.packageName = "com.android.settings";
    state.appName = "设置";
    state.activityName = "com.android.settings.Settings";
  }
}

function applyVirtualIntentTransition(
  state: VirtualDeviceState,
  payload: Record<string, unknown>,
): void {
  const uri = typeof payload.uri === "string" ? payload.uri.trim() : "";
  const pkg = typeof payload.packageName === "string" ? payload.packageName.trim() : "";
  if (uri.startsWith("shop://cashier") || payload.activityName === "CashierActivity") {
    state.packageName = "com.demo.shop";
    state.appName = "示例商城";
    state.activityName = "com.demo.shop.CashierActivity";
    state.customObservation = null;
    return;
  }
  if (!pkg) return;
  const found = VIRTUAL_INSTALLED_APPS.find((a) => a.packageName === pkg);
  state.packageName = pkg;
  state.appName = found?.appName ?? pkg;
  state.activityName =
    typeof payload.activityName === "string" ? payload.activityName : `${pkg}.IntentActivity`;
  state.customObservation = null;
}

function applyVirtualTapTransition(
  device: PhoneDevice,
  state: VirtualDeviceState,
  currentRaw: PhoneObservation | null,
  payload: Record<string, unknown>,
  now: number,
): void {
  const base = currentRaw ?? buildVirtualObservation(device, state, now, false);
  const targetEl =
    typeof payload.ref === "string" ? findPhoneElementByRef(base.elements, payload.ref) : null;
  state.lastTapX =
    typeof payload.x === "number" ? payload.x : (targetEl?.x ?? Math.round(device.screenWidth / 2));
  state.lastTapY =
    typeof payload.y === "number"
      ? payload.y
      : (targetEl?.y ?? Math.round(device.screenHeight / 2));
  const label = (targetEl?.text ?? targetEl?.contentDescription ?? "").trim();
  if (state.packageName === "com.android.launcher3") {
    applyVirtualLauncherTap(state, label);
  } else if (state.packageName === "com.tencent.mm" && label === "发送" && state.draftText.trim()) {
    state.sentMessages.push(`我: ${state.draftText.trim()}`);
    state.draftText = "";
  } else if (state.packageName === "com.demo.shop" && label === "去结算") {
    state.activityName = "com.demo.shop.CashierActivity";
  }
}

function applyVirtualScrollOrSwipe(
  state: VirtualDeviceState,
  kind: "scroll" | "swipe",
  payload: Record<string, unknown>,
): void {
  const maxPage = WECHAT_FEED_PAGES.length - 1;
  if (kind === "scroll") {
    const dir = String(payload.direction ?? "down");
    if (dir === "down") state.scrollPage = Math.min(maxPage, state.scrollPage + 1);
    else if (dir === "up") state.scrollPage = Math.max(0, state.scrollPage - 1);
    return;
  }
  const startY = Number(payload.startY ?? 1600);
  const endY = Number(payload.endY ?? 600);
  if (endY < startY) state.scrollPage = Math.min(maxPage, state.scrollPage + 1);
  else if (endY > startY) state.scrollPage = Math.max(0, state.scrollPage - 1);
  state.lastTapX = Number(payload.endX ?? 540);
  state.lastTapY = endY;
}

function applyVirtualStateTransition(
  device: PhoneDevice,
  state: VirtualDeviceState,
  currentRaw: PhoneObservation | null,
  kind: PhoneCommandKind,
  payload: Record<string, unknown>,
  now: number,
): void {
  if (kind === "launch_app") {
    const pkg = String(payload.packageName ?? "").trim();
    const found = VIRTUAL_INSTALLED_APPS.find((a) => a.packageName === pkg);
    state.packageName = pkg;
    state.appName = found?.appName ?? pkg;
    state.activityName = `${pkg}.MainActivity`;
    state.scrollPage = 0;
    state.customObservation = null;
    return;
  }
  if (kind === "intent") {
    applyVirtualIntentTransition(state, payload);
    return;
  }
  if (kind === "tap") {
    applyVirtualTapTransition(device, state, currentRaw, payload, now);
    return;
  }
  if (kind === "type") {
    const text = String(payload.text ?? "");
    state.draftText = payload.clearFirst ? text : `${state.draftText}${text}`;
    if (payload.submit && state.packageName === "com.tencent.mm" && state.draftText.trim()) {
      state.sentMessages.push(`我: ${state.draftText.trim()}`);
      state.draftText = "";
    }
    return;
  }
  if (kind === "scroll" || kind === "swipe") {
    applyVirtualScrollOrSwipe(state, kind, payload);
    return;
  }
  if (kind === "back") {
    const onShopCashier =
      state.packageName === "com.demo.shop" &&
      state.activityName === "com.demo.shop.CashierActivity";
    if (onShopCashier) {
      state.activityName = "com.demo.shop.ProductActivity";
    } else {
      state.packageName = "com.android.launcher3";
      state.appName = "Pixel Launcher";
      state.activityName = "com.android.launcher3.uioverrides.QuickstepLauncher";
    }
    state.customObservation = null;
  }
}

function resolveReportedScreenshot(
  obsInput: NonNullable<RpcInput<typeof phoneReportCommandResult>["observation"]>,
  input: RpcInput<typeof phoneReportCommandResult>,
): { base64: string | null; mime: "image/jpeg" | "image/png" } {
  const screenshotRaw = obsInput.screenshotBase64 ?? input.screenshotBase64 ?? null;
  const parsedShot = screenshotRaw ? stripDataUrlPrefix(screenshotRaw) : null;
  const mime =
    obsInput.screenshotMimeType ?? input.screenshotMimeType ?? parsedShot?.mimeType ?? "image/jpeg";
  return { base64: parsedShot ? parsedShot.base64 : null, mime };
}

function resolveTapPoint(
  obsInput: NonNullable<RpcInput<typeof phoneReportCommandResult>["observation"]>,
  input: RpcInput<typeof phoneReportCommandResult>,
): { x: number | null; y: number | null } {
  return {
    x: obsInput.lastTapX ?? input.lastTapX ?? null,
    y: obsInput.lastTapY ?? input.lastTapY ?? null,
  };
}

function buildObservationFromReportInput(
  device: PhoneDevice,
  obsInput: NonNullable<RpcInput<typeof phoneReportCommandResult>["observation"]>,
  input: RpcInput<typeof phoneReportCommandResult>,
  now: number,
): PhoneObservation {
  const elements = obsInput.elements ?? [];
  const shot = resolveReportedScreenshot(obsInput, input);
  const tap = resolveTapPoint(obsInput, input);
  const obs: PhoneObservation = {
    deviceId: device.deviceId,
    displayId: obsInput.displayId ?? device.virtualDisplayId,
    packageName: obsInput.packageName,
    activityName: obsInput.activityName ?? null,
    isSecureFlag: obsInput.isSecureFlag ?? false,
    screenWidth: obsInput.screenWidth ?? device.screenWidth,
    screenHeight: obsInput.screenHeight ?? device.screenHeight,
    treeQuality: obsInput.treeQuality ?? computeTreeQuality(elements),
    elements,
    screenshotBase64: shot.base64,
    screenshotMimeType: shot.mime,
    lastTapX: tap.x,
    lastTapY: tap.y,
    capturedAt: obsInput.capturedAt ?? now,
  };
  if (obsInput.appName) obs.appName = obsInput.appName;
  if (obsInput.summary) obs.summary = obsInput.summary;
  return obs;
}

function normalizeReportedObservation(
  record: DeviceRuntimeRecord,
  input: RpcInput<typeof phoneReportCommandResult>,
  now: number,
): PhoneObservation | null {
  if (input.observation) {
    return buildObservationFromReportInput(record.device, input.observation, input, now);
  }
  if (!input.screenshotBase64) {
    return null;
  }
  const parsedShot = stripDataUrlPrefix(input.screenshotBase64);
  const base: PhoneObservation = record.latestRawObservation ?? {
    deviceId: record.device.deviceId,
    displayId: record.device.virtualDisplayId,
    packageName: "android",
    elements: [],
    capturedAt: now,
  };
  return {
    ...base,
    screenshotBase64: parsedShot.base64,
    screenshotMimeType: input.screenshotMimeType ?? parsedShot.mimeType,
    lastTapX: input.lastTapX ?? base.lastTapX ?? null,
    lastTapY: input.lastTapY ?? base.lastTapY ?? null,
    capturedAt: now,
  };
}

function createPollWaitPromise(
  record: DeviceRuntimeRecord,
  waitMs: number,
): Promise<RpcOutput<typeof phonePollCommand>> {
  let resolvePromise!: (res: RpcOutput<typeof phonePollCommand>) => void;
  const promise = new Promise<RpcOutput<typeof phonePollCommand>>((resolve) => {
    resolvePromise = resolve;
  });

  const waiter: PollWaiter = {
    resolve: (res) => {
      clearTimeout(waiter.timer);
      record.pollWaiters.delete(waiter);
      resolvePromise(res);
    },
    timer: setTimeout(() => {
      record.pollWaiters.delete(waiter);
      resolvePromise({ command: null });
    }, waitMs),
  };
  waiter.timer.unref?.();
  record.pollWaiters.add(waiter);
  return promise;
}

export class AssistantPhoneManager {
  private readonly devices = new Map<string, DeviceRuntimeRecord>();
  private readonly now: () => number;
  private readonly commandTimeoutMs: number;
  private readonly stepsBudgetMs: number;
  private readonly outwardMinIntervalMs: number;
  private readonly adbRunner: AdbCommandRunner;
  private readonly recentSteps: PhoneStepTrailItem[] = [];
  private stepCounter = 0;
  private lastActiveDeviceId: string | null = null;
  private readonly taskConfirmedPackages = new Map<string, Set<string>>();
  private readonly oneShotConfirmedPackages = new Map<string, Set<string>>();
  private readonly lastOutwardAtByPackage = new Map<string, number>();

  constructor(options: AssistantPhoneManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.commandTimeoutMs = Math.min(
      PHONE_COMMAND_TIMEOUT_MS,
      options.commandTimeoutMs ?? PHONE_COMMAND_TIMEOUT_MS,
    );
    this.stepsBudgetMs = Math.min(
      PHONE_STEPS_MAX_DURATION_MS,
      options.stepsBudgetMs ?? PHONE_STEPS_MAX_DURATION_MS,
    );
    this.outwardMinIntervalMs = options.outwardMinIntervalMs ?? PHONE_DEFAULT_OUTWARD_INTERVAL_MS;
    this.adbRunner = options.adbRunner ?? defaultAdbRunner;
  }

  hasEnabledDevice(): boolean {
    for (const record of this.devices.values()) {
      if (record.device.enabled) return true;
    }
    return false;
  }

  listDevices(): PhoneDevice[] {
    const list = Array.from(this.devices.values(), (r) => ({ ...r.device }));
    return [...list].sort((a, b) => a.deviceName.localeCompare(b.deviceName));
  }

  getDevice(deviceIdOrName?: string): PhoneDevice | null {
    const record = this.resolveDeviceRecord(deviceIdOrName, false);
    return record ? { ...record.device } : null;
  }

  registerDevice(input: RpcInput<typeof phoneRegisterDevice>): PhoneDevice {
    return this.upsertDevice(input, true);
  }

  configureDevice(input: RpcInput<typeof phoneConfigureDevice>): PhoneDevice {
    return this.upsertDevice(input, false);
  }

  private upsertDevice(
    input: RpcInput<typeof phoneRegisterDevice>,
    isRegistration: boolean,
  ): PhoneDevice {
    const now = this.now();
    const existing = this.devices.get(input.deviceId);
    const device = buildUpdatedPhoneDevice(input, existing?.device, now);

    if (existing) {
      if (isRegistration && existing.inFlight.size > 0 && device.mode === "app") {
        this.settleDisconnectedInFlight(existing, "Phone reconnected mid-command.");
      }
      existing.device = device;
      if (!device.paused) {
        this.flushDeviceQueueToWaiters(existing);
      }
      this.lastActiveDeviceId = this.lastActiveDeviceId ?? device.deviceId;
      return { ...device };
    }

    const created: DeviceRuntimeRecord = {
      device,
      virtual: {
        packageName: "com.android.launcher3",
        appName: "Pixel Launcher",
        activityName: "com.android.launcher3.uioverrides.QuickstepLauncher",
        scrollPage: 0,
        draftText: "",
        sentMessages: [],
        clipboard: "",
        lastTapX: null,
        lastTapY: null,
        customObservation: null,
      },
      latestRawObservation: null,
      latestSanitizedObservation: null,
      queue: [],
      inFlight: new Map(),
      completedOutcomes: new Map(),
      pollWaiters: new Set(),
      activeTurnId: null,
      activeAssistantId: null,
      activeAssistantName: null,
    };

    if (device.mode === "virtual") {
      const initialRaw = buildVirtualObservation(device, created.virtual, now, true);
      created.latestRawObservation = initialRaw;
      created.latestSanitizedObservation = sanitizePhoneObservation(initialRaw);
    }

    this.devices.set(device.deviceId, created);
    this.lastActiveDeviceId = device.deviceId;
    return { ...device };
  }

  /** Test & simulator helper to inject a specific screen observation on a virtual/app device. */
  setVirtualObservation(deviceId: string, observation: Partial<PhoneObservation> | null): void {
    const record = this.devices.get(deviceId);
    if (!record) throw new Error(`Unknown phone device: ${deviceId}`);
    record.virtual.customObservation = observation;
    if (observation) {
      if (observation.packageName) record.virtual.packageName = observation.packageName;
      if (observation.appName) record.virtual.appName = observation.appName;
      if (observation.activityName !== undefined) {
        record.virtual.activityName = observation.activityName;
      }
      const raw = buildVirtualObservation(record.device, record.virtual, this.now(), true);
      record.latestRawObservation = raw;
      record.latestSanitizedObservation = sanitizePhoneObservation(raw);
    }
  }

  /** Marks an app device's transport disconnected; dispatched mutating commands become `unknown_outcome`. */
  markDeviceDisconnected(
    deviceId: string,
    reason = "Phone connection dropped mid-execution.",
  ): void {
    const record = this.devices.get(deviceId);
    if (!record) return;
    record.device = { ...record.device, online: false };
    this.settleDisconnectedInFlight(record, reason);
  }

  private settleDisconnectedInFlight(record: DeviceRuntimeRecord, reason: string): void {
    for (const [commandId, entry] of record.inFlight) {
      clearTimeout(entry.timer);
      record.inFlight.delete(commandId);
      if (entry.mutating) {
        const outcome: InternalCommandOutcome = {
          ok: false,
          unknownOutcome: true,
          commandId,
          error: reason,
        };
        record.completedOutcomes.set(commandId, outcome);
        this.recordStep({
          commandId,
          deviceId: record.device.deviceId,
          assistantId: entry.command.assistantId ?? null,
          assistantName: entry.command.assistantName ?? null,
          kind: entry.command.kind,
          label: `${entry.command.stepLabel ?? entry.command.kind} (unknown outcome)`,
          status: "unknown_outcome",
        });
        entry.resolve(outcome);
      } else {
        entry.reject(new Error(reason));
      }
    }
  }

  grantTakeoverConfirmation(input: {
    assistantId: string;
    conversationId: string;
    deviceId?: string | null;
    packageName?: string | null;
  }): void {
    if (input.deviceId) {
      const rec = this.devices.get(input.deviceId);
      if (rec) rec.device = { ...rec.device, onMainScreenTakeover: false };
    } else {
      for (const rec of this.devices.values()) {
        if (rec.device.onMainScreenTakeover) {
          rec.device = { ...rec.device, onMainScreenTakeover: false };
        }
      }
    }
    const pkg = input.packageName?.trim().toLowerCase();
    if (!pkg) return;
    const key = `${input.assistantId}:${input.conversationId}`;
    let taskSet = this.taskConfirmedPackages.get(key);
    if (!taskSet) {
      taskSet = new Set();
      this.taskConfirmedPackages.set(key, taskSet);
    }
    taskSet.add(pkg);

    let oneShot = this.oneShotConfirmedPackages.get(key);
    if (!oneShot) {
      oneShot = new Set();
      this.oneShotConfirmedPackages.set(key, oneShot);
    }
    oneShot.add(pkg);
  }

  private consumeOutwardConfirmation(
    assistantId: string,
    conversationId: string,
    packageName: string,
  ): { confirmedAction: boolean; taskConfirmed: ReadonlySet<string> } {
    const key = `${assistantId}:${conversationId}`;
    const normalized = packageName.trim().toLowerCase();
    const oneShot = this.oneShotConfirmedPackages.get(key);
    let confirmedAction = false;
    if (oneShot?.has(normalized)) {
      confirmedAction = true;
      oneShot.delete(normalized);
    }
    const taskConfirmed = this.taskConfirmedPackages.get(key) ?? new Set<string>();
    return { confirmedAction, taskConfirmed };
  }

  async pollCommand(
    input: RpcInput<typeof phonePollCommand>,
  ): Promise<RpcOutput<typeof phonePollCommand>> {
    const now = this.now();
    let record = this.devices.get(input.deviceId);
    if (!record) {
      this.registerDevice({
        deviceId: input.deviceId,
        deviceName: input.deviceId,
        mode: "app",
        enabled: true,
        ...(input.isRelay !== undefined ? { isRelay: input.isRelay } : {}),
        ...(input.paused !== undefined ? { paused: input.paused } : {}),
      });
      record = this.devices.get(input.deviceId)!;
    } else {
      record.device = {
        ...record.device,
        online: true,
        lastSeenAt: now,
        ...(input.isRelay !== undefined ? { connectedViaRelay: input.isRelay } : {}),
        ...(input.paused !== undefined ? { paused: input.paused } : {}),
      };
    }

    if (record.device.connectedViaRelay && !record.device.allowRelayControl) {
      return { command: null, relayBlocked: true };
    }

    if (!record.device.paused && record.device.enabled) {
      const next = this.popNextCommandForPoll(record);
      if (next) return { command: next };
    }

    const waitMs = Math.min(
      PHONE_POLL_DEFAULT_WAIT_MS,
      Math.max(0, input.waitMs ?? PHONE_POLL_DEFAULT_WAIT_MS),
    );
    if (waitMs === 0) {
      return { command: null };
    }
    return createPollWaitPromise(record, waitMs);
  }

  private popNextCommandForPoll(record: DeviceRuntimeRecord): PhoneCommand | null {
    const entry = record.queue.shift();
    if (!entry) return null;
    entry.dispatched = true;
    record.inFlight.set(entry.command.commandId, entry);
    return entry.command;
  }

  private flushDeviceQueueToWaiters(record: DeviceRuntimeRecord): void {
    if (record.device.paused || !record.device.enabled) return;
    if (record.device.connectedViaRelay && !record.device.allowRelayControl) return;
    for (const waiter of record.pollWaiters) {
      const next = this.popNextCommandForPoll(record);
      if (!next) break;
      waiter.resolve({ command: next });
    }
  }

  private findRecordForCommandReport(
    deviceId: string | undefined,
    commandId: string,
  ): DeviceRuntimeRecord | undefined {
    if (deviceId) {
      const direct = this.devices.get(deviceId);
      if (direct) return direct;
    }
    for (const candidate of this.devices.values()) {
      if (
        candidate.inFlight.has(commandId) ||
        candidate.completedOutcomes.has(commandId) ||
        candidate.queue.some((q) => q.command.commandId === commandId)
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  private detachPendingCommand(
    record: DeviceRuntimeRecord,
    commandId: string,
  ): PendingCommandEntry | undefined {
    const inFlight = record.inFlight.get(commandId);
    if (inFlight) {
      record.inFlight.delete(commandId);
      return inFlight;
    }
    const queuedIdx = record.queue.findIndex((q) => q.command.commandId === commandId);
    if (queuedIdx >= 0) {
      return record.queue.splice(queuedIdx, 1)[0];
    }
    return undefined;
  }

  reportCommandResult(
    input: RpcInput<typeof phoneReportCommandResult>,
  ): RpcOutput<typeof phoneReportCommandResult> {
    const now = this.now();
    const record = this.findRecordForCommandReport(input.deviceId, input.commandId);
    if (!record) {
      throw new Error(`Unknown phone device or command: ${input.deviceId ?? input.commandId}`);
    }

    record.device = { ...record.device, online: true, lastSeenAt: now };
    if (record.completedOutcomes.has(input.commandId)) {
      return { accepted: true, duplicate: true };
    }

    const pending = this.detachPendingCommand(record, input.commandId);
    const normalizedObservation = normalizeReportedObservation(record, input, now);
    if (normalizedObservation) {
      this.storeObservation(record, normalizedObservation);
    }

    const ok = input.ok ?? (!input.error && !input.isError);
    const payloadData = input.data ?? input.result;
    const outcome: InternalCommandOutcome = {
      ok,
      commandId: input.commandId,
      observation: normalizedObservation,
    };
    if (input.error) outcome.error = input.error;
    if (input.apps) outcome.apps = input.apps;
    if (input.clipboardText !== undefined || input.text !== undefined) {
      outcome.clipboardText = input.clipboardText ?? input.text ?? null;
    }
    if (payloadData) outcome.data = payloadData;

    record.completedOutcomes.set(input.commandId, outcome);
    if (record.completedOutcomes.size > 200) {
      const oldestKey = record.completedOutcomes.keys().next().value;
      if (oldestKey) record.completedOutcomes.delete(oldestKey);
    }

    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(outcome);
    }

    return { accepted: true, duplicate: false };
  }

  emergencyStop(input: { deviceId?: string; reason?: string }): {
    cancelledCommandIds: string[];
    activeTurnIds: string[];
  } {
    const reason = input.reason?.trim() || "Emergency stop triggered on phone.";
    const cancelledCommandIds: string[] = [];
    const activeTurnIds = new Set<string>();
    const targets = input.deviceId
      ? [this.devices.get(input.deviceId)].filter((x): x is DeviceRuntimeRecord => Boolean(x))
      : [...this.devices.values()];

    for (const record of targets) {
      if (record.activeTurnId) activeTurnIds.add(record.activeTurnId);
      for (const entry of record.queue.splice(0)) {
        clearTimeout(entry.timer);
        cancelledCommandIds.push(entry.command.commandId);
        if (entry.command.turnId) activeTurnIds.add(entry.command.turnId);
        entry.reject(new Error(reason));
      }
      for (const [commandId, entry] of record.inFlight) {
        clearTimeout(entry.timer);
        record.inFlight.delete(commandId);
        cancelledCommandIds.push(commandId);
        if (entry.command.turnId) activeTurnIds.add(entry.command.turnId);
        entry.reject(new Error(reason));
      }
      for (const waiter of record.pollWaiters) {
        waiter.resolve({ command: null });
      }
      record.activeTurnId = null;
      record.activeAssistantId = null;
      record.activeAssistantName = null;
      record.device = { ...record.device, paused: false };
      this.recordStep({
        deviceId: record.device.deviceId,
        kind: "emergency_stop",
        label: reason,
        status: "cancelled",
      });
    }

    return {
      cancelledCommandIds,
      activeTurnIds: [...activeTurnIds],
    };
  }

  private pickLiveStateTarget(
    devices: readonly PhoneDevice[],
    input?: RpcInput<typeof phoneGetLiveState>,
  ): DeviceRuntimeRecord | undefined {
    if (input?.deviceId) return this.devices.get(input.deviceId);
    if (input?.assistantId) {
      for (const rec of this.devices.values()) {
        if (rec.activeAssistantId === input.assistantId) return rec;
      }
    }
    if (this.lastActiveDeviceId) {
      const byLast = this.devices.get(this.lastActiveDeviceId);
      if (byLast) return byLast;
    }
    return devices[0] ? this.devices.get(devices[0].deviceId) : undefined;
  }

  private isRecordActivelyExecuting(record: DeviceRuntimeRecord | undefined): boolean {
    if (!record) return false;
    return (
      record.queue.length > 0 ||
      record.inFlight.size > 0 ||
      record.activeTurnId !== null ||
      record.device.onMainScreenTakeover
    );
  }

  private buildEmptyLiveState(
    devices: PhoneDevice[],
    recentSteps: PhoneStepTrailItem[],
  ): PhoneLiveState {
    return {
      active: false,
      paused: false,
      onMainScreenTakeover: false,
      activeDeviceId: null,
      activeAssistantId: null,
      activeAssistantName: null,
      activeTurnId: null,
      devices,
      latestObservation: null,
      screenshotBase64: null,
      screenshotDataUrl: null,
      displayId: null,
      packageName: null,
      appName: null,
      lastTapX: null,
      lastTapY: null,
      screenWidth: 1080,
      screenHeight: 2400,
      recentSteps,
    };
  }

  private buildObservationSummaryFields(
    target: DeviceRuntimeRecord,
  ): Pick<
    PhoneLiveState,
    | "screenshotBase64"
    | "screenshotDataUrl"
    | "displayId"
    | "packageName"
    | "appName"
    | "lastTapX"
    | "lastTapY"
    | "screenWidth"
    | "screenHeight"
  > {
    const obs = target.latestSanitizedObservation;
    if (!obs) {
      return {
        screenshotBase64: null,
        screenshotDataUrl: null,
        displayId: target.device.virtualDisplayId,
        packageName: null,
        appName: null,
        lastTapX: null,
        lastTapY: null,
        screenWidth: target.device.screenWidth,
        screenHeight: target.device.screenHeight,
      };
    }
    const shotBase64 = obs.screenshotBase64 ?? null;
    const shotMime = obs.screenshotMimeType ?? "image/jpeg";
    return {
      screenshotBase64: shotBase64,
      screenshotDataUrl: toScreenshotDataUrl(shotBase64, shotMime),
      displayId: obs.displayId ?? target.device.virtualDisplayId,
      packageName: obs.packageName,
      appName: obs.appName ?? null,
      lastTapX: obs.lastTapX ?? null,
      lastTapY: obs.lastTapY ?? null,
      screenWidth: obs.screenWidth ?? target.device.screenWidth,
      screenHeight: obs.screenHeight ?? target.device.screenHeight,
    };
  }

  getLiveState(input?: RpcInput<typeof phoneGetLiveState>): PhoneLiveState {
    const devices = this.listDevices();
    const recentSteps = input?.deviceId
      ? this.recentSteps.filter((s) => s.deviceId === input.deviceId)
      : [...this.recentSteps];
    const target = this.pickLiveStateTarget(devices, input);
    if (!target) {
      return this.buildEmptyLiveState(devices, recentSteps);
    }

    return {
      active: this.isRecordActivelyExecuting(target),
      paused: target.device.paused,
      onMainScreenTakeover: target.device.onMainScreenTakeover,
      activeDeviceId: target.device.deviceId,
      activeAssistantId: target.activeAssistantId,
      activeAssistantName: target.activeAssistantName,
      activeTurnId: target.activeTurnId,
      devices,
      latestObservation: target.latestSanitizedObservation,
      ...this.buildObservationSummaryFields(target),
      recentSteps,
    };
  }

  close(): void {
    for (const record of this.devices.values()) {
      for (const entry of record.queue.splice(0)) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Phone manager is closing."));
      }
      for (const [, entry] of record.inFlight) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Phone manager is closing."));
      }
      record.inFlight.clear();
      for (const waiter of record.pollWaiters) {
        waiter.resolve({ command: null });
      }
      record.pollWaiters.clear();
    }
  }

  private storeObservation(record: DeviceRuntimeRecord, raw: PhoneObservation): PhoneObservation {
    const sanitized = sanitizePhoneObservation(raw);
    record.latestRawObservation = raw;
    record.latestSanitizedObservation = sanitized;
    this.lastActiveDeviceId = record.device.deviceId;
    return sanitized;
  }

  private recordStep(input: {
    commandId?: string;
    deviceId: string;
    assistantId?: string | null;
    assistantName?: string | null;
    kind: string;
    label: string;
    packageName?: string;
    appName?: string;
    status: PhoneStepTrailItem["status"];
    tapX?: number | null;
    tapY?: number | null;
  }): void {
    this.stepCounter += 1;
    const item: PhoneStepTrailItem = {
      step: this.stepCounter,
      deviceId: input.deviceId,
      assistantId: input.assistantId ?? null,
      assistantName: input.assistantName ?? null,
      kind: input.kind,
      label: input.label,
      status: input.status,
      tapX: input.tapX ?? null,
      tapY: input.tapY ?? null,
      timestamp: this.now(),
    };
    if (input.commandId) item.commandId = input.commandId;
    if (input.packageName) item.packageName = input.packageName;
    if (input.appName) item.appName = input.appName;
    this.recentSteps.push(item);
    if (this.recentSteps.length > PHONE_MAX_RECENT_STEPS) {
      this.recentSteps.splice(0, this.recentSteps.length - PHONE_MAX_RECENT_STEPS);
    }
  }

  resolveDeviceRecord(
    requestedDevice: string | undefined,
    requireEnabled = true,
    allowedDeviceIds?: readonly string[],
  ): DeviceRuntimeRecord | null {
    const allowedSet =
      allowedDeviceIds && allowedDeviceIds.length > 0 ? new Set(allowedDeviceIds) : null;
    const candidates = [...this.devices.values()].filter((rec) => {
      if (requireEnabled && !rec.device.enabled) return false;
      if (allowedSet && !allowedSet.has(rec.device.deviceId)) return false;
      return true;
    });

    if (!requestedDevice) {
      if (candidates.length === 1) return candidates[0]!;
      if (this.lastActiveDeviceId) {
        const last = candidates.find((c) => c.device.deviceId === this.lastActiveDeviceId);
        if (last) return last;
      }
      if (candidates.length === 0) return null;
      throw new Error(
        `Multiple Android phones are available (${candidates.map((c) => `"${c.device.deviceName}" [${c.device.deviceId}]`).join(", ")}). Pass device by ID or name.`,
      );
    }

    const needle = requestedDevice.trim().toLowerCase();
    const match = candidates.find(
      (rec) =>
        rec.device.deviceId.toLowerCase() === needle ||
        rec.device.deviceName.toLowerCase() === needle,
    );
    if (match) return match;

    const rawMatch = [...this.devices.values()].find(
      (rec) =>
        rec.device.deviceId.toLowerCase() === needle ||
        rec.device.deviceName.toLowerCase() === needle,
    );
    if (rawMatch && !rawMatch.device.enabled && requireEnabled) {
      throw new Error(
        `Phone "${rawMatch.device.deviceName}" has its Phone Control master switch turned off.`,
      );
    }
    if (rawMatch && allowedSet && !allowedSet.has(rawMatch.device.deviceId)) {
      throw new Error(
        `Assistant is not authorized to control phone "${rawMatch.device.deviceName}".`,
      );
    }
    return null;
  }

  private requireCallableDevice(
    caller: AuthorizedPhoneCaller,
    requestedDevice?: string,
  ): DeviceRuntimeRecord {
    const record = this.resolveDeviceRecord(
      requestedDevice,
      true,
      caller.assistant.phone?.allowedDeviceIds,
    );
    if (!record) {
      if (this.devices.size === 0) {
        throw new Error(
          "No Android phone is registered for Phone Control yet. Open Phone Control settings in the Paseo Android app to enable it.",
        );
      }
      throw new Error(
        requestedDevice
          ? `Phone "${requestedDevice}" was not found or is disabled. Call pavra-phone_devices to list available phones.`
          : "No enabled Android phone is currently available. Enable Phone Control on your phone first.",
      );
    }
    if (record.device.connectedViaRelay && !record.device.allowRelayControl) {
      throw new Error(
        `Phone "${record.device.deviceName}" is connected via Relay (non-LAN) while 'Allow 5G / Encrypted Relay Control' is disabled on the phone.`,
      );
    }
    if (!record.device.effectiveReady) {
      throw new Error(
        `Phone "${record.device.deviceName}" privilege channel is not ready (${record.device.lastError ?? "pair Shizuku or Wireless Debugging in Phone Control settings"}).`,
      );
    }
    record.activeTurnId = caller.turnId;
    record.activeAssistantId = caller.assistant.id;
    record.activeAssistantName = caller.assistant.name;
    this.lastActiveDeviceId = record.device.deviceId;
    return record;
  }

  private async dispatchDeviceCommand(
    record: DeviceRuntimeRecord,
    caller: AuthorizedPhoneCaller,
    kind: PhoneCommandKind,
    payload: Record<string, unknown>,
    stepLabel: string,
    timeoutMs = this.commandTimeoutMs,
  ): Promise<InternalCommandOutcome> {
    const cappedTimeout = Math.max(250, Math.min(this.commandTimeoutMs, timeoutMs));
    const commandId = randomUUID();

    if (record.device.mode === "virtual") {
      return this.executeVirtualCommand(record, caller, commandId, kind, payload, stepLabel);
    }
    if (record.device.mode === "adb") {
      return this.executeAdbDeviceCommand(
        record,
        caller,
        commandId,
        kind,
        payload,
        stepLabel,
        cappedTimeout,
      );
    }

    const mutating = isMutatingCommand(kind, payload);
    const command: PhoneCommand = {
      commandId,
      deviceId: record.device.deviceId,
      kind,
      payload,
      assistantId: caller.assistant.id,
      assistantName: caller.assistant.name,
      conversationId: caller.conversationId,
      turnId: caller.turnId,
      stepLabel,
      createdAt: this.now(),
      timeoutMs: cappedTimeout,
    };

    return new Promise<InternalCommandOutcome>((resolve, reject) => {
      const entry: PendingCommandEntry = {
        command,
        mutating,
        dispatched: false,
        resolve: (outcome) => {
          this.recordStep({
            commandId,
            deviceId: record.device.deviceId,
            assistantId: caller.assistant.id,
            assistantName: caller.assistant.name,
            kind,
            label: stepLabel,
            packageName: outcome.observation?.packageName,
            appName: outcome.observation?.appName,
            status: outcomeToStepStatus(outcome),
            tapX: outcome.observation?.lastTapX ?? null,
            tapY: outcome.observation?.lastTapY ?? null,
          });
          resolve(outcome);
        },
        reject: (err) => {
          this.recordStep({
            commandId,
            deviceId: record.device.deviceId,
            assistantId: caller.assistant.id,
            assistantName: caller.assistant.name,
            kind,
            label: stepLabel,
            status: "failed",
          });
          reject(err);
        },
        timer: setTimeout(() => {
          this.handleQueuedCommandTimeout(record, entry, cappedTimeout);
        }, cappedTimeout),
      };
      entry.timer.unref?.();
      record.queue.push(entry);
      this.flushDeviceQueueToWaiters(record);
    });
  }

  private handleQueuedCommandTimeout(
    record: DeviceRuntimeRecord,
    entry: PendingCommandEntry,
    cappedTimeout: number,
  ): void {
    const { commandId, kind } = entry.command;
    if (entry.dispatched) {
      record.inFlight.delete(commandId);
      if (entry.mutating) {
        const unknownOutcome: InternalCommandOutcome = {
          ok: false,
          unknownOutcome: true,
          commandId,
          error: `Command "${kind}" was sent to "${record.device.deviceName}", but timed out before its result returned.`,
        };
        record.completedOutcomes.set(commandId, unknownOutcome);
        entry.resolve(unknownOutcome);
        return;
      }
    } else {
      const idx = record.queue.indexOf(entry);
      if (idx >= 0) record.queue.splice(idx, 1);
    }
    entry.reject(
      new Error(
        `Timed out after ${cappedTimeout}ms waiting for phone "${record.device.deviceName}" to complete "${kind}".`,
      ),
    );
  }

  private async executeVirtualCommand(
    record: DeviceRuntimeRecord,
    caller: AuthorizedPhoneCaller,
    commandId: string,
    kind: PhoneCommandKind,
    payload: Record<string, unknown>,
    stepLabel: string,
  ): Promise<InternalCommandOutcome> {
    const now = this.now();
    const state = record.virtual;

    if (kind === "list_apps") {
      const apps = annotateAppsBlocked(VIRTUAL_INSTALLED_APPS, record.device.unlockedPackages);
      this.recordStep({
        commandId,
        deviceId: record.device.deviceId,
        assistantId: caller.assistant.id,
        assistantName: caller.assistant.name,
        kind,
        label: stepLabel,
        status: "succeeded",
      });
      return { ok: true, commandId, apps };
    }

    if (kind === "clipboard") {
      if (payload.action === "set") {
        state.clipboard = String(payload.text ?? "");
      }
      this.recordStep({
        commandId,
        deviceId: record.device.deviceId,
        assistantId: caller.assistant.id,
        assistantName: caller.assistant.name,
        kind,
        label: stepLabel,
        status: "succeeded",
      });
      return {
        ok: true,
        commandId,
        clipboardText: redactPhoneUiTreeText(state.clipboard),
      };
    }

    applyVirtualStateTransition(
      record.device,
      state,
      record.latestRawObservation,
      kind,
      payload,
      now,
    );

    const rawObs = buildVirtualObservation(record.device, state, now, true);
    this.storeObservation(record, rawObs);
    const includeScreenshot = Boolean(payload.includeScreenshot);
    const returnedObs: PhoneObservation = {
      ...rawObs,
      screenshotBase64: includeScreenshot ? rawObs.screenshotBase64 : null,
    };

    this.recordStep({
      commandId,
      deviceId: record.device.deviceId,
      assistantId: caller.assistant.id,
      assistantName: caller.assistant.name,
      kind,
      label: stepLabel,
      packageName: rawObs.packageName,
      appName: rawObs.appName,
      status: "succeeded",
      tapX: rawObs.lastTapX ?? null,
      tapY: rawObs.lastTapY ?? null,
    });

    return { ok: true, commandId, observation: returnedObs };
  }

  private adbArgs(record: DeviceRuntimeRecord, args: readonly string[]): string[] {
    const serial = record.device.adbSerial?.trim();
    return serial ? ["-s", serial, ...args] : [...args];
  }

  private adbDisplayArg(record: DeviceRuntimeRecord): string[] {
    const displayId = record.device.virtualDisplayId;
    return displayId && displayId > 0 ? ["-d", String(displayId)] : [];
  }

  private async runAdbInputMutation(
    record: DeviceRuntimeRecord,
    kind: PhoneCommandKind,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    const displayArg = this.adbDisplayArg(record);
    if (kind === "tap") {
      await this.runAdbTap(record, displayArg, payload, timeoutMs);
      return;
    }
    if (kind === "type") {
      await this.runAdbType(record, displayArg, payload, timeoutMs);
      return;
    }
    if (kind === "scroll") {
      const [sx, sy, ex, ey] = resolveScrollSwipeCoords(
        record.device.screenWidth,
        record.device.screenHeight,
        String(payload.direction ?? "down"),
      );
      await this.adbRunner(
        this.adbArgs(record, [
          "shell",
          "input",
          ...displayArg,
          "swipe",
          String(sx),
          String(sy),
          String(ex),
          String(ey),
          "300",
        ]),
        { timeoutMs },
      );
      return;
    }
    if (kind === "swipe") {
      await this.adbRunner(
        this.adbArgs(record, [
          "shell",
          "input",
          ...displayArg,
          "swipe",
          String(Math.round(Number(payload.startX ?? 540))),
          String(Math.round(Number(payload.startY ?? 1600))),
          String(Math.round(Number(payload.endX ?? 540))),
          String(Math.round(Number(payload.endY ?? 600))),
          String(Math.round(Number(payload.durationMs ?? 300))),
        ]),
        { timeoutMs },
      );
      return;
    }
    if (kind === "back") {
      await this.adbRunner(
        this.adbArgs(record, ["shell", "input", ...displayArg, "keyevent", "4"]),
        { timeoutMs },
      );
      return;
    }
    if (kind === "launch_app" || kind === "intent") {
      await this.runAdbLaunchOrIntent(record, kind, payload, timeoutMs);
    }
  }

  private async runAdbTap(
    record: DeviceRuntimeRecord,
    displayArg: readonly string[],
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    const current = record.latestRawObservation;
    const targetEl =
      typeof payload.ref === "string" && current
        ? findPhoneElementByRef(current.elements, payload.ref)
        : null;
    const x = typeof payload.x === "number" ? payload.x : targetEl?.x;
    const y = typeof payload.y === "number" ? payload.y : targetEl?.y;
    if (typeof x !== "number" || typeof y !== "number") {
      throw new Error("Could not resolve tap coordinates; call pavra-phone_observe first.");
    }
    const longPressMs = typeof payload.longPressMs === "number" ? payload.longPressMs : 0;
    const inputArgs =
      longPressMs > 0
        ? ["swipe", String(x), String(y), String(x), String(y), String(longPressMs)]
        : ["tap", String(x), String(y)];
    await this.adbRunner(this.adbArgs(record, ["shell", "input", ...displayArg, ...inputArgs]), {
      timeoutMs,
    });
    record.virtual.lastTapX = x;
    record.virtual.lastTapY = y;
  }

  private async runAdbType(
    record: DeviceRuntimeRecord,
    displayArg: readonly string[],
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    if (typeof payload.ref === "string" && record.latestRawObservation) {
      const targetEl = findPhoneElementByRef(record.latestRawObservation.elements, payload.ref);
      if (targetEl?.x !== undefined && targetEl?.y !== undefined) {
        await this.adbRunner(
          this.adbArgs(record, [
            "shell",
            "input",
            ...displayArg,
            "tap",
            String(targetEl.x),
            String(targetEl.y),
          ]),
          { timeoutMs },
        );
      }
    }
    const escaped = String(payload.text ?? "")
      .replace(/ /g, "%s")
      .replace(/["'`$\\]/g, "");
    await this.adbRunner(this.adbArgs(record, ["shell", "input", ...displayArg, "text", escaped]), {
      timeoutMs,
    });
    if (payload.submit) {
      await this.adbRunner(
        this.adbArgs(record, ["shell", "input", ...displayArg, "keyevent", "66"]),
        { timeoutMs },
      );
    }
  }

  private async runAdbLaunchOrIntent(
    record: DeviceRuntimeRecord,
    kind: "launch_app" | "intent",
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    const displayId = record.device.virtualDisplayId;
    const displayFlag = displayId && displayId > 0 ? ["--display", String(displayId)] : [];
    if (kind === "launch_app") {
      const pkg = String(payload.packageName ?? "").trim();
      await this.adbRunner(
        this.adbArgs(record, [
          "shell",
          "monkey",
          "-p",
          pkg,
          "-c",
          "android.intent.category.LAUNCHER",
          ...displayFlag,
          "1",
        ]),
        { timeoutMs },
      );
      return;
    }
    const amArgs = ["shell", "am", "start", ...displayFlag];
    if (typeof payload.action === "string" && payload.action) amArgs.push("-a", payload.action);
    if (typeof payload.uri === "string" && payload.uri) amArgs.push("-d", payload.uri);
    if (typeof payload.packageName === "string" && payload.packageName) {
      amArgs.push("-p", payload.packageName);
    }
    await this.adbRunner(this.adbArgs(record, amArgs), { timeoutMs });
  }

  private async executeAdbDeviceCommand(
    record: DeviceRuntimeRecord,
    caller: AuthorizedPhoneCaller,
    commandId: string,
    kind: PhoneCommandKind,
    payload: Record<string, unknown>,
    stepLabel: string,
    timeoutMs: number,
  ): Promise<InternalCommandOutcome> {
    if (kind === "list_apps") {
      const { stdout } = await this.adbRunner(
        this.adbArgs(record, ["shell", "pm", "list", "packages", "-3"]),
        { timeoutMs },
      );
      const rawApps: PhoneAppInfo[] = String(stdout)
        .split(/\r?\n/)
        .map((line) => line.replace(/^package:/, "").trim())
        .filter(Boolean)
        .map((pkg) => ({ packageName: pkg, appName: pkg, systemApp: false }));
      return {
        ok: true,
        commandId,
        apps: annotateAppsBlocked(rawApps, record.device.unlockedPackages),
      };
    }

    if (kind === "clipboard") {
      if (payload.action === "set") {
        const text = String(payload.text ?? "");
        await this.adbRunner(
          this.adbArgs(record, ["shell", "cmd", "clipboard", "set-text", text]),
          { timeoutMs },
        ).catch(() => undefined);
        return { ok: true, commandId, clipboardText: redactPhoneUiTreeText(text) };
      }
      const res = await this.adbRunner(
        this.adbArgs(record, ["shell", "cmd", "clipboard", "get-text"]),
        { timeoutMs },
      ).catch(() => ({ stdout: "", stderr: "" }));
      return {
        ok: true,
        commandId,
        clipboardText: redactPhoneUiTreeText(String(res.stdout).trim()),
      };
    }

    if (kind !== "observe") {
      await this.runAdbInputMutation(record, kind, payload, timeoutMs);
    }

    const dumpRes = await this.adbRunner(
      this.adbArgs(record, [
        "shell",
        "uiautomator dump /sdcard/pavra_uidump.xml >/dev/null 2>&1 && cat /sdcard/pavra_uidump.xml",
      ]),
      { timeoutMs },
    );
    const parsedTree = parseAndroidUiAutomatorXml(String(dumpRes.stdout));
    let screenshotBase64: string | null = null;
    let screenshotMimeType: "image/jpeg" | "image/png" = "image/jpeg";
    if (payload.includeScreenshot) {
      const capRes = await this.adbRunner(
        this.adbArgs(record, ["exec-out", "screencap", ...this.adbDisplayArg(record), "-p"]),
        { encoding: "buffer", timeoutMs },
      ).catch(() => null);
      if (capRes && Buffer.isBuffer(capRes.stdout) && capRes.stdout.length > 0) {
        screenshotBase64 = capRes.stdout.toString("base64");
        screenshotMimeType = "image/png";
      }
    }

    const obs: PhoneObservation = {
      deviceId: record.device.deviceId,
      displayId: record.device.virtualDisplayId,
      packageName: parsedTree.packageName,
      activityName: null,
      isSecureFlag: false,
      screenWidth: record.device.screenWidth,
      screenHeight: record.device.screenHeight,
      treeQuality: parsedTree.treeQuality,
      elements: parsedTree.elements,
      screenshotBase64,
      screenshotMimeType,
      lastTapX: record.virtual.lastTapX,
      lastTapY: record.virtual.lastTapY,
      capturedAt: this.now(),
    };
    this.storeObservation(record, obs);
    this.recordStep({
      commandId,
      deviceId: record.device.deviceId,
      assistantId: caller.assistant.id,
      assistantName: caller.assistant.name,
      kind,
      label: stepLabel,
      packageName: obs.packageName,
      status: "succeeded",
      tapX: obs.lastTapX ?? null,
      tapY: obs.lastTapY ?? null,
    });
    return { ok: true, commandId, observation: obs };
  }

  private copySanitizedOptionalFields(
    sanitized: PhoneObservation,
    output: PhoneToolObservationOutput,
  ): void {
    if (sanitized.appName) output.appName = sanitized.appName;
    if (sanitized.screenWidth) output.screenWidth = sanitized.screenWidth;
    if (sanitized.screenHeight) output.screenHeight = sanitized.screenHeight;
    if (sanitized.treeQuality) output.treeQuality = sanitized.treeQuality;
    if (sanitized.summary) output.summary = sanitized.summary;
  }

  private formatObservationToolResult(
    sanitized: PhoneObservation,
    options: {
      includeScreenshot?: boolean;
      rawScreenshotBase64?: string | null;
      screenshotMimeType?: "image/jpeg" | "image/png";
      status?: PhoneToolObservationOutput["status"];
      commandId?: string;
      takeoverId?: string | null;
      safetyReason?: string | null;
      instruction?: string;
      warning?: string;
    } = {},
  ): PhoneToolObservationOutput {
    const rawShot = options.includeScreenshot
      ? (options.rawScreenshotBase64 ?? sanitized.screenshotBase64 ?? null)
      : null;
    const parsedShot = rawShot ? stripDataUrlPrefix(rawShot) : null;
    const mimeType = options.screenshotMimeType ?? parsedShot?.mimeType ?? "image/jpeg";
    const hasScreenshot = Boolean(parsedShot && parsedShot.base64.length > 0);

    const output: PhoneToolObservationOutput = {
      status: options.status ?? "ok",
      deviceId: sanitized.deviceId,
      displayId: sanitized.displayId ?? null,
      packageName: sanitized.packageName,
      activityName: sanitized.activityName ?? null,
      isSecureFlag: sanitized.isSecureFlag ?? false,
      elements: sanitized.elements,
      hasScreenshot,
      lastTapX: sanitized.lastTapX ?? null,
      lastTapY: sanitized.lastTapY ?? null,
      capturedAt: sanitized.capturedAt,
    };
    this.copySanitizedOptionalFields(sanitized, output);
    if (hasScreenshot && parsedShot) {
      output.screenshotMimeType = mimeType;
      output._images = [{ data: parsedShot.base64, mimeType }];
    }
    this.applyToolResultMetadata(output, options);
    return output;
  }

  private applyToolResultMetadata(
    output: PhoneToolObservationOutput,
    options: {
      commandId?: string;
      takeoverId?: string | null;
      safetyReason?: string | null;
      instruction?: string;
      warning?: string;
    },
  ): void {
    if (options.commandId) output.commandId = options.commandId;
    if (options.takeoverId !== undefined) output.takeoverId = options.takeoverId;
    if (options.safetyReason !== undefined) output.safetyReason = options.safetyReason;
    if (options.instruction) output.instruction = options.instruction;
    if (options.warning) output.warning = options.warning;
  }

  private async triggerSafetyTakeover(
    coordinator: Coordinator,
    caller: AuthorizedPhoneCaller,
    record: DeviceRuntimeRecord,
    sanitizedObs: PhoneObservation,
    reason: string,
    status: "handed_to_user" | "confirmation_required",
    includeScreenshot?: boolean,
  ): Promise<PhoneToolObservationOutput> {
    record.device = { ...record.device, onMainScreenTakeover: true };
    const takeover = await coordinator.requestPhoneTakeover({
      assistant: caller.assistant,
      conversationId: caller.conversationId,
      threadId: caller.threadId,
      turnId: caller.turnId,
      deviceId: record.device.deviceId,
      packageName: sanitizedObs.packageName,
      appName: sanitizedObs.appName ?? null,
      displayId: sanitizedObs.displayId ?? record.device.virtualDisplayId ?? null,
      screenshotDataUrl: toScreenshotDataUrl(
        record.latestRawObservation?.screenshotBase64 ?? sanitizedObs.screenshotBase64,
        sanitizedObs.screenshotMimeType ?? "image/jpeg",
      ),
      reason,
    });
    this.recordStep({
      deviceId: record.device.deviceId,
      assistantId: caller.assistant.id,
      assistantName: caller.assistant.name,
      kind: "hand_to_user",
      label: reason,
      packageName: sanitizedObs.packageName,
      appName: sanitizedObs.appName,
      status: "handed_to_user",
    });
    const instruction =
      status === "confirmation_required"
        ? "SafetyGate paused before this outward social action. A confirmation/takeover card is shown in Chat; explain briefly what will be sent and end your turn so the user can approve and continue."
        : "SafetyGate halted automation and handed the phone screen to the user. Briefly explain what the user needs to complete on their phone (e.g. payment, password, or verification) and end your turn now.";
    return this.formatObservationToolResult(sanitizedObs, {
      includeScreenshot,
      status,
      takeoverId: takeover.id,
      safetyReason: reason,
      instruction,
    });
  }

  async observe(
    coordinator: Coordinator,
    caller: AuthorizedPhoneCaller,
    input: { device?: string; includeScreenshot?: boolean; timeoutMs?: number },
  ): Promise<PhoneToolObservationOutput> {
    const record = this.requireCallableDevice(caller, input.device);
    const outcome = await this.dispatchDeviceCommand(
      record,
      caller,
      "observe",
      { includeScreenshot: Boolean(input.includeScreenshot) },
      "Observe screen",
      input.timeoutMs,
    );
    if (!outcome.ok || !outcome.observation) {
      throw new Error(outcome.error ?? "Failed to observe phone screen.");
    }
    const rawObs = outcome.observation;
    const sanitized = sanitizePhoneObservation(rawObs);
    const gate = evaluatePhoneSafetyGate({
      action: "observe",
      observation: rawObs,
      unlockedPackages: record.device.unlockedPackages,
      outwardConfirmTier: record.device.outwardConfirmTier,
    });
    if (gate.decision === "deny") {
      throw new Error(gate.reason ?? `Access to "${rawObs.packageName}" is blocked by SafetyGate.`);
    }
    if (gate.decision === "require_takeover") {
      return this.triggerSafetyTakeover(
        coordinator,
        caller,
        record,
        sanitized,
        gate.reason ?? "Protected screen requires user takeover.",
        "handed_to_user",
        input.includeScreenshot,
      );
    }
    return this.formatObservationToolResult(sanitized, {
      includeScreenshot: input.includeScreenshot,
      rawScreenshotBase64: rawObs.screenshotBase64,
      screenshotMimeType: rawObs.screenshotMimeType,
      commandId: outcome.commandId,
    });
  }

  private computeOutwardPacingDelayMs(
    record: DeviceRuntimeRecord,
    packageName: string,
    kind: string,
    targetElement: PhoneUiElementLike | null,
    submit: boolean,
  ): number {
    if (this.outwardMinIntervalMs <= 0) return 0;
    if (!isOutwardSocialAction({ packageName, action: kind, targetElement, submit })) return 0;
    const pkgKey = `${record.device.deviceId}:${packageName.toLowerCase()}`;
    const now = this.now();
    const prevAt = this.lastOutwardAtByPackage.get(pkgKey) ?? 0;
    const elapsed = now - prevAt;
    if (prevAt > 0 && elapsed >= 0 && elapsed < this.outwardMinIntervalMs) {
      const waitMs = Math.min(2_000, this.outwardMinIntervalMs - elapsed);
      this.lastOutwardAtByPackage.set(pkgKey, now + waitMs);
      return waitMs;
    }
    this.lastOutwardAtByPackage.set(pkgKey, now);
    return 0;
  }

  private checkPreActionGateSync(
    caller: AuthorizedPhoneCaller,
    record: DeviceRuntimeRecord,
    kind: Exclude<PhoneCommandKind, "observe" | "list_apps" | "clipboard">,
    payload: Record<string, unknown>,
    targetPkg: string | undefined,
  ):
    | {
        kind: "takeover";
        raw: PhoneObservation;
        status: "handed_to_user" | "confirmation_required";
        reason: string;
      }
    | { kind: "allow"; pacingWaitMs: number } {
    if (
      !record.latestRawObservation &&
      (kind === "tap" || kind === "type") &&
      record.device.mode === "virtual"
    ) {
      this.storeObservation(
        record,
        buildVirtualObservation(record.device, record.virtual, this.now(), false),
      );
    }
    const currentRaw = record.latestRawObservation;
    if (!currentRaw) return { kind: "allow", pacingWaitMs: 0 };

    const targetRef = typeof payload.ref === "string" ? payload.ref : undefined;
    const targetElement = targetRef ? findPhoneElementByRef(currentRaw.elements, targetRef) : null;
    const confirmState = this.consumeOutwardConfirmation(
      caller.assistant.id,
      caller.conversationId,
      currentRaw.packageName,
    );
    const preGate = evaluatePhoneSafetyGate({
      action: kind,
      observation: currentRaw,
      targetPackageName: targetPkg,
      targetElement,
      targetRef,
      submit: Boolean(payload.submit),
      unlockedPackages: record.device.unlockedPackages,
      outwardConfirmTier: record.device.outwardConfirmTier,
      taskConfirmedPackages: confirmState.taskConfirmed,
      confirmedAction: confirmState.confirmedAction,
    });

    if (preGate.decision === "deny") {
      throw new Error(preGate.reason ?? "Blocked by SafetyGate.");
    }
    if (preGate.decision === "require_takeover" || preGate.decision === "require_confirmation") {
      return {
        kind: "takeover",
        raw: currentRaw,
        status:
          preGate.decision === "require_confirmation" ? "confirmation_required" : "handed_to_user",
        reason: preGate.reason ?? "User confirmation or takeover required.",
      };
    }

    const pacingWaitMs = this.computeOutwardPacingDelayMs(
      record,
      currentRaw.packageName,
      kind,
      targetElement,
      Boolean(payload.submit),
    );
    return { kind: "allow", pacingWaitMs };
  }

  async runAction(
    coordinator: Coordinator,
    caller: AuthorizedPhoneCaller,
    kind: Exclude<PhoneCommandKind, "observe" | "list_apps" | "clipboard">,
    payload: Record<string, unknown>,
    options: {
      device?: string;
      includeScreenshot?: boolean;
      stepLabel: string;
      timeoutMs?: number;
    },
  ): Promise<PhoneToolObservationOutput> {
    const record = this.requireCallableDevice(caller, options.device);
    const targetPkg =
      typeof payload.packageName === "string" && payload.packageName.trim()
        ? payload.packageName.trim()
        : undefined;

    if (targetPkg) {
      const pkgPolicy = checkPhonePackagePolicy(targetPkg, record.device.unlockedPackages);
      if (pkgPolicy.blocked) {
        throw new Error(pkgPolicy.reason ?? `Package "${targetPkg}" is blocked by SafetyGate.`);
      }
    }

    const preCheck = this.checkPreActionGateSync(caller, record, kind, payload, targetPkg);
    if (preCheck.kind === "takeover") {
      return this.triggerSafetyTakeover(
        coordinator,
        caller,
        record,
        sanitizePhoneObservation(preCheck.raw),
        preCheck.reason,
        preCheck.status,
        options.includeScreenshot,
      );
    }
    if (preCheck.pacingWaitMs > 0) {
      await new Promise((r) => setTimeout(r, preCheck.pacingWaitMs));
    }

    const outcome = await this.dispatchDeviceCommand(
      record,
      caller,
      kind,
      { ...payload, includeScreenshot: Boolean(options.includeScreenshot) },
      options.stepLabel,
      options.timeoutMs,
    );

    if (outcome.unknownOutcome) {
      return this.buildUnknownOutcomeResult(record, outcome.commandId, targetPkg);
    }
    if (!outcome.ok) {
      throw new Error(outcome.error ?? `Phone command "${kind}" failed.`);
    }

    return this.finalizePostActionObservation(
      coordinator,
      caller,
      record,
      outcome,
      targetPkg,
      options.includeScreenshot,
    );
  }

  private buildUnknownOutcomeResult(
    record: DeviceRuntimeRecord,
    commandId: string,
    targetPkg?: string,
  ): PhoneToolObservationOutput {
    const fallback =
      record.latestSanitizedObservation ??
      sanitizePhoneObservation({
        deviceId: record.device.deviceId,
        displayId: record.device.virtualDisplayId,
        packageName: targetPkg ?? "unknown",
        elements: [],
        capturedAt: this.now(),
      });
    return this.formatObservationToolResult(fallback, {
      status: "unknown_outcome",
      commandId,
      warning:
        "The action was delivered to the phone, but the connection dropped or timed out before its result returned. Outcome is unknown — DO NOT blindly repeat the action; call pavra-phone_observe first to inspect the screen.",
    });
  }

  private async finalizePostActionObservation(
    coordinator: Coordinator,
    caller: AuthorizedPhoneCaller,
    record: DeviceRuntimeRecord,
    outcome: InternalCommandOutcome,
    targetPkg: string | undefined,
    includeScreenshot?: boolean,
  ): Promise<PhoneToolObservationOutput> {
    const postRaw = outcome.observation ??
      record.latestRawObservation ?? {
        deviceId: record.device.deviceId,
        displayId: record.device.virtualDisplayId,
        packageName: targetPkg ?? "android",
        elements: [],
        capturedAt: this.now(),
      };
    const sanitizedPost = sanitizePhoneObservation(postRaw);
    const postGate = evaluatePhoneSafetyGate({
      action: "observe",
      observation: postRaw,
      unlockedPackages: record.device.unlockedPackages,
      outwardConfirmTier: record.device.outwardConfirmTier,
    });
    if (postGate.decision === "deny") {
      throw new Error(postGate.reason ?? `Blocked package "${postRaw.packageName}".`);
    }
    if (postGate.decision === "require_takeover") {
      return this.triggerSafetyTakeover(
        coordinator,
        caller,
        record,
        sanitizedPost,
        postGate.reason ?? "Screen requires user takeover on the phone.",
        "handed_to_user",
        includeScreenshot,
      );
    }
    return this.formatObservationToolResult(sanitizedPost, {
      includeScreenshot,
      rawScreenshotBase64: postRaw.screenshotBase64,
      screenshotMimeType: postRaw.screenshotMimeType,
      commandId: outcome.commandId,
    });
  }

  async listApps(
    caller: AuthorizedPhoneCaller,
    device?: string,
  ): Promise<{ deviceId: string; apps: PhoneAppInfo[] }> {
    const record = this.requireCallableDevice(caller, device);
    const outcome = await this.dispatchDeviceCommand(
      record,
      caller,
      "list_apps",
      {},
      "List installed apps",
    );
    if (!outcome.ok) {
      throw new Error(outcome.error ?? "Failed to list apps on phone.");
    }
    return {
      deviceId: record.device.deviceId,
      apps: annotateAppsBlocked(outcome.apps ?? [], record.device.unlockedPackages),
    };
  }

  async clipboard(
    caller: AuthorizedPhoneCaller,
    input: { device?: string; action: "get" | "set"; text?: string },
  ): Promise<{ deviceId: string; action: "get" | "set"; text: string | null }> {
    const record = this.requireCallableDevice(caller, input.device);
    if (input.action === "set" && typeof input.text !== "string") {
      throw new Error('Pass `text` when calling phone_clipboard with action "set".');
    }
    const outcome = await this.dispatchDeviceCommand(
      record,
      caller,
      "clipboard",
      { action: input.action, ...(input.text !== undefined ? { text: input.text } : {}) },
      input.action === "set" ? "Set clipboard text" : "Read clipboard text",
    );
    if (outcome.unknownOutcome) {
      throw new Error(outcome.error ?? "Clipboard command outcome is unknown.");
    }
    if (!outcome.ok) {
      throw new Error(outcome.error ?? "Clipboard operation failed.");
    }
    const rawText = outcome.clipboardText ?? (input.action === "set" ? (input.text ?? "") : null);
    return {
      deviceId: record.device.deviceId,
      action: input.action,
      text: rawText !== null ? redactPhoneUiTreeText(rawText) : null,
    };
  }

  private observationMatchesWait(obs: PhoneToolObservationOutput, wait: PhoneStepWait): boolean {
    if (
      wait.packageName &&
      obs.packageName.toLowerCase() !== wait.packageName.trim().toLowerCase()
    ) {
      return false;
    }
    if (!wait.textIncludes) return true;
    const needle = wait.textIncludes;
    if (obs.summary?.includes(needle)) return true;
    return obs.elements.some((el) =>
      Boolean(el.text?.includes(needle) || el.contentDescription?.includes(needle)),
    );
  }

  private async satisfyStepWait(
    coordinator: Coordinator,
    caller: AuthorizedPhoneCaller,
    deviceId: string,
    wait: PhoneStepWait | undefined,
    deadline: number,
  ): Promise<PhoneToolObservationOutput | null> {
    if (!wait) return null;
    const remaining = deadline - this.now();
    if (remaining <= 0) return null;

    if (!wait.textIncludes && !wait.packageName) {
      const sleepMs = Math.min(remaining, Math.max(0, wait.ms ?? 250));
      if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
      return null;
    }

    const waitDeadline = this.now() + Math.min(remaining, wait.ms ?? 3_000);
    let lastObs: PhoneToolObservationOutput | null = null;
    while (this.now() <= waitDeadline) {
      lastObs = await this.observe(coordinator, caller, {
        device: deviceId,
        includeScreenshot: false,
        timeoutMs: Math.max(250, waitDeadline - this.now()),
      });
      if (lastObs.status && lastObs.status !== "ok") return lastObs;
      if (this.observationMatchesWait(lastObs, wait)) return lastObs;
      if (this.now() + 100 > waitDeadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return lastObs;
  }

  private buildStepActionParams(
    step: Exclude<PhoneStep, { action: "wait" }>,
    index: number,
  ): {
    kind: Exclude<PhoneCommandKind, "observe" | "list_apps" | "clipboard">;
    payload: Record<string, unknown>;
    stepLabel: string;
  } {
    const prefix = `Step ${index + 1}`;
    if (step.action === "tap") {
      const payload: Record<string, unknown> = {};
      if (step.ref) payload.ref = step.ref;
      if (step.x !== undefined) payload.x = step.x;
      if (step.y !== undefined) payload.y = step.y;
      if (step.longPressMs !== undefined) payload.longPressMs = step.longPressMs;
      return {
        kind: "tap",
        payload,
        stepLabel: `${prefix}: tap ${step.ref ?? `(${step.x},${step.y})`}`,
      };
    }
    if (step.action === "type") {
      const payload: Record<string, unknown> = { text: step.text };
      if (step.ref) payload.ref = step.ref;
      if (step.clearFirst !== undefined) payload.clearFirst = step.clearFirst;
      if (step.submit !== undefined) payload.submit = step.submit;
      return { kind: "type", payload, stepLabel: `${prefix}: type` };
    }
    if (step.action === "scroll") {
      const dir = step.direction ?? "down";
      const payload: Record<string, unknown> = { direction: dir };
      if (step.delta !== undefined) payload.delta = step.delta;
      if (step.ref) payload.ref = step.ref;
      return { kind: "scroll", payload, stepLabel: `${prefix}: scroll ${dir}` };
    }
    if (step.action === "swipe") {
      const payload: Record<string, unknown> = {
        startX: step.startX,
        startY: step.startY,
        endX: step.endX,
        endY: step.endY,
      };
      if (step.durationMs !== undefined) payload.durationMs = step.durationMs;
      return { kind: "swipe", payload, stepLabel: `${prefix}: swipe` };
    }
    if (step.action === "back") {
      return { kind: "back", payload: {}, stepLabel: `${prefix}: back` };
    }
    return {
      kind: "launch_app",
      payload: { packageName: step.packageName },
      stepLabel: `${prefix}: launch ${step.packageName}`,
    };
  }

  async steps(
    coordinator: Coordinator,
    caller: AuthorizedPhoneCaller,
    input: {
      device?: string;
      steps: PhoneStep[];
      includeScreenshot?: boolean;
      maxDurationMs?: number;
    },
  ): Promise<{
    completedSteps: number;
    totalSteps: number;
    stoppedEarlyReason?: string;
    observation: PhoneToolObservationOutput;
  }> {
    const record = this.requireCallableDevice(caller, input.device);
    const budgetMs = Math.min(
      this.stepsBudgetMs,
      Math.max(500, input.maxDurationMs ?? this.stepsBudgetMs),
    );
    const deadline = this.now() + budgetMs;
    let completedSteps = 0;
    let lastResult: PhoneToolObservationOutput | null = null;
    let stoppedEarlyReason: string | undefined;

    for (let i = 0; i < input.steps.length; i++) {
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        stoppedEarlyReason = "budget_exceeded";
        break;
      }
      const step = input.steps[i]!;
      if (step.action === "wait") {
        const waited = await this.satisfyStepWait(
          coordinator,
          caller,
          record.device.deviceId,
          step,
          deadline,
        );
        if (waited) lastResult = waited;
        completedSteps += 1;
      } else {
        const wantShot = Boolean(input.includeScreenshot && i === input.steps.length - 1);
        const params = this.buildStepActionParams(step, i);
        lastResult = await this.runAction(coordinator, caller, params.kind, params.payload, {
          device: record.device.deviceId,
          includeScreenshot: wantShot,
          stepLabel: params.stepLabel,
          timeoutMs: remaining,
        });
        if (lastResult.status && lastResult.status !== "ok") {
          stoppedEarlyReason = lastResult.status;
          break;
        }
        completedSteps += 1;
        if (step.wait) {
          const waited = await this.satisfyStepWait(
            coordinator,
            caller,
            record.device.deviceId,
            step.wait,
            deadline,
          );
          if (waited) lastResult = waited;
        }
      }
      if (lastResult?.status && lastResult.status !== "ok") {
        stoppedEarlyReason = lastResult.status;
        break;
      }
    }

    if (
      !lastResult ||
      (input.includeScreenshot && !lastResult.hasScreenshot && lastResult.status === "ok")
    ) {
      lastResult = await this.observe(coordinator, caller, {
        device: record.device.deviceId,
        includeScreenshot: input.includeScreenshot,
      });
    }

    return {
      completedSteps,
      totalSteps: input.steps.length,
      ...(stoppedEarlyReason ? { stoppedEarlyReason } : {}),
      observation: lastResult,
    };
  }

  private extractPageItems(
    elements: readonly PhoneUiElement[],
    seen: Set<string>,
    items: string[],
  ): number {
    let added = 0;
    const ordered = [...elements].sort(
      (a, b) => (a.y ?? a.bounds?.top ?? 0) - (b.y ?? b.bounds?.top ?? 0),
    );
    for (const el of ordered) {
      if (el.editable) continue;
      const rawText = (el.text ?? el.contentDescription ?? "").replace(/\s+/g, " ").trim();
      if (!rawText || seen.has(rawText)) continue;
      seen.add(rawText);
      items.push(rawText);
      added += 1;
    }
    return added;
  }

  async collect(
    coordinator: Coordinator,
    caller: AuthorizedPhoneCaller,
    input: {
      device?: string;
      maxPages?: number;
      direction?: "down" | "up";
      containerRef?: string;
      stopWhenTextIncludes?: string;
    },
  ): Promise<{
    deviceId: string;
    packageName: string;
    pagesRead: number;
    totalItems: number;
    reachedEnd: boolean;
    stoppedReason?: string;
    items: string[];
    observation: PhoneToolObservationOutput;
  }> {
    const record = this.requireCallableDevice(caller, input.device);
    const maxPages = Math.min(15, Math.max(1, input.maxPages ?? 5));
    const direction = input.direction ?? "down";
    const deadline = this.now() + this.stepsBudgetMs;
    const seen = new Set<string>();
    const items: string[] = [];
    let pagesRead = 0;
    let reachedEnd = false;
    let stoppedReason: string | undefined;
    let latestObs: PhoneToolObservationOutput | null = null;

    for (let page = 0; page < maxPages; page++) {
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        stoppedReason = "budget_exceeded";
        break;
      }
      latestObs =
        page === 0
          ? await this.observe(coordinator, caller, {
              device: record.device.deviceId,
              includeScreenshot: false,
              timeoutMs: remaining,
            })
          : await this.runAction(
              coordinator,
              caller,
              "scroll",
              { direction, ...(input.containerRef ? { ref: input.containerRef } : {}) },
              {
                device: record.device.deviceId,
                includeScreenshot: false,
                stepLabel: `Collect page ${page + 1} (${direction})`,
                timeoutMs: remaining,
              },
            );
      pagesRead += 1;

      if (latestObs.status && latestObs.status !== "ok") {
        stoppedReason = latestObs.status;
        break;
      }
      const newCount = this.extractPageItems(latestObs.elements, seen, items);
      if (
        input.stopWhenTextIncludes &&
        items.some((i) => i.includes(input.stopWhenTextIncludes!))
      ) {
        stoppedReason = "matched_stop_text";
        break;
      }
      if (page > 0 && newCount === 0) {
        reachedEnd = true;
        break;
      }
    }

    latestObs ??= await this.observe(coordinator, caller, {
      device: record.device.deviceId,
      includeScreenshot: false,
    });

    return {
      deviceId: record.device.deviceId,
      packageName: latestObs.packageName,
      pagesRead,
      totalItems: items.length,
      reachedEnd,
      ...(stoppedReason ? { stoppedReason } : {}),
      items,
      observation: latestObs,
    };
  }
}

export interface AuthorizedPhoneCaller {
  assistant: Assistant;
  conversationId: string;
  threadId: string | null;
  turnId: string | null;
}

interface PhoneToolContext {
  caller: ToolCaller;
}

export function authorizePhoneCaller(
  coordinator: Coordinator,
  caller: ToolCaller,
): AuthorizedPhoneCaller {
  const { store } = coordinator;
  if (store.get("tasks", caller.agentId)) {
    throw new Error(
      "Task agents cannot control user phones directly. Report what you need in your task result instead.",
    );
  }
  const session = store.getChatSessionByAgent(caller.agentId);
  if (!session || (session.serverId ?? null) !== (caller.serverId ?? null)) {
    throw new Error("Phone tools are only available to a Chat assistant in its chat.");
  }
  const assistant = store.get("assistants", session.assistantId);
  if (!assistant) {
    throw new Error("This assistant no longer exists.");
  }
  const conversation = store.get("conversations", session.conversationId);
  if (!conversation?.members.includes(assistant.id)) {
    throw new Error("You are no longer a member of this chat.");
  }
  if (assistant.disabledTools?.includes("phone") || assistant.phone?.enabled === false) {
    throw new Error(
      "Phone Control is disabled for you. Ask the user to enable Phone Control in your assistant settings.",
    );
  }

  const liveTurn = coordinator.liveChatTurn(caller.agentId);
  if (!liveTurn) {
    const latestAgentTurn = store
      .snapshot()
      .turns.findLast((t) => t.agentId === caller.agentId && !t.taskId);
    if (latestAgentTurn?.status === "cancelled") {
      throw new Error("The active chat turn was cancelled; stop phone operations immediately.");
    }
  }

  return {
    assistant,
    conversationId: conversation.id,
    threadId: session.threadId,
    turnId: liveTurn?.id ?? null,
  };
}

// ============================================================================
// 14 `pavra-phone_*` Agent Tools
// ============================================================================

export const phoneDevicesTool = defineAgentTool({
  name: "phone_devices",
  description:
    "List registered Android phones and their privilege channel, background virtual display, and network readiness status.",
  input: z.object({}),
  output: z.object({
    devices: z.array(
      z.object({
        deviceId: z.string(),
        deviceName: z.string(),
        enabled: z.boolean(),
        online: z.boolean(),
        mode: z.string(),
        activeChannel: z.string(),
        effectiveReady: z.boolean(),
        virtualDisplayId: z.number().int().nullable(),
        allowRelayControl: z.boolean(),
        connectedViaRelay: z.boolean(),
        outwardConfirmTier: z.enum(["always_ask", "once_per_task", "always_allow"]),
      }),
    ),
  }),
});

export const phoneObserveTool = defineAgentTool({
  name: "phone_observe",
  description:
    "Observe the Android phone's current screen (sanitized UI tree with @e1..@eN refs, foreground package, treeQuality). Pass includeScreenshot: true when treeQuality is sparse/empty or visual layout matters to receive a compressed JPEG screenshot block.",
  input: z.object({
    device: z.string().optional().describe("Optional phone deviceId or deviceName."),
    includeScreenshot: z
      .boolean()
      .optional()
      .describe("Pass true to attach a compressed JPEG screenshot as an image block."),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneTapTool = defineAgentTool({
  name: "phone_tap",
  description:
    "Tap an interactive element on the Android phone by its @eN ref from phone_observe or by (x, y) coordinates.",
  input: z.object({
    device: z.string().optional(),
    ref: z.string().optional().describe("Element reference from phone_observe, e.g. '@e3'."),
    x: z.number().optional().describe("Horizontal pixel coordinate."),
    y: z.number().optional().describe("Vertical pixel coordinate."),
    longPressMs: z
      .number()
      .int()
      .min(0)
      .max(5_000)
      .optional()
      .describe("Optional long-press duration in milliseconds."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneTypeTool = defineAgentTool({
  name: "phone_type",
  description:
    "Type text into an editable field on the Android phone (optionally targeting an @eN ref, clearing existing text, or submitting).",
  input: z.object({
    device: z.string().optional(),
    text: z.string().describe("Text to input."),
    ref: z.string().optional().describe("Optional @eN element ref to focus first."),
    clearFirst: z.boolean().optional().describe("Clear existing field text before typing."),
    submit: z.boolean().optional().describe("Send Enter/Search/Send IME action after typing."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneScrollTool = defineAgentTool({
  name: "phone_scroll",
  description:
    "Scroll the current screen or a scrollable container on the Android phone (down, up, left, or right).",
  input: z.object({
    device: z.string().optional(),
    direction: z.enum(["down", "up", "left", "right"]).optional(),
    delta: z.number().optional(),
    ref: z.string().optional().describe("Optional @eN container ref to scroll."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneSwipeTool = defineAgentTool({
  name: "phone_swipe",
  description:
    "Perform a swipe gesture from (startX, startY) to (endX, endY) on the Android phone.",
  input: z.object({
    device: z.string().optional(),
    startX: z.number(),
    startY: z.number(),
    endX: z.number(),
    endY: z.number(),
    durationMs: z.number().int().min(50).max(5_000).optional(),
    includeScreenshot: z.boolean().optional(),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneBackTool = defineAgentTool({
  name: "phone_back",
  description: "Press the Android system Back button on the phone's target display.",
  input: z.object({
    device: z.string().optional(),
    includeScreenshot: z.boolean().optional(),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneLaunchAppTool = defineAgentTool({
  name: "phone_launch_app",
  description:
    "Launch an installed Android app by packageName onto the phone's background virtual display (subject to SafetyGate package locks).",
  input: z.object({
    device: z.string().optional(),
    packageName: z.string().trim().min(1).describe("Android package name, e.g. 'com.tencent.mm'."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneListAppsTool = defineAgentTool({
  name: "phone_list_apps",
  description:
    "List launchable apps installed on the Android phone and whether any are locked by SafetyGate.",
  input: z.object({
    device: z.string().optional(),
  }),
  output: z.object({
    deviceId: z.string(),
    apps: z.array(phoneAppInfoSchema),
  }),
});

export const phoneIntentTool = defineAgentTool({
  name: "phone_intent",
  description:
    "Send an Android system Intent (alarm, calendar event, share sheet, or deep-link URI) — prefer this over fragile multi-step UI tapping whenever a direct Intent exists.",
  input: z.object({
    device: z.string().optional(),
    action: z.string().optional().describe("Intent action, e.g. 'android.intent.action.VIEW'."),
    uri: z.string().optional().describe("Intent data URI / deep link."),
    packageName: z.string().optional().describe("Optional target package name."),
    activityName: z.string().optional().describe("Optional target activity name."),
    extras: z.record(z.string(), z.string()).optional(),
    includeScreenshot: z.boolean().optional(),
  }),
  output: phoneToolObservationOutputSchema,
});

export const phoneClipboardTool = defineAgentTool({
  name: "phone_clipboard",
  description:
    "Read or write the Android phone's clipboard text (PII is automatically redacted on read).",
  input: z.object({
    device: z.string().optional(),
    action: z.enum(["get", "set"]),
    text: z.string().optional().describe("Text to copy when action is 'set'."),
  }),
  output: z.object({
    deviceId: z.string(),
    action: z.enum(["get", "set"]),
    text: z.string().nullable(),
  }),
});

export const phoneStepsTool = defineAgentTool({
  name: "phone_steps",
  description:
    "Execute 1 to 20 known phone actions sequentially within a 25-second budget, with optional per-step wait conditions and automatic SafetyGate checks.",
  input: z.object({
    device: z.string().optional(),
    steps: z.array(phoneStepSchema).min(1).max(20),
    includeScreenshot: z.boolean().optional(),
  }),
  output: z.object({
    completedSteps: z.number().int().nonnegative(),
    totalSteps: z.number().int().positive(),
    stoppedEarlyReason: z.string().optional(),
    observation: phoneToolObservationOutputSchema,
    _images: z.array(phoneToolImageBlockSchema).optional(),
  }),
});

export const phoneCollectTool = defineAgentTool({
  name: "phone_collect",
  description:
    "Scroll through a long list or chat conversation on the Android phone (up to 15 screens within 25s), deduplicating and merging visible text items in order.",
  input: z.object({
    device: z.string().optional(),
    maxPages: z.number().int().min(1).max(15).optional(),
    direction: z.enum(["down", "up"]).optional(),
    containerRef: z.string().optional(),
    stopWhenTextIncludes: z.string().optional(),
  }),
  output: z.object({
    deviceId: z.string(),
    packageName: z.string(),
    pagesRead: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    reachedEnd: z.boolean(),
    stoppedReason: z.string().optional(),
    items: z.array(z.string()),
    observation: phoneToolObservationOutputSchema,
  }),
});

export const phoneHandToUserTool = defineAgentTool({
  name: "phone_hand_to_user",
  description:
    "Pause phone automation and hand the app to the user on their main screen for login, SMS/2FA verification, CAPTCHA, or payment confirmation.",
  input: z.object({
    device: z.string().optional(),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Clear explanation of what the user needs to complete on their phone."),
  }),
  output: z.object({
    status: z.literal("handed_to_user"),
    takeoverId: z.string(),
    deviceId: z.string().nullable(),
    instruction: z.string(),
  }),
});

function phoneEntry<Tool extends PluginAgentToolContract>(
  tool: Tool,
  handler: (
    coordinator: Coordinator,
  ) => (input: z.output<Tool["input"]>, context: PhoneToolContext) => unknown,
): AgentToolEntry {
  return {
    tool,
    run: (coordinator, input, context) =>
      handler(coordinator)(tool.input.parse(input) as z.output<Tool["input"]>, context),
  };
}

export const phoneAgentTools: readonly AgentToolEntry[] = [
  phoneEntry(phoneDevicesTool, (coordinator) => (_input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    const allowedSet = caller.assistant.phone?.allowedDeviceIds?.length
      ? new Set(caller.assistant.phone.allowedDeviceIds)
      : null;
    const devices = coordinator.phoneManager
      .listDevices()
      .filter((d) => !allowedSet || allowedSet.has(d.deviceId))
      .map((d) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        enabled: d.enabled,
        online: d.online,
        mode: d.mode,
        activeChannel: d.activeChannel,
        effectiveReady: d.effectiveReady,
        virtualDisplayId: d.virtualDisplayId,
        allowRelayControl: d.allowRelayControl,
        connectedViaRelay: d.connectedViaRelay,
        outwardConfirmTier: d.outwardConfirmTier,
      }));
    return { devices };
  }),
  phoneEntry(phoneObserveTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.observe(coordinator, caller, input);
  }),
  phoneEntry(phoneTapTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    if (!input.ref && (typeof input.x !== "number" || typeof input.y !== "number")) {
      throw new Error("Pass either `ref` (e.g. '@e1') or coordinates `{ x, y }` to phone_tap.");
    }
    return coordinator.phoneManager.runAction(
      coordinator,
      caller,
      "tap",
      {
        ...(input.ref ? { ref: input.ref } : {}),
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.longPressMs !== undefined ? { longPressMs: input.longPressMs } : {}),
      },
      {
        device: input.device,
        includeScreenshot: input.includeScreenshot,
        stepLabel: `Tap ${input.ref ?? `(${input.x}, ${input.y})`}`,
      },
    );
  }),
  phoneEntry(phoneTypeTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.runAction(
      coordinator,
      caller,
      "type",
      {
        text: input.text,
        ...(input.ref ? { ref: input.ref } : {}),
        ...(input.clearFirst !== undefined ? { clearFirst: input.clearFirst } : {}),
        ...(input.submit !== undefined ? { submit: input.submit } : {}),
      },
      {
        device: input.device,
        includeScreenshot: input.includeScreenshot,
        stepLabel: input.ref ? `Type into ${input.ref}` : "Type text",
      },
    );
  }),
  phoneEntry(phoneScrollTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    const direction = input.direction ?? "down";
    return coordinator.phoneManager.runAction(
      coordinator,
      caller,
      "scroll",
      {
        direction,
        ...(input.delta !== undefined ? { delta: input.delta } : {}),
        ...(input.ref ? { ref: input.ref } : {}),
      },
      {
        device: input.device,
        includeScreenshot: input.includeScreenshot,
        stepLabel: `Scroll ${direction}`,
      },
    );
  }),
  phoneEntry(phoneSwipeTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.runAction(
      coordinator,
      caller,
      "swipe",
      {
        startX: input.startX,
        startY: input.startY,
        endX: input.endX,
        endY: input.endY,
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      },
      {
        device: input.device,
        includeScreenshot: input.includeScreenshot,
        stepLabel: `Swipe (${input.startX},${input.startY}) -> (${input.endX},${input.endY})`,
      },
    );
  }),
  phoneEntry(phoneBackTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.runAction(
      coordinator,
      caller,
      "back",
      {},
      {
        device: input.device,
        includeScreenshot: input.includeScreenshot,
        stepLabel: "Press Back",
      },
    );
  }),
  phoneEntry(phoneLaunchAppTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.runAction(
      coordinator,
      caller,
      "launch_app",
      { packageName: input.packageName },
      {
        device: input.device,
        includeScreenshot: input.includeScreenshot,
        stepLabel: `Launch ${input.packageName}`,
      },
    );
  }),
  phoneEntry(phoneListAppsTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.listApps(caller, input.device);
  }),
  phoneEntry(phoneIntentTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.runAction(
      coordinator,
      caller,
      "intent",
      {
        ...(input.action ? { action: input.action } : {}),
        ...(input.uri ? { uri: input.uri } : {}),
        ...(input.packageName ? { packageName: input.packageName } : {}),
        ...(input.activityName ? { activityName: input.activityName } : {}),
        ...(input.extras ? { extras: input.extras } : {}),
      },
      {
        device: input.device,
        includeScreenshot: input.includeScreenshot,
        stepLabel: `Intent ${input.action ?? input.uri ?? input.packageName ?? "start"}`,
      },
    );
  }),
  phoneEntry(phoneClipboardTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.clipboard(caller, input);
  }),
  phoneEntry(phoneStepsTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    const result = await coordinator.phoneManager.steps(coordinator, caller, input);
    const topImages = result.observation._images;
    if (topImages && topImages.length > 0) {
      const { _images: _nestedImages, ...cleanObservation } = result.observation;
      return {
        ...result,
        observation: cleanObservation,
        _images: topImages,
      };
    }
    return result;
  }),
  phoneEntry(phoneCollectTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    return coordinator.phoneManager.collect(coordinator, caller, input);
  }),
  phoneEntry(phoneHandToUserTool, (coordinator) => async (input, context) => {
    const caller = authorizePhoneCaller(coordinator, context.caller);
    const live = coordinator.phoneManager.getLiveState({
      deviceId: input.device,
      assistantId: caller.assistant.id,
    });
    const deviceId = input.device ?? live.activeDeviceId ?? live.devices[0]?.deviceId ?? null;
    if (deviceId) {
      coordinator.phoneManager.configureDevice({
        deviceId,
        onMainScreenTakeover: true,
      });
    }
    const takeover = await coordinator.requestPhoneTakeover({
      assistant: caller.assistant,
      conversationId: caller.conversationId,
      threadId: caller.threadId,
      turnId: caller.turnId,
      deviceId,
      packageName: live.packageName,
      appName: live.appName,
      displayId: live.displayId,
      screenshotDataUrl: live.screenshotDataUrl,
      reason: input.reason,
    });
    return {
      status: "handed_to_user" as const,
      takeoverId: takeover.id,
      deviceId,
      instruction:
        "A phone takeover card has been posted in Chat and on the user's phone. Briefly tell the user what they need to complete (e.g. login, verification code, or payment) and end your turn now.",
    };
  }),
];

export async function callPhoneAgentTool(
  coordinator: Coordinator,
  caller: ToolCaller,
  name: string,
  input: unknown,
): Promise<unknown> {
  const entry = phoneAgentTools.find(({ tool }) => tool.name === name);
  if (!entry) return undefined;
  return entry.run(coordinator, input, { caller });
}

export function isPhoneAgentTool(name: string): boolean {
  return phoneAgentTools.some(({ tool }) => tool.name === name);
}

export { type PhoneOutwardConfirmTier };
