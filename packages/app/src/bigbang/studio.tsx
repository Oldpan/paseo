import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { ResourceChoice } from "./ui/ResourceChoice";
import { StudioHome, StudioMachine } from "./ui/StudioHome";
import { RetainedPanel } from "@/components/retained-panel";
import { WorkspaceScreen } from "@/screens/workspace/workspace-screen";
import { useWorkspace, useWorkspaceKeys } from "@/stores/session-store-hooks";
import { getHostRuntimeStore, useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useBigbangView } from "./store";
import { StudioBar, WorkspaceChrome } from "./ui/StudioChrome";
import { studioKey, type StudioColumn } from "./model";
import type { Palette } from "./palette";
import type { BigbangData } from "./data";
import { Collaboration } from "./collaboration";

const FILL = { flex: 1, minHeight: 0 };
const HORIZONTAL = { flexDirection: "row", flex: 1 } as const;
const SCROLL_CONTENT = { flexGrow: 1 };
const MACHINES = { gap: 12 };

export function Studio({
  palette,
  active,
  data,
  onAdd,
  onSidebar,
}: {
  palette: Palette;
  active: boolean;
  /** The Chat ledger, which holds the Studios that collaborate across machines. */
  data: BigbangData;
  onAdd(): void;
  onSidebar?(): void;
}) {
  const [collaborating, setCollaborating] = useState(false);
  const [group, setGroup] = useState("General");
  const openCollaboration = useCallback(() => setCollaborating(true), []);
  const closeCollaboration = useCallback(() => setCollaborating(false), []);
  const columns = useBigbangView((state) => state.columns);
  const activeKey = useBigbangView((state) => state.activeColumn);
  const compact = useIsCompactFormFactor();
  const frame = useMemo(
    () => ({ flex: 1, minHeight: 0, backgroundColor: palette.surfacePrimary }),
    [palette.surfacePrimary],
  );
  const focus = useCallback((key: string) => useBigbangView.getState().focusColumn(key), []);
  const close = useCallback((key: string) => useBigbangView.getState().removeColumn(key), []);
  const activeGroup = columns.find((column) => studioKey(column) === activeKey)?.group ?? "General";
  return (
    <View style={frame}>
      <StudioBar
        columns={columns}
        active={activeKey}
        onFocus={focus}
        onClose={close}
        onAdd={onAdd}
        onSidebar={onSidebar}
        onCollaborate={openCollaboration}
      />
      <View style={HORIZONTAL}>
        {columns.length ? (
          <ScrollView horizontal style={FILL} contentContainerStyle={SCROLL_CONTENT}>
            <View style={HORIZONTAL}>
              {columns.map((column) => (
                <StudioWorkspace
                  key={studioKey(column)}
                  column={column}
                  palette={palette}
                  compact={compact}
                  selected={studioKey(column) === activeKey}
                  visible={
                    active &&
                    (compact ? studioKey(column) === activeKey : column.group === activeGroup)
                  }
                />
              ))}
            </View>
          </ScrollView>
        ) : (
          <StudioHomePanel group={group} onGroupChange={setGroup} />
        )}
        {collaborating ? (
          <Collaboration
            data={data}
            group={activeGroup}
            columns={columns}
            compact={compact}
            onClose={closeCollaboration}
          />
        ) : null}
      </View>
    </View>
  );
}

function StudioWorkspace({
  column,
  palette,
  compact,
  selected,
  visible,
}: {
  column: StudioColumn;
  palette: Palette;
  compact: boolean;
  selected: boolean;
  visible: boolean;
}) {
  const connected = useHostRuntimeIsConnected(column.serverId);
  const hosts = useHosts();
  const hostLabel =
    hosts.find((host) => host.serverId === column.serverId)?.label ?? column.serverId;
  const frame = useMemo(
    () => ({
      width: compact ? ("100%" as const) : 640,
      minWidth: compact ? 0 : 360,
      flex: 1,
      borderWidth: 1,
      borderColor: selected ? palette.brandAccent : palette.retroBorderLight,
    }),
    [compact, palette, selected],
  );
  const focus = useCallback(
    () => useBigbangView.getState().focusColumn(studioKey(column)),
    [column],
  );
  return (
    <RetainedPanel active={visible} style={frame}>
      <WorkspaceChrome
        label={`${hostLabel} / ${column.name}`}
        connected={connected}
        selected={selected}
        onFocus={focus}
      >
        <WorkspaceScreen
          serverId={column.serverId}
          workspaceId={column.workspaceId}
          isRouteFocused={visible && selected}
        />
      </WorkspaceChrome>
    </RetainedPanel>
  );
}

/**
 * Studio's home with the machines' workspaces. `onClose` is set when the home covers open columns;
 * it closes once a workspace opens, from the list or from Add project and Import session.
 */
export function StudioHomePanel({
  group,
  onGroupChange,
  onClose,
}: {
  group: string;
  onGroupChange(group: string): void;
  onClose?(): void;
}) {
  useEffect(() => {
    if (!onClose) return;
    return useBigbangView.subscribe((state, previous) => {
      if (state.columns !== previous.columns || state.activeColumn !== previous.activeColumn)
        onClose();
    });
  }, [onClose]);
  return (
    <StudioHome group={group} onGroupChange={onGroupChange} onClose={onClose}>
      <WorkspacePicker group={group} onOpen={onClose} />
    </StudioHome>
  );
}

function WorkspaceChoice({
  serverId,
  workspaceId,
  group,
  onOpen,
}: {
  serverId: string;
  workspaceId: string;
  group: string;
  onOpen?(): void;
}) {
  const workspace = useWorkspace(serverId, workspaceId);
  const open = useCallback(() => {
    useBigbangView
      .getState()
      .openColumn({ serverId, workspaceId, name: workspace?.title ?? workspaceId, group });
    onOpen?.();
  }, [group, onOpen, serverId, workspace?.title, workspaceId]);
  if (!workspace) return null;
  return (
    <ResourceChoice
      onPress={open}
      label={workspace.title || workspace.workspaceDirectory || workspaceId}
      detail={workspace.workspaceDirectory}
    />
  );
}
function HostWorkspaces({
  serverId,
  label,
  group,
  onOpen,
}: {
  serverId: string;
  label: string;
  group: string;
  onOpen?(): void;
}) {
  const keys = useWorkspaceKeys(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  useEffect(() => getHostRuntimeStore().acquireDirectoryDemand(serverId), [serverId]);
  return (
    <StudioMachine label={label} connected={connected} empty={!keys.length}>
      {keys.map((key) => (
        <WorkspaceChoice
          key={key}
          serverId={serverId}
          workspaceId={key}
          group={group}
          onOpen={onOpen}
        />
      ))}
    </StudioMachine>
  );
}
/** Workspaces grouped by machine; choosing one opens it as a column in `group`. */
export function WorkspacePicker({ group, onOpen }: { group: string; onOpen?(): void }) {
  const hosts = useHosts();
  return (
    <View style={MACHINES}>
      {hosts.map((host) => (
        <HostWorkspaces
          key={host.serverId}
          serverId={host.serverId}
          label={host.label}
          group={group}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}
