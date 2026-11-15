import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type {
  Assistant,
  Conversation,
  MachineInfo,
  Message,
  Task,
} from "../../../../../extensions/pavra/shared/contracts";
import { startTask } from "../../../../../extensions/pavra/shared/contracts";
import {
  type PromoteTaskTargetOption,
  TASK_BUDGET_PRESETS,
  buildPromoteToTaskInput,
  deriveTaskDraftFromMessage,
  resolvePromoteTaskTargets,
} from "../chat-actions";
import type { PavraData } from "../data";
import { Chip } from "./ChatChrome";
import { FormFrame, PavraField, PavraInput } from "./FormChrome";
import { OptionSelect } from "./OptionSelect";
import { useTheme } from "./ThemeProvider";
import { ctrlShadow, text as type } from "./theme";

export interface PromoteToTaskModalProps {
  message: Message;
  conversation: Conversation;
  assistants: readonly Assistant[];
  machines?: readonly MachineInfo[];
  defaultDirectory?: string;
  data?: Pick<PavraData, "call">;
  onStartTask?: (input: ReturnType<typeof buildPromoteToTaskInput>) => Promise<unknown> | unknown;
  onTaskCreated?: (taskId: string) => void;
  onClose: () => void;
}

function QuickTargetsList({
  targets,
  serverId,
  directory,
  isolation,
  onSelect,
}: {
  targets: readonly PromoteTaskTargetOption[];
  serverId: string;
  directory: string;
  isolation: Task["isolation"];
  onSelect: (target: PromoteTaskTargetOption) => void;
}) {
  const { palette: t, name } = useTheme();
  if (targets.length === 0) return null;
  return (
    <PavraField label="Authorized Workspace Targets">
      <View style={s.targetList}>
        {targets.map((target) => {
          const active =
            target.serverId === serverId &&
            target.directory === directory &&
            target.isolation === isolation;
          return (
            <Pressable
              key={target.key}
              accessibilityRole="button"
              onPress={() => onSelect(target)}
              style={({ pressed }) => [
                s.targetPill,
                {
                  borderColor: active ? t.retroBorder : t.retroBorderLight,
                  backgroundColor: active ? t.brandAccentSoft : t.surfacePrimary,
                  opacity: pressed ? 0.85 : 1,
                },
                active && ctrlShadow(t, name),
              ]}
            >
              <Text
                style={type(t.textPrimary, 11, {
                  fontWeight: active ? "700" : "500",
                })}
                numberOfLines={1}
              >
                {target.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </PavraField>
  );
}

export function PromoteToTaskModal({
  message,
  conversation,
  assistants,
  machines = [],
  defaultDirectory = "",
  data,
  onStartTask,
  onTaskCreated,
  onClose,
}: PromoteToTaskModalProps) {
  const { palette: t } = useTheme();
  const memberAssistants = useMemo(() => {
    const memberSet = new Set(conversation.members);
    const filtered = assistants.filter((assistant) => memberSet.has(assistant.id));
    return filtered.length > 0 ? filtered : [...assistants];
  }, [assistants, conversation.members]);

  const initialDraft = useMemo(
    () =>
      deriveTaskDraftFromMessage({
        message,
        conversation,
        assistants: memberAssistants,
      }),
    [message, conversation, memberAssistants],
  );

  const [title, setTitle] = useState(initialDraft.title);
  const [goal, setGoal] = useState(initialDraft.goal);
  const [assistantId, setAssistantId] = useState<string>(
    () => initialDraft.defaultAssistantId ?? memberAssistants[0]?.id ?? "",
  );

  const selectedAssistant = useMemo(
    () =>
      memberAssistants.find((assistant) => assistant.id === assistantId) ??
      memberAssistants[0] ??
      null,
    [memberAssistants, assistantId],
  );

  const quickTargets = useMemo(
    () =>
      resolvePromoteTaskTargets({
        assistant: selectedAssistant,
        defaultDirectory,
        defaultServerId: selectedAssistant?.serverId ?? machines[0]?.serverId ?? "local",
      }),
    [selectedAssistant, defaultDirectory, machines],
  );

  const [serverId, setServerId] = useState<string>(
    () =>
      quickTargets[0]?.serverId ?? selectedAssistant?.serverId ?? machines[0]?.serverId ?? "local",
  );
  const [directory, setDirectory] = useState<string>(
    () => quickTargets[0]?.directory ?? defaultDirectory,
  );
  const [directoryInputKey, setDirectoryInputKey] = useState(0);
  const [isolation, setIsolation] = useState<Task["isolation"]>(
    () => quickTargets[0]?.isolation ?? "worktree",
  );
  const [budgetMinutes, setBudgetMinutes] = useState<number>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTargetOption = (target: PromoteTaskTargetOption) => {
    setServerId(target.serverId);
    setDirectory(target.directory);
    setDirectoryInputKey((prev) => prev + 1);
    setIsolation(target.isolation);
  };

  const selectAssistant = (nextId: string) => {
    setAssistantId(nextId);
    const nextAssistant = memberAssistants.find((item) => item.id === nextId);
    const nextTargets = resolvePromoteTaskTargets({
      assistant: nextAssistant,
      defaultDirectory,
      defaultServerId: nextAssistant?.serverId ?? machines[0]?.serverId ?? "local",
    });
    if (nextTargets[0]) {
      applyTargetOption(nextTargets[0]);
    } else if (nextAssistant?.serverId) {
      setServerId(nextAssistant.serverId);
    }
  };

  const machineOptions = useMemo(() => {
    if (machines.length === 0) {
      return [{ value: serverId || "local", label: `${serverId || "local"} (coordinator)` }];
    }
    return machines.map((machine) => ({
      value: machine.serverId,
      label: `${machine.label} (${machine.role})`,
    }));
  }, [machines, serverId]);

  const canSubmit = Boolean(selectedAssistant && directory.trim() && goal.trim() && !busy);

  const handleStart = async () => {
    if (!selectedAssistant || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const taskId = randomUUID();
      const payload = buildPromoteToTaskInput({
        id: taskId,
        conversationId: conversation.id,
        assistant: selectedAssistant,
        title,
        goal,
        serverId,
        directory,
        isolation,
        budgetMinutes,
      });
      if (onStartTask) {
        await onStartTask(payload);
      } else if (data) {
        const ok = await data.call(startTask, payload);
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      onTaskCreated?.(taskId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <FormFrame title="Promote to Background Task" onClose={onClose}>
      <PavraField label="Task Title">
        <PavraInput
          key={`title:${message.id}`}
          initialValue={title}
          onChangeText={setTitle}
          placeholder="e.g. Fix flaky reconnect test"
        />
      </PavraField>

      <PavraField label="Goal & Instructions">
        <PavraInput
          key={`goal:${message.id}`}
          initialValue={goal}
          onChangeText={setGoal}
          placeholder="Describe what the background task should accomplish…"
          multiline
          style={s.goalInput}
        />
      </PavraField>

      <PavraField label="Assignee Assistant">
        <View style={s.chipRow}>
          {memberAssistants.map((assistant) => (
            <Chip
              key={assistant.id}
              accent={assistant.id === selectedAssistant?.id}
              onPress={() => selectAssistant(assistant.id)}
            >
              {assistant.name}
            </Chip>
          ))}
        </View>
      </PavraField>

      <QuickTargetsList
        targets={quickTargets}
        serverId={serverId}
        directory={directory}
        isolation={isolation}
        onSelect={applyTargetOption}
      />

      <View style={s.splitRow}>
        <View style={s.flexCol}>
          <PavraField label="Machine">
            <OptionSelect
              label="Machine"
              value={serverId}
              options={machineOptions}
              onSelect={setServerId}
            />
          </PavraField>
        </View>
        <View style={s.flexCol}>
          <PavraField label="Workspace Isolation">
            <View style={s.chipRow}>
              <Chip accent={isolation === "worktree"} onPress={() => setIsolation("worktree")}>
                Git Worktree
              </Chip>
              <Chip accent={isolation === "directory"} onPress={() => setIsolation("directory")}>
                In Directory
              </Chip>
            </View>
          </PavraField>
        </View>
      </View>

      <PavraField label="Target Directory">
        <PavraInput
          key={`dir:${directoryInputKey}`}
          initialValue={directory}
          onChangeText={setDirectory}
          placeholder="/Users/you/project"
        />
      </PavraField>

      <PavraField label="Time Budget">
        <View style={s.chipRow}>
          {TASK_BUDGET_PRESETS.map((preset) => (
            <Chip
              key={preset.minutes}
              accent={budgetMinutes === preset.minutes}
              onPress={() => setBudgetMinutes(preset.minutes)}
            >
              {preset.label}
            </Chip>
          ))}
        </View>
      </PavraField>

      {error ? (
        <View style={[s.errorBanner, { borderColor: t.destructive, backgroundColor: t.badgeRed }]}>
          <Text style={type(t.destructive, 11)}>{error}</Text>
        </View>
      ) : null}

      <View style={s.footerRow}>
        <Chip onPress={onClose} disabled={busy}>
          Cancel
        </Chip>
        <Chip accent disabled={!canSubmit} onPress={() => void handleStart()}>
          {busy ? "Starting…" : "Start Task"}
        </Chip>
      </View>
    </FormFrame>
  );
}

const s = StyleSheet.create({
  goalInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  targetList: {
    gap: 6,
  },
  targetPill: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  splitRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  flexCol: {
    flex: 1,
    minWidth: 180,
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingTop: 4,
  },
});
