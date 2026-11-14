import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { Text, View } from "react-native";
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
} from "../../../../extensions/bigbang/shared/contracts";
import { useAssistantMachines, useBigbangData, useMachines, type BigbangData } from "./data";
import { normalizeAutonomy, parseAutonomy, serializeAutonomy, validateAutonomy } from "./autonomy";
import { resolveDefaultChatId, resolveDefaultCoordinatorId } from "./model";
import { taskIdOfThread, taskTitle } from "./task-view";
import { useBigbangTitle } from "./title";
import { CoordinatorNotice } from "./coordinator-notice";
import { useBigbangView } from "./store";
import { palettes } from "./palette";
import { BigbangChat } from "./chat";
import { BigbangForm } from "./forms";
import { findLatestNonTaskTurn, turnColumnName } from "./chat-studio";
import { openTurnProcess, Studio, StudioHomePanel } from "./studio";
import { BigbangTheme, useBigbangDark } from "./ui/ThemeProvider";
import { AnimatedDrawer } from "./ui/AnimatedDrawer";
import { CoordinatorPickerModal } from "./ui/CoordinatorPickerModal";
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

export function BigbangScreen() {
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const [bootSettled, setBootSettled] = useState(() =>
    getHostRuntimeStore().isHostRegistryLoaded(),
  );
  const [viewHydrated, setViewHydrated] = useState(() => useBigbangView.persist.hasHydrated());
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
    if (useBigbangView.persist.hasHydrated()) {
      setViewHydrated(true);
      return;
    }
    return useBigbangView.persist.onFinishHydration(() => {
      setViewHydrated(true);
    });
  }, []);
  const compact = useIsCompactFormFactor();
  const dark = useBigbangDark();
  const palette = dark ? palettes.dark : palettes.light;
  const rawCoordinatorId = useBigbangView((state) => state.coordinatorId);
  const rawChatId = useBigbangView((state) => state.chatId);
  const mode = useBigbangView((state) => state.mode);
  const coordinatorId = resolveDefaultCoordinatorId(rawCoordinatorId, hosts);
  const data = useBigbangData(coordinatorId);
  const selectCoordinator = useBigbangView((state) => state.selectCoordinator);
  const chatId = resolveDefaultChatId(rawChatId, data.state.conversations);
  useEffect(() => {
    if (!viewHydrated) return;
    if (coordinatorId && coordinatorId !== rawCoordinatorId) {
      selectCoordinator(coordinatorId);
    }
  }, [coordinatorId, rawCoordinatorId, selectCoordinator, viewHydrated]);
  useEffect(() => {
    if (!viewHydrated) return;
    if (chatId && chatId !== rawChatId) {
      useBigbangView.setState({ chatId });
    }
  }, [chatId, rawChatId, viewHydrated]);
  const conversationTitle = data.state.conversations.find((item) => item.id === chatId)?.name;
  useBigbangTitle(mode, conversationTitle);
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
  const changeChat = useBigbangView((state) => state.selectChat);
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
    useBigbangView
      .getState()
      .openColumn({ serverId, workspaceId, name: taskTitle(task).slice(0, 40), group: "Tasks" });
  }, []);
  const openTurn = useCallback(
    (turn: Turn) => {
      const assistant = data.state.assistants.find((a) => a.id === turn.assistantId);
      const conversation = data.state.conversations.find((c) => c.id === turn.conversationId);
      const assistantName = assistant?.name ?? "Assistant";
      const columnName = turnColumnName(assistantName, conversation, turn.threadId);
      const studioGroup = conversation?.kind === "group" ? conversation.name : "Chat";
      void openTurnProcess(turn, coordinatorId, setError, { columnName, group: studioGroup });
    },
    [coordinatorId, data.state.assistants, data.state.conversations],
  );
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
          const columnName = turnColumnName(assistantName, conversation, targetThreadId);
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
    },
    [changeChat],
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
        useBigbangView.getState().setSection("chat");
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
          useBigbangView.getState().setSection("chat");
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
    onSelect: selectChat,
    onAssistant: showAssistant,
    onEdit: editAssistant,
    onOpenAssistant: openAssistantChat,
    onAssistantForMachine: showAssistantForMachine,
    onGroup: showGroup,
    onHosts: showHosts,
  };
  return (
    <BigbangTheme name={dark ? "dark" : "light"}>
      <UsageSidebarRoot>
        <View style={frame} testID="bigbang-app">
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
              <RetainedPanel active={mode === "chat" && Boolean(coordinatorId)}>
                <BigbangChat
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
              <RetainedPanel active={mode === "studio"}>
                <Studio
                  palette={palette}
                  data={data}
                  coordinatorId={coordinatorId}
                  hostLabels={hostLabels}
                  active={mode === "studio"}
                  onAdd={showWorkspaces}
                  onSidebar={compact ? showSidebar : undefined}
                  onError={setError}
                />
              </RetainedPanel>
              {form === "hosts" ||
              (!coordinatorId && viewHydrated && hostRegistryStatus === "ready" && bootSettled) ? (
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
    </BigbangTheme>
  );
}

interface FormHostProps {
  form: string | null;
  editing: string | null;
  chatId: string;
  group: string;
  assistantFields: ComponentProps<typeof BigbangForm>["fields"];
  groupFields: ComponentProps<typeof BigbangForm>["fields"];
  taskFields: ComponentProps<typeof BigbangForm>["fields"];
  palette: ComponentProps<typeof BigbangForm>["palette"];
  save(values: Record<string, string>): Promise<void>;
  close(): void;
  groupChange(value: string): void;
  data?: BigbangData;
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
        <BigbangForm
          key={editing ?? "new-assistant"}
          title={editing ? "Edit assistant" : "New assistant"}
          fields={assistantFields}
          palette={palette}
          onSubmit={save}
          onClose={close}
        />
      ) : null}
      {form === "group" ? (
        <BigbangForm
          key="new-group"
          title="New group"
          fields={groupFields}
          palette={palette}
          onSubmit={save}
          onClose={close}
        />
      ) : null}
      {form === "task" ? (
        <BigbangForm
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
