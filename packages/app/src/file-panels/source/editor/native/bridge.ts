export const MAX_EDITOR_MESSAGE_BYTES = 20 * 1024 * 1024;

export interface NativeEditorMessage {
  type: "ready" | "change" | "save" | "state" | "error";
  sessionId: string;
  revision: number;
  sourceRevision?: number;
  content?: string;
  line?: number;
  column?: number;
  message?: string;
}

// Derived from Bigbang's native editor bridge. Every document has its own session and revision.
export function parseEditorMessage(
  raw: string,
  sessionId: string,
  revision: number,
): NativeEditorMessage | null {
  if (
    raw.length > MAX_EDITOR_MESSAGE_BYTES ||
    new TextEncoder().encode(raw).length > MAX_EDITOR_MESSAGE_BYTES
  )
    return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const message = value as NativeEditorMessage;
    if (
      message.sessionId !== sessionId ||
      !Number.isSafeInteger(message.revision) ||
      message.revision < revision
    )
      return null;
    if (!["ready", "change", "save", "state", "error"].includes(message.type)) return null;
    if (!validEditorPayload(message, revision)) return null;
    if (message.type === "error" && typeof message.message !== "string") return null;
    return message;
  } catch {
    return null;
  }
}

function validEditorPayload(message: NativeEditorMessage, revision: number): boolean {
  if (
    message.type === "change" &&
    (message.revision <= revision ||
      typeof message.content !== "string" ||
      !Number.isSafeInteger(message.sourceRevision) ||
      message.sourceRevision! < 0)
  )
    return false;
  if (
    message.type === "state" &&
    (!Number.isSafeInteger(message.line) ||
      !Number.isSafeInteger(message.column) ||
      message.line! < 1 ||
      message.column! < 1)
  )
    return false;
  return true;
}

export function editorScript(message: object): string {
  const json = JSON.stringify(message)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.paseoEditorReceive(${json});true;`;
}

export function allowEditorNavigation(url: string): boolean {
  return url === "about:blank";
}
