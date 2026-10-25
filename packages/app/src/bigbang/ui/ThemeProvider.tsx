import { createContext, useContext, useMemo, type ReactNode } from "react";
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
