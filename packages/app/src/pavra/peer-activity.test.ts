import { describe, expect, it } from "vitest";
import type {
  Message,
  PeerMessage,
  Studio,
  Takeover,
  Task,
  Turn,
} from "../../../../extensions/pavra/shared/contracts";
import {
  buildTurnLineage,
  formatProvenanceLabel,
  openExchanges,
  studioForGroup,
  studioRecords,
} from "./peer-activity";

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

const cy = { key: "assistant:cy", kind: "assistant", name: "Cy", machine: "Spark" };

function makeTurn(overrides: Partial<Turn> & Pick<Turn, "id">): Turn {
  return {
    conversationId: "dm",
    threadId: null,
    assistantId: "a",
    prompt: "Help the user",
    status: "completed",
    agentId: "agent-a",
    error: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> & Pick<Message, "id">): Message {
  return {
    conversationId: "dm",
    threadId: null,
    senderId: "a",
    content: "Here is the answer.",
    createdAt: 100,
    taskId: null,
    kind: "final",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    conversationId: "dm",
    assistantId: "a",
    prompt: "Fix the flaky test in packages/server",
    title: "Fix flaky test",
    serverId: "spark",
    directory: "/repo",
    provider: "anthropic/claude-sonnet-4-5",
    isolation: "worktree",
    status: "running",
    execution: { serverId: "spark", workspaceId: "ws-1", agentId: "task-agent-1" },
    accepted: true,
    error: null,
    createdAt: 50,
    deadline: 1000,
    origin: "assistant",
    ...overrides,
  };
}

function makeTakeover(overrides: Partial<Takeover> & Pick<Takeover, "id">): Takeover {
  return {
    kind: "browser",
    status: "pending",
    assistantId: "a",
    conversationId: "dm",
    threadId: null,
    turnId: null,
    serverId: "spark",
    reason: "Complete 2FA login",
    url: "https://www.github.com/login/two-factor",
    title: "GitHub Two-Factor Authentication",
    screenshotDataUrl: null,
    createdAt: 60,
    updatedAt: 60,
    ...overrides,
  };
}

describe("buildTurnLineage", () => {
  it("aggregates peer consultations, spawned tasks, browser takeovers, and provenance summary", () => {
    const userMsg = makeMessage({
      id: "u1",
      senderId: "user",
      kind: "user",
      content: "Check Spark status and fix the test",
      createdAt: 10,
    });
    const finalMsg = makeMessage({
      id: "final:t1",
      turnId: "t1",
      createdAt: 100,
    });
    const turn = makeTurn({
      id: "t1",
      triggerId: "u1",
      rootTriggerId: "u1",
      finalMessageId: "final:t1",
    });

    const askCy = row({
      id: "req-cy",
      sender: ada,
      recipient: cy,
      text: "Is Spark healthy?",
      status: "acked",
      createdAt: 20,
    });
    const replyCy = row({
      id: "rep-cy",
      kind: "reply",
      replyTo: "req-cy",
      sender: cy,
      recipient: ada,
      text: "Spark is healthy and load is 0.4.",
      status: "delivered",
      detail: "ok",
      createdAt: 40,
    });
    const pendingSa = row({
      id: "req-sa",
      sender: ada,
      recipient: sa,
      text: "Can you verify GPU memory?",
      status: "delivered",
      createdAt: 45,
    });
    const cancelledReq = row({
      id: "req-cancel",
      sender: ada,
      recipient: grok,
      text: "Old question",
      status: "cancelled",
      createdAt: 55,
    });
    const shareInfo = row({
      id: "info-cy",
      kind: "info",
      sender: ada,
      recipient: cy,
      text: "Deployment started",
      status: "acked",
      createdAt: 60,
    });

    const spawnedTask = makeTask({
      id: "task-1",
      requestedByTurnId: "t1",
      createdAt: 50,
    });
    const userTask = makeTask({
      id: "task-user",
      origin: "user",
      createdAt: 52,
    });
    const takeover = makeTakeover({
      id: "takeover-1",
      turnId: "t1",
      createdAt: 70,
    });

    const lineage = buildTurnLineage({
      turn,
      message: finalMsg,
      messages: [userMsg, finalMsg],
      turns: [turn],
      peerMessages: [askCy, replyCy, pendingSa, cancelledReq, shareInfo],
      tasks: [spawnedTask, userTask],
      takeovers: [takeover],
    });

    expect(lineage.hasLineage).toBe(true);
    expect(lineage.consultations.map((c) => [c.id, c.kind, c.status, c.peerName])).toEqual([
      ["req-cy", "ask", "replied", "Cy"],
      ["req-sa", "ask", "pending", "Sa"],
      ["req-cancel", "ask", "cancelled", "grok"],
      ["info-cy", "share", "replied", "Cy"],
    ]);
    expect(lineage.consultations[0]).toMatchObject({
      id: "req-cy",
      route: "Ada → Cy · Spark",
      question: "Is Spark healthy?",
      answer: "Spark is healthy and load is 0.4.",
      outcome: "ok",
    });

    expect(lineage.tasks).toHaveLength(1);
    expect(lineage.tasks[0]).toMatchObject({
      id: "task-1",
      title: "Fix flaky test",
      status: "running",
    });

    expect(lineage.takeovers).toHaveLength(1);
    expect(lineage.takeovers[0]).toMatchObject({
      id: "takeover-1",
      status: "pending",
      domain: "github.com",
      displayLabel: "GitHub Two-Factor Authentication",
    });

    expect(lineage.provenance).toEqual({
      consultedPeers: [
        { id: "cy", name: "Cy" },
        { id: "s", name: "Sa" },
        { id: "agent:srv:g", name: "grok" },
      ],
      taskCount: 1,
      takeoverCount: 1,
    });
  });

  it("links wakeup turns to the earlier mailbox request and rootTrigger chain", () => {
    const userMsg = makeMessage({
      id: "u1",
      senderId: "user",
      kind: "user",
      content: "Ask Cy for the deploy key",
      createdAt: 100,
    });
    const initialTurn = makeTurn({
      id: "t-ask",
      triggerId: "u1",
      rootTriggerId: "u1",
    });
    const askCy = row({
      id: "mb-1",
      sender: ada,
      recipient: cy,
      text: "What is the deploy key fingerprint?",
      status: "acked",
      createdAt: 120,
    });
    const replyCy = row({
      id: "mb-2",
      kind: "reply",
      replyTo: "mb-1",
      sender: cy,
      recipient: ada,
      text: "SHA256:xyz123",
      status: "delivered",
      createdAt: 150,
    });
    const wakeupTurn = makeTurn({
      id: "wakeup:w1",
      triggerId: "mb-1",
      rootTriggerId: "u1",
      mailboxWakeupIds: ["w1"],
      finalMessageId: "final:wakeup:w1",
      prompt: "[Reply 1 · from Cy · outcome ok · correlation c1 · request mb-1]\nSHA256:xyz123",
    });
    const finalMsg = makeMessage({
      id: "final:wakeup:w1",
      turnId: "wakeup:w1",
      content: "Cy confirmed the fingerprint is SHA256:xyz123.",
      createdAt: 180,
    });
    const taskFromInitialTurn = makeTask({
      id: "task-initial",
      requestedByTurnId: "t-ask",
      createdAt: 130,
    });

    const lineage = buildTurnLineage({
      message: finalMsg,
      turns: [initialTurn, wakeupTurn],
      messages: [userMsg, finalMsg],
      peerMessages: [askCy, replyCy],
      tasks: [taskFromInitialTurn],
    });

    expect(lineage.turnId).toBe("wakeup:w1");
    expect(lineage.consultations).toHaveLength(1);
    expect(lineage.consultations[0]).toMatchObject({
      id: "mb-1",
      status: "replied",
      question: "What is the deploy key fingerprint?",
      answer: "SHA256:xyz123",
    });
    expect(lineage.tasks.map((t) => t.id)).toEqual(["task-initial"]);
    expect(formatProvenanceLabel(lineage.provenance)).toBe("Consulted @Cy · 1 task");
  });

  it("isolates lineage between consecutive turns in the same conversation", () => {
    const u1 = makeMessage({ id: "u1", senderId: "user", kind: "user", createdAt: 10 });
    const a1 = makeMessage({ id: "a1", turnId: "t1", createdAt: 50 });
    const u2 = makeMessage({ id: "u2", senderId: "user", kind: "user", createdAt: 100 });
    const a2 = makeMessage({ id: "a2", turnId: "t2", createdAt: 150 });

    const t1 = makeTurn({ id: "t1", triggerId: "u1", rootTriggerId: "u1", finalMessageId: "a1" });
    const t2 = makeTurn({ id: "t2", triggerId: "u2", rootTriggerId: "u2", finalMessageId: "a2" });

    const reqInT1 = row({ id: "req-1", sender: ada, recipient: cy, createdAt: 25 });
    const taskInT1 = makeTask({ id: "task-1", requestedByTurnId: "t1", createdAt: 30 });
    const takeoverInT1 = makeTakeover({ id: "tk-1", turnId: "t1", createdAt: 35 });

    const lineage1 = buildTurnLineage({
      turn: t1,
      messages: [u1, a1, u2, a2],
      turns: [t1, t2],
      peerMessages: [reqInT1],
      tasks: [taskInT1],
      takeovers: [takeoverInT1],
    });
    expect(lineage1.hasLineage).toBe(true);
    expect(lineage1.consultedPeers).toEqual([{ id: "cy", name: "Cy" }]);
    expect(lineage1.taskCount).toBe(1);
    expect(lineage1.takeoverCount).toBe(1);

    const lineage2 = buildTurnLineage({
      turn: t2,
      messages: [u1, a1, u2, a2],
      turns: [t1, t2],
      peerMessages: [reqInT1],
      tasks: [taskInT1],
      takeovers: [takeoverInT1],
    });
    expect(lineage2.hasLineage).toBe(false);
    expect(lineage2.consultedPeers).toEqual([]);
    expect(lineage2.taskCount).toBe(0);
    expect(lineage2.takeoverCount).toBe(0);
  });
});

describe("formatProvenanceLabel", () => {
  it("formats consulted peers, tasks, and takeovers concisely", () => {
    expect(
      formatProvenanceLabel({
        consultedPeers: [{ id: "cy", name: "Cy" }],
        taskCount: 1,
        takeoverCount: 0,
      }),
    ).toBe("Consulted @Cy · 1 task");

    expect(
      formatProvenanceLabel({
        consultedPeers: [
          { id: "cy", name: "Cy" },
          { id: "sa", name: "@Sa" },
        ],
        taskCount: 2,
        takeoverCount: 1,
      }),
    ).toBe("Consulted @Cy, @Sa · 2 tasks · 1 takeover");

    expect(
      formatProvenanceLabel({
        consultedPeers: [
          { id: "1", name: "A" },
          { id: "2", name: "B" },
          { id: "3", name: "C" },
          { id: "4", name: "D" },
        ],
        taskCount: 0,
        takeoverCount: 0,
      }),
    ).toBe("Consulted @A, @B, @C +1");

    expect(
      formatProvenanceLabel({
        consultedPeers: [],
        taskCount: 0,
        takeoverCount: 0,
      }),
    ).toBe("");
  });
});
