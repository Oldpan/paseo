import { resolveOrdinaryChannelRoute } from "./routing";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PaseoApi, PaseoAgentHandle } from "@getpaseo/client";
import type { RpcInput } from "@getpaseo/plugin";
import {
  type Assistant,
  type Conversation,
  type Task,
  type Turn,
  sendMessage,
  startTask,
} from "../shared/contracts";
import { findMentionedAgents } from "./mentions";
import { ChatStore } from "./store";
import {
  assistantInstructions,
  bindChatSession,
  chatPrompt,
  unseenMessages,
  runnableChatTurns,
  restoreChatSessions,
} from "./chat-sessions";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function failureStatus(error: unknown): "failed" | "unknown" {
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
function finishedStatus(status: string): "attention" | "failed" | "completed" {
  if (status === "permission") return "attention";
  if (status === "error") return "failed";
  return "completed";
}
const LIVE = new Set(["queued", "creating", "running", "attention", "unknown"]);
function requireConfirmedChatExecution(turn: Turn, agent: PaseoAgentHandle): void {
  if (turn.chatSessionId && agent.status === "closed")
    throw Object.assign(
      new Error(
        "The chat execution closed before its result was confirmed. Inspect the existing execution in Studio; no replacement will be created.",
      ),
      { code: "agent_request_outcome_unknown" },
    );
}

export class Coordinator {
  private api: PaseoApi | null = null;
  private readonly busy = new Set<string>();
  private readonly operations = new Set<Promise<void>>();
  private closed = false;
  private restoredSessions = false;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    readonly store: ChatStore,
    private readonly home: string,
  ) {
    this.timer = setInterval(() => void this.pump(), 1500);
  }
  attach(api: PaseoApi): void {
    this.api = api;
    if (!this.restoredSessions) {
      restoreChatSessions(this.store);
      this.restoredSessions = true;
    }
    void this.pump();
  }
  saveAssistant(assistant: Assistant): Assistant {
    const directory = path.join(this.home, "assistants", assistant.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(directory, "MEMORY.md"), assistant.memory, { mode: 0o600 });
    this.store.transaction(() => this.store.put("assistants", assistant));
    return assistant;
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
    const members = state.assistants.filter((assistant) =>
      conversation.members.includes(assistant.id),
    );
    const mentioned = findMentionedAgents(
      input.content,
      members.map((assistant) => ({ ...assistant, agentId: assistant.id })),
    );
    const recent = state.messages
      .filter(
        (message) =>
          message.conversationId === conversation.id &&
          message.threadId === input.threadId &&
          message.senderId !== "user" &&
          message.createdAt > Date.now() - 60 * 60 * 1000,
      )
      .toReversed()
      .map((message) => message.senderId);
    const route = resolveOrdinaryChannelRoute({
      memberAgentIds: new Set(conversation.members),
      mentionedAgentIds: mentioned.map((member) => member.id),
      recentParticipantAgentIds: recent,
      firstMemberAgentId: conversation.members[0],
    });
    const routed = members.filter((member) => route?.dispatchAgentIds.includes(member.id));
    let responders = routed;
    if (conversation.roundtable) responders = mentioned.length ? mentioned : members;
    const taskRoot = input.threadId ? this.store.get("messages", input.threadId) : null;
    const followupTask = taskRoot?.taskId ? this.store.get("tasks", taskRoot.taskId) : null;
    if (followupTask && (!followupTask.execution || followupTask.status === "cancelled"))
      throw new Error("This task cannot accept a follow-up yet.");
    let orderedResponders = responders;
    if (conversation.roundtable)
      orderedResponders = Array.from({ length: 3 }, (_, round) => [
        ...responders.slice(round % responders.length),
        ...responders.slice(0, round % responders.length),
      ])
        .flat()
        .slice(0, 10);
    if (followupTask)
      orderedResponders = members.filter((member) => member.id === followupTask.assistantId);
    this.store.transaction(() => {
      this.store.put("messages", {
        ...input,
        senderId: "user",
        createdAt: Date.now(),
        taskId: null,
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
      if (followupTask)
        this.store.put("tasks", {
          ...followupTask,
          status: "running",
          deadline: Date.now() + 30 * 60 * 1000,
        });
      for (const assistant of orderedResponders) {
        const id = randomUUID();
        const session = followupTask
          ? null
          : bindChatSession(this.store, conversation.id, input.threadId, assistant);
        this.store.put("turns", {
          id,
          conversationId: conversation.id,
          threadId: input.threadId,
          assistantId: assistant.id,
          prompt: input.content,
          prepared: false,
          accepted: false,
          triggerId: input.id,
          taskId: followupTask?.id ?? null,
          status: "queued",
          agentId: followupTask?.execution?.agentId ?? session!.agentId,
          chatSessionId: session?.id,
          error: null,
        });
      }
    });
    void this.pump();
    return { id: input.id };
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
      deadline: Date.now() + 30 * 60 * 1000,
    };
    this.store.transaction(() => {
      this.store.put("tasks", task);
      this.store.put("messages", {
        id: `task:${task.id}`,
        conversationId: task.conversationId,
        senderId: "user",
        threadId: null,
        content: task.prompt,
        createdAt: Date.now(),
        taskId: task.id,
      });
    });
    void this.pump();
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
      error: null,
    };
    this.store.transaction(() => this.store.put("tasks", cancelled));
    if (task.execution && this.api) {
      const api = await this.target(task.serverId);
      try {
        const agent = api.agents.ref(task.execution.agentId);
        if (!task.accepted && !(await agent.refresh())) return cancelled;
        await agent.cancel();
        const stopped = { ...this.store.get("tasks", id)!, cancelPending: false };
        this.store.transaction(() => this.store.put("tasks", stopped));
        return stopped;
      } finally {
        if (api !== this.api) await api.dispose();
      }
    }
    return cancelled;
  }
  private async target(serverId: string): Promise<PaseoApi> {
    if (!this.api) throw new Error("Coordinator is not connected.");
    const directory = await this.api.hosts.list();
    return directory.self.serverId === serverId ? this.api : this.api.hosts.client(serverId);
  }
  private async pump(): Promise<void> {
    if (this.closed || !this.api) return;
    const state = this.store.snapshot();
    const liveTasks = state.tasks.filter(
      (task) => LIVE.has(task.status) && task.status !== "queued",
    );
    const queued = state.tasks
      .filter((task) => task.status === "queued")
      .slice(0, Math.max(0, 2 - liveTasks.length));
    const followed = new Set(
      state.turns.filter((turn) => turn.taskId && LIVE.has(turn.status)).map((turn) => turn.taskId),
    );
    for (const task of [...liveTasks, ...queued].filter((candidate) => !followed.has(candidate.id)))
      this.launch(task.id, () => this.runTask(task));
    for (const task of state.tasks.filter(
      (candidate) => candidate.status === "cancelled" && candidate.cancelPending,
    ))
      this.launch(`cancel:${task.id}`, async () => {
        await this.cancel(task.id);
      });
    for (const turn of runnableChatTurns(state.turns)) {
      const key = `${turn.conversationId}:${turn.threadId ?? "main"}`;
      this.launch(key, () => this.runTurn(turn));
    }
  }
  private launch(key: string, operation: () => Promise<void>): void {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    const pending = operation()
      .catch((error) => console.error("Bigbang coordination failed", error))
      .finally(() => {
        this.busy.delete(key);
        this.operations.delete(pending);
      });
    this.operations.add(pending);
  }
  private prepareTurn(turn: Turn, assistant: Assistant): Turn {
    if (turn.prepared && (turn.taskId || turn.chatSessionId)) return turn;
    if (!turn.taskId) return this.prepareChatTurn(turn, assistant);
    const history = this.store
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
    this.store.transaction(() => this.store.put("turns", prepared));
    return prepared;
  }
  private prepareChatTurn(turn: Turn, assistant: Assistant): Turn {
    if (!turn.chatSessionId && turn.status !== "queued")
      throw Object.assign(
        new Error(
          "This earlier chat turn has an unconfirmed execution. Inspect its existing agent in Studio before continuing; it will not be sent again.",
        ),
        { code: "agent_request_outcome_unknown" },
      );
    const session = this.store.transaction(() =>
      bindChatSession(this.store, turn.conversationId, turn.threadId, assistant),
    );
    if (session.provider !== assistant.provider)
      throw new Error(
        "This chat already has an execution with another model. Keep that model or start a new chat; it will not create a second execution automatically.",
      );
    const state = this.store.snapshot();
    const delta = unseenMessages(state.messages, session, state.turns);
    const instructions = assistantInstructions(assistant);
    let prompt =
      chatPrompt(delta, assistant, state.assistants) ||
      "Continue this roundtable discussion with another useful contribution.";
    if (instructions !== session.lastInstructions)
      prompt = `Updated assistant instructions:\n${instructions}\n\n${prompt}`;
    const history = state.messages.filter(
      (message) =>
        message.conversationId === turn.conversationId && message.threadId === turn.threadId,
    );
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
      seenUserId: history.findLast((message) => message.senderId === "user")?.id,
      status: "creating",
    };
    this.store.transaction(() => this.store.put("turns", prepared));
    return prepared;
  }
  private async chatAgent(
    api: PaseoApi,
    turn: Turn,
    assistant: Assistant,
  ): Promise<PaseoAgentHandle> {
    const session = this.store.getChatSession(turn.chatSessionId!);
    if (!session) throw new Error("Chat execution binding is missing.");
    let agent = api.agents.ref(session.agentId);
    await agent.refresh();
    if (agent.archivedAt)
      throw new Error("This chat execution is archived. Restore it in Studio before continuing.");
    if (session.created && !agent.current())
      throw new Error(
        "The existing chat execution is unavailable. It will not be replaced automatically.",
      );
    if (!session.created) {
      if (!agent.current()) {
        const directory = path.join(this.home, "assistants", assistant.id);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        agent = await api.agents.create({
          agentId: session.agentId,
          idempotencyKey: `chat-session:${session.agentId}`,
          cwd: directory,
          title: `${assistant.name} · Chat`,
          config: { provider: session.provider, systemPrompt: session.systemPrompt },
        });
      }
      this.store.transaction(() => this.store.putChatSession({ ...session, created: true }));
    }
    return agent;
  }
  private advanceChatContext(turn: Turn, messageId: string | undefined): void {
    if (!turn.chatSessionId || !messageId) return;
    const session = this.store.getChatSession(turn.chatSessionId);
    if (session)
      this.store.putChatSession({
        ...session,
        lastMessageId: messageId,
        lastInstructions: turn.systemPrompt ?? session.lastInstructions,
      });
  }
  private async dispatchTurn(
    api: PaseoApi,
    turn: Turn,
    assistant: Assistant,
  ): Promise<PaseoAgentHandle> {
    if (turn.chatSessionId) {
      const agent = await this.chatAgent(api, turn, assistant);
      if (!turn.accepted) {
        await agent.send(turn.prompt, { messageId: turn.id });
        await agent.refresh();
      }
      return agent;
    }
    if (turn.accepted) return api.agents.ref(turn.agentId);
    if (turn.taskId) {
      const agent = api.agents.ref(turn.agentId);
      await agent.send(turn.prompt, { messageId: turn.id });
      return agent;
    }
    throw new Error("Chat execution binding is missing.");
  }
  private finishTurn(
    turn: Turn,
    assistant: Assistant,
    result: Awaited<ReturnType<PaseoAgentHandle["waitForFinish"]>>,
  ): void {
    const latestUser = this.store
      .snapshot()
      .messages.findLast(
        (message) =>
          message.conversationId === turn.conversationId &&
          message.threadId === turn.threadId &&
          message.senderId === "user",
      );
    if (!turn.taskId && latestUser?.id !== turn.seenUserId) {
      this.store.transaction(() =>
        this.store.put("turns", {
          ...turn,
          status: "cancelled",
          error: "Superseded by a newer message.",
        }),
      );
      return;
    }
    const status = finishedStatus(result.status);
    this.store.transaction(() => {
      this.store.put("turns", { ...turn, status, error: result.error });
      if (turn.taskId) {
        const latest = this.store.get("tasks", turn.taskId);
        if (latest) this.store.put("tasks", { ...latest, status, error: result.error });
      }
      if (status === "completed" && result.lastMessage) {
        this.store.put("messages", {
          id: `reply:${turn.id}`,
          conversationId: turn.conversationId,
          threadId: turn.threadId,
          senderId: assistant.id,
          content: result.lastMessage,
          createdAt: Date.now(),
          taskId: turn.taskId ?? null,
        });
      }
    });
  }
  private cancelledTurnTask(turn: Turn): boolean {
    return Boolean(turn.taskId && this.store.get("tasks", turn.taskId)?.status === "cancelled");
  }
  private async runTurn(turn: Turn): Promise<void> {
    if (!this.api) return;
    const assistant = this.store.get("assistants", turn.assistantId);
    if (!assistant) return;
    let api: PaseoApi | null = null;
    try {
      const task = turn.taskId ? this.store.get("tasks", turn.taskId) : null;
      if (task && Date.now() >= task.deadline && task.status !== "cancelled")
        await this.cancel(task.id);
      if (task && this.store.get("tasks", task.id)?.status === "cancelled") {
        this.store.transaction(() => this.store.put("turns", { ...turn, status: "cancelled" }));
        return;
      }
      turn = this.prepareTurn(turn, assistant);
      api = task ? await this.target(task.serverId) : this.api;
      const agent = await this.dispatchTurn(api, turn, assistant);
      if (this.closed) return;
      requireConfirmedChatExecution(turn, agent);
      turn = { ...turn, accepted: true, status: "running" };
      this.store.transaction(() => {
        this.store.put("turns", turn);
        this.advanceChatContext(turn, turn.contextThroughId);
      });
      const result = await agent.waitForFinish(500);
      if (this.closed || result.status === "timeout") return;
      requireConfirmedChatExecution(turn, agent);
      if (this.cancelledTurnTask(turn)) return;
      this.finishTurn(turn, assistant, result);
    } catch (error) {
      if (!this.closed)
        this.store.transaction(() =>
          this.store.put("turns", {
            ...turn,
            status: failureStatus(error),
            error: errorMessage(error),
          }),
        );
    } finally {
      if (api && api !== this.api) await api.dispose();
    }
  }
  private async prepareTaskWorkspace(api: PaseoApi, task: Task): Promise<Task | null> {
    if (!task.execution) {
      this.store.transaction(() => this.store.put("tasks", { ...task, status: "creating" }));
      const source =
        task.isolation === "worktree"
          ? {
              kind: "worktree" as const,
              cwd: task.directory,
              branchName: `codex/bigbang-${task.id.slice(0, 8)}`,
            }
          : { kind: "directory" as const, path: task.directory };
      const workspace = await api.workspaces.create({
        idempotencyKey: `task-workspace:${task.id}`,
        source,
        title: task.prompt.slice(0, 60),
      });
      if (this.closed) return null;
      const latest = this.store.get("tasks", task.id)!;
      if (latest.status === "cancelled") return null;
      task = {
        ...latest,
        execution: { serverId: task.serverId, workspaceId: workspace.id, agentId: task.id },
        status: "creating",
      };
      this.store.transaction(() => this.store.put("tasks", task));
    }
    return task;
  }
  private async runTask(task: Task): Promise<void> {
    let api: PaseoApi | null = null;
    try {
      if (Date.now() >= task.deadline) {
        await this.cancel(task.id);
        return;
      }
      api = await this.target(task.serverId);
      if (this.closed || this.store.get("tasks", task.id)?.status === "cancelled") return;
      let agent: PaseoAgentHandle;
      const prepared = await this.prepareTaskWorkspace(api, task);
      if (!prepared) return;
      task = prepared;
      const execution = task.execution!;
      if (!task.accepted) {
        agent = await api.workspaces.ref(execution.workspaceId).agents.create({
          agentId: execution.agentId,
          idempotencyKey: `task-agent:${task.id}`,
          config: { provider: task.provider },
          title: task.prompt.slice(0, 60),
          prompt: task.prompt,
        });
        const latest = this.store.get("tasks", task.id)!;
        if (latest.status === "cancelled") {
          this.store.transaction(() =>
            this.store.put("tasks", { ...latest, accepted: true, cancelPending: true }),
          );
          await this.cancel(task.id);
          return;
        }
        task = { ...latest, status: "running", accepted: true };
        this.store.transaction(() => this.store.put("tasks", task));
      } else agent = api.agents.ref(execution.agentId);
      const result = await agent.waitForFinish(500);
      if (
        this.closed ||
        result.status === "timeout" ||
        this.store.get("tasks", task.id)?.status === "cancelled"
      )
        return;
      const status = finishedStatus(result.status);
      this.store.transaction(() => {
        this.store.put("tasks", { ...task, status, error: result.error });
        if (status === "completed" && result.lastMessage)
          this.store.put("messages", {
            id: `result:${task.id}`,
            conversationId: task.conversationId,
            threadId: null,
            senderId: task.assistantId,
            content: result.lastMessage,
            createdAt: Date.now(),
            taskId: task.id,
          });
      });
    } catch (error) {
      if (!this.closed && this.store.get("tasks", task.id)?.status !== "cancelled")
        this.store.transaction(() =>
          this.store.put("tasks", {
            ...task,
            status: failureStatus(error),
            error: errorMessage(error),
          }),
        );
    } finally {
      if (api && api !== this.api) await api.dispose();
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.operations);
  }
}
