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
} from "./shared/contracts";
import { taskSettings } from "./shared/settings";
import {
  startTaskHandler,
  startTaskTool,
  taskStatusHandler,
  taskStatusTool,
} from "./server/agent-tools";
import { ChatStore } from "./server/store";
import { Coordinator } from "./server/coordinator";

export default function contribute(server: PluginServerContext) {
  if (!process.env.PASEO_HOME) throw new Error("Bigbang requires an explicit PASEO_HOME.");
  const home = path.join(process.env.PASEO_HOME, "bigbang");
  const store = new ChatStore(path.join(home, "chat.sqlite"));
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
  const coordinator = new Coordinator(store, home, {
    onAudience: (agentIds) => server.setAgentToolAudience(agentIds),
  });
  server.handle(readState, (input) => coordinator.readState(input));
  server.handle(saveAssistant, (input) => coordinator.saveAssistant(input));
  server.handle(readAssistantMemory, (input) => coordinator.readAssistantMemory(input));
  server.handle(writeAssistantMemory, (input) => coordinator.writeAssistantMemory(input));
  server.handle(createConversation, (input) => coordinator.createConversation(input));
  server.handle(sendMessage, (input) => coordinator.send(input));
  server.handle(startTask, (input) => coordinator.task(input));
  server.handle(cancelTask, (input) => coordinator.cancel(input.id));
  server.handle(respondTaskPermission, (input) => coordinator.respondPermission(input));
  server.registerAgentTool(startTaskTool, startTaskHandler(coordinator));
  server.registerAgentTool(taskStatusTool, taskStatusHandler(coordinator));
  // Limits start at their defaults and follow the host's settings.
  const settings = server.registerSettings(taskSettings);
  const applyLimits = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status === "ready") coordinator.setLimits(state.values);
  };
  void settings
    .read()
    .then(applyLimits, (error) => console.error("Bigbang settings read failed", error));
  const unsubscribeSettings = settings.subscribe(applyLimits);
  // Recovery starts now, in the background, without waiting for a client RPC or a hook. It also
  // admits the existing assistants' chat executions to the agent tools, so it runs after they exist.
  coordinator.attach(server.paseo);
  // Lifecycle hooks are best-effort and only fire for this daemon. They record and enqueue;
  // the coordinator reads the execution's timeline, so a missed or repeated hook is harmless.
  server.on("agent.turn_started", (event) => {
    coordinator.onTurnStarted(event);
  });
  server.on("agent.turn_ended", (event) => {
    coordinator.onTurnEnded(event);
  });
  server.on("agent.permission_requested", (event) => {
    coordinator.onPermissionRequested(event);
  });
  server.on("agent.permission_resolved", (event) => {
    coordinator.onPermissionResolved(event);
  });
  server.on("agent.archived", (event) => {
    coordinator.onAgentGone(event, "archived");
  });
  server.on("agent.closed", (event) => {
    coordinator.onAgentGone(event, "closed");
  });
  return async () => {
    unsubscribeSettings();
    await coordinator.close();
    store.close();
  };
}
