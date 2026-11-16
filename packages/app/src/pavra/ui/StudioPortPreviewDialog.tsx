import { EditingTextInput } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import { CloseIcon, MonitorIcon } from "./icons";
import { PortPreviewModal, type PortPreviewTarget } from "./PortPreviewModal";
import {
  isValidPreviewPort,
  normalizePreviewPath,
  pickHostReachableEndpoint,
  resolvePortPreviewTargetUrl,
} from "./portPreviewUrl";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export const STUDIO_PORT_PRESETS = [3000, 5173, 8000, 8080] as const;

export interface StudioPortPreviewMachineOption {
  serverId: string;
  label: string;
  online?: boolean;
  hostEndpoint?: string | null;
}

export interface StudioPortPreviewSelection {
  serverId: string;
  label: string;
  port: number;
  path: string;
  hostEndpoint: string | null;
  url: string;
}

export interface StudioPortPreviewDialogProps {
  visible?: boolean;
  machines?: ReadonlyArray<StudioPortPreviewMachineOption>;
  defaultServerId?: string;
  defaultPort?: number;
  defaultPath?: string;
  onClose: () => void;
  onOpenPreview?: (selection: StudioPortPreviewSelection) => void;
}

function MachineOptionRow({
  machine,
  selected,
  onSelect,
}: {
  machine: StudioPortPreviewMachineOption;
  selected: boolean;
  onSelect: (serverId: string) => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID={`studio-port-machine-${machine.serverId}`}
      role="button"
      accessibilityRole="button"
      accessibilityLabel={`Machine ${machine.label}`}
      accessibilityState={{ selected }}
      onPress={() => onSelect(machine.serverId)}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: selected ? t.retroBorder : t.retroBorderLight,
            backgroundColor: selected
              ? t.brandAccentSoft
              : hovered
                ? t.surfaceHover
                : t.surfaceElevated,
            paddingHorizontal: 12,
            paddingVertical: 10,
            ...(isWeb ? (webTransition("background-color") as ViewStyle) : null),
          },
          selected ? ctrlShadow(t, name) : null,
        ];
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <MonitorIcon color={t.textPrimary} size={14} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={type(t.textPrimary, 13, { fontWeight: "700" })}>
            {machine.label}
          </Text>
          <Text numberOfLines={1} style={type(t.textMuted, 10, { fontFamily: "monospace" })}>
            {machine.hostEndpoint
              ? `${machine.serverId} · ${machine.hostEndpoint}`
              : machine.serverId}
          </Text>
        </View>
      </View>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: t.success,
        }}
      />
    </Pressable>
  );
}

function PortPresetRow({
  activePortText,
  onSelectPreset,
}: {
  activePortText: string;
  onSelectPreset: (preset: number) => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <Text style={type(t.textMuted, 11, { fontWeight: "600" })}>Quick presets:</Text>
      {STUDIO_PORT_PRESETS.map((preset) => {
        const active = activePortText.trim() === String(preset);
        return (
          <Pressable
            key={preset}
            testID={`studio-port-preset-${preset}`}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={`Port ${preset}`}
            accessibilityState={{ selected: active }}
            onPress={() => onSelectPreset(preset)}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return [
                {
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: active
                    ? t.brandAccent
                    : hovered
                      ? t.surfaceHover
                      : t.surfaceElevated,
                  paddingHorizontal: 10,
                  paddingVertical: 3,
                  ...(isWeb ? (webTransition("background-color") as ViewStyle) : null),
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <Text
              style={type(active ? t.onAccent : t.textPrimary, 11, {
                fontFamily: "monospace",
                fontWeight: "700",
              })}
            >
              {preset}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StudioPortPreviewDialog({
  visible = true,
  machines,
  defaultServerId,
  defaultPort,
  defaultPath = "/",
  onClose,
  onOpenPreview,
}: StudioPortPreviewDialogProps) {
  const { palette: t, name } = useTheme();
  const hosts = useHosts();

  const onlineMachines = useMemo<StudioPortPreviewMachineOption[]>(() => {
    if (machines) {
      return machines.filter((item) => item.online !== false);
    }
    const store = getHostRuntimeStore();
    return hosts
      .map((host) => {
        const snapshot = store.getSnapshot(host.serverId);
        const online = isHostRuntimeConnected(snapshot);
        const hostEndpoint = pickHostReachableEndpoint({
          activeConnection: snapshot?.activeConnection,
          connections: host.connections,
        });
        return {
          serverId: host.serverId,
          label: host.label || host.serverId,
          online,
          hostEndpoint,
        };
      })
      .filter((item) => item.online);
  }, [hosts, machines]);

  const [serverId, setServerId] = useState<string>(() => {
    if (defaultServerId && onlineMachines.some((m) => m.serverId === defaultServerId)) {
      return defaultServerId;
    }
    return onlineMachines[0]?.serverId ?? "";
  });
  const [portText, setPortText] = useState<string>(
    defaultPort !== undefined ? String(defaultPort) : "",
  );
  const [portInputKey, setPortInputKey] = useState(0);
  const [pathText, setPathText] = useState<string>(defaultPath);
  const [error, setError] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<PortPreviewTarget | null>(null);

  useEffect(() => {
    if (serverId && onlineMachines.some((item) => item.serverId === serverId)) {
      return;
    }
    if (defaultServerId && onlineMachines.some((item) => item.serverId === defaultServerId)) {
      setServerId(defaultServerId);
      return;
    }
    setServerId(onlineMachines[0]?.serverId ?? "");
  }, [defaultServerId, onlineMachines, serverId]);

  const selectedMachine = useMemo(
    () => onlineMachines.find((item) => item.serverId === serverId) ?? null,
    [onlineMachines, serverId],
  );

  const parsedPortCandidate = useMemo(() => {
    const trimmed = portText.trim();
    if (!/^\d+$/u.test(trimmed)) return null;
    const value = Number(trimmed);
    return isValidPreviewPort(value) ? value : null;
  }, [portText]);

  const previewUrlHint = useMemo(() => {
    if (!selectedMachine || !parsedPortCandidate) return null;
    return resolvePortPreviewTargetUrl({
      port: parsedPortCandidate,
      path: pathText,
      hostEndpoint: selectedMachine.hostEndpoint,
    });
  }, [parsedPortCandidate, pathText, selectedMachine]);

  const handleSelectMachine = useCallback((nextServerId: string) => {
    setServerId(nextServerId);
    setError(null);
  }, []);

  const handleSelectPreset = useCallback((preset: number) => {
    setPortText(String(preset));
    setPortInputKey((current) => current + 1);
    setError(null);
  }, []);

  const handlePortChange = useCallback((value: string) => {
    setPortText(value);
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!selectedMachine) {
      setError("Select an online machine to preview a port.");
      return;
    }
    const trimmedPort = portText.trim();
    const parsedPort = /^\d+$/u.test(trimmedPort) ? Number(trimmedPort) : NaN;
    if (!isValidPreviewPort(parsedPort)) {
      setError("Enter an HTTP port between 1 and 65535.");
      return;
    }
    const normalizedPath = normalizePreviewPath(pathText);
    const resolvedUrl = resolvePortPreviewTargetUrl({
      port: parsedPort,
      path: normalizedPath,
      hostEndpoint: selectedMachine.hostEndpoint,
    });
    if (!resolvedUrl) {
      setError("Could not resolve a valid preview URL for this port.");
      return;
    }
    setError(null);
    const selection: StudioPortPreviewSelection = {
      serverId: selectedMachine.serverId,
      label: selectedMachine.label,
      port: parsedPort,
      path: normalizedPath,
      hostEndpoint: selectedMachine.hostEndpoint ?? null,
      url: resolvedUrl,
    };
    onOpenPreview?.(selection);
    setActivePreview({
      url: resolvedUrl,
      port: parsedPort,
      path: normalizedPath,
      machineId: selectedMachine.serverId,
      machineLabel: selectedMachine.label,
      hostEndpoint: selectedMachine.hostEndpoint ?? null,
    });
  }, [onOpenPreview, pathText, portText, selectedMachine]);

  if (!visible) return null;

  if (activePreview) {
    return (
      <PortPreviewModal
        target={activePreview}
        onClose={() => {
          setActivePreview(null);
          onClose();
        }}
      />
    );
  }

  const canSubmit = Boolean(selectedMachine && portText.trim().length > 0);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        testID="studio-port-preview-backdrop"
        accessibilityLabel="Dismiss port preview"
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Pressable
          testID="studio-port-preview-dialog"
          role="dialog"
          accessibilityLabel="Port Preview"
          onPress={() => {}}
          style={[
            {
              width: "100%",
              maxWidth: 460,
              maxHeight: "90%",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfacePrimary,
              overflow: "hidden",
            },
            ctrlShadow(t, name),
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              borderBottomWidth: 1,
              borderColor: t.dividerLine,
              backgroundColor: t.brandAccent,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Text style={type(t.onAccent, 14, { fontWeight: "700" })}>Port Preview</Text>
            <Pressable
              testID="studio-port-preview-close"
              role="button"
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
            >
              <CloseIcon color={t.onAccent} size={14} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ padding: 16, gap: 14 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ gap: 6 }}>
              <Text
                style={type(t.textSecondary, 11, {
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                })}
              >
                Online Machine
              </Text>
              {onlineMachines.length === 0 ? (
                <View
                  style={{
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: t.retroBorderLight,
                    backgroundColor: t.surfaceSecondary,
                    padding: 12,
                  }}
                >
                  <Text style={type(t.textSecondary, 12)}>No online machines connected.</Text>
                </View>
              ) : (
                <View style={{ gap: 6 }}>
                  {onlineMachines.map((machine) => (
                    <MachineOptionRow
                      key={machine.serverId}
                      machine={machine}
                      selected={machine.serverId === serverId}
                      onSelect={handleSelectMachine}
                    />
                  ))}
                </View>
              )}
            </View>

            <View style={{ gap: 8 }}>
              <Text
                style={type(t.textSecondary, 11, {
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                })}
              >
                HTTP Port (1..65535)
              </Text>
              <PortPresetRow activePortText={portText} onSelectPreset={handleSelectPreset} />
              <EditingTextInput
                key={`port:${portInputKey}`}
                testID="studio-port-input"
                accessibilityLabel="HTTP Port"
                keyboardType="number-pad"
                initialValue={portText}
                onChangeText={handlePortChange}
                onSubmitEditing={handleSubmit}
                placeholder="3000"
                placeholderTextColor={t.textSubtle}
                style={[
                  type(t.textPrimary, 13, { fontFamily: "monospace" }),
                  {
                    minHeight: 36,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: t.surfaceElevated,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  },
                ]}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text
                style={type(t.textSecondary, 11, {
                  fontWeight: "700",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                })}
              >
                Initial Path
              </Text>
              <EditingTextInput
                testID="studio-port-path-input"
                accessibilityLabel="Initial Path"
                initialValue={pathText}
                onChangeText={setPathText}
                onSubmitEditing={handleSubmit}
                placeholder="/"
                placeholderTextColor={t.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  type(t.textPrimary, 12, { fontFamily: "monospace" }),
                  {
                    minHeight: 36,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: t.surfaceElevated,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  },
                ]}
              />
            </View>

            {previewUrlHint ? (
              <View
                testID="studio-port-resolved-url"
                style={{
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.retroBorderLight,
                  backgroundColor: t.surfaceSecondary,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}
              >
                <Text style={type(t.textMuted, 11, { fontFamily: "monospace" })}>
                  {previewUrlHint}
                </Text>
              </View>
            ) : null}

            {error ? (
              <Text role="alert" accessibilityRole="alert" style={type(t.destructive, 12)}>
                {error}
              </Text>
            ) : null}

            <View
              style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}
            >
              <Pressable
                testID="studio-port-preview-cancel"
                role="button"
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={onClose}
                style={[
                  {
                    height: 34,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: t.surfaceElevated,
                    paddingHorizontal: 14,
                    justifyContent: "center",
                  },
                  ctrlShadow(t, name),
                ]}
              >
                <Text style={type(t.textPrimary, 12, { fontWeight: "700" })}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="studio-port-preview-submit"
                role="button"
                accessibilityRole="button"
                accessibilityLabel="Open Preview"
                disabled={!canSubmit}
                onPress={handleSubmit}
                style={[
                  {
                    height: 34,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: t.brandAccent,
                    paddingHorizontal: 14,
                    justifyContent: "center",
                    opacity: canSubmit ? 1 : 0.45,
                  },
                  ctrlShadow(t, name),
                ]}
              >
                <Text style={type(t.onAccent, 12, { fontWeight: "700" })}>Open Preview</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
