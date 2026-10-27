import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Limits on tasks assistants start on their own. They also cap tasks the user starts. */
export const taskSettings = defineSettings({
  id: "tasks",
  scope: "host",
  version: 1,
  schema: z.object({
    // Tasks that run at the same time across all chats; the rest queue.
    maxParallelTasks: z.number().int().min(1).max(8).default(2),
    // Agents a task's executor may have running at once; extras are cancelled.
    maxWorkAgentsPerTask: z.number().int().min(1).max(10).default(3),
    // How long one autonomous run may take before it stops and asks the user to reply.
    autonomousBudgetMinutes: z.number().int().min(1).max(240).default(30),
  }),
});
export type TaskLimits = z.output<typeof taskSettings.schema>;
export const DEFAULT_TASK_LIMITS: TaskLimits = {
  maxParallelTasks: 2,
  maxWorkAgentsPerTask: 3,
  autonomousBudgetMinutes: 30,
};

/**
 * Which part this daemon plays in Bigbang Chat. A coordinator keeps the ledger; a member runs the
 * executions of assistants bound to it and relays its agents' tool calls to its coordinator.
 * Changing the role takes effect when the plugin reloads.
 */
export const roleSettings = defineSettings({
  id: "role",
  scope: "host",
  version: 1,
  schema: z.object({
    mode: z.enum(["coordinator", "member"]).default("coordinator"),
    // The coordinator's serverId; a member answers only that coordinator's polls.
    coordinatorServerId: z.string().trim().min(1).optional(),
  }),
});
export type RoleSettings = z.output<typeof roleSettings.schema>;
