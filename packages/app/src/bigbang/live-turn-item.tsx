import { memo, useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { PermissionRequestCard } from "@/agent-stream/view";
import { useRevealedText } from "@/hooks/use-revealed-text";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import type { Turn } from "../../../../extensions/bigbang/shared/contracts";
import { Chip, LiveTurnBubble } from "./ui/ChatChrome";
import { selectLiveTurn } from "./live-turn";

const EMPTY_ITEMS: StreamItem[] = [];
const EMPTY_PERMISSIONS: PendingPermission[] = [];
const CHIP_ROW = { marginTop: 6, alignItems: "flex-start" } as const;
const APPROVALS = { alignSelf: "stretch", marginTop: 8, maxWidth: 560 } as const;
const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  creating: "Starting…",
  running: "Thinking…",
  attention: "Waiting for you",
  unknown: "Reconnecting…",
};
// An awareness turn may answer "(pass)"; the coordinator commits nothing for it, so do not flash
// its first characters either.
const PASS = "(pass)";
function isPassPrefix(text: string): boolean {
  const value = text.trim().toLowerCase();
  return value.length > 0 && (PASS.startsWith(value) || value === "pass");
}

/**
 * One in-flight Chat turn: the assistant's streaming reply and its pending approvals, read from
 * the execution agent's timeline in the session store. The coordinator commits the final message
 * and the parent stops rendering this component; nothing here writes to the ledger.
 */
export const LiveTurnItem = memo(function LiveTurnItem({
  serverId,
  turn,
  name,
  seed,
  onOpenTurn,
}: {
  serverId: string;
  turn: Turn;
  name: string;
  seed: string;
  onOpenTurn(turn: Turn): void;
}) {
  const client = useHostRuntimeClient(serverId);
  const tail = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamTail.get(turn.agentId) ?? EMPTY_ITEMS,
  );
  const head = useSessionStore(
    (state) => state.sessions[serverId]?.agentStreamHead.get(turn.agentId) ?? EMPTY_ITEMS,
  );
  const permissions = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const all = state.sessions[serverId]?.pendingPermissions;
      if (!all) return EMPTY_PERMISSIONS;
      const mine: PendingPermission[] = [];
      for (const permission of all.values()) {
        if (permission.agentId === turn.agentId) mine.push(permission);
      }
      return mine.length > 0 ? mine : EMPTY_PERMISSIONS;
    },
    shallow,
  );
  const view = useMemo(
    () => selectLiveTurn(head.length > 0 ? [...tail, ...head] : tail, turn.id),
    [head, tail, turn.id],
  );
  const text = useRevealedText(isPassPrefix(view.text) ? "" : view.text, "streaming");
  const startedAt = useRef(Date.now());
  const onOpen = useCallback(() => onOpenTurn(turn), [onOpenTurn, turn]);
  return (
    <LiveTurnBubble
      id={`live:${turn.id}`}
      sender={name}
      seed={seed}
      text={text}
      commentary={view.commentary}
      activity={view.activity}
      statusLabel={STATUS_LABEL[turn.status] ?? turn.status}
      createdAt={startedAt.current}
    >
      {permissions.length > 0 ? (
        <View style={APPROVALS}>
          {permissions.map((permission) => (
            <PermissionRequestCard key={permission.key} permission={permission} client={client} />
          ))}
        </View>
      ) : null}
      <View style={CHIP_ROW}>
        <Chip onPress={onOpen}>View process</Chip>
      </View>
    </LiveTurnBubble>
  );
});
