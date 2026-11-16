import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import { saveMessage, type Message } from "../../../../../extensions/pavra/shared/contracts";
import { buildSaveMessageRequest } from "../chat-actions";
import type { PavraData } from "../data";
import {
  filterSavedMessages,
  type SavedMessageFilterType,
  type SavedMessageItem,
} from "../saved-messages";
import { HeaderIconButton } from "./ChatChrome";
import { BookmarkIcon, ExternalLinkIcon, MenuIcon, SearchIcon, TrashIcon } from "./icons";
import { ctrlShadow, selectedFillProps, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface SavedMessagesPaneProps {
  data: Pick<PavraData, "state" | "call" | "connected">;
  compact?: boolean;
  embedded?: boolean;
  onJumpToMessage(conversationId: string, threadId: string | null, messageId: string): void;
  onSidebar?(): void;
}

const FILTER_PILLS: ReadonlyArray<{
  id: SavedMessageFilterType;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "dm", label: "DM" },
  { id: "group", label: "Group" },
  { id: "thread", label: "Thread" },
];

function formatSavedTime(timestampMs: number): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) return "";
  const date = new Date(timestampMs);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceBadgeLabel(sourceType: SavedMessageItem["sourceType"]): string {
  switch (sourceType) {
    case "thread":
      return "Thread";
    case "group":
      return "Group";
    default:
      return "DM";
  }
}

export function SavedMessagesPane({
  data,
  compact = false,
  embedded = false,
  onJumpToMessage,
  onSidebar,
}: SavedMessagesPaneProps) {
  const { palette: t, name } = useTheme();
  const [filterType, setFilterType] = useState<SavedMessageFilterType>("all");
  const [query, setQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allSaved = useMemo(
    () =>
      filterSavedMessages({
        messages: data.state.messages,
        conversations: data.state.conversations,
        assistants: data.state.assistants,
      }),
    [data.state.assistants, data.state.conversations, data.state.messages],
  );

  const filtered = useMemo(
    () =>
      filterSavedMessages({
        messages: data.state.messages,
        conversations: data.state.conversations,
        assistants: data.state.assistants,
        filterType,
        query,
      }),
    [data.state.assistants, data.state.conversations, data.state.messages, filterType, query],
  );

  const handleUnsave = useCallback(
    async (message: Message) => {
      setRemovingId(message.id);
      setError(null);
      try {
        await data.call(saveMessage, buildSaveMessageRequest({ message, saved: false }));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setRemovingId((current) => (current === message.id ? null : current));
      }
    },
    [data],
  );

  const countLabel =
    filterType === "all" && !query.trim()
      ? `${allSaved.length} ${allSaved.length === 1 ? "saved message" : "saved messages"}`
      : `${filtered.length} of ${allSaved.length} saved`;

  return (
    <View
      testID="saved-messages-pane"
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: embedded ? "transparent" : t.chatSurface,
      }}
    >
      <View
        style={{
          backgroundColor: t.surfacePrimary,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: embedded ? 1 : 2,
          borderBottomColor: embedded ? t.retroBorder : t.black,
          gap: 10,
        }}
      >
        {!embedded ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              {compact && onSidebar ? (
                <HeaderIconButton label="Open sidebar" onPress={onSidebar} size={34}>
                  <MenuIcon color={t.textSecondary} size={16} />
                </HeaderIconButton>
              ) : null}
              <View
                style={[
                  {
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: t.brandAccent,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  ctrlShadow(t, name),
                ]}
              >
                <BookmarkIcon color={t.onAccent} size={15} filled />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  role="heading"
                  numberOfLines={1}
                  style={type(t.textPrimary, 15, { fontWeight: "800" })}
                >
                  Saved · 收藏
                </Text>
                <Text numberOfLines={1} style={type(t.textSecondary, 11, { marginTop: 1 })}>
                  {countLabel}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {FILTER_PILLS.map((pill) => {
              const selected = filterType === pill.id;
              return (
                <Pressable
                  key={pill.id}
                  testID={`saved-filter-${pill.id}`}
                  role="button"
                  accessibilityLabel={pill.label}
                  accessibilityState={{ selected }}
                  onPress={() => setFilterType(pill.id)}
                  {...selectedFillProps(selected)}
                  style={(state) => {
                    const hovered = Boolean((state as { hovered?: boolean }).hovered);
                    return [
                      {
                        height: 30,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: t.retroBorder,
                        backgroundColor: selected
                          ? hovered
                            ? t.brandAccentHover
                            : t.brandAccent
                          : hovered
                            ? t.surfaceHover
                            : t.surfaceElevated,
                        paddingHorizontal: 10,
                        justifyContent: "center",
                        ...webTransition("background-color 120ms ease"),
                      },
                      ctrlShadow(t, name),
                    ];
                  }}
                >
                  <Text
                    style={type(selected ? t.onAccent : t.textSecondary, 11, {
                      fontWeight: "700",
                    })}
                  >
                    {pill.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              minWidth: 200,
              flex: 1,
              maxWidth: 340,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              paddingHorizontal: 10,
            }}
          >
            <SearchIcon color={t.textMuted} size={13} />
            <EditingTextInput
              testID="saved-search-input"
              accessibilityLabel="Search saved messages"
              initialValue={query}
              onChangeText={setQuery}
              placeholder="Search saved messages…"
              placeholderTextColor={t.textSubtle}
              style={[
                type(t.textPrimary, 12),
                {
                  flex: 1,
                  minHeight: 30,
                  paddingVertical: 4,
                },
              ]}
            />
          </View>
        </View>
      </View>

      {error ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: t.surfaceElevated,
            borderBottomWidth: 1,
            borderBottomColor: t.destructive,
          }}
        >
          <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
            {error}
          </Text>
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        {allSaved.length === 0 ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 40,
            }}
          >
            <View
              style={[
                {
                  maxWidth: 320,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.surfaceElevated,
                  paddingHorizontal: 20,
                  paddingVertical: 16,
                  gap: 6,
                },
                ctrlShadow(t, name),
              ]}
            >
              <Text
                style={type(t.textMuted, 11, {
                  fontWeight: "800",
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                })}
              >
                Nothing saved yet
              </Text>
              <Text style={type(t.textSecondary, 13)}>
                Bookmark important replies or decisions in any chat or thread to keep them handy
                here.
              </Text>
            </View>
          </View>
        ) : filtered.length === 0 ? (
          <Text style={type(t.textMuted, 13, { textAlign: "center", marginTop: 24 })}>
            No matching saved messages found.
          </Text>
        ) : (
          filtered.map((item) => {
            const busy = removingId === item.messageId;
            return (
              <View
                key={item.messageId}
                testID={`saved-item-${item.messageId}`}
                style={[
                  {
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: t.surfaceElevated,
                    padding: 12,
                    gap: 8,
                  },
                  ctrlShadow(t, name),
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                      flex: 1,
                    }}
                  >
                    <Text numberOfLines={1} style={type(t.textPrimary, 12, { fontWeight: "800" })}>
                      {item.senderName}
                    </Text>
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
                      <Text style={type(t.textPrimary, 10, { fontWeight: "700" })}>
                        {`${item.conversationTitle} · ${sourceBadgeLabel(item.sourceType)}`}
                      </Text>
                    </View>
                  </View>
                  <Text style={type(t.textMuted, 11)}>
                    {formatSavedTime(item.savedAtMs || item.createdAt)}
                  </Text>
                </View>

                <Text numberOfLines={4} style={type(t.textPrimary, 13, { lineHeight: 20 })}>
                  {item.previewContent}
                </Text>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Pressable
                    testID={`saved-jump-${item.messageId}`}
                    role="button"
                    accessibilityLabel="Jump to message"
                    onPress={() =>
                      onJumpToMessage(item.conversationId, item.threadId, item.messageId)
                    }
                    style={[
                      {
                        minHeight: 28,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: t.retroBorder,
                        backgroundColor: t.brandAccent,
                        paddingHorizontal: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                      },
                      ctrlShadow(t, name),
                    ]}
                  >
                    <ExternalLinkIcon color={t.onAccent} size={12} />
                    <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Jump to Message</Text>
                  </Pressable>

                  <Pressable
                    testID={`saved-unsave-${item.messageId}`}
                    role="button"
                    accessibilityLabel="Unsave message"
                    disabled={busy}
                    onPress={() => {
                      void handleUnsave(item.message);
                    }}
                    style={[
                      {
                        minHeight: 28,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: t.retroBorder,
                        backgroundColor: t.surfacePrimary,
                        paddingHorizontal: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        opacity: busy ? 0.5 : 1,
                      },
                      ctrlShadow(t, name),
                    ]}
                  >
                    <TrashIcon color={t.textSecondary} size={12} />
                    <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Unsave</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
