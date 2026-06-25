/**
 * Push notification dispatch — Expo Push API.
 *
 * Sends to both user (staff/agent) and client device tokens.
 * Handles chunking, error logging, and token cleanup on
 * DeviceNotRegistered errors.
 *
 * Upgrade path for >500 concurrent users:
 *   Replace direct Expo HTTP calls here with a Redis queue
 *   (Bull/BullMQ). Workers dequeue and call Expo in parallel.
 *   Set PUSH_BACKEND=redis in env. No API contract changes.
 */

import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { storage } from "./storage";
import { structuredLog } from "./logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExpoClass: typeof Expo = (Expo as any).default ?? Expo;
const expo = new ExpoClass();

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

/** Send push to all registered devices for a staff/agent user. */
export async function pushToUser(
  orgId: string,
  userId: string,
  payload: PushPayload
): Promise<void> {
  const tokens = await storage.getUserDeviceTokens(orgId, userId);
  if (!tokens.length) return;
  await _dispatch(
    tokens.map((t) => t.token),
    payload,
    async (bad) => storage.removeUserDeviceToken(bad)
  );
}

/** Send push to all registered devices for a client. */
export async function pushToClient(
  orgId: string,
  clientId: string,
  payload: PushPayload
): Promise<void> {
  const tokens = await storage.getClientDeviceTokens(orgId, clientId);
  if (!tokens.length) return;
  await _dispatch(
    tokens.map((t) => t.token),
    payload,
    async (bad) => storage.removeClientDeviceToken(orgId, bad)
  );
}

/** Fan-out push to every user in an org that has a device token. */
export async function pushToOrgUsers(
  orgId: string,
  payload: PushPayload,
  filter?: (userId: string) => boolean
): Promise<void> {
  const tokens = await storage.getAllUserDeviceTokensByOrg(orgId);
  const filtered = filter ? tokens.filter((t) => filter(t.userId)) : tokens;
  if (!filtered.length) return;
  await _dispatch(
    filtered.map((t) => t.token),
    payload,
    async (bad) => storage.removeUserDeviceToken(bad)
  );
}

async function _dispatch(
  tokens: string[],
  payload: PushPayload,
  onInvalid: (token: string) => Promise<void>
): Promise<void> {
  const valid = tokens.filter((t) => ExpoClass.isExpoPushToken(t));
  if (!valid.length) return;

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound ?? "default",
    badge: payload.badge,
    priority: "high",
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    try {
      const batch = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...batch);
    } catch (err) {
      structuredLog("error", "Expo push chunk failed", { error: (err as Error).message });
    }
  }

  // Handle DeviceNotRegistered — remove stale tokens
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === "error") {
      structuredLog("warn", "Push ticket error", { details: ticket.details, message: ticket.message });
      if ((ticket.details as any)?.error === "DeviceNotRegistered") {
        try { await onInvalid(valid[i]); } catch { /* best-effort */ }
      }
    }
  }
}
