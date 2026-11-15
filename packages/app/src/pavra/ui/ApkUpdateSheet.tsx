import { useCallback, useMemo } from "react";
import { Modal, Text, View } from "react-native";
import { formatApkMegabytes, formatSha256Snippet } from "../apk-updates";
import { type ApkUpdateTaskPhase, usePavraApkUpdater } from "../use-pavra-apk-updater";
import { Chip } from "./ChatChrome";
import { FormFrame } from "./FormChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

const META_ROW_STYLE = {
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
} as const;

const ACTIONS_ROW_STYLE = {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  paddingTop: 4,
} as const;

const PROGRESS_CONTAINER_STYLE = {
  gap: 6,
  paddingVertical: 4,
} as const;

function computeDownloadPercent(
  progress: number | null,
  receivedBytes: number,
  totalBytes: number | null,
): number {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return Math.round(Math.max(0, Math.min(1, progress)) * 100);
  }
  if (totalBytes && totalBytes > 0) {
    return Math.round(Math.max(0, Math.min(1, receivedBytes / totalBytes)) * 100);
  }
  return 0;
}

function formatBytesSuffix(receivedBytes: number, totalBytes: number | null): string {
  const receivedLabel = formatApkMegabytes(receivedBytes) ?? "0.0 MB";
  const totalLabel = formatApkMegabytes(totalBytes);
  if (totalLabel) {
    return ` · ${receivedLabel.replace(/ MB$/, "")} / ${totalLabel}`;
  }
  if (receivedLabel !== "0.0 MB") {
    return ` · ${receivedLabel}`;
  }
  return "";
}

function formatDownloadProgressSummary(input: {
  taskPhase: ApkUpdateTaskPhase;
  progress: number | null;
  receivedBytes: number;
  totalBytes: number | null;
}): { label: string; percent: number } {
  const rawPercent = computeDownloadPercent(input.progress, input.receivedBytes, input.totalBytes);
  const bytesSuffix = formatBytesSuffix(input.receivedBytes, input.totalBytes);

  if (input.taskPhase === "verifying") {
    return {
      label: `Verifying ${rawPercent}%${bytesSuffix}`,
      percent: 100,
    };
  }
  return {
    label: `Downloading ${rawPercent}%${bytesSuffix}`,
    percent: rawPercent,
  };
}

function ApkUpdateSheetActions({
  taskPhase,
  onStartUpdate,
  onSkipVersion,
  onOpenReleasePage,
  onCancelDownload,
  onGrantPermission,
  onInstallNow,
  onClose,
}: {
  taskPhase: ApkUpdateTaskPhase;
  onStartUpdate(): void;
  onSkipVersion(): void;
  onOpenReleasePage(): void;
  onCancelDownload(): void;
  onGrantPermission(): void;
  onInstallNow(): void;
  onClose(): void;
}) {
  if (taskPhase === "downloading" || taskPhase === "verifying") {
    return (
      <View style={ACTIONS_ROW_STYLE}>
        <Chip label="Cancel download" onPress={onCancelDownload}>
          Cancel download
        </Chip>
        <Chip label="Hide (continue in background)" onPress={onClose}>
          Hide (continue in background)
        </Chip>
      </View>
    );
  }

  if (taskPhase === "needsPermission") {
    return (
      <View style={ACTIONS_ROW_STYLE}>
        <Chip label="Grant install permission" onPress={onGrantPermission} accent>
          Grant install permission
        </Chip>
        <Chip label="Open release page" onPress={onOpenReleasePage}>
          Open release page
        </Chip>
        <Chip label="Later" onPress={onClose}>
          Later
        </Chip>
      </View>
    );
  }

  if (taskPhase === "ready" || taskPhase === "installing") {
    return (
      <View style={ACTIONS_ROW_STYLE}>
        <Chip
          label="Install now"
          onPress={onInstallNow}
          disabled={taskPhase === "installing"}
          accent
        >
          {taskPhase === "installing" ? "Installing…" : "Install now"}
        </Chip>
        <Chip label="Later" onPress={onClose}>
          Later
        </Chip>
      </View>
    );
  }

  return (
    <View style={ACTIONS_ROW_STYLE}>
      <Chip label="Update now" onPress={onStartUpdate} accent>
        Update now
      </Chip>
      <Chip label="Skip this version" onPress={onSkipVersion}>
        Skip this version
      </Chip>
      <Chip label="Open release page" onPress={onOpenReleasePage}>
        Open release page
      </Chip>
      <Chip label="Later" onPress={onClose}>
        Later
      </Chip>
    </View>
  );
}

export function ApkUpdateSheet() {
  const { palette: t } = useTheme();
  const {
    installed,
    availableRelease,
    taskPhase,
    progress,
    receivedBytes,
    totalBytes,
    sheetOpen,
    statusMessage,
    closeUpdateSheet,
    skipVersion,
    startDownloadAndInstall,
    cancelDownload,
    installReadyApk,
    openInstallPermissionSettings,
    openReleasePage,
  } = usePavraApkUpdater();

  const handleStartUpdate = useCallback(() => {
    void startDownloadAndInstall();
  }, [startDownloadAndInstall]);

  const handleSkipVersion = useCallback(() => {
    if (!availableRelease) return;
    skipVersion(availableRelease.version);
  }, [availableRelease, skipVersion]);

  const handleOpenReleasePage = useCallback(() => {
    void openReleasePage();
  }, [openReleasePage]);

  const handleCancelDownload = useCallback(() => {
    void cancelDownload();
  }, [cancelDownload]);

  const handleGrantPermission = useCallback(() => {
    void openInstallPermissionSettings();
  }, [openInstallPermissionSettings]);

  const handleInstallNow = useCallback(() => {
    void installReadyApk();
  }, [installReadyApk]);

  const badgeStyle = useMemo(
    () => ({
      borderRadius: 999,
      backgroundColor: t.brandAccent,
      borderWidth: 1,
      borderColor: t.retroBorder,
      paddingHorizontal: 8,
      paddingVertical: 2,
    }),
    [t.brandAccent, t.retroBorder],
  );

  const metaChipStyle = useMemo(
    () => ({
      borderRadius: 6,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.retroBorderLight,
      paddingHorizontal: 7,
      paddingVertical: 2,
    }),
    [t.retroBorderLight, t.surfaceSecondary],
  );

  const notesBoxStyle = useMemo(
    () => ({
      borderWidth: 1,
      borderColor: t.retroBorder,
      borderRadius: 10,
      backgroundColor: t.surfaceSecondary,
      padding: 10,
    }),
    [t.retroBorder, t.surfaceSecondary],
  );

  const progressTrackStyle = useMemo(
    () => ({
      height: 8,
      borderRadius: 999,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.retroBorder,
      overflow: "hidden" as const,
    }),
    [t.retroBorder, t.surfaceSecondary],
  );

  const progressInfo = useMemo(
    () =>
      formatDownloadProgressSummary({
        taskPhase,
        progress,
        receivedBytes,
        totalBytes: totalBytes ?? availableRelease?.apkSizeBytes ?? null,
      }),
    [availableRelease?.apkSizeBytes, progress, receivedBytes, taskPhase, totalBytes],
  );

  const progressFillStyle = useMemo(
    () => ({
      height: "100%" as const,
      width: `${progressInfo.percent}%` as const,
      backgroundColor: t.brandAccent,
    }),
    [progressInfo.percent, t.brandAccent],
  );

  const titleTextStyle = useMemo(
    () => type(t.textPrimary, 14, { fontWeight: "700" }),
    [t.textPrimary],
  );
  const badgeTextStyle = useMemo(() => type(t.onAccent, 11, { fontWeight: "800" }), [t.onAccent]);
  const subtitleTextStyle = useMemo(() => type(t.textSecondary, 12), [t.textSecondary]);
  const metaTextStyle = useMemo(() => type(t.textMuted, 11), [t.textMuted]);
  const notesTextStyle = useMemo(
    () => type(t.textSecondary, 11, { lineHeight: 16 }),
    [t.textSecondary],
  );
  const progressTextStyle = useMemo(
    () => type(t.textPrimary, 12, { fontWeight: "600" }),
    [t.textPrimary],
  );
  const errorTextStyle = useMemo(
    () => type(t.destructive, 12, { fontWeight: "600" }),
    [t.destructive],
  );
  const permissionTextStyle = useMemo(
    () => type(t.warning, 12, { fontWeight: "600" }),
    [t.warning],
  );

  if (!sheetOpen || !availableRelease) {
    return null;
  }

  const sizeLabel = formatApkMegabytes(availableRelease.apkSizeBytes);
  const sha256Snippet = formatSha256Snippet(availableRelease.sha256);
  const currentRev = installed.revision ? ` (${installed.revision})` : "";
  const targetRev = availableRelease.revision ? ` (${availableRelease.revision})` : "";
  const isDownloading = taskPhase === "downloading" || taskPhase === "verifying";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={closeUpdateSheet}>
      <FormFrame title="Pavra Android Update" onClose={closeUpdateSheet}>
        <View style={META_ROW_STYLE} testID="apk-update-sheet-header">
          <Text style={titleTextStyle}>{availableRelease.title}</Text>
          <View style={badgeStyle}>
            <Text style={badgeTextStyle}>{`v${availableRelease.version}`}</Text>
          </View>
          {sizeLabel ? (
            <View style={metaChipStyle}>
              <Text style={metaTextStyle}>{sizeLabel}</Text>
            </View>
          ) : null}
          {sha256Snippet ? (
            <View style={metaChipStyle}>
              <Text style={metaTextStyle}>{`SHA-256: ${sha256Snippet}`}</Text>
            </View>
          ) : null}
        </View>

        <Text
          style={subtitleTextStyle}
        >{`Installed: v${installed.version}${currentRev}  →  v${availableRelease.version}${targetRev}`}</Text>

        {availableRelease.notes ? (
          <View style={notesBoxStyle}>
            <Text numberOfLines={10} style={notesTextStyle}>
              {availableRelease.notes}
            </Text>
          </View>
        ) : null}

        {isDownloading ? (
          <View style={PROGRESS_CONTAINER_STYLE} testID="apk-update-sheet-progress">
            <Text style={progressTextStyle}>{progressInfo.label}</Text>
            <View style={progressTrackStyle}>
              <View style={progressFillStyle} />
            </View>
          </View>
        ) : null}

        {taskPhase === "failed" && statusMessage ? (
          <Text style={errorTextStyle} accessibilityRole="alert">
            {statusMessage}
          </Text>
        ) : null}

        {taskPhase === "needsPermission" ? (
          <Text style={permissionTextStyle}>
            Allow Pavra to install unknown apps in Android Settings, then return here to continue.
          </Text>
        ) : null}

        <ApkUpdateSheetActions
          taskPhase={taskPhase}
          onStartUpdate={handleStartUpdate}
          onSkipVersion={handleSkipVersion}
          onOpenReleasePage={handleOpenReleasePage}
          onCancelDownload={handleCancelDownload}
          onGrantPermission={handleGrantPermission}
          onInstallNow={handleInstallNow}
          onClose={closeUpdateSheet}
        />
      </FormFrame>
    </Modal>
  );
}
