import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";

/** A machine an assistant can be bound to, as the coordinator sees it. */
export interface Machine {
  serverId: string;
  label: string;
  /** coordinator: this daemon; member: its plugin serves this coordinator; unavailable: neither. */
  role: "coordinator" | "member" | "unavailable";
  reason?: string;
}

/** The coordinator's view of its member machines. */
export interface MachinePort {
  /** This coordinator's own serverId. */
  self(): Promise<string>;
  /** The host's Bigbang plugin is linked to this coordinator right now. */
  isMember(serverId: string): boolean;
  list(): Promise<Machine[]>;
  /** Whether a saved host is reachable now. */
  online(serverId: string): Promise<boolean>;
  call<Input extends ZodType, Output extends ZodType>(
    serverId: string,
    contract: PluginRpcContract<Input, Output>,
    input: ZodInput<Input>,
  ): Promise<ZodOutput<Output>>;
}
