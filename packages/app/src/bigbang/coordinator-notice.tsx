// Why Chat did not load on the selected host. A member keeps no ledger, so instead of a generic
// failure the user is sent to the coordinator it serves.
import { useCallback, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import type { HostProfile } from "@/types/host-connection";
import { useChatRole, type BigbangData } from "./data";
import { chatReadError } from "./title";
import { Chip } from "./ui/ChatChrome";

const ROW = {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  paddingHorizontal: 12,
  paddingVertical: 8,
} as const;

export function CoordinatorNotice({
  error,
  invoke,
  hosts,
  coordinatorId,
  textColor,
  onSelect,
}: {
  error: Error;
  invoke: BigbangData["invoke"];
  hosts: readonly HostProfile[];
  coordinatorId: string;
  textColor: string;
  onSelect(serverId: string): void;
}) {
  const role = useChatRole(invoke, true);
  const style = useMemo(() => ({ color: textColor }), [textColor]);
  const label = (serverId: string) =>
    hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const target =
    role?.mode === "member" && role.coordinatorServerId ? role.coordinatorServerId : null;
  const known = target !== null && hosts.some((host) => host.serverId === target);
  useEffect(() => {
    if (known && target && target !== coordinatorId) {
      onSelect(target);
    }
  }, [coordinatorId, known, onSelect, target]);
  const open = useCallback(() => {
    if (target) onSelect(target);
  }, [onSelect, target]);
  if (role?.mode !== "member")
    return (
      <View style={ROW} accessibilityRole="alert">
        <Text style={style}>{chatReadError(error)}</Text>
      </View>
    );
  return (
    <View style={ROW} accessibilityRole="alert">
      <Text style={style}>
        {target
          ? `${label(coordinatorId)} is a Chat member of ${label(target)}. Chat lives on its coordinator.`
          : `${label(coordinatorId)} is a Chat member without a coordinator yet.`}
      </Text>
      {known ? (
        <Chip onPress={open} accent>
          {`Open ${label(target)}`}
        </Chip>
      ) : null}
    </View>
  );
}
