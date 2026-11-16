import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";
import {
  SANDBOXED_HTML_CSP,
  buildSandboxedHtmlDocument,
  detectHtmlPreviewKind,
  formatSelectedTableRowsMarkdown,
  isInteractiveTableFenceLang,
  isPreviewableHtmlBlock,
  parseInteractiveTable,
  queryInteractiveTable,
} from "./uiHtmlPreview";

describe("isPreviewableHtmlBlock & detectHtmlPreviewKind", () => {
  it("accepts html, htm, svg, and ui-html fenced blocks with non-empty markup", () => {
    expect(isPreviewableHtmlBlock("html", "<div>Hello</div>")).toBe(true);
    expect(isPreviewableHtmlBlock("HTML", "<section><p>Card</p></section>")).toBe(true);
    expect(isPreviewableHtmlBlock("htm", "<h1>Title</h1>")).toBe(true);
    expect(isPreviewableHtmlBlock("svg", '<svg viewBox="0 0 10 10"><circle r="4" /></svg>')).toBe(
      true,
    );
    expect(isPreviewableHtmlBlock("ui-html", "<button>Click me</button>")).toBe(true);
  });

  it("rejects empty markup and non-previewable languages", () => {
    expect(isPreviewableHtmlBlock("html", "")).toBe(false);
    expect(isPreviewableHtmlBlock("html", "   \n  ")).toBe(false);
    expect(isPreviewableHtmlBlock("typescript", "const x = 1;")).toBe(false);
    expect(isPreviewableHtmlBlock("json", '{"a":1}')).toBe(false);
    expect(isPreviewableHtmlBlock(null, "<div>Hi</div>")).toBe(false);
  });

  it("detects svg vs html kind and json:panel fence languages", () => {
    expect(detectHtmlPreviewKind("svg", "<circle />")).toBe("svg");
    expect(detectHtmlPreviewKind("html", '<svg width="100"></svg>')).toBe("svg");
    expect(detectHtmlPreviewKind("html", "<div>Widget</div>")).toBe("html");

    expect(isInteractiveTableFenceLang("json:panel")).toBe(true);
    expect(isInteractiveTableFenceLang("json-table")).toBe(true);
    expect(isInteractiveTableFenceLang("json")).toBe(false);
  });
});

describe("buildSandboxedHtmlDocument", () => {
  it("wraps HTML snippets with strict CSP, viewport meta, and theme styling", () => {
    const lightDoc = buildSandboxedHtmlDocument("<div class='card'>Widget</div>", {
      dark: false,
      kind: "html",
    });

    expect(lightDoc).toContain("<!DOCTYPE html>");
    expect(lightDoc).toContain(`content="${SANDBOXED_HTML_CSP}"`);
    expect(lightDoc).toContain(
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'",
    );
    expect(lightDoc).toContain('name="viewport"');
    expect(lightDoc).toContain('data-theme="light"');
    expect(lightDoc).toContain("<div class='card'>Widget</div>");

    const darkSvgDoc = buildSandboxedHtmlDocument(
      '<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>',
      {
        dark: true,
        kind: "svg",
      },
    );

    expect(darkSvgDoc).toContain('data-theme="dark"');
    expect(darkSvgDoc).toContain("pavra-svg-stage");
    expect(darkSvgDoc).toContain('<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>');
  });
});

describe("parseInteractiveTable", () => {
  it("parses a simplified Markdown table object (headers + rows)", () => {
    const parsed = parseInteractiveTable({
      title: "Agent Nodes",
      headers: ["Host", "Latency", "Status"],
      rows: [
        ["spark", "12", "online"],
        ["macbook", "4", "online"],
      ],
    });

    expect(parsed).toEqual({
      title: "Agent Nodes",
      columns: ["Host", "Latency", "Status"],
      rows: [
        { id: "row-0", cells: ["spark", "12", "online"] },
        { id: "row-1", cells: ["macbook", "4", "online"] },
      ],
    });
  });

  it("parses a Markdown-it table AST node from parseMarkdown", () => {
    const tree = parseMarkdown(
      [
        "| Model | Score | Cost |",
        "| :--- | ---: | :---: |",
        "| `claude-4` | 94.5 | $1.20 |",
        "| **gpt-5** | 91.0 | $0.80 |",
      ].join("\n"),
    );
    const tableBlock = tree.children.find((node) => node.type === "table");
    expect(tableBlock).toBeDefined();

    const parsed = parseInteractiveTable(tableBlock);
    expect(parsed).toEqual({
      columns: ["Model", "Score", "Cost"],
      rows: [
        { id: "row-0", cells: ["claude-4", "94.5", "$1.20"] },
        { id: "row-1", cells: ["gpt-5", "91.0", "$0.80"] },
      ],
    });
  });

  it("parses json:panel and json-table fenced blocks", () => {
    const jsonPanelCode = JSON.stringify({
      title: "Benchmark Results",
      columns: [
        { field: "suite", label: "Suite" },
        { field: "passRate", label: "Pass Rate" },
      ],
      rows: [
        { id: "r1", suite: "unit", passRate: "100%" },
        { id: "r2", suite: "e2e", passRate: "92%" },
      ],
    });

    const parsed = parseInteractiveTable({
      lang: "json:panel",
      code: jsonPanelCode,
    });

    expect(parsed).toEqual({
      title: "Benchmark Results",
      columns: ["Suite", "Pass Rate"],
      rows: [
        { id: "r1", cells: ["unit", "100%"] },
        { id: "r2", cells: ["e2e", "92%"] },
      ],
    });
  });
});

describe("queryInteractiveTable", () => {
  const table = parseInteractiveTable({
    headers: ["Service", "Port", "Memory"],
    rows: [
      ["paseo-daemon", "6767", "120"],
      ["pavra-web", "6778", "45"],
      ["paseo-relay", "8080", "310"],
    ],
  });

  it("filters rows by space-separated AND search terms (case-insensitive)", () => {
    const matched = queryInteractiveTable(table, { query: "paseo 8080" });
    expect(matched.map((r) => r.cells[0])).toEqual(["paseo-relay"]);

    const allPaseo = queryInteractiveTable(table, { query: "PASEO" });
    expect(allPaseo.map((r) => r.cells[0])).toEqual(["paseo-daemon", "paseo-relay"]);
  });

  it("sorts rows numerically and falls back to string comparison without mutating input", () => {
    const originalOrder = table.rows.map((r) => r.id);

    const byMemoryAsc = queryInteractiveTable(table, {
      sortColIndex: 2,
      sortDir: "asc",
    });
    expect(byMemoryAsc.map((r) => r.cells[2])).toEqual(["45", "120", "310"]);

    const byMemoryDesc = queryInteractiveTable(table, {
      sortColIndex: 2,
      sortDir: "desc",
    });
    expect(byMemoryDesc.map((r) => r.cells[2])).toEqual(["310", "120", "45"]);

    const byServiceDesc = queryInteractiveTable(table, {
      sortColIndex: 0,
      sortDir: "desc",
    });
    expect(byServiceDesc.map((r) => r.cells[0])).toEqual([
      "pavra-web",
      "paseo-relay",
      "paseo-daemon",
    ]);

    expect(table.rows.map((r) => r.id)).toEqual(originalOrder);
  });
});

describe("formatSelectedTableRowsMarkdown", () => {
  it("formats selected rows as a GFM Markdown table and escapes pipe characters", () => {
    const markdown = formatSelectedTableRowsMarkdown(
      ["Name", "Command"],
      [{ cells: ["build", "npm run build | tee log"] }, { cells: ["test", "npx vitest run"] }],
    );

    expect(markdown).toBe(
      [
        "| Name | Command |",
        "| --- | --- |",
        "| build | npm run build \\| tee log |",
        "| test | npx vitest run |",
      ].join("\n"),
    );
  });

  it("returns empty string when no rows are selected", () => {
    expect(formatSelectedTableRowsMarkdown(["A", "B"], [])).toBe("");
  });
});
