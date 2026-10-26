import { describe, expect, test } from "vitest";

import { createAgentMcpIdentity } from "./agent-mcp-identity.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { withRuntimePaseoMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimePaseoMcpServer", () => {
  test("injects the paseo MCP server with a bearer header when a token is provided", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: "Bearer cap-token" },
    });
  });

  test("each agent's server entry carries that agent's own token", () => {
    const identity = createAgentMcpIdentity("test-secret");
    const configFor = (agentId: string) =>
      withRuntimePaseoMcpServer({
        config: BASE_CONFIG,
        agentId,
        mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
        mcpAuthToken: identity.tokenFor(agentId),
      }).mcpServers?.paseo;

    expect(configFor("agent-1")).toMatchObject({
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: `Bearer ${identity.tokenFor("agent-1")}` },
    });
    expect(configFor("agent-2")).toMatchObject({
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-2",
      headers: { Authorization: `Bearer ${identity.tokenFor("agent-2")}` },
    });
    expect(identity.tokenFor("agent-1")).not.toBe(identity.tokenFor("agent-2"));
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });
});
