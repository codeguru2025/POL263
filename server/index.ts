import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth } from "./auth";
import { setupClientAuth } from "./client-auth";
import { seedDatabase } from "./seed";
import { requestIdMiddleware, structuredLog } from "./logger";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { pool } from "./db";
import csurf from "csurf";

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

if (process.env.ENABLE_CSRF_PROTECTION === "true") {
  const csrfProtection = csurf({
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  });

  app.use(csrfProtection);

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many authentication attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);
  app.use("/api/agent-auth", authLimiter);
  app.use("/api/client-auth", authLimiter);
app.use("/api/security-questions", authLimiter);
app.use("/api/agents/by-referral", authLimiter);

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT 1");
    const dbConnected = result.rowCount === 1;
    return res.json({ status: "ok", dbConnected });
  } catch {
    return res.status(503).json({ status: "degraded", dbConnected: false });
  }
});

setupAuth(app);
setupClientAuth(app);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

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

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message || "Internal Server Error";

    structuredLog("error", "Unhandled error", {
      error: err.message,
      stack: err.stack,
      status,
    });

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  httpServer.listen(
    { port, host },
    async () => {
      structuredLog("info", `POL263 serving on ${host}:${port}`);

      if (process.env.RUN_DB_BOOTSTRAP === "true") {
        try {
          structuredLog("info", "Pushing database schema (RUN_DB_BOOTSTRAP=true)...");
          const { spawn } = await import("child_process");
          const push = spawn("npx", ["drizzle-kit", "push"], {
            stdio: ["pipe", "inherit", "inherit"],
            shell: true,
            env: { ...process.env },
          });
          push.stdin?.write("y\n");
          push.stdin?.end();
          await new Promise<void>((resolve, reject) => {
            push.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`drizzle-kit push exited ${code}`))));
            push.on("error", reject);
          });
          structuredLog("info", "Database schema pushed successfully.");

          structuredLog("info", "Starting database seed...");
          await seedDatabase();
          structuredLog("info", "Database seed completed successfully.");
        } catch (err) {
          structuredLog("error", "Database initialization failed", { error: String(err) });
        }
      } else {
        structuredLog(
          "info",
          "Skipping automatic database migrations/seed. Set RUN_DB_BOOTSTRAP=true to enable on startup.",
        );
      }
    }
  );
})();
