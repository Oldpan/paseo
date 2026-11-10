// Member → Machines, after the Computes list in the Bigbang directory sidebar. Rows are this
// device's saved hosts; the Chat coordinator plays the Bigbang role.
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useAddHost } from "@/hosts/add-host";
import { openHostOverview } from "@/navigation/settings-navigation";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import type { Assistant, MachineInfo } from "../../../../extensions/bigbang/shared/contracts";
import { machineRoleLabel } from "./model";
import { AgentAvatar } from "./ui/avatars";
import { ChevronIcon, PlusIcon, SettingsIcon } from "./ui/icons";
import { SectionHeader } from "./ui/SidebarControls";
import { ctrlShadow, text as type } from "./ui/theme";
import { useTheme } from "./ui/ThemeProvider";

const BODY = { flex: 1, minWidth: 0 } as const;
const ROW_CONTAINER = { gap: 2, marginBottom: 4 } as const;
const ROW_HEADER = {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  paddingHorizontal: 8,
  paddingVertical: 6,
  borderRadius: 12,
} as const;
const ROW_TOGGLE = {
  flex: 1,
  minWidth: 0,
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
} as const;
const ACTIONS_GROUP = { flexDirection: "row", alignItems: "center", gap: 4 } as const;
const ASSISTANTS_LIST = { paddingLeft: 18, gap: 2 } as const;
const ASSISTANT_ROW = {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  borderRadius: 10,
  paddingHorizontal: 8,
  paddingVertical: 6,
} as const;
const ASSISTANT_TOGGLE = {
  flex: 1,
  minWidth: 0,
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
} as const;
const EXPANDED_STATE = { expanded: true } as const;
const COLLAPSED_STATE = { expanded: false } as const;

export function MachinesSection({
  machines,
  assistants,
  coordinatorId,
  onOpenAssistant,
  onEditAssistant,
  onCreateAssistant,
}: {
  machines: MachineInfo[];
  assistants: Assistant[];
  coordinatorId: string;
  onOpenAssistant(assistantId: string): void;
  onEditAssistant(assistantId: string): void;
  onCreateAssistant(serverId: string): void;
}) {
  const hosts = useHosts();
  const addHost = useAddHost();
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const entries = useMemo(() => {
    const savedIds = new Set(hosts.map((host) => host.serverId));
    return [
      ...hosts.map((host) => ({
        serverId: host.serverId,
        label: host.label,
        saved: true,
        machine: machines.find((item) => item.serverId === host.serverId),
      })),
      ...machines
        .filter((machine) => !savedIds.has(machine.serverId))
        .map((machine) => ({
          serverId: machine.serverId,
          label: machine.label,
          saved: false,
          machine,
        })),
    ];
  }, [hosts, machines]);
  return (
    <>
      <SectionHeader
        label="Machines"
        count={entries.length}
        expanded={open}
        onToggle={toggle}
        actionLabel="Add host"
        onAction={addHost}
      />
      {open
        ? entries.map((entry) => {
            const boundAssistants = assistants.filter(
              (assistant) => (assistant.serverId || coordinatorId) === entry.serverId,
            );
            return (
              <MachineRow
                key={entry.serverId}
                serverId={entry.serverId}
                label={entry.label}
                role={machineRoleLabel(entry.machine)}
                saved={entry.saved}
                relayConnected={Boolean(entry.machine)}
                boundAssistants={boundAssistants}
                onOpenAssistant={onOpenAssistant}
                onEditAssistant={onEditAssistant}
                onCreateAssistant={onCreateAssistant}
              />
            );
          })
        : null}
    </>
  );
}

function MachineRow({
  serverId,
  label,
  role,
  saved,
  relayConnected,
  boundAssistants,
  onOpenAssistant,
  onEditAssistant,
  onCreateAssistant,
}: {
  serverId: string;
  label: string;
  role: string;
  saved: boolean;
  relayConnected: boolean;
  boundAssistants: Assistant[];
  onOpenAssistant(assistantId: string): void;
  onEditAssistant(assistantId: string): void;
  onCreateAssistant(serverId: string): void;
}) {
  const { palette: t, name } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const directConnected = useHostRuntimeIsConnected(serverId);
  const connected = directConnected || relayConnected;
  const openOverview = useCallback(() => openHostOverview(serverId), [serverId]);
  const handleCreate = useCallback(
    () => onCreateAssistant(serverId),
    [onCreateAssistant, serverId],
  );
  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);

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
      emptyText: type(t.textMuted, 11, { paddingHorizontal: 8, paddingVertical: 4 }),
      actionButton: [
        {
          borderRadius: 8,
          width: 26,
          height: 26,
          alignItems: "center" as const,
          justifyContent: "center" as const,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
        },
        ctrlShadow(t, name),
      ],
    }),
    [connected, name, t],
  );

  return (
    <View style={ROW_CONTAINER}>
      <View style={ROW_HEADER}>
        <PressHighlight
          role="button"
          accessibilityLabel={`${label} machine`}
          accessibilityState={expanded ? EXPANDED_STATE : COLLAPSED_STATE}
          onPress={toggleExpanded}
          style={ROW_TOGGLE}
        >
          <ChevronIcon color={t.textSecondary} down={expanded} />
          <View style={styles.dot} />
          <View style={BODY}>
            <Text numberOfLines={1} style={styles.name}>
              {label}
            </Text>
            <Text numberOfLines={1} style={styles.role}>
              {`${connected ? role : `Offline · ${role}`} · ${boundAssistants.length} ${boundAssistants.length === 1 ? "agent" : "agents"}`}
            </Text>
          </View>
        </PressHighlight>
        <View style={ACTIONS_GROUP}>
          <PressHighlight
            role="button"
            accessibilityLabel={`New assistant on ${label}`}
            onPress={handleCreate}
            style={styles.actionButton}
          >
            <PlusIcon color={t.textSecondary} size={13} />
          </PressHighlight>
          {saved ? (
            <PressHighlight
              role="button"
              accessibilityLabel={`${label} settings`}
              onPress={openOverview}
              style={styles.actionButton}
            >
              <SettingsIcon color={t.textSecondary} size={13} />
            </PressHighlight>
          ) : null}
        </View>
      </View>
      {expanded ? (
        <View style={ASSISTANTS_LIST}>
          {boundAssistants.length > 0 ? (
            boundAssistants.map((assistant) => (
              <MachineAssistantRow
                key={assistant.id}
                assistant={assistant}
                onOpenAssistant={onOpenAssistant}
                onEditAssistant={onEditAssistant}
              />
            ))
          ) : (
            <Text style={styles.emptyText}>No assistants on this machine</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function MachineAssistantRow({
  assistant,
  onOpenAssistant,
  onEditAssistant,
}: {
  assistant: Assistant;
  onOpenAssistant(assistantId: string): void;
  onEditAssistant(assistantId: string): void;
}) {
  const { palette: t, name } = useTheme();
  const handleOpen = useCallback(
    () => onOpenAssistant(assistant.id),
    [assistant.id, onOpenAssistant],
  );
  const handleEdit = useCallback(
    () => onEditAssistant(assistant.id),
    [assistant.id, onEditAssistant],
  );

  const styles = useMemo(
    () => ({
      name: type(t.textPrimary, 12, { fontWeight: "600" }),
      provider: type(t.textSecondary, 10),
      actionButton: [
        {
          borderRadius: 8,
          width: 26,
          height: 26,
          alignItems: "center" as const,
          justifyContent: "center" as const,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
        },
        ctrlShadow(t, name),
      ],
    }),
    [name, t],
  );

  return (
    <View style={ASSISTANT_ROW}>
      <PressHighlight
        role="button"
        accessibilityLabel={`Chat with ${assistant.name}`}
        onPress={handleOpen}
        style={ASSISTANT_TOGGLE}
      >
        <AgentAvatar
          seed={`${assistant.id}:${assistant.name}`}
          label={assistant.name}
          size={24}
          theme={t}
          name={name}
        />
        <View style={BODY}>
          <Text numberOfLines={1} style={styles.name}>
            {assistant.name}
          </Text>
          <Text numberOfLines={1} style={styles.provider}>
            {assistant.provider}
          </Text>
        </View>
      </PressHighlight>
      <PressHighlight
        role="button"
        accessibilityLabel={`Edit ${assistant.name}`}
        onPress={handleEdit}
        style={styles.actionButton}
      >
        <SettingsIcon color={t.textSecondary} size={13} />
      </PressHighlight>
    </View>
  );
}
