// Migrated from Bigbang apps/app/src/terminalCopyKeys.ts
/** Ctrl/Cmd+C copies a terminal selection; without a selection it is SIGINT. */
export function copyShortcutShouldSuppressPty(
  event: {
    type?: string;
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  hasSelection: boolean,
): boolean {
  if (event.type && event.type !== "keydown") return false;
  if (event.altKey || event.shiftKey) return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (event.key !== "c" && event.key !== "C") return false;
  return hasSelection;
}
