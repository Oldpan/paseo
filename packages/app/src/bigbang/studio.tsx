import { useCallback, useEffect, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { ResourceChoice } from "./ui/ResourceChoice";
import { RetainedPanel } from "@/components/retained-panel";
import { WorkspaceScreen } from "@/screens/workspace/workspace-screen";
import { useWorkspace, useWorkspaceKeys } from "@/stores/session-store-hooks";
import { getHostRuntimeStore, useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useBigbangView } from "./store";
import { StudioBar, WorkspaceChrome, StudioEmpty } from "./ui/StudioChrome";
import { studioKey, type StudioColumn } from "./model";
import type { Palette } from "./palette";

const FILL = { flex: 1, minHeight: 0 };
const HORIZONTAL = { flexDirection: "row", flex: 1 } as const;
const SCROLL_CONTENT = { flexGrow: 1 };

export function Studio({
  palette,
  active,
  onAdd,
  onSidebar,
}: {
  palette: Palette;
  active: boolean;
  onAdd(): void;
  onSidebar?(): void;
}) {
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
      />
      {!columns.length ? <StudioEmpty onAdd={onAdd} /> : null}
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
                active && (compact ? studioKey(column) === activeKey : column.group === activeGroup)
              }
            />
          ))}
        </View>
      </ScrollView>
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

function WorkspaceChoice({
  serverId,
  workspaceId,
  palette: _palette,
  group,
}: {
  serverId: string;
  workspaceId: string;
  palette: Palette;
  group: string;
}) {
  const workspace = useWorkspace(serverId, workspaceId);
  const open = useCallback(
    () =>
      useBigbangView
        .getState()
        .openColumn({ serverId, workspaceId, name: workspace?.title ?? workspaceId, group }),
    [group, serverId, workspace?.title, workspaceId],
  );
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
  palette,
  group,
}: {
  serverId: string;
  label: string;
  palette: Palette;
  group: string;
}) {
  const keys = useWorkspaceKeys(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const text = useMemo(() => ({ color: palette.textPrimary, padding: 8 }), [palette.textPrimary]);
  useEffect(() => getHostRuntimeStore().acquireDirectoryDemand(serverId), [serverId]);
  return (
    <View>
      <Text style={text}>
        {label}
        {connected ? "" : " · offline"}
      </Text>
      {keys.map((key) => (
        <WorkspaceChoice
          key={key}
          serverId={serverId}
          workspaceId={key}
          palette={palette}
          group={group}
        />
      ))}
    </View>
  );
}
export function WorkspacePicker({ palette, group }: { palette: Palette; group: string }) {
  const hosts = useHosts();
  return (
    <ScrollView style={FILL}>
      {hosts.map((host) => (
        <HostWorkspaces
          key={host.serverId}
          serverId={host.serverId}
          label={host.label}
          palette={palette}
          group={group}
        />
      ))}
    </ScrollView>
  );
}
