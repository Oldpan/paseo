import { setTimeout as delay } from "node:timers/promises";
import type { RpcOutput } from "@getpaseo/plugin";
import {
  MEMBER_PROTOCOL,
  memberHello,
  memberPoll,
  memberRespond,
  type CallResult,
  type MemberCall,
  type MemberEvent,
} from "../../shared/member";
import { callPluginRpc } from "./rpc";

const POLL_WAIT_MS = 20_000;
const DEFAULT_DISCOVER_MS = 30_000;
const DEFAULT_RETRY_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
/** A redelivered call (its poll's ack was lost) gets the first answer instead of running twice. */
const RESULT_TTL_MS = 5 * 60_000;

export type MemberState =
  | { kind: "connecting" }
  | { kind: "member"; processId: string }
  | { kind: "other"; reason: string };

export interface HostDirectoryPort {
  self(): Promise<string>;
  /** Saved hosts this daemon can reach, with their link status. */
  list(): Promise<Array<{ serverId: string; label: string; online: boolean }>>;
  invoke(serverId: string, method: string, input: unknown): Promise<unknown>;
}
export interface MemberLinkHandlers {
  call(serverId: string, call: MemberCall): Promise<unknown>;
  event(serverId: string, event: MemberEvent): void;
  /** The member's plugin restarted or the link came back: its missed events are gone. */
  reconnected(serverId: string): void;
}
export interface MemberLinksOptions {
  discoverMs?: number;
  retryMs?: number;
  now?: () => number;
}

// Resolves after `ms`, or as soon as `signal` aborts.
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal }).catch(() => undefined);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The coordinator's side of every member link: one long-poll loop per saved host whose Bigbang
// plugin is a member of this coordinator. The coordinator dialed that host, so a call's serverId
// is the link's and its agentId was verified by the member's daemon; nothing in the item can
// claim another machine.
export class MemberLinks {
  private readonly loops = new Map<string, AbortController>();
  private readonly states = new Map<string, MemberState>();
  private readonly results = new Map<string, { result: Promise<CallResult>; at: number }>();
  private readonly lifetime = new AbortController();
  private readonly discoverMs: number;
  private readonly retryMs: number;
  private readonly now: () => number;
  private discovery: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly hosts: HostDirectoryPort,
    private readonly handlers: MemberLinkHandlers,
    options: MemberLinksOptions = {},
  ) {
    this.discoverMs = options.discoverMs ?? DEFAULT_DISCOVER_MS;
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    void this.discover();
    this.discovery = setInterval(() => void this.discover(), this.discoverMs);
    this.discovery.unref?.();
  }

  /** What each saved host is to this coordinator, for the machine picker. */
  state(serverId: string): MemberState | undefined {
    return this.states.get(serverId);
  }

  close(): void {
    if (this.discovery) clearInterval(this.discovery);
    this.lifetime.abort();
    this.loops.clear();
  }

  async discover(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    let hosts: Awaited<ReturnType<HostDirectoryPort["list"]>>;
    try {
      hosts = await this.hosts.list();
    } catch (error) {
      console.error("Bigbang could not list hosts", error);
      return;
    }
    for (const host of hosts) {
      if (!host.online || this.loops.has(host.serverId)) continue;
      const controller = new AbortController();
      this.loops.set(host.serverId, controller);
      void this.run(host.serverId, controller.signal).finally(() => {
        if (this.loops.get(host.serverId) === controller) this.loops.delete(host.serverId);
      });
    }
  }

  private async run(serverId: string, signal: AbortSignal): Promise<void> {
    const stop = AbortSignal.any([signal, this.lifetime.signal]);
    const self = await this.hosts.self();
    let processId: string | null = null;
    let ackThrough = 0;
    let backoff = 1_000;
    this.states.set(serverId, { kind: "connecting" });
    while (!stop.aborted) {
      try {
        if (!processId) {
          const hello = await callPluginRpc(memberHello, this.invoker(serverId), {});
          const reason = this.refusal(hello, self);
          if (reason) {
            this.states.set(serverId, { kind: "other", reason });
            await wait(this.retryMs, stop);
            continue;
          }
          processId = hello.processId;
          ackThrough = 0;
          this.states.set(serverId, { kind: "member", processId });
          this.handlers.reconnected(serverId);
        }
        const batch = await callPluginRpc(memberPoll, this.invoker(serverId), {
          coordinatorServerId: self,
          ackThrough,
          waitMs: POLL_WAIT_MS,
        });
        if (batch.processId !== processId) {
          // The member restarted between hello and poll: start over so the restart is noticed.
          processId = null;
          continue;
        }
        backoff = 1_000;
        for (const item of batch.items) {
          if (item.type === "event") this.handlers.event(serverId, item);
          else void this.answer(serverId, item);
          ackThrough = Math.max(ackThrough, item.seq);
        }
      } catch (error) {
        if (stop.aborted) break;
        console.error(`Bigbang member link to ${serverId} failed: ${message(error)}`);
        processId = null;
        this.states.set(serverId, { kind: "connecting" });
        await wait(backoff, stop);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private refusal(hello: RpcOutput<typeof memberHello>, self: string): string | null {
    if (hello.mode !== "member") return "It is a Chat coordinator itself.";
    if (hello.protocol !== MEMBER_PROTOCOL) return "Its Bigbang plugin is a different version.";
    if (hello.coordinatorServerId !== self)
      return hello.coordinatorServerId
        ? `It is a member of another coordinator (${hello.coordinatorServerId}).`
        : "It has no coordinator configured.";
    return null;
  }

  private answer(serverId: string, call: MemberCall): Promise<void> {
    const key = `${serverId}\n${call.callId}`;
    this.forget();
    let entry = this.results.get(key);
    if (!entry) {
      const result = this.handlers.call(serverId, call).then(
        (output): CallResult => ({ ok: true, output }),
        (error: unknown): CallResult => ({ ok: false, error: message(error) }),
      );
      entry = { result, at: this.now() };
      this.results.set(key, entry);
    }
    return entry.result
      .then((result) =>
        callPluginRpc(memberRespond, this.invoker(serverId), { callId: call.callId, result }),
      )
      .then(
        () => undefined,
        // The member times the call out on its own; a lost response is reported there as unknown.
        (error: unknown) =>
          console.error(`Bigbang could not answer ${serverId}: ${message(error)}`),
      );
  }

  private forget(): void {
    const cutoff = this.now() - RESULT_TTL_MS;
    for (const [key, entry] of this.results) if (entry.at < cutoff) this.results.delete(key);
  }

  private invoker(serverId: string) {
    return (method: string, input: unknown) => this.hosts.invoke(serverId, method, input);
  }
}
