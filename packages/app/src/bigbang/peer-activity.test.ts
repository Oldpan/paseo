import { describe, expect, it } from "vitest";
import type { PeerMessage, Studio } from "../../../../extensions/bigbang/shared/contracts";
import { openExchanges, studioForGroup, studioRecords } from "./peer-activity";

const ada = { key: "assistant:a", kind: "assistant", name: "Ada", machine: "Mac" };
const sa = { key: "assistant:s", kind: "assistant", name: "Sa", machine: "Spark" };
const grok = {
  key: "agent:srv:g",
  kind: "agent",
  name: "grok",
  machine: "Spark",
  address: "Spark/Lab/grok",
};
const codex = {
  key: "agent:srv:c",
  kind: "agent",
  name: "codex",
  machine: "Mac",
  address: "Mac/App/codex",
};

function row(overrides: Partial<PeerMessage> & Pick<PeerMessage, "id">): PeerMessage {
  return {
    ledger: "mailbox",
    kind: "request",
    studioId: null,
    sender: ada,
    recipient: sa,
    text: "What is the hostname?",
    replyTo: null,
    status: "acked",
    conversationId: "dm",
    threadId: null,
    createdAt: 1,
    ...overrides,
  };
}

describe("openExchanges", () => {
  it("shows requests from this lane until their answer reaches the asking assistant", () => {
    const working = row({ id: "1" });
    const answered = row({ id: "2", status: "acked" });
    const answer = row({
      id: "3",
      kind: "reply",
      replyTo: "2",
      sender: sa,
      recipient: ada,
      text: "aitopatom",
      status: "queued",
    });
    const done = row({ id: "4" });
    const doneReply = row({ id: "5", kind: "reply", replyTo: "4", status: "delivered" });
    const otherLane = row({ id: "6", conversationId: "other" });
    const failed = row({ id: "7", status: "failed" });
    expect(
      openExchanges([working, answered, answer, done, doneReply, otherLane, failed], "dm", null),
    ).toEqual([
      { id: "1", route: "Ada → Sa · Spark", state: "Working on it", text: "What is the hostname?" },
      { id: "2", route: "Ada → Sa · Spark", state: "Answered", text: "aitopatom" },
    ]);
  });

  it("describes a Studio agent recipient and a failed answer", () => {
    const toAgent = row({ id: "1", recipient: grok });
    const asked = row({ id: "2" });
    const failure = row({
      id: "3",
      kind: "reply",
      replyTo: "2",
      status: "queued",
      detail: "failed",
      text: "Recipient finished without replying.",
    });
    expect(openExchanges([toAgent, asked, failure], "dm", null).map((item) => item.state)).toEqual([
      "Delivered",
      "Could not help; telling the assistant",
    ]);
  });
});

describe("studioRecords", () => {
  const studio: Studio = { id: "s1", name: "Lab", status: "active", workspaces: [], createdAt: 0 };
  it("nests replies under the message they answer, oldest first", () => {
    const message = row({
      id: "m1",
      ledger: "studio",
      kind: "message",
      studioId: "s1",
      sender: codex,
      recipient: grok,
      status: "accepted",
      code: "delivered",
      createdAt: 1,
    });
    const notice = row({
      id: "n1",
      ledger: "studio",
      kind: "notice",
      studioId: "s1",
      sender: null,
      recipient: codex,
      status: "accepted",
      createdAt: 0,
    });
    const reply = row({
      id: "r1",
      ledger: "studio",
      kind: "reply",
      studioId: "s1",
      sender: grok,
      recipient: codex,
      replyTo: "m1",
      status: "unknown",
      code: "delivery_outcome_unknown",
      createdAt: 2,
    });
    const elsewhere = row({
      id: "x",
      ledger: "studio",
      kind: "message",
      studioId: "s2",
      createdAt: 3,
    });
    expect(
      studioRecords([reply, message, notice, elsewhere], studio).map((item) => [
        item.id,
        item.depth,
        item.route,
        item.status,
        item.detail,
      ]),
    ).toEqual([
      ["n1", 0, "Studio → codex · Mac", "accepted", ""],
      ["m1", 0, "codex · Mac → grok · Spark", "accepted", "delivered"],
      ["r1", 1, "grok · Spark → codex · Mac", "unknown", "delivery_outcome_unknown"],
    ]);
  });

  it("finds the active Studio for a tab group", () => {
    const archived: Studio = { ...studio, id: "old", status: "archived" };
    expect(studioForGroup([archived, studio], "Lab")?.id).toBe("s1");
    expect(studioForGroup([archived], "Lab")).toBeUndefined();
  });
});
