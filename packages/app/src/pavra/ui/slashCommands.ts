// Migrated from Bigbang apps/app/src/slashCommands.ts. Keep presentation changes reviewable against that source.
import { resolveRasterImageMimeType } from "../../attachments/file-types";

type AgentType = string;
interface ConversationPromptSlashCommand {
  name: string;
  bodyText: string;
}

export type SlashCommandSurface =
  | "primary_dm"
  | "dm_task_thread"
  | "channel_root"
  | "channel_thread"
  | "workspace";

export interface SlashCommandDescriptor {
  name: string;
  description: string;
  argumentHint?: string;
  scopeHint?: string;
  enabled: boolean;
  disabledReason?: string;
}

// Pavra Chat slash commands available in the composer.
const COMMANDS: Array<
  Omit<SlashCommandDescriptor, "enabled" | "disabledReason"> & { kind: string }
> = [
  {
    name: "task",
    argumentHint: "<goal>",
    description: "Create a background task or prefill the task prompt",
    kind: "all",
  },
  {
    name: "steer",
    argumentHint: "<instruction>",
    description: "Steer the active turn immediately with new instructions",
    kind: "all",
  },
  {
    name: "status",
    description: "Ask for a concise status check on current work",
    kind: "all",
  },
  {
    name: "pass",
    description: "Send a quick pass / status check prompt",
    kind: "all",
  },
  {
    name: "clear",
    description: "Clear the current message draft",
    kind: "all",
  },
];

export type SlashCommandAction =
  | { kind: "clear"; command: SlashCommandDescriptor }
  | { kind: "task"; command: SlashCommandDescriptor; goal: string }
  | { kind: "steer"; command: SlashCommandDescriptor; instruction: string }
  | { kind: "send"; command: SlashCommandDescriptor; content: string }
  | { kind: "autocomplete"; command: SlashCommandDescriptor; replacement: string };

export function resolveSlashCommands(
  surface: SlashCommandSurface,
  agentType?: AgentType | null,
): SlashCommandDescriptor[] {
  void agentType;
  return COMMANDS.map((command) => {
    if (command.kind === "primary_dm") {
      const enabled = surface === "primary_dm";
      return Object.assign({}, command, {
        enabled,
        disabledReason: enabled ? undefined : "Primary DM chat only.",
      });
    }
    const enabled = surface !== "workspace";
    return Object.assign({}, command, {
      enabled,
      disabledReason: enabled ? undefined : "Chat conversations only.",
    });
  });
}

export function findMatchingSlashCommands(
  text: string,
  commands: SlashCommandDescriptor[],
): SlashCommandDescriptor[] {
  const normalized = text.replace(/^\s*／/u, "/").trimStart();
  if (!normalized.startsWith("/")) return [];
  const after = normalized.slice(1);
  if (/\s/u.test(after)) return [];
  if (after.length > 0 && !/^[A-Za-z0-9:_-]*$/u.test(after)) return [];
  const prefix = after.toLowerCase();
  return commands.filter((command) => command.name.startsWith(prefix));
}

export function replaceLeadingSlashCommand(text: string, commandName: string): string {
  const leading = text.match(/^\s*/u)?.[0] ?? "";
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return `${leading}/${commandName} `;
  const space = trimmed.search(/\s/u);
  const rest = space >= 0 ? trimmed.slice(space).trimStart() : "";
  return `${leading}/${commandName}${rest ? ` ${rest}` : " "}`;
}

export function parseSlashInvocation(
  text: string,
  commands: SlashCommandDescriptor[],
): { command: SlashCommandDescriptor; bodyText: string } | null {
  const normalized = text.replace(/^\s*／/u, "/").trimStart();
  const match = normalized.match(/^\/([A-Za-z0-9:_-]+)(?:\s+([\s\S]*))?$/u);
  if (!match) return null;
  const command = commands.find((item) => item.name === match[1]?.trim().toLowerCase());
  if (!command) return null;
  return { command, bodyText: match[2]?.trim() ?? "" };
}

export function buildPromptSlashCommand(invocation: {
  command: SlashCommandDescriptor;
  bodyText: string;
}): ConversationPromptSlashCommand | undefined {
  if (!invocation.command.enabled) return undefined;
  return { name: invocation.command.name, bodyText: invocation.bodyText };
}

export function resolveSlashCommandAction(
  text: string,
  commands: SlashCommandDescriptor[],
): SlashCommandAction | null {
  const invocation = parseSlashInvocation(text, commands);
  if (!invocation || !invocation.command.enabled) return null;
  const { command, bodyText } = invocation;
  switch (command.name) {
    case "clear":
      return { kind: "clear", command };
    case "task":
      return { kind: "task", command, goal: bodyText };
    case "steer":
      if (!bodyText) {
        return {
          kind: "autocomplete",
          command,
          replacement: replaceLeadingSlashCommand(text, "steer"),
        };
      }
      return { kind: "steer", command, instruction: bodyText };
    case "status":
      return {
        kind: "send",
        command,
        content: bodyText
          ? `Status check: ${bodyText}`
          : "Status check: please summarize current progress, blockers, and next steps.",
      };
    case "pass":
      return {
        kind: "send",
        command,
        content: bodyText || "Quick status check — reply (pass) if nothing needs attention.",
      };
    default:
      return bodyText ? { kind: "send", command, content: bodyText } : null;
  }
}

export interface PendingAttachment {
  localId: string;
  attachmentId: string | null;
  name: string;
  previewUrl: string | null;
  mimeType?: string;
  sizeBytes?: number;
  textContent?: string | null;
}

export interface PickedNativeAsset {
  name: string;
  uri: string;
  mimeType?: string | null;
  size?: number | null;
  base64?: string | null;
  file?: File | null;
}

export interface NativeAssetFileReader {
  readText(uri: string): Promise<string>;
  readBase64(uri: string): Promise<string>;
}

const TEXT_ATTACHMENT_EXT =
  /\.(txt|md|json|ts|tsx|py|js|jsx|mjs|cjs|yaml|yml|toml|csv|log|sh|html|css|xml|sql|rs|go|java|kt|swift|c|cpp|h)$/i;
const MAX_ATTACHMENT_TEXT_CHARS = 16_000;

function normalizeSuppliedMimeType(mimeType: string | null | undefined): string | undefined {
  const trimmed = mimeType?.trim();
  if (!trimmed || trimmed === "application/octet-stream") return undefined;
  return trimmed;
}

function resolvePickedAttachmentKind(
  suppliedMimeType: string | null | undefined,
  fileName: string,
): { mimeType: string | undefined; isImage: boolean; isText: boolean } {
  const rawMime = normalizeSuppliedMimeType(suppliedMimeType);
  const resolvedImageMime =
    resolveRasterImageMimeType({ mimeType: rawMime, path: fileName }) ??
    resolveRasterImageMimeType({ path: fileName });
  const mimeType = resolvedImageMime ?? rawMime;
  const isImage = Boolean(resolvedImageMime || mimeType?.startsWith("image/"));
  const isText =
    !isImage &&
    (Boolean(mimeType?.startsWith("text/")) ||
      mimeType === "application/json" ||
      TEXT_ATTACHMENT_EXT.test(fileName));
  return { mimeType, isImage, isText };
}

function truncateAttachmentText(raw: string): string {
  return raw.length > MAX_ATTACHMENT_TEXT_CHARS
    ? `${raw.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}\n…`
    : raw;
}

async function readNativeImagePreviewUrl(
  asset: PickedNativeAsset,
  imageMime: string,
  reader: NativeAssetFileReader,
): Promise<string | null> {
  if (typeof asset.base64 === "string" && asset.base64.length > 0) {
    return asset.base64.startsWith("data:")
      ? asset.base64
      : `data:${imageMime};base64,${asset.base64}`;
  }
  if (!asset.uri) return null;
  try {
    const b64 = await reader.readBase64(asset.uri);
    return b64 ? `data:${imageMime};base64,${b64}` : asset.uri;
  } catch {
    return asset.uri;
  }
}

async function readNativeTextExcerpt(
  uri: string,
  reader: NativeAssetFileReader,
): Promise<string | null> {
  if (!uri) return null;
  try {
    const raw = await reader.readText(uri);
    return truncateAttachmentText(raw);
  } catch {
    return null;
  }
}

export async function readPickedFile(file: File, index: number): Promise<PendingAttachment> {
  const localId = `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
  const { mimeType, isImage, isText } = resolvePickedAttachmentKind(file.type, file.name);
  let previewUrl: string | null = null;
  let textContent: string | null = null;
  if (isImage && typeof FileReader !== "undefined") {
    previewUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.addEventListener(
        "load",
        () => resolve(typeof reader.result === "string" ? reader.result : null),
        { once: true },
      );
      reader.addEventListener("error", () => resolve(null), { once: true });
      reader.readAsDataURL(file);
    });
  } else if (isText && typeof file.text === "function") {
    try {
      textContent = truncateAttachmentText(await file.text());
    } catch {
      textContent = null;
    }
  }
  return {
    localId,
    attachmentId: localId,
    name: file.name,
    previewUrl,
    mimeType,
    sizeBytes: file.size,
    textContent,
  };
}

export async function readPickedNativeAsset(
  asset: PickedNativeAsset,
  index: number,
  reader: NativeAssetFileReader,
): Promise<PendingAttachment> {
  if (asset.file) {
    return await readPickedFile(asset.file, index);
  }
  const localId = `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
  const name = asset.name?.trim() || asset.uri.split("/").pop()?.split("?")[0] || "attachment";
  const { mimeType, isImage, isText } = resolvePickedAttachmentKind(
    asset.mimeType,
    name || asset.uri,
  );
  const previewUrl = isImage
    ? await readNativeImagePreviewUrl(asset, mimeType ?? "image/png", reader)
    : null;
  const textContent = !isImage && isText ? await readNativeTextExcerpt(asset.uri, reader) : null;
  return {
    localId,
    attachmentId: localId,
    name,
    previewUrl,
    mimeType,
    sizeBytes: typeof asset.size === "number" ? asset.size : undefined,
    textContent,
  };
}

export function formatMessageWithAttachments(
  draftText: string,
  attachments: ReadonlyArray<{
    name: string;
    previewUrl?: string | null;
    textContent?: string | null;
    mimeType?: string;
  }>,
): string {
  const base = draftText.trim();
  if (!attachments.length) return draftText;
  const blocks = attachments.map((item) => {
    if (item.textContent && item.textContent.trim()) {
      return `[Attachment: ${item.name}]\n\`\`\`\n${item.textContent.trim()}\n\`\`\``;
    }
    if (item.previewUrl || item.mimeType?.startsWith("image/")) {
      return `[Attachment: ${item.name} (image)]`;
    }
    return `[Attachment: ${item.name}]`;
  });
  return base ? `${base}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}
