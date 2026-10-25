import { Pressable, Text, View } from "react-native";
import { ChevronIcon, FolderIcon } from "./icons";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";
export function ResourceChoice({
  label,
  onPress,
  detail,
}: {
  label: string;
  detail?: string;
  onPress(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          gap: 10,
          alignItems: "center",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: pressed ? t.surfaceHover : t.surfacePrimary,
          padding: 12,
          marginVertical: 3,
        },
        ctrlShadow(t, name),
      ]}
    >
      <FolderIcon color={t.textMuted} size={18} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={type(t.textPrimary, 12, { fontWeight: "600" })}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={type(t.textMuted, 10)}>
            {detail}
          </Text>
        ) : null}
      </View>
      <ChevronIcon color={t.textMuted} size={14} />
    </Pressable>
  );
}
