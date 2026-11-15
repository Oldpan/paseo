import * as Notifications from "expo-notifications";
import type { NotificationOpenSource, NotificationTap } from "./source";

function toTap(response: Notifications.NotificationResponse): NotificationTap {
  return {
    id: response.notification.request.identifier,
    data: response.notification.request.content.data,
  };
}

export function createNotificationOpenSource(): NotificationOpenSource {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;
      const isPavra =
        typeof data === "object" &&
        data !== null &&
        (typeof Reflect.get(data, "pavraSection") === "string" ||
          typeof Reflect.get(data, "pavraConversationId") === "string");
      return {
        shouldShowAlert: isPavra,
        shouldShowBanner: isPavra,
        shouldShowList: true,
        shouldPlaySound: isPavra,
        shouldSetBadge: false,
      };
    },
  });
  return {
    subscribe(onTap) {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
        onTap(toTap(response)),
      );
      return () => subscription.remove();
    },
    async takeLaunchTap() {
      const response = await Notifications.getLastNotificationResponseAsync();
      return response ? toTap(response) : null;
    },
    acknowledge() {
      Notifications.clearLastNotificationResponse();
    },
  };
}
