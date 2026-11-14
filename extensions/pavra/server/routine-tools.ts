import { defineAgentTool } from "@getpaseo/plugin";
import { z } from "zod";
import {
  type Assistant,
  type Routine,
  routineCadenceSchema,
  routineRunOutcomeSchema,
  routineStatusSchema,
} from "../shared/contracts";
import type { ToolCaller } from "./agent-tools";
import type { Coordinator } from "./coordinator";

const routineToolSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  conversationId: z.string(),
  threadId: z.string().nullable(),
  status: routineStatusSchema,
  cadence: routineCadenceSchema,
  maxRuns: z.number().int().positive().nullable(),
  expiresAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  lastRun: z
    .object({
      id: z.string(),
      status: z.enum(["running", "succeeded", "failed"]),
      outcome: routineRunOutcomeSchema.nullable(),
      summary: z.string().nullable(),
      startedAt: z.number(),
      endedAt: z.number().nullable(),
    })
    .nullable(),
});

export const routineListTool = defineAgentTool({
  name: "routine_list",
  description:
    "List your scheduled routines and one-time reminders in this chat (or across all chats when scope is 'all'), including their cadence, next run time, and last run outcome.",
  input: z.object({
    scope: z
      .enum(["conversation", "all"])
      .optional()
      .describe("Defaults to 'conversation' (this chat); pass 'all' for all chats."),
  }),
  output: z.object({
    routines: z.array(routineToolSummarySchema),
  }),
});

export const routineSaveTool = defineAgentTool({
  name: "routine_save",
  description:
    "Create or update a scheduled routine or one-time reminder for yourself in this chat. " +
    "Pass maxRuns: 1 for a one-time reminder (e.g. 'remind me in 2 hours'). " +
    "For recurring inspections, reference playbooks/<slug>.md in prompt and instruct yourself to reply (pass) when everything is normal.",
  input: z.object({
    id: z.string().min(1).optional().describe("Routine id when updating an existing routine."),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("Short display name (e.g. 'Morning check' or 'Reply to email')."),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(20_000)
      .describe(
        "Self-contained instructions for the routine turn (may reference playbooks/<slug>.md).",
      ),
    cadence: routineCadenceSchema.describe(
      "Schedule cadence: { type: 'every', everyMs } or { type: 'cron', expression, timezone? }.",
    ),
    maxRuns: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe("Pass 1 for a one-time reminder; omit or null for recurring routines."),
    expiresAt: z
      .number()
      .nullable()
      .optional()
      .describe("Optional epoch ms after which the routine completes."),
  }),
  output: z.object({
    routine: routineToolSummarySchema,
    created: z.boolean(),
  }),
});

export const routineDeleteTool = defineAgentTool({
  name: "routine_delete",
  description: "Delete a routine or reminder that belongs to you.",
  input: z.object({
    id: z.string().min(1).describe("The id of the routine to delete."),
  }),
  output: z.object({
    deleted: z.boolean(),
    id: z.string(),
  }),
});

interface RoutineCaller {
  assistant: Assistant;
  conversationId: string;
  threadId: string | null;
}

interface Context {
  caller: ToolCaller;
}

export function authorizeRoutineCaller(
  coordinator: Coordinator,
  caller: ToolCaller,
): RoutineCaller {
  const { store } = coordinator;
  if (store.get("tasks", caller.agentId)) {
    throw new Error(
      "Task agents cannot manage routines. Report what you need in your result instead.",
    );
  }
  const session = store.getChatSessionByAgent(caller.agentId);
  if (!session || (session.serverId ?? null) !== (caller.serverId ?? null)) {
    throw new Error("This tool is only available to a Chat assistant in its chat.");
  }
  const assistant = store.get("assistants", session.assistantId);
  if (!assistant) {
    throw new Error("This assistant no longer exists.");
  }
  const conversation = store.get("conversations", session.conversationId);
  if (!conversation?.members.includes(assistant.id)) {
    throw new Error("You are no longer a member of this chat.");
  }
  return {
    assistant,
    conversationId: conversation.id,
    threadId: session.threadId,
  };
}

function formatRoutineForTool(routine: Routine): z.output<typeof routineToolSummarySchema> {
  const lastRun = routine.runs.at(-1) ?? null;
  return {
    id: routine.id,
    name: routine.name,
    prompt: routine.prompt,
    conversationId: routine.conversationId,
    threadId: routine.threadId,
    status: routine.status,
    cadence: routine.cadence,
    maxRuns: routine.maxRuns,
    expiresAt: routine.expiresAt,
    nextRunAt: routine.nextRunAt,
    lastRunAt: routine.lastRunAt,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          outcome: lastRun.outcome,
          summary: lastRun.summary,
          startedAt: lastRun.startedAt,
          endedAt: lastRun.endedAt,
        }
      : null,
  };
}

export function routineListHandler(coordinator: Coordinator) {
  return (input: z.output<typeof routineListTool.input>, context: Context) => {
    const caller = authorizeRoutineCaller(coordinator, context.caller);
    const scope = input.scope ?? "conversation";
    const routines = (coordinator.store.snapshot().routines ?? [])
      .filter(
        (routine) =>
          routine.assistantId === caller.assistant.id &&
          (scope === "all" || routine.conversationId === caller.conversationId),
      )
      .toSorted((a, b) => a.createdAt - b.createdAt);
    return {
      routines: routines.map(formatRoutineForTool),
    };
  };
}

export function routineSaveHandler(coordinator: Coordinator) {
  return (input: z.output<typeof routineSaveTool.input>, context: Context) => {
    const caller = authorizeRoutineCaller(coordinator, context.caller);
    const allRoutines = coordinator.store.snapshot().routines ?? [];
    let existing: Routine | null = null;
    if (input.id) {
      const found = coordinator.store.get("routines", input.id);
      if (!found) throw new Error("Routine no longer exists.");
      if (
        found.assistantId !== caller.assistant.id ||
        found.conversationId !== caller.conversationId
      ) {
        throw new Error("You can only modify your own routines in this chat.");
      }
      existing = found;
    } else {
      const normalizedName = input.name.trim().toLowerCase();
      existing =
        allRoutines.find(
          (item) =>
            item.assistantId === caller.assistant.id &&
            item.conversationId === caller.conversationId &&
            item.threadId === caller.threadId &&
            item.status !== "completed" &&
            item.name.trim().toLowerCase() === normalizedName,
        ) ?? null;
    }

    const liveTurn = coordinator.liveChatTurn(context.caller.agentId);
    if (liveTurn?.kind === "routine" && !existing) {
      throw new Error("Routines cannot create new routines during a routine turn.");
    }

    const saved = coordinator.saveRoutine({
      ...(existing ? { id: existing.id } : {}),
      name: input.name,
      prompt: input.prompt,
      assistantId: caller.assistant.id,
      conversationId: caller.conversationId,
      threadId: caller.threadId,
      cadence: input.cadence,
      maxRuns: input.maxRuns,
      expiresAt: input.expiresAt,
    });

    return {
      routine: formatRoutineForTool(saved),
      created: !existing,
    };
  };
}

export function routineDeleteHandler(coordinator: Coordinator) {
  return (input: z.output<typeof routineDeleteTool.input>, context: Context) => {
    const caller = authorizeRoutineCaller(coordinator, context.caller);
    const existing = coordinator.store.get("routines", input.id);
    if (!existing) throw new Error("Routine no longer exists.");
    if (existing.assistantId !== caller.assistant.id) {
      throw new Error("You can only delete your own routines.");
    }
    return coordinator.deleteRoutine({ id: input.id });
  };
}
