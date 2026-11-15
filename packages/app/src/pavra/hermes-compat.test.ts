import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PeerMessage, Studio } from "../../../../extensions/pavra/shared/contracts";
import { recentParticipantIds } from "./group";
import { openExchanges, studioRecords } from "./peer-activity";
import {
  findMatchingSlashCommands,
  formatMessageWithAttachments,
  resolveSlashCommandAction,
  resolveSlashCommands,
} from "./ui/slashCommands";

const pavraDir = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(pavraDir, "../../../../extensions/pavra/shared");
const selfPath = fileURLToPath(import.meta.url);

const FORBIDDEN_HERMES_TOKENS = [
  ".toSorted(",
  ".toReversed(",
  ".toSpliced(",
  "Object.groupBy(",
  "Map.groupBy(",
  "Promise.withResolvers(",
] as const;

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry) && path.resolve(fullPath) !== path.resolve(selfPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Hermes runtime compatibility", () => {
  it("does not call ES2023+ / non-Hermes APIs in pavra app or shared sources", () => {
    const files = [...collectSourceFiles(pavraDir), ...collectSourceFiles(sharedDir)];
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const token of FORBIDDEN_HERMES_TOKENS) {
        if (source.includes(token)) {
          violations.push(`${path.relative(pavraDir, file)}: ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("runs openExchanges, studioRecords, and recentParticipantIds when Array.prototype.toSorted and toReversed are undefined", () => {
    const originalToSorted = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    const originalToReversed = Object.getOwnPropertyDescriptor(Array.prototype, "toReversed");
    Reflect.deleteProperty(Array.prototype, "toSorted");
    Reflect.deleteProperty(Array.prototype, "toReversed");

    try {
      expect((Array.prototype as { toSorted?: unknown }).toSorted).toBeUndefined();
      expect((Array.prototype as { toReversed?: unknown }).toReversed).toBeUndefined();

      const sender = {
        key: "assistant:a",
        kind: "assistant" as const,
        name: "Sky",
        machine: "Spark",
      };
      const recipient = {
        key: "assistant:b",
        kind: "assistant" as const,
        name: "Max",
        machine: "Spark",
      };
      const messages: PeerMessage[] = [
        {
          id: "req-2",
          ledger: "mailbox",
          kind: "request",
          studioId: null,
          sender,
          recipient,
          text: "Second request",
          replyTo: null,
          status: "acked",
          conversationId: "conv-1",
          threadId: null,
          createdAt: 20,
        },
        {
          id: "req-1",
          ledger: "mailbox",
          kind: "request",
          studioId: null,
          sender,
          recipient,
          text: "First request",
          replyTo: null,
          status: "queued",
          conversationId: "conv-1",
          threadId: null,
          createdAt: 10,
        },
        {
          id: "studio-2",
          ledger: "studio",
          kind: "message",
          studioId: "studio-1",
          sender,
          recipient,
          text: "Later studio record",
          replyTo: null,
          status: "accepted",
          conversationId: null,
          threadId: null,
          createdAt: 20,
        },
        {
          id: "studio-1",
          ledger: "studio",
          kind: "message",
          studioId: "studio-1",
          sender,
          recipient,
          text: "Earlier studio record",
          replyTo: null,
          status: "accepted",
          conversationId: null,
          threadId: null,
          createdAt: 10,
        },
      ];

      const exchanges = openExchanges(messages, "conv-1", null);
      expect(exchanges.map((item) => item.id)).toEqual(["req-1", "req-2"]);

      const studio: Studio = {
        id: "studio-1",
        name: "Spark Studio",
        status: "active",
        workspaces: [],
        createdAt: 1,
      };
      const records = studioRecords(messages, studio);
      expect(records.map((item) => item.id)).toEqual(["studio-1", "studio-2"]);

      const participants = recentParticipantIds(
        [
          {
            id: "m1",
            conversationId: "conv-1",
            threadId: null,
            taskId: null,
            senderId: "sky",
            content: "Hello",
            createdAt: 100,
          },
          {
            id: "m2",
            conversationId: "conv-1",
            threadId: null,
            taskId: null,
            senderId: "max",
            content: "Hi",
            createdAt: 200,
          },
        ],
        { id: "conv-1", members: ["sky", "max"] },
        null,
        300,
      );
      expect(participants).toEqual(["max", "sky"]);
    } finally {
      const target: object = Array.prototype;
      if (originalToSorted) {
        Reflect.defineProperty(target, "toSorted", originalToSorted);
      }
      if (originalToReversed) {
        Reflect.defineProperty(target, "toReversed", originalToReversed);
      }
    }
  });

  it("guards all expo/dom proxy method calls in PavraTerminalEmulator with optional invocation", () => {
    const emulatorPath = path.join(pavraDir, "terminal", "emulator.native.tsx");
    const source = readFileSync(emulatorPath, "utf8");
    const unsafeCalls = [...source.matchAll(/dom\.current\?\.\w+\(/g)].map((m) => m[0]);
    expect(unsafeCalls).toEqual([]);
    const safeCalls = [...source.matchAll(/dom\.current\?\.\w+\?\.\(/g)].map((m) => m[0]);
    expect(safeCalls.length).toBeGreaterThanOrEqual(10);
  });

  it("unifies Android and Web icons on lucide-react-native and hides message action bars by default", () => {
    const iconsSource = readFileSync(path.join(pavraDir, "ui", "icons.tsx"), "utf8");
    const webIconsSource = readFileSync(path.join(pavraDir, "ui", "icons.web.tsx"), "utf8");
    expect(iconsSource).toContain('from "lucide-react-native"');
    expect(webIconsSource).toBe(iconsSource);
    expect(webIconsSource).not.toContain('from "./icons"');
    const chatChromeSource = readFileSync(path.join(pavraDir, "ui", "ChatChrome.tsx"), "utf8");
    expect(chatChromeSource).not.toContain("hovered || !isWeb || compact");
    expect(chatChromeSource).toContain("MessageContextMenu");
    expect(chatChromeSource).toContain("MessageSideActions");
    expect(chatChromeSource).toContain("MessageSwipeReveal");
    const swipeSource = readFileSync(path.join(pavraDir, "ui", "MessageSwipe.tsx"), "utf8");
    expect(swipeSource).toContain("message-swipe-content");
    expect(swipeSource).toContain("message-timestamp");
  });

  it("supports Pavra composer slash commands (/task, /steer, /status, /pass, /clear) and attachment formatting", () => {
    const commands = resolveSlashCommands("primary_dm");
    expect(commands.map((c) => c.name)).toEqual(["task", "steer", "status", "pass", "clear"]);
    expect(findMatchingSlashCommands("/st", commands).map((c) => c.name)).toEqual([
      "steer",
      "status",
    ]);

    expect(resolveSlashCommandAction("/clear", commands)).toMatchObject({ kind: "clear" });
    expect(resolveSlashCommandAction("/task Ship v0.16", commands)).toMatchObject({
      kind: "task",
      goal: "Ship v0.16",
    });
    expect(resolveSlashCommandAction("/steer", commands)).toMatchObject({
      kind: "autocomplete",
      replacement: "/steer ",
    });
    expect(resolveSlashCommandAction("/steer Focus on tests", commands)).toMatchObject({
      kind: "steer",
      instruction: "Focus on tests",
    });
    expect(resolveSlashCommandAction("/status", commands)).toMatchObject({
      kind: "send",
      content: "Status check: please summarize current progress, blockers, and next steps.",
    });
    expect(resolveSlashCommandAction("/pass", commands)).toMatchObject({
      kind: "send",
      content: "Quick status check — reply (pass) if nothing needs attention.",
    });

    const formatted = formatMessageWithAttachments("Please review", [
      { name: "notes.md", textContent: "# Plan\n- Step 1" },
      { name: "shot.png", previewUrl: "data:image/png;base64,abc", mimeType: "image/png" },
    ]);
    expect(formatted).toContain("Please review");
    expect(formatted).toContain("[Attachment: notes.md]\n```\n# Plan\n- Step 1\n```");
    expect(formatted).toContain("[Attachment: shot.png (image)]");
  });
});
