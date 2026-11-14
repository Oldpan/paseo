// Migrated from Bigbang apps/app/src/HighlightedCode.tsx. Keep presentation changes reviewable against that source.
import { Text, type TextStyle } from "react-native";
import { text as type } from "./theme";

/** Native leftover: plain monospace. Web override lazy-loads Shiki HTML. */
export function HighlightedCode({
  code,
  color,
  style,
}: {
  code: string;
  language: string | null;
  color: string;
  narrow: boolean;
  style?: TextStyle;
}) {
  return (
    <Text
      selectable
      testID="markdown-code-plain"
      style={[type(color, 12, { fontFamily: "monospace", lineHeight: 18 }), style]}
    >
      {code}
    </Text>
  );
}
