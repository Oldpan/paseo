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
} from "./shared/contracts";
import { ChatStore } from "./server/store";
import { Coordinator } from "./server/coordinator";

export default function contribute(server: PluginServerContext) {
  if (!process.env.PASEO_HOME) throw new Error("Bigbang requires an explicit PASEO_HOME.");
  const home = path.join(process.env.PASEO_HOME, "bigbang");
  const store = new ChatStore(path.join(home, "chat.sqlite"));
  const coordinator = new Coordinator(store, home);
  // Recovery starts now, in the background, without waiting for a client RPC or a hook.
  coordinator.attach(server.paseo);
  server.handle(readState, (input) => coordinator.readState(input));
  server.handle(saveAssistant, (input) => coordinator.saveAssistant(input));
  server.handle(readAssistantMemory, (input) => coordinator.readAssistantMemory(input));
  server.handle(writeAssistantMemory, (input) => coordinator.writeAssistantMemory(input));
  server.handle(createConversation, (input) => coordinator.createConversation(input));
  server.handle(sendMessage, (input) => coordinator.send(input));
  server.handle(startTask, (input) => coordinator.task(input));
  server.handle(cancelTask, (input) => coordinator.cancel(input.id));
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
    await coordinator.close();
    store.close();
  };
}
