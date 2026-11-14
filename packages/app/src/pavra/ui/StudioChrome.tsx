// Workspace tab chrome adapted from Bigbang StudioNamedTabBar.tsx and StudioShell.tsx.
import { Pressable, ScrollView, Text, View } from "react-native";
import type { StudioColumn } from "../model";
import { studioKey } from "../model";
import { CloseIcon, MenuIcon, PlusIcon, BoxesIcon } from "./icons";
import { Chip } from "./ChatChrome";
import { text as type, ctrlShadow } from "./theme";
import { useTheme } from "./ThemeProvider";
export function StudioBar({
  columns,
  active,
  onFocus,
  onClose,
  onAdd,
  onSidebar,
  onCollaborate,
}: {
  columns: StudioColumn[];
  active: string | null;
  onFocus(key: string): void;
  onClose(key: string): void;
  onAdd(): void;
  onSidebar?(): void;
  /** Opens the collaboration panel for the active tab group (Paseo addition). */
  onCollaborate?(): void;
}) {
  const { palette: t, name } = useTheme();
  const groups = [...new Set(columns.map((column) => column.group))];
  return (
    <View
      style={{
        backgroundColor: t.surfacePrimary,
        borderBottomWidth: 2,
        borderBottomColor: t.black,
      }}
    >
      <View
        style={{
          height: 44,
          paddingHorizontal: 12,
          flexDirection: "row",
          gap: 10,
          alignItems: "center",
        }}
      >
        {onSidebar ? (
          <Pressable role="button" accessibilityLabel="Open sidebar" onPress={onSidebar}>
            <MenuIcon color={t.textSecondary} size={18} />
          </Pressable>
        ) : null}
        <BoxesIcon color={t.brandAccent} size={18} />
        <Text style={type(t.textPrimary, 14, { fontWeight: "700", flex: 1 })}>Studio</Text>
        {onCollaborate ? <Chip onPress={onCollaborate}>Collaboration</Chip> : null}
        <Chip onPress={onAdd}>Add workspace</Chip>
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          gap: 8,
          alignItems: "center",
        }}
      >
        {groups.map((group) => (
          <View key={group} style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            <View
              style={{
                height: 28,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.retroBorderLight,
                backgroundColor: t.surfaceHover,
                paddingHorizontal: 8,
                justifyContent: "center",
              }}
            >
              <Text style={type(t.textSecondary, 11, { fontWeight: "700" })}>{group}</Text>
            </View>
            {columns
              .filter((column) => column.group === group)
              .map((column) => {
                const key = studioKey(column),
                  selected = key === active;
                return (
                  <View
                    key={key}
                    testID="studio-tab-item"
                    style={{
                      position: "relative",
                      flexDirection: "row",
                      alignItems: "center",
                      height: 28,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: selected ? t.retroBorderLight : "transparent",
                      backgroundColor: selected ? t.surfaceElevated : "transparent",
                      paddingHorizontal: 8,
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <Pressable
                      role="button"
                      accessibilityLabel={column.name}
                      accessibilityState={{ selected }}
                      onPress={() => onFocus(key)}
                      style={{ maxWidth: 224 }}
                    >
                      <Text
                        numberOfLines={1}
                        style={type(selected ? t.brandAccent : t.textSecondary, 11, {
                          fontWeight: "600",
                        })}
                      >
                        {column.name}
                      </Text>
                    </Pressable>
                    <Pressable
                      role="button"
                      accessibilityLabel={`Close workspace view ${column.name}`}
                      onPress={() => onClose(key)}
                      style={{
                        width: 16,
                        height: 16,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <CloseIcon color={t.textMuted} size={12} />
                    </Pressable>
                  </View>
                );
              })}
          </View>
        ))}
        <Pressable
          role="button"
          accessibilityLabel="Add workspace"
          onPress={onAdd}
          style={[
            {
              height: 26,
              width: 26,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              alignItems: "center",
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <PlusIcon color={t.textSecondary} size={14} />
        </Pressable>
      </ScrollView>
    </View>
  );
}
export function WorkspaceChrome({
  label,
  connected,
  selected,
  onFocus,
  children,
}: {
  label: string;
  connected: boolean;
  selected: boolean;
  onFocus(): void;
  children: React.ReactNode;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onStartShouldSetResponderCapture={() => {
        onFocus();
        return false;
      }}
    >
      <View
        style={{
          height: 34,
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderBottomColor: t.retroBorderLight,
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
          backgroundColor: t.surfaceSecondary,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: connected ? t.success : t.destructive,
          }}
        />
        <Pressable
          role="button"
          accessibilityLabel={`Focus ${label}`}
          onPress={onFocus}
          style={{ flex: 1 }}
        >
          <Text
            numberOfLines={1}
            style={type(selected ? t.textPrimary : t.textMuted, 11, { fontWeight: "600" })}
          >
            {label}
            {connected ? "" : " · offline"}
          </Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}
