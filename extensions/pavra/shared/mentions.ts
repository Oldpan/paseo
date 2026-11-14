// Migrated from Bigbang protocol mention parsing.
export function stripIgnoredMentionContexts(content: string): string {
  let sanitized = content;

  sanitized = sanitized.replace(/```[\s\S]*?```/g, " ");
  sanitized = sanitized.replace(/~~~[\s\S]*?~~~/g, " ");
  sanitized = sanitized.replace(/`[^`\n]*`/g, " ");
  sanitized = sanitized.replace(/^\s*>.*$/gm, " ");

  const quotedSpanPatterns = [
    /"[^"\n]*"/g,
    /“[^”\n]*”/g,
    /‘[^’\n]*’/g,
    /「[^」\n]*」/g,
    /『[^』\n]*』/g,
  ];
  for (const pattern of quotedSpanPatterns) {
    sanitized = sanitized.replace(pattern, " ");
  }

  return sanitized;
}

export function extractMentionedNames(content: string): string[] {
  const sanitizedContent = stripIgnoredMentionContexts(content);
  const mentionRegex = /(?<![a-zA-Z0-9_.@-])@([a-zA-Z0-9_-]+)/g;
  const mentioned = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(sanitizedContent)) !== null) {
    mentioned.add(match[1].toLowerCase());
  }

  return [...mentioned];
}

export const CHANNEL_ALL_MENTION_NAME = "all";
