import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type Assistant,
  type ChatState,
  type Conversation,
  type Message,
  type Task,
  type Turn,
  readAssistantMemory,
  readState,
  sendMessage,
  startTask,
  writeAssistantMemory,
} from "../shared/contracts";
import { ChatStore } from "./store";
import { restoreChatSessions } from "./chat-sessions";
import { Fanout } from "./fanout";
import { Roundtable, roundtableStartMembers } from "./roundtable";
import { Dispatcher, KeyedQueue, agentKey, errorMessage, failureStatus } from "./dispatcher";
import {
  PaseoExecution,
  type ExecutionPort,
  type PermissionInfo,
  type TaskSpec,
} from "./execution";
import { isPass } from "./projection";

const LIVE = new Set(["queued", "creating", "running", "attention", "unknown"]);
const TURN_LIVE = new Set(["running", "attention", "unknown"]);
const TASK_BUDGET_MS = 30 * 60 * 1000;
const TASK_QUOTA = 2;
const DEFAULT_SWEEP_MS = 60_000;
const INTERRUPTED_MESSAGE =
  "Interrupted: the execution closed before this reply finished. Send again to continue.";
const ARCHIVED_MESSAGE =
  "This execution was archived before the reply finished. Restore it in Studio to continue.";

/** The parts of the plugin lifecycle events the coordinator reads. */
export interface AgentEvent {
  agent: { id: string };
}
export interface TurnEndedEvent extends AgentEvent {
  outcome:
    | { kind: "completed" }
    | { kind: "failed"; error: { message: string } }
    | { kind: "canceled"; reason: string };
}
export interface PermissionRequestedEvent extends AgentEvent {
  request: { id: string; name: string; title?: string };
}
export interface CoordinatorOptions {
  execution?: ExecutionPort;
  /** Safety sweep interval; hooks are best-effort, so the sweep settles what they missed. */
  sweepMs?: number;
  /** Clock for message times, recent participants and the peer inbox; tests drive it. */
  now?: () => number;
}
interface Finish {
  outcome?: TurnEndedEvent["outcome"];
  /** The execution was archived or closed (hook), so an unfinished turn is over. */
  gone?: "archived" | "closed";
}

function taskSpec(task: Task): TaskSpec {
  return {
    id: task.id,
    prompt: task.prompt,
    provider: task.provider,
    isolation: task.isolation,
    directory: task.directory,
    serverId: task.serverId,
  };
}
function goneReason(
  read: { agentClosed: boolean; agentArchived: boolean },
  finish: Finish,
): "archived" | "closed" | undefined {
  if (read.agentArchived) return "archived";
  return read.agentClosed ? "closed" : finish.gone;
}
function permissionOf(permission: PermissionInfo | null): Task["pendingPermission"] {
  return permission ? { requestId: permission.requestId, title: permission.title } : null;
}

// Chat state lives in the SQLite ledger. Paseo agent hooks (and, for tasks on other hosts, agent
// subscriptions) only enqueue work here; every settle is idempotent and re-reads the execution's
// timeline, so duplicated, reordered or missed events converge on the same ledger.
export class Coordinator {
  private port: ExecutionPort | null;
  private readonly injected: boolean;
  private readonly queue = new KeyedQueue();
  private readonly dispatcher: Dispatcher;
  private readonly fanout: Fanout;
  private readonly roundtable: Roundtable;
  private readonly now: () => number;
  private inboxTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly watches = new Map<string, () => void>();
  private readonly watching = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private recovered = false;
  private readonly sweepMs: number;
  constructor(
    readonly store: ChatStore,
    private readonly home: string,
    options: CoordinatorOptions = {},
  ) {
    this.port = options.execution ?? null;
    this.injected = Boolean(options.execution);
    this.sweepMs = options.sweepMs ?? DEFAULT_SWEEP_MS;
    this.now = options.now ?? Date.now;
    this.fanout = new Fanout(store, this.now);
    this.roundtable = new Roundtable(store, this.now);
    this.dispatcher = new Dispatcher({
      store,
      queue: this.queue,
      execution: () => this.port,
      closed: () => this.closed,
      cancelTask: (id) => this.cancel(id),
      settle: (agentId) => this.settle(agentId),
      turnEnded: (turn) => this.afterTurn(turn),
    });
  }
  /** Binds the plugin's Paseo API once; later calls are ignored. The first call runs recovery. */
  attach(api?: PaseoApi): void {
    if (this.closed) return;
    if (api && !this.injected && !this.port) {
      this.port = new PaseoExecution(api, this.home, {
        get: (id) => this.store.getAssistantHome(id),
        put: (home) => this.store.putAssistantHome(home),
      });
    }
    if (this.recovered || !this.port) return;
    this.recovered = true;
    restoreChatSessions(this.store);
    // Resume what the last process left: roundtable epochs between turns, and peer batches that
    // came due while it was down.
    this.roundtable.advanceAll();
    this.fanout.flushDue();
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref();
    void this.sweep();
  }
  // Long poll: with `after`, hold the request until the ledger advances past it.
  async readState(input: RpcInput<typeof readState>): Promise<ChatState> {
    const { after, generation, waitMs } = input;
    if (
      waitMs &&
      after !== undefined &&
      (generation === undefined || generation === this.store.currentGeneration)
    )
      await this.store.waitForChange(after, waitMs);
    if (this.closed) throw new Error("The Chat coordinator is shutting down.");
    return this.store.snapshot(after, generation);
  }
  private assistantDirectory(assistantId: string): string {
    return (
      this.store.getAssistantHome(assistantId)?.directory ??
      path.join(this.home, "assistants", assistantId)
    );
  }
  saveAssistant(input: Assistant): Assistant {
    const existing = this.store.get("assistants", input.id);
    const directory = this.assistantDirectory(input.id);
    mkdirSync(path.join(directory, "notes"), { recursive: true, mode: 0o700 });
    // The agent owns its memory file afterwards; a later save never overwrites it.
    try {
      writeFileSync(path.join(directory, "MEMORY.md"), input.memory ?? "", {
        mode: 0o600,
        flag: "wx",
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const assistant: Assistant = existing ? { ...input, memory: existing.memory } : input;
    this.store.transaction(() => this.store.put("assistants", assistant));
    return assistant;
  }
  private memoryFile(assistantId: string): string {
    if (!this.store.get("assistants", assistantId)) throw new Error("Assistant no longer exists.");
    return path.join(this.assistantDirectory(assistantId), "MEMORY.md");
  }
  private readMemory(file: string): RpcOutput<typeof readAssistantMemory> {
    try {
      return { content: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { content: "", mtimeMs: 0 };
      throw error;
    }
  }
  readAssistantMemory(input: RpcInput<typeof readAssistantMemory>) {
    return this.readMemory(this.memoryFile(input.assistantId));
  }
  writeAssistantMemory(
    input: RpcInput<typeof writeAssistantMemory>,
  ): RpcOutput<typeof writeAssistantMemory> {
    const file = this.memoryFile(input.assistantId);
    if (this.readMemory(file).mtimeMs !== input.expectedMtimeMs)
      throw new Error("The memory changed since it was loaded. Reload it and try again.");
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, input.content, { mode: 0o600 });
    renameSync(temporary, file);
    return this.readMemory(file);
  }
  createConversation(conversation: Conversation): Conversation {
    if (conversation.members.some((id) => !this.store.get("assistants", id)))
      throw new Error("Choose existing assistants.");
    if (conversation.kind === "dm" && conversation.members.length !== 1)
      throw new Error("A private chat has exactly one assistant.");
    this.store.transaction(() => this.store.put("conversations", conversation));
    return conversation;
  }

  send(input: RpcInput<typeof sendMessage>): { id: string } {
    const existing = this.store.get("messages", input.id);
    if (existing) {
      if (existing.conversationId !== input.conversationId || existing.content !== input.content)
        throw new Error("Message ID was already used for another message.");
      return { id: existing.id };
    }
    const conversation = this.store.get("conversations", input.conversationId);
    if (!conversation) throw new Error("Chat no longer exists.");
    if (
      input.threadId &&
      this.store.get("messages", input.threadId)?.conversationId !== conversation.id
    )
      throw new Error("Thread belongs to another chat.");
    const state = this.store.snapshot();
    const { followupTask, epoch, starters } = this.planSend(input, conversation, state);
    const staleAgents =
      epoch?.status === "running"
        ? state.turns
            .filter(
              (turn) => turn.epochId === epoch.id && turn.accepted && TURN_LIVE.has(turn.status),
            )
            .map((turn) => turn.agentId)
        : [];
    this.store.transaction(() => {
      const message = this.store.putMessage({
        id: input.id,
        conversationId: input.conversationId,
        threadId: input.threadId,
        content: input.content,
        senderId: "user",
        createdAt: this.now(),
        taskId: null,
        kind: "user",
        ...(input.quoteOf ? { quoteOf: input.quoteOf } : {}),
      });
      for (const previous of state.turns.filter(
        (turn) =>
          turn.conversationId === conversation.id &&
          turn.threadId === input.threadId &&
          turn.status === "queued",
      ))
        this.store.put("turns", {
          ...previous,
          status: "cancelled",
          error: "Superseded by a newer message.",
        });
      // Peer messages waiting for a batch belong to the conversation this message just replaced.
      this.store.clearInbox(conversation.id, input.threadId);
      if (followupTask) this.queueFollowup(followupTask, message);
      else if (starters)
        this.roundtable.advance(this.roundtable.start(conversation, message, starters).id);
      // Supersedes the running epoch; its in-flight turn is cancelled when it settles below.
      else if (epoch) this.roundtable.advance(this.roundtable.restart(epoch, message).id);
      else this.fanout.wakeForUserMessage(conversation, message);
    });
    for (const agentId of staleAgents) this.settle(agentId);
    this.kick();
    return { id: input.id };
  }
  // Checks everything a message needs before anything is written and decides how it is routed.
  private planSend(
    input: RpcInput<typeof sendMessage>,
    conversation: Conversation,
    state: ChatState,
  ) {
    const taskRoot = input.threadId ? this.store.get("messages", input.threadId) : null;
    const followupTask = taskRoot?.taskId ? this.store.get("tasks", taskRoot.taskId) : null;
    if (followupTask && (!followupTask.execution || followupTask.status === "cancelled"))
      throw new Error("This task cannot accept a follow-up yet.");
    if (
      input.quoteOf &&
      state.messages.find((message) => message.id === input.quoteOf)?.conversationId !==
        conversation.id
    )
      throw new Error("The quoted message no longer exists.");
    // A message in a roundtable thread always continues it; only a root message can start one.
    const epoch = input.threadId ? this.store.latestEpoch(conversation.id, input.threadId) : null;
    const starters =
      input.responseMode === "roundtable" && !epoch
        ? roundtableStartMembers({
            conversation,
            threadId: input.threadId,
            content: input.content,
            members: conversation.members.flatMap(
              (id) => state.assistants.find((assistant) => assistant.id === id) ?? [],
            ),
          })
        : null;
    return { followupTask, epoch, starters };
  }
  private queueFollowup(task: Task, message: Message): void {
    this.store.put("tasks", { ...task, status: "running", deadline: Date.now() + TASK_BUDGET_MS });
    this.store.put("turns", {
      id: randomUUID(),
      kind: "task_followup",
      conversationId: message.conversationId,
      threadId: message.threadId,
      assistantId: task.assistantId,
      prompt: message.content,
      prepared: false,
      accepted: false,
      triggerId: message.id,
      rootTriggerId: message.id,
      taskId: task.id,
      status: "queued",
      agentId: task.execution!.agentId,
      error: null,
    });
  }

  task(input: RpcInput<typeof startTask>): Task {
    const existing = this.store.get("tasks", input.id);
    if (existing) {
      if (
        existing.prompt !== input.prompt ||
        existing.serverId !== input.serverId ||
        existing.directory !== input.directory ||
        existing.conversationId !== input.conversationId
      )
        throw new Error("Task ID was already used for another task.");
      return existing;
    }
    const conversation = this.store.get("conversations", input.conversationId);
    if (!conversation?.members.includes(input.assistantId))
      throw new Error("Choose a member of this chat.");
    const task: Task = {
      ...input,
      status: "queued",
      execution: null,
      accepted: false,
      error: null,
      createdAt: Date.now(),
      deadline: Date.now() + TASK_BUDGET_MS,
      origin: "user",
    };
    this.store.transaction(() => {
      this.store.put("tasks", task);
      this.store.putMessage({
        id: `task:${task.id}`,
        conversationId: task.conversationId,
        senderId: "user",
        threadId: null,
        content: task.prompt,
        createdAt: Date.now(),
        taskId: task.id,
        kind: "user",
      });
    });
    this.kick();
    return task;
  }
  async cancel(id: string): Promise<Task> {
    const task = this.store.get("tasks", id);
    if (!task) throw new Error("Task no longer exists.");
    if (!LIVE.has(task.status) && !task.cancelPending) return task;
    const cancelled: Task = {
      ...task,
      status: "cancelled",
      cancelPending: Boolean(task.execution),
      pendingPermission: null,
      error: null,
    };
    this.store.transaction(() => {
      this.store.put("tasks", cancelled);
      for (const turn of this.store.snapshot().turns)
        if (turn.taskId === id && LIVE.has(turn.status))
          this.store.put("turns", { ...turn, status: "cancelled" });
    });
    this.stopWatch(id);
    if (task.execution && this.port) {
      const stopped = await this.port.cancel(task.execution.agentId, task.serverId);
      // An execution that was never created cannot be stopped yet; keep the cancel pending.
      if (!stopped && !task.accepted) return cancelled;
      const settled = { ...this.store.get("tasks", id)!, cancelPending: false };
      this.store.transaction(() => this.store.put("tasks", settled));
      return settled;
    }
    return cancelled;
  }

  // Hooks: record and enqueue; never await coordinator work from the plugin callback.
  onTurnStarted(event: AgentEvent): void {
    this.settle(event.agent.id);
  }
  onTurnEnded(event: TurnEndedEvent): void {
    this.settle(event.agent.id, { outcome: event.outcome });
  }
  onPermissionRequested(event: PermissionRequestedEvent): void {
    const permission = {
      requestId: event.request.id,
      title: event.request.title ?? event.request.name,
    };
    if (this.owns(event.agent.id))
      void this.queue.run(agentKey(event.agent.id), async () =>
        this.markAttention(event.agent.id, permission),
      );
  }
  onPermissionResolved(event: AgentEvent): void {
    if (this.owns(event.agent.id))
      void this.queue.run(agentKey(event.agent.id), async () =>
        this.markAttention(event.agent.id, null),
      );
  }
  onAgentGone(event: AgentEvent, reason: "archived" | "closed" = "closed"): void {
    this.settle(event.agent.id, { gone: reason });
  }
  // Hooks fire for every agent on the daemon; only executions this ledger created matter.
  private owns(agentId: string): boolean {
    return Boolean(this.store.getChatSessionByAgent(agentId) ?? this.store.get("tasks", agentId));
  }
  private settle(agentId: string, finish: Finish = {}): void {
    if (this.closed || !this.port || !this.owns(agentId)) return;
    void this.queue.run(agentKey(agentId), () => this.reconcile(agentId, finish));
  }
  private kick(): void {
    this.dispatcher.kick();
    this.scheduleTasks();
    this.armInbox();
  }
  // One timer, armed for the earliest pending peer batch.
  private armInbox(): void {
    if (this.inboxTimer) clearTimeout(this.inboxTimer);
    this.inboxTimer = null;
    const due = this.fanout.nextDeadline();
    if (this.closed || due === null) return;
    this.inboxTimer = setTimeout(
      () => {
        void this.queue.run("fanout", async () => {
          this.fanout.flushDue();
          this.kick();
        });
      },
      Math.max(0, due - this.now()),
    );
    this.inboxTimer.unref();
  }
  // A turn ended outside the settle path: the roundtable moves on to its next speaker.
  private afterTurn(turn: Turn): void {
    if (!turn.epochId || turn.status !== "failed") return;
    this.roundtable.advance(turn.epochId);
    this.kick();
  }
  /** Settles everything live, enforces task budgets and restarts stalled work. */
  async sweep(): Promise<void> {
    if (this.closed || !this.port) return;
    const state = this.store.snapshot();
    this.roundtable.advanceAll();
    this.fanout.flushDue();
    for (const turn of state.turns)
      if (turn.accepted && TURN_LIVE.has(turn.status)) this.settle(turn.agentId);
    for (const task of state.tasks) {
      if (!task.execution || !task.accepted || !LIVE.has(task.status)) continue;
      if (task.status !== "cancelled" && Date.now() >= task.deadline)
        void this.queue.run(agentKey(task.id), async () => void (await this.cancel(task.id)));
      else this.settle(task.execution.agentId);
    }
    this.kick();
    await this.queue.idle();
  }
  /** Resolves when all queued coordination has finished. */
  idle(): Promise<void> {
    return this.queue.idle();
  }
  private scheduleTasks(): void {
    if (this.closed || !this.port) return;
    const tasks = this.store.snapshot().tasks;
    const live = tasks.filter((task) => LIVE.has(task.status) && task.status !== "queued");
    const queued = tasks
      .filter((task) => task.status === "queued")
      .slice(0, Math.max(0, TASK_QUOTA - live.length));
    for (const task of [...live.filter((candidate) => !candidate.accepted), ...queued])
      void this.queue.run(agentKey(task.id), () => this.runTask(task.id));
    for (const task of tasks)
      if (task.status === "cancelled" && task.cancelPending)
        void this.queue.run(agentKey(task.id), async () => void (await this.cancel(task.id)));
    for (const task of live) if (task.accepted && task.execution) this.watch(task);
  }
  // Hooks only fire for this daemon; a task on another host is observed through its agent.
  private watch(task: Task): void {
    const port = this.port;
    if (!port || !task.execution || this.watches.has(task.id) || this.watching.has(task.id)) return;
    this.watching.add(task.id);
    const agentId = task.execution.agentId;
    void (async () => {
      try {
        if (await port.isLocal(task.serverId)) return;
        const stop = await port.watch(task.serverId, agentId, () => this.settle(agentId));
        if (this.closed || !LIVE.has(this.store.get("tasks", task.id)?.status ?? "cancelled"))
          stop();
        else this.watches.set(task.id, stop);
      } catch (error) {
        console.error("Bigbang task observation failed; the sweep will retry", error);
      } finally {
        this.watching.delete(task.id);
      }
    })();
  }
  private stopWatch(taskId: string): void {
    this.watches.get(taskId)?.();
    this.watches.delete(taskId);
  }

  private liveTurn(agentId: string): Turn | undefined {
    return this.store
      .snapshot()
      .turns.findLast(
        (turn) => turn.agentId === agentId && turn.accepted && TURN_LIVE.has(turn.status),
      );
  }
  private serverFor(turn: Turn): string | undefined {
    return turn.taskId ? this.store.get("tasks", turn.taskId)?.serverId : undefined;
  }
  // Reads the execution's timeline and brings the ledger in line with it. An execution or turn
  // that is not ours (a message typed in Studio, a finished turn) has no live ledger entry or no
  // anchor, so it is ignored.
  private async reconcile(agentId: string, finish: Finish): Promise<void> {
    if (this.closed || !this.port) return;
    try {
      const turns = this.store.snapshot().turns;
      const turn = this.liveTurn(agentId);
      const task = this.store.get("tasks", agentId);
      if (turn) await this.settleTurn(turn, finish);
      else if (
        task?.execution?.agentId === agentId &&
        !turns.some((item) => item.taskId === task.id && LIVE.has(item.status) && !item.accepted)
      )
        await this.settleTask(task, finish);
    } catch (error) {
      console.error("Bigbang settle failed; the sweep will retry", error);
      if (finish.gone) this.markGone(agentId, finish.gone);
    }
    this.kick();
  }
  private async settleTurn(turn: Turn, finish: Finish): Promise<void> {
    const read = await this.port!.readTurn(turn.agentId, turn.id, this.serverFor(turn));
    if (read.kind === "unknown") return;
    if (!read.ended) {
      const gone = goneReason(read, finish);
      if (gone) this.interrupt(turn, gone);
      // A superseded roundtable turn is stopped, not waited for.
      else if (this.roundtable.isStale(turn.epochId))
        await this.port!.cancel(turn.agentId, this.serverFor(turn));
      else this.setAttention(turn, read.permission);
      return;
    }
    const assistant = this.store.get("assistants", turn.assistantId);
    const task = turn.taskId ? this.store.get("tasks", turn.taskId) : null;
    const latestUser = this.store
      .snapshot()
      .messages.findLast(
        (message) =>
          message.conversationId === turn.conversationId &&
          message.threadId === turn.threadId &&
          message.senderId === "user",
      );
    let status: Turn["status"] = "completed";
    let error: string | null = null;
    if (task?.status === "cancelled") status = "cancelled";
    else if (!turn.taskId && latestUser?.id !== turn.seenUserId) {
      status = "cancelled";
      error = "Superseded by a newer message.";
    } else if (finish.outcome?.kind === "canceled") {
      status = "cancelled";
      error = finish.outcome.reason;
    } else if (finish.outcome?.kind === "failed" || read.error) {
      status = "failed";
      error = finish.outcome?.kind === "failed" ? finish.outcome.error.message : read.error;
    }
    const text = read.text.trim();
    this.store.transaction(() => {
      let final: Message | undefined;
      if (status === "completed" && assistant && text && !isPass(text)) {
        const id = `final:${turn.id}`;
        final = this.store.get("messages", id) ?? undefined;
        if (!final)
          final = this.store.putMessage({
            id,
            conversationId: turn.conversationId,
            threadId: turn.threadId,
            senderId: assistant.id,
            content: text,
            createdAt: this.now(),
            taskId: turn.taskId ?? null,
            kind: "final",
            turnId: turn.id,
            ...(turn.epochId ? { epochId: turn.epochId } : {}),
            ...(turn.round !== undefined ? { round: turn.round } : {}),
          });
      }
      const settled: Turn = {
        ...turn,
        status,
        error,
        ...(final ? { finalMessageId: final.id } : {}),
      };
      this.store.put("turns", settled);
      // What the assistant said may wake others; what the roundtable does next depends on it.
      if (final) this.fanout.onFinal(settled, final);
      if (turn.epochId) this.roundtable.advance(turn.epochId);
      const latest = task ? this.store.get("tasks", task.id) : null;
      if (latest && latest.status !== "cancelled")
        this.store.put("tasks", {
          ...latest,
          status: status === "completed" || status === "cancelled" ? status : "failed",
          error,
          pendingPermission: null,
        });
    });
    if (turn.taskId) this.stopWatch(turn.taskId);
  }
  private async settleTask(task: Task, finish: Finish): Promise<void> {
    const execution = task.execution;
    if (!execution || !LIVE.has(task.status) || task.status === "queued") return;
    const read = await this.port!.readTurn(execution.agentId, task.id, task.serverId);
    if (read.kind === "unknown") return;
    if (!read.ended) {
      const gone = goneReason(read, finish);
      if (gone) this.interrupt(task, gone);
      else this.setAttention(task, read.permission);
      return;
    }
    let status: Task["status"] = "completed";
    let error: string | null = null;
    if (finish.outcome?.kind === "canceled") {
      status = "cancelled";
      error = finish.outcome.reason;
    } else if (finish.outcome?.kind === "failed" || read.error) {
      status = "failed";
      error = finish.outcome?.kind === "failed" ? finish.outcome.error.message : read.error;
    }
    const text = read.text.trim();
    this.store.transaction(() => {
      const latest = this.store.get("tasks", task.id)!;
      if (latest.status === "cancelled") return;
      if (status === "completed" && text && !this.store.get("messages", `result:${task.id}`))
        this.store.putMessage({
          id: `result:${task.id}`,
          conversationId: task.conversationId,
          threadId: null,
          senderId: task.assistantId,
          content: text,
          createdAt: Date.now(),
          taskId: task.id,
          kind: "final",
          turnId: task.id,
        });
      this.store.put("tasks", {
        ...latest,
        status,
        error,
        accepted: true,
        pendingPermission: null,
      });
    });
    this.stopWatch(task.id);
  }
  // Moves a live turn or task between running and attention (waiting on an approval).
  private setAttention(target: Turn | Task, permission: PermissionInfo | null): void {
    const status = permission ? "attention" : "running";
    this.store.transaction(() => {
      if ("agentId" in target) {
        const turn = target;
        const fresh = this.store.get("turns", turn.id);
        if (fresh && TURN_LIVE.has(fresh.status) && fresh.status !== status)
          this.store.put("turns", { ...fresh, status, error: null });
        if (turn.taskId) this.setTaskAttention(turn.taskId, status, permission);
      } else this.setTaskAttention(target.id, status, permission);
    });
  }
  private setTaskAttention(
    taskId: string,
    status: "running" | "attention",
    permission: PermissionInfo | null,
  ): void {
    const task = this.store.get("tasks", taskId);
    if (!task || !LIVE.has(task.status) || task.status === "queued" || task.status === "creating")
      return;
    const pending = permissionOf(permission);
    if (task.status !== status || task.pendingPermission?.requestId !== pending?.requestId)
      this.store.put("tasks", { ...task, status, error: null, pendingPermission: pending });
  }
  private markAttention(agentId: string, permission: PermissionInfo | null): void {
    if (this.closed) return;
    const turn = this.liveTurn(agentId);
    if (turn) return this.setAttention(turn, permission);
    const task = this.store.get("tasks", agentId);
    if (task?.execution?.agentId === agentId && task.accepted) this.setAttention(task, permission);
  }
  // An accepted turn or task whose execution closed or was archived before it ended is terminal:
  // nothing is committed (the partial text is never guessed), the execution stays bound, and the
  // lane is free so the next message resumes the same agent.
  private interrupt(target: Turn | Task, reason: "archived" | "closed"): void {
    const error = reason === "archived" ? ARCHIVED_MESSAGE : INTERRUPTED_MESSAGE;
    this.store.transaction(() => {
      const taskId = "agentId" in target ? target.taskId : target.id;
      if ("agentId" in target) {
        this.store.put("turns", { ...target, status: "failed", error });
        if (target.epochId) this.roundtable.advance(target.epochId);
      }
      const task = taskId ? this.store.get("tasks", taskId) : null;
      if (task && LIVE.has(task.status))
        this.store.put("tasks", { ...task, status: "failed", error, pendingPermission: null });
    });
    const taskId = "agentId" in target ? target.taskId : target.id;
    if (taskId) this.stopWatch(taskId);
  }
  private markGone(agentId: string, reason: "archived" | "closed"): void {
    const turn = this.liveTurn(agentId);
    const task = this.store.get("tasks", agentId);
    if (turn) this.interrupt(turn, reason);
    else if (task && LIVE.has(task.status) && task.accepted) this.interrupt(task, reason);
  }
  private async runTask(taskId: string): Promise<void> {
    const port = this.port;
    let task = this.store.get("tasks", taskId);
    if (!port || this.closed || !task || !LIVE.has(task.status) || task.accepted) return;
    try {
      if (Date.now() >= task.deadline) {
        await this.cancel(task.id);
        return;
      }
      if (!task.execution) {
        this.store.transaction(() => this.store.put("tasks", { ...task!, status: "creating" }));
        const { workspaceId } = await port.createTaskWorkspace(taskSpec(task));
        if (this.closed) return;
        const latest = this.store.get("tasks", task.id)!;
        if (latest.status === "cancelled") return;
        task = {
          ...latest,
          execution: { serverId: task.serverId, workspaceId, agentId: task.id },
          status: "creating",
        };
        this.store.transaction(() => this.store.put("tasks", task!));
      }
      await port.createTaskAgent(taskSpec(task), task.execution!.workspaceId);
      const latest = this.store.get("tasks", task.id)!;
      if (latest.status === "cancelled") {
        this.store.transaction(() =>
          this.store.put("tasks", { ...latest, accepted: true, cancelPending: true }),
        );
        await this.cancel(task.id);
        return;
      }
      task = { ...latest, status: "running", accepted: true };
      this.store.transaction(() => this.store.put("tasks", task!));
      this.watch(task);
      // The hook for a quick turn may have fired before the task was recorded as accepted.
      this.settle(task.id);
    } catch (error) {
      if (!this.closed && this.store.get("tasks", taskId)?.status !== "cancelled")
        this.store.transaction(() =>
          this.store.put("tasks", {
            ...task!,
            status: failureStatus(error),
            error: errorMessage(error),
          }),
        );
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.inboxTimer) clearTimeout(this.inboxTimer);
    for (const stop of this.watches.values()) stop();
    this.watches.clear();
    await this.queue.idle();
    await this.port?.dispose().catch(() => undefined);
  }
}
