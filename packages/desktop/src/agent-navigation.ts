import { parseAgentDeepLink, type AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";

export function parseDesktopAgentDeepLink(
  input: string,
  scheme = "paseo",
): AgentDeepLinkTarget | null {
  if (!input.startsWith(`${scheme}:`)) return null;
  return parseAgentDeepLink(`paseo:${input.slice(scheme.length + 1)}`);
}

export function parseAgentDeepLinkFromArgv(
  argv: string[],
  scheme = "paseo",
): AgentDeepLinkTarget | null {
  for (const arg of argv) {
    const target = parseDesktopAgentDeepLink(arg, scheme);
    if (target) {
      return target;
    }
  }
  return null;
}

export class AgentNavigationInbox {
  private readonly readyWindows = new Set<number>();
  private readonly pendingByWindow = new Map<number, AgentDeepLinkTarget>();

  windowLoading(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
  }

  windowReady(webContentsId: number): AgentDeepLinkTarget | null {
    this.readyWindows.add(webContentsId);
    const pending = this.pendingByWindow.get(webContentsId) ?? null;
    this.pendingByWindow.delete(webContentsId);
    return pending;
  }

  deliverOrQueue(webContentsId: number, target: AgentDeepLinkTarget): AgentDeepLinkTarget | null {
    if (this.readyWindows.has(webContentsId)) {
      return target;
    }
    this.pendingByWindow.set(webContentsId, target);
    return null;
  }

  removeWindow(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
    this.pendingByWindow.delete(webContentsId);
  }
}
