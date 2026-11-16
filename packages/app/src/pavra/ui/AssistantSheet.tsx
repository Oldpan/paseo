import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  createConversation,
  saveAssistant,
  type Assistant,
  type AssistantToolFamily,
  type MachineInfo,
  type Turn,
} from "../../../../../extensions/pavra/shared/contracts";
import { normalizeAutonomy, parseAutonomy, serializeAutonomy, validateAutonomy } from "../autonomy";
import type { PavraData } from "../data";
import {
  ASSISTANT_TOOL_FAMILIES,
  type TokenUsageSnapshot,
  formatEnvVarsText,
  isAssistantToolEnabled,
  normalizeDisabledTools,
  parseEnvVarsText,
  toggleAssistantToolFamily,
} from "../token-usage";
import { AutonomyEditor, type HostOption } from "./AutonomyEditor";
import { Chip } from "./ChatChrome";
import { ContextUsageBar, useAssistantContextUsage } from "./ContextUsageBar";
import { FormActions, FormFrame, PavraField, PavraInput } from "./FormChrome";
import { OptionSelect } from "./OptionSelect";
import { useTheme } from "./ThemeProvider";
import { ctrlShadow, text as type } from "./theme";

export interface AssistantSheetProps {
  assistant?: Assistant | null;
  editing?: string | null;
  coordinatorId: string;
  hosts?: ReadonlyArray<{ serverId: string; label: string }>;
  machines?: readonly MachineInfo[];
  defaultServerId?: string | null;
  turns?: readonly Turn[];
  contextUsage?: TokenUsageSnapshot | AgentUsage | null;
  onRequestCompact?: () => void;
  data?: Pick<PavraData, "call" | "state">;
  onSave?: (
    assistant: Assistant,
    extra: { isNew: boolean; chatId: string },
  ) => Promise<void> | void;
  onCreatedChat?: (chatId: string) => void;
  onClose: () => void;
}

function buildMachineOptions(params: {
  machines: readonly MachineInfo[];
  hosts: ReadonlyArray<{ serverId: string; label: string }>;
  machineId: string;
}) {
  const { machines, hosts, machineId } = params;
  const options = machines
    .filter((machine) => machine.role === "coordinator" || machine.role === "member")
    .map((machine) => ({
      value: machine.serverId,
      label: machine.label,
    }));
  if (!options.some((item) => item.value === machineId)) {
    options.unshift({
      value: machineId,
      label: hosts.find((host) => host.serverId === machineId)?.label ?? machineId,
    });
  }
  return options;
}

function resolveEditingAssistant(
  assistantProp: Assistant | null | undefined,
  editing: string | null,
  assistants: readonly Assistant[] | undefined,
): Assistant | null {
  if (assistantProp) return assistantProp;
  if (editing && assistants) {
    return assistants.find((item) => item.id === editing) ?? null;
  }
  return null;
}

function validateAssistantDraft(input: {
  assistantId: string;
  isEditing: boolean;
  resolvedAssistant: Assistant | null;
  coordinatorId: string;
  serverId: string;
  name: string;
  provider: string;
  persona: string;
  memory: string;
  autonomyValue: string;
  autonomyHosts: readonly HostOption[];
  envVarsText: string;
  disabledTools: readonly AssistantToolFamily[] | undefined;
}): { payload?: Assistant; error?: string } {
  const trimmedName = input.name.trim();
  const trimmedProvider = input.provider.trim();
  if (!trimmedName) return { error: "Enter a name for this assistant." };
  if (!trimmedProvider || !/^[^/]+\/.+$/.test(trimmedProvider)) {
    return { error: "Choose a provider / model (e.g. codex/gpt-5)." };
  }
  const parsedEnv = parseEnvVarsText(input.envVarsText);
  if (parsedEnv.invalidLines.length > 0) {
    return {
      error: `Fix invalid environment variable line(s): ${parsedEnv.invalidLines.join(", ")}`,
    };
  }
  const autonomy = parseAutonomy(input.autonomyValue);
  const knownHostIds = input.autonomyHosts.map((host) => host.value);
  if (knownHostIds.length > 0) {
    const problem = validateAutonomy(
      autonomy,
      knownHostIds,
      (targetServerId) =>
        input.autonomyHosts.find((host) => host.value === targetServerId)?.label ?? targetServerId,
    );
    if (problem) return { error: problem };
  }
  const normalizedAutonomy = normalizeAutonomy(
    autonomy,
    (targetServerId) => input.autonomyHosts.find((host) => host.value === targetServerId)?.label,
  );
  const effectiveServerId = input.isEditing ? input.resolvedAssistant?.serverId : input.serverId;
  const normalizedTools = normalizeDisabledTools(input.disabledTools);
  return {
    payload: {
      id: input.assistantId,
      name: trimmedName,
      provider: trimmedProvider,
      persona: input.persona,
      ...(effectiveServerId && effectiveServerId !== input.coordinatorId
        ? { serverId: effectiveServerId }
        : {}),
      ...(normalizedAutonomy ? { autonomy: normalizedAutonomy } : {}),
      ...(input.resolvedAssistant?.browser ? { browser: input.resolvedAssistant.browser } : {}),
      ...(input.isEditing ? {} : { memory: input.memory }),
      envVars: parsedEnv.envVars,
      disabledTools: normalizedTools ?? [],
    },
  };
}

async function persistAssistantSubmission(params: {
  payload: Assistant;
  isEditing: boolean;
  chatId: string;
  data?: Pick<PavraData, "call" | "state">;
  onSave?: AssistantSheetProps["onSave"];
  onCreatedChat?: (chatId: string) => void;
}): Promise<boolean> {
  const { payload, isEditing, chatId, data, onSave, onCreatedChat } = params;
  if (onSave) {
    await onSave(payload, { isNew: !isEditing, chatId });
    return true;
  }
  if (!data) return true;
  const saved = await data.call(saveAssistant, payload);
  if (!saved) return false;
  if (!isEditing) {
    const created = await data.call(createConversation, {
      id: chatId,
      name: payload.name,
      kind: "dm",
      members: [payload.id],
      roundtable: false,
    });
    if (created && onCreatedChat) onCreatedChat(created.id);
  }
  return true;
}

function ProviderModelField({
  serverId,
  value,
  disabled,
  onChange,
}: {
  serverId: string;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const models = useProvidersSnapshot(serverId);
  const options = useMemo(() => {
    const list = (models.entries ?? []).flatMap((entry) =>
      (entry.models ?? [])
        .filter((model) => model.isSelectable !== false)
        .map((model) => ({
          value: `${entry.provider}/${model.id}`,
          label: `${entry.label ?? entry.provider} · ${model.label}`,
        })),
    );
    if (value && !list.some((item) => item.value === value)) {
      list.unshift({ value, label: value });
    }
    return list;
  }, [models.entries, value]);
  const refresh = useCallback(() => {
    models.refetchIfStale();
  }, [models]);
  return (
    <PavraField label="Provider / model">
      <View style={s.providerWrap}>
        <OptionSelect
          label="Provider / model"
          value={value}
          options={options}
          onSelect={onChange}
          emptyLabel="Choose…"
          disabled={disabled || models.isLoading}
        />
        <View style={s.refreshRow}>
          <Chip onPress={refresh} disabled={disabled}>
            Refresh models
          </Chip>
        </View>
      </View>
    </PavraField>
  );
}

function ToolPermissionsSection({
  disabledTools,
  disabled,
  onToggle,
}: {
  disabledTools: readonly AssistantToolFamily[] | undefined;
  disabled: boolean;
  onToggle: (family: AssistantToolFamily) => void;
}) {
  const { palette: t, name } = useTheme();
  const blockedCount = disabledTools?.length ?? 0;
  return (
    <PavraField label="Capabilities & Tool Permissions">
      <View
        testID="assistant-tool-permissions"
        style={[
          s.sectionBox,
          {
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
          },
        ]}
      >
        <View style={s.sectionHeaderRow}>
          <Text style={type(t.textMuted, 11)}>
            Toggle which Pavra tool families this assistant is allowed to use in chat turns.
          </Text>
          <Text style={type(t.textSecondary, 10, { fontWeight: "700" })}>
            {blockedCount === 0 ? "All enabled" : `${blockedCount} disabled`}
          </Text>
        </View>
        <View style={s.toolGrid}>
          {ASSISTANT_TOOL_FAMILIES.map((family) => {
            const enabled = isAssistantToolEnabled(family.id, disabledTools);
            return (
              <Pressable
                key={family.id}
                testID={`assistant-tool-toggle-${family.id}`}
                accessibilityRole="switch"
                accessibilityLabel={family.label}
                accessibilityState={{ checked: enabled, disabled }}
                disabled={disabled}
                onPress={() => onToggle(family.id)}
                style={({ pressed }) => [
                  s.toolCard,
                  {
                    borderColor: enabled ? t.retroBorder : t.retroBorderLight,
                    backgroundColor: enabled ? t.brandAccentMuted : t.surfacePrimary,
                    opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
                  },
                  enabled && ctrlShadow(t, name),
                ]}
              >
                <View style={s.toolTopRow}>
                  <View
                    style={[
                      s.checkbox,
                      {
                        borderColor: t.retroBorder,
                        backgroundColor: enabled ? t.brandAccent : t.surfacePrimary,
                      },
                    ]}
                  >
                    {enabled ? (
                      <Text style={type(t.onAccent, 10, { fontWeight: "800" })}>✓</Text>
                    ) : null}
                  </View>
                  <Text style={type(t.textPrimary, 12, { fontWeight: "700", flex: 1 })}>
                    {family.shortLabel}
                  </Text>
                  <Text
                    style={type(enabled ? t.success : t.textMuted, 10, {
                      fontWeight: "800",
                    })}
                  >
                    {enabled ? "On" : "Off"}
                  </Text>
                </View>
                <Text style={type(t.textMuted, 10)}>{family.description}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </PavraField>
  );
}

function EnvVarsSection({
  editorKey,
  envVarsText,
  disabled,
  onChangeText,
}: {
  editorKey: string;
  envVarsText: string;
  disabled: boolean;
  onChangeText: (next: string) => void;
}) {
  const { palette: t } = useTheme();
  const parsed = useMemo(() => parseEnvVarsText(envVarsText), [envVarsText]);
  const envCount = Object.keys(parsed.envVars).length;
  return (
    <PavraField label="Environment Variables (KEY=VALUE per line)">
      <View style={s.envWrap}>
        <PavraInput
          key={`env:${editorKey}`}
          testID="assistant-env-vars-input"
          accessibilityLabel="Environment Variables (KEY=VALUE per line)"
          initialValue={envVarsText}
          onChangeText={onChangeText}
          multiline
          editable={!disabled}
          placeholder={"API_KEY=your_key\nRUST_LOG=info"}
          style={s.envInput}
        />
        <View style={s.envMetaRow}>
          <Text testID="assistant-env-vars-count" style={type(t.textMuted, 10)}>
            {envCount === 0
              ? "No environment variables configured."
              : `${envCount} variable${envCount === 1 ? "" : "s"} configured (${Object.keys(parsed.envVars).join(", ")}).`}
          </Text>
        </View>
        {parsed.invalidLines.length > 0 ? (
          <View
            testID="assistant-env-vars-error"
            accessibilityRole="alert"
            style={[
              s.errorBanner,
              {
                borderColor: t.destructive,
                backgroundColor: t.badgeRed,
              },
            ]}
          >
            <Text style={type(t.destructive, 11)}>
              {`Invalid KEY=VALUE line${parsed.invalidLines.length === 1 ? "" : "s"}: ${parsed.invalidLines.join(" · ")}`}
            </Text>
          </View>
        ) : null}
      </View>
    </PavraField>
  );
}

function SheetErrorBanner({ error }: { error: string | null }) {
  const { palette: t } = useTheme();
  if (!error) return null;
  return (
    <View
      testID="assistant-sheet-error"
      accessibilityRole="alert"
      style={[
        s.errorBanner,
        {
          borderColor: t.destructive,
          backgroundColor: t.badgeRed,
        },
      ]}
    >
      <Text style={type(t.destructive, 11)}>{error}</Text>
    </View>
  );
}

function useAssistantSheetIdentity(props: AssistantSheetProps) {
  const {
    assistant: assistantProp,
    editing = null,
    coordinatorId,
    turns,
    contextUsage: contextUsageProp,
    data,
  } = props;
  const resolvedAssistant = useMemo(
    () => resolveEditingAssistant(assistantProp, editing, data?.state.assistants),
    [assistantProp, editing, data?.state.assistants],
  );
  const isEditing = Boolean(resolvedAssistant || editing);
  const [formIds] = useState(() => ({
    assistantId: resolvedAssistant?.id ?? editing ?? randomUUID(),
    chatId: randomUUID(),
  }));
  const editorKey = resolvedAssistant?.id ?? editing ?? formIds.assistantId;

  const liveUsage = useAssistantContextUsage({
    turns: turns ?? data?.state.turns ?? [],
    assistant: resolvedAssistant,
    coordinatorId,
  });
  const contextUsage = contextUsageProp !== undefined ? contextUsageProp : liveUsage;
  return { resolvedAssistant, isEditing, formIds, editorKey, contextUsage };
}

function useAssistantSheetForm(
  props: AssistantSheetProps,
  identity: ReturnType<typeof useAssistantSheetIdentity>,
) {
  const {
    coordinatorId,
    hosts = [],
    machines = [],
    defaultServerId = null,
    data,
    onSave,
    onCreatedChat,
    onClose,
  } = props;
  const { resolvedAssistant, isEditing, formIds } = identity;

  const [serverId, setServerId] = useState(
    () => resolvedAssistant?.serverId ?? defaultServerId ?? coordinatorId,
  );
  const [name, setName] = useState(resolvedAssistant?.name ?? "");
  const [provider, setProvider] = useState(resolvedAssistant?.provider ?? "");
  const [persona, setPersona] = useState(resolvedAssistant?.persona ?? "");
  const [memory, setMemory] = useState(resolvedAssistant?.memory ?? "");
  const [autonomyValue, setAutonomyValue] = useState(() =>
    serializeAutonomy(resolvedAssistant?.autonomy),
  );
  const [envVarsText, setEnvVarsText] = useState(() =>
    formatEnvVarsText(resolvedAssistant?.envVars),
  );
  const [disabledTools, setDisabledTools] = useState<AssistantToolFamily[] | undefined>(() =>
    normalizeDisabledTools(resolvedAssistant?.disabledTools),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const machineOptions = useMemo(
    () => buildMachineOptions({ machines, hosts, machineId: serverId }),
    [machines, hosts, serverId],
  );
  const autonomyHosts = useMemo<HostOption[]>(
    () =>
      hosts.length > 0
        ? hosts.map((host) => ({ value: host.serverId, label: host.label }))
        : machineOptions,
    [hosts, machineOptions],
  );

  const handleToggleTool = useCallback((family: AssistantToolFamily) => {
    setDisabledTools((current) => toggleAssistantToolFamily(family, current));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (busy) return;
    setError(null);
    const validated = validateAssistantDraft({
      assistantId: formIds.assistantId,
      isEditing,
      resolvedAssistant,
      coordinatorId,
      serverId,
      name,
      provider,
      persona,
      memory,
      autonomyValue,
      autonomyHosts,
      envVarsText,
      disabledTools,
    });
    if (validated.error || !validated.payload) {
      setError(validated.error ?? "Invalid assistant configuration.");
      return;
    }

    setBusy(true);
    try {
      const ok = await persistAssistantSubmission({
        payload: validated.payload,
        isEditing,
        chatId: formIds.chatId,
        data,
        onSave,
        onCreatedChat,
      });
      if (ok) onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [
    autonomyHosts,
    autonomyValue,
    busy,
    coordinatorId,
    data,
    disabledTools,
    envVarsText,
    formIds,
    isEditing,
    memory,
    name,
    onClose,
    onCreatedChat,
    onSave,
    persona,
    provider,
    resolvedAssistant,
    serverId,
  ]);

  return {
    serverId,
    setServerId,
    name,
    setName,
    provider,
    setProvider,
    persona,
    setPersona,
    memory,
    setMemory,
    autonomyValue,
    setAutonomyValue,
    envVarsText,
    setEnvVarsText,
    disabledTools,
    handleToggleTool,
    machineOptions,
    autonomyHosts,
    busy,
    error,
    handleSubmit,
  };
}

export function AssistantSheet(props: AssistantSheetProps) {
  const { coordinatorId, onRequestCompact, onClose } = props;
  const identity = useAssistantSheetIdentity(props);
  const { isEditing, editorKey, contextUsage } = identity;
  const {
    serverId,
    setServerId,
    name,
    setName,
    provider,
    setProvider,
    persona,
    setPersona,
    memory,
    setMemory,
    autonomyValue,
    setAutonomyValue,
    envVarsText,
    setEnvVarsText,
    disabledTools,
    handleToggleTool,
    machineOptions,
    autonomyHosts,
    busy,
    error,
    handleSubmit,
  } = useAssistantSheetForm(props, identity);

  const showMachineField = isEditing || machineOptions.length >= 2;

  return (
    <FormFrame title={isEditing ? "Edit assistant" : "New assistant"} onClose={onClose}>
      <View testID="assistant-sheet" style={s.sheetBody}>
        {isEditing ? (
          <ContextUsageBar
            usage={contextUsage}
            variant="full"
            showUnavailable
            onRequestCompact={onRequestCompact}
          />
        ) : null}

        {showMachineField ? (
          <PavraField label="Machine">
            <OptionSelect
              label="Machine"
              value={serverId}
              options={machineOptions}
              onSelect={setServerId}
              emptyLabel="Choose…"
              disabled={busy || isEditing}
            />
          </PavraField>
        ) : null}

        <PavraField label="Name">
          <PavraInput
            key={`name:${editorKey}`}
            testID="assistant-name-input"
            accessibilityLabel="Name"
            initialValue={name}
            onChangeText={setName}
            editable={!busy}
            placeholder="Assistant name (e.g. Sky)"
          />
        </PavraField>

        <ProviderModelField
          serverId={serverId}
          value={provider}
          disabled={busy}
          onChange={setProvider}
        />

        <PavraField label="Persona">
          <PavraInput
            key={`persona:${editorKey}`}
            testID="assistant-persona-input"
            accessibilityLabel="Persona"
            initialValue={persona}
            onChangeText={setPersona}
            multiline
            editable={!busy}
            placeholder="Describe this assistant's role, tone, and working style…"
          />
        </PavraField>

        {!isEditing ? (
          <PavraField label="Initial memory">
            <PavraInput
              key={`memory:${editorKey}`}
              testID="assistant-memory-input"
              accessibilityLabel="Initial memory"
              initialValue={memory}
              onChangeText={setMemory}
              multiline
              editable={!busy}
              placeholder="Optional initial notes to seed MEMORY.md…"
            />
          </PavraField>
        ) : null}

        <ToolPermissionsSection
          disabledTools={disabledTools}
          disabled={busy}
          onToggle={handleToggleTool}
        />

        <EnvVarsSection
          editorKey={editorKey}
          envVarsText={envVarsText}
          disabled={busy}
          onChangeText={setEnvVarsText}
        />

        <PavraField label="Tasks">
          <AutonomyEditor
            value={autonomyValue}
            hosts={autonomyHosts}
            defaultHost={coordinatorId}
            disabled={busy}
            onChange={setAutonomyValue}
          />
        </PavraField>

        <SheetErrorBanner error={error} />

        <FormActions
          onSubmit={() => {
            void handleSubmit();
          }}
          onClose={onClose}
          busy={busy}
        />
      </View>
    </FormFrame>
  );
}

const s = StyleSheet.create({
  sheetBody: {
    gap: 12,
  },
  providerWrap: {
    gap: 6,
  },
  refreshRow: {
    flexDirection: "row",
  },
  sectionBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  toolGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  toolCard: {
    flexGrow: 1,
    flexBasis: 200,
    minWidth: 180,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  toolTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  envWrap: {
    gap: 6,
  },
  envInput: {
    minHeight: 84,
    fontFamily: "monospace",
    textAlignVertical: "top",
  },
  envMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  errorBanner: {
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
