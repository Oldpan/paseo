import { randomUUID } from "node:crypto";
import type { RpcInput } from "@getpaseo/plugin";
import type {
  CallResult,
  MemberCall,
  MemberEvent,
  MemberItem,
  memberPoll,
} from "../../shared/member";

type RpcPollInput = RpcInput<typeof memberPoll>;

/** The daemon's tool call timeout is 30 seconds; answer before it with an honest "unknown". */
const DEFAULT_CALL_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_EVENTS = 500;
const MAX_ITEMS_PER_POLL = 100;

export const UNKNOWN_OUTCOME =
  "No answer from the Chat coordinator in time, so the outcome is unknown. Check the records or task_status before you repeat this.";
export const NOT_LINKED = "This machine is not linked to a Chat coordinator yet.";

export interface MemberRelayOptions {
  /** The coordinator this member serves; null until configured. */
  coordinatorServerId: () => string | null;
  callTimeoutMs?: number;
  maxEvents?: number;
}
interface Pending {
  resolve: (output: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// The member side of the coordinator link. Agents' tool calls and hook events queue here until the
// coordinator polls; an item is redelivered until a later poll acknowledges it. A call stays open
// until the coordinator responds or the timeout passes, and an unacknowledged call is withdrawn at
// the timeout so it can never run after the agent was told its outcome is unknown.
export class MemberRelay {
  readonly processId = randomUUID();
  private seq = 0;
  private items: MemberItem[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly waiters = new Set<() => void>();
  private readonly callTimeoutMs: number;
  private readonly maxEvents: number;
  private closed = false;

  constructor(private readonly options: MemberRelayOptions) {
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  }

  call(agentId: string, tool: string, input: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("The Chat member is shutting down."));
    if (!this.options.coordinatorServerId()) return Promise.reject(new Error(NOT_LINKED));
    const callId = randomUUID();
    const item: MemberCall = { seq: ++this.seq, type: "call", callId, agentId, tool, input };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        this.items = this.items.filter((entry) => entry !== item);
        reject(new Error(UNKNOWN_OUTCOME));
      }, this.callTimeoutMs);
      this.pending.set(callId, { resolve, reject, timer });
      this.push(item);
    });
  }

  event(event: Omit<MemberEvent, "seq" | "type">): void {
    if (this.closed) return;
    this.push({ ...event, seq: ++this.seq, type: "event" });
    // Events are hints; the coordinator re-reads timelines, so the oldest ones can go.
    const events = this.items.filter((entry) => entry.type === "event");
    if (events.length > this.maxEvents) {
      const drop = new Set<MemberItem>(events.slice(0, events.length - this.maxEvents));
      this.items = this.items.filter((entry) => !drop.has(entry));
    }
  }

  async poll(input: RpcPollInput): Promise<{ processId: string; items: MemberItem[] }> {
    const expected = this.options.coordinatorServerId();
    if (!expected) throw new Error(NOT_LINKED);
    if (input.coordinatorServerId !== expected)
      throw new Error(`This machine belongs to the Chat coordinator ${expected}.`);
    this.items = this.items.filter((entry) => entry.seq > input.ackThrough);
    if (this.items.length === 0 && input.waitMs > 0 && !this.closed) await this.wait(input.waitMs);
    return { processId: this.processId, items: this.items.slice(0, MAX_ITEMS_PER_POLL) };
  }

  respond(callId: string, result: CallResult): { accepted: boolean } {
    const pending = this.pending.get(callId);
    if (!pending) return { accepted: false };
    this.pending.delete(callId);
    clearTimeout(pending.timer);
    this.items = this.items.filter((entry) => entry.type !== "call" || entry.callId !== callId);
    if (result.ok) pending.resolve(result.output);
    else pending.reject(new Error(result.error));
    return { accepted: true };
  }

  close(): void {
    this.closed = true;
    for (const [callId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(UNKNOWN_OUTCOME));
      this.pending.delete(callId);
    }
    this.items = [];
    this.wake();
  }

  private push(item: MemberItem): void {
    this.items.push(item);
    this.wake();
  }
  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }
  private wait(ms: number): Promise<void> {
    let wake = () => {};
    const woken = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const timer = setTimeout(wake, ms);
    this.waiters.add(wake);
    return woken.finally(() => {
      clearTimeout(timer);
      this.waiters.delete(wake);
    });
  }
}
