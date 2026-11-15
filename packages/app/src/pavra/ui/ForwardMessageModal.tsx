import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type {
  Assistant,
  Conversation,
  Message,
} from "../../../../../extensions/pavra/shared/contracts";
import { sendMessage } from "../../../../../extensions/pavra/shared/contracts";
import {
  type ForwardConversationTarget,
  buildForwardSendInput,
  buildForwardSource,
  listForwardTargets,
} from "../chat-actions";
import type { PavraData } from "../data";
import { Chip } from "./ChatChrome";
import { FormFrame, PavraField, PavraInput } from "./FormChrome";
import { CheckIcon, ForwardIcon, SearchIcon } from "./icons";
import { useTheme } from "./ThemeProvider";
import { ctrlShadow, text as type } from "./theme";

function ForwardTargetRow({
  target,
  active,
  onSelect,
}: {
  target: ForwardConversationTarget;
  active: boolean;
  onSelect: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Forward to ${target.title}`}
      onPress={onSelect}
      style={({ pressed }) => [
        s.targetRow,
        {
          borderColor: active ? t.retroBorder : t.retroBorderLight,
          backgroundColor: active ? t.brandAccentSoft : t.surfacePrimary,
          opacity: pressed ? 0.86 : 1,
        },
        active && ctrlShadow(t, name),
      ]}
    >
      <View style={s.targetMeta}>
        <View style={s.targetTitleRow}>
          <Text
            style={type(t.textPrimary, 12, { fontWeight: active ? "700" : "600" })}
            numberOfLines={1}
          >
            {target.title}
          </Text>
          <View
            style={[
              s.kindBadge,
              {
                borderColor: t.retroBorderLight,
                backgroundColor: target.kind === "group" ? t.badgeBlue : t.surfaceElevated,
              },
            ]}
          >
            <Text style={type(t.textSecondary, 10, { fontWeight: "700" })}>
              {target.kind === "group" ? "GROUP" : "DM"}
            </Text>
          </View>
          {target.isOrigin ? (
            <Text style={type(t.textMuted, 10, { fontWeight: "700" })}>CURRENT</Text>
          ) : null}
        </View>
        <Text style={type(t.textSecondary, 11)} numberOfLines={1}>
          {target.subtitle}
        </Text>
      </View>
      <View
        style={[
          s.checkCircle,
          {
            borderColor: active ? t.retroBorder : t.retroBorderLight,
            backgroundColor: active ? t.brandAccent : t.surfaceSecondary,
          },
        ]}
      >
        {active ? <CheckIcon size={11} color={t.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

export interface ForwardMessageModalProps {
  message: Message;
  conversations: readonly Conversation[];
  assistants: readonly Assistant[];
  data?: Pick<PavraData, "call">;
  onSendForward?: (input: ReturnType<typeof buildForwardSendInput>) => Promise<unknown> | unknown;
  onForwarded?: (targetConversationId: string, forwardedMessageId: string) => void;
  onClose: () => void;
}

export function ForwardMessageModal({
  message,
  conversations,
  assistants,
  data,
  onSendForward,
  onForwarded,
  onClose,
}: ForwardMessageModalProps) {
  const { palette: t, name } = useTheme();
  const source = useMemo(
    () => buildForwardSource({ message, conversations, assistants }),
    [message, conversations, assistants],
  );
  const allTargets = useMemo(
    () =>
      listForwardTargets({
        conversations,
        assistants,
        originConversationId: message.conversationId,
      }),
    [conversations, assistants, message.conversationId],
  );
  const [query, setQuery] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string>(
    () => allTargets[0]?.conversation.id ?? message.conversationId,
  );
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredTargets = useMemo(
    () =>
      listForwardTargets({
        conversations,
        assistants,
        query,
        originConversationId: message.conversationId,
      }),
    [conversations, assistants, query, message.conversationId],
  );

  const selectedTarget =
    allTargets.find((target) => target.conversation.id === selectedConversationId) ??
    filteredTargets[0] ??
    null;

  const submitForward = async () => {
    const targetId = selectedTarget?.conversation.id;
    if (!targetId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const forwardedId = randomUUID();
      const payload = buildForwardSendInput({
        id: forwardedId,
        targetConversationId: targetId,
        source,
        comment,
      });
      if (onSendForward) {
        await onSendForward(payload);
      } else if (data) {
        const ok = await data.call(sendMessage, payload);
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      onForwarded?.(targetId, forwardedId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <FormFrame title="Forward Message" onClose={onClose}>
      <View
        style={[
          s.previewCard,
          {
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
          },
          ctrlShadow(t, name),
        ]}
      >
        <View style={s.previewHeader}>
          <ForwardIcon size={12} color={t.textSecondary} />
          <Text style={type(t.textSecondary, 11, { fontWeight: "700" })} numberOfLines={1}>
            {source.senderName} · {source.conversationTitle}
          </Text>
        </View>
        <Text style={type(t.textPrimary, 12)} numberOfLines={4}>
          {source.content.trim() || "(empty message)"}
        </Text>
      </View>

      <PavraField label={`Target Chat (${filteredTargets.length})`}>
        <View style={s.searchWrap}>
          <View style={s.searchIcon}>
            <SearchIcon size={13} color={t.textMuted} />
          </View>
          <PavraInput
            initialValue={query}
            onChangeText={setQuery}
            placeholder="Filter by chat or assistant name…"
            style={s.searchInput}
          />
        </View>

        <ScrollView style={s.targetList} contentContainerStyle={s.targetListContent}>
          {filteredTargets.length === 0 ? (
            <View style={[s.emptyState, { borderColor: t.retroBorderLight }]}>
              <Text style={type(t.textMuted, 11)}>No matching chats found.</Text>
            </View>
          ) : (
            filteredTargets.map((target) => (
              <ForwardTargetRow
                key={target.conversation.id}
                target={target}
                active={target.conversation.id === selectedTarget?.conversation.id}
                onSelect={() => setSelectedConversationId(target.conversation.id)}
              />
            ))
          )}
        </ScrollView>
      </PavraField>

      <PavraField label="Comment (optional)">
        <PavraInput
          initialValue={comment}
          onChangeText={setComment}
          placeholder="Add context or @mention an assistant…"
          multiline
          style={s.commentInput}
        />
      </PavraField>

      {error ? (
        <View style={[s.errorBanner, { borderColor: t.destructive, backgroundColor: t.badgeRed }]}>
          <Text style={type(t.destructive, 11)}>{error}</Text>
        </View>
      ) : null}

      <View style={s.footerRow}>
        <Chip onPress={onClose} disabled={busy}>
          Cancel
        </Chip>
        <Chip accent disabled={busy || !selectedTarget} onPress={() => void submitForward()}>
          {busy ? "Forwarding…" : "Forward"}
        </Chip>
      </View>
    </FormFrame>
  );
}

const s = StyleSheet.create({
  previewCard: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchWrap: {
    position: "relative",
    justifyContent: "center",
  },
  searchIcon: {
    position: "absolute",
    left: 11,
    zIndex: 1,
  },
  searchInput: {
    paddingLeft: 32,
  },
  targetList: {
    maxHeight: 210,
    marginTop: 6,
  },
  targetListContent: {
    gap: 6,
  },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1.5,
  },
  targetMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  targetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  kindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    paddingVertical: 16,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  commentInput: {
    minHeight: 68,
    textAlignVertical: "top",
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingTop: 4,
  },
});
