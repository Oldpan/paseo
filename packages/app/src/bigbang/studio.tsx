import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { randomUUID } from "expo-crypto";
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
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  bindStudioWorkspace,
  saveStudio,
  setStudioAssistants,
  type Assistant,
  type Studio as StudioRecord,
  type Task,
  type Turn,
} from "../../../../extensions/bigbang/shared/contracts";
import { findLatestNonTaskTurn } from "./chat-studio";
import { studioForGroup } from "./peer-activity";
import { taskTitle } from "./task-view";

const FILL = { flex: 1, minHeight: 0 };
const HORIZONTAL = { flexDirection: "row", flex: 1 } as const;
const SCROLL_CONTENT = { flexGrow: 1 };
const MACHINES = { gap: 12 };

export function Studio({
  palette,
  active,
  data,
  coordinatorId,
  hostLabels,
  onAdd,
  onSidebar,
  onError,
}: {
  palette: Palette;
  active: boolean;
  /** The Chat ledger, which holds the Studios that collaborate across machines. */
  data: BigbangData;
  coordinatorId?: string;
  hostLabels?: Record<string, string>;
  onAdd(): void;
  onSidebar?(): void;
  onError?(error: string | null): void;
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
          <StudioHomePanel
            group={group}
            onGroupChange={setGroup}
            data={data}
            coordinatorId={coordinatorId}
            hostLabels={hostLabels}
            onError={onError}
          />
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

type StudioErrorHandler = (error: string | null) => void;
interface BoundWorkspace {
  serverId: string;
  workspaceId: string;
  name: string;
}

const createdStudios = new Map<string, StudioRecord>();
let bindQueue: Promise<void> = Promise.resolve();

function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function reportError(onError: StudioErrorHandler | undefined, message: string) {
  if (onError) onError(message);
  else console.warn(message);
}

function bindError(onError: StudioErrorHandler | undefined): StudioErrorHandler {
  return (message) => {
    if (message) reportError(onError, message);
  };
}

function isWorkspaceTaken(failure: unknown): boolean {
  return failureMessage(failure).includes("already belongs to another Studio");
}

function resolveStudio(data: BigbangData, group: string): StudioRecord | undefined {
  const fromState = studioForGroup(data.state.studios ?? [], group);
  if (fromState) {
    createdStudios.set(group, fromState);
    return fromState;
  }
  const cached = createdStudios.get(group);
  if (!cached) return undefined;
  const current = (data.state.studios ?? []).find((studio) => studio.id === cached.id);
  if (current && current.status !== "active") {
    createdStudios.delete(group);
    return undefined;
  }
  return cached;
}

function rememberStudio(group: string, studio: StudioRecord): StudioRecord {
  createdStudios.set(group, studio);
  return studio;
}

async function bindWorkspace(
  data: BigbangData,
  studio: StudioRecord,
  workspace: BoundWorkspace,
  boundKeys: Set<string>,
  optional: boolean,
): Promise<StudioRecord> {
  try {
    const next = await data.call(bindStudioWorkspace, {
      studioId: studio.id,
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      name: workspace.name,
    });
    boundKeys.add(studioKey(workspace));
    return next;
  } catch (failure: unknown) {
    if (optional && isWorkspaceTaken(failure)) return studio;
    throw failure;
  }
}

async function ensureStudioBindingLocked(
  data: BigbangData,
  group: string,
  input: { workspace?: BoundWorkspace; assistantId?: string },
): Promise<void> {
  let studio =
    resolveStudio(data, group) ??
    rememberStudio(
      group,
      await data.call(saveStudio, { id: `studio-${randomUUID()}`, name: group }),
    );
  const boundKeys = new Set((studio.workspaces ?? []).map((workspace) => studioKey(workspace)));
  if (input.workspace && !boundKeys.has(studioKey(input.workspace))) {
    studio = rememberStudio(
      group,
      await bindWorkspace(data, studio, input.workspace, boundKeys, false),
    );
  }
  if (input.assistantId) {
    const currentAssistantIds = studio.assistantIds ?? [];
    if (!currentAssistantIds.includes(input.assistantId)) {
      studio = rememberStudio(
        group,
        await data.call(setStudioAssistants, {
          studioId: studio.id,
          assistantIds: [...currentAssistantIds, input.assistantId],
        }),
      );
    }
  }
  const openGroupColumns = useBigbangView
    .getState()
    .columns.filter((column) => column.group === group);
  for (const column of openGroupColumns) {
    if (boundKeys.has(studioKey(column))) continue;
    studio = rememberStudio(group, await bindWorkspace(data, studio, column, boundKeys, true));
  }
}

export function ensureStudioBinding(
  data: BigbangData,
  group: string,
  input: { workspace?: BoundWorkspace; assistantId?: string },
): Promise<void> {
  const result = bindQueue.then(() => ensureStudioBindingLocked(data, group, input));
  bindQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function openWorkspaceColumn(input: {
  serverId: string;
  workspaceId: string;
  name: string;
  group: string;
  agentId?: string;
}) {
  if (input.agentId) {
    prepareWorkspaceTab(
      {
        serverId: input.serverId,
        workspaceId: input.workspaceId,
        target: { kind: "agent", agentId: input.agentId },
        pin: true,
      },
      { openTab: useWorkspaceLayoutStore.getState().deferOpenTab },
    );
  }
  useBigbangView.getState().openColumn({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    name: input.name,
    group: input.group,
  });
}

export async function openTurnProcess(
  turn: Turn,
  coordinatorId: string | undefined,
  setError: StudioErrorHandler,
  options?: { columnName?: string; group?: string; clearError?: boolean },
): Promise<boolean> {
  if (options?.clearError !== false) setError(null);
  const serverId = turn.serverId ?? coordinatorId ?? useBigbangView.getState().coordinatorId;
  const host = getHostRuntimeStore().getClient(serverId);
  if (!host) {
    setError("That assistant's machine is not connected in this app. Add it as a host first.");
    return false;
  }
  try {
    const result = await host.fetchAgent({ agentId: turn.agentId });
    if (!result?.agent.workspaceId) throw new Error("Execution workspace is not available yet.");
    const workspaceId = result.agent.workspaceId;
    openWorkspaceColumn({
      serverId,
      workspaceId,
      name: options?.columnName ?? "Assistant process",
      group: options?.group ?? "Chat",
      agentId: turn.agentId,
    });
    await getHostRuntimeStore().prepareWorkspaceRoute(serverId, workspaceId);
    return true;
  } catch (failure: unknown) {
    setError(failureMessage(failure));
    return false;
  }
}

function AssistantChoice({
  assistant,
  group,
  coordinatorId,
  hostLabels,
  data,
  onOpen,
  onError,
}: {
  assistant: Assistant;
  group: string;
  coordinatorId?: string;
  hostLabels?: Record<string, string>;
  data: BigbangData;
  onOpen?(): void;
  onError?: StudioErrorHandler;
}) {
  const hostLabel =
    hostLabels?.[assistant.serverId ?? coordinatorId ?? ""] ?? assistant.serverId ?? "Local";
  const detail = `${hostLabel} · ${assistant.provider}`;
  const onPress = useCallback(() => {
    void (async () => {
      try {
        await ensureStudioBinding(data, group, { assistantId: assistant.id });
        const turn = findLatestNonTaskTurn(data.state.turns, assistant.id);
        if (turn) {
          await openTurnProcess(turn, coordinatorId, bindError(onError), {
            columnName: `${assistant.name} · Chat`,
            group,
            clearError: false,
          });
        }
        onOpen?.();
      } catch (failure: unknown) {
        reportError(onError, failureMessage(failure));
      }
    })();
  }, [assistant.id, assistant.name, coordinatorId, data, group, onError, onOpen]);

  return <ResourceChoice onPress={onPress} label={assistant.name} detail={detail} />;
}

function TaskChoice({
  task,
  group,
  data,
  onOpen,
  onError,
}: {
  task: Task;
  group: string;
  data: BigbangData;
  onOpen?(): void;
  onError?: StudioErrorHandler;
}) {
  const assistantName =
    data.state.assistants.find((a) => a.id === task.assistantId)?.name ?? "Assistant";
  const title = taskTitle(task);
  const label = title.slice(0, 60);
  const detail = `${assistantName} · ${task.directory}`;
  const onPress = useCallback(() => {
    if (!task.execution) return;
    const execution = task.execution;
    const name = title.slice(0, 40);
    const workspace = {
      serverId: execution.serverId,
      workspaceId: execution.workspaceId,
      name,
    };
    void (async () => {
      try {
        openWorkspaceColumn({ ...workspace, group, agentId: execution.agentId });
        await getHostRuntimeStore().prepareWorkspaceRoute(
          execution.serverId,
          execution.workspaceId,
        );
        await ensureStudioBinding(data, group, { workspace });
        onOpen?.();
      } catch (failure: unknown) {
        reportError(onError, failureMessage(failure));
      }
    })();
  }, [data, group, onError, onOpen, task.execution, title]);

  return <ResourceChoice onPress={onPress} label={label} detail={detail} />;
}

function WorkspaceChoice({
  serverId,
  workspaceId,
  group,
  onOpen,
  data,
  onError,
}: {
  serverId: string;
  workspaceId: string;
  group: string;
  onOpen?(): void;
  data?: BigbangData;
  onError?: StudioErrorHandler;
}) {
  const workspace = useWorkspace(serverId, workspaceId);
  const open = useCallback(() => {
    const name = workspace?.title ?? workspaceId;
    void (async () => {
      try {
        openWorkspaceColumn({ serverId, workspaceId, name, group });
        if (data)
          await ensureStudioBinding(data, group, { workspace: { serverId, workspaceId, name } });
        onOpen?.();
      } catch (failure: unknown) {
        reportError(onError, failureMessage(failure));
      }
    })();
  }, [data, group, onError, onOpen, serverId, workspace?.title, workspaceId]);
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
  data,
  onError,
}: {
  serverId: string;
  label: string;
  group: string;
  onOpen?(): void;
  data?: BigbangData;
  onError?: StudioErrorHandler;
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
          data={data}
          onError={onError}
        />
      ))}
    </StudioMachine>
  );
}

/** Workspaces grouped by machine; choosing one opens it as a column in `group`. */
export function WorkspacePicker({
  group,
  onOpen,
  data,
  coordinatorId,
  hostLabels,
  onError,
}: {
  group: string;
  onOpen?(): void;
  data?: BigbangData;
  coordinatorId?: string;
  hostLabels?: Record<string, string>;
  onError?: StudioErrorHandler;
}) {
  const hosts = useHosts();
  const activeTasks = useMemo(
    () => (data ? data.state.tasks.filter((t) => Boolean(t.execution)) : []),
    [data],
  );
  return (
    <View style={MACHINES}>
      {data ? (
        <StudioMachine
          label="Assistants"
          connected={true}
          empty={!data.state.assistants.length}
          emptyLabel="No assistants yet."
        >
          {data.state.assistants.map((assistant) => (
            <AssistantChoice
              key={assistant.id}
              assistant={assistant}
              group={group}
              coordinatorId={coordinatorId}
              hostLabels={hostLabels}
              data={data}
              onOpen={onOpen}
              onError={onError}
            />
          ))}
        </StudioMachine>
      ) : null}
      {data && activeTasks.length > 0 ? (
        <StudioMachine label="Active Tasks" connected={true} empty={false}>
          {activeTasks.map((task) => (
            <TaskChoice
              key={task.id}
              task={task}
              group={group}
              data={data}
              onOpen={onOpen}
              onError={onError}
            />
          ))}
        </StudioMachine>
      ) : null}
      {hosts.map((host) => (
        <HostWorkspaces
          key={host.serverId}
          serverId={host.serverId}
          label={host.label}
          group={group}
          onOpen={onOpen}
          data={data}
          onError={onError}
        />
      ))}
    </View>
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
  data,
  coordinatorId,
  hostLabels,
  onError,
}: {
  group: string;
  onGroupChange(group: string): void;
  onClose?(): void;
  data?: BigbangData;
  coordinatorId?: string;
  hostLabels?: Record<string, string>;
  onError?: StudioErrorHandler;
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
      <WorkspacePicker
        group={group}
        onOpen={onClose}
        data={data}
        coordinatorId={coordinatorId}
        hostLabels={hostLabels}
        onError={onError}
      />
    </StudioHome>
  );
}
