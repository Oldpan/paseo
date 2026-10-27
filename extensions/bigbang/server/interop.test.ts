import { afterEach, describe, expect, it } from "vitest";
import type { Turn } from "../shared/contracts";
import { callAgentTool } from "./agent-tools";
import { closeFixtures, fixture } from "./chat-fixture";
import type { MachinePort } from "./machines";
import { mailboxTurnId } from "./mailbox";

// Chat assistants and Studio agents messaging each other: an assistant linked to a Studio reaches
// its members, and they reach it. The mailbox ledger keeps fan-out, fences and wakeups for both.

afterEach(closeFixtures);

const MAC = "srv_mac";
const SPARK = "srv_spark";

function setup() {
  const offline = new Set<string>();
  const machines: MachinePort = {
    self: async () => MAC,
    isMember: () => true,
    online: async (serverId) => !offline.has(serverId),
    list: async () => [
      { serverId: MAC, label: "Mac", role: "coordinator" },
      { serverId: SPARK, label: "Spark", role: "member" },
    ],
    call: async () => {
      throw new Error("unused");
    },
  };
  const f = fixture({ names: ["Ada", "Bob"], machines });
  f.execution.localServerId = MAC;
  f.execution.addWorkspaceAgent(MAC, "wks-app", "agent-codex", "codex");
  f.execution.addWorkspaceAgent(SPARK, "wks-lab", "agent-grok", "grok");
  const adaDm = f.group({ kind: "dm", name: "Ada", members: [f.ada!.id] });
  const tool = (agentId: string, serverId: string | undefined, name: string, input: unknown) =>
    callAgentTool(f.coordinator, { agentId, serverId: serverId as never }, name, input);
  const codex = (name: string, input: unknown) => tool("agent-codex", undefined, name, input);
  const grok = (name: string, input: unknown) => tool("agent-grok", SPARK, name, input);
  async function settle() {
    await f.coordinator.idle();
    await new Promise((resolve) => setImmediate(resolve));
    await f.coordinator.idle();
  }
  async function linked() {
    await f.coordinator.machinesList();
    const studio = f.coordinator.studio;
    studio.save({ id: "studio-1", name: "Lab" });
    studio.bind({ studioId: "studio-1", serverId: MAC, workspaceId: "wks-app", name: "App" });
    studio.bind({ studioId: "studio-1", serverId: SPARK, workspaceId: "wks-lab", name: "Lab" });
    studio.setAssistants({ studioId: "studio-1", assistantIds: [f.ada!.id] });
    await settle();
  }
  const turns = () => f.store.snapshot().turns;
  async function adaReplying(text = "Ask grok on Spark") {
    await f.say(text, { conversationId: adaDm.id });
    return turns().findLast(
      (item) => item.conversationId === adaDm.id && item.status === "running",
    )!;
  }
  async function answer(turn: Turn, text: string, outcome: "completed" | "canceled" = "completed") {
    f.execution.say(turn.agentId, text, `m-${turn.id}`);
    f.execution.finish(turn.agentId);
    f.coordinator.onTurnEnded({
      agent: { id: turn.agentId },
      outcome:
        outcome === "completed" ? { kind: "completed" } : { kind: "canceled", reason: "stopped" },
    });
    await settle();
  }
  const replies = () => f.execution.delivered.filter((item) => item.text.includes("[Studio reply"));
  return Object.assign(f, {
    offline,
    adaDm,
    tool,
    codex,
    grok,
    settle,
    linked,
    turns,
    adaReplying,
    answer,
    replies,
  });
}

describe("Chat and Studio together", () => {
  it("lets a Studio agent ask a linked assistant and answers it through the Studio", async () => {
    const f = setup();
    await f.linked();
    const peers = (await f.codex("peers", {})) as { peers: Array<{ name: string; kind: string }> };
    expect(peers.peers).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Ada", kind: "assistant" })]),
    );
    const out = (await f.codex("send", { to: "Ada", text: "Which branch is released?" })) as {
      messages: Array<{ messageId: string; status: string; code: string }>;
    };
    expect(out.messages[0]).toMatchObject({ status: "queued", code: "mailbox_queued" });
    await f.settle();
    const request = f.turns().find((turn) => turn.mailboxId)!;
    expect(request).toMatchObject({ assistantId: f.ada!.id, status: "running" });
    expect(f.sentTo(request)).toContain("Mac/App/codex");

    await f.answer(request, "release/1.4");
    expect(f.replies()).toMatchObject([
      {
        agentId: "agent-codex",
        text: expect.stringContaining(`reply to ${out.messages[0]!.messageId}`),
      },
    ]);
    expect(f.replies()[0]!.text).toContain("release/1.4");
    expect(f.finals()).toEqual([]);
  });

  it("does not answer a Studio agent whose workspace was bound again since it asked", async () => {
    const f = setup();
    await f.linked();
    await f.codex("send", { to: "Ada", text: "Which branch?" });
    await f.settle();
    const request = f.turns().find((turn) => turn.mailboxId)!;
    f.coordinator.studio.unbind({ serverId: MAC, workspaceId: "wks-app" });
    f.coordinator.studio.bind({
      studioId: "studio-1",
      serverId: MAC,
      workspaceId: "wks-app",
      name: "App",
    });
    await f.settle();
    await f.answer(request, "release/1.4");
    expect(f.replies()).toEqual([]);
  });

  it("lets a linked assistant ask a Studio agent and wakes it with the agent's reply", async () => {
    const f = setup();
    await f.linked();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, undefined, "send", {
      to: "grok",
      text: "Spark load?",
    })) as {
      mailboxId: string;
      status: string;
      recipient: string;
      messages: Array<{ messageId: string; status: string }>;
    };
    expect(sent).toMatchObject({ status: "acked", recipient: "Spark/Lab/grok" });
    const delivered = f.execution.delivered.find(
      (item) => item.agentId === "agent-grok" && item.text.includes("Spark load?"),
    )!;
    expect(delivered.text).toContain("From Ada on Mac (Mac/Chat/Ada)");
    expect(delivered.sourceAgentId).toBeUndefined();

    await f.grok("reply", { messageId: sent.messages[0]!.messageId, text: "load 0.4" });
    await f.answer(ada, "I asked grok.");
    const wakeup = f.turns().find((turn) => turn.mailboxWakeupIds)!;
    expect(f.sentTo(wakeup)).toContain("load 0.4");
    expect(f.sentTo(wakeup)).toContain("Spark/Lab/grok");
  });

  it("counts Studio agents and assistants together toward one new peer per user message", async () => {
    const f = setup();
    await f.linked();
    const ada = await f.adaReplying();
    await f.tool(ada.agentId, undefined, "send", { to: "grok", text: "first" });
    await expect(
      f.tool(ada.agentId, undefined, "send", { to: "Bob", text: "second" }),
    ).rejects.toThrow("root already contacted 1 new peer");
  });

  it("fences what a stopped reply asked, so a late Studio reply is refused", async () => {
    const f = setup();
    await f.linked();
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, undefined, "send", {
      to: "grok",
      text: "long job",
    })) as {
      messages: Array<{ messageId: string }>;
    };
    await f.answer(ada, "", "canceled");
    await expect(
      f.grok("reply", { messageId: sent.messages[0]!.messageId, text: "done anyway" }),
    ).rejects.toThrow("fenced");
  });

  it("answers the assistant with a failed reply when the agent's machine is offline", async () => {
    const f = setup();
    await f.linked();
    f.offline.add(SPARK);
    const ada = await f.adaReplying();
    const sent = (await f.tool(ada.agentId, undefined, "send", { to: "grok", text: "ping" })) as {
      mailboxId: string;
      status: string;
      messages: Array<{ status: string }>;
    };
    expect(sent).toMatchObject({ status: "failed", messages: [{ status: "not_attempted" }] });
    await f.answer(ada, "I tried grok.");
    const wakeup = f.turns().find((turn) => turn.mailboxWakeupIds)!;
    expect(f.sentTo(wakeup)).toContain("Not delivered");
  });

  it("keeps unlinked assistants and Studio agents apart", async () => {
    const f = setup();
    await f.linked();
    await expect(f.codex("send", { to: "Bob", text: "hi" })).rejects.toThrow(
      'No current member "Bob"',
    );
    const bobDm = f.group({ kind: "dm", name: "Bob", members: [f.bob!.id] });
    await f.say("Ask grok", { conversationId: bobDm.id });
    const bob = f
      .turns()
      .findLast((turn) => turn.conversationId === bobDm.id && turn.status === "running")!;
    await expect(
      f.tool(bob.agentId, undefined, "send", { to: "grok", text: "hi" }),
    ).rejects.toThrow("No assistant named grok");
    // A mailbox lane's own request id is not a Studio reply target.
    expect(f.turns().filter((turn) => turn.id.startsWith(mailboxTurnId("")))).toEqual([]);
  });
});
