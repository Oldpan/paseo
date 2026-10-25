import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ChatStore } from "./store";
import { Coordinator } from "./coordinator";
import { bindChatSession, chatPrompt, runnableChatTurns, unseenMessages } from "./chat-sessions";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bigbang-chat-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ChatStore(path.join(directory, "chat.sqlite"));
  cleanup.push(() => store.close());
  const coordinator = new Coordinator(store, directory);
  cleanup.push(() => coordinator.close());
  const assistant = coordinator.saveAssistant({
    id: randomUUID(),
    name: "Ada",
    provider: "codex/test-model",
    persona: "Think carefully",
    memory: "Likes TypeScript",
  });
  const conversation = coordinator.createConversation({
    id: randomUUID(),
    name: "Ada",
    kind: "dm",
    members: [assistant.id],
    roundtable: false,
  });
  return { directory, store, coordinator, assistant, conversation };
}
describe("Bigbang durable Chat", () => {
  it("reuses one execution agent for consecutive turns in the same private chat", () => {
    const { store, coordinator, conversation } = fixture();
    coordinator.send({
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "Hello",
    });
    const first = store.snapshot().turns[0];
    store.transaction(() => store.put("turns", { ...first, status: "completed", accepted: true }));
    coordinator.send({
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "Where are we?",
    });
    const turns = store.snapshot().turns;
    expect(turns).toHaveLength(2);
    expect(new Set(turns.map((turn) => turn.agentId)).size).toBe(1);
  });
  it("recovers the chat execution identity with a new coordinator and SQLite connection", () => {
    const { directory, store, coordinator, conversation } = fixture();
    coordinator.send({
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "Remember this chat",
    });
    const first = store.snapshot().turns[0];
    store.transaction(() => store.put("turns", { ...first, status: "completed", accepted: true }));

    const reopened = new ChatStore(path.join(directory, "chat.sqlite"));
    cleanup.push(() => reopened.close());
    const recovered = new Coordinator(reopened, directory);
    cleanup.push(() => recovered.close());
    const followupId = randomUUID();
    recovered.send({
      id: followupId,
      conversationId: conversation.id,
      threadId: null,
      content: "Continue after reconnect",
    });

    expect(reopened.snapshot().turns.find((turn) => turn.triggerId === followupId)?.agentId).toBe(
      first.agentId,
    );
  });
  it("adopts the latest completed legacy execution instead of creating a third chat", () => {
    const { store, coordinator, assistant, conversation } = fixture();
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    const first = {
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      assistantId: assistant.id,
      prompt: "Hello",
      status: "completed" as const,
      agentId: randomUUID(),
      error: null,
    };
    const second = { ...first, id: randomUUID(), agentId: randomUUID(), prompt: "Where are we?" };
    store.transaction(() => {
      store.put("messages", {
        id: firstUserId,
        conversationId: conversation.id,
        threadId: null,
        senderId: "user",
        content: first.prompt,
        createdAt: 1,
        taskId: null,
      });
      store.put("turns", first);
      store.put("messages", {
        id: `reply:${first.id}`,
        conversationId: conversation.id,
        threadId: null,
        senderId: assistant.id,
        content: "Hello back",
        createdAt: 2,
        taskId: null,
      });
      store.put("messages", {
        id: secondUserId,
        conversationId: conversation.id,
        threadId: null,
        senderId: "user",
        content: second.prompt,
        createdAt: 3,
        taskId: null,
      });
      store.put("turns", second);
      store.put("messages", {
        id: `reply:${second.id}`,
        conversationId: conversation.id,
        threadId: null,
        senderId: assistant.id,
        content: "In the same workspace",
        createdAt: 4,
        taskId: null,
      });
    });

    const followupId = randomUUID();
    coordinator.send({
      id: followupId,
      conversationId: conversation.id,
      threadId: null,
      content: "Continue here",
    });

    const next = store.snapshot().turns.find((turn) => turn.triggerId === followupId);
    expect(next?.agentId).toBe(second.agentId);
    expect(next?.agentId).not.toBe(first.agentId);
    const session = store.getChatSession(next!.chatSessionId!);
    expect(session?.lastMessageId).toBe(`reply:${second.id}`);
    expect(unseenMessages(store.snapshot().messages, session!)).toEqual([
      store.get("messages", followupId),
    ]);
    expect(store.get("turns", first.id)).toEqual(first);
    expect(store.get("turns", second.id)).toEqual(second);
  });
  it("sends only unseen group context after a persisted execution cursor", () => {
    const { store, coordinator, assistant } = fixture();
    const grace = coordinator.saveAssistant({ ...assistant, id: randomUUID(), name: "Grace" });
    const conversation = coordinator.createConversation({
      id: randomUUID(),
      name: "Shared room",
      kind: "group",
      members: [assistant.id, grace.id],
      roundtable: false,
    });
    const originalId = randomUUID();
    coordinator.send({
      id: originalId,
      conversationId: conversation.id,
      threadId: null,
      content: "Already seen",
    });
    const session = store.transaction(() =>
      bindChatSession(store, conversation.id, null, assistant),
    );
    const teammateReply = {
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      senderId: grace.id,
      content: "A new observation",
      createdAt: 1,
      taskId: null,
    };
    store.transaction(() => {
      store.putChatSession({ ...session, lastMessageId: originalId });
      store.put("messages", teammateReply);
      store.put("messages", {
        ...teammateReply,
        id: randomUUID(),
        threadId: originalId,
        content: "Private thread context",
      });
      store.put("messages", {
        ...teammateReply,
        id: randomUUID(),
        conversationId: randomUUID(),
        content: "Another room's context",
      });
    });
    const followupId = randomUUID();
    coordinator.send({
      id: followupId,
      conversationId: conversation.id,
      threadId: null,
      content: "What do you think?",
    });

    const persisted = store.getChatSession(session.id)!;
    const delta = unseenMessages(store.snapshot().messages, persisted);
    expect(delta).toEqual([teammateReply, store.get("messages", followupId)]);
    expect(chatPrompt(delta, assistant, [assistant, grace])).toBe(
      "Grace: A new observation\n\nYou: What do you think?",
    );
  });
  it("reports a lost execution cursor instead of replaying the chat history", () => {
    const { store, assistant, conversation } = fixture();
    const session = store.transaction(() =>
      bindChatSession(store, conversation.id, null, assistant),
    );
    store.transaction(() => store.putChatSession({ ...session, lastMessageId: "missing-message" }));

    expect(() =>
      unseenMessages(store.snapshot().messages, store.getChatSession(session.id)!),
    ).toThrow("cursor is missing");
    expect(store.getChatSession(session.id)?.agentId).toBe(session.agentId);
  });
  it("keeps unseen task and teammate messages while excluding the execution's own reply", () => {
    const { store, coordinator, assistant, conversation } = fixture();
    const originalId = randomUUID();
    coordinator.send({
      id: originalId,
      conversationId: conversation.id,
      threadId: null,
      content: "Already sent to this execution",
    });
    const first = store.snapshot().turns[0];
    const session = store.getChatSession(first.chatSessionId!)!;
    const taskResult = {
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      senderId: assistant.id,
      content: "The separate development task finished",
      createdAt: 1,
      taskId: randomUUID(),
    };
    const teammateReply = {
      ...taskResult,
      id: randomUUID(),
      senderId: randomUUID(),
      content: "Another assistant has new context",
      taskId: null,
    };
    const ownReply = {
      ...taskResult,
      id: `reply:${first.id}`,
      content: "The native execution already has this reply",
      taskId: null,
    };
    store.transaction(() => {
      store.putChatSession({ ...session, lastMessageId: originalId });
      store.put("turns", { ...first, status: "completed", accepted: true });
      store.put("messages", taskResult);
      store.put("messages", teammateReply);
      store.put("messages", ownReply);
    });

    const state = store.snapshot();
    const delta = unseenMessages(state.messages, store.getChatSession(session.id)!, state.turns);
    expect(delta).toEqual([taskResult, teammateReply]);
    expect(store.getChatSession(session.id)?.lastMessageId).toBe(originalId);
  });
  it("keeps an already running execution ahead of queued work after its snapshot row moves", () => {
    const { store, coordinator, conversation } = fixture();
    coordinator.send({
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "First turn",
    });
    const first = store.snapshot().turns[0];
    const running = { ...first, status: "running" as const, accepted: true };
    store.transaction(() => store.put("turns", running));
    const queuedMessageId = randomUUID();
    coordinator.send({
      id: queuedMessageId,
      conversationId: conversation.id,
      threadId: null,
      content: "Wait until the current turn settles",
    });
    const second = store.snapshot().turns.find((turn) => turn.triggerId === queuedMessageId)!;
    store.transaction(() => store.put("turns", running));

    expect(store.snapshot().turns.map((turn) => turn.id)).toEqual([second.id, first.id]);
    expect(runnableChatTurns(store.snapshot().turns).map((turn) => turn.id)).toEqual([first.id]);
    store.transaction(() => store.put("turns", { ...running, status: "completed" }));
    expect(runnableChatTurns(store.snapshot().turns).map((turn) => turn.id)).toEqual([second.id]);
  });
  it("keeps the same assistant's separate chats and ordinary threads isolated", () => {
    const { store, coordinator, conversation } = fixture();
    const otherChat = coordinator.createConversation({
      ...conversation,
      id: randomUUID(),
      name: "Another private chat",
    });
    const mainMessage = randomUUID();
    const otherMessage = randomUUID();
    const firstReply = randomUUID();
    const secondRoot = randomUUID();
    const secondReply = randomUUID();
    coordinator.send({
      id: mainMessage,
      conversationId: conversation.id,
      threadId: null,
      content: "First topic",
    });
    coordinator.send({
      id: otherMessage,
      conversationId: otherChat.id,
      threadId: null,
      content: "Different chat",
    });
    coordinator.send({
      id: firstReply,
      conversationId: conversation.id,
      threadId: mainMessage,
      content: "First thread",
    });
    coordinator.send({
      id: secondRoot,
      conversationId: conversation.id,
      threadId: null,
      content: "Second topic",
    });
    coordinator.send({
      id: secondReply,
      conversationId: conversation.id,
      threadId: secondRoot,
      content: "Second thread",
    });

    const turns = store.snapshot().turns;
    const agentFor = (messageId: string) =>
      turns.find((turn) => turn.triggerId === messageId)?.agentId;
    expect(agentFor(mainMessage)).toBe(agentFor(secondRoot));
    expect(new Set([mainMessage, otherMessage, firstReply, secondReply].map(agentFor)).size).toBe(
      4,
    );
  });
  it("reuses each roundtable participant's execution across rounds without sharing assistants", () => {
    const { store, coordinator, assistant } = fixture();
    const grace = coordinator.saveAssistant({ ...assistant, id: randomUUID(), name: "Grace" });
    const conversation = coordinator.createConversation({
      id: randomUUID(),
      name: "Roundtable",
      kind: "group",
      members: [assistant.id, grace.id],
      roundtable: true,
    });
    coordinator.send({
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "Discuss this together",
    });

    const turns = store.snapshot().turns;
    expect(turns).toHaveLength(6);
    for (const member of [assistant, grace]) {
      const memberTurns = turns.filter((turn) => turn.assistantId === member.id);
      expect(memberTurns).toHaveLength(3);
      expect(new Set(memberTurns.map((turn) => turn.agentId)).size).toBe(1);
    }
    expect(new Set(turns.map((turn) => turn.agentId)).size).toBe(2);
  });
  it("keeps one execution identity when a newer queued message supersedes the old one", () => {
    const { store, coordinator, conversation } = fixture();
    coordinator.send({
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "First draft",
    });
    const first = store.snapshot().turns[0];
    const newestId = randomUUID();
    coordinator.send({
      id: newestId,
      conversationId: conversation.id,
      threadId: null,
      content: "Use this correction",
    });

    const second = store.snapshot().turns.find((turn) => turn.triggerId === newestId);
    expect(store.get("turns", first.id)?.status).toBe("cancelled");
    expect(second?.status).toBe("queued");
    expect(second?.agentId).toBe(first.agentId);
  });
  it("stores one message and one dispatch intent across duplicate sends", () => {
    const { store, coordinator, conversation } = fixture();
    const input = {
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "Hello",
    };
    expect(coordinator.send(input)).toEqual({ id: input.id });
    expect(coordinator.send(input)).toEqual({ id: input.id });
    expect(store.snapshot().messages).toHaveLength(1);
    expect(store.snapshot().turns).toHaveLength(1);
    expect(() => coordinator.send({ ...input, content: "Another message" })).toThrow(
      "already used",
    );
  });
  it("returns only changed projections after a cursor and rolls back partial writes", () => {
    const { store, assistant } = fixture();
    const cursor = store.snapshot().cursor;
    store.transaction(() => store.put("assistants", { ...assistant, memory: "New memory" }));
    const delta = store.snapshot(cursor);
    expect(delta.assistants).toEqual([{ ...assistant, memory: "New memory" }]);
    expect(delta.conversations).toEqual([]);
    const abort = () =>
      store.transaction(() => {
        store.put("assistants", { ...assistant, name: "Lost update" });
        throw new Error("abort");
      });
    expect(abort).toThrow("abort");
    expect(store.get("assistants", assistant.id)?.name).toBe("Ada");
    expect(store.snapshot().cursor).toBe(delta.cursor);
  });
  it("persists execution intent before starting a worker and keeps cancellation final", async () => {
    const { store, coordinator, assistant, conversation, directory } = fixture();
    const input = {
      id: randomUUID(),
      conversationId: conversation.id,
      assistantId: assistant.id,
      prompt: "Run checks",
      serverId: "spark",
      directory,
      provider: assistant.provider,
      isolation: "worktree" as const,
    };
    const task = coordinator.task(input);
    expect(task.status).toBe("queued");
    expect(task.execution).toBeNull();
    expect(coordinator.task(input)).toEqual(task);
    expect((await coordinator.cancel(task.id)).status).toBe("cancelled");
    expect(coordinator.task(input).status).toBe("cancelled");
    expect(store.snapshot().tasks).toHaveLength(1);
    expect(store.snapshot().messages[0].taskId).toBe(task.id);
  });
  it("does not route quoted or code mentions to an unintended group member", () => {
    const { coordinator, store, assistant } = fixture();
    const grace = coordinator.saveAssistant({ ...assistant, id: randomUUID(), name: "Grace" });
    const conversation = coordinator.createConversation({
      id: randomUUID(),
      name: "Team",
      kind: "group",
      members: [assistant.id, grace.id],
      roundtable: false,
    });
    coordinator.send({
      id: randomUUID(),
      conversationId: conversation.id,
      threadId: null,
      content: "`@Ada` @Grace please check",
    });
    expect(store.snapshot().turns.map((turn) => turn.assistantId)).toEqual([grace.id]);
  });
  it("recovers the same task identities after reopening SQLite", () => {
    const { store, coordinator, assistant, conversation, directory } = fixture();
    const task = coordinator.task({
      id: randomUUID(),
      conversationId: conversation.id,
      assistantId: assistant.id,
      prompt: "Build",
      serverId: "mac",
      directory,
      provider: assistant.provider,
      isolation: "directory",
    });
    const reopened = new ChatStore(path.join(directory, "chat.sqlite"));
    expect(reopened.get("tasks", task.id)).toEqual(store.get("tasks", task.id));
    reopened.close();
  });
});
