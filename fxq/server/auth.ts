import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import argon2 from "argon2";
import { pool } from "./db";
import { storage } from "./storage";
import { structuredLog } from "./logger";

const PgSession = connectPgSimple(session);

export function setupAuth(app: Express) {
  const rawSessionSecret = process.env.SESSION_SECRET;

  if (!rawSessionSecret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production for secure session handling.");
  }

  if (!rawSessionSecret && process.env.NODE_ENV !== "production") {
    structuredLog("warn", "SESSION_SECRET is not set. Using a weak default; set SESSION_SECRET in your environment for better security.");
  }

  const sessionSecret = rawSessionSecret || "pol263-session-secret-change-in-dev-only";

  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(
    session({
      store: new PgSession({
        pool: pool as any,
        tableName: "sessions",
        createTableIfMissing: true,
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

            let user = await storage.getUserByGoogleId(profile.id);

            if (!user) {
              user = await storage.getUserByEmail(email);
              if (!user) {
                return done(null, false, { message: "Not authorized. Ask your administrator to add your email to the system." });
              }
              const roles = await storage.getUserRoles(user.id, user.organizationId ?? "");
              const isAgent = roles.some((r) => r.name === "agent");
              if (isAgent) {
                return done(null, false, { message: "Agents must use the agent login page with email and password." });
              }
              user = await storage.updateUser(user.id, {
                googleId: profile.id,
                displayName: profile.displayName,
                avatarUrl: profile.photos?.[0]?.value,
              });
            }

            if (!user!.isActive) {
              return done(null, false, { message: "Account is disabled" });
            }

            structuredLog("info", "Google OAuth login", {
              userId: user!.id,
              email: user!.email,
            });

            done(null, user!);
          } catch (err) {
            done(err as Error, undefined);
          }
        }
      )
    );

    app.get(
      "/api/auth/google",
      (req, res, next) => {
        const returnTo = typeof req.query.returnTo === "string" && req.query.returnTo.startsWith("/")
          ? req.query.returnTo
          : undefined;
        const origin = typeof req.query.origin === "string" && /^https?:\/\//.test(req.query.origin)
          ? req.query.origin.replace(/\/$/, "")
          : (process.env.APP_BASE_URL || "").replace(/\/$/, "");
        if (returnTo && (origin || returnTo.startsWith("/"))) {
          (req.session as any).authReturnTo = origin ? `${origin}${returnTo}` : returnTo;
        }
        (req.session as any).save((err: Error | null) => {
          if (err) return next(err);
          passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
        });
      }
    );

    app.get(
      "/api/auth/google/callback",
      (req, res, next) => {
        passport.authenticate("google", (err: Error | null, user: any, info?: { message?: string }) => {
          if (err) return next(err);
          if (!user) {
            const message = info?.message || "Authentication failed";
            const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
            const loginPath = "/staff/login";
            const redirectUrl = baseUrl ? `${baseUrl}${loginPath}?error=${encodeURIComponent(message)}` : `${loginPath}?error=${encodeURIComponent(message)}`;
            return res.redirect(redirectUrl);
          }
          req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            const session = req.session as any;
            const returnTo = session?.authReturnTo;
            if (returnTo) {
              delete session.authReturnTo;
              return res.redirect(returnTo);
            }
            const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
            const staffPath = "/staff";
            if (baseUrl) {
              return res.redirect(`${baseUrl}${staffPath}`);
            }
            const host = req.get("host");
            const proto = (req.get("x-forwarded-proto") as string)?.split(",")[0]?.trim() || (req as any).protocol || "http";
            const sameOrigin = host ? `${proto}://${host}` : "";
            return res.redirect(sameOrigin ? `${sameOrigin}${staffPath}` : staffPath);
          });
        })(req, res, next);
      }
    );
  } else {
    structuredLog("warn", "Google OAuth credentials not configured.");
  }

  const demoLoginEnabled =
    process.env.ENABLE_DEMO_LOGIN === "true" && process.env.NODE_ENV !== "production";

  if (demoLoginEnabled) {
    app.post("/api/auth/demo-login", async (req: Request, res: Response) => {
      if (googleClientId && googleClientSecret) {
        return res.status(403).json({ message: "Demo login disabled when Google OAuth is configured" });
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
    structuredLog("info", "Demo login endpoint disabled. Set ENABLE_DEMO_LOGIN=true to enable in non-production environments.");
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
      const orgId = user.organizationId ?? "";
      const roles = await storage.getUserRoles(user.id, orgId);
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
      res.json({ message: "Logged out" });
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
      return res.status(400).json({ message: "This account uses Google sign-in; there is no password to change." });
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
      const orgId = user.organizationId ?? undefined;
      const userRoles = orgId
        ? await storage.getUserRoles(user.id, orgId)
        : [];
      const effectivePermissions = await storage.getUserEffectivePermissions(user.id);

      return res.json({
        user: sanitizeUser(user),
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

export function requireTenantScope(req: Request, res: Response, next: NextFunction) {
  const user = req.user as any;
  if (!user?.organizationId) {
    return res.status(403).json({ message: "No tenant scope assigned" });
  }
  next();
}
