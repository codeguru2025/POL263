import { storage } from "./storage";
import { structuredLog } from "./logger";

export async function notifyClient(orgId: string, clientId: string, subject: string, body: string, channel = "in_app") {
  try {
    await storage.createNotificationLog(orgId, {
      recipientType: "client",
      recipientId: clientId,
      channel,
      subject,
      body,
      status: "sent",
    });
  } catch (err) {
    structuredLog("error", "Failed to create notification log", { error: (err as Error).message, orgId, clientId });
  }
}
