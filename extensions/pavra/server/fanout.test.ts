import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Message } from "../shared/contracts";
import { HOUR, closeFixtures, fixture } from "./chat-fixture";
import { previewRoute } from "../shared/routing-preview";
import {
  AGENT_TURN_BUDGET,
  MENTION_COOLDOWN_MS,
  PEER_INBOX_WINDOW_MS,
  RECENT_MAX,
  recentParticipants,
} from "./fanout";

afterEach(async () => {
  vi.useRealTimers();
  await closeFixtures();
});

describe("routing a user message", () => {
  it("wakes the first member when nobody is recent and nobody is named", async () => {
    const { say, kinds } = fixture();
    expect(kinds(await say("hello"))).toEqual(["reply:Ada"]);
  });

  it("wakes the default responder instead of the first member", async () => {
    const { say, kinds, group, cy } = fixture();
    const room = group({ defaultResponderId: cy.id });
    expect(kinds(await say("hello", { conversationId: room.id }))).toEqual(["reply:Cy"]);
  });

  it("gives named assistants reply turns and recent ones awareness turns, once each", async () => {
    const { say, run, kinds, turnsOf, running } = fixture();
    await say("@Ada @Bob introduce yourselves");
    await run({ Ada: "Hello from Ada", Bob: "Hello from Bob" });

    const id = await say("@Bob and @Bob again, plus @Cy");
    expect(kinds(id)).toEqual(["awareness:Ada", "reply:Bob", "reply:Cy"]);
    expect(running()?.kind).toBe("reply");
    expect(turnsOf(id).every((turn) => turn.rootTriggerId === id)).toBe(true);
  });

  it("asks every recent participant to reply when a plain message follows replies", async () => {
    const { say, run, kinds } = fixture();
    await say("@Ada @Cy hi");
    await run({ Ada: "Ada here", Cy: "Cy here" });
    // Nobody was named, so the message is to the recent participants: each gets a reply turn.
    expect(kinds(await say("what next?"))).toEqual(["reply:Ada", "reply:Cy"]);
  });

  it("forgets recent participants after an hour", async () => {
    const { say, run, kinds, clock, group, cy } = fixture();
    const room = group({ defaultResponderId: cy.id });
    await say("@Ada hi", { conversationId: room.id });
    await run({ Ada: "Hi" });
    expect(kinds(await say("again", { conversationId: room.id }))).toEqual(["reply:Ada"]);
    await run();
    clock.t += HOUR + 1;
    expect(kinds(await say("much later", { conversationId: room.id }))).toEqual(["reply:Cy"]);
  });

  it("routes a quote to the quoted assistant plus recent participants", async () => {
    const { say, run, kinds, finals, nameOf } = fixture();
    await say("@Ada @Cy hi");
    await run({ Ada: "Ada here", Cy: "Cy here" });
    const quoted = finals().find((message) => nameOf(message.senderId) === "Cy")!;
    const id = await say("what do you mean?", { quoteOf: quoted.id });
    expect(kinds(id)).toEqual(["awareness:Ada", "reply:Cy"]);
  });

  it("persists the quote and refuses a quote from another chat", async () => {
    const { say, run, store, finals, group, coordinator } = fixture();
    await say("@Ada hi");
    await run({ Ada: "Hi" });
    const quoted = finals()[0];
    const id = await say("follow up", { quoteOf: quoted.id });
    expect(store.get("messages", id)?.quoteOf).toBe(quoted.id);
    const other = group();
    expect(() =>
      coordinator.send({
        id: randomUUID(),
        conversationId: other.id,
        threadId: null,
        content: "x",
        quoteOf: quoted.id,
      }),
    ).toThrow("quoted message");
  });

  it("expands @all to every member", async () => {
    const { say, kinds } = fixture();
    expect(kinds(await say("@all status please"))).toEqual(["reply:Ada", "reply:Bob", "reply:Cy"]);
  });

  it("keeps a private chat to its one assistant", async () => {
    const { say, kinds, coordinator, ada } = fixture();
    const dm = coordinator.createConversation({
      id: randomUUID(),
      name: "Ada",
      kind: "dm",
      members: [ada.id],
      roundtable: false,
    });
    expect(kinds(await say("hello", { conversationId: dm.id }))).toEqual(["reply:Ada"]);
  });

  it("matches the composer's preview of the same message", async () => {
    const { say, run, kinds, assistants, nameOf, conversation, store } = fixture();
    await say("@Ada hi");
    await run({ Ada: "Hi" });
    const content = "@Cy thoughts?";
    const preview = previewRoute({
      members: assistants,
      content,
      recentParticipantIds: recentParticipants(
        store.snapshot().messages,
        conversation,
        null,
        Date.now(),
      ),
    });
    expect(preview).toMatchObject({ reason: "mention" });
    const id = await say(content);
    expect(kinds(id)).toEqual(
      [
        ...preview!.directIds.map((assistant) => `reply:${nameOf(assistant)}`),
        ...preview!.recentOnlyIds.map((assistant) => `awareness:${nameOf(assistant)}`),
      ].toSorted(),
    );
  });
});

describe("recent participants", () => {
  const conversation: Conversation = {
    id: "c",
    name: "c",
    kind: "group",
    members: Array.from({ length: 25 }, (_, index) => `a${index}`),
    roundtable: false,
  };
  const final = (senderId: string, createdAt: number, extra: Partial<Message> = {}): Message => ({
    id: `${senderId}-${createdAt}`,
    conversationId: "c",
    threadId: null,
    senderId,
    content: "x",
    createdAt,
    taskId: null,
    kind: "final",
    ...extra,
  });
  it("lists current members with a visible final in the lane within the hour, newest first, max 20", () => {
    const now = 10 * HOUR;
    const messages = [
      ...conversation.members.map((id, index) => final(id, now - 1000 + index)),
      final("departed", now - 10),
      final("a0", now - 2 * HOUR, { id: "old" }),
      final("a1", now - 5, { threadId: "elsewhere", id: "thread" }),
      final("a2", now - 5, { kind: "system", id: "system" }),
      final("a3", now - 5, { taskId: "task", id: "task-result" }),
    ];
    const recent = recentParticipants(messages, conversation, null, now);
    expect(recent).toHaveLength(RECENT_MAX);
    expect(recent[0]).toBe("a24");
    expect(recent).not.toContain("departed");
    expect(recent).not.toContain("a1-elsewhere");
    expect(recentParticipants(messages, conversation, "elsewhere", now)).toEqual(["a1"]);
  });
});

describe("what a woken assistant is told", () => {
  it("names the group, how to mention, and why it was woken", async () => {
    const { say, sentTo, turnsOf } = fixture();
    const id = await say("@Ada hello");
    const prompt = sentTo(turnsOf(id)[0]);
    expect(prompt).toContain("@Ada (you), @Bob, @Cy");
    expect(prompt).toContain("Mention a member with @Name");
    expect(prompt).toContain("The user addressed you");
    expect(prompt).toContain("You: @Ada hello");
  });

  it("tells a recent-only assistant it was not addressed and may pass", async () => {
    const { say, run, sentTo, turnsOf } = fixture();
    await say("@Ada hi");
    await run({ Ada: "Hi" });
    const id = await say("@Cy anyone?");
    // The named assistant runs first; the awareness turn is sent after it.
    await run({ Cy: "Here" });
    const prompt = sentTo(turnsOf(id).find((turn) => turn.kind === "awareness")!);
    expect(prompt).toContain("not addressed directly");
    expect(prompt).toContain("Reply exactly (pass)");
  });

  it("commits nothing when a recent-only assistant passes", async () => {
    const { say, run, finals } = fixture();
    await say("@Ada hi");
    await run({ Ada: "Hi" });
    await say("@Cy anyone?");
    await run({ Ada: "(pass)", Cy: "Here" });
    expect(finals().map((message) => message.content)).toEqual(["Hi", "Here"]);
  });

  it("sends each assistant only the messages its execution has not seen", async () => {
    const { say, run, sentTo, turnsOf } = fixture();
    await say("@Ada @Bob hi");
    await run({ Ada: "Ada says hello", Bob: "Bob says hello" });
    const id = await say("@Ada and then?");
    const prompt = sentTo(turnsOf(id).find((turn) => turn.kind === "reply")!);
    // Ada's own reply is in her native session; Bob's reply and the new question are not.
    expect(prompt).not.toContain("Ada says hello");
    expect(prompt).not.toContain("You: @Ada @Bob hi");
    expect(prompt).toContain("Bob: Bob says hello");
    expect(prompt).toContain("You: @Ada and then?");
  });
});

describe("assistants waking each other", () => {
  it("wakes a mentioned member that the user did not wake", async () => {
    const { say, run, turnsOf, store, sentTo, ada, kinds } = fixture();
    const id = await say("@Ada take a look");
    await run({ Ada: "Needs input from @Cy on this." });
    const final = store.snapshot().messages.find((message) => message.kind === "final")!;
    const woken = turnsOf(final.id);
    expect(kinds(final.id)).toEqual(["mention:Cy"]);
    expect(woken[0]).toMatchObject({ wokenBy: ada.id, rootTriggerId: id });
    expect(sentTo(woken[0])).toContain("@Ada mentioned you");
    expect(sentTo(woken[0])).toContain("Ada: Needs input from @Cy on this.");
  });

  it("does not let assistants woken by the same message wake each other from their replies", async () => {
    const { say, run, store, kinds, nameOf } = fixture();
    const id = await say("@Ada @Bob compare notes");
    await run({ Ada: "I agree with @Bob", Bob: "Thanks @Ada, @Cy any thoughts?" });
    // Ada and Bob were woken together by the user, so neither wakes the other; Cy was not.
    expect(kinds(id)).toEqual(["reply:Ada", "reply:Bob"]);
    const mentions = store.snapshot().turns.filter((turn) => turn.kind === "mention");
    expect(mentions.map((turn) => nameOf(turn.assistantId))).toEqual(["Cy"]);
  });

  it("applies the same suppression to recent participants woken for awareness", async () => {
    const { say, run, store } = fixture();
    await say("@Bob hi");
    await run({ Bob: "Hi" });
    await say("@Ada what do you think?");
    await run({ Ada: "Ask @Bob.", Bob: "(pass)" });
    expect(store.snapshot().turns.filter((turn) => turn.kind === "mention")).toEqual([]);
  });

  it("limits a direction to one wake-up per minute", async () => {
    const { say, run, clock, store, nameOf } = fixture();
    const mentionTurns = () =>
      store
        .snapshot()
        .turns.filter((turn) => turn.kind === "mention")
        .map((turn) => nameOf(turn.assistantId));
    // Cy passes, so it stays a non-participant and only the cooldown can hold its wake-ups back.
    await say("@Ada start");
    await run({ Ada: "@Cy please help" });
    expect(mentionTurns()).toEqual(["Cy"]);

    clock.t += MENTION_COOLDOWN_MS - 1;
    await say("@Ada again");
    await run({ Ada: "@Cy once more" });
    expect(mentionTurns()).toEqual(["Cy"]);

    clock.t += 1;
    await say("@Ada one more time");
    await run({ Ada: "@Cy once more" });
    expect(mentionTurns()).toEqual(["Cy", "Cy"]);
  });

  it("keeps the two directions between a pair apart", async () => {
    const { say, run, store, nameOf } = fixture();
    await say("@Ada start");
    await run({ Ada: "@Cy please help", Cy: "Done, back to you @Ada" });
    // Ada -> Cy was just used, yet Cy -> Ada is its own direction and wakes Ada again.
    expect(
      store
        .snapshot()
        .turns.filter((turn) => turn.kind === "mention")
        .map((turn) => nameOf(turn.assistantId))
        .toSorted(),
    ).toEqual(["Ada", "Cy"]);
  });

  it("wakes a member once per batch even when two assistants mention it", async () => {
    const { say, run, store, nameOf } = fixture();
    await say("@Ada @Bob do your parts");
    await run({ Ada: "Over to @Cy", Bob: "Handing to @Cy as well" });
    expect(
      store
        .snapshot()
        .turns.filter((turn) => turn.kind === "mention")
        .map((turn) => nameOf(turn.assistantId)),
    ).toEqual(["Cy"]);
  });

  it("ignores @all in an assistant's reply", async () => {
    const { say, run, store } = fixture();
    await say("@Ada hello");
    await run({ Ada: "@all this concerns everyone" });
    expect(store.snapshot().turns.filter((turn) => turn.kind === "mention")).toEqual([]);
  });

  it("stops after eight agent-triggered turns per user message", async () => {
    const { say, run, clock, store, nameOf } = fixture();
    const id = await say("@Ada start a debate");
    // Every hop is a minute apart, so only the budget (not the cooldown) ends the chain.
    await run((turn, name) => {
      clock.t += MENTION_COOLDOWN_MS + 1;
      return `Your turn @${name === "Ada" ? "Bob" : "Ada"}, turn ${turn.id.slice(0, 4)}`;
    });
    const chained = store.snapshot().turns.filter((turn) => turn.kind === "mention");
    expect(chained).toHaveLength(AGENT_TURN_BUDGET);
    expect(chained.every((turn) => turn.rootTriggerId === id)).toBe(true);
    expect(new Set(chained.map((turn) => nameOf(turn.assistantId)))).toEqual(
      new Set(["Ada", "Bob"]),
    );
    // A new user message starts a fresh budget.
    await say("@Ada keep going");
    expect(store.snapshot().turns.filter((turn) => turn.status === "running")).toHaveLength(1);
  });

  it("drops queued turns when a newer user message arrives", async () => {
    const { say, store, kinds } = fixture();
    const first = await say("@Ada @Bob @Cy all of you");
    expect(kinds(first)).toEqual(["reply:Ada", "reply:Bob", "reply:Cy"]);
    await say("@Cy only you now");
    const turns = store.snapshot().turns.filter((turn) => turn.triggerId === first);
    expect(turns.map((turn) => turn.status).toSorted()).toEqual([
      "cancelled",
      "cancelled",
      "running",
    ]);
    expect(turns.find((turn) => turn.status === "cancelled")?.error).toBe(
      "Superseded by a newer message.",
    );
  });
});

describe("the peer inbox", () => {
  /** Everyone replies to the opening message without mentioning anyone. */
  async function chatter(f: ReturnType<typeof fixture>) {
    await f.say("@Ada @Bob @Cy introduce yourselves");
    await f.run({ Ada: "Ada here", Bob: "Bob here", Cy: "Cy here" });
  }
  const pendingFor = (f: ReturnType<typeof fixture>, name: string) =>
    f.store
      .inboxItems()
      .filter((item) => item.assistantId === f.assistants.find((a) => a.name === name)!.id);

  it("batches replies that name nobody for the other recent participants", async () => {
    const f = fixture();
    await chatter(f);
    // Bob's reply reached Ada, Cy's reached Ada and Bob; each assistant never gets its own.
    expect(pendingFor(f, "Ada")).toHaveLength(2);
    expect(pendingFor(f, "Bob")).toHaveLength(1);
    expect(pendingFor(f, "Cy")).toHaveLength(0);
  });

  it("flushes one peer_inbox turn per recipient after a minute, listing the batched messages", async () => {
    const f = fixture();
    await chatter(f);
    f.clock.t += PEER_INBOX_WINDOW_MS - 1;
    await f.coordinator.sweep();
    expect(f.store.snapshot().turns.filter((turn) => turn.kind === "peer_inbox")).toEqual([]);

    f.clock.t += 1;
    await f.coordinator.sweep();
    const turns = f.store.snapshot().turns.filter((turn) => turn.kind === "peer_inbox");
    expect(turns.map((turn) => f.nameOf(turn.assistantId)).toSorted()).toEqual(["Ada", "Bob"]);
    expect(f.store.inboxItems()).toEqual([]);

    const ada = turns.find((turn) => f.nameOf(turn.assistantId) === "Ada")!;
    expect(ada.inboxMessageIds).toHaveLength(2);
    // Whoever is not running yet is dispatched once the lane frees up.
    await f.run();
    const prompt = f.sentTo(ada);
    expect(prompt).toContain("Bob: Bob here");
    expect(prompt).toContain("Cy: Cy here");
    expect(prompt).toContain("2 messages");
    expect(prompt).toContain("reply exactly (pass)");
  });

  it("flushes as soon as five messages are waiting", async () => {
    const f = fixture({ names: ["Ada", "Bob", "Cy", "Dee", "Eve", "Fay"] });
    await f.say("@Ada @Bob @Cy @Dee @Eve @Fay all of you, introduce yourselves");
    await f.run((turn, name) => (turn.kind === "peer_inbox" ? "(pass)" : `${name} here`));
    // Five peers answered after Ada did, so her fifth waiting message flushed her batch at once.
    const batches = f.store.snapshot().turns.filter((turn) => turn.kind === "peer_inbox");
    expect(batches.map((turn) => f.nameOf(turn.assistantId))).toEqual(["Ada"]);
    expect(batches[0].inboxMessageIds).toHaveLength(5);
    expect(pendingFor(f, "Ada")).toEqual([]);
    expect(f.clock.t).toBe(1_800_000_000_000);
  });

  it("arms a single timer for the earliest deadline and fires it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const f = fixture();
    await chatter(f);
    expect(vi.getTimerCount()).toBe(1);
    f.clock.t += PEER_INBOX_WINDOW_MS;
    await vi.advanceTimersByTimeAsync(PEER_INBOX_WINDOW_MS);
    await f.coordinator.idle();
    expect(f.store.snapshot().turns.filter((turn) => turn.kind === "peer_inbox")).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps waiting batches across a restart and flushes them on recovery", async () => {
    const f = fixture();
    await chatter(f);
    const before = f.store.inboxItems();
    expect(before).toHaveLength(3);
    const early = await f.restart();
    // Not due yet: recovery keeps the batch and re-arms its timer.
    expect(early.store.inboxItems()).toEqual(before);
    expect(early.store.snapshot().turns.filter((turn) => turn.kind === "peer_inbox")).toEqual([]);

    // The deadline passes while the process is down; the next one flushes it on recovery.
    f.clock.t += PEER_INBOX_WINDOW_MS;
    const late = await f.restart();
    await late.coordinator.idle();
    expect(late.store.snapshot().turns.filter((turn) => turn.kind === "peer_inbox")).toHaveLength(
      2,
    );
    expect(late.store.inboxItems()).toEqual([]);
  });

  it("drops waiting messages a newer user message replaced", async () => {
    const f = fixture();
    await chatter(f);
    await f.say("@Ada new topic");
    expect(f.store.inboxItems()).toEqual([]);
  });

  it("drops a batch the recipient already read", async () => {
    const f = fixture();
    await chatter(f);
    await f.say("@Ada anything to add?");
    await f.run({ Ada: "(pass)" });
    f.clock.t += PEER_INBOX_WINDOW_MS;
    await f.coordinator.sweep();
    expect(f.store.snapshot().turns.filter((turn) => turn.kind === "peer_inbox")).toEqual([]);
  });

  it("never wakes anyone for a message without mentions that only its sender has seen", async () => {
    const f = fixture();
    await f.say("@Ada hi");
    await f.run({ Ada: "Hello" });
    expect(f.store.inboxItems()).toEqual([]);
  });
});
