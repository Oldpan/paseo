import { buildHostRootRoute } from "@/utils/host-routes";
import type { NotificationOpenSource, NotificationTap } from "./source";

export const WEB_NOTIFICATION_CLICK_EVENT = "paseo:web-notification-click";

export type NotificationOpenTarget =
  | { kind: "agent"; serverId: string; agentId: string }
  | { kind: "terminal"; serverId: string; workspaceId: string; terminalId: string }
  | {
      kind: "pavra";
      serverId: string;
      section: "inbox" | "chat";
      conversationId?: string;
      threadId?: string | null;
    }
  | { kind: "host"; serverId: string };

function readId(data: object, key: string): string {
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseNotificationOpenTarget(data: unknown): NotificationOpenTarget | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const serverId = readId(data, "serverId");
  if (!serverId) return null;
  const pavraSection = readId(data, "pavraSection");
  const pavraConversationId = readId(data, "pavraConversationId");
  const pavraThreadId = readId(data, "pavraThreadId");
  if (pavraSection === "inbox" || pavraSection === "chat" || pavraConversationId) {
    return {
      kind: "pavra",
      serverId,
      section: pavraSection === "inbox" ? "inbox" : "chat",
      ...(pavraConversationId ? { conversationId: pavraConversationId } : {}),
      threadId: pavraThreadId || null,
    };
  }
  const workspaceId = readId(data, "workspaceId");
  const terminalId = readId(data, "terminalId");
  if (workspaceId && terminalId) return { kind: "terminal", serverId, workspaceId, terminalId };
  const agentId = readId(data, "agentId");
  if (agentId) return { kind: "agent", serverId, agentId };
  return { kind: "host", serverId };
}

export function buildPavraNotificationRoute(
  target: Extract<NotificationOpenTarget, { kind: "pavra" }>,
): string {
  const params = new URLSearchParams();
  params.set("serverId", target.serverId);
  params.set("section", target.section);
  if (target.conversationId) {
    params.set("chatId", target.conversationId);
  }
  if (target.threadId) {
    params.set("threadId", target.threadId);
  }
  return `/pavra?${params.toString()}`;
}

interface NotificationOpenRouterDeps {
  source: NotificationOpenSource;
  openAgent: (target: { serverId: string; agentId: string }) => void;
  openRoute: (route: string) => void;
  openTerminal: (target: Extract<NotificationOpenTarget, { kind: "terminal" }>) => void;
  openPavra?: (target: Extract<NotificationOpenTarget, { kind: "pavra" }>) => void;
  whenReadyToNavigate: () => Promise<void>;
}

export function createNotificationOpenRouter(deps: NotificationOpenRouterDeps) {
  const handledIds = new Set<string>();
  let launchTaken = false;
  async function receive(tap: NotificationTap) {
    if (handledIds.has(tap.id)) return;
    handledIds.add(tap.id);
    await deps.whenReadyToNavigate();
    const target = parseNotificationOpenTarget(tap.data);
    if (target?.kind === "agent") {
      deps.openAgent({ serverId: target.serverId, agentId: target.agentId });
    } else if (target?.kind === "terminal") {
      deps.openTerminal(target);
    } else if (target?.kind === "pavra") {
      deps.openPavra?.(target);
      deps.openRoute(buildPavraNotificationRoute(target));
    } else if (target?.kind === "host") {
      deps.openRoute(buildHostRootRoute(target.serverId));
    }
    deps.source.acknowledge(tap);
  }
  return {
    start() {
      const unsubscribe = deps.source.subscribe((tap) => {
        void receive(tap);
      });
      if (!launchTaken) {
        launchTaken = true;
        void deps.source.takeLaunchTap().then((tap) => {
          return tap ? receive(tap) : undefined;
        });
      }
      return unsubscribe;
    },
  };
}
