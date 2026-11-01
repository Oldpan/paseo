import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { useAppSettings } from "@/hooks/use-settings";
import { palettes, type ThemeName } from "./theme";

// Presentation context keeps Bigbang's original component API. Paseo owns the theme preference.
const ThemeContext = createContext({ name: "light" as ThemeName, palette: palettes.light });
export function BigbangTheme({ name, children }: { name: ThemeName; children: ReactNode }) {
  const value = useMemo(() => ({ name, palette: palettes[name] }), [name]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  return useContext(ThemeContext);
}

/** Bigbang follows the app's theme preference, resolving "auto" from the system scheme. */
export function useBigbangDark(): boolean {
  const scheme = useColorScheme();
  const { settings } = useAppSettings();
  return settings.theme === "dark" || (settings.theme === "auto" && scheme === "dark");
}
