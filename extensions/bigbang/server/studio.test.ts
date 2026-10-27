import { afterEach, describe, expect, it, vi } from "vitest";
import { callAgentTool } from "./agent-tools";
import { closeFixtures, fixture } from "./chat-fixture";
import type { MachinePort } from "./machines";

// Ported from Bigbang Core's studioHerdr.test.ts (the messaging cases). herdr sessions, panes and
// process proofs become Paseo workspaces, agents and per-agent MCP identity.

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
  const f = fixture({ names: ["Ada"], machines });
  f.execution.localServerId = MAC;
  f.execution.addWorkspaceAgent(MAC, "wks-app", "agent-codex", "codex");
  f.execution.addWorkspaceAgent(SPARK, "wks-lab", "agent-grok", "grok");
  const studio = () => f.coordinator.studio;
  const tool = (agentId: string, serverId: string | undefined, name: string, input: unknown) =>
    callAgentTool(f.coordinator, { agentId, serverId: serverId as never }, name, input);
  const codex = (name: string, input: unknown) => tool("agent-codex", undefined, name, input);
  const grok = (name: string, input: unknown) => tool("agent-grok", SPARK, name, input);
  async function settle() {
    await f.coordinator.idle();
    await new Promise((resolve) => setImmediate(resolve));
  }
  async function bound() {
    await f.coordinator.machinesList();
    studio().save({ id: "studio-1", name: "Lab" });
    studio().bind({ studioId: "studio-1", serverId: MAC, workspaceId: "wks-app", name: "App" });
    studio().bind({ studioId: "studio-1", serverId: SPARK, workspaceId: "wks-lab", name: "Lab" });
    await settle();
  }
  const sent = () => f.execution.delivered.filter((item) => !item.text.includes("Studio notice"));
  // Keeps the fixture's getters, so store and coordinator follow a restart.
  return Object.assign(f, { offline, studio, codex, grok, tool, settle, bound, sent });
}

interface Receipt {
  messageId: string;
  recipient: string;
  status: string;
  code: string;
}

describe("Studio collaboration", () => {
  it("records one attempt, answers the original sender and rejects a reply after a rebind", async () => {
    const f = setup();
    await f.bound();
    const out = (await f.codex("send", { to: "grok", text: "x".repeat(8192) })) as {
      messages: Receipt[];
    };
    const [message] = out.messages;
    expect(message).toMatchObject({ recipient: "Spark/Lab/grok", status: "accepted" });
    expect(f.sent()).toMatchObject([
      {
        serverId: SPARK,
        agentId: "agent-grok",
        messageId: message!.messageId,
        sourceAgentId: "agent-codex",
        sourceAgentServerId: MAC,
      },
    ]);
    expect(f.sent()[0]!.text).toContain("From codex on Mac (Mac/App/codex)");

    const reply = (await f.grok("reply", {
      messageId: message!.messageId,
      text: "reply body",
    })) as {
      status: string;
    };
    expect(reply.status).toBe("accepted");
    expect(f.sent().at(-1)).toMatchObject({ agentId: "agent-codex", sourceAgentId: "agent-grok" });
    expect(f.sent()).toHaveLength(2);
    // Only the recipient may reply.
    await expect(f.codex("reply", { messageId: message!.messageId, text: "me?" })).rejects.toThrow(
      "no longer bound",
    );
    // Removing and binding the workspace again starts a new binding; old messages cannot be answered.
    f.studio().unbind({ serverId: SPARK, workspaceId: "wks-lab" });
    f.studio().bind({ studioId: "studio-1", serverId: SPARK, workspaceId: "wks-lab", name: "Lab" });
    await expect(f.grok("reply", { messageId: message!.messageId, text: "again" })).rejects.toThrow(
      "no longer bound",
    );
  });

  it("addresses members by name, address or key, sends to several and filters records", async () => {
    const f = setup();
    await f.bound();
    const peers = (await f.codex("peers", {})) as {
      peers: Array<{ address: string; key: string }>;
    };
    expect(peers.peers).toEqual([
      expect.objectContaining({
        address: "Spark/Lab/grok",
        key: `agent:${SPARK}:agent-grok`,
        machine: "Spark",
      }),
    ]);
    const send = (to: string | string[], text = "hello") =>
      f.codex("send", { to, text }) as Promise<{ messages: Receipt[] }>;
    const byName = (await send("grok")).messages[0]!;
    const byAddress = (await send("Spark/Lab/grok")).messages[0]!;
    const byKey = (await send(`agent:${SPARK}:agent-grok`)).messages[0]!;
    expect([byName, byAddress, byKey].map((item) => item.recipient)).toEqual([
      "Spark/Lab/grok",
      "Spark/Lab/grok",
      "Spark/Lab/grok",
    ]);
    f.execution.addWorkspaceAgent(SPARK, "wks-lab", "agent-grok-2", "reviewer");
    const both = (await send(["grok", "reviewer"], "to both")).messages;
    expect(both.map((item) => item.recipient)).toEqual(["Spark/Lab/grok", "Spark/Lab/reviewer"]);
    expect(new Set(both.map((item) => item.messageId)).size).toBe(2);
    await expect(send("nobody")).rejects.toThrow('No current member "nobody"');
    await expect(send(Array.from({ length: 9 }, (_, index) => `m${index}`))).rejects.toThrow();

    const reply = (await f.grok("reply", { messageId: byName.messageId, text: "done" })) as {
      messageId: string;
    };
    const records = (filter: Record<string, string>) =>
      f
        .codex("records", filter)
        .then((result) => (result as { records: Array<{ messageId: string }> }).records);
    expect((await records({ replyTo: byName.messageId })).map((row) => row.messageId)).toEqual([
      reply.messageId,
    ]);
    expect((await records({ since: both[1]!.messageId })).map((row) => row.messageId)).toEqual([
      reply.messageId,
    ]);
    expect((await records({ with: "reviewer" })).map((row) => row.messageId)).toEqual([
      both[1]!.messageId,
    ]);
    await expect(records({ since: "missing" })).rejects.toThrow("Message not found");
  });

  it("rejects an ambiguous name and lists the matching addresses", async () => {
    const f = setup();
    f.execution.addWorkspaceAgent(SPARK, "wks-lab", "agent-grok-2", "grok");
    await f.bound();
    await expect(f.codex("send", { to: "grok", text: "hi" })).rejects.toThrow(
      /matches several members: Spark\/Lab\/grok \[agent:srv_spark:agent-grok\], Spark\/Lab\/grok \[agent:srv_spark:agent-grok-2\]/,
    );
    const out = (await f.codex("send", { to: `agent:${SPARK}:agent-grok-2`, text: "hi" })) as {
      messages: Receipt[];
    };
    expect(out.messages[0]!.status).toBe("accepted");
  });

  it("keeps an unknown receipt without resending, also across a coordinator restart", async () => {
    const f = setup();
    await f.bound();
    f.execution.failNextDelivery = Object.assign(new Error("lost receipt"), {
      code: "agent_request_outcome_unknown",
    });
    const unknown = (
      (await f.codex("send", { to: "grok", text: "maybe" })) as { messages: Receipt[] }
    ).messages[0]!;
    expect(unknown).toMatchObject({ status: "unknown", code: "delivery_outcome_unknown" });
    f.store.database
      .prepare("UPDATE studio_records SET delivery_status='attempting' WHERE message_id=?")
      .run(unknown.messageId);
    await f.restart();
    const after = f.coordinator.studio
      .records("studio-1")
      .find((row) => row.messageId === unknown.messageId);
    expect(after?.receipt).toMatchObject({ status: "unknown", code: "coordinator_restarted" });
    expect(f.sent()).toEqual([]);
  });

  it("treats a hung delivery as unknown after the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const f = setup();
      await f.bound();
      f.execution.failNextDelivery = "hang";
      const pending = f.codex("send", { to: "grok", text: "slow" }) as Promise<{
        messages: Receipt[];
      }>;
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).messages[0]!.status).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a rejected delivery and an offline recipient without attempting it", async () => {
    const f = setup();
    await f.bound();
    f.execution.failNextDelivery = new Error("agent is closed");
    const rejected = ((await f.codex("send", { to: "grok", text: "a" })) as { messages: Receipt[] })
      .messages[0]!;
    expect(rejected).toMatchObject({ status: "rejected", code: "delivery_rejected" });
    f.offline.add(SPARK);
    const offline = ((await f.codex("send", { to: "grok", text: "b" })) as { messages: Receipt[] })
      .messages[0]!;
    expect(offline).toMatchObject({ status: "not_attempted", code: "host_offline" });
    expect(f.sent()).toEqual([]);
    f.offline.delete(SPARK);
    await f.settle();
    expect(f.sent()).toEqual([]);
  });

  it("sends one automatic notice per continuous binding, and to an agent created later", async () => {
    const f = setup();
    await f.bound();
    const notices = () =>
      f.execution.delivered.filter((item) => item.text.includes("Studio notice"));
    expect(
      notices()
        .map((item) => item.agentId)
        .toSorted(),
    ).toEqual(["agent-codex", "agent-grok"]);
    expect(notices()[0]!.text).toContain('Studio "Lab"');
    f.studio().bind({ studioId: "studio-1", serverId: SPARK, workspaceId: "wks-lab", name: "Lab" });
    await f.settle();
    expect(notices()).toHaveLength(2);
    f.studio().unbind({ serverId: SPARK, workspaceId: "wks-lab" });
    f.studio().bind({ studioId: "studio-1", serverId: SPARK, workspaceId: "wks-lab", name: "Lab" });
    await f.settle();
    expect(notices()).toHaveLength(3);
    f.execution.addWorkspaceAgent(MAC, "wks-app", "agent-new", "newcomer");
    f.coordinator.onAgentCreated({
      agent: { id: "agent-new", workspaceId: "wks-app", title: "newcomer" },
    });
    await f.settle();
    expect(notices().at(-1)?.agentId).toBe("agent-new");
  });

  it("refuses callers outside a Studio, Bigbang executions, and other Studios' members", async () => {
    const f = setup();
    await f.bound();
    f.execution.addWorkspaceAgent(MAC, "wks-other", "agent-other", "other");
    await expect(
      f.tool("agent-other", undefined, "send", { to: "grok", text: "hi" }),
    ).rejects.toThrow("workspace that belongs to a Studio");
    f.studio().save({ id: "studio-2", name: "Other" });
    f.studio().bind({
      studioId: "studio-2",
      serverId: MAC,
      workspaceId: "wks-other",
      name: "Other",
    });
    await f.settle();
    await expect(
      f.tool("agent-other", undefined, "send", { to: "grok", text: "hi" }),
    ).rejects.toThrow('No current member "grok"');
    const peers = (await f.tool("agent-other", undefined, "peers", {})) as { peers: unknown[] };
    expect(peers.peers).toEqual([]);
    // A spoofed machine is a different caller.
    await expect(f.tool("agent-codex", SPARK, "send", { to: "grok", text: "hi" })).rejects.toThrow(
      "workspace that belongs to a Studio",
    );
  });

  it("keeps a workspace in one Studio at a time and releases it on unbind", async () => {
    const f = setup();
    await f.bound();
    f.studio().save({ id: "studio-2", name: "Other" });
    expect(() =>
      f.studio().bind({ studioId: "studio-2", serverId: MAC, workspaceId: "wks-app", name: "App" }),
    ).toThrow("already belongs to another Studio");
    f.studio().unbind({ serverId: MAC, workspaceId: "wks-app" });
    expect(
      f.studio().bind({ studioId: "studio-2", serverId: MAC, workspaceId: "wks-app", name: "App" })
        .workspaces,
    ).toEqual([{ serverId: MAC, workspaceId: "wks-app", name: "App" }]);
    expect(
      f.store
        .snapshot()
        .studios?.map((studio) => studio.id)
        .toSorted(),
    ).toEqual(["studio-1", "studio-2"]);
  });

  it("projects records for the app with the receipt", async () => {
    const f = setup();
    await f.bound();
    await f.codex("send", { to: "grok", text: "status?" });
    const projected = f.store.snapshot().peerMessages?.filter((row) => row.kind === "message");
    expect(projected).toMatchObject([
      {
        ledger: "studio",
        studioId: "studio-1",
        sender: { name: "codex", machine: "Mac" },
        recipient: { name: "grok", machine: "Spark", address: "Spark/Lab/grok" },
        text: "status?",
        status: "accepted",
      },
    ]);
  });
});
