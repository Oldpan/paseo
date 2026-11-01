import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
export function useBigbangTitle(mode: string, label: string | undefined) {
  const title = mode === "studio" ? "Studio · Bigbang" : `${label ?? "Chat"} · Bigbang`;
  useEffect(() => {
    if (isWeb) document.title = title;
  }, [title]);
}
export function chatReadError(error: Error) {
  if (error.message.includes("Plugin is not available"))
    return "This host has not enabled Bigbang Chat. Choose the Chat coordinator.";
  return "Could not load Chat. Check the coordinator connection and try again.";
}
