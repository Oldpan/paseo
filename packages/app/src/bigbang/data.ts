import { useFetchQuery } from "@/data/query";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RpcInput, PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType } from "zod";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { readState, type ChatState } from "../../../../extensions/bigbang/shared/contracts";
import { EMPTY_CHAT_STATE, mergeChatState } from "./model";
import { runChatSyncLoop } from "./sync";

type ChatStateCache = Pick<QueryClient, "getQueryData" | "setQueryData">;

function applyChatState(cache: ChatStateCache, key: readonly unknown[], next: ChatState) {
  // Functional update: the snapshot fetch and the long poll both merge into the same cache entry.
  return cache.setQueryData<ChatState>(key, (previous) =>
    mergeChatState(previous ?? EMPTY_CHAT_STATE, next),
  );
}

export function useBigbangData(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const cache = useQueryClient();
  const key = useMemo(() => ["bigbang", serverId] as const, [serverId]);
  const [pollError, setPollError] = useState<Error | null>(null);
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: key,
    enabled: Boolean(client && connected),
    queryFn: async () => {
      if (!client) throw new Error("Choose the Chat coordinator.");
      const previous = cache.getQueryData<ChatState>(key) ?? EMPTY_CHAT_STATE;
      const next = readState.output.parse(
        await client.invokePluginRpc("bigbang", readState.name, {
          after: previous.cursor,
          generation: previous.generation,
        }),
      );
      return applyChatState(cache, key, next) ?? next;
    },
  });
  // The snapshot above covers first paint and post-mutation refresh; the long poll then keeps the
  // cache current. It starts once the snapshot settles so the two do not fetch the same state twice.
  const settled = query.isSuccess || query.isError;
  useEffect(() => {
    if (!client || !connected || !settled) return;
    return startChatSync({
      client,
      cache,
      key,
      onSuccess: () => setPollError(null),
      onError: setPollError,
    });
  }, [cache, client, connected, key, settled]);
  // `invoke` is for reads and for writes that never touch the ledger; `call` also refreshes it.
  const invoke = useCallback(
    async <I extends ZodType, O extends ZodType>(
      contract: PluginRpcContract<I, O>,
      input: RpcInput<PluginRpcContract<I, O>>,
    ): Promise<import("zod").output<O>> => {
      if (!client || !connected)
        throw new Error(
          "The Chat coordinator is offline. Reconnect or choose another host explicitly.",
        );
      return contract.output.parse(
        await client.invokePluginRpc("bigbang", contract.name, contract.input.parse(input)),
      );
    },
    [client, connected],
  );
  const call = useCallback(
    async <I extends ZodType, O extends ZodType>(
      contract: PluginRpcContract<I, O>,
      input: RpcInput<PluginRpcContract<I, O>>,
    ): Promise<import("zod").output<O>> => {
      const result = await invoke(contract, input);
      await cache.invalidateQueries({ queryKey: key });
      return result;
    },
    [cache, invoke, key],
  );
  return {
    state: query.data ?? EMPTY_CHAT_STATE,
    error: query.error ?? pollError,
    connected,
    loading: query.isPending,
    call,
    invoke,
  };
}
export type BigbangData = ReturnType<typeof useBigbangData>;

function startChatSync(input: {
  client: DaemonClient;
  cache: ChatStateCache;
  key: readonly unknown[];
  onSuccess(): void;
  onError(error: Error): void;
}): () => void {
  let cancelled = false;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  void runChatSyncLoop({
    read: async ({ after, generation, waitMs }) =>
      readState.output.parse(
        await input.client.invokePluginRpc("bigbang", readState.name, {
          after,
          generation,
          waitMs,
        }),
      ),
    current: () => input.cache.getQueryData<ChatState>(input.key) ?? EMPTY_CHAT_STATE,
    apply: (next) => applyChatState(input.cache, input.key, next),
    sleep,
    now: () => Date.now(),
    isCancelled: () => cancelled,
    onSuccess: input.onSuccess,
    onError: input.onError,
  });
  return () => {
    cancelled = true;
  };
}
