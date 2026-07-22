/**
 * Platform-owner-only tenant configuration console API.
 *
 * Everything here is control-plane-shaped tenant config (branding, PayNow, feature
 * flags, domains, database routing, storage routing) that used to be either
 * tenant self-service (branding, PayNow) or had no UI/API at all (the rest). All
 * routes are gated by requirePlatformOwner — there is no permission-string
 * variant, since this is platform-owner-exclusive by design (see
 * docs — the "control plane" is metadata about tenants, not tenant data itself).
 */
import type { Express } from "express";
import multer from "multer";
import path from "path";
import { eq, ne, and } from "drizzle-orm";
import { requireAuth, requirePlatformOwner, invalidateTenantActiveCache } from "./auth";
import { storage } from "./storage";
import { cpDb } from "./control-plane-db";
import {
  tenants as cpTenants,
  tenantDomains,
  tenantDatabases,
  tenantStorage,
  tenantIntegrations,
  tenantFeatureFlags,
} from "@shared/control-plane-schema";
import { upsertTenantBranding, getTenantBranding, type TenantBrandingPatch } from "./tenant-branding-config";
import { getOrgPaynowConfig, upsertOrgPaynowConfig } from "./paynow-config";
import { encryptSecret } from "./tenant-config-crypto";
import * as objectStorage from "./object-storage";
import { structuredLog } from "./logger";
import { auditLog } from "./route-helpers";
import { ORG_TYPES, PRODUCT_TYPES, DISTRIBUTION_CHANNELS } from "@shared/org-profile";

const KNOWN_FEATURE_FLAGS = ["claims_enabled", "mobile_payments", "agent_portal", "whatsapp_notifications"];

const brandingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(png|jpg|jpeg|webp)$/i;
    const allowedMimes = ["image/png", "image/jpeg", "image/webp"];
    if (allowed.test(path.extname(file.originalname)) && allowedMimes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Logo/signature must be PNG, JPG, or WebP"));
  },
});

function handleUploadError(err: any, _req: any, res: any, next: any) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "File too large (max 5MB)" });
    return res.status(400).json({ message: err.message });
  }
  if (err?.message) return res.status(400).json({ message: err.message });
  next(err);
}

async function requireTenant(id: string, res: any): Promise<boolean> {
  const [tenant] = await cpDb.select({ id: cpTenants.id }).from(cpTenants).where(eq(cpTenants.id, id)).limit(1);
  if (!tenant) {
    res.status(404).json({ message: "Tenant not found" });
    return false;
  }
  return true;
}

export function registerPlatformRoutes(app: Express): void {
  // ── Full config bundle ──────────────────────────────────────────
  app.get("/api/platform/tenants/:id/config", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const org = await storage.getOrganization(id);
    if (!org) return res.status(404).json({ message: "Tenant not found" });

    const [paynow, flags, domains, database, storageRow, storageIntegration, tenantRow] = await Promise.all([
      getOrgPaynowConfig(id),
      cpDb.select().from(tenantFeatureFlags).where(eq(tenantFeatureFlags.tenantId, id)),
      cpDb.select().from(tenantDomains).where(eq(tenantDomains.tenantId, id)),
      cpDb.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, id)).limit(1),
      cpDb.select().from(tenantStorage).where(eq(tenantStorage.tenantId, id)).limit(1),
      cpDb.select().from(tenantIntegrations).where(and(eq(tenantIntegrations.tenantId, id), eq(tenantIntegrations.provider, "storage"))).limit(1),
      cpDb.select().from(cpTenants).where(eq(cpTenants.id, id)).limit(1),
    ]);
    const tenant = tenantRow[0];

    return res.json({
      id: org.id,
      name: org.name,
      lifecycle: tenant
        ? {
            slug: tenant.slug,
            isActive: tenant.isActive,
            licenseStatus: tenant.licenseStatus,
            provisioningState: tenant.provisioningState,
            suspendedAt: tenant.suspendedAt,
            suspendReason: tenant.suspendReason,
          }
        : { slug: null, isActive: true, licenseStatus: "active", provisioningState: "ready", suspendedAt: null, suspendReason: null },
      branding: {
        logoUrl: org.logoUrl,
        signatureUrl: org.signatureUrl,
        primaryColor: org.primaryColor,
        footerText: org.footerText,
        address: org.address,
        phone: org.phone,
        email: org.email,
        website: org.website,
        policyNumberPrefix: org.policyNumberPrefix,
        policyNumberPadding: org.policyNumberPadding,
        isWhitelabeled: org.isWhitelabeled,
      },
      payments: {
        integrationId: paynow.integrationId,
        authEmail: paynow.authEmail,
        returnUrl: paynow.returnUrl,
        resultUrl: paynow.resultUrl,
        mode: paynow.mode,
        hasKey: !!paynow.integrationKey,
      },
      featureFlags: flags.map((f) => ({ flag: f.flag, enabled: f.enabled, setAt: f.setAt })),
      domains: domains.map((d) => ({ id: d.id, domain: d.domain, isPrimary: d.isPrimary, isVerified: d.isVerified })),
      database: database[0]
        ? {
            databaseUrl: database[0].databaseUrl ? "•".repeat(12) : null,
            hasDatabaseUrl: !!database[0].databaseUrl,
            migrationState: database[0].migrationState,
            schemaVersion: database[0].schemaVersion,
            lastMigratedAt: database[0].lastMigratedAt,
          }
        : { databaseUrl: null, hasDatabaseUrl: false, migrationState: "current", schemaVersion: null, lastMigratedAt: null },
      storage: storageRow[0]
        ? {
            prefix: storageRow[0].prefix,
            bucket: storageRow[0].bucket,
            region: storageRow[0].region,
            endpoint: storageRow[0].endpoint,
            accessKeyId: storageRow[0].accessKeyId,
            hasSecretAccessKey: !!storageIntegration[0]?.config,
          }
        : { prefix: `tenants/${id}/`, bucket: null, region: null, endpoint: null, accessKeyId: null, hasSecretAccessKey: false },
      profile: {
        orgType: org.orgType,
        productTypes: org.productTypes,
        distributionChannels: org.distributionChannels,
        bookStatus: org.bookStatus,
        bookSizeCurrent: org.bookSizeCurrent,
        bookSizeProjected12mo: org.bookSizeProjected12mo,
        staffComplement: org.staffComplement,
        onboardingProfileCompletedAt: org.onboardingProfileCompletedAt,
      },
    });
  });

  // ── Business profile (org type, product types, book size, staff, channels) ────────
  app.put("/api/platform/tenants/:id/profile", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const before = await storage.getOrganization(id);
    if (!before) return res.status(404).json({ message: "Tenant not found" });

    const { orgType, productTypes, distributionChannels, bookStatus, bookSizeCurrent, bookSizeProjected12mo, staffComplement } = req.body;
    const patch: Record<string, any> = {};

    if (orgType !== undefined) {
      if (orgType !== null && !(ORG_TYPES as readonly string[]).includes(orgType)) {
        return res.status(400).json({ message: `orgType must be one of: ${ORG_TYPES.join(", ")}` });
      }
      patch.orgType = orgType;
    }
    if (productTypes !== undefined) {
      const list = Array.isArray(productTypes) ? productTypes : [];
      const unknown = list.filter((t: any) => !(PRODUCT_TYPES as readonly string[]).includes(t));
      if (unknown.length > 0) return res.status(400).json({ message: `Unknown product type(s): ${unknown.join(", ")}` });
      patch.productTypes = list;
    }
    if (distributionChannels !== undefined) {
      const list = Array.isArray(distributionChannels) ? distributionChannels : [];
      const unknown = list.filter((c: any) => !(DISTRIBUTION_CHANNELS as readonly string[]).includes(c));
      if (unknown.length > 0) return res.status(400).json({ message: `Unknown distribution channel(s): ${unknown.join(", ")}` });
      patch.distributionChannels = list;
    }
    if (bookStatus !== undefined) {
      if (bookStatus !== null && bookStatus !== "existing" && bookStatus !== "new") {
        return res.status(400).json({ message: "bookStatus must be 'existing', 'new', or null" });
      }
      patch.bookStatus = bookStatus;
    }
    if (bookSizeCurrent !== undefined) patch.bookSizeCurrent = bookSizeCurrent === null ? null : parseInt(bookSizeCurrent, 10);
    if (bookSizeProjected12mo !== undefined) patch.bookSizeProjected12mo = bookSizeProjected12mo === null ? null : parseInt(bookSizeProjected12mo, 10);
    if (staffComplement !== undefined) patch.staffComplement = staffComplement === null ? null : parseInt(staffComplement, 10);

    // Stamp completion once orgType is set and hasn't been stamped yet — marks the tenant as
    // having gone through (or been backfilled with) the onboarding profile at least once.
    if (patch.orgType && !before.onboardingProfileCompletedAt) {
      patch.onboardingProfileCompletedAt = new Date();
    }

    const updated = await storage.updateOrganization(id, patch);
    await auditLog(req, "UPDATE_TENANT_PROFILE", "Organization", id, before, updated, id);
    return res.json({
      orgType: updated?.orgType, productTypes: updated?.productTypes, distributionChannels: updated?.distributionChannels,
      bookStatus: updated?.bookStatus, bookSizeCurrent: updated?.bookSizeCurrent, bookSizeProjected12mo: updated?.bookSizeProjected12mo,
      staffComplement: updated?.staffComplement, onboardingProfileCompletedAt: updated?.onboardingProfileCompletedAt,
    });
  });

  // ── Lifecycle (suspend/reactivate, license status) ────────────────
  const LICENSE_STATUSES = new Set(["active", "suspended", "trial", "expired"]);
  app.put("/api/platform/tenants/:id/lifecycle", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { action, reason, licenseStatus } = req.body;

    let patch: Record<string, any>;
    if (action === "suspend") {
      patch = { isActive: false, licenseStatus: "suspended", suspendedAt: new Date(), suspendReason: reason || null };
    } else if (action === "reactivate") {
      patch = { isActive: true, licenseStatus: "active", suspendedAt: null, suspendReason: null };
    } else if (action === "setLicenseStatus") {
      if (!LICENSE_STATUSES.has(licenseStatus)) {
        return res.status(400).json({ message: `licenseStatus must be one of: ${Array.from(LICENSE_STATUSES).join(", ")}` });
      }
      patch = { licenseStatus };
    } else {
      return res.status(400).json({ message: "action must be one of: suspend, reactivate, setLicenseStatus" });
    }

    const [before] = await cpDb.select().from(cpTenants).where(eq(cpTenants.id, id)).limit(1);
    await cpDb.update(cpTenants).set(patch).where(eq(cpTenants.id, id));
    const [after] = await cpDb.select().from(cpTenants).where(eq(cpTenants.id, id)).limit(1);
    invalidateTenantActiveCache(id);
    structuredLog("warn", "Tenant lifecycle changed by platform owner", { tenantId: id, action, licenseStatus: after?.licenseStatus, isActive: after?.isActive });
    await auditLog(req, "SET_TENANT_LIFECYCLE", "Tenant", id, before, after, id);
    return res.json({
      slug: after?.slug,
      isActive: after?.isActive,
      licenseStatus: after?.licenseStatus,
      provisioningState: after?.provisioningState,
      suspendedAt: after?.suspendedAt,
      suspendReason: after?.suspendReason,
    });
  });

  // ── Branding ─────────────────────────────────────────────────────
  app.patch("/api/platform/tenants/:id/branding", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;

    const ALLOWED = new Set([
      "logoUrl", "signatureUrl", "primaryColor", "footerText", "address", "phone",
      "email", "website", "policyNumberPrefix", "policyNumberPadding", "isWhitelabeled",
    ]);
    const patch: TenantBrandingPatch = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (ALLOWED.has(key)) (patch as any)[key] = value;
    }
    if (patch.policyNumberPadding !== undefined && patch.policyNumberPadding !== null) {
      patch.policyNumberPadding = Math.max(1, Math.min(20, Number(patch.policyNumberPadding)));
    }

    const before = await getTenantBranding(id);
    await upsertTenantBranding(id, patch);
    const after = await getTenantBranding(id);
    await auditLog(req, "UPDATE_TENANT_BRANDING", "TenantBranding", id, before, after, id);
    return res.json(after);
  });

  app.post("/api/platform/tenants/:id/branding/upload-logo", requireAuth, requirePlatformOwner, brandingUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "File is empty" });
    try {
      const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "logos");
      return res.json({ url, filename: key });
    } catch (err: any) {
      structuredLog("error", "Platform logo upload failed", { error: err?.message });
      return res.status(500).json({ message: "Upload failed. Please try again." });
    }
  });
  app.use("/api/platform/tenants/:id/branding/upload-logo", handleUploadError);

  app.post("/api/platform/tenants/:id/branding/upload-signature", requireAuth, requirePlatformOwner, brandingUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "File is empty" });
    try {
      const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "signatures");
      return res.json({ url, filename: key });
    } catch (err: any) {
      structuredLog("error", "Platform signature upload failed", { error: err?.message });
      return res.status(500).json({ message: "Upload failed. Please try again." });
    }
  });
  app.use("/api/platform/tenants/:id/branding/upload-signature", handleUploadError);

  // ── PayNow / payments ───────────────────────────────────────────
  app.patch("/api/platform/tenants/:id/payments", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { paynowIntegrationId, paynowIntegrationKey, paynowAuthEmail, paynowReturnUrl, paynowResultUrl, paynowMode } = req.body;
    const mode = paynowMode === "test" || paynowMode === "live" ? paynowMode : undefined;
    await upsertOrgPaynowConfig(id, {
      integrationId: paynowIntegrationId,
      integrationKey: paynowIntegrationKey,
      authEmail: paynowAuthEmail,
      returnUrl: paynowReturnUrl,
      resultUrl: paynowResultUrl,
      mode,
    });
    await auditLog(req, "UPDATE_TENANT_PAYNOW", "TenantIntegration", id, null, { paynowConfigChanged: true }, id);
    const updated = await getOrgPaynowConfig(id);
    return res.json({ ...updated, integrationKey: undefined, hasKey: !!updated.integrationKey });
  });

  // ── Feature flags ────────────────────────────────────────────────
  app.get("/api/platform/tenants/:id/feature-flags", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const flags = await cpDb.select().from(tenantFeatureFlags).where(eq(tenantFeatureFlags.tenantId, id));
    return res.json({ known: KNOWN_FEATURE_FLAGS, flags });
  });

  app.put("/api/platform/tenants/:id/feature-flags/:flag", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const flag = req.params.flag as string;
    if (!(await requireTenant(id, res))) return;
    if (typeof req.body.enabled !== "boolean") {
      return res.status(400).json({ message: "enabled (boolean) is required" });
    }
    const [existing] = await cpDb.select({ tenantId: tenantFeatureFlags.tenantId }).from(tenantFeatureFlags)
      .where(and(eq(tenantFeatureFlags.tenantId, id), eq(tenantFeatureFlags.flag, flag))).limit(1);
    if (existing) {
      await cpDb.update(tenantFeatureFlags).set({ enabled: req.body.enabled, setAt: new Date() })
        .where(and(eq(tenantFeatureFlags.tenantId, id), eq(tenantFeatureFlags.flag, flag)));
    } else {
      await cpDb.insert(tenantFeatureFlags).values({ tenantId: id, flag, enabled: req.body.enabled });
    }
    await auditLog(req, "SET_TENANT_FEATURE_FLAG", "TenantFeatureFlag", id, null, { flag, enabled: req.body.enabled }, id);
    return res.json({ flag, enabled: req.body.enabled });
  });

  app.delete("/api/platform/tenants/:id/feature-flags/:flag", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const flag = req.params.flag as string;
    await cpDb.delete(tenantFeatureFlags).where(and(eq(tenantFeatureFlags.tenantId, id), eq(tenantFeatureFlags.flag, flag)));
    await auditLog(req, "REMOVE_TENANT_FEATURE_FLAG", "TenantFeatureFlag", id, { flag }, null, id);
    return res.status(204).send();
  });

  // ── Domains ──────────────────────────────────────────────────────
  app.get("/api/platform/tenants/:id/domains", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const domains = await cpDb.select().from(tenantDomains).where(eq(tenantDomains.tenantId, id));
    return res.json(domains);
  });

  app.post("/api/platform/tenants/:id/domains", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const domain = String(req.body.domain || "").trim().toLowerCase();
    if (!domain) return res.status(400).json({ message: "domain is required" });
    try {
      const [created] = await cpDb.insert(tenantDomains).values({
        tenantId: id, domain, isPrimary: !!req.body.isPrimary, isVerified: false,
      }).returning();
      if (req.body.isPrimary) {
        await cpDb.update(tenantDomains).set({ isPrimary: false })
          .where(and(eq(tenantDomains.tenantId, id), ne(tenantDomains.id, created.id)));
      }
      await auditLog(req, "ADD_TENANT_DOMAIN", "TenantDomain", id, null, created, id);
      return res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(409).json({ message: "This domain is already in use." });
      throw err;
    }
  });

  app.patch("/api/platform/tenants/:id/domains/:domainId", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const domainId = req.params.domainId as string;
    const patch: Record<string, any> = {};
    if (typeof req.body.isVerified === "boolean") patch.isVerified = req.body.isVerified;

    if (req.body.isPrimary === true) {
      await cpDb.transaction(async (tx) => {
        await tx.update(tenantDomains).set({ isPrimary: false })
          .where(and(eq(tenantDomains.tenantId, id), ne(tenantDomains.id, domainId)));
        await tx.update(tenantDomains).set({ ...patch, isPrimary: true })
          .where(and(eq(tenantDomains.tenantId, id), eq(tenantDomains.id, domainId)));
      });
    } else if (Object.keys(patch).length > 0) {
      await cpDb.update(tenantDomains).set(patch)
        .where(and(eq(tenantDomains.tenantId, id), eq(tenantDomains.id, domainId)));
    }
    const [updated] = await cpDb.select().from(tenantDomains).where(eq(tenantDomains.id, domainId)).limit(1);
    if (!updated) return res.status(404).json({ message: "Domain not found" });
    await auditLog(req, "UPDATE_TENANT_DOMAIN", "TenantDomain", id, null, updated, id);
    return res.json(updated);
  });

  app.delete("/api/platform/tenants/:id/domains/:domainId", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const domainId = req.params.domainId as string;
    await cpDb.delete(tenantDomains).where(and(eq(tenantDomains.tenantId, id), eq(tenantDomains.id, domainId)));
    await auditLog(req, "REMOVE_TENANT_DOMAIN", "TenantDomain", id, { domainId }, null, id);
    return res.status(204).send();
  });

  // ── Database routing ────────────────────────────────────────────
  app.put("/api/platform/tenants/:id/database", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { databaseUrl, databaseDirectUrl, migrationState } = req.body;
    if (databaseUrl !== undefined && databaseUrl !== null && typeof databaseUrl !== "string") {
      return res.status(400).json({ message: "databaseUrl must be a string or null" });
    }
    const [existing] = await cpDb.select({ tenantId: tenantDatabases.tenantId }).from(tenantDatabases)
      .where(eq(tenantDatabases.tenantId, id)).limit(1);
    const patch = {
      databaseUrl: databaseUrl || null,
      databaseDirectUrl: databaseDirectUrl || null,
      migrationState: migrationState || "current",
      lastMigratedAt: new Date(),
    };
    if (existing) {
      await cpDb.update(tenantDatabases).set(patch).where(eq(tenantDatabases.tenantId, id));
    } else {
      await cpDb.insert(tenantDatabases).values({ tenantId: id, ...patch });
    }
    structuredLog("warn", "Tenant database routing changed by platform owner", { tenantId: id, hasDatabaseUrl: !!patch.databaseUrl });
    await auditLog(req, "SET_TENANT_DATABASE_ROUTING", "TenantDatabase", id, null, { hasDatabaseUrl: !!patch.databaseUrl }, id);
    return res.json({ hasDatabaseUrl: !!patch.databaseUrl, migrationState: patch.migrationState });
  });

  // ── Storage routing ─────────────────────────────────────────────
  app.put("/api/platform/tenants/:id/storage", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { prefix, bucket, region, endpoint, accessKeyId, secretAccessKey } = req.body;
    const patch = {
      prefix: prefix || `tenants/${id}/`,
      bucket: bucket || null,
      region: region || null,
      endpoint: endpoint || null,
      accessKeyId: accessKeyId || null,
    };
    const [existing] = await cpDb.select({ tenantId: tenantStorage.tenantId }).from(tenantStorage)
      .where(eq(tenantStorage.tenantId, id)).limit(1);
    if (existing) {
      await cpDb.update(tenantStorage).set(patch).where(eq(tenantStorage.tenantId, id));
    } else {
      await cpDb.insert(tenantStorage).values({ tenantId: id, ...patch });
    }

    if (secretAccessKey) {
      const config = { secretAccessKey: encryptSecret(String(secretAccessKey)) };
      const [existingIntegration] = await cpDb.select({ id: tenantIntegrations.id }).from(tenantIntegrations)
        .where(and(eq(tenantIntegrations.tenantId, id), eq(tenantIntegrations.provider, "storage"))).limit(1);
      if (existingIntegration) {
        await cpDb.update(tenantIntegrations).set({ config, isActive: true, updatedAt: new Date() }).where(eq(tenantIntegrations.id, existingIntegration.id));
      } else {
        await cpDb.insert(tenantIntegrations).values({ tenantId: id, provider: "storage", isActive: true, config });
      }
    }

    await auditLog(req, "SET_TENANT_STORAGE_ROUTING", "TenantStorage", id, null, { ...patch, secretChanged: !!secretAccessKey }, id);
    return res.json({ ...patch, hasSecretAccessKey: !!secretAccessKey || undefined });
  });
}
