import { afterEach, describe, expect, it } from "vitest";
import type { Turn } from "../shared/contracts";
import { callAgentTool } from "./agent-tools";
import { closeFixtures, fixture } from "./chat-fixture";
import { mailboxLaneId } from "./chat-sessions";
import { mailboxTurnId } from "./mailbox";
import { assistantPeerKey } from "./peers";

// Ported from Bigbang Core's agentMailboxRuntime.test.ts and agentMailboxWakeup.test.ts, on the
// Paseo coordinator: a request runs in the recipient's mailbox lane and its final is the reply.

afterEach(closeFixtures);

function setup(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture({ names: ["Ada", "Bob", "Cy"], ...options });
  const adaDm = f.group({ kind: "dm", name: "Ada", members: [f.ada!.id] });
  const bobDm = f.group({ kind: "dm", name: "Bob", members: [f.bob!.id] });
  const turns = () => f.store.snapshot().turns;
  const turn = (id: string) => f.store.get("turns", id)!;
  /** Ada starts replying to the user in her DM; the mailbox is used from inside that reply. */
  async function adaReplying(text = "Ask Bob for the build status") {
    await f.say(text, { conversationId: adaDm.id });
    return turns().findLast(
      (item) => item.conversationId === adaDm.id && item.status === "running",
    )!;
  }
  const tool = (agentId: string, name: string, input: unknown) =>
    callAgentTool(f.coordinator, { agentId, serverId: undefined as never }, name, input);
  async function answer(
    target: Turn,
    text: string,
    outcome: "completed" | "canceled" = "completed",
  ) {
    f.execution.say(target.agentId, text, `m-${target.id}`);
    f.execution.finish(target.agentId);
    f.coordinator.onTurnEnded({
      agent: { id: target.agentId },
      outcome:
        outcome === "completed" ? { kind: "completed" } : { kind: "canceled", reason: "stopped" },
    });
    await f.coordinator.idle();
  }
  async function kick() {
    f.coordinator.kickWork();
    await f.coordinator.idle();
  }
  // Keeps the fixture's getters, so store, coordinator and ledger follow a restart.
  const helpers = Object.assign(f, { adaDm, bobDm, turns, turn, adaReplying, tool, answer, kick });
  return Object.defineProperty(helpers, "ledger", {
    get: () => f.coordinator.mailbox.ledger,
  }) as typeof helpers & { readonly ledger: typeof f.coordinator.mailbox.ledger };
}

describe("mailbox in Chat", () => {
  it("runs a request in the recipient's private lane and wakes the asker with its answer", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "@Bob", text: "Is main green?" })) as {
      mailboxId: string;
      status: string;
    };
    expect(sent.status).toBe("delivered");
    await f.coordinator.idle();
    const bob = f.turn(mailboxTurnId(sent.mailboxId));
    expect(bob).toMatchObject({
      conversationId: mailboxLaneId(f.bob!.id),
      assistantId: f.bob!.id,
      status: "running",
      mailboxId: sent.mailboxId,
    });
    expect(f.sentTo(bob)).toContain("Is main green?");
    expect(f.ledger.get(sent.mailboxId)?.status).toBe("acked");

    await f.answer(bob, "Yes, main is green.");
    // Nothing from the mailbox lane reaches a chat.
    expect(f.finals()).toEqual([]);
    const reply = f.ledger
      .listByRoot(ada.rootTriggerId ?? ada.triggerId!)
      .find((row) => row.kind === "reply");
    expect(reply).toMatchObject({ outcome: "ok", payloadText: "Yes, main is green." });

    // Ada is still replying, so the answer waits for her lane to go idle.
    expect(f.turns().filter((item) => item.mailboxWakeupIds)).toEqual([]);
    await f.answer(ada, "I asked Bob; I'll tell you when he answers.");
    const wakeup = f.turns().find((item) => item.mailboxWakeupIds)!;
    expect(wakeup).toMatchObject({ conversationId: f.adaDm.id, assistantId: f.ada!.id });
    expect(f.sentTo(wakeup)).toContain("[System: Mailbox replies] 1 internal reply");
    expect(f.sentTo(wakeup)).toContain("Yes, main is green.");
    await f.answer(wakeup, "Bob says main is green.");
    expect(f.finals().map((message) => message.content)).toEqual([
      "I asked Bob; I'll tell you when he answers.",
      "Bob says main is green.",
    ]);
  });

  it("deduplicates a repeated send and keeps one delivery", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    const first = (await f.tool(ada.agentId, "send", { to: "Bob", text: "ping" })) as {
      mailboxId: string;
      created: boolean;
    };
    const second = (await f.tool(ada.agentId, "send", { to: "Bob", text: "ping" })) as {
      mailboxId: string;
      created: boolean;
    };
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ mailboxId: first.mailboxId, created: false });
    expect(f.turns().filter((item) => item.mailboxId)).toHaveLength(1);
  });

  it("allows one new peer per user message", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    await f.tool(ada.agentId, "send", { to: "Bob", text: "first" });
    await expect(f.tool(ada.agentId, "send", { to: "Cy", text: "second" })).rejects.toThrow(
      "root already contacted 1 new peer",
    );
  });

  it("rejects an unknown recipient and sending from a mailbox lane", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    await expect(f.tool(ada.agentId, "send", { to: "Nobody", text: "hi" })).rejects.toThrow(
      "No assistant named Nobody",
    );
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "help" })) as {
      mailboxId: string;
    };
    await f.coordinator.idle();
    const bob = f.turn(mailboxTurnId(sent.mailboxId));
    await expect(f.tool(bob.agentId, "send", { to: "Cy", text: "can you?" })).rejects.toThrow(
      "answering a mailbox request",
    );
  });

  it("waits while the recipient is busy, then times out with a failed reply", async () => {
    const f = setup();
    await f.say("Bob, think hard", { conversationId: f.bobDm.id });
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "quick one" })) as {
      mailboxId: string;
    };
    await f.coordinator.idle();
    expect(f.turn(mailboxTurnId(sent.mailboxId)).status).toBe("queued");
    expect(f.ledger.get(sent.mailboxId)?.firstDeferredAt).toBe(f.clock.t);

    f.clock.t += 11 * 60 * 1000;
    await f.kick();
    expect(f.turn(mailboxTurnId(sent.mailboxId))).toMatchObject({
      status: "failed",
      error: "admission_timeout",
    });
    expect(f.ledger.get(sent.mailboxId)).toMatchObject({
      status: "failed",
      failureReason: "admission_timeout",
    });
    const reply = f.ledger.listForPeer({ peerKey: assistantPeerKey(f.ada!.id), limit: 5 })[0];
    expect(reply).toMatchObject({ kind: "reply", outcome: "failed" });
  });

  it("admits the request once the recipient's other reply ends", async () => {
    const f = setup();
    await f.say("Bob, think hard", { conversationId: f.bobDm.id });
    const bobChat = f.running()!;
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "quick one" })) as {
      mailboxId: string;
    };
    await f.coordinator.idle();
    expect(f.turn(mailboxTurnId(sent.mailboxId)).status).toBe("queued");
    await f.answer(bobChat, "Done thinking.");
    expect(f.turn(mailboxTurnId(sent.mailboxId)).status).toBe("running");
  });

  it("answers silence and failure with a synthetic failed reply", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "anything?" })) as {
      mailboxId: string;
    };
    await f.coordinator.idle();
    await f.answer(f.turn(mailboxTurnId(sent.mailboxId)), "(pass)");
    expect(f.ledger.get(sent.mailboxId)).toMatchObject({
      status: "failed",
      failureReason: "no_reply",
    });
    const replies = f.ledger
      .listByRoot(sent.mailboxId ? f.ledger.get(sent.mailboxId)!.originRootId : "")
      .filter((row) => row.kind === "reply");
    expect(replies).toMatchObject([
      { outcome: "failed", payloadText: "Recipient finished without replying." },
    ]);
  });

  it("sends info without a reply and never wakes the sender", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", {
      to: "Bob",
      text: "FYI: deploy at 5",
      kind: "info",
    })) as { mailboxId: string };
    await f.coordinator.idle();
    await f.answer(f.turn(mailboxTurnId(sent.mailboxId)), "(pass)");
    await f.answer(ada, "Told Bob.");
    expect(f.ledger.get(sent.mailboxId)?.status).toBe("acked");
    expect(f.turns().filter((item) => item.mailboxWakeupIds)).toEqual([]);
  });

  it("uses an explicit reply instead of the final answer", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "status?" })) as {
      mailboxId: string;
    };
    await f.coordinator.idle();
    const bob = f.turn(mailboxTurnId(sent.mailboxId));
    await f.tool(bob.agentId, "reply", { mailboxId: sent.mailboxId, text: "Green." });
    await f.answer(bob, "I replied with the tool.");
    const replies = f.ledger
      .listByRoot(f.ledger.get(sent.mailboxId)!.originRootId)
      .filter((row) => row.kind === "reply");
    expect(replies.map((row) => row.payloadText)).toEqual(["Green."]);
  });

  it("fences the root when the asking reply is stopped, cancelling the request in progress", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "long job" })) as {
      mailboxId: string;
    };
    await f.coordinator.idle();
    const bob = f.turn(mailboxTurnId(sent.mailboxId));
    await f.answer(ada, "", "canceled");
    expect(f.ledger.isRootFenced(f.ledger.get(sent.mailboxId)!.originRootId)).toBe(true);
    expect(f.execution.cancelled).toContain(bob.agentId);
    // A late answer from Bob is not delivered to Ada.
    await f.answer(bob, "Done anyway.");
    expect(f.turns().filter((item) => item.mailboxWakeupIds)).toEqual([]);
  });

  it("lets the sender withdraw a request that has not started", async () => {
    const f = setup();
    await f.say("Bob, think hard", { conversationId: f.bobDm.id });
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "later" })) as {
      mailboxId: string;
    };
    await expect(
      f.tool(ada.agentId, "cancel_request", { mailboxId: sent.mailboxId }),
    ).resolves.toEqual({ mailboxId: sent.mailboxId, status: "cancelled" });
    expect(f.turn(mailboxTurnId(sent.mailboxId)).status).toBe("cancelled");
  });

  it("lists the caller's own records with peers named", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    await f.tool(ada.agentId, "send", { to: "Bob", text: "status?" });
    const records = (await f.tool(ada.agentId, "records", {})) as {
      records: Array<{ from: string; to: string; kind: string }>;
    };
    expect(records.records).toMatchObject([{ from: "Ada", to: "Bob", kind: "request" }]);
    const peers = (await f.tool(ada.agentId, "peers", {})) as { peers: Array<{ name: string }> };
    expect(peers.peers.map((peer) => peer.name)).toEqual(["Bob", "Cy"]);
  });
});

describe("mailbox wakeups", () => {
  function seedReplies(f: ReturnType<typeof setup>, count: number) {
    for (let index = 0; index < count; index++) {
      const request = f.ledger.createOutgoing({
        senderKey: assistantPeerKey(f.ada!.id),
        recipientKey: assistantPeerKey(f.bob!.id),
        kind: "request",
        originConversationId: f.adaDm.id,
        originThreadId: null,
        originRootId: `root-${index}`,
        payloadText: `question ${index}`,
        idempotencyKey: `key-${index}`,
      });
      f.ledger.createReply({
        replyToMailboxId: request.record.mailboxId,
        replierKey: assistantPeerKey(f.bob!.id),
        outcome: "ok",
        payloadText: `answer ${index}`,
      });
    }
  }

  it("delivers six replies to an idle lane as five, then one", async () => {
    const f = setup();
    seedReplies(f, 6);
    await f.kick();
    const first = f.turns().filter((item) => item.mailboxWakeupIds);
    expect(first).toHaveLength(1);
    expect(first[0]!.mailboxWakeupIds).toHaveLength(5);
    expect(f.sentTo(first[0]!)).toContain("5 internal replies");
    await f.answer(first[0]!, "Five answers in.");
    const all = f.turns().filter((item) => item.mailboxWakeupIds);
    expect(all.map((item) => item.mailboxWakeupIds!.length).toSorted()).toEqual([1, 5]);
    expect(f.ledger.listPendingWakeups()).toEqual([]);
  });

  it("keeps replies pending while the lane has a queued or running turn", async () => {
    const f = setup();
    await f.say("Hi Ada", { conversationId: f.adaDm.id });
    seedReplies(f, 1);
    await f.kick();
    expect(f.turns().filter((item) => item.mailboxWakeupIds)).toEqual([]);
    expect(f.ledger.listPendingWakeups()).toHaveLength(1);
  });

  it("does not deliver a fenced root's reply", async () => {
    const f = setup();
    seedReplies(f, 1);
    f.ledger.fenceRoot("root-0");
    await f.kick();
    expect(f.turns().filter((item) => item.mailboxWakeupIds)).toEqual([]);
  });

  it("delivers a reply once across a restart", async () => {
    const f = setup();
    seedReplies(f, 1);
    await f.kick();
    await f.restart();
    await f.kick();
    expect(f.turns().filter((item) => item.mailboxWakeupIds)).toHaveLength(1);
    expect(f.ledger.listPendingWakeups()).toEqual([]);
  });

  it("answers a request whose mailbox turn ended before the last process recorded it", async () => {
    const f = setup();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, "send", { to: "Bob", text: "status?" })) as {
      mailboxId: string;
    };
    await f.coordinator.idle();
    // The turn settled as failed, but the process stopped before the synthetic reply.
    const bob = f.turn(mailboxTurnId(sent.mailboxId));
    f.store.transaction(() => f.store.put("turns", { ...bob, status: "failed", error: "boom" }));
    await f.restart();
    expect(f.coordinator.mailbox.ledger.hasReply(sent.mailboxId)).toBe(true);
  });
});
