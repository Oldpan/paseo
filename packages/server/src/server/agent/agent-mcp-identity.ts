import { createHmac, timingSafeEqual } from "node:crypto";

import { extractHttpBearerToken, isBearerTokenValidAsync } from "../auth.js";

const TOKEN_DOMAIN = "paseo.agent-mcp.v1\0";

export type AgentMcpCaller =
  | { kind: "agent"; agentId: string; verified: true }
  | { kind: "owner" }
  | { kind: "open" }
  | { kind: "rejected" };

export interface AgentMcpVerifyInput {
  callerAgentId: string | undefined;
  authorizationHeader: string | undefined;
  password: string | undefined;
}

export interface AgentMcpIdentity {
  tokenFor(agentId: string): string;
  verify(input: AgentMcpVerifyInput): Promise<AgentMcpCaller>;
}

/**
 * Per-agent identity for the Agent MCP endpoint (/mcp/agents). Each agent's bearer
 * token is derived from a per-daemon-run secret, so presenting the token proves the
 * caller is that agent; `callerAgentId` alone is only a claim.
 *
 * - bearer matches tokenFor(callerAgentId): verified agent
 * - bearer is the daemon password: owner (callerAgentId stays an unverified claim)
 * - no password and no Authorization header: open (loopback default; callerAgentId unverified)
 * - anything else, including one agent's token with another agent's id: rejected
 */
export function createAgentMcpIdentity(secret: Buffer | string): AgentMcpIdentity {
  function tokenFor(agentId: string): string {
    return createHmac("sha256", secret).update(`${TOKEN_DOMAIN}${agentId}`).digest("base64url");
  }

  async function verify(input: AgentMcpVerifyInput): Promise<AgentMcpCaller> {
    if (input.authorizationHeader === undefined) {
      return input.password ? { kind: "rejected" } : { kind: "open" };
    }
    const bearer = extractHttpBearerToken(input.authorizationHeader);
    if (bearer === null) {
      return { kind: "rejected" };
    }
    if (
      input.callerAgentId !== undefined &&
      constantTimeEqual(bearer, tokenFor(input.callerAgentId))
    ) {
      return { kind: "agent", agentId: input.callerAgentId, verified: true };
    }
    if (
      input.password &&
      (await isBearerTokenValidAsync({ password: input.password, token: bearer }))
    ) {
      return { kind: "owner" };
    }
    return { kind: "rejected" };
  }

  return { tokenFor, verify };
}

function constantTimeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}
