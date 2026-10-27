import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { text as type } from "./ui/theme";
import { randomUUID } from "expo-crypto";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useShallow } from "zustand/shallow";
import {
  sendMessage,
  cancelTask,
  respondTaskPermission,
  type Assistant,
  type Task,
  type Turn,
} from "../../../../extensions/bigbang/shared/contracts";
import type { BigbangData } from "./data";
import { useBigbangView } from "./store";
import type { Palette } from "./palette";
import { ChatHeader, ThreadHeader } from "./ui/ChatChrome";
import { ChatPane, MemoryPane } from "./ui/ChatPane";
import { TaskCard, type TaskCardActions } from "./ui/TaskChrome";
import { LiveTurnItem } from "./live-turn-item";
import { useAssistantMemory } from "./memory";
import { isNoteMessage, sortMessages } from "./model";
import {
  followUpState,
  isTaskRoot,
  taskEventNote,
  taskIdOfThread,
  taskThreadId,
  taskTitle,
} from "./task-view";
import {
  applyMention,
  canQuote,
  membersOf,
  mentionSuggestions,
  noteLabel,
  quotePreview,
  responderHint,
  roundtableEligibility,
  roundtableProgress,
  roundtableTitle,
  type RoundtableProgress,
} from "./group";
import type { GroupComposerState } from "./ui/GroupComposer";

interface ChatProps {
  data: BigbangData;
  palette: Palette;
  onTask(): void;
  onOpenTask(task: Task): void;
  onOpenTurn(turn: Turn): void;
  onEditAssistant(id: string): void;
  onSidebar?(): void;
}
/** What task cards and receipt rows need from the screen: navigation and the task RPCs. */
interface TaskWiring {
  hostLabel(serverId: string): string;
  openThread(taskId: string): void;
  actionsFor(task: Task, inThread: boolean): TaskCardActions;
  respond(taskId: string, requestId: string, behavior: "allow" | "deny"): Promise<void>;
}
const FLEX = { flex: 1, minWidth: 0, minHeight: 0 };
const SPLIT = { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" } as const;
const THREAD = { width: 420, maxWidth: "100%", minHeight: 0, borderLeftWidth: 1 } as const;
const TASKS = { padding: 20, gap: 12 };
const LIVE = new Set(["queued", "creating", "running", "attention", "unknown"]);
const HINT_DEBOUNCE_MS = 150;
function noMention() {}
/** Task navigation and RPCs shared by the cards, receipt rows and the Tasks tab. */
function useTaskWiring(
  data: BigbangData,
  onOpenTask: (task: Task) => void,
  setTab: (tab: string) => void,
): TaskWiring {
  const hosts = useHosts();
  const setThread = useBigbangView((state) => state.setThread);
  return useMemo<TaskWiring>(() => {
    const respond = async (
      taskId: string,
      requestId: string,
      behavior: "allow" | "deny",
    ): Promise<void> => {
      await data.call(respondTaskPermission, { taskId, requestId, behavior });
    };
    // The thread panel only exists on the Chat tab.
    const openThread = (taskId: string) => {
      setTab("chat");
      setThread(taskThreadId(taskId));
    };
    return {
      hostLabel: (serverId) => hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
      openThread,
      respond,
      actionsFor: (task, inThread) => ({
        ...(inThread ? {} : { openThread: () => openThread(task.id) }),
        openStudio: () => onOpenTask(task),
        cancel: async () => {
          await data.call(cancelTask, { id: task.id });
        },
        respond: (requestId, behavior) => respond(task.id, requestId, behavior),
      }),
    };
  }, [data, hosts, onOpenTask, setTab, setThread]);
}
function TasksTab({
  data,
  palette,
  wiring,
}: {
  data: BigbangData;
  palette: Palette;
  wiring: TaskWiring;
}) {
  const chatId = useBigbangView((state) => state.chatId);
  const tasks = data.state.tasks.filter((task) => task.conversationId === chatId);
  return (
    <ScrollView contentContainerStyle={TASKS}>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          assistantName={data.state.assistants.find((item) => item.id === task.assistantId)?.name}
          hostLabel={wiring.hostLabel(task.serverId)}
          actions={wiring.actionsFor(task, false)}
        />
      ))}
      {tasks.length ? null : (
        <Text style={type(palette.textMuted, 12)}>
          No tasks yet. Start one with Create task, or let an assistant start one.
        </Text>
      )}
    </ScrollView>
  );
}
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
  const roundtable = useMemo(
    () => roundtableProgress(data.state.messages, data.state.turns, chatId, threadId),
    [chatId, data.state.messages, data.state.turns, threadId],
  );
  const threadStyle = useMemo(
    () => [THREAD, { borderColor: palette.retroBorder }],
    [palette.retroBorder],
  );
  const wiring = useTaskWiring(data, props.onOpenTask, setTab);
  const threadTask = data.state.tasks.find((task) => task.id === taskIdOfThread(threadId));
  const threadTitle = taskIdOfThread(threadId)
    ? `Task thread${threadTask ? `: ${taskTitle(threadTask)}` : ""}`
    : roundtableTitle(roundtable);
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
            <ConversationPane
              key="root"
              {...props}
              threadId={null}
              phone={compact}
              roundtable={null}
              wiring={wiring}
            />
          ) : null}
          {threadId ? (
            <View style={compact ? FLEX : threadStyle}>
              <ThreadHeader onClose={leaveThread} compact={compact} title={threadTitle} />
              <ConversationPane
                key={threadId}
                {...props}
                threadId={threadId}
                phone={compact}
                roundtable={roundtable}
                wiring={wiring}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {tab === "task" ? <TasksTab data={data} palette={palette} wiring={wiring} /> : null}
      {tab === "memory" ? (
        <MemoryTab data={data} assistant={assistant} onEdit={assistant ? edit : undefined} />
      ) : null}
    </View>
  );
}
function MemoryTab({
  data,
  assistant,
  onEdit,
}: {
  data: BigbangData;
  assistant?: Assistant;
  onEdit?(): void;
}) {
  const memory = useAssistantMemory(data, assistant?.id);
  return (
    <MemoryPane
      assistant={assistant}
      content={memory.content}
      editorKey={memory.editorKey}
      loading={memory.loading}
      saving={memory.saving}
      dirty={memory.dirty}
      error={memory.error}
      onChange={memory.change}
      onSave={memory.save}
      onReload={memory.reload}
      onEdit={onEdit}
    />
  );
}
function ConversationPane({
  data,
  onTask,
  onOpenTurn,
  threadId,
  phone,
  roundtable,
  wiring,
}: ChatProps & {
  threadId: string | null;
  phone: boolean;
  /** Set when this thread is a roundtable. */
  roundtable: RoundtableProgress | null;
  wiring: TaskWiring;
}) {
  const chatId = useBigbangView((state) => state.chatId);
  const coordinatorId = useBigbangView((state) => state.coordinatorId);
  const setThread = useBigbangView((state) => state.setThread);
  const setDraft = useBigbangView((state) => state.draft);
  const draftKey = JSON.stringify([coordinatorId, chatId, threadId]);
  const draft = useBigbangView((state) => state.drafts[draftKey] ?? "");
  const conversation = data.state.conversations.find((item) => item.id === chatId);
  const isGroup = conversation?.kind === "group";
  const threadTaskId = taskIdOfThread(threadId);
  const followUp = useMemo(
    () =>
      threadTaskId
        ? followUpState(data.state.tasks.find((item) => item.id === threadTaskId))
        : null,
    [data.state.tasks, threadTaskId],
  );
  const members = useMemo(
    () => membersOf(conversation, data.state.assistants),
    [conversation, data.state.assistants],
  );
  const messagesById = useMemo(
    () => new Map(data.state.messages.map((message) => [message.id, message])),
    [data.state.messages],
  );
  const pendingMessage = useRef<{
    id: string;
    content: string;
    quoteOf?: string;
    responseMode?: "roundtable";
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  // The toggle starts from the group's default; the user's own choice wins until the next send.
  const [roundtableChoice, setRoundtableChoice] = useState<boolean | null>(null);
  const changeDraft = useCallback(
    (value: string) => setDraft(draftKey, value),
    [draftKey, setDraft],
  );
  const eligibility = roundtableEligibility({ conversation, threadId, draft, members });
  const roundtableOn =
    eligibility.eligible && (roundtableChoice ?? conversation?.roundtable ?? false);
  const quoted = quoteId ? messagesById.get(quoteId) : undefined;
  const send = useCallback(async () => {
    if (!draft.trim() || pending) return;
    const request = {
      content: draft,
      ...(quoted ? { quoteOf: quoted.id } : {}),
      ...(roundtableOn ? { responseMode: "roundtable" as const } : {}),
    };
    // A retry of the same message keeps its id, so the coordinator never stores it twice.
    const previous = pendingMessage.current;
    const message =
      previous &&
      previous.content === request.content &&
      previous.quoteOf === request.quoteOf &&
      previous.responseMode === request.responseMode
        ? previous
        : { id: randomUUID(), ...request };
    pendingMessage.current = message;
    setPending(true);
    setError(null);
    try {
      await data.call(sendMessage, { ...message, conversationId: chatId, threadId });
      if (useBigbangView.getState().drafts[draftKey] === message.content) setDraft(draftKey, "");
      pendingMessage.current = null;
      setQuoteId(null);
      setRoundtableChoice(null);
      // The roundtable runs in the thread under the message that started it.
      if (message.responseMode) setThread(message.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }, [chatId, data, draft, draftKey, pending, quoted, roundtableOn, setDraft, setThread, threadId]);
  const sendPress = useCallback(() => {
    void send();
  }, [send]);
  const rows = useMemo(() => {
    const replyCounts = new Map<string, number>();
    for (const message of data.state.messages) {
      if (message.threadId && !isNoteMessage(message))
        replyCounts.set(message.threadId, (replyCounts.get(message.threadId) ?? 0) + 1);
    }
    const nameOf = (senderId: string) => {
      if (senderId === "user") return "You";
      if (senderId === "system") return "System";
      return data.state.assistants.find((item) => item.id === senderId)?.name ?? "Assistant";
    };
    return sortMessages(
      data.state.messages.filter(
        (message) =>
          message.conversationId === chatId &&
          (message.threadId === threadId || message.id === threadId),
      ),
    ).map((message) => {
      const task = data.state.tasks.find((item) => item.id === message.taskId);
      const assistant = data.state.assistants.find((item) => item.id === message.senderId);
      const original = message.quoteOf ? messagesById.get(message.quoteOf) : undefined;
      const taskId = message.taskId;
      const inTaskThread = threadId !== null && message.id === threadId;
      return {
        message,
        sender: nameOf(message.senderId),
        seed: `${assistant?.id}:${assistant?.name}`,
        replyCount: replyCounts.get(message.id) ?? 0,
        reply: threadId ? undefined : () => setThread(message.id),
        onQuote: canQuote(message, conversation) ? () => setQuoteId(message.id) : undefined,
        quote: message.quoteOf
          ? {
              sender: original ? nameOf(original.senderId) : "Quoted message",
              text: original ? quotePreview(original.content) : "No longer available",
            }
          : undefined,
        note: message.kind === "system" ? noteLabel(message) : undefined,
        event:
          message.kind === "task_event" && taskId
            ? {
                note: taskEventNote(message, task),
                onOpen: task ? () => wiring.openThread(taskId) : undefined,
                respond: (requestId: string, behavior: "allow" | "deny") =>
                  wiring.respond(taskId, requestId, behavior),
              }
            : undefined,
        taskCard:
          task && isTaskRoot(message)
            ? {
                task,
                assistantName: data.state.assistants.find((item) => item.id === task.assistantId)
                  ?.name,
                hostLabel: wiring.hostLabel(task.serverId),
                inThread: inTaskThread,
                actions: wiring.actionsFor(task, inTaskThread),
              }
            : undefined,
      };
    });
  }, [chatId, conversation, data, messagesById, setThread, threadId, wiring]);
  const turns = useMemo(
    () =>
      data.state.turns
        .filter(
          (turn) =>
            turn.conversationId === chatId &&
            turn.threadId === threadId &&
            LIVE.has(turn.status) &&
            !turn.finalMessageId,
        )
        .map((turn) => {
          const assistant = data.state.assistants.find((item) => item.id === turn.assistantId);
          return {
            turn,
            node: (
              <LiveTurnItem
                serverId={turn.serverId ?? coordinatorId}
                turn={turn}
                name={assistant?.name ?? "Assistant"}
                seed={`${assistant?.id}:${assistant?.name}`}
                onOpenTurn={onOpenTurn}
              />
            ),
          };
        }),
    [chatId, coordinatorId, data, onOpenTurn, threadId],
  );
  useLiveTurnDemand(
    `bigbang:${draftKey}`,
    useMemo(
      () =>
        turns.map((item) => ({
          // An assistant bound to another machine streams from that machine's session.
          serverId: item.turn.serverId ?? coordinatorId,
          agentId: item.turn.agentId,
        })),
      [coordinatorId, turns],
    ),
  );
  const hintDraft = useDebouncedValue(draft, HINT_DEBOUNCE_MS);
  const hint = useMemo(
    () =>
      responderHint({
        conversation,
        members,
        messages: data.state.messages,
        threadId,
        draft: hintDraft,
        quotedSenderId: quoted?.senderId,
        inRoundtable: roundtable !== null,
        roundtableOn,
        now: Date.now(),
      }),
    [
      conversation,
      data.state.messages,
      hintDraft,
      members,
      quoted,
      roundtable,
      roundtableOn,
      threadId,
    ],
  );
  const mentions = useMemo(
    () => (isGroup && !followUp ? mentionSuggestions(draft, members) : []),
    [draft, followUp, isGroup, members],
  );
  const group = useMemo<GroupComposerState | undefined>(() => {
    // A reply in a task thread goes to the task's executor, so there is nothing to route.
    if (followUp)
      return {
        hint: followUp.hint,
        quote: null,
        mentions: [],
        onMention: noMention,
        roundtable: null,
      };
    if (!isGroup) return undefined;
    return {
      hint,
      quote: quoted
        ? {
            sender:
              quoted.senderId === "user"
                ? "You"
                : (members.find((member) => member.id === quoted.senderId)?.name ?? "Assistant"),
            text: quotePreview(quoted.content),
            onRemove: () => setQuoteId(null),
          }
        : null,
      mentions,
      onMention: (name) => changeDraft(applyMention(draft, name)),
      roundtable: eligibility.eligible
        ? { on: roundtableOn, onToggle: () => setRoundtableChoice(!roundtableOn) }
        : null,
    };
  }, [
    changeDraft,
    draft,
    eligibility.eligible,
    followUp,
    hint,
    isGroup,
    members,
    mentions,
    quoted,
    roundtableOn,
  ]);
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
      group={group}
      locked={followUp ? !followUp.allowed : false}
    />
  );
}

/**
 * Asks the session for the timelines of this pane's in-flight turns so the live bubble has a
 * stream to read. Same contract as the workspace screen: replace this owner's visible agents, and
 * clear them when the pane unmounts or its panel is hidden.
 */
function useLiveTurnDemand(
  owner: string,
  executions: Array<{ serverId: string; agentId: string }>,
) {
  const panelActive = useRetainedPanelActive();
  // Keyed by content: the list is a new array whenever the ledger changes, the demand is not.
  const demandKey = panelActive
    ? [...new Set(executions.map((item) => `${item.serverId}\t${item.agentId}`))].sort().join("\n")
    : "";
  const demanded = useMemo(
    () =>
      demandKey
        ? demandKey.split("\n").map((line) => {
            const [serverId = "", agentId = ""] = line.split("\t");
            return { serverId, agentId };
          })
        : [],
    [demandKey],
  );
  const servers = useMemo(() => [...new Set(demanded.map((item) => item.serverId))], [demanded]);
  const syncs = useSessionStore(
    useShallow((state) => servers.map((serverId) => state.sessions[serverId]?.viewedTimelineSync)),
  );
  useEffect(() => {
    for (const { serverId, agentId } of demanded) {
      void getHostRuntimeStore()
        .prepareAgentTimeline(serverId, agentId)
        .catch(() => undefined);
    }
  }, [demanded]);
  // Each pass clears what the previous one set, so a machine that drops out loses its demand too.
  useLayoutEffect(() => {
    servers.forEach((serverId, index) =>
      syncs[index]?.replaceVisibleAgentIds(
        owner,
        demanded.filter((item) => item.serverId === serverId).map((item) => item.agentId),
      ),
    );
    return () => {
      for (const sync of syncs) sync?.replaceVisibleAgentIds(owner, []);
    };
  }, [demanded, owner, servers, syncs]);
}
