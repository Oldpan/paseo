import { z } from "zod";
import type { AssistantBrowserConfig } from "../shared/contracts";
import {
  type MemberBrowserOperation,
  memberBrowserAction,
  memberBrowserCall,
  memberBrowserOperationSchema,
  memberBrowserState,
} from "../shared/member";
import { type AssistantBrowserManager, browserStepSchema } from "./browser";

export {
  type MemberBrowserOperation,
  memberBrowserAction,
  memberBrowserCall,
  memberBrowserOperationSchema,
  memberBrowserState,
};

function optStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export async function executeMemberBrowserOperation(
  manager: AssistantBrowserManager,
  input: {
    assistantId: string;
    homeDir: string;
    operation: MemberBrowserOperation;
    policy?: Partial<AssistantBrowserConfig>;
    payload?: Record<string, unknown>;
  },
): Promise<unknown> {
  const payload = input.payload ?? {};
  const base = {
    assistantId: input.assistantId,
    homeDir: input.homeDir,
    policy: input.policy,
    includeScreenshot: Boolean(payload.includeScreenshot),
  };
  switch (input.operation) {
    case "open":
      return manager.open({ ...base, url: String(payload.url ?? "") });
    case "tabs":
      return manager.tabs({
        assistantId: input.assistantId,
        homeDir: input.homeDir,
        index: optNum(payload.index),
      });
    case "close":
      return manager.closeTab({
        assistantId: input.assistantId,
        homeDir: input.homeDir,
        index: optNum(payload.index),
      });
    case "observe":
      return manager.observe(base);
    case "click":
      return manager.click({
        ...base,
        ref: optStr(payload.ref),
        x: optNum(payload.x),
        y: optNum(payload.y),
      });
    case "fill":
      return manager.fill({
        ...base,
        ref: String(payload.ref ?? ""),
        value: String(payload.value ?? ""),
      });
    case "press":
      return manager.press({ ...base, key: String(payload.key ?? "Enter") });
    case "scroll":
      return manager.scroll({ ...base, deltaY: optNum(payload.deltaY) });
    case "wait":
      return manager.wait({
        ...base,
        text: optStr(payload.text),
        urlIncludes: optStr(payload.urlIncludes),
        ms: optNum(payload.ms),
      });
    case "steps":
      return manager.steps({
        ...base,
        steps: z.array(browserStepSchema).min(1).max(15).parse(payload.steps),
      });
  }
}
