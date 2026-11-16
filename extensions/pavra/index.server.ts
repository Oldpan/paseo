import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  readState,
  readAssistantMemory,
  writeAssistantMemory,
  listAssistantNotes,
  readAssistantNote,
  writeAssistantNote,
  deleteAssistantNote,
  memberNotesList,
  memberNoteRead,
  memberNoteWrite,
  memberNoteDelete,
  listAssistantPlaybooks,
  readAssistantPlaybook,
  writeAssistantPlaybook,
  deleteAssistantPlaybook,
  saveAssistant,
  createConversation,
  sendMessage,
  reactToMessage,
  saveMessage,
  cancelTurn,
  startTask,
  cancelTask,
  respondTaskPermission,
  listMachines,
  saveStudio,
  bindStudioWorkspace,
  unbindStudioWorkspace,
  archiveStudio,
  listStudioMembers,
  setStudioAssistants,
  saveRoutine,
  pauseRoutine,
  resumeRoutine,
  runRoutineOnce,
  deleteRoutine,
  resolveTakeover,
  cancelTakeover,
  browserPageState,
  browserRemoteAction,
} from "./shared/contracts";
import {
  MEMBER_PROTOCOL,
  memberHello,
  memberHomePrepare,
  memberMemoryRead,
  memberMemoryWrite,
  memberMemorySnapshot,
  memberPlaybooksList,
  memberPlaybookRead,
  memberPlaybookWrite,
  memberPlaybookDelete,
  memberTaskOutcomeSync,
  memberBrowserCall,
  memberBrowserState,
  memberBrowserAction,
  memberPoll,
  memberRespond,
} from "./shared/member";
import {
  assistantRoot,
  deleteNote,
  deletePlaybook,
  listNotes,
  listPlaybooks,
  prepareHome,
  readMemory,
  readMemorySnapshot,
  readNote,
  readPlaybook,
  syncTaskOutcomeToNotes,
  writeMemory,
  writeNote,
  writePlaybook,
} from "./server/assistant-files";
import type { MachinePort } from "./server/machines";
import { callPluginRpc } from "./server/member/rpc";
import { roleSettings, taskSettings, type RoleSettings, type TaskLimits } from "./shared/settings";
import { agentTools, callAgentTool } from "./server/agent-tools";
import { AssistantBrowserManager } from "./server/browser";
import { ChatStore } from "./server/store";
import { Coordinator } from "./server/coordinator";
import { executeMemberBrowserOperation } from "./server/member";
import { MemberLinks } from "./server/member/link";
import { hostDirectory } from "./server/member/hosts";
import { MemberRelay } from "./server/member/relay";

const STARTING = "Pavra Chat is starting. Try again in a moment.";
const DEFAULT_COORDINATOR_VERSION = "0.16.0";

export function readCoordinatorVersion(paseoHome: string): string {
  const candidates = [
    path.resolve(process.cwd(), "extensions/pavra/package.json"),
    path.resolve(paseoHome, "../../../extensions/pavra/package.json"),
    path.resolve(paseoHome, "../../extensions/pavra/package.json"),
  ];
  try {
    const configPath = path.join(paseoHome, "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        plugins?: { pavra?: { path?: unknown } };
      };
      const pluginPath = config.plugins?.pavra?.path;
      if (typeof pluginPath === "string" && pluginPath.trim().length > 0) {
        candidates.unshift(path.resolve(pluginPath.trim(), "package.json"));
      }
    }
  } catch {
    // Fall back to default candidate locations.
  }
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.trim().length > 0) {
        return pkg.version.trim();
      }
    } catch {
      // Try next candidate.
    }
  }
  return DEFAULT_COORDINATOR_VERSION;
}

export default function contribute(server: PluginServerContext) {
  if (!process.env.PASEO_HOME) throw new Error("Pavra requires an explicit PASEO_HOME.");
  const home = path.join(process.env.PASEO_HOME, "pavra");
  const coordinatorVersion = readCoordinatorVersion(process.env.PASEO_HOME);
  // Assistants act on their own through agent tools, which need a daemon that offers them.
  if (
    typeof server.registerAgentTool !== "function" ||
    typeof server.registerSettings !== "function"
  ) {
    const message =
      "Pavra Chat needs a newer Paseo daemon (agent tools and plugin settings). Update the daemon and reload the plugin.";
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
  const memberBrowsers = new AssistantBrowserManager();
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

  server.handle(readState, async (input) => ({
    ...(await chat().readState(input)),
    coordinatorVersion,
  }));
  server.handle(saveAssistant, (input) => chat().saveAssistant(input));
  server.handle(readAssistantMemory, (input) => chat().readAssistantMemory(input));
  server.handle(writeAssistantMemory, (input) => chat().writeAssistantMemory(input));
  server.handle(listAssistantNotes, (input) => chat().listAssistantNotes(input));
  server.handle(readAssistantNote, (input) => chat().readAssistantNote(input));
  server.handle(writeAssistantNote, (input) => chat().writeAssistantNote(input));
  server.handle(deleteAssistantNote, (input) => chat().deleteAssistantNote(input));
  server.handle(listAssistantPlaybooks, (input) => chat().listAssistantPlaybooks(input));
  server.handle(readAssistantPlaybook, (input) => chat().readAssistantPlaybook(input));
  server.handle(writeAssistantPlaybook, (input) => chat().writeAssistantPlaybook(input));
  server.handle(deleteAssistantPlaybook, (input) => chat().deleteAssistantPlaybook(input));
  server.handle(createConversation, (input) => chat().createConversation(input));
  server.handle(sendMessage, (input) => chat().send(input));
  server.handle(reactToMessage, (input) => chat().reactToMessage(input));
  server.handle(saveMessage, (input) => chat().saveMessage(input));
  server.handle(cancelTurn, (input) => chat().cancelTurn(input));
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
  server.handle(saveStudio, (input) => chat().studio.save(input));
  server.handle(bindStudioWorkspace, (input) => chat().studio.bind(input));
  server.handle(unbindStudioWorkspace, (input) => ({ studio: chat().studio.unbind(input) }));
  server.handle(archiveStudio, (input) => chat().studio.archive(input.id));
  server.handle(setStudioAssistants, (input) => chat().studio.setAssistants(input));
  server.handle(saveRoutine, (input) => chat().saveRoutine(input));
  server.handle(pauseRoutine, (input) => chat().pauseRoutine(input));
  server.handle(resumeRoutine, (input) => chat().resumeRoutine(input));
  server.handle(runRoutineOnce, (input) => chat().runRoutineOnce(input));
  server.handle(deleteRoutine, (input) => chat().deleteRoutine(input));
  server.handle(resolveTakeover, (input) => chat().resolveTakeover(input));
  server.handle(cancelTakeover, (input) => chat().cancelTakeover(input));
  server.handle(browserPageState, (input) => chat().browserPageState(input));
  server.handle(browserRemoteAction, (input) => chat().browserRemoteAction(input));
  server.handle(listStudioMembers, async (input) => {
    const listing = await chat().studio.members(input.studioId);
    return {
      members: listing.members.map((member) => ({
        key: member.key,
        kind: "agent",
        name: member.name,
        serverId: member.serverId,
        machine: member.machine,
        address: member.address,
      })),
      unavailable: listing.unavailable,
    };
  });
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
  server.handle(memberMemorySnapshot, (input) => readMemorySnapshot(memberHome(input), input.slug));
  server.handle(memberNotesList, (input) => ({
    notes: listNotes(memberHome(input)),
  }));
  server.handle(memberNoteRead, (input) => readNote(memberHome(input), input.path));
  server.handle(memberNoteWrite, (input) =>
    writeNote(memberHome(input), input.path, input.content, input.expectedMtimeMs),
  );
  server.handle(memberNoteDelete, (input) => deleteNote(memberHome(input), input.path));
  server.handle(memberPlaybooksList, (input) => ({
    playbooks: listPlaybooks(memberHome(input)),
  }));
  server.handle(memberPlaybookRead, (input) => readPlaybook(memberHome(input), input.slug));
  server.handle(memberPlaybookWrite, (input) =>
    writePlaybook(memberHome(input), input.slug, input.content, input.expectedMtimeMs),
  );
  server.handle(memberPlaybookDelete, (input) => deletePlaybook(memberHome(input), input.slug));
  server.handle(memberTaskOutcomeSync, (input) => {
    syncTaskOutcomeToNotes(memberHome(input), input.outcome);
    return { ok: true as const };
  });
  server.handle(memberBrowserCall, async (input) => {
    const homeDir = memberHome(input);
    const result = await executeMemberBrowserOperation(memberBrowsers, {
      assistantId: input.assistantId,
      homeDir,
      operation: input.operation,
      policy: input.policy,
      payload: input.payload,
    });
    return { result };
  });
  server.handle(memberBrowserState, (input) =>
    memberBrowsers.getPageState({
      assistantId: input.assistantId,
      homeDir: memberHome(input),
      policy: input.policy,
    }),
  );
  server.handle(memberBrowserAction, (input) =>
    memberBrowsers.remoteAction({
      assistantId: input.assistantId,
      homeDir: memberHome(input),
      policy: input.policy,
      action: input.action,
      url: input.url,
      ref: input.ref,
      x: input.x,
      y: input.y,
      value: input.value,
      key: input.key,
      deltaY: input.deltaY,
    }),
  );
  server.handle(memberRespond, (input) => relay.respond(input.callId, input.result));

  // Every agent on a Pavra daemon lists the tools: providers list MCP tools once per session, so
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
    if (coordinator) coordinator.onAgentCreated(event);
    else relayEvent("agent.created", event.agent);
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
    .then(applyLimits, (error) => console.error("Pavra settings read failed", error));
  const unsubscribeTasks = tasks.subscribe(applyLimits);

  const roles = server.registerSettings(roleSettings);
  const start = (state: Awaited<ReturnType<typeof roles.read>>) => {
    if (closed || role) return;
    if (state.status !== "ready")
      console.error(`Pavra role setting is invalid (${state.error}); acting as coordinator.`);
    role = state.status === "ready" ? state.values : { mode: "coordinator" };
    if (role.mode === "member") {
      if (!role.coordinatorServerId)
        console.error("Pavra is a member without coordinatorServerId; set it and reload.");
      return;
    }
    const hosts = hostDirectory(server.paseo);
    hostLinks = hosts;
    const machines: MachinePort = {
      self: () => hosts.self(),
      isMember: (serverId) => links?.state(serverId)?.kind === "member",
      online: async (serverId) =>
        (await hosts.list()).some((host) => host.serverId === serverId && host.online),
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
                  : "Its Pavra plugin is not reachable as a member of this coordinator.",
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
      event: (serverId, event) => active.onMemberEvent(serverId, event),
      reconnected: () => active.onMemberReconnected(),
    });
    links.start();
  };
  void roles.read().then(start, (error) => {
    console.error("Pavra role read failed; acting as coordinator", error);
    start({ status: "ready", revision: "", values: { mode: "coordinator" } });
  });
  const unsubscribeRoles = roles.subscribe((state) => {
    if (
      role &&
      state.status === "ready" &&
      (state.values.mode !== role.mode ||
        state.values.coordinatorServerId !== role.coordinatorServerId)
    )
      console.error("Pavra role changed; reload the plugin to apply it.");
  });

  return async () => {
    closed = true;
    unsubscribeTasks();
    unsubscribeRoles();
    relay.close();
    links?.close();
    await memberBrowsers.stopAll().catch(() => undefined);
    await coordinator?.close();
    await hostLinks?.dispose();
    store?.close();
  };
}
