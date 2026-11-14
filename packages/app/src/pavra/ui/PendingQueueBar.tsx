import { Pressable, Text, View } from "react-native";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface PendingQueueItem {
  id: string;
  content: string;
  quoteOf?: string;
  responseMode?: "roundtable";
}

export function PendingQueueBar({
  items,
  busy = false,
  onSteer,
  onRemove,
}: {
  items: readonly PendingQueueItem[];
  busy?: boolean;
  onSteer(id: string): void;
  onRemove(id: string): void;
}) {
  const { palette: t, name } = useTheme();
  if (items.length === 0) return null;
  return (
    <View
      testID="pending-queue-bar"
      accessibilityLabel="Queued messages"
      style={{
        backgroundColor: t.surfaceSecondary,
        borderTopWidth: 1,
        borderTopColor: t.retroBorder,
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 6,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          style={type(t.textMuted, 10, {
            fontWeight: "700",
            letterSpacing: 1.1,
            textTransform: "uppercase",
          })}
        >
          {`Queued (${items.length}) · sends when reply finishes`}
        </Text>
      </View>
      {items.map((item) => (
        <View
          key={item.id}
          testID={`pending-queue-item-${item.id}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfacePrimary,
          }}
        >
          <Text numberOfLines={2} style={type(t.textPrimary, 12, { flex: 1, minWidth: 0 })}>
            {item.content}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Pressable
              testID={`pending-queue-steer-${item.id}`}
              role="button"
              accessibilityLabel="Steer"
              disabled={busy}
              onPress={() => onSteer(item.id)}
              style={(state) => {
                const hovered = Boolean((state as { hovered?: boolean }).hovered);
                return [
                  {
                    minHeight: 26,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: hovered && !busy ? t.brandAccentHover : t.brandAccent,
                    paddingHorizontal: 10,
                    justifyContent: "center",
                    opacity: busy ? 0.45 : 1,
                    transform: [{ translateY: hovered && !busy ? -1 : 0 }],
                    ...webTransition("transform 100ms ease, background-color 100ms ease"),
                  },
                  ctrlShadow(t, name),
                ];
              }}
            >
              <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Steer</Text>
            </Pressable>
            <Pressable
              testID={`pending-queue-remove-${item.id}`}
              role="button"
              accessibilityLabel="Remove"
              disabled={busy}
              onPress={() => onRemove(item.id)}
              style={(state) => {
                const hovered = Boolean((state as { hovered?: boolean }).hovered);
                return [
                  {
                    minHeight: 26,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: hovered && !busy ? t.surfaceHover : t.surfaceElevated,
                    paddingHorizontal: 10,
                    justifyContent: "center",
                    opacity: busy ? 0.45 : 1,
                    transform: [{ translateY: hovered && !busy ? -1 : 0 }],
                    ...webTransition("transform 100ms ease, background-color 100ms ease"),
                  },
                  ctrlShadow(t, name),
                ];
              }}
            >
              <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
