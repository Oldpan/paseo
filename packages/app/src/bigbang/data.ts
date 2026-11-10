import { useFetchQuery } from "@/data/query";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RpcInput, PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType } from "zod";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  listMachines,
  readState,
  type ChatState,
  type MachineInfo,
} from "../../../../extensions/bigbang/shared/contracts";
import { memberHello } from "../../../../extensions/bigbang/shared/member";
import { EMPTY_CHAT_STATE, mergeChatState } from "./model";
import { runChatSyncLoop } from "./sync";

type MemberHello = import("zod").output<typeof memberHello.output>;

type ChatStateCache = Pick<QueryClient, "getQueryData" | "setQueryData">;

/** Initial per-conversation message window requested on a cold (`after = 0`) snapshot. */
export const INITIAL_MESSAGE_LIMIT = 200;

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
  // Keyed by host: an error from the coordinator the user just left must not outlive the switch.
  const [pollError, setPollError] = useState<{ serverId: string; error: Error } | null>(null);
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
          ...(previous.cursor === 0 ? { messageLimit: INITIAL_MESSAGE_LIMIT } : {}),
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
      onError: (error) => setPollError({ serverId, error }),
    });
  }, [cache, client, connected, key, serverId, settled]);
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
    error: query.error ?? (pollError?.serverId === serverId ? pollError.error : null),
    connected,
    loading: query.isPending,
    call,
    invoke,
  };
}
export type BigbangData = ReturnType<typeof useBigbangData>;

/** Machines a new assistant can live on, as the coordinator sees them; read while creating one. */
/** The machines a new assistant can pick from. */
export function useAssistantMachines(
  invoke: BigbangData["invoke"],
  form: string | null,
  editing: string | null,
) {
  return useMachines(invoke, form === "assistant" && !editing);
}

/** The coordinator's view of every saved host, read while `enabled`. */
export function useMachines(invoke: BigbangData["invoke"], enabled: boolean) {
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void (async () => {
      let next: MachineInfo[] = [];
      try {
        next = (await invoke(listMachines, {})).machines;
      } catch {
        // COMPAT(bigbangMachines): added 2026-10-28, remove after 2027-04-28. Coordinators
        // without chat.machines run every assistant themselves.
      }
      if (current) setMachines(next);
    })();
    return () => {
      current = false;
    };
  }, [enabled, invoke]);
  return machines;
}

/** Whether the selected host is a Chat member, read once Chat failed to load there. */
export function useChatRole(invoke: BigbangData["invoke"], enabled: boolean) {
  const [role, setRole] = useState<MemberHello | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void invoke(memberHello, {}).then(
      (hello) => current && setRole(hello),
      () => current && setRole(null),
    );
    return () => {
      current = false;
      setRole(null);
    };
  }, [enabled, invoke]);
  return role;
}

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
