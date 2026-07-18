import { apiJson } from "./client";

export async function submitFeedback(type: "complaint" | "feedback", subject: string, message: string): Promise<void> {
  await apiJson("/api/client-auth/feedback", { method: "POST", body: JSON.stringify({ type, subject, message }) });
}
