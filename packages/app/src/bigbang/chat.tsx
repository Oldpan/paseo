import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  sendMessage,
  cancelTask,
  type Task,
  type Turn,
} from "../../../../extensions/bigbang/shared/contracts";
import type { BigbangData } from "./data";
import { useBigbangView } from "./store";
import type { Palette } from "./palette";
import { ChatHeader, ThreadHeader } from "./ui/ChatChrome";
import { ChatPane, MemoryPane, TaskCard } from "./ui/ChatPane";

interface ChatProps {
  data: BigbangData;
  palette: Palette;
  onTask(): void;
  onOpenTask(task: Task): void;
  onOpenTurn(turn: Turn): void;
  onEditAssistant(id: string): void;
  onSidebar?(): void;
}
const FLEX = { flex: 1, minWidth: 0, minHeight: 0 };
const SPLIT = { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" } as const;
const THREAD = { width: 420, maxWidth: "100%", minHeight: 0, borderLeftWidth: 1 } as const;
const TASKS = { padding: 20, gap: 12 };
const LIVE = new Set(["queued", "creating", "running", "attention", "unknown"]);
export function BigbangChat(props: ChatProps) {
  const { data, palette, onEditAssistant, onSidebar } = props;
  const compact = useIsCompactFormFactor();
  const chatId = useBigbangView((state) => state.chatId);
  const threadId = useBigbangView((state) => state.threadId);
  const setThread = useBigbangView((state) => state.setThread);
  const [tab, setTab] = useState("chat");
  const conversation = data.state.conversations.find((item) => item.id === chatId);
  const assistant = data.state.assistants.find((item) => item.id === conversation?.members[0]);
  const leaveThread = useCallback(() => setThread(null), [setThread]);
  const edit = useCallback(() => {
    if (assistant) onEditAssistant(assistant.id);
  }, [assistant, onEditAssistant]);
  const threadStyle = useMemo(
    () => [THREAD, { borderColor: palette.retroBorder }],
    [palette.retroBorder],
  );
  const tasks = useMemo(
    () =>
      data.state.tasks
        .filter((task) => task.conversationId === chatId)
        .map((task) => ({
          task,
          open: () => props.onOpenTask(task),
          cancel: () => {
            void data.call(cancelTask, { id: task.id });
          },
        })),
    [chatId, data, props],
  );
  return (
    <View style={FLEX}>
      <ChatHeader
        label={(conversation?.kind === "dm" ? assistant?.name : conversation?.name) ?? "Bigbang"}
        seed={`${assistant?.id}:${assistant?.name}`}
        group={conversation?.kind === "group"}
        connected={data.connected}
        tab={tab}
        onTab={setTab}
        onSidebar={onSidebar}
        onEdit={assistant ? edit : undefined}
      />
      {tab === "chat" ? (
        <View style={SPLIT}>
          {!compact || !threadId ? (
            <ConversationPane {...props} threadId={null} phone={compact} />
          ) : null}
          {threadId ? (
            <View style={compact ? FLEX : threadStyle}>
              <ThreadHeader onClose={leaveThread} compact={compact} />
              <ConversationPane {...props} threadId={threadId} phone={compact} />
            </View>
          ) : null}
        </View>
      ) : null}
      {tab === "task" ? (
        <ScrollView contentContainerStyle={TASKS}>
          {tasks.map((row) => (
            <TaskCard key={row.task.id} task={row.task} onOpen={row.open} onCancel={row.cancel} />
          ))}
        </ScrollView>
      ) : null}
      {tab === "memory" ? (
        <MemoryPane assistant={assistant} onEdit={assistant ? edit : undefined} />
      ) : null}
    </View>
  );
}
function ConversationPane({
  data,
  onTask,
  onOpenTask,
  onOpenTurn,
  threadId,
  phone,
}: ChatProps & { threadId: string | null; phone: boolean }) {
  const chatId = useBigbangView((state) => state.chatId);
  const coordinatorId = useBigbangView((state) => state.coordinatorId);
  const setThread = useBigbangView((state) => state.setThread);
  const setDraft = useBigbangView((state) => state.draft);
  const draftKey = JSON.stringify([coordinatorId, chatId, threadId]);
  const draft = useBigbangView((state) => state.drafts[draftKey] ?? "");
  const pendingMessage = useRef<{ id: string; content: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeDraft = useCallback(
    (value: string) => setDraft(draftKey, value),
    [draftKey, setDraft],
  );
  const send = useCallback(async () => {
    if (!draft.trim() || pending) return;
    const message =
      pendingMessage.current?.content === draft
        ? pendingMessage.current
        : { id: randomUUID(), content: draft };
    pendingMessage.current = message;
    setPending(true);
    setError(null);
    try {
      await data.call(sendMessage, { ...message, conversationId: chatId, threadId });
      if (useBigbangView.getState().drafts[draftKey] === message.content) setDraft(draftKey, "");
      pendingMessage.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }, [chatId, data, draft, draftKey, pending, setDraft, threadId]);
  const sendPress = useCallback(() => {
    void send();
  }, [send]);
  const rows = useMemo(
    () =>
      data.state.messages
        .filter(
          (message) =>
            message.conversationId === chatId &&
            (message.threadId === threadId || message.id === threadId),
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((message) => {
          const task = data.state.tasks.find((item) => item.id === message.taskId);
          const assistant = data.state.assistants.find((item) => item.id === message.senderId);
          return {
            message,
            task,
            sender: message.senderId === "user" ? "You" : (assistant?.name ?? "Assistant"),
            seed: `${assistant?.id}:${assistant?.name}`,
            replyCount: data.state.messages.filter((item) => item.threadId === message.id).length,
            reply: threadId ? undefined : () => setThread(message.id),
            open: () => {
              if (task) onOpenTask(task);
            },
            cancel: () => {
              if (task)
                void data
                  .call(cancelTask, { id: task.id })
                  .catch((failure: Error) => setError(failure.message));
            },
          };
        }),
    [chatId, data, onOpenTask, setThread, threadId],
  );
  const turns = useMemo(
    () =>
      data.state.turns
        .filter(
          (turn) =>
            turn.conversationId === chatId && turn.threadId === threadId && LIVE.has(turn.status),
        )
        .map((turn) => ({
          turn,
          name:
            data.state.assistants.find((assistant) => assistant.id === turn.assistantId)?.name ??
            "Assistant",
          open: () => onOpenTurn(turn),
        })),
    [chatId, data, onOpenTurn, threadId],
  );
  return (
    <ChatPane
      rows={rows}
      turns={turns}
      draft={draft}
      setDraft={changeDraft}
      draftKey={draftKey}
      pending={pending}
      error={error}
      phone={phone}
      connected={data.connected}
      onSend={sendPress}
      onTask={onTask}
    />
  );
}
