import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("./icons", () => ({
  ChatIcon: () => null,
}));

vi.mock("./ThemeProvider", async () => {
  const { palettes } = await import("./theme");
  return {
    useTheme: () => ({ name: "light" as const, palette: palettes.light }),
  };
});

import { PavraEmptyState, PavraSkeletonList, shouldCollapseLongMessage } from "./EmptyState";
import { extractClipboardImageFiles, readPickedNativeImageAsset } from "./slashCommands";

const uiDir = path.dirname(fileURLToPath(import.meta.url));

describe("shouldCollapseLongMessage", () => {
  it("does not collapse short messages within character and line thresholds", () => {
    const content = "Hello team!\nHere is a short update on the deployment.";
    const result = shouldCollapseLongMessage(content);

    expect(result).toEqual({
      collapsible: false,
      lineCount: 2,
      charCount: content.length,
      previewContent: content,
    });
  });

  it("handles empty string cleanly", () => {
    expect(shouldCollapseLongMessage("")).toEqual({
      collapsible: false,
      lineCount: 0,
      charCount: 0,
      previewContent: "",
    });
  });

  it("collapses messages that exceed the default line threshold (22 lines)", () => {
    const lines = Array.from({ length: 30 }, (_, idx) => `Line ${idx + 1}`);
    const content = lines.join("\n");
    const result = shouldCollapseLongMessage(content);

    expect(result.collapsible).toBe(true);
    expect(result.lineCount).toBe(30);
    expect(result.charCount).toBe(content.length);
    expect(result.previewContent).toBe(`${lines.slice(0, 22).join("\n")}…`);
    expect(result.previewContent).not.toContain("Line 23");
  });

  it("collapses messages that exceed the default character threshold (1200 chars)", () => {
    const content = "a".repeat(1500);
    const result = shouldCollapseLongMessage(content);

    expect(result.collapsible).toBe(true);
    expect(result.lineCount).toBe(1);
    expect(result.charCount).toBe(1500);
    expect(result.previewContent).toBe(`${"a".repeat(1200)}…`);
  });

  it("respects custom character and line thresholds", () => {
    const content = "First line\nSecond line\nThird line\nFourth line";
    const byLines = shouldCollapseLongMessage(content, 500, 2);
    expect(byLines.collapsible).toBe(true);
    expect(byLines.lineCount).toBe(4);
    expect(byLines.previewContent).toBe("First line\nSecond line…");

    const byChars = shouldCollapseLongMessage(content, 15, 10);
    expect(byChars.collapsible).toBe(true);
    expect(byChars.previewContent).toBe(`${content.slice(0, 15)}…`);
  });
});

describe("readPickedNativeImageAsset & extractClipboardImageFiles", () => {
  it("converts expo-image-picker assets with base64 into PendingAttachment with dataUrl", async () => {
    const attachment = await readPickedNativeImageAsset(
      {
        uri: "file:///var/mobile/Media/DCIM/100APPLE/IMG_0042.PNG",
        fileName: "IMG_0042.PNG",
        mimeType: "image/png",
        fileSize: 4096,
        base64: "iVBORw0KGgoAAAANSUhEUg==",
      },
      0,
    );

    expect(attachment).toMatchObject({
      name: "IMG_0042.PNG",
      mimeType: "image/png",
      previewUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      sizeBytes: 4096,
      textContent: null,
    });
    expect(attachment.attachmentId).toBe(attachment.localId);
  });

  it("falls back to reader.readBase64 or uri when base64 is omitted on native image asset", async () => {
    const withReader = await readPickedNativeImageAsset(
      {
        uri: "file:///cache/photo.jpg",
        mimeType: "image/jpeg",
        size: 2048,
      },
      1,
      {
        async readText() {
          return "";
        },
        async readBase64() {
          return "/9j/4AAQSkZJRg==";
        },
      },
    );

    expect(withReader).toMatchObject({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      previewUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      sizeBytes: 2048,
    });
  });

  it("extracts image files from clipboardData.items and clipboardData.files without duplicates", () => {
    const pngFile = new File(["png-bytes"], "pasted.png", { type: "image/png" });
    const txtFile = new File(["hello"], "notes.txt", { type: "text/plain" });

    const fromItems = extractClipboardImageFiles({
      items: [
        { kind: "string", type: "text/plain" },
        { kind: "file", type: "image/png", getAsFile: () => pngFile },
        { kind: "file", type: "text/plain", getAsFile: () => txtFile },
      ],
      files: [pngFile, txtFile],
    });
    expect(fromItems).toEqual([pngFile]);

    const fromFilesFallback = extractClipboardImageFiles({
      files: [txtFile, pngFile],
    });
    expect(fromFilesFallback).toEqual([pngFile]);
  });
});

describe("R0 UX Polish component wiring contracts", () => {
  it("renders PavraEmptyState and PavraSkeletonList elements with expected testIDs", () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const emptyEl = PavraEmptyState({
      eyebrow: "Conversations",
      title: "No messages yet",
      subtitle: "Send a message or @mention an assistant to start collaborating.",
      primaryAction: { label: "Create task", onPress: onPrimary, testID: "empty-primary" },
      secondaryAction: { label: "Browse", onPress: onSecondary, testID: "empty-secondary" },
    });
    expect(emptyEl).toBeTruthy();
    expect((emptyEl as { props?: { testID?: string } }).props?.testID).toBe("pavra-empty-state");

    const skeletonEl = PavraSkeletonList({ rows: 4 });
    expect(skeletonEl).toBeTruthy();
    expect(
      (skeletonEl as { props?: { testID?: string; children?: unknown[] } }).props?.testID,
    ).toBe("pavra-skeleton-list");
    expect((skeletonEl as { props?: { children?: unknown[] } }).props?.children).toHaveLength(4);
  });

  it("wires PavraEmptyState, message jump highlight, long message toggle, and attach-image", () => {
    const emptyStateSource = readFileSync(path.join(uiDir, "EmptyState.tsx"), "utf8");
    expect(emptyStateSource).toContain('testID = "pavra-empty-state"');
    expect(emptyStateSource).toContain('testID = "pavra-skeleton-list"');

    const chatPaneSource = readFileSync(path.join(uiDir, "ChatPane.tsx"), "utf8");
    expect(chatPaneSource).toContain("focusMessageId");
    expect(chatPaneSource).toContain("onFocusMessageHandled");
    expect(chatPaneSource).toContain("scrollToIndex");
    expect(chatPaneSource).toContain("PavraEmptyState");

    const chatChromeSource = readFileSync(path.join(uiDir, "ChatChrome.tsx"), "utf8");
    expect(chatChromeSource).toContain("message-highlighted-");
    expect(chatChromeSource).toContain("message-expand-toggle-");
    expect(chatChromeSource).toContain("shouldCollapseLongMessage");

    const composerSource = readFileSync(path.join(uiDir, "Composer.tsx"), "utf8");
    expect(composerSource).toContain('testID="attach-image"');
    expect(composerSource).toContain("ImagePicker.launchImageLibraryAsync");
    expect(composerSource).toContain("extractClipboardImageFiles");
  });
});
