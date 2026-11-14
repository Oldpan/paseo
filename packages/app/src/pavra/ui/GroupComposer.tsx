// Group chat chrome for the Composer: quoted-message chip, @-mention suggestions, the roundtable
// toggle and the responder hint. Styled after Bigbang ChannelComposer.
import { Pressable, Text, View } from "react-native";
import { CloseIcon, QuoteIcon } from "./icons";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface GroupComposerState {
  /** One line saying who the draft will wake; null when there is nothing to say. */
  hint: string | null;
  quote: { sender: string; text: string; onRemove(): void } | null;
  mentions: Array<{ id: string; name: string }>;
  onMention(name: string): void;
  /** Null unless the draft can start a roundtable. */
  roundtable: { on: boolean; onToggle(): void } | null;
}

export function QuoteChip({
  sender,
  text,
  onRemove,
}: {
  sender: string;
  text: string;
  onRemove(): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      testID="composer-quote"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
        paddingLeft: 10,
        paddingRight: 4,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderLeftWidth: 3,
        borderColor: t.retroBorder,
        backgroundColor: t.surfacePrimary,
      }}
    >
      <QuoteIcon color={t.textMuted} size={12} />
      <Text numberOfLines={1} style={type(t.textSecondary, 11, { flex: 1, minWidth: 0 })}>
        <Text style={type(t.textPrimary, 11, { fontWeight: "600" })}>{sender}</Text>
        {`  ${text}`}
      </Text>
      <Pressable
        role="button"
        accessibilityLabel="Remove quote"
        onPress={onRemove}
        style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}
      >
        <CloseIcon color={t.textMuted} size={12} />
      </Pressable>
    </View>
  );
}

export function MentionList({
  members,
  onMention,
}: {
  members: Array<{ id: string; name: string }>;
  onMention(name: string): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      testID="mention-suggestions"
      style={{
        marginBottom: 6,
        borderWidth: 1,
        borderColor: t.retroBorder,
        borderRadius: 10,
        backgroundColor: t.surfacePrimary,
        paddingVertical: 4,
      }}
    >
      {members.map((member) => (
        <Pressable
          key={member.id}
          role="button"
          accessibilityLabel={`Mention ${member.name}`}
          onPress={() => onMention(member.name)}
          style={(state) => ({
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: (state as { hovered?: boolean }).hovered
              ? t.brandAccentMuted
              : "transparent",
          })}
        >
          <Text style={type(t.textPrimary, 12)}>{`@${member.name}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function RoundtableToggle({
  on,
  phone,
  onToggle,
}: {
  on: boolean;
  phone: boolean;
  onToggle(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID="composer-roundtable"
      role="button"
      accessibilityLabel={on ? "Reply in parallel instead" : "Discuss in order as a roundtable"}
      accessibilityState={{ selected: on }}
      onPress={onToggle}
      style={(state) => [
        {
          minHeight: phone ? 36 : 28,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: on ? t.badgePink : t.surfaceElevated,
          paddingHorizontal: 12,
          justifyContent: "center",
          transform: [{ translateY: (state as { hovered?: boolean }).hovered ? -1 : 0 }],
        },
        ctrlShadow(t, name),
      ]}
    >
      <Text style={type(on ? t.onPink : t.textSecondary, phone ? 12 : 11, { fontWeight: "600" })}>
        Roundtable
      </Text>
    </Pressable>
  );
}

export function ResponderHint({ hint }: { hint: string }) {
  const { palette: t } = useTheme();
  return (
    <Text testID="composer-responder-hint" style={type(t.textMuted, 10, { marginTop: 4 })}>
      {hint}
    </Text>
  );
}
