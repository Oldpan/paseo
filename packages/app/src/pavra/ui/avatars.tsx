import { isWeb } from "@/constants/platform";
// Migrated from Bigbang apps/app/src/avatars.tsx. Keep presentation changes reviewable against that source.
import { createElement, useMemo } from "react";
import { Text, View } from "react-native";
import { ctrlShadow, text as type, type Palette, type ThemeName } from "./theme";

const palette = [
  { foreground: "#111827", background: "#dbeafe" },
  { foreground: "#0f172a", background: "#fde68a" },
  { foreground: "#1f2937", background: "#bfdbfe" },
  { foreground: "#0b1324", background: "#fecdd3" },
  { foreground: "#111827", background: "#bbf7d0" },
  { foreground: "#172554", background: "#ddd6fe" },
];

function buildPixelAvatar(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const colors = palette[Math.abs(hash) % palette.length] ?? palette[0]!;
  const pixels = Array.from({ length: 64 }, () => false);
  let state = hash >>> 0;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const active = (next() & 1) === 1;
      pixels[y * 8 + x] = active;
      pixels[y * 8 + (7 - x)] = active;
    }
  }
  pixels[0] = false;
  pixels[7] = false;
  pixels[56] = false;
  pixels[63] = false;
  return { pixels, ...colors };
}

export function AgentAvatar({
  seed,
  label,
  size,
  theme,
  name,
}: {
  seed: string;
  label: string;
  size: number;
  theme: Palette;
  name: ThemeName;
}) {
  const art = useMemo(() => buildPixelAvatar(seed), [seed]);
  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          width: size,
          height: size,
          borderRadius: 8,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme.retroBorder,
          backgroundColor: art.background,
        },
        ctrlShadow(theme, name),
      ]}
    >
      {isWeb ? (
        createElement(
          "svg",
          {
            viewBox: "0 0 8 8",
            width: "100%",
            height: "100%",
            shapeRendering: "crispEdges",
            "aria-hidden": true,
            style: { display: "block", width: "100%", height: "100%" },
          },
          [
            createElement("rect", { key: "bg", width: 8, height: 8, fill: art.background }),
            createElement("path", {
              key: "fg",
              d: art.pixels
                .flatMap((active, index) =>
                  active ? [`M${index % 8} ${Math.floor(index / 8)}h1v1h-1z`] : [],
                )
                .join(""),
              fill: art.foreground,
              fillRule: "nonzero",
            }),
          ],
        )
      ) : (
        <View style={{ flex: 1 }}>
          {Array.from({ length: 8 }, (_, y) => (
            <View key={y} style={{ flex: 1, flexDirection: "row" }}>
              {Array.from({ length: 8 }, (_cell, x) => (
                <View
                  key={x}
                  style={{
                    flex: 1,
                    backgroundColor: art.pixels[y * 8 + x] ? art.foreground : art.background,
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function UserAvatar({
  label,
  size,
  theme,
  name,
}: {
  label: string;
  size: number;
  theme: Palette;
  name: ThemeName;
}) {
  const initial = label.trim().charAt(0).toUpperCase() || "Y";
  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          width: size,
          height: size,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.retroBorder,
          backgroundColor: "#c9c4ff",
          alignItems: "center",
          justifyContent: "center",
        },
        ctrlShadow(theme, name),
      ]}
    >
      <Text style={type("#2a2660", Math.max(10, Math.round(size * 0.38)), { fontWeight: "800" })}>
        {initial}
      </Text>
    </View>
  );
}

export function StatusDot({
  color,
  border,
  pulse,
}: {
  color: string;
  border: string;
  pulse?: boolean;
}) {
  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color,
        borderWidth: 1,
        borderColor: border,
        opacity: pulse ? 0.8 : 1,
      }}
    />
  );
}
