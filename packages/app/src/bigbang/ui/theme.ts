import { isWeb } from "@/constants/platform";
// Migrated from Bigbang apps/app/src/theme.ts. Keep presentation changes reviewable against that source.
import { type TextStyle, type ViewStyle } from "react-native";

export type ThemeName = "light" | "dark";

/** Token values copied from archive/web/src/index.css :root / .dark. Do not edit the archived CSS file. */
export interface Palette {
  surfacePrimary: string;
  surfaceSecondary: string;
  surfaceTertiary: string;
  surfaceElevated: string;
  surfaceHover: string;
  surfaceActive: string;
  card: string;
  chatSurface: string;
  brandAccent: string;
  brandAccentHover: string;
  brandAccentBright: string;
  brandAccentSoft: string;
  brandAccentMuted: string;
  sidebarSurface: string;
  sidebarSelected: string;
  sidebarSelectedHover: string;
  sidebarItemHover: string;
  msgBubble: string;
  msgBubbleHighlight: string;
  retroBorder: string;
  retroBorderLight: string;
  bubbleShadow: string;
  retroShadowHeavy: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textSubtle: string;
  badgeBlue: string;
  badgeGreen: string;
  badgeRed: string;
  badgeAmber: string;
  badgePink: string;
  onAccent: string;
  onPink: string;
  userBubbleInk: string;
  pillSurface: string;
  pillSurfaceStrong: string;
  pillBorder: string;
  pillText: string;
  dividerLine: string;
  success: string;
  destructive: string;
  warning: string;
  info: string;
  liveTool: string;
  black: string;
  codeSurface: string;
  codeBackground: string;
  codeForeground: string;
  link: string;
  linkHover: string;
  tableHeader: string;
  curatorHeader: string;
}

export const light: Palette = {
  surfacePrimary: "#fffdf5",
  surfaceSecondary: "#f7efd8",
  surfaceTertiary: "#e8dcc8",
  surfaceElevated: "#fff8d8",
  surfaceHover: "#fff1a9",
  surfaceActive: "#fff8e6",
  card: "#ffffff",
  chatSurface: "#f6efdb",
  brandAccent: "#ffd400",
  brandAccentHover: "#f7ca2e",
  brandAccentBright: "#FFD800",
  brandAccentSoft: "#fff4bf",
  brandAccentMuted: "#ffec8a",
  sidebarSurface: "#FFD800",
  sidebarSelected: "#fff8e6",
  sidebarSelectedHover: "#fff8e6",
  sidebarItemHover: "#fff3a8",
  msgBubble: "#fffef9",
  msgBubbleHighlight: "#ffd400",
  retroBorder: "rgba(24, 24, 27, 0.82)",
  retroBorderLight: "#d4d4d8",
  bubbleShadow: "rgba(24, 24, 27, 0.55)",
  retroShadowHeavy: "rgba(0, 0, 0, 0.3)",
  textPrimary: "#09090b",
  textSecondary: "#3f3f46",
  textMuted: "#71717a",
  textSubtle: "#a1a1aa",
  badgeBlue: "#d8efff",
  badgeGreen: "#d8f8c8",
  badgeRed: "#ffe4e4",
  badgeAmber: "#fff0d0",
  badgePink: "#FF6B9E",
  onAccent: "#1c1917",
  onPink: "#1c1917",
  userBubbleInk: "#1c1917",
  pillSurface: "rgba(255, 255, 255, 0.55)",
  pillSurfaceStrong: "rgba(255, 255, 255, 0.7)",
  pillBorder: "rgba(24, 24, 27, 0.1)",
  pillText: "rgba(63, 63, 70, 0.85)",
  dividerLine: "rgba(24, 24, 27, 0.1)",
  success: "#009d1e",
  destructive: "#e7000b",
  warning: "#d48e00",
  info: "#2784d5",
  liveTool: "#b45309",
  black: "#000000",
  codeSurface: "#f6f8fa",
  codeBackground: "#000000",
  codeForeground: "#ffffff",
  link: "#1d4ed8",
  linkHover: "#1e40af",
  tableHeader: "#22d3ee",
  curatorHeader: "#fff5b8",
};

export const dark: Palette = {
  surfacePrimary: "#0f0e0d",
  surfaceSecondary: "#0c0b0a",
  surfaceTertiary: "#080706",
  surfaceElevated: "#1a1713",
  surfaceHover: "#241f19",
  surfaceActive: "#1e1a15",
  card: "#141210",
  chatSurface: "#0a0908",
  brandAccent: "#eec95f",
  brandAccentHover: "#e2b84a",
  brandAccentBright: "#f5d76e",
  brandAccentSoft: "#d4a944",
  brandAccentMuted: "#453a20",
  sidebarSurface: "#0f0e0d",
  sidebarSelected: "#1e1a15",
  sidebarSelectedHover: "#241f19",
  sidebarItemHover: "#1a1713",
  msgBubble: "#1a1713",
  msgBubbleHighlight: "#eec95f",
  retroBorder: "#3a352d",
  retroBorderLight: "#2e2a24",
  bubbleShadow: "rgba(0, 0, 0, 0.85)",
  retroShadowHeavy: "rgba(0, 0, 0, 0.6)",
  textPrimary: "#f2ecdb",
  textSecondary: "#cfc7b2",
  textMuted: "#8f8778",
  textSubtle: "#6e6759",
  badgeBlue: "#233a4d",
  badgeGreen: "#1f3a26",
  badgeRed: "#4a231c",
  badgeAmber: "#4a3a17",
  badgePink: "#ff6b9e",
  onAccent: "#131007",
  onPink: "#131007",
  userBubbleInk: "#000000",
  pillSurface: "rgba(26, 23, 19, 0.7)",
  pillSurfaceStrong: "rgba(36, 31, 25, 0.8)",
  pillBorder: "rgba(242, 236, 219, 0.08)",
  pillText: "rgba(207, 199, 178, 0.85)",
  dividerLine: "rgba(242, 236, 219, 0.08)",
  success: "#8fbc7a",
  destructive: "#e07070",
  warning: "#e0b36a",
  info: "#e0b36a",
  liveTool: "#fcd34d",
  black: "#000000",
  codeSurface: "#0c0b0a",
  codeBackground: "#080706",
  codeForeground: "#f2ecdb",
  link: "#eec95f",
  linkHover: "#f5d76e",
  tableHeader: "#1e1a15",
  curatorHeader: "#fff5b8",
};

export const palettes = { light, dark } as const;
/** CSS stack is web-only. Native Text uses the platform system font. */
export const fontFamily = isWeb
  ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  : undefined;
export const compactBreakpoint = 1280;
export const phoneHeaderBreakpoint = 768;

export function offsetShadow(color: string, x: number, y: number): ViewStyle {
  if (isWeb) {
    return { boxShadow: `${x}px ${y}px 0 0 ${color}` } as ViewStyle;
  }
  return {
    shadowColor: "#000000",
    shadowOffset: { width: x, height: y },
    shadowOpacity: 0.45,
    shadowRadius: 0,
    elevation: Math.max(1, Math.round(Math.max(x, y))),
  };
}

export function ctrlShadow(theme: Palette, name: ThemeName): ViewStyle {
  return offsetShadow(theme.bubbleShadow, name === "dark" ? 3 : 1.5, name === "dark" ? 3 : 1.5);
}

export function bubbleShadow(theme: Palette, name: ThemeName): ViewStyle {
  return offsetShadow(theme.bubbleShadow, name === "dark" ? 3 : 2, name === "dark" ? 3 : 2);
}

export function cardShadow(theme: Palette): ViewStyle {
  return offsetShadow(theme.retroShadowHeavy, 8, 8);
}

export function text(color: string, size: number, extra?: TextStyle): TextStyle {
  const lineHeight = size === 24 ? 32 : size === 16 ? 24 : size === 14 ? 21 : undefined;
  return {
    color,
    fontSize: size,
    ...(lineHeight ? { lineHeight } : null),
    ...(fontFamily ? { fontFamily } : null),
    ...extra,
  };
}

/** Map palette onto the old-web CSS variable names so RN-web CSS (scrollbars, placeholders) tracks theme. */
export function cssVariables(palette: Palette, name: ThemeName = "dark"): Record<string, string> {
  return {
    "--background": name === "light" ? "#ffffff" : palette.chatSurface,
    "--foreground": palette.textPrimary,
    "--card": palette.card,
    "--card-foreground": palette.textPrimary,
    "--popover": palette.card,
    "--popover-foreground": palette.textPrimary,
    "--primary": palette.textSecondary,
    "--primary-foreground": palette.onAccent,
    "--secondary": palette.surfaceElevated,
    "--secondary-foreground": palette.textPrimary,
    "--muted": palette.surfaceElevated,
    "--muted-foreground": palette.textMuted,
    "--accent": palette.surfaceElevated,
    "--accent-foreground": palette.textPrimary,
    "--destructive": palette.destructive,
    "--success": palette.success,
    "--warning": palette.warning,
    "--info": palette.info,
    "--border": palette.retroBorderLight,
    "--input": palette.retroBorderLight,
    "--ring": name === "light" ? "#71717b" : palette.brandAccent,
    "--bubble-shadow": palette.bubbleShadow,
    "--retro-shadow": name === "light" ? "rgba(0, 0, 0, 0.12)" : "rgba(0, 0, 0, 0.45)",
    "--retro-shadow-heavy": palette.retroShadowHeavy,
    "--sidebar-selected-hover": palette.sidebarSelectedHover,
    "--radius": "0.5rem",
    "--code-background": palette.codeBackground,
    "--code-foreground": palette.codeForeground,
    "--surface-primary": palette.surfacePrimary,
    "--surface-secondary": palette.surfaceSecondary,
    "--surface-tertiary": palette.surfaceTertiary,
    "--surface-elevated": palette.surfaceElevated,
    "--surface-hover": palette.surfaceHover,
    "--surface-active": palette.surfaceActive,
    "--chat-surface": palette.chatSurface,
    "--brand-accent": palette.brandAccent,
    "--brand-accent-hover": palette.brandAccentHover,
    "--brand-accent-bright": palette.brandAccentBright,
    "--brand-accent-soft": palette.brandAccentSoft,
    "--brand-accent-muted": palette.brandAccentMuted,
    "--sidebar-surface": palette.sidebarSurface,
    "--sidebar-selected": palette.sidebarSelected,
    "--sidebar-item-hover": palette.sidebarItemHover,
    "--msg-bubble": palette.msgBubble,
    "--msg-bubble-highlight": palette.msgBubbleHighlight,
    "--retro-border": palette.retroBorder,
    "--retro-border-light": palette.retroBorderLight,
    "--text-primary": palette.textPrimary,
    "--text-secondary": palette.textSecondary,
    "--text-muted": palette.textMuted,
    "--text-subtle": palette.textSubtle,
    "--code-surface": palette.codeSurface,
    "--badge-blue": palette.badgeBlue,
    "--badge-green": palette.badgeGreen,
    "--badge-red": palette.badgeRed,
    "--badge-amber": palette.badgeAmber,
    "--badge-pink": palette.badgePink,
    "--on-accent": palette.onAccent,
    "--on-pink": palette.onPink,
    "--link": palette.link,
    "--link-hover": palette.linkHover,
    "--pill-surface": palette.pillSurface,
    "--pill-surface-strong": palette.pillSurfaceStrong,
    "--pill-border": palette.pillBorder,
    "--pill-text": palette.pillText,
    "--divider-line": palette.dividerLine,
    "--scroll-fade-from": palette.surfacePrimary,
  };
}

/** RN-web Pressable role=button maps to <button>; UA buttonface can paint white. CSS uses this flag. */
export function selectedFillProps(selected: boolean): {
  dataSet?: { selectedFill: "accent" | "idle" };
} {
  if (!isWeb) return {};
  return { dataSet: { selectedFill: selected ? "accent" : "idle" } };
}

export function goldFillProps(): { dataSet?: { goldFill: "true" } } {
  if (!isWeb) return {};
  return { dataSet: { goldFill: "true" } };
}

export const webTransition = (value: string) => (isWeb ? { transition: value } : null);

/** Old-web Sidebar AgentStatusDot Tailwind fills. */
export function runStatusColor(status: string, theme: Palette): string {
  if (
    status === "active" ||
    status === "submitted" ||
    status === "streaming" ||
    status === "cancelling"
  )
    return "#facc15";
  if (status === "queued") return "#60a5fa";
  if (status === "recovering") return "#38bdf8";
  if (status === "awaiting_approval") return "#f59e0b";
  if (status === "failed" || status === "error") return theme.destructive;
  if (status === "unavailable") return "#a8a29e";
  return theme.success;
}

/** Old-web GlobalTasksPanel status chips. */
export function taskChipColors(status: string, darkMode: boolean): { bg: string; fg: string } {
  if (status === "todo")
    return darkMode ? { bg: "#3a352d", fg: "#cfc7b2" } : { bg: "#e8e4d8", fg: "#3f3f46" };
  if (status === "in_progress")
    return darkMode ? { bg: "#2c4a5e", fg: "#cfe3f5" } : { bg: "#b8d4ee", fg: "#1d5c8a" };
  if (status === "in_review")
    return darkMode ? { bg: "#6e5c2c", fg: "#f5d76e" } : { bg: "#f5d76e", fg: "#8a6410" };
  return darkMode ? { bg: "#3a5c42", fg: "#b9e6c2" } : { bg: "#9ed0a2", fg: "#1d5c2a" };
}
