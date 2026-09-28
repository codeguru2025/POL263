/**
 * Self-service password reset for the two non-OAuth sign-ins: portal clients (policy number +
 * password) and agents (email + password). Staff are Google-only and never get a password here.
 *
 * Stateless — no token table. Two credential shapes, both HMAC'd with SESSION_SECRET:
 *  - a link token (sent by email): signed {kind, id, orgId, exp, fp} payload.
 *  - a 6-digit code (sent by SMS, clients only): HMAC of the same identity over a time window,
 *    verified by recomputing it — like TOTP, keyed per account.
 * `fp` is a fingerprint of the account's current password hash, so both are single-use: the moment
 * the password changes, every outstanding link/code for that account stops verifying. Brute force
 * on the code is bounded by the same per-account lockout + authLimiter as login.
 */
import crypto from "crypto";

export type ResetSubjectKind = "client" | "agent";

export const RESET_LINK_TTL_MS = 30 * 60 * 1000;
/** SMS codes are accepted for the current and previous window, i.e. valid 10–20 minutes. */
const CODE_WINDOW_MS = 10 * 60 * 1000;

// Never fall back to a guessable constant: without SESSION_SECRET (dev only — auth.ts refuses to
// boot in production without it), links just stop working across a restart.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

function hmac(label: string, data: string): Buffer {
  return crypto.createHmac("sha256", SECRET).update(`pw-reset:v1:${label}:`).update(data).digest();
}

/** Short fingerprint of the current password hash (or of "no password yet"). */
export function passwordFingerprint(passwordHash: string | null | undefined): string {
  return crypto.createHash("sha256").update(passwordHash || "<none>").digest("base64url").slice(0, 16);
}

interface ResetTokenPayload {
  k: ResetSubjectKind;
  id: string;
  o: string;
  exp: number;
  fp: string;
}

export function createResetToken(
  subject: { kind: ResetSubjectKind; id: string; orgId: string; passwordHash: string | null | undefined },
  now: number = Date.now(),
): string {
  const payload: ResetTokenPayload = {
    k: subject.kind,
    id: subject.id,
    o: subject.orgId,
    exp: now + RESET_LINK_TTL_MS,
    fp: passwordFingerprint(subject.passwordHash),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac("link", body).toString("base64url")}`;
}

/** Returns the token's subject if the signature is valid and it hasn't expired. The caller must
 *  still load the account and check `fp` against its current hash (see isFingerprintCurrent). */
export function verifyResetToken(
  token: unknown,
  expectedKind: ResetSubjectKind,
  now: number = Date.now(),
): { id: string; orgId: string; fp: string } | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = hmac("link", body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  let payload: ResetTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.k !== expectedKind || typeof payload.id !== "string" || typeof payload.o !== "string") return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return { id: payload.id, orgId: payload.o, fp: payload.fp };
}

export function isFingerprintCurrent(fp: string, passwordHash: string | null | undefined): boolean {
  const current = Buffer.from(passwordFingerprint(passwordHash));
  const given = Buffer.from(String(fp));
  return given.length === current.length && crypto.timingSafeEqual(given, current);
}

function codeForWindow(kind: ResetSubjectKind, id: string, passwordHash: string | null | undefined, window: number): string {
  const n = hmac("code", `${kind}|${id}|${passwordFingerprint(passwordHash)}|${window}`).readUInt32BE(0);
  return String(n % 1_000_000).padStart(6, "0");
}

export function createResetCode(kind: ResetSubjectKind, id: string, passwordHash: string | null | undefined, now: number = Date.now()): string {
  return codeForWindow(kind, id, passwordHash, Math.floor(now / CODE_WINDOW_MS));
}

export function verifyResetCode(
  kind: ResetSubjectKind, id: string, passwordHash: string | null | undefined, code: unknown, now: number = Date.now(),
): boolean {
  const given = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(given)) return false;
  const w = Math.floor(now / CODE_WINDOW_MS);
  let ok = false;
  // Check both windows without short-circuiting so timing doesn't say which one matched.
  for (const win of [w, w - 1]) {
    const expected = Buffer.from(codeForWindow(kind, id, passwordHash, win));
    if (crypto.timingSafeEqual(expected, Buffer.from(given))) ok = true;
  }
  return ok;
}

/** Origin to build emailed reset links on. APP_BASE_URL in production — never the request's Host
 *  header there, which an attacker controls (a poisoned Host would mail the victim a link to the
 *  attacker's site carrying a live token). Only local dev falls back to the request's own origin. */
export function resetLinkOrigin(req: { protocol: string; get(name: string): string | undefined }): string | null {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (base) return base;
  if (process.env.NODE_ENV === "production") return null;
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : null;
}
