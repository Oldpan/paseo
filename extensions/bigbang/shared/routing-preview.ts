// Who a user message will wake. The server routes with this and the composer previews with it,
// so the hint can never disagree with the dispatch. Pure: no node or app imports.
import { findMentionedAgents, mentionable } from "./member-mentions";
import { resolveOrdinaryChannelRoute, type OrdinaryRouteReason } from "./routing";

export interface PreviewMember {
  id: string;
  name: string;
}
export interface RoutePreview {
  leadId: string;
  /** Addressed directly: they get a normal reply turn. */
  explicitIds: string[];
  /** Recently active but not addressed: they may stay silent. */
  recentOnlyIds: string[];
  reason: OrdinaryRouteReason;
}

export function previewRoute(input: {
  members: readonly PreviewMember[];
  content: string;
  /** Sender of the assistant message being quoted, when there is one. */
  quotedSenderId?: string | null;
  /** Assistants with a recent visible reply here, most recent first. */
  recentParticipantIds?: readonly string[];
  defaultResponderId?: string | null;
}): RoutePreview | null {
  const mentioned = findMentionedAgents(input.content, mentionable(input.members));
  const route = resolveOrdinaryChannelRoute({
    memberAgentIds: new Set(input.members.map((member) => member.id)),
    mentionedAgentIds: mentioned.map((member) => member.id),
    quotedAgentId: input.quotedSenderId,
    recentParticipantAgentIds: input.recentParticipantIds,
    defaultResponderAgentId: input.defaultResponderId,
    firstMemberAgentId: input.members[0]?.id,
  });
  if (!route) return null;
  return {
    leadId: route.leadAgentId,
    explicitIds: route.explicitAgentIds,
    recentOnlyIds: route.recentOnlyAgentIds,
    reason: route.reason,
  };
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    ordered.push(trimmed);
  }
  return ordered;
}
function multiHint(names: readonly string[], discussInOrder: boolean): string | null {
  if (names.length < 2) return null;
  const who =
    names.length === 2
      ? `@${names[0]} and @${names[1]}`
      : `@${names[0]} and ${names.length - 1} others`;
  return discussInOrder ? `${who} will discuss in order.` : `${who} may reply.`;
}

function willReply(names: readonly string[]): string {
  if (names.length === 1) return `@${names[0]} will reply`;
  if (names.length === 2) return `@${names[0]} and @${names[1]} will reply`;
  return `@${names[0]} and ${names.length - 1} others will reply`;
}

/** "@X will reply; N active may respond" for a route, by name. */
export function formatResponderHint(params: {
  explicitNames: readonly string[];
  recentNames: readonly string[];
  discussInOrder?: boolean;
}): string | null {
  const explicit = uniqueNames(params.explicitNames);
  const taken = new Set(explicit.map((name) => name.toLowerCase()));
  const recent = uniqueNames(params.recentNames).filter((name) => !taken.has(name.toLowerCase()));
  if (params.discussInOrder && explicit.length >= 2) return multiHint(explicit, true);
  if (explicit.length >= 1 && recent.length >= 1) {
    const extra =
      recent.length === 1
        ? "1 active assistant may also respond"
        : `${recent.length} active assistants may also respond`;
    const lead = willReply(explicit);
    return `${lead}; ${extra}.`;
  }
  if (explicit.length >= 2) return multiHint(explicit, false);
  if (explicit.length === 1) return `@${explicit[0]} will reply.`;
  if (recent.length >= 2) return multiHint(recent, false);
  return recent.length === 1 ? `@${recent[0]} will reply.` : null;
}

export function formatRouteHint(
  preview: RoutePreview | null,
  members: readonly PreviewMember[],
  options: { discussInOrder?: boolean } = {},
): string | null {
  if (!preview) return null;
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? "";
  return formatResponderHint({
    explicitNames: preview.explicitIds.map(nameOf),
    recentNames: preview.recentOnlyIds.map(nameOf),
    discussInOrder: options.discussInOrder,
  });
}
