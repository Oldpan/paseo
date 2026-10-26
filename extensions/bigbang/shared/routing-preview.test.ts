import { describe, expect, it } from "vitest";
import { formatResponderHint, formatRouteHint, previewRoute } from "./routing-preview";

const members = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Carol" },
];

describe("previewRoute", () => {
  it("names explicit mentions and keeps recent participants as recent only", () => {
    expect(
      previewRoute({
        members,
        content: "@Beta @Unknown @Alpha @Beta compare",
        recentParticipantIds: ["c", "b"],
      }),
    ).toEqual({ leadId: "b", explicitIds: ["b", "a"], recentOnlyIds: ["c"], reason: "mention" });
  });

  it("routes a quote to the quoted assistant and ignores a quoted non-member", () => {
    expect(previewRoute({ members, content: "why?", quotedSenderId: "c" })).toMatchObject({
      explicitIds: ["c"],
      reason: "quote",
    });
    expect(previewRoute({ members, content: "why?", quotedSenderId: "user" })).toMatchObject({
      explicitIds: ["a"],
      reason: "first_member",
    });
  });

  it("expands @all and falls back to the default responder, then the first member", () => {
    expect(previewRoute({ members, content: "@all hi" })?.explicitIds).toEqual(["a", "b", "c"]);
    expect(previewRoute({ members, content: "hi", defaultResponderId: "c" })).toMatchObject({
      explicitIds: ["c"],
      reason: "default_responder",
    });
    expect(previewRoute({ members, content: "hi" })?.reason).toBe("first_member");
    expect(previewRoute({ members: [], content: "hi" })).toBeNull();
  });
});

describe("responder hints", () => {
  it("formats recent, mixed, fallback and ordered hints", () => {
    expect(formatResponderHint({ explicitNames: [], recentNames: ["Alice", "Bob", "Carol"] })).toBe(
      "@Alice and 2 others may reply.",
    );
    expect(
      formatResponderHint({ explicitNames: ["Bob"], recentNames: ["Alice", "Bob", "Carol"] }),
    ).toBe("@Bob will reply; 2 active assistants may also respond.");
    expect(formatResponderHint({ explicitNames: ["Bob"], recentNames: ["Alice"] })).toBe(
      "@Bob will reply; 1 active assistant may also respond.",
    );
    expect(formatResponderHint({ explicitNames: ["Alice", "Bob"], recentNames: [] })).toBe(
      "@Alice and @Bob may reply.",
    );
    expect(
      formatResponderHint({
        explicitNames: ["Alice", "Bob"],
        recentNames: ["Carol"],
        discussInOrder: true,
      }),
    ).toBe("@Alice and @Bob will discuss in order.");
    expect(formatResponderHint({ explicitNames: [], recentNames: [] })).toBeNull();
  });

  it("describes a route by member name", () => {
    const preview = previewRoute({ members, content: "@Beta hi", recentParticipantIds: ["a"] });
    expect(formatRouteHint(preview, members)).toBe(
      "@Beta will reply; 1 active assistant may also respond.",
    );
    expect(formatRouteHint(previewRoute({ members, content: "hi" }), members)).toBe(
      "@Alpha will reply.",
    );
    expect(formatRouteHint(null, members)).toBeNull();
  });
});
