import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  readState,
  readAssistantMemory,
  writeAssistantMemory,
  saveAssistant,
  createConversation,
  sendMessage,
  startTask,
  cancelTask,
  respondTaskPermission,
  listMachines,
} from "./shared/contracts";
import {
  MEMBER_PROTOCOL,
  memberHello,
  memberHomePrepare,
  memberMemoryRead,
  memberMemoryWrite,
  memberPoll,
  memberRespond,
} from "./shared/member";
import { assistantRoot, prepareHome, readMemory, writeMemory } from "./server/assistant-files";
import type { MachinePort } from "./server/machines";
import { callPluginRpc } from "./server/member/rpc";
import { roleSettings, taskSettings, type RoleSettings, type TaskLimits } from "./shared/settings";
import { agentTools, callAgentTool } from "./server/agent-tools";
import { ChatStore } from "./server/store";
import { Coordinator } from "./server/coordinator";
import { MemberLinks } from "./server/member/link";
import { hostDirectory } from "./server/member/hosts";
import { MemberRelay } from "./server/member/relay";

const STARTING = "Bigbang Chat is starting. Try again in a moment.";

export default function contribute(server: PluginServerContext) {
  if (!process.env.PASEO_HOME) throw new Error("Bigbang requires an explicit PASEO_HOME.");
  const home = path.join(process.env.PASEO_HOME, "bigbang");
  // Assistants act on their own through agent tools, which need a daemon that offers them.
  if (
    typeof server.registerAgentTool !== "function" ||
    typeof server.registerSettings !== "function"
  ) {
    const message =
      "Bigbang Chat needs a newer Paseo daemon (agent tools and plugin settings). Update the daemon and reload the plugin.";
    console.error(message);
    throw new Error(message);
  }

  // The role comes from a host setting, read once at load: a coordinator opens the ledger, a member
  // only relays. Until it is read, every entry point answers that Chat is starting.
  let role: RoleSettings | null = null;
  let coordinator: Coordinator | null = null;
  let store: ChatStore | null = null;
  let links: MemberLinks | null = null;
  let hostLinks: ReturnType<typeof hostDirectory> | null = null;
  let limits: TaskLimits | null = null;
  let closed = false;
  const relay = new MemberRelay({
    coordinatorServerId: () =>
      role?.mode === "member" ? (role.coordinatorServerId ?? null) : null,
  });
  const chat = (): Coordinator => {
    if (coordinator) return coordinator;
    if (role?.mode === "member")
      throw new Error(
        `This machine is a Chat member of ${role.coordinatorServerId ?? "no coordinator yet"}. Open Chat on its coordinator.`,
      );
    throw new Error(STARTING);
  };

  server.handle(readState, (input) => chat().readState(input));
  server.handle(saveAssistant, (input) => chat().saveAssistant(input));
  server.handle(readAssistantMemory, (input) => chat().readAssistantMemory(input));
  server.handle(writeAssistantMemory, (input) => chat().writeAssistantMemory(input));
  server.handle(createConversation, (input) => chat().createConversation(input));
  server.handle(sendMessage, (input) => chat().send(input));
  server.handle(startTask, (input) => chat().task(input));
  server.handle(cancelTask, (input) => chat().cancel(input.id));
  server.handle(respondTaskPermission, (input) => chat().respondPermission(input));
  server.handle(memberHello, () => {
    if (!role) throw new Error(STARTING);
    return {
      protocol: MEMBER_PROTOCOL,
      mode: role.mode,
      coordinatorServerId: role.mode === "member" ? (role.coordinatorServerId ?? null) : null,
      processId: relay.processId,
    };
  });
  server.handle(listMachines, async () => ({ machines: await chat().machinesList() }));
  server.handle(memberPoll, (input) => relay.poll(input));
  // An assistant bound to this machine keeps its home here; only its coordinator calls these.
  const memberHome = (input: { assistantId: string; subdirectory?: boolean }) => {
    if (role?.mode !== "member") throw new Error("This machine is not a Chat member.");
    return assistantRoot(home, input.assistantId, input.subdirectory);
  };
  server.handle(memberHomePrepare, (input) => {
    const directory = memberHome(input);
    prepareHome(directory, input.seed);
    return { directory };
  });
  server.handle(memberMemoryRead, (input) => readMemory(memberHome(input)));
  server.handle(memberMemoryWrite, (input) =>
    writeMemory(memberHome(input), input.content, input.expectedMtimeMs),
  );
  server.handle(memberRespond, (input) => relay.respond(input.callId, input.result));

  // Every agent on a Bigbang daemon lists the tools: providers list MCP tools once per session, so
  // a narrower audience would hide them from sessions that start before they are needed. Each call
  // is authorized from the ledger, by the caller's verified agent id and machine.
  server.setAgentToolAudience("all");
  for (const { tool, run } of agentTools) {
    server.registerAgentTool(tool, (input, context) => {
      if (coordinator) return run(coordinator, input, { caller: context.caller });
      if (role?.mode === "member") return relay.call(context.caller.agentId, tool.name, input);
      throw new Error(STARTING);
    });
  }

  // Lifecycle hooks are best-effort and only fire for this daemon. A coordinator records and
  // enqueues; it reads the execution's timeline, so a missed or repeated hook is harmless. A member
  // passes them to its coordinator over the same relay.
  server.on("agent.turn_started", (event) => {
    if (coordinator) coordinator.onTurnStarted(event);
    else relayEvent("agent.turn_started", event.agent);
  });
  server.on("agent.turn_ended", (event) => {
    if (coordinator) coordinator.onTurnEnded(event);
    else relayEvent("agent.turn_ended", event.agent, { outcome: event.outcome });
  });
  server.on("agent.permission_requested", (event) => {
    if (coordinator) coordinator.onPermissionRequested(event);
    else
      relayEvent("agent.permission_requested", event.agent, {
        request: {
          id: event.request.id,
          name: event.request.name,
          ...(event.request.title ? { title: event.request.title } : {}),
        },
      });
  });
  server.on("agent.permission_resolved", (event) => {
    if (coordinator) coordinator.onPermissionResolved(event);
    else relayEvent("agent.permission_resolved", event.agent);
  });
  server.on("agent.archived", (event) => {
    if (coordinator) coordinator.onAgentGone(event, "archived");
    else relayEvent("agent.archived", event.agent);
  });
  server.on("agent.closed", (event) => {
    if (coordinator) coordinator.onAgentGone(event, "closed");
    else relayEvent("agent.closed", event.agent);
  });
  server.on("agent.created", (event) => {
    if (!coordinator) relayEvent("agent.created", event.agent);
  });
  function relayEvent(
    name: Parameters<MemberRelay["event"]>[0]["name"],
    agent: { id: string; workspaceId: string | null },
    extra: Pick<Parameters<MemberRelay["event"]>[0], "outcome" | "request"> = {},
  ): void {
    if (role?.mode === "member")
      relay.event({ name, agentId: agent.id, workspaceId: agent.workspaceId, ...extra });
  }

  // Limits start at their defaults and follow the host's settings.
  const tasks = server.registerSettings(taskSettings);
  const applyLimits = (state: Awaited<ReturnType<typeof tasks.read>>) => {
    if (state.status !== "ready") return;
    limits = state.values;
    coordinator?.setLimits(state.values);
  };
  void tasks
    .read()
    .then(applyLimits, (error) => console.error("Bigbang settings read failed", error));
  const unsubscribeTasks = tasks.subscribe(applyLimits);

  const roles = server.registerSettings(roleSettings);
  const start = (state: Awaited<ReturnType<typeof roles.read>>) => {
    if (closed || role) return;
    if (state.status !== "ready")
      console.error(`Bigbang role setting is invalid (${state.error}); acting as coordinator.`);
    role = state.status === "ready" ? state.values : { mode: "coordinator" };
    if (role.mode === "member") {
      if (!role.coordinatorServerId)
        console.error("Bigbang is a member without coordinatorServerId; set it and reload.");
      return;
    }
    const hosts = hostDirectory(server.paseo);
    hostLinks = hosts;
    const machines: MachinePort = {
      self: () => hosts.self(),
      isMember: (serverId) => links?.state(serverId)?.kind === "member",
      call: (serverId, contract, input) =>
        callPluginRpc(contract, (method, value) => hosts.invoke(serverId, method, value), input),
      list: async () => {
        const [self, saved, own] = await Promise.all([
          hosts.self(),
          hosts.list(),
          server.paseo.hosts.list(),
        ]);
        return [
          { serverId: self, label: own.self.label, role: "coordinator" as const },
          ...saved.map(({ serverId, label }) => {
            const link = links?.state(serverId);
            if (link?.kind === "member") return { serverId, label, role: "member" as const };
            return {
              serverId,
              label,
              role: "unavailable" as const,
              reason:
                link?.kind === "other"
                  ? link.reason
                  : "Its Bigbang plugin is not reachable as a member of this coordinator.",
            };
          }),
        ];
      },
    };
    store = new ChatStore(path.join(home, "chat.sqlite"));
    const active = new Coordinator(store, home, { ...(limits ? { limits } : {}), machines });
    coordinator = active;
    // Recovery starts now, in the background, without waiting for a client RPC or a hook.
    active.attach(server.paseo);
    links = new MemberLinks(hosts, {
      call: (serverId, call) =>
        callAgentTool(active, { agentId: call.agentId, serverId }, call.tool, call.input),
      event: (_serverId, event) => active.onMemberEvent(event),
      reconnected: () => active.onMemberReconnected(),
    });
    links.start();
  };
  void roles.read().then(start, (error) => {
    console.error("Bigbang role read failed; acting as coordinator", error);
    start({ status: "ready", revision: "", values: { mode: "coordinator" } });
  });
  const unsubscribeRoles = roles.subscribe((state) => {
    if (
      role &&
      state.status === "ready" &&
      (state.values.mode !== role.mode ||
        state.values.coordinatorServerId !== role.coordinatorServerId)
    )
      console.error("Bigbang role changed; reload the plugin to apply it.");
  });

  return async () => {
    closed = true;
    unsubscribeTasks();
    unsubscribeRoles();
    relay.close();
    links?.close();
    await coordinator?.close();
    await hostLinks?.dispose();
    store?.close();
  };
}
