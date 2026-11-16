import {
  getNativeKeepaliveModule,
  type PavraKeepaliveNativeModule,
} from "../../modules/pavra-keepalive";

export type PhonePrivilegeChannelPreference = "auto" | "shizuku" | "wireless_adb";
export type ActivePhonePrivilegeChannel = "none" | "shizuku" | "wireless_adb";
export type PhoneFloatingOverlayMode = "capsule" | "mini_window";

export type PhoneOverlayActionKind =
  | "emergency_stop"
  | "pause"
  | "resume"
  | "takeover"
  | "return_background"
  | "stop"
  | "mode_changed";

export interface PhonePrivilegeStatus {
  ready: boolean;
  activeChannel: ActivePhonePrivilegeChannel;
  preferredChannel: PhonePrivilegeChannelPreference;
  shizukuInstalled: boolean;
  shizukuAvailable: boolean;
  shizukuAuthorized: boolean;
  wirelessAdbPaired: boolean;
  wirelessAdbHost: string;
  wirelessAdbPort: number | null;
  discoveredPairingPort: number | null;
  discoveredConnectPort: number | null;
  virtualDisplayId: number | null;
  overlayPermissionGranted: boolean;
  lastError: string | null;
  isSimulated: boolean;
}

export interface ParsedWirelessPairingCode {
  code: string;
  host: string;
  port: number | null;
}

export interface PrivilegedShellExecutionResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  channel: ActivePhonePrivilegeChannel;
  durationMs: number;
}

export interface VirtualDisplayInfo {
  ok: boolean;
  displayId: number;
  width: number;
  height: number;
  dpi: number;
}

export interface PhoneFrameCaptureResult {
  ok: boolean;
  displayId: number;
  base64: string | null;
  screenshotBase64: string | null;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  byteLength: number;
  isSecureFlag: boolean;
  timestamp: number;
}

export interface PhoneElementBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export interface PhoneUiElementNode {
  id: string;
  ref: string;
  index: number;
  text: string;
  contentDesc: string;
  contentDescription: string;
  resourceId: string;
  className: string;
  packageName: string;
  clickable: boolean;
  scrollable: boolean;
  editable: boolean;
  focusable: boolean;
  password: boolean;
  x: number;
  y: number;
  bounds: PhoneElementBounds;
}

export type PhoneDisplayActionInput =
  | {
      type: "launch_app";
      packageName: string;
      unlocked?: boolean;
      includeScreenshot?: boolean;
      maxLongEdge?: number;
      quality?: number;
    }
  | {
      type: "list_apps";
    }
  | {
      type: "tap";
      x?: number;
      y?: number;
      elementId?: string;
      ref?: string;
      unlocked?: boolean;
    }
  | {
      type: "type";
      text: string;
      submit?: boolean;
      elementId?: string;
      unlocked?: boolean;
    }
  | {
      type: "scroll";
      direction?: "up" | "down" | "left" | "right";
      distance?: number;
      durationMs?: number;
      unlocked?: boolean;
    }
  | {
      type: "swipe";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      durationMs?: number;
      unlocked?: boolean;
    }
  | {
      type: "back";
      unlocked?: boolean;
    }
  | {
      type: "intent";
      intentAction?: string;
      dataUri?: string;
      packageName?: string;
      extras?: Record<string, string | number | boolean>;
      unlocked?: boolean;
    }
  | {
      type: "clipboard";
      mode?: "get" | "set";
      text?: string;
    }
  | {
      type: "observe";
      includeScreenshot?: boolean;
      maxLongEdge?: number;
      quality?: number;
      unlocked?: boolean;
    };

export interface PhoneDisplayActionResult {
  ok: boolean;
  action?: string;
  displayId?: number;
  error?: string;
  x?: number;
  y?: number;
  lastTapX?: number | null;
  lastTapY?: number | null;
  submitted?: boolean;
  direction?: string;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  durationMs?: number;
  intentAction?: string;
  dataUri?: string | null;
  packageName?: string;
  appName?: string;
  activityName?: string | null;
  isSecureFlag?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  capturedAt?: number;
  elements?: PhoneUiElementNode[];
  apps?: InstalledPhoneApp[];
  screenshotBase64?: string | null;
  mimeType?: string | null;
  mode?: string;
  text?: string;
  length?: number;
}

export interface InstalledPhoneApp {
  packageName: string;
  label: string;
  activityName: string;
  isSystemApp: boolean;
}

export interface PhoneFloatingOverlayInput {
  mode?: PhoneFloatingOverlayMode;
  assistantName?: string;
  appName?: string;
  packageName?: string;
  stepText?: string;
  paused?: boolean;
  onMainScreenTakeover?: boolean;
  lastTapX?: number | null;
  lastTapY?: number | null;
  screenWidth?: number;
  screenHeight?: number;
}

export interface PhoneFloatingOverlayState {
  visible: boolean;
  mode: PhoneFloatingOverlayMode;
  overlayPermissionGranted: boolean;
  assistantName: string;
  appName: string;
  packageName: string;
  stepText: string;
  paused: boolean;
  onMainScreenTakeover: boolean;
  displayId: number | null;
  lastTapX: number | null;
  lastTapY: number | null;
}

export interface PhoneOverlayActionEvent {
  action: PhoneOverlayActionKind;
  mode: PhoneFloatingOverlayMode;
  paused: boolean;
  onMainScreenTakeover: boolean;
  packageName: string | null;
  source?: string;
  timestamp: number;
}

export interface PhoneBridgeSubscription {
  (): void;
  remove(): void;
}

export interface NativePhoneBridge {
  readonly isSimulated: boolean;
  getPrivilegeStatus(
    preferredChannel?: PhonePrivilegeChannelPreference,
  ): Promise<PhonePrivilegeStatus>;
  requestShizukuPermission(): Promise<PhonePrivilegeStatus>;
  startWirelessAdbDiscovery(): Promise<PhonePrivilegeStatus>;
  stopWirelessAdbDiscovery(): Promise<boolean>;
  openWirelessDebuggingWithPairingNotification(
    openSettings?: boolean,
  ): Promise<PhonePrivilegeStatus>;
  submitWirelessAdbPairingCode(
    pairingInput: string,
    host?: string | null,
    port?: number | null,
  ): Promise<PhonePrivilegeStatus>;
  executePrivilegedShell(
    command: string,
    channel?: PhonePrivilegeChannelPreference,
    timeoutMs?: number,
  ): Promise<PrivilegedShellExecutionResult>;
  ensureVirtualDisplay(width?: number, height?: number, dpi?: number): Promise<VirtualDisplayInfo>;
  releaseVirtualDisplay(): Promise<boolean>;
  captureFrameJpegBase64(maxLongEdge?: number, quality?: number): Promise<PhoneFrameCaptureResult>;
  launchAppOnVirtualDisplay(packageName: string, unlocked?: boolean): Promise<boolean>;
  moveAppToMainScreenForTakeover(packageName: string): Promise<boolean>;
  returnAppToVirtualDisplay(packageName: string): Promise<boolean>;
  executeDisplayAction(action: PhoneDisplayActionInput): Promise<PhoneDisplayActionResult>;
  listInstalledApps(): Promise<InstalledPhoneApp[]>;
  canDrawOverlays(): Promise<boolean>;
  openOverlayPermissionSettings(): Promise<boolean>;
  showFloatingOverlay(state: PhoneFloatingOverlayInput): Promise<PhoneFloatingOverlayState>;
  updateFloatingOverlay(state: PhoneFloatingOverlayInput): Promise<PhoneFloatingOverlayState>;
  setFloatingOverlayMode(mode: PhoneFloatingOverlayMode): Promise<PhoneFloatingOverlayState>;
  hideFloatingOverlay(): Promise<boolean>;
  setExecutionPaused(paused: boolean): Promise<PhoneFloatingOverlayState>;
  clearEmergencyStop(): Promise<boolean>;
  triggerEmergencyStop(): Promise<PhoneFloatingOverlayState>;
  simulateCapsuleLongPress(durationMs: number): Promise<PhoneFloatingOverlayState>;
  simulateOverlayControl(
    control: "pause" | "resume" | "takeover" | "return_background" | "stop" | "expand" | "collapse",
  ): Promise<PhoneFloatingOverlayState>;
  addOverlayActionListener(
    listener: (event: PhoneOverlayActionEvent) => void,
  ): PhoneBridgeSubscription;
  addPrivilegeChangedListener(
    listener: (status: PhonePrivilegeStatus) => void,
  ): PhoneBridgeSubscription;
}

export const WIRELESS_PAIRING_REMOTE_INPUT_LABEL = "输入 6 位无线调试配对码（或 配对码:端口）";
export const CAPSULE_EMERGENCY_LONG_PRESS_MS = 1000;
export const DEFAULT_VIRTUAL_DISPLAY_WIDTH = 1080;
export const DEFAULT_VIRTUAL_DISPLAY_HEIGHT = 2400;
export const DEFAULT_VIRTUAL_DISPLAY_DPI = 420;

// Minimal valid 1x1 baseline JPEG binary encoded in Base64 (starts with FF D8 FF E0 ... ends with FF D9).
const MINIMAL_VALID_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const SIX_DIGITS_RE = /^\d{6}$/;
const CODE_PORT_RE = /^(\d{6})\s*[:\s]\s*(\d{1,5})$/;
const HOST_PORT_CODE_RE = /^([A-Za-z0-9._-]+):(\d{1,5})\s*[:\s]\s*(\d{6})$/;

const HARD_BLOCKED_PACKAGES = new Set([
  "com.icbc",
  "com.chinamworld.main",
  "com.cmbchina.ccd.pluto.cmbactivity",
  "com.abchina.ebank",
  "com.bankcomm.bankcomm",
  "com.boc.bocsoft.phone",
  "com.pingan.paces.ccms",
  "com.eastmoney.android.berlin",
  "com.hexin.plat.android",
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
  "com.oldpan.pavra",
  "sh.paseo",
  "sh.paseo.debug",
]);

const HARD_BLOCKED_PREFIXES = [
  "com.icbc.",
  "com.chinamworld.",
  "com.cmbchina.",
  "com.abchina.",
  "com.bankcomm.",
  "com.eastmoney.",
] as const;

const CN_RESIDENT_ID_RE =
  /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;
const BANK_CARD_RE = /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g;

export function isBlockedPhonePackage(packageName: string | null | undefined): boolean {
  if (typeof packageName !== "string") return false;
  const clean = packageName.trim().toLowerCase();
  if (!clean) return false;
  if (HARD_BLOCKED_PACKAGES.has(clean)) return true;
  return HARD_BLOCKED_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

export function redactPiiText(rawText: string): string {
  if (!rawText) return rawText;
  const idRedacted = rawText.replace(CN_RESIDENT_ID_RE, "[REDACTED_ID]");
  return idRedacted.replace(BANK_CARD_RE, "[REDACTED_CARD]");
}

export function parseWirelessPairingInput(
  rawInput: string,
  fallbackHost = "127.0.0.1",
  fallbackPort: number | null = null,
): ParsedWirelessPairingCode | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const host = fallbackHost.trim() || "127.0.0.1";
  const validFallbackPort =
    typeof fallbackPort === "number" &&
    Number.isInteger(fallbackPort) &&
    fallbackPort >= 1 &&
    fallbackPort <= 65535
      ? fallbackPort
      : null;

  if (SIX_DIGITS_RE.test(trimmed)) {
    return { code: trimmed, host, port: validFallbackPort };
  }

  const codePort = CODE_PORT_RE.exec(trimmed);
  if (codePort) {
    const port = Number(codePort[2]);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return { code: codePort[1], host, port };
    }
    return null;
  }

  const hostPortCode = HOST_PORT_CODE_RE.exec(trimmed);
  if (hostPortCode) {
    const port = Number(hostPortCode[2]);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return { code: hostPortCode[3], host: hostPortCode[1], port };
    }
  }

  return null;
}

function createBridgeSubscription(cleanup: () => void): PhoneBridgeSubscription {
  const fn = () => {
    cleanup();
  };
  fn.remove = cleanup;
  return fn;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeChannelPreference(raw?: string | null): PhonePrivilegeChannelPreference {
  if (raw === "shizuku" || raw === "wireless_adb") return raw;
  return "auto";
}

function normalizeActiveChannel(raw: unknown): ActivePhonePrivilegeChannel {
  if (raw === "shizuku" || raw === "wireless_adb") return raw;
  return "none";
}

function normalizeOverlayMode(raw: unknown): PhoneFloatingOverlayMode {
  return raw === "mini_window" ? "mini_window" : "capsule";
}

function normalizePrivilegeStatusRecord(
  raw: Record<string, unknown>,
  isSimulated: boolean,
): PhonePrivilegeStatus {
  const activeChannel = normalizeActiveChannel(raw.activeChannel);
  return {
    ready: asBoolean(raw.ready, activeChannel !== "none"),
    activeChannel,
    preferredChannel: normalizeChannelPreference(asNullableString(raw.preferredChannel)),
    shizukuInstalled: asBoolean(raw.shizukuInstalled, false),
    shizukuAvailable: asBoolean(raw.shizukuAvailable, false),
    shizukuAuthorized: asBoolean(raw.shizukuAuthorized, false),
    wirelessAdbPaired: asBoolean(raw.wirelessAdbPaired, false),
    wirelessAdbHost: asString(raw.wirelessAdbHost, "127.0.0.1"),
    wirelessAdbPort: asNumberOrNull(raw.wirelessAdbPort),
    discoveredPairingPort: asNumberOrNull(raw.discoveredPairingPort),
    discoveredConnectPort: asNumberOrNull(raw.discoveredConnectPort),
    virtualDisplayId: asNumberOrNull(raw.virtualDisplayId),
    overlayPermissionGranted: asBoolean(raw.overlayPermissionGranted, false),
    lastError: asNullableString(raw.lastError),
    isSimulated,
  };
}

function normalizeOverlayStateRecord(raw: Record<string, unknown>): PhoneFloatingOverlayState {
  return {
    visible: asBoolean(raw.visible, false),
    mode: normalizeOverlayMode(raw.mode),
    overlayPermissionGranted: asBoolean(raw.overlayPermissionGranted, false),
    assistantName: asString(raw.assistantName, "Assistant"),
    appName: asString(raw.appName, "Android"),
    packageName: asString(raw.packageName, ""),
    stepText: asString(raw.stepText, "Ready"),
    paused: asBoolean(raw.paused, false),
    onMainScreenTakeover: asBoolean(raw.onMainScreenTakeover, false),
    displayId: asNumberOrNull(raw.displayId),
    lastTapX: asNumberOrNull(raw.lastTapX),
    lastTapY: asNumberOrNull(raw.lastTapY),
  };
}

function makeBounds(left: number, top: number, right: number, bottom: number): PhoneElementBounds {
  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
  };
}

const SIMULATED_INSTALLED_APPS: ReadonlyArray<InstalledPhoneApp> = [
  {
    packageName: "com.tencent.mm",
    label: "微信",
    activityName: "com.tencent.mm.ui.LauncherUI",
    isSystemApp: false,
  },
  {
    packageName: "com.xingin.xhs",
    label: "小红书",
    activityName: "com.xingin.xhs.index.v2.IndexActivityV2",
    isSystemApp: false,
  },
  {
    packageName: "com.eg.android.AlipayGphone",
    label: "支付宝",
    activityName: "com.eg.android.AlipayGphone.AlipayLogin",
    isSystemApp: false,
  },
  {
    packageName: "com.icbc",
    label: "中国工商银行",
    activityName: "com.icbc.activity.main.MainActivity",
    isSystemApp: false,
  },
  {
    packageName: "com.android.chrome",
    label: "Chrome",
    activityName: "com.google.android.apps.chrome.Main",
    isSystemApp: false,
  },
  {
    packageName: "com.android.settings",
    label: "设置",
    activityName: "com.android.settings.Settings",
    isSystemApp: true,
  },
];

function hasNativePhoneSupport(
  mod: PavraKeepaliveNativeModule | null,
): mod is PavraKeepaliveNativeModule {
  return Boolean(
    mod &&
    typeof mod.getPhonePrivilegeStatusAsync === "function" &&
    typeof mod.ensurePhoneVirtualDisplayAsync === "function" &&
    typeof mod.executePhoneDisplayActionAsync === "function" &&
    typeof mod.showPhoneFloatingOverlayAsync === "function",
  );
}

export interface CreateSimulatedPhoneBridgeOptions {
  now?: () => number;
  initialOverlayPermission?: boolean;
  shizukuInstalled?: boolean;
}

export function createSimulatedPhoneBridge(
  options?: CreateSimulatedPhoneBridgeOptions,
): NativePhoneBridge {
  const nowFn = options?.now ?? (() => Date.now());

  let preferredChannel: PhonePrivilegeChannelPreference = "auto";
  const shizukuInstalled = options?.shizukuInstalled ?? true;
  let shizukuAvailable = shizukuInstalled;
  let shizukuAuthorized = false;

  let discoveryActive = false;
  let discoveredPairingPort: number | null = null;
  let discoveredConnectPort: number | null = null;
  let wirelessAdbPaired = false;
  let wirelessAdbHost = "127.0.0.1";
  let wirelessAdbPort: number | null = null;
  let lastError: string | null = null;

  let virtualDisplayId: number | null = null;
  let displayWidth = DEFAULT_VIRTUAL_DISPLAY_WIDTH;
  let displayHeight = DEFAULT_VIRTUAL_DISPLAY_HEIGHT;
  let displayDpi = DEFAULT_VIRTUAL_DISPLAY_DPI;

  let activePackageName = "com.tencent.mm";
  let activeAppDisplayId = 2; // 2 = background VirtualDisplay, 0 = physical main screen takeover
  let typedDraftText = "";
  let scrollPage = 0;
  let clipboardText = "";
  let lastTapX: number | null = null;
  let lastTapY: number | null = null;
  let paused = false;
  let emergencyStopped = false;

  let overlayPermissionGranted = options?.initialOverlayPermission ?? true;
  let overlayVisible = false;
  let overlayMode: PhoneFloatingOverlayMode = "capsule";
  let overlayAssistantName = "Sky";
  let overlayAppName = "微信";
  let overlayPackageName = "com.tencent.mm";
  let overlayStepText = "Ready";

  const overlayListeners = new Set<(event: PhoneOverlayActionEvent) => void>();
  const privilegeListeners = new Set<(status: PhonePrivilegeStatus) => void>();

  function computeActiveChannel(): ActivePhonePrivilegeChannel {
    const shizukuReady = shizukuAvailable && shizukuAuthorized;
    const wirelessReady = wirelessAdbPaired && wirelessAdbPort !== null;
    if (preferredChannel === "shizuku") {
      return shizukuReady ? "shizuku" : "none";
    }
    if (preferredChannel === "wireless_adb") {
      return wirelessReady ? "wireless_adb" : "none";
    }
    if (shizukuReady) return "shizuku";
    if (wirelessReady) return "wireless_adb";
    return "none";
  }

  function snapshotPrivilegeStatus(): PhonePrivilegeStatus {
    const activeChannel = computeActiveChannel();
    return {
      ready: activeChannel !== "none",
      activeChannel,
      preferredChannel,
      shizukuInstalled,
      shizukuAvailable,
      shizukuAuthorized,
      wirelessAdbPaired,
      wirelessAdbHost,
      wirelessAdbPort,
      discoveredPairingPort,
      discoveredConnectPort,
      virtualDisplayId,
      overlayPermissionGranted,
      lastError,
      isSimulated: true,
    };
  }

  function snapshotOverlayState(): PhoneFloatingOverlayState {
    return {
      visible: overlayVisible,
      mode: overlayMode,
      overlayPermissionGranted,
      assistantName: overlayAssistantName,
      appName: overlayAppName,
      packageName: overlayPackageName || activePackageName,
      stepText: overlayStepText,
      paused,
      onMainScreenTakeover: activeAppDisplayId === 0,
      displayId: virtualDisplayId,
      lastTapX,
      lastTapY,
    };
  }

  function emitPrivilegeChanged(): void {
    const current = snapshotPrivilegeStatus();
    for (const listener of privilegeListeners) {
      listener(current);
    }
  }

  function emitOverlayAction(action: PhoneOverlayActionKind, source?: string): void {
    const payload: PhoneOverlayActionEvent = {
      action,
      mode: overlayMode,
      paused,
      onMainScreenTakeover: activeAppDisplayId === 0,
      packageName: overlayPackageName || activePackageName || null,
      ...(source ? { source } : {}),
      timestamp: nowFn(),
    };
    for (const listener of overlayListeners) {
      listener(payload);
    }
  }

  function resolveAppLabel(pkg: string): string {
    const matched = SIMULATED_INSTALLED_APPS.find((item) => item.packageName === pkg);
    return matched ? matched.label : pkg;
  }

  function makeElement(
    index: number,
    pkg: string,
    spec: {
      text: string;
      contentDesc: string;
      resourceId: string;
      className: string;
      clickable: boolean;
      scrollable: boolean;
      editable: boolean;
      focusable: boolean;
      password: boolean;
      bounds: PhoneElementBounds;
    },
  ): PhoneUiElementNode {
    const id = `e${index}`;
    const safeText = spec.password ? "••••" : redactPiiText(spec.text);
    const safeDesc = spec.password ? "••••" : redactPiiText(spec.contentDesc);
    return {
      id,
      ref: `@${id}`,
      index,
      text: safeText,
      contentDesc: safeDesc,
      contentDescription: safeDesc,
      resourceId: spec.resourceId,
      className: spec.className,
      packageName: pkg,
      clickable: spec.clickable,
      scrollable: spec.scrollable,
      editable: spec.editable,
      focusable: spec.focusable,
      password: spec.password,
      x: spec.bounds.centerX,
      y: spec.bounds.centerY,
      bounds: spec.bounds,
    };
  }

  function buildSimulatedElements(pkg: string): {
    isSecureFlag: boolean;
    activityName: string;
    elements: PhoneUiElementNode[];
  } {
    if (pkg === "com.eg.android.AlipayGphone") {
      return {
        isSecureFlag: true,
        activityName: "com.alipay.mobile.MSPContainerActivity",
        elements: [
          makeElement(1, pkg, {
            text: "确认付款 ¥88.00",
            contentDesc: "确认支付",
            resourceId: "com.eg.android.AlipayGphone:id/pay_title",
            className: "android.widget.TextView",
            clickable: false,
            scrollable: false,
            editable: false,
            focusable: false,
            password: false,
            bounds: makeBounds(120, 420, 960, 520),
          }),
          makeElement(2, pkg, {
            text: "••••",
            contentDesc: "输入支付密码",
            resourceId: "com.eg.android.AlipayGphone:id/pay_pwd",
            className: "android.widget.EditText",
            clickable: true,
            scrollable: false,
            editable: true,
            focusable: true,
            password: true,
            bounds: makeBounds(140, 620, 940, 740),
          }),
        ],
      };
    }

    return {
      isSecureFlag: false,
      activityName:
        SIMULATED_INSTALLED_APPS.find((app) => app.packageName === pkg)?.activityName ??
        `${pkg}.MainActivity`,
      elements: [
        makeElement(1, pkg, {
          text: `${resolveAppLabel(pkg)} · 文件传输助手`,
          contentDesc: "标题栏",
          resourceId: `${pkg}:id/header_title`,
          className: "android.widget.TextView",
          clickable: false,
          scrollable: false,
          editable: false,
          focusable: false,
          password: false,
          bounds: makeBounds(60, 96, 820, 180),
        }),
        makeElement(2, pkg, {
          text: `消息列表 第 ${scrollPage + 1} 屏`,
          contentDesc: "聊天消息列表",
          resourceId: `${pkg}:id/chat_list`,
          className: "androidx.recyclerview.widget.RecyclerView",
          clickable: false,
          scrollable: true,
          editable: false,
          focusable: true,
          password: false,
          bounds: makeBounds(0, 200, displayWidth, displayHeight - 260),
        }),
        makeElement(3, pkg, {
          text: typedDraftText || "发送消息…",
          contentDesc: "消息输入框",
          resourceId: `${pkg}:id/chat_input`,
          className: "android.widget.EditText",
          clickable: true,
          scrollable: false,
          editable: true,
          focusable: true,
          password: false,
          bounds: makeBounds(48, displayHeight - 220, displayWidth - 240, displayHeight - 100),
        }),
        makeElement(4, pkg, {
          text: "发送",
          contentDesc: "发送按钮",
          resourceId: `${pkg}:id/send_btn`,
          className: "android.widget.Button",
          clickable: true,
          scrollable: false,
          editable: false,
          focusable: true,
          password: false,
          bounds: makeBounds(
            displayWidth - 220,
            displayHeight - 220,
            displayWidth - 40,
            displayHeight - 100,
          ),
        }),
      ],
    };
  }

  function ensureDisplayInternal(
    width = displayWidth,
    height = displayHeight,
    dpi = displayDpi,
  ): VirtualDisplayInfo {
    displayWidth = Math.max(360, Math.min(2160, Math.round(width)));
    displayHeight = Math.max(640, Math.min(4320, Math.round(height)));
    displayDpi = Math.max(120, Math.min(640, Math.round(dpi)));
    if (virtualDisplayId === null) {
      virtualDisplayId = 2;
    }
    emergencyStopped = false;
    return {
      ok: true,
      displayId: virtualDisplayId,
      width: displayWidth,
      height: displayHeight,
      dpi: displayDpi,
    };
  }

  function captureSimulatedFrame(maxLongEdge = 1080): PhoneFrameCaptureResult {
    const info = ensureDisplayInternal();
    const safeMaxEdge = Math.max(240, Math.min(2160, Math.round(maxLongEdge)));
    const longEdge = Math.max(info.width, info.height);
    const scale = longEdge > safeMaxEdge ? safeMaxEdge / longEdge : 1;
    const scaledWidth = Math.max(1, Math.round(info.width * scale));
    const scaledHeight = Math.max(1, Math.round(info.height * scale));
    const isSecureFlag = activePackageName === "com.eg.android.AlipayGphone";
    const base64 = isSecureFlag ? null : MINIMAL_VALID_JPEG_BASE64;
    const byteLength = base64 ? Math.floor((base64.length * 3) / 4) : 0;

    return {
      ok: !isSecureFlag,
      displayId: info.displayId,
      base64,
      screenshotBase64: base64,
      mimeType: "image/jpeg",
      width: scaledWidth,
      height: scaledHeight,
      sourceWidth: info.width,
      sourceHeight: info.height,
      byteLength,
      isSecureFlag,
      timestamp: nowFn(),
    };
  }

  function resolveRequestedShellChannel(
    channel?: PhonePrivilegeChannelPreference,
  ): ActivePhonePrivilegeChannel {
    if (!channel || channel === "auto") {
      return computeActiveChannel();
    }
    if (channel === "shizuku") {
      return shizukuAuthorized ? "shizuku" : "none";
    }
    return wirelessAdbPaired ? "wireless_adb" : "none";
  }

  function runSimulatedTap(
    action: Extract<PhoneDisplayActionInput, { type: "tap" }>,
    info: VirtualDisplayInfo,
    elements: PhoneUiElementNode[],
  ): PhoneDisplayActionResult {
    let x = typeof action.x === "number" ? Math.round(action.x) : null;
    let y = typeof action.y === "number" ? Math.round(action.y) : null;
    const rawTarget = (action.elementId ?? action.ref ?? "").trim().replace(/^@/, "");
    if ((x === null || y === null) && rawTarget) {
      const matched = elements.find((el) => el.id === rawTarget);
      if (matched) {
        x = matched.bounds.centerX;
        y = matched.bounds.centerY;
      }
    }
    if (x === null || y === null) {
      return {
        ok: false,
        displayId: info.displayId,
        error: "Tap requires valid (x, y) coordinates or known elementId",
      };
    }
    lastTapX = x;
    lastTapY = y;
    return {
      ok: true,
      action: "tap",
      displayId: info.displayId,
      x,
      y,
      lastTapX: x,
      lastTapY: y,
    };
  }

  function runSimulatedScroll(
    action: Extract<PhoneDisplayActionInput, { type: "scroll" }>,
    info: VirtualDisplayInfo,
  ): PhoneDisplayActionResult {
    const direction = action.direction ?? "down";
    if (direction === "down") {
      scrollPage += 1;
    } else if (direction === "up" && scrollPage > 0) {
      scrollPage -= 1;
    }
    const cx = Math.round(info.width / 2);
    const startY = Math.round(info.height * 0.7);
    const endY = Math.round(info.height * 0.3);
    lastTapX = cx;
    lastTapY = endY;
    return {
      ok: true,
      action: "scroll",
      direction,
      displayId: info.displayId,
      startX: cx,
      startY,
      endX: cx,
      endY,
    };
  }

  function runSimulatedClipboard(
    action: Extract<PhoneDisplayActionInput, { type: "clipboard" }>,
  ): PhoneDisplayActionResult {
    const mode = action.mode ?? (typeof action.text === "string" ? "set" : "get");
    if (mode === "set") {
      clipboardText = action.text ?? "";
      return {
        ok: true,
        action: "clipboard",
        mode: "set",
        length: clipboardText.length,
      };
    }
    return {
      ok: true,
      action: "clipboard",
      mode: "get",
      text: clipboardText,
    };
  }

  function runSimulatedObserve(
    action: Extract<PhoneDisplayActionInput, { type: "observe" }>,
    info: VirtualDisplayInfo,
    ui: { isSecureFlag: boolean; activityName: string; elements: PhoneUiElementNode[] },
  ): PhoneDisplayActionResult {
    const frame =
      action.includeScreenshot && !ui.isSecureFlag
        ? captureSimulatedFrame(action.maxLongEdge ?? 1080)
        : null;
    return {
      ok: true,
      action: "observe",
      displayId: info.displayId,
      packageName: activePackageName,
      appName: resolveAppLabel(activePackageName),
      activityName: ui.activityName,
      isSecureFlag: ui.isSecureFlag,
      screenWidth: info.width,
      screenHeight: info.height,
      lastTapX,
      lastTapY,
      capturedAt: nowFn(),
      elements: ui.elements,
      screenshotBase64: frame ? frame.base64 : null,
      mimeType: frame ? frame.mimeType : null,
    };
  }

  function resolveTargetPackage(action: PhoneDisplayActionInput): string {
    if ("packageName" in action && typeof action.packageName === "string") {
      const trimmed = action.packageName.trim();
      if (trimmed) return trimmed;
    }
    return activePackageName;
  }

  function runSimulatedLaunchApp(
    action: Extract<PhoneDisplayActionInput, { type: "launch_app" }>,
    info: VirtualDisplayInfo,
    unlocked: boolean,
  ): PhoneDisplayActionResult {
    const cleanPkg = action.packageName.trim();
    if (!cleanPkg) {
      return {
        ok: false,
        displayId: info.displayId,
        error: "launch_app requires a non-empty packageName",
      };
    }
    activePackageName = cleanPkg;
    activeAppDisplayId = info.displayId;
    overlayPackageName = cleanPkg;
    overlayAppName = resolveAppLabel(cleanPkg);
    const launchedUi = buildSimulatedElements(activePackageName);
    const observed = runSimulatedObserve(
      {
        type: "observe",
        includeScreenshot: action.includeScreenshot,
        maxLongEdge: action.maxLongEdge,
        quality: action.quality,
        unlocked,
      },
      info,
      launchedUi,
    );
    return { ...observed, action: "launch_app" };
  }

  return {
    isSimulated: true,

    async getPrivilegeStatus(preferred) {
      if (preferred) {
        preferredChannel = normalizeChannelPreference(preferred);
      }
      return snapshotPrivilegeStatus();
    },

    async requestShizukuPermission() {
      if (!shizukuInstalled) {
        lastError = "Shizuku (moe.shizuku.privileged.api) is not installed";
      } else {
        shizukuAvailable = true;
        shizukuAuthorized = true;
        lastError = null;
      }
      emitPrivilegeChanged();
      return snapshotPrivilegeStatus();
    },

    async startWirelessAdbDiscovery() {
      discoveryActive = true;
      discoveredPairingPort = 37891;
      discoveredConnectPort = 41555;
      emitPrivilegeChanged();
      return snapshotPrivilegeStatus();
    },

    async stopWirelessAdbDiscovery() {
      discoveryActive = false;
      return true;
    },

    async openWirelessDebuggingWithPairingNotification() {
      discoveryActive = true;
      if (discoveredPairingPort === null) {
        discoveredPairingPort = 37891;
      }
      if (discoveredConnectPort === null) {
        discoveredConnectPort = 41555;
      }
      lastError = null;
      emitPrivilegeChanged();
      return snapshotPrivilegeStatus();
    },

    async submitWirelessAdbPairingCode(pairingInput, host, port) {
      const parsed = parseWirelessPairingInput(
        pairingInput,
        host ?? "127.0.0.1",
        port ?? discoveredPairingPort,
      );
      if (!parsed) {
        lastError = "Invalid pairing code format; expected 6 digits (e.g. 123456 or 123456:37891)";
        emitPrivilegeChanged();
        return snapshotPrivilegeStatus();
      }
      wirelessAdbPaired = true;
      wirelessAdbHost = parsed.host;
      wirelessAdbPort = parsed.port ?? discoveredConnectPort ?? 41555;
      if (discoveryActive && discoveredConnectPort === null) {
        discoveredConnectPort = wirelessAdbPort;
      }
      lastError = null;
      emitPrivilegeChanged();
      return snapshotPrivilegeStatus();
    },

    async executePrivilegedShell(command, channel, _timeoutMs) {
      const active = resolveRequestedShellChannel(channel);
      if (active === "none") {
        return {
          ok: false,
          exitCode: 126,
          stdout: "",
          stderr: "Privilege channel is not authorized yet",
          channel: "none",
          durationMs: 1,
        };
      }
      return {
        ok: true,
        exitCode: 0,
        stdout: `[sim:${active}] ${command.trim()}`,
        stderr: "",
        channel: active,
        durationMs: 4,
      };
    },

    async ensureVirtualDisplay(width, height, dpi) {
      const info = ensureDisplayInternal(width, height, dpi);
      emitPrivilegeChanged();
      return info;
    },

    async releaseVirtualDisplay() {
      virtualDisplayId = null;
      emitPrivilegeChanged();
      return true;
    },

    async captureFrameJpegBase64(maxLongEdge = 1080) {
      return captureSimulatedFrame(maxLongEdge);
    },

    async launchAppOnVirtualDisplay(packageName, unlocked = false) {
      const clean = packageName.trim();
      if (!clean) return false;
      if (!unlocked && isBlockedPhonePackage(clean)) {
        return false;
      }
      const info = ensureDisplayInternal();
      activePackageName = clean;
      activeAppDisplayId = info.displayId;
      overlayPackageName = clean;
      overlayAppName = resolveAppLabel(clean);
      return true;
    },

    async moveAppToMainScreenForTakeover(packageName) {
      const clean = packageName.trim() || activePackageName;
      if (!clean) return false;
      activePackageName = clean;
      activeAppDisplayId = 0; // Moved to physical main screen displayId = 0
      return true;
    },

    async returnAppToVirtualDisplay(packageName) {
      const clean = packageName.trim() || activePackageName;
      if (!clean) return false;
      const info = ensureDisplayInternal();
      activePackageName = clean;
      activeAppDisplayId = info.displayId; // Returned to background VirtualDisplay
      return true;
    },

    async executeDisplayAction(action) {
      if (emergencyStopped) {
        return {
          ok: false,
          error: "ERR_EMERGENCY_STOPPED: Phone execution halted by emergency stop",
        };
      }
      if (paused) {
        return {
          ok: false,
          error: "ERR_PAUSED: Phone execution is currently paused",
        };
      }

      const info = ensureDisplayInternal();
      if (action.type === "list_apps") {
        return {
          ok: true,
          action: "list_apps",
          displayId: info.displayId,
          apps: [...SIMULATED_INSTALLED_APPS].sort((a, b) => a.label.localeCompare(b.label)),
        };
      }
      if (action.type === "clipboard") {
        return runSimulatedClipboard(action);
      }

      const unlocked = Boolean(action.unlocked);
      const targetPkg = resolveTargetPackage(action);
      if (!unlocked && isBlockedPhonePackage(targetPkg)) {
        return {
          ok: false,
          displayId: info.displayId,
          packageName: targetPkg,
          error: `ERR_SAFETY_BLOCKED_PACKAGE: Package ${targetPkg} is hard-locked by native SafetyGate`,
        };
      }

      if (action.type === "launch_app") {
        return runSimulatedLaunchApp(action, info, unlocked);
      }

      const ui = buildSimulatedElements(activePackageName);

      switch (action.type) {
        case "tap":
          return runSimulatedTap(action, info, ui.elements);
        case "type":
          typedDraftText = action.text;
          return {
            ok: true,
            action: "type",
            displayId: info.displayId,
            submitted: Boolean(action.submit),
          };
        case "scroll":
          return runSimulatedScroll(action, info);
        case "swipe":
          lastTapX = Math.round(action.endX);
          lastTapY = Math.round(action.endY);
          return {
            ok: true,
            action: "swipe",
            displayId: info.displayId,
            startX: Math.round(action.startX),
            startY: Math.round(action.startY),
            endX: Math.round(action.endX),
            endY: Math.round(action.endY),
            durationMs: action.durationMs ?? 300,
          };
        case "back":
          return { ok: true, action: "back", displayId: info.displayId };
        case "intent":
          if (action.packageName) activePackageName = action.packageName;
          return {
            ok: true,
            action: "intent",
            displayId: info.displayId,
            intentAction: action.intentAction ?? "android.intent.action.VIEW",
            dataUri: action.dataUri ?? null,
            packageName: action.packageName ?? activePackageName,
          };
        case "observe":
          return runSimulatedObserve(action, info, ui);
      }
    },

    async listInstalledApps() {
      return [...SIMULATED_INSTALLED_APPS].sort((a, b) => a.label.localeCompare(b.label));
    },

    async canDrawOverlays() {
      return overlayPermissionGranted;
    },

    async openOverlayPermissionSettings() {
      overlayPermissionGranted = true;
      emitPrivilegeChanged();
      return true;
    },

    async showFloatingOverlay(state) {
      if (state.mode) overlayMode = state.mode;
      if (state.assistantName) overlayAssistantName = state.assistantName;
      if (state.appName) overlayAppName = state.appName;
      if (state.packageName) overlayPackageName = state.packageName;
      if (state.stepText) overlayStepText = state.stepText;
      if (typeof state.paused === "boolean") paused = state.paused;
      if (typeof state.onMainScreenTakeover === "boolean") {
        activeAppDisplayId = state.onMainScreenTakeover ? 0 : (virtualDisplayId ?? 2);
      }
      if (state.lastTapX !== undefined) lastTapX = state.lastTapX;
      if (state.lastTapY !== undefined) lastTapY = state.lastTapY;
      if (overlayPermissionGranted) {
        overlayVisible = true;
      }
      return snapshotOverlayState();
    },

    async updateFloatingOverlay(state) {
      return this.showFloatingOverlay(state);
    },

    async setFloatingOverlayMode(mode) {
      overlayMode = normalizeOverlayMode(mode);
      emitOverlayAction("mode_changed");
      return snapshotOverlayState();
    },

    async hideFloatingOverlay() {
      overlayVisible = false;
      return true;
    },

    async setExecutionPaused(nextPaused) {
      paused = nextPaused;
      return snapshotOverlayState();
    },

    async clearEmergencyStop() {
      emergencyStopped = false;
      return true;
    },

    async triggerEmergencyStop() {
      emergencyStopped = true;
      paused = false;
      overlayVisible = false;
      overlayStepText = "急停已触发";
      emitOverlayAction("emergency_stop", "js_bridge");
      return snapshotOverlayState();
    },

    async simulateCapsuleLongPress(durationMs) {
      if (durationMs >= CAPSULE_EMERGENCY_LONG_PRESS_MS) {
        emergencyStopped = true;
        paused = false;
        overlayVisible = false;
        overlayStepText = "急停已触发";
        emitOverlayAction("emergency_stop", "capsule_long_press");
      }
      return snapshotOverlayState();
    },

    async simulateOverlayControl(control) {
      switch (control) {
        case "expand":
          overlayMode = "mini_window";
          emitOverlayAction("mode_changed");
          break;
        case "collapse":
          overlayMode = "capsule";
          emitOverlayAction("mode_changed");
          break;
        case "pause":
          paused = true;
          emitOverlayAction("pause");
          break;
        case "resume":
          paused = false;
          emitOverlayAction("resume");
          break;
        case "takeover":
          activeAppDisplayId = 0;
          emitOverlayAction("takeover");
          break;
        case "return_background":
          activeAppDisplayId = virtualDisplayId ?? 2;
          emitOverlayAction("return_background");
          break;
        case "stop":
          emergencyStopped = true;
          paused = false;
          overlayVisible = false;
          emitOverlayAction("stop");
          break;
      }
      return snapshotOverlayState();
    },

    addOverlayActionListener(listener) {
      overlayListeners.add(listener);
      return createBridgeSubscription(() => {
        overlayListeners.delete(listener);
      });
    },

    addPrivilegeChangedListener(listener) {
      privilegeListeners.add(listener);
      return createBridgeSubscription(() => {
        privilegeListeners.delete(listener);
      });
    },
  };
}

export interface CreateNativePhoneBridgeOptions {
  nativeModule?: PavraKeepaliveNativeModule | null;
  simulatorOptions?: CreateSimulatedPhoneBridgeOptions;
}

export function createNativePhoneBridge(
  options?: CreateNativePhoneBridgeOptions,
): NativePhoneBridge {
  const nativeMod =
    options && "nativeModule" in options
      ? (options.nativeModule ?? null)
      : getNativeKeepaliveModule();

  if (!hasNativePhoneSupport(nativeMod)) {
    return createSimulatedPhoneBridge(options?.simulatorOptions);
  }

  const simulatorFallback = createSimulatedPhoneBridge(options?.simulatorOptions);

  return {
    isSimulated: false,

    async getPrivilegeStatus(preferredChannel) {
      const raw = await nativeMod.getPhonePrivilegeStatusAsync!(preferredChannel ?? null);
      return normalizePrivilegeStatusRecord(raw, false);
    },

    async requestShizukuPermission() {
      const raw = (await nativeMod.requestShizukuPermissionAsync?.()) ?? {};
      return normalizePrivilegeStatusRecord(raw, false);
    },

    async startWirelessAdbDiscovery() {
      const raw = (await nativeMod.startWirelessAdbDiscoveryAsync?.()) ?? {};
      return normalizePrivilegeStatusRecord(raw, false);
    },

    async stopWirelessAdbDiscovery() {
      return Boolean(await nativeMod.stopWirelessAdbDiscoveryAsync?.());
    },

    async openWirelessDebuggingWithPairingNotification(openSettings = true) {
      const raw =
        (await nativeMod.openWirelessDebuggingWithPairingNotificationAsync?.(openSettings)) ?? {};
      return normalizePrivilegeStatusRecord(raw, false);
    },

    async submitWirelessAdbPairingCode(pairingInput, host = null, port = null) {
      const raw =
        (await nativeMod.submitWirelessAdbPairingCodeAsync?.(pairingInput, host, port)) ?? {};
      return normalizePrivilegeStatusRecord(raw, false);
    },

    async executePrivilegedShell(command, channel, timeoutMs) {
      const raw =
        (await nativeMod.executePrivilegedShellAsync?.(
          command,
          channel ?? null,
          timeoutMs ?? null,
        )) ?? {};
      return {
        ok: asBoolean(raw.ok, false),
        exitCode: asNumberOrNull(raw.exitCode) ?? -1,
        stdout: asString(raw.stdout, ""),
        stderr: asString(raw.stderr, ""),
        channel: normalizeActiveChannel(raw.channel),
        durationMs: asNumberOrNull(raw.durationMs) ?? 0,
      };
    },

    async ensureVirtualDisplay(width, height, dpi) {
      const raw = await nativeMod.ensurePhoneVirtualDisplayAsync!(
        width ?? null,
        height ?? null,
        dpi ?? null,
      );
      return {
        ok: asBoolean(raw.ok, true),
        displayId: asNumberOrNull(raw.displayId) ?? 2,
        width: asNumberOrNull(raw.width) ?? DEFAULT_VIRTUAL_DISPLAY_WIDTH,
        height: asNumberOrNull(raw.height) ?? DEFAULT_VIRTUAL_DISPLAY_HEIGHT,
        dpi: asNumberOrNull(raw.dpi) ?? DEFAULT_VIRTUAL_DISPLAY_DPI,
      };
    },

    async releaseVirtualDisplay() {
      return Boolean(await nativeMod.releasePhoneVirtualDisplayAsync?.());
    },

    async captureFrameJpegBase64(maxLongEdge = 1080, quality = 72) {
      const raw = (await nativeMod.capturePhoneFrameAsync?.(maxLongEdge, quality)) ?? {};
      const base64 = asNullableString(raw.base64) ?? asNullableString(raw.screenshotBase64);
      return {
        ok: asBoolean(raw.ok, Boolean(base64)),
        displayId: asNumberOrNull(raw.displayId) ?? 2,
        base64,
        screenshotBase64: base64,
        mimeType: "image/jpeg",
        width: asNumberOrNull(raw.width) ?? DEFAULT_VIRTUAL_DISPLAY_WIDTH,
        height: asNumberOrNull(raw.height) ?? DEFAULT_VIRTUAL_DISPLAY_HEIGHT,
        sourceWidth: asNumberOrNull(raw.sourceWidth) ?? DEFAULT_VIRTUAL_DISPLAY_WIDTH,
        sourceHeight: asNumberOrNull(raw.sourceHeight) ?? DEFAULT_VIRTUAL_DISPLAY_HEIGHT,
        byteLength: asNumberOrNull(raw.byteLength) ?? 0,
        isSecureFlag: asBoolean(raw.isSecureFlag, false),
        timestamp: asNumberOrNull(raw.timestamp) ?? Date.now(),
      };
    },

    async launchAppOnVirtualDisplay(packageName, unlocked = false) {
      if (!unlocked && isBlockedPhonePackage(packageName)) {
        return false;
      }
      if (unlocked && typeof nativeMod.executePhoneDisplayActionAsync === "function") {
        const res = await nativeMod.executePhoneDisplayActionAsync({
          type: "launch_app",
          packageName,
          unlocked: true,
        });
        return asBoolean(res?.ok, false);
      }
      return Boolean(await nativeMod.launchAppOnVirtualDisplayAsync?.(packageName));
    },

    async moveAppToMainScreenForTakeover(packageName) {
      return Boolean(await nativeMod.moveAppToMainScreenForTakeoverAsync?.(packageName));
    },

    async returnAppToVirtualDisplay(packageName) {
      return Boolean(await nativeMod.returnAppToVirtualDisplayAsync?.(packageName));
    },

    async executeDisplayAction(action) {
      const raw = await nativeMod.executePhoneDisplayActionAsync!(
        action as unknown as Record<string, unknown>,
      );
      return raw as unknown as PhoneDisplayActionResult;
    },

    async listInstalledApps() {
      const rawList = (await nativeMod.listInstalledPhoneAppsAsync?.()) ?? [];
      return rawList.map((entry) => ({
        packageName: asString(entry.packageName, ""),
        label: asString(entry.label, asString(entry.packageName, "")),
        activityName: asString(entry.activityName, ""),
        isSystemApp: asBoolean(entry.isSystemApp, false),
      }));
    },

    async canDrawOverlays() {
      return Boolean(await nativeMod.canDrawPhoneOverlaysAsync?.());
    },

    async openOverlayPermissionSettings() {
      return Boolean(await nativeMod.openPhoneOverlayPermissionSettingsAsync?.());
    },

    async showFloatingOverlay(state) {
      const raw = await nativeMod.showPhoneFloatingOverlayAsync!(
        state as unknown as Record<string, unknown>,
      );
      return normalizeOverlayStateRecord(raw);
    },

    async updateFloatingOverlay(state) {
      const raw =
        (await nativeMod.updatePhoneFloatingOverlayAsync?.(
          state as unknown as Record<string, unknown>,
        )) ?? {};
      return normalizeOverlayStateRecord(raw);
    },

    async setFloatingOverlayMode(mode) {
      const raw = (await nativeMod.setPhoneFloatingOverlayModeAsync?.(mode)) ?? {};
      return normalizeOverlayStateRecord(raw);
    },

    async hideFloatingOverlay() {
      return Boolean(await nativeMod.hidePhoneFloatingOverlayAsync?.());
    },

    async setExecutionPaused(paused) {
      const raw = (await nativeMod.setPhoneExecutionPausedAsync?.(paused)) ?? {};
      return normalizeOverlayStateRecord(raw);
    },

    async clearEmergencyStop() {
      return Boolean(await nativeMod.clearPhoneEmergencyStopAsync?.());
    },

    async triggerEmergencyStop() {
      const raw = (await nativeMod.triggerPhoneEmergencyStopAsync?.()) ?? {};
      return normalizeOverlayStateRecord(raw);
    },

    async simulateCapsuleLongPress(durationMs) {
      if (durationMs >= CAPSULE_EMERGENCY_LONG_PRESS_MS) {
        return this.triggerEmergencyStop();
      }
      return simulatorFallback.simulateCapsuleLongPress(durationMs);
    },

    async simulateOverlayControl(control) {
      if (control === "expand") return this.setFloatingOverlayMode("mini_window");
      if (control === "collapse") return this.setFloatingOverlayMode("capsule");
      if (control === "pause") return this.setExecutionPaused(true);
      if (control === "resume") return this.setExecutionPaused(false);
      if (control === "stop") return this.triggerEmergencyStop();
      return simulatorFallback.simulateOverlayControl(control);
    },

    addOverlayActionListener(listener) {
      if (typeof nativeMod.addListener !== "function") {
        return createBridgeSubscription(() => {});
      }
      const sub = nativeMod.addListener("onPhoneOverlayAction", (raw) => {
        const actionRaw = asString(raw?.action, "mode_changed") as PhoneOverlayActionKind;
        listener({
          action: actionRaw,
          mode: normalizeOverlayMode(raw?.mode),
          paused: asBoolean(raw?.paused, false),
          onMainScreenTakeover: asBoolean(raw?.onMainScreenTakeover, false),
          packageName: asNullableString(raw?.packageName),
          ...(typeof raw?.source === "string" ? { source: raw.source } : {}),
          timestamp: asNumberOrNull(raw?.timestamp) ?? Date.now(),
        });
      });
      return createBridgeSubscription(() => {
        try {
          sub.remove();
        } catch {
          // Ignore listener removal errors.
        }
      });
    },

    addPrivilegeChangedListener(listener) {
      if (typeof nativeMod.addListener !== "function") {
        return createBridgeSubscription(() => {});
      }
      const sub = nativeMod.addListener("onPhonePrivilegeChanged", (raw) => {
        listener(normalizePrivilegeStatusRecord(raw ?? {}, false));
      });
      return createBridgeSubscription(() => {
        try {
          sub.remove();
        } catch {
          // Ignore listener removal errors.
        }
      });
    },
  };
}

let sharedBridgeInstance: NativePhoneBridge | null = null;

export function getNativePhoneBridge(): NativePhoneBridge {
  if (!sharedBridgeInstance) {
    sharedBridgeInstance = createNativePhoneBridge();
  }
  return sharedBridgeInstance;
}

export function resetSharedNativePhoneBridgeForTesting(): void {
  sharedBridgeInstance = null;
}
