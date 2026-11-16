import { describe, expect, it } from "vitest";
import { bubbleShadow, cardShadow, ctrlShadow, palettes as pavraPalettes } from "@/pavra/ui/theme";
import {
  pavraDarkTheme,
  pavraLightTheme,
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

  it("draws the Pavra themes from the Pavra warm-minimal palette", () => {
    expect(pavraDarkTheme.colors).toMatchObject({
      surface0: "#121110",
      foreground: "#f2ecdb",
      accent: "#E0B456",
      accentForeground: "#131007",
    });
    expect(pavraDarkTheme.chrome).toMatchObject({
      controlBorderWidth: 1,
      controlShadow: {},
      bubbleShadow: {},
      userBubble: { background: "#2B2419", foreground: "#F2ECDB", borderWidth: 1 },
      headerRule: { width: 1, color: "rgba(242, 236, 219, 0.08)" },
      activeTab: { background: "#E0B456", foreground: "#131007" },
    });
    expect(pavraLightTheme.colors).toMatchObject({
      surface0: "#FAF8F5",
      accent: "#C87D32",
      accentBright: "#1d4ed8",
    });
    expect(pavraLightTheme.chrome).toMatchObject({
      controlBorderWidth: 1,
      controlShadow: {},
      bubbleShadow: {},
      userBubble: { background: "#EDE6DA", foreground: "#1C1917", borderWidth: 1 },
      headerRule: { width: 1, color: "rgba(28, 25, 23, 0.08)" },
      activeTab: { background: "#C87D32", foreground: "#FFFFFF" },
    });
  });

  it("eliminates hard control/bubble offset shadows and uses diffuse card elevation in Pavra UI", () => {
    expect(ctrlShadow(pavraPalettes.light, "light")).toEqual({});
    expect(ctrlShadow(pavraPalettes.dark, "dark")).toEqual({});
    expect(bubbleShadow(pavraPalettes.light, "light")).toEqual({});
    expect(bubbleShadow(pavraPalettes.dark, "dark")).toEqual({});

    const lightCard = cardShadow(pavraPalettes.light);
    expect(
      lightCard.boxShadow === `0 10px 28px -4px ${pavraPalettes.light.retroShadowHeavy}` ||
        lightCard.shadowRadius === 16,
    ).toBe(true);

    expect(pavraPalettes.light).toMatchObject({
      surfacePrimary: "#FAF8F5",
      sidebarSurface: "#EFECE6",
      msgBubbleHighlight: "#EDE6DA",
      userBubbleInk: "#1C1917",
      brandAccent: "#C87D32",
      badgePink: "#C87D32",
      onAccent: "#FFFFFF",
      onPink: "#FFFFFF",
    });
    expect(pavraPalettes.dark).toMatchObject({
      surfacePrimary: "#121110",
      sidebarSurface: "#121110",
      msgBubbleHighlight: "#2B2419",
      userBubbleInk: "#F2ECDB",
      brandAccent: "#E0B456",
      badgePink: "#E0B456",
      onAccent: "#131007",
      onPink: "#131007",
    });
  });
});

describe("resolveBuildThemePreference", () => {
  it("keeps every preference in the Paseo build", () => {
    expect(resolveBuildThemePreference("zinc", false)).toBe("zinc");
    expect(resolveBuildThemePreference("plugin", false)).toBe("plugin");
  });

  it("follows the system for a variant or plugin theme the Pavra build does not offer", () => {
    expect(resolveBuildThemePreference("light", true)).toBe("light");
    expect(resolveBuildThemePreference("dark", true)).toBe("dark");
    expect(resolveBuildThemePreference("auto", true)).toBe("auto");
    expect(resolveBuildThemePreference("midnight", true)).toBe("auto");
    expect(resolveBuildThemePreference("plugin", true)).toBe("auto");
  });
});
