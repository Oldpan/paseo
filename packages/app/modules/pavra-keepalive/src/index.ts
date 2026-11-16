export interface InstalledApkInfo {
  versionName: string;
  versionCode: number;
  packageName: string;
  sourceDir: string;
}

export interface ApkDownloadResult {
  filePath: string;
  sha256: string;
  size: number;
}

export interface ApkDownloadProgressEvent {
  received: number;
  total: number | null;
  progress: number | null;
}

export interface ApkDownloadProgressSubscription {
  (): void;
  remove(): void;
}

export interface DownloadAndVerifyApkOptions {
  url: string;
  expectedSha256?: string | null;
  sha256?: string | null;
  expectedSize?: number | null;
  size?: number | null;
}

export interface PavraKeepaliveNativeModule {
  startKeepalive(title: string, body: string): boolean;
  stopKeepalive(): boolean;
  getInstalledApkInfoAsync?(): Promise<InstalledApkInfo>;
  cleanupApkCacheAsync?(): Promise<boolean>;
  canRequestPackageInstallsAsync?(): Promise<boolean>;
  openUnknownAppSourcesSettingsAsync?(): Promise<boolean>;
  downloadAndVerifyApkAsync?(
    url: string,
    expectedSha256?: string | null,
    expectedSize?: number | null,
  ): Promise<ApkDownloadResult>;
  cancelApkDownloadAsync?(): Promise<boolean>;
  installApkSessionAsync?(filePath: string): Promise<boolean>;
  getPhonePrivilegeStatusAsync?(preferredChannel?: string | null): Promise<Record<string, unknown>>;
  requestShizukuPermissionAsync?(): Promise<Record<string, unknown>>;
  startWirelessAdbDiscoveryAsync?(): Promise<Record<string, unknown>>;
  stopWirelessAdbDiscoveryAsync?(): Promise<boolean>;
  openWirelessDebuggingWithPairingNotificationAsync?(
    openSettings?: boolean | null,
  ): Promise<Record<string, unknown>>;
  submitWirelessAdbPairingCodeAsync?(
    pairingInput: string,
    host?: string | null,
    port?: number | null,
  ): Promise<Record<string, unknown>>;
  executePrivilegedShellAsync?(
    command: string,
    channel?: string | null,
    timeoutMs?: number | null,
  ): Promise<Record<string, unknown>>;
  ensurePhoneVirtualDisplayAsync?(
    width?: number | null,
    height?: number | null,
    dpi?: number | null,
  ): Promise<Record<string, unknown>>;
  releasePhoneVirtualDisplayAsync?(): Promise<boolean>;
  capturePhoneFrameAsync?(
    maxLongEdge?: number | null,
    quality?: number | null,
  ): Promise<Record<string, unknown>>;
  launchAppOnVirtualDisplayAsync?(packageName: string): Promise<boolean>;
  moveAppToMainScreenForTakeoverAsync?(packageName: string): Promise<boolean>;
  returnAppToVirtualDisplayAsync?(packageName: string): Promise<boolean>;
  executePhoneDisplayActionAsync?(
    action: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  listInstalledPhoneAppsAsync?(): Promise<Array<Record<string, unknown>>>;
  canDrawPhoneOverlaysAsync?(): Promise<boolean>;
  openPhoneOverlayPermissionSettingsAsync?(): Promise<boolean>;
  showPhoneFloatingOverlayAsync?(state: Record<string, unknown>): Promise<Record<string, unknown>>;
  updatePhoneFloatingOverlayAsync?(
    state: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  setPhoneFloatingOverlayModeAsync?(mode: string): Promise<Record<string, unknown>>;
  hidePhoneFloatingOverlayAsync?(): Promise<boolean>;
  setPhoneExecutionPausedAsync?(paused: boolean): Promise<Record<string, unknown>>;
  clearPhoneEmergencyStopAsync?(): Promise<boolean>;
  triggerPhoneEmergencyStopAsync?(): Promise<Record<string, unknown>>;
  addListener?(
    eventName: string,
    listener: (event: Record<string, unknown>) => void,
  ): { remove(): void };
}

interface ExpoModulesCore {
  requireOptionalNativeModule<T>(name: string): T | null;
}

let cachedModule: PavraKeepaliveNativeModule | null | undefined;

export function getNativeKeepaliveModule(): PavraKeepaliveNativeModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  try {
    // Lazy-loaded so Node/Vitest unit tests do not evaluate expo-modules-core's __DEV__ globals at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("expo-modules-core") as ExpoModulesCore;
    cachedModule = core.requireOptionalNativeModule<PavraKeepaliveNativeModule>("PavraKeepalive");
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

function createSubscription(cleanup: () => void): ApkDownloadProgressSubscription {
  const callable = () => {
    cleanup();
  };
  callable.remove = cleanup;
  return callable;
}

export function startKeepalive(title: string, body: string): boolean {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule) return false;
  try {
    return Boolean(nativeModule.startKeepalive(title, body));
  } catch {
    return false;
  }
}

export function stopKeepalive(): boolean {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule) return false;
  try {
    return Boolean(nativeModule.stopKeepalive());
  } catch {
    return false;
  }
}

export async function getInstalledApkInfoAsync(): Promise<InstalledApkInfo | null> {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.getInstalledApkInfoAsync !== "function") {
    return null;
  }
  try {
    return await nativeModule.getInstalledApkInfoAsync();
  } catch {
    return null;
  }
}

export async function cleanupApkCacheAsync(): Promise<boolean> {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.cleanupApkCacheAsync !== "function") {
    return false;
  }
  try {
    return Boolean(await nativeModule.cleanupApkCacheAsync());
  } catch {
    return false;
  }
}

export async function canRequestPackageInstallsAsync(): Promise<boolean> {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.canRequestPackageInstallsAsync !== "function") {
    return false;
  }
  try {
    return Boolean(await nativeModule.canRequestPackageInstallsAsync());
  } catch {
    return false;
  }
}

export async function openUnknownAppSourcesSettingsAsync(): Promise<boolean> {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.openUnknownAppSourcesSettingsAsync !== "function") {
    return false;
  }
  try {
    return Boolean(await nativeModule.openUnknownAppSourcesSettingsAsync());
  } catch {
    return false;
  }
}

export async function downloadAndVerifyApkAsync(
  urlOrOptions: string | DownloadAndVerifyApkOptions,
  expectedSha256?: string | null,
  expectedSize?: number | null,
): Promise<ApkDownloadResult> {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.downloadAndVerifyApkAsync !== "function") {
    throw new Error("ERR_UNAVAILABLE: Native APK downloader is not available on this platform");
  }

  let url: string;
  let resolvedSha256: string | null = null;
  let resolvedSize: number | null = null;

  if (typeof urlOrOptions === "string") {
    url = urlOrOptions;
    resolvedSha256 = expectedSha256 ?? null;
    resolvedSize =
      typeof expectedSize === "number" && Number.isFinite(expectedSize) && expectedSize > 0
        ? expectedSize
        : null;
  } else {
    url = urlOrOptions.url;
    resolvedSha256 = urlOrOptions.expectedSha256 ?? urlOrOptions.sha256 ?? null;
    const rawSize = urlOrOptions.expectedSize ?? urlOrOptions.size ?? null;
    resolvedSize =
      typeof rawSize === "number" && Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null;
  }

  return await nativeModule.downloadAndVerifyApkAsync(url, resolvedSha256, resolvedSize);
}

export async function cancelApkDownloadAsync(): Promise<boolean> {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.cancelApkDownloadAsync !== "function") {
    return false;
  }
  try {
    return Boolean(await nativeModule.cancelApkDownloadAsync());
  } catch {
    return false;
  }
}

export async function installApkSessionAsync(
  filePathOrOptions: string | { filePath: string },
): Promise<boolean> {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.installApkSessionAsync !== "function") {
    throw new Error("ERR_UNAVAILABLE: Native APK installer is not available on this platform");
  }
  const filePath =
    typeof filePathOrOptions === "string" ? filePathOrOptions : filePathOrOptions.filePath;
  return Boolean(await nativeModule.installApkSessionAsync(filePath));
}

export function addApkDownloadProgressListener(
  listener: (event: ApkDownloadProgressEvent) => void,
): ApkDownloadProgressSubscription {
  const nativeModule = getNativeKeepaliveModule();
  if (!nativeModule || typeof nativeModule.addListener !== "function") {
    return createSubscription(() => {});
  }
  try {
    const subscription = nativeModule.addListener("onApkDownloadProgress", (raw) => {
      const received =
        typeof raw?.received === "number" && Number.isFinite(raw.received) ? raw.received : 0;
      const total =
        typeof raw?.total === "number" && Number.isFinite(raw.total) && raw.total > 0
          ? raw.total
          : null;
      let progress: number | null = null;
      if (typeof raw?.progress === "number" && Number.isFinite(raw.progress)) {
        progress = Math.max(0, Math.min(1, raw.progress));
      } else if (total !== null) {
        progress = Math.max(0, Math.min(1, received / total));
      }
      listener({ received, total, progress });
    });
    return createSubscription(() => {
      try {
        subscription.remove();
      } catch {
        // Ignore listener removal errors.
      }
    });
  } catch {
    return createSubscription(() => {});
  }
}
