// Open peer requests from this chat lane, in the task-event row style of ChatPane.
import { Text, View } from "react-native";
import type { OpenExchange } from "../peer-activity";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export function PeerActivity({ items }: { items: OpenExchange[] }) {
  const { palette: t } = useTheme();
  if (items.length === 0) return null;
  return (
    <View
      accessibilityLabel="Peer requests in progress"
      style={{ marginHorizontal: 16, marginVertical: 6, gap: 6 }}
    >
      {items.map((item) => (
        <View
          key={item.id}
          style={{
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceHover,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            gap: 2,
          }}
        >
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={type(t.textSecondary, 11, { fontWeight: "700", flexShrink: 1 })}>
              {item.route}
            </Text>
            <Text style={type(t.brandAccent, 11, { fontWeight: "600" })}>{item.state}</Text>
          </View>
          <Text numberOfLines={2} style={type(t.textMuted, 12)}>
            {item.text}
          </Text>
        </View>
      ))}
    </View>
  );
}
