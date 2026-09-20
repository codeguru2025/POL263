/**
 * Shared SMTP email sending.
 * Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM in environment.
 * Falls back gracefully (no-op) if SMTP is not configured — callers should check
 * the return value rather than assume delivery.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { structuredLog } from "./logger";

/**
 * Escapes a value for safe interpolation into an HTML email body. Every caller building an
 * `html` string by interpolating user/client-entered data (names, addresses, free-text notes)
 * needs this — plain string substitution with no escaping lets a client whose stored name/field
 * contains markup have it render verbatim (including injected links/scripts, depending on the
 * mail client) in every automated email about them.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  fromName?: string;
  /** Overrides the default EMAIL_FROM address — e.g. a tenant's own verified domain
   *  (organizations.emailFromAddress, resolved via server/tenant-email-sending.ts) so a
   *  notification/PDF email comes from the tenant's own domain instead of the shared platform
   *  address. Must be paired with `apiKeyOverride` for a domain other than the platform's own —
   *  see that comment below. */
  from?: string;
  /** A Resend API key scoped to `from`'s domain, when it isn't the platform's own. The platform's
   *  own SMTP_PASS is deliberately a "sending access" key restricted to just its one domain (see
   *  .env.example) — the same Resend account can hold many verified domains, but a
   *  domain-restricted key can only ever send from the one domain it was scoped to, so sending
   *  from a tenant's own domain needs a second, separately-scoped key, not just a different
   *  `from` address (confirmed empirically: the platform key gets "550 This API key is not
   *  authorized to send emails from <domain>" otherwise). Builds a separate, cached-per-key
   *  transporter rather than touching the platform's own cached one. */
  apiKeyOverride?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

let cachedTransporter: Transporter | null | undefined;
const overrideTransporters = new Map<string, Transporter>();

function buildTransporter(user: string, pass: string): Transporter {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
}

export function getTransporter(): Transporter | null {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    cachedTransporter = null;
    return null;
  }

  cachedTransporter = buildTransporter(user, pass);
  return cachedTransporter;
}

/** A transporter using a per-tenant API key instead of the platform's own — same relay host, same
 *  SMTP "resend" username convention, different credential. Cached per key so a tenant with a
 *  steady stream of outbound email doesn't reconnect every send. */
function getOverrideTransporter(apiKey: string): Transporter {
  const existing = overrideTransporters.get(apiKey);
  if (existing) return existing;
  const transporter = buildTransporter(process.env.SMTP_USER || "resend", apiKey);
  overrideTransporters.set(apiKey, transporter);
  return transporter;
}

export function isEmailConfigured(): boolean {
  return getTransporter() !== null;
}

/** Send an email. Returns ok:false (never throws) if SMTP isn't configured or the send fails. */
export async function sendEmail(opts: SendEmailOptions): Promise<{ ok: boolean; message: string }> {
  const transporter = opts.apiKeyOverride ? getOverrideTransporter(opts.apiKeyOverride) : getTransporter();
  if (!transporter) {
    return { ok: false, message: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT and EMAIL_FROM in your environment variables." };
  }

  const from = opts.from || process.env.EMAIL_FROM || process.env.SMTP_USER;

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
