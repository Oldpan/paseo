import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useCallback, useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";
import { create } from "zustand";
import * as PavraKeepalive from "../../modules/pavra-keepalive";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { resolveAppVersion } from "@/utils/app-version";
import {
  buildCandidateApkDownloadUrls,
  fetchLatestPavraApkRelease,
  isAutoUpdateCheckDue,
  isReleaseNewerThanInstalled,
  resolveCoordinatorHttpOriginFromHosts,
  type InstalledPavraBuildInfo,
  type PavraApkReleaseInfo,
  type PavraUpdateSource,
} from "./apk-updates";
import { usePavraView } from "./store";

export const PAVRA_APK_UPDATER_PREFS_KEY = "pavra.apkUpdater.prefs.v1";

export type ApkUpdateCheckPhase = "idle" | "checking" | "upToDate" | "available" | "unavailable";

export type ApkUpdateTaskPhase =
  | "idle"
  | "downloading"
  | "verifying"
  | "ready"
  | "needsPermission"
  | "installing"
  | "failed";

export interface ApkDownloadProgressEvent {
  received: number;
  total: number;
  progress: number;
}

export interface ApkDownloadResult {
  filePath: string;
  sha256?: string;
  size?: number;
}

interface PavraKeepaliveInstallerBridge {
  downloadAndVerifyApkAsync?: (
    url: string,
    expectedSha256?: string | null,
    expectedSize?: number | null,
  ) => Promise<ApkDownloadResult | null>;
  cancelApkDownloadAsync?: () => Promise<boolean | void>;
  canRequestPackageInstallsAsync?: () => Promise<boolean>;
  openUnknownAppSourcesSettingsAsync?: () => Promise<boolean>;
  installApkSessionAsync?: (filePath: string) => Promise<boolean | void>;
  cleanupApkCacheAsync?: () => Promise<boolean | void>;
  addApkDownloadProgressListener?: (
    listener: (event: ApkDownloadProgressEvent) => void,
  ) => { remove(): void } | (() => void) | null;
}

function getKeepaliveInstallerBridge(): PavraKeepaliveInstallerBridge {
  return PavraKeepalive as unknown as Record<string, unknown> as PavraKeepaliveInstallerBridge;
}

export interface PersistedPavraApkUpdaterPrefs {
  autoCheck: boolean;
  skippedVersion: string | null;
  lastCheckedAtMs: number | null;
  lastAttemptAtMs: number | null;
  lastWorkingSource: string | null;
  availableRelease: PavraApkReleaseInfo | null;
}

export function getInstalledPavraBuildInfo(): InstalledPavraBuildInfo {
  const version = resolveAppVersion() ?? "0.0.0";
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    diagnosticRevision?: unknown;
    diagnosticBuildTime?: unknown;
  };
  const rawRevision =
    typeof extra.diagnosticRevision === "string" ? extra.diagnosticRevision.trim() : "";
  const cleanRevision = rawRevision ? rawRevision.replace(/-dirty$/, "") : null;
  const buildTime =
    typeof extra.diagnosticBuildTime === "string" && extra.diagnosticBuildTime.trim().length > 0
      ? extra.diagnosticBuildTime.trim()
      : null;
  return {
    version,
    revision: cleanRevision,
    buildTime,
  };
}

export async function openApkReleaseDownload(release: PavraApkReleaseInfo): Promise<void> {
  const targetUrl = release.apkDownloadUrl || release.htmlUrl;
  await Linking.openURL(targetUrl);
}

export function isAndroidApkUpdateSupported(): boolean {
  return Platform.OS === "android";
}

function resolveCurrentCoordinatorHttpOrigin(): string | null {
  try {
    const hosts = getHostRuntimeStore().getHosts();
    const coordinatorId = usePavraView.getState().coordinatorId;
    return resolveCoordinatorHttpOriginFromHosts(hosts, coordinatorId);
  } catch {
    return null;
  }
}

export interface PavraApkUpdaterState {
  installed: InstalledPavraBuildInfo;
  availableRelease: PavraApkReleaseInfo | null;
  autoCheck: boolean;
  skippedVersion: string | null;
  lastCheckedAtMs: number | null;
  lastAttemptAtMs: number | null;
  lastWorkingSource: string | null;
  checkPhase: ApkUpdateCheckPhase;
  taskPhase: ApkUpdateTaskPhase;
  progress: number | null;
  receivedBytes: number;
  totalBytes: number | null;
  downloadedFilePath: string | null;
  sheetOpen: boolean;
  checking: boolean;
  statusMessage: string | null;
  hydrated: boolean;
  setChecking(checking: boolean): void;
  setResult(release: PavraApkReleaseInfo | null, statusMessage: string | null): void;
  setAutoCheck(enabled: boolean): void;
  skipVersion(version?: string | null): void;
  openUpdateSheet(): void;
  closeUpdateSheet(): void;
  patchState(partial: Partial<PavraApkUpdaterState>): void;
}

async function persistUpdaterPrefs(state: PavraApkUpdaterState): Promise<void> {
  try {
    const prefs: PersistedPavraApkUpdaterPrefs = {
      autoCheck: state.autoCheck,
      skippedVersion: state.skippedVersion,
      lastCheckedAtMs: state.lastCheckedAtMs,
      lastAttemptAtMs: state.lastAttemptAtMs,
      lastWorkingSource: state.lastWorkingSource,
      availableRelease: state.availableRelease,
    };
    await AsyncStorage.setItem(PAVRA_APK_UPDATER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage write errors in non-persistent environments.
  }
}

export const usePavraApkUpdaterStore = create<PavraApkUpdaterState>((set, get) => ({
  installed: getInstalledPavraBuildInfo(),
  availableRelease: null,
  autoCheck: true,
  skippedVersion: null,
  lastCheckedAtMs: null,
  lastAttemptAtMs: null,
  lastWorkingSource: null,
  checkPhase: "idle",
  taskPhase: "idle",
  progress: null,
  receivedBytes: 0,
  totalBytes: null,
  downloadedFilePath: null,
  sheetOpen: false,
  checking: false,
  statusMessage: null,
  hydrated: false,
  setChecking: (checking) =>
    set((state) => ({
      checking,
      checkPhase: checking ? "checking" : state.checkPhase,
    })),
  setResult: (availableRelease, statusMessage) =>
    set({
      availableRelease,
      statusMessage,
      checking: false,
      checkPhase: availableRelease ? "available" : "upToDate",
    }),
  setAutoCheck: (enabled) => {
    set({ autoCheck: Boolean(enabled) });
    void persistUpdaterPrefs(get());
  },
  skipVersion: (version) => {
    const targetVersion =
      version !== undefined ? version : (get().availableRelease?.version ?? null);
    set({
      skippedVersion: targetVersion,
      sheetOpen: false,
    });
    void persistUpdaterPrefs(get());
  },
  openUpdateSheet: () => set({ sheetOpen: true }),
  closeUpdateSheet: () => set({ sheetOpen: false }),
  patchState: (partial) => set(partial),
}));

let hydrationPromise: Promise<void> | null = null;

function applyHydratedPrefs(parsed: Partial<PersistedPavraApkUpdaterPrefs>): void {
  const current = usePavraApkUpdaterStore.getState();
  const cachedRelease =
    parsed.availableRelease &&
    typeof parsed.availableRelease === "object" &&
    typeof parsed.availableRelease.version === "string" &&
    isReleaseNewerThanInstalled(parsed.availableRelease, current.installed)
      ? parsed.availableRelease
      : null;

  current.patchState({
    autoCheck: typeof parsed.autoCheck === "boolean" ? parsed.autoCheck : true,
    skippedVersion:
      typeof parsed.skippedVersion === "string" && parsed.skippedVersion.trim().length > 0
        ? parsed.skippedVersion.trim()
        : null,
    lastCheckedAtMs:
      typeof parsed.lastCheckedAtMs === "number" && Number.isFinite(parsed.lastCheckedAtMs)
        ? parsed.lastCheckedAtMs
        : null,
    lastAttemptAtMs:
      typeof parsed.lastAttemptAtMs === "number" && Number.isFinite(parsed.lastAttemptAtMs)
        ? parsed.lastAttemptAtMs
        : null,
    lastWorkingSource:
      typeof parsed.lastWorkingSource === "string" && parsed.lastWorkingSource.trim().length > 0
        ? parsed.lastWorkingSource.trim()
        : null,
    availableRelease: cachedRelease,
    checkPhase: cachedRelease ? "available" : current.checkPhase,
    hydrated: true,
  });
}

export async function hydratePavraApkUpdaterPrefs(): Promise<void> {
  if (usePavraApkUpdaterStore.getState().hydrated) return;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(PAVRA_APK_UPDATER_PREFS_KEY);
      if (!raw) {
        usePavraApkUpdaterStore.getState().patchState({ hydrated: true });
        return;
      }
      applyHydratedPrefs(JSON.parse(raw) as Partial<PersistedPavraApkUpdaterPrefs>);
    } catch {
      usePavraApkUpdaterStore.getState().patchState({ hydrated: true });
    } finally {
      hydrationPromise = null;
    }
  })();

  return hydrationPromise;
}

let activeDownloadCancelled = false;

function applyCheckedReleaseToStore(input: {
  latest: PavraApkReleaseInfo | null;
  checkedTimeMs: number;
  workingSource: string | null;
  manual: boolean;
  onNotice?: (message: string) => void;
}): void {
  const store = usePavraApkUpdaterStore.getState();
  const { latest, checkedTimeMs, workingSource, manual, onNotice } = input;

  if (!latest) {
    const msg = "No APK release found on GitHub yet.";
    store.patchState({
      availableRelease: null,
      checking: false,
      checkPhase: "unavailable",
      statusMessage: msg,
      lastCheckedAtMs: checkedTimeMs,
      lastAttemptAtMs: checkedTimeMs,
      lastWorkingSource: workingSource,
    });
    void persistUpdaterPrefs(usePavraApkUpdaterStore.getState());
    if (manual) onNotice?.(msg);
    return;
  }

  if (!isReleaseNewerThanInstalled(latest, store.installed)) {
    const revSuffix = store.installed.revision ? ` · ${store.installed.revision}` : "";
    const currentLabel = `${store.installed.version}${revSuffix}`;
    const msg = `Up to date (${currentLabel})`;
    store.patchState({
      availableRelease: null,
      checking: false,
      checkPhase: "upToDate",
      statusMessage: msg,
      lastCheckedAtMs: checkedTimeMs,
      lastAttemptAtMs: checkedTimeMs,
      lastWorkingSource: workingSource,
    });
    void persistUpdaterPrefs(usePavraApkUpdaterStore.getState());
    if (manual) onNotice?.(`Already on the latest Pavra build (${currentLabel}).`);
    return;
  }

  const revSuffix = latest.revision ? ` · ${latest.revision}` : "";
  const msg = `New APK available: v${latest.version}${revSuffix}`;
  const shouldResetTask =
    store.availableRelease?.version !== latest.version &&
    store.taskPhase !== "downloading" &&
    store.taskPhase !== "verifying";

  store.patchState({
    availableRelease: latest,
    checking: false,
    checkPhase: "available",
    statusMessage: msg,
    lastCheckedAtMs: checkedTimeMs,
    lastAttemptAtMs: checkedTimeMs,
    lastWorkingSource: workingSource,
    ...(shouldResetTask
      ? {
          taskPhase: "idle",
          progress: null,
          receivedBytes: 0,
          totalBytes: latest.apkSizeBytes,
          downloadedFilePath: null,
        }
      : {}),
    ...(manual ? { sheetOpen: true } : {}),
  });
  void persistUpdaterPrefs(usePavraApkUpdaterStore.getState());
  if (manual) onNotice?.(msg);
}

export async function checkForPavraApkUpdateAction(options?: {
  manual?: boolean;
  coordinatorHttpOrigin?: string | null;
  onNotice?: (message: string) => void;
}): Promise<void> {
  const manual = Boolean(options?.manual);
  if (!isAndroidApkUpdateSupported() && !manual) return;

  await hydratePavraApkUpdaterPrefs();
  const store = usePavraApkUpdaterStore.getState();
  if (store.checking || store.checkPhase === "checking") return;

  store.patchState({
    checking: true,
    checkPhase: "checking",
    lastAttemptAtMs: Date.now(),
  });

  const coordinatorHttpOrigin =
    options?.coordinatorHttpOrigin !== undefined
      ? options.coordinatorHttpOrigin
      : resolveCurrentCoordinatorHttpOrigin();

  let workingSource: PavraUpdateSource | string | null = store.lastWorkingSource;

  try {
    const latest = await fetchLatestPavraApkRelease({
      coordinatorHttpOrigin,
      lastWorkingSource: store.lastWorkingSource,
      onSourceSuccess: (source) => {
        workingSource = source;
      },
    });
    applyCheckedReleaseToStore({
      latest,
      checkedTimeMs: Date.now(),
      workingSource,
      manual,
      onNotice: options?.onNotice,
    });
  } catch (failure) {
    const msg = failure instanceof Error ? failure.message : "Failed to check APK releases.";
    const currentRelease = usePavraApkUpdaterStore.getState().availableRelease;
    store.patchState({
      checking: false,
      checkPhase: currentRelease ? "available" : "unavailable",
      statusMessage: msg,
      lastAttemptAtMs: Date.now(),
    });
    void persistUpdaterPrefs(usePavraApkUpdaterStore.getState());
    if (manual) options?.onNotice?.(msg);
  }
}

async function handleMissingInstallPermission(
  bridge: PavraKeepaliveInstallerBridge,
  requestSettingsIfMissing: boolean,
): Promise<void> {
  usePavraApkUpdaterStore.getState().patchState({
    taskPhase: "needsPermission",
    statusMessage: "Allow installing unknown apps for Pavra to finish the update.",
  });
  if (requestSettingsIfMissing && typeof bridge.openUnknownAppSourcesSettingsAsync === "function") {
    await bridge.openUnknownAppSourcesSettingsAsync();
  }
}

export async function installReadyPavraApkAction(options?: {
  requestSettingsIfMissing?: boolean;
}): Promise<void> {
  const state = usePavraApkUpdaterStore.getState();
  const filePath = state.downloadedFilePath;
  const release = state.availableRelease;
  const bridge = getKeepaliveInstallerBridge();
  const requestSettings = Boolean(options?.requestSettingsIfMissing);

  if (!filePath || typeof bridge.installApkSessionAsync !== "function") {
    if (release) {
      await openApkReleaseDownload(release);
    }
    return;
  }

  try {
    if (typeof bridge.canRequestPackageInstallsAsync === "function") {
      const canInstall = await bridge.canRequestPackageInstallsAsync();
      if (!canInstall) {
        await handleMissingInstallPermission(bridge, requestSettings);
        return;
      }
    }

    state.patchState({
      taskPhase: "installing",
      statusMessage: "Launching Android package installer…",
    });
    await bridge.installApkSessionAsync(filePath);
    state.patchState({
      taskPhase: "ready",
      statusMessage: "Confirm the installation prompt to complete the update.",
    });
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (message.includes("ERR_NEEDS_INSTALL_PERMISSION")) {
      await handleMissingInstallPermission(bridge, requestSettings);
      return;
    }
    state.patchState({
      taskPhase: "failed",
      statusMessage: message || "Failed to launch APK installer.",
    });
  }
}

function computeProgressRatio(
  event: ApkDownloadProgressEvent | undefined,
  received: number,
  total: number | null,
): number | null {
  if (typeof event?.progress === "number" && Number.isFinite(event.progress)) {
    return Math.max(0, Math.min(1, event.progress));
  }
  if (total && total > 0) {
    return Math.max(0, Math.min(1, received / total));
  }
  return null;
}

function attachDownloadProgressListener(
  bridge: PavraKeepaliveInstallerBridge,
  fallbackSizeBytes: number | null,
): (() => void) | null {
  if (typeof bridge.addApkDownloadProgressListener !== "function") return null;
  try {
    const sub = bridge.addApkDownloadProgressListener((event) => {
      if (activeDownloadCancelled) return;
      const received =
        typeof event?.received === "number" && Number.isFinite(event.received) ? event.received : 0;
      const total =
        typeof event?.total === "number" && Number.isFinite(event.total) && event.total > 0
          ? event.total
          : fallbackSizeBytes;
      const ratio = computeProgressRatio(event, received, total);
      const nextPhase: ApkUpdateTaskPhase =
        ratio !== null && ratio >= 0.999 ? "verifying" : "downloading";
      usePavraApkUpdaterStore.getState().patchState({
        taskPhase: nextPhase,
        receivedBytes: received,
        totalBytes: total,
        progress: ratio,
      });
    });
    if (typeof sub === "function") return sub;
    if (sub && typeof sub.remove === "function") return () => sub.remove();
    return null;
  } catch {
    return null;
  }
}

function markDownloadCancelled(): void {
  usePavraApkUpdaterStore.getState().patchState({
    taskPhase: "idle",
    progress: null,
    statusMessage: "Download cancelled.",
  });
}

function applyDownloadedResult(release: PavraApkReleaseInfo, result: ApkDownloadResult): void {
  const actualSize =
    typeof result.size === "number" && result.size > 0 ? result.size : release.apkSizeBytes;
  usePavraApkUpdaterStore.getState().patchState({
    taskPhase: "ready",
    progress: 1,
    downloadedFilePath: result.filePath,
    receivedBytes: actualSize ?? usePavraApkUpdaterStore.getState().receivedBytes,
    totalBytes: actualSize,
    statusMessage: `Pavra v${release.version} is ready to install.`,
  });
}

function isDownloadCancelledError(msg: string): boolean {
  return activeDownloadCancelled || /cancel/i.test(msg) || msg.includes("ERR_DOWNLOAD_CANCELLED");
}

async function runCandidateDownloadLoop(
  bridge: PavraKeepaliveInstallerBridge,
  release: PavraApkReleaseInfo,
  urlsToTry: readonly string[],
): Promise<void> {
  if (typeof bridge.downloadAndVerifyApkAsync !== "function") return;
  let lastErrorMessage = "Failed to download APK update.";

  for (const candidateUrl of urlsToTry) {
    if (activeDownloadCancelled) {
      markDownloadCancelled();
      return;
    }

    try {
      const result = await bridge.downloadAndVerifyApkAsync(
        candidateUrl,
        release.sha256,
        release.apkSizeBytes,
      );
      if (activeDownloadCancelled) {
        markDownloadCancelled();
        return;
      }
      if (!result || typeof result.filePath !== "string" || result.filePath.length === 0) {
        usePavraApkUpdaterStore.getState().patchState({ taskPhase: "idle", progress: null });
        await openApkReleaseDownload(release);
        return;
      }
      applyDownloadedResult(release, result);
      await installReadyPavraApkAction({ requestSettingsIfMissing: false });
      return;
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : String(failure);
      if (isDownloadCancelledError(msg)) {
        markDownloadCancelled();
        return;
      }
      lastErrorMessage = msg || lastErrorMessage;
    }
  }

  usePavraApkUpdaterStore.getState().patchState({
    taskPhase: "failed",
    progress: null,
    statusMessage: lastErrorMessage,
  });
}

export async function startPavraApkDownloadAndInstallAction(): Promise<void> {
  const state = usePavraApkUpdaterStore.getState();
  const release = state.availableRelease;
  if (!release || state.taskPhase === "downloading" || state.taskPhase === "verifying") {
    return;
  }

  if (state.skippedVersion === release.version) {
    state.patchState({ skippedVersion: null });
    void persistUpdaterPrefs(usePavraApkUpdaterStore.getState());
  }

  const bridge = getKeepaliveInstallerBridge();
  if (!isAndroidApkUpdateSupported() || typeof bridge.downloadAndVerifyApkAsync !== "function") {
    await openApkReleaseDownload(release);
    return;
  }

  activeDownloadCancelled = false;
  state.patchState({
    taskPhase: "downloading",
    progress: 0,
    receivedBytes: 0,
    totalBytes: release.apkSizeBytes,
    statusMessage: `Downloading Pavra v${release.version}…`,
  });

  const removeProgressListener = attachDownloadProgressListener(bridge, release.apkSizeBytes);
  const candidateUrls = buildCandidateApkDownloadUrls(
    release,
    state.lastWorkingSource,
    resolveCurrentCoordinatorHttpOrigin(),
  );
  const urlsToTry = candidateUrls.length > 0 ? candidateUrls : [release.apkDownloadUrl];

  try {
    await runCandidateDownloadLoop(bridge, release, urlsToTry);
  } finally {
    removeProgressListener?.();
  }
}

export async function cancelPavraApkDownloadAction(): Promise<void> {
  activeDownloadCancelled = true;
  const bridge = getKeepaliveInstallerBridge();
  try {
    await bridge.cancelApkDownloadAsync?.();
  } catch {
    // Ignore native cancel errors.
  }
  markDownloadCancelled();
}

export async function openUnknownSourcesSettingsAction(): Promise<void> {
  const bridge = getKeepaliveInstallerBridge();
  if (typeof bridge.openUnknownAppSourcesSettingsAsync === "function") {
    try {
      await bridge.openUnknownAppSourcesSettingsAsync();
      return;
    } catch {
      // Fallback below if intent fails.
    }
  }
  await installReadyPavraApkAction({ requestSettingsIfMissing: true });
}

export async function openPavraReleasePageAction(): Promise<void> {
  const release = usePavraApkUpdaterStore.getState().availableRelease;
  const targetUrl =
    release?.htmlUrl ||
    release?.apkDownloadUrl ||
    "https://github.com/Oldpan/paseo/releases/latest";
  await Linking.openURL(targetUrl);
}

export function usePavraApkUpdater(onNotice?: (message: string) => void) {
  const installed = usePavraApkUpdaterStore((state) => state.installed);
  const availableRelease = usePavraApkUpdaterStore((state) => state.availableRelease);
  const autoCheck = usePavraApkUpdaterStore((state) => state.autoCheck);
  const skippedVersion = usePavraApkUpdaterStore((state) => state.skippedVersion);
  const lastCheckedAtMs = usePavraApkUpdaterStore((state) => state.lastCheckedAtMs);
  const lastAttemptAtMs = usePavraApkUpdaterStore((state) => state.lastAttemptAtMs);
  const lastWorkingSource = usePavraApkUpdaterStore((state) => state.lastWorkingSource);
  const checkPhase = usePavraApkUpdaterStore((state) => state.checkPhase);
  const taskPhase = usePavraApkUpdaterStore((state) => state.taskPhase);
  const progress = usePavraApkUpdaterStore((state) => state.progress);
  const receivedBytes = usePavraApkUpdaterStore((state) => state.receivedBytes);
  const totalBytes = usePavraApkUpdaterStore((state) => state.totalBytes);
  const downloadedFilePath = usePavraApkUpdaterStore((state) => state.downloadedFilePath);
  const sheetOpen = usePavraApkUpdaterStore((state) => state.sheetOpen);
  const checking = usePavraApkUpdaterStore((state) => state.checking);
  const statusMessage = usePavraApkUpdaterStore((state) => state.statusMessage);
  const setAutoCheck = usePavraApkUpdaterStore((state) => state.setAutoCheck);
  const skipVersion = usePavraApkUpdaterStore((state) => state.skipVersion);
  const openUpdateSheet = usePavraApkUpdaterStore((state) => state.openUpdateSheet);
  const closeUpdateSheet = usePavraApkUpdaterStore((state) => state.closeUpdateSheet);

  useEffect(() => {
    void hydratePavraApkUpdaterPrefs();
  }, []);

  const checkForApkUpdate = useCallback(
    async (options?: { manual?: boolean; coordinatorHttpOrigin?: string | null }) => {
      await checkForPavraApkUpdateAction({
        ...options,
        onNotice,
      });
    },
    [onNotice],
  );

  const startDownloadAndInstall = useCallback(async () => {
    await startPavraApkDownloadAndInstallAction();
  }, []);

  const cancelDownload = useCallback(async () => {
    await cancelPavraApkDownloadAction();
  }, []);

  const installReadyApk = useCallback(async () => {
    await installReadyPavraApkAction({ requestSettingsIfMissing: true });
  }, []);

  const openInstallPermissionSettings = useCallback(async () => {
    await openUnknownSourcesSettingsAction();
  }, []);

  const openReleasePage = useCallback(async () => {
    await openPavraReleasePageAction();
  }, []);

  const downloadAvailableRelease = useCallback(() => {
    void startPavraApkDownloadAndInstallAction();
  }, []);

  const isSkipped =
    Boolean(availableRelease) &&
    Boolean(skippedVersion) &&
    availableRelease?.version === skippedVersion;

  return {
    installed,
    availableRelease,
    hasUpdate: Boolean(availableRelease) && !isSkipped,
    isSkipped,
    autoCheck,
    skippedVersion,
    lastCheckedAtMs,
    lastAttemptAtMs,
    lastWorkingSource,
    checkPhase,
    taskPhase,
    progress,
    receivedBytes,
    totalBytes,
    downloadedFilePath,
    sheetOpen,
    checking,
    statusMessage,
    setAutoCheck,
    skipVersion,
    openUpdateSheet,
    closeUpdateSheet,
    checkForApkUpdate,
    startDownloadAndInstall,
    cancelDownload,
    installReadyApk,
    openInstallPermissionSettings,
    openReleasePage,
    downloadAvailableRelease,
  };
}

async function runDueAutoUpdateCheckIfEnabled(
  checkForApkUpdate: (options?: { manual?: boolean }) => Promise<void>,
): Promise<void> {
  await hydratePavraApkUpdaterPrefs();
  const state = usePavraApkUpdaterStore.getState();
  if (
    state.autoCheck &&
    isAutoUpdateCheckDue({
      nowMs: Date.now(),
      lastCheckedAtMs: state.lastCheckedAtMs,
      lastAttemptAtMs: state.lastAttemptAtMs,
    })
  ) {
    await checkForApkUpdate({ manual: false });
  }
}

async function handleAppStateActiveForUpdater(
  bridge: PavraKeepaliveInstallerBridge,
  checkForApkUpdate: (options?: { manual?: boolean }) => Promise<void>,
): Promise<void> {
  await hydratePavraApkUpdaterPrefs();
  const state = usePavraApkUpdaterStore.getState();
  if (state.taskPhase === "needsPermission" && state.downloadedFilePath) {
    let canInstall = false;
    if (typeof bridge.canRequestPackageInstallsAsync === "function") {
      try {
        canInstall = Boolean(await bridge.canRequestPackageInstallsAsync());
      } catch {
        canInstall = false;
      }
    }
    if (canInstall) {
      await installReadyPavraApkAction({ requestSettingsIfMissing: false });
    }
    return;
  }
  await runDueAutoUpdateCheckIfEnabled(checkForApkUpdate);
}

export function usePavraApkBackgroundCheck() {
  const { checkForApkUpdate } = usePavraApkUpdater();
  useEffect(() => {
    if (!isAndroidApkUpdateSupported()) return;

    const bridge = getKeepaliveInstallerBridge();
    void bridge.cleanupApkCacheAsync?.()?.catch(() => undefined);

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void runDueAutoUpdateCheckIfEnabled(checkForApkUpdate);
    }, 6_000);

    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      void handleAppStateActiveForUpdater(bridge, checkForApkUpdate);
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.remove();
    };
  }, [checkForApkUpdate]);
}
