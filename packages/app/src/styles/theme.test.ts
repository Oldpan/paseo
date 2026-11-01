import { describe, expect, it } from "vitest";
import {
  bigbangDarkTheme,
  bigbangLightTheme,
  darkPureBlackTheme,
  darkTheme,
  FONT_SIZE,
  getNextThemePreference,
  lightTheme,
  paseoDarkTheme,
  paseoLightTheme,
  resolveBuildThemePreference,
  THEME_OPTIONS,
} from "./theme";

describe("Typography scale", () => {
  it("names 14px as the default interface tier", () => {
    expect(FONT_SIZE).toEqual({
      code: 12,
      content: 15,
      sm: 12,
      base: 14,
      lg: 16,
      xl: 18,
      "2xl": 20,
      "3xl": 22,
      "4xl": 26,
    });
  });
});

describe("Theme catalog", () => {
  it("owns the picker and shortcut order", () => {
    expect(THEME_OPTIONS.map((option) => option.name)).toEqual([
      "light",
      "dark",
      "auto",
      "zinc",
      "midnight",
      "claude",
      "ghostty",
      "pureBlack",
    ]);
    expect(getNextThemePreference("dark")).toBe("auto");
    expect(getNextThemePreference("pureBlack")).toBe("light");
  });
});

describe("Pure black theme", () => {
  it("uses a pure black application and terminal background", () => {
    expect(darkPureBlackTheme.colors.surface0).toBe("#000000");
    expect(darkPureBlackTheme.colors.background).toBe("#000000");
    expect(darkPureBlackTheme.colors.terminal.background).toBe("#000000");
  });

  it("uses Paseo's muted green accent", () => {
    expect(darkPureBlackTheme.colors.accent).toBe("#20744A");
    expect(darkPureBlackTheme.colors.accentBright).toBe("#7ccba0");
  });

  it("derives sidebar interaction surfaces from the surface scale", () => {
    expect(darkPureBlackTheme.colors.surfaceSidebar).toBe("#000000");
    expect(darkPureBlackTheme.colors.surfaceSidebarHover).toBe(darkPureBlackTheme.colors.surface1);
    expect(darkPureBlackTheme.colors.surfaceSidebarSelected).toBe(
      darkPureBlackTheme.colors.surface2,
    );
  });

  it("keeps ANSI black output readable on its zero-luminance terminal background", () => {
    expect(darkPureBlackTheme.colors.terminal.black).toBe("#595959");
    expect(darkPureBlackTheme.colors.terminal.brightBlack).toBe("#8a8a8a");
  });
});

describe("Sidebar interaction surfaces", () => {
  it("keeps Light hover and selection darker than the sidebar surface", () => {
    expect(lightTheme.colors.surfaceSidebarHover).toBe(lightTheme.colors.surface3);
    expect(lightTheme.colors.surfaceSidebarSelected).toBe(lightTheme.colors.surface4);
    expect(lightTheme.colors.surfaceSidebarSelected).not.toBe(lightTheme.colors.surfaceSidebar);
  });

  it("derives Dark hover and selection from the first two raised surfaces", () => {
    expect(darkTheme.colors.surfaceSidebarHover).toBe(darkTheme.colors.surface1);
    expect(darkTheme.colors.surfaceSidebarSelected).toBe(darkTheme.colors.surface2);
  });
});

describe("Built-in light theme", () => {
  it("preserves its authored aliases and terminal contrast through the semantic builder", () => {
    expect(lightTheme.colors).toMatchObject({
      primary: "#18181b",
      primaryForeground: "#fafafa",
      destructiveForeground: "#ffffff",
      successForeground: "#ffffff",
      terminal: {
        black: "#1a1a1e",
        brightBlack: "#3f3f46",
      },
    });
  });
});

describe("Theme chrome", () => {
  it("keeps Paseo's own look by default", () => {
    for (const theme of [paseoDarkTheme, paseoLightTheme, darkPureBlackTheme]) {
      expect(theme.chrome).toMatchObject({
        controlBorderWidth: 0,
        controlShadow: {},
        bubbleShadow: {},
        userBubble: {
          background: theme.colors.surface3,
          foreground: theme.colors.foreground,
          borderWidth: 0,
        },
        headerRule: { width: 1, color: theme.colors.border },
        pillRadius: 16,
        activeTab: { background: theme.colors.surface2, foreground: theme.colors.foreground },
        liveTool: theme.colors.foreground,
      });
    }
  });

  it("draws the Bigbang themes from the Bigbang palette with retro outlines", () => {
    expect(bigbangDarkTheme.colors).toMatchObject({
      surface0: "#0f0e0d",
      foreground: "#f2ecdb",
      accent: "#eec95f",
      accentForeground: "#131007",
    });
    expect(bigbangDarkTheme.chrome).toMatchObject({
      controlBorderWidth: 1,
      userBubble: { background: "#eec95f", foreground: "#000000", borderWidth: 1 },
      headerRule: { width: 2, color: "#000000" },
      activeTab: { background: "#eec95f", foreground: "#131007" },
    });
    expect(bigbangLightTheme.colors).toMatchObject({
      surface0: "#fffdf5",
      accent: "#ffd400",
      accentBright: "#1d4ed8",
    });
  });
});

describe("resolveBuildThemePreference", () => {
  it("keeps every preference in the Paseo build", () => {
    expect(resolveBuildThemePreference("zinc", false)).toBe("zinc");
    expect(resolveBuildThemePreference("plugin", false)).toBe("plugin");
  });

  it("follows the system for a variant or plugin theme the Bigbang build does not offer", () => {
    expect(resolveBuildThemePreference("light", true)).toBe("light");
    expect(resolveBuildThemePreference("dark", true)).toBe("dark");
    expect(resolveBuildThemePreference("auto", true)).toBe("auto");
    expect(resolveBuildThemePreference("midnight", true)).toBe("auto");
    expect(resolveBuildThemePreference("plugin", true)).toBe("auto");
  });
});
