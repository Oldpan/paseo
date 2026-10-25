// Migrated presentation from Bigbang AgentCreateDialog.tsx. Host form models own edits and saving.
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput, type EditingTextInputProps } from "@/components/ui/text-input";
import { CloseIcon } from "./icons";
import { Chip } from "./ChatChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";
export function FormFrame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: t.chatSurface,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <View
        accessibilityRole="summary"
        accessibilityLabel={title}
        style={{
          width: "100%",
          maxWidth: 672,
          maxHeight: "100%",
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfaceSecondary,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: t.brandAccent,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderColor: t.retroBorder,
          }}
        >
          <Text role="heading" style={type(t.onAccent, 14, { fontWeight: "700" })}>
            {title}
          </Text>
          <Pressable
            role="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
          >
            <CloseIcon color={t.onAccent} size={14} />
          </Pressable>
        </View>
        <ScrollView
          style={{ backgroundColor: t.surfacePrimary, flexGrow: 0, maxHeight: 680 }}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    </View>
  );
}
export function BigbangField({ label, children }: { label: string; children: ReactNode }) {
  const { palette: t } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={type(t.textSecondary, 10, {
          fontWeight: "800",
          letterSpacing: 0.6,
          textTransform: "uppercase",
        })}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}
export function BigbangInput(props: EditingTextInputProps) {
  const { palette: t } = useTheme();
  return (
    <EditingTextInput
      {...props}
      placeholderTextColor={t.textSubtle}
      style={[
        type(t.textPrimary, 12),
        {
          minHeight: props.multiline ? 100 : 36,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfacePrimary,
          paddingHorizontal: 10,
          paddingVertical: 8,
          textAlignVertical: "top",
        },
        props.style,
      ]}
    />
  );
}
export function FormActions({
  onSubmit,
  onClose,
  busy,
}: {
  onSubmit(): void;
  onClose(): void;
  busy: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 8 }}>
      <Chip onPress={onSubmit} disabled={busy} accent>
        {busy ? "Saving…" : "Save"}
      </Chip>
      <Chip onPress={onClose} disabled={busy}>
        Cancel
      </Chip>
    </View>
  );
}
