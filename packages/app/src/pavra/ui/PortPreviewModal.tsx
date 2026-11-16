import { EditingTextInput } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { WebView } from "react-native-webview";
import {
  AlertIcon,
  BoxesIcon,
  CloseIcon,
  ExternalLinkIcon,
  MonitorIcon,
  RefreshIcon,
} from "./icons";
import {
  normalizePreviewPath,
  parsePreviewablePortUrl,
  pickHostReachableEndpoint,
  resolvePortPreviewTargetUrl,
} from "./portPreviewUrl";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface PortPreviewTarget {
  url?: string;
  port?: number;
  path?: string;
  machineId?: string;
  machineLabel?: string;
  hostEndpoint?: string | null;
  workspaceId?: string;
  workspaceName?: string;
  group?: string;
}

export interface PortPreviewOpenStudioPayload {
  url: string;
  port: number;
  path: string;
  machineId?: string;
}

export interface PortPreviewModalProps {
  visible?: boolean;
  target?: PortPreviewTarget | null;
  url?: string | null;
  port?: number;
  initialPath?: string;
  machineId?: string;
  machineLabel?: string;
  hostEndpoint?: string | null;
  onClose: () => void;
  onOpenInStudio?: (payload: PortPreviewOpenStudioPayload) => void;
}

const ORIGIN_WHITELIST = ["http://*", "https://*"];

function resolveEffectiveEndpoint(input: {
  targetEndpoint?: string | null;
  propEndpoint?: string | null;
  machineId?: string;
  hosts: readonly HostProfile[];
}): string | null {
  if (input.targetEndpoint !== undefined) return input.targetEndpoint;
  if (input.propEndpoint !== undefined) return input.propEndpoint;
  if (!input.machineId) return null;
  const snapshot = getHostRuntimeStore().getSnapshot(input.machineId);
  const profile = input.hosts.find((item) => item.serverId === input.machineId);
  return pickHostReachableEndpoint({
    activeConnection: snapshot?.activeConnection,
    connections: profile?.connections,
  });
}

function resolveEffectiveMachineLabel(input: {
  targetLabel?: string;
  propLabel?: string;
  machineId?: string;
  fallbackHost?: string;
  hosts: readonly HostProfile[];
}): string {
  if (input.targetLabel) return input.targetLabel;
  if (input.propLabel) return input.propLabel;
  if (input.machineId) {
    const profile = input.hosts.find((item) => item.serverId === input.machineId);
    return profile?.label || input.machineId;
  }
  return input.fallbackHost ?? "localhost";
}

function ToolbarButton({
  testID,
  label,
  accent = false,
  disabled = false,
  onPress,
  children,
}: {
  testID?: string;
  label: string;
  accent?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            minHeight: 30,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: accent
              ? hovered
                ? t.brandAccentHover
                : t.brandAccent
              : hovered
                ? t.surfaceHover
                : t.surfacePrimary,
            paddingHorizontal: 10,
            paddingVertical: 4,
            opacity: disabled ? 0.45 : 1,
            ...(isWeb ? (webTransition("background-color") as ViewStyle) : null),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      {children}
    </Pressable>
  );
}

function PortPreviewHeader({
  badgeText,
  resolvedUrl,
  onOpenBrowser,
  onOpenStudio,
  onClose,
}: {
  badgeText: string;
  resolvedUrl: string | null;
  onOpenBrowser: () => void;
  onOpenStudio?: () => void;
  onClose: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        borderBottomWidth: 2,
        borderColor: t.retroBorder,
        backgroundColor: t.brandAccent,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexWrap: "wrap",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 180,
          flexWrap: "wrap",
        }}
      >
        <View
          testID="port-preview-badge"
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfacePrimary,
              paddingHorizontal: 10,
              paddingVertical: 3,
            },
            ctrlShadow(t, name),
          ]}
        >
          <MonitorIcon color={t.textPrimary} size={12} />
          <Text
            style={type(t.textPrimary, 11, {
              fontFamily: "monospace",
              fontWeight: "700",
            })}
          >
            {badgeText}
          </Text>
        </View>
        {resolvedUrl ? (
          <Text
            testID="port-preview-url"
            numberOfLines={1}
            style={type(t.onAccent, 11, {
              fontFamily: "monospace",
              fontWeight: "600",
              flexShrink: 1,
            })}
          >
            {resolvedUrl}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {onOpenStudio ? (
          <ToolbarButton
            testID="port-preview-open-studio"
            label="Open in Studio"
            onPress={onOpenStudio}
          >
            <BoxesIcon color={t.textPrimary} size={12} />
            <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Open in Studio</Text>
          </ToolbarButton>
        ) : null}

        <ToolbarButton
          testID="port-preview-open-browser"
          label="Open in Browser"
          disabled={!resolvedUrl}
          onPress={onOpenBrowser}
        >
          <ExternalLinkIcon color={t.textPrimary} size={12} />
          <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Open in Browser</Text>
        </ToolbarButton>

        <ToolbarButton testID="port-preview-close" label="Close port preview" onPress={onClose}>
          <CloseIcon color={t.textPrimary} size={13} />
        </ToolbarButton>
      </View>
    </View>
  );
}

function PortPreviewNavigationBar({
  pathInputKey,
  initialPathValue,
  onChangePath,
  onGo,
  onRefresh,
}: {
  pathInputKey: number;
  initialPathValue: string;
  onChangePath: (value: string) => void;
  onGo: () => void;
  onRefresh: () => void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderBottomWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceSecondary,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <EditingTextInput
        key={`path:${pathInputKey}`}
        testID="port-preview-path-input"
        accessibilityLabel="Preview path"
        initialValue={initialPathValue}
        onChangeText={onChangePath}
        onSubmitEditing={onGo}
        placeholder="/path"
        placeholderTextColor={t.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          type(t.textPrimary, 12, { fontFamily: "monospace" }),
          {
            flex: 1,
            minHeight: 32,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfacePrimary,
            paddingHorizontal: 10,
            paddingVertical: 5,
          },
        ]}
      />
      <ToolbarButton testID="port-preview-go" label="Go to path" accent onPress={onGo}>
        <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Go</Text>
      </ToolbarButton>
      <ToolbarButton testID="port-preview-refresh" label="Refresh preview" onPress={onRefresh}>
        <RefreshIcon color={t.textPrimary} size={12} />
        <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Refresh</Text>
      </ToolbarButton>
    </View>
  );
}

function PortPreviewFallbackCard({
  reason,
  resolvedUrl,
  onRetry,
  onOpenBrowser,
}: {
  reason: string;
  resolvedUrl: string | null;
  onRetry: () => void;
  onOpenBrowser: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      testID="port-preview-fallback"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backgroundColor: t.surfacePrimary,
      }}
    >
      <View
        style={[
          {
            width: "100%",
            maxWidth: 440,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceElevated,
            padding: 18,
            gap: 10,
          },
          ctrlShadow(t, name),
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AlertIcon color={t.destructive} size={16} />
          <Text style={type(t.textPrimary, 14, { fontWeight: "700" })}>
            Service port unreachable
          </Text>
        </View>
        <Text style={type(t.textSecondary, 12)}>{reason}</Text>
        {resolvedUrl ? (
          <Text selectable style={type(t.textMuted, 11, { fontFamily: "monospace" })}>
            {resolvedUrl}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <ToolbarButton testID="port-preview-retry" label="Retry preview" accent onPress={onRetry}>
            <RefreshIcon color={t.onAccent} size={12} />
            <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Retry</Text>
          </ToolbarButton>
          {resolvedUrl ? (
            <ToolbarButton label="Open in Browser" onPress={onOpenBrowser}>
              <ExternalLinkIcon color={t.textPrimary} size={12} />
              <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Open in Browser</Text>
            </ToolbarButton>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function PortPreviewViewport({
  resolvedUrl,
  badgeText,
  activePort,
  reloadNonce,
  loading,
  unreachableError,
  onLoadStart,
  onLoadEnd,
  onError,
  onRetry,
  onOpenBrowser,
}: {
  resolvedUrl: string | null;
  badgeText: string;
  activePort: number | null;
  reloadNonce: number;
  loading: boolean;
  unreachableError: string | null;
  onLoadStart: () => void;
  onLoadEnd: () => void;
  onError: (message: string) => void;
  onRetry: () => void;
  onOpenBrowser: () => void;
}) {
  const { palette: t } = useTheme();
  const frameKey = `${resolvedUrl ?? "invalid"}:${reloadNonce}`;

  return (
    <View style={{ flex: 1, minHeight: 260, position: "relative", backgroundColor: "#ffffff" }}>
      {!resolvedUrl || unreachableError ? (
        <PortPreviewFallbackCard
          reason={
            unreachableError ??
            "Only local or private LAN HTTP service ports (1..65535) can be previewed."
          }
          resolvedUrl={resolvedUrl}
          onRetry={onRetry}
          onOpenBrowser={onOpenBrowser}
        />
      ) : isWeb ? (
        <iframe
          key={frameKey}
          data-testid="port-preview-iframe"
          title={`Port preview ${badgeText}`}
          src={resolvedUrl}
          sandbox="allow-scripts allow-forms allow-popups"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            flex: 1,
            backgroundColor: "#ffffff",
          }}
          onLoad={onLoadEnd}
          onError={() =>
            onError(
              `Failed to load ${resolvedUrl}. Make sure the service is listening on port ${activePort ?? ""}.`,
            )
          }
        />
      ) : (
        <WebView
          key={frameKey}
          testID="port-preview-webview"
          style={{ flex: 1, backgroundColor: "#ffffff" }}
          source={{ uri: resolvedUrl }}
          originWhitelist={ORIGIN_WHITELIST}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          onLoadStart={onLoadStart}
          onLoadEnd={onLoadEnd}
          onError={(event) =>
            onError(
              event.nativeEvent.description ||
                `Unable to connect to ${resolvedUrl}. Make sure the service is running.`,
            )
          }
        />
      )}
      {loading && resolvedUrl && !unreachableError ? (
        <View
          testID="port-preview-loading"
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceElevated,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <ActivityIndicator size="small" color={t.textPrimary} />
          <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Loading…</Text>
        </View>
      ) : null}
    </View>
  );
}

function resolvePreviewInputState(props: PortPreviewModalProps) {
  const { visible = true, target, url, port, initialPath, machineId } = props;
  const base: PortPreviewTarget = target ?? {};
  const rawUrl = base.url ?? url ?? undefined;
  const resolvedMachineId = base.machineId ?? machineId;
  const explicitPort = base.port ?? port;
  const parsedInitial = rawUrl ? parsePreviewablePortUrl(rawUrl) : null;
  const activePort = explicitPort ?? (parsedInitial ? parsedInitial.port : null);
  const startingPath = normalizePreviewPath(
    base.path ?? initialPath ?? (parsedInitial ? parsedInitial.pathAndQuery : "/"),
  );
  const isOpen = visible && Boolean(target || rawUrl || explicitPort !== undefined);
  return {
    rawUrl,
    resolvedMachineId,
    parsedInitial,
    activePort,
    startingPath,
    isOpen,
  };
}

export function PortPreviewModal(props: PortPreviewModalProps) {
  const { target, machineLabel, hostEndpoint, onClose, onOpenInStudio } = props;
  const { palette: t, name } = useTheme();
  const hosts = useHosts();

  const { rawUrl, resolvedMachineId, parsedInitial, activePort, startingPath, isOpen } = useMemo(
    () => resolvePreviewInputState(props),
    [props],
  );

  const [pathDraft, setPathDraft] = useState(startingPath);
  const [committedPath, setCommittedPath] = useState(startingPath);
  const [pathInputKey, setPathInputKey] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unreachableError, setUnreachableError] = useState<string | null>(null);

  useEffect(() => {
    setPathDraft(startingPath);
    setCommittedPath(startingPath);
    setPathInputKey((current) => current + 1);
    setUnreachableError(null);
    setLoading(true);
  }, [rawUrl, activePort, startingPath]);

  const effectiveHostEndpoint = useMemo(
    () =>
      resolveEffectiveEndpoint({
        targetEndpoint: target?.hostEndpoint,
        propEndpoint: hostEndpoint,
        machineId: resolvedMachineId,
        hosts,
      }),
    [hostEndpoint, hosts, resolvedMachineId, target?.hostEndpoint],
  );

  const effectiveMachineLabel = useMemo(
    () =>
      resolveEffectiveMachineLabel({
        targetLabel: target?.machineLabel,
        propLabel: machineLabel,
        machineId: resolvedMachineId,
        fallbackHost: parsedInitial?.hostname,
        hosts,
      }),
    [hosts, machineLabel, parsedInitial?.hostname, resolvedMachineId, target?.machineLabel],
  );

  const resolvedUrl = useMemo(
    () =>
      resolvePortPreviewTargetUrl({
        rawUrl,
        port: activePort ?? undefined,
        path: committedPath,
        hostEndpoint: effectiveHostEndpoint,
      }),
    [activePort, committedPath, effectiveHostEndpoint, rawUrl],
  );

  const handleGo = useCallback(() => {
    const normalized = normalizePreviewPath(pathDraft);
    setPathDraft(normalized);
    setCommittedPath(normalized);
    setPathInputKey((current) => current + 1);
    setUnreachableError(null);
    setLoading(true);
    setReloadNonce((current) => current + 1);
  }, [pathDraft]);

  const handleRefresh = useCallback(() => {
    setUnreachableError(null);
    setLoading(true);
    setReloadNonce((current) => current + 1);
  }, []);

  const handleOpenBrowser = useCallback(() => {
    if (resolvedUrl) void Linking.openURL(resolvedUrl);
  }, [resolvedUrl]);

  const handleOpenStudio = useMemo(() => {
    if (!onOpenInStudio || !resolvedUrl || !activePort) return undefined;
    return () => {
      onOpenInStudio({
        url: resolvedUrl,
        port: activePort,
        path: committedPath,
        machineId: resolvedMachineId,
      });
    };
  }, [activePort, committedPath, onOpenInStudio, resolvedMachineId, resolvedUrl]);

  if (!isOpen) return null;

  const badgeText = activePort ? `${effectiveMachineLabel}:${activePort}` : effectiveMachineLabel;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        testID="port-preview-backdrop"
        accessibilityLabel="Close port preview"
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Pressable
          testID="port-preview-modal"
          onPress={() => {}}
          style={[
            {
              width: "100%",
              maxWidth: 960,
              height: "88%",
              maxHeight: 760,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              overflow: "hidden",
            },
            ctrlShadow(t, name),
          ]}
        >
          <PortPreviewHeader
            badgeText={badgeText}
            resolvedUrl={resolvedUrl}
            onOpenBrowser={handleOpenBrowser}
            onOpenStudio={handleOpenStudio}
            onClose={onClose}
          />
          <PortPreviewNavigationBar
            pathInputKey={pathInputKey}
            initialPathValue={committedPath}
            onChangePath={setPathDraft}
            onGo={handleGo}
            onRefresh={handleRefresh}
          />
          <PortPreviewViewport
            resolvedUrl={resolvedUrl}
            badgeText={badgeText}
            activePort={activePort}
            reloadNonce={reloadNonce}
            loading={loading}
            unreachableError={unreachableError}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(msg) => {
              setLoading(false);
              setUnreachableError(msg);
            }}
            onRetry={handleRefresh}
            onOpenBrowser={handleOpenBrowser}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
