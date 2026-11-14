import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
// Presentation extracted/adapted from Bigbang Chat.tsx MessageRow and header.
// Native execution, tool calls and approvals are rendered by Paseo in Studio.
import { useRef, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { AgentAvatar, StatusDot, UserAvatar } from "./avatars";
import {
  BoxesIcon,
  CheckIcon,
  ChatIcon,
  CopyIcon,
  MenuIcon,
  CloseIcon,
  ArrowLeftIcon,
  QuoteIcon,
  SettingsIcon,
} from "./icons";
import { MessageMarkdown } from "./MessageMarkdown";
import { copyText } from "./clipboard";
import { bubbleShadow, ctrlShadow, text as type, selectedFillProps, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

function HeaderIconButton({
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

function StudioButton({ label, onPress }: { label: string; onPress(): void }) {
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
  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "task", label: "Task" },
    ...(!group ? [{ id: "memory", label: "Memory" }] : []),
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
            <HeaderIconButton label="Open sidebar" onPress={onSidebar} size={34}>
              <MenuIcon color={t.textSecondary} size={16} />
            </HeaderIconButton>
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
  quote,
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
  /** The message this one answers, shown as a compact block above its text. */
  quote?: { sender: string; text: string };
  children?: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  const compact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showChrome = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setHovered(true);
  };
  const hideChrome = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(false), 500);
  };
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  // Hover only exists on web with a pointer; touch layouts keep the actions in reach.
  const actionsShown = hovered || !isWeb || compact;
  const avatar = user ? (
    <UserAvatar label="You" size={32} theme={t} name={name} />
  ) : (
    <AgentAvatar seed={seed} label={sender} size={32} theme={t} name={name} />
  );
  return (
    <View
      testID={`message-${id}`}
      style={{
        position: "relative",
        flexDirection: "row",
        justifyContent: user ? "flex-end" : "flex-start",
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
          alignItems: user ? "flex-end" : "flex-start",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: user ? "flex-end" : "flex-start",
            gap: 6,
            marginBottom: 4,
            width: "100%",
          }}
        >
          <Text style={type(t.textPrimary, 15, { fontWeight: "600", flexShrink: 1 })}>
            {sender}
          </Text>
          <Text style={type(t.textSubtle, 10)}>
            {new Date(createdAt).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
        <View
          onPointerEnter={showChrome}
          onPointerLeave={hideChrome}
          accessibilityLabel={`Message from ${sender}`}
          style={{ position: "relative", maxWidth: "100%" }}
        >
          <View
            pointerEvents={actionsShown ? "auto" : "none"}
            style={[
              {
                position: "absolute",
                bottom: "100%",
                marginBottom: 6,
                right: 0,
                zIndex: 20,
                flexDirection: "row",
                gap: 2,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.surfaceSecondary,
                padding: 2,
                opacity: actionsShown ? 1 : 0,
              },
              ctrlShadow(t, name),
            ]}
          >
            <Pressable
              role="button"
              accessibilityLabel={copied ? "Copied" : "Copy message"}
              onPress={() => {
                void copyText(content).then((status) => {
                  return setCopied(status === "copied");
                });
              }}
              style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
            >
              {copied ? <CheckIcon color={t.success} /> : <CopyIcon color={t.textSecondary} />}
            </Pressable>
            {onQuote ? (
              <Pressable
                role="button"
                accessibilityLabel="Quote message"
                onPress={onQuote}
                style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
              >
                <QuoteIcon color={t.textSecondary} size={14} />
              </Pressable>
            ) : null}
            {onReply ? (
              <Pressable
                role="button"
                accessibilityLabel="Reply in thread"
                onPress={onReply}
                style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
              >
                <ChatIcon color={t.textSecondary} size={14} />
              </Pressable>
            ) : null}
          </View>
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
        </View>
        {children}
        {onReply && replyCount > 0 ? (
          <View style={{ marginTop: 6 }}>
            <Chip onPress={onReply} label="Open thread">
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </Chip>
          </View>
        ) : null}
      </View>
      {user ? avatar : null}
    </View>
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
 * as a status line before that. `children` carry the process chip and any inline approvals.
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
  children?: ReactNode;
}) {
  const { palette: t, name } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const status = (
    <Text numberOfLines={1} style={type(t.textMuted, 11, { marginTop: 6 })}>
      {activity ? `${sender} · ${activity}…` : `${sender} · ${statusLabel}`}
    </Text>
  );
  const notes = (
    <>
      {commentary ? (
        <Pressable
          role="button"
          accessibilityLabel={expanded ? "Collapse process notes" : "Expand process notes"}
          onPress={() => setExpanded((current) => !current)}
          style={{ marginTop: 6, maxWidth: "100%" }}
        >
          <Text numberOfLines={expanded ? undefined : 1} style={type(t.textMuted, 11)}>
            {expanded ? `▾ ${commentary}` : `▸ ${commentary}`}
          </Text>
        </Pressable>
      ) : null}
      {text && activity ? status : null}
      {children}
    </>
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
      >
        {notes}
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
        {notes}
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
