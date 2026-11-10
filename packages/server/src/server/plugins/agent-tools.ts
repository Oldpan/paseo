import { z } from "zod";
import type { Logger } from "pino";
import type {
  AgentToolDefinition,
  AgentToolResult,
  PluginHookContext,
  PluginSessionOpenRequest,
  PluginHookAgent,
} from "@getpaseo/plugin/server";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

import type { PaseoToolDefinition, PaseoToolResult } from "../agent/tools/types.js";
import type { PluginService } from "./index.js";

interface PluginAgentToolsInput {
  runtime: Pick<PluginService, "listAgentTools" | "callAgentTool">;
  callerAgentId: string;
  logger: Logger;
}

/**
 * Agent tools the plugins admit `callerAgentId` to, shaped as Paseo tool definitions. Callers
 * must only pass an agent the daemon has verified; audience membership is re-checked on call.
 */
export function createPluginAgentTools(input: PluginAgentToolsInput): PaseoToolDefinition[] {
  const { runtime, callerAgentId, logger } = input;
  const definitions: PaseoToolDefinition[] = [];
  for (const { pluginId, tool } of runtime.listAgentTools(callerAgentId)) {
    let inputSchema: z.ZodType;
    try {
      inputSchema = z.fromJSONSchema(tool.inputSchema);
    } catch (error) {
      logger.warn({ err: error, pluginId, tool: tool.name }, "Skipping plugin agent tool");
      continue;
    }
    definitions.push({
      // Tool names cannot contain "-", so this never collides with another plugin's tool or a
      // built-in. Never "__": Grok qualifies MCP tools as `<server>__<tool>` and drops any tool
      // whose own name contains it.
      name: `${pluginId}-${tool.name}`,
      title: tool.name,
      description: tool.description,
      inputSchema,
      handler: async (args) => {
        try {
          const output = await runtime.callAgentTool({
            pluginId,
            tool: tool.name,
            input: args,
            callerAgentId,
          });
          return toToolResult(output);
        } catch (error) {
          return {
            isError: true,
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
      },
    });
  }
  return definitions;
}

function toToolResult(output: unknown): PaseoToolResult {
  const text = JSON.stringify(output) ?? "null";
  const isRecord = typeof output === "object" && output !== null && !Array.isArray(output);
  return {
    content: [{ type: "text", text }],
    ...(isRecord ? { structuredContent: output } : {}),
  };
}

export const agentToolMetadataSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(64),
    title: z.string().optional(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    pluginId: z.string().optional(),
    pluginInstanceId: z.string().optional(),
  })
  .strict();
export type AgentToolMetadata = z.infer<typeof agentToolMetadataSchema>;
export type AttachedAgentTool = AgentToolMetadata & { pluginId: string; pluginInstanceId: string };
export type SessionOpenWireRequest = Omit<PluginSessionOpenRequest, "tools"> & {
  tools: AgentToolMetadata[];
};

export interface PluginAgentToolsRuntime {
  isToolPluginAvailable(pluginId: string, pluginInstanceId: string): boolean;
  detachTools(agentId: string): void;
  callTool(
    pluginId: string,
    pluginInstanceId: string,
    agent: PluginHookAgent,
    name: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<AgentToolResult>;
}

export function serializeAgentTool(tool: AgentToolDefinition): AgentToolMetadata {
  return agentToolMetadataSchema.parse({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toJsonSchemaCompat(tool.input, { strictUnions: true, pipeStrategy: "input" }),
  });
}

// This store lives only in the plugin process. Definitions and parsed values never cross IPC.
export class PluginAgentTools {
  private readonly agents = new Map<string, AgentToolDefinition[]>();
  private readonly calls = new Map<string, { agentId: string; controller: AbortController }>();

  attach(agentId: string, tools: AgentToolDefinition[]): AgentToolMetadata[] {
    const names = new Set<string>();
    const metadata = tools.map((tool) => {
      const serialized = serializeAgentTool(tool);
      if (names.has(tool.name)) throw new Error(`Duplicate agent tool: ${tool.name}`);
      names.add(tool.name);
      return serialized;
    });
    this.agents.set(agentId, tools);
    return metadata;
  }

  detach(agentId: string): void {
    this.agents.delete(agentId);
    for (const call of this.calls.values()) {
      if (call.agentId === agentId) call.controller.abort();
    }
  }

  cancel(requestId: string): void {
    this.calls.get(requestId)?.controller.abort();
  }

  close(): void {
    for (const call of this.calls.values()) call.controller.abort();
    this.agents.clear();
  }

  async call(
    requestId: string,
    agent: PluginHookAgent,
    name: string,
    input: unknown,
    paseo: PluginHookContext["paseo"],
  ): Promise<AgentToolResult> {
    const controller = new AbortController();
    this.calls.set(requestId, { agentId: agent.id, controller });
    try {
      const tool = this.agents.get(agent.id)?.find((definition) => definition.name === name);
      if (!tool) throw new Error(`Agent tool not attached: ${name}`);
      const parsed = await tool.input.parseAsync(input);
      controller.signal.throwIfAborted();
      const result = await tool.execute(parsed, { agent, paseo, signal: controller.signal });
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      return { isError: true, text: error instanceof Error ? error.message : String(error) };
    } finally {
      this.calls.delete(requestId);
    }
  }
}
