import { defineAgentTool, type PluginAgentToolContract } from "@getpaseo/plugin";
import { z } from "zod";
import type { Assistant, Task } from "../shared/contracts";
import type { Coordinator } from "./coordinator";
import { describeTargets } from "./chat-sessions";
import {
  deterministicTaskId,
  excerpt,
  resultMessageId,
  taskThreadId,
  taskTitle,
} from "./task-events";

const targetSchema = z.object({
  serverId: z.string().describe("The host (serverId) of the project."),
  directory: z.string().describe("The project's directory on that host."),
});
const isolationSchema = z.enum(["worktree", "directory"]);
const authorizedTargetSchema = targetSchema.extend({
  isolation: isolationSchema,
  label: z.string().optional().describe("The machine's name."),
});

export const startTaskTool = defineAgentTool({
  name: "start_task",
  description:
    "Start a project task: a separate coding agent that works in one of the projects the user has authorized for you. " +
    "Use it for any work that changes or inspects project files, runs commands or tests, or needs more than a quick answer; do not do that work in this chat. " +
    "Put a complete, self-contained brief in `prompt` (goal, context, constraints, what done looks like): the task agent cannot see this conversation. " +
    "If the project, the scope or the key requirements are unclear, ask the user first instead of guessing. " +
    "Call task_status to see the projects you may use. The result is posted in the task's thread and you are told when the task ends.",
  input: z.object({
    prompt: z.string().trim().min(1).max(20_000).describe("The full brief for the task agent."),
    title: z.string().trim().min(1).max(80).optional().describe("A short name for the task."),
    target: targetSchema
      .optional()
      .describe("One of your authorized projects. Optional when you have exactly one."),
    provider: z
      .string()
      .regex(/^[^/]+\/.+$/)
      .optional()
      .describe("The task agent's provider/model. Defaults to yours."),
    isolation: isolationSchema
      .optional()
      .describe("Use worktree to work on a separate copy. Defaults to the project's setting."),
  }),
  output: z.object({
    taskId: z.string(),
    title: z.string(),
    status: z.string(),
    target: authorizedTargetSchema,
    message: z.string(),
  }),
});

export const taskStatusTool = defineAgentTool({
  name: "task_status",
  description:
    "Report the tasks you started in this chat (status, result summary, pending approval) and the projects you may start tasks in. " +
    "Pass taskId for one task.",
  input: z.object({ taskId: z.string().optional() }),
  output: z.object({
    tasks: z.array(
      z.object({
        taskId: z.string(),
        title: z.string(),
        status: z.string(),
        error: z.string().nullable(),
        stoppedByBudget: z.boolean(),
        waitingForApproval: z.string().nullable(),
        result: z.string().nullable(),
        thread: z.string(),
      }),
    ),
    targets: z.array(authorizedTargetSchema),
    limits: z.object({
      maxParallelTasks: z.number(),
      maxWorkAgentsPerTask: z.number(),
      autonomousBudgetMinutes: z.number(),
    }),
  }),
});

/** The verified agent making a call, and the machine whose daemon verified it. */
export interface ToolCaller {
  agentId: string;
  /** The member machine that relayed the call; absent when the agent runs on the coordinator. */
  serverId?: string;
}
interface Context {
  caller: ToolCaller;
}
const normalize = (directory: string) => directory.trim().replace(/\/+$/, "") || "/";

interface Caller {
  assistant: Assistant;
  conversationId: string;
  threadId: string | null;
}

// The caller is the verified agent id the daemon hands over. Which assistant that is, which chat
// it is in and what it may touch come from the ledger, never from tool input or agent labels.
function authorize(coordinator: Coordinator, caller: ToolCaller): Caller {
  const { store } = coordinator;
  if (store.get("tasks", caller.agentId))
    throw new Error("Task agents cannot start tasks. Report what you need in your result instead.");
  const session = store.getChatSessionByAgent(caller.agentId);
  // An agent id is only meaningful on the machine that verified it.
  if (!session || (session.serverId ?? null) !== (caller.serverId ?? null))
    throw new Error("This tool is only available to a Chat assistant in its chat.");
  const assistant = store.get("assistants", session.assistantId);
  if (!assistant) throw new Error("This assistant no longer exists.");
  const conversation = store.get("conversations", session.conversationId);
  if (!conversation?.members.includes(assistant.id))
    throw new Error("You are no longer a member of this chat, so you cannot start tasks from it.");
  if (!assistant.autonomy?.enabled)
    throw new Error(
      "You are not allowed to start tasks on your own. Ask the user to enable autonomy for you, or suggest that they start the task.",
    );
  return { assistant, conversationId: conversation.id, threadId: session.threadId };
}
function resolveTarget(assistant: Assistant, requested?: z.output<typeof targetSchema>) {
  const targets = assistant.autonomy?.targets ?? [];
  if (targets.length === 0)
    throw new Error(
      "You have no authorized projects. Ask the user to add one in your settings before starting tasks.",
    );
  if (!requested) {
    if (targets.length === 1) return targets[0];
    throw new Error(
      `Choose a target. Your authorized projects: ${describeTargets(assistant)}. Pass it as target {serverId, directory}.`,
    );
  }
  const match = targets.find(
    (target) =>
      target.serverId === requested.serverId &&
      normalize(target.directory) === normalize(requested.directory),
  );
  if (!match)
    throw new Error(
      `That project is not authorized for you. Your authorized projects: ${describeTargets(assistant)}. Ask the user before using another one.`,
    );
  return match;
}
function report(task: Task, message: string) {
  return {
    taskId: task.id,
    title: taskTitle(task),
    status: task.status,
    target: { serverId: task.serverId, directory: task.directory, isolation: task.isolation },
    message,
  };
}

export function startTaskHandler(coordinator: Coordinator) {
  return (input: z.output<typeof startTaskTool.input>, context: Context) => {
    const caller = authorize(coordinator, context.caller);
    const target = resolveTarget(caller.assistant, input.target);
    // A worktree is the stricter choice; the project's own setting may only be tightened.
    if (input.isolation === "directory" && target.isolation === "worktree")
      throw new Error(
        "This project is set to use a separate worktree; a task cannot work in the directory directly.",
      );
    // A tool call happens inside a reply; outside one there is no request to attach the task to.
    const turn = coordinator.liveChatTurn(context.caller.agentId);
    if (!turn)
      throw new Error("Tasks can only be started while you are replying to a chat message.");
    const id = deterministicTaskId(turn.id, input.prompt);
    const existing = coordinator.store.get("tasks", id);
    if (existing) return report(existing, "This request already started this task.");
    const task = coordinator.startAssistantTask({
      id,
      conversationId: caller.conversationId,
      threadId: caller.threadId,
      assistant: caller.assistant,
      title: input.title ?? taskTitle({ prompt: input.prompt }),
      prompt: input.prompt,
      serverId: target.serverId,
      directory: target.directory,
      provider: input.provider ?? caller.assistant.provider,
      isolation: input.isolation ?? target.isolation,
      requestedByTurnId: turn.id,
    });
    return report(
      task,
      coordinator.isQueuedBehindLimit(task.id)
        ? "Queued: the task limit is reached. It starts automatically when a slot frees up, and you will be told when it ends."
        : "Started. Progress and the result are in the task thread, and you will be told when it ends. Tell the user briefly what you started.",
    );
  };
}

export function taskStatusHandler(coordinator: Coordinator) {
  return (input: z.output<typeof taskStatusTool.input>, context: Context) => {
    const caller = authorize(coordinator, context.caller);
    const own = coordinator.store
      .snapshot()
      .tasks.filter(
        (task) =>
          task.origin === "assistant" &&
          task.assistantId === caller.assistant.id &&
          task.conversationId === caller.conversationId,
      );
    const tasks = input.taskId ? own.filter((task) => task.id === input.taskId) : own;
    if (input.taskId && tasks.length === 0)
      throw new Error("You did not start that task in this chat.");
    return {
      tasks: tasks.map((task) => {
        const result = coordinator.store.get("messages", resultMessageId(task.id))?.content;
        return {
          taskId: task.id,
          title: taskTitle(task),
          status: task.status,
          error: task.error,
          stoppedByBudget: task.stopReason === "budget",
          waitingForApproval: task.pendingPermission?.title ?? null,
          result: result ? excerpt(result) : null,
          thread: taskThreadId(task.id),
        };
      }),
      targets: caller.assistant.autonomy?.targets ?? [],
      limits: coordinator.taskLimits,
    };
  };
}

/** One agent tool: its contract, and how the coordinator runs a call to it. */
export interface AgentToolEntry {
  tool: PluginAgentToolContract;
  run(coordinator: Coordinator, input: unknown, context: Context): unknown;
}
/** Every agent tool, registered under the same names on the coordinator and on its members. */
export const agentTools: readonly AgentToolEntry[] = [
  {
    tool: startTaskTool,
    run: (coordinator, input, context) =>
      startTaskHandler(coordinator)(startTaskTool.input.parse(input), context),
  },
  {
    tool: taskStatusTool,
    run: (coordinator, input, context) =>
      taskStatusHandler(coordinator)(taskStatusTool.input.parse(input), context),
  },
];

/** Runs a tool call a member relayed; the member's daemon already verified the agent. */
export async function callAgentTool(
  coordinator: Coordinator,
  caller: Required<ToolCaller>,
  name: string,
  input: unknown,
): Promise<unknown> {
  const entry = agentTools.find(({ tool }) => tool.name === name);
  if (!entry)
    throw new Error(`Unknown Bigbang tool ${name}. Update the Bigbang plugin on this machine.`);
  return entry.run(coordinator, input, { caller });
}
