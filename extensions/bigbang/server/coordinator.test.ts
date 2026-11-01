import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatStore } from "./store";
import { Coordinator, type TurnEndedEvent } from "./coordinator";
import { FakeExecution } from "./execution.fake";
import { assistantInstructions } from "./chat-sessions";
import { BIGBANG_TOOLS_NOTE } from "./tools-note";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});
const completed: TurnEndedEvent["outcome"] = { kind: "completed" };

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "bigbang-coordinator-"));
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

  it("tells the agent the bigbang tools are MCP tools it may have to search for", () => {
    const { assistant } = fixture();
    expect(assistantInstructions(assistant)).toContain(BIGBANG_TOOLS_NOTE);
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
});
