// Task presentation for the Bigbang Chat: the task card (chat root lane, Tasks tab, task thread
// header), the lifecycle receipt row, and the inline approval both can carry. State is derived in
// ../task-view; actions come from the chat screen, which owns the RPC calls.
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Task } from "../../../../../extensions/bigbang/shared/contracts";
import { taskCardState, type TaskApproval, type TaskEventNote, type Tone } from "../task-view";
import { Chip } from "./ChatChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface TaskCardActions {
  /** Opens the task's thread in the chat; absent inside that thread. */
  openThread?(): void;
  openStudio(): void;
  cancel(): Promise<void>;
  respond(requestId: string, behavior: "allow" | "deny"): Promise<void>;
}

/** Runs one async action at a time and keeps its failure for display next to the control. */
function useAction() {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      running.current = false;
      setPending(false);
    }
  }, []);
  return { pending, error, run };
}

function useToneColor() {
  const { palette: t } = useTheme();
  return (tone: Tone) =>
    tone === "live"
      ? t.warning
      : tone === "ok"
        ? t.success
        : tone === "bad"
          ? t.destructive
          : t.textMuted;
}

/** The permission the task is waiting on, answered through the coordinator on any host. */
export function ApprovalBlock({
  approval,
  respond,
}: {
  approval: TaskApproval;
  respond(requestId: string, behavior: "allow" | "deny"): Promise<void>;
}) {
  const { palette: t } = useTheme();
  const action = useAction();
  const { requestId } = approval;
  const allow = () => void action.run(() => respond(requestId, "allow"));
  const deny = () => void action.run(() => respond(requestId, "deny"));
  return (
    <View
      testID={`task-approval-${requestId}`}
      style={{
        alignSelf: "stretch",
        gap: 6,
        padding: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: t.warning,
        backgroundColor: t.surfacePrimary,
      }}
    >
      <Text style={type(t.textMuted, 10, { fontWeight: "800", textTransform: "uppercase" })}>
        Approval needed
      </Text>
      <Text selectable style={type(t.textPrimary, 12)}>
        {approval.title}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <Chip onPress={allow} disabled={action.pending} accent label="Allow">
          Allow
        </Chip>
        <Chip onPress={deny} disabled={action.pending} label="Deny">
          Deny
        </Chip>
        {action.pending ? <Text style={type(t.textMuted, 11)}>Sending…</Text> : null}
      </View>
      {action.error ? (
        <Text accessibilityRole="alert" style={type(t.destructive, 11)}>
          {action.error}
        </Text>
      ) : null}
    </View>
  );
}

export function TaskCard({
  task,
  assistantName,
  hostLabel,
  inThread = false,
  actions,
}: {
  task: Task;
  assistantName?: string;
  hostLabel?: string;
  /** The card heads its own task thread: full prompt, no "Open thread". */
  inThread?: boolean;
  actions: TaskCardActions;
}) {
  const { palette: t } = useTheme();
  const toneColor = useToneColor();
  const cancelAction = useAction();
  const state = taskCardState({ task, assistantName, hostLabel, inThread });
  const cancel = () => void cancelAction.run(actions.cancel);
  return (
    <View
      testID={`task-card-${task.id}`}
      style={{
        alignSelf: "stretch",
        marginTop: inThread ? 0 : 8,
        padding: 12,
        gap: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceElevated,
      }}
    >
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: toneColor(state.tone),
          }}
        />
        <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>{state.statusLabel}</Text>
        {state.origin ? (
          <View
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.badgeBlue,
              paddingHorizontal: 8,
              paddingVertical: 1,
            }}
          >
            <Text style={type(t.onAccent, 10, { fontWeight: "600" })}>
              {`Started by ${state.origin}`}
            </Text>
          </View>
        ) : null}
        <Text numberOfLines={1} style={type(t.textMuted, 10, { flex: 1, textAlign: "right" })}>
          {state.provider}
        </Text>
      </View>
      <Text selectable={inThread} style={type(t.textPrimary, 13, { fontWeight: "600" })}>
        {state.title}
      </Text>
      {state.detail ? (
        <Text
          selectable={inThread}
          numberOfLines={inThread ? undefined : 3}
          style={type(t.textSecondary, 12)}
        >
          {state.detail}
        </Text>
      ) : null}
      <Text numberOfLines={inThread ? undefined : 1} style={type(t.textMuted, 10)}>
        {state.target}
      </Text>
      {state.budgetStopped ? (
        <Text style={type(t.textSecondary, 11)}>
          Budget reached. Reply in the thread to continue.
        </Text>
      ) : null}
      {state.error ? <Text style={type(t.destructive, 11)}>{state.error}</Text> : null}
      {state.approval ? (
        <ApprovalBlock approval={state.approval} respond={actions.respond} />
      ) : null}
      {cancelAction.error ? (
        <Text accessibilityRole="alert" style={type(t.destructive, 11)}>
          {cancelAction.error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {state.canOpenThread && actions.openThread ? (
          <Chip onPress={actions.openThread} label="Open task thread" accent>
            Open thread
          </Chip>
        ) : null}
        <Chip onPress={actions.openStudio} disabled={!state.canOpenStudio} label="Open Studio">
          Open Studio
        </Chip>
        {state.live ? (
          <Chip onPress={cancel} disabled={!state.canCancel || cancelAction.pending}>
            {task.cancelPending || cancelAction.pending ? "Cancelling…" : "Cancel"}
          </Chip>
        ) : null}
      </View>
    </View>
  );
}

/** A `task_event` receipt: a compact centred note that opens the task thread when tapped. */
export function TaskEventRow({
  id,
  note,
  onOpen,
  respond,
}: {
  id: string;
  note: TaskEventNote;
  onOpen?(): void;
  respond(requestId: string, behavior: "allow" | "deny"): Promise<void>;
}) {
  const { palette: t } = useTheme();
  const toneColor = useToneColor();
  const body = (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", maxWidth: 520 }}>
      <Text style={type(toneColor(note.tone), 11, { fontWeight: "700", width: 12 })}>
        {note.glyph}
      </Text>
      <Text
        selectable={!onOpen}
        style={type(t.textMuted, 11, { flexShrink: 1, textAlign: "center" })}
      >
        {note.text}
      </Text>
    </View>
  );
  return (
    <View
      testID={`message-${id}`}
      style={{ alignItems: "center", paddingHorizontal: 24, paddingVertical: 6, gap: 6 }}
    >
      {onOpen ? (
        <Pressable role="button" accessibilityLabel="Open task thread" onPress={onOpen}>
          {body}
        </Pressable>
      ) : (
        body
      )}
      {note.approval ? (
        <View style={{ alignSelf: "stretch", maxWidth: 420, alignItems: "stretch" }}>
          <ApprovalBlock approval={note.approval} respond={respond} />
        </View>
      ) : null}
    </View>
  );
}
