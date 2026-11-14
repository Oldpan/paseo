import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
export function usePavraTitle(mode: string, label: string | undefined) {
  const title = mode === "studio" ? "Studio · Pavra" : `${label ?? "Chat"} · Pavra`;
  useEffect(() => {
    if (isWeb) document.title = title;
  }, [title]);
}
export function chatReadError(error: Error) {
  if (error.message.includes("Plugin is not available"))
    return "This host has not enabled Pavra Chat. Choose the Chat coordinator.";
  return "Could not load Chat. Check the coordinator connection and try again.";
}
