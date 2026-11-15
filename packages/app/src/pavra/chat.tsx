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
  reactToMessage,
  saveMessage,
  cancelTakeover,
  cancelTask,
  cancelTurn,
  resolveTakeover,
  respondTaskPermission,
  type Assistant,
  type Message,
  type Takeover,
  type Task,
  type Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { buildSaveMessageRequest, isMessageSaved } from "./chat-actions";
import type { PavraData } from "./data";
import {
  clampThreadWidth,
  maxAllowedThreadWidth,
  THREAD_DEFAULT_WIDTH,
  THREAD_MIN_WIDTH,
} from "./panel-resize";
import { usePavraView } from "./store";
import type { Palette } from "./palette";
import { AnimatedDrawer, usePresenceId } from "./ui/AnimatedDrawer";
import { BrowserTakeoverModal, TakeoverCard } from "./ui/BrowserTakeoverModal";
import { ChatHeader, ThreadHeader } from "./ui/ChatChrome";
import { ChatPane, MemoryPane, PlaybooksPane, RoutinesPane } from "./ui/ChatPane";
import type { ComposerSendExtras } from "./ui/Composer";
import type { ParsedFileRef } from "./ui/fileRefParser";
import {
  FileRefPreviewModal,
  openFileRefInStudio,
  readWorkspaceFileForPreview,
} from "./ui/FileRefPreviewModal";
import { ForwardMessageModal } from "./ui/ForwardMessageModal";
import { GlobalSearchModal } from "./ui/GlobalSearchModal";
import type { PendingQueueItem } from "./ui/PendingQueueBar";
import { PromoteToTaskModal } from "./ui/PromoteToTaskModal";
import { SavePlaybookModal } from "./ui/SavePlaybookModal";
import { ColResizeHandle } from "./ui/ColResizeHandle";
import { TaskCard, type TaskCardActions } from "./ui/TaskChrome";
import { LiveTurnItem } from "./live-turn-item";
import { buildTurnLineage, openExchanges } from "./peer-activity";
import { PeerActivity } from "./ui/PeerActivity";
import { useAssistantMemory } from "./memory";
import { useAssistantPlaybooks } from "./playbooks";
import { formatMessageRoutineBadge, useAssistantRoutines } from "./routines";
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
  data: PavraData;
  palette: Palette;
  hostLabels?: Record<string, string>;
  onTask(initialPrompt?: string): void;
  onOpenTask(task: Task): void;
  onOpenTurn(turn: Turn): void;
  onOpenStudio?(conversationId: string, threadId: string | null): void;
  onEditAssistant(id: string): void;
  onOpenAssistant?(assistantId: string): void;
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
const TAKEOVERS_CONTAINER = { gap: 8, paddingVertical: 6 } as const;
const THREAD_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const LIVE = new Set(["queued", "creating", "running", "attention", "unknown"]);
const HINT_DEBOUNCE_MS = 150;
const EMPTY_QUEUE: readonly PendingQueueItem[] = [];
function noMention() {}
function resolveMessageTurn(
  message: Message,
  turnsByFinalMessageId: ReadonlyMap<string, Turn>,
  turnsById: ReadonlyMap<string, Turn>,
): Turn | undefined {
  if (message.senderId === "user" || message.senderId === "system") return undefined;
  return (
    turnsByFinalMessageId.get(message.id) ??
    (message.turnId ? turnsById.get(message.turnId) : undefined)
  );
}
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
function useTaskWiring(data: PavraData, onOpenTask: (task: Task) => void): TaskWiring {
  const hosts = useHosts();
  const setThread = usePavraView((state) => state.setThread);
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
  data: PavraData;
  palette: Palette;
  wiring: TaskWiring;
}) {
  const chatId = usePavraView((state) => state.chatId);
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
  if (conversation?.kind === "dm") return assistant?.name ?? "Pavra";
  return conversation?.name ?? "Pavra";
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

export function PavraChat(props: ChatProps) {
  const { data, palette, onEditAssistant, onSidebar } = props;
  const compact = useIsCompactFormFactor();
  const chatId = usePavraView((state) => state.chatId);
  const coordinatorId = usePavraView((state) => state.coordinatorId);
  const threadId = usePavraView((state) => state.threadId);
  const setThread = usePavraView((state) => state.setThread);
  const threadWidth = usePavraView((state) => state.threadWidth);
  const setThreadWidth = usePavraView((state) => state.setThreadWidth);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tab, setTab] = useState("chat");
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const toggleSearch = useCallback(() => setSearchOpen((prev) => !prev), []);
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
          onOpenSearch={openSearch}
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
        {tab === "routines" ? (
          <RoutinesTab data={data} assistant={assistant} conversationId={chatId} />
        ) : null}
        {tab === "memory" ? <MemoryTab data={data} assistant={assistant} onEdit={edit} /> : null}
        {tab === "playbooks" ? <PlaybooksTab data={data} assistant={assistant} /> : null}
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
      <PavraGlobalSearchHost
        open={searchOpen}
        onOpen={openSearch}
        onClose={closeSearch}
        onToggle={toggleSearch}
        data={data}
        chatId={chatId}
        hostLabels={props.hostLabels}
        onSetTab={setTab}
        onOpenTask={props.onOpenTask}
        onOpenAssistant={props.onOpenAssistant}
      />
    </View>
  );
}

function PavraGlobalSearchHost({
  open,
  onOpen,
  onClose,
  onToggle,
  data,
  chatId,
  hostLabels,
  onSetTab,
  onOpenTask,
  onOpenAssistant,
}: {
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onToggle(): void;
  data: PavraData;
  chatId: string;
  hostLabels?: Record<string, string>;
  onSetTab(tab: string): void;
  onOpenTask(task: Task): void;
  onOpenAssistant?(assistantId: string): void;
}) {
  const handleSelectConversation = useCallback(
    (targetConversationId: string, _messageId?: string, targetThreadId?: string | null) => {
      usePavraView.getState().selectChat(targetConversationId);
      usePavraView.getState().setThread(targetThreadId ?? null);
      onSetTab("chat");
    },
    [onSetTab],
  );
  const handleSelectTask = useCallback(
    (targetConversationId: string, targetTaskId: string) => {
      const targetTask = data.state.tasks.find((item) => item.id === targetTaskId);
      if (targetTask?.execution) {
        onOpenTask(targetTask);
      } else {
        usePavraView.getState().selectChat(targetConversationId);
        usePavraView.getState().setThread(taskThreadId(targetTaskId));
        onSetTab("chat");
      }
    },
    [data.state.tasks, onOpenTask, onSetTab],
  );
  const handleSelectRoutine = useCallback(
    (_routineId: string, targetConversationId?: string, targetAssistantId?: string) => {
      const convId =
        targetConversationId ??
        data.state.conversations.find(
          (item) =>
            item.kind === "dm" &&
            Boolean(targetAssistantId && item.members.includes(targetAssistantId)),
        )?.id;
      if (convId && convId !== chatId) usePavraView.getState().selectChat(convId);
      onSetTab("routines");
    },
    [chatId, data.state.conversations, onSetTab],
  );
  const handleSelectPlaybook = useCallback(
    (_slug: string, targetAssistantId?: string, targetConversationId?: string) => {
      const convId =
        targetConversationId ??
        data.state.conversations.find(
          (item) =>
            item.kind === "dm" &&
            Boolean(targetAssistantId && item.members.includes(targetAssistantId)),
        )?.id;
      if (convId && convId !== chatId) usePavraView.getState().selectChat(convId);
      onSetTab("playbooks");
    },
    [chatId, data.state.conversations, onSetTab],
  );
  const handleSelectStudio = useCallback(
    (studioId: string) => {
      const targetStudio = (data.state.studios ?? []).find((item) => item.id === studioId);
      const firstWorkspace = targetStudio?.workspaces?.[0];
      if (targetStudio && firstWorkspace) {
        usePavraView.getState().openColumn({
          serverId: firstWorkspace.serverId,
          workspaceId: firstWorkspace.workspaceId,
          name: targetStudio.name,
          group: targetStudio.name,
        });
      }
      usePavraView.getState().setMode("studio");
    },
    [data.state.studios],
  );
  const handleSelectAssistant = useCallback(
    (targetAssistantId: string) => {
      if (onOpenAssistant) {
        onOpenAssistant(targetAssistantId);
        return;
      }
      const dm = data.state.conversations.find(
        (item) => item.kind === "dm" && item.members.includes(targetAssistantId),
      );
      if (dm) {
        usePavraView.getState().selectChat(dm.id);
        onSetTab("chat");
      }
    },
    [data.state.conversations, onOpenAssistant, onSetTab],
  );
  return (
    <GlobalSearchModal
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      onToggle={onToggle}
      state={data.state}
      routines={data.state.routines}
      studios={data.state.studios}
      hostLabels={hostLabels}
      onSelectConversation={handleSelectConversation}
      onSelectTask={handleSelectTask}
      onSelectRoutine={handleSelectRoutine}
      onSelectPlaybook={handleSelectPlaybook}
      onSelectStudio={handleSelectStudio}
      onSelectAssistant={handleSelectAssistant}
    />
  );
}
function MemoryTab({
  data,
  assistant,
  onEdit,
}: {
  data: PavraData;
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
      onEdit={assistant ? onEdit : undefined}
    />
  );
}
function PlaybooksTab({ data, assistant }: { data: PavraData; assistant?: Assistant }) {
  const playbooks = useAssistantPlaybooks(data, assistant?.id);
  return (
    <PlaybooksPane
      assistant={assistant}
      playbooks={playbooks.playbooks}
      selectedSlug={playbooks.selectedSlug}
      content={playbooks.content}
      editorKey={playbooks.editorKey}
      loading={playbooks.loading}
      saving={playbooks.saving}
      dirty={playbooks.dirty}
      error={playbooks.error}
      onSelect={playbooks.select}
      onCreate={playbooks.create}
      onChange={playbooks.change}
      onSave={playbooks.save}
      onDelete={playbooks.remove}
      onReload={playbooks.reload}
    />
  );
}
function RoutinesTab({
  data,
  assistant,
  conversationId,
}: {
  data: PavraData;
  assistant?: Assistant;
  conversationId: string;
}) {
  const routines = useAssistantRoutines(data, assistant?.id, conversationId);
  return (
    <RoutinesPane
      assistant={assistant}
      routines={routines.routines}
      busyId={routines.busyId}
      saving={routines.saving}
      error={routines.error}
      onCreate={routines.create}
      onRunOnce={routines.runOnce}
      onPause={routines.pause}
      onResume={routines.resume}
      onDelete={routines.remove}
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
  const chatId = usePavraView((state) => state.chatId);
  const coordinatorId = usePavraView((state) => state.coordinatorId);
  const setThread = usePavraView((state) => state.setThread);
  const setDraft = usePavraView((state) => state.draft);
  const draftKey = JSON.stringify([coordinatorId, chatId, threadId]);
  const draft = usePavraView((state) => state.drafts[draftKey] ?? "");
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
  const turnsById = useMemo(
    () => new Map(data.state.turns.map((turn) => [turn.id, turn])),
    [data.state.turns],
  );
  const turnsByFinalMessageId = useMemo(() => {
    const map = new Map<string, Turn>();
    for (const turn of data.state.turns) {
      if (turn.finalMessageId) map.set(turn.finalMessageId, turn);
    }
    return map;
  }, [data.state.turns]);
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
  const pendingMessage = useRef<{
    id: string;
    content: string;
    quoteOf?: string;
    responseMode?: "roundtable";
  } | null>(null);
  const autoFlushedId = useRef<string | null>(null);
  const [queuesByLane, setQueuesByLane] = useState<Record<string, PendingQueueItem[]>>({});
  const queue = queuesByLane[draftKey] ?? EMPTY_QUEUE;
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    ref: ParsedFileRef;
    machineId?: string;
    agentId?: string;
    workspaceCwd?: string;
    workspaceId?: string;
    workspaceName?: string;
    group?: string;
  } | null>(null);
  const [forwardModalMessage, setForwardModalMessage] = useState<Message | null>(null);
  const [promoteTaskMessage, setPromoteTaskMessage] = useState<Message | null>(null);
  const [playbookModalSource, setPlaybookModalSource] = useState<{
    message?: Message | null;
    takeover?: Takeover | null;
    takeoverNote?: string;
  } | null>(null);
  // The toggle starts from the group's default; the user's own choice wins until the next send.
  const [roundtableChoice, setRoundtableChoice] = useState<boolean | null>(null);
  const changeDraft = useCallback(
    (value: string) => setDraft(draftKey, value),
    [draftKey, setDraft],
  );
  const removeQueuedItem = useCallback(
    (id: string) => {
      setQueuesByLane((current) => {
        const existing = current[draftKey];
        if (!existing?.some((item) => item.id === id)) return current;
        return {
          ...current,
          [draftKey]: existing.filter((item) => item.id !== id),
        };
      });
    },
    [draftKey],
  );
  const dispatchQueued = useCallback(
    async (item: PendingQueueItem, delivery?: "steer") => {
      if (pending) return;
      removeQueuedItem(item.id);
      setPending(true);
      setError(null);
      try {
        await data.call(sendMessage, {
          id: item.id,
          conversationId: chatId,
          threadId,
          content: item.content,
          ...(item.quoteOf ? { quoteOf: item.quoteOf } : {}),
          ...(item.responseMode ? { responseMode: item.responseMode } : {}),
          ...(delivery ? { delivery } : {}),
        });
        if (item.responseMode) setThread(item.id);
      } catch (failure) {
        setQueuesByLane((current) => {
          const existing = current[draftKey] ?? [];
          if (existing.some((entry) => entry.id === item.id)) return current;
          return { ...current, [draftKey]: [item, ...existing] };
        });
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setPending(false);
      }
    },
    [chatId, data, draftKey, pending, removeQueuedItem, setThread, threadId],
  );
  useEffect(() => {
    if (turns.length > 0) {
      autoFlushedId.current = null;
      return;
    }
    if (pending || !data.connected || queue.length === 0) return;
    const next = queue[0]!;
    if (autoFlushedId.current === next.id) return;
    autoFlushedId.current = next.id;
    void dispatchQueued(next);
  }, [data.connected, dispatchQueued, pending, queue, turns.length]);
  const handleSteerQueued = useCallback(
    (id: string) => {
      const item = queue.find((entry) => entry.id === id);
      if (!item || pending) return;
      autoFlushedId.current = null;
      void dispatchQueued(item, "steer");
    },
    [dispatchQueued, pending, queue],
  );
  const handleRemoveQueued = useCallback(
    (id: string) => {
      const item = queue.find((entry) => entry.id === id);
      if (!item) return;
      removeQueuedItem(id);
      const currentDraft = usePavraView.getState().drafts[draftKey] ?? "";
      if (!currentDraft.trim()) {
        setDraft(draftKey, item.content);
        if (item.quoteOf) setQuoteId(item.quoteOf);
      }
    },
    [draftKey, queue, removeQueuedItem, setDraft],
  );
  const stopTurn = useCallback(async () => {
    if (cancelling || turns.length === 0) return;
    setCancelling(true);
    setError(null);
    try {
      await Promise.all(turns.map((item) => data.call(cancelTurn, { id: item.turn.id })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCancelling(false);
    }
  }, [cancelling, data, turns]);
  const stopPress = useCallback(() => {
    void stopTurn();
  }, [stopTurn]);
  const eligibility = roundtableEligibility({ conversation, threadId, draft, members });
  const roundtableOn =
    eligibility.eligible && (roundtableChoice ?? conversation?.roundtable ?? false);
  const quoted = quoteId ? messagesById.get(quoteId) : undefined;
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      setError(null);
      try {
        await data.call(reactToMessage, {
          conversationId: chatId,
          messageId,
          emoji,
        });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    },
    [chatId, data],
  );
  const toggleSaveMessage = useCallback(
    async (message: Message) => {
      setError(null);
      try {
        await data.call(saveMessage, buildSaveMessageRequest({ message }));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    },
    [data],
  );
  const send = useCallback(
    async (extras?: ComposerSendExtras) => {
      const content = extras?.contentOverride ?? draft;
      if (!content.trim()) return;
      const delivery = extras?.delivery;
      const request = {
        content,
        ...(quoted ? { quoteOf: quoted.id } : {}),
        ...(roundtableOn ? { responseMode: "roundtable" as const } : {}),
      };
      if ((turns.length > 0 && delivery !== "steer") || pending) {
        const queuedItem: PendingQueueItem = { id: randomUUID(), ...request };
        setQueuesByLane((current) => ({
          ...current,
          [draftKey]: [...(current[draftKey] ?? []), queuedItem],
        }));
        setDraft(draftKey, "");
        pendingMessage.current = null;
        setQuoteId(null);
        setRoundtableChoice(null);
        setError(null);
        return;
      }
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
        await data.call(sendMessage, {
          ...message,
          conversationId: chatId,
          threadId,
          ...(delivery ? { delivery } : {}),
        });
        if (usePavraView.getState().drafts[draftKey] === draft) setDraft(draftKey, "");
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
    },
    [
      chatId,
      data,
      draft,
      draftKey,
      pending,
      quoted,
      roundtableOn,
      setDraft,
      setThread,
      threadId,
      turns.length,
    ],
  );
  const sendPress = useCallback(
    (extras?: ComposerSendExtras) => {
      void send(extras);
    },
    [send],
  );
  const rows = useMemo(
    () =>
      buildConversationMessageRows({
        state: data.state,
        chatId,
        threadId,
        coordinatorId,
        conversation,
        assistantsById,
        messagesById,
        tasksById,
        turnsById,
        turnsByFinalMessageId,
        wiring,
        onOpenTurn,
        setThread,
        setQuoteId,
        setPreviewTarget,
        setForwardModalMessage,
        setPromoteTaskMessage,
        setPlaybookModalSource,
        toggleReaction,
        toggleSaveMessage,
      }),
    [
      assistantsById,
      chatId,
      conversation,
      coordinatorId,
      data.state,
      messagesById,
      onOpenTurn,
      setThread,
      tasksById,
      threadId,
      toggleReaction,
      toggleSaveMessage,
      turnsByFinalMessageId,
      turnsById,
      wiring,
    ],
  );
  useLiveTurnDemand(
    `pavra:${draftKey}`,
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
  const [activeTakeover, setActiveTakeover] = useState<{
    takeover: Takeover;
    assistantName: string;
  } | null>(null);
  const [takeoverBusyId, setTakeoverBusyId] = useState<string | null>(null);
  const laneTakeovers = useMemo(
    () =>
      (data.state.takeovers ?? []).filter(
        (item) =>
          item.status === "pending" &&
          item.conversationId === chatId &&
          (item.threadId ?? null) === (threadId ?? null),
      ),
    [chatId, data.state.takeovers, threadId],
  );
  const handleResolveTakeover = useCallback(
    async (takeoverId: string) => {
      setTakeoverBusyId(takeoverId);
      setError(null);
      try {
        await data.call(resolveTakeover, { id: takeoverId });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setTakeoverBusyId((current) => (current === takeoverId ? null : current));
      }
    },
    [data],
  );
  const handleCancelTakeover = useCallback(
    async (takeoverId: string) => {
      setTakeoverBusyId(takeoverId);
      setError(null);
      try {
        await data.call(cancelTakeover, { id: takeoverId });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setTakeoverBusyId((current) => (current === takeoverId ? null : current));
      }
    },
    [data],
  );
  const handleOpenTakeover = useCallback(
    (takeover: Takeover) => {
      const assistantName = assistantsById.get(takeover.assistantId)?.name ?? "Assistant";
      setActiveTakeover({ takeover, assistantName });
    },
    [assistantsById],
  );
  const handleResolveTakeoverPress = useCallback(
    (id: string) => {
      void handleResolveTakeover(id);
    },
    [handleResolveTakeover],
  );
  const handleCancelTakeoverPress = useCallback(
    (id: string) => {
      void handleCancelTakeover(id);
    },
    [handleCancelTakeover],
  );
  const closeTakeoverModal = useCallback(() => {
    setActiveTakeover(null);
  }, []);
  const takeoversNode = useMemo(
    () =>
      laneTakeovers.length > 0 ? (
        <View style={TAKEOVERS_CONTAINER}>
          {laneTakeovers.map((item) => {
            const assistantName = assistantsById.get(item.assistantId)?.name ?? "Assistant";
            return (
              <TakeoverCard
                key={item.id}
                takeover={item}
                assistantName={assistantName}
                busy={takeoverBusyId === item.id}
                onOpenTakeover={handleOpenTakeover}
                onResolve={handleResolveTakeoverPress}
                onCancel={handleCancelTakeoverPress}
              />
            );
          })}
        </View>
      ) : null,
    [
      assistantsById,
      handleCancelTakeoverPress,
      handleOpenTakeover,
      handleResolveTakeoverPress,
      laneTakeovers,
      takeoverBusyId,
    ],
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
    <>
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
        takeovers={takeoversNode}
        queue={queue}
        onSteerQueued={handleSteerQueued}
        onRemoveQueued={handleRemoveQueued}
        onStop={stopPress}
        cancelling={cancelling}
      />
      <ConversationActionModals
        data={data}
        chatId={chatId}
        conversation={conversation}
        assistantsById={assistantsById}
        wiring={wiring}
        activeTakeover={activeTakeover}
        onCloseTakeover={closeTakeoverModal}
        previewTarget={previewTarget}
        setPreviewTarget={setPreviewTarget}
        forwardModalMessage={forwardModalMessage}
        setForwardModalMessage={setForwardModalMessage}
        promoteTaskMessage={promoteTaskMessage}
        setPromoteTaskMessage={setPromoteTaskMessage}
        playbookModalSource={playbookModalSource}
        setPlaybookModalSource={setPlaybookModalSource}
      />
    </>
  );
}

interface PreviewTargetState {
  ref: ParsedFileRef;
  machineId?: string;
  agentId?: string;
  workspaceCwd?: string;
  workspaceId?: string;
  workspaceName?: string;
  group?: string;
}

interface PlaybookModalSourceState {
  message?: Message | null;
  takeover?: Takeover | null;
  takeoverNote?: string;
}

function resolveRowMachineId(
  task: Task | undefined,
  turn: Turn | undefined,
  assistant: Assistant | undefined,
  coordinatorId: string,
): string {
  const execServer = task ? task.execution?.serverId : undefined;
  return execServer ?? task?.serverId ?? turn?.serverId ?? assistant?.serverId ?? coordinatorId;
}

function lookupSessionAgent(machineId: string | undefined, agentId: string | undefined) {
  if (!machineId || !agentId) return undefined;
  const session = useSessionStore.getState().sessions[machineId];
  if (!session) return undefined;
  return session.agents.get(agentId) ?? session.agentDetails.get(agentId);
}

function resolveAssistantDefaultDir(assistant: Assistant | undefined): string | undefined {
  if (!assistant || !assistant.autonomy) return undefined;
  return assistant.autonomy.targets[0]?.directory;
}

function resolveRowWorkspace(input: {
  task: Task | undefined;
  turn: Turn | undefined;
  assistant: Assistant | undefined;
  coordinatorId: string;
  conversation: PavraData["state"]["conversations"][number] | undefined;
}) {
  const { task, turn, assistant, coordinatorId, conversation } = input;
  const machineId = resolveRowMachineId(task, turn, assistant, coordinatorId);
  const agentId = (task ? task.execution?.agentId : undefined) ?? turn?.agentId;
  const sessionAgent = lookupSessionAgent(machineId, agentId);
  const workspaceId = (task ? task.execution?.workspaceId : undefined) ?? sessionAgent?.workspaceId;
  const workspaceCwd =
    task?.directory ?? sessionAgent?.cwd ?? resolveAssistantDefaultDir(assistant);
  const workspaceName = assistant?.name ?? conversation?.name ?? "Workspace";
  const group = conversation?.kind === "group" ? conversation.name : "Chat";
  return { machineId, agentId, workspaceId, workspaceCwd, workspaceName, group };
}

function buildRowEventAndTask(input: {
  message: Message;
  task: Task | undefined;
  threadId: string | null;
  assistantsById: ReadonlyMap<string, Assistant>;
  wiring: TaskWiring;
}) {
  const { message, task, threadId, assistantsById, wiring } = input;
  const taskId = message.taskId;
  const inTaskThread = threadId !== null && message.id === threadId;
  const event =
    message.kind === "task_event" && taskId
      ? {
          note: taskEventNote(message, task),
          onOpen: task ? () => wiring.openThread(taskId) : undefined,
          respond: (requestId: string, behavior: "allow" | "deny") =>
            wiring.respond(taskId, requestId, behavior),
        }
      : undefined;
  const taskCard =
    task && isTaskRoot(message)
      ? {
          task,
          assistantName: assistantsById.get(task.assistantId)?.name,
          hostLabel: wiring.hostLabel(task.serverId),
          inThread: inTaskThread,
          actions: wiring.actionsFor(task, inTaskThread),
        }
      : undefined;
  return { event, taskCard };
}

function resolveSavePlaybookAction(
  message: Message,
  lineage: ReturnType<typeof buildTurnLineage> | undefined,
  takeovers: readonly Takeover[] | undefined,
  setPlaybookModalSource: (next: PlaybookModalSourceState | null) => void,
) {
  if (message.senderId === "user" || message.senderId === "system") return undefined;
  return () => {
    const firstTakeoverId = lineage?.takeovers[0]?.id;
    const turnTakeover = firstTakeoverId
      ? ((takeovers ?? []).find((item) => item.id === firstTakeoverId) ?? null)
      : null;
    setPlaybookModalSource({ message, takeover: turnTakeover });
  };
}

function buildConversationMessageRows(input: {
  state: PavraData["state"];
  chatId: string;
  threadId: string | null;
  coordinatorId: string;
  conversation: PavraData["state"]["conversations"][number] | undefined;
  assistantsById: ReadonlyMap<string, Assistant>;
  messagesById: ReadonlyMap<string, Message>;
  tasksById: ReadonlyMap<string, Task>;
  turnsById: ReadonlyMap<string, Turn>;
  turnsByFinalMessageId: ReadonlyMap<string, Turn>;
  wiring: TaskWiring;
  onOpenTurn(turn: Turn): void;
  setThread(id: string | null): void;
  setQuoteId(id: string | null): void;
  setPreviewTarget(target: PreviewTargetState | null): void;
  setForwardModalMessage(message: Message | null): void;
  setPromoteTaskMessage(message: Message | null): void;
  setPlaybookModalSource(source: PlaybookModalSourceState | null): void;
  toggleReaction(messageId: string, emoji: string): Promise<void>;
  toggleSaveMessage(message: Message): Promise<void>;
}) {
  const {
    state,
    chatId,
    threadId,
    coordinatorId,
    conversation,
    assistantsById,
    messagesById,
    tasksById,
    turnsById,
    turnsByFinalMessageId,
    wiring,
    onOpenTurn,
    setThread,
    setQuoteId,
    setPreviewTarget,
    setForwardModalMessage,
    setPromoteTaskMessage,
    setPlaybookModalSource,
    toggleReaction,
    toggleSaveMessage,
  } = input;
  const replyCounts = new Map<string, number>();
  for (const message of state.messages) {
    if (message.threadId && !isNoteMessage(message)) {
      replyCounts.set(message.threadId, (replyCounts.get(message.threadId) ?? 0) + 1);
    }
  }
  const nameOf = (senderId: string) => {
    if (senderId === "user") return "You";
    if (senderId === "system") return "System";
    return assistantsById.get(senderId)?.name ?? "Assistant";
  };
  return sortMessages(
    state.messages.filter(
      (message) =>
        message.conversationId === chatId &&
        (message.threadId === threadId || message.id === threadId),
    ),
  ).map((message) => {
    const task = message.taskId ? tasksById.get(message.taskId) : undefined;
    const assistant = assistantsById.get(message.senderId);
    const original = message.quoteOf ? messagesById.get(message.quoteOf) : undefined;
    const turn = resolveMessageTurn(message, turnsByFinalMessageId, turnsById);
    const lineage = turn
      ? buildTurnLineage({
          turn,
          message,
          turns: state.turns,
          messages: state.messages,
          peerMessages: state.peerMessages,
          tasks: state.tasks,
          takeovers: state.takeovers,
          assistants: state.assistants,
        })
      : undefined;
    const ws = resolveRowWorkspace({ task, turn, assistant, coordinatorId, conversation });
    const { event, taskCard } = buildRowEventAndTask({
      message,
      task,
      threadId,
      assistantsById,
      wiring,
    });
    return {
      message,
      sender: nameOf(message.senderId),
      seed: `${assistant?.id}:${assistant?.name}`,
      replyCount: replyCounts.get(message.id) ?? 0,
      reactions: message.reactions,
      onReact: (emoji: string) => {
        void toggleReaction(message.id, emoji);
      },
      reply: threadId ? undefined : () => setThread(message.id),
      onQuote: canQuote(message, conversation) ? () => setQuoteId(message.id) : undefined,
      onOpenProcess: turn ? () => onOpenTurn(turn) : undefined,
      provenance: lineage?.hasLineage ? lineage.provenance : undefined,
      workspaceCwd: ws.workspaceCwd,
      onPressFileRef: (ref: ParsedFileRef) => {
        setPreviewTarget({
          ref,
          ...ws,
          workspaceCwd: resolvePreviewWorkspaceCwd(ref.filePath, ws.workspaceCwd, task?.directory),
        });
      },
      saved: isMessageSaved(message),
      forwardedFrom: message.forwardedFrom,
      onToggleSave: () => {
        void toggleSaveMessage(message);
      },
      onForward: () => setForwardModalMessage(message),
      onPromoteToTask: () => setPromoteTaskMessage(message),
      onSavePlaybook: resolveSavePlaybookAction(
        message,
        lineage,
        state.takeovers,
        setPlaybookModalSource,
      ),
      quote: message.quoteOf
        ? {
            sender: original ? nameOf(original.senderId) : "Quoted message",
            text: original ? quotePreview(original.content) : "No longer available",
          }
        : undefined,
      routineBadge: formatMessageRoutineBadge(message, turn),
      note: message.kind === "system" ? noteLabel(message) : undefined,
      event,
      taskCard,
    };
  });
}

function resolvePreviewWorkspaceCwd(
  filePath: string,
  workspaceCwd: string | undefined,
  taskDirectory: string | undefined,
): string | undefined {
  if (!filePath.startsWith("/")) return workspaceCwd;
  if (taskDirectory) return taskDirectory;
  if (!workspaceCwd) return undefined;
  const normalizedCwd = workspaceCwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedFile = filePath.trim().replace(/\\/g, "/");
  if (normalizedFile === normalizedCwd || normalizedFile.startsWith(`${normalizedCwd}/`)) {
    return workspaceCwd;
  }
  return undefined;
}

async function readPreviewFileWithAgentFallback(
  targetMachineId: string,
  filePath: string,
  previewTarget: PreviewTargetState | null,
) {
  let resolvedCwd = previewTarget?.workspaceCwd;
  if (!resolvedCwd && !filePath.startsWith("/") && previewTarget?.agentId) {
    const host = getHostRuntimeStore().getClient(targetMachineId);
    const fetched = await host?.fetchAgent({ agentId: previewTarget.agentId }).catch(() => null);
    if (fetched?.agent.cwd) {
      resolvedCwd = fetched.agent.cwd;
    }
  }
  return readWorkspaceFileForPreview(targetMachineId, filePath, resolvedCwd);
}

function openPreviewTargetInStudio(
  ref: ParsedFileRef,
  previewTarget: PreviewTargetState | null,
): void {
  if (!previewTarget?.machineId) return;
  const targetMachineId = previewTarget.machineId;
  if (previewTarget.workspaceId) {
    openFileRefInStudio({
      ref,
      serverId: targetMachineId,
      workspaceId: previewTarget.workspaceId,
      workspaceName: previewTarget.workspaceName ?? "Workspace",
      workspaceCwd: previewTarget.workspaceCwd,
      group: previewTarget.group,
    });
    return;
  }
  if (!previewTarget.agentId) return;
  const host = getHostRuntimeStore().getClient(targetMachineId);
  void host
    ?.fetchAgent({ agentId: previewTarget.agentId })
    .then((result) => {
      if (!result?.agent.workspaceId) return null;
      openFileRefInStudio({
        ref,
        serverId: targetMachineId,
        workspaceId: result.agent.workspaceId,
        workspaceName: previewTarget.workspaceName ?? "Workspace",
        workspaceCwd: result.agent.cwd ?? previewTarget.workspaceCwd,
        group: previewTarget.group,
      });
      return null;
    })
    .catch(() => null);
}

function resolvePromoteDefaultDirectory(
  promoteTaskMessage: Message,
  conversation: PavraData["state"]["conversations"][number],
  assistantsById: ReadonlyMap<string, Assistant>,
): string | undefined {
  return (
    resolveAssistantDefaultDir(assistantsById.get(promoteTaskMessage.senderId)) ??
    resolveAssistantDefaultDir(assistantsById.get(conversation.members[0] ?? ""))
  );
}

function ConversationActionModals({
  data,
  chatId,
  conversation,
  assistantsById,
  wiring,
  activeTakeover,
  onCloseTakeover,
  previewTarget,
  setPreviewTarget,
  forwardModalMessage,
  setForwardModalMessage,
  promoteTaskMessage,
  setPromoteTaskMessage,
  playbookModalSource,
  setPlaybookModalSource,
}: {
  data: PavraData;
  chatId: string;
  conversation: PavraData["state"]["conversations"][number] | undefined;
  assistantsById: ReadonlyMap<string, Assistant>;
  wiring: TaskWiring;
  activeTakeover: { takeover: Takeover; assistantName: string } | null;
  onCloseTakeover(): void;
  previewTarget: PreviewTargetState | null;
  setPreviewTarget(target: PreviewTargetState | null): void;
  forwardModalMessage: Message | null;
  setForwardModalMessage(message: Message | null): void;
  promoteTaskMessage: Message | null;
  setPromoteTaskMessage(message: Message | null): void;
  playbookModalSource: PlaybookModalSourceState | null;
  setPlaybookModalSource(source: PlaybookModalSourceState | null): void;
}) {
  const handleClosePreview = useCallback(() => setPreviewTarget(null), [setPreviewTarget]);
  const handleReadFile = useCallback(
    (targetMachineId: string, filePath: string) =>
      readPreviewFileWithAgentFallback(targetMachineId, filePath, previewTarget),
    [previewTarget],
  );
  const handleOpenInStudio = useCallback(
    (ref: ParsedFileRef) => openPreviewTargetInStudio(ref, previewTarget),
    [previewTarget],
  );
  const handleForwarded = useCallback(
    (targetConversationId: string) => {
      if (targetConversationId !== chatId) {
        usePavraView.getState().selectChat(targetConversationId);
        usePavraView.getState().setThread(null);
      }
    },
    [chatId],
  );
  const handleCloseForward = useCallback(
    () => setForwardModalMessage(null),
    [setForwardModalMessage],
  );
  const handleTaskCreated = useCallback(
    (createdTaskId: string) => {
      wiring.openThread(createdTaskId);
    },
    [wiring],
  );
  const handleClosePromoteTask = useCallback(
    () => setPromoteTaskMessage(null),
    [setPromoteTaskMessage],
  );
  const handleClosePlaybook = useCallback(
    () => setPlaybookModalSource(null),
    [setPlaybookModalSource],
  );

  return (
    <>
      {activeTakeover ? (
        <BrowserTakeoverModal
          takeover={activeTakeover.takeover}
          assistantName={activeTakeover.assistantName}
          data={data}
          onClose={onCloseTakeover}
        />
      ) : null}
      <FileRefPreviewModal
        fileRef={previewTarget?.ref ?? null}
        machineId={previewTarget?.machineId}
        workspaceCwd={previewTarget?.workspaceCwd}
        onClose={handleClosePreview}
        onReadFile={handleReadFile}
        onOpenInStudio={handleOpenInStudio}
      />
      {forwardModalMessage ? (
        <ForwardMessageModal
          message={forwardModalMessage}
          conversations={data.state.conversations}
          assistants={data.state.assistants}
          data={data}
          onForwarded={handleForwarded}
          onClose={handleCloseForward}
        />
      ) : null}
      {promoteTaskMessage && conversation ? (
        <PromoteToTaskModal
          message={promoteTaskMessage}
          conversation={conversation}
          assistants={data.state.assistants}
          defaultDirectory={resolvePromoteDefaultDirectory(
            promoteTaskMessage,
            conversation,
            assistantsById,
          )}
          data={data}
          onTaskCreated={handleTaskCreated}
          onClose={handleClosePromoteTask}
        />
      ) : null}
      {playbookModalSource ? (
        <SavePlaybookModal
          message={playbookModalSource.message}
          takeover={playbookModalSource.takeover}
          takeoverNote={playbookModalSource.takeoverNote}
          conversation={conversation ?? null}
          assistants={data.state.assistants}
          data={data}
          onClose={handleClosePlaybook}
        />
      ) : null}
    </>
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
