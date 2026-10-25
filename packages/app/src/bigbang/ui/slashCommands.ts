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

// Old Core-only commands are supplied by the host when their capabilities are available.
const COMMANDS: Array<
  Omit<SlashCommandDescriptor, "enabled" | "disabledReason"> & { kind: string }
> = [];

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
