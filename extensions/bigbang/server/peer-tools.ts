import { defineAgentTool } from "@getpaseo/plugin";
import { z } from "zod";
import type { Coordinator } from "./coordinator";
import type { AssistantSender } from "./mailbox";
import { assistantPeerKey } from "./peers";
import type { ToolCaller } from "./agent-tools";

// Mailbox tools for chat assistants. The caller is the verified agent the daemon hands over; who
// it is and which reply it acts in come from the ledger, never from tool input.

const mailboxStatus = z.enum(["queued", "delivered", "acked", "failed", "cancelled"]);

export const peersTool = defineAgentTool({
  name: "peers",
  description:
    "List the assistants you can ask privately with bigbang-send, with the machine each one runs on.",
  input: z.object({}),
  output: z.object({
    peers: z.array(
      z.object({ key: z.string(), name: z.string(), kind: z.string(), machine: z.string() }),
    ),
  }),
});

export const sendTool = defineAgentTool({
  name: "send",
  description:
    "Ask another assistant privately (kind request, the default) or tell it something (kind info). " +
    "It works on your message in its own session, on its own machine; its answer comes back to you here in a later turn, so tell the user you asked and end your reply. " +
    "One request per peer per user message; you cannot reach a second new peer for the same user message.",
  input: z.object({
    to: z.string().trim().min(1).describe("The assistant's name (or the key bigbang-peers lists)."),
    text: z.string().trim().min(1).max(20_000).describe("A complete, self-contained message."),
    kind: z.enum(["request", "info"]).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  }),
  output: z.object({
    mailboxId: z.string(),
    status: z.string(),
    correlationId: z.string(),
    created: z.boolean(),
    recipient: z.string(),
  }),
});

export const replyTool = defineAgentTool({
  name: "reply",
  description:
    "Answer the mailbox request you are handling now. Optional: your final answer is sent as the reply when you do not call this.",
  input: z.object({
    mailboxId: z.string().min(1),
    text: z.string().trim().min(1).max(20_000),
    outcome: z.enum(["ok", "failed"]).optional(),
  }),
  output: z.object({ replyMailboxId: z.string(), status: z.string(), created: z.boolean() }),
});

export const recordsTool = defineAgentTool({
  name: "records",
  description:
    "Your mailbox messages, newest first: what you asked, what you were asked, and the replies. " +
    "Check here before repeating a message whose outcome you do not know.",
  input: z.object({
    status: mailboxStatus.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  output: z.object({
    records: z.array(
      z.object({
        mailboxId: z.string(),
        kind: z.string(),
        status: z.string(),
        from: z.string(),
        to: z.string(),
        text: z.string(),
        replyTo: z.string().nullable(),
        outcome: z.string().nullable(),
        createdAt: z.number(),
      }),
    ),
  }),
});

export const cancelRequestTool = defineAgentTool({
  name: "cancel_request",
  description: "Withdraw a request you sent that the other assistant has not started on.",
  input: z.object({ mailboxId: z.string().min(1) }),
  output: z.object({ mailboxId: z.string(), status: z.string() }),
});

/** The assistant behind a verified caller, in the reply it is giving now. */
export function assistantSender(coordinator: Coordinator, caller: ToolCaller): AssistantSender {
  const { store } = coordinator;
  if (store.get("tasks", caller.agentId))
    throw new Error("Task agents cannot use the mailbox. Report what you need in your result.");
  const session = store.getChatSessionByAgent(caller.agentId);
  if (!session || (session.serverId ?? null) !== (caller.serverId ?? null))
    throw new Error("This tool is only available to a Chat assistant.");
  const assistant = store.get("assistants", session.assistantId);
  if (!assistant) throw new Error("This assistant no longer exists.");
  const turn = coordinator.liveChatTurn(caller.agentId);
  if (!turn) throw new Error("Use the mailbox while you are replying.");
  return { assistant, turn };
}

function nameOf(coordinator: Coordinator, key: string): string {
  const id = key.startsWith("assistant:") ? key.slice("assistant:".length) : null;
  return (id && coordinator.store.get("assistants", id)?.name) || key;
}

interface Context {
  caller: ToolCaller;
}

export function peersHandler(coordinator: Coordinator) {
  return (_input: z.output<typeof peersTool.input>, context: Context) => {
    const self = assistantSender(coordinator, context.caller).assistant;
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
  return (input: z.output<typeof sendTool.input>, context: Context) => {
    const result = coordinator.mailbox.send(assistantSender(coordinator, context.caller), input);
    coordinator.kickWork();
    return result;
  };
}

export function replyHandler(coordinator: Coordinator) {
  return (input: z.output<typeof replyTool.input>, context: Context) => {
    const result = coordinator.mailbox.reply(assistantSender(coordinator, context.caller), input);
    coordinator.kickWork();
    return result;
  };
}

export function recordsHandler(coordinator: Coordinator) {
  return (input: z.output<typeof recordsTool.input>, context: Context) => {
    const sender = assistantSender(coordinator, context.caller);
    const rows = coordinator.mailbox.records(assistantPeerKey(sender.assistant.id), {
      ...(input.status ? { status: input.status } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    });
    return {
      records: rows.map((row) => ({
        mailboxId: row.mailboxId,
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
    return coordinator.mailbox.cancel(assistantPeerKey(sender.assistant.id), input.mailboxId);
  };
}
