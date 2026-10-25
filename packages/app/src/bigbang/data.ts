import { useFetchQuery } from "@/data/query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { RpcInput, PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType } from "zod";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { readState, type ChatState } from "../../../../extensions/bigbang/shared/contracts";
import { EMPTY_CHAT_STATE, mergeChatState } from "./model";

export function useBigbangData(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const cache = useQueryClient();
  const key = ["bigbang", serverId] as const;
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: key,
    enabled: Boolean(client && connected),
    refetchInterval: 1500,
    queryFn: async () => {
      if (!client) throw new Error("Choose the Chat coordinator.");
      const previous = cache.getQueryData<ChatState>(key) ?? EMPTY_CHAT_STATE;
      const next = readState.output.parse(
        await client.invokePluginRpc("bigbang", readState.name, {
          after: previous.cursor,
          generation: previous.generation,
        }),
      );
      return mergeChatState(previous, next);
    },
  });
  const call = useCallback(
    async <I extends ZodType, O extends ZodType>(
      contract: PluginRpcContract<I, O>,
      input: RpcInput<PluginRpcContract<I, O>>,
    ): Promise<import("zod").output<O>> => {
      if (!client || !connected)
        throw new Error(
          "The Chat coordinator is offline. Reconnect or choose another host explicitly.",
        );
      const result = contract.output.parse(
        await client.invokePluginRpc("bigbang", contract.name, contract.input.parse(input)),
      );
      await cache.invalidateQueries({ queryKey: ["bigbang", serverId] });
      return result;
    },
    [cache, client, connected, serverId],
  );
  return {
    state: query.data ?? EMPTY_CHAT_STATE,
    error: query.error,
    connected,
    loading: query.isPending,
    call,
  };
}
export type BigbangData = ReturnType<typeof useBigbangData>;
