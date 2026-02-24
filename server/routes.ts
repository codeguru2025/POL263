import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { requireAuth, requirePermission, requireTenantScope } from "./auth";
import { structuredLog } from "./logger";
import { z } from "zod";
import { insertOrganizationSchema, insertBranchSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Organization / Tenant routes ─────────────────────────

  app.get("/api/organizations", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (user.organizationId) {
      const org = await storage.getOrganization(user.organizationId);
      return res.json(org ? [org] : []);
    }
    return res.json([]);
  });

  app.get("/api/organizations/:id", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const id = req.params.id as string;
    if (id !== user.organizationId) {
      return res.status(403).json({ message: "Cross-tenant access denied" });
    }
    const org = await storage.getOrganization(id);
    if (!org) return res.status(404).json({ message: "Organization not found" });
    return res.json(org);
  });

  app.patch(
    "/api/organizations/:id",
    requireAuth,
    requireTenantScope,
    requirePermission("write:organization"),
    async (req, res) => {
      const user = req.user as any;
      const id = req.params.id as string;
      if (id !== user.organizationId) {
        return res.status(403).json({ message: "Cross-tenant access denied" });
      }

      const before = await storage.getOrganization(id);
      const updated = await storage.updateOrganization(id, req.body);

      await storage.createAuditLog({
        organizationId: user.organizationId,
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE_ORGANIZATION",
        entityType: "Organization",
        entityId: id,
        before,
        after: updated,
        requestId: (req as any).requestId,
      });

      return res.json(updated);
    }
  );

  // ─── Branch routes ────────────────────────────────────────

  app.get("/api/branches", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const branches = await storage.getBranchesByOrg(user.organizationId);
    return res.json(branches);
  });

  app.post(
    "/api/branches",
    requireAuth,
    requireTenantScope,
    requirePermission("write:branch"),
    async (req, res) => {
      const user = req.user as any;
      const parsed = insertBranchSchema.parse({
        ...req.body,
        organizationId: user.organizationId,
      });
      const branch = await storage.createBranch(parsed);

      await storage.createAuditLog({
        organizationId: user.organizationId,
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE_BRANCH",
        entityType: "Branch",
        entityId: branch.id,
        before: null,
        after: branch,
        requestId: (req as any).requestId,
      });

      return res.status(201).json(branch);
    }
  );

  // ─── User routes ──────────────────────────────────────────

  app.get(
    "/api/users",
    requireAuth,
    requireTenantScope,
    requirePermission("read:user"),
    async (req, res) => {
      const user = req.user as any;
      const users = await storage.getUsersByOrg(user.organizationId);
      return res.json(
        users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          isActive: u.isActive,
          createdAt: u.createdAt,
        }))
      );
    }
  );

  // ─── Role routes ──────────────────────────────────────────

  app.get(
    "/api/roles",
    requireAuth,
    requireTenantScope,
    requirePermission("read:role"),
    async (req, res) => {
      const user = req.user as any;
      const rolesList = await storage.getRolesByOrg(user.organizationId);
      return res.json(rolesList);
    }
  );

  app.get(
    "/api/roles/:id/permissions",
    requireAuth,
    requireTenantScope,
    requirePermission("read:role"),
    async (req, res) => {
      const perms = await storage.getRolePermissions(req.params.id as string);
      return res.json(perms);
    }
  );

  // ─── Permission routes ────────────────────────────────────

  app.get(
    "/api/permissions",
    requireAuth,
    requirePermission("read:role"),
    async (_req, res) => {
      const perms = await storage.getPermissions();
      return res.json(perms);
    }
  );

  // ─── Audit Log routes ────────────────────────────────────

  app.get(
    "/api/audit-logs",
    requireAuth,
    requireTenantScope,
    requirePermission("read:audit_log"),
    async (req, res) => {
      const user = req.user as any;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const logs = await storage.getAuditLogs(user.organizationId, limit, offset);
      return res.json(logs);
    }
  );

  return httpServer;
}
