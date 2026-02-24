import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

export interface LogContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
  role?: string;
}

export function structuredLog(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  context?: Partial<LogContext> & Record<string, unknown>
) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  (req as any).requestId = req.headers["x-request-id"] || randomUUID();
  next();
}
