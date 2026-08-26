/**
 * WhatsApp Cloud API sending — one platform-level Meta WhatsApp Business account, unlike
 * server/sms-service.ts's per-tenant model. This is used for internal staff/agent MFA fallback,
 * not a client-facing tenant feature, so a single business account is the right shape (same
 * account POL263's own Meta Business verification is being completed against).
 *
 * Never throws — callers check the returned {ok, message}, same contract as sms-service.ts.
 *
 * WhatsApp's Cloud API does not allow arbitrary free-form text for a business-initiated message
 * (only replies within an open 24h customer-service window can be free-form) — an OTP send must
 * use a pre-approved "Authentication" message template from Meta Business Manager. This sends a
 * single body parameter (the code) against WHATSAPP_OTP_TEMPLATE_NAME; if the approved template
 * also uses the "one-tap autofill" button variant, that needs an extra button component added
 * here once the exact template is known (see Meta's Authentication Templates docs) — not built
 * blind since the template doesn't exist yet as of this writing (business verification pending).
 */
import { structuredLog } from "./logger";

export interface SendWhatsAppOtpOptions {
  to: string;
  code: string;
}

interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  templateLang: string;
}

function getConfig(): WhatsAppConfig {
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    templateName: process.env.WHATSAPP_OTP_TEMPLATE_NAME || "otp_code",
    templateLang: process.env.WHATSAPP_OTP_TEMPLATE_LANG || "en_US",
  };
}

export function isWhatsAppConfigured(): boolean {
  const c = getConfig();
  return !!c.accessToken && !!c.phoneNumberId;
}

/** Strips everything but digits — Cloud API expects a plain E.164-style number, no '+'/spaces. */
function normalizePhoneForWhatsApp(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

export async function sendWhatsAppOtp(opts: SendWhatsAppOtpOptions): Promise<{ ok: boolean; message: string }> {
  const { accessToken, phoneNumberId, templateName, templateLang } = getConfig();
  if (!accessToken || !phoneNumberId) {
    return { ok: false, message: "WhatsApp is not configured yet (pending Meta Business verification)." };
  }
  const to = normalizePhoneForWhatsApp(opts.to);
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: [
            { type: "body", parameters: [{ type: "text", text: opts.code }] },
          ],
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      structuredLog("error", "WhatsApp OTP send failed", { status: res.status, error: data?.error?.message, to });
      return { ok: false, message: data?.error?.message || `WhatsApp send failed: HTTP ${res.status}` };
    }
    structuredLog("info", "WhatsApp OTP sent", { to, messageId: data?.messages?.[0]?.id });
    return { ok: true, message: "sent" };
  } catch (err) {
    structuredLog("error", "WhatsApp OTP send threw", { error: (err as Error).message, to });
    return { ok: false, message: "WhatsApp send failed" };
  }
}
