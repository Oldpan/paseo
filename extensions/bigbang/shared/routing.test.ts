import { describe, expect, it } from "vitest";
import { resolveOrdinaryChannelRoute } from "./routing";

// Ported from Bigbang's ordinary Channel Free resolver tests.
describe("ordinary chat routing", () => {
  const members = new Set(["alpha", "beta", "gamma"]);

  it("keeps slash target-only and does not union recent participants", () => {
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: members,
        mentionedAgentIds: ["beta"],
        quotedAgentId: "gamma",
        slashTargetAgentId: "alpha",
        recentParticipantAgentIds: ["beta", "gamma"],
        defaultResponderAgentId: "gamma",
        firstMemberAgentId: "alpha",
      }),
    ).toMatchObject({
      reason: "slash",
      explicitAgentIds: ["alpha"],
      recentOnlyAgentIds: [],
      dispatchAgentIds: ["alpha"],
    });
  });

  it("unions explicit mentions with recent participants and dedupes each assistant once", () => {
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: members,
        mentionedAgentIds: ["beta", "alpha", "beta"],
        quotedAgentId: "gamma",
        recentParticipantAgentIds: ["gamma", "beta", "departed"],
      }),
    ).toMatchObject({
      reason: "mention",
      explicitAgentIds: ["beta", "alpha"],
      recentOnlyAgentIds: ["gamma"],
      dispatchAgentIds: ["beta", "alpha", "gamma"],
    });
  });

  it("unions a quote without mention with recent participants", () => {
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: members,
        quotedAgentId: "gamma",
        recentParticipantAgentIds: ["alpha", "gamma"],
        defaultResponderAgentId: "alpha",
      }),
    ).toMatchObject({
      reason: "quote",
      explicitAgentIds: ["gamma"],
      recentOnlyAgentIds: ["alpha"],
      dispatchAgentIds: ["gamma", "alpha"],
    });
  });

  it("dispatches every recent participant on a plain message", () => {
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: members,
        recentParticipantAgentIds: ["gamma", "alpha", "gamma"],
        defaultResponderAgentId: "beta",
        firstMemberAgentId: "alpha",
      }),
    ).toMatchObject({
      reason: "recent",
      explicitAgentIds: [],
      recentOnlyAgentIds: ["gamma", "alpha"],
    });
  });

  it("falls back to one default responder, else the first member", () => {
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: members,
        defaultResponderAgentId: "beta",
        firstMemberAgentId: "alpha",
      }),
    ).toMatchObject({ reason: "default_responder", dispatchAgentIds: ["beta"] });
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: members,
        defaultResponderAgentId: "departed",
        firstMemberAgentId: "alpha",
      }),
    ).toMatchObject({ reason: "first_member", dispatchAgentIds: ["alpha"] });
  });

  it("returns null only when the chat has no members, and ignores departed ones", () => {
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: new Set(),
        mentionedAgentIds: ["alpha"],
        firstMemberAgentId: "alpha",
      }),
    ).toBeNull();
    expect(
      resolveOrdinaryChannelRoute({
        memberAgentIds: members,
        mentionedAgentIds: ["departed"],
        quotedAgentId: "gone",
        recentParticipantAgentIds: ["stale"],
        defaultResponderAgentId: "stale",
        firstMemberAgentId: "beta",
      }),
    ).toMatchObject({ reason: "first_member", dispatchAgentIds: ["beta"] });
  });
});
