import type {
  Assistant,
  Conversation,
  Message,
} from "../../../../extensions/pavra/shared/contracts";
import {
  isMessageSaved,
  resolveConversationDisplayTitle,
  resolveSenderDisplayName,
} from "./chat-actions";

export type SavedMessageSourceType = "dm" | "group" | "thread";
export type SavedMessageFilterType = "all" | SavedMessageSourceType;

export const SAVED_CONTENT_PREVIEW_MAX_CHARS = 240;

export interface SavedMessageItem {
  message: Message;
  messageId: string;
  conversationId: string;
  threadId: string | null;
  senderId: string;
  senderName: string;
  conversationTitle: string;
  conversationKind: Conversation["kind"];
  sourceType: SavedMessageSourceType;
  savedAt: string;
  savedAtMs: number;
  createdAt: number;
  content: string;
  previewContent: string;
}

export interface FilterSavedMessagesInput {
  messages: readonly Message[];
  conversations: readonly Conversation[];
  assistants: readonly Assistant[];
  filterType?: SavedMessageFilterType;
  query?: string;
}

export function parseSavedTimestampMs(savedAt: string | undefined, fallbackMs: number): number {
  if (!savedAt) return fallbackMs;
  const trimmed = savedAt.trim();
  if (!trimmed) return fallbackMs;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallbackMs;
}

export function inferSavedMessageSourceType(
  message: Pick<Message, "threadId">,
  conversation: Pick<Conversation, "kind"> | undefined,
): SavedMessageSourceType {
  if (typeof message.threadId === "string" && message.threadId.trim().length > 0) {
    return "thread";
  }
  if (conversation?.kind === "group") {
    return "group";
  }
  return "dm";
}

export function formatSavedMessagePreview(
  content: string,
  maxChars = SAVED_CONTENT_PREVIEW_MAX_CHARS,
): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars)).trimEnd()}…`;
}

export function filterSavedMessages(input: FilterSavedMessagesInput): SavedMessageItem[] {
  const filterType = input.filterType ?? "all";
  const normalizedQuery = (input.query ?? "").trim().toLowerCase();
  const conversationsById = new Map(input.conversations.map((conv) => [conv.id, conv]));

  const items: SavedMessageItem[] = [];
  for (const message of input.messages) {
    if (!isMessageSaved(message) || !message.savedAt) continue;
    const conversation = conversationsById.get(message.conversationId);
    const sourceType = inferSavedMessageSourceType(message, conversation);
    if (filterType !== "all" && sourceType !== filterType) continue;

    const senderName = resolveSenderDisplayName(message.senderId, input.assistants);
    const conversationTitle = resolveConversationDisplayTitle(conversation, input.assistants);
    const savedAtMs = parseSavedTimestampMs(message.savedAt, message.createdAt);

    if (normalizedQuery) {
      const haystack =
        `${message.content} ${senderName} ${conversationTitle} ${sourceType}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) continue;
    }

    items.push({
      message,
      messageId: message.id,
      conversationId: message.conversationId,
      threadId: message.threadId,
      senderId: message.senderId,
      senderName,
      conversationTitle,
      conversationKind: conversation?.kind ?? "dm",
      sourceType,
      savedAt: message.savedAt,
      savedAtMs,
      createdAt: message.createdAt,
      content: message.content,
      previewContent: formatSavedMessagePreview(message.content),
    });
  }

  return [...items].sort((left, right) => {
    if (right.savedAtMs !== left.savedAtMs) return right.savedAtMs - left.savedAtMs;
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
    return left.messageId.localeCompare(right.messageId);
  });
}
