// Migrated from Bigbang ordinaryChannelRouting.
export type OrdinaryRouteReason =
  | "mention"
  | "quote"
  | "slash"
  | "recent"
  | "focus"
  | "default_responder"
  | "first_member";

export interface OrdinaryChannelRoute {
  leadAgentId: string;
  directAgentIds: string[];
  explicitAgentIds: string[];
  recentOnlyAgentIds: string[];
  dispatchAgentIds: string[];
  reason: OrdinaryRouteReason;
}

export function resolveOrdinaryChannelRoute(params: {
  memberAgentIds: ReadonlySet<string>;
  mentionedAgentIds?: readonly string[];
  quotedAgentId?: string | null;
  slashTargetAgentId?: string | null;
  recentParticipantAgentIds?: readonly string[];
  defaultResponderAgentId?: string | null;
  firstMemberAgentId?: string | null;
}): OrdinaryChannelRoute | null {
  const members = params.memberAgentIds;
  const mentioned = uniqueMembers(params.mentionedAgentIds ?? [], members);
  const recent = uniqueMembers(params.recentParticipantAgentIds ?? [], members);

  const slashTargetAgentId = memberOrNull(params.slashTargetAgentId, members);
  if (slashTargetAgentId) {
    return buildRoute("slash", [slashTargetAgentId], []);
  }

  if (mentioned.length > 0) {
    return buildRoute("mention", mentioned, recent);
  }

  const quotedAgentId = memberOrNull(params.quotedAgentId, members);
  if (quotedAgentId) {
    return buildRoute("quote", [quotedAgentId], recent);
  }

  if (recent.length > 0) {
    return buildRoute("recent", [], recent);
  }

  const defaultResponderAgentId = memberOrNull(params.defaultResponderAgentId, members);
  if (defaultResponderAgentId) {
    return buildRoute("default_responder", [defaultResponderAgentId], []);
  }

  const firstMemberAgentId = memberOrNull(params.firstMemberAgentId, members);
  if (firstMemberAgentId) {
    return buildRoute("first_member", [firstMemberAgentId], []);
  }

  return null;
}

function buildRoute(
  reason: OrdinaryRouteReason,
  explicitAgentIds: readonly string[],
  recentParticipantAgentIds: readonly string[],
): OrdinaryChannelRoute {
  const explicit = uniquePreserve(explicitAgentIds);
  const explicitSet = new Set(explicit);
  const recentOnlyAgentIds = uniquePreserve(recentParticipantAgentIds).filter(
    (agentId) => !explicitSet.has(agentId),
  );
  const dispatchAgentIds = [...explicit, ...recentOnlyAgentIds];
  const leadAgentId = dispatchAgentIds[0];
  if (!leadAgentId) {
    throw new Error("Ordinary Channel route requires at least one legal Agent");
  }
  const directAgentIds = explicit.length > 0 ? [...explicit] : [...dispatchAgentIds];
  return {
    leadAgentId,
    directAgentIds,
    explicitAgentIds: explicit,
    recentOnlyAgentIds,
    dispatchAgentIds,
    reason,
  };
}

function memberOrNull(
  agentId: string | null | undefined,
  members: ReadonlySet<string>,
): string | null {
  if (!agentId || !members.has(agentId)) return null;
  return agentId;
}

function uniqueMembers(agentIds: readonly string[], members: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const agentId of agentIds) {
    if (!members.has(agentId) || seen.has(agentId)) continue;
    seen.add(agentId);
    ordered.push(agentId);
  }
  return ordered;
}

function uniquePreserve(agentIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const agentId of agentIds) {
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    ordered.push(agentId);
  }
  return ordered;
}
