import { useCallback, useMemo, useState } from "react";
import {
  deleteRoutine,
  pauseRoutine,
  resumeRoutine,
  runRoutineOnce,
  saveRoutine,
  type Assistant,
  type Conversation,
  type Message,
  type Routine,
  type RoutineCadence,
  type RoutineRun,
  type Turn,
} from "../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "./data";
import { errorText } from "./memory";

export interface RoutinesModel {
  routines: Routine[];
  busyId: string | null;
  saving: boolean;
  error: string | null;
  create(input: {
    name: string;
    prompt: string;
    cadence: RoutineCadence;
    maxRuns?: number | null;
    expiresAt?: number | null;
    assistantId?: string;
    conversationId?: string;
    threadId?: string | null;
  }): Promise<Routine | null>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  runOnce(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function formatRoutineCadence(cadence: RoutineCadence): string {
  if (cadence.type === "cron") {
    return cadence.timezone
      ? `Cron ${cadence.expression} (${cadence.timezone})`
      : `Cron ${cadence.expression}`;
  }
  const ms = cadence.everyMs;
  if (ms % 86_400_000 === 0) {
    const days = ms / 86_400_000;
    return days === 1 ? "Every day" : `Every ${days}d`;
  }
  if (ms % 3_600_000 === 0) {
    const hours = ms / 3_600_000;
    return hours === 1 ? "Every hour" : `Every ${hours}h`;
  }
  if (ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return minutes === 1 ? "Every minute" : `Every ${minutes}m`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds === 1 ? "Every second" : `Every ${seconds}s`;
}

export function formatRoutineOutcome(run: RoutineRun | null | undefined): string {
  if (!run) return "Never run";
  if (run.status === "running") return "Running…";
  switch (run.outcome) {
    case "replied":
      return run.summary ? `Replied · ${run.summary}` : "Replied";
    case "passed":
      return "Silent ((pass))";
    case "skipped":
      return run.summary ?? "Skipped";
    case "failed":
      return run.error ? `Failed · ${run.error}` : (run.summary ?? "Failed");
    default:
      return run.status === "failed" ? (run.error ?? "Failed") : "Succeeded";
  }
}

export function routineKindLabel(routine: Pick<Routine, "maxRuns">): "Reminder" | "Routine" {
  return routine.maxRuns === 1 ? "Reminder" : "Routine";
}

export function routineTargetLabel(
  routine: Pick<Routine, "assistantId" | "conversationId">,
  assistants: readonly Assistant[],
  conversations: readonly Conversation[],
): string {
  const assistant = assistants.find((item) => item.id === routine.assistantId);
  const conversation = conversations.find((item) => item.id === routine.conversationId);
  const assistantLabel = assistant?.name ?? "Assistant";
  if (!conversation) return `${assistantLabel} · ${routine.conversationId}`;
  const conversationLabel =
    conversation.kind === "group" && !conversation.name.startsWith("#")
      ? `#${conversation.name}`
      : conversation.name;
  return `${assistantLabel} · ${conversationLabel}`;
}

export function formatMessageRoutineBadge(
  message: Pick<Message, "routineId" | "routineName">,
  turn?: Pick<Turn, "kind" | "routineName">,
): string | undefined {
  if (message.routineName) return `Routine · ${message.routineName}`;
  if (message.routineId || turn?.kind === "routine") {
    return `Routine · ${turn?.routineName ?? "Routine"}`;
  }
  return undefined;
}

export function useAssistantRoutines(
  data: Pick<PavraData, "state" | "call" | "connected">,
  assistantId?: string,
  conversationId?: string,
): RoutinesModel {
  const { call, state } = data;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(() => new Set());

  const routines = useMemo(() => {
    const all = state.routines ?? [];
    return all
      .filter(
        (routine) =>
          !deletedIds.has(routine.id) &&
          (assistantId === undefined || routine.assistantId === assistantId) &&
          (conversationId === undefined || routine.conversationId === conversationId),
      )
      .toSorted((a, b) => b.createdAt - a.createdAt);
  }, [assistantId, conversationId, deletedIds, state.routines]);

  const create = useCallback<RoutinesModel["create"]>(
    async (input) => {
      const targetAssistantId = input.assistantId ?? assistantId;
      const targetConversationId = input.conversationId ?? conversationId;
      if (!targetAssistantId || !targetConversationId) {
        setError("Choose an assistant and a chat before creating a routine.");
        return null;
      }
      setSaving(true);
      setError(null);
      try {
        return await call(saveRoutine, {
          name: input.name.trim(),
          prompt: input.prompt.trim(),
          assistantId: targetAssistantId,
          conversationId: targetConversationId,
          threadId: input.threadId ?? null,
          cadence: input.cadence,
          ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        });
      } catch (failure) {
        setError(errorText(failure));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [assistantId, call, conversationId],
  );

  const runAction = useCallback(async (id: string, work: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusyId((current) => (current === id ? null : current));
    }
  }, []);

  const pause = useCallback(
    async (id: string) => {
      await runAction(id, () => call(pauseRoutine, { id }));
    },
    [call, runAction],
  );

  const resume = useCallback(
    async (id: string) => {
      await runAction(id, () => call(resumeRoutine, { id }));
    },
    [call, runAction],
  );

  const runOnce = useCallback(
    async (id: string) => {
      await runAction(id, () => call(runRoutineOnce, { id }));
    },
    [call, runAction],
  );

  const remove = useCallback(
    async (id: string) => {
      await runAction(id, async () => {
        await call(deleteRoutine, { id });
        setDeletedIds((previous) => {
          const next = new Set(previous);
          next.add(id);
          return next;
        });
      });
    },
    [call, runAction],
  );

  return {
    routines,
    busyId,
    saving,
    error,
    create,
    pause,
    resume,
    runOnce,
    remove,
  };
}
