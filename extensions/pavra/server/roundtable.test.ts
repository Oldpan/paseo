import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeFixtures, fixture } from "./chat-fixture";
import {
  ROUNDTABLE_MAX_VISIBLE_MESSAGES,
  resolveRoundtableResponderIds,
  roundtableStartMembers,
  rotateRoundtableOrder,
} from "./roundtable";

afterEach(closeFixtures);

type Fixture = ReturnType<typeof fixture>;
/** A roundtable's visible replies in the order they were posted. */
const spoken = (f: Fixture, root: string) =>
  f.store
    .snapshot()
    .messages.filter((message) => message.threadId === root && message.kind === "final")
    .toSorted((a, b) => a.seq! - b.seq!)
    .map((message) => f.nameOf(message.senderId));
const system = (f: Fixture, root: string) =>
  f.store
    .snapshot()
    .messages.filter((message) => message.threadId === root && message.kind === "system");
const roundtableTurns = (f: Fixture, root: string) =>
  f.store.snapshot().turns.filter((turn) => turn.threadId === root);
const start = (f: Fixture, content = "@Ada @Bob @Cy discuss the plan") =>
  f.say(content, { responseMode: "roundtable" });
/** Everyone contributes, never mentioning anyone. */
const chat = (turn: { id: string }, name: string) => `${name} on ${turn.id.slice(-4)}`;

describe("starting a roundtable", () => {
  it("opens an epoch in the thread rooted at the message and queues the first speaker", async () => {
    const f = fixture();
    const root = await start(f);
    const turns = roundtableTurns(f, root);
    expect(turns).toEqual([
      expect.objectContaining({
        kind: "roundtable",
        assistantId: f.ada.id,
        round: 0,
        threadId: root,
        triggerId: root,
      }),
    ]);
    // Only the thread has turns; the root conversation lane is untouched.
    expect(f.store.snapshot().turns.filter((turn) => turn.threadId === null)).toEqual([]);
    expect(f.store.latestEpoch(f.conversation.id, root)).toMatchObject({
      status: "running",
      generation: 0,
      members: [f.ada.id, f.bob.id, f.cy.id],
    });
  });

  it.each([
    ["@all", "@all let's discuss", "@all is not supported"],
    ["fewer than two members", "@Ada alone", "at least 2"],
    ["no members", "let's discuss", "at least 2"],
  ])("rejects %s with a clear error and writes nothing", async (_name, content, error) => {
    const f = fixture();
    expect(() =>
      f.coordinator.send({
        id: randomUUID(),
        conversationId: f.conversation.id,
        threadId: null,
        content,
        responseMode: "roundtable",
      }),
    ).toThrow(error);
    expect(f.store.snapshot().messages).toEqual([]);
    expect(f.store.snapshot().turns).toEqual([]);
  });

  it("rejects a private chat and a message inside an ordinary thread", async () => {
    const f = fixture();
    const dm = f.coordinator.createConversation({
      id: randomUUID(),
      name: "Ada",
      kind: "dm",
      members: [f.ada.id],
      roundtable: false,
    });
    const send = (conversationId: string, threadId: string | null, content: string) =>
      f.coordinator.send({
        id: randomUUID(),
        conversationId,
        threadId,
        content,
        responseMode: "roundtable",
      });
    expect(() => send(dm.id, null, "@Ada @Bob hi")).toThrow("needs a group chat");
    const root = await f.say("hello team");
    expect(() => send(f.conversation.id, root, "@Ada @Bob hi")).toThrow("not inside a thread");
  });

  it("caps a roundtable at six members", () => {
    const members = ["Ada", "Bob", "Cy", "Dee", "Eve", "Fay", "Gus"].map((name) => ({
      id: name,
      name,
      provider: "p/m",
      persona: "",
    }));
    const conversation = {
      id: "c",
      name: "c",
      kind: "group" as const,
      members: [],
      roundtable: false,
    };
    const content = members.map((member) => `@${member.name}`).join(" ");
    expect(() =>
      roundtableStartMembers({ conversation, threadId: null, content, members }),
    ).toThrow("at most 6");
    expect(
      roundtableStartMembers({ conversation, threadId: null, content: "@Ada @Gus", members }),
    ).toHaveLength(2);
  });

  it("starts nothing from the conversation's roundtable toggle alone", async () => {
    const f = fixture();
    const room = f.group({ roundtable: true });
    const id = await f.say("@Ada @Bob discuss", { conversationId: room.id });
    // Two ordinary replies in the chat, not an ordered discussion in a thread.
    expect(f.kinds(id)).toEqual(["reply:Ada", "reply:Bob"]);
    expect(f.store.runningEpochs()).toEqual([]);
  });
});

describe("speaking order", () => {
  it("rotates the order each round and stops after three rounds", async () => {
    const f = fixture();
    const root = await start(f);
    await f.run(chat);

    // Rounds of Ada-Bob-Cy, Bob-Cy-Ada and Cy-Ada-Bob.
    expect(spoken(f, root)).toEqual(["Ada", "Bob", "Cy", "Bob", "Cy", "Ada", "Cy", "Ada", "Bob"]);
    const turns = roundtableTurns(f, root);
    expect(turns).toHaveLength(9);
    expect(turns.every((turn) => turn.kind === "roundtable" && turn.status === "completed")).toBe(
      true,
    );
    expect(new Set(turns.map((turn) => turn.round))).toEqual(new Set([0, 1, 2]));
    // Each member keeps one execution across rounds, and each turn commits exactly one final.
    for (const member of [f.ada, f.bob, f.cy])
      expect(
        new Set(turns.filter((turn) => turn.assistantId === member.id).map((turn) => turn.agentId))
          .size,
      ).toBe(1);
    expect(turns.map((turn) => turn.finalMessageId)).toEqual(
      turns.map((turn) => `final:${turn.id}`),
    );

    const [ended] = system(f, root);
    expect(system(f, root)).toHaveLength(1);
    expect(ended).toMatchObject({
      kind: "system",
      senderId: "system",
      event: { type: "roundtable_ended", detail: "max_rounds" },
    });
    expect(ended.content).toContain("3 rounds");
    expect(f.store.latestEpoch(f.conversation.id, root)).toMatchObject({
      status: "ended",
      reason: "max_rounds",
    });
  });

  it("keeps the roundtable's replies stamped with their epoch and round", async () => {
    const f = fixture();
    const root = await start(f);
    await f.run(chat);
    const epoch = f.store.latestEpoch(f.conversation.id, root)!;
    const finals = f.store
      .snapshot()
      .messages.filter((message) => message.threadId === root && message.kind === "final");
    expect(finals.every((message) => message.epochId === epoch.id)).toBe(true);
    expect(finals.map((message) => message.round)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  });

  it("lets mentions in the latest message choose the next round's speakers", async () => {
    const f = fixture();
    const root = await start(f);
    const opening: Record<string, string> = {
      Ada: "@Cy what do you think?",
      Bob: "Fine by me",
      Cy: "I agree",
    };
    await f.run((turn, name) => (turn.round === 0 ? opening[name] : "(pass)"));
    // Round two is Cy alone; when Cy passes the whole round was silent and the epoch ends.
    expect(f.store.latestEpoch(f.conversation.id, root)).toMatchObject({
      status: "ended",
      reason: "all_passed",
      round: 1,
    });
    expect(spoken(f, root)).toEqual(["Ada", "Bob", "Cy"]);
    expect(roundtableTurns(f, root).filter((turn) => turn.round === 1)).toHaveLength(1);
    // Roundtable replies never wake anyone by mention or peer inbox.
    expect(f.store.snapshot().turns.filter((turn) => turn.kind === "mention")).toEqual([]);
    expect(f.store.inboxItems()).toEqual([]);
  });

  it("ends when a whole round passes", async () => {
    const f = fixture();
    const root = await start(f);
    await f.run((turn, name) =>
      turn.round === 0 && name === "Ada" ? "Opening thoughts" : "(pass)",
    );
    // Round two: everyone passes.
    expect(spoken(f, root)).toEqual(["Ada"]);
    expect(f.store.latestEpoch(f.conversation.id, root)).toMatchObject({
      status: "ended",
      reason: "all_passed",
    });
    const [ended] = system(f, root);
    expect(ended.content).toContain("everyone passed");
    expect(roundtableTurns(f, root)).toHaveLength(6);
    expect(roundtableTurns(f, root).filter((turn) => turn.finalMessageId)).toHaveLength(1);
  });

  it("ends at ten visible messages", async () => {
    const f = fixture({ names: ["Ada", "Bob", "Cy", "Dee", "Eve", "Fay"] });
    const room = f.group();
    const root = await f.say("@Ada @Bob @Cy @Dee @Eve @Fay everyone weigh in", {
      conversationId: room.id,
      responseMode: "roundtable",
    });
    await f.run(chat);
    expect(spoken(f, root)).toHaveLength(ROUNDTABLE_MAX_VISIBLE_MESSAGES);
    expect(f.store.latestEpoch(room.id, root)).toMatchObject({
      status: "ended",
      reason: "max_messages",
      round: 1,
    });
    expect(system(f, root)[0].event).toEqual({ type: "roundtable_ended", detail: "max_messages" });
    expect(roundtableTurns(f, root)).toHaveLength(ROUNDTABLE_MAX_VISIBLE_MESSAGES);
  });

  it("counts a failed turn as a pass and moves on", async () => {
    const f = fixture();
    f.execution.rejectNextDispatch = Object.assign(new Error("bad provider"), { code: "bad" });
    const root = await start(f);
    await f.run(chat);
    expect(spoken(f, root).slice(0, 2)).toEqual(["Bob", "Cy"]);
    expect(roundtableTurns(f, root).find((turn) => turn.status === "failed")?.assistantId).toBe(
      f.ada.id,
    );
  });
});

describe("what a speaker is told", () => {
  it("lists the members, the round, the pass option and the shared messages", async () => {
    const f = fixture();
    const root = await start(f);
    await f.run(chat);
    const adaFirst = roundtableTurns(f, root).find(
      (turn) => turn.assistantId === f.ada.id && turn.round === 0,
    )!;
    const bobFirst = roundtableTurns(f, root).find(
      (turn) => turn.assistantId === f.bob.id && turn.round === 0,
    )!;
    const adaSecond = roundtableTurns(f, root).find(
      (turn) => turn.assistantId === f.ada.id && turn.round === 1,
    )!;

    const open = f.sentTo(adaFirst);
    expect(open).toContain("roundtable discussion with @Ada, @Bob, @Cy");
    expect(open).toContain("round 1 of 3");
    expect(open).toContain("reply exactly (pass)");
    expect(open).toContain("Do not invite anyone outside these members");
    expect(open).toContain("You: @Ada @Bob @Cy discuss the plan");

    // Bob joins after Ada: he reads the opening and her contribution.
    const bob = f.sentTo(bobFirst);
    expect(bob).toContain("round 1 of 3");
    expect(bob).toContain("You: @Ada @Bob @Cy discuss the plan");
    expect(bob).toContain("Ada: Ada on ");

    // Ada's second turn only adds what her execution has not seen: not her own words nor the opening.
    const later = f.sentTo(adaSecond);
    expect(later).toContain("round 2 of 3");
    expect(later).not.toContain("discuss the plan");
    expect(later).toContain("Bob: Bob on ");
    expect(later).toContain("Cy: Cy on ");
  });
});

describe("a new user message in the thread", () => {
  it("cancels the in-flight turn and starts a new epoch with the mentioned speakers", async () => {
    const f = fixture();
    const root = await start(f);
    const first = f.running()!;
    f.execution.say(first.agentId, "Half a thought", "m1");

    const follow = await f.say("@Bob change of plan", { threadId: root });
    expect(f.store.latestEpoch(f.conversation.id, root)).toMatchObject({
      generation: 1,
      status: "running",
      triggerId: follow,
    });
    // The old turn's execution is stopped; it stays the lane's owner until it reports back.
    expect(f.execution.cancelled).toEqual([first.agentId]);
    expect(f.store.get("turns", first.id)?.status).toBe("running");
    const next = roundtableTurns(f, root).find((turn) => turn.triggerId === follow)!;
    expect(next).toMatchObject({ status: "queued", assistantId: f.bob.id, kind: "roundtable" });

    f.execution.finish(first.agentId);
    f.coordinator.onTurnEnded({
      agent: { id: first.agentId },
      outcome: { kind: "canceled", reason: "stopped" },
    });
    await f.coordinator.idle();
    expect(f.store.get("turns", first.id)).toMatchObject({
      status: "cancelled",
      error: "Superseded by a newer message.",
    });
    expect(f.store.get("turns", next.id)?.status).toBe("running");
    expect(f.sentTo(next)).toContain("You: @Bob change of plan");

    await f.run(chat);
    // Bob alone speaks in the new epoch; the cancelled Ada turn posted nothing.
    expect(spoken(f, root).filter((name) => name !== "Bob")).toEqual([]);
    expect(spoken(f, root)).not.toHaveLength(0);
    expect(f.store.latestEpoch(f.conversation.id, root)).toMatchObject({
      generation: 1,
      status: "ended",
    });
    // The superseded epoch leaves no closing line of its own.
    expect(system(f, root)).toHaveLength(1);
  });

  it("speaks with every member when the message names nobody", async () => {
    const f = fixture();
    const root = await start(f);
    await f.run({ Ada: "@Cy only you", Bob: "(pass)", Cy: "(pass)" });
    expect(f.store.latestEpoch(f.conversation.id, root)?.status).toBe("ended");

    const follow = await f.say("thanks, what is left?", { threadId: root });
    const turn = roundtableTurns(f, root).find((item) => item.triggerId === follow)!;
    expect(turn.assistantId).toBe(f.ada.id);
    await f.run({ Ada: "Ada", Bob: "Bob", Cy: "Cy" });
    expect(
      roundtableTurns(f, root)
        .filter((item) => item.triggerId === follow && item.round === 0)
        .map((item) => f.nameOf(item.assistantId))
        .toSorted(),
    ).toEqual(["Ada", "Bob", "Cy"]);
  });

  it("drops a queued turn of an epoch that was replaced before it ever started", async () => {
    const f = fixture();
    const root = await start(f);
    const first = f.running()!;
    const second = await f.say("@Bob first correction", { threadId: root });
    const third = await f.say("@Cy second correction", { threadId: root });

    const turns = roundtableTurns(f, root);
    expect(turns.find((turn) => turn.triggerId === second)).toMatchObject({
      status: "cancelled",
      error: "Superseded by a newer message.",
    });
    expect(turns.find((turn) => turn.triggerId === third)).toMatchObject({
      status: "queued",
      assistantId: f.cy.id,
    });
    expect(f.store.latestEpoch(f.conversation.id, root)).toMatchObject({
      generation: 2,
      triggerId: third,
    });
    expect(f.execution.cancelled.every((agentId) => agentId === first.agentId)).toBe(true);
  });

  it("does not run the superseded epoch's next speaker", async () => {
    const f = fixture();
    const root = await start(f);
    const first = f.running()!;
    await f.say("@Cy only you", { threadId: root });
    f.execution.say(first.agentId, "Late answer", "m1");
    f.execution.finish(first.agentId);
    f.coordinator.onTurnEnded({ agent: { id: first.agentId }, outcome: { kind: "completed" } });
    await f.coordinator.idle();
    // Ada finished after being superseded: her answer is dropped and Bob's turn never starts.
    expect(f.finals()).toEqual([]);
    expect(roundtableTurns(f, root).filter((turn) => turn.assistantId === f.bob.id)).toEqual([]);
    expect(f.running()?.assistantId).toBe(f.cy.id);
  });
});

describe("restarting", () => {
  it("settles the turn that finished while the process was down and carries on", async () => {
    const f = fixture();
    const root = await start(f);
    const first = f.running()!;
    f.execution.say(first.agentId, "Ada's view", "m1");
    f.execution.finish(first.agentId);

    const { store, coordinator } = await f.restart();
    await coordinator.idle();
    expect(spoken(f, root)).toEqual(["Ada"]);
    expect(store.get("turns", first.id)?.status).toBe("completed");
    expect(store.latestEpoch(f.conversation.id, root)).toMatchObject({ round: 0, next: 2 });
    const bob = store
      .snapshot()
      .turns.find((turn) => turn.threadId === root && turn.assistantId === f.bob.id)!;
    expect(bob).toMatchObject({ accepted: true, status: "running" });

    // Sweeping again neither repeats a speaker nor skips one.
    await coordinator.sweep();
    await coordinator.sweep();
    expect(roundtableTurns(f, root).filter((turn) => turn.round === 0)).toHaveLength(2);
  });

  it("picks the epoch up between turns when only the ledger survived", async () => {
    const f = fixture();
    const root = await start(f);
    const first = f.running()!;
    f.execution.say(first.agentId, "Ada's view", "m1");
    f.execution.finish(first.agentId);
    f.coordinator.onTurnEnded({ agent: { id: first.agentId }, outcome: { kind: "completed" } });
    await f.coordinator.idle();
    // Bob is running now. Let the daemon finish him too while we are away.
    const bob = f.running()!;
    f.execution.say(bob.agentId, "Bob's view", "m2");
    f.execution.finish(bob.agentId);
    const { store, coordinator } = await f.restart();
    await coordinator.idle();
    expect(spoken(f, root)).toEqual(["Ada", "Bob"]);
    expect(store.snapshot().turns.find((turn) => turn.status === "running")?.assistantId).toBe(
      f.cy.id,
    );
  });
});

describe("roundtable rules", () => {
  it("rotates a member list by round", () => {
    expect(rotateRoundtableOrder(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
    expect(rotateRoundtableOrder(["a", "b", "c"], 1)).toEqual(["b", "c", "a"]);
    expect(rotateRoundtableOrder(["a", "b", "c"], 4)).toEqual(["b", "c", "a"]);
    expect(rotateRoundtableOrder([], 2)).toEqual([]);
  });

  const members = [
    { id: "a", name: "Ada" },
    { id: "b", name: "Bob" },
    { id: "c", name: "Cy" },
  ];
  it("resolves the next speakers from the mentions since the latest user message", () => {
    const user = (content: string) => ({ senderId: "user", content });
    const agent = (senderId: string, content: string) => ({ senderId, content });
    expect(resolveRoundtableResponderIds([user("hello all")], members)).toEqual(["a", "b", "c"]);
    expect(resolveRoundtableResponderIds([user("@Bob and @Cy")], members)).toEqual(["b", "c"]);
    expect(
      resolveRoundtableResponderIds([user("@Bob and @Cy"), agent("b", "over to @Cy")], members),
    ).toEqual(["c"]);
    expect(resolveRoundtableResponderIds([user("@Bob"), agent("b", "ok")], members)).toEqual(["b"]);
    expect(resolveRoundtableResponderIds([user("@all go"), agent("a", "@Bob")], members)).toEqual([
      "a",
      "b",
      "c",
    ]);
    // An older user message no longer counts once a newer one arrives.
    expect(resolveRoundtableResponderIds([user("@Bob"), user("anyone?")], members)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(resolveRoundtableResponderIds([user("@Stranger")], members)).toEqual(["a", "b", "c"]);
  });
});
