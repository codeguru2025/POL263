import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import argon2 from "argon2";
import crypto from "crypto";
import { pool } from "./db";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { PLATFORM_OWNER_EMAIL } from "./constants";

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
        createTableIfMissing: true,
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
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
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
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(new Error("No email provided by Google"), undefined);
            }

            const owner = isPlatformOwnerEmail(email);

            let user = await storage.getUserByGoogleId(profile.id);

            if (!user) {
              // Try match by email first
              user = await storage.getUserByEmail(email);

              // ✅ Fresh DB bootstrap: allow platform owner to be created automatically
              if (!user && owner) {
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

              user = await storage.updateUser(user.id, {
                googleId: profile.id,
                displayName: profile.displayName,
                avatarUrl: profile.photos?.[0]?.value,
              });
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

        req.login(user, (loginErr) => {
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

          // ✅ If platform owner logged in but has no tenant selected/created yet, send them to tenant setup/selection.
          // If you don't have this route in your frontend yet, change it to "/staff" and rely on NO_TENANT_SELECTED.
          const loggedInUser = req.user as any;
          if (loggedInUser?.isPlatformOwner && !loggedInUser?.organizationId) {
            const tenantSetupPath = "/staff/tenants";
            const homeWithReturn = baseUrl
              ? `${baseUrl}/?returnTo=${encodeURIComponent(tenantSetupPath)}`
              : `/?returnTo=${encodeURIComponent(tenantSetupPath)}`;
            return res.redirect(homeWithReturn);
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
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    try {
      const user = await storage.getUserByEmail(email.toLowerCase().trim());
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
      // If user has an org that no longer exists or is soft-deleted, clear it so they can add/select a tenant
      if (user.organizationId) {
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

      const orgId = user.organizationId ?? undefined;
      const userRoles = orgId ? await storage.getUserRoles(user.id, orgId) : [];
      const effectivePermissions = await storage.getUserEffectivePermissions(user.id);
      const session = req.session as any;
      const effectiveOrganizationId = user.isPlatformOwner
        ? (session?.activeTenantId ?? user.organizationId)
        : user.organizationId;

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
    const effectivePerms = await storage.getUserEffectivePermissions(user.id);

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
    const effectivePerms = await storage.getUserEffectivePermissions(user.id);

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
  if (!user?.organizationId) {
    if (user?.isPlatformOwner) {
      return res.status(403).json({ message: "Select a tenant first", code: "NO_TENANT_SELECTED" });
    }
    return res.status(403).json({ message: "No tenant scope assigned" });
  }
  next();
}