import type { PeerMessage, Studio } from "../../../../extensions/bigbang/shared/contracts";

const OPEN = new Set(["queued", "delivered", "acked"]);

export interface OpenExchange {
  id: string;
  /** "Ada → Sa · Spark" */
  route: string;
  state: string;
  text: string;
}

function peerLabel(peer: PeerMessage["recipient"]): string {
  return peer.machine ? `${peer.name} · ${peer.machine}` : peer.name;
}
function excerpt(text: string, max = 140): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Mailbox requests asked from this chat lane that are still open: not answered yet, or answered
 * and waiting for the asking assistant to be free. Settled exchanges live in the assistant's reply.
 */
export function openExchanges(
  messages: readonly PeerMessage[],
  conversationId: string,
  threadId: string | null,
): OpenExchange[] {
  const replies = new Map(
    messages.filter((row) => row.kind === "reply" && row.replyTo).map((row) => [row.replyTo!, row]),
  );
  return messages
    .filter(
      (row) =>
        row.ledger === "mailbox" &&
        (row.kind === "request" || row.kind === "info") &&
        row.conversationId === conversationId &&
        (row.threadId ?? null) === threadId,
    )
    .flatMap((row) => {
      const reply = replies.get(row.id);
      if (reply && reply.status !== "queued") return [];
      if (!reply && !OPEN.has(row.status)) return [];
      if (row.kind === "info" && row.status === "acked") return [];
      return [
        {
          id: row.id,
          route: `${row.sender?.name ?? "?"} → ${peerLabel(row.recipient)}`,
          state: exchangeState(row, reply),
          text: excerpt(reply ? reply.text : row.text),
        },
      ];
    })
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

function exchangeState(request: PeerMessage, reply: PeerMessage | undefined): string {
  if (reply)
    return reply.detail === "failed" ? "Could not help; telling the assistant" : "Answered";
  if (request.status === "queued") return "Waiting to be delivered";
  if (request.status === "delivered") return "Waiting for a free moment";
  return request.recipient.kind === "agent" ? "Delivered" : "Working on it";
}

export interface RecordRow {
  id: string;
  depth: number;
  route: string;
  kind: string;
  status: string;
  detail: string;
  text: string;
  createdAt: number;
}

/** A Studio's records, oldest first, with replies under the message they answer. */
export function studioRecords(messages: readonly PeerMessage[], studio: Studio): RecordRow[] {
  const own = messages
    .filter((row) => row.ledger === "studio" && row.studioId === studio.id)
    .toSorted((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const ids = new Set(own.map((row) => row.id));
  const children = new Map<string, PeerMessage[]>();
  for (const row of own)
    if (row.replyTo && ids.has(row.replyTo))
      children.set(row.replyTo, [...(children.get(row.replyTo) ?? []), row]);
  const rows: RecordRow[] = [];
  const visit = (row: PeerMessage, depth: number) => {
    rows.push({
      id: row.id,
      depth,
      route: `${row.sender ? peerLabel(row.sender) : "Studio"} → ${peerLabel(row.recipient)}`,
      kind: row.kind,
      status: row.status,
      detail: row.code ?? "",
      text: excerpt(row.text, 240),
      createdAt: row.createdAt,
    });
    for (const child of children.get(row.id) ?? []) visit(child, depth + 1);
  };
  for (const row of own) if (!row.replyTo || !ids.has(row.replyTo)) visit(row, 0);
  return rows;
}

/** The active Studio that collaborates for a Studio tab group, by name. */
export function studioForGroup(studios: readonly Studio[], group: string): Studio | undefined {
  return studios.find((studio) => studio.status === "active" && studio.name === group);
}
