import { defineAgentTool, defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";

const whoami = defineAgentTool({
  name: "whoami",
  description: "Returns the ID of the agent calling this tool",
  input: z.object({}),
  output: z.object({ agentId: z.string() }),
});

const echo = defineAgentTool({
  name: "echo",
  description: "Returns the given text",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ text: z.string() }),
});

const setAudience = defineRpc({
  name: "set_audience",
  input: z.object({ agentIds: z.union([z.array(z.string()), z.literal("all")]) }),
  output: z.object({}),
});

export default function contribute(server: PluginServerContext) {
  server.registerAgentTool(whoami, (_input, { caller }) => ({ agentId: caller.agentId }));
  server.registerAgentTool(echo, ({ text }) => ({ text }));
  server.handle(setAudience, ({ agentIds }) => {
    server.setAgentToolAudience(agentIds);
    return {};
  });
  return () => undefined;
}
