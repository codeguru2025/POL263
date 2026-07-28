/**
 * Shared SMTP email sending.
 * Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM in environment.
 * Falls back gracefully (no-op) if SMTP is not configured — callers should check
 * the return value rather than assume delivery.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { structuredLog } from "./logger";

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  fromName?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

let cachedTransporter: Transporter | null | undefined;

export function getTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    cachedTransporter = null;
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
  return cachedTransporter;
}

export function isEmailConfigured(): boolean {
  return getTransporter() !== null;
}

/** Send an email. Returns ok:false (never throws) if SMTP isn't configured or the send fails. */
export async function sendEmail(opts: SendEmailOptions): Promise<{ ok: boolean; message: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, message: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT and EMAIL_FROM in your environment variables." };
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  try {
    await transporter.sendMail({
      from: opts.fromName ? `"${opts.fromName}" <${from}>` : from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    structuredLog("info", "Email sent", { to: opts.to, subject: opts.subject });
    return { ok: true, message: `Email sent to ${opts.to}` };
  } catch (err: any) {
    structuredLog("error", "Email send failed", { error: err?.message, to: opts.to, subject: opts.subject });
    return { ok: false, message: `Email failed: ${err?.message}` };
  }
}
