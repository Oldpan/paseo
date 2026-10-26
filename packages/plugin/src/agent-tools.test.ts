import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as sdk from "./index.js";

describe("defineAgentTool", () => {
  const schemas = { input: z.object({}), output: z.object({}) };

  it("is published from the shared root entry", () => {
    expect(typeof sdk.defineAgentTool).toBe("function");
  });

  it("keeps the schemas and trims name and description", () => {
    const tool = sdk.defineAgentTool({ name: " whoami ", description: " Who am I ", ...schemas });
    expect(tool).toEqual({ name: "whoami", description: "Who am I", ...schemas });
  });

  it.each(["Whoami", "who-am-i", "1who", "", "a".repeat(42)])("rejects the name %j", (name) => {
    expect(() => sdk.defineAgentTool({ name, description: "x", ...schemas })).toThrow(
      "Invalid plugin agent tool name",
    );
  });

  it("requires a description", () => {
    expect(() => sdk.defineAgentTool({ name: "ping", description: "  ", ...schemas })).toThrow(
      "requires a description",
    );
  });
});
