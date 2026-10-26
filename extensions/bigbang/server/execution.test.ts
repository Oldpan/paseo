import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { PaseoExecution, type ChatAgentSpec } from "./execution";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

const spec: ChatAgentSpec = {
  agentId: "agent-1",
  assistantId: "assistant-1",
  assistantName: "Ada",
  provider: "codex/test",
  systemPrompt: "Be Ada",
  created: false,
};

function directory() {
  const home = mkdtempSync(path.join(tmpdir(), "bigbang-execution-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  return home;
}
function memoryHomes() {
  const rows = new Map<string, { assistantId: string; workspaceId: string; directory: string }>();
  return {
    rows,
    get: (id: string) => rows.get(id) ?? null,
    put: (row: never) => void rows.set((row as { assistantId: string }).assistantId, row),
  };
}

describe("PaseoExecution", () => {
  it("creates chat agents inside one background workspace per assistant", async () => {
    const home = directory();
    const homes = memoryHomes();
    const created: Array<[string, { agentId: string }]> = [];
    const workspaceCreate = vi.fn(async () => ({
      id: "wks_home",
      current: () => ({ background: true }),
    }));
    const api = {
      agents: { ref: () => ({ refresh: async () => null, current: () => null, archivedAt: null }) },
      workspaces: {
        create: workspaceCreate,
        ref: (id: string) => ({
          agents: {
            create: async (options: { agentId: string }) => {
              created.push([id, options]);
              return {};
            },
          },
        }),
      },
    } as unknown as PaseoApi;
    const execution = new PaseoExecution(api, home, homes);

    await execution.ensureChatAgent(spec);
    await execution.ensureChatAgent({ ...spec, agentId: "agent-2" });

    expect(workspaceCreate).toHaveBeenCalledTimes(1);
    expect(workspaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        background: true,
        idempotencyKey: "assistant-home:assistant-1",
        source: { kind: "directory", path: path.join(home, "assistants", "assistant-1") },
      }),
    );
    expect(created.map(([id, options]) => [id, options.agentId])).toEqual([
      ["wks_home", "agent-1"],
      ["wks_home", "agent-2"],
    ]);
    expect(homes.rows.get("assistant-1")?.workspaceId).toBe("wks_home");
  });

  it("moves the home to a private subdirectory when the daemon reuses a visible workspace", async () => {
    const home = directory();
    const homes = memoryHomes();
    const created = [
      { id: "wks_visible", current: () => ({ background: false }) },
      { id: "wks_private", current: () => ({ background: true }) },
    ];
    const workspaceCreate = vi.fn(async () => created.shift()!);
    const api = {
      agents: { ref: () => ({ refresh: async () => null, current: () => null, archivedAt: null }) },
      workspaces: {
        create: workspaceCreate,
        ref: () => ({ agents: { create: async () => ({}) } }),
      },
    } as unknown as PaseoApi;
    await new PaseoExecution(api, home, homes).ensureChatAgent(spec);
    expect(workspaceCreate.mock.calls[1]).toEqual([
      expect.objectContaining({
        idempotencyKey: "assistant-home:assistant-1:home",
        source: { kind: "directory", path: path.join(home, "assistants", "assistant-1", "home") },
      }),
    ]);
    expect(homes.rows.get("assistant-1")).toMatchObject({ workspaceId: "wks_private" });
  });

  it("never replaces an execution that was created before", async () => {
    const api = {
      agents: { ref: () => ({ refresh: async () => null, current: () => null, archivedAt: null }) },
    } as unknown as PaseoApi;
    await expect(
      new PaseoExecution(api, directory(), memoryHomes()).ensureChatAgent({
        ...spec,
        created: true,
      }),
    ).rejects.toThrow("will not be replaced");
  });

  it("resumes a closed execution under the same id instead of treating it as gone", async () => {
    const create = vi.fn();
    const api = {
      agents: {
        ref: () => ({
          refresh: async () => ({}),
          current: () => ({ status: "closed" }),
          archivedAt: null,
        }),
      },
      workspaces: { create, ref: () => ({ agents: { create } }) },
    } as unknown as PaseoApi;
    await new PaseoExecution(api, directory(), memoryHomes()).ensureChatAgent({
      ...spec,
      created: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("pages back from the tail until it finds the anchor", async () => {
    const entry = (item: object) => ({ item });
    const pages = [
      {
        entries: [entry({ type: "assistant_message", text: "Final", messageId: "m2" })],
        hasOlder: true,
        startCursor: { epoch: "e", seq: 9 },
        agent: { status: "idle", pendingPermissions: [] },
      },
      {
        entries: [
          entry({ type: "user_message", text: "hi", messageId: "turn-1" }),
          entry({ type: "tool_call" }),
        ],
        hasOlder: false,
        startCursor: { epoch: "e", seq: 1 },
        agent: null,
      },
    ];
    const refetch = vi.fn(async () => ({ staleCursor: false, gap: false, ...pages.shift()! }));
    const api = {
      agents: { ref: () => ({ timeline: { refetch }, refresh: async () => null }) },
    } as unknown as PaseoApi;
    const read = await new PaseoExecution(api, directory(), memoryHomes()).readTurn(
      "agent-1",
      "turn-1",
    );
    expect(refetch.mock.calls).toEqual([
      [{ direction: "tail", limit: 100 }],
      [{ direction: "before", cursor: { epoch: "e", seq: 9 }, limit: 100 }],
    ]);
    expect(read).toMatchObject({ kind: "found", ended: true, text: "Final", agentClosed: false });
  });

  it("reports unknown when the anchor is not within the bounded history", async () => {
    const refetch = vi.fn(async () => ({
      staleCursor: false,
      gap: false,
      entries: [{ item: { type: "assistant_message", text: "x", messageId: "m" } }],
      hasOlder: true,
      startCursor: { epoch: "e", seq: 1 },
      agent: { status: "idle", pendingPermissions: [] },
    }));
    const api = { agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi;
    expect(
      await new PaseoExecution(api, directory(), memoryHomes()).readTurn("a", "turn-1"),
    ).toEqual({
      kind: "unknown",
    });
    expect(refetch).toHaveBeenCalledTimes(8);
  });

  it("treats a running execution as not ended and exposes its pending approval", async () => {
    const refetch = async () => ({
      staleCursor: false,
      gap: false,
      entries: [{ item: { type: "user_message", text: "hi", messageId: "turn-1" } }],
      hasOlder: false,
      startCursor: null,
      agent: {
        status: "running",
        pendingPermissions: [{ id: "req-1", name: "shell", title: "Run ls" }],
      },
    });
    const api = { agents: { ref: () => ({ timeline: { refetch } }) } } as unknown as PaseoApi;
    expect(
      await new PaseoExecution(api, directory(), memoryHomes()).readTurn("a", "turn-1"),
    ).toMatchObject({
      kind: "found",
      ended: false,
      permission: { requestId: "req-1", title: "Run ls" },
    });
  });
});
