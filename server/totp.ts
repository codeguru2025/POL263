/**
 * TOTP (authenticator-app MFA) helpers — a single wrapper around otplib so the verification
 * tolerance is defined in exactly one place.
 *
 * WHY THIS EXISTS: otplib v13's verify() defaults to epochTolerance:0 — it accepts a code ONLY
 * if it was generated in the server's exact current 30-second window. No allowance for the
 * clock drift between the DigitalOcean server and the user's phone, or the few seconds a human
 * takes to read six digits and press submit. That made MFA login fail intermittently for
 * well-synced users and completely for anyone whose device clock had drifted. RFC 6238 §5.2
 * explicitly recommends a validation window for exactly this; ±1 step (30s) is the standard.
 * See docs/BUGFIX-LOG.md.
 */
import { generateSecret, generateURI, verify } from "otplib";

/** ±1 time-step tolerance, in seconds. otplib's epochTolerance is seconds, not steps. */
export const TOTP_EPOCH_TOLERANCE_SEC = 30;

/** New base32 TOTP secret for enrollment. */
export function generateTotpSecret(): string {
  return generateSecret();
}

/** otpauth:// URI for the enrollment QR code. */
export function generateTotpUri(opts: { issuer: string; label: string; secret: string }): string {
  return generateURI(opts);
}

/**
 * Verify a submitted 6-digit code against a stored secret, allowing ±1 step of clock skew.
 * Returns a plain boolean — never throws.
 */
export async function verifyTotpCode(secret: string | null | undefined, token: string | null | undefined): Promise<boolean> {
  const s = typeof secret === "string" ? secret : "";
  const t = typeof token === "string" ? token.trim() : "";
  if (!s || !t) return false;
  try {
    const result = await verify({ secret: s, token: t, epochTolerance: TOTP_EPOCH_TOLERANCE_SEC });
    return !!result?.valid;
  } catch {
    return false;
  }
}
