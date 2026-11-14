import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER_PROTOCOL, type MemberCall, type MemberEvent } from "../../shared/member";
import { MemberLinks, type HostDirectoryPort } from "./link";
import { MemberRelay } from "./relay";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

interface FakeMember {
  relay: MemberRelay;
  mode: "member" | "coordinator";
  coordinator: string | null;
  online: boolean;
  /** Fails the next poll, as a dropped link would. */
  dropNextPoll?: boolean;
}
function directory(members: Record<string, FakeMember>): HostDirectoryPort {
  return {
    self: async () => "srv_coord",
    list: async () =>
      Object.entries(members).map(([serverId, entry]) => ({
        serverId,
        label: serverId,
        online: entry.online,
      })),
    invoke: async (serverId, method, input) => {
      const member = members[serverId];
      if (!member?.online) throw new Error("host offline");
      if (method === "member.hello")
        return {
          protocol: MEMBER_PROTOCOL,
          mode: member.mode,
          coordinatorServerId: member.coordinator,
          processId: member.relay.processId,
        };
      if (method === "member.poll") {
        if (member.dropNextPoll) {
          member.dropNextPoll = false;
          throw new Error("link dropped");
        }
        return member.relay.poll(input as never);
      }
      if (method === "member.respond") {
        const { callId, result } = input as { callId: string; result: never };
        return member.relay.respond(callId, result);
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}
function fakeMember(overrides: Partial<FakeMember> = {}): FakeMember {
  const relay = new MemberRelay({ coordinatorServerId: () => "srv_coord" });
  cleanup.push(() => relay.close());
  return { relay, mode: "member", coordinator: "srv_coord", online: true, ...overrides };
}
function links(
  members: Record<string, FakeMember>,
  handlers: Partial<ConstructorParameters<typeof MemberLinks>[1]> = {},
) {
  const calls: Array<[string, MemberCall]> = [];
  const events: Array<[string, MemberEvent]> = [];
  const reconnected: string[] = [];
  const created = new MemberLinks(
    directory(members),
    {
      call: async (serverId, call) => {
        calls.push([serverId, call]);
        return { from: serverId, tool: call.tool };
      },
      event: (serverId, event) => void events.push([serverId, event]),
      reconnected: (serverId) => void reconnected.push(serverId),
      ...handlers,
    },
    { discoverMs: 60_000, retryMs: 20 },
  );
  cleanup.push(() => created.close());
  return { links: created, calls, events, reconnected };
}

describe("MemberLinks", () => {
  it("runs a member's tool call on the coordinator and answers the calling agent", async () => {
    const spark = fakeMember();
    const { links: target, calls } = links({ srv_spark: spark });
    target.start();
    const output = await spark.relay.call("agent-1", "start_task", { prompt: "go" });
    expect(output).toEqual({ from: "srv_spark", tool: "start_task" });
    expect(calls).toMatchObject([["srv_spark", { agentId: "agent-1", input: { prompt: "go" } }]]);
  });

  it("forwards hook events with the machine they came from", async () => {
    const spark = fakeMember();
    const { links: target, events, reconnected } = links({ srv_spark: spark });
    target.start();
    spark.relay.event({
      name: "agent.turn_ended",
      agentId: "agent-1",
      workspaceId: "wks",
      outcome: { kind: "completed" },
    });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject([
      "srv_spark",
      { agentId: "agent-1", name: "agent.turn_ended" },
    ]);
    expect(reconnected).toEqual(["srv_spark"]);
  });

  it("leaves hosts that are coordinators or serve another coordinator alone", async () => {
    const own = fakeMember({ mode: "coordinator", coordinator: null });
    const foreign = fakeMember({ coordinator: "srv_elsewhere" });
    const { links: target } = links({ srv_own: own, srv_foreign: foreign });
    target.start();
    await vi.waitFor(() => {
      expect(target.state("srv_own")).toEqual({
        kind: "other",
        reason: "It is a Chat coordinator itself.",
      });
      expect(target.state("srv_foreign")).toMatchObject({ kind: "other" });
    });
  });

  it("answers a redelivered call once, and recovers after a dropped poll", async () => {
    const spark = fakeMember();
    let runs = 0;
    const { links: target, reconnected } = links(
      { srv_spark: spark },
      {
        call: async () => {
          runs += 1;
          return runs;
        },
      },
    );
    spark.dropNextPoll = true;
    target.start();
    await expect(spark.relay.call("agent-1", "task_status", {})).resolves.toBe(1);
    expect(runs).toBe(1);
    // A dropped poll counts as a reconnect, because events may have been missed in between.
    expect(reconnected).toEqual(["srv_spark", "srv_spark"]);
  });

  it("reports a refused call to the agent as an error", async () => {
    const spark = fakeMember();
    const { links: target } = links(
      { srv_spark: spark },
      {
        call: async () => {
          throw new Error("Only chat assistants may start tasks.");
        },
      },
    );
    target.start();
    await expect(spark.relay.call("agent-1", "start_task", {})).rejects.toThrow(
      "Only chat assistants may start tasks.",
    );
  });
});
