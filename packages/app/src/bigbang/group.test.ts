import { describe, expect, it } from "vitest";
import type { Conversation, Message, Turn } from "../../../../extensions/bigbang/shared/contracts";
import {
  applyMention,
  canQuote,
  mentionSuggestions,
  noteLabel,
  quotePreview,
  recentParticipantIds,
  responderHint,
  roundtableEligibility,
  roundtableProgress,
  roundtableTitle,
} from "./group";

const NOW = 10_000_000;
const MINUTE = 60_000;
const ada = { id: "ada", name: "Ada" };
const grace = { id: "grace", name: "Grace" };
const ken = { id: "ken", name: "Ken Thompson" };
const members = [ada, grace, ken];
const group: Conversation = {
  id: "chat",
  name: "Team",
  kind: "group",
  members: members.map((member) => member.id),
  roundtable: false,
};
const dm: Conversation = { ...group, kind: "dm", members: ["ada"] };

let seq = 0;
function message(overrides: Partial<Message> & Pick<Message, "senderId">): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    conversationId: "chat",
    threadId: null,
    content: "hello",
    createdAt: NOW - MINUTE,
    taskId: null,
    kind: overrides.senderId === "user" ? "user" : "final",
    seq,
    ...overrides,
  };
}
function turn(overrides: Partial<Turn>): Turn {
  seq += 1;
  return {
    id: `t${seq}`,
    conversationId: "chat",
    threadId: null,
    assistantId: "ada",
    prompt: "",
    status: "completed",
    agentId: "agent",
    error: null,
    ...overrides,
  };
}
function hint(overrides: Partial<Parameters<typeof responderHint>[0]> = {}) {
  return responderHint({
    conversation: group,
    members,
    messages: [],
    threadId: null,
    draft: "",
    inRoundtable: false,
    roundtableOn: false,
    now: NOW,
    ...overrides,
  });
}

describe("recent participants", () => {
  it("lists assistants with a visible final in the lane in the last hour, newest first", () => {
    const messages = [
      message({ senderId: "ada", createdAt: NOW - 30 * MINUTE }),
      message({ senderId: "grace", createdAt: NOW - 20 * MINUTE }),
      message({ senderId: "ada", createdAt: NOW - 10 * MINUTE }),
      message({ senderId: "ken", createdAt: NOW - 61 * MINUTE }),
    ];
    expect(recentParticipantIds(messages, group, null, NOW)).toEqual(["ada", "grace"]);
  });

  it("ignores other lanes, task results, notes, users and former members", () => {
    const messages = [
      message({ senderId: "ada", threadId: "root" }),
      message({ senderId: "grace", taskId: "task" }),
      message({ senderId: "ken", kind: "task_event" }),
      message({ senderId: "ken", kind: "system" }),
      message({ senderId: "user" }),
      message({ senderId: "gone" }),
      message({ senderId: "ada", conversationId: "elsewhere" }),
    ];
    expect(recentParticipantIds(messages, group, null, NOW)).toEqual([]);
    expect(recentParticipantIds(messages, group, "root", NOW)).toEqual(["ada"]);
  });

  it("treats a row written before kinds existed as a reply", () => {
    const old = message({ senderId: "grace", kind: undefined });
    expect(recentParticipantIds([old], group, null, NOW)).toEqual(["grace"]);
  });

  it("caps the list at 20", () => {
    const many = { ...group, members: Array.from({ length: 25 }, (_, index) => `a${index}`) };
    const messages = many.members.map((id) => message({ senderId: id }));
    expect(recentParticipantIds(messages, many, null, NOW)).toHaveLength(20);
  });
});

describe("responder hint", () => {
  it("is empty in a direct chat", () => {
    expect(hint({ conversation: dm, draft: "@Ada hi" })).toBeNull();
  });

  it("names the mentioned assistant and counts the other active ones", () => {
    const messages = [message({ senderId: "grace" }), message({ senderId: "ken" })];
    expect(hint({ messages, draft: "@Ada what do you think?" })).toBe(
      "@Ada will reply; 2 active assistants may also respond.",
    );
  });

  it("matches a mention of a name with spaces", () => {
    expect(hint({ draft: "@Ken Thompson ping" })).toBe("@Ken Thompson will reply.");
  });

  it("routes a quote to the quoted assistant", () => {
    expect(hint({ draft: "and then?", quotedSenderId: "grace" })).toBe("@Grace will reply.");
  });

  it("falls back to recent participants, the default responder, then the first member", () => {
    const recent = [message({ senderId: "ken" })];
    expect(hint({ messages: recent, draft: "anyone?" })).toBe("@Ken Thompson will reply.");
    expect(
      hint({ conversation: { ...group, defaultResponderId: "grace" }, draft: "anyone?" }),
    ).toBe("@Grace will reply.");
    expect(hint({ draft: "anyone?" })).toBe("@Ada will reply.");
  });

  it("says the mentioned members will discuss in order when the roundtable is on", () => {
    expect(hint({ draft: "@Ada @Grace plan this", roundtableOn: true })).toBe(
      "@Ada and @Grace will discuss in order.",
    );
    expect(hint({ draft: "@Ada @Grace plan this", roundtableOn: false })).toBe(
      "@Ada and @Grace may reply.",
    );
    // One mention is not a roundtable, whatever the toggle says.
    expect(hint({ draft: "@Ada plan this", roundtableOn: true })).toBe("@Ada will reply.");
  });

  it("describes a roundtable thread by who the draft addresses", () => {
    expect(hint({ threadId: "root", inRoundtable: true, draft: "thoughts?" })).toBe(
      "The roundtable continues with everyone.",
    );
    expect(hint({ threadId: "root", inRoundtable: true, draft: "@Grace thoughts?" })).toBe(
      "@Grace will reply.",
    );
    expect(hint({ threadId: "root", inRoundtable: true, draft: "@Ada @Ken Thompson go" })).toBe(
      "@Ada and @Ken Thompson will discuss in order.",
    );
    expect(hint({ threadId: "root", inRoundtable: true, draft: "@all go" })).toBe(
      "The roundtable continues with everyone.",
    );
  });
});

describe("roundtable toggle eligibility", () => {
  const eligible = (draft: string, threadId: string | null = null, conversation = group) =>
    roundtableEligibility({ conversation, threadId, draft, members }).eligible;

  it("needs two to six explicitly mentioned members", () => {
    expect(eligible("hello")).toBe(false);
    expect(eligible("@Ada hello")).toBe(false);
    expect(eligible("@Ada and @Grace hello")).toBe(true);
    expect(eligible("@Ada @Grace @Ken Thompson hello")).toBe(true);
  });

  it("counts a member once however often it is named", () => {
    expect(eligible("@Ada @Ada hello")).toBe(false);
  });

  it("is not offered for @all, in a thread, or in a direct chat", () => {
    expect(eligible("@all @Ada hello")).toBe(false);
    expect(eligible("@Ada @Grace hello", "root")).toBe(false);
    expect(eligible("@Ada @Grace hello", null, dm)).toBe(false);
  });

  it("reports who is mentioned, in mention order", () => {
    expect(
      roundtableEligibility({
        conversation: group,
        threadId: null,
        draft: "@Grace then @Ada",
        members,
      }).mentioned.map((member) => member.id),
    ).toEqual(["grace", "ada"]);
  });
});

describe("mentions", () => {
  it("suggests members whose name starts the text after the trailing @", () => {
    expect(mentionSuggestions("hi @", members).map((member) => member.name)).toEqual([
      "Ada",
      "Grace",
      "Ken Thompson",
    ]);
    expect(mentionSuggestions("hi @g", members).map((member) => member.name)).toEqual(["Grace"]);
    expect(mentionSuggestions("@ken t", members).map((member) => member.name)).toEqual([
      "Ken Thompson",
    ]);
    expect(mentionSuggestions("mail me@ada", members)).toEqual([]);
    expect(mentionSuggestions("@Ada done", members)).toEqual([]);
    expect(mentionSuggestions("no mention", members)).toEqual([]);
  });

  it("completes the mention in the form the router reads, spaces included", () => {
    expect(applyMention("hi @ke", "Ken Thompson")).toBe("hi @Ken Thompson ");
    expect(applyMention("@", "Ada")).toBe("@Ada ");
    expect(applyMention("line one\n@gr", "Grace")).toBe("line one\n@Grace ");
    expect(applyMention("@a", "A$&B")).toBe("@A$&B ");
    const completed = applyMention("@ke", "Ken Thompson");
    expect(
      roundtableEligibility({
        conversation: group,
        threadId: null,
        draft: `${completed}@Ada`,
        members,
      }).mentioned.map((member) => member.id),
    ).toEqual(["ken", "ada"]);
  });
});

describe("quoting", () => {
  it("offers Quote on assistant replies in a group chat only", () => {
    expect(canQuote({ senderId: "ada", kind: "final", taskId: null }, group)).toBe(true);
    expect(canQuote({ senderId: "ada", taskId: null }, group)).toBe(true);
    expect(canQuote({ senderId: "ada", kind: "final", taskId: null }, dm)).toBe(false);
    expect(canQuote({ senderId: "user", kind: "user", taskId: null }, group)).toBe(false);
    expect(canQuote({ senderId: "system", kind: "system", taskId: null }, group)).toBe(false);
    expect(canQuote({ senderId: "ada", kind: "final", taskId: "task" }, group)).toBe(false);
    expect(canQuote({ senderId: "ada", kind: "task_event", taskId: null }, group)).toBe(false);
  });

  it("shortens the quoted text to one line", () => {
    expect(quotePreview("one\n\n two   three")).toBe("one two three");
    const long = quotePreview("x".repeat(500));
    expect(long).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("system rows", () => {
  const ended = (detail?: string): Pick<Message, "content" | "event"> => ({
    content: "raw server text",
    event: { type: "roundtable_ended", detail },
  });
  it("labels each way a roundtable can end", () => {
    expect(noteLabel(ended("max_rounds"))).toBe(
      "Roundtable ended: reached the limit of 3 rounds. Send a message to continue.",
    );
    expect(noteLabel(ended("max_messages"))).toContain("message limit");
    expect(noteLabel(ended("all_passed"))).toContain("everyone passed");
    expect(noteLabel(ended("something_new"))).toBe("Roundtable ended. Send a message to continue.");
  });
  it("shows any other note as written", () => {
    expect(noteLabel({ content: "Task started" })).toBe("Task started");
    expect(noteLabel({ content: "Task done", event: { type: "task_done" } })).toBe("Task done");
  });
});

describe("roundtable progress", () => {
  const thread = "root";
  const inThread = (overrides: Partial<Message> & Pick<Message, "senderId">) =>
    message({ threadId: thread, ...overrides });
  const progress = (messages: Message[], turns: Turn[] = []) =>
    roundtableProgress(messages, turns, "chat", thread);

  it("is absent outside a roundtable", () => {
    expect(roundtableProgress([], [], "chat", null)).toBeNull();
    expect(progress([inThread({ senderId: "ada" })])).toBeNull();
    expect(roundtableTitle(null)).toBe("Thread");
  });

  it("reads the round from the latest message of the latest epoch", () => {
    const messages = [
      inThread({ senderId: "ada", epochId: "e1", round: 0 }),
      inThread({ senderId: "grace", epochId: "e1", round: 1 }),
      inThread({ senderId: "user" }),
      inThread({ senderId: "ada", epochId: "e2", round: 0 }),
    ];
    expect(progress(messages)).toEqual({ round: 1, of: 3, ended: false });
    expect(progress(messages.slice(0, 2))).toEqual({ round: 2, of: 3, ended: false });
  });

  it("follows a live turn into a newer epoch before it has said anything", () => {
    const messages = [inThread({ senderId: "ada", epochId: "e1", round: 2 })];
    const live = turn({ threadId: thread, epochId: "e2", round: 0, status: "running" });
    expect(progress(messages, [live])).toEqual({ round: 1, of: 3, ended: false });
  });

  it("counts a round whose speakers all passed", () => {
    const messages = [inThread({ senderId: "ada", epochId: "e1", round: 0 })];
    const passed = turn({ threadId: thread, epochId: "e1", round: 1 });
    expect(progress(messages, [passed])).toEqual({ round: 2, of: 3, ended: false });
  });

  it("marks the roundtable ended and never shows a round past the limit", () => {
    const messages = [
      inThread({ senderId: "ada", epochId: "e1", round: 2 }),
      inThread({
        senderId: "system",
        kind: "system",
        epochId: "e1",
        event: { type: "roundtable_ended", detail: "max_rounds" },
      }),
    ];
    const done = turn({ threadId: thread, epochId: "e1", round: 3 });
    expect(progress(messages, [done])).toEqual({ round: 3, of: 3, ended: true });
    expect(roundtableTitle({ round: 3, of: 3, ended: true })).toBe(
      "Roundtable · round 3 of 3 · ended",
    );
    expect(roundtableTitle({ round: 2, of: 3, ended: false })).toBe("Roundtable · round 2 of 3");
  });

  it("ignores other threads and chats", () => {
    const other = [
      message({ senderId: "ada", threadId: "elsewhere", epochId: "e9", round: 1 }),
      message({ senderId: "ada", threadId: thread, conversationId: "other", epochId: "e9" }),
    ];
    expect(progress(other)).toBeNull();
  });
});
