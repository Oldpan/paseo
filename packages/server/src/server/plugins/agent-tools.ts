import { z } from "zod";
import type { Logger } from "pino";

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
      name: `${pluginId}__${tool.name}`,
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
