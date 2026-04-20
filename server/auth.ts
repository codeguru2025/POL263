import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import argon2 from "argon2";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { pool } from "./db";
import { storage } from "./storage";
import { getDbForOrg } from "./tenant-db";
import { users } from "@shared/schema";
import { structuredLog } from "./logger";
import { PLATFORM_OWNER_EMAIL } from "./constants";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants } from "@shared/control-plane-schema";

const PgSession = connectPgSimple(session);

function isPlatformOwnerEmail(email?: string | null) {
  if (!email) return false;
  return email.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
}

function baseUrlFromEnv() {
  return (process.env.APP_BASE_URL || "").replace(/\/$/, "");
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
      done(null, user || null);
    } catch (err) {
      done(err, null);
    }
  });

  // Platform-owner tenant override:
  // If platform owner has selected a tenant (session.activeTenantId), treat that as current org scope.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const user = req.user as any;
    if (!user) return next();

    const isOwner = isPlatformOwnerEmail(user.email);
    if (isOwner) {
      const activeTenantId = (req.session as any)?.activeTenantId;
      if (activeTenantId) {
        user.organizationId = activeTenantId;
      }
      user.isPlatformOwner = true;
    }

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
              if (!user) {
                const [byEmail] = await tenantDb
                  .select()
                  .from(users)
                  .where(eq(users.email, email.toLowerCase()))
                  .limit(1);
                user = byEmail;
              }
            } else {
              user = await storage.getUserByGoogleId(profile.id);
              if (!user) user = await storage.getUserByEmail(email);
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
              const isAgent = roles.some((r) => r.name === "agent");
              if (isAgent) {
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
      const returnTo =
        typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
          ? req.query.returnTo
          : undefined;

      const origin =
        typeof req.query.origin === "string" && /^https?:\/\//.test(req.query.origin)
          ? req.query.origin.replace(/\/$/, "")
          : (process.env.APP_BASE_URL || "").replace(/\/$/, "");

      if (returnTo && (origin || returnTo.startsWith("/"))) {
        (req.session as any).authReturnTo = origin ? `${origin}${returnTo}` : returnTo;
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

        req.login(user, async (loginErr) => {
          if (loginErr) return next(loginErr);

          const sessionAny = req.session as any;
          const returnTo = sessionAny?.authReturnTo;

          // Redirect to home with returnTo so the client can redirect after auth is ready (avoids error page on first load).
          const pathFromReturnTo = returnTo
            ? (returnTo.startsWith("http") ? new URL(returnTo).pathname : returnTo)
            : null;
          if (pathFromReturnTo) {
            delete sessionAny.authReturnTo;
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
            return res.redirect(homeWithReturn);
          }

          const baseUrl = baseUrlFromEnv();
          const staffPath = "/staff";

          const loggedInUser = req.user as any;

          // If the login was initiated from a tenant subdomain (authTenantId saved
          // by /api/auth/google), activate that tenant so the platform owner lands
          // on that tenant's dashboard rather than the control plane.
          const authTenantId = sessionAny?.authTenantId as string | undefined;
          if (authTenantId) {
            delete sessionAny.authTenantId;
            sessionAny.activeTenantId = authTenantId;
            const homeWithReturn = baseUrl
              ? `${baseUrl}/?returnTo=${encodeURIComponent(staffPath)}`
              : `/?returnTo=${encodeURIComponent(staffPath)}`;
            return res.redirect(homeWithReturn);
          }

          // ✅ If platform owner logged in but has no tenant selected/created yet, send them to tenant setup/selection.
          if (loggedInUser?.isPlatformOwner && !loggedInUser?.organizationId) {
            const tenantSetupPath = "/staff/tenants";
            const homeWithReturn = baseUrl
              ? `${baseUrl}/?returnTo=${encodeURIComponent(tenantSetupPath)}`
              : `/?returnTo=${encodeURIComponent(tenantSetupPath)}`;
            return res.redirect(homeWithReturn);
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
                return res.redirect(`${tenantOrigin}/?returnTo=${encodeURIComponent(staffPath)}`);
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
          return res.redirect(homeWithReturn);
        });
      })(req, res, next);
    });
  } else {
    structuredLog("warn", "Google OAuth credentials not configured.");

    app.get("/api/auth/google", (_req: Request, res: Response) => {
      const msg = encodeURIComponent("Google OAuth is not configured. Use demo login or configure GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.");
      return res.redirect(`/staff/login?error=${msg}`);
    });
  }

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

  app.post("/api/agent-auth/login", async (req: Request, res: Response) => {
    const { email, password, orgId } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    try {
      // Resolve tenant: subdomain middleware (production) takes priority,
      // body orgId is the fallback for local dev or direct URL access.
      const tenantId = ((req as any).tenantId as string | undefined) || orgId;
      let user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user && tenantId) {
        const { getDbForOrg } = await import("./tenant-db");
        const { users: usersTable } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const tdb = await getDbForOrg(tenantId);
        const [tenantUser] = await tdb
          .select()
          .from(usersTable)
          .where(eq(usersTable.email, email.toLowerCase().trim()))
          .limit(1);
        user = tenantUser ?? undefined;
      }
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      if (!user.isActive) {
        return res.status(403).json({ message: "Account is disabled" });
      }
      if (!user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // ✅ Never pass empty string as uuid
      if (!user.organizationId) {
        return res.status(403).json({ message: "No tenant scope assigned to this account." });
      }

      const roles = await storage.getUserRoles(user.id, user.organizationId);
      const isAgent = roles.some((r) => r.name === "agent");
      if (!isAgent) {
        return res.status(403).json({ message: "Use the staff login (Google) for this account." });
      }

      const valid = await argon2.verify(user.passwordHash, password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ message: "Login failed" });
        }
        structuredLog("info", "Agent login successful", { userId: user.id, email: user.email });
        return res.json({ user: sanitizeUser(user), redirect: "/staff" });
      });
    } catch (err) {
      structuredLog("error", "Agent login error", { error: (err as Error).message });
      return res.status(500).json({ message: "Internal server error" });
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
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
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
    return res.json({ message: "Password updated" });
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
        if (!org || org.name?.endsWith(" (deleted)")) {
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
    isActive: user.isActive,
    referralCode: user.referralCode,
    isPlatformOwner: user.isPlatformOwner || false,
  };
}

function getEffectiveOrgId(req: Request, user: any): string | null {
  const session = req.session as any;
  if (user?.isPlatformOwner) {
    return (session?.activeTenantId ?? user.organizationId ?? null) as string | null;
  }
  return (user?.organizationId ?? null) as string | null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}

export function requirePermission(...requiredPerms: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = req.user as any;
    // Platform owners are superusers — they bypass all permission checks.
    if (user.isPlatformOwner) return next();

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

    next();
  };
}

export function requireAnyPermission(...anyOfPerms: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = req.user as any;
    // Platform owners are superusers — they bypass all permission checks.
    if (user.isPlatformOwner) return next();

    const effectiveOrgId = getEffectiveOrgId(req, user);
    const effectivePerms = await storage.getUserEffectivePermissions(user.id, effectiveOrgId);
    if (effectiveOrgId) {
      // Keep downstream handlers tenant-scoped even if they read user.organizationId directly.
      user.organizationId = effectiveOrgId;
    }

    const hasAny = anyOfPerms.some((p) => effectivePerms.includes(p));
    if (!hasAny) {
      structuredLog("warn", "Permission denied", {
        userId: user.id,
        requiredAnyOf: anyOfPerms,
        had: effectivePerms,
        requestId: (req as any).requestId,
      });
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
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
  // Keep downstream handlers tenant-scoped even if they read user.organizationId directly.
  user.organizationId = effectiveOrgId;
  next();
}