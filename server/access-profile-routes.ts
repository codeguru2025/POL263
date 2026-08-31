/**
 * Access profiles (Phase 7): platform-owner/admin-managed reusable permission bundles. Applying
 * one to a user writes an "allow" user_permission_override per listed permission — a shortcut for
 * "give this agent receipting rights" without hand-ticking each permission. Not a new RBAC layer.
 *
 * Gated on write:role, the same permission the per-user override routes use.
 */
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth, requireTenantScope, requirePermission } from "./auth";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { accessProfiles, permissions as permissionsTable } from "@shared/schema";
import { auditLog } from "./route-helpers";
import { structuredLog } from "./logger";

export function registerAccessProfileRoutes(app: Express): void {
  app.get("/api/access-profiles", requireAuth, requireTenantScope, requirePermission("read:role"), async (req, res) => {
    const orgId = (req.user as any).organizationId;
    const db = await getDbForOrg(orgId);
    const rows = await db.select().from(accessProfiles).where(eq(accessProfiles.organizationId, orgId)).orderBy(accessProfiles.name);
    return res.json(rows);
  });

  app.post("/api/access-profiles", requireAuth, requireTenantScope, requirePermission("write:role"), async (req, res) => {
    const orgId = (req.user as any).organizationId;
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "name is required" });
    const perms = await validatePermissionList(orgId, req.body?.permissions);
    if (perms.error) return res.status(400).json({ message: perms.error });

    const db = await getDbForOrg(orgId);
    try {
      const [created] = await db.insert(accessProfiles).values({
        organizationId: orgId, name, description: req.body?.description || null, permissions: perms.list,
      }).returning();
      await auditLog(req, "CREATE_ACCESS_PROFILE", "AccessProfile", created.id, null, created);
      return res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(409).json({ message: "A profile with this name already exists" });
      throw err;
    }
  });

  app.patch("/api/access-profiles/:id", requireAuth, requireTenantScope, requirePermission("write:role"), async (req, res) => {
    const orgId = (req.user as any).organizationId;
    const db = await getDbForOrg(orgId);
    const [existing] = await db.select().from(accessProfiles).where(and(eq(accessProfiles.id, req.params.id as string), eq(accessProfiles.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "Profile not found" });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body?.description !== undefined) patch.description = req.body.description || null;
    if (req.body?.permissions !== undefined) {
      const perms = await validatePermissionList(orgId, req.body.permissions);
      if (perms.error) return res.status(400).json({ message: perms.error });
      patch.permissions = perms.list;
    }
    await db.update(accessProfiles).set(patch).where(eq(accessProfiles.id, existing.id));
    const [after] = await db.select().from(accessProfiles).where(eq(accessProfiles.id, existing.id)).limit(1);
    await auditLog(req, "UPDATE_ACCESS_PROFILE", "AccessProfile", existing.id, existing, after);
    return res.json(after);
  });

  app.delete("/api/access-profiles/:id", requireAuth, requireTenantScope, requirePermission("write:role"), async (req, res) => {
    const orgId = (req.user as any).organizationId;
    const db = await getDbForOrg(orgId);
    const [existing] = await db.select().from(accessProfiles).where(and(eq(accessProfiles.id, req.params.id as string), eq(accessProfiles.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ message: "Profile not found" });
    await db.delete(accessProfiles).where(eq(accessProfiles.id, existing.id));
    await auditLog(req, "DELETE_ACCESS_PROFILE", "AccessProfile", existing.id, existing, null);
    return res.status(204).send();
  });

  /**
   * Apply a profile to a user: sets an "allow" override for each of the profile's permissions.
   * With ?mode=exclusive, also sets a "deny" override for every permission NOT in the profile —
   * turning the profile into the user's complete custom access list on top of role membership.
   */
  app.post("/api/users/:userId/apply-access-profile/:profileId", requireAuth, requireTenantScope, requirePermission("write:role"), async (req, res) => {
    const orgId = (req.user as any).organizationId;
    const db = await getDbForOrg(orgId);
    const target = await storage.getUser(req.params.userId as string, orgId);
    if (!target || target.organizationId !== orgId) return res.status(404).json({ message: "User not found" });
    const [profile] = await db.select().from(accessProfiles).where(and(eq(accessProfiles.id, req.params.profileId as string), eq(accessProfiles.organizationId, orgId))).limit(1);
    if (!profile) return res.status(404).json({ message: "Profile not found" });

    const exclusive = req.query.mode === "exclusive";
    const allowSet = new Set(profile.permissions);
    const allNames = (await db.select({ name: permissionsTable.name }).from(permissionsTable)).map((p) => p.name);

    let applied = 0;
    for (const name of profile.permissions) {
      await storage.setUserPermissionOverride(target.id, name, true, orgId);
      applied++;
    }
    if (exclusive) {
      for (const name of allNames) {
        if (allowSet.has(name)) continue;
        await storage.setUserPermissionOverride(target.id, name, false, orgId);
        applied++;
      }
    }

    await auditLog(req, "APPLY_ACCESS_PROFILE", "User", target.id, null, { profile: profile.name, mode: exclusive ? "exclusive" : "additive", applied });
    structuredLog("info", "Access profile applied", { orgId, userId: target.id, profile: profile.name, exclusive, applied });
    return res.json({ ok: true, applied });
  });
}

async function validatePermissionList(orgId: string, raw: unknown): Promise<{ list: string[]; error?: string }> {
  if (!Array.isArray(raw)) return { list: [], error: "permissions must be an array of permission names" };
  const list = Array.from(new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0)));
  if (list.length === 0) return { list: [] };
  const db = await getDbForOrg(orgId);
  const known = new Set(
    (await db.select({ name: permissionsTable.name }).from(permissionsTable).where(inArray(permissionsTable.name, list))).map((p) => p.name),
  );
  const unknown = list.filter((n) => !known.has(n));
  if (unknown.length) return { list: [], error: `Unknown permission(s): ${unknown.join(", ")}` };
  return { list };
}
