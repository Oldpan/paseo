import { useEffect, useRef, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { isNoteMessage } from "../model";
import { BigbangInput } from "./FormChrome";
import type {
  Message,
  Task,
  Turn,
  Assistant,
} from "../../../../../extensions/bigbang/shared/contracts";
import { Composer } from "./Composer";
import type { GroupComposerState } from "./GroupComposer";
import { ChatMessage, Chip, NoteRow } from "./ChatChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface MessageRow {
  message: Message;
  sender: string;
  seed: string;
  replyCount: number;
  reply?: () => void;
  /** Quotes this message in the composer; set on assistant replies in a group chat. */
  onQuote?: () => void;
  /** The message this one quotes, resolved to a sender name and a short text. */
  quote?: { sender: string; text: string };
  /** Display text of a system or task_event row. */
  note?: string;
  task?: Task;
  open(): void;
  cancel(): void;
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
  onSend(): void;
  onTask(): void;
  /** Group chat composer chrome; absent in a direct chat. */
  group?: GroupComposerState;
}) {
  const { palette: t } = useTheme();
  const list = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    if (atBottom.current) list.current?.scrollToEnd({ animated: false });
  }, [rows.length, turns.length]);
  // Streaming text grows the content without changing the row count.
  const followContent = () => {
    if (atBottom.current) list.current?.scrollToEnd({ animated: false });
  };
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: t.chatSurface }}>
      <ScrollView
        ref={list}
        testID="chat-message-scroll"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 }}
        scrollEventThrottle={100}
        onContentSizeChange={followContent}
        onScroll={({ nativeEvent: e }) => {
          atBottom.current =
            e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 80;
        }}
      >
        {rows.map((row) =>
          isNoteMessage(row.message) ? (
            <NoteRow
              key={row.message.id}
              id={row.message.id}
              content={row.note ?? row.message.content}
            />
          ) : (
            <ChatMessage
              key={row.message.id}
              id={row.message.id}
              content={row.message.content}
              sender={row.sender}
              seed={row.seed}
              user={row.message.senderId === "user"}
              createdAt={row.message.createdAt}
              replyCount={row.replyCount}
              onReply={row.reply}
              onQuote={row.onQuote}
              quote={row.quote}
            >
              {row.task ? (
                <TaskCard task={row.task} onOpen={row.open} onCancel={row.cancel} />
              ) : null}
            </ChatMessage>
          ),
        )}
        {turns.map((item) => (
          <View key={item.turn.id}>{item.node}</View>
        ))}
        {!rows.length ? (
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
        ) : null}
      </ScrollView>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={type(t.destructive, 12, { paddingHorizontal: 16, paddingVertical: 6 })}
        >
          {error}
        </Text>
      ) : null}
      <Composer
        draft={draft}
        setDraft={setDraft}
        draftKey={draftKey}
        failed={false}
        showCancel={false}
        cancelling={false}
        phone={phone}
        connected={connected}
        pendingFiles={EMPTY_FILES}
        uploading={pending}
        uploadError=""
        allowPlanMode={false}
        showSendAsTask={false}
        onRemovePending={ignoreFile}
        onPasteFiles={ignoreFile}
        onSend={onSend}
        onStop={ignoreFile}
        footerAction={<Chip onPress={onTask}>Create task</Chip>}
        group={group}
      />
    </View>
  );
}
export function TaskCard({
  task,
  onOpen,
  onCancel,
}: {
  task: Task;
  onOpen(): void;
  onCancel(): void;
}) {
  const { palette: t } = useTheme();
  const live = ["queued", "creating", "running", "attention", "unknown"].includes(task.status);
  return (
    <View
      style={{
        alignSelf: "stretch",
        marginTop: 8,
        padding: 12,
        gap: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceElevated,
      }}
    >
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: live ? t.warning : t.success,
          }}
        />
        <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>{task.status}</Text>
        <Text style={type(t.textMuted, 10, { flex: 1 })}>{task.provider}</Text>
      </View>
      <Text numberOfLines={3} style={type(t.textSecondary, 12)}>
        {task.prompt}
      </Text>
      {task.error ? <Text style={type(t.destructive, 11)}>{task.error}</Text> : null}
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Chip onPress={onOpen} disabled={!task.execution} accent>
          Open Studio
        </Chip>
        {live ? <Chip onPress={onCancel}>Cancel task</Chip> : null}
      </View>
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
        <BigbangInput
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
