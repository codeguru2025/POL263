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

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Security headers
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
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many authentication attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);
app.use("/api/client-auth", authLimiter);

setupAuth(app);
setupClientAuth(app);

// Request logging
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
  // Push schema and seed the database
  try {
    structuredLog("info", "Pushing database schema...");
    const { execSync } = await import("child_process");
    execSync("npx drizzle-kit push --force", { stdio: "inherit" });
    structuredLog("info", "Database schema pushed successfully.");

    await seedDatabase();
  } catch (err) {
    structuredLog("error", "Database initialization failed", { error: String(err) });
  }

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
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      structuredLog("info", `Falakhe PMS serving on port ${port}`);
    }
  );
})();
