/**
 * Phase 6: a tenant suspended for non-payment but still inside its deletion-grace window is
 * READ-ONLY. deserializeUser (server/auth.ts) sets req.user.tenantViewOnly = true for such a
 * session; this middleware — registered globally right after the auth middleware — rejects every
 * state-changing request from it. Kept in its own leaf module so it's unit-testable without
 * dragging in the database on import.
 */
import type { Request, Response, NextFunction } from "express";

/** Requests a view-only tenant's staff may still make despite the read-only lock. */
const VIEW_ONLY_ALLOWED_PATHS = new Set(["/api/auth/logout"]);

export function enforceTenantViewOnly(req: Request, res: Response, next: NextFunction) {
  const user = req.user as any;
  if (!user?.tenantViewOnly) return next();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (VIEW_ONLY_ALLOWED_PATHS.has(req.path)) return next();
  return res.status(403).json({
    code: "TENANT_VIEW_ONLY",
    message: "Your account is suspended and in read-only mode. Settle the outstanding balance to restore full access.",
  });
}
