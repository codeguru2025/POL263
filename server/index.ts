import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth } from "./auth";
import { setupClientAuth } from "./client-auth";
import { requestIdMiddleware, structuredLog } from "./logger";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import cookieParser from "cookie-parser";
import { pool } from "./db";
import { startOutboxBackgroundDrain } from "./outbox";
import { drainActiveJobs } from "./job-queue";
import csurf from "csurf";
import { createRedisStore } from "./rate-limit-redis-store";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: process.env.NODE_ENV === "production"
          ? ["'self'"]
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// TODO(security): Install the `cors` npm package and add explicit CORS configuration:
//   import cors from "cors";
//   app.use(cors({ origin: (APP_BASE_URL || "").split(",").map(s => s.trim()).filter(Boolean), credentials: true }));
// Required for the Capacitor mobile app when VITE_API_BASE points to a remote host.

app.use(compression());
app.use(cookieParser());
app.use(requestIdMiddleware);

app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

const enableCsrf = process.env.ENABLE_CSRF_PROTECTION !== undefined
  ? process.env.ENABLE_CSRF_PROTECTION !== "false"
  : process.env.NODE_ENV === "production";
if (enableCsrf) {
  const csrfProtection = csurf({
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  });

  const CSRF_EXEMPT_PATHS = [
    "/api/payments/paynow/result",
    "/api/agent-auth/login",
    "/api/agent-auth/logout",
    // Mobile deep-link exchange and client auth flows are called without a browser session
    "/api/auth/mobile-exchange",
    "/api/client-auth/login",
    "/api/client-auth/logout",
  ];
  app.use((req, res, next) => {
    if (CSRF_EXEMPT_PATHS.includes(req.path)) return next();
    return csrfProtection(req, res, next);
  });

  // Mobile app token endpoint: GET request, csurf runs for generation only (no validation on GET)
  app.get("/api/agent-auth/csrf-token", csrfProtection, (req: Request, res: Response) => {
    return res.json({ token: (req as any).csrfToken() });
  });

  app.use((req, res, next) => {
    try {
      const token = (req as any).csrfToken?.();
      if (token) {
        res.cookie("XSRF-TOKEN", token, {
          httpOnly: false,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        });
      }
    } catch {
      // ignore token generation errors; csurf middleware will handle invalid/missing tokens
    }
    next();
  });
}

// Rate limiters (optional Redis when REDIS_URL set); then health, auth, routes
(async () => {
  const getRedisStore = await createRedisStore({ prefix: "rl:pol263" });
  if (!getRedisStore && process.env.NODE_ENV === "production") {
    structuredLog("warn", "REDIS_URL not set — rate limits are per-instance. Set REDIS_URL in production for shared rate limiting.");
  }
  const limiterOpts = { standardHeaders: true, legacyHeaders: false };

  app.use(
    "/api",
    rateLimit({
      ...limiterOpts,
      store: getRedisStore?.("api"),
      windowMs: 60 * 1000,
      max: 200,
      message: { message: "Too many requests, please slow down" },
    })
  );

  const authLimiter = rateLimit({
    ...limiterOpts,
    store: getRedisStore?.("auth"),
    windowMs: 15 * 60 * 1000,
    // Dev workflows (OAuth retries, tenant switching, frequent reloads) can exceed
    // strict auth limits quickly; keep production strict but relax in dev.
    max: process.env.NODE_ENV === "production" ? 20 : 200,
    message: { message: "Too many authentication attempts, please try again later" },
  });
  app.use("/api/auth", authLimiter);
  app.use("/api/agent-auth", authLimiter);
  app.use("/api/client-auth", authLimiter);
  app.use("/api/security-questions", authLimiter);
  app.use("/api/agents/by-referral", authLimiter);

  app.use(
    "/api/payments/paynow/result",
    rateLimit({
      ...limiterOpts,
      store: getRedisStore?.("paynow"),
      windowMs: 60 * 1000,
      max: 60,
      message: { message: "Too many requests" },
    })
  );

  const reportExportLimiter = rateLimit({
    ...limiterOpts,
    store: getRedisStore?.("reports"),
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { message: "Too many report requests, please try again later" },
  });
  app.use("/api/reports", reportExportLimiter);
  app.use("/api/dashboard/stats", reportExportLimiter);
  app.use("/api/dashboard/revenue-trend", reportExportLimiter);
  app.use("/api/dashboard/product-performance", reportExportLimiter);
  app.use("/api/dashboard/lapse-retention", reportExportLimiter);

  const writeLimiter = rateLimit({
    ...limiterOpts,
    store: getRedisStore?.("write"),
    windowMs: 60 * 1000,
    max: 30,
    message: { message: "Too many write requests, please slow down" },
  });
  app.use("/api/policies", (req, _res, next) => {
    if (req.method === "POST") return writeLimiter(req, _res, next);
    next();
  });
  app.use("/api/payments", (req, _res, next) => {
    if (req.method === "POST") return writeLimiter(req, _res, next);
    next();
  });
  app.use("/api/month-end-run", (req, _res, next) => {
    if (req.method === "POST") return writeLimiter(req, _res, next);
    next();
  });
  app.use("/api/upload", writeLimiter);
  app.use("/api/public/register-policy", writeLimiter);
  app.use("/api/public/walkin-register", writeLimiter);
  app.use("/api/public/billing", writeLimiter);
  app.use("/api/admin/run-notifications", writeLimiter);

  app.use(
    "/api/public/agent-app-latest",
    rateLimit({
      ...limiterOpts,
      store: getRedisStore?.("agent-app-dl"),
      windowMs: 60 * 1000,
      max: 30,
      message: { message: "Too many requests, please slow down" },
    })
  );

  app.get("/api/health", async (_req, res) => {
    try {
      const result = await pool.query("SELECT 1");
      const dbConnected = result.rowCount === 1;
      return res.json({ status: "ok", dbConnected });
    } catch {
      return res.status(503).json({ status: "degraded", dbConnected: false });
    }
  });

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        const user = (req as any).user;
        structuredLog("info", `${req.method} ${path} ${res.statusCode} in ${duration}ms`, {
          requestId: (req as any).requestId,
          userId: user?.id,
          tenantId: user?.organizationId,
          method: req.method,
          path,
          statusCode: res.statusCode,
          duration,
        });
      }
    });

    next();
  });

  // Tenant resolver must run before auth routes so req.tenantId is available
  // on login endpoints (e.g. /api/agent-auth/login). Session-based fallback
  // (req.user.organizationId) won't be available yet, but subdomain/header
  // resolution doesn't need it.
  const { tenantResolverMiddleware } = await import("./tenant-resolver");
  app.use(tenantResolverMiddleware);

  setupAuth(app);
  setupClientAuth(app);

  await registerRoutes(httpServer, app);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    let message: string;
    if (err.code === "EBADCSRFTOKEN") {
      message = "Session expired. Please reload the page and try again.";
    } else if (process.env.NODE_ENV === "production") {
      message = "Internal Server Error";
    } else {
      message = err.message || "Internal Server Error";
    }

    structuredLog("error", "Unhandled error", {
      error: err.message,
      stack: err.stack,
      status,
      code: err.code,
    });

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  httpServer.listen(
    { port, host },
    () => {
      structuredLog("info", `POL263 serving on ${host}:${port}`);
      startOutboxBackgroundDrain();

      // Start daily backup sync to Supabase (if SUPABASE_BACKUP_URL is configured)
      import("./backup-sync").then(({ startBackupScheduler }) => startBackupScheduler()).catch(() => {});

      // Start the daily tenant billing sweep (invoice generation, past-due transitions,
      // auto-suspend). Enforcement of module gating is a separate kill switch — see
      // billingSettings.moduleEnforcementEnabled — so this can run safely before that's on.
      import("./tenant-billing-sweep").then(({ startTenantBillingSweepScheduler }) => startTenantBillingSweepScheduler()).catch(() => {});

      // Ensure all orgs have every role defined in ROLE_PERMISSION_MAP (e.g. newly added roles like "driver")
      import("./seed").then(async ({ seedPermissions, seedOrgRoles }) => {
        const { storage } = await import("./storage");
        try {
          const permMap = await seedPermissions();
          const orgs = await storage.getOrganizations();
          for (const org of orgs) {
            await seedOrgRoles(org.id, permMap);
          }
          structuredLog("info", "Role sync complete", { orgCount: orgs.length });
        } catch (err: any) {
          structuredLog("warn", "Startup role sync failed (non-fatal)", { error: err?.message });
        }
      }).catch(() => {});

      // Fix 12: Warn in production if platform-owner MFA is not enforced.
      // The PLATFORM_OWNER_EMAIL account bypasses all RBAC — a compromise is catastrophic.
      if (process.env.NODE_ENV === "production" && !process.env.PLATFORM_OWNER_MFA_ENFORCED) {
        structuredLog("error", "SECURITY CRITICAL: PLATFORM_OWNER_MFA_ENFORCED is not set. "
          + "The platform owner account has unrestricted cross-tenant access to all tenant data. "
          + "Enable MFA on the platform owner Google account and set PLATFORM_OWNER_MFA_ENFORCED=true in production.");
      }
    }
  );

  // Fix 11: Graceful shutdown — stop accepting requests, wait for in-flight
  // background jobs (PDF generation, commissions, notifications) to finish.
  async function gracefulShutdown(signal: string) {
    structuredLog("info", `Received ${signal}, shutting down gracefully`);
    httpServer.close();
    import("./backup-sync").then(({ stopBackupScheduler }) => stopBackupScheduler()).catch(() => {});
    import("./tenant-billing-sweep").then(({ stopTenantBillingSweepScheduler }) => stopTenantBillingSweepScheduler()).catch(() => {});
    await drainActiveJobs(30_000);
    structuredLog("info", "Graceful shutdown complete");
    process.exit(0);
  }
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.once("SIGINT",  () => gracefulShutdown("SIGINT"));

})().catch((err) => {
  structuredLog("error", "Fatal startup error", { error: err?.message, stack: err?.stack });
  process.exit(1);
});
