import type { PaseoAgentPermissionResponse, PaseoApi, PaseoAgentHandle } from "@getpaseo/client";
import { finalTextAfter, type ProjectionEntry, type TurnProjection } from "./projection";
import { taskBrief } from "./prompts";

export interface PermissionInfo {
  requestId: string;
  title: string;
}
/** `unknown`: the turn's anchor is not in the execution's timeline. */
export type TurnRead =
  | {
      kind: "unknown";
      /** The execution is still producing output, so the anchor may yet be the latest turn. */
      running: boolean;
    }
  | {
      kind: "found";
      /** The turn can no longer produce output. */
      ended: boolean;
      text: string;
      error: string | null;
      permission: PermissionInfo | null;
      /** The execution is closed; whether this turn finished is not confirmed. */
      agentClosed: boolean;
      /** The execution was archived; it cannot be resumed until restored. */
      agentArchived: boolean;
    };
export interface ChatAgentSpec {
  agentId: string;
  assistantId: string;
  assistantName: string;
  provider: string;
  systemPrompt: string;
  /** The machine the assistant is bound to; omitted means this daemon. */
  serverId?: string;
  /** The execution was created before; it must exist, and is never replaced. */
  created: boolean;
}
export interface TaskSpec {
  id: string;
  /** Short name for the workspace and agent; the prompt's first line when absent. */
  title?: string;
  prompt: string;
  provider: string;
  isolation: "worktree" | "directory";
  directory: string;
  serverId: string;
  memoryContext?: string;
}
/** An agent a task's executor started (labelled with the executor as its parent). */
export interface ChildAgent {
  id: string;
  /** Still doing work: running or starting up. */
  active: boolean;
  createdAt: string;
}
/** An agent in a workspace, as Studio collaboration sees it. */
export interface WorkspaceAgent {
  id: string;
  title: string | null;
  workspaceId: string | null;
  archived: boolean;
}
export interface DeliverOptions {
  /** Recorded as the message's id in the recipient's timeline. */
  messageId: string;
  /** The agent the message comes from, so the recipient sees who wrote it. */
  sourceAgentId?: string;
  sourceAgentServerId?: string;
}
export interface AssistantHomes {
  get(assistantId: string): { workspaceId: string; directory: string } | null;
  put(home: { assistantId: string; workspaceId: string; directory: string }): void;
  /** Creates the home directory on the assistant's machine and returns its path there. */
  prepare(assistantId: string, subdirectory: boolean): Promise<string>;
}

/** Everything the coordinator needs from Paseo. `serverId` omitted means this daemon. */
export interface ExecutionPort {
  isLocal(serverId: string): Promise<boolean>;
  ensureChatAgent(spec: ChatAgentSpec): Promise<void>;
  /** Idempotent per messageId: the daemon records it as the user_message anchor. */
  dispatch(agentId: string, text: string, messageId: string, serverId?: string): Promise<void>;
  readTurn(agentId: string, messageId: string, serverId?: string): Promise<TurnRead>;
  /** False when the execution does not exist. */
  cancel(agentId: string, serverId?: string): Promise<boolean>;
  respondToPermission(
    agentId: string,
    requestId: string,
    response: PaseoAgentPermissionResponse,
    serverId?: string,
  ): Promise<void>;
  createTaskWorkspace(task: TaskSpec): Promise<{ workspaceId: string }>;
  /** Creates the worker with its first prompt; the prompt's anchor is the task id. */
  createTaskAgent(task: TaskSpec, workspaceId: string): Promise<void>;
  /** Agents the execution started through Paseo, oldest first. */
  listChildren(agentId: string, serverId?: string): Promise<ChildAgent[]>;
  /** Agents in a workspace on a host, archived ones excluded. */
  listWorkspaceAgents(serverId: string | undefined, workspaceId: string): Promise<WorkspaceAgent[]>;
  agentInfo(serverId: string | undefined, agentId: string): Promise<WorkspaceAgent | null>;
  /** Sends a message into an agent without interrupting a turn in progress. */
  deliverMessage(
    serverId: string | undefined,
    agentId: string,
    text: string,
    options: DeliverOptions,
  ): Promise<void>;
  /** Calls `onChange` when the execution's state moves, for hosts whose hooks never fire here. */
  watch(serverId: string, agentId: string, onChange: () => void): Promise<() => void>;
  dispose(): Promise<void>;
}

type TimelineCursor = NonNullable<
  NonNullable<Parameters<PaseoAgentHandle["timeline"]["refetch"]>[0]>["cursor"]
>;
type AgentSnapshot = Awaited<ReturnType<PaseoAgentHandle["timeline"]["refetch"]>>["agent"];
const PAGE_LIMIT = 100;
// Label the daemon puts on agents created through an agent's MCP tools (packages/protocol).
const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
const MAX_PAGES = 8;

function isRunning(snapshot: AgentSnapshot): boolean {
  return (
    snapshot?.status === "running" ||
    snapshot?.status === "initializing" ||
    Boolean(snapshot?.activeTurn)
  );
}
function describeTurn(projection: TurnProjection, snapshot: AgentSnapshot): TurnRead {
  const running = isRunning(snapshot);
  const agentClosed = snapshot?.status === "closed" || Boolean(snapshot?.archivedAt);
  const open = !projection.closed;
  const pending = open ? snapshot?.pendingPermissions[0] : undefined;
  let error = projection.error;
  if (!error && open && snapshot?.status === "error")
    error = snapshot.lastError ?? "The execution reported an error.";
  return {
    kind: "found",
    ended: !agentClosed && (projection.closed || !running),
    text: projection.text,
    error,
    permission: pending ? { requestId: pending.id, title: pending.title ?? pending.name } : null,
    agentClosed,
    agentArchived: Boolean(snapshot?.archivedAt),
  };
}

function taskLabel(task: TaskSpec): string {
  return (task.title ?? task.prompt).slice(0, 60);
}
export function outcomeUnknown(message: string): Error {
  return Object.assign(new Error(message), { code: "agent_request_outcome_unknown" });
}

export class PaseoExecution implements ExecutionPort {
  private readonly remotes = new Map<string, Promise<PaseoApi>>();
  private self: Promise<string> | null = null;
  constructor(
    private readonly api: PaseoApi,
    private readonly homes: AssistantHomes,
  ) {}
  private serverId(): Promise<string> {
    this.self ??= this.api.hosts.list().then((directory) => directory.self.serverId);
    return this.self;
  }
  async isLocal(serverId: string): Promise<boolean> {
    return (await this.serverId()) === serverId;
  }
  private async on(serverId?: string): Promise<PaseoApi> {
    if (!serverId || (await this.isLocal(serverId))) return this.api;
    let client = this.remotes.get(serverId);
    if (!client) {
      client = this.api.hosts.client(serverId);
      this.remotes.set(serverId, client);
      client.catch(() => this.remotes.delete(serverId));
    }
    return client;
  }
  // Each assistant owns one background workspace for its home directory, on the machine the
  // assistant is bound to, so its chat executions stay out of the Studio sidebar. The daemon creates
  // a new record per directory create, so it cannot collide with a visible workspace; a reused
  // visible one would ignore `background`, which is detected and moved to a private subdirectory.
  private async assistantHome(spec: ChatAgentSpec, api: PaseoApi): Promise<string> {
    const known = this.homes.get(spec.assistantId);
    if (known) return known.workspaceId;
    let directory = await this.homes.prepare(spec.assistantId, false);
    let workspace = await this.createHome(
      api,
      spec,
      directory,
      `assistant-home:${spec.assistantId}`,
    );
    if (workspace.current()?.background === false) {
      directory = await this.homes.prepare(spec.assistantId, true);
      workspace = await this.createHome(
        api,
        spec,
        directory,
        `assistant-home:${spec.assistantId}:home`,
      );
    }
    this.homes.put({ assistantId: spec.assistantId, workspaceId: workspace.id, directory });
    return workspace.id;
  }
  private createHome(api: PaseoApi, spec: ChatAgentSpec, directory: string, key: string) {
    return api.workspaces.create({
      source: { kind: "directory", path: directory },
      background: true,
      idempotencyKey: key,
      title: `${spec.assistantName} · Home`,
    });
  }
  async ensureChatAgent(spec: ChatAgentSpec): Promise<void> {
    const api = await this.on(spec.serverId);
    const agent = api.agents.ref(spec.agentId);
    await agent.refresh();
    if (agent.archivedAt)
      throw new Error("This chat execution is archived. Restore it in Studio before continuing.");
    // A closed execution still exists and resumes under the same id when prompted.
    if (agent.current()) return;
    if (spec.created)
      throw new Error(
        "The existing chat execution is unavailable. It will not be replaced automatically.",
      );
    const workspaceId = await this.assistantHome(spec, api);
    await api.workspaces.ref(workspaceId).agents.create({
      agentId: spec.agentId,
      idempotencyKey: `chat-session:${spec.agentId}`,
      title: `${spec.assistantName} · Chat`,
      config: { provider: spec.provider, systemPrompt: spec.systemPrompt },
    });
  }
  async dispatch(
    agentId: string,
    text: string,
    messageId: string,
    serverId?: string,
  ): Promise<void> {
    const agent = (await this.on(serverId)).agents.ref(agentId);
    await agent.send(text, { messageId });
    await agent.refresh();
    if (agent.status === "closed")
      throw outcomeUnknown(
        "The execution closed before its result was confirmed. Inspect the existing execution in Studio; no replacement will be created.",
      );
  }
  async readTurn(agentId: string, messageId: string, serverId?: string): Promise<TurnRead> {
    const agent = (await this.on(serverId)).agents.ref(agentId);
    const pages: ProjectionEntry[][] = [];
    let cursor: TimelineCursor | undefined;
    let snapshot: AgentSnapshot = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await agent.timeline.refetch(
        page === 0
          ? { direction: "tail", limit: PAGE_LIMIT }
          : { direction: "before", cursor, limit: PAGE_LIMIT },
      );
      snapshot ??= result.agent;
      if (result.staleCursor || result.gap) break;
      pages.unshift(result.entries);
      const projection = finalTextAfter(pages.flat(), messageId);
      if (projection) {
        snapshot ??= (await agent.refresh())?.agent ?? null;
        return describeTurn(projection, snapshot);
      }
      if (!result.hasOlder || !result.startCursor) break;
      cursor = result.startCursor;
    }
    snapshot ??= (await agent.refresh())?.agent ?? null;
    return { kind: "unknown", running: isRunning(snapshot) };
  }
  async cancel(agentId: string, serverId?: string): Promise<boolean> {
    const agent = (await this.on(serverId)).agents.ref(agentId);
    if (!(await agent.refresh())) return false;
    await agent.cancel();
    return true;
  }
  async respondToPermission(
    agentId: string,
    requestId: string,
    response: PaseoAgentPermissionResponse,
    serverId?: string,
  ): Promise<void> {
    await (
      await this.on(serverId)
    ).agents
      .ref(agentId)
      .respondToPermission({ requestId, response });
  }
  async createTaskWorkspace(task: TaskSpec): Promise<{ workspaceId: string }> {
    const api = await this.on(task.serverId);
    const source =
      task.isolation === "worktree"
        ? {
            kind: "worktree" as const,
            cwd: task.directory,
            branchName: `bigbang/task-${task.id.slice(0, 8)}`,
          }
        : { kind: "directory" as const, path: task.directory };
    const workspace = await api.workspaces.create({
      idempotencyKey: `task-workspace:${task.id}`,
      source,
      title: taskLabel(task),
    });
    return { workspaceId: workspace.id };
  }
  async createTaskAgent(task: TaskSpec, workspaceId: string): Promise<void> {
    const api = await this.on(task.serverId);
    await api.workspaces.ref(workspaceId).agents.create({
      agentId: task.id,
      idempotencyKey: `task-agent:${task.id}`,
      config: { provider: task.provider },
      title: taskLabel(task),
      prompt: taskBrief(task),
      clientMessageId: task.id,
      // Observation only: authorization never reads labels.
      labels: { "bigbang.task": task.id },
    });
  }
  async listChildren(agentId: string, serverId?: string): Promise<ChildAgent[]> {
    const api = await this.on(serverId);
    const result = await api.agents.list({
      filter: { labels: { [PARENT_AGENT_ID_LABEL]: agentId } },
      includeBackground: true,
      page: { limit: 200 },
    });
    return result.entries
      .filter(({ agent }) => !agent.archivedAt && agent.labels[PARENT_AGENT_ID_LABEL] === agentId)
      .map(({ agent }) => ({
        id: agent.id,
        active: agent.status === "running" || agent.status === "initializing",
        createdAt: agent.createdAt,
      }))
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async listWorkspaceAgents(
    serverId: string | undefined,
    workspaceId: string,
  ): Promise<WorkspaceAgent[]> {
    const api = await this.on(serverId);
    const result = await api.agents.list({ includeBackground: true, page: { limit: 200 } });
    return result.entries
      .filter(({ agent }) => agent.workspaceId === workspaceId && !agent.archivedAt)
      .map(({ agent }) => ({
        id: agent.id,
        title: agent.title ?? null,
        workspaceId: agent.workspaceId ?? null,
        archived: false,
      }));
  }
  async agentInfo(serverId: string | undefined, agentId: string): Promise<WorkspaceAgent | null> {
    const agent = (await (await this.on(serverId)).agents.ref(agentId).refresh())?.agent;
    if (!agent) return null;
    return {
      id: agent.id,
      title: agent.title ?? null,
      workspaceId: agent.workspaceId ?? null,
      archived: Boolean(agent.archivedAt),
    };
  }
  async deliverMessage(
    serverId: string | undefined,
    agentId: string,
    text: string,
    options: DeliverOptions,
  ): Promise<void> {
    await (await this.on(serverId)).agents.ref(agentId).send(text, {
      messageId: options.messageId,
      activeTurnBehavior: "steer",
      ...(options.sourceAgentId ? { sourceAgentId: options.sourceAgentId } : {}),
      ...(options.sourceAgentServerId ? { sourceAgentServerId: options.sourceAgentServerId } : {}),
    });
  }
  async watch(serverId: string, agentId: string, onChange: () => void): Promise<() => void> {
    const api = await this.on(serverId);
    const listing = await api.agents.list({
      filter: { labels: { "bigbang.task": agentId } },
      includeBackground: true,
      subscribe: {},
    });
    const stop = api.agents.ref(agentId).subscribe(onChange);
    return () => {
      stop();
      void listing.subscription.release().catch(() => undefined);
    };
  }
  async dispose(): Promise<void> {
    const remotes = await Promise.allSettled(this.remotes.values());
    this.remotes.clear();
    await Promise.allSettled(
      remotes.flatMap((remote) => (remote.status === "fulfilled" ? [remote.value.dispose()] : [])),
    );
  }
}
