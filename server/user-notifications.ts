/**
 * User (staff / agent) notification helper.
 *
 * Call notifyUser() anywhere in routes.ts or outbox-handlers.ts to:
 *  1. Persist a row in user_notifications (the agent-app inbox)
 *  2. Push to the user's registered Expo device tokens
 *  3. Emit an SSE event if the user has an open browser/app tab
 *
 * Notification types (kept in sync with agent-app UI):
 *   TRIP_ASSIGNED | CLAIM_SUBMITTED | CLAIM_STATUS | APPROVAL_NEEDED |
 *   APPROVAL_RESOLVED | PAYMENT_RECEIVED | COMMISSION_EARNED |
 *   POLICY_ISSUED | ATTENDANCE_RESOLVED | GENERAL
 */

import { storage } from "./storage";
import { pushToUser } from "./push";
import { sseEmit } from "./sse";
import { structuredLog } from "./logger";

export interface UserNotifyPayload {
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export async function notifyUser(
  orgId: string,
  userId: string,
  payload: UserNotifyPayload
): Promise<void> {
  try {
    const row = await storage.createUserNotification({
      organizationId: orgId,
      recipientId: userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      metadata: payload.metadata ?? null,
      isRead: false,
    });

    // SSE — instant delivery if user has an open connection
    const unread = await storage.getUnreadUserNotificationCount(orgId, userId);
    sseEmit(userId, {
      type: "notification",
      id: row.id,
      title: payload.title,
      body: payload.body,
      metadata: (payload.metadata ?? {}) as Record<string, unknown>,
      unreadCount: unread,
      createdAt: row.createdAt.toISOString(),
    });

    // Push — background delivery to locked-screen device
    await pushToUser(orgId, userId, {
      title: payload.title,
      body: payload.body,
      data: { type: payload.type, id: row.id, ...(payload.metadata ?? {}) },
    });
  } catch (err) {
    structuredLog("error", "notifyUser failed", { orgId, userId, error: (err as Error).message });
  }
}

/**
 * Notify every user in the org that has a given permission.
 * Useful for broadcasting to "all claims managers" or "all branch managers".
 */
export async function notifyUsersWithPermission(
  orgId: string,
  permission: string,
  payload: UserNotifyPayload
): Promise<void> {
  try {
    const users = await storage.getUsersWithPermission(orgId, permission);
    await Promise.all(users.map((u) => notifyUser(orgId, u.id, payload)));
  } catch (err) {
    structuredLog("error", "notifyUsersWithPermission failed", { orgId, permission, error: (err as Error).message });
  }
}
