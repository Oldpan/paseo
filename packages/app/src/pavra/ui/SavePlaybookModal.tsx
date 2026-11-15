import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  Assistant,
  Conversation,
  Message,
  PlaybookFile,
  Takeover,
} from "../../../../../extensions/pavra/shared/contracts";
import {
  saveRoutine,
  writeAssistantPlaybook,
} from "../../../../../extensions/pavra/shared/contracts";
import {
  PLAYBOOK_ROUTINE_CADENCE_PRESETS,
  buildPlaybookRoutineInput,
  derivePlaybookDraft,
} from "../chat-actions";
import type { PavraData } from "../data";
import { normalizePlaybookSlug } from "../playbooks";
import { Chip } from "./ChatChrome";
import { FormFrame, PavraField, PavraInput } from "./FormChrome";
import { CheckIcon } from "./icons";
import { useTheme } from "./ThemeProvider";
import { ctrlShadow, text as type } from "./theme";

export interface SavePlaybookModalProps {
  message?: Message | null;
  takeover?: Takeover | null;
  takeoverNote?: string;
  conversation?: Conversation | null;
  assistants: readonly Assistant[];
  data?: Pick<PavraData, "invoke" | "call">;
  onSavePlaybook?: (input: {
    assistantId: string;
    slug: string;
    content: string;
  }) => Promise<PlaybookFile | unknown> | unknown;
  onCreateRoutine?: (
    input: ReturnType<typeof buildPlaybookRoutineInput>,
  ) => Promise<unknown> | unknown;
  onSaved?: (result: { assistantId: string; slug: string; routineCreated: boolean }) => void;
  onClose: () => void;
}

function resolveAvailableAssistants(
  assistants: readonly Assistant[],
  conversation: Conversation | null,
): Assistant[] {
  if (!conversation) return [...assistants];
  const memberSet = new Set(conversation.members);
  const filtered = assistants.filter((assistant) => memberSet.has(assistant.id));
  return filtered.length > 0 ? filtered : [...assistants];
}

async function persistPlaybookAndOptionalRoutine(params: {
  assistantId: string;
  slug: string;
  content: string;
  routineName: string;
  alsoCreateRoutine: boolean;
  conversationId: string | null;
  threadId: string | null;
  cadenceKey: string;
  data?: Pick<PavraData, "invoke" | "call">;
  onSavePlaybook?: SavePlaybookModalProps["onSavePlaybook"];
  onCreateRoutine?: SavePlaybookModalProps["onCreateRoutine"];
}): Promise<boolean> {
  const payload = {
    assistantId: params.assistantId,
    slug: params.slug,
    content: params.content,
  };
  if (params.onSavePlaybook) {
    await params.onSavePlaybook(payload);
  } else if (params.data) {
    await params.data.invoke(writeAssistantPlaybook, payload);
  }

  if (!params.alsoCreateRoutine || !params.conversationId) {
    return false;
  }

  const preset =
    PLAYBOOK_ROUTINE_CADENCE_PRESETS.find((item) => item.key === params.cadenceKey) ??
    PLAYBOOK_ROUTINE_CADENCE_PRESETS[1]!;
  const routineInput = buildPlaybookRoutineInput({
    name: params.routineName,
    slug: params.slug,
    assistantId: params.assistantId,
    conversationId: params.conversationId,
    threadId: params.threadId,
    cadence: preset.cadence,
  });
  if (params.onCreateRoutine) {
    await params.onCreateRoutine(routineInput);
    return true;
  }
  if (params.data) {
    const ok = await params.data.call(saveRoutine, routineInput);
    return Boolean(ok);
  }
  return false;
}

function PlaybookRoutineToggleCard({
  checked,
  slug,
  cadenceKey,
  onToggle,
  onSelectCadence,
}: {
  checked: boolean;
  slug: string;
  cadenceKey: string;
  onToggle: () => void;
  onSelectCadence: (key: string) => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={[
        s.routineCard,
        {
          borderColor: checked ? t.retroBorder : t.retroBorderLight,
          backgroundColor: checked ? t.brandAccentSoft : t.surfaceSecondary,
        },
        checked && ctrlShadow(t, name),
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        style={s.routineToggleRow}
      >
        <View
          style={[
            s.checkbox,
            {
              borderColor: checked ? t.retroBorder : t.retroBorderLight,
              backgroundColor: checked ? t.brandAccent : t.surfacePrimary,
            },
          ]}
        >
          {checked ? <CheckIcon size={11} color={t.onAccent} /> : null}
        </View>
        <View style={s.routineToggleMeta}>
          <Text style={type(t.textPrimary, 12, { fontWeight: "700" })}>
            Also create a Routine from this Playbook
          </Text>
          <Text style={type(t.textSecondary, 11)}>
            Schedules the assistant to run playbooks/{slug || "playbook"}.md and stay silent on
            (pass).
          </Text>
        </View>
      </Pressable>

      {checked ? (
        <View style={s.cadenceRow}>
          {PLAYBOOK_ROUTINE_CADENCE_PRESETS.map((preset) => (
            <Chip
              key={preset.key}
              accent={cadenceKey === preset.key}
              onPress={() => onSelectCadence(preset.key)}
            >
              {preset.label}
            </Chip>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function resolvePlaybookContext(params: {
  message: Message | null;
  takeover: Takeover | null;
  conversation: Conversation | null;
  defaultAssistantId: string | undefined;
  availableAssistants: readonly Assistant[];
}) {
  const initialAssistantId = params.defaultAssistantId ?? params.availableAssistants[0]?.id ?? "";
  const conversationId =
    params.conversation?.id ??
    params.message?.conversationId ??
    params.takeover?.conversationId ??
    null;
  const threadId = params.message?.threadId ?? params.takeover?.threadId ?? null;
  const sourceKey = `${params.message?.id ?? "none"}:${params.takeover?.id ?? "none"}`;
  const modalTitle = params.takeover ? "Save Show-Me Playbook" : "Save as Playbook";
  return {
    initialAssistantId,
    conversationId,
    threadId,
    sourceKey,
    modalTitle,
  };
}

export function SavePlaybookModal({
  message = null,
  takeover = null,
  takeoverNote,
  conversation = null,
  assistants,
  data,
  onSavePlaybook,
  onCreateRoutine,
  onSaved,
  onClose,
}: SavePlaybookModalProps) {
  const { palette: t } = useTheme();

  const availableAssistants = useMemo(
    () => resolveAvailableAssistants(assistants, conversation),
    [assistants, conversation],
  );

  const draft = useMemo(
    () =>
      derivePlaybookDraft({
        message,
        takeover,
        takeoverNote,
        conversation,
        assistants: availableAssistants,
      }),
    [message, takeover, takeoverNote, conversation, availableAssistants],
  );

  const ctx = useMemo(
    () =>
      resolvePlaybookContext({
        message,
        takeover,
        conversation,
        defaultAssistantId: draft.defaultAssistantId,
        availableAssistants,
      }),
    [message, takeover, conversation, draft.defaultAssistantId, availableAssistants],
  );

  const [assistantId, setAssistantId] = useState<string>(ctx.initialAssistantId);
  const [title, setTitle] = useState(draft.title);
  const [slug, setSlug] = useState(draft.slug);
  const [slugInputKey, setSlugInputKey] = useState(0);
  const [slugTouched, setSlugTouched] = useState(false);
  const [content, setContent] = useState(draft.content);
  const [alsoCreateRoutine, setAlsoCreateRoutine] = useState(false);
  const [cadenceKey, setCadenceKey] = useState<string>("every-1h");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedSlug = normalizePlaybookSlug(slug);
  const canSave = Boolean(assistantId && normalizedSlug && content.trim() && !busy);

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    if (slugTouched) return;
    const nextSlug = normalizePlaybookSlug(nextTitle);
    if (nextSlug) {
      setSlug(nextSlug);
      setSlugInputKey((prev) => prev + 1);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const routineCreated = await persistPlaybookAndOptionalRoutine({
        assistantId,
        slug: normalizedSlug,
        content,
        routineName: title.trim() || draft.title,
        alsoCreateRoutine,
        conversationId: ctx.conversationId,
        threadId: ctx.threadId,
        cadenceKey,
        data,
        onSavePlaybook,
        onCreateRoutine,
      });
      onSaved?.({ assistantId, slug: normalizedSlug, routineCreated });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <FormFrame title={ctx.modalTitle} onClose={onClose}>
      {availableAssistants.length > 1 ? (
        <PavraField label="Assistant Owner">
          <View style={s.chipRow}>
            {availableAssistants.map((assistant) => (
              <Chip
                key={assistant.id}
                accent={assistant.id === assistantId}
                onPress={() => setAssistantId(assistant.id)}
              >
                {assistant.name}
              </Chip>
            ))}
          </View>
        </PavraField>
      ) : null}

      <View style={s.splitRow}>
        <View style={s.flexCol}>
          <PavraField label="Playbook Title">
            <PavraInput
              key={`title:${ctx.sourceKey}`}
              initialValue={title}
              onChangeText={handleTitleChange}
              placeholder="e.g. Deploy Canary Release"
            />
          </PavraField>
        </View>
        <View style={s.flexCol}>
          <PavraField label="Slug (playbooks/<slug>.md)">
            <PavraInput
              key={`slug:${ctx.sourceKey}:${slugInputKey}`}
              initialValue={slug}
              onChangeText={(next) => {
                setSlugTouched(true);
                setSlug(next);
              }}
              placeholder="deploy-canary-release"
            />
          </PavraField>
        </View>
      </View>

      <PavraField label={`Playbook Markdown (${draft.steps.length} steps)`}>
        <PavraInput
          key={`content:${ctx.sourceKey}`}
          initialValue={content}
          onChangeText={setContent}
          placeholder="# Playbook Title..."
          multiline
          style={s.markdownInput}
        />
      </PavraField>

      {ctx.conversationId ? (
        <PlaybookRoutineToggleCard
          checked={alsoCreateRoutine}
          slug={normalizedSlug}
          cadenceKey={cadenceKey}
          onToggle={() => setAlsoCreateRoutine((prev) => !prev)}
          onSelectCadence={setCadenceKey}
        />
      ) : null}

      {error ? (
        <View style={[s.errorBanner, { borderColor: t.destructive, backgroundColor: t.badgeRed }]}>
          <Text style={type(t.destructive, 11)}>{error}</Text>
        </View>
      ) : null}

      <View style={s.footerRow}>
        <Chip onPress={onClose} disabled={busy}>
          Cancel
        </Chip>
        <Chip accent disabled={!canSave} onPress={() => void handleSave()}>
          {busy ? "Saving…" : "Save Playbook"}
        </Chip>
      </View>
    </FormFrame>
  );
}

const s = StyleSheet.create({
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  markdownInput: {
    minHeight: 170,
    textAlignVertical: "top",
  },
  routineCard: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  routineToggleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  routineToggleMeta: {
    flex: 1,
    gap: 2,
  },
  cadenceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingLeft: 28,
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
