import { randomUUID } from "node:crypto";
import type { Assistant, Message, Turn } from "../shared/contracts";
import type { ChatStore } from "./store";
import { receiptText } from "./task-events";

export interface ChatSession {
  id: string;
  conversationId: string;
  threadId: string | null;
  assistantId: string;
  agentId: string;
  provider: string;
  systemPrompt: string;
  lastInstructions: string;
  created: boolean;
  lastMessageId?: string;
}
export function chatSessionKey(
  conversationId: string,
  threadId: string | null,
  assistantId: string,
): string {
  return JSON.stringify([conversationId, threadId, assistantId]);
}
export function restoreChatSessions(store: ChatStore): void {
  const state = store.snapshot();
  store.transaction(() => {
    for (const turn of state.turns) {
      if (turn.taskId) continue;
      const assistant = state.assistants.find((item) => item.id === turn.assistantId);
      if (assistant) bindChatSession(store, turn.conversationId, turn.threadId, assistant);
    }
  });
}
export function assistantInstructions(assistant: Assistant): string {
  return `${assistant.persona}
You are a personal assistant. Your long-term memory is personal to you and lives in MEMORY.md and the notes/ directory of your working directory. Read them when earlier context matters and keep them current with your file tools. Other assistants have separate memory; share something with them only by saying it in the chat. Project changes belong in separate Studio tasks, not in your memory.
In a group chat, reply with exactly (pass) when you have nothing useful to add.${autonomyInstructions(assistant)}`;
}
function autonomyInstructions(assistant: Assistant): string {
  if (!assistant.autonomy?.enabled) return "";
  return `
You may start project work yourself with the bigbang__start_task tool, on the projects bigbang__task_status lists for you. Put the whole brief in the prompt (goal, context, constraints, what done looks like): the task agent cannot see this chat. Ask the user first when the project or the key requirements are unclear. After starting a task, tell the user briefly what you started. Its result is posted in the task thread, and you are told when it finishes so you can report back.`;
}
function legacySessionTurn(turns: Turn[]): Turn | undefined {
  const reverse = turns.toReversed();
  return (
    reverse.find((turn) => ["running", "attention", "unknown", "creating"].includes(turn.status)) ??
    reverse.find((turn) => turn.status === "completed") ??
    reverse.find((turn) => turn.accepted) ??
    reverse[0]
  );
}
export function bindChatSession(
  store: ChatStore,
  conversationId: string,
  threadId: string | null,
  assistant: Assistant,
): ChatSession {
  const id = chatSessionKey(conversationId, threadId, assistant.id);
  const existing = store.getChatSession(id);
  if (existing) return existing;
  const state = store.snapshot();
  const previous = legacySessionTurn(
    state.turns.filter(
      (turn) =>
        turn.conversationId === conversationId &&
        turn.threadId === threadId &&
        turn.assistantId === assistant.id &&
        !turn.taskId,
    ),
  );
  // COMPAT(bigbangReplyIds): added in bigbang chat v2, remove after 2027-03-01
  const reply =
    previous &&
    state.messages.find(
      (message) => message.id === `final:${previous.id}` || message.id === `reply:${previous.id}`,
    );
  const session: ChatSession = {
    id,
    conversationId,
    threadId,
    assistantId: assistant.id,
    agentId: previous?.agentId ?? randomUUID(),
    provider: previous?.provider ?? assistant.provider,
    systemPrompt: previous?.systemPrompt ?? assistantInstructions(assistant),
    lastInstructions: previous?.systemPrompt ?? assistantInstructions(assistant),
    created: Boolean(
      previous &&
      (previous.accepted || ["running", "attention", "completed"].includes(previous.status)),
    ),
    lastMessageId: reply?.id ?? previous?.seenUserId,
  };
  store.putChatSession(session);
  return session;
}
const OUTCOME_EVENTS = new Set(["task_completed", "task_failed", "task_cancelled"]);
function isOutcome(message: Message): boolean {
  return OUTCOME_EVENTS.has(message.event?.type ?? "");
}
/** The messages of one lane, plus the thread's root message when `rootId` names it (roundtable). */
export function laneMessages(
  messages: Message[],
  conversationId: string,
  threadId: string | null,
  rootId?: string | null,
): Message[] {
  return messages.filter(
    (message) =>
      message.conversationId === conversationId &&
      message.kind !== "system" &&
      (message.threadId === threadId || (rootId != null && message.id === rootId)),
  );
}
export function unseenMessages(
  messages: Message[],
  session: ChatSession,
  turns: Turn[] = [],
  rootId?: string | null,
): Message[] {
  const history = laneMessages(messages, session.conversationId, session.threadId, rootId);
  // Lifecycle rows are interface chrome, except an outcome the assistant has yet to report. A task
  // the assistant started is already in its own history, so it is not told about it again.
  const visible = (message: Message) =>
    message.kind === "task_event"
      ? message.event?.notifyAssistantId === session.assistantId && isOutcome(message)
      : !(
          message.taskId &&
          message.id.startsWith("task:") &&
          message.senderId === session.assistantId
        );
  // The execution already holds its own replies in its native history.
  const nativeReplies = new Set(
    turns
      .filter((turn) => turn.agentId === session.agentId)
      .flatMap((turn) => [
        `final:${turn.id}`,
        // COMPAT(bigbangReplyIds): added in bigbang chat v2, remove after 2027-03-01
        `reply:${turn.id}`,
      ]),
  );
  if (!session.lastMessageId)
    return history
      .filter(visible)
      .slice(-24)
      .filter((message) => !nativeReplies.has(message.id));
  const index = history.findIndex((message) => message.id === session.lastMessageId);
  if (index < 0)
    throw new Error(
      "The chat execution cursor is missing. Open the existing execution in Studio to inspect it.",
    );
  return history
    .slice(index + 1)
    .filter((message) => visible(message) && !nativeReplies.has(message.id));
}
// Updating a turn moves its SQLite snapshot row behind newer queued turns. Keep
// the current execution owner ahead of those turns until its result is settled.
export function runnableChatTurns(turns: Turn[]): Turn[] {
  const selected = new Map<string, Turn>();
  for (const turn of turns) {
    if (!["queued", "creating", "running", "attention", "unknown"].includes(turn.status)) continue;
    const key = JSON.stringify([turn.conversationId, turn.threadId]);
    const previous = selected.get(key);
    if (!previous || (previous.status === "queued" && turn.status !== "queued"))
      selected.set(key, turn);
  }
  return [...selected.values()];
}
export interface QueuedTurn {
  /** Defaults to a fresh id; the id is the anchor the execution records. */
  id?: string;
  conversationId: string;
  threadId: string | null;
  assistant: Assistant;
  kind: NonNullable<Turn["kind"]>;
  triggerId: string;
  /** Replaced by the composed prompt when the dispatcher prepares the turn. */
  prompt: string;
  rootTriggerId: string;
  wokenBy?: string;
  inboxMessageIds?: string[];
  epochId?: string;
  round?: number;
}
/** Persists a queued turn for an assistant in a lane, binding its chat execution. */
export function queueTurn(store: ChatStore, input: QueuedTurn): Turn {
  const session = bindChatSession(store, input.conversationId, input.threadId, input.assistant);
  const turn: Turn = {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    conversationId: input.conversationId,
    threadId: input.threadId,
    assistantId: input.assistant.id,
    prompt: input.prompt,
    prepared: false,
    accepted: false,
    triggerId: input.triggerId,
    rootTriggerId: input.rootTriggerId,
    taskId: null,
    status: "queued",
    agentId: session.agentId,
    chatSessionId: session.id,
    error: null,
    ...(input.wokenBy ? { wokenBy: input.wokenBy } : {}),
    ...(input.inboxMessageIds ? { inboxMessageIds: input.inboxMessageIds } : {}),
    ...(input.epochId ? { epochId: input.epochId } : {}),
    ...(input.round !== undefined ? { round: input.round } : {}),
  };
  store.put("turns", turn);
  return turn;
}
export function chatPrompt(
  messages: Message[],
  assistant: Assistant,
  assistants: Assistant[],
): string {
  return messages
    .map((message) => {
      if (message.kind === "task_event") return `[${receiptText(message)}]`;
      if (message.senderId === "user") return `You: ${message.content}`;
      const sender = assistants.find((item) => item.id === message.senderId);
      return `${sender?.name ?? (message.senderId === assistant.id ? assistant.name : "Assistant")}: ${message.content}`;
    })
    .join("\n\n");
}
