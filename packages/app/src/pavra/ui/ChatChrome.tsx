import { isWeb } from "@/constants/platform";
// Presentation extracted/adapted from Bigbang Chat.tsx MessageRow and header.
// Native execution, tool calls and approvals are rendered by Paseo in Studio.
import { useRef, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { AgentAvatar, StatusDot, UserAvatar } from "./avatars";
import {
  ActivityIcon,
  BoxesIcon,
  CheckIcon,
  ChatIcon,
  CopyIcon,
  MenuIcon,
  MoreIcon,
  CloseIcon,
  ArrowLeftIcon,
  QuoteIcon,
  SettingsIcon,
} from "./icons";
import { MessageMarkdown } from "./MessageMarkdown";
import { MessageSwipeReveal } from "./MessageSwipe";
import { copyText } from "./clipboard";
import { formatLiveTurnStatus } from "../live-turn";
import { usePavraApkUpdaterStore } from "../use-pavra-apk-updater";
import { bubbleShadow, ctrlShadow, text as type, selectedFillProps, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export function HeaderIconButton({
  label,
  onPress,
  size = 32,
  children,
}: {
  label: string;
  onPress(): void;
  size?: number;
  children: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            width: size,
            height: size,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: hovered ? t.surfaceHover : t.surfaceElevated,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ translateY: hovered ? -1 : 0 }],
            ...webTransition("transform 120ms ease, background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      {children}
    </Pressable>
  );
}

export function StudioButton({ label, onPress }: { label: string; onPress(): void }) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            height: 32,
            paddingHorizontal: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: hovered ? t.surfaceHover : t.surfaceElevated,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            transform: [{ translateY: hovered ? -1 : 0 }],
            ...webTransition("transform 120ms ease, background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <BoxesIcon color={t.textSecondary} size={13} />
      <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Studio</Text>
    </Pressable>
  );
}

export function ChatHeader({
  label,
  seed,
  group,
  subtitle,
  connected,
  tab,
  onTab,
  onSidebar,
  onEdit,
  onOpenStudio,
}: {
  label: string;
  seed: string;
  group: boolean;
  subtitle?: string;
  connected: boolean;
  tab: string;
  onTab(value: string): void;
  onSidebar?: () => void;
  onEdit?: () => void;
  onOpenStudio?: () => void;
}) {
  const { palette: t, name } = useTheme();
  const hasApkUpdate = usePavraApkUpdaterStore((state) => Boolean(state.availableRelease));
  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "task", label: "Task" },
    { id: "routines", label: "Routines" },
    ...(!group
      ? [
          { id: "memory", label: "Memory" },
          { id: "playbooks", label: "Playbooks" },
        ]
      : []),
  ];
  return (
    <View
      style={{
        minHeight: 56,
        backgroundColor: t.surfacePrimary,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderBottomWidth: 2,
        borderBottomColor: t.black,
        justifyContent: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          columnGap: 12,
          rowGap: 8,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            flex: 1,
            minWidth: 160,
          }}
        >
          {onSidebar ? (
            <View style={{ position: "relative" }}>
              <HeaderIconButton label="Open sidebar" onPress={onSidebar} size={34}>
                <MenuIcon color={t.textSecondary} size={16} />
              </HeaderIconButton>
              {hasApkUpdate ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: t.brandAccent,
                    borderWidth: 1.5,
                    borderColor: t.surfacePrimary,
                  }}
                />
              ) : null}
            </View>
          ) : null}
          <View style={{ position: "relative" }}>
            <AgentAvatar seed={seed} label={label} size={34} theme={t} name={name} />
            <View style={{ position: "absolute", right: -2, bottom: -2 }}>
              <StatusDot color={connected ? t.success : t.destructive} border={t.surfacePrimary} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              role="heading"
              numberOfLines={1}
              style={type(t.textPrimary, 14, { fontWeight: "700" })}
            >
              {label}
            </Text>
            <Text
              numberOfLines={1}
              style={
                subtitle
                  ? type(t.textSecondary, 11, { marginTop: 1 })
                  : type(t.textMuted, 10, {
                      letterSpacing: 1.4,
                      textTransform: "uppercase",
                      marginTop: 2,
                    })
              }
            >
              {subtitle ?? (group ? "Group chat" : "Private chat")}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {tabs.map((item) => {
            const selected = tab === item.id;
            return (
              <Pressable
                key={item.id}
                role="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => onTab(item.id)}
                {...selectedFillProps(selected)}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  return [
                    {
                      height: 32,
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
                      paddingHorizontal: 12,
                      justifyContent: "center",
                      transform: [{ translateY: hovered ? -1 : 0 }],
                      ...webTransition("transform 120ms ease, background-color 120ms ease"),
                    },
                    ctrlShadow(t, name),
                  ];
                }}
              >
                <Text
                  style={type(selected ? t.onAccent : t.textSecondary, 12, {
                    fontWeight: "600",
                  })}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
          {onOpenStudio || onEdit ? (
            <View
              style={{
                width: 1,
                height: 18,
                backgroundColor: t.dividerLine,
                marginHorizontal: 2,
              }}
            />
          ) : null}
          {onOpenStudio ? <StudioButton label="Open in Studio" onPress={onOpenStudio} /> : null}
          {onEdit ? (
            <HeaderIconButton label={`Edit ${label}`} onPress={onEdit} size={32}>
              <SettingsIcon color={t.textSecondary} size={15} />
            </HeaderIconButton>
          ) : null}
        </View>
      </View>
    </View>
  );
}
export function Chip({
  children,
  onPress,
  label,
  disabled = false,
  accent = false,
}: {
  children: ReactNode;
  onPress(): void;
  label?: string;
  disabled?: boolean;
  accent?: boolean;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          minHeight: 26,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: accent ? t.brandAccent : t.surfaceElevated,
          paddingHorizontal: 10,
          justifyContent: "center",
          opacity: disabled ? 0.45 : 1,
        },
        ctrlShadow(t, name),
      ]}
    >
      <Text style={type(accent ? t.onAccent : t.textSecondary, 11, { fontWeight: "600" })}>
        {children}
      </Text>
    </Pressable>
  );
}
export function ProcessIconButton({
  onPress,
  label = "View process",
}: {
  onPress(): void;
  label?: string;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            width: 26,
            height: 24,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: hovered ? t.surfaceHover : t.surfaceElevated,
            alignItems: "center",
            justifyContent: "center",
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <ActivityIcon color={t.textSecondary} size={13} />
    </Pressable>
  );
}

function SideActionIcon({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress(): void;
  children(color: string): ReactNode;
}) {
  const { palette: t } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return {
          width: 26,
          height: 26,
          borderRadius: 6,
          backgroundColor: hovered ? t.surfaceHover : "transparent",
          alignItems: "center",
          justifyContent: "center",
          ...webTransition("background-color 120ms ease, opacity 120ms ease"),
        };
      }}
    >
      {(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return children(hovered ? t.textPrimary : t.textMuted);
      }}
    </Pressable>
  );
}

function MessageSideActions({
  visible,
  copied,
  content,
  user,
  onCopied,
  onQuote,
  onReply,
  onOpenProcess,
  onToggleMenu,
}: {
  visible: boolean;
  copied: boolean;
  content: string;
  user: boolean;
  onCopied(copied: boolean): void;
  onQuote?: () => void;
  onReply?: () => void;
  onOpenProcess?: () => void;
  onToggleMenu(): void;
}) {
  const { palette: t } = useTheme();
  if (!isWeb) return null;
  return (
    <View
      testID="message-side-actions"
      pointerEvents={visible ? "auto" : "none"}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        opacity: visible ? 1 : 0,
        flexShrink: 0,
        ...webTransition("opacity 140ms ease"),
      }}
    >
      <SideActionIcon
        label={copied ? "Copied" : "Copy message"}
        onPress={() => {
          void copyText(content).then((status) => {
            return onCopied(status === "copied");
          });
        }}
      >
        {(color) =>
          copied ? <CheckIcon color={t.success} size={14} /> : <CopyIcon color={color} size={14} />
        }
      </SideActionIcon>
      {onReply ? (
        <SideActionIcon label="Reply in thread" onPress={onReply}>
          {(color) => <ChatIcon color={color} size={14} />}
        </SideActionIcon>
      ) : null}
      {onQuote ? (
        <SideActionIcon label="Quote message" onPress={onQuote}>
          {(color) => <QuoteIcon color={color} size={14} />}
        </SideActionIcon>
      ) : null}
      {!user && onOpenProcess ? (
        <SideActionIcon label="View process" onPress={onOpenProcess}>
          {(color) => <ActivityIcon color={color} size={14} />}
        </SideActionIcon>
      ) : null}
      <SideActionIcon label="More actions" onPress={onToggleMenu}>
        {(color) => <MoreIcon color={color} size={14} />}
      </SideActionIcon>
    </View>
  );
}

function MessageContextMenu({
  id,
  user,
  copied,
  content,
  onCopied,
  onQuote,
  onReply,
  onOpenProcess,
  onClose,
}: {
  id: string;
  user: boolean;
  copied: boolean;
  content: string;
  onCopied(copied: boolean): void;
  onQuote?: () => void;
  onReply?: () => void;
  onOpenProcess?: () => void;
  onClose(): void;
}) {
  const { palette: t, name } = useTheme();
  const itemStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  };
  return (
    <View
      testID={`message-context-menu-${id}`}
      role="menu"
      style={[
        {
          marginTop: 6,
          minWidth: 168,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceElevated,
          padding: 4,
          gap: 2,
          alignSelf: user ? "flex-end" : "flex-start",
          zIndex: 30,
        },
        ctrlShadow(t, name),
      ]}
    >
      <Pressable
        role="menuitem"
        accessibilityLabel={copied ? "Copied" : "Copy message"}
        onPress={() => {
          void copyText(content).then((status) => {
            onCopied(status === "copied");
            return onClose();
          });
        }}
        style={itemStyle}
      >
        {copied ? (
          <CheckIcon color={t.success} size={14} />
        ) : (
          <CopyIcon color={t.textSecondary} size={14} />
        )}
        <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>
          {copied ? "Copied" : "Copy message"}
        </Text>
      </Pressable>
      {onReply ? (
        <Pressable
          role="menuitem"
          accessibilityLabel="Reply in thread"
          onPress={() => {
            onClose();
            onReply();
          }}
          style={itemStyle}
        >
          <ChatIcon color={t.textSecondary} size={14} />
          <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>Reply in thread</Text>
        </Pressable>
      ) : null}
      {onQuote ? (
        <Pressable
          role="menuitem"
          accessibilityLabel="Quote message"
          onPress={() => {
            onClose();
            onQuote();
          }}
          style={itemStyle}
        >
          <QuoteIcon color={t.textSecondary} size={14} />
          <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>Quote message</Text>
        </Pressable>
      ) : null}
      {!user && onOpenProcess ? (
        <Pressable
          role="menuitem"
          accessibilityLabel="View process"
          onPress={() => {
            onClose();
            onOpenProcess();
          }}
          style={itemStyle}
        >
          <ActivityIcon color={t.textSecondary} size={14} />
          <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>View process</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MessageFooterChips({ replyCount, onReply }: { replyCount: number; onReply?: () => void }) {
  if (!onReply || replyCount <= 0) return null;
  return (
    <View
      style={{
        marginTop: 6,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Chip onPress={onReply} label="Open thread">
        {replyCount} {replyCount === 1 ? "reply" : "replies"}
      </Chip>
    </View>
  );
}

export function ChatMessage({
  id,
  content,
  sender,
  seed,
  user,
  createdAt,
  replyCount,
  onReply,
  onQuote,
  onOpenProcess,
  quote,
  routineBadge,
  children,
}: {
  id: string;
  content: string;
  sender: string;
  seed: string;
  user: boolean;
  createdAt: number;
  replyCount: number;
  onReply?: () => void;
  /** Quotes this message in the composer. Group chats offer it on assistant replies. */
  onQuote?: () => void;
  /** Opens the process drawer for the turn that produced this assistant message. */
  onOpenProcess?: () => void;
  /** The message this one answers, shown as a compact block above its text. */
  quote?: { sender: string; text: string };
  /** Compact routine origin badge (e.g. `Routine · 早间汇总`). */
  routineBadge?: string;
  children?: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showChrome = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setHovered(true);
  };
  const hideChrome = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(false), 350);
  };
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const alignment = user ? "flex-end" : "flex-start";
  const avatar = user ? (
    <UserAvatar label="You" size={32} theme={t} name={name} />
  ) : (
    <AgentAvatar seed={seed} label={sender} size={32} theme={t} name={name} />
  );
  const webContextMenuProps = isWeb
    ? ({
        onContextMenu: (event: { preventDefault?: () => void }) => {
          event.preventDefault?.();
          setMenuOpen((prev) => !prev);
        },
      } as Record<string, unknown>)
    : undefined;
  const sideActions = (
    <MessageSideActions
      visible={hovered || menuOpen}
      copied={copied}
      content={content}
      user={user}
      onCopied={setCopied}
      onQuote={onQuote}
      onReply={onReply}
      onOpenProcess={onOpenProcess}
      onToggleMenu={() => setMenuOpen((prev) => !prev)}
    />
  );
  return (
    <MessageSwipeReveal createdAt={createdAt} side={user ? "start" : "end"}>
      <View
        testID={`message-${id}`}
        onPointerEnter={showChrome}
        onPointerLeave={hideChrome}
        style={{
          position: "relative",
          flexDirection: "row",
          justifyContent: alignment,
          alignItems: "flex-start",
          gap: 10,
          paddingHorizontal: 4,
          paddingVertical: 6,
          maxWidth: "100%",
        }}
      >
        {!user ? avatar : null}
        <View
          style={{
            flex: 1,
            minWidth: 0,
            maxWidth: "100%",
            alignItems: alignment,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: alignment,
              gap: 6,
              marginBottom: 4,
              width: "100%",
            }}
          >
            <Text style={type(t.textPrimary, 15, { fontWeight: "600", flexShrink: 1 })}>
              {sender}
            </Text>
            {routineBadge ? (
              <View
                testID={`routine-badge-${id}`}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.surfaceElevated,
                  paddingHorizontal: 7,
                  paddingVertical: 1,
                }}
              >
                <Text style={type(t.textSecondary, 10, { fontWeight: "600" })}>{routineBadge}</Text>
              </View>
            ) : null}
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: alignment,
              gap: 6,
              maxWidth: "100%",
            }}
          >
            {user ? sideActions : null}
            <Pressable
              accessibilityLabel={`Message from ${sender}`}
              onPress={
                !isWeb || menuOpen
                  ? () => {
                      setMenuOpen((prev) => !prev);
                    }
                  : undefined
              }
              onLongPress={
                isWeb
                  ? undefined
                  : () => {
                      setMenuOpen(true);
                    }
              }
              delayLongPress={isWeb ? undefined : 280}
              {...webContextMenuProps}
              style={{ position: "relative", flexShrink: 1, maxWidth: "100%" }}
            >
              <View
                style={[
                  {
                    maxWidth: "100%",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: user ? t.msgBubbleHighlight : t.msgBubble,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  },
                  bubbleShadow(t, name),
                ]}
              >
                <MessageBody id={id} content={content} user={user} quote={quote} />
              </View>
            </Pressable>
            {!user ? sideActions : null}
          </View>
          {menuOpen ? (
            <MessageContextMenu
              id={id}
              user={user}
              copied={copied}
              content={content}
              onCopied={setCopied}
              onQuote={onQuote}
              onReply={onReply}
              onOpenProcess={onOpenProcess}
              onClose={() => setMenuOpen(false)}
            />
          ) : null}
          {children}
          <MessageFooterChips replyCount={replyCount} onReply={onReply} />
        </View>
        {user ? avatar : null}
      </View>
    </MessageSwipeReveal>
  );
}
/** The message a reply answers: sender and a short excerpt, set off by a rule on the left. */
function MessageBody({
  id,
  content,
  user,
  quote,
}: {
  id: string;
  content: string;
  user: boolean;
  quote?: { sender: string; text: string };
}) {
  const { palette: t } = useTheme();
  return (
    <>
      {quote ? <QuoteBlock id={id} quote={quote} user={user} /> : null}
      {user ? (
        <Text selectable style={type(t.userBubbleInk, 14, { lineHeight: 20 })}>
          {content}
        </Text>
      ) : (
        <MessageMarkdown content={content} color={t.textPrimary} narrow={false} />
      )}
    </>
  );
}
function QuoteBlock({
  id,
  quote,
  user,
}: {
  id: string;
  quote: { sender: string; text: string };
  user: boolean;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      testID={`quote-${id}`}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: t.retroBorder,
        paddingLeft: 8,
        marginBottom: 6,
        gap: 1,
      }}
    >
      <Text style={type(user ? t.userBubbleInk : t.textMuted, 11, { fontWeight: "600" })}>
        {quote.sender}
      </Text>
      <Text
        numberOfLines={2}
        style={type(user ? t.userBubbleInk : t.textSecondary, 11, { opacity: 0.8 })}
      >
        {quote.text}
      </Text>
    </View>
  );
}
/** A ledger note (system or task_event row): compact, centred, no avatar. */
export function NoteRow({ id, content }: { id: string; content: string }) {
  const { palette: t } = useTheme();
  return (
    <View
      testID={`message-${id}`}
      style={{ alignItems: "center", paddingHorizontal: 24, paddingVertical: 6 }}
    >
      <Text selectable style={type(t.textMuted, 11, { textAlign: "center" })}>
        {content}
      </Text>
    </View>
  );
}
/**
 * The reply an assistant is still writing. Renders like a committed message once text arrives and
 * as a single status line before that; full process steps stay folded inside the Process Drawer.
 */
export function LiveTurnBubble({
  id,
  sender,
  seed,
  text,
  commentary,
  activity,
  statusLabel,
  createdAt,
  onOpenProcess,
  children,
}: {
  id: string;
  sender: string;
  seed: string;
  text: string;
  commentary: string;
  activity: string | null;
  statusLabel: string;
  createdAt: number;
  onOpenProcess?: () => void;
  children?: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  const statusText = (
    <Text numberOfLines={1} style={type(t.textMuted, 11, { marginTop: 6 })}>
      {formatLiveTurnStatus({ sender, activity, commentary, statusLabel })}
    </Text>
  );
  const status = onOpenProcess ? (
    <Pressable role="button" accessibilityLabel="View process" onPress={onOpenProcess}>
      {statusText}
    </Pressable>
  ) : (
    statusText
  );
  if (text)
    return (
      <ChatMessage
        id={id}
        content={text}
        sender={sender}
        seed={seed}
        user={false}
        createdAt={createdAt}
        replyCount={0}
        onOpenProcess={onOpenProcess}
      >
        {status}
        {children}
      </ChatMessage>
    );
  return (
    <View
      testID={`message-${id}`}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingHorizontal: 4,
        paddingVertical: 6,
      }}
    >
      <AgentAvatar seed={seed} label={sender} size={32} theme={t} name={name} />
      <View style={{ flex: 1, minWidth: 0, alignItems: "flex-start" }}>
        {status}
        {children}
      </View>
    </View>
  );
}
export function ThreadHeader({
  onClose,
  compact,
  title = "Thread",
  subtitle,
  onOpenStudio,
}: {
  onClose(): void;
  compact: boolean;
  title?: string;
  subtitle?: string;
  onOpenStudio?: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        minHeight: 56,
        paddingHorizontal: 14,
        paddingVertical: 9,
        backgroundColor: t.surfacePrimary,
        borderBottomWidth: 2,
        borderBottomColor: t.black,
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
      }}
    >
      {compact ? (
        <HeaderIconButton label="Back to chat" onPress={onClose} size={32}>
          <ArrowLeftIcon color={t.textPrimary} size={15} />
        </HeaderIconButton>
      ) : (
        <View
          style={[
            {
              width: 32,
              height: 32,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              alignItems: "center",
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <ChatIcon color={t.brandAccent} size={15} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={type(t.textPrimary, 14, { fontWeight: "700" })}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={type(t.textSecondary, 11, { marginTop: 1 })}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onOpenStudio ? <StudioButton label="Open thread in Studio" onPress={onOpenStudio} /> : null}
      <HeaderIconButton label="Close thread" onPress={onClose} size={32}>
        <CloseIcon color={t.textPrimary} size={15} />
      </HeaderIconButton>
    </View>
  );
}
