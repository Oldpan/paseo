import Constants from "expo-constants";
import { useCallback, useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";
import { create } from "zustand";
import { resolveAppVersion } from "@/utils/app-version";
import {
  fetchLatestPavraApkRelease,
  isReleaseNewerThanInstalled,
  type InstalledPavraBuildInfo,
  type PavraApkReleaseInfo,
} from "./apk-updates";

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

interface PavraApkUpdaterState {
  installed: InstalledPavraBuildInfo;
  availableRelease: PavraApkReleaseInfo | null;
  checking: boolean;
  statusMessage: string | null;
  setChecking(checking: boolean): void;
  setResult(release: PavraApkReleaseInfo | null, statusMessage: string | null): void;
}

export const usePavraApkUpdaterStore = create<PavraApkUpdaterState>((set) => ({
  installed: getInstalledPavraBuildInfo(),
  availableRelease: null,
  checking: false,
  statusMessage: null,
  setChecking: (checking) => set({ checking }),
  setResult: (availableRelease, statusMessage) =>
    set({ availableRelease, statusMessage, checking: false }),
}));

export function usePavraApkUpdater(onNotice?: (message: string) => void) {
  const installed = usePavraApkUpdaterStore((state) => state.installed);
  const availableRelease = usePavraApkUpdaterStore((state) => state.availableRelease);
  const checking = usePavraApkUpdaterStore((state) => state.checking);
  const statusMessage = usePavraApkUpdaterStore((state) => state.statusMessage);

  const checkForApkUpdate = useCallback(
    async (options?: { manual?: boolean }) => {
      const manual = Boolean(options?.manual);
      if (!isAndroidApkUpdateSupported() && !manual) return;
      const store = usePavraApkUpdaterStore.getState();
      if (store.checking) return;
      store.setChecking(true);
      try {
        const latest = await fetchLatestPavraApkRelease();
        if (!latest) {
          const msg = "No APK release found on GitHub yet.";
          store.setResult(null, msg);
          if (manual) onNotice?.(msg);
          return;
        }
        const newer = isReleaseNewerThanInstalled(latest, store.installed);
        if (!newer) {
          const currentLabel = `${store.installed.version}${store.installed.revision ? ` · ${store.installed.revision}` : ""}`;
          const msg = `Up to date (${currentLabel})`;
          store.setResult(null, msg);
          if (manual) onNotice?.(`Already on the latest Pavra build (${currentLabel}).`);
          return;
        }
        const newLabel = `v${latest.version}${latest.revision ? ` · ${latest.revision}` : ""}`;
        const msg = `New APK available: ${newLabel}`;
        store.setResult(latest, msg);
        if (manual) onNotice?.(msg);
      } catch (failure) {
        const msg = failure instanceof Error ? failure.message : "Failed to check GitHub releases.";
        store.setResult(store.availableRelease, msg);
        if (manual) onNotice?.(msg);
      }
    },
    [onNotice],
  );

  const downloadAvailableRelease = useCallback(() => {
    const target = usePavraApkUpdaterStore.getState().availableRelease;
    if (!target) return;
    void openApkReleaseDownload(target);
  }, []);

  return {
    installed,
    availableRelease,
    hasUpdate: Boolean(availableRelease),
    checking,
    statusMessage,
    checkForApkUpdate,
    downloadAvailableRelease,
  };
}

export function usePavraApkBackgroundCheck() {
  const { checkForApkUpdate } = usePavraApkUpdater();
  useEffect(() => {
    if (!isAndroidApkUpdateSupported()) return;
    void checkForApkUpdate({ manual: false });
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkForApkUpdate({ manual: false });
      }
    });
    return () => {
      sub.remove();
    };
  }, [checkForApkUpdate]);
}
