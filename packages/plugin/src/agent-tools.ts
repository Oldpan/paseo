import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";

export interface PluginAgentToolContract<
  InputSchema extends ZodType = ZodType,
  OutputSchema extends ZodType = ZodType,
> {
  name: string;
  description: string;
  input: InputSchema;
  output: OutputSchema;
}

export type AgentToolInput<Contract extends PluginAgentToolContract> = ZodOutput<Contract["input"]>;
export type AgentToolOutput<Contract extends PluginAgentToolContract> = ZodInput<
  Contract["output"]
>;

interface AgentToolDefinition<InputSchema extends ZodType, OutputSchema extends ZodType> {
  name: string;
  description: string;
  input: InputSchema;
  output: OutputSchema;
}

export const AGENT_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;

/**
 * Declares a tool that agents can call through the daemon's Agent MCP endpoint. The daemon
 * exposes it as `<pluginId>-<name>` to verified agents the plugin has admitted.
 */
export function defineAgentTool<InputSchema extends ZodType, OutputSchema extends ZodType>(
  definition: AgentToolDefinition<InputSchema, OutputSchema>,
): PluginAgentToolContract<InputSchema, OutputSchema> {
  const name = definition.name.trim();
  if (!AGENT_TOOL_NAME_PATTERN.test(name))
    throw new Error(`Invalid plugin agent tool name: ${definition.name}`);
  const description = definition.description.trim();
  if (!description) throw new Error(`Plugin agent tool ${name} requires a description`);
  return { ...definition, name, description };
}
