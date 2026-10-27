import type { PaseoApi } from "@getpaseo/client";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import type { PluginAgentToolContract } from "../agent-tools.js";
import type { PluginRpcContract } from "../rpc.js";
import type { PluginCleanup } from "../contracts.js";
import type { ProviderRegistration } from "./provider.js";
import type { UsageSourceRegistration } from "./usage.js";
import type { PluginLifecycleRegistration } from "./lifecycle.js";

export interface PluginHandlerContext {
  paseo: PaseoApi;
}

export interface PluginAgentToolCaller {
  agentId: string;
}

export interface PluginAgentToolContext {
  /** The verified agent making the call. */
  caller: PluginAgentToolCaller;
  paseo: PaseoApi;
  /** Aborted when the daemon gives up on the call (timeout or plugin shutdown). */
  signal: AbortSignal;
}

export type PluginAgentToolAudience = readonly string[] | "all";

export type PluginSettingsState<Schema extends ZodType> =
  | {
      status: "ready";
      revision: string;
      values: ZodOutput<Schema>;
    }
  | {
      status: "invalid";
      revision: string;
      error: string;
    };

export interface PluginSettings<Schema extends ZodType> {
  read(): Promise<PluginSettingsState<Schema>>;
  subscribe(listener: (state: PluginSettingsState<Schema>) => void | Promise<void>): PluginCleanup;
}

export interface PluginServerContext extends PluginLifecycleRegistration {
  /**
   * The plugin's connection to the daemon. It is ready when `contribute()` runs, but do not
   * await daemon calls synchronously inside `contribute()`: start background recovery
   * without blocking the return of the cleanup function.
   */
  paseo: PaseoApi;
  /**
   * Exposes a tool to agents over the daemon's Agent MCP endpoint as `<pluginId>-<name>`.
   * Only verified agents named by `setAgentToolAudience` can list or call it.
   */
  registerAgentTool<InputSchema extends ZodType, OutputSchema extends ZodType>(
    tool: PluginAgentToolContract<InputSchema, OutputSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginAgentToolContext,
    ) => ZodInput<OutputSchema> | Promise<ZodInput<OutputSchema>>,
  ): void;
  /**
   * Replaces the set of agent ids that can see this plugin's agent tools. Defaults to none.
   * Call it before creating an agent that must see the tools.
   */
  setAgentToolAudience(agentIds: PluginAgentToolAudience): void;
  registerSettings<Schema extends ZodType>(
    definition: import("../settings.js").SettingsDefinition<Schema>,
  ): PluginSettings<Schema>;
  handle<InputSchema extends ZodType, OutputSchema extends ZodType>(
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginHandlerContext,
    ) => ZodInput<OutputSchema> | Promise<ZodInput<OutputSchema>>,
  ): void;
  registerProvider(provider: ProviderRegistration): void;
  registerUsageSource(source: UsageSourceRegistration): void;
}

export type PluginServerContribution = (server: PluginServerContext) => PluginCleanup;
