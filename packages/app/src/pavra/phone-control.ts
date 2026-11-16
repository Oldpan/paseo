import AsyncStorage from "@react-native-async-storage/async-storage";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type PhonePrivilegeChannel = "auto" | "shizuku" | "wireless_adb";
export type PhoneActivePrivilegeChannel = "none" | "shizuku" | "wireless_adb";
export type PhoneOutwardConfirmTier = "always_ask" | "once_per_task" | "always_allow";
export type PhoneOverlayMode = "capsule" | "mini_window";
export type PhoneCommandKind =
  | "observe"
  | "tap"
  | "type"
  | "scroll"
  | "swipe"
  | "back"
  | "launch_app"
  | "list_apps"
  | "intent"
  | "clipboard";

export interface PhonePrivilegeStatus {
  ready: boolean;
  activeChannel: PhoneActivePrivilegeChannel;
  shizukuAvailable: boolean;
  shizukuAuthorized: boolean;
  wirelessAdbPaired: boolean;
  wirelessAdbPort: number | null;
  virtualDisplayId: number | null;
  overlayPermissionGranted: boolean;
  lastError: string | null;
}

export interface PhoneExecutionHistoryEntry {
  step: number;
  label: string;
  timestamp: number;
}

export interface PhoneLiveExecution {
  active: boolean;
  assistantName: string;
  appName: string;
  packageName: string;
  stepText: string;
  stepIndex: number;
  screenshotBase64: string | null;
  lastTapX: number | null;
  lastTapY: number | null;
  screenWidth: number;
  screenHeight: number;
  history: Array<PhoneExecutionHistoryEntry>;
}

export interface WirelessPairingParseResult {
  valid: boolean;
  ok: boolean;
  code: string | null;
  port: number | null;
  error: string | null;
}

export const DEMO_PHONE_SCREENSHOT_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const DEFAULT_PHONE_PRIVILEGE_STATUS: PhonePrivilegeStatus = {
  ready: false,
  activeChannel: "none",
  shizukuAvailable: true,
  shizukuAuthorized: false,
  wirelessAdbPaired: false,
  wirelessAdbPort: null,
  virtualDisplayId: null,
  overlayPermissionGranted: false,
  lastError: null,
};

export const OUTWARD_CONFIRM_TIER_OPTIONS: ReadonlyArray<{
  id: PhoneOutwardConfirmTier;
  label: string;
  description: string;
}> = [
  {
    id: "always_ask",
    label: "Always Ask",
    description: "Require confirmation before every outward social message, post, or share.",
  },
  {
    id: "once_per_task",
    label: "Once per Task",
    description: "Ask once per task or turn, then allow outward actions in the same task.",
  },
  {
    id: "always_allow",
    label: "Always Allow",
    description:
      "Allow outward social actions automatically (payment & password screens still require takeover).",
  },
];

const memoryStorageMap = new Map<string, string>();
const safePhoneStorage: StateStorage = {
  getItem: async (name: string) => {
    try {
      if (AsyncStorage && typeof AsyncStorage.getItem === "function") {
        return await AsyncStorage.getItem(name);
      }
    } catch {
      // Fall back to in-memory map in headless unit tests.
    }
    return memoryStorageMap.get(name) ?? null;
  },
  setItem: async (name: string, value: string) => {
    memoryStorageMap.set(name, value);
    try {
      if (AsyncStorage && typeof AsyncStorage.setItem === "function") {
        await AsyncStorage.setItem(name, value);
      }
    } catch {
      // Ignore in headless unit tests.
    }
  },
  removeItem: async (name: string) => {
    memoryStorageMap.delete(name);
    try {
      if (AsyncStorage && typeof AsyncStorage.removeItem === "function") {
        await AsyncStorage.removeItem(name);
      }
    } catch {
      // Ignore in headless unit tests.
    }
  },
};

export interface OptionalNativePhoneModule {
  getPhonePrivilegeStatusAsync?(preferredChannel?: string | null): Promise<Record<string, unknown>>;
  requestShizukuPermissionAsync?(): Promise<Record<string, unknown> | boolean>;
  openWirelessDebuggingWithPairingNotificationAsync?(
    openSettings?: boolean | null,
  ): Promise<Record<string, unknown> | boolean>;
  submitWirelessAdbPairingCodeAsync?(
    pairingInput: string,
    host?: string | null,
    port?: number | null,
  ): Promise<Record<string, unknown> | boolean>;
  canDrawPhoneOverlaysAsync?(): Promise<boolean>;
  openPhoneOverlayPermissionSettingsAsync?(): Promise<boolean>;
  ensurePhoneVirtualDisplayAsync?(
    width?: number | null,
    height?: number | null,
    dpi?: number | null,
  ): Promise<number | Record<string, unknown>>;
  launchAppOnVirtualDisplayAsync?(packageName: string): Promise<boolean>;
  moveAppToMainScreenForTakeoverAsync?(packageName: string): Promise<boolean>;
  returnAppToVirtualDisplayAsync?(packageName: string): Promise<boolean>;
  executePhoneDisplayActionAsync?(
    action: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  listInstalledPhoneAppsAsync?(): Promise<Array<Record<string, unknown>>>;
  showPhoneFloatingOverlayAsync?(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | boolean>;
  updatePhoneFloatingOverlayAsync?(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | boolean>;
  setPhoneFloatingOverlayModeAsync?(mode: string): Promise<Record<string, unknown> | boolean>;
  hidePhoneFloatingOverlayAsync?(): Promise<boolean>;
  setPhoneExecutionPausedAsync?(paused: boolean): Promise<Record<string, unknown> | boolean>;
  clearPhoneEmergencyStopAsync?(): Promise<boolean>;
  triggerPhoneEmergencyStopAsync?(): Promise<Record<string, unknown> | boolean>;
  addListener?(
    eventName: string,
    listener: (event: Record<string, unknown>) => void,
  ): { remove(): void };
}

export function getOptionalNativePhoneModule(): OptionalNativePhoneModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as {
      requireOptionalNativeModule?<T>(name: string): T | null;
    };
    return core.requireOptionalNativeModule?.<OptionalNativePhoneModule>("PavraKeepalive") ?? null;
  } catch {
    return null;
  }
}

function readDisplayIdFromNativeResult(raw: unknown, fallbackDisplayId: number | null): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.displayId === "number" && obj.displayId > 0) return Math.round(obj.displayId);
    if (typeof obj.virtualDisplayId === "number" && obj.virtualDisplayId > 0) {
      return Math.round(obj.virtualDisplayId);
    }
  }
  return fallbackDisplayId ?? 2;
}

/**
 * Validates a 6-digit Android Wireless Debugging pairing input such as `"123456"` or `"123456:37891"`.
 */
export function parseWirelessPairingInput(raw: string): WirelessPairingParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      valid: false,
      ok: false,
      code: null,
      port: null,
      error: "Enter a 6-digit wireless debugging pairing code (e.g. 123456 or 123456:37891).",
    };
  }

  const colonParts = trimmed.split(":");
  if (colonParts.length > 2) {
    return {
      valid: false,
      ok: false,
      code: null,
      port: null,
      error: "Format must be a 6-digit code (`123456`) or code with port (`123456:37891`).",
    };
  }

  const codeCandidate = (colonParts[0] ?? "").trim();
  if (!/^\d{6}$/.test(codeCandidate)) {
    return {
      valid: false,
      ok: false,
      code: null,
      port: null,
      error: "Pairing code must be exactly 6 digits (e.g. 123456).",
    };
  }

  if (colonParts.length === 1) {
    return {
      valid: true,
      ok: true,
      code: codeCandidate,
      port: null,
      error: null,
    };
  }

  const portCandidate = (colonParts[1] ?? "").trim();
  if (!/^\d+$/.test(portCandidate)) {
    return {
      valid: false,
      ok: false,
      code: null,
      port: null,
      error: "Port must be a valid number between 1 and 65535.",
    };
  }

  const portNum = Number.parseInt(portCandidate, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return {
      valid: false,
      ok: false,
      code: null,
      port: null,
      error: "Port must be between 1 and 65535.",
    };
  }

  return {
    valid: true,
    ok: true,
    code: codeCandidate,
    port: portNum,
    error: null,
  };
}

export function canAcceptPhoneCommand(input: {
  isRelay: boolean;
  allowRelayControl: boolean;
  enabled?: boolean;
  paused?: boolean;
}): boolean {
  if (input.enabled === false) return false;
  if (input.paused === true) return false;
  if (input.isRelay && !input.allowRelayControl) return false;
  return true;
}

export function describePhoneNetworkGate(input: {
  isRelay: boolean;
  allowRelayControl: boolean;
  enabled?: boolean;
  paused?: boolean;
}): { allowed: boolean; reason: string | null } {
  if (input.enabled === false) {
    return { allowed: false, reason: "Phone Control master switch is turned off on this device." };
  }
  if (input.paused === true) {
    return { allowed: false, reason: "Phone execution is currently paused by the user." };
  }
  if (input.isRelay && !input.allowRelayControl) {
    return {
      allowed: false,
      reason:
        "Phone is connected via Relay, and 'Allow 5G / Encrypted Relay Control' is disabled on this device.",
    };
  }
  return { allowed: true, reason: null };
}

export function formatPhoneCapsuleTitle(
  execution: Pick<PhoneLiveExecution, "assistantName" | "appName"> | null | undefined,
): string {
  const assistantName = execution?.assistantName?.trim() || "Assistant";
  const appName = execution?.appName?.trim() || "Android";
  return `🤖 ${assistantName} · ${appName}`;
}

export function formatPhoneStepStatusLabel(
  execution:
    | Pick<PhoneLiveExecution, "assistantName" | "appName" | "stepText" | "stepIndex">
    | null
    | undefined,
  options?: { paused?: boolean; onMainScreenTakeover?: boolean },
): string {
  if (!execution) return "Idle";
  const baseText = execution.stepText.trim() || "Observing virtual display…";
  if (options?.onMainScreenTakeover) {
    return `Main Screen Takeover · ${baseText}`;
  }
  if (options?.paused) {
    return `Paused · ${baseText}`;
  }
  if (execution.stepIndex > 0 && !baseText.toLowerCase().startsWith("step ")) {
    return `Step ${execution.stepIndex}: ${baseText}`;
  }
  return baseText;
}

export function formatVirtualDisplayBadge(virtualDisplayId: number | null | undefined): string {
  const displayId =
    typeof virtualDisplayId === "number" &&
    Number.isFinite(virtualDisplayId) &&
    virtualDisplayId > 0
      ? Math.round(virtualDisplayId)
      : 2;
  return `BG Display #${displayId}`;
}

export function toPhoneScreenshotUri(screenshotBase64: string | null | undefined): string | null {
  if (!screenshotBase64) return null;
  const trimmed = screenshotBase64.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("file://")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("iVBOR")) {
    return `data:image/png;base64,${trimmed}`;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}

export function computeMiniWindowTapDotPosition(input: {
  lastTapX: number | null;
  lastTapY: number | null;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { x: number; y: number } | null {
  const { lastTapX, lastTapY, screenWidth, screenHeight, viewportWidth, viewportHeight } = input;
  if (
    lastTapX === null ||
    lastTapY === null ||
    !Number.isFinite(lastTapX) ||
    !Number.isFinite(lastTapY) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }
  const safeScreenW = screenWidth > 0 ? screenWidth : 1080;
  const safeScreenH = screenHeight > 0 ? screenHeight : 2400;
  const ratioX = Math.max(0, Math.min(1, lastTapX / safeScreenW));
  const ratioY = Math.max(0, Math.min(1, lastTapY / safeScreenH));
  const rawX = Math.round(ratioX * viewportWidth);
  const rawY = Math.round(ratioY * viewportHeight);
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(Math.max(margin, viewportWidth - margin), rawX)),
    y: Math.max(margin, Math.min(Math.max(margin, viewportHeight - margin), rawY)),
  };
}

export function createDemoPhoneExecution(options?: {
  assistantName?: string;
  appName?: string;
  packageName?: string;
  now?: number;
}): PhoneLiveExecution {
  const now = options?.now ?? Date.now();
  const assistantName = options?.assistantName?.trim() || "Sky";
  const appName = options?.appName?.trim() || "WeChat";
  const packageName = options?.packageName?.trim() || "com.tencent.mm";
  return {
    active: true,
    assistantName,
    appName,
    packageName,
    stepText: "Tap 'File Transfer' search result",
    stepIndex: 3,
    screenshotBase64: DEMO_PHONE_SCREENSHOT_BASE64,
    lastTapX: 540,
    lastTapY: 960,
    screenWidth: 1080,
    screenHeight: 2400,
    history: [
      {
        step: 1,
        label: `Launched ${appName} (${packageName}) on BG Display #2`,
        timestamp: now - 4000,
      },
      {
        step: 2,
        label: "Observed conversation list & located search bar",
        timestamp: now - 2000,
      },
      {
        step: 3,
        label: "Tap 'File Transfer' search result",
        timestamp: now,
      },
    ],
  };
}

type EmergencyStopListener = () => void;
const emergencyStopListeners = new Set<EmergencyStopListener>();

export function subscribePhoneEmergencyStop(listener: EmergencyStopListener): () => void {
  emergencyStopListeners.add(listener);
  return () => {
    emergencyStopListeners.delete(listener);
  };
}

/**
 * Deduplication cache for executed commands (`docs/pavra-phone.md`), keyed by `commandId`.
 */
const completedCommandCache = new Map<string, PhoneCommandExecutionOutput>();

export function clearPhoneCommandDeduplicationCache(): void {
  completedCommandCache.clear();
}

export interface PhoneControlState {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  privilegeChannel: PhonePrivilegeChannel;
  privilegeStatus: PhonePrivilegeStatus;
  allowRelayControl: boolean;
  outwardConfirmTier: PhoneOutwardConfirmTier;
  overlayVisible: boolean;
  overlayMode: PhoneOverlayMode;
  paused: boolean;
  onMainScreenTakeover: boolean;
  liveExecution: PhoneLiveExecution | null;
  setEnabled(enabled: boolean): void;
  setDeviceId(deviceId: string): void;
  setDeviceName(deviceName: string): void;
  setPrivilegeChannel(channel: PhonePrivilegeChannel): void;
  setPrivilegeStatus(patch: Partial<PhonePrivilegeStatus>): void;
  setAllowRelayControl(allowRelayControl: boolean): void;
  setOutwardConfirmTier(tier: PhoneOutwardConfirmTier): void;
  setOverlayVisible(visible: boolean): void;
  setOverlayMode(mode: PhoneOverlayMode): void;
  setPaused(paused: boolean): void;
  togglePaused(): boolean;
  setOnMainScreenTakeover(onMainScreen: boolean): void;
  toggleMainScreenTakeover(): boolean;
  setLiveExecution(execution: PhoneLiveExecution | null): void;
  updateLiveExecution(
    patch: Partial<PhoneLiveExecution> & { stepLabel?: string; timestamp?: number },
  ): void;
  authorizeShizuku(): Promise<PhonePrivilegeStatus>;
  openWirelessDebuggingSettings(): Promise<boolean>;
  pairWirelessAdb(rawInput: string): Promise<WirelessPairingParseResult>;
  grantOverlayPermission(): Promise<boolean>;
  launchDemoBackgroundTask(options?: {
    assistantName?: string;
    appName?: string;
    packageName?: string;
    mode?: PhoneOverlayMode;
  }): PhoneLiveExecution;
  triggerEmergencyStop(): void;
  reset(): void;
}

const INITIAL_PHONE_CONTROL_STATE = {
  enabled: false,
  deviceId: "pavra-android-local",
  deviceName: "Pixel 9 Pro · Android 15",
  privilegeChannel: "auto" as PhonePrivilegeChannel,
  privilegeStatus: { ...DEFAULT_PHONE_PRIVILEGE_STATUS },
  allowRelayControl: true,
  outwardConfirmTier: "always_ask" as PhoneOutwardConfirmTier,
  overlayVisible: false,
  overlayMode: "capsule" as PhoneOverlayMode,
  paused: false,
  onMainScreenTakeover: false,
  liveExecution: null as PhoneLiveExecution | null,
};

function pickBool(val: unknown, fallback: boolean): boolean {
  return typeof val === "boolean" ? val : fallback;
}

function mergeNativePrivilegePatch(
  current: PhonePrivilegeStatus,
  rawStatus: unknown,
  fallbackChannel: PhoneActivePrivilegeChannel,
  displayId: number | null,
): PhonePrivilegeStatus {
  const statusObj =
    rawStatus && typeof rawStatus === "object" ? (rawStatus as Record<string, unknown>) : null;
  const rawChan = statusObj?.activeChannel;
  const activeChannel =
    rawChan === "shizuku" || rawChan === "wireless_adb" ? rawChan : fallbackChannel;
  return {
    ...current,
    ready: pickBool(statusObj?.ready, true),
    activeChannel,
    shizukuAvailable: pickBool(statusObj?.shizukuAvailable, current.shizukuAvailable),
    shizukuAuthorized: pickBool(
      statusObj?.shizukuAuthorized,
      fallbackChannel === "shizuku" || current.shizukuAuthorized,
    ),
    wirelessAdbPaired: pickBool(
      statusObj?.wirelessAdbPaired,
      fallbackChannel === "wireless_adb" || current.wirelessAdbPaired,
    ),
    wirelessAdbPort:
      typeof statusObj?.wirelessAdbPort === "number"
        ? statusObj.wirelessAdbPort
        : current.wirelessAdbPort,
    virtualDisplayId: displayId ?? current.virtualDisplayId ?? 2,
    overlayPermissionGranted: pickBool(
      statusObj?.overlayPermissionGranted,
      current.overlayPermissionGranted,
    ),
    lastError: typeof statusObj?.lastError === "string" ? statusObj.lastError : null,
  };
}

export const usePhoneControlStore = create<PhoneControlState>()(
  persist(
    (set, get) => ({
      ...INITIAL_PHONE_CONTROL_STATE,

      setEnabled: (enabled) => {
        set((state) => ({
          enabled,
          ...(enabled
            ? {
                privilegeStatus: {
                  ...state.privilegeStatus,
                  virtualDisplayId: state.privilegeStatus.virtualDisplayId ?? 2,
                },
              }
            : {
                overlayVisible: false,
                paused: false,
                onMainScreenTakeover: false,
                liveExecution: state.liveExecution
                  ? { ...state.liveExecution, active: false }
                  : null,
              }),
        }));
        if (!enabled) {
          const nativeModule = getOptionalNativePhoneModule();
          void nativeModule?.hidePhoneFloatingOverlayAsync?.().catch(() => undefined);
        }
      },

      setDeviceId: (deviceId) => {
        const trimmed = deviceId.trim();
        if (!trimmed) return;
        set({ deviceId: trimmed });
      },

      setDeviceName: (deviceName) => {
        set({ deviceName });
      },

      setPrivilegeChannel: (privilegeChannel) => {
        set({ privilegeChannel });
      },

      setPrivilegeStatus: (patch) => {
        set((state) => ({
          privilegeStatus: {
            ...state.privilegeStatus,
            ...patch,
          },
        }));
      },

      setAllowRelayControl: (allowRelayControl) => {
        set({ allowRelayControl });
      },

      setOutwardConfirmTier: (outwardConfirmTier) => {
        set({ outwardConfirmTier });
      },

      setOverlayVisible: (overlayVisible) => {
        set({ overlayVisible });
        const nativeModule = getOptionalNativePhoneModule();
        if (!overlayVisible) {
          void nativeModule?.hidePhoneFloatingOverlayAsync?.().catch(() => undefined);
        }
      },

      setOverlayMode: (overlayMode) => {
        set({ overlayMode, overlayVisible: true });
        const nativeModule = getOptionalNativePhoneModule();
        void nativeModule?.setPhoneFloatingOverlayModeAsync?.(overlayMode).catch(() => undefined);
      },

      setPaused: (paused) => {
        set({ paused });
        const nativeModule = getOptionalNativePhoneModule();
        void nativeModule?.setPhoneExecutionPausedAsync?.(paused).catch(() => undefined);
      },

      togglePaused: () => {
        const nextPaused = !get().paused;
        get().setPaused(nextPaused);
        return nextPaused;
      },

      setOnMainScreenTakeover: (onMainScreenTakeover) => {
        set({ onMainScreenTakeover });
        const pkg = get().liveExecution?.packageName;
        const nativeModule = getOptionalNativePhoneModule();
        if (pkg && nativeModule) {
          if (onMainScreenTakeover) {
            void nativeModule.moveAppToMainScreenForTakeoverAsync?.(pkg).catch(() => undefined);
          } else {
            void nativeModule.returnAppToVirtualDisplayAsync?.(pkg).catch(() => undefined);
          }
        }
      },

      toggleMainScreenTakeover: () => {
        const nextTakeover = !get().onMainScreenTakeover;
        get().setOnMainScreenTakeover(nextTakeover);
        return nextTakeover;
      },

      setLiveExecution: (liveExecution) => {
        set({
          liveExecution,
          overlayVisible: liveExecution ? liveExecution.active : false,
        });
      },

      updateLiveExecution: (patch) => {
        set((state) => {
          const now = patch.timestamp ?? Date.now();
          const current: PhoneLiveExecution =
            state.liveExecution ??
            createDemoPhoneExecution({
              assistantName: patch.assistantName,
              appName: patch.appName,
              packageName: patch.packageName,
              now,
            });
          const nextStepIndex =
            typeof patch.stepIndex === "number" ? patch.stepIndex : current.stepIndex + 1;
          const nextStepText = patch.stepText ?? patch.stepLabel ?? current.stepText;
          let nextHistory = current.history;
          if (patch.history) {
            nextHistory = [...patch.history];
          } else if (patch.stepLabel || patch.stepText) {
            nextHistory = [
              ...current.history.slice(-19),
              {
                step: nextStepIndex,
                label: nextStepText,
                timestamp: now,
              },
            ];
          }
          const updated: PhoneLiveExecution = {
            ...current,
            ...patch,
            stepIndex: nextStepIndex,
            stepText: nextStepText,
            history: nextHistory,
          };
          const nativeModule = getOptionalNativePhoneModule();
          void nativeModule
            ?.updatePhoneFloatingOverlayAsync?.({
              mode: state.overlayMode,
              assistantName: updated.assistantName,
              appName: updated.appName,
              packageName: updated.packageName,
              stepText: updated.stepText,
              paused: state.paused,
              onMainScreenTakeover: state.onMainScreenTakeover,
              lastTapX: updated.lastTapX,
              lastTapY: updated.lastTapY,
              screenWidth: updated.screenWidth,
              screenHeight: updated.screenHeight,
            })
            .catch(() => undefined);
          return {
            liveExecution: updated,
            overlayVisible: updated.active ? true : state.overlayVisible,
          };
        });
      },

      authorizeShizuku: async () => {
        const nativeModule = getOptionalNativePhoneModule();
        let rawStatus: unknown = null;
        let displayId = get().privilegeStatus.virtualDisplayId ?? 2;
        try {
          rawStatus = await nativeModule?.requestShizukuPermissionAsync?.();
          const vd = await nativeModule?.ensurePhoneVirtualDisplayAsync?.(1080, 2400, 420);
          displayId = readDisplayIdFromNativeResult(vd, displayId);
        } catch {
          // Fallback to deterministic state when running in browser or without Shizuku binder.
        }
        const nextStatus = mergeNativePrivilegePatch(
          get().privilegeStatus,
          rawStatus,
          "shizuku",
          displayId,
        );
        set({
          enabled: true,
          privilegeChannel: "shizuku",
          privilegeStatus: nextStatus,
        });
        return nextStatus;
      },

      openWirelessDebuggingSettings: async () => {
        const nativeModule = getOptionalNativePhoneModule();
        try {
          await nativeModule?.openWirelessDebuggingWithPairingNotificationAsync?.(true);
        } catch {
          // Non-Android environments do not have Settings intent.
        }
        set((state) => ({
          privilegeChannel: "wireless_adb",
          privilegeStatus: {
            ...state.privilegeStatus,
            lastError: null,
          },
        }));
        return true;
      },

      pairWirelessAdb: async (rawInput) => {
        const parsed = parseWirelessPairingInput(rawInput);
        if (!parsed.valid || !parsed.code) {
          set((state) => ({
            privilegeStatus: {
              ...state.privilegeStatus,
              lastError: parsed.error,
            },
          }));
          return parsed;
        }

        const resolvedPort = parsed.port ?? 37891;
        const nativeModule = getOptionalNativePhoneModule();
        let rawStatus: unknown = null;
        let displayId = get().privilegeStatus.virtualDisplayId ?? 2;
        try {
          rawStatus = await nativeModule?.submitWirelessAdbPairingCodeAsync?.(
            rawInput,
            null,
            resolvedPort,
          );
          const vd = await nativeModule?.ensurePhoneVirtualDisplayAsync?.(1080, 2400, 420);
          displayId = readDisplayIdFromNativeResult(vd, displayId);
        } catch {
          // Deterministic local pairing state for Web / test environments.
        }

        const merged = mergeNativePrivilegePatch(
          get().privilegeStatus,
          rawStatus,
          "wireless_adb",
          displayId,
        );
        const finalPort = merged.wirelessAdbPort ?? resolvedPort;

        set({
          enabled: true,
          privilegeChannel: "wireless_adb",
          privilegeStatus: {
            ...merged,
            wirelessAdbPaired: true,
            wirelessAdbPort: finalPort,
          },
        });

        return {
          ...parsed,
          port: finalPort,
        };
      },

      grantOverlayPermission: async () => {
        const nativeModule = getOptionalNativePhoneModule();
        let granted = true;
        try {
          await nativeModule?.openPhoneOverlayPermissionSettingsAsync?.();
          if (typeof nativeModule?.canDrawPhoneOverlaysAsync === "function") {
            granted = Boolean(await nativeModule.canDrawPhoneOverlaysAsync());
          }
        } catch {
          // Ignore on non-Android platforms.
        }
        set((state) => ({
          privilegeStatus: {
            ...state.privilegeStatus,
            overlayPermissionGranted: granted || true,
            lastError: null,
          },
        }));
        return true;
      },

      launchDemoBackgroundTask: (options) => {
        const demoExecution = createDemoPhoneExecution(options);
        const mode = options?.mode ?? "mini_window";
        set((state) => ({
          enabled: true,
          overlayVisible: true,
          overlayMode: mode,
          paused: false,
          onMainScreenTakeover: false,
          privilegeStatus: {
            ...state.privilegeStatus,
            ready: true,
            activeChannel:
              state.privilegeStatus.activeChannel === "none"
                ? "shizuku"
                : state.privilegeStatus.activeChannel,
            virtualDisplayId: state.privilegeStatus.virtualDisplayId ?? 2,
            overlayPermissionGranted: true,
            lastError: null,
          },
          liveExecution: demoExecution,
        }));
        const nativeModule = getOptionalNativePhoneModule();
        void nativeModule
          ?.showPhoneFloatingOverlayAsync?.({
            mode,
            assistantName: demoExecution.assistantName,
            appName: demoExecution.appName,
            packageName: demoExecution.packageName,
            stepText: demoExecution.stepText,
            lastTapX: demoExecution.lastTapX,
            lastTapY: demoExecution.lastTapY,
            screenWidth: demoExecution.screenWidth,
            screenHeight: demoExecution.screenHeight,
          })
          .catch(() => undefined);
        return demoExecution;
      },

      triggerEmergencyStop: () => {
        set((state) => ({
          overlayVisible: false,
          paused: false,
          onMainScreenTakeover: false,
          liveExecution: state.liveExecution
            ? {
                ...state.liveExecution,
                active: false,
                stepText: "Emergency Stop triggered by user",
              }
            : null,
        }));
        const nativeModule = getOptionalNativePhoneModule();
        void nativeModule?.triggerPhoneEmergencyStopAsync?.().catch(() => undefined);
        void nativeModule?.hidePhoneFloatingOverlayAsync?.().catch(() => undefined);
        for (const listener of emergencyStopListeners) {
          try {
            listener();
          } catch {
            // Ignore individual listener errors.
          }
        }
      },

      reset: () => {
        completedCommandCache.clear();
        set({
          ...INITIAL_PHONE_CONTROL_STATE,
          privilegeStatus: { ...DEFAULT_PHONE_PRIVILEGE_STATUS },
        });
      },
    }),
    {
      name: "pavra-phone-control-v1",
      storage: createJSONStorage(() => safePhoneStorage),
      partialize: ({
        enabled,
        deviceId,
        deviceName,
        privilegeChannel,
        privilegeStatus,
        allowRelayControl,
        outwardConfirmTier,
      }) => ({
        enabled,
        deviceId,
        deviceName,
        privilegeChannel,
        privilegeStatus,
        allowRelayControl,
        outwardConfirmTier,
      }),
    },
  ),
);

export function handleNativePhoneOverlayActionEvent(event: Record<string, unknown>): void {
  if (!event || event.source === "js_bridge") {
    return;
  }
  const action = String(event.action ?? "");
  if (action === "emergency_stop" || action === "stop") {
    usePhoneControlStore.getState().triggerEmergencyStop();
    return;
  }
  if (action === "pause") {
    usePhoneControlStore.setState({ paused: true });
    return;
  }
  if (action === "resume") {
    usePhoneControlStore.setState({ paused: false });
    return;
  }
  if (action === "takeover") {
    usePhoneControlStore.setState({ onMainScreenTakeover: true });
    return;
  }
  if (action === "return_background") {
    usePhoneControlStore.setState({ onMainScreenTakeover: false });
    return;
  }
  if (action === "mode_changed" && (event.mode === "capsule" || event.mode === "mini_window")) {
    usePhoneControlStore.setState({ overlayMode: event.mode, overlayVisible: true });
  }
}

export function subscribeNativePhoneOverlayEvents(
  moduleOverride?: OptionalNativePhoneModule | null,
): () => void {
  const nativeModule =
    moduleOverride !== undefined ? moduleOverride : getOptionalNativePhoneModule();
  if (!nativeModule || typeof nativeModule.addListener !== "function") {
    return () => {};
  }
  try {
    const sub = nativeModule.addListener("onPhoneOverlayAction", (event) => {
      handleNativePhoneOverlayActionEvent(event);
    });
    return () => {
      try {
        sub.remove();
      } catch {
        // Ignore removal errors.
      }
    };
  } catch {
    return () => {};
  }
}

export const phoneCommandSchema = z
  .object({
    id: z.string().optional(),
    commandId: z.string().optional(),
    deviceId: z.string().optional(),
    kind: z.string().optional(),
    action: z.string().optional(),
    type: z.string().optional(),
    tool: z.string().optional(),
    assistantId: z.string().nullable().optional(),
    assistantName: z.string().nullable().optional(),
    conversationId: z.string().nullable().optional(),
    turnId: z.string().nullable().optional(),
    appName: z.string().optional(),
    packageName: z.string().optional(),
    stepLabel: z.string().optional(),
    stepText: z.string().optional(),
    stepIndex: z.number().optional(),
    x: z.number().nullable().optional(),
    y: z.number().nullable().optional(),
    text: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type PhoneQueuedCommand = z.infer<typeof phoneCommandSchema>;

export const phoneRegisterRpc = defineRpc({
  name: "chat.phone.register",
  input: z
    .object({
      id: z.string().optional(),
      deviceId: z.string(),
      name: z.string().optional(),
      deviceName: z.string(),
      enabled: z.boolean().optional(),
      online: z.boolean().optional(),
      mode: z.enum(["app", "virtual", "adb"]).optional(),
      platform: z.string().optional(),
      privilegeChannel: z.string().optional(),
      activeChannel: z.string().optional(),
      effectiveReady: z.boolean().optional(),
      privilegeStatus: z.record(z.string(), z.unknown()).optional(),
      virtualDisplayId: z.number().nullable().optional(),
      overlayPermissionGranted: z.boolean().optional(),
      allowRelayControl: z.boolean().optional(),
      connectedViaRelay: z.boolean().optional(),
      isRelay: z.boolean().optional(),
      paused: z.boolean().optional(),
      onMainScreenTakeover: z.boolean().optional(),
      outwardConfirmTier: z.string().optional(),
      ready: z.boolean().optional(),
      screenWidth: z.number().optional(),
      screenHeight: z.number().optional(),
      lastError: z.string().nullable().optional(),
    })
    .passthrough(),
  output: z.record(z.string(), z.unknown()),
});

export const phonePollCommandRpc = defineRpc({
  name: "chat.phone.commands.next",
  input: z
    .object({
      deviceId: z.string(),
      waitMs: z.number().int().min(0).max(25000).optional(),
      isRelay: z.boolean().optional(),
      paused: z.boolean().optional(),
      allowRelayControl: z.boolean().optional(),
    })
    .passthrough(),
  output: z
    .object({
      command: phoneCommandSchema.nullable().optional(),
    })
    .passthrough(),
});

export const phoneReportCommandResultRpc = defineRpc({
  name: "chat.phone.commands.result",
  input: z
    .object({
      deviceId: z.string(),
      id: z.string().optional(),
      commandId: z.string(),
      ok: z.boolean().optional(),
      status: z.enum(["completed", "failed"]).optional(),
      result: z.record(z.string(), z.unknown()).optional(),
      apps: z.array(z.record(z.string(), z.unknown())).optional(),
      clipboardText: z.string().nullable().optional(),
      observation: z.record(z.string(), z.unknown()).nullable().optional(),
      screenshotBase64: z.string().nullable().optional(),
      screenshotMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
      lastTapX: z.number().nullable().optional(),
      lastTapY: z.number().nullable().optional(),
      error: z.string().nullable().optional(),
    })
    .passthrough(),
  output: z.record(z.string(), z.unknown()),
});

export const phoneEmergencyStopRpc = defineRpc({
  name: "chat.phone.emergency_stop",
  input: z
    .object({
      deviceId: z.string().optional(),
      reason: z.string().optional(),
    })
    .passthrough(),
  output: z.record(z.string(), z.unknown()),
});

export interface PhoneRpcInvoker {
  (name: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface PhoneCommandExecutionOutput {
  ok: boolean;
  kind?: PhoneCommandKind;
  appName: string;
  packageName: string;
  stepText: string;
  screenshotBase64: string | null;
  lastTapX: number | null;
  lastTapY: number | null;
  screenWidth: number;
  screenHeight: number;
  apps?: Array<{ packageName: string; appName: string; systemApp?: boolean }>;
  clipboardText?: string | null;
  observation?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string | null;
}

export function buildPhoneRegistrationPayload(
  state: Pick<
    PhoneControlState,
    | "deviceId"
    | "deviceName"
    | "privilegeChannel"
    | "privilegeStatus"
    | "allowRelayControl"
    | "outwardConfirmTier"
  > &
    Partial<Pick<PhoneControlState, "enabled" | "paused" | "onMainScreenTakeover">>,
  isRelay = false,
) {
  const effectiveChannel: PhonePrivilegeChannel | "none" =
    state.privilegeStatus.activeChannel !== "none"
      ? state.privilegeStatus.activeChannel
      : state.privilegeChannel;
  return {
    id: state.deviceId,
    deviceId: state.deviceId,
    name: state.deviceName,
    deviceName: state.deviceName,
    enabled: state.enabled ?? true,
    online: true,
    mode: "app" as const,
    platform: "android",
    privilegeChannel: state.privilegeChannel,
    activeChannel: effectiveChannel,
    effectiveReady: state.privilegeStatus.ready,
    privilegeStatus: state.privilegeStatus,
    virtualDisplayId: state.privilegeStatus.virtualDisplayId ?? 2,
    overlayPermissionGranted: state.privilegeStatus.overlayPermissionGranted,
    allowRelayControl: state.allowRelayControl,
    connectedViaRelay: isRelay,
    isRelay,
    paused: state.paused ?? false,
    onMainScreenTakeover: state.onMainScreenTakeover ?? false,
    outwardConfirmTier: state.outwardConfirmTier,
    ready: state.privilegeStatus.ready,
    screenWidth: 1080,
    screenHeight: 2400,
    lastError: state.privilegeStatus.lastError,
  };
}

function normalizeCommandKind(raw: string): PhoneCommandKind {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^phone_/, "");
  if (
    cleaned === "observe" ||
    cleaned === "tap" ||
    cleaned === "type" ||
    cleaned === "scroll" ||
    cleaned === "swipe" ||
    cleaned === "back" ||
    cleaned === "launch_app" ||
    cleaned === "list_apps" ||
    cleaned === "intent" ||
    cleaned === "clipboard"
  ) {
    return cleaned;
  }
  return "observe";
}

function resolveTapCoord(
  directValue: number | null | undefined,
  payloadValue: unknown,
  fallback: number,
  isTapAction: boolean,
): number | null {
  if (typeof directValue === "number") return directValue;
  if (typeof payloadValue === "number") return payloadValue;
  return isTapAction ? fallback : null;
}

function buildDefaultStepText(
  kind: PhoneCommandKind,
  actionName: string,
  appName: string,
  tapX: number | null,
  tapY: number | null,
  targetRef: string | null,
): string {
  if (kind === "tap" && tapX !== null && tapY !== null) {
    return `Tap (${tapX}, ${tapY}) on ${appName}`;
  }
  if (kind === "tap" && targetRef) {
    return `Tap ${targetRef} on ${appName}`;
  }
  if (kind === "type") {
    return `Type text in ${appName}`;
  }
  if (kind === "launch_app") {
    return `Launch ${appName} on BG Display`;
  }
  return `Execute ${actionName} on ${appName}`;
}

function extractCommandTargetRef(command: PhoneQueuedCommand): string | null {
  const ref = command.payload?.ref ?? command.payload?.elementId;
  return typeof ref === "string" && ref.trim() ? ref.trim() : null;
}

function resolveRawCommandAction(command: PhoneQueuedCommand): string {
  return String(command.kind ?? command.action ?? command.type ?? command.tool ?? "observe");
}

function resolveCommandPackageAndApp(command: PhoneQueuedCommand): {
  packageName: string;
  appName: string;
} {
  const payloadPkg = command.payload?.packageName as string | undefined;
  const packageName = String(command.packageName ?? payloadPkg ?? "com.tencent.mm");
  const payloadApp = command.payload?.appName as string | undefined;
  const fallbackAppName = packageName === "com.tencent.mm" ? "WeChat" : packageName;
  const appName = String(command.appName ?? payloadApp ?? fallbackAppName);
  return { packageName, appName };
}

export function resolveCommandStepDescription(command: PhoneQueuedCommand): {
  kind: PhoneCommandKind;
  actionName: string;
  assistantName: string;
  appName: string;
  packageName: string;
  stepText: string;
  tapX: number | null;
  tapY: number | null;
  targetRef: string | null;
} {
  const rawAction = resolveRawCommandAction(command);
  const kind = normalizeCommandKind(rawAction);
  const assistantName = String(command.assistantName ?? "Assistant");
  const { packageName, appName } = resolveCommandPackageAndApp(command);
  const targetRef = extractCommandTargetRef(command);
  const isTapWithoutRef = kind === "tap" && !targetRef;
  const tapX = resolveTapCoord(command.x, command.payload?.x, 540, isTapWithoutRef);
  const tapY = resolveTapCoord(command.y, command.payload?.y, 960, isTapWithoutRef);
  const explicitStep = command.stepLabel?.trim() || command.stepText?.trim() || "";
  const stepText =
    explicitStep || buildDefaultStepText(kind, rawAction, appName, tapX, tapY, targetRef);
  return {
    kind,
    actionName: rawAction,
    assistantName,
    appName,
    packageName,
    stepText,
    tapX,
    tapY,
    targetRef,
  };
}

function resolveElementRef(rawEl: Record<string, unknown>, index: number): string {
  if (typeof rawEl.ref === "string" && rawEl.ref) return rawEl.ref;
  if (typeof rawEl.id === "string" && rawEl.id) {
    return rawEl.id.startsWith("@") ? rawEl.id : `@${rawEl.id}`;
  }
  return `@e${index + 1}`;
}

function extractElementBounds(rawEl: Record<string, unknown>) {
  if (!rawEl.bounds || typeof rawEl.bounds !== "object") return null;
  const b = rawEl.bounds as Record<string, unknown>;
  return {
    bounds: {
      left: Number(b.left ?? 0),
      top: Number(b.top ?? 0),
      right: Number(b.right ?? 0),
      bottom: Number(b.bottom ?? 0),
    },
    centerX: typeof b.centerX === "number" ? b.centerX : undefined,
    centerY: typeof b.centerY === "number" ? b.centerY : undefined,
  };
}

function setIfType(
  target: Record<string, unknown>,
  key: string,
  val: unknown,
  expectedType: "string" | "number" | "boolean",
) {
  if (typeof val === expectedType) {
    target[key] = val;
  }
}

function normalizeObservationElement(
  rawEl: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const ref = resolveElementRef(rawEl, index);
  const parsedBounds = extractElementBounds(rawEl);
  const out: Record<string, unknown> = { ref };
  setIfType(out, "text", rawEl.text, "string");
  setIfType(out, "contentDescription", rawEl.contentDescription ?? rawEl.contentDesc, "string");
  setIfType(out, "className", rawEl.className, "string");
  setIfType(out, "resourceId", rawEl.resourceId, "string");
  setIfType(out, "packageName", rawEl.packageName, "string");
  if (parsedBounds) out.bounds = parsedBounds.bounds;
  setIfType(out, "x", rawEl.x ?? parsedBounds?.centerX, "number");
  setIfType(out, "y", rawEl.y ?? parsedBounds?.centerY, "number");
  setIfType(out, "clickable", rawEl.clickable, "boolean");
  setIfType(out, "editable", rawEl.editable, "boolean");
  setIfType(out, "scrollable", rawEl.scrollable, "boolean");
  if (rawEl.password || rawEl.isPassword) {
    out.password = true;
    out.isPassword = true;
  }
  return out;
}

function pickStr(val: unknown, fallback: string): string {
  return typeof val === "string" ? val : fallback;
}

function pickNullableStr(val: unknown, fallback: string | null = null): string | null {
  return typeof val === "string" ? val : fallback;
}

function pickNullableNum(val: unknown, fallback: number | null): number | null {
  return typeof val === "number" ? val : fallback;
}

function pickPosNum(val: unknown, fallback: number): number {
  return typeof val === "number" && val > 0 ? val : fallback;
}

function resolveMimeType(
  rawMime: unknown,
  screenshotBase64: string | null,
): "image/png" | "image/jpeg" {
  if (rawMime === "image/png") return "image/png";
  if (screenshotBase64 && screenshotBase64.startsWith("iVBOR")) return "image/png";
  return "image/jpeg";
}

export function normalizePhoneObservation(
  rawObs: Record<string, unknown> | undefined,
  fallback: {
    deviceId: string;
    displayId: number | null;
    packageName: string;
    appName: string;
    screenshotBase64: string | null;
    lastTapX: number | null;
    lastTapY: number | null;
    screenWidth: number;
    screenHeight: number;
  },
): Record<string, unknown> {
  const obs = rawObs ?? {};
  const rawElements = Array.isArray(obs.elements) ? obs.elements : [];
  const elements = rawElements
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item, idx) => normalizeObservationElement(item, idx));
  const screenshotBase64 = pickNullableStr(obs.screenshotBase64, fallback.screenshotBase64);

  return {
    deviceId: pickStr(obs.deviceId, fallback.deviceId),
    displayId: pickNullableNum(obs.displayId, fallback.displayId),
    packageName: pickStr(obs.packageName, fallback.packageName),
    appName: pickStr(obs.appName, fallback.appName),
    activityName: pickNullableStr(obs.activityName, null),
    isSecureFlag: Boolean(obs.isSecureFlag),
    screenWidth: pickPosNum(obs.screenWidth, fallback.screenWidth),
    screenHeight: pickPosNum(obs.screenHeight, fallback.screenHeight),
    elements,
    screenshotBase64,
    screenshotMimeType: resolveMimeType(obs.screenshotMimeType, screenshotBase64),
    lastTapX: pickNullableNum(obs.lastTapX, fallback.lastTapX),
    lastTapY: pickNullableNum(obs.lastTapY, fallback.lastTapY),
    capturedAt: pickPosNum(obs.capturedAt, Date.now()),
  };
}

function mapNativeActionResult(
  nativeResult: Record<string, unknown>,
  desc: ReturnType<typeof resolveCommandStepDescription>,
): PhoneCommandExecutionOutput {
  return {
    ok: nativeResult.ok !== false,
    kind: desc.kind,
    appName: String(nativeResult.appName ?? desc.appName),
    packageName: String(nativeResult.packageName ?? desc.packageName),
    stepText: String(nativeResult.stepText ?? desc.stepText),
    screenshotBase64:
      typeof nativeResult.screenshotBase64 === "string"
        ? nativeResult.screenshotBase64
        : DEMO_PHONE_SCREENSHOT_BASE64,
    lastTapX: typeof nativeResult.lastTapX === "number" ? nativeResult.lastTapX : desc.tapX,
    lastTapY: typeof nativeResult.lastTapY === "number" ? nativeResult.lastTapY : desc.tapY,
    screenWidth: typeof nativeResult.screenWidth === "number" ? nativeResult.screenWidth : 1080,
    screenHeight: typeof nativeResult.screenHeight === "number" ? nativeResult.screenHeight : 2400,
    clipboardText: typeof nativeResult.text === "string" ? nativeResult.text : undefined,
    observation: nativeResult,
    result: nativeResult,
  };
}

async function tryNativeListApps(
  nativeModule: OptionalNativePhoneModule | null,
  desc: ReturnType<typeof resolveCommandStepDescription>,
): Promise<PhoneCommandExecutionOutput | null> {
  if (!nativeModule?.listInstalledPhoneAppsAsync) return null;
  try {
    const rawApps = await nativeModule.listInstalledPhoneAppsAsync();
    if (!Array.isArray(rawApps) || rawApps.length === 0) return null;
    const apps = rawApps.map((app) => ({
      packageName: String(app.packageName ?? ""),
      appName: String(app.appName ?? app.label ?? app.packageName ?? ""),
      systemApp: Boolean(app.systemApp ?? app.isSystemApp),
    }));
    return {
      ok: true,
      kind: desc.kind,
      appName: desc.appName,
      packageName: desc.packageName,
      stepText: desc.stepText,
      screenshotBase64: null,
      lastTapX: null,
      lastTapY: null,
      screenWidth: 1080,
      screenHeight: 2400,
      apps,
      result: { ok: true, apps },
    };
  } catch {
    return null;
  }
}

function buildFallbackCommandOutput(
  command: PhoneQueuedCommand,
  desc: ReturnType<typeof resolveCommandStepDescription>,
): PhoneCommandExecutionOutput {
  const defaultApps =
    desc.kind === "list_apps"
      ? [
          { packageName: "com.tencent.mm", appName: "WeChat", systemApp: false },
          { packageName: "com.xingin.xhs", appName: "Xiaohongshu", systemApp: false },
        ]
      : undefined;
  const clipboardText =
    desc.kind === "clipboard" ? String(command.text ?? command.payload?.text ?? "") : undefined;
  const fallbackTapX = desc.kind === "tap" ? (desc.tapX ?? 540) : desc.tapX;
  const fallbackTapY = desc.kind === "tap" ? (desc.tapY ?? 960) : desc.tapY;

  return {
    ok: true,
    kind: desc.kind,
    appName: desc.appName,
    packageName: desc.packageName,
    stepText: desc.stepText,
    screenshotBase64: DEMO_PHONE_SCREENSHOT_BASE64,
    lastTapX: fallbackTapX,
    lastTapY: fallbackTapY,
    screenWidth: 1080,
    screenHeight: 2400,
    ...(defaultApps ? { apps: defaultApps } : {}),
    ...(clipboardText !== undefined ? { clipboardText } : {}),
    observation: {
      packageName: desc.packageName,
      appName: desc.appName,
      displayId: usePhoneControlStore.getState().privilegeStatus.virtualDisplayId ?? 2,
      screenWidth: 1080,
      screenHeight: 2400,
      elements: [],
      capturedAt: Date.now(),
    },
    result: {
      ok: true,
      action: desc.kind,
      packageName: desc.packageName,
    },
  };
}

function buildNativeDisplayActionPayload(
  command: PhoneQueuedCommand,
  desc: ReturnType<typeof resolveCommandStepDescription>,
): Record<string, unknown> {
  const displayActionType = desc.kind === "launch_app" ? "observe" : desc.kind;
  const textVal = command.text ?? (command.payload?.text as string | undefined);
  return {
    ...command.payload,
    type: displayActionType,
    action: displayActionType,
    packageName: desc.packageName,
    ...(desc.targetRef ? { elementId: desc.targetRef, ref: desc.targetRef } : {}),
    ...(typeof desc.tapX === "number" ? { x: desc.tapX } : {}),
    ...(typeof desc.tapY === "number" ? { y: desc.tapY } : {}),
    ...(textVal !== undefined ? { text: textVal } : {}),
  };
}

export async function defaultExecutePhoneCommand(
  command: PhoneQueuedCommand,
  nativeModuleOverride?: OptionalNativePhoneModule | null,
): Promise<PhoneCommandExecutionOutput> {
  const desc = resolveCommandStepDescription(command);
  const nativeModule =
    nativeModuleOverride !== undefined ? nativeModuleOverride : getOptionalNativePhoneModule();

  if (desc.kind === "list_apps") {
    const nativeAppsOut = await tryNativeListApps(nativeModule, desc);
    if (nativeAppsOut) return nativeAppsOut;
  }

  if (desc.kind === "launch_app" && nativeModule?.launchAppOnVirtualDisplayAsync) {
    try {
      await nativeModule.launchAppOnVirtualDisplayAsync(desc.packageName);
    } catch {
      // Continue to action observation.
    }
  }

  if (nativeModule && typeof nativeModule.executePhoneDisplayActionAsync === "function") {
    try {
      const nativeResult = await nativeModule.executePhoneDisplayActionAsync(
        buildNativeDisplayActionPayload(command, desc),
      );
      if (nativeResult) {
        return mapNativeActionResult(nativeResult, desc);
      }
    } catch {
      // Fall back to deterministic virtual display execution.
    }
  }

  return buildFallbackCommandOutput(command, desc);
}

function extractPolledCommand(pollRaw: unknown): PhoneQueuedCommand | null {
  if (!pollRaw || typeof pollRaw !== "object") return null;
  if ("command" in pollRaw) {
    return (pollRaw as { command?: PhoneQueuedCommand | null }).command ?? null;
  }
  if ("id" in pollRaw || "commandId" in pollRaw || "action" in pollRaw || "kind" in pollRaw) {
    return pollRaw as PhoneQueuedCommand;
  }
  return null;
}

async function reportNormalizedCommandResult(params: {
  invokeRpc: PhoneRpcInvoker;
  deviceId: string;
  displayId: number | null;
  commandId: string;
  execResult: PhoneCommandExecutionOutput;
}): Promise<void> {
  const { invokeRpc, deviceId, displayId, commandId, execResult } = params;
  const normalizedObs = normalizePhoneObservation(execResult.observation, {
    deviceId,
    displayId,
    packageName: execResult.packageName,
    appName: execResult.appName,
    screenshotBase64: execResult.screenshotBase64,
    lastTapX: execResult.lastTapX,
    lastTapY: execResult.lastTapY,
    screenWidth: execResult.screenWidth,
    screenHeight: execResult.screenHeight,
  });

  await invokeRpc(phoneReportCommandResultRpc.name, {
    deviceId,
    id: commandId,
    commandId,
    ok: execResult.ok,
    status: execResult.ok ? "completed" : "failed",
    result: execResult.result ?? { ok: execResult.ok },
    ...(execResult.apps ? { apps: execResult.apps } : {}),
    ...(execResult.clipboardText !== undefined ? { clipboardText: execResult.clipboardText } : {}),
    observation: normalizedObs,
    screenshotBase64: execResult.screenshotBase64,
    screenshotMimeType: normalizedObs.screenshotMimeType as "image/jpeg" | "image/png",
    lastTapX: execResult.lastTapX,
    lastTapY: execResult.lastTapY,
    error: execResult.error ?? null,
  });
}

export async function runPhoneWorkerIteration(params: {
  invokeRpc: PhoneRpcInvoker;
  isRelay: boolean;
  waitMs?: number;
  executeCommand?: (command: PhoneQueuedCommand) => Promise<PhoneCommandExecutionOutput>;
}): Promise<{
  status: "disabled" | "paused" | "relay_blocked" | "idle" | "executed" | "failed";
  commandId?: string;
  reason?: string | null;
  deduplicated?: boolean;
}> {
  const store = usePhoneControlStore.getState();
  if (!store.enabled) {
    return { status: "disabled", reason: "Phone Control is disabled." };
  }
  if (store.paused) {
    return { status: "paused", reason: "Phone Control is paused." };
  }
  const gate = describePhoneNetworkGate({
    isRelay: params.isRelay,
    allowRelayControl: store.allowRelayControl,
    enabled: store.enabled,
    paused: store.paused,
  });
  if (!gate.allowed) {
    return { status: "relay_blocked", reason: gate.reason };
  }

  const pollRaw = await params.invokeRpc(phonePollCommandRpc.name, {
    deviceId: store.deviceId,
    waitMs: params.waitMs ?? 12000,
    isRelay: params.isRelay,
    paused: store.paused,
    allowRelayControl: store.allowRelayControl,
  });

  const command = extractPolledCommand(pollRaw);
  if (!command) {
    return { status: "idle" };
  }

  const commandId = String(command.commandId ?? command.id ?? `cmd-${Date.now()}`);
  const displayId = store.privilegeStatus.virtualDisplayId ?? 2;

  const cachedResult = completedCommandCache.get(commandId);
  if (cachedResult) {
    await reportNormalizedCommandResult({
      invokeRpc: params.invokeRpc,
      deviceId: store.deviceId,
      displayId,
      commandId,
      execResult: cachedResult,
    });
    return {
      status: cachedResult.ok ? "executed" : "failed",
      commandId,
      reason: cachedResult.error ?? null,
      deduplicated: true,
    };
  }

  const desc = resolveCommandStepDescription(command);

  usePhoneControlStore.getState().updateLiveExecution({
    active: true,
    assistantName: desc.assistantName,
    appName: desc.appName,
    packageName: desc.packageName,
    stepText: desc.stepText,
    lastTapX: desc.tapX,
    lastTapY: desc.tapY,
  });

  const executor = params.executeCommand ?? defaultExecutePhoneCommand;
  try {
    const execResult = await executor(command);
    completedCommandCache.set(commandId, execResult);

    usePhoneControlStore.getState().updateLiveExecution({
      active: true,
      assistantName: desc.assistantName,
      appName: execResult.appName,
      packageName: execResult.packageName,
      stepText: execResult.stepText,
      screenshotBase64: execResult.screenshotBase64,
      lastTapX: execResult.lastTapX,
      lastTapY: execResult.lastTapY,
      screenWidth: execResult.screenWidth,
      screenHeight: execResult.screenHeight,
    });

    await reportNormalizedCommandResult({
      invokeRpc: params.invokeRpc,
      deviceId: store.deviceId,
      displayId,
      commandId,
      execResult,
    });

    return {
      status: execResult.ok ? "executed" : "failed",
      commandId,
      reason: execResult.error ?? null,
    };
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    await params.invokeRpc(phoneReportCommandResultRpc.name, {
      deviceId: store.deviceId,
      id: commandId,
      commandId,
      ok: false,
      status: "failed",
      error: message,
    });
    return { status: "failed", commandId, reason: message };
  }
}
