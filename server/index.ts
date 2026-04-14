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
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

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
app.use(express.urlencoded({ extended: false }));

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

  const CSRF_EXEMPT_PATHS = ["/api/payments/paynow/result"];
  app.use((req, res, next) => {
    if (CSRF_EXEMPT_PATHS.includes(req.path)) return next();
    return csrfProtection(req, res, next);
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

  setupAuth(app);
  setupClientAuth(app);

  // Resolve tenant for every request. Must come after auth so session-based
  // fallback (req.user.organizationId) is available.
  const { tenantResolverMiddleware } = await import("./tenant-resolver");
  app.use(tenantResolverMiddleware);

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
    }
  );
})().catch((err) => {
  structuredLog("error", "Fatal startup error", { error: err?.message, stack: err?.stack });
  process.exit(1);
});
