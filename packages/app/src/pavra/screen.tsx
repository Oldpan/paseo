import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { PressHighlight } from "@/components/ui/press-highlight";
import { randomUUID } from "expo-crypto";
import { RetainedPanel } from "@/components/retained-panel";
import { UsageSidebarRoot } from "@/usage/sidebar-item";
import { getHostRuntimeStore, useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";
import {
  createConversation,
  saveAssistant,
  type Assistant,
  type MachineInfo,
  startTask,
  type Task,
  type Turn,
} from "../../../../extensions/pavra/shared/contracts";
import { useAssistantMachines, usePavraData, useMachines, type PavraData } from "./data";
import { normalizeAutonomy, parseAutonomy, serializeAutonomy, validateAutonomy } from "./autonomy";
import { deriveInboxState } from "./inbox";
import { resolveDefaultChatId, resolveDefaultCoordinatorId } from "./model";
import { taskIdOfThread, taskTitle } from "./task-view";
import { usePavraTitle } from "./title";
import { CoordinatorNotice } from "./coordinator-notice";
import { usePavraView, type SidebarSection } from "./store";
import { palettes } from "./palette";
import { PavraChat } from "./chat";
import { PavraForm } from "./forms";
import { findLatestNonTaskTurn, turnColumnName } from "./chat-studio";
import { openTurnProcess, Studio, StudioHomePanel } from "./studio";
import { TurnProcessDrawer } from "./turn-process-drawer";
import { PavraTheme, usePavraDark } from "./ui/ThemeProvider";
import { AnimatedDrawer } from "./ui/AnimatedDrawer";
import { CoordinatorPickerModal } from "./ui/CoordinatorPickerModal";
import { InboxPane } from "./ui/InboxPane";
import { Sidebar } from "./ui/Sidebar";

const FILL = { flex: 1, minHeight: 0, position: "relative" } as const;
const CONTENT = { flex: 1, minHeight: 0, flexDirection: "row" } as const;
const WORKSPACES_MODAL = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 40,
} as const;
const ASSISTANT_FIELDS = [
  { name: "name", label: "Name", initial: "" },
  { name: "provider", label: "Provider / model", initial: "" },
  { name: "persona", label: "Persona", initial: "", multiline: true },
  { name: "memory", label: "Initial memory", initial: "", multiline: true },
];
const ERROR_BANNER = {
  paddingHorizontal: 16,
  paddingVertical: 8,
  borderBottomWidth: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
} as const;
const DISMISS_TEXT = { fontSize: 12, marginLeft: 8 } as const;

function assistantFormFields(input: {
  assistant: Assistant | undefined;
  editing: string | null;
  coordinatorId: string;
  hosts: Array<{ serverId: string; label: string }>;
  formIds: ReturnType<typeof freshFormIds>;
  machines: MachineInfo[];
  defaultServerId?: string | null;
}) {
  const { assistant, editing, coordinatorId, hosts, formIds, machines, defaultServerId } = input;
  const machineId = assistant?.serverId ?? defaultServerId ?? coordinatorId;
  const machineOptions = machines
    .filter((machine) => machine.role === "coordinator" || machine.role === "member")
    .map((machine) => ({
      id: machine.serverId,
      value: machine.serverId,
      label: machine.label,
    }));
  if (!machineOptions.some((o) => o.value === machineId)) {
    machineOptions.unshift({
      id: machineId,
      value: machineId,
      label: hosts.find((h) => h.serverId === machineId)?.label ?? machineId,
    });
  }
  return [
    { name: "id", label: "", initial: editing ?? formIds.assistant, hidden: true },
    { name: "chatId", label: "", initial: formIds.chat, hidden: true },
    // The model list follows the machine: a new assistant picks one; an existing one keeps its own.
    {
      name: "server",
      label: "Machine",
      initial: machineId,
      hidden: !editing && machineOptions.length < 2,
      readOnly: Boolean(editing),
      options: machineOptions,
    },
    ...ASSISTANT_FIELDS.filter((field) => !editing || field.name !== "memory").map((field) => ({
      name: field.name,
      label: field.label,
      modelHost: field.name === "provider" ? machineId : undefined,
      multiline: field.multiline,
      initial: assistant?.[field.name as "name" | "provider" | "persona"] ?? "",
    })),
    {
      name: "autonomy",
      label: "Tasks",
      initial: serializeAutonomy(assistant?.autonomy),
      autonomy: {
        hosts: hosts.map((host) => ({ value: host.serverId, label: host.label })),
        defaultHost: coordinatorId,
      },
    },
  ];
}

// Option value for "no default responder": a plain message then goes to the first member.
const NO_DEFAULT_RESPONDER = "first";
const VALID_SECTIONS = new Set<SidebarSection>(["chat", "inbox", "members", "search"]);

function usePavraUrlLocationSync(viewHydrated: boolean) {
  const searchParams = useLocalSearchParams<{
    section?: string;
    chatId?: string;
    threadId?: string;
  }>();
  const appliedParamsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!viewHydrated) return;
    const paramSection = typeof searchParams.section === "string" ? searchParams.section : "";
    const paramChatId = typeof searchParams.chatId === "string" ? searchParams.chatId : "";
    const paramThreadId = typeof searchParams.threadId === "string" ? searchParams.threadId : "";
    if (!paramSection && !paramChatId && !paramThreadId) return;
    const key = `${paramSection}\0${paramChatId}\0${paramThreadId}`;
    if (appliedParamsRef.current === key) return;
    appliedParamsRef.current = key;
    const view = usePavraView.getState();
    if (paramChatId) view.selectChat(paramChatId);
    if (paramThreadId) view.setThread(paramThreadId);
    if (VALID_SECTIONS.has(paramSection as SidebarSection)) {
      view.setSection(paramSection as SidebarSection);
      view.setMode("chat");
    }
  }, [searchParams.chatId, searchParams.section, searchParams.threadId, viewHydrated]);
}

function usePavraHydrationAndDefaults(
  coordinatorId: string,
  rawCoordinatorId: string,
  chatId: string,
  rawChatId: string,
  selectCoordinator: (id: string) => void,
) {
  const [bootSettled, setBootSettled] = useState(() =>
    getHostRuntimeStore().isHostRegistryLoaded(),
  );
  const [viewHydrated, setViewHydrated] = useState(() => usePavraView.persist.hasHydrated());
  useEffect(() => {
    let active = true;
    void getHostRuntimeStore()
      .boot()
      .finally(() => {
        if (active) setBootSettled(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (usePavraView.persist.hasHydrated()) {
      setViewHydrated(true);
      return;
    }
    return usePavraView.persist.onFinishHydration(() => {
      setViewHydrated(true);
    });
  }, []);
  useEffect(() => {
    if (!viewHydrated) return;
    if (coordinatorId && coordinatorId !== rawCoordinatorId) {
      selectCoordinator(coordinatorId);
    }
  }, [coordinatorId, rawCoordinatorId, selectCoordinator, viewHydrated]);
  useEffect(() => {
    if (!viewHydrated) return;
    if (chatId && chatId !== rawChatId) {
      usePavraView.setState({ chatId });
    }
  }, [chatId, rawChatId, viewHydrated]);
  usePavraUrlLocationSync(viewHydrated);
  return { bootSettled, viewHydrated };
}

function shouldOpenCoordinatorPicker(input: {
  form: string | null;
  coordinatorId: string;
  viewHydrated: boolean;
  hostRegistryStatus: string;
  bootSettled: boolean;
}): boolean {
  if (input.form === "hosts") return true;
  return (
    !input.coordinatorId &&
    input.viewHydrated &&
    input.hostRegistryStatus === "ready" &&
    input.bootSettled
  );
}

function resolveActivePavraPanels(
  mode: "chat" | "studio" | "assistants",
  section: SidebarSection,
  coordinatorId: string,
) {
  const hasCoordinator = Boolean(coordinatorId);
  return {
    chatActive: mode === "chat" && section !== "inbox" && hasCoordinator,
    inboxActive: mode === "chat" && section === "inbox" && hasCoordinator,
    studioActive: mode === "studio",
  };
}

export function PavraScreen() {
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const compact = useIsCompactFormFactor();
  const dark = usePavraDark();
  const palette = dark ? palettes.dark : palettes.light;
  const rawCoordinatorId = usePavraView((state) => state.coordinatorId);
  const rawChatId = usePavraView((state) => state.chatId);
  const mode = usePavraView((state) => state.mode);
  const section = usePavraView((state) => state.section);
  const coordinatorId = resolveDefaultCoordinatorId(rawCoordinatorId, hosts);
  const data = usePavraData(coordinatorId);
  const selectCoordinator = usePavraView((state) => state.selectCoordinator);
  const chatId = resolveDefaultChatId(rawChatId, data.state.conversations);
  const { bootSettled, viewHydrated } = usePavraHydrationAndDefaults(
    coordinatorId,
    rawCoordinatorId,
    chatId,
    rawChatId,
    selectCoordinator,
  );
  const conversationTitle = data.state.conversations.find((item) => item.id === chatId)?.name;
  usePavraTitle(mode, conversationTitle, section);
  const [form, setForm] = useState<"assistant" | "group" | "task" | "workspaces" | "hosts" | null>(
    null,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [defaultServerId, setDefaultServerId] = useState<string | null>(null);
  // Ids for records a form creates. Fresh on every open so a second creation never reuses the
  // first one's ids; kept while the form is open so a retried save stays idempotent.
  const [formIds, setFormIds] = useState(freshFormIds);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("General");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [processTurnId, setProcessTurnId] = useState<string | null>(null);
  const closeProcessDrawer = useCallback(() => setProcessTurnId(null), []);
  const dismissError = useCallback(() => setError(null), []);
  const errorBannerStyle = useMemo(
    () => [
      ERROR_BANNER,
      {
        backgroundColor: palette.surfaceElevated,
        borderBottomColor: palette.destructive,
      },
    ],
    [palette.destructive, palette.surfaceElevated],
  );
  const showSidebar = useCallback(() => setSidebarOpen(true), []);
  const hideSidebar = useCallback(() => setSidebarOpen(false), []);
  const text = useMemo(() => ({ color: palette.textPrimary }), [palette.textPrimary]);
  const frame = useMemo(
    () => ({ flex: 1, backgroundColor: palette.surfacePrimary }),
    [palette.surfacePrimary],
  );
  const changeChat = usePavraView((state) => state.selectChat);
  const close = useCallback(() => {
    setForm(null);
    setEditing(null);
    setDefaultServerId(null);
  }, []);
  const openForm = useCallback((next: "assistant" | "group" | "task") => {
    setFormIds(freshFormIds());
    setForm(next);
    // Forms overlay the chat pane (zIndex 50); the compact sidebar sits above that (zIndex 100).
    setSidebarOpen(false);
  }, []);
  const showAssistant = useCallback(() => {
    setEditing(null);
    setDefaultServerId(null);
    openForm("assistant");
  }, [openForm]);
  const showAssistantForMachine = useCallback(
    (serverId: string) => {
      setEditing(null);
      setDefaultServerId(serverId);
      openForm("assistant");
    },
    [openForm],
  );
  const showGroup = useCallback(() => openForm("group"), [openForm]);
  const showTask = useCallback(() => openForm("task"), [openForm]);
  const showWorkspaces = useCallback(() => {
    setForm("workspaces");
    setSidebarOpen(false);
  }, []);
  const showHosts = useCallback(() => {
    setForm("hosts");
    setSidebarOpen(false);
  }, []);

  const openTask = useCallback((task: Task) => {
    setError(null);
    if (!task.execution) return;
    const { serverId, workspaceId, agentId } = task.execution;
    prepareWorkspaceTab(
      { serverId, workspaceId, target: { kind: "agent", agentId }, pin: true },
      { openTab: useWorkspaceLayoutStore.getState().deferOpenTab },
    );
    usePavraView
      .getState()
      .openColumn({ serverId, workspaceId, name: taskTitle(task).slice(0, 40), group: "Tasks" });
  }, []);
  const openTurnInStudio = useCallback(
    (turn: Turn) => {
      setProcessTurnId(null);
      const targetAssistant = data.state.assistants.find((a) => a.id === turn.assistantId);
      const conversation = data.state.conversations.find((c) => c.id === turn.conversationId);
      const rootMessage = turn.threadId
        ? data.state.messages.find((m) => m.id === turn.threadId)
        : undefined;
      const assistantName = targetAssistant?.name ?? "Assistant";
      const columnName = turnColumnName(
        assistantName,
        conversation,
        turn.threadId,
        rootMessage,
        turn.conversationId,
      );
      const studioGroup = conversation?.kind === "group" ? conversation.name : "Chat";
      void openTurnProcess(turn, coordinatorId, setError, { columnName, group: studioGroup });
    },
    [coordinatorId, data.state.assistants, data.state.conversations, data.state.messages],
  );
  const openTurn = useCallback((turn: Turn) => {
    setError(null);
    setProcessTurnId(turn.id);
  }, []);
  const openChatStudio = useCallback(
    (conversationId: string, targetThreadId: string | null) => {
      setError(null);
      const taskId = taskIdOfThread(targetThreadId);
      if (taskId) {
        const task = data.state.tasks.find((t) => t.id === taskId);
        if (task?.execution) {
          openTask(task);
          return;
        }
        setError("This task has no execution workspace yet.");
        return;
      }
      const conversation = data.state.conversations.find((c) => c.id === conversationId);
      if (!conversation) return;
      const rootMessage = targetThreadId
        ? data.state.messages.find((m) => m.id === targetThreadId)
        : undefined;
      const studioGroup = conversation.kind === "group" ? conversation.name : "Chat";
      let openedAny = false;
      for (const memberId of conversation.members) {
        const turn = findLatestNonTaskTurn(data.state.turns, memberId, {
          conversationId,
          threadId: targetThreadId,
        });
        if (turn) {
          openedAny = true;
          const assistant = data.state.assistants.find((a) => a.id === memberId);
          const assistantName = assistant?.name ?? "Assistant";
          const columnName = turnColumnName(
            assistantName,
            conversation,
            targetThreadId,
            rootMessage,
            conversationId,
          );
          void openTurnProcess(turn, coordinatorId, setError, {
            columnName,
            group: studioGroup,
            clearError: false,
          });
        }
      }
      if (!openedAny) {
        setError("Send a message first so the assistant starts its execution workspace.");
      }
    },
    [
      coordinatorId,
      data.state.assistants,
      data.state.conversations,
      data.state.messages,
      data.state.tasks,
      data.state.turns,
      openTask,
    ],
  );
  const machines = useAssistantMachines(data.invoke, form, editing);
  const assistant = data.state.assistants.find((item) => item.id === editing);
  const save = useCallback(
    async (values: Record<string, string>) => {
      if (form === "assistant") {
        const id = values.id;
        const autonomy = parseAutonomy(values.autonomy);
        const problem = validateAutonomy(
          autonomy,
          hosts.map((host) => host.serverId),
          (serverId) => hosts.find((host) => host.serverId === serverId)?.label ?? serverId,
        );
        if (problem) throw new Error(problem);
        const normalized = normalizeAutonomy(
          autonomy,
          (serverId) => hosts.find((host) => host.serverId === serverId)?.label,
        );
        // The machine is chosen once, at creation; edits resend it unchanged.
        const serverId = editing ? assistant?.serverId : values.server;
        await data.call(saveAssistant, {
          id,
          name: values.name,
          provider: values.provider,
          persona: values.persona,
          ...(serverId && serverId !== coordinatorId ? { serverId } : {}),
          ...(normalized ? { autonomy: normalized } : {}),
          // Only seeds MEMORY.md for a new assistant; an existing one edits it in the Memory tab.
          ...(editing ? {} : { memory: values.memory }),
        });
        if (!editing) {
          const chat = await data.call(createConversation, {
            id: values.chatId,
            name: values.name,
            kind: "dm",
            members: [id],
            roundtable: false,
          });
          changeChat(chat.id);
        }
      }
      if (form === "group") {
        const names = values.members.split(",").map((value) => value.trim());
        const members = names.map((name) => {
          const member = data.state.assistants.find((item) => item.name === name);
          if (!member) throw new Error(`Unknown assistant: ${name}`);
          return member.id;
        });
        const responder = values.defaultResponder;
        if (responder && responder !== NO_DEFAULT_RESPONDER && !members.includes(responder))
          throw new Error("The default responder must be one of the group's assistants.");
        const chat = await data.call(createConversation, {
          id: values.id,
          name: values.name,
          kind: "group",
          members,
          roundtable: values.roundtable === "yes",
          ...(responder && responder !== NO_DEFAULT_RESPONDER
            ? { defaultResponderId: responder }
            : {}),
        });
        changeChat(chat.id);
      }
      if (form === "task") {
        const conversation = data.state.conversations.find((item) => item.id === chatId);
        const member = data.state.assistants.find(
          (item) => item.name === values.assistant && conversation?.members.includes(item.id),
        );
        if (!member) throw new Error("Choose an assistant in this chat.");
        await data.call(startTask, {
          id: values.id,
          conversationId: chatId,
          assistantId: member.id,
          prompt: values.prompt,
          serverId: values.server,
          directory: values.directory,
          provider: values.provider,
          isolation: values.isolation === "directory" ? "directory" : "worktree",
        });
      }
      close();
    },
    [assistant, changeChat, chatId, close, coordinatorId, data, editing, form, hosts],
  );
  const selectChat = useCallback(
    (id: string) => {
      changeChat(id);
      setForm(null);
      setSidebarOpen(false);
      setProcessTurnId(null);
    },
    [changeChat],
  );
  const openInboxConversation = useCallback(
    (targetChatId: string, targetThreadId: string | null) => {
      selectChat(targetChatId);
      usePavraView.getState().setThread(targetThreadId);
    },
    [selectChat],
  );
  const editAssistant = useCallback(
    (id: string) => {
      setEditing(id);
      setDefaultServerId(null);
      openForm("assistant");
    },
    [openForm],
  );
  const openAssistantChat = useCallback(
    (assistantId: string) => {
      const existing = data.state.conversations.find(
        (item) => item.kind === "dm" && item.members.includes(assistantId),
      );
      if (existing) {
        selectChat(existing.id);
        usePavraView.getState().setSection("chat");
        return;
      }
      const targetAssistant = data.state.assistants.find((item) => item.id === assistantId);
      if (!targetAssistant) return;
      void data
        .call(createConversation, {
          id: randomUUID(),
          name: targetAssistant.name,
          kind: "dm",
          members: [assistantId],
          roundtable: false,
        })
        .then((chat) => {
          selectChat(chat.id);
          usePavraView.getState().setSection("chat");
          return chat;
        })
        .catch((failure: unknown) => {
          setError(failure instanceof Error ? failure.message : String(failure));
        });
    },
    [data, selectChat],
  );
  const assistantFields = useMemo(
    () =>
      assistantFormFields({
        assistant,
        editing,
        coordinatorId,
        hosts,
        formIds,
        machines,
        defaultServerId,
      }),
    [assistant, editing, coordinatorId, hosts, formIds, machines, defaultServerId],
  );
  const groupFields = useMemo(
    () => [
      { name: "id", label: "", initial: formIds.group, hidden: true },
      { name: "name", label: "Group name", initial: "" },
      { name: "members", label: "Assistant names, separated by commas", initial: "" },
      {
        name: "defaultResponder",
        label: "Replies when nobody is mentioned or recently active",
        initial: NO_DEFAULT_RESPONDER,
        options: [
          { id: NO_DEFAULT_RESPONDER, value: NO_DEFAULT_RESPONDER, label: "First member" },
          ...data.state.assistants.map((item) => ({
            id: item.id,
            value: item.id,
            label: item.name,
          })),
        ],
      },
      {
        name: "roundtable",
        label: "Roundtable switch starts",
        initial: "no",
        options: [
          { id: "yes", value: "yes", label: "On, when 2-6 members are mentioned" },
          { id: "no", value: "no", label: "Off" },
        ],
      },
    ],
    [data.state.assistants, formIds],
  );
  const taskFields = useMemo(
    () => [
      { name: "id", label: "Task ID", initial: formIds.task, hidden: true },
      { name: "prompt", label: "Task", initial: "", multiline: true },
      {
        name: "assistant",
        label: "Assistant name",
        initial:
          data.state.assistants.find((item) =>
            data.state.conversations.find((chat) => chat.id === chatId)?.members.includes(item.id),
          )?.name ?? "",
      },
      {
        name: "server",
        label: "Machine",
        initial: coordinatorId,
        options: hosts.map((host) => ({
          id: host.serverId,
          value: host.serverId,
          label: host.label,
        })),
      },
      { name: "directory", label: "Project directory on that machine", initial: "" },
      {
        name: "provider",
        label: "Model",
        modelHost: coordinatorId,
        initial: assistant?.provider ?? "",
      },
      {
        name: "isolation",
        label: "Workspace",
        initial: "worktree",
        options: [
          { id: "worktree", value: "worktree", label: "New Git worktree" },
          { id: "directory", value: "directory", label: "Existing directory" },
        ],
      },
    ],
    [
      assistant?.provider,
      chatId,
      coordinatorId,
      data.state.assistants,
      data.state.conversations,
      hosts,
      formIds,
    ],
  );
  const groupChange = useCallback((textValue: string) => setGroup(textValue), []);
  const directoryMachines = useMachines(data.invoke, Boolean(coordinatorId));
  const hostLabels = useMemo(
    () => ({
      ...Object.fromEntries(directoryMachines.map((machine) => [machine.serverId, machine.label])),
      ...Object.fromEntries(hosts.map((host) => [host.serverId, host.label])),
    }),
    [directoryMachines, hosts],
  );
  const inboxState = useMemo(() => deriveInboxState(data.state), [data.state]);
  const processTurn = useMemo(
    () =>
      mode === "chat" && processTurnId
        ? (data.state.turns.find((item) => item.id === processTurnId) ?? null)
        : null,
    [data.state.turns, mode, processTurnId],
  );
  const panels = resolveActivePavraPanels(mode, section, coordinatorId);
  const showCoordinatorModal = shouldOpenCoordinatorPicker({
    form,
    coordinatorId,
    viewHydrated,
    hostRegistryStatus,
    bootSettled,
  });
  const sidebarProps = {
    compact,
    chatId,
    coordinator:
      hosts.find((host) => host.serverId === coordinatorId)?.label ?? "Choose coordinator",
    coordinatorId,
    connected: data.connected,
    conversations: data.state.conversations,
    assistants: data.state.assistants,
    machines: directoryMachines,
    messages: data.state.messages,
    hostLabels,
    inboxBadge: inboxState.needsAction.length,
    inboxState,
    onSelect: selectChat,
    onAssistant: showAssistant,
    onEdit: editAssistant,
    onOpenAssistant: openAssistantChat,
    onAssistantForMachine: showAssistantForMachine,
    onGroup: showGroup,
    onHosts: showHosts,
  };
  return (
    <PavraTheme name={dark ? "dark" : "light"}>
      <UsageSidebarRoot>
        <View style={frame} testID="pavra-app">
          <View style={CONTENT}>
            {!compact ? <Sidebar {...sidebarProps} /> : null}
            <View style={FILL}>
              {data.error ? (
                <CoordinatorNotice
                  error={data.error}
                  invoke={data.invoke}
                  hosts={hosts}
                  coordinatorId={coordinatorId}
                  textColor={palette.textPrimary}
                  onSelect={selectCoordinator}
                />
              ) : null}
              {error ? (
                <PressHighlight
                  role="button"
                  accessibilityLabel="Dismiss error"
                  onPress={dismissError}
                  style={errorBannerStyle}
                >
                  <Text
                    style={[text, { color: palette.destructive, flex: 1 }]}
                    accessibilityRole="alert"
                  >
                    {error}
                  </Text>
                  <Text style={[text, DISMISS_TEXT]}>Dismiss</Text>
                </PressHighlight>
              ) : null}
              <RetainedPanel active={panels.chatActive}>
                <PavraChat
                  key={`${coordinatorId}:${chatId}`}
                  data={data}
                  palette={palette}
                  hostLabels={hostLabels}
                  onTask={showTask}
                  onOpenTask={openTask}
                  onOpenTurn={openTurn}
                  onOpenStudio={openChatStudio}
                  onEditAssistant={editAssistant}
                  onSidebar={compact ? showSidebar : undefined}
                />
              </RetainedPanel>
              <RetainedPanel active={panels.inboxActive}>
                <InboxPane
                  data={data}
                  inbox={inboxState}
                  compact={compact}
                  onOpenConversation={openInboxConversation}
                  onOpenTask={openTask}
                  onOpenTurn={openTurn}
                  onSidebar={compact ? showSidebar : undefined}
                />
              </RetainedPanel>
              <RetainedPanel active={panels.studioActive}>
                <Studio
                  palette={palette}
                  data={data}
                  coordinatorId={coordinatorId}
                  hostLabels={hostLabels}
                  active={panels.studioActive}
                  onAdd={showWorkspaces}
                  onSidebar={compact ? showSidebar : undefined}
                  onError={setError}
                />
              </RetainedPanel>
              <TurnProcessDrawer
                turn={processTurn}
                data={data}
                coordinatorId={coordinatorId}
                hostLabels={hostLabels}
                compact={compact}
                onClose={closeProcessDrawer}
                onOpenStudio={openTurnInStudio}
              />
              {showCoordinatorModal ? (
                <CoordinatorPickerModal
                  hosts={hosts}
                  onSelect={selectCoordinator}
                  onClose={close}
                />
              ) : null}
              <FormHost
                form={form}
                editing={editing}
                chatId={chatId}
                assistantFields={assistantFields}
                groupFields={groupFields}
                taskFields={taskFields}
                palette={palette}
                save={save}
                close={close}
                group={group}
                groupChange={groupChange}
                data={data}
                coordinatorId={coordinatorId}
                hostLabels={hostLabels}
                onError={setError}
              />
            </View>
          </View>
          <AnimatedDrawer
            open={compact && sidebarOpen}
            side="left"
            drawerWidth={290}
            closeLabel="Close sidebar"
            onClose={hideSidebar}
          >
            <Sidebar {...sidebarProps} />
          </AnimatedDrawer>
        </View>
      </UsageSidebarRoot>
    </PavraTheme>
  );
}

interface FormHostProps {
  form: string | null;
  editing: string | null;
  chatId: string;
  group: string;
  assistantFields: ComponentProps<typeof PavraForm>["fields"];
  groupFields: ComponentProps<typeof PavraForm>["fields"];
  taskFields: ComponentProps<typeof PavraForm>["fields"];
  palette: ComponentProps<typeof PavraForm>["palette"];
  save(values: Record<string, string>): Promise<void>;
  close(): void;
  groupChange(value: string): void;
  data?: PavraData;
  coordinatorId?: string;
  hostLabels?: Record<string, string>;
  onError?(error: string | null): void;
}
function FormHost({
  form,
  editing,
  chatId,
  assistantFields,
  groupFields,
  taskFields,
  palette,
  save,
  close,
  group,
  groupChange,
  data,
  coordinatorId,
  hostLabels,
  onError,
}: FormHostProps) {
  return (
    <>
      {form === "assistant" ? (
        <PavraForm
          key={editing ?? "new-assistant"}
          title={editing ? "Edit assistant" : "New assistant"}
          fields={assistantFields}
          palette={palette}
          onSubmit={save}
          onClose={close}
        />
      ) : null}
      {form === "group" ? (
        <PavraForm
          key="new-group"
          title="New group"
          fields={groupFields}
          palette={palette}
          onSubmit={save}
          onClose={close}
        />
      ) : null}
      {form === "task" ? (
        <PavraForm
          key={`task:${chatId}`}
          title="New task"
          fields={taskFields}
          palette={palette}
          onSubmit={save}
          onClose={close}
        />
      ) : null}
      {form === "workspaces" ? (
        <View style={WORKSPACES_MODAL}>
          <StudioHomePanel
            group={group}
            onGroupChange={groupChange}
            onClose={close}
            data={data}
            coordinatorId={coordinatorId}
            hostLabels={hostLabels}
            onError={onError}
          />
        </View>
      ) : null}
    </>
  );
}

function freshFormIds() {
  return { assistant: randomUUID(), chat: randomUUID(), group: randomUUID(), task: randomUUID() };
}
