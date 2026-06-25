/**
 * Expo Push Notifications setup.
 *
 * Call initPushNotifications() once after the user logs in.
 * It requests permissions, gets the Expo push token, and POSTs
 * it to /api/agent-auth/push-token so the server can reach this device.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiPost } from "../api";
import { structuredLog } from "./logger";

// Control how notifications appear when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function initPushNotifications(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await apiPost("/api/agent-auth/push-token", {
      token,
      platform: Platform.OS,
    });
    return token;
  } catch (err: any) {
    structuredLog("warn", "Push token registration failed", { error: err?.message });
    return null;
  }
}

/** Same as initPushNotifications but registers via the client-auth endpoint. */
export async function initClientPushNotifications(): Promise<string | null> {
  if (Platform.OS === "web") return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await apiPost("/api/client-auth/push-token", { token, platform: Platform.OS });
    return token;
  } catch (err: any) {
    structuredLog("warn", "Client push token registration failed", { error: err?.message });
    return null;
  }
}

/** Set the app icon badge number. */
export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch { /* not supported on all platforms */ }
}

/** Clear the badge (e.g., when user opens the notifications screen). */
export async function clearBadge(): Promise<void> {
  await setBadgeCount(0);
}
