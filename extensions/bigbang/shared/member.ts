import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// A member daemon runs the plugin without a ledger: its agents' tool calls and lifecycle events
// wait in a relay that the coordinator long-polls over the host link it already uses to run
// executions there. The coordinator dials the member, so the member never needs a link back.
export const MEMBER_PROTOCOL = 1;
export const PLUGIN_ID = "bigbang";

export const roleSchema = z.enum(["coordinator", "member"]);
export type Role = z.output<typeof roleSchema>;

export const memberHello = defineRpc({
  name: "member.hello",
  input: z.object({}),
  output: z.object({
    protocol: z.number().int(),
    mode: roleSchema,
    coordinatorServerId: z.string().nullable(),
    /** Changes when the member's plugin restarts; its hook events from before are gone. */
    processId: z.string(),
  }),
});

export const memberEventNames = [
  "agent.turn_started",
  "agent.turn_ended",
  "agent.permission_requested",
  "agent.permission_resolved",
  "agent.archived",
  "agent.closed",
  "agent.created",
] as const;
export type MemberEventName = (typeof memberEventNames)[number];

const outcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("completed") }),
  z.object({ kind: z.literal("failed"), error: z.object({ message: z.string() }) }),
  z.object({ kind: z.literal("canceled"), reason: z.string() }),
]);
const callItemSchema = z.object({
  seq: z.number().int(),
  type: z.literal("call"),
  callId: z.string(),
  agentId: z.string(),
  tool: z.string(),
  input: z.unknown(),
});
const eventItemSchema = z.object({
  seq: z.number().int(),
  type: z.literal("event"),
  name: z.enum(memberEventNames),
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  outcome: outcomeSchema.optional(),
  request: z.object({ id: z.string(), name: z.string(), title: z.string().optional() }).optional(),
});
export const memberItemSchema = z.discriminatedUnion("type", [callItemSchema, eventItemSchema]);
export type MemberItem = z.output<typeof memberItemSchema>;
export type MemberCall = z.output<typeof callItemSchema>;
export type MemberEvent = z.output<typeof eventItemSchema>;

export const memberPoll = defineRpc({
  name: "member.poll",
  input: z.object({
    // The poller's own serverId; a member answers only the coordinator it is configured for.
    coordinatorServerId: z.string(),
    // Items up to this seq were handled and are dropped; the rest are delivered again.
    ackThrough: z.number().int().min(0),
    waitMs: z.number().int().min(0).max(20000),
  }),
  output: z.object({ processId: z.string(), items: z.array(memberItemSchema) }),
});

export const callResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), output: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type CallResult = z.output<typeof callResultSchema>;

export const memberRespond = defineRpc({
  name: "member.respond",
  input: z.object({ callId: z.string(), result: callResultSchema }),
  // False when the call already timed out on the member; the agent was told the outcome is unknown.
  output: z.object({ accepted: z.boolean() }),
});

const assistantHomeInput = z.object({
  assistantId: z.string().uuid(),
  // The private `home` subdirectory, used when the daemon reused a visible workspace for the root.
  subdirectory: z.boolean().optional(),
});
export const memberHomePrepare = defineRpc({
  name: "member.home.prepare",
  input: assistantHomeInput.extend({ seed: z.string().max(1_000_000) }),
  output: z.object({ directory: z.string() }),
});
const memoryOutput = z.object({ content: z.string(), mtimeMs: z.number() });
export const memberMemoryRead = defineRpc({
  name: "member.memory.read",
  input: assistantHomeInput,
  output: memoryOutput,
});
export const memberMemoryWrite = defineRpc({
  name: "member.memory.write",
  input: assistantHomeInput.extend({
    content: z.string().max(1_000_000),
    expectedMtimeMs: z.number(),
  }),
  output: memoryOutput,
});
