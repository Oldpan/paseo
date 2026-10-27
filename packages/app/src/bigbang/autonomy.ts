// The assistant form's "Allow starting tasks" section. The form model holds strings only, so the
// editor's value travels as JSON in one field and is parsed and validated again on save.
import type { Assistant } from "../../../../extensions/bigbang/shared/contracts";

export type Autonomy = NonNullable<Assistant["autonomy"]>;
export type AutonomyTarget = Autonomy["targets"][number];

export const EMPTY_AUTONOMY: Autonomy = { enabled: false, targets: [] };

export function serializeAutonomy(autonomy: Autonomy | undefined): string {
  return JSON.stringify(autonomy ?? EMPTY_AUTONOMY);
}
export function parseAutonomy(value: string | undefined): Autonomy {
  if (!value) return EMPTY_AUTONOMY;
  try {
    const parsed = JSON.parse(value) as Partial<Autonomy>;
    return {
      enabled: parsed.enabled === true,
      targets: (parsed.targets ?? []).map((target) => ({
        serverId: String(target.serverId ?? ""),
        directory: String(target.directory ?? ""),
        isolation: target.isolation === "directory" ? "directory" : "worktree",
      })),
    };
  } catch {
    return EMPTY_AUTONOMY;
  }
}

/**
 * The first problem that would make the coordinator reject the settings, in words for the form.
 * Rows are checked even while the toggle is off, because they are saved either way.
 */
export function validateAutonomy(
  autonomy: Autonomy,
  hostIds: readonly string[],
  hostLabel: (serverId: string) => string = (serverId) => serverId,
): string | null {
  const known = new Set(hostIds);
  for (const [index, target] of autonomy.targets.entries()) {
    const row = `Task target ${index + 1}`;
    if (!known.has(target.serverId)) return `${row}: choose a machine from your hosts.`;
    if (!target.directory.trim())
      return `${row}: enter the project directory on ${hostLabel(target.serverId)}.`;
  }
  if (autonomy.enabled && autonomy.targets.length === 0)
    return "Add at least one task target, or turn off Allow starting tasks.";
  return null;
}

/** What `chat.assistant.save` receives: trimmed, without repeated targets, absent when unused. */
export function normalizeAutonomy(autonomy: Autonomy): Autonomy | undefined {
  const seen = new Set<string>();
  const targets = autonomy.targets.flatMap((target) => {
    const next = { ...target, directory: target.directory.trim() };
    const key = JSON.stringify([next.serverId, next.directory, next.isolation]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [next];
  });
  if (!autonomy.enabled && targets.length === 0) return undefined;
  return { enabled: autonomy.enabled, targets };
}
