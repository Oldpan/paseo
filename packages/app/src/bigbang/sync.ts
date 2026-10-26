import type { ChatState } from "../../../../extensions/bigbang/shared/contracts";

// The coordinator holds a `chat.state` request open for up to this long, answering early when the
// ledger changes. The plugin request timeout is 30s, so this stays below it.
export const LONG_POLL_MS = 20000;
// A coordinator that predates `waitMs` answers at once; an honest long poll never returns this
// fast without a change. Used to keep an old coordinator from being polled in a tight loop.
const FAST_RETURN_MS = 1000;
const LEGACY_PAUSE_MS = 1500;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export interface SyncLoopPorts {
  read(input: { after: number; generation: string; waitMs: number }): Promise<ChatState>;
  current(): ChatState;
  apply(next: ChatState): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  isCancelled(): boolean;
  onSuccess?(): void;
  onError?(error: Error): void;
  onLegacyCoordinator?(): void;
}

export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
}

/** Resolves when `isCancelled()` turns true; a cancelled loop never applies a late response. */
export async function runChatSyncLoop(ports: SyncLoopPorts): Promise<void> {
  let failures = 0;
  while (!ports.isCancelled()) {
    const before = ports.current();
    const startedAt = ports.now();
    try {
      const next = await ports.read({
        after: before.cursor,
        generation: before.generation,
        waitMs: LONG_POLL_MS,
      });
      if (ports.isCancelled()) return;
      ports.apply(next);
      failures = 0;
      ports.onSuccess?.();
      const progressed = next.generation !== before.generation || next.cursor !== before.cursor;
      if (!progressed && ports.now() - startedAt < FAST_RETURN_MS) {
        ports.onLegacyCoordinator?.();
        await ports.sleep(LEGACY_PAUSE_MS);
      }
    } catch (failure) {
      if (ports.isCancelled()) return;
      failures += 1;
      ports.onError?.(failure instanceof Error ? failure : new Error(String(failure)));
      await ports.sleep(backoffMs(failures));
    }
  }
}
