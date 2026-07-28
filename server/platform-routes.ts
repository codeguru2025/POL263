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
import { invalidateTenantModuleCache } from "./module-gate";
import { provisionTenantEmailDomain } from "./email-domain-provisioning";
import { auditLog } from "./route-helpers";
import { ORG_TYPES, PRODUCT_TYPES, DISTRIBUTION_CHANNELS } from "@shared/org-profile";
import { upsertTenantDatabaseRouting } from "./tenant-data-migration";
import { commissionDedicatedTenantDatabase } from "./tenant-db-commissioning";
import { IMPORT_ENTITY_TYPES, type ImportEntityType } from "@shared/schema";
import {
  parseUploadedFile, MAX_IMPORT_ROWS, getFieldSpec, transformAndValidateRow,
  cacheParsedUpload, getCachedUpload, AUDIT_ENTITY_TYPE_LABEL,
} from "./legacy-import";

const KNOWN_FEATURE_FLAGS = ["claims_enabled", "mobile_payments", "agent_portal", "whatsapp_notifications", "email_notifications", "email_inbound"];

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

const legacyImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(csv|xlsx|xls)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error("File must be .csv, .xlsx, or .xls"));
  },
});

// Extended as more entity types gain a field spec/commit path (see legacy-import.ts).
const SUPPORTED_IMPORT_ENTITY_TYPES: ImportEntityType[] = ["client", "policy", "payment", "claim", "dependent"];

function importDependencyMessage(entityType: ImportEntityType): string {
  const dependsOn = entityType === "policy" ? "clients" : "policies";
  return `Importing ${entityType} data requires existing ${dependsOn} (or a committed ${dependsOn.slice(0, -1)} import) first.`;
}

/** Which already-imported parent entities a row must reference, and by which field — "dependent"
 *  is the only type with two (a client for household, a policy for the actual membership). */
function parentChecksFor(entityType: ImportEntityType): { parentType: ImportEntityType; field: string }[] {
  if (entityType === "policy") return [{ parentType: "client", field: "clientExternalKey" }];
  if (entityType === "payment" || entityType === "claim") return [{ parentType: "policy", field: "policyExternalKey" }];
  if (entityType === "dependent") return [
    { parentType: "client", field: "clientExternalKey" },
    { parentType: "policy", field: "policyExternalKey" },
  ];
  return [];
}

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
            domainCommissioned: tenant.domainCommissioned,
            suspendedAt: tenant.suspendedAt,
            suspendReason: tenant.suspendReason,
          }
        : { slug: null, isActive: true, licenseStatus: "active", provisioningState: "ready", domainCommissioned: true, suspendedAt: null, suspendReason: null },
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
    invalidateTenantModuleCache(id);

    if (flag === "email_inbound" && req.body.enabled === true) {
      const provisioning = await provisionTenantEmailDomain(id);
      return res.json({ flag, enabled: req.body.enabled, provisioning });
    }
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

  // ── Domain commissioning ─────────────────────────────────────────
  // Marks the tenant's default subdomain as manually added to DigitalOcean App Platform's
  // Domains list — see docs on tenants.domainCommissioned in shared/control-plane-schema.ts.
  app.post("/api/platform/tenants/:id/commission-domain", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const [before] = await cpDb.select().from(cpTenants).where(eq(cpTenants.id, id)).limit(1);
    if (before?.domainCommissioned) {
      return res.json({ slug: before.slug, domainCommissioned: true, domainCommissionedAt: before.domainCommissionedAt });
    }
    await cpDb.update(cpTenants).set({ domainCommissioned: true, domainCommissionedAt: new Date() }).where(eq(cpTenants.id, id));
    const [after] = await cpDb.select().from(cpTenants).where(eq(cpTenants.id, id)).limit(1);
    await auditLog(req, "COMMISSION_TENANT_DOMAIN", "Tenant", id, before, after, id);
    return res.json({ slug: after?.slug, domainCommissioned: after?.domainCommissioned, domainCommissionedAt: after?.domainCommissionedAt });
  });

  // ── Database routing ────────────────────────────────────────────
  app.put("/api/platform/tenants/:id/database", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { databaseUrl, databaseDirectUrl, migrationState } = req.body;
    if (databaseUrl !== undefined && databaseUrl !== null && typeof databaseUrl !== "string") {
      return res.status(400).json({ message: "databaseUrl must be a string or null" });
    }
    const patch = {
      databaseUrl: databaseUrl || null,
      databaseDirectUrl: databaseDirectUrl || null,
      migrationState: migrationState || "current",
    };
    await upsertTenantDatabaseRouting(cpDb, id, patch);
    structuredLog("warn", "Tenant database routing changed by platform owner", { tenantId: id, hasDatabaseUrl: !!patch.databaseUrl });
    await auditLog(req, "SET_TENANT_DATABASE_ROUTING", "TenantDatabase", id, null, { hasDatabaseUrl: !!patch.databaseUrl }, id);
    return res.json({ hasDatabaseUrl: !!patch.databaseUrl, migrationState: patch.migrationState });
  });

  // ── Automatic database commissioning (manual trigger / retry) ──────
  // Platform-owner equivalent of the automatic trial→paid trigger in
  // server/tenant-billing-service.ts — lets the owner (re)try provisioning on demand,
  // e.g. from the dashboard's "Pending dedicated database provisioning" section.
  app.post("/api/platform/tenants/:id/commission-database", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    // Fire-and-forget: the full migration (schema build, ~90-table copy, verification, cutover)
    // can run well past any HTTP gateway timeout for a tenant with real data volume. Respond
    // immediately and let the dashboard's existing migrationState polling reflect progress —
    // same pattern as the automatic trial→paid trigger in tenant-billing-service.ts.
    commissionDedicatedTenantDatabase(id)
      .then((result) => auditLog(req, "COMMISSION_TENANT_DATABASE", "Tenant", id, null, result, id))
      .catch((err) => structuredLog("error", "commissionDedicatedTenantDatabase (manual trigger) failed", { tenantId: id, error: (err as Error).message }));
    return res.json({ started: true });
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

  // ── Legacy data import (bulk-import a tenant's history from POL360/Easipol/etc) ──
  // Feeds the "map legacy plan name → real product version" value-mapping step for policy imports.
  app.get("/api/platform/tenants/:id/import/product-versions", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const versions = await storage.getAllProductVersions(id);
    return res.json(versions.map((v) => ({ id: v.id, version: v.version, productName: v.productName })));
  });

  app.post("/api/platform/tenants/:id/import/upload", requireAuth, requirePlatformOwner, legacyImportUpload.single("file"), async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const entityType = String(req.body.entityType || "") as ImportEntityType;
    if (!SUPPORTED_IMPORT_ENTITY_TYPES.includes(entityType)) {
      return res.status(400).json({ message: `Import not yet supported for entity type: ${entityType || "(none)"}` });
    }
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      if (!(await storage.hasImportableDependency(id, entityType))) {
        return res.status(400).json({ message: importDependencyMessage(entityType) });
      }
      const parsed = await parseUploadedFile(req.file.buffer, req.file.originalname);
      if (parsed.rows.length === 0) return res.status(400).json({ message: "File has no data rows" });
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ message: `File has ${parsed.rows.length} rows — split into files of ${MAX_IMPORT_ROWS} or fewer.` });
      }
      const fieldSpec = getFieldSpec(entityType);
      const suggestedMapping: Record<string, string> = {};
      for (const spec of fieldSpec) {
        const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_-]/g, "");
        const match = parsed.headers.find((h) => normalize(h) === normalize(spec.field) || normalize(h) === normalize(spec.label));
        if (match) suggestedMapping[spec.field] = match;
      }
      const uploadToken = cacheParsedUpload(id, req.file.originalname, parsed);
      return res.json({
        uploadToken,
        headers: parsed.headers,
        sampleRows: parsed.rows.slice(0, 20),
        totalRows: parsed.rows.length,
        suggestedMapping,
        fieldSpec,
      });
    } catch (err: any) {
      return res.status(400).json({ message: err?.message || "Failed to parse file" });
    }
  });
  app.use("/api/platform/tenants/:id/import/upload", handleUploadError);

  // Distinct values for a mapped source column — feeds the "map legacy plan name → real product
  // version" value-mapping step (only the mapping step knows which column is "plan name", so this
  // can't be precomputed at upload time).
  app.post("/api/platform/tenants/:id/import/distinct-values", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { uploadToken, column } = req.body || {};
    const cached = getCachedUpload(String(uploadToken || ""), id);
    if (!cached) return res.status(400).json({ message: "Upload expired or not found — please re-upload the file" });
    if (!column || typeof column !== "string") return res.status(400).json({ message: "column is required" });
    const values = new Set<string>();
    for (const row of cached.rows) {
      const v = (row[column] ?? "").toString().trim();
      if (v) values.add(v);
      if (values.size >= 200) break;
    }
    return res.json({ values: Array.from(values).sort() });
  });

  app.post("/api/platform/tenants/:id/import/preview", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const user = req.user as any;
    const { uploadToken, entityType, columnMapping, valueMappings, sourceSystemLabel } = req.body || {};
    if (!SUPPORTED_IMPORT_ENTITY_TYPES.includes(entityType)) {
      return res.status(400).json({ message: `Import not yet supported for entity type: ${entityType}` });
    }
    if (!columnMapping || typeof columnMapping !== "object") {
      return res.status(400).json({ message: "columnMapping is required" });
    }
    const cached = getCachedUpload(String(uploadToken || ""), id);
    if (!cached) return res.status(400).json({ message: "Upload expired or not found — please re-upload the file" });
    if (!(await storage.hasImportableDependency(id, entityType))) {
      return res.status(400).json({ message: importDependencyMessage(entityType) });
    }

    try {
      const existingKeys = await storage.getExistingImportExternalKeys(id, entityType);
      // Policies/payments/claims/dependants reference an already-imported parent by legacy id —
      // validate that reference exists now (at preview time) so the admin gets an immediate,
      // specific error instead of a wall of "not found" failures at commit.
      const parentChecks = parentChecksFor(entityType);
      const parentKeysByType = new Map<ImportEntityType, Set<string>>();
      for (const pc of parentChecks) {
        if (!parentKeysByType.has(pc.parentType)) {
          parentKeysByType.set(pc.parentType, await storage.getExistingImportExternalKeys(id, pc.parentType));
        }
      }

      // The real DB-unique business key each entity actually enforces (distinct from the legacy
      // externalKey above, which is only this feature's own bookkeeping) — checked here too so a
      // colliding policyNumber/claimNumber/receiptNumber is caught with a clear message now,
      // rather than aborting the whole commit on a raw unique-constraint violation later.
      const businessKeyField = entityType === "policy" ? "policyNumber" : entityType === "claim" ? "claimNumber" : entityType === "payment" ? "receiptNumber" : null;
      const existingBusinessKeys = businessKeyField ? await storage.getExistingBusinessKeys(id, entityType) : null;
      const seenBusinessKeysInFile = new Set<string>();

      const seenInFile = new Set<string>();
      const validRows: any[] = [];
      const errorReport: { rowIndex: number; field: string; message: string }[] = [];

      cached.rows.forEach((rawRow, idx) => {
        const result = transformAndValidateRow(entityType, rawRow, idx, columnMapping);
        if (result.errors.length > 0) {
          errorReport.push(...result.errors);
          return;
        }
        const externalKey = result.value.externalKey;
        if (existingKeys.has(externalKey) || seenInFile.has(externalKey)) {
          errorReport.push({ rowIndex: idx, field: "externalKey", message: `Legacy ID "${externalKey}" is already imported or duplicated in this file` });
          return;
        }
        for (const pc of parentChecks) {
          const parentKey = result.value[pc.field];
          if (!parentKeysByType.get(pc.parentType)!.has(parentKey)) {
            errorReport.push({ rowIndex: idx, field: pc.field, message: `Legacy ${pc.parentType} ID "${parentKey}" was not found among imported ${pc.parentType}s` });
            return;
          }
        }
        if (businessKeyField && existingBusinessKeys) {
          const bkValue = result.value[businessKeyField];
          if (existingBusinessKeys.has(bkValue) || seenBusinessKeysInFile.has(bkValue)) {
            errorReport.push({ rowIndex: idx, field: businessKeyField, message: `${businessKeyField} "${bkValue}" is already in use or duplicated in this file` });
            return;
          }
          seenBusinessKeysInFile.add(bkValue);
        }
        seenInFile.add(externalKey);
        validRows.push({ ...result.value, __rowIndex: idx });
      });

      const batch = await storage.createImportBatch({
        organizationId: id,
        entityType,
        sourceSystemLabel: sourceSystemLabel || null,
        fileName: cached.fileName,
        columnMapping,
        valueMappings: valueMappings || null,
        status: "previewed",
        totalRows: cached.rows.length,
        successRows: validRows.length,
        errorRows: errorReport.length,
        previewSnapshot: validRows,
        errorReport,
        createdByUserId: user.id,
      });

      return res.status(201).json({
        batchId: batch.id,
        totalRows: batch.totalRows,
        successRows: batch.successRows,
        errorRows: batch.errorRows,
        sampleErrors: errorReport.slice(0, 50),
      });
    } catch (err: any) {
      structuredLog("error", "POST /api/platform/tenants/:id/import/preview failed", { error: err?.message, orgId: id });
      return res.status(500).json({ message: err?.message || "Preview failed" });
    }
  });

  app.get("/api/platform/tenants/:id/import/batches", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const entityType = (req.query.entityType as ImportEntityType | undefined) || undefined;
    const batches = await storage.listImportBatches(id, entityType);
    return res.json(batches.map(({ previewSnapshot, ...rest }) => rest));
  });

  app.get("/api/platform/tenants/:id/import/batches/:batchId", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const batch = await storage.getImportBatch(req.params.batchId as string, id);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    const { previewSnapshot, ...rest } = batch;
    return res.json(rest);
  });

  app.get("/api/platform/tenants/:id/import/batches/:batchId/audit-log", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const batch = await storage.getImportBatch(req.params.batchId as string, id);
    if (!batch) return res.status(404).json({ message: "Import batch not found" });
    const rows = await storage.getImportBatchAuditLog(id, batch.id);
    return res.json(rows);
  });

  app.post("/api/platform/tenants/:id/import/batches/:batchId/commit", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const batchId = req.params.batchId as string;
    if (!(await requireTenant(id, res))) return;
    const user = req.user as any;
    try {
      const batch = await storage.getImportBatch(batchId, id);
      if (!batch) return res.status(404).json({ message: "Import batch not found" });
      if (batch.status !== "previewed") return res.status(400).json({ message: `Batch is already ${batch.status}` });
      if (batch.successRows === 0) return res.status(400).json({ message: "No valid rows to import" });

      const result = await storage.commitImportBatch(id, batchId, { userId: user.id });
      await auditLog(req, "bulk_import", AUDIT_ENTITY_TYPE_LABEL[batch.entityType as ImportEntityType], batchId, null, result, id);
      return res.json(result);
    } catch (err: any) {
      structuredLog("error", "POST /api/platform/tenants/:id/import/batches/:batchId/commit failed", { error: err?.message, batchId });
      return res.status(500).json({ message: err?.message || "Import commit failed" });
    }
  });

  app.post("/api/platform/tenants/:id/import/batches/:batchId/rollback", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const batchId = req.params.batchId as string;
    if (!(await requireTenant(id, res))) return;
    const user = req.user as any;
    try {
      const batch = await storage.getImportBatch(batchId, id);
      if (!batch) return res.status(404).json({ message: "Import batch not found" });
      if (batch.status !== "committed") return res.status(400).json({ message: `Batch is ${batch.status}, not committed — nothing to roll back.` });

      const result = await storage.rollbackImportBatch(id, batchId, { userId: user.id });
      if (!result.ok) return res.status(409).json({ message: result.reason });

      await auditLog(req, "rollback_import", AUDIT_ENTITY_TYPE_LABEL[batch.entityType as ImportEntityType], batchId, null, { rolledBack: true }, id);
      return res.json(result);
    } catch (err: any) {
      structuredLog("error", "POST /api/platform/tenants/:id/import/batches/:batchId/rollback failed", { error: err?.message, batchId });
      return res.status(500).json({ message: err?.message || "Rollback failed" });
    }
  });
}
