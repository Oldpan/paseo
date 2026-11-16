import type { MdBlock, MdInline, MdTableRow } from "./markdown";

export const SANDBOXED_HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'";

const PREVIEWABLE_HTML_LANGS = new Set(["html", "htm", "svg", "ui-html"]);
const INTERACTIVE_TABLE_FENCE_LANGS = new Set(["json:panel", "json-table"]);

export interface SandboxedHtmlOptions {
  dark?: boolean;
  kind?: "html" | "svg";
}

export interface InteractiveTableRow {
  id: string;
  cells: string[];
}

export interface InteractiveTableData {
  title?: string;
  columns: string[];
  rows: InteractiveTableRow[];
}

export interface InteractiveTableQueryOptions {
  query?: string;
  sortColIndex?: number | null;
  sortDir?: "asc" | "desc";
}

export type InteractiveTableInput =
  | {
      title?: string;
      headers?: string[];
      columns?: Array<
        | string
        | {
            key?: string;
            field?: string;
            name?: string;
            label?: string;
            title?: string;
            header?: string;
          }
      >;
      rows?: unknown[];
      data?: unknown[];
    }
  | Extract<MdBlock, { type: "table" }>
  | {
      type?: "code" | "fence";
      lang?: string | null;
      code?: string;
      value?: string;
    }
  | string
  | null
  | undefined;

function normalizeFenceLang(lang: string | null | undefined): string {
  return (lang ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
}

/**
 * Returns true for `html`, `htm`, `svg`, or `ui-html` fenced code blocks with non-empty markup.
 */
export function isPreviewableHtmlBlock(
  lang: string | null | undefined,
  code: string | null | undefined,
): boolean {
  const normalizedLang = normalizeFenceLang(lang);
  if (!PREVIEWABLE_HTML_LANGS.has(normalizedLang)) {
    return false;
  }
  return typeof code === "string" && code.trim().length > 0;
}

/**
 * Returns true when a fenced code block language is a `json:panel` or `json-table` table block.
 */
export function isInteractiveTableFenceLang(lang: string | null | undefined): boolean {
  return INTERACTIVE_TABLE_FENCE_LANGS.has(normalizeFenceLang(lang));
}

/**
 * Detects whether a previewable block should be treated as SVG or general HTML.
 */
export function detectHtmlPreviewKind(
  lang: string | null | undefined,
  code: string,
): "html" | "svg" {
  const normalizedLang = normalizeFenceLang(lang);
  if (normalizedLang === "svg") {
    return "svg";
  }
  const trimmed = code.trim();
  if (/^<svg[\s>]/i.test(trimmed)) {
    return "svg";
  }
  return "html";
}

/**
 * Wraps raw HTML snippet or `<svg>` into a self-contained HTML5 document with a strict CSP,
 * responsive viewport, and clean default typography and colors.
 */
export function buildSandboxedHtmlDocument(code: string, options?: SandboxedHtmlOptions): string {
  const raw = (code ?? "").replace(/^\uFEFF/, "").trim();
  const dark = Boolean(options?.dark);
  const kind = options?.kind ?? (detectHtmlPreviewKind(null, raw) === "svg" ? "svg" : "html");

  const bg = dark ? "#141210" : "#fffef9";
  const fg = dark ? "#f2ecdb" : "#09090b";
  const muted = dark ? "#8f8778" : "#71717a";
  const border = dark ? "#3a352d" : "#d4d4d8";
  const surface = dark ? "#1a1713" : "#f7efd8";
  const colorScheme = dark ? "dark" : "light";

  const bodyContent = kind === "svg" ? `<div class="pavra-svg-stage">${raw}</div>` : raw;

  return [
    "<!DOCTYPE html>",
    `<html lang="en" data-theme="${colorScheme}" style="color-scheme: ${colorScheme};">`,
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOXED_HTML_CSP}" />`,
    "<style>",
    "*, *::before, *::after { box-sizing: border-box; }",
    `html, body { margin: 0; padding: 0; background-color: ${bg}; color: ${fg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }`,
    "body { padding: 12px; min-height: 100vh; overflow-x: auto; }",
    "img, svg, canvas, video { max-width: 100%; height: auto; }",
    ".pavra-svg-stage { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 24px); width: 100%; }",
    `table { border-collapse: collapse; width: 100%; border: 1px solid ${border}; }`,
    `th, td { border: 1px solid ${border}; padding: 6px 10px; text-align: left; }`,
    `th { background-color: ${surface}; font-weight: 600; }`,
    `pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background-color: ${surface}; border-radius: 4px; }`,
    "pre { padding: 8px 10px; overflow-x: auto; }",
    "code { padding: 1px 4px; }",
    `caption, small, .muted { color: ${muted}; }`,
    "</style>",
    "</head>",
    `<body>${bodyContent}</body>`,
    "</html>",
  ].join("\n");
}

function flattenMdInlineList(inlines: MdInline[]): string {
  const parts: string[] = [];
  for (const item of inlines) {
    if (!item || typeof item !== "object") continue;
    switch (item.type) {
      case "text":
      case "code":
        parts.push(item.value);
        break;
      case "break":
        parts.push(" ");
        break;
      case "image":
        parts.push(item.alt || item.url);
        break;
      case "strong":
      case "emphasis":
      case "delete":
      case "link":
        parts.push(flattenMdInlineList(item.children));
        break;
    }
  }
  return parts.join("");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMdInlineEntry(entry: unknown): entry is MdInline {
  return isPlainRecord(entry) && typeof entry.type === "string";
}

function cellValueToString(cell: unknown): string {
  if (cell === null || cell === undefined) {
    return "";
  }
  if (typeof cell === "string") {
    return cell.trim();
  }
  if (typeof cell === "number" || typeof cell === "boolean" || typeof cell === "bigint") {
    return String(cell);
  }
  if (Array.isArray(cell)) {
    if (cell.every(isMdInlineEntry)) {
      return flattenMdInlineList(cell).trim();
    }
    return cell.map((item) => cellValueToString(item)).join(", ");
  }
  if (isPlainRecord(cell)) {
    if (typeof cell.text === "string") return cell.text.trim();
    if (typeof cell.label === "string") return cell.label.trim();
    if ("value" in cell && cell.value !== undefined) return cellValueToString(cell.value);
    try {
      return JSON.stringify(cell);
    } catch {
      return String(cell);
    }
  }
  return String(cell);
}

function firstNonEmptyString(
  record: Record<string, unknown>,
  fieldNames: readonly string[],
): string | null {
  for (const field of fieldNames) {
    const val = record[field];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

const COLUMN_KEY_FIELDS = ["field", "key", "name", "id", "header", "label", "title"] as const;
const COLUMN_LABEL_FIELDS = ["label", "title", "header", "name"] as const;

function normalizeSingleColumnDescriptor(
  col: unknown,
  index: number,
): { label: string; key: string } {
  if (typeof col === "string") {
    const trimmed = col.trim();
    return {
      label: trimmed || `Column ${index + 1}`,
      key: trimmed || String(index),
    };
  }
  if (isPlainRecord(col)) {
    const key = firstNonEmptyString(col, COLUMN_KEY_FIELDS) ?? String(index);
    const label = firstNonEmptyString(col, COLUMN_LABEL_FIELDS) ?? key;
    return { label, key };
  }
  const fallback = cellValueToString(col) || `Column ${index + 1}`;
  return { label: fallback, key: fallback };
}

function normalizeColumnDescriptors(rawColumns: unknown[]): { labels: string[]; keys: string[] } {
  const labels: string[] = [];
  const keys: string[] = [];
  for (let i = 0; i < rawColumns.length; i += 1) {
    const { label, key } = normalizeSingleColumnDescriptor(rawColumns[i], i);
    labels.push(label);
    keys.push(key);
  }
  return { labels, keys };
}

function extractRowId(rec: Record<string, unknown>, fallbackId: string): string {
  if (typeof rec.id === "string" && rec.id.trim().length > 0) {
    return rec.id.trim();
  }
  if (typeof rec.id === "number") {
    return String(rec.id);
  }
  return fallbackId;
}

function normalizeArrayCells(items: unknown[], minWidth: number): string[] {
  const width = Math.max(minWidth, items.length);
  const cells: string[] = [];
  for (let c = 0; c < width; c += 1) {
    cells.push(cellValueToString(items[c]));
  }
  return cells;
}

function normalizeDataRows(
  rawRows: unknown[],
  columnKeys: string[],
  columnCount: number,
): InteractiveTableRow[] {
  const rows: InteractiveTableRow[] = [];

  for (let idx = 0; idx < rawRows.length; idx += 1) {
    const rawRow = rawRows[idx];
    const defaultId = `row-${idx}`;

    if (Array.isArray(rawRow)) {
      rows.push({ id: defaultId, cells: normalizeArrayCells(rawRow, columnCount) });
      continue;
    }

    if (isPlainRecord(rawRow)) {
      const rowId = extractRowId(rawRow, defaultId);
      if (Array.isArray(rawRow.cells)) {
        rows.push({ id: rowId, cells: normalizeArrayCells(rawRow.cells, columnCount) });
        continue;
      }
      const sourceRecord = isPlainRecord(rawRow.fields) ? rawRow.fields : rawRow;
      const cells = columnKeys.map((key) => cellValueToString(sourceRecord[key]));
      rows.push({ id: rowId, cells });
      continue;
    }

    rows.push({ id: defaultId, cells: [cellValueToString(rawRow)] });
  }

  return rows;
}

function parseMdTableAstRows(mdRows: MdTableRow[], title?: string): InteractiveTableData {
  if (mdRows.length === 0) {
    return { ...(title ? { title } : {}), columns: [], rows: [] };
  }

  const headerIndex = mdRows.findIndex((r) => r.header);
  const effectiveHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
  const headerRow = mdRows[effectiveHeaderIndex];
  const columns = (headerRow?.cells ?? []).map((cell, idx) => {
    const text = cellValueToString(cell);
    return text || `Column ${idx + 1}`;
  });

  const dataMdRows = mdRows.filter(
    (_, idx) => idx !== effectiveHeaderIndex && !mdRows[idx]?.header,
  );
  const rows: InteractiveTableRow[] = dataMdRows.map((row, rowIdx) => ({
    id: `row-${rowIdx}`,
    cells: normalizeArrayCells(row.cells, columns.length),
  }));

  return {
    ...(title ? { title } : {}),
    columns,
    rows,
  };
}

function unwrapJsonFenceString(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json:panel|json-table|json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(
    trimmed,
  );
  if (fenceMatch && fenceMatch[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function collectRecordKeys(items: unknown[], excludeId: boolean): string[] {
  const keySet = new Set<string>();
  for (const item of items) {
    if (!isPlainRecord(item)) continue;
    const source = isPlainRecord(item.fields) ? item.fields : item;
    for (const key of Object.keys(source)) {
      if (!excludeId || key !== "id") {
        keySet.add(key);
      }
    }
  }
  return Array.from(keySet);
}

function resolveTableTitle(record: Record<string, unknown>): string | undefined {
  if (typeof record.title === "string" && record.title.trim()) {
    return record.title.trim();
  }
  if (isPlainRecord(record.props) && typeof record.props.title === "string") {
    return record.props.title.trim() || undefined;
  }
  return undefined;
}

function resolveRawHeaders(record: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(record.headers)) return record.headers;
  if (Array.isArray(record.columns)) return record.columns;
  if (isPlainRecord(record.table)) {
    if (Array.isArray(record.table.headers)) return record.table.headers;
    if (Array.isArray(record.table.columns)) return record.table.columns;
  }
  return null;
}

function resolveRawRows(record: Record<string, unknown>): unknown[] {
  if (Array.isArray(record.rows)) return record.rows;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.items)) return record.items;
  if (isPlainRecord(record.table) && Array.isArray(record.table.rows)) {
    return record.table.rows;
  }
  return [];
}

function parseJsonTablePayload(parsed: unknown): InteractiveTableData {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || !isPlainRecord(parsed[0])) {
      return { columns: [], rows: [] };
    }
    const columns = collectRecordKeys(parsed, false);
    const rows = normalizeDataRows(parsed, columns, columns.length);
    return { columns, rows };
  }

  if (!isPlainRecord(parsed)) {
    return { columns: [], rows: [] };
  }

  const title = resolveTableTitle(parsed);
  const rawHeaders = resolveRawHeaders(parsed);
  const rawRows = resolveRawRows(parsed);

  if (rawHeaders && rawHeaders.length > 0) {
    const { labels, keys } = normalizeColumnDescriptors(rawHeaders);
    const rows = normalizeDataRows(rawRows, keys, labels.length);
    return { ...(title ? { title } : {}), columns: labels, rows };
  }

  const firstRow = rawRows[0];
  if (isPlainRecord(firstRow) && !Array.isArray(firstRow.cells) && !("header" in firstRow)) {
    const columns = collectRecordKeys(rawRows, true);
    const rows = normalizeDataRows(rawRows, columns, columns.length);
    return { ...(title ? { title } : {}), columns, rows };
  }

  return { ...(title ? { title } : {}), columns: [], rows: [] };
}

function isMdTableAstRecord(record: Record<string, unknown>): boolean {
  if (!Array.isArray(record.rows) || record.rows.length === 0) return false;
  if (Array.isArray(record.headers) || Array.isArray(record.columns)) return false;
  const first = record.rows[0];
  return isPlainRecord(first) && "header" in first && "cells" in first;
}

function extractFenceCodeFromRecord(record: Record<string, unknown>): string | null {
  if (
    Array.isArray(record.rows) ||
    Array.isArray(record.headers) ||
    Array.isArray(record.columns)
  ) {
    return null;
  }
  if (typeof record.code === "string") return record.code;
  if (typeof record.value === "string") return record.value;
  return null;
}

/**
 * Parses either a Markdown `table` AST node (`headers: string[]`, `rows: string[][]` or `MdBlock` table)
 * or a `json:panel` / `json-table` fenced block into `{ title?: string; columns: string[]; rows: Array<{ id: string; cells: string[] }> }`.
 */
export function parseInteractiveTable(input: InteractiveTableInput): InteractiveTableData {
  if (!input) {
    return { columns: [], rows: [] };
  }

  if (typeof input === "string") {
    const unwrapped = unwrapJsonFenceString(input);
    if (!unwrapped) {
      return { columns: [], rows: [] };
    }
    try {
      const parsed: unknown = JSON.parse(unwrapped);
      return parseJsonTablePayload(parsed);
    } catch {
      return { columns: [], rows: [] };
    }
  }

  if (isPlainRecord(input)) {
    const record = input as Record<string, unknown>;
    const fenceCode = extractFenceCodeFromRecord(record);
    if (fenceCode !== null) {
      return parseInteractiveTable(fenceCode);
    }
    if (isMdTableAstRecord(record)) {
      const title = typeof record.title === "string" ? record.title.trim() || undefined : undefined;
      return parseMdTableAstRows(record.rows as MdTableRow[], title);
    }
    return parseJsonTablePayload(record);
  }

  return { columns: [], rows: [] };
}

function parseSortableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed
    .replace(/^[$€£¥]/, "")
    .replace(/%$/, "")
    .replace(/,/g, "")
    .trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Filters rows by space-separated `AND` terms and sorts by the chosen column
 * (numeric-aware + string fallback, Hermes-safe `[...rows].sort(...)`).
 */
export function queryInteractiveTable(
  table: InteractiveTableData | { rows: InteractiveTableRow[]; columns?: string[] },
  options?: InteractiveTableQueryOptions,
): InteractiveTableRow[] {
  const sourceRows = Array.isArray(table?.rows) ? table.rows : [];
  const terms = (options?.query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  const filtered =
    terms.length === 0
      ? [...sourceRows]
      : sourceRows.filter((row) => {
          const haystack = row.cells.map((cell) => cell.toLowerCase()).join(" ");
          return terms.every((term) => haystack.includes(term));
        });

  const sortColIndex = options?.sortColIndex;
  if (sortColIndex === undefined || sortColIndex === null || sortColIndex < 0) {
    return filtered;
  }

  const direction = options?.sortDir === "desc" ? -1 : 1;

  return [...filtered].sort((rowA, rowB) => {
    const cellA = (rowA.cells[sortColIndex] ?? "").trim();
    const cellB = (rowB.cells[sortColIndex] ?? "").trim();

    const numA = parseSortableNumber(cellA);
    const numB = parseSortableNumber(cellB);

    if (numA !== null && numB !== null) {
      if (numA !== numB) {
        return (numA - numB) * direction;
      }
      return 0;
    }

    const cmp = cellA.localeCompare(cellB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return cmp * direction;
  });
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/**
 * Formats selected rows as a clean Markdown table snippet for quoting/inserting into
 * the Chat composer or copying to clipboard.
 */
export function formatSelectedTableRowsMarkdown(
  columns: string[],
  selectedRows: Array<{ cells: string[] }>,
): string {
  if (!Array.isArray(selectedRows) || selectedRows.length === 0) {
    return "";
  }

  const effectiveColumns =
    columns.length > 0
      ? columns
      : (selectedRows[0]?.cells ?? []).map((_, index) => `Column ${index + 1}`);

  if (effectiveColumns.length === 0) {
    return "";
  }

  const headerLine = `| ${effectiveColumns.map(escapeMarkdownTableCell).join(" | ")} |`;
  const dividerLine = `| ${effectiveColumns.map(() => "---").join(" | ")} |`;
  const rowLines = selectedRows.map((row) => {
    const cells = effectiveColumns.map((_, colIdx) =>
      escapeMarkdownTableCell(String(row.cells[colIdx] ?? "")),
    );
    return `| ${cells.join(" | ")} |`;
  });

  return [headerLine, dividerLine, ...rowLines].join("\n");
}
