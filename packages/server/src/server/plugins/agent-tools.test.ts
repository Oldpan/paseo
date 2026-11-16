import pino from "pino";
import { expect, test } from "vitest";
import { z } from "zod";
import { defineAgentTool } from "@getpaseo/plugin/server";
import { createPluginAgentTools, serializeAgentTool, toToolResult } from "./agent-tools.js";
import { serializePaseoToolInputParameters } from "../agent/tools/paseo-tool-serialization.js";

test("agent tool schemas survive the process boundary and catalog round trip", () => {
  const input = z
    .object({
      title: z.string().min(1).describe("Issue title"),
      state: z.enum(["open", "closed"]),
      tags: z.array(z.string()).optional(),
      nested: z.object({ enabled: z.boolean() }),
    })
    .describe("Create an issue");
  const tool = defineAgentTool({
    name: "create_issue",
    description: "Create",
    input,
    execute: () => ({ text: "done" }),
  });
  const metadata = JSON.parse(JSON.stringify(serializeAgentTool(tool)));
  const restored = z.fromJSONSchema(metadata.inputSchema);
  expect(
    serializePaseoToolInputParameters({
      ...metadata,
      inputSchema: restored,
      handler: async () => ({ content: [] }),
    }),
  ).toEqual({
    ...metadata.inputSchema,
    additionalProperties: {},
    properties: {
      ...metadata.inputSchema.properties,
      nested: { ...metadata.inputSchema.properties.nested, additionalProperties: {} },
    },
  });
  expect(restored.parse({ title: "Bug", state: "open", nested: { enabled: true } })).toEqual({
    title: "Bug",
    state: "open",
    nested: { enabled: true },
  });
  expect(
    restored.safeParse({ title: "", state: "unknown", nested: { enabled: true } }).success,
  ).toBe(false);
});

test("toToolResult extracts _images into MCP image content blocks and strips _images from text and structuredContent", () => {
  const jpegBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQ==";
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const result = toToolResult({
    deviceId: "pixel-8",
    packageName: "com.tencent.mm",
    elements: [{ ref: "@e1", text: "发送" }],
    _images: [
      { data: jpegBase64, mimeType: "image/jpeg" },
      { data: pngBase64, mimeType: "image/png" },
      { data: "", mimeType: "image/jpeg" },
      { data: "ignored", mimeType: "image/gif" },
    ],
  });

  expect(result.structuredContent).toEqual({
    deviceId: "pixel-8",
    packageName: "com.tencent.mm",
    elements: [{ ref: "@e1", text: "发送" }],
  });
  expect(result.structuredContent).not.toHaveProperty("_images");
  expect(result.content).toEqual([
    {
      type: "text",
      text: JSON.stringify({
        deviceId: "pixel-8",
        packageName: "com.tencent.mm",
        elements: [{ ref: "@e1", text: "发送" }],
      }),
    },
    {
      type: "image",
      data: jpegBase64,
      mimeType: "image/jpeg",
    },
    {
      type: "image",
      data: pngBase64,
      mimeType: "image/png",
    },
  ]);
  expect(result.content[0]?.text).not.toContain(jpegBase64);
  expect(result.content[0]?.text).not.toContain(pngBase64);
});

test("createPluginAgentTools delivers MCP image blocks when plugin tool returns _images", async () => {
  const screenshotBase64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//Z";
  const tools = createPluginAgentTools({
    callerAgentId: "agent-1",
    logger: pino({ level: "silent" }),
    runtime: {
      listAgentTools: () => [
        {
          pluginId: "pavra",
          tool: {
            name: "phone_observe",
            description: "Observe phone screen",
            inputSchema: z.toJSONSchema(z.object({ includeScreenshot: z.boolean().optional() }), {
              io: "input",
            }),
          },
        },
      ],
      callAgentTool: async () => ({
        packageName: "com.xingin.xhs",
        hasScreenshot: true,
        _images: [{ data: screenshotBase64, mimeType: "image/jpeg" }],
      }),
    },
  });

  expect(tools).toHaveLength(1);
  expect(tools[0]?.name).toBe("pavra-phone_observe");
  const outcome = await tools[0]!.handler({ includeScreenshot: true }, {});
  expect(outcome).toEqual({
    content: [
      {
        type: "text",
        text: JSON.stringify({ packageName: "com.xingin.xhs", hasScreenshot: true }),
      },
      {
        type: "image",
        data: screenshotBase64,
        mimeType: "image/jpeg",
      },
    ],
    structuredContent: {
      packageName: "com.xingin.xhs",
      hasScreenshot: true,
    },
  });
});
