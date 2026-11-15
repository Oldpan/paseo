import { describe, expect, it } from "vitest";
import {
  extractFileRefsFromText,
  isSafeFileRefPath,
  parseFileRef,
  resolveWorkspaceRelativePath,
} from "./fileRefParser";

describe("parseFileRef", () => {
  it("parses workspace-relative paths with optional :line and :line:col", () => {
    expect(parseFileRef("packages/app/src/pavra/chat.tsx:120", "/workspace/paseo")).toEqual({
      rawToken: "packages/app/src/pavra/chat.tsx:120",
      filePath: "/workspace/paseo/packages/app/src/pavra/chat.tsx",
      displayPath: "packages/app/src/pavra/chat.tsx",
      line: 120,
    });

    expect(parseFileRef("packages/app/src/pavra/chat.tsx:120:15", "/workspace/paseo")).toEqual({
      rawToken: "packages/app/src/pavra/chat.tsx:120:15",
      filePath: "/workspace/paseo/packages/app/src/pavra/chat.tsx",
      displayPath: "packages/app/src/pavra/chat.tsx",
      line: 120,
      column: 15,
    });

    expect(parseFileRef("src/index.ts")).toEqual({
      rawToken: "src/index.ts",
      filePath: "src/index.ts",
      displayPath: "src/index.ts",
    });
  });

  it("parses explicit ./ relative paths and strips leading ./ from displayPath", () => {
    expect(parseFileRef("./scripts/run.sh", "/workspace/paseo/")).toEqual({
      rawToken: "./scripts/run.sh",
      filePath: "/workspace/paseo/scripts/run.sh",
      displayPath: "scripts/run.sh",
    });

    expect(parseFileRef("./README.md:14")).toEqual({
      rawToken: "./README.md:14",
      filePath: "README.md",
      displayPath: "README.md",
      line: 14,
    });
  });

  it("parses absolute paths and shortens displayPath when inside workspaceCwd", () => {
    expect(parseFileRef("/abs/path/file.py:42")).toEqual({
      rawToken: "/abs/path/file.py:42",
      filePath: "/abs/path/file.py",
      displayPath: "/abs/path/file.py",
      line: 42,
    });

    expect(parseFileRef("/workspace/paseo/src/main.rs:9:3", "/workspace/paseo")).toEqual({
      rawToken: "/workspace/paseo/src/main.rs:9:3",
      filePath: "/workspace/paseo/src/main.rs",
      displayPath: "src/main.rs",
      line: 9,
      column: 3,
    });

    expect(parseFileRef("file:///abs/path/file.py#L42C7")).toEqual({
      rawToken: "file:///abs/path/file.py#L42C7",
      filePath: "/abs/path/file.py",
      displayPath: "/abs/path/file.py",
      line: 42,
      column: 7,
    });
  });

  it("parses bare filenames with recognized file extensions and dotfiles", () => {
    expect(parseFileRef("FileRefPreviewModal.tsx", "/workspace/paseo")).toEqual({
      rawToken: "FileRefPreviewModal.tsx",
      filePath: "/workspace/paseo/FileRefPreviewModal.tsx",
      displayPath: "FileRefPreviewModal.tsx",
    });

    expect(parseFileRef("package.json:25")).toEqual({
      rawToken: "package.json:25",
      filePath: "package.json",
      displayPath: "package.json",
      line: 25,
    });

    expect(parseFileRef(".gitignore")).toEqual({
      rawToken: ".gitignore",
      filePath: ".gitignore",
      displayPath: ".gitignore",
    });

    expect(parseFileRef("docker/Dockerfile")).toEqual({
      rawToken: "docker/Dockerfile",
      filePath: "docker/Dockerfile",
      displayPath: "docker/Dockerfile",
    });
  });

  it("rejects unsafe path traversal (.. segments and encoded traversal)", () => {
    expect(parseFileRef("../secret.ts")).toBeNull();
    expect(parseFileRef("../../etc/passwd")).toBeNull();
    expect(parseFileRef("packages/app/../../secret.env")).toBeNull();
    expect(parseFileRef("/workspace/paseo/../etc/passwd")).toBeNull();
    expect(parseFileRef("src/%2e%2e/secret.ts")).toBeNull();
  });

  it("rejects URLs, schemes, CLI flags, plain numbers, versions, and bare words", () => {
    expect(parseFileRef("http://example.com/app.ts")).toBeNull();
    expect(parseFileRef("https://github.com/org/repo/blob/main/index.ts:10")).toBeNull();
    expect(parseFileRef("javascript:alert(1)")).toBeNull();
    expect(parseFileRef("mailto:test@example.com")).toBeNull();
    expect(parseFileRef("ws://localhost:6767/ws")).toBeNull();

    expect(parseFileRef("--foo")).toBeNull();
    expect(parseFileRef("--config=tsconfig.json")).toBeNull();
    expect(parseFileRef("-v")).toBeNull();

    expect(parseFileRef("123")).toBeNull();
    expect(parseFileRef("12:30")).toBeNull();
    expect(parseFileRef("127.0.0.1:8080")).toBeNull();
    expect(parseFileRef("v0.16.2")).toBeNull();
    expect(parseFileRef("1.2.3")).toBeNull();

    expect(parseFileRef("foobar")).toBeNull();
    expect(parseFileRef("Makefile")).toBeNull();
    expect(parseFileRef("localhost:6767")).toBeNull();
    expect(parseFileRef("console.log")).toBeNull();
    expect(parseFileRef("process.env")).toBeNull();
    expect(parseFileRef("example.com")).toBeNull();
    expect(parseFileRef("github.com/org/repo.ts")).toBeNull();
  });
});

describe("isSafeFileRefPath and resolveWorkspaceRelativePath", () => {
  it("guards against traversal and out-of-workspace absolute paths", () => {
    expect(isSafeFileRefPath("src/index.ts", "/workspace/paseo")).toBe(true);
    expect(isSafeFileRefPath("/workspace/paseo/src/index.ts", "/workspace/paseo")).toBe(true);
    expect(isSafeFileRefPath("/etc/passwd", "/workspace/paseo")).toBe(false);
    expect(isSafeFileRefPath("../src/index.ts", "/workspace/paseo")).toBe(false);

    expect(resolveWorkspaceRelativePath("/workspace/paseo/src/index.ts", "/workspace/paseo")).toBe(
      "src/index.ts",
    );
    expect(resolveWorkspaceRelativePath("./src/index.ts", "/workspace/paseo")).toBe("src/index.ts");
    expect(resolveWorkspaceRelativePath("../secret.ts", "/workspace/paseo")).toBeNull();
  });
});

describe("extractFileRefsFromText", () => {
  it("extracts deduplicated file references from inline code and prose while ignoring unsafe tokens", () => {
    const markdown = [
      "Check `packages/app/src/pavra/chat.tsx:120` and `./scripts/run.sh`.",
      "Ignore `https://example.com/foo.ts`, `--bail=1`, `../secret.ts`, and `foobar`.",
      "Also see packages/app/src/pavra/chat.tsx:120 and `/abs/path/file.py:42`.",
    ].join("\n");

    const refs = extractFileRefsFromText(markdown, "/workspace");
    expect(refs).toEqual([
      {
        rawToken: "packages/app/src/pavra/chat.tsx:120",
        filePath: "/workspace/packages/app/src/pavra/chat.tsx",
        displayPath: "packages/app/src/pavra/chat.tsx",
        line: 120,
      },
      {
        rawToken: "./scripts/run.sh",
        filePath: "/workspace/scripts/run.sh",
        displayPath: "scripts/run.sh",
      },
      {
        rawToken: "/abs/path/file.py:42",
        filePath: "/abs/path/file.py",
        displayPath: "/abs/path/file.py",
        line: 42,
      },
    ]);
  });
});
