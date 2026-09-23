/**
 * Cloudflare Turnstile (bot/abuse challenge) verification. Degrades gracefully — with no
 * TURNSTILE_SECRET_KEY configured, verification is a no-op pass (same pattern as
 * ANTHROPIC_API_KEY elsewhere: optional, doesn't block anything until set up).
 *
 * Fails CLOSED on a genuine verification failure (Cloudflare says the token is invalid/expired/
 * reused) — that's the actual bot signal. Fails OPEN on an infrastructure error (siteverify
 * unreachable/timeout) so a Cloudflare outage can't take down client login/registration.
 */
import { structuredLog } from "./logger";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

export function isTurnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export async function verifyTurnstileToken(token: unknown, remoteIp?: string): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true }; // not configured — no-op

  if (typeof token !== "string" || !token) {
    return { ok: false, reason: "Missing verification token" };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body, signal: controller.signal });
    const data = (await res.json()) as { success?: boolean; ["error-codes"]?: string[] };
    if (data.success) return { ok: true };
    structuredLog("warn", "Turnstile verification failed", { errorCodes: data["error-codes"] });
    return { ok: false, reason: "Verification failed — please try again" };
  } catch (err) {
    // Infra error (network/timeout/Cloudflare outage) — fail open, not a bot signal.
    structuredLog("error", "Turnstile siteverify request failed — failing open", { error: (err as Error).message });
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}
