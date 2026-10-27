import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Assistant } from "../shared/contracts";
import { callAgentTool } from "./agent-tools";
import { closeFixtures, fixture } from "./chat-fixture";
import type { MachinePort } from "./machines";

afterEach(closeFixtures);

const SPARK = "srv_spark";

// A fake member machine: its home RPCs keep MEMORY.md in memory, as a member plugin keeps it on disk.
function machines(members = new Set([SPARK])) {
  const calls: Array<[string, string, unknown]> = [];
  const memory = new Map<string, { content: string; mtimeMs: number }>();
  const port: MachinePort = {
    self: async () => "srv_mac",
    isMember: (serverId) => members.has(serverId),
    online: async (serverId) => members.has(serverId),
    list: async () => [
      { serverId: "srv_mac", label: "Mac", role: "coordinator" },
      { serverId: SPARK, label: "Spark", role: members.has(SPARK) ? "member" : "unavailable" },
    ],
    call: async (serverId, contract, input) => {
      calls.push([serverId, contract.name, input]);
      const { assistantId } = input as { assistantId: string };
      if (contract.name === "member.home.prepare") {
        const { seed } = input as { seed: string };
        if (!memory.has(assistantId)) memory.set(assistantId, { content: seed, mtimeMs: 1 });
        return contract.output.parse({ directory: `/spark/bigbang/assistants/${assistantId}` });
      }
      if (contract.name === "member.memory.read")
        return contract.output.parse(memory.get(assistantId) ?? { content: "", mtimeMs: 0 });
      if (contract.name === "member.memory.write") {
        const { content } = input as { content: string };
        const next = { content, mtimeMs: (memory.get(assistantId)?.mtimeMs ?? 0) + 1 };
        memory.set(assistantId, next);
        return contract.output.parse(next);
      }
      throw new Error(`unexpected ${contract.name}`);
    },
  };
  return { port, calls, memory, members };
}

function setup() {
  const spark = machines();
  const f = fixture({ names: ["Ada"], machines: spark.port });
  const sam: Assistant = f.coordinator.saveAssistant({
    id: randomUUID(),
    name: "Sam",
    provider: "grok/grok-4.7",
    persona: "Lives on Spark",
    memory: "Spark notes",
    serverId: SPARK,
  });
  const dm = f.group({ kind: "dm", name: "Sam", members: [sam.id] });
  return { ...f, spark, sam, dm };
}

describe("assistants bound to a machine", () => {
  it("runs a remote assistant's turns on its machine and settles them from relayed hooks", async () => {
    const f = setup();
    await f.say("Which machine are you on?", { conversationId: f.dm.id });
    const turn = f.running()!;
    expect(turn.serverId).toBe(SPARK);
    expect(f.execution.sent.at(-1)).toMatchObject({ messageId: turn.id, serverId: SPARK });
    expect(f.store.getChatSessionByAgent(turn.agentId)?.serverId).toBe(SPARK);

    f.execution.say(turn.agentId, "Spark", `m-${turn.id}`);
    f.execution.finish(turn.agentId);
    f.coordinator.onMemberEvent(SPARK, {
      seq: 1,
      type: "event",
      name: "agent.turn_ended",
      agentId: turn.agentId,
      workspaceId: "wks_spark",
      outcome: { kind: "completed" },
    });
    await f.coordinator.idle();
    expect(f.finals().map((message) => message.content)).toEqual(["Spark"]);
  });

  it("keeps local assistants on the coordinator", async () => {
    const f = setup();
    const adaDm = f.group({ kind: "dm", name: "Ada", members: [f.ada.id] });
    await f.say("Hi", { conversationId: adaDm.id });
    const turn = f.running()!;
    expect(turn.serverId).toBeUndefined();
    expect(f.execution.sent.at(-1)?.serverId).toBeUndefined();
  });

  it("never moves an assistant to another machine", () => {
    const f = setup();
    expect(() => f.coordinator.saveAssistant({ ...f.sam, serverId: undefined })).toThrow(
      "stays on the machine",
    );
    expect(() => f.coordinator.saveAssistant({ ...f.ada, serverId: SPARK })).toThrow(
      "stays on the machine",
    );
    expect(f.coordinator.saveAssistant({ ...f.sam, persona: "Changed" }).persona).toBe("Changed");
  });

  it("creates assistants only on machines that are members right now", () => {
    const f = setup();
    f.spark.members.delete(SPARK);
    expect(() =>
      f.coordinator.saveAssistant({
        id: randomUUID(),
        name: "Lee",
        provider: "codex/test-model",
        persona: "",
        serverId: SPARK,
      }),
    ).toThrow("not a Chat member");
  });

  it("reads and writes a remote assistant's memory on its machine, seeded from the form", async () => {
    const f = setup();
    const loaded = await f.coordinator.readAssistantMemory({ assistantId: f.sam.id });
    expect(loaded).toEqual({ content: "Spark notes", mtimeMs: 1 });
    const written = await f.coordinator.writeAssistantMemory({
      assistantId: f.sam.id,
      content: "Edited on Spark",
      expectedMtimeMs: 1,
    });
    expect(written.content).toBe("Edited on Spark");
    expect(f.spark.calls.map(([serverId, method]) => `${serverId} ${method}`)).toEqual([
      "srv_spark member.home.prepare",
      "srv_spark member.memory.read",
      "srv_spark member.home.prepare",
      "srv_spark member.memory.write",
    ]);
  });

  it("runs a mailbox request to a remote assistant on that assistant's machine", async () => {
    const f = setup();
    const adaDm = f.group({ kind: "dm", name: "Ada", members: [f.ada.id] });
    await f.say("Ask Sam about Spark", { conversationId: adaDm.id });
    const ada = f.running()!;
    const sent = (await callAgentTool(
      f.coordinator,
      { agentId: ada.agentId, serverId: undefined as never },
      "send",
      {
        to: "Sam",
        text: "What is your hostname?",
      },
    )) as { mailboxId: string };
    await f.coordinator.idle();
    const request = f.store.get("turns", `mailbox:${sent.mailboxId}`)!;
    expect(request).toMatchObject({ serverId: SPARK, status: "running" });
    expect(f.execution.sent.at(-1)).toMatchObject({ messageId: request.id, serverId: SPARK });
  });

  it("authorizes a relayed tool call only from the assistant's own machine", async () => {
    const f = setup();
    await f.say("Status?", { conversationId: f.dm.id });
    const turn = f.running()!;
    await expect(
      callAgentTool(f.coordinator, { agentId: turn.agentId, serverId: SPARK }, "task_status", {}),
    ).rejects.toThrow("not allowed to start tasks");
    await expect(
      callAgentTool(
        f.coordinator,
        { agentId: turn.agentId, serverId: "srv_other" },
        "task_status",
        {},
      ),
    ).rejects.toThrow("only available to a Chat assistant");
  });
});
