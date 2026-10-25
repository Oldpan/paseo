import {
  CHANNEL_ALL_MENTION_NAME,
  extractMentionedNames,
  stripIgnoredMentionContexts,
} from "../shared/mentions";

interface MentionableAgent {
  agentId: string;
  name: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve @mentions against live Channel members.
 * Unspaced names use the protocol tokenizer; names with spaces match the same
 * `@Full Name ` encoding the desktop composer writes (longest name first).
 */
export function findMentionedAgents<T extends MentionableAgent>(
  content: string,
  agents: readonly T[],
): T[] {
  const mentionedNames = extractMentionedNames(content);
  if (mentionedNames.includes(CHANNEL_ALL_MENTION_NAME)) {
    return [...agents];
  }

  const sanitized = stripIgnoredMentionContexts(content);
  const hits: Array<{ start: number; agent: T }> = [];
  const consumed: Array<{ start: number; end: number }> = [];
  const sorted = [...agents].sort((left, right) => right.name.length - left.name.length);
  for (const agent of sorted) {
    const name = agent.name.trim();
    if (!name) continue;
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9_.])@(${escapeRegExp(name)})(?=$|[^A-Za-z0-9_-])`,
      "ig",
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sanitized)) !== null) {
      const start = match.index + match[1].length;
      const end = start + 1 + name.length;
      if (consumed.some((span) => start < span.end && end > span.start)) continue;
      consumed.push({ start, end });
      hits.push({ start, agent });
    }
  }
  hits.sort((left, right) => left.start - right.start);
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const hit of hits) {
    if (seen.has(hit.agent.agentId)) continue;
    seen.add(hit.agent.agentId);
    ordered.push(hit.agent);
  }
  return ordered;
}

export function getChannelAllMentionValidationError(params: {
  content: string;
  sendAsTask: boolean;
  slashCommandName?: string | null;
}): string | null {
  if (!extractMentionedNames(params.content).includes(CHANNEL_ALL_MENTION_NAME)) return null;
  if (params.sendAsTask) {
    return "As Task does not support @all; mention one explicit Agent as the task owner.";
  }
  if (/^(?:panel(?::plan)?|tool(?::plan)?)$/u.test(params.slashCommandName ?? "")) {
    return "@all is not available for /panel or /tool; mention one explicit Agent.";
  }
  return null;
}
