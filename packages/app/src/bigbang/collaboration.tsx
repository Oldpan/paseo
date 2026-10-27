import { useCallback, useMemo, useState } from "react";
import { randomUUID } from "expo-crypto";
import { useHosts } from "@/runtime/host-runtime";
import {
  bindStudioWorkspace,
  saveStudio,
  setStudioAssistants,
  unbindStudioWorkspace,
} from "../../../../extensions/bigbang/shared/contracts";
import type { BigbangData } from "./data";
import { studioKey, type StudioColumn } from "./model";
import { studioForGroup, studioRecords } from "./peer-activity";
import { CollaborationPanel, type CollaborationToggle } from "./ui/CollaborationPanel";

/**
 * The Studio that collaborates for a tab group. Tab groups are this device's layout; the Studio
 * (its bound workspaces and linked assistants) lives in the Chat ledger and is shared.
 */
export function Collaboration({
  data,
  group,
  columns,
  compact,
  onClose,
}: {
  data: BigbangData;
  group: string;
  columns: StudioColumn[];
  compact: boolean;
  onClose(): void;
}) {
  const hosts = useHosts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const studio = studioForGroup(data.state.studios ?? [], group);
  const run = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, []);
  const groupColumns = useMemo(
    () => columns.filter((column) => column.group === group),
    [columns, group],
  );
  const enable = useCallback(
    () =>
      void run(async () => {
        const created = await data.call(saveStudio, { id: `studio-${randomUUID()}`, name: group });
        for (const column of groupColumns)
          await data.call(bindStudioWorkspace, {
            studioId: created.id,
            serverId: column.serverId,
            workspaceId: column.workspaceId,
            name: column.name,
          });
      }),
    [data, group, groupColumns, run],
  );
  const workspaces = useMemo<CollaborationToggle[]>(() => {
    if (!studio) return [];
    const bound = new Set(studio.workspaces.map((workspace) => studioKey(workspace)));
    const label = (serverId: string) =>
      hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
    const shown = [
      ...groupColumns.map((column) => ({ ...column, name: column.name })),
      ...studio.workspaces.filter(
        (workspace) => !groupColumns.some((column) => studioKey(column) === studioKey(workspace)),
      ),
    ];
    return shown.map((workspace) => {
      const on = bound.has(studioKey(workspace));
      return {
        key: studioKey(workspace),
        label: workspace.name,
        detail: label(workspace.serverId),
        on,
        onToggle: () =>
          void run(() =>
            on
              ? data.call(unbindStudioWorkspace, {
                  serverId: workspace.serverId,
                  workspaceId: workspace.workspaceId,
                })
              : data.call(bindStudioWorkspace, {
                  studioId: studio.id,
                  serverId: workspace.serverId,
                  workspaceId: workspace.workspaceId,
                  name: workspace.name,
                }),
          ),
      };
    });
  }, [data, groupColumns, hosts, run, studio]);
  const assistants = useMemo<CollaborationToggle[]>(() => {
    if (!studio) return [];
    const linked = new Set(studio.assistantIds ?? []);
    return data.state.assistants.map((assistant) => {
      const on = linked.has(assistant.id);
      const next = on ? [...linked].filter((id) => id !== assistant.id) : [...linked, assistant.id];
      return {
        key: assistant.id,
        label: assistant.name,
        on,
        onToggle: () =>
          void run(() =>
            data.call(setStudioAssistants, { studioId: studio.id, assistantIds: next }),
          ),
      };
    });
  }, [data, run, studio]);
  const records = useMemo(
    () => (studio ? studioRecords(data.state.peerMessages ?? [], studio) : []),
    [data.state.peerMessages, studio],
  );
  return (
    <CollaborationPanel
      group={group}
      enabled={Boolean(studio)}
      onEnable={enable}
      workspaces={workspaces}
      assistants={assistants}
      records={records}
      error={error}
      busy={busy}
      onClose={onClose}
      width={compact ? "100%" : 380}
    />
  );
}
