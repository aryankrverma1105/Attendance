import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";

// Configure foreground presentation behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Registers for push notifications and returns the Expo push token if available.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") {
    return null;
  }

  try {
    // 1. Configure Android Notification Channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "FieldPulse Workforce Alerts",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#D97706",
      });
    }

    // 2. Request Permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.warn("[Push] Notification permission not granted.");
      return null;
    }

    // 3. Obtain Expo Push Token
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId ||
      "70259b92-a6b4-4b09-8a28-6b7d9dd88cd2";

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenData.data;
  } catch (error) {
    console.warn("[Push] Error obtaining push token:", error);
    return null;
  }
}

/**
 * Initializes notification listeners for tap / deep-linking navigation.
 */
export function setupNotificationListeners(onNavigate?: (route: string) => void) {
  // Listener for user tapping on notification
  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.type === "task" && data.taskId) {
      router.push(`/tasks`);
    } else if (data?.type === "visit" && data.visitId) {
      router.push(`/(tabs)/visits`);
    } else if (data?.type === "chat") {
      router.push(`/chat`);
    } else if (data?.route && typeof data.route === "string") {
      router.push(data.route as any);
    }
  });

  return () => {
    responseSubscription.remove();
  };
}
