import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { phoneOutwardConfirmTierValues } from "./phone-safety";

export const assistantBrowserSchema = z.object({
  enabled: z.boolean(),
  allowDomains: z.array(z.string()).optional(),
  askDomains: z.array(z.string()).optional(),
  denyDomains: z.array(z.string()).optional(),
  allowPrivateHosts: z.array(z.string()).optional(),
});
export type AssistantBrowserConfig = z.infer<typeof assistantBrowserSchema>;

export const assistantPhoneSchema = z.object({
  enabled: z.boolean(),
  allowedDeviceIds: z.array(z.string()).optional(),
});
export type AssistantPhoneConfig = z.infer<typeof assistantPhoneSchema>;

export const assistantToolFamilyValues = [
  "mailbox",
  "tasks",
  "routines",
  "browser",
  "phone",
] as const;
export const assistantToolFamilySchema = z.enum(assistantToolFamilyValues);
export type AssistantToolFamily = z.infer<typeof assistantToolFamilySchema>;

export const assistantEnvVarsSchema = z.record(z.string(), z.string());
export type AssistantEnvVars = z.infer<typeof assistantEnvVarsSchema>;

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
  browser: assistantBrowserSchema.optional(),
  phone: assistantPhoneSchema.optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  disabledTools: z.array(z.enum(["mailbox", "tasks", "routines", "browser", "phone"])).optional(),
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
export const forwardedFromSchema = z.object({
  conversationId: z.string(),
  conversationTitle: z.string(),
  senderName: z.string(),
  messageId: z.string(),
});
export type ForwardedFrom = z.infer<typeof forwardedFromSchema>;

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
  routineId: z.string().optional(),
  routineName: z.string().optional(),
  reactions: z.record(z.string(), z.array(z.string())).optional(),
  savedAt: z.string().optional(),
  forwardedFrom: forwardedFromSchema.optional(),
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
export const ChatMessageSchema = messageSchema;
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
      "routine",
    ])
    .optional(),
  epochId: z.string().optional(),
  round: z.number().optional(),
  routineId: z.string().optional(),
  routineRunId: z.string().optional(),
  routineName: z.string().optional(),
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
  // Main-lane agent id whose timeline context is forked into the first turn of a sub-thread.
  forkFromAgentId: z.string().optional(),
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
export const routineCadenceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("every"),
    everyMs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().trim().min(1),
    timezone: z.string().trim().min(1).optional(),
  }),
]);
export type RoutineCadence = z.infer<typeof routineCadenceSchema>;
export const routineRunOutcomeSchema = z.enum(["replied", "passed", "skipped", "failed"]);
export type RoutineRunOutcome = z.infer<typeof routineRunOutcomeSchema>;
export const routineRunSchema = z.object({
  id: z.string(),
  scheduledFor: z.number(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  status: z.enum(["running", "succeeded", "failed"]),
  outcome: routineRunOutcomeSchema.nullable(),
  turnId: z.string().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
});
export type RoutineRun = z.infer<typeof routineRunSchema>;
export const routineStatusSchema = z.enum(["active", "paused", "completed"]);
export type RoutineStatus = z.infer<typeof routineStatusSchema>;
export const routineSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  prompt: z.string().min(1).max(20_000),
  assistantId: z.string().uuid(),
  conversationId: z.string().min(1),
  threadId: z.string().nullable(),
  cadence: routineCadenceSchema,
  status: routineStatusSchema,
  maxRuns: z.number().int().positive().nullable(),
  expiresAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  pausedAt: z.number().nullable(),
  runs: z.array(routineRunSchema),
});
export type Routine = z.infer<typeof routineSchema>;

export const takeoverStatusSchema = z.enum(["pending", "resolved", "cancelled"]);
export type TakeoverStatus = z.infer<typeof takeoverStatusSchema>;
export const takeoverSchema = z.object({
  id: z.string(),
  kind: z.enum(["browser", "phone"]),
  status: takeoverStatusSchema,
  assistantId: z.string().uuid(),
  conversationId: z.string().min(1),
  threadId: z.string().nullable(),
  turnId: z.string().nullable(),
  serverId: z.string().min(1),
  reason: z.string().min(1),
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  screenshotDataUrl: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  packageName: z.string().nullable().optional(),
  appName: z.string().nullable().optional(),
  displayId: z.number().int().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Takeover = z.infer<typeof takeoverSchema>;

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
  routines: z.array(routineSchema).optional(),
  takeovers: z.array(takeoverSchema).optional(),
});
export const readStateOutputSchema = stateSchema.extend({
  coordinatorVersion: z.string().optional(),
});
export type Studio = z.infer<typeof studioSchema>;
export type PeerMessage = z.infer<typeof peerMessageSchema>;
export type Peer = z.infer<typeof peerSchema>;
export type Assistant = z.infer<typeof assistantSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ChatMessageRecord = Message;
export type Task = z.infer<typeof taskSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type ChatState = z.infer<typeof stateSchema>;
export type ChatStatePayload = z.infer<typeof readStateOutputSchema>;

export const readState = defineRpc({
  name: "chat.state",
  input: z.object({
    after: z.number().optional(),
    generation: z.string().optional(),
    // Long poll: with `after`, wait up to this long for the cursor to advance past it.
    waitMs: z.number().int().min(0).max(20000).optional(),
    // Optional per-conversation message window on a full (after=0) snapshot.
    messageLimit: z.number().int().min(1).max(2000).optional(),
  }),
  output: readStateOutputSchema,
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
export const assistantNoteCategoryValues = [
  "index",
  "preferences",
  "channels",
  "work-log",
  "archive",
  "general",
] as const;
export const assistantNoteCategorySchema = z.enum(assistantNoteCategoryValues);
export type AssistantNoteCategory = z.infer<typeof assistantNoteCategorySchema>;
export const assistantNoteSummarySchema = z.object({
  path: z.string(),
  category: assistantNoteCategorySchema,
  title: z.string(),
  mtimeMs: z.number(),
  sizeBytes: z.number(),
});
export const assistantNoteFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  mtimeMs: z.number(),
});
export type AssistantNoteSummary = z.infer<typeof assistantNoteSummarySchema>;
export type AssistantNoteFile = z.infer<typeof assistantNoteFileSchema>;
export const listAssistantNotes = defineRpc({
  name: "chat.assistant.notes.list",
  input: z.object({ assistantId: z.string().uuid() }),
  output: z.object({ notes: z.array(assistantNoteSummarySchema) }),
});
export const readAssistantNote = defineRpc({
  name: "chat.assistant.notes.read",
  input: z.object({
    assistantId: z.string().uuid(),
    path: z.string().min(1).max(200),
  }),
  output: assistantNoteFileSchema,
});
export const writeAssistantNote = defineRpc({
  name: "chat.assistant.notes.write",
  input: z.object({
    assistantId: z.string().uuid(),
    path: z.string().min(1).max(200),
    content: z.string().max(1_000_000),
    expectedMtimeMs: z.number().optional(),
  }),
  output: assistantNoteFileSchema,
});
export const deleteAssistantNote = defineRpc({
  name: "chat.assistant.notes.delete",
  input: z.object({
    assistantId: z.string().uuid(),
    path: z.string().min(1).max(200),
  }),
  output: z.object({ deleted: z.boolean() }),
});
const memberAssistantNoteHomeInput = z.object({
  assistantId: z.string().uuid(),
  subdirectory: z.boolean().optional(),
});
export const memberNotesList = defineRpc({
  name: "member.notes.list",
  input: memberAssistantNoteHomeInput,
  output: z.object({ notes: z.array(assistantNoteSummarySchema) }),
});
export const memberNoteRead = defineRpc({
  name: "member.note.read",
  input: memberAssistantNoteHomeInput.extend({
    path: z.string().min(1).max(200),
  }),
  output: assistantNoteFileSchema,
});
export const memberNoteWrite = defineRpc({
  name: "member.note.write",
  input: memberAssistantNoteHomeInput.extend({
    path: z.string().min(1).max(200),
    content: z.string().max(1_000_000),
    expectedMtimeMs: z.number().optional(),
  }),
  output: assistantNoteFileSchema,
});
export const memberNoteDelete = defineRpc({
  name: "member.note.delete",
  input: memberAssistantNoteHomeInput.extend({
    path: z.string().min(1).max(200),
  }),
  output: z.object({ deleted: z.boolean() }),
});
export const playbookSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  mtimeMs: z.number(),
});
export const playbookFileSchema = z.object({
  slug: z.string(),
  content: z.string(),
  mtimeMs: z.number(),
});
export type PlaybookSummary = z.infer<typeof playbookSummarySchema>;
export type PlaybookFile = z.infer<typeof playbookFileSchema>;
export const listAssistantPlaybooks = defineRpc({
  name: "chat.assistant.playbooks.list",
  input: z.object({ assistantId: z.string().uuid() }),
  output: z.object({ playbooks: z.array(playbookSummarySchema) }),
});
export const readAssistantPlaybook = defineRpc({
  name: "chat.assistant.playbook.read",
  input: z.object({
    assistantId: z.string().uuid(),
    slug: z.string().min(1).max(80),
  }),
  output: playbookFileSchema,
});
export const writeAssistantPlaybook = defineRpc({
  name: "chat.assistant.playbook.write",
  input: z.object({
    assistantId: z.string().uuid(),
    slug: z.string().min(1).max(80),
    content: z.string().max(1_000_000),
    expectedMtimeMs: z.number().optional(),
  }),
  output: playbookFileSchema,
});
export const savePlaybook = writeAssistantPlaybook;
export const deleteAssistantPlaybook = defineRpc({
  name: "chat.assistant.playbook.delete",
  input: z.object({
    assistantId: z.string().uuid(),
    slug: z.string().min(1).max(80),
  }),
  output: z.object({ deleted: z.boolean() }),
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
    // Provenance metadata when a message is forwarded from another chat or thread.
    forwardedFrom: forwardedFromSchema.optional(),
    // "roundtable" starts an ordered discussion from a root message with 2-6 explicit mentions.
    responseMode: z.literal("roundtable").optional(),
    // "steer" supersedes the active turn in the lane immediately instead of waiting for it to finish.
    delivery: z.literal("steer").optional(),
  }),
  output: z.object({ id: z.string() }),
});
export const reactToMessage = defineRpc({
  name: "chat.message.react",
  input: z.object({
    conversationId: z.string().min(1),
    messageId: z.string().min(1),
    emoji: z.string().trim().min(1).max(32),
  }),
  output: messageSchema,
});
export const saveMessage = defineRpc({
  name: "chat.message.save",
  input: z.object({
    conversationId: z.string().min(1).optional(),
    messageId: z.string().min(1),
    saved: z.boolean(),
  }),
  output: messageSchema,
});
export const cancelTurn = defineRpc({
  name: "pavra.turn.cancel",
  input: z.object({ id: z.string() }),
  output: turnSchema,
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
      title: true,
    })
    .extend({
      id: z.string().uuid(),
      prompt: z.string().trim().min(1),
      directory: z.string().min(1),
      budgetMinutes: z.number().int().min(1).max(720).optional(),
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
  // coordinator: the machine holding Chat; member: its Pavra plugin serves this coordinator.
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
export const setStudioAssistants = defineRpc({
  name: "studio.assistants.set",
  input: z.object({
    studioId: z.string().min(1),
    assistantIds: z.array(z.string().uuid()).max(20),
  }),
  output: studioSchema,
});

export const saveRoutine = defineRpc({
  name: "chat.routine.save",
  input: z.object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(20_000),
    assistantId: z.string().uuid(),
    conversationId: z.string().min(1),
    threadId: z.string().nullable().optional(),
    cadence: routineCadenceSchema,
    maxRuns: z.number().int().positive().nullable().optional(),
    expiresAt: z.number().nullable().optional(),
    runOnCreate: z.boolean().optional(),
  }),
  output: routineSchema,
});
export const pauseRoutine = defineRpc({
  name: "chat.routine.pause",
  input: z.object({ id: z.string().min(1) }),
  output: routineSchema,
});
export const resumeRoutine = defineRpc({
  name: "chat.routine.resume",
  input: z.object({ id: z.string().min(1) }),
  output: routineSchema,
});
export const runRoutineOnce = defineRpc({
  name: "chat.routine.run_once",
  input: z.object({ id: z.string().min(1) }),
  output: routineSchema,
});
export const deleteRoutine = defineRpc({
  name: "chat.routine.delete",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ deleted: z.boolean(), id: z.string() }),
});

export const resolveTakeover = defineRpc({
  name: "chat.takeover.resolve",
  input: z.object({
    id: z.string().min(1),
    note: z.string().optional(),
  }),
  output: takeoverSchema,
});

export const cancelTakeover = defineRpc({
  name: "chat.takeover.cancel",
  input: z.object({
    id: z.string().min(1),
  }),
  output: takeoverSchema,
});

export const browserElementSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
});
export type BrowserElement = z.infer<typeof browserElementSchema>;

export const browserPageStateOutputSchema = z.object({
  active: z.boolean(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  screenshotDataUrl: z.string().nullable(),
  elements: z.array(browserElementSchema),
});
export type BrowserPageState = z.infer<typeof browserPageStateOutputSchema>;

export const browserPageState = defineRpc({
  name: "chat.browser.state",
  input: z.object({ assistantId: z.string().uuid() }),
  output: browserPageStateOutputSchema,
});

export const browserRemoteAction = defineRpc({
  name: "chat.browser.action",
  input: z.object({
    assistantId: z.string().uuid(),
    action: z.enum(["goto", "click", "fill", "press", "scroll", "reload"]),
    url: z.string().optional(),
    ref: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    value: z.string().optional(),
    key: z.string().optional(),
    deltaY: z.number().optional(),
  }),
  output: browserPageStateOutputSchema,
});

export const phoneOutwardConfirmTierSchema = z.enum(phoneOutwardConfirmTierValues);
export type PhoneOutwardConfirmTierConfig = z.infer<typeof phoneOutwardConfirmTierSchema>;

export const phonePrivilegeChannelValues = [
  "auto",
  "shizuku",
  "wireless_adb",
  "adb",
  "virtual",
] as const;
export const phonePrivilegeChannelSchema = z.enum(phonePrivilegeChannelValues);
export type PhonePrivilegeChannel = z.infer<typeof phonePrivilegeChannelSchema>;

export const phoneActiveChannelValues = [
  "none",
  "auto",
  "shizuku",
  "wireless_adb",
  "adb",
  "virtual",
] as const;
export const phoneActiveChannelSchema = z.enum(phoneActiveChannelValues);
export type PhoneActiveChannel = z.infer<typeof phoneActiveChannelSchema>;

export const phoneDeviceModeValues = ["app", "virtual", "adb"] as const;
export const phoneDeviceModeSchema = z.enum(phoneDeviceModeValues);
export type PhoneDeviceMode = z.infer<typeof phoneDeviceModeSchema>;

export const phonePrivilegeStatusInputSchema = z.object({
  ready: z.boolean().optional(),
  activeChannel: phoneActiveChannelSchema.optional(),
  shizukuAvailable: z.boolean().optional(),
  shizukuAuthorized: z.boolean().optional(),
  wirelessAdbPaired: z.boolean().optional(),
  wirelessAdbPort: z.number().int().nullable().optional(),
  virtualDisplayId: z.number().int().nullable().optional(),
  overlayPermissionGranted: z.boolean().optional(),
  lastError: z.string().nullable().optional(),
});

export const phoneDeviceSchema = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  enabled: z.boolean(),
  online: z.boolean(),
  mode: phoneDeviceModeSchema,
  platform: z.string().optional(),
  privilegeChannel: phonePrivilegeChannelSchema,
  activeChannel: phoneActiveChannelSchema,
  effectiveReady: z.boolean(),
  virtualDisplayId: z.number().int().nullable(),
  overlayPermissionGranted: z.boolean(),
  allowRelayControl: z.boolean(),
  connectedViaRelay: z.boolean(),
  paused: z.boolean(),
  onMainScreenTakeover: z.boolean(),
  outwardConfirmTier: phoneOutwardConfirmTierSchema,
  unlockedPackages: z.array(z.string()),
  adbSerial: z.string().nullable().optional(),
  screenWidth: z.number().int().positive(),
  screenHeight: z.number().int().positive(),
  lastSeenAt: z.number(),
  lastError: z.string().nullable().optional(),
});
export type PhoneDevice = z.infer<typeof phoneDeviceSchema>;

export const phoneUiBoundsSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
});
export type PhoneUiBounds = z.infer<typeof phoneUiBoundsSchema>;

export const phoneUiElementSchema = z.object({
  ref: z.string(),
  text: z.string().optional(),
  contentDescription: z.string().optional(),
  hint: z.string().optional(),
  className: z.string().optional(),
  resourceId: z.string().optional(),
  packageName: z.string().optional(),
  bounds: phoneUiBoundsSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  clickable: z.boolean().optional(),
  editable: z.boolean().optional(),
  scrollable: z.boolean().optional(),
  checkable: z.boolean().optional(),
  checked: z.boolean().optional(),
  focused: z.boolean().optional(),
  enabled: z.boolean().optional(),
  password: z.boolean().optional(),
  isPassword: z.boolean().optional(),
});
export type PhoneUiElement = z.infer<typeof phoneUiElementSchema>;

export const phoneObservationSchema = z.object({
  deviceId: z.string(),
  displayId: z.number().int().nullable().optional(),
  packageName: z.string(),
  appName: z.string().optional(),
  activityName: z.string().nullable().optional(),
  isSecureFlag: z.boolean().optional(),
  screenWidth: z.number().int().positive().optional(),
  screenHeight: z.number().int().positive().optional(),
  treeQuality: z.enum(["good", "sparse", "empty"]).optional(),
  summary: z.string().optional(),
  elements: z.array(phoneUiElementSchema),
  screenshotBase64: z.string().nullable().optional(),
  screenshotMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
  lastTapX: z.number().nullable().optional(),
  lastTapY: z.number().nullable().optional(),
  capturedAt: z.number(),
});
export type PhoneObservation = z.infer<typeof phoneObservationSchema>;

export const phoneAppInfoSchema = z.object({
  packageName: z.string().min(1),
  appName: z.string(),
  systemApp: z.boolean().optional(),
  blocked: z.boolean().optional(),
});
export type PhoneAppInfo = z.infer<typeof phoneAppInfoSchema>;

export const phoneStepWaitSchema = z.object({
  textIncludes: z.string().optional(),
  packageName: z.string().optional(),
  ms: z.number().int().min(0).max(10_000).optional(),
});
export type PhoneStepWait = z.infer<typeof phoneStepWaitSchema>;

export const phoneStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("tap"),
    ref: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    longPressMs: z.number().int().min(0).max(5_000).optional(),
    wait: phoneStepWaitSchema.optional(),
  }),
  z.object({
    action: z.literal("type"),
    text: z.string(),
    ref: z.string().optional(),
    clearFirst: z.boolean().optional(),
    submit: z.boolean().optional(),
    wait: phoneStepWaitSchema.optional(),
  }),
  z.object({
    action: z.literal("scroll"),
    direction: z.enum(["down", "up", "left", "right"]).optional(),
    delta: z.number().optional(),
    ref: z.string().optional(),
    wait: phoneStepWaitSchema.optional(),
  }),
  z.object({
    action: z.literal("swipe"),
    startX: z.number(),
    startY: z.number(),
    endX: z.number(),
    endY: z.number(),
    durationMs: z.number().int().min(50).max(5_000).optional(),
    wait: phoneStepWaitSchema.optional(),
  }),
  z.object({
    action: z.literal("back"),
    wait: phoneStepWaitSchema.optional(),
  }),
  z.object({
    action: z.literal("launch_app"),
    packageName: z.string().min(1),
    wait: phoneStepWaitSchema.optional(),
  }),
  z.object({
    action: z.literal("wait"),
    textIncludes: z.string().optional(),
    packageName: z.string().optional(),
    ms: z.number().int().min(0).max(10_000).optional(),
  }),
]);
export type PhoneStep = z.infer<typeof phoneStepSchema>;

export const phoneCommandKindValues = [
  "observe",
  "tap",
  "type",
  "scroll",
  "swipe",
  "back",
  "launch_app",
  "list_apps",
  "intent",
  "clipboard",
] as const;
export const phoneCommandKindSchema = z.enum(phoneCommandKindValues);
export type PhoneCommandKind = z.infer<typeof phoneCommandKindSchema>;

export const phoneCommandSchema = z.object({
  commandId: z.string().min(1),
  deviceId: z.string().min(1),
  kind: phoneCommandKindSchema,
  payload: z.record(z.string(), z.unknown()),
  assistantId: z.string().nullable().optional(),
  assistantName: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  turnId: z.string().nullable().optional(),
  stepLabel: z.string().optional(),
  createdAt: z.number(),
  timeoutMs: z.number().int().positive(),
});
export type PhoneCommand = z.infer<typeof phoneCommandSchema>;

export const phoneStepTrailItemSchema = z.object({
  step: z.number().int().nonnegative(),
  commandId: z.string().optional(),
  deviceId: z.string(),
  assistantId: z.string().nullable().optional(),
  assistantName: z.string().nullable().optional(),
  kind: z.string(),
  label: z.string(),
  packageName: z.string().optional(),
  appName: z.string().optional(),
  status: z.enum([
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "handed_to_user",
    "unknown_outcome",
  ]),
  tapX: z.number().nullable().optional(),
  tapY: z.number().nullable().optional(),
  timestamp: z.number(),
});
export type PhoneStepTrailItem = z.infer<typeof phoneStepTrailItemSchema>;

export const phoneLiveStateOutputSchema = z.object({
  active: z.boolean(),
  paused: z.boolean(),
  onMainScreenTakeover: z.boolean(),
  activeDeviceId: z.string().nullable(),
  activeAssistantId: z.string().nullable(),
  activeAssistantName: z.string().nullable(),
  activeTurnId: z.string().nullable(),
  devices: z.array(phoneDeviceSchema),
  latestObservation: phoneObservationSchema.nullable(),
  screenshotBase64: z.string().nullable(),
  screenshotDataUrl: z.string().nullable(),
  displayId: z.number().int().nullable(),
  packageName: z.string().nullable(),
  appName: z.string().nullable(),
  lastTapX: z.number().nullable(),
  lastTapY: z.number().nullable(),
  screenWidth: z.number().int(),
  screenHeight: z.number().int(),
  recentSteps: z.array(phoneStepTrailItemSchema),
});
export type PhoneLiveState = z.infer<typeof phoneLiveStateOutputSchema>;

const phoneDeviceMutationInputSchema = z.object({
  id: z.string().min(1).optional(),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  online: z.boolean().optional(),
  mode: phoneDeviceModeSchema.optional(),
  platform: z.string().optional(),
  privilegeChannel: phonePrivilegeChannelSchema.optional(),
  activeChannel: phoneActiveChannelSchema.optional(),
  effectiveReady: z.boolean().optional(),
  ready: z.boolean().optional(),
  privilegeStatus: phonePrivilegeStatusInputSchema.optional(),
  virtualDisplayId: z.number().int().nullable().optional(),
  overlayPermissionGranted: z.boolean().optional(),
  allowRelayControl: z.boolean().optional(),
  connectedViaRelay: z.boolean().optional(),
  isRelay: z.boolean().optional(),
  paused: z.boolean().optional(),
  onMainScreenTakeover: z.boolean().optional(),
  outwardConfirmTier: phoneOutwardConfirmTierSchema.optional(),
  unlockedPackages: z.array(z.string()).optional(),
  adbSerial: z.string().nullable().optional(),
  screenWidth: z.number().int().positive().optional(),
  screenHeight: z.number().int().positive().optional(),
  lastError: z.string().nullable().optional(),
});

export const phoneRegisterDevice = defineRpc({
  name: "chat.phone.register",
  input: phoneDeviceMutationInputSchema,
  output: phoneDeviceSchema,
});

export const phoneListDevices = defineRpc({
  name: "chat.phone.devices.list",
  input: z.object({}),
  output: z.object({
    devices: z.array(phoneDeviceSchema),
  }),
});

export const phoneConfigureDevice = defineRpc({
  name: "chat.phone.device.configure",
  input: phoneDeviceMutationInputSchema,
  output: phoneDeviceSchema,
});

export const phonePollCommand = defineRpc({
  name: "chat.phone.commands.next",
  input: z.object({
    deviceId: z.string().min(1),
    waitMs: z.number().int().min(0).max(25_000).optional(),
    isRelay: z.boolean().optional(),
    paused: z.boolean().optional(),
    allowRelayControl: z.boolean().optional(),
  }),
  output: z.object({
    command: phoneCommandSchema.nullable(),
    relayBlocked: z.boolean().optional(),
  }),
});

export const phoneReportCommandResult = defineRpc({
  name: "chat.phone.commands.result",
  input: z.object({
    deviceId: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    commandId: z.string().min(1),
    ok: z.boolean().optional(),
    status: z.enum(["completed", "failed"]).optional(),
    isError: z.boolean().optional(),
    error: z.string().nullable().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    result: z.record(z.string(), z.unknown()).optional(),
    apps: z.array(phoneAppInfoSchema).optional(),
    clipboardText: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    observation: z
      .object({
        deviceId: z.string().optional(),
        displayId: z.number().int().nullable().optional(),
        packageName: z.string(),
        appName: z.string().optional(),
        activityName: z.string().nullable().optional(),
        isSecureFlag: z.boolean().optional(),
        screenWidth: z.number().int().positive().optional(),
        screenHeight: z.number().int().positive().optional(),
        treeQuality: z.enum(["good", "sparse", "empty"]).optional(),
        summary: z.string().optional(),
        elements: z.array(phoneUiElementSchema).optional(),
        screenshotBase64: z.string().nullable().optional(),
        screenshotMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
        lastTapX: z.number().nullable().optional(),
        lastTapY: z.number().nullable().optional(),
        capturedAt: z.number().optional(),
      })
      .nullable()
      .optional(),
    screenshotBase64: z.string().nullable().optional(),
    screenshotMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
    lastTapX: z.number().nullable().optional(),
    lastTapY: z.number().nullable().optional(),
  }),
  output: z.object({
    accepted: z.boolean(),
    duplicate: z.boolean().optional(),
  }),
});

export const phoneEmergencyStop = defineRpc({
  name: "chat.phone.emergency_stop",
  input: z.object({
    deviceId: z.string().min(1).optional(),
    assistantId: z.string().uuid().optional(),
    conversationId: z.string().optional(),
    turnId: z.string().optional(),
    reason: z.string().optional(),
  }),
  output: z.object({
    stopped: z.literal(true),
    cancelledCommandIds: z.array(z.string()),
    cancelledTurnIds: z.array(z.string()),
  }),
});

export const phoneGetLiveState = defineRpc({
  name: "chat.phone.live_state",
  input: z.object({
    deviceId: z.string().optional(),
    assistantId: z.string().uuid().optional(),
    conversationId: z.string().optional(),
  }),
  output: phoneLiveStateOutputSchema,
});
