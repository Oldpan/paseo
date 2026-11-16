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
  surfacePrimary: "#FAF8F5",
  surfaceSecondary: "#F3EFEA",
  surfaceTertiary: "#EAE4DC",
  surfaceElevated: "#FFFFFF",
  surfaceHover: "#EFEAE2",
  surfaceActive: "#E7E0D6",
  card: "#FFFFFF",
  chatSurface: "#F6F3EC",
  brandAccent: "#C87D32",
  brandAccentHover: "#B56E27",
  brandAccentBright: "#D98A3C",
  brandAccentSoft: "#F5E6D3",
  brandAccentMuted: "#EBD5B8",
  sidebarSurface: "#EFECE6",
  sidebarSelected: "#FFFFFF",
  sidebarSelectedHover: "#FAF8F5",
  sidebarItemHover: "#E5E0D7",
  msgBubble: "#FFFFFF",
  msgBubbleHighlight: "#EDE6DA",
  retroBorder: "rgba(28, 25, 23, 0.13)",
  retroBorderLight: "rgba(28, 25, 23, 0.08)",
  bubbleShadow: "rgba(28, 25, 23, 0.06)",
  retroShadowHeavy: "rgba(28, 25, 23, 0.12)",
  textPrimary: "#18181B",
  textSecondary: "#3F3F46",
  textMuted: "#71717A",
  textSubtle: "#A1A1AA",
  badgeBlue: "#d8efff",
  badgeGreen: "#d8f8c8",
  badgeRed: "#ffe4e4",
  badgeAmber: "#fff0d0",
  badgePink: "#C87D32",
  onAccent: "#FFFFFF",
  onPink: "#FFFFFF",
  userBubbleInk: "#1C1917",
  pillSurface: "rgba(255, 255, 255, 0.65)",
  pillSurfaceStrong: "rgba(255, 255, 255, 0.82)",
  pillBorder: "rgba(28, 25, 23, 0.08)",
  pillText: "rgba(63, 63, 70, 0.85)",
  dividerLine: "rgba(28, 25, 23, 0.08)",
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
  tableHeader: "#F3EFEA",
  curatorHeader: "#F5E6D3",
};

export const dark: Palette = {
  surfacePrimary: "#121110",
  surfaceSecondary: "#161412",
  surfaceTertiary: "#0D0C0B",
  surfaceElevated: "#1D1A17",
  surfaceHover: "#26221E",
  surfaceActive: "#211E1A",
  card: "#171513",
  chatSurface: "#0E0D0C",
  brandAccent: "#E0B456",
  brandAccentHover: "#D4A646",
  brandAccentBright: "#ECC56A",
  brandAccentSoft: "rgba(224, 180, 86, 0.16)",
  brandAccentMuted: "#332B1A",
  sidebarSurface: "#121110",
  sidebarSelected: "#1F1C18",
  sidebarSelectedHover: "#26221E",
  sidebarItemHover: "#1A1815",
  msgBubble: "#191714",
  msgBubbleHighlight: "#2B2419",
  retroBorder: "rgba(242, 236, 219, 0.14)",
  retroBorderLight: "rgba(242, 236, 219, 0.08)",
  bubbleShadow: "rgba(0, 0, 0, 0.35)",
  retroShadowHeavy: "rgba(0, 0, 0, 0.55)",
  textPrimary: "#f2ecdb",
  textSecondary: "#cfc7b2",
  textMuted: "#8f8778",
  textSubtle: "#6e6759",
  badgeBlue: "#233a4d",
  badgeGreen: "#1f3a26",
  badgeRed: "#4a231c",
  badgeAmber: "#4a3a17",
  badgePink: "#E0B456",
  onAccent: "#131007",
  onPink: "#131007",
  userBubbleInk: "#F2ECDB",
  pillSurface: "rgba(29, 26, 23, 0.7)",
  pillSurfaceStrong: "rgba(38, 34, 30, 0.8)",
  pillBorder: "rgba(242, 236, 219, 0.08)",
  pillText: "rgba(207, 199, 178, 0.85)",
  dividerLine: "rgba(242, 236, 219, 0.08)",
  success: "#8fbc7a",
  destructive: "#e07070",
  warning: "#e0b36a",
  info: "#e0b36a",
  liveTool: "#fcd34d",
  black: "#000000",
  codeSurface: "#0D0C0B",
  codeBackground: "#080706",
  codeForeground: "#f2ecdb",
  link: "#E0B456",
  linkHover: "#ECC56A",
  tableHeader: "#1D1A17",
  curatorHeader: "#2B2419",
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

export function ctrlShadow(_theme: Palette, _name: ThemeName): ViewStyle {
  return {};
}

export function bubbleShadow(_theme: Palette, _name: ThemeName): ViewStyle {
  return {};
}

export function cardShadow(theme: Palette): ViewStyle {
  if (isWeb) {
    return { boxShadow: "0 10px 28px -4px " + theme.retroShadowHeavy } as ViewStyle;
  }
  return {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  };
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
    "--background": name === "light" ? palette.surfacePrimary : palette.chatSurface,
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
