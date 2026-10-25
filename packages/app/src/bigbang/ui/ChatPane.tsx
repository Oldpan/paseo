import { useEffect, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import type {
  Message,
  Task,
  Turn,
  Assistant,
} from "../../../../../extensions/bigbang/shared/contracts";
import { Composer } from "./Composer";
import { ChatMessage, Chip } from "./ChatChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface MessageRow {
  message: Message;
  sender: string;
  seed: string;
  replyCount: number;
  reply?: () => void;
  task?: Task;
  open(): void;
  cancel(): void;
}
export interface LiveTurn {
  turn: Turn;
  name: string;
  open(): void;
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
}) {
  const { palette: t } = useTheme();
  const list = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    if (atBottom.current) list.current?.scrollToEnd({ animated: false });
  }, [rows.length, turns.length]);
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: t.chatSurface }}>
      <ScrollView
        ref={list}
        testID="chat-message-scroll"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 }}
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: e }) => {
          atBottom.current =
            e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 80;
        }}
      >
        {rows.map((row) => (
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
          >
            {row.task ? <TaskCard task={row.task} onOpen={row.open} onCancel={row.cancel} /> : null}
          </ChatMessage>
        ))}
        {turns.map((item) => (
          <View
            key={item.turn.id}
            style={{ paddingHorizontal: 46, paddingVertical: 10, gap: 8, alignItems: "flex-start" }}
          >
            <Text style={type(t.textMuted, 12)}>
              {item.name} · {item.turn.status === "running" ? "Thinking…" : item.turn.status}
            </Text>
            <Chip onPress={item.open}>View process / approvals</Chip>
          </View>
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
export function MemoryPane({ assistant, onEdit }: { assistant?: Assistant; onEdit?(): void }) {
  const { palette: t } = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <Text style={type(t.textPrimary, 18, { fontWeight: "700" })}>Memory</Text>
      <Text selectable style={type(t.textSecondary, 14)}>
        {assistant?.memory || "No memories saved yet."}
      </Text>
      {onEdit ? (
        <View style={{ alignItems: "flex-start" }}>
          <Chip onPress={onEdit}>Edit persona and memory</Chip>
        </View>
      ) : null}
    </ScrollView>
  );
}
