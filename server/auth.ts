import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import argon2 from "argon2";
import crypto from "crypto";
import { generateSecret as generateTotpSecret, generateURI as generateTotpURI, verify as verifyTotp } from "otplib";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { pool } from "./db";
import { storage } from "./storage";
import { getDbForOrg } from "./tenant-db";
import { users } from "@shared/schema";
import { structuredLog } from "./logger";
import { PLATFORM_OWNER_EMAIL } from "./constants";
import { isAgentScoped } from "@shared/roles";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants } from "@shared/control-plane-schema";
import { validatePasswordPolicy } from "@shared/validation";
import { auditLog, invalidateOtherSessions } from "./route-helpers";

const PgSession = connectPgSimple(session);

// One-time tokens for the mobile OAuth flow.
// On native, we can't use the external-browser session cookie in the WebView,
// so after OAuth we generate a short-lived token and let the WebView exchange it.
const mobileAuthTokens = new Map<string, { userId: string; orgId?: string; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  mobileAuthTokens.forEach((d, t) => { if (d.expiresAt < now) mobileAuthTokens.delete(t); });
}, 60_000).unref();

// Per-account lockout for agent (email/password) login. Complements the IP-based authLimiter in
// index.ts. DB-backed via users.failedLoginAttempts/lockedUntil (mirrors clients.lockedUntil's
// pattern in client-auth.ts) — safe under horizontal scaling, unlike a per-process in-memory
// counter, since every instance reads/writes the same row. Only ever enforced once a real user
// row has been located (an unrecognized login email has no row to lock against, same as the
// client-login path's behavior for an unrecognized policy number).
const AGENT_LOCKOUT_THRESHOLD = 5;
const AGENT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/** Returns ms remaining if the given user is currently locked, else 0. */
function agentLockRemaining(user: { lockedUntil: Date | string | null }): number {
  if (!user.lockedUntil) return 0;
  const remaining = new Date(user.lockedUntil).getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
}
async function recordAgentLoginFailure(userId: string, currentAttempts: number): Promise<void> {
  const attempts = (currentAttempts || 0) + 1;
  const data: { failedLoginAttempts: number; lockedUntil?: Date } = { failedLoginAttempts: attempts };
  if (attempts >= AGENT_LOCKOUT_THRESHOLD) {
    data.lockedUntil = new Date(Date.now() + AGENT_LOCKOUT_DURATION_MS);
  }
  await storage.updateUser(userId, data as any);
}
async function clearAgentLoginFailures(userId: string): Promise<void> {
  await storage.updateUser(userId, { failedLoginAttempts: 0, lockedUntil: null } as any);
}

// Global budget on the "scan every isolated-DB tenant" login fallback below — that loop's cost
// scales linearly with the number of isolated tenants, and unlike the per-email lockout above,
// an attacker can trivially dodge a per-email limit by sending a different bogus email on every
// request. This counter is shared across all emails/IPs so the DB connection fan-out this path
// causes can't be forced unboundedly just by varying the login email. Legitimate use (a user who
// only exists in a tenant DB from a pre-registry-mirror migration) is rare enough that a shared
// budget this size doesn't meaningfully affect it.
const TENANT_SCAN_FALLBACK_LIMIT_PER_MINUTE = 10;
let tenantScanFallbackCount = 0;
setInterval(() => { tenantScanFallbackCount = 0; }, 60_000).unref();

function isPlatformOwnerEmail(email?: string | null) {
  if (!email) return false;
  return email.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
}

/**
 * For the platform owner only: scopes req.user.organizationId to the current tenant.
 *
 * The owner's session cookie is shared across every tenant subdomain (see the cookie `domain`
 * setting in setupAuth below), so session.activeTenantId — set once via the in-app "switch
 * tenant" dropdown — otherwise stays sticky no matter which tenant's actual subdomain the owner
 * navigates to next. That silently showed tenant A's dashboard while the URL bar read tenant B's
 * real, correctly-provisioned subdomain (reported 2026-08-13: visiting
 * kings-and-queens-funeral-assurance.pol263.com showed IFALAKHE, visiting
 * ifalakhe-funeral-services.pol263.com showed FALAKHE — both were just whatever tenant had last
 * been switched to, not the tenant named in the URL). A tenant resolved from the request's own
 * Host header (req.tenantId, set by tenantResolverMiddleware which runs before this) is a much
 * stronger, more current signal than a stale session value, so it wins here — and is written back
 * into the session so the UI's "current tenant" indicator and any other code reading
 * activeTenantId directly stay in sync with it too. Falls back to session.activeTenantId (e.g. on
 * the bare base domain or the controlpanel admin host, where no tenant subdomain is present).
 * No-op for non-owner users — their organizationId is always their own account's org, regardless
 * of which subdomain they're on.
 */
export function applyPlatformOwnerTenantOverride(req: Request): void {
  const user = req.user as any;
  if (!user || !isPlatformOwnerEmail(user.email)) return;

  const subdomainTenantId = (req as any).tenantId as string | undefined;
  if (subdomainTenantId) {
    user.organizationId = subdomainTenantId;
    (req.session as any).activeTenantId = subdomainTenantId;
  } else {
    const activeTenantId = (req.session as any)?.activeTenantId;
    if (activeTenantId) {
      user.organizationId = activeTenantId;
    }
  }
  user.isPlatformOwner = true;
}

// Enforces tenant suspension (set via the platform-owner console) at session-resolution time,
// which runs on every authenticated request — see the isActive===false check a few lines below
// this is modeled on. Cached (same 5-min TTL pattern as tenant-resolver.ts) so a suspend/reactivate
// doesn't add a control-plane round trip to every request platform-wide; invalidateTenantActiveCache()
// clears a specific tenant's entry immediately after a lifecycle change so enforcement is near-instant
// rather than waiting out the TTL.
const tenantActiveCache = new Map<string, { isActive: boolean; cachedAt: number }>();
const TENANT_ACTIVE_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateTenantActiveCache(orgId: string) {
  tenantActiveCache.delete(orgId);
}

async function isTenantAccessAllowed(orgId: string): Promise<boolean> {
  const cached = tenantActiveCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < TENANT_ACTIVE_CACHE_TTL_MS) return cached.isActive;
  try {
    const [row] = await cpDb.select({ isActive: cpTenants.isActive }).from(cpTenants).where(eq(cpTenants.id, orgId)).limit(1);
    // No control-plane row for this org (not yet registered, or legacy) — don't block.
    const isActive = row ? row.isActive : true;
    tenantActiveCache.set(orgId, { isActive, cachedAt: Date.now() });
    return isActive;
  } catch (err) {
    // Control plane unreachable — fail open. A transient outage there must never lock out the
    // entire platform; getOrganization()/getOrgPaynowConfig() apply the same fail-open resilience.
    structuredLog("error", "Tenant active-status lookup failed, failing open", { orgId, error: (err as Error).message });
    return true;
  }
}

function baseUrlFromEnv() {
  return (process.env.APP_BASE_URL || "").replace(/\/$/, "");
}

/**
 * Finishes a staff Google-OAuth login: req.login + the session-fixation regenerate/restore
 * dance, then the full tenant/platform-owner/mobile redirect decision tree — unchanged from what
 * this used to be inline in the /api/auth/google/callback handler. Factored out so the MFA
 * verify step (POST /api/auth/mfa/verify-login) can run the exact same completion logic after a
 * successful code, without duplicating ~130 lines of redirect logic. `asJson` swaps the response
 * mechanism only: the original GET callback still does a browser redirect; the JSON-based verify
 * endpoint gets `{ redirectUrl }` back instead, since a fetch() response can't navigate the page
 * itself — reads authReturnTo/authTenantId/isMobileAuth from req.session exactly as before, which
 * still works from the verify-login request because that session (and those fields, written
 * during the original OAuth callback) persists across the MFA-challenge round trip.
 */
async function completeGoogleLogin(req: Request, res: Response, next: NextFunction, user: any, opts: { asJson?: boolean } = {}) {
  const finish = (url: string) => (opts.asJson ? res.json({ redirectUrl: url }) : res.redirect(url));
  req.login(user, async (loginErr) => {
    if (loginErr) return next(loginErr);

    // Capture session state before regeneration, then regenerate to prevent session fixation.
    const sessionAny = req.session as any;
    const returnTo = sessionAny?.authReturnTo as string | undefined;
    const authTenantIdPre = sessionAny?.authTenantId as string | undefined;
    const isMobileAuth = sessionAny?.isMobileAuth as boolean | undefined;
    const passportData = sessionAny.passport;
    try {
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve()))
      );
      const newSess = req.session as any;
      newSess.passport = passportData;
      await new Promise<void>((resolve, reject) =>
        req.session.save((e) => (e ? reject(e) : resolve()))
      );
    } catch (e) {
      return next(e as Error);
    }

    // Mobile OAuth: generate a one-time token and deep-link back into the app.
    // The WebView can't use the external-browser session cookie, so it exchanges
    // this token for a fresh session via POST /api/auth/mobile-exchange.
    if (isMobileAuth) {
      const token = crypto.randomBytes(32).toString("hex");
      mobileAuthTokens.set(token, {
        userId: user.id,
        orgId: user.organizationId || undefined,
        expiresAt: Date.now() + 5 * 60_000,
      });
      return finish(`pol263://auth/callback?token=${token}`);
    }

    // Redirect to home with returnTo so the client can redirect after auth is ready (avoids error page on first load).
    const pathFromReturnTo = returnTo
      ? (returnTo.startsWith("http") ? new URL(returnTo).pathname : returnTo)
      : null;
    if (pathFromReturnTo) {
      const baseUrl = baseUrlFromEnv();
      const host = req.get("host");
      const proto =
        (req.get("x-forwarded-proto") as string)?.split(",")[0]?.trim() ||
        (req as any).protocol ||
        "http";
      const origin = baseUrl || (host ? `${proto}://${host}` : "");
      const homeWithReturn = origin
        ? `${origin}/?returnTo=${encodeURIComponent(pathFromReturnTo)}`
        : `/?returnTo=${encodeURIComponent(pathFromReturnTo)}`;
      return finish(homeWithReturn);
    }

    const baseUrl = baseUrlFromEnv();
    const staffPath = "/staff";

    const loggedInUser = req.user as any;

    // If the login was initiated from a tenant subdomain (authTenantId saved
    // by /api/auth/google), activate that tenant so the platform owner lands
    // on that tenant's dashboard rather than the control plane.
    const authTenantId = authTenantIdPre;
    if (authTenantId) {
      (req.session as any).activeTenantId = authTenantId;
      const homeWithReturn = baseUrl
        ? `${baseUrl}/?returnTo=${encodeURIComponent(staffPath)}`
        : `/?returnTo=${encodeURIComponent(staffPath)}`;
      return finish(homeWithReturn);
    }

    // ✅ If platform owner logged in but has no tenant selected/created yet, send them to tenant setup/selection.
    if (loggedInUser?.isPlatformOwner && !loggedInUser?.organizationId) {
      const tenantSetupPath = "/staff/tenants";
      const homeWithReturn = baseUrl
        ? `${baseUrl}/?returnTo=${encodeURIComponent(tenantSetupPath)}`
        : `/?returnTo=${encodeURIComponent(tenantSetupPath)}`;
      return finish(homeWithReturn);
    }

    // If the platform owner logged in NOT via a tenant subdomain (authTenantId unset,
    // handled above) and isn't already on the dedicated control-plane subdomain, send
    // them there. Mirrors the regular-staff → tenant-subdomain redirect just below, but
    // for the platform owner — keeps pol263.com from serving the platform console too.
    if (loggedInUser?.isPlatformOwner && baseUrl) {
      const mainHost = new URL(baseUrl).hostname;
      const adminSub = (process.env.PLATFORM_ADMIN_SUBDOMAIN || "controlpanel").toLowerCase();
      const currentHost = req.get("host")?.split(":")[0]?.toLowerCase();
      if (currentHost !== `${adminSub}.${mainHost}`) {
        const proto = (req.get("x-forwarded-proto") as string)?.split(",")[0]?.trim() || "https";
        return finish(`${proto}://${adminSub}.${mainHost}/?returnTo=${encodeURIComponent(staffPath)}`);
      }
    }

    // If a regular staff member logged in from the main domain (no authTenantId
    // means they didn't come via a tenant subdomain), redirect them to their
    // tenant's subdomain. This prevents pol263.com from serving tenant dashboards
    // and ensures staff always land on their branded subdomain.
    if (!loggedInUser?.isPlatformOwner && loggedInUser?.organizationId && baseUrl) {
      try {
        const mainHost = new URL(baseUrl).hostname; // e.g. "pol263.com"
        const [tenantRow] = await cpDb
          .select({ slug: cpTenants.slug })
          .from(cpTenants)
          .where(eq(cpTenants.id, loggedInUser.organizationId))
          .limit(1);
        if (tenantRow?.slug) {
          const proto = (req.get("x-forwarded-proto") as string)?.split(",")[0]?.trim() || "https";
          const tenantOrigin = `${proto}://${tenantRow.slug}.${mainHost}`;
          return finish(`${tenantOrigin}/?returnTo=${encodeURIComponent(staffPath)}`);
        }
      } catch {
        // Control plane unreachable — fall through to default redirect below.
      }
    }

    const homeWithReturn = baseUrl
      ? `${baseUrl}/?returnTo=${encodeURIComponent(staffPath)}`
      : (() => {
          const host = req.get("host");
          const proto =
            (req.get("x-forwarded-proto") as string)?.split(",")[0]?.trim() ||
            (req as any).protocol ||
            "http";
          const sameOrigin = host ? `${proto}://${host}` : "";
          return sameOrigin ? `${sameOrigin}/?returnTo=${encodeURIComponent(staffPath)}` : `/?returnTo=${encodeURIComponent(staffPath)}`;
        })();
    return finish(homeWithReturn);
  });
}

/**
 * Staff/agent has a password (or Google identity) verified but is enrolled in MFA — stash a
 * short-lived pending marker in the session instead of completing req.login, and send them to
 * the code-entry step. Mirrors requireClientAuth's session shape convention on the client side.
 */
function beginStaffMfaChallenge(req: Request, res: Response, next: NextFunction, user: any, respond: (challenge: true) => void) {
  const sessionAny = req.session as any;
  sessionAny.pendingMfaUserId = user.id;
  sessionAny.pendingMfaOrgId = user.organizationId || null;
  sessionAny.pendingMfaExpiresAt = Date.now() + 5 * 60_000;
  sessionAny.pendingMfaFailedAttempts = 0;
  sessionAny.save((err: Error | null) => {
    if (err) return next(err);
    respond(true);
  });
}

/** Finishes an agent password login — req.login + session-fixation regenerate, same shape as
 *  completeGoogleLogin but for the JSON-based agent login API rather than a browser redirect
 *  flow. Factored out so POST /api/agent-auth/mfa-verify can call it after a successful code. */
async function completeAgentLogin(req: Request, res: Response, user: any): Promise<void> {
  return new Promise<void>((resolveOuter) => {
    req.login(user, async (err) => {
      if (err) {
        res.status(500).json({ message: "Login failed" });
        return resolveOuter();
      }
      // Regenerate session ID to prevent session fixation.
      const passportData = (req.session as any).passport;
      try {
        await new Promise<void>((resolve, reject) =>
          req.session.regenerate((e) => (e ? reject(e) : resolve()))
        );
        (req.session as any).passport = passportData;
        await new Promise<void>((resolve, reject) =>
          req.session.save((e) => (e ? reject(e) : resolve()))
        );
      } catch {
        res.status(500).json({ message: "Login failed" });
        return resolveOuter();
      }
      structuredLog("info", "Agent login successful", { userId: user.id, email: user.email });
      res.json({ user: sanitizeUser(user), redirect: "/staff" });
      resolveOuter();
    });
  });
}

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

const MFA_PENDING_MAX_ATTEMPTS = 5;

/** Re-derives the user a pending MFA challenge (see beginStaffMfaChallenge) is for, from the
 *  session marker rather than req.user — the user isn't logged in yet at this point. Mirrors
 *  the mobile-exchange token-resolution pattern (tenant DB first, then the shared registry). */
async function resolvePendingMfaUser(req: Request): Promise<any | null> {
  const sessionAny = req.session as any;
  const userId = sessionAny?.pendingMfaUserId as string | undefined;
  const expiresAt = sessionAny?.pendingMfaExpiresAt as number | undefined;
  if (!userId || !expiresAt || Date.now() > expiresAt) return null;
  const orgId = sessionAny?.pendingMfaOrgId as string | undefined;
  return storage.getUser(userId, orgId || undefined);
}

/**
 * Checks a submitted code (TOTP or a backup code) against the pending-MFA user's session marker,
 * writes the appropriate response and returns null on any failure (expired challenge, too many
 * bad attempts, wrong code) or the resolved user on success — clearing the pending marker either
 * way it succeeds so it can't be replayed. A matched backup code is nulled out (single-use) in
 * the same call.
 */
async function verifyPendingMfaCode(req: Request, res: Response): Promise<any | null> {
  const sessionAny = req.session as any;
  const user = await resolvePendingMfaUser(req);
  if (!user) {
    res.status(401).json({ message: "MFA challenge expired — please log in again" });
    return null;
  }
  const attempts = (sessionAny.pendingMfaFailedAttempts as number) || 0;
  if (attempts >= MFA_PENDING_MAX_ATTEMPTS) {
    clearPendingMfa(sessionAny);
    res.status(429).json({ message: "Too many failed attempts — please log in again" });
    return null;
  }
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  let ok = !!code && !!user.mfaSecret && (await verifyTotp({ secret: user.mfaSecret, token: code })).valid;
  if (!ok && code && Array.isArray(user.mfaBackupCodes)) {
    const codes: (string | null)[] = user.mfaBackupCodes;
    for (let i = 0; i < codes.length; i++) {
      const hash = codes[i];
      if (!hash) continue;
      if (await argon2.verify(hash, code)) {
        ok = true;
        const updated = [...codes];
        updated[i] = null; // single-use
        await storage.updateUser(user.id, { mfaBackupCodes: updated } as any);
        break;
      }
    }
  }
  if (!ok) {
    sessionAny.pendingMfaFailedAttempts = attempts + 1;
    res.status(400).json({ message: "Invalid code" });
    return null;
  }
  clearPendingMfa(sessionAny);
  return user;
}

/** Fully clears a pending-MFA session, including the alt-channel fields below — shared by every
 *  exit path (success, expiry, too-many-attempts) so none of them can leave a stale challenge. */
function clearPendingMfa(sessionAny: any) {
  delete sessionAny.pendingMfaUserId;
  delete sessionAny.pendingMfaOrgId;
  delete sessionAny.pendingMfaExpiresAt;
  delete sessionAny.pendingMfaFailedAttempts;
  delete sessionAny.pendingMfaAltCodeHash;
  delete sessionAny.pendingMfaAltChannel;
  delete sessionAny.pendingMfaAltLastSentAt;
}

/** Shows only the last 4 digits — a hint so the legitimate user recognizes their own number
 *  without this response ever exposing enough of it to be useful to someone who doesn't already
 *  know it. Digit count is deliberately not reflected in the mask length either. */
function maskPhoneForDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return `${raw.trim().startsWith("+") ? "+" : ""}•••••${last4}`;
}

function normalizePhoneForCompare(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function setupAuth(app: Express) {
  const rawSessionSecret = process.env.SESSION_SECRET;

  if (!rawSessionSecret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production for secure session handling.");
  }

  if (!rawSessionSecret && process.env.NODE_ENV !== "production") {
    structuredLog(
      "warn",
      "SESSION_SECRET is not set. Using a weak default; set SESSION_SECRET in your environment for better security."
    );
  }

  const sessionSecret = rawSessionSecret || crypto.randomBytes(32).toString("hex");

  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(
    session({
      store: new PgSession({
        pool: pool as any,
        tableName: "sessions",
        createTableIfMissing: false,
        pruneSessionInterval: 15 * 60,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: process.env.NODE_ENV === "production",
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
        // Share the session cookie across all subdomains (e.g. falakhe.pol263.com)
        // so the Google OAuth callback on the main domain can read authTenantId
        // that was written during login on a tenant subdomain.
        // Only set domain in production — localhost domain cookies are unreliable
        // across browsers and break the dev session entirely.
        domain: (() => {
          const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
          if (!base) return undefined;
          try {
            const host = new URL(base).hostname;
            if (host === "localhost" || host.match(/^[\d.]+$/) || host.endsWith(".localhost")) return undefined;
            // "pol263.com" → ".pol263.com"  (covers all subdomains)
            return host.startsWith("www.") ? `.${host.slice(4)}` : `.${host}`;
          } catch {
            return undefined;
          }
        })(),
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: any, done) => {
    // Encode "userId:orgId" so deserializer can route to the right tenant DB.
    // If no org (platform owner before tenant selection), just the userId.
    const token = user.organizationId ? `${user.id}:${user.organizationId}` : user.id;
    done(null, token);
  });

  passport.deserializeUser(async (token: string, done) => {
    try {
      const colonIdx = (token as string).indexOf(":");
      const userId = colonIdx > -1 ? token.slice(0, colonIdx) : token;
      const orgId = colonIdx > -1 ? token.slice(colonIdx + 1) : undefined;

      let user: any;
      if (orgId) {
        // Try tenant DB first (covers isolated tenants like Falakhe)
        try {
          const tenantDb = await getDbForOrg(orgId);
          const [u] = await tenantDb.select().from(users).where(eq(users.id, userId)).limit(1);
          user = u;
        } catch {
          // Fall through to shared DB
        }
      }
      if (!user) {
        user = await storage.getUser(userId);
      }
      // Fix 8: Immediately reject deactivated accounts rather than waiting up to
      // session maxAge (24 h). deserializeUser runs on every authenticated request
      // so this revocation is near-instant without extra middleware.
      if (user && user.isActive === false) {
        return done(null, null);
      }
      // Same near-instant-revocation approach, extended to tenant-level suspension (set via the
      // platform-owner console). Never applied to the platform owner themselves — they must always
      // be able to log in to reactivate a tenant they suspended.
      if (user && orgId && !isPlatformOwnerEmail(user.email)) {
        const allowed = await isTenantAccessAllowed(orgId);
        if (!allowed) {
          return done(null, null);
        }
      }
      done(null, user || null);
    } catch (err) {
      done(err, null);
    }
  });

  // Platform-owner tenant override:
  // If platform owner has selected a tenant (session.activeTenantId), treat that as current org scope.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    applyPlatformOwnerTenantOverride(req);
    next();
  });

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (googleClientId && googleClientSecret) {
    const callbackURL =
      process.env.GOOGLE_CALLBACK_URL ||
      `https://${process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000"}/api/auth/google/callback`;

    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL,
          passReqToCallback: true,
        },
        async (req: any, _accessToken: string, _refreshToken: string, profile: any, done: any) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(new Error("No email provided by Google"), undefined);
            }

            // Only trust an email-based account match if Google asserts the email is verified.
            // (A direct googleId match is always trustworthy regardless.)
            const emailVerified =
              profile.emails?.[0]?.verified === true ||
              profile.emails?.[0]?.verified === "true" ||
              profile._json?.email_verified === true ||
              profile._json?.email_verified === "true";

            const owner = isPlatformOwnerEmail(email);
            // authTenantId is set by /api/auth/google when the request came from a tenant subdomain.
            // Platform owner always resolves from the shared DB regardless.
            const authTenantId: string | undefined = owner
              ? undefined
              : (req.session as any)?.authTenantId;

            // Look up user in the correct DB.
            let user: any;
            if (authTenantId) {
              const tenantDb = await getDbForOrg(authTenantId);
              const [byGoogleId] = await tenantDb
                .select()
                .from(users)
                .where(eq(users.googleId, profile.id))
                .limit(1);
              user = byGoogleId;
              if (!user && emailVerified) {
                const [byEmail] = await tenantDb
                  .select()
                  .from(users)
                  .where(eq(users.email, email.toLowerCase()))
                  .limit(1);
                user = byEmail;
              }
            } else {
              user = await storage.getUserByGoogleId(profile.id);
              if (!user && emailVerified) user = await storage.getUserByEmail(email);
            }

            if (!user && owner) {
              // ✅ Fresh DB bootstrap: allow platform owner to be created automatically
              user = await storage.createUser({
                email,
                displayName: profile.displayName,
                avatarUrl: profile.photos?.[0]?.value,
                googleId: profile.id,
                isActive: true,
                // organizationId intentionally not set here; owner can create/select tenant after login
              });
            }

            if (!user) {
              return done(null, false, {
                message: "Not authorized. Ask your administrator to add your email to the system.",
              });
            }

            // ✅ Only check roles if tenant-scoped (never pass "" as uuid)
            if (user.organizationId) {
              const roles = await storage.getUserRoles(user.id, user.organizationId);
              // Block agent-only users from Google OAuth; users with a superior role
              // (administrator, manager, superuser) alongside agent may use Google login.
              if (isAgentScoped(roles)) {
                return done(null, false, {
                  message: "Agents must use the agent login page with email and password.",
                });
              }
            }

            // Link Google ID / update avatar on first OAuth login
            if (!user.googleId || user.googleId !== profile.id) {
              const updateData = {
                googleId: profile.id,
                displayName: profile.displayName,
                avatarUrl: profile.photos?.[0]?.value,
              };
              if (authTenantId) {
                const tenantDb = await getDbForOrg(authTenantId);
                const [updated] = await tenantDb
                  .update(users)
                  .set(updateData)
                  .where(eq(users.id, user.id))
                  .returning();
                user = updated ?? user;
              } else {
                user = (await storage.updateUser(user.id, updateData)) ?? user;
              }
            }

            if (!user) {
              return done(new Error("User record not found after lookup"), undefined);
            }

            if (!user.isActive) {
              return done(null, false, { message: "Account is disabled" });
            }

            structuredLog("info", "Google OAuth login", {
              userId: user.id,
              email: user.email,
              isPlatformOwner: owner,
              hasOrg: Boolean(user.organizationId),
              tenantDb: authTenantId || "shared",
            });

            done(null, user);
          } catch (err) {
            done(err as Error, undefined);
          }
        }
      )
    );

    app.get("/api/auth/google", (req, res, next) => {
      const rawReturnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : undefined;
      const returnTo = rawReturnTo && (() => {
        try {
          const parsed = new URL(rawReturnTo, "http://localhost");
          // Reject protocol-relative URLs (//evil.com) — origin must match the dummy base
          return parsed.origin === "http://localhost" ? rawReturnTo : undefined;
        } catch { return undefined; }
      })();
      const isMobile = req.query.returnTo === "mobile";

      const origin = (process.env.APP_BASE_URL || "").replace(/\/$/, "");

      if (returnTo) {
        (req.session as any).authReturnTo = origin ? `${origin}${returnTo}` : returnTo;
      }
      if (isMobile) {
        (req.session as any).isMobileAuth = true;
      }

      // If this request came from a tenant subdomain, remember which tenant so the
      // callback can look up the user in the right database.
      const tenantId = (req as any).tenantId as string | undefined;
      if (tenantId) {
        (req.session as any).authTenantId = tenantId;
      }

      (req.session as any).save((err: Error | null) => {
        if (err) return next(err);
        passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
      });
    });

    app.get("/api/auth/google/callback", (req, res, next) => {
      passport.authenticate("google", (err: Error | null, user: any, info?: { message?: string }) => {
        if (err) return next(err);

        if (!user) {
          const message = info?.message || "Authentication failed";
          const baseUrl = baseUrlFromEnv();
          const loginPath = "/staff/login";
          const redirectUrl = baseUrl
            ? `${baseUrl}${loginPath}?error=${encodeURIComponent(message)}`
            : `${loginPath}?error=${encodeURIComponent(message)}`;
          return res.redirect(redirectUrl);
        }

        if (user.mfaEnabled) {
          return beginStaffMfaChallenge(req, res, next, user, () => {
            const baseUrl = baseUrlFromEnv();
            const challengePath = "/staff/mfa-verify";
            return res.redirect(baseUrl ? `${baseUrl}${challengePath}` : challengePath);
          });
        }

        return completeGoogleLogin(req, res, next, user);
      })(req, res, next);
    });
  } else {
    structuredLog("warn", "Google OAuth credentials not configured.");

    app.get("/api/auth/google", (_req: Request, res: Response) => {
      const msg = encodeURIComponent("Google OAuth is not configured. Use demo login or configure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.");
      return res.redirect(`/staff/login?error=${msg}`);
    });
  }

  // Exchange a mobile one-time auth token for a real session.
  // Called by the native WebView after the OS opens the pol263://auth/callback deep link.
  app.post("/api/auth/mobile-exchange", async (req: Request, res: Response, next: NextFunction) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return res.status(400).json({ message: "token required" });

    const data = mobileAuthTokens.get(token);
    if (!data || data.expiresAt < Date.now()) {
      mobileAuthTokens.delete(token);
      return res.status(401).json({ message: "Invalid or expired auth token" });
    }
    mobileAuthTokens.delete(token); // single use

    let user: any;
    if (data.orgId) {
      try {
        const tenantDb = await getDbForOrg(data.orgId);
        const [u] = await tenantDb.select().from(users).where(eq(users.id, data.userId)).limit(1);
        user = u;
      } catch { /* fall through */ }
    }
    if (!user) user = await storage.getUser(data.userId);
    if (!user || user.isActive === false) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.login(user, (err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  });

  // ─── TOTP MFA (opt-in) ──────────────────────────────────────
  // Enroll/confirm/disable are self-service (requireAuth only, always operate on req.user —
  // mirrors change-password above, not gated behind write:user). verify-login/mfa-verify are
  // public: they complete a *pending* login (see beginStaffMfaChallenge) via the short-lived
  // session marker, since the user isn't logged in yet when they're called.
  app.post("/api/auth/mfa/enroll", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const secret = generateTotpSecret();
    await storage.updateUser(user.id, { mfaSecret: secret } as any);
    const otpauthUrl = generateTotpURI({ issuer: "POL263", label: user.email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    return res.json({ secret, otpauthUrl, qrDataUrl });
  });

  app.post("/api/auth/mfa/confirm", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!user.mfaSecret) {
      return res.status(400).json({ message: "Start enrollment first" });
    }
    if (!code || !(await verifyTotp({ secret: user.mfaSecret, token: code })).valid) {
      return res.status(400).json({ message: "Invalid code" });
    }
    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => argon2.hash(c, { type: argon2.argon2id })));
    await storage.updateUser(user.id, { mfaEnabled: true, mfaBackupCodes: hashedCodes } as any);
    await auditLog(req, "ENABLE_MFA", "User", user.id, { mfaEnabled: false }, { mfaEnabled: true });
    return res.json({ backupCodes });
  });

  app.post("/api/auth/mfa/disable", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { password, code } = req.body;
    if (user.passwordHash) {
      if (!password || !(await argon2.verify(user.passwordHash, password))) {
        return res.status(400).json({ message: "Current password is required to disable MFA" });
      }
    } else {
      // Staff are Google-OAuth-only by default and have no passwordHash to re-check, so a hijacked
      // session could otherwise strip MFA with nothing but the existing cookie. Require a fresh
      // TOTP/backup code instead — same step-up the login flow itself demands.
      const trimmedCode = typeof code === "string" ? code.trim() : "";
      let codeOk = !!trimmedCode && !!user.mfaSecret && (await verifyTotp({ secret: user.mfaSecret, token: trimmedCode })).valid;
      if (!codeOk && trimmedCode && Array.isArray(user.mfaBackupCodes)) {
        const codes: (string | null)[] = user.mfaBackupCodes;
        for (let i = 0; i < codes.length; i++) {
          const hash = codes[i];
          if (!hash) continue;
          if (await argon2.verify(hash, trimmedCode)) {
            codeOk = true;
            const updated = [...codes];
            updated[i] = null; // single-use
            await storage.updateUser(user.id, { mfaBackupCodes: updated } as any);
            break;
          }
        }
      }
      if (!codeOk) {
        return res.status(400).json({ message: "A current MFA code or backup code is required to disable MFA" });
      }
    }
    await storage.updateUser(user.id, { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null } as any);
    await auditLog(req, "DISABLE_MFA", "User", user.id, { mfaEnabled: true }, { mfaEnabled: false });
    return res.json({ message: "MFA disabled" });
  });

  app.post("/api/auth/mfa/verify-login", async (req: Request, res: Response, next: NextFunction) => {
    const user = await verifyPendingMfaCode(req, res);
    if (!user) return;
    return completeGoogleLogin(req, res, next, user, { asJson: true });
  });

  /**
   * MFA fallback — "Try another way" from the authenticator-code screen. Three-step flow:
   * (1) this endpoint lists which channels the pending user has a number on file for, masked;
   * (2) POST .../challenge-alt requires the user to re-type the full number shown masked here
   *     (proves they actually know it — stops a hijacked-but-not-yet-completed login session
   *     from silently redirecting the code to an attacker-chosen number) before a code is sent;
   * (3) POST .../verify-alt-code checks the code and completes login, same as verify-login above.
   */
  app.get("/api/auth/mfa/alt-channels", async (req: Request, res: Response) => {
    const user = await resolvePendingMfaUser(req);
    if (!user) return res.status(401).json({ message: "MFA challenge expired — please log in again" });
    const channels: { channel: "sms" | "whatsapp"; maskedNumber: string }[] = [];
    if (user.phone) channels.push({ channel: "sms", maskedNumber: maskPhoneForDisplay(user.phone) });
    if (user.whatsapp) channels.push({ channel: "whatsapp", maskedNumber: maskPhoneForDisplay(user.whatsapp) });
    return res.json({ channels });
  });

  app.post("/api/auth/mfa/challenge-alt", async (req: Request, res: Response) => {
    const sessionAny = req.session as any;
    const user = await resolvePendingMfaUser(req);
    if (!user) return res.status(401).json({ message: "MFA challenge expired — please log in again" });

    const attempts = (sessionAny.pendingMfaFailedAttempts as number) || 0;
    if (attempts >= MFA_PENDING_MAX_ATTEMPTS) {
      clearPendingMfa(sessionAny);
      return res.status(429).json({ message: "Too many failed attempts — please log in again" });
    }

    const channel = req.body?.channel === "sms" || req.body?.channel === "whatsapp" ? req.body.channel : null;
    const confirmedNumber = typeof req.body?.confirmedNumber === "string" ? req.body.confirmedNumber.trim() : "";
    if (!channel || !confirmedNumber) {
      return res.status(400).json({ message: "channel and confirmedNumber are required" });
    }

    const storedNumber: string | null = channel === "sms" ? user.phone : user.whatsapp;
    if (!storedNumber) return res.status(400).json({ message: "No number on file for this channel" });

    if (normalizePhoneForCompare(confirmedNumber) !== normalizePhoneForCompare(storedNumber)) {
      sessionAny.pendingMfaFailedAttempts = attempts + 1;
      return res.status(400).json({ message: "That doesn't match our records" });
    }

    const lastSentAt = sessionAny.pendingMfaAltLastSentAt as number | undefined;
    if (lastSentAt && Date.now() - lastSentAt < 30_000) {
      return res.status(429).json({ message: "Please wait before requesting another code" });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    let sendResult: { ok: boolean; message: string };
    if (channel === "sms") {
      const { sendSms, sendPlatformSms } = await import("./sms-service");
      const message = `Your POL263 verification code is ${otp}. It expires shortly — do not share it.`;
      sendResult = user.organizationId
        ? await sendSms(user.organizationId, { to: storedNumber, message, kind: "otp" })
        : await sendPlatformSms({ to: storedNumber, message, kind: "otp" });
    } else {
      const { sendWhatsAppOtp } = await import("./whatsapp-service");
      sendResult = await sendWhatsAppOtp({ to: storedNumber, code: otp });
    }
    if (!sendResult.ok) {
      structuredLog("error", "MFA alt-channel send failed", { userId: user.id, channel, error: sendResult.message });
      return res.status(503).json({
        message: `Couldn't send a code via ${channel === "sms" ? "SMS" : "WhatsApp"} right now. Try your authenticator app or a backup code instead.`,
      });
    }

    sessionAny.pendingMfaAltCodeHash = await argon2.hash(otp);
    sessionAny.pendingMfaAltChannel = channel;
    sessionAny.pendingMfaAltLastSentAt = Date.now();
    sessionAny.save((err: Error | null) => {
      if (err) return res.status(500).json({ message: "Internal server error" });
      return res.json({ sent: true, channel });
    });
  });

  app.post("/api/auth/mfa/verify-alt-code", async (req: Request, res: Response, next: NextFunction) => {
    const sessionAny = req.session as any;
    const user = await resolvePendingMfaUser(req);
    if (!user) return res.status(401).json({ message: "MFA challenge expired — please log in again" });

    const attempts = (sessionAny.pendingMfaFailedAttempts as number) || 0;
    if (attempts >= MFA_PENDING_MAX_ATTEMPTS) {
      clearPendingMfa(sessionAny);
      return res.status(429).json({ message: "Too many failed attempts — please log in again" });
    }

    const codeHash = sessionAny.pendingMfaAltCodeHash as string | undefined;
    if (!codeHash) return res.status(400).json({ message: "No code was sent — request one first" });

    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const ok = !!code && (await argon2.verify(codeHash, code));
    if (!ok) {
      sessionAny.pendingMfaFailedAttempts = attempts + 1;
      return res.status(400).json({ message: "Invalid code" });
    }

    structuredLog("info", "MFA verified via alt channel", { userId: user.id, channel: sessionAny.pendingMfaAltChannel });
    clearPendingMfa(sessionAny);
    return completeGoogleLogin(req, res, next, user, { asJson: true });
  });

  app.post("/api/agent-auth/mfa-verify", async (req: Request, res: Response) => {
    const user = await verifyPendingMfaCode(req, res);
    if (!user) return;
    return completeAgentLogin(req, res, user);
  });

  const demoLoginEnabled =
    process.env.ENABLE_DEMO_LOGIN === "true" && process.env.NODE_ENV !== "production";

  const googleConfigured = !!(googleClientId && googleClientSecret);

  app.get("/api/public/auth-config", (_req: Request, res: Response) => {
    res.json({ demoLoginEnabled, googleConfigured });
  });

  if (demoLoginEnabled) {
    app.post("/api/auth/demo-login", async (req: Request, res: Response) => {
      if (googleClientId && googleClientSecret) {
        return res
          .status(403)
          .json({ message: "Demo login disabled when Google OAuth is configured" });
      }

      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      try {
        let user = await storage.getUserByEmail(email);
        if (!user) {
          user = await storage.createUser({
            email,
            displayName: email.split("@")[0],
            isActive: true,
          });
        }

        if (!user.isActive) {
          return res.status(403).json({ message: "Account is disabled" });
        }

        req.login(user, (err) => {
          if (err) {
            return res.status(500).json({ message: "Login failed" });
          }
          structuredLog("info", "Demo login successful", {
            userId: user.id,
            email: user.email,
          });
          return res.json({ user: sanitizeUser(user) });
        });
      } catch (err) {
        return res.status(500).json({ message: "Internal server error" });
      }
    });
  } else if (process.env.NODE_ENV !== "production") {
    structuredLog(
      "info",
      "Demo login endpoint disabled. Set ENABLE_DEMO_LOGIN=true to enable in non-production environments."
    );
  }

  app.post("/api/agent-auth/login", async (req: Request, res: Response, next: NextFunction) => {
    const { email, password, orgId } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    try {
      // Resolve tenant: subdomain middleware (production) takes priority,
      // body orgId is the fallback for local dev or direct URL access.
      const tenantId = ((req as any).tenantId as string | undefined) || orgId;
      structuredLog("info", "Agent login attempt", { hostname: req.hostname, tenantId: tenantId ?? null, hasOrgId: !!orgId });
      let user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user && tenantId) {
        // Tenant resolved via subdomain/header: check that tenant's DB directly.
        const tdb = await getDbForOrg(tenantId);
        const [tenantUser] = await tdb
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase().trim()))
          .limit(1);
        user = tenantUser ?? undefined;
        structuredLog("info", "Agent login tenant lookup", { found: !!user, tenantId });
      }
      if (!user && tenantScanFallbackCount >= TENANT_SCAN_FALLBACK_LIMIT_PER_MINUTE) {
        structuredLog("warn", "Agent login: tenant DB scan fallback budget exhausted, skipping", { email: email.toLowerCase().trim() });
      } else if (!user) {
        // Last resort: search all orgs with dedicated databases (e.g. user exists only in
        // tenant DB because they were migrated from Supabase or created before the registry
        // mirror was in place). Only runs when shared-DB lookup already returned nothing.
        tenantScanFallbackCount++;
        const { db: registryDb } = await import("./db");
        const { organizations } = await import("@shared/schema");
        const { isNotNull } = await import("drizzle-orm");
        const orgsWithDedicatedDb = await registryDb
          .select({ id: organizations.id })
          .from(organizations)
          .where(isNotNull(organizations.databaseUrl));
        for (const org of orgsWithDedicatedDb) {
          try {
            const tdb = await getDbForOrg(org.id);
            const [tenantUser] = await tdb
              .select()
              .from(users)
              .where(eq(users.email, email.toLowerCase().trim()))
              .limit(1);
            if (tenantUser) {
              user = tenantUser;
              structuredLog("info", "Agent login: found user in dedicated tenant DB", { orgId: org.id });
              break;
            }
          } catch {
            // unreachable tenant DB — skip
          }
        }
      }
      if (!user) {
        structuredLog("info", "Agent login: user not found", { email: email.toLowerCase().trim() });
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const lockRemainingMs = agentLockRemaining(user);
      if (lockRemainingMs > 0) {
        return res.status(429).json({
          message: "Too many failed attempts. Please try again later.",
          retryAfterSeconds: Math.ceil(lockRemainingMs / 1000),
        });
      }
      if (!user.isActive) {
        structuredLog("info", "Agent login: account disabled", { userId: user.id });
        return res.status(403).json({ message: "Account is disabled" });
      }
      if (!user.passwordHash) {
        structuredLog("info", "Agent login: no password hash", { userId: user.id });
        await recordAgentLoginFailure(user.id, user.failedLoginAttempts);
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // ✅ Never pass empty string as uuid
      if (!user.organizationId) {
        return res.status(403).json({ message: "No tenant scope assigned to this account." });
      }

      const roles = await storage.getUserRoles(user.id, user.organizationId);
      const isAgent = roles.some((r) => r.name === "agent");
      structuredLog("info", "Agent login role check", { userId: user.id, roles: roles.map(r => r.name), isAgent });
      if (!isAgent) {
        return res.status(403).json({ message: "Use the staff login (Google) for this account." });
      }

      const valid = await argon2.verify(user.passwordHash, password);
      structuredLog("info", "Agent login password check", { userId: user.id, valid });
      if (!valid) {
        await recordAgentLoginFailure(user.id, user.failedLoginAttempts);
        structuredLog("warn", "AGENT_LOGIN_FAILED", { userId: user.id, email, ip: req.ip, reason: "invalid_password" });
        return res.status(401).json({ message: "Invalid email or password" });
      }

      await clearAgentLoginFailures(user.id);

      if (user.mfaEnabled) {
        return beginStaffMfaChallenge(req, res, next, user, () => res.json({ mfaRequired: true }));
      }

      return completeAgentLogin(req, res, user);
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      structuredLog("error", "Agent login error", { error: errMsg, stack: (err as Error).stack?.split("\n")[0] });
      const detail = process.env.NODE_ENV !== "production" ? errMsg : undefined;
      return res.status(500).json({ message: "Internal server error", ...(detail && { detail }) });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) structuredLog("warn", "Session destroy failed on logout", { error: (destroyErr as Error).message });
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  app.post("/api/auth/change-password", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      return res.status(400).json({ message: policyError });
    }
    const fullUser = await storage.getUser(user.id);
    if (!fullUser || !fullUser.passwordHash) {
      return res
        .status(400)
        .json({ message: "This account uses Google sign-in; there is no password to change." });
    }
    const valid = await argon2.verify(fullUser.passwordHash, currentPassword);
    if (!valid) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await storage.updateUser(user.id, { passwordHash });
    await auditLog(req, "CHANGE_PASSWORD", "User", user.id, undefined, undefined);
    await invalidateOtherSessions({ sessField: "passportUser", matchValue: user.id, currentSessionId: req.sessionID });
    return res.json({ message: "Password updated" });
  });

  // Self-edit of vCard contact fields — mirrors change-password above: requireAuth only, always
  // operates on req.user.id, no write:user permission needed. Deliberately whitelists a small,
  // fixed set of fields — NOT displayName/email/referralCode/department etc., which stay
  // admin-only via PATCH /api/users/:id.
  app.patch("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    const { phone, whatsapp, facebookUrl, instagramUrl, websiteUrl, bio, avatarUrl } = req.body;
    const data: Record<string, any> = {};
    if (phone === null || typeof phone === "string") data.phone = phone;
    if (whatsapp === null || typeof whatsapp === "string") data.whatsapp = whatsapp;
    if (facebookUrl === null || typeof facebookUrl === "string") data.facebookUrl = facebookUrl;
    if (instagramUrl === null || typeof instagramUrl === "string") data.instagramUrl = instagramUrl;
    if (websiteUrl === null || typeof websiteUrl === "string") data.websiteUrl = websiteUrl;
    if (bio === null || typeof bio === "string") data.bio = bio;
    if (avatarUrl === null || typeof avatarUrl === "string") data.avatarUrl = avatarUrl;
    const updated = await storage.updateUser(user.id, data);
    if (!updated) return res.status(404).json({ message: "User not found" });
    return res.json({
      phone: updated.phone,
      whatsapp: updated.whatsapp,
      facebookUrl: updated.facebookUrl,
      instagramUrl: updated.instagramUrl,
      websiteUrl: updated.websiteUrl,
      bio: updated.bio,
      avatarUrl: updated.avatarUrl,
    });
  });

  app.post("/api/users/:id/reset-password", requireAuth, requireTenantScope, async (req: Request, res: Response) => {
    const admin = req.user as any;
    const { newPassword } = req.body;
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      return res.status(400).json({ message: policyError });
    }
    const target = await storage.getUser(req.params.id as string);
    if (!target || target.organizationId !== admin.organizationId) {
      return res.status(404).json({ message: "User not found" });
    }
    const perms = await storage.getUserEffectivePermissions(admin.id, admin.organizationId);
    if (!perms.includes("write:user") && !admin.isPlatformOwner) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    const passwordHash = await argon2.hash(String(newPassword), { type: argon2.argon2id });
    await storage.updateUser(target.id, { passwordHash });
    return res.json({ message: "Password reset successfully" });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = req.user as any;
    try {
      // If a non-platform-owner user's org no longer exists or is soft-deleted, clear it so
      // they can be re-assigned to a tenant. Skip this check for platform owners: their
      // organizationId was overridden by the session middleware (activeTenantId) and is a
      // control-plane UUID — looking it up in the shared organizations table would always
      // return null and wrongly erase the activeTenantId they just selected.
      if (!user.isPlatformOwner && user.organizationId) {
        const org = await storage.getOrganization(user.organizationId);
        // Fix 9: Case-insensitive soft-delete check. TODO: replace name-suffix soft-delete
        // with a proper `deleted_at` timestamp column in the organizations schema.
        if (!org || org.name?.toLowerCase().endsWith(" (deleted)")) {
          await storage.updateUser(user.id, { organizationId: null });
          user.organizationId = null;
          (req.session as any).activeTenantId = null;
          if (typeof (req.session as any).save === "function") {
            await new Promise<void>((resolve, reject) => {
              (req.session as any).save((err: Error | null) => (err ? reject(err) : resolve()));
            });
          }
        }
      }

      const effectiveOrganizationId = getEffectiveOrgId(req, user);
      const orgId = effectiveOrganizationId ?? undefined;
      const userRoles = orgId ? await storage.getUserRoles(user.id, orgId) : [];
      const effectivePermissions = await storage.getUserEffectivePermissions(user.id, effectiveOrganizationId);

      return res.json({
        user: { ...sanitizeUser(user), effectiveOrganizationId },
        roles: userRoles.map((r) => ({ name: r.name, branchId: r.branchId })),
        permissions: effectivePermissions,
      });
    } catch (err) {
      structuredLog("error", "GET /api/auth/me failed", {
        error: (err as Error).message,
        userId: user?.id,
      });
      return res.status(500).json({ message: "Could not load session. Please try again." });
    }
  });
}

function sanitizeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    organizationId: user.organizationId,
    branchId: user.branchId ?? null,
    isActive: user.isActive,
    referralCode: user.referralCode,
    isPlatformOwner: user.isPlatformOwner || false,
    mfaEnabled: user.mfaEnabled || false,
    phone: user.phone ?? null,
    bio: user.bio ?? null,
    whatsapp: user.whatsapp ?? null,
    facebookUrl: user.facebookUrl ?? null,
    instagramUrl: user.instagramUrl ?? null,
    websiteUrl: user.websiteUrl ?? null,
  };
}

function getEffectiveOrgId(req: Request, user: any): string | null {
  const session = req.session as any;
  if (user?.isPlatformOwner) {
    return (session?.activeTenantId ?? user.organizationId ?? null) as string | null;
  }
  return (user?.organizationId ?? null) as string | null;
}

// 45 min of inactivity ends the session even within its longer absolute cookie lifetime (see
// setupAuth's session config above) — mirrors the equivalent check in requireClientAuth
// (server/client-auth.ts) for the client portal.
const STAFF_IDLE_TIMEOUT_MS = 45 * 60 * 1000;

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  const session = req.session as any;
  const now = Date.now();
  if (session.lastActivityAt && now - session.lastActivityAt > STAFF_IDLE_TIMEOUT_MS) {
    return req.session.destroy(() => {
      res.status(401).json({ message: "Session expired due to inactivity" });
    });
  }
  session.lastActivityAt = now;
  next();
}

/**
 * Permissions powerful enough (account/org-wide user and settings management) that SOC 2 access-
 * control expectations require MFA on top of RBAC, not just opt-in. Platform owners are the same
 * tier by definition — they hold every permission implicitly. Checked in both requirePermission
 * and requireAnyPermission below; enrollment itself (POST /api/auth/mfa/enroll|confirm|disable)
 * is gated only by requireAuth, never by this, so a not-yet-enrolled admin can always reach the
 * enroll flow rather than being locked out with no path forward.
 */
const MFA_REQUIRED_PERMISSIONS = new Set(["manage:settings", "manage:users"]);

function rejectForMissingMfa(req: Request, res: Response, user: any, perms: string[]) {
  structuredLog("warn", "Blocked for missing MFA on privileged permission", {
    userId: user.id,
    perms,
    requestId: (req as any).requestId,
  });
  return res.status(403).json({
    message: "This action requires multi-factor authentication. Enroll MFA in Settings to continue.",
    code: "MFA_REQUIRED",
  });
}

export function requirePermission(...requiredPerms: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = req.user as any;
    // Platform owners are superusers — they bypass all permission checks — but still need MFA,
    // since they hold every permission implicitly, including the ones gated below.
    if (user.isPlatformOwner) {
      if (!user.mfaEnabled) return rejectForMissingMfa(req, res, user, ["isPlatformOwner"]);
      return next();
    }

    const effectiveOrgId = getEffectiveOrgId(req, user);
    const effectivePerms = await storage.getUserEffectivePermissions(user.id, effectiveOrgId);
    if (effectiveOrgId) {
      // Keep downstream handlers tenant-scoped even if they read user.organizationId directly.
      user.organizationId = effectiveOrgId;
    }

    const hasAll = requiredPerms.every((p) => effectivePerms.includes(p));
    if (!hasAll) {
      structuredLog("warn", "Permission denied", {
        userId: user.id,
        required: requiredPerms,
        had: effectivePerms,
        requestId: (req as any).requestId,
      });
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    if (!user.mfaEnabled && requiredPerms.some((p) => MFA_REQUIRED_PERMISSIONS.has(p))) {
      return rejectForMissingMfa(req, res, user, requiredPerms);
    }

    next();
  };
}

export function requireAnyPermission(...anyOfPerms: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = req.user as any;
    // Platform owners are superusers — they bypass all permission checks — but still need MFA,
    // since they hold every permission implicitly, including the ones gated below.
    if (user.isPlatformOwner) {
      if (!user.mfaEnabled) return rejectForMissingMfa(req, res, user, ["isPlatformOwner"]);
      return next();
    }

    const effectiveOrgId = getEffectiveOrgId(req, user);
    const effectivePerms = await storage.getUserEffectivePermissions(user.id, effectiveOrgId);
    if (effectiveOrgId) {
      // Keep downstream handlers tenant-scoped even if they read user.organizationId directly.
      user.organizationId = effectiveOrgId;
    }

    const grantedPerms = anyOfPerms.filter((p) => effectivePerms.includes(p));
    if (grantedPerms.length === 0) {
      structuredLog("warn", "Permission denied", {
        userId: user.id,
        requiredAnyOf: anyOfPerms,
        had: effectivePerms,
        requestId: (req as any).requestId,
      });
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    if (!user.mfaEnabled && grantedPerms.some((p) => MFA_REQUIRED_PERMISSIONS.has(p))) {
      return rejectForMissingMfa(req, res, user, grantedPerms);
    }

    next();
  };
}

export function requirePlatformOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  const user = req.user as any;
  const isPlatformOwner = user.isPlatformOwner ?? user.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
  if (!isPlatformOwner) {
    return res.status(403).json({ message: "Platform owner access required" });
  }
  next();
}

export function requireTenantScope(req: Request, res: Response, next: NextFunction) {
  const user = req.user as any;
  const effectiveOrgId = getEffectiveOrgId(req, user);
  if (!effectiveOrgId) {
    if (user?.isPlatformOwner) {
      return res.status(403).json({ message: "Select a tenant first", code: "NO_TENANT_SELECTED" });
    }
    return res.status(403).json({ message: "No tenant scope assigned" });
  }
  // Guard: reject if a non-platform-owner sends an X-Tenant-ID header pointing to a
  // different org — prevents cross-tenant data access if any route reads req.tenantId.
  const headerTenant = req.headers["x-tenant-id"] as string | undefined;
  if (headerTenant && !user?.isPlatformOwner && headerTenant !== effectiveOrgId) {
    structuredLog("warn", "X-Tenant-ID header mismatch for non-owner", {
      userId: user?.id,
      userOrg: effectiveOrgId,
      headerTenant,
      requestId: (req as any).requestId,
    });
    return res.status(403).json({ message: "Tenant header does not match your session" });
  }
  // Keep downstream handlers tenant-scoped even if they read user.organizationId directly.
  user.organizationId = effectiveOrgId;
  next();
}