import { defineRpc } from "@getpaseo/plugin";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import type { PavraData } from "../data";
import {
  OUTWARD_CONFIRM_TIER_OPTIONS,
  buildPhoneRegistrationPayload,
  formatVirtualDisplayBadge,
  phoneRegisterRpc,
  usePhoneControlStore,
  type PhoneLiveExecution,
  type PhoneOutwardConfirmTier,
  type PhonePrivilegeStatus,
} from "../phone-control";
import { FormFrame, PavraField, PavraInput } from "./FormChrome";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface PhoneControlModalProps {
  onClose(): void;
  data?: Pick<PavraData, "invoke" | "call">;
  isRelay?: boolean;
  onLaunchedDemo?: () => void;
}

const dynamicRegisterContract = defineRpc({
  name: phoneRegisterRpc.name,
  input: z.record(z.string(), z.unknown()),
  output: z.unknown(),
});

function formatChannelSummaryLabel(status: PhonePrivilegeStatus): string {
  if (status.activeChannel === "shizuku") {
    return "Ready · Shizuku Shell (UID 2000)";
  }
  if (status.activeChannel === "wireless_adb") {
    return `Ready · Wireless ADB (127.0.0.1:${status.wirelessAdbPort ?? 37891})`;
  }
  return "Not Paired Yet";
}

function MasterSwitchCard({
  enabled,
  deviceId,
  deviceName,
  channelSummaryLabel,
  onToggleMaster,
  onChangeDeviceName,
}: {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  channelSummaryLabel: string;
  onToggleMaster: () => void;
  onChangeDeviceName: (next: string) => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={[
        s.card,
        {
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfaceSecondary,
        },
      ]}
    >
      <View style={s.headerRow}>
        <View style={s.titleCol}>
          <Text style={type(t.textPrimary, 13, { fontWeight: "800" })}>
            Phone Control Master Switch
          </Text>
          <Text style={type(t.textMuted, 11)}>
            {`Device ID: ${deviceId} · ${channelSummaryLabel}`}
          </Text>
        </View>
        <Pressable
          testID="phone-master-toggle"
          role="switch"
          accessibilityRole="switch"
          accessibilityLabel="Phone Control Master Switch"
          accessibilityState={{ checked: enabled }}
          onPress={onToggleMaster}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            const bg = enabled ? t.brandAccent : hovered ? t.surfaceHover : t.surfacePrimary;
            return [
              s.togglePill,
              {
                borderColor: t.retroBorder,
                backgroundColor: bg,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text
            style={type(enabled ? t.onAccent : t.textPrimary, 11, {
              fontWeight: "800",
            })}
          >
            {enabled ? "Enabled · ON" : "Disabled · OFF"}
          </Text>
        </Pressable>
      </View>

      <PavraField label="Device Name">
        <PavraInput
          testID="phone-device-name-input"
          accessibilityLabel="Device Name"
          initialValue={deviceName}
          onChangeText={onChangeDeviceName}
          placeholder="Pixel 9 Pro · Android 15"
        />
      </PavraField>
    </View>
  );
}

function PrivilegeChannelsCard({
  privilegeStatus,
  pairingInput,
  busy,
  onChangePairingInput,
  onAuthorizeShizuku,
  onOpenWirelessSettings,
  onPairWirelessSubmit,
}: {
  privilegeStatus: PhonePrivilegeStatus;
  pairingInput: string;
  busy: boolean;
  onChangePairingInput: (next: string) => void;
  onAuthorizeShizuku: () => void;
  onOpenWirelessSettings: () => void;
  onPairWirelessSubmit: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={[
        s.card,
        {
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfaceSecondary,
        },
      ]}
    >
      <Text style={type(t.textPrimary, 13, { fontWeight: "800" })}>
        Dual Privilege Channel Setup (No PC Required)
      </Text>
      <Text style={type(t.textMuted, 11)}>
        Choose either Method B (one-click Shizuku) or Method A (built-in Android 11+ Wireless
        Debugging 6-digit pairing).
      </Text>

      <View
        style={[
          s.subCard,
          {
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceSecondary,
          },
        ]}
      >
        <View style={s.headerRow}>
          <View style={s.titleCol}>
            <Text style={type(t.textPrimary, 12, { fontWeight: "800" })}>
              Method B · Shizuku (One-Click)
            </Text>
            <Text style={type(t.textMuted, 11)}>
              Directly binds UID 2000 shell via Shizuku / Sui when installed.
            </Text>
          </View>
          <View
            style={[
              s.badge,
              {
                borderColor: t.retroBorder,
                backgroundColor: privilegeStatus.shizukuAuthorized ? t.badgeGreen : t.badgeAmber,
              },
            ]}
          >
            <Text style={type(t.textPrimary, 10, { fontWeight: "800" })}>
              {privilegeStatus.shizukuAuthorized ? "Authorized" : "Ready to Pair"}
            </Text>
          </View>
        </View>

        <Pressable
          testID="phone-auth-shizuku-btn"
          role="button"
          accessibilityLabel="Authorize with Shizuku"
          disabled={busy}
          onPress={onAuthorizeShizuku}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.actionBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.brandAccentHover : t.brandAccent,
                opacity: busy ? 0.55 : 1,
                ...webTransition("background-color 120ms ease"),
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text style={type(t.onAccent, 11, { fontWeight: "800" })}>Authorize with Shizuku</Text>
        </Pressable>
      </View>

      <View
        style={[
          s.subCard,
          {
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceSecondary,
          },
        ]}
      >
        <View style={s.headerRow}>
          <View style={s.titleCol}>
            <Text style={type(t.textPrimary, 12, { fontWeight: "800" })}>
              Method A · Built-in Wireless Debugging Pairing (No Extra App Needed)
            </Text>
            <Text style={type(t.textMuted, 11)}>
              Opens Developer Wireless Debugging and posts a notification input so you can enter the
              6-digit pairing code directly from the notification bar or below.
            </Text>
          </View>
          <View
            style={[
              s.badge,
              {
                borderColor: t.retroBorder,
                backgroundColor: privilegeStatus.wirelessAdbPaired ? t.badgeGreen : t.badgeBlue,
              },
            ]}
          >
            <Text style={type(t.textPrimary, 10, { fontWeight: "800" })}>
              {privilegeStatus.wirelessAdbPaired
                ? `Paired · :${privilegeStatus.wirelessAdbPort ?? 37891}`
                : "Built-in ADB"}
            </Text>
          </View>
        </View>

        <Pressable
          testID="phone-open-wireless-settings-btn"
          role="button"
          accessibilityLabel="Open Wireless Debugging & Notification Input"
          disabled={busy}
          onPress={onOpenWirelessSettings}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.actionBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.surfaceHover : t.surfaceSecondary,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
            Open Wireless Debugging & Notification Input
          </Text>
        </Pressable>

        <View style={s.pairingInputRow}>
          <PavraInput
            testID="phone-pairing-code-input"
            accessibilityLabel="6-Digit Pairing Code (123456 or 123456:port)"
            initialValue={pairingInput}
            onChangeText={onChangePairingInput}
            placeholder="123456 or 123456:37891"
            style={s.pairingInput}
          />
          <Pressable
            testID="phone-pairing-submit-btn"
            role="button"
            accessibilityLabel="Pair Local Shell"
            disabled={busy}
            onPress={onPairWirelessSubmit}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return [
                s.actionBtn,
                {
                  borderColor: t.retroBorder,
                  backgroundColor: hovered ? t.brandAccentHover : t.brandAccent,
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <Text style={type(t.onAccent, 11, { fontWeight: "800" })}>Pair Local Shell</Text>
          </Pressable>
        </View>

        {privilegeStatus.lastError ? (
          <Text accessibilityRole="alert" style={type(t.destructive, 11, { fontWeight: "700" })}>
            {privilegeStatus.lastError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function VirtualDisplayOverlayCard({
  privilegeStatus,
  overlayVisible,
  liveExecution,
  onGrantOverlayPerm,
  onLaunchDemo,
}: {
  privilegeStatus: PhonePrivilegeStatus;
  overlayVisible: boolean;
  liveExecution: PhoneLiveExecution | null;
  onGrantOverlayPerm: () => void;
  onLaunchDemo: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={[
        s.card,
        {
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfaceSecondary,
        },
      ]}
    >
      <View style={s.headerRow}>
        <View style={s.titleCol}>
          <Text style={type(t.textPrimary, 13, { fontWeight: "800" })}>
            Background Virtual Display & Floating Mini-Window
          </Text>
          <Text style={type(t.textMuted, 11)}>
            Runs target Android apps on an isolated background VirtualDisplay (
            {formatVirtualDisplayBadge(privilegeStatus.virtualDisplayId)}) while your physical
            screen stays free.
          </Text>
        </View>
        <View
          style={[
            s.badge,
            {
              borderColor: t.retroBorder,
              backgroundColor: privilegeStatus.overlayPermissionGranted
                ? t.badgeGreen
                : t.badgeAmber,
            },
          ]}
        >
          <Text style={type(t.textPrimary, 10, { fontWeight: "800" })}>
            {privilegeStatus.overlayPermissionGranted ? "Overlay Ready" : "Overlay Perm"}
          </Text>
        </View>
      </View>

      <View style={s.buttonWrapRow}>
        <Pressable
          testID="phone-overlay-perm-btn"
          role="button"
          accessibilityLabel="Grant System Floating Window Permission"
          onPress={onGrantOverlayPerm}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.actionBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.surfaceHover : t.surfacePrimary,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
            Grant System Floating Window Permission
          </Text>
        </Pressable>

        <Pressable
          testID="phone-demo-mini-window-btn"
          role="button"
          accessibilityLabel="Launch Demo Background Task (Mini-Window Preview)"
          onPress={onLaunchDemo}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              s.actionBtn,
              {
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.brandAccentHover : t.brandAccent,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <Text style={type(t.onAccent, 11, { fontWeight: "800" })}>
            Launch Demo Background Task (Mini-Window Preview)
          </Text>
        </Pressable>
      </View>

      {overlayVisible && liveExecution?.active ? (
        <Text style={type(t.success, 11, { fontWeight: "700" })}>
          {`Live Mini-Window active: 🤖 ${liveExecution.assistantName} · ${liveExecution.appName} (${formatVirtualDisplayBadge(privilegeStatus.virtualDisplayId)})`}
        </Text>
      ) : null}
    </View>
  );
}

function NetworkAndSafetyCards({
  allowRelayControl,
  outwardConfirmTier,
  onToggleRelay,
  onSelectConfirmTier,
}: {
  allowRelayControl: boolean;
  outwardConfirmTier: PhoneOutwardConfirmTier;
  onToggleRelay: () => void;
  onSelectConfirmTier: (tier: PhoneOutwardConfirmTier) => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <>
      <View
        style={[
          s.card,
          {
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
          },
        ]}
      >
        <View style={s.headerRow}>
          <View style={s.titleCol}>
            <Text style={type(t.textPrimary, 13, { fontWeight: "800" })}>
              Network Scope · LAN & 5G Encrypted Relay
            </Text>
            <Text style={type(t.textMuted, 11)}>
              When enabled, allows your Chat coordinator to control this phone over both local Wi-Fi
              LAN and 5G E2E-encrypted Relay (Noise NK). Turn off to restrict control to local LAN
              only.
            </Text>
          </View>
          <Pressable
            testID="phone-allow-relay-toggle"
            role="switch"
            accessibilityRole="switch"
            accessibilityLabel="Allow 5G / Encrypted Relay Control"
            accessibilityState={{ checked: allowRelayControl }}
            onPress={onToggleRelay}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              const bg = allowRelayControl
                ? t.brandAccent
                : hovered
                  ? t.surfaceHover
                  : t.surfacePrimary;
              return [
                s.togglePill,
                {
                  borderColor: t.retroBorder,
                  backgroundColor: bg,
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <Text
              style={type(allowRelayControl ? t.onAccent : t.textPrimary, 11, {
                fontWeight: "800",
              })}
            >
              {allowRelayControl ? "LAN + 5G Relay" : "LAN Only"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={[
          s.card,
          {
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
          },
        ]}
      >
        <Text style={type(t.textPrimary, 13, { fontWeight: "800" })}>
          SafetyGate Outward Confirmation Tier
        </Text>
        <Text style={type(t.textMuted, 11)}>
          Controls when social messages, posts, or outward actions require confirmation. Banking
          apps remain hard-blocked and payment/password screens always trigger Main Screen Takeover.
        </Text>

        <View style={s.tierRow}>
          {OUTWARD_CONFIRM_TIER_OPTIONS.map((option) => {
            const selected = outwardConfirmTier === option.id;
            return (
              <Pressable
                key={option.id}
                testID={`phone-confirm-tier-${option.id}`}
                role="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => onSelectConfirmTier(option.id)}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  const bg = selected
                    ? t.brandAccentSoft
                    : hovered
                      ? t.surfaceHover
                      : t.surfacePrimary;
                  return [
                    s.tierPill,
                    {
                      borderColor: selected ? t.retroBorder : t.retroBorderLight,
                      backgroundColor: bg,
                    },
                    selected ? ctrlShadow(t, name) : null,
                  ];
                }}
              >
                <Text
                  style={type(t.textPrimary, 11, {
                    fontWeight: "800",
                  })}
                >
                  {option.label}
                </Text>
                <Text style={type(selected ? t.textSecondary : t.textMuted, 10)}>
                  {option.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

export function PhoneControlModal({
  onClose,
  data,
  isRelay = false,
  onLaunchedDemo,
}: PhoneControlModalProps) {
  const { palette: t } = useTheme();

  const enabled = usePhoneControlStore((state) => state.enabled);
  const deviceId = usePhoneControlStore((state) => state.deviceId);
  const deviceName = usePhoneControlStore((state) => state.deviceName);
  const privilegeStatus = usePhoneControlStore((state) => state.privilegeStatus);
  const allowRelayControl = usePhoneControlStore((state) => state.allowRelayControl);
  const outwardConfirmTier = usePhoneControlStore((state) => state.outwardConfirmTier);
  const overlayVisible = usePhoneControlStore((state) => state.overlayVisible);
  const liveExecution = usePhoneControlStore((state) => state.liveExecution);

  const setEnabled = usePhoneControlStore((state) => state.setEnabled);
  const setDeviceName = usePhoneControlStore((state) => state.setDeviceName);
  const setAllowRelayControl = usePhoneControlStore((state) => state.setAllowRelayControl);
  const setOutwardConfirmTier = usePhoneControlStore((state) => state.setOutwardConfirmTier);
  const authorizeShizuku = usePhoneControlStore((state) => state.authorizeShizuku);
  const openWirelessDebuggingSettings = usePhoneControlStore(
    (state) => state.openWirelessDebuggingSettings,
  );
  const pairWirelessAdb = usePhoneControlStore((state) => state.pairWirelessAdb);
  const grantOverlayPermission = usePhoneControlStore((state) => state.grantOverlayPermission);
  const launchDemoBackgroundTask = usePhoneControlStore((state) => state.launchDemoBackgroundTask);

  const [pairingInput, setPairingInput] = useState("");
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const syncWithCoordinator = useCallback(async () => {
    if (!data?.invoke) return;
    try {
      const current = usePhoneControlStore.getState();
      await data.invoke(dynamicRegisterContract, buildPhoneRegistrationPayload(current, isRelay));
    } catch {
      // Best-effort sync when coordinator supports chat.phone.register.
    }
  }, [data, isRelay]);

  const handleToggleMaster = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    setStatusNotice(
      next ? "Phone Control enabled on this device." : "Phone Control turned off on this device.",
    );
    void syncWithCoordinator();
  }, [enabled, setEnabled, syncWithCoordinator]);

  const handleAuthorizeShizuku = useCallback(async () => {
    setBusy(true);
    try {
      const nextStatus = await authorizeShizuku();
      setStatusNotice(
        `Shizuku authorized (UID 2000 shell active on ${formatVirtualDisplayBadge(nextStatus.virtualDisplayId)}).`,
      );
      await syncWithCoordinator();
    } finally {
      setBusy(false);
    }
  }, [authorizeShizuku, syncWithCoordinator]);

  const handleOpenWirelessSettings = useCallback(async () => {
    await openWirelessDebuggingSettings();
    setStatusNotice("Opened Wireless Debugging settings & posted pairing code notification input.");
  }, [openWirelessDebuggingSettings]);

  const handlePairWirelessSubmit = useCallback(async () => {
    setBusy(true);
    try {
      const parsed = await pairWirelessAdb(pairingInput);
      if (parsed.valid) {
        setStatusNotice(
          `Paired local Wireless ADB shell on 127.0.0.1:${parsed.port ?? 37891} (${formatVirtualDisplayBadge(2)}).`,
        );
        await syncWithCoordinator();
      } else {
        setStatusNotice(null);
      }
    } finally {
      setBusy(false);
    }
  }, [pairWirelessAdb, pairingInput, syncWithCoordinator]);

  const handleGrantOverlayPerm = useCallback(async () => {
    await grantOverlayPermission();
    setStatusNotice("System floating window permission (SYSTEM_ALERT_WINDOW) granted.");
  }, [grantOverlayPermission]);

  const handleLaunchDemo = useCallback(() => {
    const demo = launchDemoBackgroundTask({
      assistantName: "Sky",
      appName: "WeChat",
      packageName: "com.tencent.mm",
      mode: "mini_window",
    });
    setStatusNotice(
      `Launched demo task (${demo.appName} on BG Display #2). Floating mini-window is active!`,
    );
    void syncWithCoordinator();
    onLaunchedDemo?.();
  }, [launchDemoBackgroundTask, onLaunchedDemo, syncWithCoordinator]);

  const handleToggleRelay = useCallback(() => {
    const next = !allowRelayControl;
    setAllowRelayControl(next);
    setStatusNotice(
      next
        ? "5G / Encrypted Relay phone control enabled."
        : "Relay control disabled — phone commands accepted on local LAN only.",
    );
    void syncWithCoordinator();
  }, [allowRelayControl, setAllowRelayControl, syncWithCoordinator]);

  const handleSelectConfirmTier = useCallback(
    (tier: PhoneOutwardConfirmTier) => {
      setOutwardConfirmTier(tier);
      void syncWithCoordinator();
    },
    [setOutwardConfirmTier, syncWithCoordinator],
  );

  return (
    <FormFrame title="Android Phone Control & Virtual Display" onClose={onClose}>
      <View testID="phone-control-modal" style={s.body}>
        <MasterSwitchCard
          enabled={enabled}
          deviceId={deviceId}
          deviceName={deviceName}
          channelSummaryLabel={formatChannelSummaryLabel(privilegeStatus)}
          onToggleMaster={handleToggleMaster}
          onChangeDeviceName={setDeviceName}
        />

        <PrivilegeChannelsCard
          privilegeStatus={privilegeStatus}
          pairingInput={pairingInput}
          busy={busy}
          onChangePairingInput={setPairingInput}
          onAuthorizeShizuku={() => void handleAuthorizeShizuku()}
          onOpenWirelessSettings={() => void handleOpenWirelessSettings()}
          onPairWirelessSubmit={() => void handlePairWirelessSubmit()}
        />

        <VirtualDisplayOverlayCard
          privilegeStatus={privilegeStatus}
          overlayVisible={overlayVisible}
          liveExecution={liveExecution}
          onGrantOverlayPerm={() => void handleGrantOverlayPerm()}
          onLaunchDemo={handleLaunchDemo}
        />

        <NetworkAndSafetyCards
          allowRelayControl={allowRelayControl}
          outwardConfirmTier={outwardConfirmTier}
          onToggleRelay={handleToggleRelay}
          onSelectConfirmTier={handleSelectConfirmTier}
        />

        {statusNotice ? (
          <View
            testID="phone-control-status-notice"
            style={[
              s.noticeBanner,
              {
                borderColor: t.retroBorder,
                backgroundColor: t.badgeGreen,
              },
            ]}
          >
            <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>{statusNotice}</Text>
          </View>
        ) : null}
      </View>
    </FormFrame>
  );
}

const s = StyleSheet.create({
  body: {
    gap: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  subCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  titleCol: {
    flex: 1,
    minWidth: 200,
    gap: 2,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  togglePill: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtn: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  pairingInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  pairingInput: {
    flex: 1,
    minWidth: 180,
    minHeight: 34,
  },
  buttonWrapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  tierRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tierPill: {
    flexGrow: 1,
    flexBasis: 170,
    minWidth: 150,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  noticeBanner: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
