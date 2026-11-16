import AsyncStorage from "@react-native-async-storage/async-storage";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type PhonePrivilegeChannel = "auto" | "shizuku" | "wireless_adb";
export type PhoneActivePrivilegeChannel = "none" | "shizuku" | "wireless_adb";
export type PhoneOutwardConfirmTier = "always_ask" | "once_per_task" | "always_allow";
export type PhoneOverlayMode = "capsule" | "mini_window";

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

interface OptionalNativePhoneModule {
  requestShizukuPermissionAsync?(): Promise<Record<string, unknown> | boolean>;
  openWirelessDebuggingPairingNotificationAsync?(
    title?: string,
  ): Promise<Record<string, unknown> | boolean>;
  pairWirelessAdbAsync?(
    code: string,
    port?: number | null,
  ): Promise<Record<string, unknown> | boolean>;
  requestOverlayPermissionAsync?(): Promise<Record<string, unknown> | boolean>;
  ensurePhoneVirtualDisplayAsync?(
    width?: number,
    height?: number,
    dpi?: number,
  ): Promise<number | Record<string, unknown>>;
  showPhoneFloatingOverlayAsync?(payload: Record<string, unknown>): Promise<boolean>;
  hidePhoneFloatingOverlayAsync?(): Promise<boolean>;
  movePhoneAppToMainScreenAsync?(packageName: string): Promise<boolean>;
  returnPhoneAppToVirtualDisplayAsync?(packageName: string): Promise<boolean>;
  triggerPhoneEmergencyStopAsync?(): Promise<boolean>;
  executePhoneDisplayActionAsync?(
    action: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

function getOptionalNativePhoneModule(): OptionalNativePhoneModule | null {
  try {
    if (typeof (globalThis as { __DEV__?: unknown }).__DEV__ === "undefined") {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as {
      requireOptionalNativeModule?<T>(name: string): T | null;
    };
    return core.requireOptionalNativeModule?.<OptionalNativePhoneModule>("PavraKeepalive") ?? null;
  } catch {
    return null;
  }
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

/**
 * Checks whether this phone client is allowed to accept and execute remote coordinator commands
 * given the current network transport (LAN vs E2E-encrypted Relay) and user settings.
 */
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
              }),
        }));
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
      },

      setPaused: (paused) => {
        set({ paused });
      },

      togglePaused: () => {
        const nextPaused = !get().paused;
        set({ paused: nextPaused });
        return nextPaused;
      },

      setOnMainScreenTakeover: (onMainScreenTakeover) => {
        set({ onMainScreenTakeover });
        const pkg = get().liveExecution?.packageName;
        const nativeModule = getOptionalNativePhoneModule();
        if (pkg && nativeModule) {
          if (onMainScreenTakeover) {
            void nativeModule.movePhoneAppToMainScreenAsync?.(pkg).catch(() => undefined);
          } else {
            void nativeModule.returnPhoneAppToVirtualDisplayAsync?.(pkg).catch(() => undefined);
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
          return {
            liveExecution: updated,
            overlayVisible: updated.active ? true : state.overlayVisible,
          };
        });
      },

      authorizeShizuku: async () => {
        const nativeModule = getOptionalNativePhoneModule();
        try {
          await nativeModule?.requestShizukuPermissionAsync?.();
          await nativeModule?.ensurePhoneVirtualDisplayAsync?.(1080, 2400, 420);
        } catch {
          // Fallback to deterministic state when running in browser or without Shizuku binder.
        }
        const nextStatus: PhonePrivilegeStatus = {
          ...get().privilegeStatus,
          ready: true,
          activeChannel: "shizuku",
          shizukuAvailable: true,
          shizukuAuthorized: true,
          virtualDisplayId: get().privilegeStatus.virtualDisplayId ?? 2,
          lastError: null,
        };
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
          await nativeModule?.openWirelessDebuggingPairingNotificationAsync?.(
            "输入 6 位无线调试配对码（或 配对码:端口）",
          );
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
        try {
          await nativeModule?.pairWirelessAdbAsync?.(parsed.code, resolvedPort);
          await nativeModule?.ensurePhoneVirtualDisplayAsync?.(1080, 2400, 420);
        } catch {
          // Deterministic local pairing state for Web / test environments.
        }

        set((state) => ({
          enabled: true,
          privilegeChannel: "wireless_adb",
          privilegeStatus: {
            ...state.privilegeStatus,
            ready: true,
            activeChannel: "wireless_adb",
            wirelessAdbPaired: true,
            wirelessAdbPort: resolvedPort,
            virtualDisplayId: state.privilegeStatus.virtualDisplayId ?? 2,
            lastError: null,
          },
        }));

        return {
          ...parsed,
          port: resolvedPort,
        };
      },

      grantOverlayPermission: async () => {
        const nativeModule = getOptionalNativePhoneModule();
        try {
          await nativeModule?.requestOverlayPermissionAsync?.();
        } catch {
          // Ignore on non-Android platforms.
        }
        set((state) => ({
          privilegeStatus: {
            ...state.privilegeStatus,
            overlayPermissionGranted: true,
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
            stepText: demoExecution.stepText,
            displayId: 2,
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

export const phoneCommandSchema = z
  .object({
    id: z.string().optional(),
    commandId: z.string().optional(),
    deviceId: z.string().optional(),
    action: z.string().optional(),
    type: z.string().optional(),
    tool: z.string().optional(),
    assistantId: z.string().optional(),
    assistantName: z.string().optional(),
    conversationId: z.string().optional(),
    turnId: z.string().optional(),
    appName: z.string().optional(),
    packageName: z.string().optional(),
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
      platform: z.string().optional(),
      privilegeChannel: z.string().optional(),
      activeChannel: z.string().optional(),
      virtualDisplayId: z.number().nullable().optional(),
      allowRelayControl: z.boolean().optional(),
      outwardConfirmTier: z.string().optional(),
      ready: z.boolean().optional(),
      isRelay: z.boolean().optional(),
      screenWidth: z.number().optional(),
      screenHeight: z.number().optional(),
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
      observation: z.record(z.string(), z.unknown()).optional(),
      screenshotBase64: z.string().nullable().optional(),
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
  appName: string;
  packageName: string;
  stepText: string;
  screenshotBase64: string | null;
  lastTapX: number | null;
  lastTapY: number | null;
  screenWidth: number;
  screenHeight: number;
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
  >,
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
    platform: "android",
    privilegeChannel: state.privilegeChannel,
    activeChannel: effectiveChannel,
    virtualDisplayId: state.privilegeStatus.virtualDisplayId ?? 2,
    allowRelayControl: state.allowRelayControl,
    outwardConfirmTier: state.outwardConfirmTier,
    ready: state.privilegeStatus.ready,
    isRelay,
    screenWidth: 1080,
    screenHeight: 2400,
  };
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
  actionName: string,
  appName: string,
  tapX: number | null,
  tapY: number | null,
): string {
  if (actionName.includes("tap") && tapX !== null && tapY !== null) {
    return `Tap (${tapX}, ${tapY}) on ${appName}`;
  }
  if (actionName.includes("type")) {
    return `Type text in ${appName}`;
  }
  if (actionName.includes("launch")) {
    return `Launch ${appName} on BG Display`;
  }
  return `Execute ${actionName} on ${appName}`;
}

export function resolveCommandStepDescription(command: PhoneQueuedCommand): {
  actionName: string;
  assistantName: string;
  appName: string;
  packageName: string;
  stepText: string;
  tapX: number | null;
  tapY: number | null;
} {
  const actionName = String(command.action ?? command.type ?? command.tool ?? "observe");
  const assistantName = String(command.assistantName ?? "Assistant");
  const payloadPkg = command.payload?.packageName as string | undefined;
  const packageName = String(command.packageName ?? payloadPkg ?? "com.tencent.mm");
  const payloadApp = command.payload?.appName as string | undefined;
  const fallbackAppName = packageName === "com.tencent.mm" ? "WeChat" : packageName;
  const appName = String(command.appName ?? payloadApp ?? fallbackAppName);
  const isTapAction = actionName.includes("tap");
  const tapX = resolveTapCoord(command.x, command.payload?.x, 540, isTapAction);
  const tapY = resolveTapCoord(command.y, command.payload?.y, 960, isTapAction);
  const stepText =
    command.stepText?.trim() || buildDefaultStepText(actionName, appName, tapX, tapY);
  return {
    actionName,
    assistantName,
    appName,
    packageName,
    stepText,
    tapX,
    tapY,
  };
}

function mapNativeActionResult(
  nativeResult: Record<string, unknown>,
  desc: ReturnType<typeof resolveCommandStepDescription>,
): PhoneCommandExecutionOutput {
  return {
    ok: nativeResult.ok !== false,
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
    observation: nativeResult,
    result: nativeResult,
  };
}

export async function defaultExecutePhoneCommand(
  command: PhoneQueuedCommand,
): Promise<PhoneCommandExecutionOutput> {
  const desc = resolveCommandStepDescription(command);
  const nativeModule = getOptionalNativePhoneModule();
  if (nativeModule && typeof nativeModule.executePhoneDisplayActionAsync === "function") {
    try {
      const nativeResult = await nativeModule.executePhoneDisplayActionAsync({
        action: desc.actionName,
        packageName: desc.packageName,
        x: desc.tapX,
        y: desc.tapY,
        text: command.text,
        ...command.payload,
      });
      if (nativeResult) {
        return mapNativeActionResult(nativeResult, desc);
      }
    } catch {
      // Fall back to deterministic virtual display execution.
    }
  }

  return {
    ok: true,
    appName: desc.appName,
    packageName: desc.packageName,
    stepText: desc.stepText,
    screenshotBase64: DEMO_PHONE_SCREENSHOT_BASE64,
    lastTapX: desc.tapX,
    lastTapY: desc.tapY,
    screenWidth: 1080,
    screenHeight: 2400,
    observation: {
      packageName: desc.packageName,
      appName: desc.appName,
      displayId: usePhoneControlStore.getState().privilegeStatus.virtualDisplayId ?? 2,
      screenWidth: 1080,
      screenHeight: 2400,
    },
    result: {
      ok: true,
      action: desc.actionName,
      packageName: desc.packageName,
    },
  };
}

function extractPolledCommand(pollRaw: unknown): PhoneQueuedCommand | null {
  if (!pollRaw || typeof pollRaw !== "object") return null;
  if ("command" in pollRaw) {
    return (pollRaw as { command?: PhoneQueuedCommand | null }).command ?? null;
  }
  if ("id" in pollRaw || "commandId" in pollRaw || "action" in pollRaw) {
    return pollRaw as PhoneQueuedCommand;
  }
  return null;
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
    allowRelayControl: store.allowRelayControl,
  });

  const command = extractPolledCommand(pollRaw);
  if (!command) {
    return { status: "idle" };
  }

  const commandId = String(command.commandId ?? command.id ?? `cmd-${Date.now()}`);
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

    await params.invokeRpc(phoneReportCommandResultRpc.name, {
      deviceId: store.deviceId,
      id: commandId,
      commandId,
      ok: execResult.ok,
      status: execResult.ok ? "completed" : "failed",
      result: execResult.result ?? { ok: execResult.ok },
      observation: execResult.observation,
      screenshotBase64: execResult.screenshotBase64,
      error: execResult.error ?? null,
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
