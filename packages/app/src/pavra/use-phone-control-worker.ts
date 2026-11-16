import { defineRpc } from "@getpaseo/plugin";
import { useCallback, useEffect, useRef } from "react";
import { z } from "zod";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import type { PavraData } from "./data";
import {
  buildPhoneRegistrationPayload,
  canAcceptPhoneCommand,
  defaultExecutePhoneCommand,
  phoneCommandSchema,
  phoneEmergencyStopRpc,
  phonePollCommandRpc,
  phoneRegisterRpc,
  phoneReportCommandResultRpc,
  resolveCommandStepDescription,
  runPhoneWorkerIteration,
  subscribePhoneEmergencyStop,
  usePhoneControlStore,
  type PhoneCommandExecutionOutput,
  type PhoneQueuedCommand,
  type PhoneRpcInvoker,
} from "./phone-control";
import { usePavraView } from "./store";

export {
  buildPhoneRegistrationPayload,
  defaultExecutePhoneCommand,
  phoneCommandSchema,
  phoneEmergencyStopRpc,
  phonePollCommandRpc,
  phoneRegisterRpc,
  phoneReportCommandResultRpc,
  resolveCommandStepDescription,
  runPhoneWorkerIteration,
  type PhoneCommandExecutionOutput,
  type PhoneQueuedCommand,
  type PhoneRpcInvoker,
};

export interface UsePhoneControlWorkerOptions {
  serverId?: string;
  data?: Pick<PavraData, "invoke" | "call">;
  isRelay?: boolean;
  pollWaitMs?: number;
}

export function usePhoneControlWorker(optionsOrServerId?: string | UsePhoneControlWorkerOptions) {
  const normalizedOptions: UsePhoneControlWorkerOptions =
    typeof optionsOrServerId === "string"
      ? { serverId: optionsOrServerId }
      : (optionsOrServerId ?? {});

  const fallbackCoordinatorId = usePavraView((state) => state.coordinatorId);
  const resolvedServerId = normalizedOptions.serverId ?? fallbackCoordinatorId;
  const client = useHostRuntimeClient(resolvedServerId);
  const connected = useHostRuntimeIsConnected(resolvedServerId);
  const snapshot = useHostRuntimeSnapshot(resolvedServerId);
  const isRelay =
    normalizedOptions.isRelay !== undefined
      ? normalizedOptions.isRelay
      : snapshot?.activeConnection?.type === "relay";

  const enabled = usePhoneControlStore((state) => state.enabled);
  const deviceId = usePhoneControlStore((state) => state.deviceId);
  const deviceName = usePhoneControlStore((state) => state.deviceName);
  const privilegeChannel = usePhoneControlStore((state) => state.privilegeChannel);
  const privilegeStatus = usePhoneControlStore((state) => state.privilegeStatus);
  const allowRelayControl = usePhoneControlStore((state) => state.allowRelayControl);
  const outwardConfirmTier = usePhoneControlStore((state) => state.outwardConfirmTier);
  const paused = usePhoneControlStore((state) => state.paused);

  const invokeRpc = useCallback<PhoneRpcInvoker>(
    async (name, payload) => {
      if (client && connected) {
        return await client.invokePluginRpc("pavra", name, payload);
      }
      if (normalizedOptions.data?.invoke) {
        const dynamicContract = defineRpc({
          name,
          input: z.record(z.string(), z.unknown()),
          output: z.unknown(),
        });
        return await normalizedOptions.data.invoke(dynamicContract, payload);
      }
      throw new Error("Coordinator client is not connected.");
    },
    [client, connected, normalizedOptions.data],
  );

  const canInvoke = Boolean((client && connected) || normalizedOptions.data?.invoke);
  const canAcceptCommands = canAcceptPhoneCommand({
    isRelay,
    allowRelayControl,
    enabled,
    paused,
  });

  const registerNow = useCallback(async () => {
    if (!canInvoke || !enabled) return false;
    const state = usePhoneControlStore.getState();
    if (!canAcceptPhoneCommand({ isRelay, allowRelayControl: state.allowRelayControl, enabled })) {
      return false;
    }
    try {
      await invokeRpc(phoneRegisterRpc.name, buildPhoneRegistrationPayload(state, isRelay));
      return true;
    } catch {
      return false;
    }
  }, [canInvoke, enabled, invokeRpc, isRelay]);

  const triggerEmergencyStop = useCallback(async () => {
    const currentDeviceId = usePhoneControlStore.getState().deviceId;
    usePhoneControlStore.getState().triggerEmergencyStop();
    if (!canInvoke) return;
    try {
      await invokeRpc(phoneEmergencyStopRpc.name, {
        deviceId: currentDeviceId,
        reason: "Hardware emergency stop triggered by user",
      });
    } catch {
      // Best-effort RPC notification.
    }
  }, [canInvoke, invokeRpc]);

  const invokeRpcRef = useRef(invokeRpc);
  invokeRpcRef.current = invokeRpc;
  const canInvokeRef = useRef(canInvoke);
  canInvokeRef.current = canInvoke;

  useEffect(() => {
    return subscribePhoneEmergencyStop(() => {
      if (!canInvokeRef.current) return;
      const currentDeviceId = usePhoneControlStore.getState().deviceId;
      void invokeRpcRef
        .current(phoneEmergencyStopRpc.name, {
          deviceId: currentDeviceId,
          reason: "Hardware emergency stop triggered by user",
        })
        .catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    if (!enabled || !canInvoke) return;
    if (!canAcceptPhoneCommand({ isRelay, allowRelayControl, enabled, paused: false })) {
      return;
    }
    void registerNow();
  }, [
    allowRelayControl,
    canInvoke,
    deviceId,
    deviceName,
    enabled,
    isRelay,
    outwardConfirmTier,
    privilegeChannel,
    privilegeStatus.activeChannel,
    privilegeStatus.ready,
    privilegeStatus.virtualDisplayId,
    registerNow,
  ]);

  useEffect(() => {
    if (!enabled || !canInvoke || !canAcceptCommands) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    void (async () => {
      while (!isCancelled()) {
        try {
          const outcome = await runPhoneWorkerIteration({
            invokeRpc,
            isRelay,
            waitMs: normalizedOptions.pollWaitMs ?? 12000,
          });
          if (isCancelled()) break;
          if (
            outcome.status === "disabled" ||
            outcome.status === "paused" ||
            outcome.status === "relay_blocked"
          ) {
            break;
          }
          await sleep(outcome.status === "idle" ? 400 : 150);
        } catch {
          if (isCancelled()) break;
          await sleep(1500);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canAcceptCommands, canInvoke, enabled, invokeRpc, isRelay, normalizedOptions.pollWaitMs]);

  return {
    enabled,
    isRelay,
    canAcceptCommands,
    registerNow,
    triggerEmergencyStop,
  };
}
