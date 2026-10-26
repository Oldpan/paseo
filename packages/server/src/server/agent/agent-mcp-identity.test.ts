import { describe, expect, test } from "vitest";

import { createAgentMcpIdentity } from "./agent-mcp-identity.js";

const PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

describe("agent MCP identity", () => {
  const identity = createAgentMcpIdentity("test-secret");
  const otherDaemon = createAgentMcpIdentity("other-secret");

  test("derives a stable token per agent that differs across agents and secrets", () => {
    expect(identity.tokenFor("agent-a")).toBe(identity.tokenFor("agent-a"));
    expect(identity.tokenFor("agent-a")).not.toBe(identity.tokenFor("agent-b"));
    expect(identity.tokenFor("agent-a")).not.toBe(otherDaemon.tokenFor("agent-a"));
    expect(identity.tokenFor("agent-a")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  describe.each([
    { label: "no daemon password", password: undefined },
    { label: "a daemon password", password: PASSWORD_HASH },
  ])("with $label", ({ password }) => {
    test("verifies an agent presenting its own token", async () => {
      expect(
        await identity.verify({
          callerAgentId: "agent-a",
          authorizationHeader: `Bearer ${identity.tokenFor("agent-a")}`,
          password,
        }),
      ).toEqual({ kind: "agent", agentId: "agent-a", verified: true });
    });

    test("rejects one agent's token presented for another agent", async () => {
      expect(
        await identity.verify({
          callerAgentId: "agent-b",
          authorizationHeader: `Bearer ${identity.tokenFor("agent-a")}`,
          password,
        }),
      ).toEqual({ kind: "rejected" });
    });

    test("rejects an agent token with no callerAgentId", async () => {
      expect(
        await identity.verify({
          callerAgentId: undefined,
          authorizationHeader: `Bearer ${identity.tokenFor("agent-a")}`,
          password,
        }),
      ).toEqual({ kind: "rejected" });
    });

    test("rejects tokens minted by another daemon run and malformed headers", async () => {
      expect(
        await identity.verify({
          callerAgentId: "agent-a",
          authorizationHeader: `Bearer ${otherDaemon.tokenFor("agent-a")}`,
          password,
        }),
      ).toEqual({ kind: "rejected" });
      expect(
        await identity.verify({
          callerAgentId: "agent-a",
          authorizationHeader: "Bearer short",
          password,
        }),
      ).toEqual({ kind: "rejected" });
      expect(
        await identity.verify({
          callerAgentId: "agent-a",
          authorizationHeader: identity.tokenFor("agent-a"),
          password,
        }),
      ).toEqual({ kind: "rejected" });
    });
  });

  test("treats a request with no bearer as open when no password is configured", async () => {
    expect(
      await identity.verify({
        callerAgentId: "agent-a",
        authorizationHeader: undefined,
        password: undefined,
      }),
    ).toEqual({ kind: "open" });
  });

  test("rejects a request with no bearer when a password is configured", async () => {
    expect(
      await identity.verify({
        callerAgentId: "agent-a",
        authorizationHeader: undefined,
        password: PASSWORD_HASH,
      }),
    ).toEqual({ kind: "rejected" });
  });

  test("accepts the daemon password as owner, with or without a claimed caller", async () => {
    expect(
      await identity.verify({
        callerAgentId: undefined,
        authorizationHeader: "Bearer correct-password",
        password: PASSWORD_HASH,
      }),
    ).toEqual({ kind: "owner" });
    expect(
      await identity.verify({
        callerAgentId: "agent-a",
        authorizationHeader: "Bearer correct-password",
        password: PASSWORD_HASH,
      }),
    ).toEqual({ kind: "owner" });
  });

  test("rejects a wrong password bearer", async () => {
    expect(
      await identity.verify({
        callerAgentId: undefined,
        authorizationHeader: "Bearer wrong-password",
        password: PASSWORD_HASH,
      }),
    ).toEqual({ kind: "rejected" });
  });

  test("rejects an unrecognized bearer when no password is configured", async () => {
    expect(
      await identity.verify({
        callerAgentId: undefined,
        authorizationHeader: "Bearer anything",
        password: undefined,
      }),
    ).toEqual({ kind: "rejected" });
  });
});
