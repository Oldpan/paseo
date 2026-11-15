// Migrated from Bigbang apps/app/src/slashCommands.ts. Keep presentation changes reviewable against that source.
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
