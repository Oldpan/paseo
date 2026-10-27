import { defineAgentTool } from "@getpaseo/plugin";
import { z } from "zod";
import type { Coordinator } from "./coordinator";
import type { AssistantSender } from "./mailbox";
import { assistantPeerKey } from "./peers";
import type { BoundMember, StudioMessage } from "./studio";
import type { ToolCaller } from "./agent-tools";

// Peer tools for chat assistants (the mailbox) and for agents in Studio workspaces (Studio
// records). The caller is the verified agent the daemon hands over; who it is, and in which reply
// or Studio it acts, come from the ledger and its bindings, never from tool input.

const peerOut = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.string(),
  machine: z.string(),
  address: z.string().optional(),
});
const receiptOut = z.object({
  messageId: z.string(),
  recipient: z.string(),
  status: z.string(),
  code: z.string(),
  detail: z.string(),
});

export const peersTool = defineAgentTool({
  name: "peers",
  description:
    "List who you can message: other assistants (for a Chat assistant) or the members of your Studio (for an agent in a Studio workspace), with the machine each runs on.",
  input: z.object({}),
  output: z.object({
    peers: z.array(peerOut),
    unavailable: z
      .array(z.object({ machine: z.string(), workspace: z.string(), reason: z.string() }))
      .optional(),
  }),
});

export const sendTool = defineAgentTool({
  name: "send",
  description:
    "Message a peer. A Chat assistant asks another assistant privately (kind request, the default, or info); its answer comes back in a later turn, so tell the user you asked and end your reply. One new peer per user message. " +
    "An agent in a Studio workspace messages 1-8 members by name, address or key; each gets one delivery and a receipt. A receipt of unknown means do not resend: check bigbang-records first.",
  input: z.object({
    to: z
      .union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1).max(8)])
      .describe("A name, address or key from bigbang-peers; a list for several Studio members."),
    text: z.string().trim().min(1).max(20_000).describe("A complete, self-contained message."),
    kind: z.enum(["request", "info"]).optional().describe("Chat assistants only."),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  }),
  output: z.object({
    mailboxId: z.string().optional(),
    status: z.string().optional(),
    correlationId: z.string().optional(),
    created: z.boolean().optional(),
    recipient: z.string().optional(),
    messages: z.array(receiptOut).optional(),
  }),
});

export const replyTool = defineAgentTool({
  name: "reply",
  description:
    "Answer a message you received: the mailbox request you are handling (optional there, your final answer is sent as the reply), or a Studio message, by its messageId.",
  input: z.object({
    messageId: z.string().min(1),
    text: z.string().trim().min(1).max(20_000),
    outcome: z.enum(["ok", "failed"]).optional().describe("Mailbox replies only."),
  }),
  output: z.object({
    messageId: z.string(),
    status: z.string(),
    created: z.boolean().optional(),
    detail: z.string().optional(),
  }),
});

export const recordsTool = defineAgentTool({
  name: "records",
  description:
    "Your message history, oldest first for a Studio and newest first for the mailbox. Check here before repeating a message whose outcome you do not know.",
  input: z.object({
    status: z.enum(["queued", "delivered", "acked", "failed", "cancelled"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    since: z.string().optional().describe("Studio: messages after this messageId."),
    with: z.string().optional().describe("Studio: messages to or from this member."),
    replyTo: z.string().optional().describe("Studio: replies to this messageId."),
  }),
  output: z.object({
    records: z.array(
      z.object({
        messageId: z.string(),
        kind: z.string(),
        status: z.string(),
        from: z.string(),
        to: z.string(),
        text: z.string(),
        replyTo: z.string().nullable(),
        outcome: z.string().nullable().optional(),
        createdAt: z.number(),
      }),
    ),
  }),
});

export const cancelRequestTool = defineAgentTool({
  name: "cancel_request",
  description: "Withdraw a mailbox request you sent that the other assistant has not started on.",
  input: z.object({ messageId: z.string().min(1) }),
  output: z.object({ messageId: z.string(), status: z.string() }),
});

const NOT_A_PEER =
  "This tool is for Chat assistants and for agents in a workspace that belongs to a Studio.";

/** The chat assistant behind a verified caller, or null for any other agent. */
function chatAssistant(coordinator: Coordinator, caller: ToolCaller) {
  const session = coordinator.store.getChatSessionByAgent(caller.agentId);
  if (!session || (session.serverId ?? null) !== (caller.serverId ?? null)) return null;
  const assistant = coordinator.store.get("assistants", session.assistantId);
  if (!assistant) throw new Error("This assistant no longer exists.");
  return assistant;
}

/** The assistant behind a verified caller, in the reply it is giving now. */
export function assistantSender(coordinator: Coordinator, caller: ToolCaller): AssistantSender {
  if (coordinator.store.get("tasks", caller.agentId))
    throw new Error("Task agents cannot message peers. Report what you need in your result.");
  const assistant = chatAssistant(coordinator, caller);
  if (!assistant) throw new Error("This tool is only available to a Chat assistant.");
  const turn = coordinator.liveChatTurn(caller.agentId);
  if (!turn) throw new Error("Use the mailbox while you are replying.");
  return { assistant, turn };
}

type Caller =
  | { kind: "assistant"; sender: AssistantSender }
  | { kind: "member"; member: BoundMember };

async function resolveCaller(coordinator: Coordinator, caller: ToolCaller): Promise<Caller> {
  if (coordinator.store.get("tasks", caller.agentId))
    throw new Error("Task agents cannot message peers. Report what you need in your result.");
  if (chatAssistant(coordinator, caller))
    return { kind: "assistant", sender: assistantSender(coordinator, caller) };
  const member = await coordinator.studio.callerMember(caller);
  if (!member) throw new Error(NOT_A_PEER);
  return { kind: "member", member };
}

function nameOf(coordinator: Coordinator, key: string): string {
  const id = key.startsWith("assistant:") ? key.slice("assistant:".length) : null;
  return (id && coordinator.store.get("assistants", id)?.name) || key;
}
function receipt(message: StudioMessage) {
  return {
    messageId: message.messageId,
    recipient: message.recipient.address,
    status: message.receipt.status,
    code: message.receipt.code,
    detail: message.receipt.message,
  };
}

interface Context {
  caller: ToolCaller;
}

export function peersHandler(coordinator: Coordinator) {
  return async (_input: z.output<typeof peersTool.input>, context: Context) => {
    const caller = await resolveCaller(coordinator, context.caller);
    if (caller.kind === "member") {
      const listing = await coordinator.studio.members(caller.member.studioId);
      return {
        peers: listing.members
          .filter((member) => member.key !== caller.member.key)
          .map((member) => ({
            key: member.key,
            name: member.name,
            kind: "agent",
            machine: member.machine,
            address: member.address,
          })),
        unavailable: listing.unavailable,
      };
    }
    const self = caller.sender.assistant;
    return {
      peers: coordinator.store
        .snapshot()
        .assistants.filter((assistant) => assistant.id !== self.id)
        .map((assistant) => ({
          key: assistantPeerKey(assistant.id),
          name: assistant.name,
          kind: "assistant",
          machine: coordinator.machineLabel(assistant.serverId),
        })),
    };
  };
}

export function sendHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof sendTool.input>, context: Context) => {
    const caller = await resolveCaller(coordinator, context.caller);
    const targets = Array.isArray(input.to) ? input.to : [input.to];
    if (caller.kind === "member") {
      const messages = await coordinator.studio.send(caller.member, targets, input.text);
      return { messages: messages.map(receipt) };
    }
    if (targets.length !== 1) throw new Error("Ask one assistant at a time.");
    const result = coordinator.mailbox.send(caller.sender, {
      to: targets[0]!,
      text: input.text,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    coordinator.kickWork();
    return result;
  };
}

export function replyHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof replyTool.input>, context: Context) => {
    const caller = await resolveCaller(coordinator, context.caller);
    if (caller.kind === "member") {
      const message = await coordinator.studio.reply(caller.member, input.messageId, input.text);
      return {
        messageId: message.messageId,
        status: message.receipt.status,
        detail: message.receipt.message,
      };
    }
    const result = coordinator.mailbox.reply(caller.sender, {
      mailboxId: input.messageId,
      text: input.text,
      ...(input.outcome ? { outcome: input.outcome } : {}),
    });
    coordinator.kickWork();
    return { messageId: result.replyMailboxId, status: result.status, created: result.created };
  };
}

export function recordsHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof recordsTool.input>, context: Context) => {
    const caller = await resolveCaller(coordinator, context.caller);
    if (caller.kind === "member") {
      const rows = coordinator.studio.records(caller.member.studioId, {
        ...(input.since ? { since: input.since } : {}),
        ...(input.with ? { with: input.with } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      });
      return {
        records: rows.map((row) => ({
          messageId: row.messageId,
          kind: row.kind,
          status: row.receipt.status,
          from: row.sender?.address ?? "Studio",
          to: row.recipient.address,
          text: row.text,
          replyTo: row.replyTo,
          createdAt: row.createdAt,
        })),
      };
    }
    const rows = coordinator.mailbox.records(assistantPeerKey(caller.sender.assistant.id), {
      ...(input.status ? { status: input.status } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    });
    return {
      records: rows.map((row) => ({
        messageId: row.mailboxId,
        kind: row.kind,
        status: row.status,
        from: nameOf(coordinator, row.senderKey),
        to: nameOf(coordinator, row.recipientKey),
        text: row.payloadText,
        replyTo: row.replyToMailboxId,
        outcome: row.outcome,
        createdAt: row.createdAt,
      })),
    };
  };
}

export function cancelRequestHandler(coordinator: Coordinator) {
  return (input: z.output<typeof cancelRequestTool.input>, context: Context) => {
    const sender = assistantSender(coordinator, context.caller);
    const result = coordinator.mailbox.cancel(
      assistantPeerKey(sender.assistant.id),
      input.messageId,
    );
    return { messageId: result.mailboxId, status: result.status };
  };
}
