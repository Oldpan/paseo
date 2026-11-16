import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { useOverlayRegistration, type KeyboardInputEvent } from "@/keyboard";
import { useGlobalOverlayLayer } from "@/lib/overlay-root";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type {
  Assistant,
  Conversation,
  Routine,
  Studio,
  Task,
} from "../../../../../extensions/pavra/shared/contracts";
import {
  buildSnippetHighlight,
  searchPavraState,
  type ChatMessage,
  type SearchFilterCategory,
  type SearchMessageInput,
  type SearchPlaybookInput,
  type SearchResultItem,
  type SearchSnapshot,
  type SnippetSegment,
} from "../search";
import { AgentAvatar } from "./avatars";
import {
  ActivityIcon,
  BookmarkIcon,
  BoxesIcon,
  ClockIcon,
  CloseIcon,
  FileTextIcon,
  HashIcon,
  MessagesSquareIcon,
  SearchIcon,
} from "./icons";
import {
  cardShadow,
  ctrlShadow,
  selectedFillProps,
  text as type,
  webTransition,
  type Palette,
  type ThemeName,
} from "./theme";
import { useTheme } from "./ThemeProvider";

export const SEARCH_FILTER_PILLS: readonly {
  key: SearchFilterCategory;
  label: string;
}[] = [
  { key: "all", label: "All" },
  { key: "messages", label: "Messages" },
  { key: "saved", label: "Saved" },
  { key: "assistants", label: "Assistants" },
  { key: "conversations", label: "Conversations" },
  { key: "tasks", label: "Tasks" },
  { key: "routines_playbooks", label: "Routines & Playbooks" },
  { key: "studios", label: "Studios" },
];

export interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  onToggle?: () => void;
  state?: SearchSnapshot;
  conversations?: readonly Conversation[];
  messages?: readonly SearchMessageInput[];
  assistants?: readonly Assistant[];
  tasks?: readonly Task[];
  routines?: readonly Routine[];
  playbooks?: readonly SearchPlaybookInput[];
  studios?: readonly Studio[];
  hostLabels?: Record<string, string>;
  onSearchServerMessages?: (query: string) => Promise<ChatMessage[]>;
  onSelectConversation: (
    conversationId: string,
    messageId?: string,
    threadId?: string | null,
  ) => void;
  onSelectTask?: (conversationId: string, taskId: string) => void;
  onSelectRoutine?: (routineId: string, conversationId?: string, assistantId?: string) => void;
  onSelectPlaybook?: (slug: string, assistantId?: string, conversationId?: string) => void;
  onSelectStudio?: (studioId: string) => void;
  onSelectAssistant?: (assistantId: string) => void;
}

const SERVER_SEARCH_DEBOUNCE_MS = 200;
const MIN_SERVER_QUERY_LENGTH = 2;

const OVERLAY_CONTAINER_STYLE = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 160,
  elevation: 60,
  alignItems: "center" as const,
  justifyContent: "flex-start" as const,
  paddingTop: 56,
  paddingHorizontal: 16,
  paddingBottom: 24,
};

const BACKDROP_STYLE = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
};

const ROW_ENVELOPE_STYLE = {
  position: "relative" as const,
};

/**
 * Registers `Cmd+K` / `Ctrl+K` on web/desktop and bridges Paseo's `commandCenterOpen`
 * store state so hardware keyboard shortcuts toggle Pavra's `GlobalSearchModal`.
 */
export function useGlobalSearchShortcut(onToggle: () => void, enabled = true): void {
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    if (!enabled) return undefined;
    const unsubscribeStore = useKeyboardShortcutsStore.subscribe((state, prevState) => {
      if (state.commandCenterOpen && !prevState.commandCenterOpen) {
        useKeyboardShortcutsStore.getState().setCommandCenterOpen(false, null);
        onToggleRef.current();
      }
    });

    if (!isWeb || typeof window === "undefined") {
      return unsubscribeStore;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k" && event.code !== "KeyK") return;
      event.preventDefault();
      event.stopPropagation();
      onToggleRef.current();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      unsubscribeStore();
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [enabled]);
}

/**
 * Neo-brutalist search trigger button for `ChatHeader` or `Sidebar` on mobile & desktop.
 */
export function GlobalSearchButton({
  onPress,
  compact = false,
  label = "Global search",
}: {
  onPress: () => void;
  compact?: boolean;
  label?: string;
}) {
  const { palette: t, name } = useTheme();
  const shortcutBadge = getShortcutOs() === "mac" ? "⌘K" : "Ctrl+K";

  return (
    <Pressable
      testID="global-search-trigger"
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            width: compact ? 34 : undefined,
            height: compact ? 34 : 32,
            paddingHorizontal: compact ? 0 : 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: hovered ? t.surfaceHover : t.surfaceElevated,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            transform: [{ translateY: hovered ? -1 : 0 }],
            ...webTransition("transform 120ms ease, background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <SearchIcon color={t.textSecondary} size={14} />
      {!compact ? (
        <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Search</Text>
      ) : null}
      {isWeb && !compact ? (
        <View
          style={{
            borderRadius: 5,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfacePrimary,
            paddingHorizontal: 5,
            paddingVertical: 1,
          }}
        >
          <Text style={type(t.textMuted, 9, { fontWeight: "700" })}>{shortcutBadge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function renderHighlightedSegments(
  segments: readonly SnippetSegment[],
  highlightBg: string,
  highlightFg: string,
): ReactNode {
  if (segments.length === 0) return null;
  if (segments.length === 1 && !segments[0]!.highlight) {
    return segments[0]!.text;
  }
  return segments.map((seg, idx) =>
    seg.highlight ? (
      <Text
        key={`hl-${idx}`}
        style={{
          backgroundColor: highlightBg,
          color: highlightFg,
          fontWeight: "700",
        }}
      >
        {seg.text}
      </Text>
    ) : (
      seg.text
    ),
  );
}

function ResultLeadingIcon({
  item,
  theme,
  name,
}: {
  item: SearchResultItem;
  theme: Palette;
  name: ThemeName;
}) {
  if (item.kind === "assistant" || (item.kind === "conversation" && item.badge === "DM")) {
    const seedId = item.assistantId ?? item.conversationId ?? item.id;
    const label = item.assistantName ?? item.title;
    return (
      <AgentAvatar seed={`${seedId}:${label}`} label={label} size={30} theme={theme} name={name} />
    );
  }

  let icon: ReactNode;
  let badgeBg = theme.surfaceElevated;
  switch (item.kind) {
    case "saved":
      icon = <BookmarkIcon color={theme.onAccent} size={14} filled />;
      badgeBg = theme.brandAccent;
      break;
    case "message":
      icon = <MessagesSquareIcon color={theme.textPrimary} size={14} />;
      badgeBg = theme.badgeBlue;
      break;
    case "conversation":
      icon = <HashIcon color={theme.textPrimary} size={14} />;
      badgeBg = theme.brandAccentSoft;
      break;
    case "task":
      icon = <ActivityIcon color={theme.textPrimary} size={14} />;
      badgeBg = theme.badgeGreen;
      break;
    case "routine":
      icon = <ClockIcon color={theme.textPrimary} size={14} />;
      badgeBg = theme.badgeAmber;
      break;
    case "playbook":
      icon = <FileTextIcon color={theme.onPink} size={14} />;
      badgeBg = theme.badgePink;
      break;
    case "studio":
      icon = <BoxesIcon color={theme.textPrimary} size={14} />;
      badgeBg = theme.brandAccentSoft;
      break;
  }

  return (
    <View
      style={[
        {
          width: 30,
          height: 30,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.retroBorder,
          backgroundColor: badgeBg,
          alignItems: "center",
          justifyContent: "center",
        },
        ctrlShadow(theme, name),
      ]}
    >
      {icon}
    </View>
  );
}

interface ResultSection {
  key: string;
  title: string;
  items: { item: SearchResultItem; flatIndex: number }[];
}

function buildDisplaySections(
  isEmptyQuery: boolean,
  activeCategory: SearchFilterCategory,
  results: readonly SearchResultItem[],
  emptySections: ReturnType<typeof searchPavraState>["emptySections"],
): { sections: ResultSection[]; flatItems: SearchResultItem[] } {
  const sections: ResultSection[] = [];
  const flatItems: SearchResultItem[] = [];

  const pushSection = (key: string, title: string, items: readonly SearchResultItem[]) => {
    if (items.length === 0) return;
    const indexed = items.map((item) => {
      const flatIndex = flatItems.length;
      flatItems.push(item);
      return { item, flatIndex };
    });
    sections.push({ key, title, items: indexed });
  };

  if (isEmptyQuery && activeCategory === "all") {
    pushSection("saved", "Saved Messages", emptySections.savedMessages);
    pushSection("recent-conversations", "Recent Conversations", emptySections.recentConversations);
    pushSection("active-tasks", "Active Tasks", emptySections.activeTasks);
    pushSection("recent-messages", "Recent Messages", emptySections.recentMessages);
    return { sections, flatItems };
  }

  if (activeCategory === "all") {
    const groupedOrder: readonly {
      key: Exclude<SearchFilterCategory, "all" | "routines_playbooks">;
      title: string;
    }[] = [
      { key: "saved", title: "Saved Messages" },
      { key: "assistants", title: "Assistants" },
      { key: "conversations", title: "Conversations" },
      { key: "messages", title: "Messages" },
      { key: "tasks", title: "Tasks" },
      { key: "routines", title: "Routines" },
      { key: "playbooks", title: "Playbooks" },
      { key: "studios", title: "Studios" },
    ];
    for (const group of groupedOrder) {
      pushSection(
        group.key,
        group.title,
        results.filter((r) => r.category === group.key),
      );
    }
    return { sections, flatItems };
  }

  if (activeCategory === "routines_playbooks") {
    pushSection(
      "routines",
      "Routines",
      results.filter((r) => r.category === "routines"),
    );
    pushSection(
      "playbooks",
      "Playbooks",
      results.filter((r) => r.category === "playbooks"),
    );
    return { sections, flatItems };
  }

  const activePill = SEARCH_FILTER_PILLS.find((p) => p.key === activeCategory);
  pushSection(activeCategory, activePill?.label ?? "Results", results);
  return { sections, flatItems };
}

function resolveSnapshotFromProps(
  props: GlobalSearchModalProps,
  serverMessages: readonly ChatMessage[],
): SearchSnapshot {
  const base = props.state;
  return {
    conversations: props.conversations ?? base?.conversations,
    messages: props.messages ?? base?.messages,
    assistants: props.assistants ?? base?.assistants,
    tasks: props.tasks ?? base?.tasks,
    routines: props.routines ?? base?.routines,
    playbooks: props.playbooks ?? base?.playbooks,
    studios: props.studios ?? base?.studios,
    hostLabels: props.hostLabels ?? base?.hostLabels,
    serverMessages,
  };
}

function navigateFallbackConversation(
  conversationId: string | undefined,
  onSelectConversation: GlobalSearchModalProps["onSelectConversation"],
  messageId?: string,
  threadId?: string | null,
): void {
  if (conversationId) {
    onSelectConversation(conversationId, messageId, threadId);
  }
}

function dispatchEntityNavigation(item: SearchResultItem, props: GlobalSearchModalProps): void {
  const {
    onSelectConversation,
    onSelectAssistant,
    onSelectTask,
    onSelectRoutine,
    onSelectPlaybook,
    onSelectStudio,
  } = props;

  if (item.kind === "assistant") {
    if (onSelectAssistant && item.assistantId) {
      onSelectAssistant(item.assistantId);
      return;
    }
    navigateFallbackConversation(item.conversationId, onSelectConversation);
    return;
  }
  if (item.kind === "task" && item.conversationId && item.taskId) {
    if (onSelectTask) {
      onSelectTask(item.conversationId, item.taskId);
      return;
    }
    onSelectConversation(item.conversationId, undefined, `task:${item.taskId}`);
    return;
  }
  if (item.kind === "routine" && item.routineId) {
    if (onSelectRoutine) {
      onSelectRoutine(item.routineId, item.conversationId, item.assistantId);
      return;
    }
    navigateFallbackConversation(item.conversationId, onSelectConversation);
    return;
  }
  if (item.kind === "playbook" && item.playbookSlug) {
    if (onSelectPlaybook) {
      onSelectPlaybook(item.playbookSlug, item.assistantId, item.conversationId);
      return;
    }
    navigateFallbackConversation(item.conversationId, onSelectConversation);
    return;
  }
  if (item.kind === "studio" && item.studioId) {
    onSelectStudio?.(item.studioId);
  }
}

function dispatchResultNavigation(item: SearchResultItem, props: GlobalSearchModalProps): void {
  if ((item.kind === "message" || item.kind === "saved") && item.conversationId) {
    props.onSelectConversation(item.conversationId, item.messageId, item.threadId);
    return;
  }
  if (item.kind === "conversation" && item.conversationId) {
    props.onSelectConversation(item.conversationId);
    return;
  }
  dispatchEntityNavigation(item, props);
}

function SearchHeaderBar({
  inputRef,
  hasQuery,
  serverLoading,
  onQueryChange,
  onClear,
  onSubmit,
  onClose,
}: {
  inputRef: React.RefObject<EditingTextInputHandle | null>;
  hasQuery: boolean;
  serverLoading: boolean;
  onQueryChange: (next: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: t.dividerLine,
        backgroundColor: t.surfacePrimary,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <View
        style={[
          {
            width: 32,
            height: 32,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.brandAccent,
            alignItems: "center",
            justifyContent: "center",
          },
          ctrlShadow(t, name),
        ]}
      >
        <SearchIcon color={t.onAccent} size={15} />
      </View>
      <EditingTextInput
        ref={inputRef}
        testID="global-search-input"
        accessibilityLabel="Search"
        autoFocus
        initialValue=""
        onChangeText={onQueryChange}
        onSubmitEditing={onSubmit}
        placeholder="Search messages, saved, assistants, tasks, routines, playbooks, studios…"
        placeholderTextColor={t.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          type(t.textPrimary, 13, { fontWeight: "500" }),
          {
            flex: 1,
            minWidth: 0,
            paddingVertical: 4,
            ...(isWeb ? ({ outlineStyle: "none" } as object) : null),
          },
        ]}
      />
      {serverLoading ? <ActivityIndicator size="small" color={t.textSecondary} /> : null}
      {hasQuery ? (
        <Pressable
          testID="global-search-clear"
          role="button"
          accessibilityLabel="Clear search query"
          onPress={onClear}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceElevated,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CloseIcon color={t.textSecondary} size={12} />
        </Pressable>
      ) : null}
      <Pressable
        testID="global-search-esc"
        role="button"
        accessibilityLabel="Close search"
        onPress={onClose}
        style={[
          {
            borderRadius: 6,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceElevated,
            paddingHorizontal: 8,
            paddingVertical: 4,
          },
          ctrlShadow(t, name),
        ]}
      >
        <Text style={type(t.textSecondary, 10, { fontWeight: "700" })}>Esc</Text>
      </Pressable>
    </View>
  );
}

function SearchFilterPillsBar({
  activeCategory,
  isEmptyQuery,
  counts,
  onSelectCategory,
}: {
  activeCategory: SearchFilterCategory;
  isEmptyQuery: boolean;
  counts: Record<SearchFilterCategory, number>;
  onSelectCategory: (category: SearchFilterCategory) => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: t.dividerLine,
        backgroundColor: t.surfaceSecondary,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        {SEARCH_FILTER_PILLS.map((pill) => {
          const selected = activeCategory === pill.key;
          const count = counts[pill.key];
          return (
            <Pressable
              key={pill.key}
              testID={`global-search-pill-${pill.key}`}
              role="button"
              accessibilityLabel={pill.label}
              accessibilityState={{ selected }}
              onPress={() => onSelectCategory(pill.key)}
              {...selectedFillProps(selected)}
              style={(pressState) => {
                const hovered = Boolean((pressState as { hovered?: boolean }).hovered);
                const selectedBg = hovered ? t.surfaceHover : t.brandAccentSoft;
                const idleBg = hovered ? t.surfaceHover : "transparent";
                return [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    minHeight: 28,
                    borderRadius: 8,
                    borderWidth: selected ? 1 : 0,
                    borderColor: selected ? t.retroBorder : "transparent",
                    backgroundColor: selected ? selectedBg : idleBg,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    ...webTransition("background-color 120ms ease"),
                  },
                  selected ? ctrlShadow(t, name) : null,
                ];
              }}
            >
              <Text
                style={type(selected ? t.textPrimary : t.textSecondary, 11, {
                  fontWeight: "700",
                  letterSpacing: 0.4,
                })}
              >
                {pill.label}
              </Text>
              {!isEmptyQuery && count > 0 ? (
                <Text
                  style={type(selected ? t.textPrimary : t.textMuted, 10, { fontWeight: "800" })}
                >
                  {count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ResultRowTitleLine({
  item,
  query,
  highlightFg,
}: {
  item: SearchResultItem;
  query: string;
  highlightFg: string;
}) {
  const { palette: t } = useTheme();
  const titleHighlight = buildSnippetHighlight(item.title, query, 90);
  const badgeBg = item.kind === "saved" ? t.brandAccent : t.brandAccentSoft;
  const badgeFg = item.kind === "saved" ? t.onAccent : t.textSecondary;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <Text numberOfLines={1} style={type(t.textPrimary, 13, { fontWeight: "700", flexShrink: 1 })}>
        {renderHighlightedSegments(titleHighlight.segments, t.brandAccent, highlightFg)}
      </Text>
      {item.badge ? (
        <View
          style={{
            borderRadius: 5,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: badgeBg,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}
        >
          <Text
            style={type(badgeFg, 9, {
              fontWeight: "800",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            })}
          >
            {item.badge}
          </Text>
        </View>
      ) : null}
      {item.relativeTime ? (
        <Text style={type(t.textMuted, 10, { fontWeight: "600" })}>{item.relativeTime}</Text>
      ) : null}
    </View>
  );
}

function ResultRowBodyLine({ item, highlightFg }: { item: SearchResultItem; highlightFg: string }) {
  const { palette: t } = useTheme();
  if (item.snippet.text) {
    return (
      <Text numberOfLines={2} style={type(t.textSecondary, 12, { lineHeight: 17 })}>
        {renderHighlightedSegments(item.snippet.segments, t.brandAccent, highlightFg)}
      </Text>
    );
  }
  if (item.subtitle) {
    return (
      <Text numberOfLines={1} style={type(t.textMuted, 11)}>
        {item.subtitle}
      </Text>
    );
  }
  return null;
}

function SearchResultRow({
  item,
  flatIndex,
  isSelected,
  query,
  highlightFg,
  onHover,
  onSelect,
}: {
  item: SearchResultItem;
  flatIndex: number;
  isSelected: boolean;
  query: string;
  highlightFg: string;
  onHover: (index: number) => void;
  onSelect: (item: SearchResultItem) => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View onPointerEnter={() => onHover(flatIndex)} style={ROW_ENVELOPE_STYLE}>
      <Pressable
        testID={`global-search-result-${item.id}`}
        role="button"
        accessibilityLabel={`${item.title} ${item.snippet.text}`}
        accessibilityState={{ selected: isSelected }}
        onPress={() => onSelect(item)}
        style={({ pressed }) => [
          {
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: isSelected || pressed ? t.retroBorder : "transparent",
            backgroundColor: isSelected || pressed ? t.surfaceElevated : "transparent",
            paddingHorizontal: 10,
            paddingVertical: 8,
          },
          isSelected ? ctrlShadow(t, name) : null,
        ]}
      >
        <ResultLeadingIcon item={item} theme={t} name={name} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <ResultRowTitleLine item={item} query={query} highlightFg={highlightFg} />
          <ResultRowBodyLine item={item} highlightFg={highlightFg} />
        </View>
      </Pressable>
    </View>
  );
}

function SearchEmptyState({ isEmptyQuery, query }: { isEmptyQuery: boolean; query: string }) {
  const { palette: t } = useTheme();
  return (
    <View
      testID="global-search-empty"
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: t.retroBorderLight,
        backgroundColor: t.surfaceSecondary,
        paddingHorizontal: 16,
        paddingVertical: 20,
        alignItems: "center",
        gap: 6,
      }}
    >
      <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>
        {isEmptyQuery ? "Nothing here yet" : `No matches for "${query}"`}
      </Text>
      <Text style={type(t.textMuted, 11, { textAlign: "center" })}>
        {isEmptyQuery
          ? "Start typing keywords (separated by spaces for AND matching) to search messages, saved items, assistants, tasks, routines, playbooks, and studios."
          : "Try fewer keywords, check another category filter pill, or search by assistant / conversation name."}
      </Text>
    </View>
  );
}

function SearchFooterBar({ onClose }: { onClose: () => void }) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderTopWidth: 1,
        borderTopColor: t.dividerLine,
        backgroundColor: t.surfaceSecondary,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <Text style={type(t.textMuted, 10, { fontWeight: "600" })}>
        {isWeb ? "↑↓ Navigate · ↵ Open · Esc Close" : "Tap any result to jump"}
      </Text>
      <Pressable
        role="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}
      >
        <CloseIcon color={t.textSecondary} size={12} />
        <Text style={type(t.textSecondary, 11, { fontWeight: "700" })}>Close</Text>
      </Pressable>
    </View>
  );
}

export function GlobalSearchModal(props: GlobalSearchModalProps) {
  const { open, onClose, onOpen, onToggle, onSearchServerMessages } = props;

  const { palette: t } = useTheme();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<SearchFilterCategory>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [serverMessages, setServerMessages] = useState<ChatMessage[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<EditingTextInputHandle | null>(null);

  const handleShortcutToggle = useCallback(() => {
    if (onToggle) {
      onToggle();
      return;
    }
    if (open) {
      onClose();
    } else if (onOpen) {
      onOpen();
    }
  }, [onClose, onOpen, onToggle, open]);

  useGlobalSearchShortcut(handleShortcutToggle, Boolean(open || onOpen || onToggle));

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveCategory("all");
      setSelectedIndex(0);
      setServerMessages([]);
      setServerLoading(false);
      setServerError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !onSearchServerMessages) return undefined;
    const trimmed = query.trim();
    if (trimmed.length < MIN_SERVER_QUERY_LENGTH) {
      setServerMessages([]);
      setServerLoading(false);
      setServerError(null);
      return undefined;
    }
    let active = true;
    setServerLoading(true);
    setServerError(null);
    const timer = setTimeout(() => {
      void onSearchServerMessages(trimmed)
        .then((items) => {
          if (active) {
            setServerMessages(items ?? []);
            setServerLoading(false);
          }
          return null;
        })
        .catch((err: unknown) => {
          if (active) {
            setServerError(err instanceof Error ? err.message : "Deep message search failed");
            setServerLoading(false);
          }
        });
    }, SERVER_SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [onSearchServerMessages, open, query]);

  const snapshot = useMemo(
    () => resolveSnapshotFromProps(props, serverMessages),
    [props, serverMessages],
  );

  const searchOutput = useMemo(
    () => searchPavraState(snapshot, query, { category: activeCategory }),
    [activeCategory, query, snapshot],
  );

  const { sections, flatItems } = useMemo(
    () =>
      buildDisplaySections(
        searchOutput.isEmptyQuery,
        activeCategory,
        searchOutput.results,
        searchOutput.emptySections,
      ),
    [activeCategory, searchOutput.emptySections, searchOutput.isEmptyQuery, searchOutput.results],
  );

  const clampedSelectedIndex =
    flatItems.length === 0 ? 0 : Math.min(selectedIndex, flatItems.length - 1);

  const handleSelectResult = useCallback(
    (item: SearchResultItem | undefined) => {
      if (!item) return;
      dispatchResultNavigation(item, props);
      onClose();
    },
    [onClose, props],
  );

  const modalLayer = useGlobalOverlayLayer("modal", open);

  const handleOverlayKeyDown = useCallback(
    (event: KeyboardInputEvent): boolean => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return true;
      }
      if (event.key === "ArrowDown") {
        if (flatItems.length === 0) return false;
        event.preventDefault();
        setSelectedIndex((current) => {
          const base = Math.min(current, flatItems.length - 1);
          return (base + 1) % flatItems.length;
        });
        return true;
      }
      if (event.key === "ArrowUp") {
        if (flatItems.length === 0) return false;
        event.preventDefault();
        setSelectedIndex((current) => {
          const base = Math.min(current, flatItems.length - 1);
          return (base - 1 + flatItems.length) % flatItems.length;
        });
        return true;
      }
      if (event.key === "Enter") {
        const target = flatItems[clampedSelectedIndex];
        if (!target) return false;
        event.preventDefault();
        handleSelectResult(target);
        return true;
      }
      return false;
    },
    [clampedSelectedIndex, flatItems, handleSelectResult, onClose],
  );

  const setOverlayScope = useOverlayRegistration({
    keys: ["Escape", "Enter", "ArrowUp", "ArrowDown"],
    active: open,
    layer: modalLayer,
    onKeyDown: handleOverlayKeyDown,
  });

  if (!open) return null;

  const highlightFg = t.onAccent;

  return (
    <View testID="global-search-modal" accessibilityViewIsModal style={OVERLAY_CONTAINER_STYLE}>
      <Pressable
        testID="global-search-backdrop"
        accessibilityLabel="Close search"
        onPress={onClose}
        style={BACKDROP_STYLE}
      />
      <View
        ref={setOverlayScope}
        style={[
          {
            width: "100%",
            maxWidth: 640,
            maxHeight: "84%",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfacePrimary,
            overflow: "hidden",
          },
          cardShadow(t),
        ]}
      >
        <SearchHeaderBar
          inputRef={inputRef}
          hasQuery={query.length > 0}
          serverLoading={serverLoading}
          onQueryChange={(next) => {
            setQuery(next);
            setSelectedIndex(0);
          }}
          onClear={() => {
            setQuery("");
            setSelectedIndex(0);
            inputRef.current?.reset();
            inputRef.current?.focus();
          }}
          onSubmit={() => {
            const target = flatItems[clampedSelectedIndex];
            if (target) handleSelectResult(target);
          }}
          onClose={onClose}
        />

        <SearchFilterPillsBar
          activeCategory={activeCategory}
          isEmptyQuery={searchOutput.isEmptyQuery}
          counts={searchOutput.counts}
          onSelectCategory={(cat) => {
            setActiveCategory(cat);
            setSelectedIndex(0);
          }}
        />

        {serverError ? (
          <View
            style={{
              backgroundColor: t.badgeRed,
              borderBottomWidth: 1,
              borderColor: t.destructive,
              paddingHorizontal: 14,
              paddingVertical: 6,
            }}
          >
            <Text role="alert" style={type(t.destructive, 11, { fontWeight: "600" })}>
              {serverError}
            </Text>
          </View>
        ) : null}

        <ScrollView
          testID="global-search-results"
          style={{ maxHeight: 440, backgroundColor: t.surfacePrimary }}
          contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 10, gap: 10 }}
          keyboardShouldPersistTaps="handled"
        >
          {sections.map((section) => (
            <View key={section.key} style={{ gap: 4 }}>
              <Text
                style={type(t.textMuted, 10, {
                  fontWeight: "800",
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  paddingHorizontal: 6,
                  paddingTop: 4,
                  paddingBottom: 2,
                })}
              >
                {section.title}
              </Text>
              {section.items.map(({ item, flatIndex }) => (
                <SearchResultRow
                  key={item.id}
                  item={item}
                  flatIndex={flatIndex}
                  isSelected={flatIndex === clampedSelectedIndex}
                  query={query}
                  highlightFg={highlightFg}
                  onHover={setSelectedIndex}
                  onSelect={handleSelectResult}
                />
              ))}
            </View>
          ))}

          {flatItems.length === 0 ? (
            <SearchEmptyState isEmptyQuery={searchOutput.isEmptyQuery} query={searchOutput.query} />
          ) : null}
        </ScrollView>

        <SearchFooterBar onClose={onClose} />
      </View>
    </View>
  );
}
