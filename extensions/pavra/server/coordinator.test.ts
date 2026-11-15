import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatStore } from "./store";
import { Coordinator, type TurnEndedEvent } from "./coordinator";
import { FakeExecution } from "./execution.fake";
import { assistantInstructions, chatAgentTitle } from "./chat-sessions";
import { PAVRA_TOOLS_NOTE } from "./tools-note";
import {
  MAX_MEMORY_INDEX_LINES,
  channelSlug,
  isoWeekKey,
  prepareHome,
  readMemorySnapshot,
} from "./assistant-files";
import { workspaceMemoryHint } from "./prompts";
import type { MachinePort } from "./machines";
import { callAgentTool } from "./agent-tools";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
const completed: TurnEndedEvent["outcome"] = { kind: "completed" };

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "pavra-coordinator-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ChatStore(path.join(directory, "chat.sqlite"));
  cleanup.push(() => store.close());
  const execution = new FakeExecution();
  const coordinator = new Coordinator(store, directory, { execution });
  cleanup.push(() => coordinator.close());
  coordinator.attach();
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
  async function say(content: string) {
    const id = randomUUID();
    coordinator.send({ id, conversationId: conversation.id, threadId: null, content });
    await coordinator.idle();
    return store.snapshot().turns.find((turn) => turn.triggerId === id)!;
  }
  const ended = (agentId: string, outcome = completed) =>
    coordinator.onTurnEnded({ agent: { id: agentId }, outcome });
  const finals = () => store.snapshot().messages.filter((message) => message.kind === "final");
  return { directory, store, execution, coordinator, assistant, conversation, say, ended, finals };
}

describe("event-driven Chat coordination", () => {
  it("dispatches with the turn id as the anchor and commits one final for duplicate hooks", async () => {
    const { store, execution, coordinator, say, ended, finals } = fixture();
    const turn = await say("Hello");
    expect(execution.sent).toEqual([
      expect.objectContaining({ agentId: turn.agentId, messageId: turn.id }),
    ]);
    expect(store.get("turns", turn.id)).toMatchObject({ accepted: true, status: "running" });

    execution.say(turn.agentId, "Hi there", "m1");
    execution.finish(turn.agentId);
    ended(turn.agentId);
    ended(turn.agentId);
    coordinator.onTurnEnded({ agent: { id: turn.agentId }, outcome: completed });
    await coordinator.idle();

    expect(finals()).toHaveLength(1);
    expect(finals()[0]).toMatchObject({
      id: `final:${turn.id}`,
      content: "Hi there",
      turnId: turn.id,
      senderId: turn.assistantId,
    });
    expect(finals()[0].seq).toBeGreaterThan(store.get("messages", turn.triggerId!)!.seq!);
    expect(store.get("turns", turn.id)).toMatchObject({
      status: "completed",
      finalMessageId: `final:${turn.id}`,
    });
  });

  it("does not settle a turn that is still running", async () => {
    const { store, execution, coordinator, say, ended, finals } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "Partial", "m1");
    ended(turn.agentId);
    await coordinator.sweep();
    expect(finals()).toHaveLength(0);
    expect(store.get("turns", turn.id)?.status).toBe("running");
  });

  it("recovers a missed turn_ended hook on the sweep", async () => {
    const { store, execution, coordinator, say, finals } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "Answer", "m1");
    execution.finish(turn.agentId);
    await coordinator.sweep();
    await coordinator.sweep();
    expect(finals().map((message) => message.content)).toEqual(["Answer"]);
    expect(store.get("turns", turn.id)?.status).toBe("completed");
  });

  it("sends the next queued turn only after the running one settles", async () => {
    const { store, execution, coordinator, say, ended, finals } = fixture();
    const first = await say("First");
    const second = await say("Second");
    expect(execution.sent).toHaveLength(1);
    execution.say(first.agentId, "One", "m1");
    execution.finish(first.agentId);
    ended(first.agentId);
    await coordinator.idle();
    // The first reply is superseded by the newer message and never reaches the chat.
    expect(execution.sent.map((item) => item.messageId)).toEqual([first.id, second.id]);
    expect(store.get("turns", first.id)).toMatchObject({
      status: "cancelled",
      error: "Superseded by a newer message.",
    });
    expect(finals()).toHaveLength(0);
  });

  it("steers an active turn immediately with delivery='steer' while preserving the session agentId", async () => {
    const { store, execution, coordinator, conversation, say, ended, finals } = fixture();
    const first = await say("First question");
    execution.say(first.agentId, "Partial first answer", "m1");

    const steerMsgId = randomUUID();
    coordinator.send({
      id: steerMsgId,
      conversationId: conversation.id,
      threadId: null,
      content: "Steer follow-up",
      delivery: "steer",
    });
    await coordinator.idle();

    const second = store.snapshot().turns.find((turn) => turn.triggerId === steerMsgId)!;
    expect(second.agentId).toBe(first.agentId);
    expect(store.get("turns", first.id)).toMatchObject({
      status: "cancelled",
      error: "Superseded by a newer message.",
    });
    expect(store.get("turns", second.id)).toMatchObject({
      status: "running",
      accepted: true,
      agentId: first.agentId,
    });
    // Dispatched immediately into the running execution without waiting for `first` to finish.
    expect(execution.sent.map((item) => [item.agentId, item.messageId])).toEqual([
      [first.agentId, first.id],
      [first.agentId, second.id],
    ]);
    expect(execution.sent[1].text).toBe("You: Steer follow-up");

    execution.say(second.agentId, "Steered final answer", "m2");
    execution.finish(second.agentId);
    ended(second.agentId);
    await coordinator.idle();

    expect(finals().map((message) => [message.id, message.content])).toEqual([
      [`final:${second.id}`, "Steered final answer"],
    ]);
    expect(store.get("turns", second.id)).toMatchObject({
      status: "completed",
      finalMessageId: `final:${second.id}`,
    });
  });

  it("cancels an in-flight turn via cancelTurn and preserves the session agentId for the next message", async () => {
    const { store, execution, coordinator, say, ended, finals } = fixture();
    const first = await say("Long question");
    execution.say(first.agentId, "Partial output", "m1");

    const cancelled = await coordinator.cancelTurn({ id: first.id });
    expect(cancelled).toMatchObject({
      id: first.id,
      status: "cancelled",
      error: null,
    });
    expect(execution.cancelled).toEqual([first.agentId]);
    expect(store.get("turns", first.id)).toMatchObject({
      status: "cancelled",
      error: null,
    });

    // A late turn_ended hook after cancellation does not commit partial output.
    execution.finish(first.agentId);
    ended(first.agentId);
    await coordinator.idle();
    expect(finals()).toHaveLength(0);

    const next = await say("Next question");
    expect(next.agentId).toBe(first.agentId);
    execution.say(next.agentId, "Next answer", "m2");
    execution.finish(next.agentId);
    ended(next.agentId);
    await coordinator.idle();
    expect(finals().map((message) => message.content)).toEqual(["Next answer"]);
  });

  it("treats an accepted dispatch with a lost response as accepted, without resending", async () => {
    const { store, execution, coordinator, say } = fixture();
    execution.failNextDispatch = Object.assign(new Error("connection lost"), {
      code: "DAEMON_DISCONNECTED",
    });
    const turn = await say("Hello");
    expect(store.get("turns", turn.id)).toMatchObject({ status: "unknown", accepted: false });
    expect(execution.sent).toHaveLength(1);

    await coordinator.sweep();
    expect(execution.sent).toHaveLength(1);
    expect(store.get("turns", turn.id)).toMatchObject({ status: "running", accepted: true });
  });

  it("resends the same message id when the anchor never reached the execution", async () => {
    const { store, execution, coordinator, say } = fixture();
    execution.rejectNextDispatch = Object.assign(new Error("host offline"), {
      code: "host_unreachable",
    });
    const turn = await say("Hello");
    expect(store.get("turns", turn.id)).toMatchObject({ status: "unknown", accepted: false });
    expect(execution.sent).toHaveLength(0);

    await coordinator.sweep();
    expect(execution.sent).toEqual([
      expect.objectContaining({ agentId: turn.agentId, messageId: turn.id }),
    ]);
    expect(store.get("turns", turn.id)).toMatchObject({ status: "running", accepted: true });
    expect(new Set(store.snapshot().turns.map((item) => item.agentId)).size).toBe(1);
  });

  it("ignores turns typed in Studio and executions without our anchor", async () => {
    const { store, execution, coordinator, say, ended, finals } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "Mine", "m1");
    execution.finish(turn.agentId);
    ended(turn.agentId);
    await coordinator.idle();
    expect(finals()).toHaveLength(1);
    const before = store.snapshot();

    execution.studioTyped(turn.agentId, "Studio question");
    execution.say(turn.agentId, "Studio answer", "s1");
    execution.finish(turn.agentId);
    ended(turn.agentId);
    await coordinator.idle();
    expect(store.snapshot()).toEqual(before);

    // A turn whose anchor left the timeline is never guessed from other output; once the
    // execution is idle it fails as interrupted.
    const next = await say("Again");
    execution.agents.get(turn.agentId)!.entries.length = 0;
    execution.studioTyped(turn.agentId, "Other", "other");
    execution.say(turn.agentId, "Unrelated", "u1");
    execution.finish(turn.agentId);
    ended(turn.agentId);
    await coordinator.idle();
    expect(store.get("turns", next.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Interrupted"),
    });
    expect(finals()).toHaveLength(1);
  });

  it("ignores hooks for agents this ledger did not create", async () => {
    const { execution, coordinator, ended } = fixture();
    const readTurn = vi.spyOn(execution, "readTurn");
    ended("someone-elses-agent");
    coordinator.onTurnStarted({ agent: { id: "someone-elses-agent" } });
    coordinator.onAgentGone({ agent: { id: "someone-elses-agent" } });
    await coordinator.idle();
    expect(readTurn).not.toHaveBeenCalled();
  });

  it("excludes a Studio message typed after the turn from its final", async () => {
    const { execution, say, ended, finals, coordinator } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "Mine", "m1");
    execution.studioTyped(turn.agentId, "Studio question");
    execution.say(turn.agentId, "Theirs", "s1");
    ended(turn.agentId);
    await coordinator.idle();
    expect(finals().map((message) => message.content)).toEqual(["Mine"]);
  });

  it("commits nothing visible when the assistant passes", async () => {
    const { store, execution, coordinator, say, ended } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "(pass)", "m1");
    execution.finish(turn.agentId);
    ended(turn.agentId);
    await coordinator.idle();
    expect(store.snapshot().messages.map((message) => message.kind)).toEqual(["user"]);
    expect(store.get("turns", turn.id)?.status).toBe("completed");
    expect(store.get("turns", turn.id)?.finalMessageId).toBeUndefined();
  });

  it("marks a turn failed from the hook outcome and commits no final", async () => {
    const { store, execution, coordinator, say, ended, finals } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "Half an answer", "m1");
    execution.finish(turn.agentId);
    ended(turn.agentId, { kind: "failed", error: { message: "provider exploded" } });
    await coordinator.idle();
    expect(finals()).toHaveLength(0);
    expect(store.get("turns", turn.id)).toMatchObject({
      status: "failed",
      error: "provider exploded",
    });
  });

  it("tracks pending approvals", async () => {
    const { store, execution, coordinator, say } = fixture();
    const turn = await say("Hello");
    execution.askPermission(turn.agentId, { requestId: "req-1", title: "Run a command" });
    coordinator.onPermissionRequested({
      agent: { id: turn.agentId },
      request: { id: "req-1", name: "shell" },
    });
    await coordinator.idle();
    expect(store.get("turns", turn.id)?.status).toBe("attention");
    execution.agents.get(turn.agentId)!.permission = null;
    coordinator.onPermissionResolved({ agent: { id: turn.agentId } });
    await coordinator.idle();
    expect(store.get("turns", turn.id)?.status).toBe("running");
  });

  it("fails a turn whose anchor a daemon restart lost once its execution is idle", async () => {
    const { store, execution, coordinator, say, finals } = fixture();
    const turn = await say("Hello");
    // The daemon rebuilds a timeline from provider history after a restart, without message ids.
    const agent = execution.agents.get(turn.agentId)!;
    agent.entries = [{ item: { type: "user_message", text: "Hello" } }];
    await coordinator.sweep();
    expect(store.get("turns", turn.id)?.status).toBe("running");

    execution.finish(turn.agentId);
    await coordinator.sweep();
    expect(store.get("turns", turn.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Interrupted"),
    });
    expect(finals()).toHaveLength(0);
    expect((await say("Try again")).agentId).toBe(turn.agentId);
  });

  it("fails a turn whose execution closed mid-turn and resumes the same agent on the next message", async () => {
    const { store, execution, coordinator, say, ended, finals } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "Partial answer", "m1");
    execution.agents.get(turn.agentId)!.closed = true;
    coordinator.onAgentGone({ agent: { id: turn.agentId } }, "closed");
    await coordinator.idle();
    expect(store.get("turns", turn.id)).toMatchObject({
      status: "failed",
      accepted: true,
      error: expect.stringContaining("Interrupted"),
    });
    expect(finals()).toHaveLength(0);

    const next = await say("Try again");
    expect(next.agentId).toBe(turn.agentId);
    expect(execution.sent.map((item) => [item.agentId, item.messageId])).toEqual([
      [turn.agentId, turn.id],
      [turn.agentId, next.id],
    ]);
    execution.say(turn.agentId, "Second answer", "m2");
    execution.finish(turn.agentId);
    ended(turn.agentId);
    await coordinator.idle();
    expect(finals().map((message) => message.content)).toEqual(["Second answer"]);
    expect(new Set(store.snapshot().turns.map((item) => item.agentId)).size).toBe(1);
  });

  it("settles a closed execution found by the sweep as interrupted, not as a reply", async () => {
    const { store, execution, coordinator, say, finals } = fixture();
    const turn = await say("Hello");
    execution.say(turn.agentId, "Half", "m1");
    execution.agents.get(turn.agentId)!.closed = true;
    await coordinator.sweep();
    expect(store.get("turns", turn.id)?.status).toBe("failed");
    expect(finals()).toHaveLength(0);
  });

  it("fails a turn whose execution was archived with the archive message", async () => {
    const { store, execution, coordinator, say } = fixture();
    const turn = await say("Hello");
    execution.agents.get(turn.agentId)!.archived = true;
    coordinator.onAgentGone({ agent: { id: turn.agentId } }, "archived");
    await coordinator.idle();
    expect(store.get("turns", turn.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("archived"),
    });
    // The lane is free, but an archived execution is never replaced.
    const next = await say("Anyone there?");
    expect(store.get("turns", next.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("archived"),
    });
    expect(new Set(store.snapshot().turns.map((item) => item.agentId)).size).toBe(1);
  });
});

describe("long-polling chat.state", () => {
  it("resolves as soon as the ledger advances past the cursor", async () => {
    const { store, coordinator, assistant } = fixture();
    const { cursor, generation } = store.snapshot();
    const poll = coordinator.readState({ after: cursor, generation, waitMs: 5000 });
    const started = Date.now();
    coordinator.saveAssistant({ ...assistant, persona: "Changed" });
    const state = await poll;
    expect(Date.now() - started).toBeLessThan(1000);
    expect(state.cursor).toBeGreaterThan(cursor);
    expect(state.assistants.map((item) => item.persona)).toEqual(["Changed"]);
  });

  it("returns an empty delta when the wait times out", async () => {
    const { store, coordinator } = fixture();
    const { cursor, generation } = store.snapshot();
    const state = await coordinator.readState({ after: cursor, generation, waitMs: 30 });
    expect(state.cursor).toBe(cursor);
    expect(state.assistants).toEqual([]);
  });

  it("answers immediately without waitMs, for a new client, or after a generation change", async () => {
    const { store, coordinator } = fixture();
    const { cursor } = store.snapshot();
    const started = Date.now();
    await coordinator.readState({ after: cursor });
    await coordinator.readState({ waitMs: 5000 });
    await coordinator.readState({ after: cursor, generation: "stale", waitMs: 5000 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not wake on a rolled back transaction", async () => {
    const { store, coordinator, assistant } = fixture();
    const { cursor, generation } = store.snapshot();
    const poll = coordinator.readState({ after: cursor, generation, waitMs: 50 });
    const abort = () =>
      store.transaction(() => {
        store.put("assistants", { ...assistant, name: "Lost" });
        throw new Error("abort");
      });
    expect(abort).toThrow("abort");
    expect((await poll).cursor).toBe(cursor);
  });
});

describe("tasks", () => {
  function taskInput(f: ReturnType<typeof fixture>, serverId: string) {
    return {
      id: randomUUID(),
      conversationId: f.conversation.id,
      assistantId: f.assistant.id,
      prompt: "Run checks",
      serverId,
      directory: f.directory,
      provider: f.assistant.provider,
      isolation: "directory" as const,
    };
  }

  it("settles a local task from its hook and posts the result to the chat", async () => {
    const f = fixture();
    const task = f.coordinator.task(taskInput(f, "local"));
    await f.coordinator.idle();
    expect(f.store.get("tasks", task.id)).toMatchObject({ status: "running", accepted: true });
    expect(f.execution.watchers.size).toBe(0);
    f.execution.say(task.id, "All checks passed", "m1");
    f.execution.finish(task.id);
    f.ended(task.id);
    f.ended(task.id);
    await f.coordinator.idle();
    expect(f.store.get("tasks", task.id)?.status).toBe("completed");
    expect(f.finals().map((message) => [message.id, message.content])).toEqual([
      [`result:${task.id}`, "All checks passed"],
    ]); // The result lands in the task's thread (M7), not at the chat root.
    expect(f.store.get("messages", `result:${task.id}`)?.threadId).toBe(`task:${task.id}`);
  });

  it("observes a task on another host through its agent and settles on the update", async () => {
    const f = fixture();
    const task = f.coordinator.task(taskInput(f, "remote"));
    await f.coordinator.idle();
    await vi.waitFor(() => expect(f.execution.watchers.get(task.id)?.size).toBe(1));
    f.execution.askPermission(task.id, { requestId: "r1", title: "Run tests" });
    f.execution.emit(task.id);
    await f.coordinator.idle();
    expect(f.store.get("tasks", task.id)).toMatchObject({
      status: "attention",
      pendingPermission: { requestId: "r1", title: "Run tests" },
    });
    f.execution.say(task.id, "Done remotely", "m1");
    f.execution.finish(task.id);
    f.execution.emit(task.id);
    await f.coordinator.idle();
    expect(f.store.get("tasks", task.id)).toMatchObject({
      status: "completed",
      pendingPermission: null,
    });
    expect(f.finals()[0].content).toBe("Done remotely");
  });

  it("keeps at most two tasks live and starts the queued one when a slot frees", async () => {
    const f = fixture();
    const tasks = [1, 2, 3].map(() => f.coordinator.task(taskInput(f, "local")));
    await f.coordinator.idle();
    expect(tasks.map((task) => f.store.get("tasks", task.id)?.status)).toEqual([
      "running",
      "running",
      "queued",
    ]);
    f.execution.say(tasks[0].id, "Done", "m1");
    f.execution.finish(tasks[0].id);
    f.ended(tasks[0].id);
    await f.coordinator.idle();
    expect(f.store.get("tasks", tasks[2].id)?.status).toBe("running");
  });

  it("fails a task whose anchor a daemon restart lost once its executor is idle", async () => {
    const f = fixture();
    const task = f.coordinator.task(taskInput(f, "local"));
    await f.coordinator.idle();
    const agent = f.execution.agents.get(task.id)!;
    agent.entries = [{ item: { type: "user_message", text: "Brief" } }];
    f.execution.finish(task.id);
    await f.coordinator.sweep();
    expect(f.store.get("tasks", task.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Interrupted"),
    });
  });

  it("fails a task whose execution closed so a follow-up can continue the same executor", async () => {
    const f = fixture();
    const task = f.coordinator.task(taskInput(f, "local"));
    await f.coordinator.idle();
    f.execution.agents.get(task.id)!.closed = true;
    f.coordinator.onAgentGone({ agent: { id: task.id } }, "closed");
    await f.coordinator.idle();
    expect(f.store.get("tasks", task.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Interrupted"),
    });
    expect(f.finals()).toHaveLength(0);
    f.coordinator.send({
      id: randomUUID(),
      conversationId: f.conversation.id,
      threadId: `task:${task.id}`,
      content: "Continue",
    });
    await f.coordinator.idle();
    expect(f.execution.sent.at(-1)?.agentId).toBe(task.id);
    expect(f.store.get("tasks", task.id)?.status).toBe("running");
  });

  it("cancels a task whose budget ran out on the sweep and keeps cancellation final", async () => {
    const f = fixture();
    const task = f.coordinator.task(taskInput(f, "local"));
    await f.coordinator.idle();
    f.store.transaction(() =>
      f.store.put("tasks", { ...f.store.get("tasks", task.id)!, deadline: Date.now() - 1 }),
    );
    await f.coordinator.sweep();
    expect(f.store.get("tasks", task.id)).toMatchObject({
      status: "cancelled",
      cancelPending: false,
    });
    expect(f.execution.cancelled).toEqual([task.id]);
    f.ended(task.id);
    await f.coordinator.idle();
    expect(f.store.get("tasks", task.id)?.status).toBe("cancelled");
  });
});

describe("file memory", () => {
  it("tells the agent where its memory lives instead of inlining it", () => {
    const { assistant } = fixture();
    const instructions = assistantInstructions(assistant);
    expect(instructions).toContain("MEMORY.md");
    expect(instructions).toContain("notes/");
    expect(instructions).not.toContain("Likes TypeScript");
  });

  it("tells the agent the pavra tools are MCP tools it may have to search for", () => {
    const { assistant } = fixture();
    expect(assistantInstructions(assistant)).toContain(PAVRA_TOOLS_NOTE);
  });

  it("writes MEMORY.md only when the assistant is created", () => {
    const { directory, coordinator, assistant } = fixture();
    const file = path.join(directory, "assistants", assistant.id, "MEMORY.md");
    expect(readFileSync(file, "utf8")).toBe("Likes TypeScript");
    writeFileSync(file, "The agent edited this");
    const saved = coordinator.saveAssistant({ ...assistant, name: "Ada L.", memory: "Overwrite?" });
    expect(readFileSync(file, "utf8")).toBe("The agent edited this");
    expect(saved).toMatchObject({ name: "Ada L.", memory: "Likes TypeScript" });
  });

  it("reads and writes memory with an mtime precondition", async () => {
    const { coordinator, assistant } = fixture();
    const loaded = await coordinator.readAssistantMemory({ assistantId: assistant.id });
    expect(loaded.content).toBe("Likes TypeScript");
    expect(loaded.mtimeMs).toBeGreaterThan(0);
    const written = await coordinator.writeAssistantMemory({
      assistantId: assistant.id,
      content: "New notes",
      expectedMtimeMs: loaded.mtimeMs,
    });
    expect(written.content).toBe("New notes");
    await expect(
      coordinator.writeAssistantMemory({
        assistantId: assistant.id,
        content: "Stale write",
        expectedMtimeMs: loaded.mtimeMs - 1,
      }),
    ).rejects.toThrow("changed since");
    expect((await coordinator.readAssistantMemory({ assistantId: assistant.id })).content).toBe(
      "New notes",
    );
  });

  it("rejects memory access for an unknown assistant", async () => {
    const { coordinator } = fixture();
    await expect(coordinator.readAssistantMemory({ assistantId: randomUUID() })).rejects.toThrow(
      "no longer exists",
    );
  });

  it("creates structured subdirectories when preparing assistant home", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pavra-prepare-home-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    prepareHome(dir, "Initial memory");

    expect(existsSync(path.join(dir, "MEMORY.md"))).toBe(true);
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toBe("Initial memory");
    expect(existsSync(path.join(dir, "notes"))).toBe(true);
    expect(existsSync(path.join(dir, "notes", "channels"))).toBe(true);
    expect(existsSync(path.join(dir, "notes", "work-log"))).toBe(true);
    expect(existsSync(path.join(dir, "notes", "archive"))).toBe(true);
    expect(existsSync(path.join(dir, "playbooks"))).toBe(true);
  });

  it("truncates MEMORY.md to 200 lines in readMemorySnapshot", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pavra-snapshot-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    prepareHome(dir, "seed");

    const lines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`);
    writeFileSync(path.join(dir, "MEMORY.md"), lines.join("\n"));
    writeFileSync(path.join(dir, "notes", "user-preferences.md"), "Prefers concise replies");

    const snapshot = readMemorySnapshot(dir);
    const resultLines = snapshot.memoryIndex.split("\n");
    expect(resultLines).toHaveLength(MAX_MEMORY_INDEX_LINES);
    expect(resultLines[0]).toBe("Line 1");
    expect(resultLines[199]).toBe("Line 200");
    expect(snapshot.memoryIndex).not.toContain("Line 201");
    expect(snapshot.userPreferences).toBe("Prefers concise replies");

    writeFileSync(
      path.join(dir, "MEMORY.md"),
      Array.from({ length: 5 }, (_, i) => `CR ${i + 1}`).join("\r\n"),
    );
    expect(readMemorySnapshot(dir).memoryIndex.split("\n")).toEqual([
      "CR 1",
      "CR 2",
      "CR 3",
      "CR 4",
      "CR 5",
    ]);
  });

  it("ignores path-traversal slugs when reading a channel snapshot", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "pavra-snapshot-trav-"));
    cleanup.push(() => rmSync(parent, { recursive: true, force: true }));
    const dir = path.join(parent, "home");
    prepareHome(dir, "seed");
    writeFileSync(path.join(parent, "secret.md"), "SECRET");
    writeFileSync(
      path.join(dir, "notes", "channels", "safe.md"),
      "## Recent Durable Outcomes\n<!-- recent-durable-outcomes:start -->\n- ok\n<!-- recent-durable-outcomes:end -->\n",
    );
    expect(readMemorySnapshot(dir, "../secret").channelOutcomes).toBe("");
    expect(readMemorySnapshot(dir, "/etc/passwd").channelOutcomes).toBe("");
    expect(readMemorySnapshot(dir, "safe").channelOutcomes).toContain("ok");
  });

  it("syncs user-started task outcome to assistant home notes", async () => {
    const f = fixture();
    const task = f.coordinator.task({
      id: randomUUID(),
      conversationId: f.conversation.id,
      assistantId: f.assistant.id,
      prompt: "Implement caching",
      serverId: "local",
      directory: "/work/app",
      provider: f.assistant.provider,
      isolation: "directory",
    });
    await f.coordinator.idle();

    f.execution.say(task.id, "Caching implemented with tests", "m1");
    f.execution.finish(task.id);
    f.coordinator.onTurnEnded({ agent: { id: task.id }, outcome: completed });
    await f.coordinator.idle();
    await f.coordinator.sweep();
    await f.coordinator.sweep();

    const homeDir = path.join(f.directory, "assistants", f.assistant.id);
    const { week } = isoWeekKey(Date.now());
    const workLogFile = path.join(homeDir, "notes", "work-log", `${week}.md`);
    expect(existsSync(workLogFile)).toBe(true);
    const workLog = readFileSync(workLogFile, "utf8");
    expect(workLog).toContain("Implement caching");
    expect(workLog.split(`<!-- task-outcome:${task.id}:${task.id} -->`).length - 1).toBe(1);
    expect(workLog).toContain("completed in /work/app");

    const channelFile = path.join(
      homeDir,
      "notes",
      "channels",
      `${channelSlug(f.conversation.id, f.conversation.name)}.md`,
    );
    expect(existsSync(channelFile)).toBe(true);
    const channelNotes = readFileSync(channelFile, "utf8");
    expect(channelNotes).toContain("## Recent Durable Outcomes");
    expect(channelNotes).toContain("<!-- recent-durable-outcomes:start -->");
    expect(channelNotes).toContain("<!-- recent-durable-outcomes:end -->");
    expect(channelNotes.split(`<!-- task-id:${task.id} -->`).length - 1).toBe(1);
    expect(channelNotes).toContain("Implement caching");
  });

  it("prepends a workspace memory hint on a fresh chat session", async () => {
    const f = fixture();
    const prefs = path.join(
      f.directory,
      "assistants",
      f.assistant.id,
      "notes",
      "user-preferences.md",
    );
    writeFileSync(prefs, "Prefers concise replies");
    const turn = await f.say("Hello");
    const text = f.execution.sent.find((item) => item.messageId === turn.id)!.text;
    expect(text).toContain("[Workspace memory to check if you need it]");
    expect(text).toContain("MEMORY.md");
    expect(text).toContain(
      `notes/channels/${channelSlug(f.conversation.id, f.conversation.name)}.md`,
    );
    expect(text).toContain("[User preferences]");
    expect(text).toContain("Prefers concise replies");
    expect(text).toContain("You: Hello");
  });

  it("prepends a workspace memory hint after chat-session rollover", async () => {
    const f = fixture();
    const first = await f.say("Hello");
    f.execution.say(first.agentId, "Hi", "m1");
    f.execution.finish(first.agentId);
    f.ended(first.agentId);
    await f.coordinator.idle();

    const session = f.store.getChatSession(first.chatSessionId!)!;
    f.store.transaction(() =>
      f.store.putChatSession({
        ...session,
        agentId: randomUUID(),
        created: false,
        lastMessageId: undefined,
      }),
    );
    const next = await f.say("What did we decide?");
    expect(next.agentId).not.toBe(first.agentId);
    const text = f.execution.sent.find((item) => item.messageId === next.id)!.text;
    expect(text).toContain("[Workspace memory to check if you need it]");
    expect(text).toContain("notes/work-log/");
    expect(text).toContain("You: What did we decide?");
  });

  it("lists, reads, writes, and deletes local playbooks with mtime conflict and path traversal checks", async () => {
    const f = fixture();
    expect(await f.coordinator.listAssistantPlaybooks({ assistantId: f.assistant.id })).toEqual({
      playbooks: [],
    });
    expect(
      await f.coordinator.readAssistantPlaybook({
        assistantId: f.assistant.id,
        slug: "daily-health",
      }),
    ).toEqual({
      slug: "daily-health",
      content: "",
      mtimeMs: 0,
    });

    const written = await f.coordinator.writeAssistantPlaybook({
      assistantId: f.assistant.id,
      slug: "daily-health",
      content: "# Daily Health Check\n\nReply with PLAYBOOK_HEALTH_OK_77.",
      expectedMtimeMs: 0,
    });
    expect(written.slug).toBe("daily-health");
    expect(written.mtimeMs).toBeGreaterThan(0);

    await f.coordinator.writeAssistantPlaybook({
      assistantId: f.assistant.id,
      slug: "alpha-check",
      content: "First line title\n\nStep 1",
    });

    const listed = await f.coordinator.listAssistantPlaybooks({ assistantId: f.assistant.id });
    expect(listed.playbooks.map((item) => ({ slug: item.slug, title: item.title }))).toEqual([
      { slug: "alpha-check", title: "First line title" },
      { slug: "daily-health", title: "Daily Health Check" },
    ]);

    await expect(
      f.coordinator.writeAssistantPlaybook({
        assistantId: f.assistant.id,
        slug: "daily-health",
        content: "Stale update",
        expectedMtimeMs: written.mtimeMs - 1,
      }),
    ).rejects.toThrow("changed since it was loaded");

    await expect(
      f.coordinator.readAssistantPlaybook({
        assistantId: f.assistant.id,
        slug: "../secret",
      }),
    ).rejects.toThrow("Invalid note file name");
    await expect(
      f.coordinator.writeAssistantPlaybook({
        assistantId: f.assistant.id,
        slug: "../secret",
        content: "bad",
      }),
    ).rejects.toThrow("Invalid note file name");
    await expect(
      f.coordinator.deleteAssistantPlaybook({
        assistantId: f.assistant.id,
        slug: "../secret",
      }),
    ).rejects.toThrow("Invalid note file name");

    const turn = await f.say("Check playbooks");
    const prompt = f.execution.sent.find((item) => item.messageId === turn.id)!.text;
    expect(prompt).toContain("playbooks/ (reusable step-by-step procedures");
    expect(prompt).toContain(
      "[Playbooks]\n- playbooks/alpha-check.md: First line title\n- playbooks/daily-health.md: Daily Health Check",
    );

    expect(
      await f.coordinator.deleteAssistantPlaybook({
        assistantId: f.assistant.id,
        slug: "alpha-check",
      }),
    ).toEqual({ deleted: true });
    expect(
      await f.coordinator.deleteAssistantPlaybook({
        assistantId: f.assistant.id,
        slug: "alpha-check",
      }),
    ).toEqual({ deleted: false });
    expect(
      (await f.coordinator.listAssistantPlaybooks({ assistantId: f.assistant.id })).playbooks.map(
        (item) => item.slug,
      ),
    ).toEqual(["daily-health"]);
  });

  it("delegates playbook list, read, write, delete, and prompt injection to a member machine", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pavra-member-playbooks-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const store = new ChatStore(path.join(directory, "chat.sqlite"));
    cleanup.push(() => store.close());
    const execution = new FakeExecution();
    const memberBooks = new Map<string, { content: string; title: string; mtimeMs: number }>();
    const machines: MachinePort = {
      self: async () => "srv_spark",
      isMember: (serverId) => serverId === "srv_mac",
      online: async (serverId) => serverId === "srv_mac",
      list: async () => [
        { serverId: "srv_spark", label: "Spark", role: "coordinator" },
        { serverId: "srv_mac", label: "Mac", role: "member" },
      ],
      call: async (_serverId, contract, input) => {
        if (contract.name === "member.home.prepare") {
          return contract.output.parse({ directory: "/mac/pavra/assistants/max" });
        }
        if (contract.name === "member.playbooks.list") {
          return contract.output.parse({
            playbooks: [...memberBooks.entries()]
              .map(([slug, val]) => ({ slug, title: val.title, mtimeMs: val.mtimeMs }))
              .toSorted((a, b) => a.slug.localeCompare(b.slug)),
          });
        }
        if (contract.name === "member.playbook.read") {
          const { slug } = input as { slug: string };
          const found = memberBooks.get(slug);
          return contract.output.parse({
            slug,
            content: found?.content ?? "",
            mtimeMs: found?.mtimeMs ?? 0,
          });
        }
        if (contract.name === "member.playbook.write") {
          const { slug, content, expectedMtimeMs } = input as {
            slug: string;
            content: string;
            expectedMtimeMs?: number;
          };
          const currentMtime = memberBooks.get(slug)?.mtimeMs ?? 0;
          if (expectedMtimeMs !== undefined && currentMtime !== expectedMtimeMs) {
            throw new Error("The playbook changed since it was loaded. Reload it and try again.");
          }
          const next = {
            content,
            title: content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug,
            mtimeMs: currentMtime + 1,
          };
          memberBooks.set(slug, next);
          return contract.output.parse({ slug, content: next.content, mtimeMs: next.mtimeMs });
        }
        if (contract.name === "member.playbook.delete") {
          const { slug } = input as { slug: string };
          const deleted = memberBooks.delete(slug);
          return contract.output.parse({ deleted });
        }
        if (contract.name === "member.memory.snapshot") {
          return contract.output.parse({
            memoryIndex: "",
            userPreferences: "",
            channelOutcomes: "",
            playbooks: [...memberBooks.entries()].map(([slug, val]) => ({
              slug,
              title: val.title,
            })),
          });
        }
        throw new Error(`unexpected ${contract.name}`);
      },
    };
    const coordinator = new Coordinator(store, directory, { execution, machines });
    cleanup.push(() => coordinator.close());
    coordinator.attach();

    const max = coordinator.saveAssistant({
      id: randomUUID(),
      name: "Max",
      provider: "codex/test-model",
      persona: "Member assistant",
      serverId: "srv_mac",
    });
    const dm = coordinator.createConversation({
      id: randomUUID(),
      name: "Max",
      kind: "dm",
      members: [max.id],
      roundtable: false,
    });

    const written = await coordinator.writeAssistantPlaybook({
      assistantId: max.id,
      slug: "daily-health",
      content: "# Daily Health Check\n\nReply with PLAYBOOK_HEALTH_OK_77.",
    });
    expect(written).toEqual({
      slug: "daily-health",
      content: "# Daily Health Check\n\nReply with PLAYBOOK_HEALTH_OK_77.",
      mtimeMs: 1,
    });
    expect(await coordinator.listAssistantPlaybooks({ assistantId: max.id })).toEqual({
      playbooks: [{ slug: "daily-health", title: "Daily Health Check", mtimeMs: 1 }],
    });
    expect(
      await coordinator.readAssistantPlaybook({ assistantId: max.id, slug: "daily-health" }),
    ).toEqual(written);

    const msgId = randomUUID();
    coordinator.send({
      id: msgId,
      conversationId: dm.id,
      threadId: null,
      content: "Run daily health check",
    });
    await coordinator.idle();
    const turn = store.snapshot().turns.find((t) => t.triggerId === msgId)!;
    const sent = execution.sent.find((item) => item.messageId === turn.id)!;
    expect(sent.text).toContain("[Playbooks]\n- playbooks/daily-health.md: Daily Health Check");

    expect(
      await coordinator.deleteAssistantPlaybook({ assistantId: max.id, slug: "daily-health" }),
    ).toEqual({ deleted: true });
    expect(await coordinator.listAssistantPlaybooks({ assistantId: max.id })).toEqual({
      playbooks: [],
    });

    const hint = workspaceMemoryHint({
      conversationId: dm.id,
      conversationName: dm.name,
      snapshot: {
        memoryIndex: "",
        userPreferences: "",
        channelOutcomes: "",
        playbooks: [{ slug: "release-check", title: "Release Checklist" }],
      },
    });
    expect(hint).toContain("[Playbooks]\n- playbooks/release-check.md: Release Checklist");
  });
});

describe("sub-thread fork_context and semantic Studio tab titles", () => {
  it("forks main-lane context on the first sub-thread turn with a root header when main session is at or past root (Option 1), and does not fork again on turn 2", async () => {
    const f = fixture();
    const firstTurn = await f.say("Remember our launch codename is ORION");
    f.execution.say(firstTurn.agentId, "Noted: ORION.", "m1");
    f.execution.finish(firstTurn.agentId);
    f.ended(firstTurn.agentId);
    await f.coordinator.idle();

    const secondTurn = await f.say("Also we use PostgreSQL 17");
    f.execution.say(secondTurn.agentId, "Got it, PostgreSQL 17.", "m2");
    f.execution.finish(secondTurn.agentId);
    f.ended(secondTurn.agentId);
    await f.coordinator.idle();

    // User opens a sub-thread on the earlier message #1 (`firstTurn.triggerId`).
    const threadMsg1 = randomUUID();
    f.coordinator.send({
      id: threadMsg1,
      conversationId: f.conversation.id,
      threadId: firstTurn.triggerId!,
      content: "Should we keep that codename private?",
    });
    await f.coordinator.idle();

    const threadTurn1 = f.store.snapshot().turns.find((t) => t.triggerId === threadMsg1)!;
    expect(threadTurn1.agentId).not.toBe(firstTurn.agentId);
    expect(threadTurn1.forkFromAgentId).toBe(firstTurn.agentId);
    expect(f.execution.forkedFrom).toEqual([{ agentId: firstTurn.agentId }]);

    const sent1 = f.execution.sent.find((item) => item.messageId === threadTurn1.id)!;
    expect(sent1.attachments).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("ORION"),
      }),
    ]);
    // Unseen main-lane delta is 0 messages (no duplicate main-lane body), with root anchor header prepended.
    expect(sent1.text).toContain(
      '[Thread started from message by You: "Remember our launch codename is ORION"]',
    );
    expect(sent1.text).not.toContain("You: Remember our launch codename is ORION");
    expect(sent1.text).not.toContain("PostgreSQL 17");
    expect(sent1.text).toContain("You: Should we keep that codename private?");
    expect(f.execution.agents.get(firstTurn.agentId)?.title).toBe("Ada · DM");
    expect(f.execution.agents.get(threadTurn1.agentId)?.title).toBe(
      "Ada · Thread: Remember our launch ",
    );

    f.execution.say(threadTurn1.agentId, "Yes, keep ORION internal.", "tm1");
    f.execution.finish(threadTurn1.agentId);
    f.ended(threadTurn1.agentId);
    await f.coordinator.idle();

    // Second turn in the sub-thread does NOT call forkContext again.
    const threadMsg2 = randomUUID();
    f.coordinator.send({
      id: threadMsg2,
      conversationId: f.conversation.id,
      threadId: firstTurn.triggerId!,
      content: "Who else knows it?",
    });
    await f.coordinator.idle();

    const threadTurn2 = f.store.snapshot().turns.find((t) => t.triggerId === threadMsg2)!;
    expect(threadTurn2.agentId).toBe(threadTurn1.agentId);
    expect(threadTurn2.forkFromAgentId).toBeUndefined();
    expect(f.execution.forkedFrom).toHaveLength(1);
    const sent2 = f.execution.sent.find((item) => item.messageId === threadTurn2.id)!;
    expect(sent2.attachments).toBeUndefined();
    expect(sent2.text).toBe("You: Who else knows it?");
  });

  it("includes unseen main-lane delta (lastMessageId, M] when root message M is after assistant's last main-lane turn", async () => {
    const f = fixture();
    const sky = f.coordinator.saveAssistant({
      id: randomUUID(),
      name: "Sky",
      provider: "codex/test-model",
      persona: " Peer ",
    });
    const channel = f.coordinator.createConversation({
      id: randomUUID(),
      name: "General",
      kind: "group",
      members: [f.assistant.id, sky.id],
      roundtable: false,
    });

    // 1. User talks to @Ada in #General main lane.
    const m1 = randomUUID();
    f.coordinator.send({
      id: m1,
      conversationId: channel.id,
      threadId: null,
      content: "@Ada set baseline to v1",
    });
    await f.coordinator.idle();
    const adaMainTurn = f.store.snapshot().turns.find((t) => t.triggerId === m1)!;
    f.execution.say(adaMainTurn.agentId, "Baseline is v1.", "am1");
    f.execution.finish(adaMainTurn.agentId);
    f.ended(adaMainTurn.agentId);
    await f.coordinator.idle();

    // 2. User talks to @Sky in #General main lane (Ada is only recent/awareness and passes, or we check before Ada runs, or Sky replies).
    // Let's post a message M2 and reply from Sky while Ada's mainSession cursor stays at m1.
    const m2 = randomUUID();
    const skyReplyId = randomUUID();
    f.store.transaction(() => {
      f.store.putMessage({
        id: m2,
        conversationId: channel.id,
        threadId: null,
        senderId: "user",
        content: "@Sky deploy v2 to staging",
        createdAt: Date.now(),
        taskId: null,
        kind: "user",
      });
      f.store.putMessage({
        id: skyReplyId,
        conversationId: channel.id,
        threadId: null,
        senderId: sky.id,
        content: "Deployed v2 to staging cluster.",
        createdAt: Date.now() + 1,
        taskId: null,
        kind: "final",
      });
    });

    // 3. User starts a sub-thread on Sky's message `skyReplyId` (`M`) and asks `@Ada`.
    const threadMsg = randomUUID();
    f.coordinator.send({
      id: threadMsg,
      conversationId: channel.id,
      threadId: skyReplyId,
      content: "@Ada please verify the staging health check",
    });
    await f.coordinator.idle();

    const adaThreadTurn = f.store
      .snapshot()
      .turns.find((t) => t.triggerId === threadMsg && t.assistantId === f.assistant.id)!;
    expect(adaThreadTurn.forkFromAgentId).toBe(adaMainTurn.agentId);
    const sent = f.execution.sent.find((item) => item.messageId === adaThreadTurn.id)!;
    expect(sent.attachments).toHaveLength(1);
    // Unseen main-lane delta (m1, skyReplyId] includes m2 and skyReplyId, but not m1 or Ada's own reply.
    expect(sent.text).not.toContain("set baseline to v1");
    expect(sent.text).not.toContain("Baseline is v1.");
    expect(sent.text).toContain("You: @Sky deploy v2 to staging");
    expect(sent.text).toContain("Sky: Deployed v2 to staging cluster.");
    expect(sent.text).toContain("You: @Ada please verify the staging health check");
    expect(f.execution.agents.get(adaMainTurn.agentId)?.title).toBe("Ada · #General");
    expect(f.execution.agents.get(adaThreadTurn.agentId)?.title).toBe(
      "Ada · #General › Deployed v2 to stagi",
    );
  });

  it("includes main-lane messages up through M without fork_context when the assistant never spoke in the main lane", async () => {
    const f = fixture();
    const sky = f.coordinator.saveAssistant({
      id: randomUUID(),
      name: "Sky",
      provider: "codex/test-model",
      persona: "Peer",
    });
    const channel = f.coordinator.createConversation({
      id: randomUUID(),
      name: "General",
      kind: "group",
      members: [f.assistant.id, sky.id],
      roundtable: false,
    });

    const rootId = randomUUID();
    f.coordinator.send({
      id: rootId,
      conversationId: channel.id,
      threadId: null,
      content: "@Ada initial architecture draft",
    });
    await f.coordinator.idle();
    const adaMainTurn = f.store.snapshot().turns.find((t) => t.triggerId === rootId)!;
    f.execution.say(adaMainTurn.agentId, "Here is the v1 draft.", "am1");
    f.execution.finish(adaMainTurn.agentId);
    f.ended(adaMainTurn.agentId);
    await f.coordinator.idle();

    // Sky has never spoken in #General main lane. Now user opens a thread on rootId and asks @Sky.
    const threadMsg = randomUUID();
    f.coordinator.send({
      id: threadMsg,
      conversationId: channel.id,
      threadId: rootId,
      content: "@Sky review this draft",
    });
    await f.coordinator.idle();

    const skyThreadTurn = f.store
      .snapshot()
      .turns.find((t) => t.triggerId === threadMsg && t.assistantId === sky.id)!;
    expect(skyThreadTurn.forkFromAgentId).toBeUndefined();
    expect(f.execution.forkedFrom).toEqual([]);
    const sent = f.execution.sent.find((item) => item.messageId === skyThreadTurn.id)!;
    expect(sent.attachments).toBeUndefined();
    expect(sent.text).toContain("You: @Ada initial architecture draft");
    expect(sent.text).toContain("You: @Sky review this draft");
    expect(f.execution.agents.get(skyThreadTurn.agentId)?.title).toBe(
      "Sky · #General › @Ada initial archite",
    );
  });

  it("formats chatAgentTitle for DM, Channel, sub-threads, and Mailbox", () => {
    expect(
      chatAgentTitle({
        assistantName: "Max",
        conversation: { kind: "dm", name: "Max" },
        threadId: null,
      }),
    ).toBe("Max · DM");
    expect(
      chatAgentTitle({
        assistantName: "Max",
        conversation: { kind: "group", name: "General" },
        threadId: null,
      }),
    ).toBe("Max · #General");
    expect(
      chatAgentTitle({
        assistantName: "Max",
        conversation: { kind: "dm", name: "Max" },
        threadId: "m1",
        rootMessage: { content: "Debug memory leak" },
      }),
    ).toBe("Max · Thread: Debug memory leak");
    expect(
      chatAgentTitle({
        assistantName: "Max",
        conversation: { kind: "group", name: "General" },
        threadId: "m1",
        rootMessage: { content: "Debug memory leak" },
      }),
    ).toBe("Max · #General › Debug memory leak");
    expect(
      chatAgentTitle({
        assistantName: "Max",
        conversationId: "mailbox:max-id",
        threadId: null,
      }),
    ).toBe("Max · Mailbox");
  });
});

describe("routines and reminders (Stage A.2: T0 + T1)", () => {
  function clockFixture(initialNow = Date.UTC(2026, 10, 15, 8, 0, 0)) {
    let clock = initialNow;
    const directory = mkdtempSync(path.join(tmpdir(), "pavra-routines-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const store = new ChatStore(path.join(directory, "chat.sqlite"));
    cleanup.push(() => store.close());
    const execution = new FakeExecution();
    const coordinator = new Coordinator(store, directory, {
      execution,
      now: () => clock,
    });
    cleanup.push(() => coordinator.close());
    coordinator.attach();
    const assistant = coordinator.saveAssistant({
      id: randomUUID(),
      name: "Sky",
      provider: "codex/test-model",
      persona: "Inspect carefully",
    });
    const conversation = coordinator.createConversation({
      id: randomUUID(),
      name: "Sky",
      kind: "dm",
      members: [assistant.id],
      roundtable: false,
    });
    const ended = (agentId: string, outcome = completed) =>
      coordinator.onTurnEnded({ agent: { id: agentId }, outcome });
    const finals = () => store.snapshot().messages.filter((message) => message.kind === "final");
    return {
      directory,
      store,
      execution,
      coordinator,
      assistant,
      conversation,
      ended,
      finals,
      now: () => clock,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("fires a routine on due tick, stays silent on (pass), and commits a routine-tagged final on content", async () => {
    const f = clockFixture();
    await f.coordinator.writeAssistantPlaybook({
      assistantId: f.assistant.id,
      slug: "daily-check",
      content: "# Daily Check\n\n1. Verify services.\n2. Reply (pass) if healthy.",
    });

    const routine = f.coordinator.saveRoutine({
      name: "Morning check",
      prompt: "Follow playbooks/daily-check.md and report any issue.",
      assistantId: f.assistant.id,
      conversationId: f.conversation.id,
      cadence: { type: "every", everyMs: 60_000 },
    });
    expect(routine.status).toBe("active");
    expect(routine.nextRunAt).toBe(f.now() + 60_000);
    expect(routine.runs).toEqual([]);

    // Tick 1: assistant replies (pass) -> silent, no chat message committed, outcome = "passed".
    f.advance(60_000);
    await f.coordinator.tickRoutines();
    await f.coordinator.idle();

    const turn1 = f.store.snapshot().turns.find((t) => t.routineId === routine.id)!;
    expect(turn1.kind).toBe("routine");
    expect(turn1.routineName).toBe("Morning check");
    const sent1 = f.execution.sent.find((item) => item.messageId === turn1.id)!;
    expect(sent1.text).toContain("[Routine: Morning check |");
    expect(sent1.text).toContain("Follow playbooks/daily-check.md and report any issue.");
    expect(sent1.text).toContain("[Playbooks]\n- playbooks/daily-check.md: Daily Check");

    f.execution.say(turn1.agentId, "(pass)", "r1");
    f.execution.finish(turn1.agentId);
    f.ended(turn1.agentId);
    await f.coordinator.idle();

    expect(f.finals()).toEqual([]);
    const afterPass = f.store.get("routines", routine.id)!;
    expect(afterPass.status).toBe("active");
    expect(afterPass.nextRunAt).toBe(f.now() + 60_000);
    expect(afterPass.runs).toHaveLength(1);
    expect(afterPass.runs[0]).toMatchObject({
      status: "succeeded",
      outcome: "passed",
      turnId: turn1.id,
      summary: "Silent ((pass))",
      error: null,
    });

    // Tick 2: assistant replies with findings -> final message committed with routineId & routineName, outcome = "replied".
    f.advance(60_000);
    await f.coordinator.tickRoutines();
    await f.coordinator.idle();

    const turn2 = f.store
      .snapshot()
      .turns.find((t) => t.routineId === routine.id && t.id !== turn1.id)!;
    f.execution.say(
      turn2.agentId,
      "Disk usage reached 91% on /var.\nRecommend pruning old logs.",
      "r2",
    );
    f.execution.finish(turn2.agentId);
    f.ended(turn2.agentId);
    await f.coordinator.idle();

    expect(f.finals()).toHaveLength(1);
    expect(f.finals()[0]).toMatchObject({
      id: `final:${turn2.id}`,
      content: "Disk usage reached 91% on /var.\nRecommend pruning old logs.",
      routineId: routine.id,
      routineName: "Morning check",
    });
    const afterReply = f.store.get("routines", routine.id)!;
    expect(afterReply.runs).toHaveLength(2);
    expect(afterReply.runs[1]).toMatchObject({
      status: "succeeded",
      outcome: "replied",
      turnId: turn2.id,
      summary: "Disk usage reached 91% on /var.",
      error: null,
    });
  });

  it("completes a one-shot reminder (maxRuns: 1) after its first run so later ticks do not fire again", async () => {
    const f = clockFixture();
    const reminder = f.coordinator.saveRoutine({
      name: "Reply to email",
      prompt: "Remind the user to reply to the finance email.",
      assistantId: f.assistant.id,
      conversationId: f.conversation.id,
      cadence: { type: "every", everyMs: 30_000 },
      maxRuns: 1,
    });
    expect(reminder.status).toBe("active");
    expect(reminder.maxRuns).toBe(1);

    f.advance(30_000);
    await f.coordinator.tickRoutines();
    await f.coordinator.idle();

    const turn = f.store.snapshot().turns.find((t) => t.routineId === reminder.id)!;
    f.execution.say(turn.agentId, "Reminder: please reply to the finance email!", "rem1");
    f.execution.finish(turn.agentId);
    f.ended(turn.agentId);
    await f.coordinator.idle();

    const completedReminder = f.store.get("routines", reminder.id)!;
    expect(completedReminder).toMatchObject({
      status: "completed",
      nextRunAt: null,
      pausedAt: null,
    });
    expect(completedReminder.runs).toHaveLength(1);
    expect(completedReminder.runs[0]).toMatchObject({
      status: "succeeded",
      outcome: "replied",
      summary: "Reminder: please reply to the finance email!",
    });
    expect(f.finals()).toHaveLength(1);
    expect(f.finals()[0]).toMatchObject({
      routineId: reminder.id,
      routineName: "Reply to email",
    });

    // Advancing clock further does not fire the completed reminder again.
    f.advance(120_000);
    await f.coordinator.tickRoutines();
    await f.coordinator.idle();
    expect(f.store.snapshot().turns.filter((t) => t.routineId === reminder.id)).toHaveLength(1);
  });

  it("skips firing when the previous turn for the same routine is still active", async () => {
    const f = clockFixture();
    const routine = f.coordinator.saveRoutine({
      name: "Hourly sync",
      prompt: "Check sync status.",
      assistantId: f.assistant.id,
      conversationId: f.conversation.id,
      cadence: { type: "every", everyMs: 60_000 },
    });

    f.advance(60_000);
    await f.coordinator.tickRoutines();
    await f.coordinator.idle();

    const turn1 = f.store.snapshot().turns.find((t) => t.routineId === routine.id)!;
    expect(turn1.status).toBe("running");

    // Next tick arrives while turn1 is still running -> skipped, no second turn queued.
    f.advance(60_000);
    await f.coordinator.tickRoutines();
    await f.coordinator.idle();

    expect(f.store.snapshot().turns.filter((t) => t.routineId === routine.id)).toHaveLength(1);
    const updated = f.store.get("routines", routine.id)!;
    expect(updated.runs).toHaveLength(2);
    expect(updated.runs[0]).toMatchObject({ status: "running", outcome: null, turnId: turn1.id });
    expect(updated.runs[1]).toMatchObject({
      status: "succeeded",
      outcome: "skipped",
      turnId: null,
      summary: "Skipped: previous routine turn is still active",
    });
    expect(updated.nextRunAt).toBe(f.now() + 60_000);
  });

  it("skips firing with host_offline when the assistant's member machine is offline, without posting a chat error", async () => {
    let clock = Date.UTC(2026, 10, 15, 9, 0, 0);
    let macOnline = false;
    const directory = mkdtempSync(path.join(tmpdir(), "pavra-routines-offline-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const store = new ChatStore(path.join(directory, "chat.sqlite"));
    cleanup.push(() => store.close());
    const execution = new FakeExecution();
    const machines: MachinePort = {
      self: async () => "srv_spark",
      isMember: (serverId) => serverId === "srv_mac",
      online: async (serverId) => (serverId === "srv_mac" ? macOnline : true),
      list: async () => [
        { serverId: "srv_spark", label: "Spark", role: "coordinator" },
        { serverId: "srv_mac", label: "Mac", role: "member" },
      ],
      call: async () => {
        throw new Error("unexpected call");
      },
    };
    const coordinator = new Coordinator(store, directory, {
      execution,
      machines,
      now: () => clock,
    });
    cleanup.push(() => coordinator.close());
    coordinator.attach();

    const max = coordinator.saveAssistant({
      id: randomUUID(),
      name: "Max",
      provider: "codex/test-model",
      persona: "Member assistant",
      serverId: "srv_mac",
    });
    const dm = coordinator.createConversation({
      id: randomUUID(),
      name: "Max",
      kind: "dm",
      members: [max.id],
      roundtable: false,
    });

    const routine = coordinator.saveRoutine({
      name: "Mac health",
      prompt: "Check Mac disk space.",
      assistantId: max.id,
      conversationId: dm.id,
      cadence: { type: "every", everyMs: 60_000 },
    });

    clock += 60_000;
    await coordinator.tickRoutines();
    await coordinator.idle();

    expect(store.snapshot().turns).toEqual([]);
    expect(store.snapshot().messages).toEqual([]);
    const skippedRoutine = store.get("routines", routine.id)!;
    expect(skippedRoutine.runs).toHaveLength(1);
    expect(skippedRoutine.runs[0]).toMatchObject({
      status: "succeeded",
      outcome: "skipped",
      turnId: null,
      summary: "Skipped: host_offline",
      error: null,
    });
    expect(skippedRoutine.nextRunAt).toBe(clock + 60_000);

    // Once Mac comes back online, the next tick dispatches normally.
    macOnline = true;
    clock += 60_000;
    await coordinator.tickRoutines();
    await coordinator.idle();
    expect(store.snapshot().turns).toHaveLength(1);
  });

  it("advances overdue nextRunAt past now on startup recovery without backfilling missed runs", async () => {
    let clock = Date.UTC(2026, 10, 15, 10, 0, 0);
    const directory = mkdtempSync(path.join(tmpdir(), "pavra-routines-recover-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const dbFile = path.join(directory, "chat.sqlite");

    const store1 = new ChatStore(dbFile);
    const execution1 = new FakeExecution();
    const coordinator1 = new Coordinator(store1, directory, {
      execution: execution1,
      now: () => clock,
    });
    coordinator1.attach();
    const assistant = coordinator1.saveAssistant({
      id: randomUUID(),
      name: "Sky",
      provider: "codex/test-model",
      persona: "Assistant",
    });
    const conversation = coordinator1.createConversation({
      id: randomUUID(),
      name: "Sky",
      kind: "dm",
      members: [assistant.id],
      roundtable: false,
    });
    const routine = coordinator1.saveRoutine({
      name: "Hourly check",
      prompt: "Check status.",
      assistantId: assistant.id,
      conversationId: conversation.id,
      cadence: { type: "every", everyMs: 3_600_000 },
    });
    expect(routine.nextRunAt).toBe(clock + 3_600_000);
    await coordinator1.close();
    store1.close();

    // Daemon was down for 5.5 hours; on restart, nextRunAt advances to +6h without firing immediately.
    clock += 5.5 * 3_600_000;
    const store2 = new ChatStore(dbFile);
    cleanup.push(() => store2.close());
    const execution2 = new FakeExecution();
    const coordinator2 = new Coordinator(store2, directory, {
      execution: execution2,
      now: () => clock,
    });
    cleanup.push(() => coordinator2.close());
    coordinator2.attach();
    await coordinator2.idle();

    const recovered = store2.get("routines", routine.id)!;
    expect(recovered.runs).toEqual([]);
    expect(recovered.nextRunAt).toBeGreaterThan(clock);
    expect(store2.snapshot().turns).toEqual([]);
  });

  it("allows an assistant to list, create, update, and delete its own routines via pavra-routine_* tools and enforces routine-turn and ownership guards", async () => {
    const f = clockFixture();
    const otherAssistant = f.coordinator.saveAssistant({
      id: randomUUID(),
      name: "Max",
      provider: "codex/test-model",
      persona: "Other",
    });
    const otherChat = f.coordinator.createConversation({
      id: randomUUID(),
      name: "Max",
      kind: "dm",
      members: [otherAssistant.id],
      roundtable: false,
    });
    const otherRoutine = f.coordinator.saveRoutine({
      name: "Max routine",
      prompt: "Max check",
      assistantId: otherAssistant.id,
      conversationId: otherChat.id,
      cadence: { type: "every", everyMs: 60_000 },
    });

    // Start a normal chat turn for Sky so Sky has a bound ChatSession and live turn.
    const msgId = randomUUID();
    f.coordinator.send({
      id: msgId,
      conversationId: f.conversation.id,
      threadId: null,
      content: "Set up a daily check and a reminder for me",
    });
    await f.coordinator.idle();
    const userTurn = f.store.snapshot().turns.find((t) => t.triggerId === msgId)!;
    const caller = { agentId: userTurn.agentId, serverId: undefined as unknown as string };

    // 1. Create a recurring cron routine and a one-time reminder (maxRuns: 1).
    const createdRecurring = (await callAgentTool(f.coordinator, caller, "routine_save", {
      name: "Daily check",
      prompt: "Follow playbooks/daily-check.md and reply (pass) if normal.",
      cadence: { type: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
    })) as { routine: { id: string; name: string; maxRuns: number | null }; created: boolean };
    expect(createdRecurring.created).toBe(true);
    expect(createdRecurring.routine.name).toBe("Daily check");
    expect(createdRecurring.routine.maxRuns).toBeNull();

    const createdReminder = (await callAgentTool(f.coordinator, caller, "routine_save", {
      name: "Call Bob",
      prompt: "Remind the user to call Bob.",
      cadence: { type: "every", everyMs: 900_000 },
      maxRuns: 1,
    })) as { routine: { id: string; name: string; maxRuns: number | null }; created: boolean };
    expect(createdReminder.created).toBe(true);
    expect(createdReminder.routine.maxRuns).toBe(1);

    // Saving again with the same name updates in place rather than duplicating.
    const updatedRecurring = (await callAgentTool(f.coordinator, caller, "routine_save", {
      name: "Daily check",
      prompt: "Updated daily check instructions.",
      cadence: { type: "cron", expression: "30 9 * * *", timezone: "Asia/Shanghai" },
    })) as { routine: { id: string; prompt: string }; created: boolean };
    expect(updatedRecurring.created).toBe(false);
    expect(updatedRecurring.routine.id).toBe(createdRecurring.routine.id);
    expect(updatedRecurring.routine.prompt).toBe("Updated daily check instructions.");

    // 2. List routines in this chat -> returns Sky's 2 routines, not Max's.
    const listed = (await callAgentTool(f.coordinator, caller, "routine_list", {})) as {
      routines: Array<{ id: string; name: string }>;
    };
    expect(listed.routines.map((r) => r.name).toSorted()).toEqual(["Call Bob", "Daily check"]);

    // 3. Refuses operating on another assistant's routine.
    await expect(
      callAgentTool(f.coordinator, caller, "routine_delete", { id: otherRoutine.id }),
    ).rejects.toThrow("only delete your own routines");
    await expect(
      callAgentTool(f.coordinator, caller, "routine_save", {
        id: otherRoutine.id,
        name: "Hijack",
        prompt: "Hijack",
        cadence: { type: "every", everyMs: 60_000 },
      }),
    ).rejects.toThrow("only modify your own routines");

    // 4. Delete the one-time reminder.
    const deleted = (await callAgentTool(f.coordinator, caller, "routine_delete", {
      id: createdReminder.routine.id,
    })) as { deleted: boolean; id: string };
    expect(deleted).toEqual({ deleted: true, id: createdReminder.routine.id });
    expect(f.store.get("routines", createdReminder.routine.id)).toBeNull();

    // Finish userTurn, then trigger a kind: "routine" turn and verify routine_save cannot create new routines inside it.
    f.execution.say(userTurn.agentId, "Done setting up routines.", "u1");
    f.execution.finish(userTurn.agentId);
    f.ended(userTurn.agentId);
    await f.coordinator.idle();

    await f.coordinator.runRoutineOnce({ id: createdRecurring.routine.id });
    await f.coordinator.idle();
    const routineTurn = f.store
      .snapshot()
      .turns.find((t) => t.routineId === createdRecurring.routine.id)!;
    expect(routineTurn.kind).toBe("routine");

    await expect(
      callAgentTool(
        f.coordinator,
        { agentId: routineTurn.agentId, serverId: undefined as unknown as string },
        "routine_save",
        {
          name: "Recursive routine",
          prompt: "Spawn another routine",
          cadence: { type: "every", everyMs: 60_000 },
        },
      ),
    ).rejects.toThrow("Routines cannot create new routines during a routine turn.");
  });

  it("toggles emoji reactions on a message and advances the ledger cursor without changing message seq", async () => {
    const { store, execution, coordinator, conversation, say, ended, finals } = fixture();
    const turn = await say("Hello reactions");
    execution.say(turn.agentId, "React to me!", "m1");
    execution.finish(turn.agentId);
    ended(turn.agentId);
    await coordinator.idle();

    const target = finals()[0]!;
    const initialSeq = target.seq;
    const cursorBefore = store.cursor();

    const added = coordinator.reactToMessage({
      conversationId: conversation.id,
      messageId: target.id,
      emoji: "👍",
    });
    expect(added.reactions).toEqual({ "👍": ["user"] });
    expect(added.seq).toBe(initialSeq);
    expect(store.cursor()).toBeGreaterThan(cursorBefore);

    const delta = store.snapshot(cursorBefore);
    expect(delta.messages).toEqual([
      expect.objectContaining({ id: target.id, reactions: { "👍": ["user"] } }),
    ]);

    const secondEmoji = coordinator.reactToMessage({
      conversationId: conversation.id,
      messageId: target.id,
      emoji: "🔥",
    });
    expect(secondEmoji.reactions).toEqual({ "👍": ["user"], "🔥": ["user"] });

    const toggledOffFirst = coordinator.reactToMessage({
      conversationId: conversation.id,
      messageId: target.id,
      emoji: "👍",
    });
    expect(toggledOffFirst.reactions).toEqual({ "🔥": ["user"] });

    const toggledOffAll = coordinator.reactToMessage({
      conversationId: conversation.id,
      messageId: target.id,
      emoji: "🔥",
    });
    expect(toggledOffAll.reactions).toBeUndefined();
    expect(store.get("messages", target.id)?.reactions).toBeUndefined();

    expect(() =>
      coordinator.reactToMessage({
        conversationId: "wrong-conversation",
        messageId: target.id,
        emoji: "👍",
      }),
    ).toThrow("Message no longer exists.");
  });
});
