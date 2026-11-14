// Peers are addressed by key so the mailbox and Studio ledgers can name either kind.
export function assistantPeerKey(assistantId: string): string {
  return `assistant:${assistantId}`;
}
export function agentPeerKey(serverId: string, agentId: string): string {
  return `agent:${serverId}:${agentId}`;
}
export function assistantIdOfKey(key: string): string | null {
  return key.startsWith("assistant:") ? key.slice("assistant:".length) : null;
}
export function agentOfKey(key: string): { serverId: string; agentId: string } | null {
  if (!key.startsWith("agent:")) return null;
  const rest = key.slice("agent:".length);
  const split = rest.indexOf(":");
  return split > 0 ? { serverId: rest.slice(0, split), agentId: rest.slice(split + 1) } : null;
}
