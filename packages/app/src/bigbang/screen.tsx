import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { Text, View, useColorScheme } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { BigbangInput as FormTextInput, FormFrame } from "./ui/FormChrome";
import { ResourceChoice } from "./ui/ResourceChoice";
import { RetainedPanel } from "@/components/retained-panel";
import { useHosts, getHostRuntimeStore } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useAppSettings } from "@/hooks/use-settings";
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
import { useAssistantMachines, useBigbangData } from "./data";
import { normalizeAutonomy, parseAutonomy, serializeAutonomy, validateAutonomy } from "./autonomy";
import { taskTitle } from "./task-view";
import { useBigbangTitle, chatReadError } from "./title";
import { useBigbangView } from "./store";
import { palettes } from "./palette";
import { BigbangChat } from "./chat";
import { BigbangForm } from "./forms";
import { Studio, WorkspacePicker } from "./studio";
import { BigbangTheme } from "./ui/ThemeProvider";
import { Sidebar } from "./ui/Sidebar";

const FILL = { flex: 1, minHeight: 0 };
const CONTENT = { flex: 1, minHeight: 0, flexDirection: "row" } as const;
const OVERLAY = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 100,
  flexDirection: "row",
} as const;
const BACKDROP = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0.45)",
} as const;
const ASSISTANT_FIELDS = [
  { name: "name", label: "Name", initial: "" },
  { name: "provider", label: "Provider / model", initial: "" },
  { name: "persona", label: "Persona", initial: "", multiline: true },
  { name: "memory", label: "Initial memory", initial: "", multiline: true },
];

function assistantFormFields(input: {
  assistant: Assistant | undefined;
  editing: string | null;
  coordinatorId: string;
  hosts: Array<{ serverId: string; label: string }>;
  formIds: ReturnType<typeof freshFormIds>;
  machines: MachineInfo[];
}) {
  const { assistant, editing, coordinatorId, hosts, formIds, machines } = input;
  const machineId = assistant?.serverId ?? coordinatorId;
  return [
    { name: "id", label: "", initial: editing ?? formIds.assistant, hidden: true },
    { name: "chatId", label: "", initial: formIds.chat, hidden: true },
    // The model list follows the machine: a new assistant picks one; an existing one keeps its own.
    {
      name: "server",
      label: "Machine",
      initial: machineId,
      hidden: Boolean(editing) || machines.length < 2,
      options: machines
        .filter((machine) => machine.role === "coordinator" || machine.role === "member")
        .map((machine) => ({
          id: machine.serverId,
          value: machine.serverId,
          label: machine.label,
        })),
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
  const router = useRouter();
  const hosts = useHosts();
  const compact = useIsCompactFormFactor();
  const scheme = useColorScheme();
  const { settings } = useAppSettings();
  const dark = isDarkTheme(settings.theme, scheme);
  const palette = dark ? palettes.dark : palettes.light;
  const coordinatorId = useBigbangView((state) => state.coordinatorId);
  const chatId = useBigbangView((state) => state.chatId);
  const mode = useBigbangView((state) => state.mode);
  const setMode = useBigbangView((state) => state.setMode);
  const data = useBigbangData(coordinatorId);
  const conversationTitle = data.state.conversations.find((item) => item.id === chatId)?.name;
  useBigbangTitle(mode, conversationTitle);
  const [form, setForm] = useState<"assistant" | "group" | "task" | "workspaces" | "hosts" | null>(
    null,
  );
  const [editing, setEditing] = useState<string | null>(null);
  // Ids for records a form creates. Fresh on every open so a second creation never reuses the
  // first one's ids; kept while the form is open so a retried save stays idempotent.
  const [formIds, setFormIds] = useState(freshFormIds);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState("General");
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  }, []);
  const chatMode = useCallback(() => setMode("chat"), [setMode]);
  const studioMode = useCallback(() => setMode("studio"), [setMode]);
  const openForm = useCallback((next: "assistant" | "group" | "task") => {
    setFormIds(freshFormIds());
    setForm(next);
  }, []);
  const showAssistant = useCallback(() => {
    setEditing(null);
    openForm("assistant");
  }, [openForm]);
  const showGroup = useCallback(() => openForm("group"), [openForm]);
  const showTask = useCallback(() => openForm("task"), [openForm]);
  const showWorkspaces = useCallback(() => setForm("workspaces"), []);
  const showHosts = useCallback(() => setForm("hosts"), []);
  const settingsPress = useCallback(() => router.push("/settings"), [router]);

  const openTask = useCallback((task: Task) => {
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
    (turn: Turn) => openTurnProcess(turn, coordinatorId, setError),
    [coordinatorId],
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
      openForm("assistant");
      setSidebarOpen(false);
    },
    [openForm],
  );
  const hostRows = useMemo(
    () =>
      hosts.map((host) => ({
        host,
        select: () => {
          useBigbangView.getState().selectCoordinator(host.serverId);
          close();
        },
      })),
    [close, hosts],
  );
  const assistantFields = useMemo(
    () => assistantFormFields({ assistant, editing, coordinatorId, hosts, formIds, machines }),
    [assistant, editing, coordinatorId, hosts, formIds, machines],
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
  const sidebarProps = {
    compact,
    mode,
    chatId,
    coordinator:
      hosts.find((host) => host.serverId === coordinatorId)?.label ?? "Choose coordinator",
    connected: data.connected,
    conversations: data.state.conversations,
    assistants: data.state.assistants,
    messages: data.state.messages,
    onChat: chatMode,
    onStudio: studioMode,
    onSelect: selectChat,
    onAssistant: showAssistant,
    onEdit: editAssistant,
    onGroup: showGroup,
    onWorkspaces: showWorkspaces,
    onHosts: showHosts,
    onSettings: settingsPress,
  };
  return (
    <BigbangTheme name={dark ? "dark" : "light"}>
      <View style={frame} testID="bigbang-app">
        <View style={CONTENT}>
          {!compact ? <Sidebar {...sidebarProps} /> : null}
          <View style={FILL}>
            {data.error ? (
              <Text style={text} accessibilityRole="alert">
                {chatReadError(data.error)}
              </Text>
            ) : null}
            {error ? (
              <Text style={text} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            {form === "hosts" || !coordinatorId ? (
              <FormFrame title="Chat coordinator" onClose={close}>
                <Text style={text}>
                  Choose the host that stores Chat. Switching Studio never changes this choice.
                </Text>
                {hostRows.map(({ host, select }) => (
                  <ResourceChoice key={host.serverId} onPress={select} label={host.label} />
                ))}
              </FormFrame>
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
            />
            <RetainedPanel active={!form && mode === "chat" && Boolean(coordinatorId)}>
              <BigbangChat
                key={`${coordinatorId}:${chatId}`}
                data={data}
                palette={palette}
                onTask={showTask}
                onOpenTask={openTask}
                onOpenTurn={openTurn}
                onEditAssistant={editAssistant}
                onSidebar={compact ? showSidebar : undefined}
              />
            </RetainedPanel>
            <RetainedPanel active={!form && mode === "studio"}>
              <Studio
                palette={palette}
                active={!form && mode === "studio"}
                onAdd={showWorkspaces}
                onSidebar={compact ? showSidebar : undefined}
              />
            </RetainedPanel>
          </View>
        </View>
        {compact && sidebarOpen ? (
          <View style={OVERLAY}>
            <PressHighlight
              accessibilityLabel="Close sidebar"
              onPress={hideSidebar}
              style={BACKDROP}
            />
            <Sidebar {...sidebarProps} />
          </View>
        ) : null}
      </View>
    </BigbangTheme>
  );
}

function GroupInput({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <FormTextInput accessibilityLabel="Studio group" initialValue={value} onChangeText={onChange} />
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
}: FormHostProps) {
  const text = useMemo(() => ({ color: palette.textPrimary }), [palette.textPrimary]);
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
        <FormFrame title="Add workspace" onClose={close}>
          <Text style={text}>Studio group</Text>
          <GroupInput value={group} onChange={groupChange} />
          <WorkspacePicker palette={palette} group={group} />
        </FormFrame>
      ) : null}
    </>
  );
}

// Opens a chat execution in Studio. An assistant bound to another machine runs its executions there.
function openTurnProcess(turn: Turn, coordinatorId: string, setError: (error: string) => void) {
  const serverId = turn.serverId ?? coordinatorId;
  const host = getHostRuntimeStore().getClient(serverId);
  if (!host) {
    setError("That assistant's machine is not connected in this app. Add it as a host first.");
    return;
  }
  void host
    .fetchAgent({ agentId: turn.agentId })
    .then((result) => {
      if (!result?.agent.workspaceId) throw new Error("Execution workspace is not available yet.");
      const workspaceId = result.agent.workspaceId;
      prepareWorkspaceTab(
        { serverId, workspaceId, target: { kind: "agent", agentId: turn.agentId }, pin: true },
        { openTab: useWorkspaceLayoutStore.getState().deferOpenTab },
      );
      useBigbangView
        .getState()
        .openColumn({ serverId, workspaceId, name: "Assistant process", group: "Chat" });
      return getHostRuntimeStore().prepareWorkspaceRoute(serverId, workspaceId);
    })
    .catch((failure: Error) => setError(failure.message));
}

function freshFormIds() {
  return { assistant: randomUUID(), chat: randomUUID(), group: randomUUID(), task: randomUUID() };
}

function isDarkTheme(preference: string, scheme: string | null | undefined) {
  return preference === "dark" || (preference === "auto" && scheme === "dark");
}
