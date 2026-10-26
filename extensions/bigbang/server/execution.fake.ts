import type { PaseoAgentPermissionResponse } from "@getpaseo/client";
import type { ChatAgentSpec, ExecutionPort, PermissionInfo, TaskSpec, TurnRead } from "./execution";
import { finalTextAfter, type ProjectionEntry } from "./projection";

interface FakeAgent {
  serverId: string | undefined;
  entries: ProjectionEntry[];
  running: boolean;
  closed: boolean;
  archived: boolean;
  permission: PermissionInfo | null;
}

/** In-memory ExecutionPort for tests: a timeline per agent, no daemon. */
export class FakeExecution implements ExecutionPort {
  readonly agents = new Map<string, FakeAgent>();
  readonly sent: Array<{ agentId: string; text: string; messageId: string }> = [];
  readonly cancelled: string[] = [];
  readonly permissionResponses: Array<{ agentId: string; requestId: string }> = [];
  readonly watchers = new Map<string, Set<() => void>>();
  localServerId = "local";
  /** Fails the next dispatch after recording it (the daemon may have accepted the message). */
  failNextDispatch: Error | null = null;
  /** Fails the next dispatch before recording anything. */
  rejectNextDispatch: Error | null = null;
  private agent(agentId: string, serverId?: string): FakeAgent {
    let agent = this.agents.get(agentId);
    if (!agent) {
      agent = {
        serverId,
        entries: [],
        running: false,
        closed: false,
        archived: false,
        permission: null,
      };
      this.agents.set(agentId, agent);
    }
    return agent;
  }
  async isLocal(serverId: string): Promise<boolean> {
    return serverId === this.localServerId;
  }
  async ensureChatAgent(spec: ChatAgentSpec): Promise<void> {
    if (!this.agents.has(spec.agentId) && spec.created)
      throw new Error("The existing chat execution is unavailable.");
    if (this.agents.get(spec.agentId)?.archived)
      throw new Error("This chat execution is archived. Restore it in Studio before continuing.");
    this.agent(spec.agentId);
  }
  async dispatch(
    agentId: string,
    text: string,
    messageId: string,
    serverId?: string,
  ): Promise<void> {
    if (this.rejectNextDispatch) {
      const error = this.rejectNextDispatch;
      this.rejectNextDispatch = null;
      throw error;
    }
    const agent = this.agent(agentId, serverId);
    this.sent.push({ agentId, text, messageId });
    if (
      !agent.entries.some(
        ({ item }) => item.type === "user_message" && item.messageId === messageId,
      )
    )
      agent.entries.push({ item: { type: "user_message", text, messageId } });
    agent.running = true;
    // Prompting a closed (not archived) execution resumes it under the same id.
    agent.closed = false;
    if (this.failNextDispatch) {
      const error = this.failNextDispatch;
      this.failNextDispatch = null;
      throw error;
    }
  }
  async readTurn(agentId: string, messageId: string): Promise<TurnRead> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");
    const projection = finalTextAfter(agent.entries, messageId);
    if (!projection) return { kind: "unknown" };
    return {
      kind: "found",
      ended: !agent.closed && !agent.archived && (projection.closed || !agent.running),
      text: projection.text,
      error: projection.error,
      permission: projection.closed ? null : agent.permission,
      agentClosed: agent.closed || agent.archived,
      agentArchived: agent.archived,
    };
  }
  async cancel(agentId: string): Promise<boolean> {
    if (!this.agents.has(agentId)) return false;
    this.cancelled.push(agentId);
    return true;
  }
  async respondToPermission(
    agentId: string,
    requestId: string,
    _response: PaseoAgentPermissionResponse,
  ): Promise<void> {
    this.permissionResponses.push({ agentId, requestId });
  }
  async createTaskWorkspace(task: TaskSpec): Promise<{ workspaceId: string }> {
    return { workspaceId: `wks_${task.id.slice(0, 16)}` };
  }
  async createTaskAgent(task: TaskSpec): Promise<void> {
    const agent = this.agent(task.id, task.serverId);
    agent.entries.push({ item: { type: "user_message", text: task.prompt, messageId: task.id } });
    agent.running = true;
  }
  async watch(_serverId: string, agentId: string, onChange: () => void): Promise<() => void> {
    const set = this.watchers.get(agentId) ?? new Set();
    set.add(onChange);
    this.watchers.set(agentId, set);
    return () => void set.delete(onChange);
  }
  async dispose(): Promise<void> {}

  /** Appends assistant output the agent produced, without ending the turn. */
  say(agentId: string, text: string, messageId?: string): void {
    this.agent(agentId).entries.push({
      item: { type: "assistant_message", text, ...(messageId ? { messageId } : {}) },
    });
  }
  /** Ends the running turn, as the daemon does before it emits agent.turn_ended. */
  finish(agentId: string): void {
    this.agent(agentId).running = false;
    this.agent(agentId).permission = null;
  }
  /** Someone typed in Studio: a user_message with an id this coordinator never issued. */
  studioTyped(agentId: string, text: string, messageId = `studio-${this.sent.length}`): void {
    this.agent(agentId).entries.push({ item: { type: "user_message", text, messageId } });
  }
  askPermission(agentId: string, permission: PermissionInfo): void {
    this.agent(agentId).permission = permission;
  }
  /** Simulates the remote host emitting an agent update. */
  emit(agentId: string): void {
    for (const onChange of this.watchers.get(agentId) ?? []) onChange();
  }
}
