import type { RpcInput } from "@getpaseo/plugin";
import type {
  Assistant,
  Conversation,
  ForwardedFrom,
  Message,
  RoutineCadence,
  Takeover,
  Task,
  saveMessage,
  saveRoutine,
  sendMessage,
  startTask,
} from "../../../../extensions/pavra/shared/contracts";
import { normalizePlaybookSlug, titleFromSlug } from "./playbooks";

export interface ForwardMessageSource {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: number;
}

export interface ForwardConversationTarget {
  conversation: Conversation;
  title: string;
  subtitle: string;
  kind: Conversation["kind"];
  memberNames: string[];
  isOrigin: boolean;
}

export interface TaskDraftFromMessage {
  title: string;
  goal: string;
  defaultAssistantId: string | undefined;
}

export interface PromoteTaskTargetOption {
  key: string;
  label: string;
  serverId: string;
  directory: string;
  isolation: Task["isolation"];
}

export interface PlaybookDraft {
  slug: string;
  title: string;
  steps: string[];
  content: string;
  defaultAssistantId: string | undefined;
  routinePrompt: string;
}

export const TASK_BUDGET_PRESETS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
] as const;

export const PLAYBOOK_ROUTINE_CADENCE_PRESETS: ReadonlyArray<{
  key: string;
  label: string;
  cadence: RoutineCadence;
}> = [
  {
    key: "every-30m",
    label: "Every 30m",
    cadence: { type: "every", everyMs: 30 * 60_000 },
  },
  {
    key: "every-1h",
    label: "Every 1h",
    cadence: { type: "every", everyMs: 60 * 60_000 },
  },
  {
    key: "daily-9am",
    label: "Daily 09:00",
    cadence: { type: "cron", expression: "0 9 * * *" },
  },
];

export function isMessageSaved(message: Pick<Message, "savedAt"> | null | undefined): boolean {
  return typeof message?.savedAt === "string" && message.savedAt.trim().length > 0;
}

export function buildSaveMessageRequest(input: {
  message: Pick<Message, "id" | "conversationId" | "savedAt">;
  saved?: boolean;
}): RpcInput<typeof saveMessage> {
  const nextSaved = input.saved ?? !isMessageSaved(input.message);
  return {
    conversationId: input.message.conversationId,
    messageId: input.message.id,
    saved: nextSaved,
  };
}

export function resolveSenderDisplayName(
  senderId: string,
  assistants: readonly Pick<Assistant, "id" | "name">[],
): string {
  if (senderId === "user") return "You";
  if (senderId === "system") return "System";
  return assistants.find((assistant) => assistant.id === senderId)?.name ?? "Assistant";
}

export function resolveConversationDisplayTitle(
  conversation: Pick<Conversation, "name" | "kind" | "members"> | null | undefined,
  assistants: readonly Pick<Assistant, "id" | "name">[],
): string {
  if (!conversation) return "Chat";
  const trimmed = conversation.name.trim();
  if (trimmed) return trimmed;
  if (conversation.kind === "dm") {
    const member = assistants.find((assistant) => assistant.id === conversation.members[0]);
    if (member) return member.name;
  }
  return conversation.kind === "group" ? "Group Chat" : "Direct Message";
}

export function buildForwardSource(input: {
  message: Pick<Message, "id" | "conversationId" | "senderId" | "content" | "createdAt">;
  conversations: readonly Conversation[];
  assistants: readonly Assistant[];
}): ForwardMessageSource {
  const conversation = input.conversations.find((item) => item.id === input.message.conversationId);
  return {
    messageId: input.message.id,
    conversationId: input.message.conversationId,
    conversationTitle: resolveConversationDisplayTitle(conversation, input.assistants),
    senderId: input.message.senderId,
    senderName: resolveSenderDisplayName(input.message.senderId, input.assistants),
    content: input.message.content,
    createdAt: input.message.createdAt,
  };
}

export function listForwardTargets(input: {
  conversations: readonly Conversation[];
  assistants: readonly Assistant[];
  query?: string;
  originConversationId?: string;
}): ForwardConversationTarget[] {
  const assistantById = new Map(input.assistants.map((assistant) => [assistant.id, assistant]));
  const normalizedQuery = (input.query ?? "").trim().toLowerCase();

  const targets: ForwardConversationTarget[] = [];
  for (const conversation of input.conversations) {
    const memberNames = conversation.members
      .map((id) => assistantById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    const title = resolveConversationDisplayTitle(conversation, input.assistants);
    const subtitle =
      conversation.kind === "dm"
        ? `Direct message · ${memberNames[0] ?? "Assistant"}`
        : `Group · ${memberNames.join(", ") || `${conversation.members.length} members`}`;
    if (normalizedQuery) {
      const haystack =
        `${title} ${subtitle} ${conversation.kind} ${memberNames.join(" ")}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) continue;
    }
    targets.push({
      conversation,
      title,
      subtitle,
      kind: conversation.kind,
      memberNames,
      isOrigin: conversation.id === input.originConversationId,
    });
  }

  return [...targets].sort((left, right) => {
    if (left.isOrigin !== right.isOrigin) return left.isOrigin ? 1 : -1;
    if (left.kind !== right.kind) return left.kind === "dm" ? -1 : 1;
    return left.title.localeCompare(right.title);
  });
}

export function formatForwardedContent(
  source: Pick<ForwardMessageSource, "senderName" | "conversationTitle" | "content">,
  comment?: string,
): string {
  const header =
    source.conversationTitle && source.conversationTitle !== source.senderName
      ? `> **Forwarded from ${source.senderName}** (${source.conversationTitle})`
      : `> **Forwarded from ${source.senderName}**`;
  const rawBody = source.content.trim() || "(empty message)";
  const quotedBody = rawBody
    .split(/\r?\n/)
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
  const trimmedComment = comment?.trim() ?? "";
  return trimmedComment
    ? `${trimmedComment}\n\n${header}\n${quotedBody}`
    : `${header}\n${quotedBody}`;
}

export function buildForwardSendInput(input: {
  id: string;
  targetConversationId: string;
  targetThreadId?: string | null;
  source: ForwardMessageSource;
  comment?: string;
}): RpcInput<typeof sendMessage> {
  const forwardedFrom: ForwardedFrom = {
    conversationId: input.source.conversationId,
    conversationTitle: input.source.conversationTitle,
    senderName: input.source.senderName,
    messageId: input.source.messageId,
  };
  return {
    id: input.id,
    conversationId: input.targetConversationId,
    threadId: input.targetThreadId ?? null,
    content: formatForwardedContent(input.source, input.comment),
    forwardedFrom,
  };
}

export function formatForwardedBadge(
  forwardedFrom: ForwardedFrom | null | undefined,
): string | null {
  if (!forwardedFrom) return null;
  const sender = forwardedFrom.senderName.trim() || "Chat";
  const title = forwardedFrom.conversationTitle.trim();
  if (title && title !== sender) {
    return `Forwarded from ${sender} · ${title}`;
  }
  return `Forwarded from ${sender}`;
}

function cleanLineForTitle(rawLine: string): string {
  return rawLine
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s*/, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateTitle(text: string, maxLength = 72): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function buildMemberSet(input: {
  conversation?: Pick<Conversation, "members"> | null;
  assistants?: readonly Pick<Assistant, "id">[];
}): Set<string> | null {
  if (input.conversation) return new Set(input.conversation.members);
  if (input.assistants) return new Set(input.assistants.map((assistant) => assistant.id));
  return null;
}

export function resolveDefaultAssistantId(input: {
  senderId?: string | null;
  conversation?: Pick<Conversation, "members" | "defaultResponderId"> | null;
  assistants?: readonly Pick<Assistant, "id" | "name">[];
}): string | undefined {
  const memberSet = buildMemberSet(input);

  if (
    input.senderId &&
    input.senderId !== "user" &&
    input.senderId !== "system" &&
    (!memberSet || memberSet.has(input.senderId))
  ) {
    return input.senderId;
  }
  if (
    input.conversation?.defaultResponderId &&
    (!memberSet || memberSet.has(input.conversation.defaultResponderId))
  ) {
    return input.conversation.defaultResponderId;
  }
  return input.conversation?.members[0] ?? input.assistants?.[0]?.id;
}

export function deriveTaskDraftFromMessage(input: {
  message: Pick<Message, "content" | "senderId">;
  conversation?: Pick<Conversation, "members" | "defaultResponderId"> | null;
  assistants?: readonly Pick<Assistant, "id" | "name">[];
}): TaskDraftFromMessage {
  const rawContent = input.message.content.trim();
  const firstCandidate =
    rawContent
      .split(/\r?\n/)
      .map((line) => cleanLineForTitle(line))
      .find((line) => line.length > 0 && !line.toLowerCase().startsWith("forwarded from ")) ?? "";

  const title = firstCandidate ? truncateTitle(firstCandidate, 72) : "Follow-up task";
  const goal = rawContent || title;

  return {
    title,
    goal,
    defaultAssistantId: resolveDefaultAssistantId({
      senderId: input.message.senderId,
      conversation: input.conversation,
      assistants: input.assistants,
    }),
  };
}

export function resolvePromoteTaskTargets(input: {
  assistant: Pick<Assistant, "serverId" | "autonomy"> | null | undefined;
  defaultDirectory?: string;
  defaultServerId?: string;
}): PromoteTaskTargetOption[] {
  const configured = input.assistant?.autonomy?.targets ?? [];
  const options: PromoteTaskTargetOption[] = [];
  const seen = new Set<string>();

  for (const target of configured) {
    const serverId =
      target.serverId || input.assistant?.serverId || input.defaultServerId || "local";
    const key = `${serverId}:${target.directory}:${target.isolation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hostPrefix = target.label?.trim() || (serverId === "local" ? "local" : serverId);
    options.push({
      key,
      label: `${hostPrefix} · ${target.directory} (${target.isolation})`,
      serverId,
      directory: target.directory,
      isolation: target.isolation,
    });
  }

  const fallbackDir = input.defaultDirectory?.trim();
  if (fallbackDir) {
    const serverId = input.assistant?.serverId || input.defaultServerId || "local";
    const key = `${serverId}:${fallbackDir}:worktree`;
    if (!seen.has(key)) {
      options.push({
        key,
        label: `${serverId === "local" ? "local" : serverId} · ${fallbackDir} (worktree)`,
        serverId,
        directory: fallbackDir,
        isolation: "worktree",
      });
    }
  }

  return options;
}

export function buildPromoteToTaskInput(input: {
  id: string;
  conversationId: string;
  assistant: Pick<Assistant, "id" | "provider" | "serverId">;
  title: string;
  goal: string;
  serverId?: string;
  directory: string;
  isolation: Task["isolation"];
  budgetMinutes?: number;
}): RpcInput<typeof startTask> {
  const trimmedTitle = input.title.trim() || "Follow-up task";
  const trimmedGoal = input.goal.trim() || trimmedTitle;
  const trimmedDir = input.directory.trim();
  const resolvedServerId = input.serverId?.trim() || input.assistant.serverId || "local";

  return {
    id: input.id,
    conversationId: input.conversationId,
    assistantId: input.assistant.id,
    title: trimmedTitle,
    prompt: trimmedGoal,
    serverId: resolvedServerId,
    directory: trimmedDir,
    provider: input.assistant.provider,
    isolation: input.isolation,
    ...(input.budgetMinutes !== undefined ? { budgetMinutes: input.budgetMinutes } : {}),
  };
}

function extractStepsFromMarkdown(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const explicitSteps: string[] = [];

  for (const rawLine of lines) {
    const numbered = rawLine.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered?.[1]) {
      const cleaned = cleanLineForTitle(numbered[1]);
      if (cleaned) explicitSteps.push(cleaned);
      continue;
    }
    const bulleted = rawLine.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (bulleted?.[1]) {
      const cleaned = cleanLineForTitle(bulleted[1]);
      if (cleaned) explicitSteps.push(cleaned);
    }
  }

  if (explicitSteps.length > 0) return explicitSteps.slice(0, 12);

  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => cleanLineForTitle(block))
    .filter((block) => block.length > 0);

  if (paragraphs.length > 1) {
    return paragraphs.slice(0, 8).map((paragraph) => truncateTitle(paragraph, 140));
  }
  if (paragraphs.length === 1) {
    const sentences = paragraphs[0]!
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (sentences.length > 1) return sentences.slice(0, 8);
    return [paragraphs[0]!];
  }

  return ["Review context and preconditions.", "Execute the procedure and verify the result."];
}

function extractPlaybookRawTitle(
  rawMessageContent: string,
  takeover: Pick<Takeover, "reason" | "title"> | null,
): string {
  const headingMatch = rawMessageContent.match(/^\s*#{1,3}\s+(.+)$/m);
  if (headingMatch?.[1]) return cleanLineForTitle(headingMatch[1]);
  if (takeover?.title?.trim()) return cleanLineForTitle(takeover.title);
  if (takeover?.reason?.trim()) return cleanLineForTitle(takeover.reason);
  if (!rawMessageContent) return "";
  return (
    rawMessageContent
      .split(/\r?\n/)
      .map((line) => cleanLineForTitle(line))
      .find((line) => line.length > 0) ?? ""
  );
}

function buildTakeoverStepsAndGoal(
  takeover: Pick<Takeover, "reason" | "url">,
  takeoverNote: string | undefined,
  rawMessageContent: string,
): { steps: string[]; goalSummary: string } {
  const url = takeover.url?.trim() ?? "";
  const urlPart = url ? ` on ${url}` : "";
  const goalSummary = `Complete "${takeover.reason.trim()}"${urlPart} and verify the resulting state.`;
  const noteSteps = takeoverNote?.trim() ? extractStepsFromMarkdown(takeoverNote.trim()) : [];
  const messageSteps = rawMessageContent ? extractStepsFromMarkdown(rawMessageContent) : [];
  const steps = [
    ...(url ? [`Navigate to ${url} and inspect the page state.`] : []),
    `Handle takeover requirement: ${takeover.reason.trim()}.`,
    ...noteSteps,
    ...messageSteps,
    "Verify the page state and continue the workflow.",
  ].slice(0, 10);
  return { steps, goalSummary };
}

export function derivePlaybookDraft(input: {
  message?: Pick<Message, "id" | "content" | "senderId"> | null;
  takeover?: Pick<Takeover, "id" | "assistantId" | "reason" | "url" | "title"> | null;
  takeoverNote?: string;
  conversation?: Pick<Conversation, "members" | "defaultResponderId"> | null;
  assistants?: readonly Pick<Assistant, "id" | "name">[];
}): PlaybookDraft {
  const takeover = input.takeover ?? null;
  const message = input.message ?? null;
  const rawMessageContent = message?.content?.trim() ?? "";

  const rawTitle = extractPlaybookRawTitle(rawMessageContent, takeover);
  const fallbackSlug = takeover ? "takeover-playbook" : "show-me-playbook";
  const slug = normalizePlaybookSlug(rawTitle) || fallbackSlug;
  const title = rawTitle ? truncateTitle(rawTitle, 64) : titleFromSlug(slug);

  const { steps, goalSummary } = takeover
    ? buildTakeoverStepsAndGoal(takeover, input.takeoverNote, rawMessageContent)
    : {
        steps: extractStepsFromMarkdown(rawMessageContent),
        goalSummary:
          cleanLineForTitle(rawMessageContent.split(/\n{2,}/)[0]?.trim() ?? "") ||
          `Reusable procedure for ${title}.`,
      };

  const numberedSteps = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const content = [
    `# ${title}`,
    "",
    "## Goal",
    goalSummary,
    "",
    "## Steps",
    numberedSteps,
    "",
    "## Verification",
    "- Confirm expected output and report any blockers.",
    "",
  ].join("\n");

  const defaultAssistantId =
    takeover?.assistantId ??
    resolveDefaultAssistantId({
      senderId: message?.senderId,
      conversation: input.conversation,
      assistants: input.assistants,
    });

  return {
    slug,
    title,
    steps,
    content,
    defaultAssistantId,
    routinePrompt: `Follow playbook \`playbooks/${slug}.md\` (${title}). Reply with (pass) when nothing needs attention.`,
  };
}

export function buildPlaybookRoutineInput(input: {
  name: string;
  slug: string;
  assistantId: string;
  conversationId: string;
  threadId?: string | null;
  cadence?: RoutineCadence;
  customPrompt?: string;
}): RpcInput<typeof saveRoutine> {
  const cleanSlug = normalizePlaybookSlug(input.slug) || "show-me-playbook";
  const cleanName = input.name.trim() || titleFromSlug(cleanSlug);
  const prompt =
    input.customPrompt?.trim() ||
    `Follow playbook \`playbooks/${cleanSlug}.md\` (${cleanName}). Reply with (pass) when nothing needs attention.`;
  return {
    name: cleanName.slice(0, 80),
    prompt,
    assistantId: input.assistantId,
    conversationId: input.conversationId,
    threadId: input.threadId ?? null,
    cadence: input.cadence ?? { type: "every", everyMs: 60 * 60_000 },
  };
}
