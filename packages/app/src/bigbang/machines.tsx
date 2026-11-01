// Member → Machines, after the Computes list in the Bigbang directory sidebar. Rows are this
// device's saved hosts; the Chat coordinator says what Bigbang role each one plays.
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { PressHighlight } from "@/components/ui/press-highlight";
import { openHostOverview } from "@/navigation/settings-navigation";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import type { MachineInfo } from "../../../../extensions/bigbang/shared/contracts";
import { machineRoleLabel } from "./model";
import { SectionHeader } from "./ui/SidebarControls";
import { text as type } from "./ui/theme";
import { useTheme } from "./ui/ThemeProvider";

const ROW = {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingHorizontal: 8,
  paddingVertical: 8,
  borderRadius: 12,
} as const;
const BODY = { flex: 1, minWidth: 0 } as const;

function addHost() {
  router.push(buildSettingsAddHostRoute(Date.now()));
}

export function MachinesSection({ machines }: { machines: MachineInfo[] }) {
  const hosts = useHosts();
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return (
    <>
      <SectionHeader
        label="Machines"
        count={hosts.length}
        expanded={open}
        onToggle={toggle}
        actionLabel="Add host"
        onAction={addHost}
      />
      {open
        ? hosts.map((host) => (
            <MachineRow
              key={host.serverId}
              serverId={host.serverId}
              label={host.label}
              role={machineRoleLabel(machines.find((item) => item.serverId === host.serverId))}
            />
          ))
        : null}
    </>
  );
}

function MachineRow({ serverId, label, role }: { serverId: string; label: string; role: string }) {
  const { palette: t } = useTheme();
  const connected = useHostRuntimeIsConnected(serverId);
  const open = useCallback(() => openHostOverview(serverId), [serverId]);
  const styles = useMemo(
    () => ({
      dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: connected ? t.success : t.textMuted,
      },
      name: type(t.textPrimary, 13, { fontWeight: "600" }),
      role: type(t.textSecondary, 10),
    }),
    [connected, t.success, t.textMuted, t.textPrimary, t.textSecondary],
  );
  return (
    <PressHighlight
      role="button"
      accessibilityLabel={`${label} settings`}
      onPress={open}
      style={ROW}
    >
      <View style={styles.dot} />
      <View style={BODY}>
        <Text numberOfLines={1} style={styles.name}>
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.role}>
          {connected ? role : `Offline · ${role}`}
        </Text>
      </View>
    </PressHighlight>
  );
}
