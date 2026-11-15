import { useEffect, useRef, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import type { ChatState } from "../../../../extensions/pavra/shared/contracts";
import { isNative, isWeb } from "@/constants/platform";
import { WEB_NOTIFICATION_CLICK_EVENT } from "@/notification-open";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { IS_PAVRA } from "./build";
import { createPavraKeepaliveController } from "./keepalive-service";
import {
  createPavraNotificationTracker,
  type PavraNotificationEvent,
  type PavraNotificationTarget,
} from "./notifications";
import type { SidebarSection } from "./store";

export const PAVRA_NOTIFICATION_CHANNEL_ID = "pavra-alerts";

function isAppForeground(appState: AppStateStatus): boolean {
  if (appState !== "active") return false;
  if (isWeb && typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  return true;
}

let nativeSetupPromise: Promise<typeof import("expo-notifications") | null> | null = null;

async function ensureNativeNotificationsReady(): Promise<
  typeof import("expo-notifications") | null
> {
  if (!isNative) return null;
  if (nativeSetupPromise) return nativeSetupPromise;

  nativeSetupPromise = (async () => {
    try {
      const Notifications = await import("expo-notifications");
      const existing = await Notifications.getPermissionsAsync();
      let granted = existing.status === Notifications.PermissionStatus.GRANTED;
      if (!granted && existing.canAskAgain) {
        const requested = await Notifications.requestPermissionsAsync();
        granted = requested.status === Notifications.PermissionStatus.GRANTED;
      }
      if (!granted) return null;

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(PAVRA_NOTIFICATION_CHANNEL_ID, {
          name: "Pavra Alerts",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
        });
      }
      return Notifications;
    } catch {
      return null;
    }
  })();

  return nativeSetupPromise;
}

function targetToData(target: PavraNotificationTarget): Record<string, unknown> {
  return {
    serverId: target.serverId,
    pavraSection: target.pavraSection,
    ...(target.pavraConversationId ? { pavraConversationId: target.pavraConversationId } : {}),
    pavraThreadId: target.pavraThreadId ?? null,
  };
}

async function emitPavraNotification(event: PavraNotificationEvent): Promise<void> {
  const data = targetToData(event.target);

  if (isNative) {
    const Notifications = await ensureNativeNotificationsReady();
    if (!Notifications) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: event.title,
        body: event.body,
        sound: "default",
        data,
      },
      trigger: null,
    });
    return;
  }

  if (isWeb && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const notification = new Notification(event.title, {
        body: event.body,
        data,
      });
      notification.addEventListener("click", () => {
        if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(WEB_NOTIFICATION_CLICK_EVENT, {
              detail: { id: event.key, data },
              cancelable: true,
            }),
          );
        }
      });
    } catch {
      // Ignore browser notification errors in restricted contexts
    }
  }
}

export function usePavraNotifications(input: {
  coordinatorId: string;
  state: ChatState;
  activeMode: "chat" | "studio" | "assistants";
  activeSection: SidebarSection;
  activeChatId: string;
  activeThreadId: string | null;
}): void {
  const { coordinatorId, state, activeMode, activeSection, activeChatId, activeThreadId } = input;
  const connected = useHostRuntimeIsConnected(coordinatorId);
  const hosts = useHosts();
  const coordinatorLabel = hosts.find((host) => host.serverId === coordinatorId)?.label;
  const trackerRef = useRef<ReturnType<typeof createPavraNotificationTracker> | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createPavraNotificationTracker();
  }
  const keepaliveRef = useRef<ReturnType<typeof createPavraKeepaliveController> | null>(null);
  if (!keepaliveRef.current) {
    keepaliveRef.current = createPavraKeepaliveController();
  }

  const [appActive, setAppActive] = useState<boolean>(() => isAppForeground(AppState.currentState));

  useEffect(() => {
    keepaliveRef.current?.update({
      isPavra: IS_PAVRA,
      platformOs: Platform.OS,
      coordinatorId,
      connected,
      coordinatorLabel,
    });
  }, [connected, coordinatorId, coordinatorLabel]);

  useEffect(() => {
    return () => {
      keepaliveRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (isNative) {
      void ensureNativeNotificationsReady();
    } else if (
      isWeb &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default" &&
      typeof Notification.requestPermission === "function"
    ) {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppActive(isAppForeground(nextState));
    });
    if (isWeb && typeof document !== "undefined") {
      const handleVisibility = () => {
        setAppActive(isAppForeground(AppState.currentState));
      };
      document.addEventListener("visibilitychange", handleVisibility);
      return () => {
        subscription.remove();
        document.removeEventListener("visibilitychange", handleVisibility);
      };
    }
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!coordinatorId || !state.generation) return;
    const emitted = trackerRef.current?.update(state, {
      coordinatorId,
      appActive,
      activeMode,
      activeSection,
      activeChatId,
      activeThreadId,
    });
    if (!emitted || emitted.length === 0) return;
    for (const event of emitted) {
      void emitPavraNotification(event);
    }
  }, [activeChatId, activeMode, activeSection, activeThreadId, appActive, coordinatorId, state]);
}
