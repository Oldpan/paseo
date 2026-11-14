import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { text as type } from "./ui/theme";
import { randomUUID } from "expo-crypto";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { useShallow } from "zustand/shallow";
import {
  sendMessage,
  cancelTask,
  respondTaskPermission,
  type Assistant,
  type Message,
  type Task,
  type Turn,
} from "../../../../extensions/bigbang/shared/contracts";
import type { BigbangData } from "./data";
import {
  clampThreadWidth,
  maxAllowedThreadWidth,
  THREAD_DEFAULT_WIDTH,
  THREAD_MIN_WIDTH,
} from "./panel-resize";
import { useBigbangView } from "./store";
import type { Palette } from "./palette";
import { AnimatedDrawer, usePresenceId } from "./ui/AnimatedDrawer";
import { ChatHeader, ThreadHeader } from "./ui/ChatChrome";
import { ChatPane, MemoryPane } from "./ui/ChatPane";
import { ColResizeHandle } from "./ui/ColResizeHandle";
import { TaskCard, type TaskCardActions } from "./ui/TaskChrome";
import { LiveTurnItem } from "./live-turn-item";
import { openExchanges } from "./peer-activity";
import { PeerActivity } from "./ui/PeerActivity";
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
  hostLabels?: Record<string, string>;
  onTask(): void;
  onOpenTask(task: Task): void;
  onOpenTurn(turn: Turn): void;
  onOpenStudio?(conversationId: string, threadId: string | null): void;
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
const FLEX = { flex: 1, minWidth: 0, minHeight: 0 } as const;
const SPLIT = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  flexDirection: "row",
  position: "relative",
} as const;
const THREAD_CLIP = { height: "100%", minHeight: 0, overflow: "hidden", flexShrink: 0 } as const;
const THREAD_INNER = { flex: 1, minHeight: 0 } as const;
const TASKS = { padding: 20, gap: 12 } as const;
const THREAD_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const LIVE = new Set(["queued", "creating", "running", "attention", "unknown"]);
const HINT_DEBOUNCE_MS = 150;
function noMention() {}
function machineLabel(
  serverId: string | undefined,
  coordinatorId: string,
  hosts: ReadonlyArray<{ serverId: string; label: string }>,
  hostLabels?: Record<string, string>,
): string {
  const machineId = serverId ?? coordinatorId;
  return (
    hostLabels?.[machineId] ?? hosts.find((host) => host.serverId === machineId)?.label ?? machineId
  );
}
/** ChatHeader line under the title: machine · provider for a DM, count · machines for a group. */
function headerSubtitle(
  conversation: { kind: string; members: readonly string[] } | undefined,
  assistant: Assistant | undefined,
  assistants: readonly Assistant[],
  coordinatorId: string,
  hosts: ReadonlyArray<{ serverId: string; label: string }>,
  hostLabels?: Record<string, string>,
): string | undefined {
  if (conversation?.kind === "dm" && assistant)
    return [machineLabel(assistant.serverId, coordinatorId, hosts, hostLabels), assistant.provider]
      .filter(Boolean)
      .join(" · ");
  if (conversation?.kind !== "group") return undefined;
  const groupMembers = assistants.filter((item) => conversation.members.includes(item.id));
  const names = [
    ...new Set(
      groupMembers.map((item) => machineLabel(item.serverId, coordinatorId, hosts, hostLabels)),
    ),
  ];
  return `${groupMembers.length} assistants${names.length ? ` · ${names.join(", ")}` : ""}`;
}
function headerEdit(
  kind: string | undefined,
  assistant: Assistant | undefined,
  edit: () => void,
): (() => void) | undefined {
  return kind === "dm" && assistant ? edit : undefined;
}
/** Task navigation and RPCs shared by the cards, receipt rows and the Tasks tab. */
function useTaskWiring(data: BigbangData, onOpenTask: (task: Task) => void): TaskWiring {
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
    const openThread = (taskId: string) => {
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
  }, [data, hosts, onOpenTask, setThread]);
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
    <ScrollView style={FLEX} contentContainerStyle={TASKS}>
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
function computeThreadTitle(
  threadId: string | null,
  tasks: readonly Task[],
  roundtable: RoundtableProgress | null,
): string {
  const taskId = taskIdOfThread(threadId);
  if (!taskId) return roundtableTitle(roundtable);
  const threadTask = tasks.find((task) => task.id === taskId);
  return `Task thread${threadTask ? `: ${taskTitle(threadTask)}` : ""}`;
}

function computeThreadSubtitle(
  threadId: string | null,
  tasks: readonly Task[],
  messages: readonly Message[],
  chatId: string,
  conversationName: string,
): string | undefined {
  if (!threadId) return undefined;
  const replies = messages.filter(
    (message) =>
      message.conversationId === chatId && message.threadId === threadId && !isNoteMessage(message),
  ).length;
  const replyLabel = `${replies} ${replies === 1 ? "reply" : "replies"}`;
  const taskId = taskIdOfThread(threadId);
  const threadTask = taskId ? tasks.find((task) => task.id === taskId) : undefined;
  if (threadTask) {
    return `${threadTask.status.replace(/_/g, " ")} · ${replyLabel}`;
  }
  return conversationName ? `in ${conversationName} · ${replyLabel}` : replyLabel;
}

function chatHeaderTitle(
  conversation: { kind: string; name: string } | undefined,
  assistant: Assistant | undefined,
): string {
  if (conversation?.kind === "dm") return assistant?.name ?? "Bigbang";
  return conversation?.name ?? "Bigbang";
}

function DesktopThreadPane({
  open,
  threadWidth,
  maxThreadWidth,
  onWidthChange,
  title,
  subtitle,
  backgroundColor,
  borderColor,
  onClose,
  onOpenStudio,
  children,
}: {
  open: boolean;
  threadWidth: number;
  maxThreadWidth: number;
  onWidthChange(width: number): void;
  title: string;
  subtitle?: string;
  backgroundColor: string;
  borderColor: string;
  onClose(): void;
  onOpenStudio?: () => void;
  children: ReactNode;
}) {
  const widthSV = useSharedValue(0);
  const opacitySV = useSharedValue(0);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (prevOpenRef.current !== open) {
      prevOpenRef.current = open;
      widthSV.value = withTiming(open ? threadWidth : 0, {
        duration: open ? 200 : 180,
        easing: THREAD_EASING,
      });
      opacitySV.value = withTiming(open ? 1 : 0, {
        duration: open ? 200 : 140,
        easing: THREAD_EASING,
      });
      return;
    }
    if (open) {
      widthSV.value = threadWidth;
      opacitySV.value = 1;
    }
  }, [open, opacitySV, threadWidth, widthSV]);

  const clipAnimatedStyle = useAnimatedStyle(() => ({
    width: widthSV.value,
    opacity: opacitySV.value,
  }));
  const clipStyle = useMemo(() => [THREAD_CLIP, clipAnimatedStyle], [clipAnimatedStyle]);
  const innerStyle = useMemo(
    () => [THREAD_INNER, inlineUnistylesStyle({ width: threadWidth, backgroundColor })],
    [backgroundColor, threadWidth],
  );

  return (
    <>
      {open ? (
        <ColResizeHandle
          testID="chat-thread-resize-handle"
          accessibilityLabel="Resize thread panel"
          grow="right"
          width={threadWidth}
          minWidth={THREAD_MIN_WIDTH}
          maxWidth={maxThreadWidth}
          defaultWidth={THREAD_DEFAULT_WIDTH}
          onWidthChange={onWidthChange}
          ruleWidth={2}
          ruleColor={borderColor}
        />
      ) : null}
      <Animated.View pointerEvents={open ? "auto" : "none"} style={clipStyle}>
        <View testID="chat-thread-panel" style={innerStyle}>
          <ThreadHeader
            onClose={onClose}
            compact={false}
            title={title}
            subtitle={subtitle}
            onOpenStudio={onOpenStudio}
          />
          {children}
        </View>
      </Animated.View>
    </>
  );
}

function CompactThreadDrawer({
  open,
  drawerWidth,
  backgroundColor,
  title,
  subtitle,
  onClose,
  onOpenStudio,
  children,
}: {
  open: boolean;
  drawerWidth: number;
  backgroundColor: string;
  title: string;
  subtitle?: string;
  onClose(): void;
  onOpenStudio?: () => void;
  children: ReactNode;
}) {
  const sheetStyle = useMemo(() => [FLEX, { backgroundColor }], [backgroundColor]);
  return (
    <AnimatedDrawer
      open={open}
      side="right"
      drawerWidth={drawerWidth > 0 ? drawerWidth : 390}
      fullWidth
      backdrop={false}
      zIndex={20}
    >
      <View testID="chat-thread-panel" style={sheetStyle}>
        <ThreadHeader
          onClose={onClose}
          compact
          title={title}
          subtitle={subtitle}
          onOpenStudio={onOpenStudio}
        />
        {children}
      </View>
    </AnimatedDrawer>
  );
}

export function BigbangChat(props: ChatProps) {
  const { data, palette, onEditAssistant, onSidebar } = props;
  const compact = useIsCompactFormFactor();
  const chatId = useBigbangView((state) => state.chatId);
  const coordinatorId = useBigbangView((state) => state.coordinatorId);
  const threadId = useBigbangView((state) => state.threadId);
  const setThread = useBigbangView((state) => state.setThread);
  const threadWidth = useBigbangView((state) => state.threadWidth);
  const setThreadWidth = useBigbangView((state) => state.setThreadWidth);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tab, setTab] = useState("chat");
  const { activeId: renderedThreadId, open: threadOpen } = usePresenceId(threadId, 190);
  const conversation = data.state.conversations.find((item) => item.id === chatId);
  const assistant = data.state.assistants.find((item) => item.id === conversation?.members[0]);
  const hosts = useHosts();
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);
  const leaveThread = useCallback(() => setThread(null), [setThread]);
  const edit = useCallback(() => {
    if (assistant) onEditAssistant(assistant.id);
  }, [assistant, onEditAssistant]);
  const onOpenStudio = props.onOpenStudio;
  const conversationId = conversation?.id;
  const openStudioRoot = useCallback(() => {
    if (conversationId && onOpenStudio) onOpenStudio(conversationId, null);
  }, [conversationId, onOpenStudio]);
  const openStudioThread = useCallback(() => {
    if (conversationId && renderedThreadId && onOpenStudio) {
      onOpenStudio(conversationId, renderedThreadId);
    }
  }, [conversationId, onOpenStudio, renderedThreadId]);
  const onOpenStudioRootProp = conversation && onOpenStudio ? openStudioRoot : undefined;
  const onOpenStudioThreadProp =
    conversation && renderedThreadId && onOpenStudio ? openStudioThread : undefined;
  const subtitle = useMemo(
    () =>
      headerSubtitle(
        conversation,
        assistant,
        data.state.assistants,
        coordinatorId,
        hosts,
        props.hostLabels,
      ),
    [assistant, conversation, coordinatorId, data.state.assistants, hosts, props.hostLabels],
  );
  const headerTitle = chatHeaderTitle(conversation, assistant);
  const activeRoundtable = useMemo(
    () => roundtableProgress(data.state.messages, data.state.turns, chatId, renderedThreadId),
    [chatId, data.state.messages, data.state.turns, renderedThreadId],
  );
  const wiring = useTaskWiring(data, props.onOpenTask);
  const threadTitle = useMemo(
    () => computeThreadTitle(renderedThreadId, data.state.tasks, activeRoundtable),
    [activeRoundtable, data.state.tasks, renderedThreadId],
  );
  const threadSubtitle = useMemo(
    () =>
      computeThreadSubtitle(
        renderedThreadId,
        data.state.tasks,
        data.state.messages,
        chatId,
        headerTitle,
      ),
    [chatId, data.state.messages, data.state.tasks, headerTitle, renderedThreadId],
  );
  const maxThreadWidth = maxAllowedThreadWidth(containerWidth);
  const effectiveThreadWidth = clampThreadWidth(threadWidth, containerWidth);
  const seed = `${assistant?.id}:${assistant?.name}`;
  const editHandler = headerEdit(conversation?.kind, assistant, edit);

  const threadContent = renderedThreadId ? (
    <ConversationPane
      key={renderedThreadId}
      {...props}
      threadId={renderedThreadId}
      phone={compact}
      roundtable={activeRoundtable}
      wiring={wiring}
    />
  ) : null;

  return (
    <View onLayout={handleLayout} style={SPLIT}>
      <View style={FLEX}>
        <ChatHeader
          label={headerTitle}
          seed={seed}
          group={conversation?.kind === "group"}
          subtitle={subtitle}
          connected={data.connected}
          tab={tab}
          onTab={setTab}
          onSidebar={onSidebar}
          onEdit={editHandler}
          onOpenStudio={onOpenStudioRootProp}
        />
        {tab === "chat" ? (
          <ConversationPane
            key="root"
            {...props}
            threadId={null}
            phone={compact}
            roundtable={null}
            wiring={wiring}
          />
        ) : null}
        {tab === "task" ? <TasksTab data={data} palette={palette} wiring={wiring} /> : null}
        {tab === "memory" ? (
          <MemoryTab data={data} assistant={assistant} onEdit={assistant ? edit : undefined} />
        ) : null}
      </View>
      {!compact && renderedThreadId ? (
        <DesktopThreadPane
          open={threadOpen}
          threadWidth={effectiveThreadWidth}
          maxThreadWidth={maxThreadWidth}
          onWidthChange={setThreadWidth}
          title={threadTitle}
          subtitle={threadSubtitle}
          backgroundColor={palette.surfaceSecondary}
          borderColor={palette.black}
          onClose={leaveThread}
          onOpenStudio={onOpenStudioThreadProp}
        >
          {threadContent}
        </DesktopThreadPane>
      ) : null}
      {compact ? (
        <CompactThreadDrawer
          open={Boolean(threadId)}
          drawerWidth={containerWidth}
          backgroundColor={palette.surfaceSecondary}
          title={threadTitle}
          subtitle={threadSubtitle}
          onClose={leaveThread}
          onOpenStudio={onOpenStudioThreadProp}
        >
          {threadContent}
        </CompactThreadDrawer>
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
  const assistantsById = useMemo(
    () => new Map(data.state.assistants.map((assistant) => [assistant.id, assistant])),
    [data.state.assistants],
  );
  const tasksById = useMemo(
    () => new Map(data.state.tasks.map((task) => [task.id, task])),
    [data.state.tasks],
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
      return assistantsById.get(senderId)?.name ?? "Assistant";
    };
    return sortMessages(
      data.state.messages.filter(
        (message) =>
          message.conversationId === chatId &&
          (message.threadId === threadId || message.id === threadId),
      ),
    ).map((message) => {
      const task = message.taskId ? tasksById.get(message.taskId) : undefined;
      const assistant = assistantsById.get(message.senderId);
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
                assistantName: assistantsById.get(task.assistantId)?.name,
                hostLabel: wiring.hostLabel(task.serverId),
                inThread: inTaskThread,
                actions: wiring.actionsFor(task, inTaskThread),
              }
            : undefined,
      };
    });
  }, [
    assistantsById,
    chatId,
    conversation,
    data.state.messages,
    messagesById,
    setThread,
    tasksById,
    threadId,
    wiring,
  ]);
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
          const assistant = assistantsById.get(turn.assistantId);
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
    [assistantsById, chatId, coordinatorId, data.state.turns, onOpenTurn, threadId],
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
  const exchanges = useMemo(
    () => openExchanges(data.state.peerMessages ?? [], chatId, threadId),
    [chatId, data.state.peerMessages, threadId],
  );
  const peers = useMemo(
    () => (exchanges.length > 0 ? <PeerActivity items={exchanges} /> : null),
    [exchanges],
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
      peers={peers}
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
