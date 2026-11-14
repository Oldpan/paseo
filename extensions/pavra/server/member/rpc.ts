import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";

/** Calls a plugin RPC through `invoke`, validating both sides against the shared contract. */
export async function callPluginRpc<Input extends ZodType, Output extends ZodType>(
  contract: PluginRpcContract<Input, Output>,
  invoke: (method: string, input: unknown) => Promise<unknown>,
  input: ZodInput<Input>,
): Promise<ZodOutput<Output>> {
  const parsed = await contract.input.parseAsync(input);
  return contract.output.parseAsync(await invoke(contract.name, parsed));
}
