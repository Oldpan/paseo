// Migrated from Bigbang apps/app/src/markdown.ts. Keep presentation changes reviewable against that source.
import MarkdownIt from "markdown-it";

export type MdInline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "emphasis"; children: MdInline[] }
  | { type: "delete"; children: MdInline[] }
  | { type: "link"; url: string; children: MdInline[] }
  | { type: "break" }
  | { type: "image"; alt: string; url: string };

export interface MdListItem {
  checked: boolean | null;
  children: MdBlock[];
}
export interface MdTableRow {
  header: boolean;
  cells: MdInline[][];
}
export type MdBlock =
  | { type: "paragraph"; children: MdInline[] }
  | { type: "heading"; depth: number; children: MdInline[] }
  | { type: "blockquote"; children: MdBlock[] }
  | { type: "list"; ordered: boolean; start: number; children: MdListItem[] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "table"; align: Array<"left" | "center" | "right" | null>; rows: MdTableRow[] }
  | { type: "thematicBreak" };

export interface MdRoot {
  type: "root";
  children: MdBlock[];
}
export type LinkKind = "external" | "local" | "unsafe";

interface Token {
  type: string;
  tag: string;
  content: string;
  info: string;
  children: Token[] | null;
  attrGet: (name: string) => string | null;
}

/** Chat markdown matches old web MessageResponse: GFM, no remark-math / KaTeX. */
const parser = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

export function linkKind(url: string): LinkKind {
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return "unsafe";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? "external" : "unsafe";
    } catch {
      return "unsafe";
    }
  }
  if (!trimmed.includes("://")) return "local";
  return "unsafe";
}

export function parseMarkdown(source: string): MdRoot {
  const tokens = parser.parse(source ?? "", {}) as Token[];
  return { type: "root", children: readBlocks(tokens, 0).nodes };
}

function fenceLanguage(info: string): string | null {
  const lang = info.trim().split(/\s+/)[0] ?? "";
  return lang ? lang.toLowerCase() : null;
}

function readBlocks(
  tokens: Token[],
  start: number,
  stopType?: string,
): { nodes: MdBlock[]; index: number } {
  const nodes: MdBlock[] = [];
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (stopType && token.type === stopType) return { nodes, index };
    if (token.type === "paragraph_open") {
      nodes.push({ type: "paragraph", children: inlineOf(tokens[index + 1]) });
      index += 3;
      continue;
    }
    if (token.type === "heading_open") {
      nodes.push({
        type: "heading",
        depth: Number(token.tag.slice(1)) || 1,
        children: inlineOf(tokens[index + 1]),
      });
      index += 3;
      continue;
    }
    if (token.type === "fence" || token.type === "code_block") {
      nodes.push({
        type: "code",
        lang: fenceLanguage(token.info),
        value: token.content.replace(/\n$/, ""),
      });
      index += 1;
      continue;
    }
    if (token.type === "hr") {
      nodes.push({ type: "thematicBreak" });
      index += 1;
      continue;
    }
    if (token.type === "blockquote_open") {
      const inner = readBlocks(tokens, index + 1, "blockquote_close");
      nodes.push({ type: "blockquote", children: inner.nodes });
      index = inner.index + 1;
      continue;
    }
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      const ordered = token.type === "ordered_list_open";
      const startNumber = Number(token.attrGet("start") || 1) || 1;
      const items: MdListItem[] = [];
      index += 1;
      while (index < tokens.length && tokens[index]!.type === "list_item_open") {
        const inner = readBlocks(tokens, index + 1, "list_item_close");
        items.push(asListItem(inner.nodes));
        index = inner.index + 1;
      }
      if (tokens[index]?.type.endsWith("list_close")) index += 1;
      nodes.push({ type: "list", ordered, start: startNumber, children: items });
      continue;
    }
    if (token.type === "table_open") {
      const table = readTable(tokens, index);
      nodes.push(table.node);
      index = table.index;
      continue;
    }
    index += 1;
  }
  return { nodes, index };
}

function inlineOf(token?: Token): MdInline[] {
  return token?.children ? parseInlines(token.children) : [];
}

function parseInlines(tokens: Token[]): MdInline[] {
  const root: MdInline[] = [];
  const stack: Array<{ node: Extract<MdInline, { children: MdInline[] }> }> = [];
  const current = () => stack.at(-1)?.node.children ?? root;
  for (const token of tokens) {
    if (token.type === "text" || token.type === "html_inline" || token.type === "entity") {
      if (token.content) current().push({ type: "text", value: token.content });
      continue;
    }
    if (token.type === "code_inline") {
      current().push({ type: "code", value: token.content });
      continue;
    }
    if (token.type === "softbreak") {
      current().push({ type: "text", value: " " });
      continue;
    }
    if (token.type === "hardbreak") {
      current().push({ type: "break" });
      continue;
    }
    if (token.type === "image") {
      current().push({ type: "image", alt: token.content, url: token.attrGet("src") || "" });
      continue;
    }
    if (token.type === "strong_open") {
      stack.push({ node: { type: "strong", children: [] } });
      continue;
    }
    if (token.type === "em_open") {
      stack.push({ node: { type: "emphasis", children: [] } });
      continue;
    }
    if (token.type === "s_open") {
      stack.push({ node: { type: "delete", children: [] } });
      continue;
    }
    if (token.type === "link_open") {
      stack.push({ node: { type: "link", url: token.attrGet("href") || "", children: [] } });
      continue;
    }
    if (
      token.type === "strong_close" ||
      token.type === "em_close" ||
      token.type === "s_close" ||
      token.type === "link_close"
    ) {
      const frame = stack.pop();
      if (frame) current().push(frame.node);
    }
  }
  while (stack.length) {
    const frame = stack.pop();
    if (frame) (stack.at(-1)?.node.children ?? root).push(frame.node);
  }
  return root;
}

function asListItem(children: MdBlock[]): MdListItem {
  const first = children[0];
  if (first?.type !== "paragraph" || first.children[0]?.type !== "text")
    return { checked: null, children };
  const match = /^\[( |x|X)\]\s+/.exec(first.children[0].value);
  if (!match) return { checked: null, children };
  const rest = first.children[0].value.slice(match[0].length);
  const nextText = rest
    ? [{ type: "text", value: rest } as const, ...first.children.slice(1)]
    : first.children.slice(1);
  const nextChildren: MdBlock[] =
    nextText.length > 0
      ? [{ type: "paragraph", children: nextText }, ...children.slice(1)]
      : children.slice(1);
  return { checked: match[1] !== " ", children: nextChildren };
}

function readTable(
  tokens: Token[],
  start: number,
): { node: Extract<MdBlock, { type: "table" }>; index: number } {
  const rows: MdTableRow[] = [];
  const align: Array<"left" | "center" | "right" | null> = [];
  let index = start + 1;
  let header = false;
  while (index < tokens.length && tokens[index]!.type !== "table_close") {
    const token = tokens[index]!;
    if (token.type === "thead_open") header = true;
    if (token.type === "thead_close" || token.type === "tbody_open") header = false;
    if (token.type === "tr_open") {
      const cells: MdInline[][] = [];
      index += 1;
      while (index < tokens.length && tokens[index]!.type !== "tr_close") {
        const cell = tokens[index]!;
        if (cell.type === "th_open" || cell.type === "td_open") {
          if (header) align.push(alignFromStyle(cell.attrGet("style")));
          cells.push(inlineOf(tokens[index + 1]));
          index += 3;
          continue;
        }
        index += 1;
      }
      rows.push({ header, cells });
    }
    index += 1;
  }
  return { node: { type: "table", align, rows }, index: index + 1 };
}

function alignFromStyle(style: string | null): "left" | "center" | "right" | null {
  if (style?.includes("center")) return "center";
  if (style?.includes("right")) return "right";
  if (style?.includes("left")) return "left";
  return null;
}
