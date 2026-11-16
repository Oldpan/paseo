import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
import type { SidebarSection } from "./store";

function formatPavraTitle(
  mode: string,
  label: string | undefined,
  section?: SidebarSection,
): string {
  if (mode === "studio") return "Studio · Pavra";
  if (section === "inbox") return "Inbox · Pavra";
  if (section === "tasks") return "Tasks · Pavra";
  if (section === "activity") return "Activity · Pavra";
  if (section === "saved") return "Saved · Pavra";
  return `${label ?? "Chat"} · Pavra`;
}

export function usePavraTitle(mode: string, label: string | undefined, section?: SidebarSection) {
  const title = formatPavraTitle(mode, label, section);
  useEffect(() => {
    if (isWeb) document.title = title;
  }, [title]);
}
export function chatReadError(error: Error) {
  if (error.message.includes("Plugin is not available"))
    return "This host has not enabled Pavra Chat. Choose the Chat coordinator.";
  return "Could not load Chat. Check the coordinator connection and try again.";
}
