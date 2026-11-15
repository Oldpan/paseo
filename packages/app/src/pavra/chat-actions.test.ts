import { describe, expect, it } from "vitest";
import type {
  Assistant,
  Conversation,
  Message,
  Takeover,
} from "../../../../extensions/pavra/shared/contracts";
import {
  buildForwardSendInput,
  buildForwardSource,
  buildPlaybookRoutineInput,
  buildPromoteToTaskInput,
  buildSaveMessageRequest,
  derivePlaybookDraft,
  deriveTaskDraftFromMessage,
  formatForwardedBadge,
  formatForwardedContent,
  isMessageSaved,
  listForwardTargets,
  resolvePromoteTaskTargets,
} from "./chat-actions";

const ada: Assistant = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada",
  provider: "codex/gpt-5",
  persona: "Systems engineer",
  serverId: "spark",
  autonomy: {
    enabled: true,
    targets: [
      {
        serverId: "spark",
        directory: "/workspace/paseo",
        isolation: "worktree",
        label: "Spark",
      },
    ],
  },
};

const grace: Assistant = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Grace",
  provider: "claude/sonnet",
  persona: "Reviewer",
};

const dmAda: Conversation = {
  id: "conv-dm-ada",
  name: "Ada",
  kind: "dm",
  members: [ada.id],
  roundtable: false,
};

const groupOps: Conversation = {
  id: "conv-group-ops",
  name: "Ops & Release",
  kind: "group",
  members: [ada.id, grace.id],
  roundtable: false,
  defaultResponderId: grace.id,
};

describe("chat-actions helpers", () => {
  it("detects saved bookmark state and builds toggle requests", () => {
    const unsaved: Message = {
      id: "m-1",
      conversationId: dmAda.id,
      threadId: null,
      senderId: ada.id,
      content: "Keep this command handy",
      createdAt: 100,
      taskId: null,
    };
    expect(isMessageSaved(unsaved)).toBe(false);
    expect(buildSaveMessageRequest({ message: unsaved })).toEqual({
      conversationId: dmAda.id,
      messageId: "m-1",
      saved: true,
    });

    const saved: Message = { ...unsaved, savedAt: "2026-11-15T12:00:00.000Z" };
    expect(isMessageSaved(saved)).toBe(true);
    expect(buildSaveMessageRequest({ message: saved })).toEqual({
      conversationId: dmAda.id,
      messageId: "m-1",
      saved: false,
    });
  });

  it("builds forward sources, filters targets, and formats forwarded payloads", () => {
    const message: Message = {
      id: "m-origin",
      conversationId: groupOps.id,
      threadId: null,
      senderId: ada.id,
      content: "Line 1\nLine 2",
      createdAt: 200,
      taskId: null,
    };

    const source = buildForwardSource({
      message,
      conversations: [dmAda, groupOps],
      assistants: [ada, grace],
    });
    expect(source).toEqual({
      messageId: "m-origin",
      conversationId: groupOps.id,
      conversationTitle: "Ops & Release",
      senderId: ada.id,
      senderName: "Ada",
      content: "Line 1\nLine 2",
      createdAt: 200,
    });

    const targets = listForwardTargets({
      conversations: [groupOps, dmAda],
      assistants: [ada, grace],
      originConversationId: groupOps.id,
    });
    expect(targets.map((target) => target.conversation.id)).toEqual([dmAda.id, groupOps.id]);

    const filtered = listForwardTargets({
      conversations: [groupOps, dmAda],
      assistants: [ada, grace],
      query: "grace",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.conversation.id).toBe(groupOps.id);

    const formatted = formatForwardedContent(source, "FYI for our DM:");
    expect(formatted).toBe(
      "FYI for our DM:\n\n> **Forwarded from Ada** (Ops & Release)\n> Line 1\n> Line 2",
    );

    const sendInput = buildForwardSendInput({
      id: "33333333-3333-4333-8333-333333333333",
      targetConversationId: dmAda.id,
      source,
      comment: "Please review",
    });
    expect(sendInput.forwardedFrom).toEqual({
      conversationId: groupOps.id,
      conversationTitle: "Ops & Release",
      senderName: "Ada",
      messageId: "m-origin",
    });
    expect(formatForwardedBadge(sendInput.forwardedFrom)).toBe(
      "Forwarded from Ada · Ops & Release",
    );
  });

  it("derives promote-to-task draft and builds startTask payload with budget", () => {
    const draft = deriveTaskDraftFromMessage({
      message: {
        senderId: ada.id,
        content: "## Fix WebSocket reconnect race\nEnsure exponential backoff resets on pong.",
      },
      conversation: groupOps,
      assistants: [ada, grace],
    });
    expect(draft).toEqual({
      title: "Fix WebSocket reconnect race",
      goal: "## Fix WebSocket reconnect race\nEnsure exponential backoff resets on pong.",
      defaultAssistantId: ada.id,
    });

    const targets = resolvePromoteTaskTargets({
      assistant: ada,
      defaultDirectory: "/tmp/fallback",
    });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      serverId: "spark",
      directory: "/workspace/paseo",
      isolation: "worktree",
    });

    const startInput = buildPromoteToTaskInput({
      id: "44444444-4444-4444-8444-444444444444",
      conversationId: groupOps.id,
      assistant: ada,
      title: draft.title,
      goal: draft.goal,
      directory: "/workspace/paseo",
      isolation: "worktree",
      budgetMinutes: 60,
    });
    expect(startInput).toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      conversationId: groupOps.id,
      assistantId: ada.id,
      title: "Fix WebSocket reconnect race",
      prompt: "## Fix WebSocket reconnect race\nEnsure exponential backoff resets on pong.",
      serverId: "spark",
      directory: "/workspace/paseo",
      provider: "codex/gpt-5",
      isolation: "worktree",
      budgetMinutes: 60,
    });
  });

  it("extracts Show-Me playbook drafts from assistant messages and browser takeovers", () => {
    const fromMessage = derivePlaybookDraft({
      message: {
        id: "m-playbook",
        senderId: ada.id,
        content: [
          "# Deploy Canary Release",
          "Run the canary deployment pipeline safely.",
          "1. Check git status and branch cleanliness",
          "2. Run targeted smoke tests",
          "3. Tag and push canary artifact",
        ].join("\n"),
      },
      conversation: groupOps,
      assistants: [ada, grace],
    });

    expect(fromMessage.slug).toBe("deploy-canary-release");
    expect(fromMessage.title).toBe("Deploy Canary Release");
    expect(fromMessage.steps).toEqual([
      "Check git status and branch cleanliness",
      "Run targeted smoke tests",
      "Tag and push canary artifact",
    ]);
    expect(fromMessage.content).toContain("# Deploy Canary Release");
    expect(fromMessage.content).toContain("1. Check git status and branch cleanliness");
    expect(fromMessage.defaultAssistantId).toBe(ada.id);

    const takeover: Takeover = {
      id: "takeover-1",
      kind: "browser",
      status: "resolved",
      assistantId: grace.id,
      conversationId: groupOps.id,
      threadId: null,
      turnId: null,
      serverId: "local",
      reason: "Complete SSO 2FA verification",
      url: "https://sso.example.com/login",
      title: "Example SSO Portal",
      createdAt: 100,
      updatedAt: 200,
    };

    const fromTakeover = derivePlaybookDraft({
      takeover,
      takeoverNote: "1. Click Use Hardware Key\n2. Approve redirect to dashboard",
      conversation: groupOps,
      assistants: [ada, grace],
    });
    expect(fromTakeover.slug).toBe("example-sso-portal");
    expect(fromTakeover.defaultAssistantId).toBe(grace.id);
    expect(fromTakeover.content).toContain("https://sso.example.com/login");
    expect(fromTakeover.content).toContain("Click Use Hardware Key");

    const routineInput = buildPlaybookRoutineInput({
      name: fromMessage.title,
      slug: fromMessage.slug,
      assistantId: ada.id,
      conversationId: groupOps.id,
    });
    expect(routineInput).toMatchObject({
      name: "Deploy Canary Release",
      assistantId: ada.id,
      conversationId: groupOps.id,
      cadence: { type: "every", everyMs: 3_600_000 },
    });
    expect(routineInput.prompt).toContain("playbooks/deploy-canary-release.md");
  });
});
