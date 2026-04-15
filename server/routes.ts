import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import argon2 from "argon2";
import { storage, findPaymentReceiptById, type ReportFilters } from "./storage";
import {
  withOrgTransaction,
  getDbForOrg,
  resolveUserIdForOrgDatabase,
  ensureRegistryUserMirroredToOrgDataDbInTx,
  ensureRegistryUserMirroredToOrgDataDb,
} from "./tenant-db";
import { requireAuth, requirePermission, requireAnyPermission, requireTenantScope } from "./auth";
import { structuredLog } from "./logger";
import { auditLog, safeError, getAddOnPrice, computePolicyPremium, recordClawback, rollbackClawbacks, enforceAgentScope } from "./route-helpers";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { registerPolicyDocumentRoute } from "./policy-document";
import { createPaymentIntent, initiatePaynowPayment, handlePaynowResult, pollPaynowStatus, applyPaymentToPolicy, initiatePaynowForGroup, pollGroupPaynowStatus, generateGroupMerchantReference } from "./payment-service";
import * as objectStorage from "./object-storage";
import { getPaynowConfig } from "./paynow-config";
import { getReceiptPdfPath } from "./receipt-pdf";
import { PLATFORM_OWNER_EMAIL } from "./constants";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, tenantBranding as cpTenantBranding } from "@shared/control-plane-schema";
import { applyPolicyStatusForClearedPayment } from "./policy-status-on-payment";
import { runApplyCreditBalances } from "./credit-apply";
import { toUpperTrim, normalizeNationalId, isValidNationalId, normalizeCurrency, SUPPORTED_CURRENCIES } from "../shared/validation";
import {
  insertOrganizationSchema, insertBranchSchema, insertClientSchema,
  insertProductSchema, insertProductVersionSchema, insertPolicySchema,
  insertClaimSchema, insertFuneralCaseSchema, insertFuneralTaskSchema,
  insertFleetVehicleSchema, insertCommissionPlanSchema,
  insertNotificationTemplateSchema, insertLeadSchema, insertExpenditureSchema,
  insertPriceBookItemSchema, insertBenefitCatalogItemSchema,
  insertBenefitBundleSchema, insertAddOnSchema, insertAgeBandConfigSchema,
  insertPaymentTransactionSchema, insertApprovalRequestSchema,
  insertPayrollEmployeeSchema, insertPayrollRunSchema, insertCashupSchema,
  insertGroupSchema, insertPlatformReceivableSchema, insertSettlementSchema,
  insertDependentSchema, insertTermsSchema,
  VALID_POLICY_TRANSITIONS, VALID_CLAIM_TRANSITIONS,
  policies, paymentTransactions, paymentReceipts, users, clients, claims, leads, branches,
} from "@shared/schema";
import { sql, eq, count, and } from "drizzle-orm";
import { notifyClient, notifyClientPush, dispatchNotification, buildPolicyContext } from "./notifications";
import { enqueueJob, getJobStats } from "./job-queue";
import {
  insertOutboxMessageInTx,
  requestOutboxDrain,
  OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP,
  OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP,
} from "./outbox";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  const DASHBOARD_MAX_ROWS =
    (process.env.DASHBOARD_MAX_ROWS && parseInt(process.env.DASHBOARD_MAX_ROWS, 10)) || 50000;
  const REPORT_EXPORT_MAX_ROWS =
    (process.env.REPORT_EXPORT_MAX_ROWS && parseInt(process.env.REPORT_EXPORT_MAX_ROWS, 10)) || 15000;
  const premiumBackfillRunning = new Set<string>();

  async function getActivePolicyDependentDobList(policy: any, orgId: string): Promise<(string | null | undefined)[]> {
    if (!policy?.id || !policy?.clientId) return [];
    const members = await storage.getPolicyMembers(policy.id, orgId);
    const activeDependentIds = members
      .filter((m: any) => m?.isActive !== false && !!m?.dependentId)
      .map((m: any) => String(m.dependentId));
    if (activeDependentIds.length === 0) return [];

    const deps = await storage.getDependentsByClient(policy.clientId, orgId);
    const depById = new Map<string, any>(deps.map((d: any) => [d.id, d]));
    return activeDependentIds
      .filter((id) => depById.has(id))
      .map((id) => depById.get(id)?.dateOfBirth ?? null);
  }

  async function getPolicyAddOnIds(policyId: string, orgId: string): Promise<string[]> {
    const policyAddOns = await storage.getPolicyAddOns(policyId, orgId);
    return Array.from(new Set(policyAddOns.map((a: any) => a.addOnId).filter(Boolean)));
  }

  async function recalculatePolicyPremiumIfNeeded(policy: any, orgId: string): Promise<any> {
    if (!policy?.id || !policy?.productVersionId) return policy;
    const dependentDateOfBirths = await getActivePolicyDependentDobList(policy, orgId);
    const addOnIds = await getPolicyAddOnIds(policy.id, orgId);
    const recomputedPremium = await computePolicyPremium(
      orgId,
      policy.productVersionId,
      policy.currency || "USD",
      policy.paymentSchedule || "monthly",
      addOnIds,
      undefined,
      undefined,
      dependentDateOfBirths,
    );

    const current = parseFloat(String(policy.premiumAmount ?? "0"));
    const next = parseFloat(String(recomputedPremium ?? "0"));
    if (Number.isFinite(current) && Number.isFinite(next) && Math.abs(current - next) >= 0.01) {
      const updated = await storage.updatePolicy(policy.id, { premiumAmount: recomputedPremium }, orgId);
      return updated || { ...policy, premiumAmount: recomputedPremium };
    }
    return policy;
  }

  function schedulePolicyPremiumBackfill(orgId: string) {
    if (!orgId || premiumBackfillRunning.has(orgId)) return;
    premiumBackfillRunning.add(orgId);
    enqueueJob("policy_premium_backfill", { orgId }, async () => {
      try {
        let offset = 0;
        const limit = 200;
        while (true) {
          const batch = await storage.getPoliciesByOrg(orgId, limit, offset);
          if (batch.length === 0) break;
          for (const policy of batch) {
            await recalculatePolicyPremiumIfNeeded(policy, orgId);
          }
          if (batch.length < limit) break;
          offset += batch.length;
        }
      } catch (err: any) {
        structuredLog("error", "Policy premium backfill failed", { orgId, error: err?.message, stack: err?.stack });
      } finally {
        premiumBackfillRunning.delete(orgId);
      }
    });
  }

  /** Paynow mobile wallets only — recurring automation triggers USSD/PIN on the saved number, not card storage. */
  function normalizePaymentMethodInput(raw: any): {
    methodType: "mobile";
    provider: string | null;
    mobileNumber: string | null;
    cardLast4: string | null;
    cardBrand: string | null;
    cardExpiryMonth: number | null;
    cardExpiryYear: number | null;
    cardToken: string | null;
  } | null {
    if (!raw || typeof raw !== "object") return null;
    if (raw.methodType === "card") return null;
    if (raw.methodType !== "mobile") return null;
    const provider = typeof raw.provider === "string" && raw.provider.trim() ? raw.provider.trim().toLowerCase() : null;
    const mobileNumber = typeof raw.mobileNumber === "string" ? raw.mobileNumber.trim() : "";
    if (!mobileNumber) return null;
    return {
      methodType: "mobile",
      provider: provider || "ecocash",
      mobileNumber,
      cardLast4: null,
      cardBrand: null,
      cardExpiryMonth: null,
      cardExpiryYear: null,
      cardToken: null,
    };
  }

  async function runPaymentAutomationForOrg(orgId: string): Promise<{ scanned: number; reminded: number; attempted: number; skipped: number }> {
    const settings = await storage.getPaymentAutomationSettings(orgId);
    if (!settings?.isEnabled) return { scanned: 0, reminded: 0, attempted: 0, skipped: 0 };

    const policies = await storage.getPoliciesByOrg(orgId, 100000, 0, { statuses: ["active", "grace"] });
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    let reminded = 0;
    let attempted = 0;
    let skipped = 0;

    for (const policy of policies) {
      if (!policy.clientId) continue;
      const payments = await storage.getPaymentsByPolicy(policy.id, orgId);
      const cleared = payments.filter((p: any) => p.status === "cleared");
      const lastClearedAt = cleared
        .map((p: any) => new Date(p.receivedAt || p.createdAt || policy.createdAt))
        .filter((d: Date) => !Number.isNaN(d.getTime()))
        .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0];
      const baseline = lastClearedAt || new Date(policy.inceptionDate || policy.effectiveDate || policy.createdAt);
      if (Number.isNaN(baseline.getTime())) continue;

      const daysSinceLastPayment = Math.floor((now.getTime() - baseline.getTime()) / msPerDay);
      if (daysSinceLastPayment < Number(settings.daysAfterLastPayment || 30)) continue;

      const lastTouchAt = policy.lastAutoReminderAt || policy.lastAutoPaymentAttemptAt;
      if (lastTouchAt) {
        const sinceLastTouch = Math.floor((now.getTime() - new Date(lastTouchAt).getTime()) / msPerDay);
        if (sinceLastTouch < Number(settings.repeatEveryDays || 30)) continue;
      }

      const ctx = await buildPolicyContext(policy, orgId);

      if (settings.autoRunPayments) {
        const method = await storage.getDefaultClientPaymentMethod(policy.clientId, orgId);
        if (!method) {
          skipped++;
          await storage.createPaymentAutomationRun(orgId, {
            organizationId: orgId,
            policyId: policy.id,
            clientId: policy.clientId,
            actionType: "auto_payment_attempt",
            status: "skipped",
            methodType: null,
            message: "No saved default Paynow mobile wallet.",
            metadata: null,
          } as any);
        } else if (method.methodType === "card") {
          skipped++;
          await storage.createPaymentAutomationRun(orgId, {
            organizationId: orgId,
            policyId: policy.id,
            clientId: policy.clientId,
            actionType: "auto_payment_attempt",
            status: "skipped",
            methodType: "card",
            message: "Legacy saved card — automation uses Paynow on a mobile wallet (client enters PIN on phone). Update saved method to EcoCash / OneMoney / InnBucks / O'Mari.",
            metadata: null,
          } as any);
        } else if (!method.mobileNumber?.trim()) {
          skipped++;
          await storage.createPaymentAutomationRun(orgId, {
            organizationId: orgId,
            policyId: policy.id,
            clientId: policy.clientId,
            actionType: "auto_payment_attempt",
            status: "skipped",
            methodType: "mobile",
            message: "Saved mobile method has no phone number.",
            metadata: null,
          } as any);
        } else {
          const idempotencyKey = `auto-${policy.id}-${now.toISOString().slice(0, 10)}`;
          const intentResult = await createPaymentIntent({
            organizationId: orgId,
            clientId: policy.clientId,
            policyId: policy.id,
            amount: String(policy.premiumAmount || "0"),
            currency: policy.currency || "USD",
            purpose: "premium",
            idempotencyKey,
          });
          if (intentResult.intent) {
            const autoResult = await initiatePaynowPayment({
              intentId: intentResult.intent.id,
              organizationId: orgId,
              method: method.provider || "ecocash",
              payerPhone: method.mobileNumber.trim(),
              actorType: "system",
            });
            if (autoResult.ok) {
              attempted++;
              await storage.createPaymentAutomationRun(orgId, {
                organizationId: orgId,
                policyId: policy.id,
                clientId: policy.clientId,
                actionType: "auto_payment_attempt",
                status: "success",
                methodType: "mobile",
                message: "Paynow mobile payment initiated (client confirms with PIN on phone).",
                metadata: { method: method.provider || "ecocash", intentId: intentResult.intent.id },
              } as any);
            } else {
              skipped++;
              await storage.createPaymentAutomationRun(orgId, {
                organizationId: orgId,
                policyId: policy.id,
                clientId: policy.clientId,
                actionType: "auto_payment_attempt",
                status: "failed",
                methodType: "mobile",
                message: autoResult.error || "Paynow initiation failed.",
                metadata: { method: method.provider || "ecocash", intentId: intentResult.intent.id },
              } as any);
            }
          }
        }
      }

      await dispatchNotification(orgId, "premium_due", policy.clientId, {
        ...ctx,
        outstanding: `${policy.currency} ${parseFloat(String(policy.premiumAmount || 0)).toFixed(2)}`,
      });
      if (settings.sendPushNotifications) {
        await notifyClientPush(
          orgId,
          policy.clientId,
          "Premium Due Reminder",
          `Your premium for policy ${policy.policyNumber} is overdue. Please pay to remain covered.`,
          policy.id,
        );
      }
      reminded++;
      await storage.createPaymentAutomationRun(orgId, {
        organizationId: orgId,
        policyId: policy.id,
        clientId: policy.clientId,
        actionType: "reminder",
        status: "success",
        methodType: null,
        message: "Premium due reminder sent.",
        metadata: {
          outstanding: `${policy.currency} ${parseFloat(String(policy.premiumAmount || 0)).toFixed(2)}`,
        },
      } as any);
      await storage.updatePolicy(policy.id, { lastAutoReminderAt: now, lastAutoPaymentAttemptAt: now }, orgId);
    }

    return { scanned: policies.length, reminded, attempted, skipped };
  }

  let paymentAutomationTickRunning = false;
  const automationTickMs = Math.max(60_000, parseInt(process.env.PAYMENT_AUTOMATION_TICK_MS || "", 10) || (6 * 60 * 60 * 1000));
  setInterval(async () => {
    if (paymentAutomationTickRunning) return;
    paymentAutomationTickRunning = true;
    try {
      const orgs = await storage.getOrganizations();
      for (const org of orgs) {
        await runPaymentAutomationForOrg(org.id);
      }
    } catch (err: any) {
      structuredLog("error", "Payment automation scheduler failed", { error: err?.message, stack: err?.stack });
    } finally {
      paymentAutomationTickRunning = false;
    }
  }, automationTickMs);

  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Serve local uploads; when object storage is enabled, /uploads/* is proxied below
  if (!objectStorage.isObjectStorageEnabled) {
    app.use("/uploads", express.static(uploadsDir, { maxAge: "1d" }));
  } else {
    app.get("/uploads/*path", (req, res) => {
      const key = (req.params as any).path;
      const publicUrl = (
        process.env.DO_SPACES_CDN_URL ||
        process.env.DO_SPACES_PUBLIC_URL ||
        process.env.R2_PUBLIC_URL
      )?.replace(/\/$/, "");
      if (publicUrl && key) {
        return res.redirect(301, `${publicUrl}/${key}`);
      }
      return res.status(404).json({ message: "File not found" });
    });
  }

  // Paynow result URL (webhook) — no auth; hash verified in handler. Always return 200 to avoid Paynow retries.
  app.post("/api/payments/paynow/result", express.urlencoded({ extended: false }), async (req, res) => {
    const body = req.body as Record<string, string>;
    const result = await handlePaynowResult(body);
    return res.status(200).send(result.ok ? "OK" : "Error");
  });

  const memUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
      const hasAllowedExtension = allowed.test(path.extname(file.originalname));
      const isImageMime = file.mimetype.startsWith("image/");
      if (hasAllowedExtension && isImageMime) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  const logoMemUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(png|jpg|jpeg|webp|svg)$/i;
      const hasAllowedExtension = allowed.test(path.extname(file.originalname));
      const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
      if (hasAllowedExtension && allowedMimes.includes(file.mimetype)) cb(null, true);
      else cb(new Error("Logo must be PNG, JPG, WebP, or SVG"));
    },
  });

  function handleMulterError(err: any, _req: any, res: any, next: any) {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "File too large (max 5MB)" });
      return res.status(400).json({ message: err.message });
    }
    if (err?.message) return res.status(400).json({ message: err.message });
    next(err);
  }

  app.post("/api/upload", requireAuth, requireTenantScope, memUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    return res.json({ url, filename: key });
  });
  app.use("/api/upload", handleMulterError);

  app.post("/api/upload/logo", requireAuth, requireTenantScope, requirePermission("manage:settings"), logoMemUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "logos");
    return res.json({ url, filename: key });
  });
  app.use("/api/upload/logo", handleMulterError);

  // Avatar upload — any authenticated staff user can upload their own avatar.
  app.post("/api/upload/avatar", requireAuth, logoMemUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const user = req.user as any;
    const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "avatars");
    await storage.updateUser(user.id, { avatarUrl: url });
    await auditLog(req, "UPDATE_AVATAR", "User", user.id, { avatarUrl: user.avatarUrl }, { avatarUrl: url });
    return res.json({ url, filename: key });
  });
  app.use("/api/upload/avatar", handleMulterError);

  // ─── Platform Owner: Tenant Switching ──────────────────────────

  app.post("/api/platform/switch-tenant", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) {
      return res.status(403).json({ message: "Platform owner access required" });
    }
    const { tenantId } = req.body;
    const previousTenantId = (req.session as any)?.activeTenantId || null;
    if (!tenantId) {
      delete (req.session as any).activeTenantId;
      await new Promise<void>((resolve, reject) => {
        (req.session as any).save((err: Error | null) => (err ? reject(err) : resolve()));
      });
      structuredLog("info", "Platform owner cleared active tenant", {
        userId: user.id,
        email: user.email,
        previousTenantId,
        ip: req.ip,
      });
      return res.json({ activeTenantId: null });
    }
    const [tenant] = await cpDb
      .select({ id: cpTenants.id, name: cpTenants.name, isActive: cpTenants.isActive })
      .from(cpTenants)
      .where(eq(cpTenants.id, tenantId))
      .limit(1);
    if (!tenant || !tenant.isActive || tenant.name?.endsWith("(deleted)")) return res.status(404).json({ message: "Tenant not found or inactive" });
    (req.session as any).activeTenantId = tenantId;
    if (typeof (req.session as any).save === "function") {
      await new Promise<void>((resolve, reject) => {
        (req.session as any).save((err: Error | null) => (err ? reject(err) : resolve()));
      });
    }
    structuredLog("info", "Platform owner switched tenant", {
      userId: user.id,
      email: user.email,
      previousTenantId,
      newTenantId: tenantId,
      tenantName: tenant.name,
      ip: req.ip,
    });
    await auditLog(req, "SWITCH_TENANT", "Organization", tenantId, { previousTenantId }, { newTenantId: tenantId, tenantName: tenant.name }, tenantId);
    return res.json({ activeTenantId: tenantId, tenantName: tenant.name });
  });

  app.get("/api/platform/active-tenant", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) {
      return res.status(403).json({ message: "Platform owner access required" });
    }
    const activeTenantId = (req.session as any)?.activeTenantId || user.organizationId || null;
    if (!activeTenantId) return res.json({ activeTenantId: null, tenant: null });
    const [tenant] = await cpDb
      .select({ id: cpTenants.id, name: cpTenants.name, slug: cpTenants.slug, isActive: cpTenants.isActive })
      .from(cpTenants)
      .where(eq(cpTenants.id, activeTenantId))
      .limit(1);
    if (!tenant || !tenant.isActive) {
      return res.json({ activeTenantId: null, tenant: null });
    }
    return res.json({ activeTenantId, tenant });
  });

  app.get("/api/platform/dashboard", requireAuth, async (req, res) => {
    const user = req.user as any;
    const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const canManageTenants = user.isPlatformOwner || perms.includes("create:tenant") || perms.includes("delete:tenant");
    if (!canManageTenants) {
      return res.status(403).json({ message: "Platform owner access required" });
    }

    const tenantRows = await cpDb
      .select({
        id: cpTenants.id,
        name: cpTenants.name,
        slug: cpTenants.slug,
        isActive: cpTenants.isActive,
        createdAt: cpTenants.createdAt,
        logoUrl: cpTenantBranding.logoUrl,
      })
      .from(cpTenants)
      .leftJoin(cpTenantBranding, eq(cpTenantBranding.tenantId, cpTenants.id))
      .where(and(eq(cpTenants.isActive, true), sql`${cpTenants.name} NOT LIKE '%(deleted)'`));

    const perTenant = await Promise.all(
      tenantRows.map(async (tenant) => {
        try {
          const tdb = await getDbForOrg(tenant.id);
          // Always scope by organizationId so shared-DB tenants only count their own rows.
          // For isolated-DB tenants the filter is redundant but harmless.
          const orgFilter = tenant.id;
          const [{ usersCount }] = await tdb.select({ usersCount: count() }).from(users).where(eq(users.organizationId, orgFilter));
          const [{ policiesCount }] = await tdb.select({ policiesCount: count() }).from(policies).where(eq(policies.organizationId, orgFilter));
          const [{ activePoliciesCount }] = await tdb
            .select({ activePoliciesCount: count() })
            .from(policies)
            .where(and(eq(policies.organizationId, orgFilter), eq(policies.status, "active")));
          const [{ clientsCount }] = await tdb.select({ clientsCount: count() }).from(clients).where(eq(clients.organizationId, orgFilter));
          const [{ claimsCount }] = await tdb.select({ claimsCount: count() }).from(claims).where(eq(claims.organizationId, orgFilter));
          const [{ leadsCount }] = await tdb.select({ leadsCount: count() }).from(leads).where(eq(leads.organizationId, orgFilter));
          const [{ branchesCount }] = await tdb.select({ branchesCount: count() }).from(branches).where(eq(branches.organizationId, orgFilter));

          return {
            ...tenant,
            usersCount,
            policiesCount,
            activePoliciesCount,
            clientsCount,
            claimsCount,
            leadsCount,
            branchesCount,
            loadError: null as string | null,
          };
        } catch (err: any) {
          return {
            ...tenant,
            usersCount: 0,
            policiesCount: 0,
            activePoliciesCount: 0,
            clientsCount: 0,
            claimsCount: 0,
            leadsCount: 0,
            branchesCount: 0,
            loadError: err?.message || "Failed to load tenant metrics",
          };
        }
      })
    );

    const summary = perTenant.reduce(
      (acc, t) => {
        acc.tenants += 1;
        acc.users += Number(t.usersCount || 0);
        acc.policies += Number(t.policiesCount || 0);
        acc.activePolicies += Number(t.activePoliciesCount || 0);
        acc.clients += Number(t.clientsCount || 0);
        acc.claims += Number(t.claimsCount || 0);
        acc.leads += Number(t.leadsCount || 0);
        acc.branches += Number(t.branchesCount || 0);
        return acc;
      },
      {
        tenants: 0,
        users: 0,
        policies: 0,
        activePolicies: 0,
        clients: 0,
        claims: 0,
        leads: 0,
        branches: 0,
      }
    );

    return res.json({ summary, tenants: perTenant });
  });

  // ─── Organization / Tenant ──────────────────────────────────

  app.get("/api/organizations", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
      const canManageTenants = user.isPlatformOwner || perms.includes("create:tenant") || perms.includes("delete:tenant");
      if (canManageTenants) {
        // Read the authoritative tenant list from the control plane so isolated
        // tenant DBs (e.g. Falakhe) also appear in the admin portal.
        const rows = await cpDb
          .select({
            id: cpTenants.id,
            name: cpTenants.name,
            slug: cpTenants.slug,
            isActive: cpTenants.isActive,
            licenseStatus: cpTenants.licenseStatus,
            createdAt: cpTenants.createdAt,
            primaryColor: cpTenantBranding.primaryColor,
            logoUrl: cpTenantBranding.logoUrl,
            address: cpTenantBranding.address,
            phone: cpTenantBranding.phone,
            email: cpTenantBranding.email,
            website: cpTenantBranding.website,
            isWhitelabeled: cpTenantBranding.isWhitelabeled,
            footerText: cpTenantBranding.footerText,
            policyNumberPrefix: cpTenantBranding.policyNumberPrefix,
            policyNumberPadding: cpTenantBranding.policyNumberPadding,
          })
          .from(cpTenants)
          .leftJoin(cpTenantBranding, eq(cpTenantBranding.tenantId, cpTenants.id))
          .where(eq(cpTenants.isActive, true));
        return res.json(rows);
      }
      if (user.organizationId) {
        const org = await storage.getOrganization(user.organizationId);
        return res.json(org ? [org] : []);
      }
      return res.json([]);
    } catch (err: any) {
      structuredLog("error", "GET /api/organizations failed", { error: err?.message || String(err), stack: err?.stack });
      return res.status(500).json({ message: process.env.NODE_ENV === "production" ? "Failed to load organizations." : (err?.message || "Failed to load organizations") });
    }
  });

  app.get("/api/organizations/:id", requireAuth, async (req, res) => {
    const user = req.user as any;
    const id = req.params.id as string;
    const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const canManageTenants = perms.includes("create:tenant") || perms.includes("delete:tenant");
    if (!canManageTenants && id !== user.organizationId) {
      return res.status(403).json({ message: "Cross-tenant access denied" });
    }
    const org = await storage.getOrganization(id);
    if (!org) return res.status(404).json({ message: "Not found" });
    return res.json(org);
  });

  app.patch("/api/organizations/:id", requireAuth, async (req, res) => {
    const user = req.user as any;
    const id = req.params.id as string;
    const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const canManageTenants = perms.includes("create:tenant") || perms.includes("delete:tenant");
    const canWriteOrg = perms.includes("write:organization");
    if (!canManageTenants && (id !== user.organizationId || !canWriteOrg)) {
      return res.status(403).json({ message: "Cross-tenant access denied or insufficient permissions" });
    }
    const isPlatformOwner = user.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
    delete req.body.id;
    delete req.body.createdAt;
    if (!isPlatformOwner) {
      delete req.body.databaseUrl;
      delete req.body.isWhitelabeled;
    }
    const before = await storage.getOrganization(id);
    if (!before) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateOrganization(id, req.body);
    await auditLog(req, "UPDATE_ORGANIZATION", "Organization", id, before, updated, id);
    return res.json(updated);
  });

  app.post("/api/organizations", requireAuth, requirePermission("create:tenant"), async (req, res) => {
    const user = req.user as any;
    const isPlatformOwner = user?.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
    const { adminEmail, adminPassword, adminDisplayName, ...orgData } = req.body;
    if (!isPlatformOwner) {
      delete orgData.isWhitelabeled;
      delete orgData.databaseUrl;
    }
    if (adminEmail && (!adminPassword || String(adminPassword).length < 8)) {
      return res.status(400).json({ message: "When providing an admin email, a password of min 8 chars is also required." });
    }

    if (adminEmail) {
      const existingAdmin = await storage.getUserByEmail(adminEmail);
      if (existingAdmin) {
        return res.status(409).json({ message: "A user with this admin email already exists." });
      }
    }

    const parsed = insertOrganizationSchema.parse(orgData);
    const org = await storage.createOrganization(parsed);
    try {
      const defaultBranch = await storage.createBranch({
        organizationId: org.id,
        name: "Head Office",
        isActive: true,
      });

      const ROLE_PERMISSION_MAP: Record<string, string[]> = {
        superuser: [],
        executive: [
          "read:organization", "read:branch", "read:user", "read:role", "read:audit_log",
          "read:policy", "read:claim", "read:client", "read:product", "read:funeral_ops",
          "read:finance", "read:fleet", "read:commission", "read:payroll", "read:report",
          "read:lead", "read:notification",
        ],
        manager: [
          "read:organization", "read:branch", "write:branch", "read:user", "write:user",
          "read:role", "read:audit_log", "read:policy", "write:policy", "read:claim",
          "write:claim", "approve:claim", "read:client", "write:client", "read:product",
          "write:product", "manage:settings",
          "read:funeral_ops", "write:funeral_ops", "read:finance", "read:fleet", "write:fleet",
          "read:commission", "read:report", "write:report", "read:lead", "write:lead",
          "read:notification", "manage:approvals",
          "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
          "view:all_clients",
        ],
        administrator: [
          "read:organization", "write:organization", "read:branch", "write:branch",
          "read:user", "write:user", "delete:user", "read:role", "write:role",
          "manage:permissions", "read:audit_log", "read:policy", "write:policy",
          "read:claim", "write:claim", "approve:claim", "read:client", "write:client",
          "read:product", "write:product", "manage:settings", "read:funeral_ops",
          "write:funeral_ops", "read:finance", "write:finance", "approve:finance",
          "read:fleet", "write:fleet", "read:commission", "write:commission",
          "read:payroll", "write:payroll", "read:report", "write:report",
          "read:lead", "write:lead", "read:notification", "write:notification",
          "manage:approvals", "backdate:payment",
          "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
          "view:own_clients", "view:all_clients",
          "delete:policy", "delete:payment", "delete:receipt", "edit:payment", "edit:receipt",
        ],
        cashier: [
          "read:policy", "read:client", "read:finance", "write:finance", "read:report",
          "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
        ],
        agent: [
          "read:policy", "write:policy", "read:client", "write:client", "read:product",
          "read:lead", "write:lead", "read:commission", "read:report",
          "read:finance", "receipt:cash",
        ],
        claims_officer: [
          "read:policy", "read:claim", "write:claim", "approve:claim", "read:client",
          "read:funeral_ops", "write:funeral_ops", "read:finance", "read:report",
        ],
        fleet_ops: [
          "read:fleet", "write:fleet", "read:funeral_ops", "write:funeral_ops", "read:report",
        ],
        staff: [
          "read:organization", "read:branch", "read:policy", "read:claim",
          "read:client", "read:product", "read:funeral_ops", "read:report",
        ],
      };

      const allPerms = await storage.getPermissions();
      const permMap = new Map<string, string>();
      for (const p of allPerms) permMap.set(p.name, p.id);

      const roleMap = new Map<string, string>();
      for (const [roleName, permNames] of Object.entries(ROLE_PERMISSION_MAP)) {
        const role = await storage.createRole({
          name: roleName,
          organizationId: org.id,
          description: `System ${roleName} role`,
          isSystem: true,
        });
        roleMap.set(roleName, role.id);

        if (roleName !== "superuser") {
          for (const permName of permNames) {
            const permId = permMap.get(permName);
            if (permId) await storage.addRolePermission(role.id, permId, org.id);
          }
        }
      }

      let adminUser: any = null;
      if (adminEmail && adminPassword) {
        const passwordHash = await argon2.hash(String(adminPassword), { type: argon2.argon2id });
        const refCode = `AGT${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        adminUser = await storage.createUser({
          email: adminEmail,
          displayName: adminDisplayName || adminEmail.split("@")[0],
          organizationId: org.id,
          branchId: defaultBranch.id,
          referralCode: refCode,
          isActive: true,
          passwordHash,
        });

        const adminRoleId = roleMap.get("administrator");
        if (adminRoleId) await storage.addUserRole(adminUser.id, adminRoleId, org.id);
      }

      await auditLog(req, "CREATE_ORGANIZATION", "Organization", org.id, null, {
        ...org,
        defaultBranchId: defaultBranch.id,
        ...(adminUser ? { adminUserId: adminUser.id, adminEmail } : {}),
      }, org.id);
      return res.status(201).json({
        ...org,
        defaultBranchId: defaultBranch.id,
        ...(adminUser ? { adminUser: { id: adminUser.id, email: adminUser.email, displayName: adminUser.displayName } } : {}),
      });
    } catch (err) {
      // Soft-delete the orphaned org to prevent partial tenant state
      try {
        await storage.updateOrganization(org.id, { name: parsed.name + " (deleted)" });
      } catch (rollbackErr) {
        structuredLog("error", "Failed to soft-delete orphaned org after create failure", {
          orgId: org.id,
          error: (rollbackErr as Error).message,
        });
      }
      throw err;
    }
  });

  app.delete("/api/organizations/:id", requireAuth, requirePermission("delete:tenant"), async (req, res) => {
    const id = req.params.id as string;
    const user = req.user as any;
    const org = await storage.getOrganization(id);
    if (!org) return res.status(404).json({ message: "Not found" });

    const usersInOrg = await storage.getUsersByOrg(id, 100, 0);
    const isPlatformOwner = user.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
    const allPlatformOwners = usersInOrg.every((u: any) => u.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase());

    if (usersInOrg.length > 0 && !allPlatformOwners) {
      return res.status(400).json({
        message: "Cannot delete tenant that has users. Remove or reassign users first.",
      });
    }

    // Clear organizationId for all users in this org (e.g. platform owner) so they can log in with no tenant
    for (const u of usersInOrg) {
      await storage.updateUser(u.id, { organizationId: null });
    }
    if (isPlatformOwner && user.organizationId === id) {
      (req.session as any).activeTenantId = null;
      await new Promise<void>((resolve, reject) => {
        (req.session as any).save((err: Error | null) => (err ? reject(err) : resolve()));
      });
    }

    await storage.updateOrganization(id, { name: org.name + " (deleted)" });
    await auditLog(req, "DELETE_ORGANIZATION", "Organization", id, org, null, id);
    return res.status(204).send();
  });

  // ─── Branches ───────────────────────────────────────────────

  app.get("/api/branches", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getBranchesByOrg(user.organizationId));
  });

  app.post("/api/branches", requireAuth, requireTenantScope, requirePermission("write:branch"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertBranchSchema.parse({ ...req.body, organizationId: user.organizationId });
    const branch = await storage.createBranch(parsed);
    await auditLog(req, "CREATE_BRANCH", "Branch", branch.id, null, branch);
    return res.status(201).json(branch);
  });

  // ─── Users ──────────────────────────────────────────────────

  app.get("/api/users", requireAuth, requireTenantScope, requirePermission("read:user"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const usersList = await storage.getUsersByOrg(user.organizationId, limit, offset);
    const rolesByUser = await storage.getUserRolesBatch(usersList.map(u => u.id), user.organizationId);
    const usersWithRoles = usersList.map((u) => ({
      id: u.id, email: u.email, displayName: u.displayName,
      avatarUrl: u.avatarUrl, isActive: u.isActive, createdAt: u.createdAt,
      referralCode: u.referralCode, branchId: u.branchId,
      roles: (rolesByUser[u.id] || []).map(r => ({ id: r.id, name: r.name })),
    }));
    return res.json(usersWithRoles);
  });

  app.get("/api/agents", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const usersList = await storage.getUsersByOrg(user.organizationId, 500, 0);
    const rolesByUser = await storage.getUserRolesBatch(usersList.map(u => u.id), user.organizationId);
    const agentsList = usersList
      .filter(u => (rolesByUser[u.id] || []).some(r => r.name === "agent"))
      .map(u => ({
        id: u.id, email: u.email, displayName: u.displayName,
        referralCode: u.referralCode,
      }));
    return res.json(agentsList);
  });

  app.get("/api/users/:id", requireAuth, requireTenantScope, requirePermission("read:user"), async (req, res) => {
    const targetUser = await storage.getUser(req.params.id as string);
    if (!targetUser) return res.status(404).json({ message: "User not found" });
    const currentUser = req.user as any;
    if (targetUser.organizationId !== currentUser.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const userRoles = await storage.getUserRoles(targetUser.id, currentUser.organizationId);
    return res.json({
      ...targetUser,
      roles: userRoles.map(r => ({ id: r.id, name: r.name })),
    });
  });

  app.post("/api/users", requireAuth, requireTenantScope, requirePermission("write:user"), async (req, res) => {
    const currentUser = req.user as any;
    const { email, displayName, roleIds, branchId, password, phone, address, nationalId, dateOfBirth, gender, maritalStatus, nextOfKinName, nextOfKinPhone } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const existing = await storage.getUserByEmail(email);
    if (existing) return res.status(409).json({ message: "A user with this email already exists" });

    const roles = roleIds && Array.isArray(roleIds) ? await storage.getRolesByIds(roleIds, currentUser.organizationId) : [];
    const isAgent = roles.some((r) => r?.name === "agent");
    if (isAgent && (!password || String(password).length < 8)) {
      return res.status(400).json({ message: "Agents require a password of at least 8 characters" });
    }

    let passwordHash: string | undefined;
    if (password && String(password).length >= 8) {
      passwordHash = await argon2.hash(String(password), { type: argon2.argon2id });
    }

    const refCode = `AGT${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const newUser = await storage.createUser({
      email,
      displayName: displayName || email.split("@")[0],
      organizationId: currentUser.organizationId,
      branchId: branchId || currentUser.branchId,
      referralCode: refCode,
      isActive: true,
      passwordHash,
      phone: phone || null,
      address: address || null,
      nationalId: nationalId || null,
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      maritalStatus: maritalStatus || null,
      nextOfKinName: nextOfKinName || null,
      nextOfKinPhone: nextOfKinPhone || null,
    });

    if (roleIds && Array.isArray(roleIds)) {
      for (const roleId of roleIds) {
        await storage.addUserRole(newUser.id, roleId, currentUser.organizationId);
      }
    }

    const userRoles = await storage.getUserRoles(newUser.id, currentUser.organizationId);
    await auditLog(req, "CREATE_USER", "User", newUser.id, null, { ...newUser, roles: userRoles.map(r => r.name) });
    return res.status(201).json({ ...newUser, roles: userRoles.map(r => ({ id: r.id, name: r.name })) });
  });

  app.patch("/api/users/:id", requireAuth, requireTenantScope, requirePermission("write:user"), async (req, res) => {
    const currentUser = req.user as any;
    const targetUser = await storage.getUser(req.params.id as string);
    if (!targetUser || targetUser.organizationId !== currentUser.organizationId) {
      return res.status(404).json({ message: "User not found" });
    }
    const before = { ...targetUser };
    const { displayName, isActive, branchId, roleIds, password, email, phone, address, nationalId, dateOfBirth, gender, maritalStatus, nextOfKinName, nextOfKinPhone } = req.body;
    const updates: any = {};
    if (email !== undefined) {
      const trimmed = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
      const existing = await storage.getUserByEmail(trimmed);
      if (existing && existing.id !== req.params.id) {
        return res.status(400).json({ message: "Email already in use" });
      }
      updates.email = trimmed;
    }
    if (displayName !== undefined) updates.displayName = displayName;
    if (isActive !== undefined) updates.isActive = isActive;
    if (branchId !== undefined) updates.branchId = branchId;
    if (password !== undefined && String(password).length >= 8) {
      updates.passwordHash = await argon2.hash(String(password), { type: argon2.argon2id });
    }
    if (phone !== undefined) updates.phone = phone || null;
    if (address !== undefined) updates.address = address || null;
    if (nationalId !== undefined) updates.nationalId = nationalId || null;
    if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth || null;
    if (gender !== undefined) updates.gender = gender || null;
    if (maritalStatus !== undefined) updates.maritalStatus = maritalStatus || null;
    if (nextOfKinName !== undefined) updates.nextOfKinName = nextOfKinName || null;
    if (nextOfKinPhone !== undefined) updates.nextOfKinPhone = nextOfKinPhone || null;
    const updated = await storage.updateUser(req.params.id as string, updates);

    if (roleIds && Array.isArray(roleIds)) {
      await storage.clearUserRoles(req.params.id as string);
      for (const roleId of roleIds) {
        await storage.addUserRole(req.params.id as string, roleId, currentUser.organizationId);
      }
    }

    const userRoles = await storage.getUserRoles(req.params.id as string, currentUser.organizationId);
    await auditLog(req, "UPDATE_USER", "User", req.params.id as string, before, { ...updated, roles: userRoles.map(r => r.name) });
    return res.json({ ...updated, roles: userRoles.map(r => ({ id: r.id, name: r.name })) });
  });

  app.delete("/api/users/:id", requireAuth, requireTenantScope, requirePermission("delete:user"), async (req, res) => {
    const currentUser = req.user as any;
    const targetUser = await storage.getUser(req.params.id as string);
    if (!targetUser || targetUser.organizationId !== currentUser.organizationId) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.id === currentUser.id) {
      return res.status(400).json({ message: "Cannot deactivate yourself" });
    }
    const updated = await storage.updateUser(req.params.id as string, { isActive: false });
    await auditLog(req, "DEACTIVATE_USER", "User", req.params.id as string, targetUser, updated);
    return res.json(updated);
  });

  // ─── Roles ──────────────────────────────────────────────────

  app.get("/api/roles", requireAuth, requireTenantScope, requirePermission("read:role"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getRolesByOrg(user.organizationId));
  });

  app.get("/api/roles/:id/permissions", requireAuth, requireTenantScope, requirePermission("read:role"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getRolePermissions(req.params.id as string, user.organizationId));
  });

  app.post("/api/roles/:id/permissions/:permId", requireAuth, requireTenantScope, requirePermission("write:role"), async (req, res) => {
    const user = req.user as any;
    await storage.addRolePermission(req.params.id as string, req.params.permId as string, user.organizationId);
    await auditLog(req, "ADD_ROLE_PERMISSION", "Role", req.params.id as string, null, { roleId: req.params.id, permissionId: req.params.permId });
    return res.json({ ok: true });
  });

  app.delete("/api/roles/:id/permissions/:permId", requireAuth, requireTenantScope, requirePermission("write:role"), async (req, res) => {
    const user = req.user as any;
    await storage.removeRolePermission(req.params.id as string, req.params.permId as string, user.organizationId);
    await auditLog(req, "REMOVE_ROLE_PERMISSION", "Role", req.params.id as string, { roleId: req.params.id, permissionId: req.params.permId }, null);
    return res.json({ ok: true });
  });

  // ─── Permissions ────────────────────────────────────────────

  app.get("/api/permissions", requireAuth, requirePermission("read:role"), async (_req, res) => {
    return res.json(await storage.getPermissions());
  });

  // ─── Audit Logs ─────────────────────────────────────────────

  app.get("/api/audit-logs", requireAuth, requireTenantScope, requirePermission("read:audit_log"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const filters: { search?: string; action?: string; from?: string; to?: string } = {};
    if (req.query.search) filters.search = String(req.query.search);
    if (req.query.action) filters.action = String(req.query.action);
    if (req.query.from) filters.from = String(req.query.from);
    if (req.query.to) filters.to = String(req.query.to);
    return res.json(await storage.getAuditLogs(user.organizationId, limit, offset, filters));
  });

  // ─── Dashboard Stats ───────────────────────────────────────

  app.get("/api/dashboard/stats", requireAuth, requireTenantScope, async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const filters: { dateFrom?: string; dateTo?: string; status?: string; branchId?: string } = {};
    if (req.query.dateFrom) filters.dateFrom = String(req.query.dateFrom);
    if (req.query.dateTo) filters.dateTo = String(req.query.dateTo);
    if (req.query.status) filters.status = String(req.query.status);
    if (req.query.branchId) filters.branchId = String(req.query.branchId);
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const agentId = isAgent ? user.id : undefined;
    return res.json(await storage.getDashboardStats(user.organizationId, filters, agentId));
  });

  // ─── Clients ────────────────────────────────────────────────

  app.get("/api/clients", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const list = isAgent
      ? await storage.getClientsByAgent(user.id, user.organizationId, limit, offset, search)
      : await storage.getClientsByOrg(user.organizationId, limit, offset, search);
    return res.json(list);
  });

  app.get("/api/clients/:id", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.id as string, user.organizationId);
    if (!client) return res.status(404).json({ message: "Not found" });
    if (client.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent) {
      const agentClients = await storage.getClientsByAgent(user.id, user.organizationId, 10000, 0);
      if (!agentClients.some((c: any) => c.id === client.id)) return res.status(403).json({ message: "Access denied" });
    }
    return res.json(client);
  });

  app.post("/api/clients", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;

    if (req.body.nationalId && String(req.body.nationalId).trim()) {
      const existing = await storage.getClientByNationalId(user.organizationId, String(req.body.nationalId).trim());
      if (existing) {
        return res.status(409).json({
          message: "A client with this ID number already exists. Request admin approval to create another policy for this client.",
          code: "DUPLICATE_CLIENT",
          existingClient: {
            id: existing.id,
            firstName: existing.firstName,
            lastName: existing.lastName,
            nationalId: existing.nationalId,
            phone: existing.phone,
            email: existing.email,
          },
        });
      }
    }

    const firstName = toUpperTrim(req.body.firstName, false);
    const lastName = toUpperTrim(req.body.lastName, false);
    const nationalIdNorm = normalizeNationalId(req.body.nationalId);
    if (!firstName || !lastName) {
      return res.status(400).json({ message: "First name and last name are required." });
    }
    if (!nationalIdNorm) {
      return res.status(400).json({ message: "National ID is required (format: digits + check letter + 2 digits, e.g. 08833089H38)." });
    }
    if (!isValidNationalId(req.body.nationalId)) {
      return res.status(400).json({ message: "National ID must be digits, then one letter, then two digits (e.g. 08833089H38)." });
    }
    const phone = toUpperTrim(req.body.phone, false);
    const address = toUpperTrim(req.body.address, true);
    if (!phone) {
      return res.status(400).json({ message: "Phone is required." });
    }
    const dateOfBirth = req.body.dateOfBirth ? String(req.body.dateOfBirth).trim() : null;
    const gender = req.body.gender ? toUpperTrim(req.body.gender, false) : null;
    if (!dateOfBirth) {
      return res.status(400).json({ message: "Date of birth is required." });
    }
    if (!gender) {
      return res.status(400).json({ message: "Gender is required." });
    }

    const activationCode = `ACT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const userRolesForCreate = await storage.getUserRoles(user.id, user.organizationId);
    const creatorIsAgent = userRolesForCreate.some((r: { name?: string }) => r?.name === "agent");
    const parsed = insertClientSchema.parse({
      ...req.body,
      firstName: firstName!,
      lastName: lastName!,
      nationalId: nationalIdNorm,
      phone: phone!,
      dateOfBirth,
      gender: gender!,
      address: address || undefined,
      organizationId: user.organizationId,
      branchId: req.body.branchId || user.branchId,
      activationCode,
      agentId: creatorIsAgent ? user.id : undefined,
    });
    const client = await storage.createClient(parsed);
    await auditLog(req, "CREATE_CLIENT", "Client", client.id, null, client);
    const lead = await storage.createLead({
      organizationId: user.organizationId,
      branchId: user.branchId || undefined,
      agentId: creatorIsAgent ? user.id : undefined,
      clientId: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone || undefined,
      email: client.email || undefined,
      source: creatorIsAgent ? "agent_capture" : "walk_in",
      stage: "lead",
    });
    await auditLog(req, "CREATE_LEAD", "Lead", lead.id, null, lead);
    const org = await storage.getOrganization(user.organizationId);
    await notifyClient(user.organizationId, client.id, "Welcome!", `Welcome to ${org?.name || "our platform"}. Your account has been created.`);
    return res.status(201).json(client);
  });

  app.patch("/api/clients/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getClient(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent) {
      const agentClients = await storage.getClientsByAgent(user.id, user.organizationId, 10000, 0);
      if (!agentClients.some((c: any) => c.id === before.id)) return res.status(403).json({ message: "Access denied" });
    }
    delete req.body.id;
    delete req.body.organizationId;
    delete req.body.createdAt;
    const updated = await storage.updateClient(req.params.id as string, req.body, user.organizationId);
    await auditLog(req, "UPDATE_CLIENT", "Client", req.params.id as string, before, updated);
    return res.json(updated);
  });

  // ─── Dependents / Beneficiaries ─────────────────────────────

  app.get("/api/clients/:clientId/dependents", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    return res.json(await storage.getDependentsByClient(req.params.clientId as string, user.organizationId));
  });

  app.post("/api/clients/:clientId/dependents", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    const body = req.body as any;
    const depFirstName = toUpperTrim(body.firstName, false);
    const depLastName = toUpperTrim(body.lastName, false);
    const relationship = toUpperTrim(body.relationship, false);
    const dateOfBirth = body.dateOfBirth ? String(body.dateOfBirth).trim() : null;
    const gender = body.gender ? toUpperTrim(body.gender, false) : null;
    const nationalIdDep = body.nationalId ? normalizeNationalId(body.nationalId) : null;
    if (!depFirstName || !depLastName) return res.status(400).json({ message: "First name and last name are required for dependants." });
    if (!relationship) return res.status(400).json({ message: "Relationship is required for dependants." });
    if (!dateOfBirth) return res.status(400).json({ message: "Date of birth is required for dependants." });
    if (!gender) return res.status(400).json({ message: "Gender is required for dependants." });
    if (nationalIdDep && !isValidNationalId(nationalIdDep)) return res.status(400).json({ message: "National ID must be digits, one letter, then two digits (e.g. 08833089H38)." });
    const parsed = insertDependentSchema.parse({
      ...body,
      firstName: depFirstName,
      lastName: depLastName,
      relationship,
      dateOfBirth,
      gender,
      nationalId: nationalIdDep || undefined,
      organizationId: user.organizationId,
      clientId: req.params.clientId,
    });
    const dep = await storage.createDependent(parsed);
    await auditLog(req, "CREATE_DEPENDENT", "Dependent", dep.id, null, dep);
    return res.status(201).json(dep);
  });

  app.patch("/api/clients/:clientId/dependents/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    const updated = await storage.updateDependent(req.params.id as string, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Dependent not found" });
    await auditLog(req, "UPDATE_DEPENDENT", "Dependent", req.params.id as string, null, updated);
    return res.json(updated);
  });

  app.delete("/api/clients/:clientId/dependents/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    await storage.deleteDependent(req.params.id as string, user.organizationId);
    await auditLog(req, "DELETE_DEPENDENT", "Dependent", req.params.id as string, null, null);
    return res.status(204).send();
  });

  app.get("/api/clients/:clientId/payment-methods", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    const methods = await storage.getClientPaymentMethods(client.id, user.organizationId);
    return res.json(methods);
  });

  app.put("/api/clients/:clientId/payment-methods/default", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    const normalized = normalizePaymentMethodInput(req.body);
    if (!normalized) {
      const wantsCard = req.body && typeof req.body === "object" && (req.body as any).methodType === "card";
      return res.status(400).json({
        message: wantsCard
          ? "Card cannot be saved for automation. Use a mobile money number — overdue premiums are collected via Paynow (PIN on the client's phone)."
          : "Invalid payment method: provide methodType mobile, provider, and mobileNumber.",
      });
    }
    const saved = await storage.upsertDefaultClientPaymentMethod(user.organizationId, client.id, {
      organizationId: user.organizationId,
      clientId: client.id,
      ...normalized,
      isDefault: true,
      isActive: true,
    } as any);
    await auditLog(req, "UPSERT_CLIENT_PAYMENT_METHOD", "ClientPaymentMethod", saved.id, null, saved);
    return res.json(saved);
  });

  // ─── Products ───────────────────────────────────────────────

  app.get("/api/products", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getProductsByOrg(user.organizationId));
  });

  app.get("/api/products/:id", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    const product = await storage.getProduct(req.params.id as string, user.organizationId);
    if (!product) return res.status(404).json({ message: "Not found" });
    if (product.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    return res.json(product);
  });

  app.post("/api/products", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertProductSchema.parse({ ...req.body, organizationId: user.organizationId });
    const product = await storage.createProduct(parsed);
    await auditLog(req, "CREATE_PRODUCT", "Product", product.id, null, product);
    return res.status(201).json(product);
  });

  app.patch("/api/products/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getProduct(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateProduct(req.params.id as string, req.body, user.organizationId);
    await auditLog(req, "UPDATE_PRODUCT", "Product", req.params.id as string, before, updated);
    return res.json(updated);
  });

  app.delete("/api/products/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const product = await storage.getProduct(req.params.id as string, user.organizationId);
    if (!product || product.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const result = await storage.deleteProduct(req.params.id as string, user.organizationId);
    if (!result.ok) return res.status(400).json({ message: result.reason });
    await auditLog(req, "DELETE_PRODUCT", "Product", req.params.id as string, product, null);
    return res.status(204).send();
  });

  app.get("/api/product-versions", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getAllProductVersions(user.organizationId));
  });

  app.get("/api/products/:id/versions", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    const product = await storage.getProduct(req.params.id as string, user.organizationId);
    if (!product || product.organizationId !== user.organizationId) return res.status(404).json({ message: "Product not found" });
    return res.json(await storage.getProductVersions(req.params.id as string, user.organizationId));
  });

  app.post("/api/products/:id/versions", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const versions = await storage.getProductVersions(req.params.id as string, user.organizationId);
    const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1;
    const parsed = insertProductVersionSchema.parse({
      ...req.body,
      productId: req.params.id as string,
      organizationId: user.organizationId,
      version: nextVersion,
    });
    const pv = await storage.createProductVersion(parsed);
    await auditLog(req, "CREATE_PRODUCT_VERSION", "ProductVersion", pv.id, null, pv);
    return res.status(201).json(pv);
  });

  app.patch("/api/product-versions/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getProductVersion(req.params.id as string, user.organizationId);
    if (!before) return res.status(404).json({ message: "Version not found" });
    const updated = await storage.updateProductVersion(req.params.id as string, req.body, user.organizationId);
    await auditLog(req, "UPDATE_PRODUCT_VERSION", "ProductVersion", req.params.id as string, before, updated);
    return res.json(updated);
  });

  // ─── Benefits & Add-ons ─────────────────────────────────────

  app.get("/api/benefit-catalog", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getBenefitCatalogItems(user.organizationId));
  });

  app.post("/api/benefit-catalog", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertBenefitCatalogItemSchema.parse({ ...req.body, organizationId: user.organizationId });
    const item = await storage.createBenefitCatalogItem(parsed);
    await auditLog(req, "CREATE_BENEFIT_CATALOG_ITEM", "BenefitCatalogItem", item.id, null, item);
    return res.status(201).json(item);
  });

  app.patch("/api/benefit-catalog/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const updated = await storage.updateBenefitCatalogItem(req.params.id as string, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await auditLog(req, "UPDATE_BENEFIT_CATALOG_ITEM", "BenefitCatalogItem", req.params.id as string, null, updated);
    return res.json(updated);
  });

  app.get("/api/benefit-bundles", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getBenefitBundles(user.organizationId));
  });

  app.post("/api/benefit-bundles", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertBenefitBundleSchema.parse({ ...req.body, organizationId: user.organizationId });
    const bundle = await storage.createBenefitBundle(parsed);
    await auditLog(req, "CREATE_BENEFIT_BUNDLE", "BenefitBundle", bundle.id, null, bundle);
    return res.status(201).json(bundle);
  });

  app.patch("/api/benefit-bundles/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const updated = await storage.updateBenefitBundle(req.params.id as string, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await auditLog(req, "UPDATE_BENEFIT_BUNDLE", "BenefitBundle", req.params.id as string, null, updated);
    return res.json(updated);
  });

  app.get("/api/add-ons", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getAddOns(user.organizationId));
  });

  app.post("/api/add-ons", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertAddOnSchema.parse({ ...req.body, organizationId: user.organizationId });
    const addon = await storage.createAddOn(parsed);
    await auditLog(req, "CREATE_ADD_ON", "AddOn", addon.id, null, addon);
    return res.status(201).json(addon);
  });

  app.patch("/api/add-ons/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const updated = await storage.updateAddOn(req.params.id as string, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await auditLog(req, "UPDATE_ADD_ON", "AddOn", req.params.id as string, null, updated);
    return res.json(updated);
  });

  app.get("/api/age-bands", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getAgeBandConfigs(user.organizationId));
  });

  app.post("/api/age-bands", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertAgeBandConfigSchema.parse({ ...req.body, organizationId: user.organizationId });
    const config = await storage.createAgeBandConfig(parsed);
    await auditLog(req, "CREATE_AGE_BAND", "AgeBandConfig", config.id, null, config);
    return res.status(201).json(config);
  });

  app.patch("/api/age-bands/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const updated = await storage.updateAgeBandConfig(req.params.id as string, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await auditLog(req, "UPDATE_AGE_BAND", "AgeBandConfig", req.params.id as string, null, updated);
    return res.json(updated);
  });

  // ─── Policies ───────────────────────────────────────────────

  app.get("/api/policies", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    schedulePolicyPremiumBackfill(user.organizationId);
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const branchId = typeof req.query.branchId === "string" && req.query.branchId ? req.query.branchId : undefined;
    const productId = typeof req.query.productId === "string" && req.query.productId ? req.query.productId : undefined;
    const agentIdParam = typeof req.query.agentId === "string" && req.query.agentId ? req.query.agentId : undefined;
    const qRaw = typeof req.query.q === "string" ? req.query.q : typeof req.query.search === "string" ? req.query.search : "";
    const search = qRaw.trim() || undefined;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const filters: ReportFilters & { search?: string } = {};
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    if (status) filters.status = status;
    if (branchId) filters.branchId = branchId;
    if (productId) filters.productId = productId;
    if (search) filters.search = search;
    if (isAgent) filters.agentId = user.id;
    else if (agentIdParam) filters.agentId = agentIdParam;
    const hasFilter = Object.keys(filters).length > 0;
    let list = await storage.getPoliciesByOrg(user.organizationId, limit, offset, hasFilter ? filters : undefined);
    list = await Promise.all(list.map((p: any) => recalculatePolicyPremiumIfNeeded(p, user.organizationId)));
    return res.json(list);
  });

  app.get("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const rawPolicy = await storage.getPolicy(req.params.id as string, user.organizationId);
    const policy = rawPolicy ? await recalculatePolicyPremiumIfNeeded(rawPolicy, user.organizationId) : undefined;
    if (!policy) return res.status(404).json({ message: "Not found" });
    if (policy.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent && (policy as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });
    const today = new Date().toISOString().split("T")[0];
    const statusOk = policy.status === "active" || policy.status === "grace";

    let productName = "";
    let productVersionLabel = "";
    let waitingPeriodDays: number | null = null;
    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId, user.organizationId);
      if (pv) {
        waitingPeriodDays = pv.waitingPeriodDays ?? 90;
        productVersionLabel = `v${pv.version}`;
        const prod = await storage.getProduct(pv.productId, user.organizationId);
        if (prod) productName = prod.name;
      }
    }

    const wpd = waitingPeriodDays ?? 90;
    const inceptionForPolicyWaiting = policy.inceptionDate || policy.effectiveDate;
    let resolvedWaitingEnd: string | null = policy.waitingPeriodEndDate ? String(policy.waitingPeriodEndDate) : null;
    if (!resolvedWaitingEnd && inceptionForPolicyWaiting) {
      const d = new Date(inceptionForPolicyWaiting);
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + wpd);
        resolvedWaitingEnd = d.toISOString().split("T")[0];
      }
    }

    const waitingOver = !resolvedWaitingEnd || resolvedWaitingEnd <= today;
    const claimable = !!(statusOk && waitingOver);
    const claimableReason = !statusOk
      ? `Policy status is ${policy.status}; must be active or in grace to lodge a claim.`
      : !waitingOver
        ? `Waiting period ends ${resolvedWaitingEnd}. Claims allowed after that date.`
        : "Policy and covered members are eligible for claims.";

    let clientActivationCode: string | null = null;
    if (policy.clientId) {
      const policyClient = await storage.getClient(policy.clientId, user.organizationId);
      if (policyClient && policyClient.activationCode && !policyClient.isEnrolled) {
        clientActivationCode = policyClient.activationCode;
      }
    }

    const policyPayments = await storage.getPaymentsByPolicy(policy.id, user.organizationId);
    const totalPaid = policyPayments
      .filter((p: any) => p.status === "cleared")
      .reduce((sum: number, p: any) => sum + parseFloat(p.amount || "0"), 0);

    const premium = parseFloat(policy.premiumAmount || "0");
    const startDate = policy.inceptionDate || policy.effectiveDate;
    let totalDue = 0;
    let periodsElapsed = 0;
    if (startDate && premium > 0) {
      const start = new Date(startDate);
      const now = new Date();
      if (!isNaN(start.getTime()) && start <= now) {
        const daysElapsed = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
        const schedule = policy.paymentSchedule || "monthly";
        const periodDays = schedule === "weekly" ? 7 : schedule === "biweekly" ? 14 : schedule === "quarterly" ? 91.31 : schedule === "annually" ? 365.25 : 30.44;
        periodsElapsed = Math.ceil(daysElapsed / periodDays);
        totalDue = periodsElapsed * premium;
      }
    }
    const balance = totalPaid - totalDue;

    return res.json({
      ...policy,
      waitingPeriodEndDate: resolvedWaitingEnd ?? policy.waitingPeriodEndDate ?? null,
      claimable,
      claimableReason,
      productName,
      productVersionLabel,
      waitingPeriodDays,
      clientActivationCode,
      totalPaid: totalPaid.toFixed(2),
      totalDue: totalDue.toFixed(2),
      balance: balance.toFixed(2),
      periodsElapsed,
    });
  });

  app.post("/api/policies", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    try {
    const policyNumber = await storage.generatePolicyNumber(user.organizationId);

    let agentId = req.body.agentId || null;
    if (!agentId && req.body.referralCode) {
      const agent = await storage.getUserByReferralCode(req.body.referralCode);
      if (agent && agent.organizationId === user.organizationId) {
        agentId = agent.id;
      }
    }

    const members = Array.isArray(req.body.members) ? req.body.members : [];
    const addOnIds = Array.isArray(req.body.addOnIds) ? req.body.addOnIds : [];
    const memberAddOns: { memberRef: string; addOnId: string }[] =
      Array.isArray(req.body.memberAddOns) ? req.body.memberAddOns : [];
    const normalizedPaymentMethod = normalizePaymentMethodInput(req.body.paymentMethod);
    let cachedClientDependents: any[] | null = null;
    let dependentDateOfBirths: (string | null)[] = [];
    if (req.body.clientId) {
      cachedClientDependents = await storage.getDependentsByClient(req.body.clientId, user.organizationId);
      const selectedDependentIds = members
        .map((m: any) => m?.dependentId)
        .filter((id: string | null | undefined): id is string => !!id);
      if (selectedDependentIds.length > 0) {
        const selectedSet = new Set(selectedDependentIds);
        dependentDateOfBirths = cachedClientDependents
          .filter((d: any) => selectedSet.has(d.id))
          .map((d: any) => d.dateOfBirth || null);
      } else if (members.length === 0) {
        dependentDateOfBirths = cachedClientDependents.map((d: any) => d.dateOfBirth || null);
      }
    }

    let premiumAmount = "0";
    if (req.body.productVersionId) {
      premiumAmount = await computePolicyPremium(
        user.organizationId,
        req.body.productVersionId,
        req.body.currency || "USD",
        req.body.paymentSchedule || "monthly",
        addOnIds,
        memberAddOns,
        1 + members.length,
        dependentDateOfBirths,
      );
    }

    const body = { ...req.body };
    delete body.premiumAmount;
    delete body.paymentMethod;

    const beneficiary = req.body.beneficiary || null;
    if (beneficiary && (beneficiary.firstName || beneficiary.lastName)) {
      const benFirst = toUpperTrim(beneficiary.firstName, false);
      const benLast = toUpperTrim(beneficiary.lastName, false);
      const benRel = toUpperTrim(beneficiary.relationship, false);
      const benNationalId = beneficiary.nationalId ? normalizeNationalId(beneficiary.nationalId) : null;
      const benPhone = toUpperTrim(beneficiary.phone, false);
      if (!benFirst || !benLast) return res.status(400).json({ message: "Beneficiary first and last name are required." });
      if (!benRel) return res.status(400).json({ message: "Beneficiary relationship is required." });
      if (!benNationalId) return res.status(400).json({ message: "Beneficiary national ID is required." });
      if (!isValidNationalId(beneficiary.nationalId)) return res.status(400).json({ message: "Beneficiary national ID must be digits, one letter, then two digits (e.g. 08833089H38)." });
      if (!benPhone) return res.status(400).json({ message: "Beneficiary phone is required." });
      beneficiary.firstName = benFirst;
      beneficiary.lastName = benLast;
      beneficiary.relationship = benRel;
      beneficiary.nationalId = benNationalId;
      beneficiary.phone = benPhone;
    }
    const parsed = insertPolicySchema.parse({
      ...body,
      organizationId: user.organizationId,
      policyNumber,
      status: "inactive",
      agentId,
      premiumAmount,
      beneficiaryFirstName: beneficiary?.firstName || null,
      beneficiaryLastName: beneficiary?.lastName || null,
      beneficiaryRelationship: beneficiary?.relationship || null,
      beneficiaryNationalId: beneficiary?.nationalId || null,
      beneficiaryPhone: beneficiary?.phone || null,
      beneficiaryDependentId: beneficiary?.dependentId || null,
    });

    // Prevent duplicate policies: same client + same product version (unless existing is cancelled)
    const existingForClient = await storage.getPoliciesByClient(parsed.clientId, user.organizationId);
    const duplicate = existingForClient.find(
      (p) => p.productVersionId === parsed.productVersionId && p.status !== "cancelled"
    );
    if (duplicate) {
      return res.status(400).json({
        error: "Duplicate policy",
        message: "This client already has an active policy for this product. Cancel the existing policy first if you need to create a new one.",
      });
    }

    let dependentsToAdd = members;
    if (dependentsToAdd.length === 0 && parsed.clientId) {
      const clientDeps = cachedClientDependents ?? await storage.getDependentsByClient(parsed.clientId, user.organizationId);
      dependentsToAdd = clientDeps.map((d: any) => ({ dependentId: d.id, role: "dependent" }));
    }
    const memberRows: Array<{ clientId?: string | null; dependentId?: string | null; role: string }> = [
      { clientId: parsed.clientId, role: "policy_holder" },
    ];
    for (const m of dependentsToAdd) {
      if (m.clientId || m.dependentId) {
        memberRows.push({
          clientId: m.clientId || null,
          dependentId: m.dependentId || null,
          role: m.role || "dependent",
        });
      }
    }
    const uniqueAddOnIds = Array.from(new Set(memberAddOns.map((ma) => ma.addOnId)));
    const allAddOnIds = uniqueAddOnIds.length > 0 ? uniqueAddOnIds : addOnIds;

    const { policy } = await storage.createPolicyWithInitialSetup(user.organizationId, {
      policy: parsed,
      statusHistory: {
        fromStatus: null,
        toStatus: "inactive",
        reason: "Policy created",
        changedBy: user.id,
      },
      members: memberRows,
      addOnIds: allAddOnIds,
    });

    await auditLog(req, "CREATE_POLICY", "Policy", policy.id, null, policy);

    if (policy.clientId) {
      enqueueJob("notify:policy_capture", { policyId: policy.id }, async () => {
        const ctx = await buildPolicyContext(policy, user.organizationId);
        await dispatchNotification(user.organizationId, "policy_capture", policy.clientId, ctx);
      });
      if (normalizedPaymentMethod) {
        await storage.upsertDefaultClientPaymentMethod(user.organizationId, policy.clientId, {
          organizationId: user.organizationId,
          clientId: policy.clientId,
          ...normalizedPaymentMethod,
          isDefault: true,
          isActive: true,
        } as any);
      }
    }

    return res.status(201).json(policy);
    } catch (err: any) {
      if (err instanceof z.ZodError) throw err;
      const dbMsg = err?.message || "";
      if (dbMsg.includes("violates foreign key")) {
        return res.status(400).json({ message: "Invalid reference: the selected client, product, agent, or branch no longer exists. Please refresh and try again." });
      }
      if (dbMsg.includes("violates unique constraint")) {
        return res.status(409).json({ message: "A policy with this number already exists. Please try again." });
      }
      structuredLog("error", "POST /api/policies failed", { error: dbMsg, stack: err?.stack });
      return res.status(500).json({ message: "Failed to create policy. Please try again or contact support." });
    }
  });

  app.patch("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    try {
    const before = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent && (before as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });
    const body = { ...req.body };
    delete body.premiumAmount;
    delete body.organizationId;
    delete body.id;
    delete body.createdAt;
    delete body.policyNumber;
    delete body.members;
    delete body.memberAddOns;
    delete body.addOnIds;
    delete body.beneficiary;
    if (!user.isPlatformOwner) delete body.agentId;

    const ALLOWED_FIELDS = new Set([
      "currency", "paymentSchedule", "effectiveDate", "branchId", "agentId", "groupId", "status",
      "beneficiaryFirstName", "beneficiaryLastName", "beneficiaryRelationship",
      "beneficiaryNationalId", "beneficiaryPhone", "beneficiaryDependentId",
    ]);
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      sanitized[key] = value === "" ? null : value;
    }

    if (Object.keys(sanitized).length === 0) {
      return res.json(before);
    }

    const updated = await storage.updatePolicy(req.params.id as string, sanitized, user.organizationId);
    await auditLog(req, "UPDATE_POLICY", "Policy", req.params.id as string, before, updated);
    return res.json(updated);
    } catch (err: any) {
      const dbMsg = err?.message || "";
      if (dbMsg.includes("violates foreign key")) {
        return res.status(400).json({ message: "Invalid reference: the selected branch, agent, or group no longer exists." });
      }
      if (dbMsg.includes("invalid input syntax")) {
        return res.status(400).json({ message: "Invalid data format. Please check your input and try again." });
      }
      structuredLog("error", "PATCH /api/policies/:id failed", { error: dbMsg, stack: err?.stack, policyId: req.params.id });
      return res.status(500).json({ message: "Failed to update policy. Please try again." });
    }
  });

  app.post("/api/policies/:id/upgrade", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    try {
      const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
      if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
      const userRoles = await storage.getUserRoles(user.id, user.organizationId);
      const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
      if (isAgent && (policy as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });

      const targetProductVersionId = typeof req.body.productVersionId === "string" ? req.body.productVersionId : "";
      if (!targetProductVersionId) return res.status(400).json({ message: "productVersionId is required" });
      const targetPv = await storage.getProductVersion(targetProductVersionId, user.organizationId);
      if (!targetPv) return res.status(400).json({ message: "Invalid target product version" });

      const currentPv = await storage.getProductVersion(policy.productVersionId, user.organizationId);
      if (!currentPv) return res.status(400).json({ message: "Current policy product version is invalid" });

      if (targetPv.id === currentPv.id) {
        const unchanged = await recalculatePolicyPremiumIfNeeded(policy, user.organizationId);
        return res.json(unchanged);
      }

      const existingForClient = await storage.getPoliciesByClient(policy.clientId, user.organizationId);
      const duplicate = existingForClient.find(
        (p) => p.id !== policy.id && p.productVersionId === targetPv.id && p.status !== "cancelled"
      );
      if (duplicate) {
        return res.status(400).json({
          error: "Duplicate policy",
          message: "This client already has an active policy for the selected product version.",
        });
      }

      const currency = normalizeCurrency(req.body.currency || policy.currency || "USD");
      const paymentSchedule = typeof req.body.paymentSchedule === "string" && req.body.paymentSchedule.trim()
        ? req.body.paymentSchedule.trim()
        : (policy.paymentSchedule || "monthly");

      const dependentDateOfBirths = await getActivePolicyDependentDobList(policy, user.organizationId);
      const addOnIds = await getPolicyAddOnIds(policy.id, user.organizationId);
      const premiumAmount = await computePolicyPremium(
        user.organizationId,
        targetPv.id,
        currency,
        paymentSchedule,
        addOnIds,
        undefined,
        undefined,
        dependentDateOfBirths,
      );

      const effectiveDate = typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
        ? req.body.effectiveDate.trim()
        : undefined;
      const updates: Record<string, any> = {
        productVersionId: targetPv.id,
        currency,
        paymentSchedule,
        premiumAmount,
      };
      if (effectiveDate) updates.effectiveDate = effectiveDate;

      const updated = await storage.updatePolicy(policy.id, updates, user.organizationId);
      await auditLog(req, "UPGRADE_POLICY_PRODUCT", "Policy", policy.id, policy, updated);
      return res.json(updated);
    } catch (err: any) {
      const dbMsg = err?.message || "";
      if (dbMsg.includes("violates foreign key")) {
        return res.status(400).json({ message: "Invalid reference: selected product version no longer exists." });
      }
      structuredLog("error", "POST /api/policies/:id/upgrade failed", { error: dbMsg, stack: err?.stack, policyId: req.params.id });
      return res.status(500).json({ message: "Failed to upgrade policy. Please try again." });
    }
  });

  app.post("/api/policies/:id/transition", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    try {
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });

    const { toStatus, reason } = req.body;
    const allowed = VALID_POLICY_TRANSITIONS[policy.status];
    if (!allowed || !allowed.includes(toStatus)) {
      return res.status(400).json({ message: `Invalid transition from ${policy.status} to ${toStatus}` });
    }

    const before = { ...policy };
    const updated = await storage.updatePolicy(policy.id, { status: toStatus }, user.organizationId);
    await storage.createPolicyStatusHistory(policy.id, policy.status, toStatus, reason, user.id, user.organizationId);

    if (policy.clientId) {
      const eventMap: Record<string, string> = {
        active: "policy_activated", grace: "grace_start", lapsed: "policy_lapsed", cancelled: "policy_cancelled",
      };
      const eventType = eventMap[toStatus] || "status_change";
      enqueueJob("notify:transition", { policyId: policy.id, toStatus }, async () => {
        const ctx = await buildPolicyContext({ ...policy, status: toStatus }, user.organizationId);
        await dispatchNotification(user.organizationId, eventType, policy.clientId, ctx);
      });
    }

    if (toStatus === "lapsed" || toStatus === "cancelled") {
      await recordClawback(user.organizationId, policy, `Policy ${toStatus}`);
    }
    await auditLog(req, "TRANSITION_POLICY", "Policy", policy.id, before, updated);
    return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "POST /api/policies/:id/transition failed", { error: err?.message, stack: err?.stack, policyId: req.params.id });
      return res.status(500).json({ message: "Failed to update policy status. Please try again." });
    }
  });

  // ─── Hard-delete a policy and all related records (RBAC-gated) ──
  app.delete("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("delete:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    await storage.deletePolicy(policy.id, user.organizationId);
    await auditLog(req, "DELETE_POLICY", "Policy", policy.id, policy, null);
    structuredLog("warn", "Hard-deleted policy", { userId: user.id, email: user.email, policyId: policy.id, policyNumber: policy.policyNumber });
    return res.json({ message: "Policy permanently deleted" });
  });

  // ─── Edit a payment transaction (RBAC-gated) ──
  app.patch("/api/payments/:id", requireAuth, requireTenantScope, requirePermission("edit:payment"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getPaymentTransaction(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const body = { ...req.body };
    delete body.id;
    delete body.organizationId;
    delete body.createdAt;
    const updated = await storage.updatePaymentTransaction(req.params.id as string, body, user.organizationId);
    await auditLog(req, "UPDATE_PAYMENT", "PaymentTransaction", req.params.id as string, before, updated);
    structuredLog("warn", "Edited payment transaction", { userId: user.id, email: user.email, transactionId: req.params.id });
    return res.json(updated);
  });

  // ─── Delete a payment transaction (RBAC-gated) ──
  app.delete("/api/payments/:id", requireAuth, requireTenantScope, requirePermission("delete:payment"), async (req, res) => {
    const user = req.user as any;
    const tx = await storage.getPaymentTransaction(req.params.id as string, user.organizationId);
    if (!tx || tx.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    await storage.deletePaymentTransaction(tx.id, user.organizationId);
    await auditLog(req, "DELETE_PAYMENT", "PaymentTransaction", tx.id, tx, null);
    structuredLog("warn", "Hard-deleted payment transaction", { userId: user.id, email: user.email, transactionId: tx.id });
    return res.json({ message: "Payment transaction permanently deleted" });
  });

  // ─── Edit a receipt (RBAC-gated) ──
  app.patch("/api/receipts/:id", requireAuth, requireTenantScope, requirePermission("edit:receipt"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getPaymentReceiptById(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const body = { ...req.body };
    delete body.id;
    delete body.organizationId;
    delete body.createdAt;
    const updated = await storage.updatePaymentReceipt(req.params.id as string, body, user.organizationId);
    await auditLog(req, "UPDATE_RECEIPT", "PaymentReceipt", req.params.id as string, before, updated);
    structuredLog("warn", "Edited receipt", { userId: user.id, email: user.email, receiptId: req.params.id });
    return res.json(updated);
  });

  // ─── Delete a receipt (RBAC-gated) ──
  app.delete("/api/receipts/:id", requireAuth, requireTenantScope, requirePermission("delete:receipt"), async (req, res) => {
    const user = req.user as any;
    const receipt = await storage.getPaymentReceiptById(req.params.id as string, user.organizationId);
    if (!receipt || receipt.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    await storage.deletePaymentReceipt(receipt.id, user.organizationId);
    await auditLog(req, "DELETE_RECEIPT", "PaymentReceipt", receipt.id, receipt, null);
    structuredLog("warn", "Hard-deleted receipt", { userId: user.id, email: user.email, receiptId: receipt.id, receiptNumber: receipt.receiptNumber });
    return res.json({ message: "Receipt permanently deleted" });
  });

  app.get("/api/policies/:id/members", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const members = await storage.getPolicyMembers(req.params.id as string, user.organizationId);
    const today = new Date().toISOString().split("T")[0];
    const todayDate = new Date();
    const policyStatusOk = policy.status === "active" || policy.status === "grace";

    let waitingPeriodDays = 90;
    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId, user.organizationId);
      if (pv?.waitingPeriodDays != null) waitingPeriodDays = pv.waitingPeriodDays;
    }

    const enriched = await Promise.all(members.map(async (m: any) => {
      let memberName = "";
      let relationship = "";
      let dateOfBirth = "";
      let gender = "";
      let nationalId = "";

      if (m.dependentId) {
        const dep = await storage.getDependent(m.dependentId, user.organizationId);
        if (dep) {
          memberName = `${dep.firstName} ${dep.lastName}`;
          relationship = dep.relationship;
          dateOfBirth = dep.dateOfBirth || "";
          gender = dep.gender || "";
          nationalId = dep.nationalId || "";
        }
      } else if (m.clientId) {
        const client = await storage.getClient(m.clientId, user.organizationId);
        if (client) {
          memberName = `${client.firstName} ${client.lastName}`;
          relationship = "Policy Holder";
          dateOfBirth = client.dateOfBirth || "";
          gender = client.gender || "";
          nationalId = client.nationalId || "";
        }
      }

      let age: number | null = null;
      if (dateOfBirth) {
        const dob = new Date(dateOfBirth);
        age = todayDate.getFullYear() - dob.getFullYear();
        const monthDiff = todayDate.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && todayDate.getDate() < dob.getDate())) age--;
      }

      const memberCreatedAt = m.createdAt ? new Date(m.createdAt).toISOString().split("T")[0] : null;
      /** Same inception basis for all covered lives (aligned with policy contract / first cover date). */
      const inceptionForWaiting = policy.inceptionDate || policy.effectiveDate || memberCreatedAt;
      const inceptionDate = inceptionForWaiting;

      let coverDate: string | null = null;
      if (inceptionForWaiting) {
        const inception = new Date(inceptionForWaiting);
        inception.setDate(inception.getDate() + waitingPeriodDays);
        coverDate = inception.toISOString().split("T")[0];
      }

      const memberWaitingOver = !coverDate || coverDate <= today;
      const memberClaimable = policyStatusOk && memberWaitingOver;

      let claimableReason = "";
      if (!policyStatusOk) {
        claimableReason = `Policy status is "${policy.status}"; must be active or in grace period.`;
      } else if (!memberWaitingOver) {
        claimableReason = `Waiting period ends ${coverDate}. Covered after that date.`;
      } else {
        claimableReason = "Eligible for claim — waiting period completed.";
      }

      let effectiveStatus: string;
      if (!m.isActive) {
        effectiveStatus = "removed";
      } else {
        effectiveStatus = policy.status;
      }

      return {
        ...m,
        memberName,
        relationship,
        dateOfBirth,
        gender,
        nationalId,
        age,
        captureDate: memberCreatedAt,
        inceptionDate: inceptionDate || null,
        coverDate,
        waitingPeriodEndDate: coverDate,
        waitingPeriodDays,
        claimable: memberClaimable,
        claimableReason,
        effectiveStatus,
      };
    }));

    return res.json(enriched);
  });

  app.post("/api/policies/:id/members", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });

    const { dependentId, clientId, role } = req.body;
    if (!dependentId && !clientId) return res.status(400).json({ message: "dependentId or clientId is required" });

    const member = await storage.createPolicyMember({
      policyId: policy.id,
      organizationId: user.organizationId,
      dependentId: dependentId || null,
      clientId: clientId || null,
      role: role || "dependent",
    });
    await recalculatePolicyPremiumIfNeeded(policy, user.organizationId);
    await auditLog(req, "ADD_POLICY_MEMBER", "PolicyMember", member.id, null, member);

    if (policy.clientId) {
      enqueueJob("notify:member_added", { policyId: policy.id }, async () => {
        let memberName = "a new member";
        if (dependentId) {
          const dep = await storage.getDependent(dependentId, user.organizationId);
          if (dep) memberName = `${dep.firstName} ${dep.lastName}`;
        }
        const ctx = await buildPolicyContext(policy, user.organizationId, { memberName });
        await dispatchNotification(user.organizationId, "member_added", policy.clientId, ctx);
      });
    }

    return res.status(201).json(member);
  });

  app.post("/api/policies/:id/sync-members", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });

    const existingMembers = await storage.getPolicyMembers(policy.id, user.organizationId);
    const existingDepIds = new Set(existingMembers.filter((m: any) => m.dependentId).map((m: any) => m.dependentId));
    const existingClientIds = new Set(existingMembers.filter((m: any) => m.clientId).map((m: any) => m.clientId));

    if (!existingClientIds.has(policy.clientId)) {
      await storage.createPolicyMember({ policyId: policy.id, clientId: policy.clientId, role: "policy_holder" });
    }

    const clientDeps = await storage.getDependentsByClient(policy.clientId, user.organizationId);
    let added = 0;
    for (const dep of clientDeps) {
      if (!existingDepIds.has(dep.id)) {
        await storage.createPolicyMember({ policyId: policy.id, dependentId: dep.id, role: "dependent" });
        added++;
      }
    }
    await recalculatePolicyPremiumIfNeeded(policy, user.organizationId);

    return res.json({ synced: added, total: existingMembers.length + added + (existingClientIds.has(policy.clientId) ? 0 : 1) });
  });

  // ─── Payments ───────────────────────────────────────────────

  app.get("/api/payments", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const filters = (fromDate || toDate) ? { fromDate, toDate } : undefined;
    return res.json(await storage.getPaymentsByOrg(user.organizationId, limit, offset, filters));
  });

  app.get("/api/policies/:id/payments", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const policyId = req.params.id as string;
    const orgId = user.organizationId;
    const intents = await storage.getPaymentIntentsByPolicy(policyId, orgId);
    const paidForPolicy = intents.filter((i: any) => i.status === "paid");
    for (const intent of paidForPolicy) {
      await applyPaymentToPolicy(intent.id, "system", null);
    }
    return res.json(await storage.getPaymentsByPolicy(policyId, orgId));
  });

  app.post("/api/payments", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer"), async (req, res) => {
    const user = req.user as any;
    try {
    const userRolesForPayment = await storage.getUserRoles(user.id, user.organizationId);
    const isAgentPayment = userRolesForPayment.some((r: { name?: string }) => r?.name === "agent");
    if (isAgentPayment && req.body.paymentMethod === "cash") {
      return res.status(403).json({ message: "Agents cannot process cash payments. Use a Paynow method instead." });
    }

    const effectivePerms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    if (!effectivePerms.includes("write:finance")) {
      const method = (req.body.paymentMethod || "cash").toLowerCase();
      const methodPermMap: Record<string, string> = {
        cash: "receipt:cash",
        mobile_money: "receipt:mobile",
        ecocash: "receipt:mobile",
        onemoney: "receipt:mobile",
        innbucks: "receipt:mobile",
        bank_transfer: "receipt:transfer",
        transfer: "receipt:transfer",
      };
      const requiredPerm = methodPermMap[method] || "receipt:cash";
      if (!effectivePerms.includes(requiredPerm)) {
        return res.status(403).json({ message: `Missing permission: ${requiredPerm}` });
      }
    }
    const statusPreview = (req.body.status ?? "pending") as string;
    const policyIdPreview = req.body.policyId as string | undefined;
    const isClearedWithPolicy = statusPreview === "cleared" && !!policyIdPreview;
    let policy: Awaited<ReturnType<typeof storage.getPolicy>> | null = null;
    if (isClearedWithPolicy && policyIdPreview) {
      policy = await storage.getPolicy(policyIdPreview, user.organizationId) ?? null;
    }

    const result = await withOrgTransaction(user.organizationId, async (txDb) => {
      await ensureRegistryUserMirroredToOrgDataDbInTx(txDb, user.organizationId, user.id);
      const [actorRow] = await txDb.select({ id: users.id }).from(users).where(eq(users.id, user.id)).limit(1);
      const recordedByForLedger = actorRow?.id ?? null;
      const today = new Date().toISOString().split("T")[0];
      const parsed = insertPaymentTransactionSchema.parse({
        ...req.body,
        organizationId: user.organizationId,
        recordedBy: recordedByForLedger ?? undefined,
        postedDate: req.body.postedDate || today,
        valueDate: req.body.valueDate || today,
      });
      const policyId = parsed.policyId;

      if (isClearedWithPolicy && policyId) {
        await txDb.execute(sql`SELECT id FROM policies WHERE id = ${policyId} FOR UPDATE`);
      }

      const [tx] = await txDb.insert(paymentTransactions).values(parsed).returning();

      let receipt = null;
      if (tx.status === "cleared" && tx.policyId && tx.clientId) {
        const receiptNumber = await storage.allocatePaymentReceiptNumberInTx(txDb, user.organizationId);
        const [newReceipt] = await txDb.insert(paymentReceipts).values({
          organizationId: user.organizationId,
          branchId: policy?.branchId || user.branchId || undefined,
          receiptNumber,
          policyId: tx.policyId,
          clientId: tx.clientId,
          amount: tx.amount,
          currency: tx.currency,
          paymentChannel: tx.paymentMethod || "cash",
          issuedByUserId: recordedByForLedger ?? undefined,
          status: "issued",
          printFormat: "thermal_80mm",
          metadataJson: { transactionId: tx.id, notes: tx.notes },
        }).returning();
        receipt = newReceipt;
      }

      let policyStatusChange: {
        from: string | null | undefined;
        to: "active";
        reason: string;
      } | null = null;
      if (tx.status === "cleared" && tx.policyId && policy) {
        const todayDate = new Date().toISOString().split("T")[0];
        const updated = await applyPolicyStatusForClearedPayment(txDb, tx.policyId, policy, todayDate, " (recorded)", recordedByForLedger ?? undefined);
        policyStatusChange = updated
          ? { from: policy.status, to: "active" as const, reason: policy.status === "inactive" ? "First premium paid — conversion" : policy.status === "grace" ? "Payment received" : "Reinstatement — payment received" }
          : null;
      }

      if (tx.status === "cleared") {
        await insertOutboxMessageInTx(txDb, {
          organizationId: user.organizationId,
          type: OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP,
          dedupeKey: `payment_staff_followup:${tx.id}`,
          payload: {
            transactionId: tx.id,
            receiptId: receipt?.id ?? null,
          },
        });
      }

      return { tx, receipt, policyStatusChange };
    });

    if (result.tx.status === "cleared" && result.tx.policyId && policy?.status === "lapsed") {
      await rollbackClawbacks(user.organizationId, policy);
    }

    await auditLog(req, "CREATE_PAYMENT", "PaymentTransaction", result.tx.id, null, result.tx);
    if (result.receipt) await auditLog(req, "CREATE_RECEIPT", "PaymentReceipt", result.receipt.id, null, result.receipt);

    if (result.tx.status === "cleared") {
      requestOutboxDrain(user.organizationId);
    }

    return res.status(201).json({ ...result.tx, receipt: result.receipt });
    } catch (err: any) {
      if (err?.name === "ZodError" && err?.errors?.length) {
        const msg = err.errors.map((e: { path?: string[]; message?: string }) => `${e.path?.join(".") || "field"}: ${e.message}`).join("; ");
        return res.status(400).json({ message: msg || "Invalid payment data" });
      }
      // Duplicate idempotency key (e.g. retry) — return 409 so client can treat as idempotent
      if (err?.code === "23505" || (err?.message && String(err.message).includes("unique constraint") && String(err.message).includes("idempotency_key"))) {
        return res.status(409).json({ message: "A payment with this idempotency key already exists. Duplicate request ignored." });
      }
      structuredLog("error", "POST /api/payments failed", { error: err?.message || String(err), stack: err?.stack });
      return res.status(500).json({ message: process.env.NODE_ENV === "production" ? "Payment failed. Please try again." : (err?.message || "Payment failed") });
    }
  });

  app.get("/api/policies/:id/receipts", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getPaymentReceiptsByPolicy(req.params.id as string, user.organizationId));
  });

  // ─── Payment intents (Paynow) & receipts ─────────────────────
  app.get("/api/payment-intents", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    return res.json(await storage.getPaymentIntentsByOrg(user.organizationId, limit));
  });

  app.get("/api/payment-intents/:id", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const intent = await storage.getPaymentIntentById(id, user.organizationId);
    if (!intent || intent.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const events = await storage.getPaymentEventsByIntentId(intent.id, user.organizationId);
    return res.json({ ...intent, events });
  });

  app.post("/api/payment-intents/:id/poll", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const intent = await storage.getPaymentIntentById(id, user.organizationId);
    if (!intent || intent.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const result = await pollPaynowStatus(intent.id, intent.organizationId);
    return res.json(result);
  });

  // Staff-side Paynow: create intent, initiate, submit OTP
  app.post("/api/payment-intents", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const { policyId, clientId, amount, currency, purpose } = req.body;
    if (!policyId || !clientId || !amount) return res.status(400).json({ message: "policyId, clientId, and amount are required" });
    try {
      const idempotencyKey = `staff-${user.id}-${policyId}-${Date.now()}`;
      const result = await createPaymentIntent({
        organizationId: user.organizationId,
        clientId,
        policyId,
        amount: String(amount),
        currency: currency || "USD",
        purpose: purpose || "premium",
        idempotencyKey,
      });
      if (result.error) return res.status(400).json({ message: result.error });
      await auditLog(req, "CREATE_PAYMENT_INTENT", "PaymentIntent", result.intent.id, null, result.intent);
      return res.status(201).json(result.intent);
    } catch (err) {
      structuredLog("error", "Staff create payment intent failed", { error: (err as Error).message });
      return res.status(500).json({ message: "Failed to create payment intent" });
    }
  });

  app.post("/api/payment-intents/:id/initiate", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const intent = await storage.getPaymentIntentById(id, user.organizationId);
    if (!intent || intent.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const { method, payerPhone, payerEmail } = req.body;
    try {
      const result = await initiatePaynowPayment({
        intentId: intent.id,
        organizationId: user.organizationId,
        method: method || "visa_mastercard",
        payerPhone,
        payerEmail,
        actorType: "admin",
        actorId: user.id,
      });
      if (!result.ok) return res.status(400).json({ message: result.error });
      return res.json({
        redirectUrl: result.redirectUrl,
        pollUrl: result.pollUrl,
        innbucksCode: result.innbucksCode,
        innbucksExpiry: result.innbucksExpiry,
        omariOtpReference: result.omariOtpReference,
        needsOtp: !!result.omariOtpUrl,
      });
    } catch (err) {
      structuredLog("error", "Staff initiate Paynow failed", { error: (err as Error).message });
      return res.status(500).json({ message: "Failed to initiate payment" });
    }
  });

  app.post("/api/payment-intents/:id/otp", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const intent = await storage.getPaymentIntentById(id, user.organizationId);
    if (!intent || intent.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const { otp } = req.body;
    if (!otp || typeof otp !== "string" || otp.trim().length < 4) return res.status(400).json({ message: "Enter a valid OTP" });
    try {
      const { submitOmariOtp } = await import("./payment-service");
      const result = await submitOmariOtp(id, user.organizationId, otp.trim(), "admin", user.id);
      if (!result.ok) return res.status(400).json({ message: result.error });
      return res.json({ paid: result.paid });
    } catch (err) {
      structuredLog("error", "Staff O'Mari OTP submit failed", { error: (err as Error).message });
      return res.status(500).json({ message: "OTP verification failed" });
    }
  });

  app.get("/api/receipts/:id/download", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const receipt = user.organizationId
      ? await storage.getPaymentReceiptById(id, user.organizationId)
      : await findPaymentReceiptById(id);
    if (!receipt) return res.status(404).json({ message: "Not found" });
    if (user.organizationId && receipt.organizationId !== user.organizationId) return res.status(403).json({ message: "Forbidden" });
    const result = await getReceiptPdfPath(receipt.pdfStorageKey);
    if (!result) return res.status(404).json({ message: "Receipt PDF not available" });
    if (Buffer.isBuffer(result)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="receipt-${receipt.receiptNumber}.pdf"`);
      return res.send(result);
    }
    return res.download(result, `receipt-${receipt.receiptNumber}.pdf`);
  });

  app.post("/api/admin/receipts/cash", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    try {
    const userRolesForCash = await storage.getUserRoles(user.id, user.organizationId);
    const isAgentCash = userRolesForCash.some((r: { name?: string }) => r?.name === "agent");
    if (isAgentCash) {
      return res.status(403).json({ message: "Agents cannot process cash payments. Use a Paynow method instead." });
    }
    const { policyId, amount, currency, notes, receivedAt, idempotencyKey } = req.body;
    if (!policyId || amount == null) return res.status(400).json({ message: "policyId and amount required" });

    // Idempotency: reject if a cleared transaction for this policy with the same idempotency key exists
    if (idempotencyKey) {
      const existing = await storage.getPaymentTransactionByIdempotencyKey(idempotencyKey, user.organizationId);
      if (existing) return res.status(200).json({ transaction: existing, receipt: null, duplicate: true });
    }

    const policy = await storage.getPolicy(policyId, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });

    // Use a database transaction so payment + receipt + status change are atomic
    const result = await withOrgTransaction(user.organizationId, async (txDb) => {
      await ensureRegistryUserMirroredToOrgDataDbInTx(txDb, user.organizationId, user.id);
      const [actorRow] = await txDb.select({ id: users.id }).from(users).where(eq(users.id, user.id)).limit(1);
      const recordedByForLedger = actorRow?.id ?? null;
      // Lock the policy row to prevent concurrent modifications
      await txDb.execute(sql`SELECT id FROM policies WHERE id = ${policyId} FOR UPDATE`);

      const today = new Date().toISOString().split("T")[0];
      const [tx] = await txDb.insert(paymentTransactions).values({
        organizationId: user.organizationId,
        policyId,
        clientId: policy.clientId,
        amount: String(amount),
        currency: currency || policy.currency,
        paymentMethod: "cash",
        status: "cleared",
        reference: `CASH-${Date.now()}`,
        idempotencyKey: idempotencyKey || `cash-${policyId}-${Date.now()}`,
        receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
        postedDate: today,
        valueDate: today,
        notes: notes || null,
        recordedBy: recordedByForLedger ?? undefined,
      }).returning();

      const receiptNumber = await storage.allocatePaymentReceiptNumberInTx(txDb, user.organizationId);
      const [receipt] = await txDb.insert(paymentReceipts).values({
        organizationId: user.organizationId,
        branchId: policy.branchId || user.branchId || undefined,
        receiptNumber,
        paymentIntentId: undefined,
        policyId,
        clientId: policy.clientId,
        amount: String(amount),
        currency: currency || policy.currency,
        paymentChannel: "cash",
        issuedByUserId: recordedByForLedger ?? undefined,
        status: "issued",
        printFormat: "thermal_80mm",
        metadataJson: { transactionId: tx.id, notes },
      }).returning();

      // Transition policy status atomically within the same transaction
      await applyPolicyStatusForClearedPayment(txDb, policyId, policy, today, " (cash)", recordedByForLedger ?? undefined);

      await insertOutboxMessageInTx(txDb, {
        organizationId: user.organizationId,
        type: OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP,
        dedupeKey: `cash_receipt_followup:${tx.id}`,
        payload: { transactionId: tx.id, receiptId: receipt.id },
      });

      return { tx, receipt };
    });

    if (policy.status === "lapsed") {
      await rollbackClawbacks(user.organizationId, policy);
    }

    await auditLog(req, "CASH_RECEIPT", "PaymentReceipt", result.receipt.id, null, result.receipt);

    requestOutboxDrain(user.organizationId);

    return res.status(201).json({ transaction: result.tx, receipt: result.receipt });
    } catch (err: any) {
      structuredLog("error", "POST /api/admin/receipts/cash failed", { error: err?.message || String(err), stack: err?.stack });
      return res.status(500).json({ message: process.env.NODE_ENV === "production" ? "Cash receipt failed. Please try again." : (err?.message || "Cash receipt failed") });
    }
  });

  app.post("/api/admin/receipts/reprint", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const { receiptId } = req.body;
    if (!receiptId) return res.status(400).json({ message: "receiptId required" });
    const receipt = await storage.getPaymentReceiptById(receiptId, user.organizationId);
    if (!receipt || receipt.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    if (receipt.paymentIntentId) {
      await storage.createPaymentEvent({
        paymentIntentId: receipt.paymentIntentId,
        organizationId: user.organizationId,
        type: "reprint",
        payloadJson: { receiptId },
        actorType: "admin",
        actorId: user.id,
      });
    }
    await auditLog(req, "RECEIPT_REPRINT", "PaymentReceipt", receiptId, null, { receiptId });
    return res.json({ message: "Reprint logged" });
  });

  // ─── Month-end run (batch receipt from bank file) ─────────────
  app.get("/api/month-end-run/template", requireAuth, requireTenantScope, requirePermission("read:finance"), (_req, res) => {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=month-end-run-template.csv");
    res.send("policy_number,amount,currency\nPOL001,25.00,USD\n");
  });

  const memoryUpload = multer({ storage: multer.memoryStorage() });
  app.post("/api/month-end-run", requireAuth, requireTenantScope, requirePermission("write:finance"), memoryUpload.single("file"), async (req, res) => {
    const user = req.user as any;
    if (!req.file?.buffer) return res.status(400).json({ message: "No file uploaded" });
    const recordedByForLedger = await resolveUserIdForOrgDatabase(user.id, user.organizationId);
    const runNumber = await storage.getNextMonthEndRunNumber(user.organizationId);
    const run = await storage.createMonthEndRun({
      organizationId: user.organizationId,
      runNumber,
      fileName: (req.file as any).originalname || "upload.csv",
      totalRows: 0,
      receiptedCount: 0,
      creditNoteCount: 0,
      status: "processing",
      runBy: recordedByForLedger ?? undefined,
    });
    const text = req.file.buffer.toString("utf-8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0]?.toLowerCase() || "";
    const policyCol = header.includes("policy_number") ? "policy_number" : header.split(",")[0]?.trim().toLowerCase() || "policy_number";
    const amountCol = header.includes("amount") ? "amount" : "amount";
    const currencyCol = header.includes("currency") ? "currency" : "currency";
    const rows = lines.slice(1);
    let receipted = 0;
    let creditNotes = 0;
    const today = new Date().toISOString().split("T")[0];
    for (const line of rows) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 2) continue;
      const policyNumber = parts[0];
      const amountStr = parts[1] || "0";
      const currency = normalizeCurrency(parts[2]);
      const amount = parseFloat(amountStr);
      if (!policyNumber || !Number.isFinite(amount) || amount < 0) continue;
      const policy = await storage.getPolicyByNumber(policyNumber, user.organizationId);
      if (!policy) continue;
      const premium = parseFloat(String(policy.premiumAmount || 0));
      if (amount >= premium) {
        await withOrgTransaction(user.organizationId, async (txDb) => {
          // Lock the policy row to prevent concurrent status changes
          await txDb.execute(sql`SELECT id FROM policies WHERE id = ${policy.id} FOR UPDATE`);
          const receiptNum = await storage.allocatePaymentReceiptNumberInTx(txDb, user.organizationId);
          const [tx] = await txDb.insert(paymentTransactions).values({
            organizationId: user.organizationId,
            policyId: policy.id,
            clientId: policy.clientId,
            amount: String(premium),
            currency: policy.currency || "USD",
            paymentMethod: "bank",
            status: "cleared",
            reference: `MER-${runNumber}-${policyNumber}`,
            receivedAt: new Date(),
            postedDate: today,
            valueDate: today,
            recordedBy: recordedByForLedger ?? undefined,
          }).returning();
          await txDb.insert(paymentReceipts).values({
            organizationId: user.organizationId,
            branchId: policy.branchId ?? undefined,
            receiptNumber: receiptNum,
            policyId: policy.id,
            clientId: policy.clientId!,
            amount: String(premium),
            currency: policy.currency || "USD",
            paymentChannel: "bank",
            issuedByUserId: recordedByForLedger ?? undefined,
            status: "issued",
            metadataJson: { monthEndRunId: run.id, transactionId: tx.id },
          });
          await applyPolicyStatusForClearedPayment(txDb, policy.id, policy, today, " (month-end)", recordedByForLedger ?? undefined);
        });
        receipted++;
        // Post-transaction best-effort side effects
        if (policy.status === "lapsed") {
          await rollbackClawbacks(user.organizationId, policy);
          if (policy.clientId) {
            enqueueJob("notify:reinstatement", { policyId: policy.id }, async () => {
              const ctx = await buildPolicyContext({ ...policy, status: "active" }, user.organizationId);
              await dispatchNotification(user.organizationId, "reinstatement", policy.clientId, ctx);
            });
          }
        }
        if (amount > premium) {
          await storage.addPolicyCreditBalance(user.organizationId, policy.id, (amount - premium).toFixed(2), currency);
        }
      } else {
        await storage.addPolicyCreditBalance(user.organizationId, policy.id, amountStr, currency);
        const cnNumber = await storage.getNextCreditNoteNumber(user.organizationId);
        await storage.createCreditNote({
          organizationId: user.organizationId,
          policyId: policy.id,
          clientId: policy.clientId!,
          creditNoteNumber: cnNumber,
          amount: amountStr,
          currency,
          reason: "Insufficient payment in month-end run; credited to policy balance.",
          monthEndRunId: run.id,
        });
        creditNotes++;
      }
    }
    await storage.getMonthEndRunById(run.id, user.organizationId).then(async () => {
      const { getDbForOrg } = await import("./tenant-db");
      const { monthEndRuns } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const tdb = await getDbForOrg(user.organizationId);
      await tdb.update(monthEndRuns).set({
        totalRows: rows.length,
        receiptedCount: receipted,
        creditNoteCount: creditNotes,
        status: "completed",
      }).where(eq(monthEndRuns.id, run.id));
    }).catch((err) => {
      structuredLog("warn", "Month-end run update failed (run already saved)", { runId: run.id, error: (err as Error).message });
    });
    await auditLog(req, "MONTH_END_RUN", "MonthEndRun", run.id, null, { runId: run.id, runNumber, receiptedCount: receipted, creditNoteCount: creditNotes, totalRows: rows.length, fileName: run.fileName });
    return res.status(201).json({ run: { ...run, receiptedCount: receipted, creditNoteCount: creditNotes, status: "completed" }, receiptedCount: receipted, creditNoteCount: creditNotes });
  });

  app.get("/api/credit-notes", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const policyId = typeof req.query.policyId === "string" ? req.query.policyId : undefined;
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
    if (policyId) {
      return res.json(await storage.getCreditNotesByPolicy(policyId, user.organizationId));
    }
    if (clientId) {
      return res.json(await storage.getCreditNotesByClient(clientId, user.organizationId));
    }
    return res.status(400).json({ message: "policyId or clientId required" });
  });

  // ─── Group batch receipt (staff: receipt multiple group policies at once) ───
  app.post("/api/group-receipt", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    try {
    const { groupId, policyIds, totalAmount, currency } = req.body;
    if (!groupId || !Array.isArray(policyIds) || policyIds.length === 0 || totalAmount == null) {
      return res.status(400).json({ message: "groupId, policyIds (array), and totalAmount required" });
    }
    const policies = await storage.getPoliciesByIds(policyIds, user.organizationId);
    const valid = policies.filter((p) => p && p.organizationId === user.organizationId && p.groupId === groupId);
    if (valid.length === 0) return res.status(400).json({ message: "No valid policies in group" });
    const totalPremium = valid.reduce((s, p) => s + parseFloat(String(p.premiumAmount || 0)), 0);
    const amountNum = parseFloat(String(totalAmount));
    const today = new Date().toISOString().split("T")[0];
    const results: { policyId: string; policyNumber: string; amount: string; receiptNumber: string }[] = [];
    const groupRef = `GRP-${groupId.slice(0, 8)}-${Date.now()}`;
    // Stable lock order avoids deadlocks when multiple group receipts overlap.
    const sortedPolicies = [...valid].sort((a, b) => a.id.localeCompare(b.id));
    await withOrgTransaction(user.organizationId, async (txDb) => {
      await ensureRegistryUserMirroredToOrgDataDbInTx(txDb, user.organizationId, user.id);
      const [actorRow] = await txDb.select({ id: users.id }).from(users).where(eq(users.id, user.id)).limit(1);
      const recordedByForLedger = actorRow?.id ?? null;
      for (const policy of sortedPolicies) {
        const premium = parseFloat(String(policy.premiumAmount || 0));
        const amount = totalPremium > 0 ? (amountNum * (premium / totalPremium)).toFixed(2) : (amountNum / valid.length).toFixed(2);
        const polyCurrency = currency || policy.currency || "USD";
        await txDb.execute(sql`SELECT id FROM policies WHERE id = ${policy.id} FOR UPDATE`);
        const receiptNum = await storage.allocatePaymentReceiptNumberInTx(txDb, user.organizationId);
        const [tx] = await txDb.insert(paymentTransactions).values({
          organizationId: user.organizationId,
          policyId: policy.id,
          clientId: policy.clientId!,
          amount,
          currency: polyCurrency,
          paymentMethod: "cash",
          status: "cleared",
          reference: groupRef,
          receivedAt: new Date(),
          postedDate: today,
          valueDate: today,
          notes: "Group batch receipt",
          recordedBy: recordedByForLedger ?? undefined,
        }).returning();
        await txDb.insert(paymentReceipts).values({
          organizationId: user.organizationId,
          branchId: policy.branchId ?? undefined,
          receiptNumber: receiptNum,
          policyId: policy.id,
          clientId: policy.clientId!,
          amount,
          currency: polyCurrency,
          paymentChannel: "cash",
          issuedByUserId: recordedByForLedger ?? undefined,
          status: "issued",
          metadataJson: { groupId, transactionId: tx.id },
        });
        await applyPolicyStatusForClearedPayment(txDb, policy.id, policy, today, " (group receipt)", recordedByForLedger ?? undefined);
        results.push({ policyId: policy.id, policyNumber: policy.policyNumber, amount, receiptNumber: receiptNum });
      }
    });
    for (const policy of sortedPolicies) {
      if (policy.status === "lapsed") {
        await rollbackClawbacks(user.organizationId, policy);
      }
    }
    return res.status(201).json({ receipted: results.length, results });
    } catch (err: any) {
      structuredLog("error", "POST /api/group-receipt failed", { error: err?.message || String(err), stack: err?.stack });
      return res.status(500).json({ message: process.env.NODE_ENV === "production" ? "Group receipt failed. Please try again." : (err?.message || "Group receipt failed") });
    }
  });

  // ─── Group PayNow (create intent, initiate, poll) ───
  app.post("/api/group-payment-intents", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const { groupId, policyIds, totalAmount, currency } = req.body;
    if (!groupId || !Array.isArray(policyIds) || policyIds.length === 0 || totalAmount == null) {
      return res.status(400).json({ message: "groupId, policyIds (array), and totalAmount required" });
    }
    const policies = await storage.getPoliciesByIds(policyIds, user.organizationId);
    const valid = policies.filter((p) => p && p.organizationId === user.organizationId && p.groupId === groupId);
    if (valid.length === 0) return res.status(400).json({ message: "No valid policies in group" });
    const totalPremium = valid.reduce((s, p) => s + parseFloat(String(p.premiumAmount || 0)), 0);
    const amountNum = parseFloat(String(totalAmount));
    const cur = currency || "USD";
    const idempotencyKey = `grp-${groupId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const org = await storage.getOrganization(user.organizationId);
    const orgCode = (org?.name ?? "ORG").replace(/\s+/g, "").slice(0, 8).toUpperCase();
    const merchantReference = generateGroupMerchantReference(orgCode, groupId);
    const existing = await storage.getGroupPaymentIntentByOrgAndIdempotencyKey(user.organizationId, idempotencyKey);
    if (existing) return res.json(existing);
    const initiatedByResolved = await resolveUserIdForOrgDatabase(user.id, user.organizationId);
    const intent = await storage.createGroupPaymentIntent({
      organizationId: user.organizationId,
      groupId,
      totalAmount: amountNum.toFixed(2),
      currency: cur,
      status: "created",
      idempotencyKey,
      merchantReference,
      initiatedByUserId: initiatedByResolved ?? undefined,
    });
    const allocations = valid.map((p) => {
      const premium = parseFloat(String(p.premiumAmount || 0));
      const amount = totalPremium > 0 ? (amountNum * (premium / totalPremium)).toFixed(2) : (amountNum / valid.length).toFixed(2);
      return { groupPaymentIntentId: intent.id, policyId: p.id, amount, currency: cur };
    });
    await storage.createGroupPaymentAllocations(user.organizationId, allocations);
    return res.status(201).json(intent);
  });

  app.get("/api/group-payment-intents/:id", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ message: "Missing id" });
    const intent = await storage.getGroupPaymentIntentById(id, user.organizationId);
    if (!intent) return res.status(404).json({ message: "Not found" });
    return res.json(intent);
  });

  app.post("/api/group-payment-intents/:id/initiate", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ message: "Missing id" });
    const { method, payerPhone } = req.body || {};
    const result = await initiatePaynowForGroup({
      groupIntentId: id,
      organizationId: user.organizationId,
      method: method || "visa_mastercard",
      payerPhone,
      actorType: "admin",
      actorId: user.id,
    });
    if (!result.ok) return res.status(400).json({ message: result.error });
    return res.json({ redirectUrl: result.redirectUrl, pollUrl: result.pollUrl });
  });

  app.post("/api/group-payment-intents/:id/poll", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ message: "Missing id" });
    const result = await pollGroupPaynowStatus(id, user.organizationId);
    return res.json(result);
  });

  app.get("/api/paynow-config", requireAuth, requireTenantScope, requirePermission("read:finance"), (_req, res) => {
    return res.json({ enabled: getPaynowConfig().enabled });
  });

  app.post("/api/apply-credit-balances", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const result = await runApplyCreditBalances(user.organizationId);
    return res.json(result);
  });

  // ─── Cashups ────────────────────────────────────────────────

  app.get("/api/cashups/my-receipt-totals", requireAuth, requireTenantScope, requireAnyPermission("read:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
    if (!date) return res.status(400).json({ error: "Query 'date' (YYYY-MM-DD) is required" });
    const result = await storage.getReceiptTotalsByUserDate(user.organizationId, user.id, date);
    return res.json(result);
  });

  app.get("/api/cashups", requireAuth, requireTenantScope, requireAnyPermission("read:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const canReadFinance = perms.includes("read:finance");
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const filters: { fromDate?: string; toDate?: string; preparedBy?: string; status?: string } = {};
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    if (status) filters.status = status;
    if (canReadFinance && userId) filters.preparedBy = userId;
    if (!canReadFinance) filters.preparedBy = user.id;
    const list = await storage.getCashups(user.organizationId, 100, filters);
    return res.json(list);
  });

  app.post("/api/cashups", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    const body = req.body as any;
    const amountsByMethod = body.amountsByMethod && typeof body.amountsByMethod === "object" ? body.amountsByMethod : { cash: "0", paynow_ecocash: "0", paynow_card: "0", other: "0" };
    let totalAmount = 0;
    for (const k of Object.keys(amountsByMethod)) {
      totalAmount += parseFloat(String(amountsByMethod[k] || "0")) || 0;
    }
    const parsed = insertCashupSchema.parse({
      organizationId: user.organizationId,
      preparedBy: user.id,
      branchId: body.branchId || undefined,
      cashupDate: body.cashupDate,
      totalAmount: String(totalAmount.toFixed(2)),
      currency: body.currency || "USD",
      transactionCount: typeof body.transactionCount === "number" ? body.transactionCount : parseInt(String(body.transactionCount || "0"), 10) || 0,
      amountsByMethod,
      status: "draft",
      notes: body.notes || undefined,
    });
    const cashup = await storage.createCashup(parsed);
    await auditLog(req, "CREATE_CASHUP", "Cashup", cashup.id, null, cashup);
    return res.status(201).json(cashup);
  });

  app.get("/api/cashups/:id", requireAuth, requireTenantScope, requireAnyPermission("read:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    const cashup = await storage.getCashup(req.params.id as string, user.organizationId);
    if (!cashup) return res.status(404).json({ message: "Not found" });
    const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    if (!perms.includes("read:finance") && cashup.preparedBy !== user.id) return res.status(403).json({ message: "You can only view your own cashups" });
    return res.json(cashup);
  });

  app.patch("/api/cashups/:id", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    const cashup = await storage.getCashup(req.params.id as string, user.organizationId);
    if (!cashup) return res.status(404).json({ message: "Not found" });
    const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const hasFinance = perms.includes("write:finance");
    const body = req.body as any;

    if (cashup.status === "draft" && body.action === "submit") {
      if (cashup.preparedBy !== user.id) return res.status(403).json({ message: "Only the preparer can submit" });
      const updated = await storage.updateCashup(cashup.id, {
        status: "submitted",
        submittedAt: new Date(),
        submittedBy: user.id,
      }, user.organizationId);
      await auditLog(req, "SUBMIT_CASHUP", "Cashup", cashup.id, cashup, updated);
      return res.json(updated);
    }

    if (cashup.status === "submitted" && (body.action === "confirm" || body.action === "confirm_discrepancy")) {
      if (!hasFinance) return res.status(403).json({ message: "Only finance can confirm cashups" });
      const countedTotal = body.countedTotal != null ? parseFloat(String(body.countedTotal)) : null;
      const countedAmountsByMethod = body.countedAmountsByMethod && typeof body.countedAmountsByMethod === "object" ? body.countedAmountsByMethod : undefined;
      let computedCountedTotal = countedTotal;
      if (computedCountedTotal == null && countedAmountsByMethod) {
        computedCountedTotal = 0;
        for (const k of Object.keys(countedAmountsByMethod)) {
          computedCountedTotal += parseFloat(String(countedAmountsByMethod[k] || "0")) || 0;
        }
      }
      const expectedTotal = parseFloat(String(cashup.totalAmount || "0"));
      const finalCounted = computedCountedTotal ?? expectedTotal;
      const discrepancyAmount = finalCounted - expectedTotal;
      const hasDiscrepancy = Math.abs(discrepancyAmount) > 0.005;
      const status = hasDiscrepancy ? "discrepancy" : "confirmed";
      const discrepancyNotes = body.discrepancyNotes || (hasDiscrepancy ? `Counted ${finalCounted.toFixed(2)} vs expected ${expectedTotal.toFixed(2)}` : undefined);
      const updated = await storage.updateCashup(cashup.id, {
        status,
        confirmedAt: new Date(),
        confirmedBy: user.id,
        countedTotal: finalCounted.toFixed(2),
        countedAmountsByMethod: countedAmountsByMethod || undefined,
        discrepancyAmount: hasDiscrepancy ? String(discrepancyAmount.toFixed(2)) : undefined,
        discrepancyNotes,
        isLocked: true,
        lockedAt: new Date(),
        lockedBy: user.id,
      }, user.organizationId);
      await auditLog(req, "CONFIRM_CASHUP", "Cashup", cashup.id, cashup, updated);
      return res.json(updated);
    }

    return res.status(400).json({ error: "Invalid action or state", status: cashup.status });
  });

  // ─── Claims ─────────────────────────────────────────────────

  app.get("/api/claims", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const filters = (fromDate || toDate) ? { fromDate, toDate } : undefined;
    return res.json(await storage.getClaimsByOrg(user.organizationId, limit, offset, filters));
  });

  app.get("/api/claims/:id", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
    const user = req.user as any;
    const claim = await storage.getClaim(req.params.id as string, user.organizationId);
    if (!claim) return res.status(404).json({ message: "Not found" });
    if (claim.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    return res.json(claim);
  });

  app.post("/api/claims", requireAuth, requireTenantScope, requirePermission("write:claim"), async (req, res) => {
    const user = req.user as any;
    const claimNumber = await storage.generateClaimNumber(user.organizationId);
    const parsed = insertClaimSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      claimNumber,
      status: "submitted",
      submittedBy: user.id,
    });
    const claim = await storage.createClaim(parsed);
    await storage.createClaimStatusHistory(claim.id, null, "submitted", "Claim submitted", user.id);
    await auditLog(req, "CREATE_CLAIM", "Claim", claim.id, null, claim);
    return res.status(201).json(claim);
  });

  app.post("/api/claims/:id/transition", requireAuth, requireTenantScope, requirePermission("write:claim"), async (req, res) => {
    const user = req.user as any;
    const claim = await storage.getClaim(req.params.id as string, user.organizationId);
    if (!claim || claim.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });

    const { toStatus, reason } = req.body;
    const allowed = VALID_CLAIM_TRANSITIONS[claim.status];
    if (!allowed || !allowed.includes(toStatus)) {
      return res.status(400).json({ message: `Invalid transition from ${claim.status} to ${toStatus}` });
    }

    if (["approved", "paid"].includes(toStatus)) {
      const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
      if (!perms.includes("approve:claim")) {
        return res.status(403).json({ message: "Approval permission required" });
      }
    }

    const before = { ...claim };
    const updateData: any = { status: toStatus };
    if (toStatus === "verified") updateData.verifiedBy = user.id;
    if (toStatus === "approved") updateData.approvedBy = user.id;

    const updated = await storage.updateClaim(claim.id, updateData, claim.organizationId);
    await storage.createClaimStatusHistory(claim.id, claim.status, toStatus, reason, user.id);
    await auditLog(req, "TRANSITION_CLAIM", "Claim", claim.id, before, updated);
    return res.json(updated);
  });

  app.get("/api/claims/:id/documents", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getClaimDocuments(req.params.id as string, user.organizationId));
  });

  // ─── Funeral Cases ──────────────────────────────────────────

  app.get("/api/funeral-cases", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const filters = (fromDate || toDate) ? { fromDate, toDate } : undefined;
    return res.json(await storage.getFuneralCasesByOrg(user.organizationId, limit, offset, filters));
  });

  app.get("/api/funeral-cases/:id", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const fc = await storage.getFuneralCase(req.params.id as string, user.organizationId);
    if (!fc) return res.status(404).json({ message: "Not found" });
    if (fc.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    return res.json(fc);
  });

  app.post("/api/funeral-cases", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const caseNumber = await storage.generateCaseNumber(user.organizationId);
    const parsed = insertFuneralCaseSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      caseNumber,
      status: "open",
    });
    const fc = await storage.createFuneralCase(parsed);
    await auditLog(req, "CREATE_FUNERAL_CASE", "FuneralCase", fc.id, null, fc);
    return res.status(201).json(fc);
  });

  app.patch("/api/funeral-cases/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getFuneralCase(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateFuneralCase(req.params.id as string, req.body, user.organizationId);
    await auditLog(req, "UPDATE_FUNERAL_CASE", "FuneralCase", req.params.id as string, before, updated);
    return res.json(updated);
  });

  app.get("/api/funeral-cases/:id/tasks", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getFuneralTasks(req.params.id as string, user.organizationId));
  });

  app.post("/api/funeral-cases/:id/tasks", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const fc = await storage.getFuneralCase(req.params.id as string, user.organizationId);
    if (!fc || fc.organizationId !== user.organizationId) return res.status(404).json({ message: "Funeral case not found" });
    const parsed = insertFuneralTaskSchema.parse({ ...req.body, funeralCaseId: req.params.id as string });
    const task = await storage.createFuneralTask(parsed);
    return res.status(201).json(task);
  });

  app.patch("/api/funeral-tasks/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await storage.updateFuneralTask(id, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Funeral task not found" });
    return res.json(updated);
  });

  // ─── Fleet ──────────────────────────────────────────────────

  app.get("/api/fleet", requireAuth, requireTenantScope, requirePermission("read:fleet"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const rows = await storage.getFleetVehicles(user.organizationId);
    return res.json(rows.slice(offset, offset + limit));
  });

  app.post("/api/fleet", requireAuth, requireTenantScope, requirePermission("write:fleet"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertFleetVehicleSchema.parse({ ...req.body, organizationId: user.organizationId });
    const vehicle = await storage.createFleetVehicle(parsed);
    await auditLog(req, "CREATE_VEHICLE", "FleetVehicle", vehicle.id, null, vehicle);
    return res.status(201).json(vehicle);
  });

  // ─── Commissions ────────────────────────────────────────────

  app.get("/api/commission-plans", requireAuth, requireTenantScope, requirePermission("read:commission"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getCommissionPlans(user.organizationId));
  });

  app.post("/api/commission-plans", requireAuth, requireTenantScope, requirePermission("write:commission"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertCommissionPlanSchema.parse({ ...req.body, organizationId: user.organizationId });
    const plan = await storage.createCommissionPlan(parsed);
    await auditLog(req, "CREATE_COMMISSION_PLAN", "CommissionPlan", plan.id, null, plan);
    return res.status(201).json(plan);
  });

  app.get("/api/commission-ledger", requireAuth, requireTenantScope, requirePermission("read:commission"), async (req, res) => {
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const agentId = req.query.agentId as string | undefined;
    const filterAgent = isAgent ? user.id : agentId;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);
    const offset = parseInt(req.query.offset as string) || 0;
    const rows = await storage.getCommissionLedgerDetailedByOrg(user.organizationId, filterAgent);
    return res.json(rows.slice(offset, offset + limit));
  });

  // ─── Leads / Pipeline ──────────────────────────────────────

  app.get("/api/leads", requireAuth, requireTenantScope, requirePermission("read:lead"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const list = isAgent
      ? (await storage.getLeadsByAgent(user.id, user.organizationId)).slice(offset, offset + limit)
      : await storage.getLeadsByOrg(user.organizationId, limit, offset);
    return res.json(list);
  });

  app.post("/api/leads", requireAuth, requireTenantScope, requirePermission("write:lead"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertLeadSchema.parse({ ...req.body, organizationId: user.organizationId });
    const lead = await storage.createLead(parsed);
    await auditLog(req, "CREATE_LEAD", "Lead", lead.id, null, lead);
    return res.status(201).json(lead);
  });

  app.patch("/api/leads/:id", requireAuth, requireTenantScope, requirePermission("write:lead"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getLead(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent && (before as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });
    const updated = await storage.updateLead(req.params.id as string, req.body, user.organizationId);
    await auditLog(req, "UPDATE_LEAD", "Lead", req.params.id as string, before, updated);
    return res.json(updated);
  });

  // ─── Notifications ─────────────────────────────────────────

  app.get("/api/notification-templates", requireAuth, requireTenantScope, requirePermission("read:notification"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getNotificationTemplates(user.organizationId));
  });

  app.post("/api/notification-templates", requireAuth, requireTenantScope, requirePermission("write:notification"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertNotificationTemplateSchema.parse({ ...req.body, organizationId: user.organizationId });
    const tmpl = await storage.createNotificationTemplate(parsed);
    await auditLog(req, "CREATE_NOTIFICATION_TEMPLATE", "NotificationTemplate", tmpl.id, null, tmpl);
    return res.status(201).json(tmpl);
  });

  app.put("/api/notification-templates/:id", requireAuth, requireTenantScope, requirePermission("write:notification"), async (req, res) => {
    const user = req.user as any;
    const { name, eventType, channel, subject, bodyTemplate, isActive } = req.body;
    const updated = await storage.updateNotificationTemplate(req.params.id as string, user.organizationId, {
      name, eventType, channel, subject, bodyTemplate, isActive,
    });
    if (!updated) return res.status(404).json({ message: "Template not found" });
    await auditLog(req, "UPDATE_NOTIFICATION_TEMPLATE", "NotificationTemplate", updated.id, null, updated);
    return res.json(updated);
  });

  app.delete("/api/notification-templates/:id", requireAuth, requireTenantScope, requirePermission("write:notification"), async (req, res) => {
    const user = req.user as any;
    await storage.deleteNotificationTemplate(req.params.id as string, user.organizationId);
    await auditLog(req, "DELETE_NOTIFICATION_TEMPLATE", "NotificationTemplate", req.params.id as string, null, null);
    return res.json({ success: true });
  });

  app.get("/api/notification-merge-tags", requireAuth, requireTenantScope, requirePermission("read:notification"), (_req, res) => {
    const { MERGE_TAGS, EVENT_TYPES } = require("./notifications");
    return res.json({ mergeTags: MERGE_TAGS, eventTypes: EVENT_TYPES });
  });

  app.post("/api/admin/notifications/broadcast", requireAuth, requireTenantScope, requirePermission("write:notification"), async (req, res) => {
    const user = req.user as any;
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ message: "Subject and body are required" });
    const { broadcastNotification } = require("./notifications");
    const sent = await broadcastNotification(user.organizationId, subject, body);
    await auditLog(req, "BROADCAST_NOTIFICATION", "Notification", undefined, null, { subject, sent });
    return res.json({ sent });
  });

  app.get("/api/payment-automation-settings", requireAuth, requireTenantScope, requirePermission("read:notification"), async (req, res) => {
    const user = req.user as any;
    const settings = await storage.getPaymentAutomationSettings(user.organizationId);
    return res.json(settings ?? {
      isEnabled: false,
      daysAfterLastPayment: 30,
      repeatEveryDays: 30,
      sendPushNotifications: true,
      autoRunPayments: true,
    });
  });

  app.put("/api/payment-automation-settings", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    const body = req.body || {};
    const updated = await storage.upsertPaymentAutomationSettings(user.organizationId, {
      isEnabled: body.isEnabled === true,
      daysAfterLastPayment: Math.max(1, Number(body.daysAfterLastPayment || 30)),
      repeatEveryDays: Math.max(1, Number(body.repeatEveryDays || 30)),
      sendPushNotifications: body.sendPushNotifications !== false,
      autoRunPayments: body.autoRunPayments !== false,
    });
    await auditLog(req, "UPDATE_PAYMENT_AUTOMATION_SETTINGS", "PaymentAutomationSettings", updated.id, null, updated);
    return res.json(updated);
  });

  app.get("/api/payment-automation-runs", requireAuth, requireTenantScope, requirePermission("read:notification"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    return res.json(await storage.getPaymentAutomationRuns(user.organizationId, limit));
  });

  app.post("/api/admin/run-payment-automation", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    const result = await runPaymentAutomationForOrg(user.organizationId);
    await auditLog(req, "RUN_PAYMENT_AUTOMATION", "PaymentAutomation", undefined, null, result);
    return res.json(result);
  });

  // ─── Expenditures ──────────────────────────────────────────

  app.get("/api/expenditures", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const filters = (fromDate || toDate) ? { fromDate, toDate } : undefined;
    return res.json(await storage.getExpenditures(user.organizationId, limit, offset, filters));
  });

  app.post("/api/expenditures", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertExpenditureSchema.parse({ ...req.body, organizationId: user.organizationId });
    const exp = await storage.createExpenditure(parsed);
    await auditLog(req, "CREATE_EXPENDITURE", "Expenditure", exp.id, null, exp);
    return res.status(201).json(exp);
  });

  // ─── Price Book ─────────────────────────────────────────────

  app.get("/api/price-book", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getPriceBookItems(user.organizationId));
  });

  app.post("/api/price-book", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertPriceBookItemSchema.parse({ ...req.body, organizationId: user.organizationId });
    const item = await storage.createPriceBookItem(parsed);
    await auditLog(req, "CREATE_PRICE_BOOK_ITEM", "PriceBookItem", item.id, null, item);
    return res.status(201).json(item);
  });

  // ─── Approvals (Maker-Checker) ──────────────────────────────

  app.get("/api/approvals", requireAuth, requireTenantScope, requirePermission("manage:approvals"), async (req, res) => {
    const user = req.user as any;
    const status = req.query.status as string | undefined;
    return res.json(await storage.getApprovalRequests(user.organizationId, status));
  });

  app.post("/api/approvals", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const parsed = insertApprovalRequestSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      initiatedBy: user.id,
      status: "pending",
    });
    const approval = await storage.createApprovalRequest(parsed);
    await auditLog(req, "CREATE_APPROVAL_REQUEST", "ApprovalRequest", approval.id, null, approval);
    return res.status(201).json(approval);
  });

  app.post("/api/approvals/:id/resolve", requireAuth, requireTenantScope, requirePermission("manage:approvals"), async (req, res) => {
    const user = req.user as any;
    const { action, rejectionReason } = req.body;
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    }
    const before = await storage.getApprovalRequests(user.organizationId);
    const approval = before.find(a => a.id === req.params.id as string);
    if (!approval) return res.status(404).json({ message: "Not found" });
    if (approval.initiatedBy === user.id) {
      return res.status(400).json({ message: "Cannot approve own request (maker-checker)" });
    }
    const updated = await storage.updateApprovalRequest(approval.id, {
      status: action === "approve" ? "approved" : "rejected",
      approvedBy: user.id,
      rejectionReason: rejectionReason || null,
    }, user.organizationId);
    await auditLog(req, `RESOLVE_APPROVAL_${action.toUpperCase()}`, "ApprovalRequest", approval.id, approval, updated);
    return res.json(updated);
  });

  // ─── Payroll ────────────────────────────────────────────────

  app.get("/api/payroll/employees", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);
    const offset = parseInt(req.query.offset as string) || 0;
    const rows = await storage.getPayrollEmployees(user.organizationId);
    return res.json(rows.slice(offset, offset + limit));
  });

  app.post("/api/payroll/employees", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertPayrollEmployeeSchema.parse({ ...req.body, organizationId: user.organizationId });
    const emp = await storage.createPayrollEmployee(parsed);
    return res.status(201).json(emp);
  });

  app.get("/api/payroll/runs", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const rows = await storage.getPayrollRuns(user.organizationId);
    return res.json(rows.slice(offset, offset + limit));
  });

  app.post("/api/payroll/runs", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertPayrollRunSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      preparedBy: user.id,
      status: "draft",
    });
    const run = await storage.createPayrollRun(parsed);
    await auditLog(req, "CREATE_PAYROLL_RUN", "PayrollRun", run.id, null, run);
    return res.status(201).json(run);
  });

  // ─── Security Questions (for client auth) ───────────────────

  app.get("/api/security-questions", requireAuth, async (req, res) => {
    const orgIdParam = typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
    if (orgIdParam) {
      return res.json(await storage.getSecurityQuestions(orgIdParam));
    }
    const orgs = await storage.getOrganizations();
    if (orgs.length > 0) {
      return res.json(await storage.getSecurityQuestions(orgs[0].id));
    }
    return res.json([]);
  });

  // ─── Agent Referral Links ─────────────────────────────────

  app.get("/api/agents/by-referral/:code", async (req, res) => {
    const code = String(req.params.code);
    const agent = await storage.getUserByReferralCode(code);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    return res.json({ name: agent.displayName || agent.email, referralCode: code });
  });

  // ─── Public tenant context (no auth required) ──────────────────
  // Returns the tenant the request is scoped to, based on subdomain/custom domain.
  // Used by the frontend to detect which tenant subdomain it's running on.
  app.get("/api/public/tenant-context", async (req, res) => {
    const tenantId = (req as any).tenantId as string | undefined;
    if (!tenantId) return res.json(null);
    try {
      const [row] = await cpDb
        .select({ id: cpTenants.id, name: cpTenants.name, slug: cpTenants.slug })
        .from(cpTenants)
        .where(eq(cpTenants.id, tenantId))
        .limit(1);
      if (!row) return res.json(null);
      return res.json(row);
    } catch {
      return res.json(null);
    }
  });

  // ─── Public branding (no auth required, for login/splash screens) ──
  app.get("/api/public/branding", async (req, res) => {
    const NEUTRAL = { name: "POL263", logoUrl: "/assets/logo.png", isWhitelabeled: false, primaryColor: "#0d9488" };
    const orgIdParam = typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
    // Fall back to subdomain-resolved tenant when no explicit orgId provided
    const orgId = orgIdParam || ((req as any).tenantId as string | undefined) || "";
    if (!orgId) {
      return res.json(NEUTRAL);
    }
    const org = await storage.getOrganization(orgId);
    if (!org || org.name?.endsWith("(deleted)")) return res.json(NEUTRAL);
    return res.json({
      name: org.name,
      logoUrl: org.logoUrl || "/assets/logo.png",
      primaryColor: org.primaryColor || "#0d9488",
      address: org.address,
      phone: org.phone,
      email: org.email,
      website: org.website,
      isWhitelabeled: org.isWhitelabeled,
    });
  });

  // ─── Public policy registration (from agent referral link) ──
  app.get("/api/public/registration-options", async (req, res) => {
    const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
    if (!ref) return res.status(400).json({ message: "Referral code (ref) required" });
    const agent = await storage.getUserByReferralCode(ref);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    if (!agent.organizationId) return res.status(400).json({ message: "Agent has no organization" });
    const orgId = agent.organizationId;
    const products = await storage.getProductsByOrg(orgId);
    const allVersions = await storage.getAllProductVersions(orgId);
    const versionsByProduct: Record<string, typeof allVersions> = {};
    for (const v of allVersions) {
      if (!versionsByProduct[v.productId]) versionsByProduct[v.productId] = [];
      versionsByProduct[v.productId].push(v);
    }
    const withVersions = products.filter((p) => p.isActive).map((p) => ({
      ...p,
      versions: (versionsByProduct[p.id] || []).filter((v) => v.isActive !== false),
    }));
    const branches = await storage.getBranchesByOrg(orgId);
    return res.json({
      agentName: agent.displayName || agent.email,
      referralCode: ref,
      products: withVersions,
      branches: branches.filter((b) => b.isActive),
    });
  });

  app.post("/api/public/register-policy", express.json(), async (req, res) => {
    const { referralCode, firstName, lastName, email, phone, dateOfBirth, nationalId, productVersionId, branchId, premiumAmount, currency, paymentSchedule, paymentMethod: rawPaymentMethod, dependents: rawDeps, beneficiary: rawBeneficiary } = req.body;
    const missingFields: string[] = [];
    if (!referralCode) missingFields.push("referralCode");
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!productVersionId) missingFields.push("productVersionId");
    if (missingFields.length > 0) {
      return res.status(400).json({ message: `Missing required fields: ${missingFields.join(", ")}` });
    }
    const nationalIdNorm = normalizeNationalId(nationalId);
    if (!nationalIdNorm) return res.status(400).json({ message: "National ID is required (format: digits + check letter + 2 digits, e.g. 08833089H38)." });
    if (!isValidNationalId(nationalId)) return res.status(400).json({ message: "National ID must be digits, one letter, then two digits (e.g. 08833089H38)." });
    if (!phone || !String(phone).trim()) return res.status(400).json({ message: "Phone is required." });
    if (!dateOfBirth) return res.status(400).json({ message: "Date of birth is required." });
    if (!req.body.gender) return res.status(400).json({ message: "Gender is required." });
    const agent = await storage.getUserByReferralCode(referralCode);
    if (!agent) return res.status(400).json({ message: "Invalid referral code" });
    if (!agent.organizationId) return res.status(400).json({ message: "Agent has no organization" });
    const orgId = agent.organizationId;
    const normalizedPaymentMethod = normalizePaymentMethodInput(rawPaymentMethod);
    const pv = await storage.getProductVersion(productVersionId, orgId);
    if (!pv) return res.status(400).json({ message: "Invalid product version" });
    const product = await storage.getProduct(pv.productId, orgId);
    if (!product) return res.status(400).json({ message: "Product not found" });
    const effectiveBranchId = branchId || agent.branchId || null;

    // Reuse existing client when identified by email or national ID (no duplicate clients)
    let client: Awaited<ReturnType<typeof storage.createClient>>;
    const emailTrim = email ? String(email).trim() : "";
    const nationalIdTrim = nationalIdNorm;
    let existing = emailTrim ? await storage.getClientByEmail(orgId, emailTrim) : undefined;
    if (!existing && nationalIdTrim) existing = await storage.getClientByNationalId(orgId, nationalIdTrim);
    if (existing) {
      client = existing;
      const updates: Record<string, unknown> = {};
      if (effectiveBranchId !== undefined) updates.branchId = effectiveBranchId;
      if (phone !== undefined) updates.phone = phone ? String(phone).trim() : null;
      if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth || null;
      if (nationalIdTrim) updates.nationalId = nationalIdTrim;
      if (!client.activationCode) {
        updates.activationCode = `ACT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      }
      if (!(client as any).agentId) updates.agentId = agent.id;
      if (Object.keys(updates).length > 0) {
        const updated = await storage.updateClient(client.id, updates, orgId);
        if (updated) client = updated;
      }
    } else {
      const activationCode = `ACT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const clientParsed = insertClientSchema.parse({
        organizationId: orgId,
        branchId: effectiveBranchId,
        firstName: toUpperTrim(firstName, false)!,
        lastName: toUpperTrim(lastName, false)!,
        email: emailTrim || null,
        phone: toUpperTrim(phone, false) || null,
        dateOfBirth: dateOfBirth || null,
        nationalId: nationalIdTrim,
        gender: req.body.gender ? toUpperTrim(req.body.gender, false) : null,
        activationCode,
        isEnrolled: false,
        agentId: agent.id,
      });
      client = await storage.createClient(clientParsed);
    }

    try {
      const policyNumber = await storage.generatePolicyNumber(orgId);
      const depsList = Array.isArray(rawDeps) ? rawDeps : [];
      const createdDeps: Awaited<ReturnType<typeof storage.createDependent>>[] = [];
      for (const d of depsList) {
        const dFirst = toUpperTrim(d.firstName, false);
        const dLast = toUpperTrim(d.lastName, false);
        const dRel = toUpperTrim(d.relationship, false);
        const dDob = d.dateOfBirth ? String(d.dateOfBirth).trim() : null;
        const dGender = d.gender ? toUpperTrim(d.gender, false) : null;
        const dNationalId = d.nationalId ? normalizeNationalId(d.nationalId) : null;
        if (!dFirst || !dLast) continue;
        if (!dRel) continue;
        if (!dDob) continue;
        if (!dGender) continue;
        if (dNationalId && !isValidNationalId(dNationalId)) continue;
        const dep = await storage.createDependent({
          organizationId: orgId,
          clientId: client.id,
          firstName: dFirst,
          lastName: dLast,
          relationship: dRel,
          dateOfBirth: dDob,
          nationalId: dNationalId || null,
          gender: dGender,
        });
        createdDeps.push(dep);
      }
      const premium = await computePolicyPremium(
        orgId,
        productVersionId,
        currency || "USD",
        paymentSchedule || "monthly",
        [],
        [],
        undefined,
        createdDeps.map((d) => d.dateOfBirth || null),
      );

      let ben = rawBeneficiary && rawBeneficiary.firstName && rawBeneficiary.lastName ? rawBeneficiary : null;
      if (ben) {
        const benFirst = toUpperTrim(ben.firstName, false);
        const benLast = toUpperTrim(ben.lastName, false);
        const benRel = toUpperTrim(ben.relationship, false);
        const benNationalId = ben.nationalId ? normalizeNationalId(ben.nationalId) : null;
        const benPhone = toUpperTrim(ben.phone, false);
        if (!benFirst || !benLast || !benRel || !benNationalId || !benPhone) ben = null;
        else if (!isValidNationalId(ben.nationalId)) ben = null;
        else {
          ben = { firstName: benFirst, lastName: benLast, relationship: benRel, nationalId: benNationalId, phone: benPhone };
        }
      }
      const policyParsed = insertPolicySchema.parse({
        organizationId: orgId,
        branchId: effectiveBranchId,
        policyNumber,
        clientId: client.id,
        productVersionId: pv.id,
        agentId: agent.id,
        status: "inactive",
        premiumAmount: premium,
        currency: currency || "USD",
        paymentSchedule: paymentSchedule || "monthly",
        effectiveDate: new Date().toISOString().split("T")[0],
        beneficiaryFirstName: ben?.firstName ? String(ben.firstName).trim() : null,
        beneficiaryLastName: ben?.lastName ? String(ben.lastName).trim() : null,
        beneficiaryRelationship: ben?.relationship ? String(ben.relationship).trim() : null,
        beneficiaryNationalId: ben?.nationalId ? String(ben.nationalId).trim() : null,
        beneficiaryPhone: ben?.phone ? String(ben.phone).trim() : null,
        beneficiaryDependentId: null,
      });
      const existingForClient = await storage.getPoliciesByClient(client.id, orgId);
      const duplicate = existingForClient.find(
        (p) => p.productVersionId === policyParsed.productVersionId && p.status !== "cancelled"
      );
      if (duplicate) {
        res.status(400).json({
          error: "Duplicate policy",
          message: "This client already has an active policy for this product.",
        });
        return;
      }
      const memberRows: Array<{ clientId?: string | null; dependentId?: string | null; role: string }> = [
        { clientId: client.id, role: "policy_holder" },
        ...createdDeps.map((dep) => ({ dependentId: dep.id, role: "dependent" as const })),
      ];
      const { policy } = await storage.createPolicyWithInitialSetup(orgId, {
        policy: policyParsed,
        statusHistory: {
          fromStatus: null,
          toStatus: "inactive",
          reason: "Registered via agent link",
          changedBy: null,
        },
        members: memberRows,
        addOnIds: [],
      });
      if (normalizedPaymentMethod) {
        await storage.upsertDefaultClientPaymentMethod(orgId, client.id, {
          organizationId: orgId,
          clientId: client.id,
          ...normalizedPaymentMethod,
          isDefault: true,
          isActive: true,
        } as any);
      }
      const lead = await storage.createLead({
        organizationId: orgId,
        branchId: effectiveBranchId || undefined,
        agentId: agent.id,
        clientId: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone || undefined,
        email: client.email || undefined,
        source: "agent_link",
        stage: "lead",
      });
      return res.status(201).json({
        policyNumber: policy.policyNumber,
        activationCode: client.activationCode,
        clientId: client.id,
        message: "Policy registered. Use your policy number and activation code to claim your account, then sign in.",
      });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", details: e.errors });
      throw e;
    }
  });

  // ─── Groups ──────────────────────────────────────────────

  app.get("/api/groups", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getGroupsByOrg(user.organizationId));
  });

  app.post("/api/groups", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertGroupSchema.parse({ ...req.body, organizationId: user.organizationId });
    const group = await storage.createGroup(parsed);
    await auditLog(req, "CREATE_GROUP", "Group", group.id, null, group);
    return res.status(201).json(group);
  });

  app.patch("/api/groups/:id", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const id = String(req.params.id);
    const user = req.user as any;
    const existing = await storage.getGroup(id, user.organizationId);
    if (!existing) return res.status(404).json({ error: "Group not found" });
    if (existing.organizationId !== user.organizationId) return res.status(403).json({ error: "Forbidden" });
    const updated = await storage.updateGroup(id, req.body, user.organizationId);
    await auditLog(req, "UPDATE_GROUP", "Group", id, existing, updated);
    return res.json(updated);
  });

  app.get("/api/groups/:id/policies", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const groupId = String(req.params.id);
    const group = await storage.getGroup(groupId, user.organizationId);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const policiesList = await storage.getPoliciesByGroupId(user.organizationId, groupId);
    const enriched = await Promise.all(
      policiesList.map(async (p) => {
        const client = p.clientId ? await storage.getClient(p.clientId, user.organizationId) : null;
        return {
          ...p,
          clientFirstName: client?.firstName || null,
          clientLastName: client?.lastName || null,
          clientPhone: client?.phone || null,
          clientNationalId: client?.nationalId || null,
        };
      })
    );
    return res.json(enriched);
  });

  // ─── Platform Revenue Share ──────────────────────────────

  app.get("/api/platform/receivables", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(String(req.query.limit) || "100", 10) || 100, 500);
    const offset = parseInt(String(req.query.offset) || "0");
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const filters = (fromDate || toDate) ? { fromDate, toDate } : undefined;
    return res.json(await storage.getPlatformReceivables(user.organizationId, limit, offset, filters));
  });

  app.get("/api/platform/summary", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getPlatformRevenueSummary(user.organizationId));
  });

  app.get("/api/settlements", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const rows = await storage.getSettlements(user.organizationId);
    return res.json(rows.slice(offset, offset + limit));
  });

  app.post("/api/settlements", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertSettlementSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      initiatedBy: user.id,
      status: "pending",
    });
    const settlement = await storage.createSettlement(parsed);
    await auditLog(req, "CREATE_SETTLEMENT", "Settlement", settlement.id, null, settlement);
    return res.status(201).json(settlement);
  });

  app.post("/api/settlements/:id/approve", requireAuth, requireTenantScope, requirePermission("manage:approvals"), async (req, res) => {
    const id = String(req.params.id);
    const user = req.user as any;
    const existing = await storage.getSettlements(user.organizationId);
    const settlement = existing.find(s => s.id === id);
    if (!settlement) return res.status(404).json({ error: "Settlement not found" });
    if (settlement.initiatedBy === user.id) return res.status(400).json({ error: "Cannot approve own settlement" });
    const updated = await storage.updateSettlement(id, { status: "approved", approvedBy: user.id }, user.organizationId);
    await auditLog(req, "APPROVE_SETTLEMENT", "Settlement", id, settlement, updated);
    return res.json(updated);
  });

  // ─── Cost Sheets ────────────────────────────────────────

  app.get("/api/cost-sheets", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getCostSheetsByOrg(user.organizationId));
  });

  app.post("/api/cost-sheets", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const data = { ...req.body, organizationId: user.organizationId };
    const cs = await storage.createCostSheet(data);
    await auditLog(req, "CREATE_COST_SHEET", "CostSheet", cs.id, null, cs);
    return res.status(201).json(cs);
  });

  app.get("/api/cost-sheets/:id/items", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const id = String(req.params.id);
    return res.json(await storage.getCostLineItems(id, user.organizationId));
  });

  app.post("/api/cost-sheets/:id/items", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const costSheetId = String(req.params.id);
    const item = await storage.createCostLineItem({ ...req.body, costSheetId });
    return res.status(201).json(item);
  });

  // ─── Staff: Client Feedback ──────────────────────────────────
  app.get("/api/feedback", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const result = await storage.getFeedbackByOrg(user.organizationId, limit, offset, { search, status, type });
    return res.json(result);
  });

  app.patch("/api/feedback/:id/status", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const status = typeof req.body.status === "string" ? req.body.status : "";
    if (!["open", "acknowledged", "in_progress", "resolved", "closed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be one of: open, acknowledged, in_progress, resolved, closed" });
    }
    const updated = await storage.updateFeedbackStatus(req.params.id as string, status, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Feedback not found" });
    await auditLog(req, "UPDATE_FEEDBACK_STATUS", "ClientFeedback", updated.id, null, { status });
    return res.json(updated);
  });

  // ─── Diagnostics ────────────────────────────────────────

  app.get("/api/diagnostics", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const stats = await storage.getDashboardStats(user.organizationId, undefined, isAgent ? user.id : undefined);
    const unallocated = await storage.getPaymentsByOrg(user.organizationId, 100, 0);
    const unallocatedPayments = unallocated.filter((p: any) => !p.policyId);
    return res.json({
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      tableCounts: stats,
      unallocatedPayments: unallocatedPayments.length,
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Enhanced Dashboard Stats ───────────────────────────

  app.get("/api/dashboard/revenue-trend", requireAuth, requireTenantScope, async (req, res) => {
    res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    let payments: any[];
    if (isAgent) {
      const agentPolicyIds = new Set((await storage.getPoliciesByAgent(user.id, user.organizationId)).map((p) => p.id));
      const allPayments = await storage.getPaymentsByOrg(user.organizationId, 5000, 0);
      payments = allPayments.filter((p: any) => p.policyId && agentPolicyIds.has(p.policyId));
    } else {
      payments = await storage.getPaymentsByOrg(user.organizationId, 5000, 0);
    }
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
    const cleared = payments.filter((p: any) => {
      if (p.status !== "cleared") return false;
      const day = new Date(p.receivedAt || p.createdAt).toISOString().slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
    const daily: Record<string, number> = {};
    cleared.forEach((p: any) => {
      const day = new Date(p.receivedAt || p.createdAt).toISOString().slice(0, 10);
      daily[day] = (daily[day] || 0) + parseFloat(p.amount || "0");
    });
    const trend = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total }));
    return res.json(trend);
  });

  app.get("/api/dashboard/policy-status-breakdown", requireAuth, requireTenantScope, async (req, res) => {
    res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const allPolicies = isAgent
      ? await storage.getPoliciesByAgent(user.id, user.organizationId)
      : await storage.getPoliciesByOrg(user.organizationId, DASHBOARD_MAX_ROWS, 0);
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const breakdown: Record<string, number> = {};
    allPolicies.forEach((p: any) => {
      if (dateFrom && p.createdAt && new Date(p.createdAt).toISOString().slice(0, 10) < dateFrom) return;
      if (dateTo && p.createdAt && new Date(p.createdAt).toISOString().slice(0, 10) > dateTo) return;
      if (branchId && branchId !== "all" && p.branchId !== branchId) return;
      breakdown[p.status] = (breakdown[p.status] || 0) + 1;
    });
    return res.json(breakdown);
  });

  app.get("/api/dashboard/lead-funnel", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const allLeads = isAgent
      ? await storage.getLeadsByAgent(user.id, user.organizationId)
      : await storage.getLeadsByOrg(user.organizationId, DASHBOARD_MAX_ROWS, 0);
    const stages: Record<string, number> = {};
    allLeads.forEach((l: any) => {
      stages[l.stage] = (stages[l.stage] || 0) + 1;
    });
    return res.json(stages);
  });

  app.get("/api/dashboard/covered-lives", requireAuth, requireTenantScope, async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent) {
      const agentPolicies = await storage.getPoliciesByAgent(user.id, user.organizationId);
      const activePolicies = agentPolicies.filter((p: any) => p.status === "active");
      const policyIds = activePolicies.map(p => p.id);
      const membersByPolicy = await storage.getPolicyMembersBatch(policyIds, user.organizationId);
      let coveredLives = 0;
      for (const pid of policyIds) coveredLives += (membersByPolicy[pid] || []).length;
      return res.json({ coveredLives, activePolicyCount: activePolicies.length });
    }
    const result = await storage.countCoveredLives(user.organizationId);
    return res.json(result);
  });

  app.get("/api/dashboard/product-performance", requireAuth, requireTenantScope, async (req, res) => {
    res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const allProducts = await storage.getProductsByOrg(user.organizationId);
    const allPolicies = isAgent
      ? await storage.getPoliciesByAgent(user.id, user.organizationId)
      : await storage.getPoliciesByOrg(user.organizationId, DASHBOARD_MAX_ROWS, 0);
    const allPaymentsRaw = await storage.getPaymentsByOrg(user.organizationId, DASHBOARD_MAX_ROWS, 0);
    const allPayments = isAgent
      ? allPaymentsRaw.filter((p: any) => p.policyId && allPolicies.some((pol: any) => pol.id === p.policyId))
      : allPaymentsRaw;

    const pvToProductId: Record<string, string> = {};
    const allVersions = await storage.getAllProductVersions(user.organizationId);
    for (const v of allVersions) pvToProductId[v.id] = v.productId;
    const policyByProduct: Record<string, { total: number; active: number; lapsed: number }> = {};
    allPolicies.forEach((p: any) => {
      const pid = pvToProductId[p.productVersionId] || "unknown";
      if (!policyByProduct[pid]) policyByProduct[pid] = { total: 0, active: 0, lapsed: 0 };
      policyByProduct[pid].total++;
      if (p.status === "active") policyByProduct[pid].active++;
      if (p.status === "lapsed") policyByProduct[pid].lapsed++;
    });

    const revenueByProduct: Record<string, number> = {};
    const currencyByProduct: Record<string, string> = {};
    allPayments.filter((p: any) => p.status === "cleared").forEach((p: any) => {
      const pol = allPolicies.find((pol: any) => pol.id === p.policyId);
      const pid = pol ? (pvToProductId[pol.productVersionId] || "unknown") : "unknown";
      revenueByProduct[pid] = (revenueByProduct[pid] || 0) + parseFloat(p.amount || "0");
      if (p.currency && !currencyByProduct[pid]) currencyByProduct[pid] = p.currency;
    });

    const performance = allProducts.map((prod: any) => ({
      id: prod.id,
      name: prod.name,
      totalPolicies: policyByProduct[prod.id]?.total || 0,
      activePolicies: policyByProduct[prod.id]?.active || 0,
      lapsedPolicies: policyByProduct[prod.id]?.lapsed || 0,
      revenue: revenueByProduct[prod.id] || 0,
      currency: currencyByProduct[prod.id] || "USD",
    }));

    return res.json(performance);
  });

  app.get("/api/dashboard/lapse-retention", requireAuth, requireTenantScope, async (req, res) => {
    res.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    const allPolicies = isAgent
      ? await storage.getPoliciesByAgent(user.id, user.organizationId)
      : await storage.getPoliciesByOrg(user.organizationId, DASHBOARD_MAX_ROWS, 0);
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const filtered = allPolicies.filter((p: any) => {
      if (dateFrom && p.createdAt && new Date(p.createdAt).toISOString().slice(0, 10) < dateFrom) return false;
      if (dateTo && p.createdAt && new Date(p.createdAt).toISOString().slice(0, 10) > dateTo) return false;
      if (branchId && branchId !== "all" && p.branchId !== branchId) return false;
      return true;
    });
    const total = filtered.length;
    const active = filtered.filter((p: any) => p.status === "active").length;
    const lapsed = filtered.filter((p: any) => p.status === "lapsed").length;
    const grace = filtered.filter((p: any) => p.status === "grace").length;
    const cancelled = filtered.filter((p: any) => p.status === "cancelled").length;
    const retentionRate = total > 0 ? ((active / total) * 100).toFixed(1) : "0";
    const lapseRate = total > 0 ? ((lapsed / total) * 100).toFixed(1) : "0";
    return res.json({ total, active, lapsed, grace, cancelled, retentionRate, lapseRate });
  });

  // ─── Terms & Conditions ──────────────────────────────────

  app.get("/api/terms", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const all = req.query.all === "true";
    const pvId = req.query.productVersionId as string | undefined;
    if (pvId) {
      const terms = await storage.getTermsByProductVersion(pvId, user.organizationId);
      return res.json(terms);
    }
    const terms = all
      ? await storage.getTermsByOrgAll(user.organizationId)
      : await storage.getTermsByOrg(user.organizationId);
    return res.json(terms);
  });

  app.post("/api/terms", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertTermsSchema.parse({ ...req.body, organizationId: user.organizationId });
    const created = await storage.createTerms(parsed);
    return res.status(201).json(created);
  });

  app.patch("/api/terms/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const updated = await storage.updateTerms(req.params.id as string, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  });

  app.delete("/api/terms/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    await storage.deleteTerms(req.params.id as string, user.organizationId);
    return res.status(204).send();
  });

  registerPolicyDocumentRoute(app);

  // ─── Reports CSV Export ────────────────────────────────────

  const parseReportFilters = (q: any) => {
    const fromDate = typeof q.fromDate === "string" && q.fromDate ? q.fromDate : undefined;
    const toDate = typeof q.toDate === "string" && q.toDate ? q.toDate : undefined;
    const userId = typeof q.userId === "string" && q.userId ? q.userId : undefined;
    const branchId = typeof q.branchId === "string" && q.branchId ? q.branchId : undefined;
    const productId = typeof q.productId === "string" && q.productId ? q.productId : undefined;
    const agentId = typeof q.agentId === "string" && q.agentId ? q.agentId : undefined;
    const status = typeof q.status === "string" && q.status ? q.status : undefined;
    const statuses = Array.isArray(q.statuses) ? q.statuses.filter((s: unknown) => typeof s === "string") : undefined;
    return { fromDate, toDate, userId, branchId, productId, agentId, status, statuses };
  };

  app.get("/api/reports/policy-details", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, REPORT_EXPORT_MAX_ROWS);
    const offset = parseInt(String(req.query.offset)) || 0;
    const rows = await storage.getPolicyReportByOrg(user.organizationId, limit, offset, filters);
    const clientIds = Array.from(new Set(rows.map((r) => r.clientId).filter(Boolean)));
    const depsByClient: Record<string, { firstName: string; lastName: string; nationalId: string | null; dateOfBirth: string | null; gender: string | null; relationship: string }[]> = {};
    await Promise.all(clientIds.map(async (cid) => {
      const deps = await storage.getDependentsByClient(cid, user.organizationId);
      depsByClient[cid] = deps.map((d: any) => ({ firstName: d.firstName, lastName: d.lastName, nationalId: d.nationalId ?? null, dateOfBirth: d.dateOfBirth ?? null, gender: d.gender ?? null, relationship: d.relationship }));
    }));
    const enriched = rows.map((r) => ({ ...r, dependents: depsByClient[r.clientId] || [] }));
    return res.json(enriched);
  });

  app.get("/api/reports/finance", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, REPORT_EXPORT_MAX_ROWS);
    const offset = parseInt(String(req.query.offset)) || 0;
    const rows = await storage.getFinanceReportByOrg(user.organizationId, limit, offset, filters);
    return res.json(rows);
  });

  app.get("/api/reports/underwriter-payable", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, REPORT_EXPORT_MAX_ROWS);
    const offset = parseInt(String(req.query.offset)) || 0;
    const result = await storage.getUnderwriterPayableReport(user.organizationId, limit, offset, filters);
    return res.json(result);
  });

  app.get("/api/reports/reinstatements", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const list = await storage.getReinstatementHistory(user.organizationId, filters);
    return res.json(list);
  });

  app.get("/api/reports/conversions", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getConversionHistory(user.organizationId, filters));
  });

  app.get("/api/reports/activations", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getActivationHistory(user.organizationId, filters));
  });
  app.get("/api/reports/active-policies", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...filters, status: "active" }));
  });
  app.get("/api/reports/awaiting-payments", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...filters, statuses: ["active", "grace"] }));
  });
  app.get("/api/reports/overdue", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...filters, status: "grace" }));
  });
  app.get("/api/reports/pre-lapse", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...filters, status: "grace" }));
  });
  app.get("/api/reports/lapsed", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...filters, status: "lapsed" }));
  });
  app.get("/api/reports/issued-policies", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, REPORT_EXPORT_MAX_ROWS);
    const offset = parseInt(String(req.query.offset)) || 0;
    return res.json(await storage.getNewJoiningsReportByOrg(user.organizationId, limit, offset, filters));
  });
  app.get("/api/reports/new-joinings", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, REPORT_EXPORT_MAX_ROWS);
    const offset = parseInt(String(req.query.offset)) || 0;
    return res.json(await storage.getNewJoiningsReportByOrg(user.organizationId, limit, offset, filters));
  });
  app.get("/api/reports/agent-productivity", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, REPORT_EXPORT_MAX_ROWS);
    const offset = parseInt(String(req.query.offset)) || 0;
    return res.json(await storage.getAgentProductivityReportByOrg(user.organizationId, limit, offset, filters));
  });
  app.get("/api/reports/cashups", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const preparedBy = filters.agentId ?? filters.userId;
    return res.json(await storage.getCashups(user.organizationId, REPORT_EXPORT_MAX_ROWS, { ...filters, preparedBy }));
  });

  app.get("/api/reports/receipts", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, REPORT_EXPORT_MAX_ROWS);
    const offset = parseInt(String(req.query.offset)) || 0;
    return res.json(await storage.getReceiptReportByOrg(user.organizationId, limit, offset, filters));
  });
  app.get("/api/reports/commissions-summary", requireAuth, requireTenantScope, requirePermission("read:commission"), async (req, res) => {
    const user = req.user as any;
    const filters = await enforceAgentScope(req, parseReportFilters(req.query));
    return res.json(await storage.getCommissionReportByOrg(user.organizationId, filters));
  });

  app.get("/api/reports/export/:type", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const reportType = req.params.type as string;
    const reportFilters = await enforceAgentScope(req, parseReportFilters(req.query));

    const CURRENCIES = ["USD", "ZAR", "ZIG"] as const;
    const currencyHeaders = (label: string) => CURRENCIES.map(c => `${label} (${c})`);
    const currencyAmounts = (amount: any, currency: string) => {
      const num = parseFloat(String(amount ?? 0)) || 0;
      const norm = (currency || "USD").toUpperCase();
      return CURRENCIES.map(c => c === norm ? num.toFixed(2) : "");
    };

    try {
      let rows: any[] = [];
      let headers: string[] = [];
      let currencyTotals: Record<string, Record<string, number>> | null = null;

      switch (reportType) {
        case "policies": {
          const polRaw = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Policy Number", "Status", "Currency", "Premium", ...currencyHeaders("Premium"), "Payment Schedule", "Created"];
          currencyTotals = { Premium: {} };
          rows = polRaw.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.premiumAmount ?? 0)) || 0;
            currencyTotals!.Premium[c] = (currencyTotals!.Premium[c] || 0) + amt;
            return [r.policyNumber, r.status, r.currency, r.premiumAmount, ...currencyAmounts(r.premiumAmount, r.currency), r.paymentSchedule, r.createdAt];
          });
          break;
        }
        case "policy-details": {
          const reportRows = await storage.getPolicyReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          const clientIds = Array.from(new Set(reportRows.map((r) => r.clientId).filter(Boolean)));
          const depsByClient: Record<string, any[]> = {};
          await Promise.all(clientIds.map(async (cid) => {
            const deps = await storage.getDependentsByClient(cid, user.organizationId);
            depsByClient[cid] = deps;
          }));
          const maxDeps = Math.max(1, ...Object.values(depsByClient).map((d) => d.length));
          const depHeaders: string[] = [];
          for (let i = 1; i <= maxDeps; i++) {
            depHeaders.push(`Dependent ${i} Name`, `Dependent ${i} National ID`, `Dependent ${i} DOB`, `Dependent ${i} Gender`, `Dependent ${i} Relationship`);
          }
          headers = [
            "Branch", "Member No", "Policy Number", "National ID", "First Name", "Surname", "Full Name",
            "Address", "Location", "Phone", "Email", "Date of Birth", "Gender", "Marital Status",
            "Product Name", "Product Code", "Cover Amount", "Cover Currency",
            "Inception Date", "Effective Date", "Cover Date", "Premium", "Currency", "Payment Schedule",
            "Status", "Capture Date", "Current Cycle Start", "Current Cycle End", "Grace End",
            "Group", "Agent Name", "Agent Email",
            "Beneficiary Name", "Beneficiary National ID", "Beneficiary Phone", "Beneficiary Relationship",
            ...depHeaders,
          ];
          rows = reportRows.map((r: any) => {
            const deps = depsByClient[r.clientId] || [];
            const depCols: string[] = [];
            for (let i = 0; i < maxDeps; i++) {
              const d = deps[i];
              depCols.push(
                d ? `${d.firstName} ${d.lastName}` : "",
                d?.nationalId ?? "",
                d?.dateOfBirth ?? "",
                d?.gender ?? "",
                d?.relationship ?? "",
              );
            }
            return [
              r.branchName ?? "", r.memberNumber ?? "", r.policyNumber, r.clientNationalId ?? "",
              r.clientFirstName, r.clientLastName, [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" "),
              r.clientAddress ?? "", r.clientLocation ?? "", r.clientPhone ?? "", r.clientEmail ?? "",
              r.clientDateOfBirth ?? "", r.clientGender ?? "", r.clientMaritalStatus ?? "",
              r.productName ?? "", r.productCode ?? "", r.coverAmount ?? "", r.coverCurrency ?? "",
              r.inceptionDate ?? "", r.effectiveDate ?? "", r.waitingPeriodEndDate ?? "",
              r.premiumAmount, r.currency, r.paymentSchedule,
              r.status, r.policyCreatedAt ?? "", r.currentCycleStart ?? "", r.currentCycleEnd ?? "", r.graceEndDate ?? "",
              r.groupName ?? "", r.agentDisplayName ?? "", r.agentEmail ?? "",
              [r.beneficiaryFirstName, r.beneficiaryLastName].filter(Boolean).join(" ") || "",
              r.beneficiaryNationalId ?? "", r.beneficiaryPhone ?? "", r.beneficiaryRelationship ?? "",
              ...depCols,
            ];
          });
          break;
        }
        case "finance": {
          const reportRows = await storage.getFinanceReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = [
            "Policy Number", "Status", "Currency", "Premium", ...currencyHeaders("Premium"),
            "Capture Date", "Inception Date", "Cover Date", "Due Date", "Date Paid", "Receipt Count", "Months Paid", "Grace Days Used", "Grace Days Remaining",
            "Outstanding Premium", ...currencyHeaders("Outstanding"),
            "Advance Premium",
            "Client Name", "Product", "Product Code", "Branch", "Group", "Agent",
          ];
          currencyTotals = { Premium: {}, Outstanding: {} };
          rows = reportRows.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const prem = parseFloat(String(r.premiumAmount ?? 0)) || 0;
            const outstanding = parseFloat(String(r.outstandingPremium ?? 0)) || 0;
            currencyTotals!.Premium[c] = (currencyTotals!.Premium[c] || 0) + prem;
            if (outstanding > 0) currencyTotals!.Outstanding[c] = (currencyTotals!.Outstanding[c] || 0) + outstanding;
            return [
              r.policyNumber, r.status, r.currency, r.premiumAmount, ...currencyAmounts(r.premiumAmount, r.currency),
              r.policyCreatedAt ?? "", r.inceptionDate ?? "", r.waitingPeriodEndDate ?? "", r.dueDate ?? "", r.datePaid ?? "", r.receiptCount, r.monthsPaid, r.graceDaysUsed, r.graceDaysRemaining ?? "",
              r.outstandingPremium, ...currencyAmounts(r.outstandingPremium, r.currency),
              r.advancePremium,
              [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" "), r.productName ?? "", r.productCode ?? "", r.branchName ?? "", r.groupName ?? "", r.agentDisplayName ?? r.agentEmail ?? "",
            ];
          });
          break;
        }
        case "underwriter-payable": {
          const result = await storage.getUnderwriterPayableReport(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = [
            "Policy Number", "Status", "Currency", "Client First Name", "Client Last Name", "Client Phone", "Client Email", "Product Name", "Product Code", "Branch",
            "Adults", "Children", "Underwriter Amount Adult", "Underwriter Amount Child", "Advance Months",
            "Monthly Payable", ...currencyHeaders("Monthly Payable"),
            "Total Payable", ...currencyHeaders("Total Payable"),
          ];
          currencyTotals = { "Monthly Payable": {}, "Total Payable": {} };
          rows = result.rows.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            currencyTotals!["Monthly Payable"][c] = (currencyTotals!["Monthly Payable"][c] || 0) + (r.monthlyPayable || 0);
            currencyTotals!["Total Payable"][c] = (currencyTotals!["Total Payable"][c] || 0) + (r.totalPayable || 0);
            return [
              r.policyNumber, r.status, r.currency || "USD", r.clientFirstName ?? "", r.clientLastName ?? "", r.clientPhone ?? "", r.clientEmail ?? "",
              r.productName ?? "", r.productCode ?? "", r.branchName ?? "",
              r.adults, r.children, r.underwriterAmountAdult ?? "", r.underwriterAmountChild ?? "", r.underwriterAdvanceMonths,
              r.monthlyPayable.toFixed(2), ...currencyAmounts(r.monthlyPayable, r.currency),
              r.totalPayable.toFixed(2), ...currencyAmounts(r.totalPayable, r.currency),
            ];
          });
          break;
        }
        case "claims": {
          const claimRaw = await storage.getClaimsByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Claim Number", "Type", "Status", "Currency", "Approved Amount", ...currencyHeaders("Approved"), "Deceased Name", "Created"];
          currencyTotals = { Approved: {} };
          rows = claimRaw.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.approvedAmount ?? 0)) || 0;
            if (amt > 0) currencyTotals!.Approved[c] = (currencyTotals!.Approved[c] || 0) + amt;
            return [r.claimNumber, r.claimType, r.status, r.currency || "USD", r.approvedAmount ?? "", ...currencyAmounts(r.approvedAmount, r.currency), r.deceasedName || "", r.createdAt];
          });
          break;
        }
        case "payments": {
          const payRaw = await storage.getPaymentsByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Reference", "Amount", "Currency", ...currencyHeaders("Amount"), "Method", "Status", "Received At"];
          currencyTotals = { Amount: {} };
          rows = payRaw.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.amount ?? 0)) || 0;
            currencyTotals!.Amount[c] = (currencyTotals!.Amount[c] || 0) + amt;
            return [r.reference || "", r.amount, r.currency, ...currencyAmounts(r.amount, r.currency), r.paymentMethod, r.status, r.receivedAt];
          });
          break;
        }
        case "funerals": {
          const cases = await storage.getFuneralCasesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Case Number", "Deceased Name", "Status", "Funeral Date"];
          rows = cases.map((r: any) => [r.caseNumber, r.deceasedName, r.status, r.funeralDate || ""]);
          break;
        }
        case "fleet": {
          const vehicles = await storage.getFleetVehicles(user.organizationId);
          headers = ["Registration", "Make", "Model", "Year", "Status", "Mileage"];
          rows = vehicles.map((r: any) => [r.registration, r.make, r.model, r.year, r.status, r.currentMileage || ""]);
          break;
        }
        case "expenditures": {
          const exps = await storage.getExpenditures(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Description", "Category", "Amount", "Currency", ...currencyHeaders("Amount"), "Date", "Receipt Ref"];
          currencyTotals = { Amount: {} };
          rows = exps.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.amount ?? 0)) || 0;
            currencyTotals!.Amount[c] = (currencyTotals!.Amount[c] || 0) + amt;
            return [r.description, r.category, r.amount, r.currency, ...currencyAmounts(r.amount, r.currency), r.spentAt || r.createdAt, r.receiptRef || ""];
          });
          break;
        }
        case "payroll": {
          const employees = await storage.getPayrollEmployees(user.organizationId);
          headers = ["Employee Name", "ID Number", "Position", "Department", "Currency", "Basic Salary", ...currencyHeaders("Salary"), "Status"];
          currencyTotals = { Salary: {} };
          rows = employees.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.basicSalary ?? 0)) || 0;
            currencyTotals!.Salary[c] = (currencyTotals!.Salary[c] || 0) + amt;
            return [r.employeeName, r.idNumber, r.position, r.department, r.currency || "USD", r.basicSalary, ...currencyAmounts(r.basicSalary, r.currency), r.status];
          });
          break;
        }
        case "commissions": {
          const ledgerMode = String(req.query.mode ?? "") === "ledger";
          const agentFilter = typeof req.query.agentId === "string" ? req.query.agentId : null;
          if (ledgerMode && agentFilter) {
            const ledger = await storage.getCommissionLedgerByAgent(agentFilter, user.organizationId);
            headers = ["Agent ID", "Entry Type", "Amount", "Currency", ...currencyHeaders("Amount"), "Description", "Period Start", "Period End", "Status", "Created"];
            currencyTotals = { Amount: {} };
            rows = ledger.map((r: any) => {
              const c = (r.currency || "USD").toUpperCase();
              const amt = parseFloat(String(r.amount ?? 0)) || 0;
              currencyTotals!.Amount[c] = (currencyTotals!.Amount[c] || 0) + amt;
              return [r.agentId, r.entryType, r.amount, r.currency, ...currencyAmounts(r.amount, r.currency), r.description || "", r.periodStart || "", r.periodEnd || "", r.status, r.createdAt];
            });
          } else {
            const payrollRows = await storage.getCommissionReportByOrg(user.organizationId, reportFilters);
            headers = [
              "AGENT NAME",
              "",
              "NUMBER OF POLICIES",
              "Groups",
              "Groups",
              "individ",
              "Individ",
              "Investm",
              "Clawb",
              "Call Cen",
              "Trips",
              "Cash se",
              "Basic",
              "Overtim",
              "TOTAL",
              "PA",
              "TAX LE",
              "CRED",
              "ADVAN",
              "POLICY DEDUCTI",
              "MEDICAL AID DEDUCTI",
              "UNPAID M",
              "NET P",
            ];
            currencyTotals = null;
            rows = payrollRows.map((r: any) => [
              r.agentName,
              "",
              r.numberOfPolicies,
              r.groupsCount,
              r.groupsCommission,
              r.individualsCount,
              r.individualsCommission,
              r.investment,
              r.clawback,
              r.callCenter,
              r.trips,
              r.cashSettlement,
              r.basic,
              r.overtime,
              r.total,
              r.paye,
              r.taxLevy,
              r.credit,
              r.advance,
              r.policyDeduction,
              r.medicalAidDeduction,
              r.unpaidMonths,
              r.netPay,
            ]);
          }
          break;
        }
        case "platform": {
          const receivables = await storage.getPlatformReceivables(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Description", "Amount", "Currency", ...currencyHeaders("Amount"), "Settled", "Created"];
          currencyTotals = { Amount: {} };
          rows = receivables.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.amount ?? 0)) || 0;
            currencyTotals!.Amount[c] = (currencyTotals!.Amount[c] || 0) + amt;
            return [r.description, r.amount, r.currency, ...currencyAmounts(r.amount, r.currency), r.isSettled ? "Yes" : "No", r.createdAt];
          });
          break;
        }
        case "reinstatements": {
          const reinstatements = await storage.getReinstatementHistory(user.organizationId, reportFilters);
          headers = ["Policy Number", "Client", "Previous Status", "Reinstated At", "Reason", "Current Status"];
          rows = reinstatements.map((r: any) => [r.policyNumber, r.clientName, r.fromStatus || "", r.reinstatedAt, r.reason || "", r.currentStatus]);
          break;
        }
        case "conversions": {
          const conversions = await storage.getConversionHistory(user.organizationId, reportFilters);
          headers = ["Policy Number", "Client", "Converted At", "Reason", "Current Status"];
          rows = conversions.map((r: any) => [r.policyNumber, r.clientName, r.convertedAt, r.reason || "", r.currentStatus]);
          break;
        }
        case "activations": {
          const activations = await storage.getActivationHistory(user.organizationId, reportFilters);
          headers = ["Policy Number", "Client", "Previous Status", "Activated At", "Reason", "Current Status"];
          rows = activations.map((r: any) => [r.policyNumber, r.clientName, r.fromStatus || "", r.activatedAt, r.reason || "", r.currentStatus]);
          break;
        }
        case "active-policies": {
          const active = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, status: "active" });
          headers = ["Policy Number", "Status", "Currency", "Premium", ...currencyHeaders("Premium"), "Payment Schedule", "Created"];
          currencyTotals = { Premium: {} };
          rows = active.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.premiumAmount ?? 0)) || 0;
            currencyTotals!.Premium[c] = (currencyTotals!.Premium[c] || 0) + amt;
            return [r.policyNumber, r.status, r.currency, r.premiumAmount, ...currencyAmounts(r.premiumAmount, r.currency), r.paymentSchedule, r.createdAt];
          });
          break;
        }
        case "awaiting-payments": {
          const awaiting = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, statuses: ["active", "grace"] });
          headers = ["Policy Number", "Status", "Currency", "Premium", ...currencyHeaders("Premium"), "Payment Schedule", "Created"];
          currencyTotals = { Premium: {} };
          rows = awaiting.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.premiumAmount ?? 0)) || 0;
            currencyTotals!.Premium[c] = (currencyTotals!.Premium[c] || 0) + amt;
            return [r.policyNumber, r.status, r.currency, r.premiumAmount, ...currencyAmounts(r.premiumAmount, r.currency), r.paymentSchedule, r.createdAt];
          });
          break;
        }
        case "overdue":
        case "pre-lapse": {
          const grace = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, status: "grace" });
          headers = ["Policy Number", "Status", "Currency", "Premium", ...currencyHeaders("Premium"), "Grace End Date", "Created"];
          currencyTotals = { Premium: {} };
          rows = grace.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.premiumAmount ?? 0)) || 0;
            currencyTotals!.Premium[c] = (currencyTotals!.Premium[c] || 0) + amt;
            return [r.policyNumber, r.status, r.currency, r.premiumAmount, ...currencyAmounts(r.premiumAmount, r.currency), r.graceEndDate || "", r.createdAt];
          });
          break;
        }
        case "lapsed": {
          const lapsed = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, status: "lapsed" });
          headers = ["Policy Number", "Status", "Currency", "Premium", ...currencyHeaders("Premium"), "Payment Schedule", "Created"];
          currencyTotals = { Premium: {} };
          rows = lapsed.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.premiumAmount ?? 0)) || 0;
            currencyTotals!.Premium[c] = (currencyTotals!.Premium[c] || 0) + amt;
            return [r.policyNumber, r.status, r.currency, r.premiumAmount, ...currencyAmounts(r.premiumAmount, r.currency), r.paymentSchedule, r.createdAt];
          });
          break;
        }
        case "agent-productivity": {
          const prod = await storage.getAgentProductivityReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = [
            "agent_id",
            "AgentsNar",
            "Inception_",
            "Policy_Nur",
            "FullName",
            "Product_N",
            "UsualPrem",
            "StatusDes",
            "ReceiptsC",
            "Colour",
            "MembersB",
            "AgentsBra",
            "Active",
            "fdate",
            "tdate",
          ];
          currencyTotals = null;
          rows = prod.map((r: any) => [
            r.agent_id ?? "",
            r.AgentsNar ?? "",
            r.Inception_ ?? "",
            r.Policy_Nur ?? "",
            r.FullName ?? "",
            r.Product_N ?? "",
            r.UsualPrem ?? "",
            r.StatusDes ?? "",
            r.ReceiptsC ?? "",
            r.Colour ?? "",
            r.MembersB ?? "",
            r.AgentsBra ?? "",
            r.Active ?? "",
            r.fdate ?? "",
            r.tdate ?? "",
          ]);
          break;
        }
        case "issued-policies":
        case "new-joinings": {
          const issued = await storage.getNewJoiningsReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = [
            "Franchise_Branch_ID",
            "Franchise_BranchName",
            "Marketing_Member_ID",
            "Policy_num",
            "Inception_Date",
            "ID_Number",
            "First_Name",
            "Surname",
            "PolicyHolder",
            "Title",
            "Initials",
            "UsualPrem",
            "Cell_Num",
            "PhysicalAdd",
            "PostalAdd",
            "EasyPayNo",
            "Payment_M",
            "StopOrder",
            "Product_N",
            "Waiting_Pe",
            "InternalRe",
            "AgentNam",
            "MaturityTe",
            "GroupName",
            "Idate",
            "tdate",
            "Status",
            "Date captured",
          ];
          currencyTotals = null;
          rows = issued.map((r: any) => [
            r.Franchise_Branch_ID ?? "",
            r.Franchise_BranchName ?? "",
            r.Marketing_Member_ID ?? "",
            r.Policy_num ?? "",
            r.Inception_Date ?? "",
            r.ID_Number ?? "",
            r.First_Name ?? "",
            r.Surname ?? "",
            r.PolicyHolder ?? "",
            r.Title ?? "",
            r.Initials ?? "",
            r.UsualPrem ?? "",
            r.Cell_Num ?? "",
            r.PhysicalAdd ?? "",
            r.PostalAdd ?? "",
            r.EasyPayNo ?? "",
            r.Payment_M ?? "",
            r.StopOrder ?? "",
            r.Product_N ?? "",
            r.Waiting_Pe ?? "",
            r.InternalRe ?? "",
            r.AgentNam ?? "",
            r.MaturityTe ?? "",
            r.GroupName ?? "",
            r.Idate ?? "",
            r.tdate ?? "",
            r._status ?? "",
            r._policyCreatedAt ?? "",
          ]);
          break;
        }
        case "cashups": {
          const cashupsList = await storage.getCashups(user.organizationId, REPORT_EXPORT_MAX_ROWS, { ...reportFilters, preparedBy: reportFilters.userId });
          headers = ["Cashup Date", "Currency", "Total Amount", ...currencyHeaders("Total"), "Transaction Count", "Status", "Locked", "Prepared By", "Confirmed By", "Discrepancy Amount", "Discrepancy Notes", "Created"];
          currencyTotals = { Total: {} };
          rows = cashupsList.map((r: any) => {
            const c = (r.currency || "USD").toUpperCase();
            const amt = parseFloat(String(r.totalAmount ?? 0)) || 0;
            currencyTotals!.Total[c] = (currencyTotals!.Total[c] || 0) + amt;
            return [
              r.cashupDate, r.currency || "USD", r.totalAmount, ...currencyAmounts(r.totalAmount, r.currency), r.transactionCount, r.status || "—", r.isLocked ? "Yes" : "No", r.preparedBy,
              r.confirmedBy || "—", r.discrepancyAmount ?? "—", r.discrepancyNotes ?? "—", r.createdAt,
            ];
          });
          break;
        }
        case "receipts": {
          const receiptRows = await storage.getReceiptReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = [
            "DTSTAMP",
            "agentsName",
            "MonthsPaidInAdvance",
            "policy_number",
            "surname",
            "InternalReferenceNumber",
            "Product_Name",
            "Inception_Date",
            "MonthNumber",
            "YearNumber",
            "ReceiptCount",
            "fdate",
            "tdate",
            "PaymentBy",
            "ReceiptNumber",
            "ManualUser",
            "DatePaid",
            "Transaction",
            "PremiumDue",
            "Currency",
            "AmountCollected",
            "MonthsPaid",
            "Remarks",
            "PaymentMethod",
            "DefaultPay",
            "DebitMethod",
            "ReceiptMonth",
            "ReceiptYear",
            "policy_num",
            "PolicyBranch",
            "Inception_",
            "Sstatus",
            "InternalRe",
            "Product_N",
            "CollectedBy",
            "fromDate",
            "toDate",
            "GroupName",
            "InceptionD",
            "MemberID",
            "ActualPen",
            "ReceiptID",
            "CapturedBy",
          ];
          currencyTotals = null;
          rows = receiptRows.map((r: any) => [
            r.DTSTAMP ?? "",
            r.agentsName ?? "",
            r.MonthsPaidInAdvance ?? "",
            r.policy_number ?? "",
            r.surname ?? "",
            r.InternalReferenceNumber ?? "",
            r.Product_Name ?? "",
            r.Inception_Date ?? "",
            r.MonthNumber ?? "",
            r.YearNumber ?? "",
            r.ReceiptCount ?? "",
            r.fdate ?? "",
            r.tdate ?? "",
            r.PaymentBy ?? "",
            r.ReceiptNumber ?? "",
            r.ManualUser ?? "",
            r.DatePaid ?? "",
            r.Transaction ?? "",
            r.PremiumDue ?? "",
            r.Currency ?? "",
            r.AmountCollected ?? "",
            r.MonthsPaid ?? "",
            r.Remarks ?? "",
            r.PaymentMethod ?? "",
            r.DefaultPay ?? "",
            r.DebitMethod ?? "",
            r.ReceiptMonth ?? "",
            r.ReceiptYear ?? "",
            r.policy_num ?? "",
            r.PolicyBranch ?? "",
            r.Inception_ ?? "",
            r.Sstatus ?? "",
            r.InternalRe ?? "",
            r.Product_N ?? "",
            r.CollectedBy ?? "",
            r.fromDate ?? "",
            r.toDate ?? "",
            r.GroupName ?? "",
            r.InceptionD ?? "",
            r.MemberID ?? "",
            r.ActualPen ?? "",
            r.ReceiptID ?? "",
            r.CapturedBy ?? "",
          ]);
          break;
        }
        default:
          return res.status(400).json({ message: `Unknown report type: ${reportType}` });
      }

      const escapeCsv = (val: any) => {
        const str = String(val ?? "");
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvLines = [headers.join(",")];
      for (const row of rows) {
        csvLines.push(row.map(escapeCsv).join(","));
      }

      if (currencyTotals && Object.keys(currencyTotals).length > 0) {
        csvLines.push("");
        csvLines.push(`CURRENCY TOTALS (${rows.length} rows)`);
        for (const [label, totals] of Object.entries(currencyTotals)) {
          for (const cur of CURRENCIES) {
            const val = totals[cur];
            if (val) csvLines.push(`${escapeCsv(`${label} (${cur})`)},${val.toFixed(2)}`);
          }
        }
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${reportType}-report.csv"`);
      return res.send(csvLines.join("\n"));
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── ADMIN DIAGNOSTICS ─────────────────────────────────────

  app.get("/api/diagnostics/health", requireAuth, requireTenantScope, requirePermission("read:audit_log"), async (_req, res) => {
    try {
      const { pool } = await import("./db");
      let dbConnected = false;
      const tableCounts: Record<string, number> = {};
      try {
        const testResult = await pool.query("SELECT 1");
        dbConnected = testResult.rowCount !== null && testResult.rowCount > 0;
        const tableNames = [
          "organizations", "branches", "users", "roles", "permissions",
          "clients", "products", "policies", "claims", "funeral_cases",
          "payment_transactions", "notification_logs", "audit_logs", "leads",
        ];
        for (const table of tableNames) {
          try {
            const countResult = await pool.query(`SELECT COUNT(*)::int as count FROM ${table}`);
            tableCounts[table] = countResult.rows[0]?.count ?? 0;
          } catch {
            tableCounts[table] = -1;
          }
        }
      } catch {
        dbConnected = false;
      }
      const { getTenantPoolStats } = await import("./tenant-db");
      return res.json({
        dbConnected,
        uptime: process.uptime(),
        tableCounts,
        tenantPools: getTenantPoolStats(),
        backgroundJobs: getJobStats(),
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/diagnostics/notification-failures", requireAuth, requireTenantScope, requirePermission("read:notification"), async (req, res) => {
    try {
      const user = req.user as any;
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT id, channel, subject, recipient_type, failure_reason, attempts, created_at
         FROM notification_logs
         WHERE organization_id = $1 AND status = 'failed'
         ORDER BY created_at DESC LIMIT 50`,
        [user.organizationId]
      );
      const rows = result.rows.map((r: any) => ({
        id: r.id, channel: r.channel, subject: r.subject,
        recipientType: r.recipient_type, failureReason: r.failure_reason,
        attempts: r.attempts, createdAt: r.created_at,
      }));
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/diagnostics/unallocated-payments", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    try {
      const user = req.user as any;
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT id, amount, method, reference, status, received_at, created_at
         FROM payment_transactions
         WHERE organization_id = $1 AND policy_id IS NULL
         ORDER BY created_at DESC LIMIT 50`,
        [user.organizationId]
      );
      const rows = result.rows.map((r: any) => ({
        id: r.id, amount: r.amount, method: r.method, reference: r.reference,
        status: r.status, receivedAt: r.received_at, createdAt: r.created_at,
      }));
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/diagnostics/recent-errors", requireAuth, requireTenantScope, requirePermission("read:audit_log"), async (req, res) => {
    try {
      const user = req.user as any;
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT id, action, entity_type, actor_email, timestamp
         FROM audit_logs
         WHERE organization_id = $1 AND action ILIKE '%error%'
         ORDER BY timestamp DESC LIMIT 50`,
        [user.organizationId]
      );
      const rows = result.rows.map((r: any) => ({
        id: r.id, action: r.action, entityType: r.entity_type,
        actorEmail: r.actor_email, timestamp: r.timestamp,
      }));
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/admin/migrate-tc-pv", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      const { db } = await import("./db");
      await (db as any).execute(sql`ALTER TABLE terms_and_conditions ADD COLUMN IF NOT EXISTS product_version_id UUID REFERENCES product_versions(id)`);
      await (db as any).execute(sql`CREATE INDEX IF NOT EXISTS tc_pv_idx ON terms_and_conditions(product_version_id)`);
      return res.json({ success: true, message: "Migration complete: product_version_id column added to terms_and_conditions" });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/admin/run-notifications", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    const orgId = user.organizationId;
    const today = new Date();
    const { dispatchNotification, buildPolicyContext } = require("./notifications");
    const org = await storage.getOrganization(orgId);

    let birthdayCount = 0;
    let preLapseCount = 0;
    let lapseCount = 0;
    let anniversaryCount = 0;
    let premiumDueCount = 0;

    const allClients = await storage.getClientsByOrg(orgId, 100000, 0);
    for (const c of allClients) {
      if (c.dateOfBirth) {
        const dob = new Date(c.dateOfBirth);
        if (dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate()) {
          const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          await dispatchNotification(orgId, "birthday", c.id, {
            clientName: `${c.firstName} ${c.lastName}`,
            firstName: c.firstName,
            lastName: c.lastName,
            birthdayName: `${c.firstName} ${c.lastName}`,
            birthdayDate: `${monthNames[dob.getMonth()]} ${dob.getDate()}`,
            orgName: org?.name,
          });
          birthdayCount++;
        }
      }
    }

    const allPolicies = await storage.getPoliciesByOrg(orgId, 100000, 0);
    for (const p of allPolicies) {
      if (!p.clientId) continue;
      const ctx = await buildPolicyContext(p, orgId);

      if (p.inceptionDate) {
        const inception = new Date(p.inceptionDate);
        if (inception.getMonth() === today.getMonth() && inception.getDate() === today.getDate() && inception.getFullYear() < today.getFullYear()) {
          const years = today.getFullYear() - inception.getFullYear();
          await dispatchNotification(orgId, "anniversary", p.clientId, { ...ctx, anniversaryYears: String(years) });
          anniversaryCount++;
        }
      }

      if (p.status === "active" && p.currentCycleEnd) {
        const cycleEnd = new Date(p.currentCycleEnd);
        const daysToEnd = Math.ceil((cycleEnd.getTime() - today.getTime()) / 86400000);
        if (daysToEnd === 3) {
          await dispatchNotification(orgId, "premium_due", p.clientId, ctx);
          premiumDueCount++;
        }
      }

      if ((p.status === "active" || p.status === "grace") && p.graceEndDate) {
        const graceEnd = new Date(p.graceEndDate);
        const daysToGrace = Math.ceil((graceEnd.getTime() - today.getTime()) / 86400000);
        if (daysToGrace === 7 || daysToGrace === 3 || daysToGrace === 1) {
          await dispatchNotification(orgId, "pre_lapse_warning", p.clientId, ctx);
          preLapseCount++;
        } else if (daysToGrace <= 0 && p.status === "grace") {
          await dispatchNotification(orgId, "policy_lapsed", p.clientId, ctx);
          lapseCount++;
        }
      }

      const members = await storage.getPolicyMembers(p.id, orgId);
      for (const m of members as any[]) {
        if (!m.dependentId) continue;
        const dep = await storage.getDependent(m.dependentId, orgId);
        if (!dep?.dateOfBirth) continue;
        const dob = new Date(dep.dateOfBirth);
        if (dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate()) {
          const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          await dispatchNotification(orgId, "birthday", p.clientId, {
            ...ctx,
            birthdayName: `${dep.firstName} ${dep.lastName}`,
            birthdayDate: `${monthNames[dob.getMonth()]} ${dob.getDate()}`,
            memberName: `${dep.firstName} ${dep.lastName}`,
          });
          birthdayCount++;
        }
      }
    }

    return res.json({ birthdayCount, preLapseCount, lapseCount, anniversaryCount, premiumDueCount });
  });

  app.post("/api/admin/sync-permissions", requireAuth, requireTenantScope, requirePermission("manage:permissions"), async (req, res) => {
    const user = req.user as any;
    try {
      const { seedDatabase } = await import("./seed");
      await seedDatabase();
      return res.json({ success: true, message: "Permissions and roles synchronized" });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0]?.message || "Validation failed", errors: err.errors });
    }
    structuredLog("error", "Unhandled route error", { error: err.message, stack: err.stack, path: req.path, method: req.method });
    return res.status(500).json({ message: "Internal server error" });
  });

  return httpServer;
}
