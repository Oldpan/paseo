import { defineAgentTool } from "@getpaseo/plugin";
import { z } from "zod";
import { type Assistant, browserElementSchema } from "../shared/contracts";
import type { ToolCaller } from "./agent-tools";
import { browserStepSchema } from "./browser";
import type { Coordinator } from "./coordinator";

export const browserObservationOutputSchema = z.object({
  url: z.string().nullable(),
  title: z.string().nullable(),
  text: z.string().optional(),
  elements: z.array(browserElementSchema),
  screenshotDataUrl: z.string().nullable(),
});

export const browserTabInfoSchema = z.object({
  index: z.number(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
});

export const browserOpenTool = defineAgentTool({
  name: "browser_open",
  description:
    "Open an http:// or https:// URL in your persistent Chromium browser and return the current page's interactive elements and text.",
  input: z.object({
    url: z.string().trim().min(1).describe("The http:// or https:// URL to navigate to."),
    includeScreenshot: z
      .boolean()
      .optional()
      .describe("Pass true to also capture a compressed JPEG screenshot of the page."),
  }),
  output: browserObservationOutputSchema,
});

export const browserTabsTool = defineAgentTool({
  name: "browser_tabs",
  description:
    "List open tabs in your persistent Chromium browser, or switch to a tab by passing its index.",
  input: z.object({
    index: z.number().int().min(0).optional().describe("Optional tab index to switch to."),
  }),
  output: z.object({
    tabs: z.array(browserTabInfoSchema),
  }),
});

export const browserCloseTool = defineAgentTool({
  name: "browser_close",
  description: "Close a tab in your persistent Chromium browser (defaults to the active tab).",
  input: z.object({
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional tab index to close; defaults to the active tab."),
  }),
  output: z.object({
    tabs: z.array(browserTabInfoSchema),
  }),
});

export const browserObserveTool = defineAgentTool({
  name: "browser_observe",
  description:
    "Read the current page's URL, title, visible text, and interactive elements (labeled @e1, @e2, ...), optionally with a JPEG screenshot.",
  input: z.object({
    includeScreenshot: z
      .boolean()
      .optional()
      .describe("Pass true when layout is complex and you need a visual JPEG screenshot."),
  }),
  output: browserObservationOutputSchema,
});

export const browserClickTool = defineAgentTool({
  name: "browser_click",
  description:
    "Click an interactive element by its @eN ref from browser_observe (or by x/y coordinates) and return the updated page observation.",
  input: z.object({
    ref: z.string().optional().describe("Element reference from browser_observe, e.g. '@e1'."),
    x: z.number().optional().describe("Horizontal coordinate when clicking by position."),
    y: z.number().optional().describe("Vertical coordinate when clicking by position."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: browserObservationOutputSchema,
});

export const browserFillTool = defineAgentTool({
  name: "browser_fill",
  description:
    "Fill text into an input or textarea element identified by its @eN ref from browser_observe.",
  input: z.object({
    ref: z.string().min(1).describe("Element reference from browser_observe, e.g. '@e1'."),
    value: z.string().describe("The text value to fill into the field."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: browserObservationOutputSchema,
});

export const browserPressTool = defineAgentTool({
  name: "browser_press",
  description: "Press a keyboard key (such as 'Enter', 'Tab', 'Escape', 'ArrowDown') on the page.",
  input: z.object({
    key: z.string().min(1).describe("Key name to press, e.g. 'Enter'."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: browserObservationOutputSchema,
});

export const browserScrollTool = defineAgentTool({
  name: "browser_scroll",
  description: "Scroll the current page vertically by deltaY pixels (positive down, negative up).",
  input: z.object({
    deltaY: z.number().optional().describe("Vertical scroll delta in pixels (defaults to 500)."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: browserObservationOutputSchema,
});

export const browserWaitTool = defineAgentTool({
  name: "browser_wait",
  description:
    "Wait for specific text to appear on the page, for the URL to include a substring, or for a short duration (max 25s).",
  input: z.object({
    text: z.string().optional().describe("Visible text to wait for."),
    urlIncludes: z.string().optional().describe("URL substring to wait for."),
    ms: z
      .number()
      .int()
      .min(0)
      .max(25_000)
      .optional()
      .describe("Wait duration or timeout in milliseconds (max 25000)."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: browserObservationOutputSchema,
});

export const browserStepsTool = defineAgentTool({
  name: "browser_steps",
  description:
    "Execute 1 to 15 known browser steps sequentially within a single 25-second budget, returning the final page observation.",
  input: z.object({
    steps: z
      .array(browserStepSchema)
      .min(1)
      .max(15)
      .describe("Ordered list of 1–15 actions (open, click, fill, press, scroll, wait)."),
    includeScreenshot: z.boolean().optional(),
  }),
  output: z.object({
    completedSteps: z.number(),
    observation: browserObservationOutputSchema,
  }),
});

export const browserHandToUserTool = defineAgentTool({
  name: "browser_hand_to_user",
  description:
    "Pause browser automation and ask the user to take over when encountering a login wall, CAPTCHA, 2FA challenge, or payment/sensitive confirmation.",
  input: z.object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        "Short explanation of what the user needs to complete (e.g. 'Complete 2FA login').",
      ),
  }),
  output: z.object({
    status: z.literal("handed_to_user"),
    takeoverId: z.string(),
    instruction: z.string(),
  }),
});

export interface BrowserCaller {
  assistant: Assistant;
  conversationId: string;
  threadId: string | null;
  turnId: string | null;
}

interface Context {
  caller: ToolCaller;
}

export function authorizeBrowserCaller(
  coordinator: Coordinator,
  caller: ToolCaller,
): BrowserCaller {
  const { store } = coordinator;
  if (store.get("tasks", caller.agentId)) {
    throw new Error(
      "Task agents cannot use Chat assistant browser tools. Report what you need in your task result instead.",
    );
  }
  const session = store.getChatSessionByAgent(caller.agentId);
  if (!session || (session.serverId ?? null) !== (caller.serverId ?? null)) {
    throw new Error("This tool is only available to a Chat assistant in its chat.");
  }
  const assistant = store.get("assistants", session.assistantId);
  if (!assistant) {
    throw new Error("This assistant no longer exists.");
  }
  const conversation = store.get("conversations", session.conversationId);
  if (!conversation?.members.includes(assistant.id)) {
    throw new Error("You are no longer a member of this chat.");
  }
  if (!assistant.browser?.enabled) {
    throw new Error(
      "Browser access is not enabled for you. Ask the user to enable browser access in your assistant settings.",
    );
  }
  const liveTurn = coordinator.liveChatTurn(caller.agentId);
  return {
    assistant,
    conversationId: conversation.id,
    threadId: session.threadId,
    turnId: liveTurn?.id ?? null,
  };
}

export function browserOpenHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserOpenTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "open", input);
  };
}

export function browserTabsHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserTabsTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "tabs", input);
  };
}

export function browserCloseHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserCloseTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "close", input);
  };
}

export function browserObserveHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserObserveTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "observe", input);
  };
}

export function browserClickHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserClickTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "click", input);
  };
}

export function browserFillHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserFillTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "fill", input);
  };
}

export function browserPressHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserPressTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "press", input);
  };
}

export function browserScrollHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserScrollTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "scroll", input);
  };
}

export function browserWaitHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserWaitTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "wait", input);
  };
}

export function browserStepsHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserStepsTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    return coordinator.callAssistantBrowser(caller.assistant.id, "steps", input);
  };
}

export function browserHandToUserHandler(coordinator: Coordinator) {
  return async (input: z.output<typeof browserHandToUserTool.input>, context: Context) => {
    const caller = authorizeBrowserCaller(coordinator, context.caller);
    const takeover = await coordinator.requestBrowserTakeover({
      assistant: caller.assistant,
      conversationId: caller.conversationId,
      threadId: caller.threadId,
      turnId: caller.turnId,
      reason: input.reason,
    });
    return {
      status: "handed_to_user" as const,
      takeoverId: takeover.id,
      instruction:
        "A takeover card has been shown to the user. Briefly tell the user what they need to complete (e.g. login or verification) and end your turn now.",
    };
  };
}
