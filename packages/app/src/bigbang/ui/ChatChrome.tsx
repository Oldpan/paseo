import { isWeb } from "@/constants/platform";
// Presentation extracted/adapted from Bigbang Chat.tsx MessageRow and header.
// Native execution, tool calls and approvals are rendered by Paseo in Studio.
import { useRef, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { AgentAvatar, StatusDot, UserAvatar } from "./avatars";
import { CheckIcon, ChatIcon, CopyIcon, MenuIcon, CloseIcon, ArrowLeftIcon } from "./icons";
import { MessageMarkdown } from "./MessageMarkdown";
import { copyText } from "./clipboard";
import { bubbleShadow, ctrlShadow, text as type, selectedFillProps } from "./theme";
import { useTheme } from "./ThemeProvider";

export function ChatHeader({
  label,
  seed,
  group,
  connected,
  tab,
  onTab,
  onSidebar,
  onEdit,
}: {
  label: string;
  seed: string;
  group: boolean;
  connected: boolean;
  tab: string;
  onTab(value: string): void;
  onSidebar?: () => void;
  onEdit?: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surfacePrimary,
        paddingHorizontal: 16,
        paddingTop: 6,
        paddingBottom: 4,
        borderBottomWidth: 2,
        borderBottomColor: t.black,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {onSidebar ? (
          <Pressable
            role="button"
            accessibilityLabel="Open sidebar"
            onPress={onSidebar}
            style={[
              {
                width: 36,
                height: 36,
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
            <MenuIcon color={t.textSecondary} size={16} />
          </Pressable>
        ) : null}
        <Pressable
          role="button"
          accessibilityLabel={`Edit ${label}`}
          onPress={onEdit}
          disabled={!onEdit}
        >
          <View style={{ position: "relative" }}>
            <AgentAvatar seed={seed} label={label} size={36} theme={t} name={name} />
            <View style={{ position: "absolute", right: -2, bottom: -2 }}>
              <StatusDot color={connected ? t.success : t.destructive} border={t.surfacePrimary} />
            </View>
          </View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            role="heading"
            numberOfLines={1}
            style={type(t.textPrimary, 14, { fontWeight: "600" })}
          >
            {label}
          </Text>
          <Text
            style={type(t.textMuted, 11, {
              letterSpacing: 1.6,
              textTransform: "uppercase",
              marginTop: 4,
            })}
          >
            {group ? "Group chat" : "Private chat"}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {[
          { id: "chat", label: "Chat" },
          { id: "task", label: "Task" },
          ...(!group ? [{ id: "memory", label: "Memory" }] : []),
        ].map((item) => (
          <Pressable
            key={item.id}
            role="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: tab === item.id }}
            onPress={() => onTab(item.id)}
            {...selectedFillProps(tab === item.id)}
            style={[
              {
                height: 32,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: tab === item.id ? t.brandAccent : t.surfaceElevated,
                paddingHorizontal: 12,
                justifyContent: "center",
              },
              ctrlShadow(t, name),
            ]}
          >
            <Text
              style={type(tab === item.id ? t.onAccent : t.textSecondary, 12, {
                fontWeight: "600",
              })}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
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
  children?: ReactNode;
}) {
  const { palette: t, name } = useTheme();
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
        <Pressable
          onHoverIn={showChrome}
          onHoverOut={hideChrome}
          accessibilityLabel={`Message from ${sender}`}
          style={{ position: "relative", maxWidth: "100%" }}
        >
          <View
            pointerEvents={hovered || !isWeb ? "auto" : "none"}
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
                opacity: hovered || !isWeb ? 1 : 0,
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
            {user ? (
              <Text selectable style={type(t.userBubbleInk, 14, { lineHeight: 20 })}>
                {content}
              </Text>
            ) : (
              <MessageMarkdown content={content} color={t.textPrimary} narrow={false} />
            )}
          </View>
        </Pressable>
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
export function ThreadHeader({ onClose, compact }: { onClose(): void; compact: boolean }) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        height: 45,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: t.retroBorder,
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
      }}
    >
      {compact ? <ArrowLeftIcon color={t.textMuted} /> : null}
      <Text style={type(t.textPrimary, 13, { fontWeight: "700", flex: 1 })}>Thread</Text>
      <Pressable role="button" accessibilityLabel="Close thread" onPress={onClose}>
        <CloseIcon color={t.textSecondary} size={16} />
      </Pressable>
    </View>
  );
}
