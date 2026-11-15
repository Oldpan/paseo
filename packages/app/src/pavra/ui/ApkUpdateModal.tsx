import { Text, View } from "react-native";
import type { InstalledPavraBuildInfo, PavraApkReleaseInfo } from "../apk-updates";
import { Chip } from "./ChatChrome";
import { FormFrame } from "./FormChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

function formatMegabytes(bytes: number | null): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ApkUpdateModal({
  release,
  installed,
  onDownload,
  onDismiss,
}: {
  release: PavraApkReleaseInfo;
  installed: InstalledPavraBuildInfo;
  onDownload(): void;
  onDismiss(): void;
}) {
  const { palette: t } = useTheme();
  const sizeLabel = formatMegabytes(release.apkSizeBytes);
  const currentSummary = installed.revision
    ? `${installed.version} (${installed.revision})`
    : installed.version;
  const targetSummary = release.revision
    ? `${release.version} (${release.revision})`
    : release.version;

  return (
    <FormFrame title="New Pavra APK available" onClose={onDismiss}>
      <Text style={type(t.textPrimary, 13, { fontWeight: "600" })}>{release.title}</Text>
      <Text style={type(t.textSecondary, 12)}>
        {`Installed: ${currentSummary}  →  Latest: ${targetSummary}${sizeLabel ? ` · ${sizeLabel}` : ""}`}
      </Text>
      {release.notes ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.retroBorder,
            borderRadius: 10,
            backgroundColor: t.surfaceSecondary,
            padding: 10,
          }}
        >
          <Text numberOfLines={8} style={type(t.textSecondary, 11, { lineHeight: 16 })}>
            {release.notes}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
        <Chip label="Download APK update" onPress={onDownload} accent>
          立即更新 · Download APK
        </Chip>
        <Chip label="Dismiss APK update" onPress={onDismiss}>
          稍后提醒 · Later
        </Chip>
      </View>
    </FormFrame>
  );
}
