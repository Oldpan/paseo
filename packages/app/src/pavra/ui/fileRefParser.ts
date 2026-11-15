import { ASSISTANT_FILE_EXTENSIONS } from "../../assistant-file-links/extensions";

export interface ParsedFileRef {
  rawToken: string;
  filePath: string;
  displayPath: string;
  line?: number;
  column?: number;
}

const KNOWN_FILENAMES: ReadonlySet<string> = new Set([
  "AUTHORS",
  "Brewfile",
  "CHANGELOG",
  "CMakeLists.txt",
  "CODEOWNERS",
  "CONTRIBUTING",
  "Cargo.lock",
  "Containerfile",
  "Dockerfile",
  "Gemfile",
  "Justfile",
  "LICENSE",
  "Makefile",
  "NOTICE",
  "Procfile",
  "README",
  "Rakefile",
  "SECURITY",
  "Vagrantfile",
]);

const EXTRA_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "astro",
  "bat",
  "cfg",
  "cjs",
  "cmake",
  "conf",
  "csv",
  "cts",
  "diff",
  "env",
  "fish",
  "gif",
  "gql",
  "gradle",
  "graphql",
  "ico",
  "ini",
  "jpeg",
  "jpg",
  "lock",
  "log",
  "markdown",
  "mdx",
  "mjs",
  "mts",
  "patch",
  "pdf",
  "plist",
  "png",
  "prisma",
  "properties",
  "proto",
  "ps1",
  "svg",
  "tsv",
  "txt",
  "wasm",
  "webp",
  "zig",
]);

const SAFE_DOTFILES: ReadonlySet<string> = new Set([
  ".babelrc",
  ".clang-format",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".env.development",
  ".env.example",
  ".env.local",
  ".env.production",
  ".env.test",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".gitmodules",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  ".stylelintrc",
  ".tool-versions",
  ".yarnrc",
]);

const DOMAIN_LIKE_TLDS: ReadonlySet<string> = new Set([
  "ai",
  "app",
  "cloud",
  "co",
  "com",
  "dev",
  "edu",
  "gg",
  "gov",
  "io",
  "me",
  "net",
  "org",
  "uk",
  "us",
]);

const AMBIGUOUS_BARE_PREFIXES: ReadonlySet<string> = new Set([
  "console",
  "document",
  "global",
  "json",
  "math",
  "navigator",
  "Number",
  "number",
  "object",
  "Object",
  "process",
  "promise",
  "reflect",
  "string",
  "symbol",
  "window",
]);

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) <= 31) {
      return true;
    }
  }
  return false;
}

function isRecognizedExtension(ext: string): boolean {
  const lower = ext.toLowerCase();
  return ASSISTANT_FILE_EXTENSIONS.has(lower) || EXTRA_FILE_EXTENSIONS.has(lower);
}

function normalizeWorkspaceCwd(workspaceCwd?: string): string | undefined {
  if (!workspaceCwd) {
    return undefined;
  }
  const normalized = workspaceCwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : undefined;
}

function stripLineColumnSuffix(input: string): {
  pathPart: string;
  line?: number;
  column?: number;
} {
  const hashMatch = input.match(/^(.*)#L([1-9]\d*)(?:C([1-9]\d*)|-L\d+)?$/i);
  if (hashMatch?.[1]) {
    return {
      pathPart: hashMatch[1],
      line: Number.parseInt(hashMatch[2], 10),
      column: hashMatch[3] ? Number.parseInt(hashMatch[3], 10) : undefined,
    };
  }

  const colonMatch = input.match(/^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/);
  if (colonMatch?.[1]) {
    return {
      pathPart: colonMatch[1],
      line: Number.parseInt(colonMatch[2], 10),
      column: colonMatch[3] ? Number.parseInt(colonMatch[3], 10) : undefined,
    };
  }

  return { pathPart: input };
}

function hasValidFileBasename(basename: string, hasDirectorySeparator: boolean): boolean {
  if (!basename || basename === "." || basename === "..") {
    return false;
  }
  if (SAFE_DOTFILES.has(basename.toLowerCase())) {
    return true;
  }
  if (hasDirectorySeparator && KNOWN_FILENAMES.has(basename)) {
    return true;
  }

  const lastDot = basename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return false;
  }

  const stem = basename.slice(0, lastDot);
  const ext = basename.slice(lastDot + 1);
  if (!hasDirectorySeparator && AMBIGUOUS_BARE_PREFIXES.has(stem)) {
    return false;
  }
  if (
    !hasDirectorySeparator &&
    DOMAIN_LIKE_TLDS.has(ext.toLowerCase()) &&
    ext.toLowerCase() !== "sh"
  ) {
    return false;
  }
  return isRecognizedExtension(ext);
}

function extractCandidatePath(rawToken: string): string | null {
  if (
    !rawToken ||
    rawToken.length > 512 ||
    rawToken.startsWith("-") ||
    hasControlChar(rawToken) ||
    /[\s<>"'|?*=`]/.test(rawToken) ||
    /%2e%2e/i.test(rawToken)
  ) {
    return null;
  }

  if (/^file:\/\/\//i.test(rawToken)) {
    return rawToken.slice("file://".length);
  }

  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawToken) ||
    /^(?:mailto|javascript|data|tel|about|blob|chrome|vscode|ws|wss|ftp|ssh|git):/i.test(rawToken)
  ) {
    return null;
  }

  return rawToken;
}

function isDomainPrefixedPath(
  rawSegments: string[],
  isAbsolute: boolean,
  hasExplicitRelativePrefix: boolean,
): boolean {
  if (isAbsolute || hasExplicitRelativePrefix || rawSegments.length <= 1) {
    return false;
  }
  const firstSegment = rawSegments[0];
  const dotIdx = firstSegment.lastIndexOf(".");
  if (dotIdx <= 0) {
    return false;
  }
  const tld = firstSegment.slice(dotIdx + 1).toLowerCase();
  return DOMAIN_LIKE_TLDS.has(tld);
}

function areValidPathSegments(rawSegments: string[]): boolean {
  if (rawSegments.length === 0) {
    return false;
  }
  for (const seg of rawSegments) {
    if (!seg || seg === "." || seg === ".." || !/^[a-zA-Z0-9._@+~[\]()-]+$/.test(seg)) {
      return false;
    }
  }
  return true;
}

function normalizeAndSplitPath(pathPart: string): {
  rawSegments: string[];
  isAbsolute: boolean;
  hasDirectorySeparator: boolean;
} | null {
  const normalized = pathPart.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized === "/" ||
    normalized.includes(":") ||
    normalized.includes("#") ||
    normalized.endsWith("/") ||
    normalized.includes("//") ||
    /^\d+$/.test(normalized) ||
    /^v?\d+(?:\.\d+)+$/i.test(normalized)
  ) {
    return null;
  }

  const hasExplicitRelativePrefix = normalized.startsWith("./");
  const isAbsolute = normalized.startsWith("/");
  const stripped = isAbsolute
    ? normalized.slice(1)
    : hasExplicitRelativePrefix
      ? normalized.slice(2)
      : normalized;

  if (!stripped) {
    return null;
  }

  const rawSegments = stripped.split("/");
  if (
    !areValidPathSegments(rawSegments) ||
    isDomainPrefixedPath(rawSegments, isAbsolute, hasExplicitRelativePrefix)
  ) {
    return null;
  }

  const hasDirectorySeparator = isAbsolute || hasExplicitRelativePrefix || rawSegments.length > 1;
  return { rawSegments, isAbsolute, hasDirectorySeparator };
}

function formatResolvedPaths(
  rawSegments: string[],
  isAbsolute: boolean,
  workspaceCwd?: string,
): { filePath: string; displayPath: string } {
  const cwd = normalizeWorkspaceCwd(workspaceCwd);
  if (isAbsolute) {
    const filePath = `/${rawSegments.join("/")}`;
    const displayPath =
      cwd && filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1) : filePath;
    return { filePath, displayPath };
  }
  const displayPath = rawSegments.join("/");
  const filePath = cwd ? `${cwd}/${displayPath}` : displayPath;
  return { filePath, displayPath };
}

/**
 * Checks whether a candidate path contains any `..` traversal segment or unsafe characters.
 */
export function isSafeFileRefPath(filePath: string, workspaceCwd?: string): boolean {
  if (!filePath || typeof filePath !== "string") {
    return false;
  }
  if (hasControlChar(filePath) || /%2e%2e/i.test(filePath)) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (!normalized) {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.includes("..")) {
    return false;
  }
  const cwd = normalizeWorkspaceCwd(workspaceCwd);
  if (cwd && normalized.startsWith("/")) {
    return normalized === cwd || normalized.startsWith(`${cwd}/`);
  }
  return true;
}

/**
 * Resolves a filePath into a workspace-relative path suitable for `studio.file.read` / `client.readFile`,
 * or returns null if the path escapes the workspace or contains traversal segments.
 */
export function resolveWorkspaceRelativePath(
  filePath: string,
  workspaceCwd?: string,
): string | null {
  if (!isSafeFileRefPath(filePath)) {
    return null;
  }
  const normalized = filePath.replace(/\\/g, "/").trim();
  const cwd = normalizeWorkspaceCwd(workspaceCwd);
  if (cwd) {
    if (normalized === cwd) {
      return null;
    }
    if (normalized.startsWith(`${cwd}/`)) {
      const rel = normalized.slice(cwd.length + 1).replace(/^\/+/, "");
      return rel.length > 0 ? rel : null;
    }
  }
  const stripped = normalized.replace(/^(?:\.\/)+/, "");
  return stripped.length > 0 ? stripped : null;
}

/**
 * Parses a single inline token (e.g. from an inline code span) into a `ParsedFileRef`
 * if and only if it represents a safe workspace/local file reference.
 */
export function parseFileRef(rawInput: string, workspaceCwd?: string): ParsedFileRef | null {
  if (typeof rawInput !== "string") {
    return null;
  }

  const rawToken = rawInput.trim();
  const candidate = extractCandidatePath(rawToken);
  if (!candidate) {
    return null;
  }

  const { pathPart, line, column } = stripLineColumnSuffix(candidate);
  const split = normalizeAndSplitPath(pathPart);
  if (!split) {
    return null;
  }

  const basename = split.rawSegments[split.rawSegments.length - 1];
  if (!hasValidFileBasename(basename, split.hasDirectorySeparator)) {
    return null;
  }

  const { filePath, displayPath } = formatResolvedPaths(
    split.rawSegments,
    split.isAbsolute,
    workspaceCwd,
  );

  const result: ParsedFileRef = { rawToken, filePath, displayPath };
  if (line !== undefined) {
    result.line = line;
  }
  if (column !== undefined) {
    result.column = column;
  }
  return result;
}

const INLINE_CODE_SPAN_REGEX = /`([^`\n]+)`/g;
const WHITESPACE_TOKEN_SPLIT_REGEX = /[\s,()[\]{}<>"']+/;

/**
 * Extracts all unique safe file references from markdown or plain message text.
 */
export function extractFileRefsFromText(text: string, workspaceCwd?: string): ParsedFileRef[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const seen = new Set<string>();
  const results: ParsedFileRef[] = [];

  const pushIfValid = (token: string) => {
    const cleaned = token.replace(/[.,;!?]+$/, "");
    const parsed = parseFileRef(cleaned, workspaceCwd);
    if (!parsed) {
      return;
    }
    const key = `${parsed.filePath}:${parsed.line ?? ""}:${parsed.column ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    results.push(parsed);
  };

  for (const match of text.matchAll(INLINE_CODE_SPAN_REGEX)) {
    if (match[1]) {
      pushIfValid(match[1]);
    }
  }

  const withoutFencedBlocks = text.replace(/```[\s\S]*?```/g, " ");
  for (const rawWord of withoutFencedBlocks.split(WHITESPACE_TOKEN_SPLIT_REGEX)) {
    if (rawWord && !rawWord.startsWith("`")) {
      pushIfValid(rawWord);
    }
  }

  return results;
}
