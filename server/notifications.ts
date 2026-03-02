import { storage } from "./storage";

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
  } catch {}
}
