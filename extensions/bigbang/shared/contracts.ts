import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const assistantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  provider: z.string().regex(/^[^/]+\/.+$/),
  persona: z.string(),
  // The machine (serverId) the assistant's executions and home live on, fixed at creation.
  // Absent means the Chat coordinator's own machine.
  serverId: z.string().min(1).optional(),
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
          // The machine's display name when the target was saved, so the assistant can match
          // "on Spark" to a serverId. Authorization still matches serverId and directory only.
          label: z.string().optional(),
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
  // The composer's default for the roundtable toggle; the server starts one only on an explicit
  // `responseMode`.
  roundtable: z.boolean(),
  // Replies when a plain message has no mention, quote or recent participant.
  defaultResponderId: z.string().uuid().optional(),
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
  round: z.number().optional(),
  // Lifecycle receipt payload of a `task_event` row. `type` stays a string so a newer daemon can add
  // event types an older client does not know; see `taskEventTypes` for the current set.
  event: z
    .object({
      type: z.string(),
      taskId: z.string().optional(),
      detail: z.string().optional(),
      // task_attention: the approval the row is about, so a client can answer it inline.
      requestId: z.string().optional(),
      // The assistant that started the task and is told about its outcome on its next turn.
      notifyAssistantId: z.string().optional(),
    })
    .optional(),
});
export const taskEventTypes = [
  "task_started",
  "task_attention",
  "task_completed",
  "task_failed",
  "task_cancelled",
  "task_queued",
  "task_budget",
  "task_workers_capped",
] as const;
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
  // Short name of the task; clients fall back to the first line of `prompt`.
  title: z.string().optional(),
  // The thread of the conversation the task was requested from; lifecycle rows land there. The
  // task's own thread is the one rooted at the `task:<id>` message.
  sourceThreadId: z.string().nullable().optional(),
  // Why the task is stopped: `budget` means its time budget ran out and a reply in the task thread
  // continues it.
  stopReason: z.enum(["budget"]).optional(),
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
  // The user message that started the chain of turns this one belongs to. Agent-triggered turns
  // (mention, peer_inbox) are budgeted per root trigger.
  rootTriggerId: z.string().optional(),
  // The assistant whose message woke this turn (kind mention).
  wokenBy: z.string().optional(),
  // The peer messages a peer_inbox turn was batched from.
  inboxMessageIds: z.array(z.string()).optional(),
  finalMessageId: z.string().optional(),
  accepted: z.boolean().optional(),
  prepared: z.boolean().optional(),
  taskId: z.string().nullable().optional(),
  provider: z.string().optional(),
  systemPrompt: z.string().optional(),
  triggerId: z.string().optional(),
  seenUserId: z.string().optional(),
  chatSessionId: z.string().optional(),
  // The machine the turn's execution runs on; absent means the coordinator's own machine.
  serverId: z.string().optional(),
  // A mailbox request or info this turn delivers to its assistant's private mailbox lane.
  mailboxId: z.string().optional(),
  // The mailbox replies this turn hands back to the assistant that asked.
  mailboxWakeupIds: z.array(z.string()).optional(),
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
// A Studio whose bound workspaces' agents may message each other across machines.
export const studioSchema = z.object({
  id: z.string(),
  name: z.string(),
  // active or archived
  status: z.string(),
  workspaces: z.array(
    z.object({ serverId: z.string(), workspaceId: z.string(), name: z.string() }),
  ),
  // Assistants that Studio members may reach, and that may reach them.
  assistantIds: z.array(z.string()).optional(),
  createdAt: z.number(),
});
const peerSchema = z.object({
  key: z.string(),
  // assistant or agent
  kind: z.string(),
  name: z.string(),
  serverId: z.string().optional(),
  machine: z.string().optional(),
  address: z.string().optional(),
});
// One message between peers, from the mailbox or a Studio's records, as the client shows it.
export const peerMessageSchema = z.object({
  id: z.string(),
  // mailbox or studio
  ledger: z.string(),
  // request, info, reply, message or notice
  kind: z.string(),
  studioId: z.string().nullable(),
  sender: peerSchema.nullable(),
  recipient: peerSchema,
  text: z.string(),
  replyTo: z.string().nullable(),
  // Mailbox status, or the Studio receipt status (accepted, queued, rejected, not_attempted, unknown).
  status: z.string(),
  code: z.string().optional(),
  detail: z.string().optional(),
  // The chat lane a request came from.
  conversationId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  createdAt: z.number(),
});
export const stateSchema = z.object({
  generation: z.string(),
  cursor: z.number(),
  assistants: z.array(assistantSchema),
  conversations: z.array(conversationSchema),
  messages: z.array(messageSchema),
  tasks: z.array(taskSchema),
  turns: z.array(turnSchema),
  studios: z.array(studioSchema).optional(),
  peerMessages: z.array(peerMessageSchema).optional(),
});
export type Studio = z.infer<typeof studioSchema>;
export type PeerMessage = z.infer<typeof peerMessageSchema>;
export type Peer = z.infer<typeof peerSchema>;
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
    // Id of the assistant message being quoted; routes the reply to its sender.
    quoteOf: z.string().optional(),
    // "roundtable" starts an ordered discussion from a root message with 2-6 explicit mentions.
    responseMode: z.literal("roundtable").optional(),
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
export const respondTaskPermission = defineRpc({
  name: "chat.task.permission.respond",
  input: z.object({
    taskId: z.string(),
    requestId: z.string(),
    behavior: z.enum(["allow", "deny"]),
    message: z.string().optional(),
  }),
  output: taskSchema,
});
export const machineSchema = z.object({
  serverId: z.string(),
  label: z.string(),
  // coordinator: the machine holding Chat; member: its Bigbang plugin serves this coordinator.
  role: z.string(),
  reason: z.string().optional(),
});
export type MachineInfo = z.infer<typeof machineSchema>;
/** Machines an assistant can be created on; new assistants pick one, and it never changes. */
export const listMachines = defineRpc({
  name: "chat.machines",
  input: z.object({}),
  output: z.object({ machines: z.array(machineSchema) }),
});

export const saveStudio = defineRpc({
  name: "studio.save",
  input: z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(80) }),
  output: studioSchema,
});
export const bindStudioWorkspace = defineRpc({
  name: "studio.bind",
  input: z.object({
    studioId: z.string().min(1),
    serverId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
  }),
  output: studioSchema,
});
export const unbindStudioWorkspace = defineRpc({
  name: "studio.unbind",
  input: z.object({ serverId: z.string().min(1), workspaceId: z.string().min(1) }),
  output: z.object({ studio: studioSchema.nullable() }),
});
export const archiveStudio = defineRpc({
  name: "studio.archive",
  input: z.object({ id: z.string().min(1) }),
  output: studioSchema,
});
export const listStudioMembers = defineRpc({
  name: "studio.members",
  input: z.object({ studioId: z.string().min(1) }),
  output: z.object({
    members: z.array(peerSchema),
    unavailable: z.array(
      z.object({ machine: z.string(), workspace: z.string(), reason: z.string() }),
    ),
  }),
});
