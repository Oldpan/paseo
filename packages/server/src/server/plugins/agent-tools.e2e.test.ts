import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, expect, test } from "vitest";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { resolveDaemonVersion } from "../daemon-version.js";

const PLUGIN_ID = "agent-tool-fixture";
const fixtureDirectory = fileURLToPath(
  new URL("./test-fixtures/agent-tool-directory/", import.meta.url),
);
const WHOAMI = `${PLUGIN_ID}__whoami`;
const ECHO = `${PLUGIN_ID}__echo`;

const roots: string[] = [];
let daemon: TestPaseoDaemon;
let client: DaemonClient;
let agentA: string;
let agentB: string;
const mcpClients: Client[] = [];

async function createAgent(cwd: string): Promise<string> {
  const agent = await daemon.daemon.agentManager.createAgent(
    { provider: "claude", cwd },
    undefined,
    { workspaceId: undefined },
  );
  return agent.id;
}

async function connectMcp(input: { callerAgentId?: string; bearer?: string }): Promise<Client> {
  const url = new URL(`http://127.0.0.1:${daemon.port}/mcp/agents`);
  if (input.callerAgentId) url.searchParams.set("callerAgentId", input.callerAgentId);
  const transport = new StreamableHTTPClientTransport(
    url,
    input.bearer
      ? { requestInit: { headers: { Authorization: `Bearer ${input.bearer}` } } }
      : undefined,
  );
  const mcp = new Client({ name: "agent-tools-test", version: "1.0.0" });
  await mcp.connect(transport);
  mcpClients.push(mcp);
  return mcp;
}

function asAgent(agentId: string): Promise<Client> {
  return connectMcp({
    callerAgentId: agentId,
    bearer: daemon.daemon.agentManager.mcpAuthTokenFor(agentId) ?? undefined,
  });
}

async function toolNames(mcp: Client): Promise<string[]> {
  return (await mcp.listTools()).tools.map((tool) => tool.name);
}

beforeEach(async () => {
  daemon = await createTestPaseoDaemon({ agentClients: createTestAgentClients() });
  client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  await client.connect();
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await expect(client.installDirectoryPlugin(fixtureDirectory)).resolves.toMatchObject({
    id: PLUGIN_ID,
    status: "running",
  });
  agentA = await createAgent(daemon.staticDir);
  agentB = await createAgent(daemon.staticDir);
});

afterEach(async () => {
  await Promise.all(mcpClients.splice(0).map((mcp) => mcp.close().catch(() => undefined)));
  await client.close().catch(() => undefined);
  await daemon.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("a verified agent in the audience lists and calls the plugin tool as itself", async () => {
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: [agentA, agentB] });

  const asA = await asAgent(agentA);
  const asB = await asAgent(agentB);
  const listed = (await asA.listTools()).tools.find((tool) => tool.name === WHOAMI);
  expect(listed?.description).toBe("Returns the ID of the agent calling this tool");
  expect(await toolNames(asA)).toEqual(expect.arrayContaining([WHOAMI, ECHO]));

  const resultA = await asA.callTool({ name: WHOAMI, arguments: {} });
  expect(resultA.isError).toBeFalsy();
  expect(resultA.structuredContent).toEqual({ agentId: agentA });
  const resultB = await asB.callTool({ name: WHOAMI, arguments: {} });
  expect(resultB.structuredContent).toEqual({ agentId: agentB });
  expect(await asA.callTool({ name: ECHO, arguments: { text: "hi" } })).toMatchObject({
    structuredContent: { text: "hi" },
  });
});

test("an agent outside the audience neither sees nor can call the tools", async () => {
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: [agentA] });

  const asB = await asAgent(agentB);
  expect(await toolNames(asB)).not.toContain(WHOAMI);
  const rejected = await asB.callTool({ name: WHOAMI, arguments: {} });
  expect(rejected.isError).toBe(true);
  expect(await toolNames(await asAgent(agentA))).toContain(WHOAMI);
});

test("audience changes apply to the next request and 'all' admits every verified agent", async () => {
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: [agentA] });
  expect(await toolNames(await asAgent(agentB))).not.toContain(WHOAMI);
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: "all" });
  expect(await toolNames(await asAgent(agentB))).toContain(WHOAMI);
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: [] });
  expect(await toolNames(await asAgent(agentA))).not.toContain(WHOAMI);
});

test("an unverified caller never sees plugin tools, even when named in the audience", async () => {
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: "all" });

  const claimedOnly = await connectMcp({ callerAgentId: agentA });
  expect(await toolNames(claimedOnly)).not.toContain(WHOAMI);
  const anonymous = await connectMcp({});
  expect(await toolNames(anonymous)).not.toContain(WHOAMI);
  expect(await toolNames(await asAgent(agentA))).toContain(WHOAMI);
});

test("invalid input is reported as a tool error without reaching the plugin handler", async () => {
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: [agentA] });
  const asA = await asAgent(agentA);

  const invalid = await asA.callTool({ name: ECHO, arguments: { text: "" } });
  expect(invalid.isError).toBe(true);
  expect(await asA.callTool({ name: ECHO, arguments: { text: "still works" } })).toMatchObject({
    structuredContent: { text: "still works" },
  });
});

test("removing the plugin removes its tools", async () => {
  await client.invokePluginRpc(PLUGIN_ID, "set_audience", { agentIds: "all" });
  expect(await toolNames(await asAgent(agentA))).toContain(WHOAMI);

  await client.removePlugin(PLUGIN_ID);

  expect(await toolNames(await asAgent(agentA))).not.toContain(WHOAMI);
});

async function installInline(source: string, id: string): Promise<unknown> {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-agent-tool-plugin-"));
  roots.push(directory);
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id, requirements: { paseo: `>=${resolveDaemonVersion(import.meta.url)}` } }),
  );
  await writeFile(path.join(directory, "index.server.ts"), source);
  return client.installDirectoryPlugin(directory).then(
    (plugin) => plugin,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

const TOOL_PRELUDE = `import { defineAgentTool } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
const tool = defineAgentTool({ name: "ping", description: "Ping", input: z.object({}), output: z.object({}) });
`;

test("registration problems fail the plugin load instead of exposing a bad tool", async () => {
  expect(
    await installInline(
      `${TOOL_PRELUDE}export default function contribute(server: PluginServerContext) {
        server.registerAgentTool(tool, () => ({}));
        server.registerAgentTool(tool, () => ({}));
        return () => undefined;
      }`,
      "duplicate-tool",
    ),
  ).toContain("Duplicate plugin agent tool: ping");

  expect(
    await installInline(
      `${TOOL_PRELUDE}export default function contribute(server: PluginServerContext) {
        server.registerAgentTool(tool, () => ({}));
        server.setAgentToolAudience([""]);
        return () => undefined;
      }`,
      "bad-audience",
    ),
  ).toContain("Agent tool audience");

  await installInline(
    `import { defineAgentTool, defineRpc } from "@getpaseo/plugin";
    import type { PluginServerContext } from "@getpaseo/plugin/server";
    import { z } from "zod";
    const tool = defineAgentTool({ name: "ping", description: "Ping", input: z.object({}), output: z.object({}) });
    const late = defineRpc({ name: "late", input: z.object({}), output: z.object({ error: z.string() }) });
    export default function contribute(server: PluginServerContext) {
      server.handle(late, () => {
        try {
          server.registerAgentTool(tool, () => ({}));
          return { error: "" };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      });
      return () => undefined;
    }`,
    "late-tool",
  );
  expect(await client.invokePluginRpc("late-tool", "late", {})).toEqual({
    error: "Plugin agent tools must be registered while contribute() runs",
  });
});

test("defineAgentTool rejects names outside the exposed tool name format", async () => {
  expect(
    await installInline(
      `import { defineAgentTool } from "@getpaseo/plugin";
      import { z } from "zod";
      defineAgentTool({ name: "Bad-Name", description: "x", input: z.object({}), output: z.object({}) });
      export default function contribute() { return () => undefined; }`,
      "bad-name",
    ),
  ).toContain("Invalid plugin agent tool name: Bad-Name");
});

test("tool calls run with the plugin's paseo API available at registration time", async () => {
  const outcome = await installInline(
    `import { defineAgentTool } from "@getpaseo/plugin";
    import type { PluginServerContext } from "@getpaseo/plugin/server";
    import { z } from "zod";
    const probe = defineAgentTool({ name: "probe", description: "Probe", input: z.object({}), output: z.object({ ok: z.boolean() }) });
    export default function contribute(server: PluginServerContext) {
      const recovery = server.paseo.agents.list({ page: { limit: 1 } });
      server.registerAgentTool(probe, async () => {
        await recovery;
        return { ok: true };
      });
      server.setAgentToolAudience("all");
      return () => undefined;
    }`,
    "probe-plugin",
  );
  expect(outcome).toMatchObject({ id: "probe-plugin", status: "running" });
  const result = await (
    await asAgent(agentA)
  ).callTool({
    name: "probe-plugin__probe",
    arguments: {},
  });
  expect(result.structuredContent).toEqual({ ok: true });
});
