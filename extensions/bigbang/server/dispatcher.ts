import type { Assistant, Turn } from "../shared/contracts";
import type { ExecutionPort } from "./execution";
import type { ChatStore } from "./store";
import {
  assistantInstructions,
  bindChatSession,
  chatPrompt,
  laneMessages,
  runnableChatTurns,
  unseenMessages,
} from "./chat-sessions";
import { TASK_RECEIPT_LEAD, groupPreamble } from "./prompts";
import { ROUNDTABLE_HISTORY_LIMIT } from "./roundtable";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function failureStatus(error: unknown): "failed" | "unknown" {
  if (error instanceof Error && "code" in error) {
    const code = String(error.code);
    if (
      code.startsWith("DAEMON_") ||
      code.startsWith("host_") ||
      code === "PLUGIN_SESSION_CLOSED" ||
      code.toLowerCase().includes("outcome_unknown")
    )
      return "unknown";
  }
  return "failed";
}

/** Runs operations one at a time per key, so duplicate hooks and dispatches cannot interleave. */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  run(key: string, operation: () => Promise<void>): Promise<void> {
    const next = (this.tails.get(key) ?? Promise.resolve())
      .then(operation)
      .catch((error) => console.error("Bigbang coordination failed", error));
    this.tails.set(key, next);
    this.pending.add(next);
    void next.finally(() => {
      this.pending.delete(next);
      if (this.tails.get(key) === next) this.tails.delete(key);
    });
    return next;
  }
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled(this.pending);
  }
}

export const agentKey = (agentId: string) => `agent:${agentId}`;

export interface DispatcherDeps {
  store: ChatStore;
  queue: KeyedQueue;
  execution(): ExecutionPort | null;
  closed(): boolean;
  /** Cancels a task whose budget ran out. */
  cancelTask(taskId: string): Promise<unknown>;
  /** Looks at an execution whose turn was just confirmed as accepted. */
  settle(agentId: string): void;
  /** A turn ended without its execution ever reporting back (dispatch failed). */
  turnEnded(turn: Turn): void;
  /** Whether a queued turn may start now; a mailbox turn waits while its assistant is busy. */
  admit(turn: Turn): boolean;
  /** The execution confirmed a turn: it has the message. */
  accepted(turn: Turn): void;
  /** Formats a memory hint when a session is fresh (first turn, branch, rollover). */
  memoryHint?: (turn: Turn, assistant: Assistant, isFreshSession: boolean) => string;
}

// A turn is persisted `prepared` before anything is sent. If the process dies in between, the
// timeline decides: the anchor (a user_message whose messageId is the turn id) means the
// execution already accepted it; no anchor means the same message is sent again.
export class Dispatcher {
  private scheduled = false;
  constructor(private readonly deps: DispatcherDeps) {}
  /** Looks for work now. Coalesced; never waits for the work itself. */
  kick(): void {
    if (this.scheduled || this.deps.closed() || !this.deps.execution()) return;
    this.scheduled = true;
    void this.deps.queue.run("dispatcher", async () => {
      this.scheduled = false;
      this.evaluate();
    });
  }
  private evaluate(): void {
    // One live turn per conversation lane, which also keeps one per ChatSession.
    for (const turn of runnableChatTurns(this.deps.store.snapshot().turns)) {
      if (turn.status === "queued")
        void this.deps.queue.run(agentKey(turn.agentId), () => this.start(turn.id));
      else if ((turn.status === "creating" || turn.status === "unknown") && !turn.accepted)
        void this.deps.queue.run(agentKey(turn.agentId), () => this.recover(turn.id));
    }
  }
  private async start(turnId: string): Promise<void> {
    let turn = this.deps.store.get("turns", turnId);
    if (!turn || turn.status !== "queued" || this.deps.closed()) return;
    const assistant = this.deps.store.get("assistants", turn.assistantId);
    if (!assistant) return;
    try {
      const task = turn.taskId ? this.deps.store.get("tasks", turn.taskId) : null;
      if (task && Date.now() >= task.deadline && task.status !== "cancelled")
        await this.deps.cancelTask(task.id);
      if (task && this.deps.store.get("tasks", task.id)?.status === "cancelled") {
        this.deps.store.transaction(() =>
          this.deps.store.put("turns", { ...turn!, status: "cancelled" }),
        );
        return;
      }
      if (!this.deps.admit(turn)) return;
      turn = this.prepare(turn, assistant);
      await this.send(turn, assistant);
    } catch (error) {
      this.fail(turn, error);
    }
  }
  private async recover(turnId: string): Promise<void> {
    const turn = this.deps.store.get("turns", turnId);
    const port = this.deps.execution();
    if (!turn || !port || turn.accepted || this.deps.closed()) return;
    if (!["creating", "unknown"].includes(turn.status) || !turn.prepared) return;
    const assistant = this.deps.store.get("assistants", turn.assistantId);
    if (!assistant) return;
    try {
      const read = await port
        .readTurn(turn.agentId, turn.id, this.serverOf(turn))
        .catch(() => ({ kind: "unknown" as const, running: true }));
      if (read.kind === "found") this.accept(turn);
      else await this.send(turn, assistant);
    } catch (error) {
      this.fail(turn, error);
    }
  }
  private serverOf(turn: Turn): string | undefined {
    return turn.taskId ? this.deps.store.get("tasks", turn.taskId)?.serverId : turn.serverId;
  }
  private accept(turn: Turn): void {
    const accepted: Turn = { ...turn, accepted: true, status: "running", error: null };
    this.deps.store.transaction(() => {
      this.deps.store.put("turns", accepted);
      this.advanceChatContext(accepted);
      this.deps.accepted(accepted);
    });
    this.deps.settle(turn.agentId);
  }
  private async send(turn: Turn, assistant: Assistant): Promise<void> {
    const port = this.deps.execution();
    if (!port) return;
    if (turn.chatSessionId) {
      const session = this.deps.store.getChatSession(turn.chatSessionId);
      if (!session) throw new Error("Chat execution binding is missing.");
      await port.ensureChatAgent({
        agentId: session.agentId,
        assistantId: assistant.id,
        assistantName: assistant.name,
        provider: session.provider,
        systemPrompt: session.systemPrompt,
        ...(session.serverId ? { serverId: session.serverId } : {}),
        created: session.created,
      });
      if (!session.created)
        this.deps.store.transaction(() =>
          this.deps.store.putChatSession({ ...session, created: true }),
        );
    } else if (!turn.taskId) throw new Error("Chat execution binding is missing.");
    await port.dispatch(turn.agentId, turn.prompt, turn.id, this.serverOf(turn));
    if (this.deps.closed()) return;
    this.accept(turn);
  }
  private fail(turn: Turn, error: unknown): void {
    if (this.deps.closed()) return;
    const failed: Turn = { ...turn, status: failureStatus(error), error: errorMessage(error) };
    this.deps.store.transaction(() => this.deps.store.put("turns", failed));
    this.deps.turnEnded(failed);
  }
  private advanceChatContext(turn: Turn): void {
    if (!turn.chatSessionId || !turn.contextThroughId) return;
    const session = this.deps.store.getChatSession(turn.chatSessionId);
    if (session)
      this.deps.store.putChatSession({
        ...session,
        lastMessageId: turn.contextThroughId,
        lastInstructions: turn.systemPrompt ?? session.lastInstructions,
      });
  }
  private prepare(turn: Turn, assistant: Assistant): Turn {
    if (turn.prepared && (turn.taskId || turn.chatSessionId)) return turn;
    return turn.taskId
      ? this.prepareTaskTurn(turn, assistant)
      : this.prepareChatTurn(turn, assistant);
  }
  private prepareTaskTurn(turn: Turn, assistant: Assistant): Turn {
    const history = this.deps.store
      .snapshot()
      .messages.filter(
        (message) =>
          message.conversationId === turn.conversationId && message.threadId === turn.threadId,
      )
      .slice(-24);
    const latestUser = history.findLast((message) => message.senderId === "user");
    const prepared: Turn = {
      ...turn,
      prepared: true,
      provider: assistant.provider,
      systemPrompt: assistantInstructions(assistant),
      prompt: history.map((message) => `${message.senderId}: ${message.content}`).join("\n\n"),
      seenUserId: latestUser?.id,
      status: "creating",
    };
    this.deps.store.transaction(() => this.deps.store.put("turns", prepared));
    return prepared;
  }
  private prepareChatTurn(turn: Turn, assistant: Assistant): Turn {
    const store = this.deps.store;
    if (!turn.chatSessionId && turn.status !== "queued")
      throw Object.assign(
        new Error(
          "This earlier chat turn has an unconfirmed execution. Inspect its existing agent in Studio before continuing; it will not be sent again.",
        ),
        { code: "agent_request_outcome_unknown" },
      );
    const session = store.transaction(() =>
      bindChatSession(store, turn.conversationId, turn.threadId, assistant),
    );
    if (session.provider !== assistant.provider)
      throw new Error(
        "This chat already has an execution with another model. Keep that model or start a new chat; it will not create a second execution automatically.",
      );
    const state = store.snapshot();
    const isFreshSession = !session.lastMessageId;
    // A roundtable thread's root message is part of the discussion but lives outside the thread.
    const rootId = turn.kind === "roundtable" ? turn.threadId : null;
    let delta = unseenMessages(state.messages, session, state.turns, rootId);
    if (turn.kind === "roundtable") delta = delta.slice(-ROUNDTABLE_HISTORY_LIMIT);
    const instructions = assistantInstructions(assistant);
    let prompt = this.turnPrompt(turn, assistant, chatPrompt(delta, assistant, state.assistants));
    // Returning mailbox replies follow whatever the lane said since the assistant last looked.
    if (turn.mailboxWakeupIds)
      prompt = delta.length > 0 ? `${prompt}\n\n${turn.prompt}` : turn.prompt;
    if (instructions !== session.lastInstructions)
      prompt = `Updated assistant instructions:\n${instructions}\n\n${prompt}`;
    if (isFreshSession && this.deps.memoryHint && !turn.mailboxId) {
      const hint = this.deps.memoryHint(turn, assistant, isFreshSession);
      if (hint?.trim()) prompt = `${hint.trim()}\n\n${prompt}`;
    }
    const history = laneMessages(state.messages, turn.conversationId, turn.threadId, rootId);
    const threadUsers = laneMessages(state.messages, turn.conversationId, turn.threadId);
    const prepared: Turn = {
      ...turn,
      agentId: session.agentId,
      chatSessionId: session.id,
      prepared: true,
      accepted: turn.accepted ?? false,
      provider: session.provider,
      systemPrompt: instructions,
      prompt,
      contextThroughId: history.at(-1)?.id,
      seenUserId: threadUsers.findLast((message) => message.senderId === "user")?.id,
      status: "creating",
    };
    store.transaction(() => store.put("turns", prepared));
    return prepared;
  }
  // A private chat prompts with the messages alone; a group says who is here and why it woke you.
  // A mailbox request carries its own prompt.
  private turnPrompt(turn: Turn, assistant: Assistant, messages: string): string {
    if (turn.mailboxId) return turn.prompt;
    const store = this.deps.store;
    const conversation = store.get("conversations", turn.conversationId);
    if (conversation?.kind === "group")
      return `${groupPreamble({
        turn,
        assistant,
        conversation,
        assistants: store.snapshot().assistants,
        epoch: turn.epochId ? store.getEpoch(turn.epochId) : null,
      })}\n\n${messages || "(no new messages)"}`;
    const prompt =
      messages || "Continue this roundtable discussion with another useful contribution.";
    return turn.kind === "task_receipt" ? `${TASK_RECEIPT_LEAD}\n\n${prompt}` : prompt;
  }
}
