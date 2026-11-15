import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { resolveAppVersion } from "@/utils/app-version";
import {
  fetchLatestPavraApkRelease,
  isReleaseNewerThanInstalled,
  type InstalledPavraBuildInfo,
  type PavraApkReleaseInfo,
} from "./apk-updates";

const DISMISSED_RELEASE_TAG_KEY = "pavra.dismissedApkReleaseTag.v1";

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

async function getDismissedReleaseTag(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DISMISSED_RELEASE_TAG_KEY);
  } catch {
    return null;
  }
}

async function setDismissedReleaseTag(tagName: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_RELEASE_TAG_KEY, tagName);
  } catch {
    // Ignore storage failures
  }
}

export async function openApkReleaseDownload(release: PavraApkReleaseInfo): Promise<void> {
  const targetUrl = release.apkDownloadUrl || release.htmlUrl;
  await Linking.openURL(targetUrl);
}

export function isAndroidApkUpdateSupported(): boolean {
  return Platform.OS === "android";
}

export function usePavraApkUpdater(onNotice?: (message: string) => void) {
  const [installed] = useState<InstalledPavraBuildInfo>(getInstalledPavraBuildInfo);
  const [pendingRelease, setPendingRelease] = useState<PavraApkReleaseInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const checkForApkUpdate = useCallback(
    async (options?: { manual?: boolean }) => {
      const manual = Boolean(options?.manual);
      if (!isAndroidApkUpdateSupported() && !manual) return;
      setChecking(true);
      try {
        const latest = await fetchLatestPavraApkRelease();
        if (!latest) {
          if (manual) onNotice?.("No APK release found on GitHub yet.");
          return;
        }
        const newer = isReleaseNewerThanInstalled(latest, installed);
        if (!newer) {
          if (manual) {
            onNotice?.(
              `Already on the latest Pavra build (${installed.version}${installed.revision ? ` · ${installed.revision}` : ""}).`,
            );
          }
          return;
        }
        if (!manual) {
          const dismissed = await getDismissedReleaseTag();
          if (dismissed === latest.tagName) return;
        }
        setPendingRelease(latest);
      } catch (failure) {
        if (manual) {
          onNotice?.(
            failure instanceof Error ? failure.message : "Failed to check GitHub releases.",
          );
        }
      } finally {
        setChecking(false);
      }
    },
    [installed, onNotice],
  );

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

  const dismissPendingRelease = useCallback(() => {
    const tag = pendingRelease?.tagName;
    setPendingRelease(null);
    if (tag) {
      void setDismissedReleaseTag(tag);
    }
  }, [pendingRelease]);

  const downloadPendingRelease = useCallback(() => {
    const target = pendingRelease;
    if (!target) return;
    setPendingRelease(null);
    void openApkReleaseDownload(target);
  }, [pendingRelease]);

  return {
    installed,
    pendingRelease,
    checking,
    checkForApkUpdate,
    dismissPendingRelease,
    downloadPendingRelease,
  };
}
