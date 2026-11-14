import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { ChevronIcon } from "./icons";
import type { OptionSelectProps } from "./optionSelectTypes";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export type { OptionSelectItem, OptionSelectProps } from "./optionSelectTypes";

export function OptionSelect({
  label,
  value,
  options,
  onSelect,
  disabled,
  testID,
  emptyLabel,
}: OptionSelectProps) {
  const { palette: t, name } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const shown = selected?.label ?? emptyLabel ?? "Select";
  return (
    <View>
      <Pressable
        testID={testID}
        role="combobox"
        accessibilityLabel={label}
        accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        style={[
          {
            minHeight: 32,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceHover,
            paddingHorizontal: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            opacity: disabled ? 0.5 : 1,
          },
          ctrlShadow(t, name),
        ]}
      >
        <Text
          numberOfLines={1}
          style={[type(t.textPrimary, 12, { fontWeight: "600" }), { flex: 1 }]}
        >
          {shown}
        </Text>
        <ChevronIcon color={t.textMuted} size={12} down={!open} />
      </Pressable>
      <Modal
        visible={open && !disabled}
        transparent
        animationType="none"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          testID={testID ? `${testID}-dismiss` : undefined}
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: "transparent", justifyContent: "center", padding: 16 }}
        >
          <Pressable
            testID={testID ? `${testID}-menu` : undefined}
            onPress={() => undefined}
            style={{
              maxHeight: "70%",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfacePrimary,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                borderBottomWidth: 2,
                borderColor: t.retroBorder,
                backgroundColor: t.brandAccentMuted,
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text
                style={type(t.textPrimary, 10, {
                  fontWeight: "800",
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                })}
              >
                {label}
              </Text>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ backgroundColor: t.surfacePrimary, maxHeight: 256 }}
            >
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value || "empty"}
                    role="option"
                    accessibilityLabel={option.label}
                    accessibilityState={{
                      selected: isSelected,
                      disabled: Boolean(option.disabled),
                    }}
                    disabled={option.disabled}
                    onPress={() => {
                      if (option.disabled) return;
                      onSelect(option.value);
                      setOpen(false);
                    }}
                    style={{
                      minHeight: 32,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 8,
                      borderBottomWidth: 1,
                      borderColor: t.retroBorderLight,
                      backgroundColor: isSelected ? t.brandAccent : t.surfacePrimary,
                      opacity: option.disabled ? 0.45 : 1,
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        marginTop: 6,
                        borderWidth: 1,
                        borderColor: t.retroBorder,
                        backgroundColor: isSelected ? "rgb(19, 16, 7)" : "transparent",
                      }}
                    />
                    <Text
                      style={[type(isSelected ? t.textPrimary : t.textSecondary, 11), { flex: 1 }]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
