import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, ScrollView, Text, View, type ListRenderItemInfo } from "react-native";
import { isNoteMessage } from "../model";
import { PavraInput } from "./FormChrome";
import type {
  Message,
  Task,
  Turn,
  Assistant,
  PlaybookSummary,
  Routine,
  RoutineCadence,
} from "../../../../../extensions/pavra/shared/contracts";
import { formatRoutineCadence, formatRoutineOutcome, routineKindLabel } from "../routines";
import { Composer, type ComposerSendExtras } from "./Composer";
import type { GroupComposerState } from "./GroupComposer";
import { ChatMessage, Chip, NoteRow } from "./ChatChrome";
import { PendingQueueBar, type PendingQueueItem } from "./PendingQueueBar";
import { TaskCard, TaskEventRow, type TaskCardActions } from "./TaskChrome";
import type { TaskEventNote } from "../task-view";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface MessageRow {
  message: Message;
  sender: string;
  seed: string;
  replyCount: number;
  reactions?: Record<string, string[]>;
  onReact?: (emoji: string) => void;
  reply?: () => void;
  /** Quotes this message in the composer; set on assistant replies in a group chat. */
  onQuote?: () => void;
  /** Opens the process drawer for the turn that produced this assistant message. */
  onOpenProcess?: () => void;
  /** The message this one quotes, resolved to a sender name and a short text. */
  quote?: { sender: string; text: string };
  /** Compact routine origin badge (e.g. `Routine · 早间汇总`). */
  routineBadge?: string;
  /** Display text of a system or task_event row. */
  note?: string;
  /** A `task_event` receipt row; set instead of `note`. */
  event?: {
    note: TaskEventNote;
    /** Opens the task thread; absent when the task is unknown. */
    onOpen?(): void;
    respond(requestId: string, behavior: "allow" | "deny"): Promise<void>;
  };
  /** The task card on a task's root message; `inThread` replaces the plain root bubble. */
  taskCard?: {
    task: Task;
    assistantName?: string;
    hostLabel?: string;
    inThread: boolean;
    actions: TaskCardActions;
  };
}
export interface LiveTurn {
  turn: Turn;
  /** The host-rendered live bubble (stream text, approvals); keyed by `turn.id`. */
  node: ReactNode;
}
const EMPTY_FILES: never[] = [];
function ignoreFile() {}
export function ChatPane({
  rows,
  turns,
  draft,
  setDraft,
  draftKey,
  pending,
  error,
  phone,
  connected,
  onSend,
  onTask,
  group,
  locked = false,
  peers,
  takeovers,
  queue,
  onSteerQueued,
  onRemoveQueued,
  onStop,
  cancelling = false,
}: {
  rows: MessageRow[];
  turns: LiveTurn[];
  draft: string;
  setDraft(value: string): void;
  draftKey: string;
  pending: boolean;
  error: string | null;
  phone: boolean;
  connected: boolean;
  onSend(extras?: ComposerSendExtras): void;
  onTask(initialPrompt?: string): void;
  /** Group chat composer chrome; absent in a direct chat. */
  group?: GroupComposerState;
  /** The composer cannot send (a task thread whose task takes no follow-up). */
  locked?: boolean;
  /** Peer requests this lane has open (Paseo-hosted mailbox and Studio traffic). */
  peers?: ReactNode;
  /** Active browser/phone takeovers waiting on the user in this lane. */
  takeovers?: ReactNode;
  /** Messages queued while a turn is active in this lane. */
  queue?: readonly PendingQueueItem[];
  onSteerQueued?(id: string): void;
  onRemoveQueued?(id: string): void;
  onStop?(): void;
  cancelling?: boolean;
}) {
  const { palette: t } = useTheme();
  const list = useRef<FlatList<MessageRow>>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    if (atBottom.current) list.current?.scrollToEnd({ animated: false });
  }, [rows.length, turns.length]);
  // Streaming text grows the content without changing the row count.
  const followContent = useCallback(() => {
    if (atBottom.current) list.current?.scrollToEnd({ animated: false });
  }, []);
  const keyExtractor = useCallback((row: MessageRow) => row.message.id, []);
  const renderRow = useCallback(({ item: row }: ListRenderItemInfo<MessageRow>) => {
    if (row.event)
      return (
        <TaskEventRow
          id={row.message.id}
          note={row.event.note}
          onOpen={row.event.onOpen}
          respond={row.event.respond}
        />
      );
    if (isNoteMessage(row.message))
      return <NoteRow id={row.message.id} content={row.note ?? row.message.content} />;
    if (row.taskCard?.inThread)
      return (
        <View testID={`message-${row.message.id}`} style={{ padding: 4 }}>
          <TaskCard {...row.taskCard} />
        </View>
      );
    return (
      <ChatMessage
        id={row.message.id}
        content={row.message.content}
        sender={row.sender}
        seed={row.seed}
        user={row.message.senderId === "user"}
        createdAt={row.message.createdAt}
        replyCount={row.replyCount}
        reactions={row.reactions}
        onReact={row.onReact}
        onReply={row.reply}
        onQuote={row.onQuote}
        onOpenProcess={row.onOpenProcess}
        quote={row.quote}
        routineBadge={row.routineBadge}
      >
        {row.taskCard ? <TaskCard {...row.taskCard} /> : null}
      </ChatMessage>
    );
  }, []);
  const footer = useMemo(
    () =>
      turns.length > 0 || peers || takeovers ? (
        <>
          {turns.map((item) => (
            <View key={item.turn.id}>{item.node}</View>
          ))}
          {takeovers}
          {peers}
        </>
      ) : null,
    [peers, takeovers, turns],
  );
  const empty = useMemo(
    () =>
      !rows.length ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            gap: 10,
          }}
        >
          <Text style={type(t.textPrimary, 22, { fontWeight: "700" })}>Start a conversation</Text>
          <Text style={type(t.textMuted, 13, { textAlign: "center" })}>
            Your assistant keeps its identity and memory across projects.
          </Text>
        </View>
      ) : null,
    [rows.length, t.textMuted, t.textPrimary],
  );
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: t.chatSurface }}>
      <FlatList
        ref={list}
        testID="chat-message-scroll"
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        ListFooterComponent={footer}
        ListEmptyComponent={empty}
        initialNumToRender={24}
        maxToRenderPerBatch={16}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 }}
        scrollEventThrottle={100}
        onContentSizeChange={followContent}
        onScroll={({ nativeEvent: e }) => {
          atBottom.current =
            e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 80;
        }}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          style={type(t.destructive, 12, { paddingHorizontal: 16, paddingVertical: 6 })}
        >
          {error}
        </Text>
      ) : null}
      {queue && queue.length > 0 && onSteerQueued && onRemoveQueued ? (
        <PendingQueueBar
          items={queue}
          busy={pending}
          onSteer={onSteerQueued}
          onRemove={onRemoveQueued}
        />
      ) : null}
      <Composer
        draft={draft}
        setDraft={setDraft}
        draftKey={draftKey}
        failed={locked}
        showCancel={Boolean(onStop) && turns.length > 0}
        cancelling={cancelling}
        phone={phone}
        connected={connected}
        pendingFiles={EMPTY_FILES}
        uploading={pending}
        uploadError=""
        allowPlanMode={false}
        showSendAsTask={false}
        onTask={onTask}
        onRemovePending={ignoreFile}
        onPasteFiles={ignoreFile}
        onSend={onSend}
        onStop={onStop ?? ignoreFile}
        footerAction={<Chip onPress={() => onTask()}>Create task</Chip>}
        group={group}
      />
    </View>
  );
}
export function MemoryPane({
  assistant,
  content,
  editorKey,
  loading,
  saving,
  dirty,
  error,
  onChange,
  onSave,
  onReload,
  onEdit,
}: {
  assistant?: Assistant;
  content: string;
  editorKey: number;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  onChange(text: string): void;
  onSave(): void;
  onReload(): void;
  onEdit?(): void;
}) {
  const { palette: t } = useTheme();
  return (
    <ScrollView
      contentContainerStyle={{ padding: 24, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={type(t.textPrimary, 18, { fontWeight: "700" })}>Memory</Text>
      <Text style={type(t.textMuted, 12)}>
        {assistant?.name ?? "This assistant"} keeps long-term notes in MEMORY.md and can edit them
        itself. Changes saved here are read on its next turn.
      </Text>
      {assistant ? (
        <PavraInput
          key={editorKey}
          accessibilityLabel="Assistant memory"
          initialValue={content}
          onChangeText={onChange}
          multiline
          editable={!loading && !saving}
          placeholder={loading ? "Loading…" : "No memories saved yet."}
          style={{ minHeight: 240 }}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Chip onPress={onSave} disabled={!dirty || saving || loading} accent>
          {saving ? "Saving…" : "Save memory"}
        </Chip>
        <Chip onPress={onReload} disabled={saving || loading}>
          Reload
        </Chip>
        {onEdit ? <Chip onPress={onEdit}>Edit persona and model</Chip> : null}
      </View>
    </ScrollView>
  );
}
export function PlaybooksPane({
  assistant,
  playbooks,
  selectedSlug,
  content,
  editorKey,
  loading,
  saving,
  dirty,
  error,
  onSelect,
  onCreate,
  onChange,
  onSave,
  onDelete,
  onReload,
}: {
  assistant?: Assistant;
  playbooks: readonly PlaybookSummary[];
  selectedSlug: string | null;
  content: string;
  editorKey: number;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  onSelect(slug: string): void;
  onCreate(slug: string): void;
  onChange(text: string): void;
  onSave(): void;
  onDelete(slug?: string): void;
  onReload(): void;
}) {
  const { palette: t } = useTheme();
  const [newSlug, setNewSlug] = useState("");
  const [slugKey, setSlugKey] = useState(0);
  const handleCreate = useCallback(() => {
    const trimmed = newSlug.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewSlug("");
    setSlugKey((value) => value + 1);
  }, [newSlug, onCreate]);
  return (
    <ScrollView
      contentContainerStyle={{ padding: 24, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={type(t.textPrimary, 18, { fontWeight: "700" })}>Playbooks</Text>
      <Text style={type(t.textMuted, 12)}>
        {assistant?.name ?? "This assistant"} keeps reusable step-by-step procedures in{" "}
        playbooks/&lt;slug&gt;.md and follows them on matching requests or routines.
      </Text>
      {assistant ? (
        <>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {playbooks.map((item) => (
              <Chip
                key={item.slug}
                label={`Select playbook ${item.slug}`}
                onPress={() => onSelect(item.slug)}
                accent={selectedSlug === item.slug}
                disabled={saving}
              >
                {item.slug}
              </Chip>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <PavraInput
              key={slugKey}
              accessibilityLabel="New playbook slug"
              initialValue={newSlug}
              onChangeText={setNewSlug}
              editable={!loading && !saving}
              placeholder="New playbook slug (e.g. daily-check)"
              style={{ flex: 1, minWidth: 200, minHeight: 34 }}
            />
            <Chip
              label="Create playbook"
              onPress={handleCreate}
              disabled={!newSlug.trim() || loading || saving}
            >
              Create
            </Chip>
          </View>
          {selectedSlug ? (
            <PavraInput
              key={`${selectedSlug}:${editorKey}`}
              accessibilityLabel="Playbook content"
              initialValue={content}
              onChangeText={onChange}
              multiline
              editable={!loading && !saving}
              placeholder={loading ? "Loading…" : `# ${selectedSlug}`}
              style={{ minHeight: 240 }}
            />
          ) : (
            <Text style={type(t.textMuted, 12)}>
              {loading
                ? "Loading playbooks…"
                : "No playbooks yet. Enter a slug above and press Create to start one."}
            </Text>
          )}
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {selectedSlug ? (
          <Chip onPress={onSave} disabled={!dirty || saving || loading} accent>
            {saving ? "Saving…" : "Save playbook"}
          </Chip>
        ) : null}
        <Chip onPress={onReload} disabled={saving || loading}>
          Reload
        </Chip>
        {selectedSlug ? (
          <Chip onPress={() => onDelete(selectedSlug)} disabled={saving || loading}>
            Delete
          </Chip>
        ) : null}
      </View>
    </ScrollView>
  );
}

type CadencePreset = "every-1h" | "every-30m" | "cron" | "reminder-15m";

const CADENCE_PRESETS: Array<{ id: CadencePreset; label: string }> = [
  { id: "every-1h", label: "Every 1h" },
  { id: "every-30m", label: "Every 30m" },
  { id: "cron", label: "Cron" },
  { id: "reminder-15m", label: "Reminder (15m)" },
];

export function RoutinesPane({
  assistant,
  routines,
  busyId,
  saving,
  error,
  onCreate,
  onRunOnce,
  onPause,
  onResume,
  onDelete,
}: {
  assistant?: Assistant;
  routines: readonly Routine[];
  busyId: string | null;
  saving: boolean;
  error: string | null;
  onCreate(input: {
    name: string;
    prompt: string;
    cadence: RoutineCadence;
    maxRuns?: number | null;
  }): void;
  onRunOnce(id: string): void;
  onPause(id: string): void;
  onResume(id: string): void;
  onDelete(id: string): void;
}) {
  const { palette: t } = useTheme();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<CadencePreset>("every-1h");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [formKey, setFormKey] = useState(0);

  const handleCreate = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) return;
    let cadence: RoutineCadence;
    let maxRuns: number | null = null;
    if (preset === "every-30m") {
      cadence = { type: "every", everyMs: 30 * 60_000 };
    } else if (preset === "cron") {
      cadence = { type: "cron", expression: cronExpression.trim() || "0 9 * * *" };
    } else if (preset === "reminder-15m") {
      cadence = { type: "every", everyMs: 15 * 60_000 };
      maxRuns = 1;
    } else {
      cadence = { type: "every", everyMs: 60 * 60_000 };
    }
    onCreate({ name: trimmedName, prompt: trimmedPrompt, cadence, maxRuns });
    setName("");
    setPrompt("");
    setFormKey((value) => value + 1);
  }, [cronExpression, name, onCreate, preset, prompt]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 24, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={type(t.textPrimary, 18, { fontWeight: "700" })}>Routines & Reminders</Text>
      <Text style={type(t.textMuted, 12)}>
        {assistant?.name ?? "This assistant"} runs scheduled checks or one-time reminders in this
        chat. When a routine finds nothing that needs attention, it replies (pass) and stays silent.
      </Text>
      {assistant ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.retroBorder,
            borderRadius: 12,
            backgroundColor: t.surfaceSecondary,
            padding: 14,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {CADENCE_PRESETS.map((item) => (
              <Chip
                key={item.id}
                label={`Select cadence ${item.label}`}
                onPress={() => setPreset(item.id)}
                accent={preset === item.id}
                disabled={saving}
              >
                {item.label}
              </Chip>
            ))}
          </View>
          <PavraInput
            key={`name:${formKey}`}
            accessibilityLabel="Routine name"
            initialValue={name}
            onChangeText={setName}
            editable={!saving}
            placeholder={
              preset === "reminder-15m"
                ? "Reminder title (e.g. Reply to email)"
                : "Routine name (e.g. Morning check)"
            }
            style={{ minHeight: 34 }}
          />
          {preset === "cron" ? (
            <PavraInput
              key={`cron:${formKey}`}
              accessibilityLabel="Cron expression"
              initialValue={cronExpression}
              onChangeText={setCronExpression}
              editable={!saving}
              placeholder="5-field cron (e.g. 0 9 * * *)"
              style={{ minHeight: 34 }}
            />
          ) : null}
          <PavraInput
            key={`prompt:${formKey}`}
            accessibilityLabel="Routine prompt"
            initialValue={prompt}
            onChangeText={setPrompt}
            multiline
            editable={!saving}
            placeholder="Instructions for the turn (e.g. Follow playbooks/daily-check.md; reply (pass) if normal)."
            style={{ minHeight: 90 }}
          />
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Chip
              label="Create routine"
              onPress={handleCreate}
              disabled={!name.trim() || !prompt.trim() || saving}
              accent
            >
              {saving
                ? "Saving…"
                : preset === "reminder-15m"
                  ? "Create reminder"
                  : "Create routine"}
            </Chip>
          </View>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
          {error}
        </Text>
      ) : null}
      {routines.map((routine) => {
        const lastRun = routine.runs.at(-1);
        const busy = busyId === routine.id;
        return (
          <View
            key={routine.id}
            testID={`routine-card-${routine.id}`}
            style={{
              borderWidth: 1,
              borderColor: t.retroBorder,
              borderRadius: 12,
              backgroundColor: t.surfaceSecondary,
              padding: 14,
              gap: 8,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              <Text style={type(t.textPrimary, 14, { fontWeight: "700" })}>{routine.name}</Text>
              <Text style={type(t.textMuted, 11, { fontWeight: "600" })}>
                {`${routineKindLabel(routine)} · ${routine.status} · ${formatRoutineCadence(routine.cadence)}`}
              </Text>
            </View>
            <Text numberOfLines={3} style={type(t.textSecondary, 12)}>
              {routine.prompt}
            </Text>
            <Text
              style={type(t.textMuted, 11)}
            >{`Last run: ${formatRoutineOutcome(lastRun)}`}</Text>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Chip
                label={`Run ${routine.name} now`}
                onPress={() => onRunOnce(routine.id)}
                disabled={busy}
              >
                Run now
              </Chip>
              {routine.status === "active" ? (
                <Chip
                  label={`Pause ${routine.name}`}
                  onPress={() => onPause(routine.id)}
                  disabled={busy}
                >
                  Pause
                </Chip>
              ) : (
                <Chip
                  label={`Resume ${routine.name}`}
                  onPress={() => onResume(routine.id)}
                  disabled={busy}
                >
                  Resume
                </Chip>
              )}
              <Chip
                label={`Delete ${routine.name}`}
                onPress={() => onDelete(routine.id)}
                disabled={busy}
              >
                Delete
              </Chip>
            </View>
          </View>
        );
      })}
      {routines.length === 0 ? (
        <Text style={type(t.textMuted, 12)}>
          No routines or reminders in this chat yet. Create one above, or ask the assistant in chat.
        </Text>
      ) : null}
    </ScrollView>
  );
}
