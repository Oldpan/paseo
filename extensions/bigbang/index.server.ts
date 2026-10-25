import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  readState,
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
  server.handle(readState, (input, { paseo }) => {
    coordinator.attach(paseo);
    return store.snapshot(input.after, input.generation);
  });
  server.handle(saveAssistant, (input) => coordinator.saveAssistant(input));
  server.handle(createConversation, (input) => coordinator.createConversation(input));
  server.handle(sendMessage, (input, { paseo }) => {
    coordinator.attach(paseo);
    return coordinator.send(input);
  });
  server.handle(startTask, (input, { paseo }) => {
    coordinator.attach(paseo);
    return coordinator.task(input);
  });
  server.handle(cancelTask, (input, { paseo }) => {
    coordinator.attach(paseo);
    return coordinator.cancel(input.id);
  });
  return async () => {
    await coordinator.close();
    store.close();
  };
}
