import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const assistantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  provider: z.string().regex(/^[^/]+\/.+$/),
  persona: z.string(),
  // Deprecated: long-term memory lives in the assistant's MEMORY.md; read and write it with
  // chat.assistant.memory.*. Kept so older clients keep parsing.
  memory: z.string().optional(),
  autonomy: z
    .object({
      enabled: z.boolean(),
      targets: z.array(
        z.object({
          serverId: z.string(),
          directory: z.string().min(1),
          isolation: z.enum(["worktree", "directory"]),
        }),
      ),
    })
    .optional(),
});
export const conversationSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(z.string().uuid()).min(1).max(6),
  kind: z.enum(["dm", "group"]),
  roundtable: z.boolean(),
});
export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  threadId: z.string().nullable(),
  senderId: z.string(),
  content: z.string(),
  createdAt: z.number(),
  taskId: z.string().nullable(),
  kind: z.enum(["user", "final", "system", "task_event"]).optional(),
  seq: z.number().optional(),
  turnId: z.string().optional(),
  quoteOf: z.string().optional(),
  epochId: z.string().optional(),
  event: z
    .object({ type: z.string(), taskId: z.string().optional(), detail: z.string().optional() })
    .optional(),
});
export const executionSchema = z.object({
  serverId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
});
export const taskSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  assistantId: z.string(),
  prompt: z.string(),
  serverId: z.string(),
  directory: z.string(),
  provider: z.string(),
  isolation: z.enum(["worktree", "directory"]),
  status: z.enum([
    "queued",
    "creating",
    "running",
    "attention",
    "completed",
    "failed",
    "cancelled",
    "unknown",
  ]),
  execution: executionSchema.nullable(),
  accepted: z.boolean(),
  cancelPending: z.boolean().optional(),
  error: z.string().nullable(),
  createdAt: z.number(),
  deadline: z.number(),
  origin: z.enum(["user", "assistant"]).optional(),
  requestedByTurnId: z.string().optional(),
  pendingPermission: z.object({ requestId: z.string(), title: z.string() }).nullable().optional(),
});
export const turnSchema = z.object({
  id: z.string(),
  kind: z
    .enum([
      "reply",
      "awareness",
      "mention",
      "peer_inbox",
      "roundtable",
      "task_followup",
      "task_receipt",
    ])
    .optional(),
  epochId: z.string().optional(),
  round: z.number().optional(),
  finalMessageId: z.string().optional(),
  accepted: z.boolean().optional(),
  prepared: z.boolean().optional(),
  taskId: z.string().nullable().optional(),
  provider: z.string().optional(),
  systemPrompt: z.string().optional(),
  triggerId: z.string().optional(),
  seenUserId: z.string().optional(),
  chatSessionId: z.string().optional(),
  contextThroughId: z.string().optional(),
  conversationId: z.string(),
  threadId: z.string().nullable(),
  assistantId: z.string(),
  prompt: z.string(),
  status: z.enum([
    "queued",
    "creating",
    "running",
    "attention",
    "completed",
    "failed",
    "cancelled",
    "unknown",
  ]),
  agentId: z.string(),
  error: z.string().nullable(),
});
export const stateSchema = z.object({
  generation: z.string(),
  cursor: z.number(),
  assistants: z.array(assistantSchema),
  conversations: z.array(conversationSchema),
  messages: z.array(messageSchema),
  tasks: z.array(taskSchema),
  turns: z.array(turnSchema),
});
export type Assistant = z.infer<typeof assistantSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type ChatState = z.infer<typeof stateSchema>;

export const readState = defineRpc({
  name: "chat.state",
  input: z.object({
    after: z.number().optional(),
    generation: z.string().optional(),
    // Long poll: with `after`, wait up to this long for the cursor to advance past it.
    waitMs: z.number().int().min(0).max(20000).optional(),
  }),
  output: stateSchema,
});
export const readAssistantMemory = defineRpc({
  name: "chat.assistant.memory.read",
  input: z.object({ assistantId: z.string().uuid() }),
  output: z.object({ content: z.string(), mtimeMs: z.number() }),
});
export const writeAssistantMemory = defineRpc({
  name: "chat.assistant.memory.write",
  input: z.object({
    assistantId: z.string().uuid(),
    content: z.string().max(1_000_000),
    // mtimeMs returned by the last read; 0 when the file did not exist.
    expectedMtimeMs: z.number(),
  }),
  output: z.object({ content: z.string(), mtimeMs: z.number() }),
});
export const saveAssistant = defineRpc({
  name: "chat.assistant.save",
  input: assistantSchema,
  output: assistantSchema,
});
export const createConversation = defineRpc({
  name: "chat.conversation.create",
  input: conversationSchema,
  output: conversationSchema,
});
export const sendMessage = defineRpc({
  name: "chat.message.send",
  input: z.object({
    id: z.string().uuid(),
    conversationId: z.string(),
    threadId: z.string().nullable(),
    content: z.string().trim().min(1).max(100000),
  }),
  output: z.object({ id: z.string() }),
});
export const startTask = defineRpc({
  name: "chat.task.start",
  input: taskSchema
    .pick({
      id: true,
      conversationId: true,
      assistantId: true,
      prompt: true,
      serverId: true,
      directory: true,
      provider: true,
      isolation: true,
    })
    .extend({
      id: z.string().uuid(),
      prompt: z.string().trim().min(1),
      directory: z.string().min(1),
    }),
  output: taskSchema,
});
export const cancelTask = defineRpc({
  name: "chat.task.cancel",
  input: z.object({ id: z.string() }),
  output: taskSchema,
});
