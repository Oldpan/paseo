import { createContext, useContext } from "react";

/**
 * A shell other than Paseo's left sidebar can own the header's sidebar button. Wide layouts drop
 * the button because that shell's navigation is always visible; phones open it with `onMenu`.
 */
export interface SidebarMenuHost {
  onMenu(): void;
}

export const SidebarMenuHostContext = createContext<SidebarMenuHost | null>(null);

export function useSidebarMenuHost(): SidebarMenuHost | null {
  return useContext(SidebarMenuHostContext);
}
