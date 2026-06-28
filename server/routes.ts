import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import argon2 from "argon2";
import crypto from "crypto";
import { storage, findPaymentReceiptById, type ReportFilters } from "./storage";
import {
  withOrgTransaction,
  getDbForOrg,
  resolveUserIdForOrgDatabase,
  ensureRegistryUserMirroredToOrgDataDbInTx,
  ensureRegistryUserMirroredToOrgDataDb,
  getPoolForOrg,
} from "./tenant-db";
import { requireAuth, requirePermission, requireAnyPermission, requireTenantScope } from "./auth";
import { structuredLog } from "./logger";
import { auditLog, safeError, handleZodError, getAddOnPrice, computePolicyPremium, recordClawback, rollbackClawbacks, rollbackClawbacksInTx, nullifyEmptyFields, enforceAgentScope, enforceAgentPolicyAccess, computePolicyOutstanding, reconcilePremiumChange, periodsBetween } from "./route-helpers";
import { withAdvisoryLock } from "./advisory-lock";
import { buildIncomeStatement, buildCashFlowStatement } from "./financial-statements";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { registerPolicyDocumentRoute } from "./policy-document";
import { registerMortuaryFormRoutes } from "./routes-pdf-mortuary";
import { registerPolicyFormRoutes } from "./routes-pdf-policy";
import { registerFinanceFormRoutes } from "./routes-pdf-finance";
import { registerHrFleetFormRoutes } from "./routes-pdf-hr-fleet";
import { createPaymentIntent, initiatePaynowPayment, handlePaynowResult, pollPaynowStatus, applyPaymentToPolicy, initiatePaynowForGroup, pollGroupPaynowStatus, generateGroupMerchantReference } from "./payment-service";
import * as objectStorage from "./object-storage";
import { getPaynowConfig, getOrgPaynowConfig } from "./paynow-config";
import { getReceiptPdfPath } from "./receipt-pdf";
import { PLATFORM_OWNER_EMAIL, SYSTEM_PERMISSIONS, ROLE_PERMISSION_MAP } from "./constants";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, tenantBranding as cpTenantBranding } from "@shared/control-plane-schema";
import { applyPolicyStatusForClearedPayment, advancePolicyCycle } from "./policy-status-on-payment";
import { runApplyCreditBalances } from "./credit-apply";
import { toUpperTrim, normalizeNationalId, isValidNationalId, normalizeCurrency, SUPPORTED_CURRENCIES, parsePositiveAmount } from "../shared/validation";
import {
  insertOrganizationSchema, insertBranchSchema, insertClientSchema,
  insertProductSchema, insertProductVersionSchema, insertPolicySchema,
  insertClaimSchema, insertFuneralCaseSchema, insertFuneralTaskSchema,
  insertPartnerParlourSchema,
  insertMortuaryIntakeSchema, insertMortuaryDispatchSchema,
  insertDeceasedBelongingSchema, insertBodyWashRequirementSchema, insertDriverChecklistSchema,
  insertFleetVehicleSchema, insertCommissionPlanSchema,
  insertNotificationTemplateSchema, insertLeadSchema, insertExpenditureSchema,
  insertPriceBookItemSchema, insertBenefitCatalogItemSchema,
  insertBenefitBundleSchema, insertAddOnSchema, insertAgeBandConfigSchema,
  insertPaymentTransactionSchema, insertApprovalRequestSchema,
  insertPayrollEmployeeSchema, insertPayrollRunSchema, insertCashupSchema,
  insertGroupSchema, insertPlatformReceivableSchema, insertSettlementSchema,
  insertReceiptAdvertSchema,
  insertDependentSchema, insertTermsSchema,
  insertRequisitionSchema, insertRequisitionItemSchema, REQUISITION_STATUSES,
  insertDebitOrderSchema, DEBIT_ORDER_STATUSES,
  VALID_POLICY_TRANSITIONS, VALID_CLAIM_TRANSITIONS,
  policies, paymentTransactions, paymentReceipts, users, clients, claims, leads, branches, appReleases, waitingPeriodWaivers,
} from "@shared/schema";
import { sql, eq, count, and, max } from "drizzle-orm";
import { pool, db } from "./db";
import { notifyClient, notifyClientPush, dispatchNotification, buildPolicyContext } from "./notifications";
import { notifyUser, notifyUsersWithPermission } from "./user-notifications";
import { pushToClient } from "./push";
import { sseConnect, sseActiveCount } from "./sse";
import { enqueueJob, getJobStats } from "./job-queue";
import {
  insertOutboxMessageInTx,
  requestOutboxDrain,
  OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP,
  OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP,
  OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP,
} from "./outbox";
import { isAgentScoped } from "@shared/roles";


export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  const DASHBOARD_MAX_ROWS =
    (process.env.DASHBOARD_MAX_ROWS && parseInt(process.env.DASHBOARD_MAX_ROWS, 10)) || 5000;
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
    const rawAddOns = await storage.getPolicyAddOns(policy.id, orgId);
    const memberAddOns = rawAddOns
      .filter((a: any) => a.addOnId)
      .map((a: any) => ({ memberRef: a.policyMemberId ?? "holder", addOnId: a.addOnId }));
    const recomputedPremium = await computePolicyPremium(
      orgId,
      policy.productVersionId,
      policy.currency || "USD",
      policy.paymentSchedule || "monthly",
      [],
      memberAddOns.length > 0 ? memberAddOns : undefined,
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

  // Fix 5: Derive a stable uint32 advisory lock key from an orgId UUID so that
  // multiple processes don't run premium backfill for the same org concurrently.
  const BACKFILL_LOCK_CLASS = 900263002; // distinct namespace from payment automation (9002630001)
  function orgIdToLockId(orgId: string): number {
    const hex = orgId.replace(/-/g, "").slice(0, 8);
    return (parseInt(hex, 16) >>> 0); // unsigned 32-bit int
  }

  function schedulePolicyPremiumBackfill(orgId: string) {
    if (!orgId || premiumBackfillRunning.has(orgId)) return;
    premiumBackfillRunning.add(orgId);
    enqueueJob("policy_premium_backfill", { orgId }, async () => {
      try {
        await withAdvisoryLock(BACKFILL_LOCK_CLASS, orgIdToLockId(orgId), async () => {
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
        });
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

    // Fix 3: Bulk-load last cleared payment date per policy once (still a single GROUP BY query).
    const tdbForAuto = await getDbForOrg(orgId);
    const lastPmtRows = await tdbForAuto
      .select({ policyId: paymentTransactions.policyId, lastCleared: max(paymentTransactions.receivedAt) })
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.organizationId, orgId), sql`${paymentTransactions.status} = 'cleared'`))
      .groupBy(paymentTransactions.policyId);
    const lastClearedMap = new Map<string, Date>();
    for (const r of lastPmtRows) {
      if (r.policyId && r.lastCleared) lastClearedMap.set(r.policyId, new Date(r.lastCleared));
    }

    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    let reminded = 0;
    let attempted = 0;
    let skipped = 0;
    let totalScanned = 0;

    // Fix 3: Paginate policy load (200 per page) instead of loading up to 100k rows into memory.
    const AUTO_PAGE = 200;
    let offset = 0;
    let pageHasRows = true;
    while (pageHasRows) {
      const policies = await storage.getPoliciesByOrg(orgId, AUTO_PAGE, offset, { statuses: ["active", "grace"] });
      if (policies.length === 0) break;
      pageHasRows = policies.length === AUTO_PAGE;
      offset += policies.length;
      totalScanned += policies.length;

    for (const policy of policies) {
      if (!policy.clientId) continue;
      const lastClearedAt = lastClearedMap.get(policy.id) ?? null;
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
    } // end for policy
    } // end while page
    return { scanned: totalScanned, reminded, attempted, skipped };
  }

  let paymentAutomationTickRunning = false;
  const PAYMENT_AUTO_LOCK_KEY = 9_002_630_001; // stable pg advisory lock key for this scheduler
  const automationTickMs = Math.max(60_000, parseInt(process.env.PAYMENT_AUTOMATION_TICK_MS || "", 10) || (6 * 60 * 60 * 1000));
  setInterval(async () => {
    if (paymentAutomationTickRunning) return;
    paymentAutomationTickRunning = true;
    try {
      await withAdvisoryLock(PAYMENT_AUTO_LOCK_KEY, async () => {
        const orgs = await storage.getOrganizations();
        for (const org of orgs) {
          await runPaymentAutomationForOrg(org.id);
        }
      });
    } catch (err: any) {
      structuredLog("error", "Payment automation scheduler failed", { error: err?.message, stack: err?.stack });
    } finally {
      paymentAutomationTickRunning = false;
    }
  }, automationTickMs);

  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Helper to serve a file from object storage or local disk (no auth required for public assets)
  const serveUpload = async (req: any, res: any, requiresAuth: boolean, keyPrefix = "") => {
    const key = keyPrefix + decodeURIComponent(String((req.params as any).path || ""));
    if (!key) return res.status(400).end();
    if (!objectStorage.isObjectStorageEnabled) {
      const filePath = path.join(uploadsDir, key);
      if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
        return res.status(403).json({ message: "Forbidden" });
      }
      return res.sendFile(filePath, { maxAge: requiresAuth ? 0 : 86400 }, (err: any) => {
        if (err) res.status(404).json({ message: "File not found" });
      });
    }
    try {
      const buf = await objectStorage.fetchFile(key);
      if (!buf) return res.status(404).json({ message: "Not found" });
      const ext = path.extname(key).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".gif": "image/gif", ".pdf": "application/pdf",
      };
      res.set("Content-Type", mimeTypes[ext] || "application/octet-stream");
      res.set("Cache-Control", requiresAuth ? "private, no-store" : "public, max-age=86400, stale-while-revalidate=3600");
      return res.send(buf);
    } catch (err: any) {
      structuredLog("error", "Proxy fetch from object storage failed", { key, error: err?.message });
      return res.status(502).json({ message: "Could not fetch file" });
    }
  };

  // Brand assets — publicly accessible (no session cookie) for <img> tags on the
  // login page and in Capacitor mobile where cookies aren't sent cross-origin.
  // NOTE: *path captures everything AFTER the folder segment, so we re-prefix the
  // storage key (e.g. "logo.jpg" → "logos/logo.jpg") before calling fetchFile.
  app.get("/uploads/logos/*path", (req, res) => serveUpload(req, res, false, "logos/"));
  app.get("/uploads/signatures/*path", (req, res) => serveUpload(req, res, false, "signatures/"));
  app.get("/uploads/receipt-adverts/*path", (req, res) => serveUpload(req, res, false, "receipt-adverts/"));

  // All other uploads (documents, PDFs, receipts) require authentication.
  if (!objectStorage.isObjectStorageEnabled) {
    app.get("/uploads/*path", requireAuth, (req, res) => {
      const filePath = path.join(uploadsDir, String((req.params as any).path || ""));
      if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
        return res.status(403).json({ message: "Forbidden" });
      }
      return res.sendFile(filePath, { maxAge: 0 }, (err) => {
        if (err) res.status(404).json({ message: "File not found" });
      });
    });
  } else {
    // Stream files from object storage using server credentials.
    // The bucket can remain private — the browser never hits the CDN directly.
    app.get("/uploads/*path", requireAuth, async (req, res) => {
      return serveUpload(req, res, true);
    });
  }

  // Paynow result URL (webhook) — no auth; hash verified in handler. Always return 200 to avoid Paynow retries.
  app.post("/api/payments/paynow/result", express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const body = req.body as Record<string, string>;
      // ?org=<orgId> is embedded in the resultUrl we give PayNow per tenant so we
      // can verify with the correct integration key without scanning all orgs.
      const orgId = typeof req.query.org === "string" ? req.query.org : undefined;
      const result = await handlePaynowResult(body, orgId);
      return res.status(200).send(result.ok ? "OK" : "Error");
    } catch (err: any) {
      structuredLog("error", "PayNow result handler threw", { error: err?.message });
      return res.status(200).send("Error");
    }
  });

  // Fix 7: SVG removed from both upload allowlists.
  // SVG files can contain embedded <script> tags / event handlers, enabling stored XSS
  // when served with Content-Type: image/svg+xml by a CDN.
  const memUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
      const hasAllowedExtension = allowed.test(path.extname(file.originalname));
      const isImageMime = file.mimetype.startsWith("image/") && file.mimetype !== "image/svg+xml";
      if (hasAllowedExtension && isImageMime) cb(null, true);
      else cb(new Error("Only image files are allowed (jpg, jpeg, png, gif, webp)"));
    },
  });

  const logoMemUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(png|jpg|jpeg|webp)$/i;
      const hasAllowedExtension = allowed.test(path.extname(file.originalname));
      const allowedMimes = ["image/png", "image/jpeg", "image/webp"];
      if (hasAllowedExtension && allowedMimes.includes(file.mimetype)) cb(null, true);
      else cb(new Error("Logo must be PNG, JPG, or WebP"));
    },
  });

  const POLICY_DOC_ALLOWED_MIMES = new Set([
    "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg",
    "video/mp4", "video/quicktime", "video/x-msvideo",
  ]);
  const policyDocUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(pdf|jpg|jpeg|png|gif|webp|doc|docx|mp3|mp4|wav|m4a|ogg|avi|mov)$/i;
      if (allowed.test(path.extname(file.originalname)) && POLICY_DOC_ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
      else cb(new Error("File type not allowed. Supported: PDF, images, Word, audio, video"));
    },
  });

  function handleMulterError(err: any, _req: any, res: any, next: any) {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "File too large (max 10MB for documents, 5MB for images)" });
      return res.status(400).json({ message: err.message });
    }
    if (err?.message) return res.status(400).json({ message: err.message });
    next(err);
  }

  app.post("/api/upload", requireAuth, requireTenantScope, requireAnyPermission("write:client", "write:claim", "write:policy", "write:funeral_ops"), memUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "File is empty" });
    try {
      const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      return res.json({ url, filename: key });
    } catch (err: any) {
      structuredLog("error", "Upload failed", { error: err?.message });
      return res.status(500).json({ message: "Upload failed. Please try again." });
    }
  });
  app.use("/api/upload", handleMulterError);

  app.post("/api/upload/logo", requireAuth, requireTenantScope, requirePermission("manage:settings"), logoMemUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "File is empty" });
    try {
      const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "logos");
      return res.json({ url, filename: key });
    } catch (err: any) {
      structuredLog("error", "Logo upload failed", { error: err?.message });
      return res.status(500).json({ message: "Upload failed. Please try again." });
    }
  });
  app.use("/api/upload/logo", handleMulterError);

  app.post("/api/upload/signature", requireAuth, requireTenantScope, requirePermission("manage:settings"), logoMemUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "File is empty" });
    try {
      const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "signatures");
      return res.json({ url, filename: key });
    } catch (err: any) {
      structuredLog("error", "Signature upload failed", { error: err?.message });
      return res.status(500).json({ message: "Upload failed. Please try again." });
    }
  });
  app.use("/api/upload/signature", handleMulterError);

  // Receipt advert image upload
  app.post("/api/upload/receipt-advert-image", requireAuth, requireTenantScope, requirePermission("manage:settings"), logoMemUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "File is empty" });
    try {
      const { url } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "receipt-adverts");
      return res.json({ url });
    } catch (err: any) {
      structuredLog("error", "Receipt advert image upload failed", { error: err?.message });
      return res.status(500).json({ message: "Upload failed. Please try again." });
    }
  });
  app.use("/api/upload/receipt-advert-image", handleMulterError);

  // ─── Receipt Adverts ────────────────────────────────────────────
  app.get("/api/receipt-adverts", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getReceiptAdverts(user.organizationId));
  });

  app.post("/api/receipt-adverts", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    try {
      const data = insertReceiptAdvertSchema.parse({ ...req.body, organizationId: user.organizationId });
      const advert = await storage.createReceiptAdvert(data);
      await auditLog(req, "CREATE_RECEIPT_ADVERT", "ReceiptAdvert", advert.id, null, advert);
      return res.status(201).json(advert);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      return res.status(500).json({ message: err?.message || "Failed to create advert" });
    }
  });

  app.patch("/api/receipt-adverts/:id", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    const before = (await storage.getReceiptAdverts(user.organizationId)).find(a => a.id === req.params.id);
    const updated = await storage.updateReceiptAdvert(req.params.id as string, req.body, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Advert not found" });
    await auditLog(req, "UPDATE_RECEIPT_ADVERT", "ReceiptAdvert", req.params.id as string, before, updated);
    return res.json(updated);
  });

  app.delete("/api/receipt-adverts/:id", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    await storage.deleteReceiptAdvert(req.params.id as string, user.organizationId);
    await auditLog(req, "DELETE_RECEIPT_ADVERT", "ReceiptAdvert", req.params.id as string, null, null);
    return res.status(204).end();
  });

  app.post("/api/receipt-adverts/:id/activate", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    await storage.setActiveReceiptAdvert(req.params.id as string, user.organizationId);
    await auditLog(req, "ACTIVATE_RECEIPT_ADVERT", "ReceiptAdvert", req.params.id as string, null, null);
    return res.json({ success: true });
  });

  app.post("/api/receipt-adverts/:id/deactivate", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    await storage.updateReceiptAdvert(req.params.id as string, { isActive: false }, user.organizationId);
    return res.json({ success: true });
  });

  // Avatar upload — any authenticated staff user can upload their own avatar.
  app.post("/api/upload/avatar", requireAuth, logoMemUpload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "File is empty" });
    try {
      const user = req.user as any;
      const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "avatars");
      await storage.updateUser(user.id, { avatarUrl: url });
      await auditLog(req, "UPDATE_AVATAR", "User", user.id, { avatarUrl: user.avatarUrl }, { avatarUrl: url });
      return res.json({ url, filename: key });
    } catch (err: any) {
      structuredLog("error", "Avatar upload failed", { error: err?.message });
      return res.status(500).json({ message: "Upload failed. Please try again." });
    }
  });
  app.use("/api/upload/avatar", handleMulterError);

  // ─── App Release Management ──────────────────────────────────

  app.get("/api/public/agent-app-latest", async (_req, res) => {
    try {
      const [release] = await db.select().from(appReleases).where(eq(appReleases.isActive, true)).orderBy(sql`${appReleases.createdAt} desc`).limit(1);
      if (!release) return res.status(404).json({ message: "No release available" });
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json({ url: release.downloadUrl, version: release.version, buildNumber: release.buildNumber, updatedAt: release.createdAt });
    } catch {
      return res.status(503).json({ message: "Service temporarily unavailable" });
    }
  });

  app.get("/api/app-info", requireAuth, async (_req, res) => {
    try {
      const [release] = await db.select().from(appReleases).where(eq(appReleases.isActive, true)).orderBy(sql`${appReleases.createdAt} desc`).limit(1);
      if (!release) return res.json({ available: false });
      return res.json({ available: true, version: release.version, buildNumber: release.buildNumber, minVersion: release.minVersion, minBuildNumber: release.minBuildNumber, downloadUrl: release.downloadUrl, releaseNotes: release.releaseNotes });
    } catch {
      return res.status(503).json({ message: "Service temporarily unavailable" });
    }
  });

  app.get("/api/platform/app-releases", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) return res.status(403).json({ message: "Platform owner access required" });
    const releases = await db.select().from(appReleases).orderBy(sql`${appReleases.createdAt} desc`).limit(20);
    return res.json(releases);
  });

  app.post("/api/platform/app-release", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) return res.status(403).json({ message: "Platform owner access required" });
    const { version, buildNumber, minVersion, minBuildNumber, downloadUrl, releaseNotes } = req.body;
    if (!version || !buildNumber || !downloadUrl) return res.status(400).json({ message: "version, buildNumber and downloadUrl are required" });
    await db.insert(appReleases).values({ version: String(version), buildNumber: Number(buildNumber), minVersion: minVersion || "1.0.0", minBuildNumber: Number(minBuildNumber) || 1, downloadUrl: String(downloadUrl), releaseNotes: releaseNotes || null, isActive: true });
    const [created] = await db.select().from(appReleases).orderBy(sql`${appReleases.createdAt} desc`).limit(1);
    return res.status(201).json(created);
  });

  app.patch("/api/platform/app-release/:id", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) return res.status(403).json({ message: "Platform owner access required" });
    const { version, buildNumber, minVersion, minBuildNumber, downloadUrl, releaseNotes, isActive } = req.body;
    const updates: Record<string, any> = {};
    if (version !== undefined) updates.version = String(version);
    if (buildNumber !== undefined) updates.buildNumber = Number(buildNumber);
    if (minVersion !== undefined) updates.minVersion = String(minVersion);
    if (minBuildNumber !== undefined) updates.minBuildNumber = Number(minBuildNumber);
    if (downloadUrl !== undefined) updates.downloadUrl = String(downloadUrl);
    if (releaseNotes !== undefined) updates.releaseNotes = releaseNotes;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    const [updated] = await db.update(appReleases).set(updates).where(eq(appReleases.id, req.params.id as string)).returning();
    if (!updated) return res.status(404).json({ message: "Release not found" });
    return res.json(updated);
  });

  // ─── Platform Owner: Tenant Switching ──────────────────────────

  app.post("/api/platform/backup-sync", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) {
      return res.status(403).json({ message: "Platform owner access required" });
    }
    try {
      const { runBackupSync } = await import("./backup-sync");
      // Run async — don't block the response
      runBackupSync().catch((err) => structuredLog("error", "Manual backup failed", { error: (err as Error).message }));
      return res.json({ message: "Backup sync triggered. Check logs for progress." });
    } catch (err) {
      return res.status(500).json({ message: "Failed to trigger backup" });
    }
  });

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

    const DASHBOARD_BATCH = 5;
    const perTenant: any[] = [];
    for (let _bi = 0; _bi < tenantRows.length; _bi += DASHBOARD_BATCH) {
      const batch = tenantRows.slice(_bi, _bi + DASHBOARD_BATCH);
      const batchResults = await Promise.all(batch.map(async (tenant) => {
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
            usersCount: 0 as number,
            policiesCount: 0 as number,
            activePoliciesCount: 0 as number,
            clientsCount: 0,
            claimsCount: 0,
            leadsCount: 0,
            branchesCount: 0,
            loadError: err?.message || "Failed to load tenant metrics",
          };
        }
      }));
      perTenant.push(...batchResults);
    }

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
      return res.status(500).json({ message: safeError(err) });
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
    const isPlatformOwner = (user as any).isPlatformOwner ?? (user as any).email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
    const { paynowIntegrationKey: _pik, databaseUrl: _du, paynowAuthEmail: _pae, ...safeOrg } = org as any;
    return res.json(isPlatformOwner ? org : safeOrg);
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
    const isPlatformOwner = user.isPlatformOwner ?? user.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
    const TENANT_WRITE_FIELDS = new Set([
      "name", "address", "phone", "email", "website", "logoUrl", "signatureUrl", "primaryColor",
      "footerText", "policyNumberPrefix", "policyNumberPadding",
      "paynowIntegrationId", "paynowIntegrationKey", "paynowAuthEmail",
      "paynowReturnUrl", "paynowResultUrl", "paynowMode",
    ]);
    const PLATFORM_ONLY_ORG_FIELDS = new Set(["slug", "isActive", "licenseStatus", "isWhitelabeled", "databaseUrl"]);
    const sanitizedOrg: Record<string, any> = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (TENANT_WRITE_FIELDS.has(key)) sanitizedOrg[key] = value;
      else if (PLATFORM_ONLY_ORG_FIELDS.has(key) && isPlatformOwner) sanitizedOrg[key] = value;
    }
    // Narrow paynowMode to the literal union the schema expects
    if (sanitizedOrg.paynowMode !== undefined && sanitizedOrg.paynowMode !== "test" && sanitizedOrg.paynowMode !== "live") {
      delete sanitizedOrg.paynowMode;
    }
    const before = await storage.getOrganization(id);
    if (!before) return res.status(404).json({ message: "Not found" });
    if (Object.keys(sanitizedOrg).length === 0) return res.json(before);
    const updated = await storage.updateOrganization(id, sanitizedOrg as any);
    await auditLog(req, "UPDATE_ORGANIZATION", "Organization", id, before, updated, id);
    const { paynowIntegrationKey: _upik, databaseUrl: _udu, paynowAuthEmail: _upae, ...safeUpdatedOrg } = (updated || {}) as any;
    return res.json(isPlatformOwner ? updated : safeUpdatedOrg);
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

    const isPlatformOwner = user.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
    // Count non-platform-owner users directly (avoids fetching only first 100)
    const tdbDel = await getDbForOrg(id);
    const [{ nonOwnerCount }] = await tdbDel
      .select({ nonOwnerCount: count() })
      .from(users)
      .where(and(
        eq(users.organizationId, id),
        sql`LOWER(${users.email}) != ${PLATFORM_OWNER_EMAIL.toLowerCase()}`,
      ));
    if (nonOwnerCount > 0) {
      return res.status(400).json({
        message: "Cannot delete tenant that has users. Remove or reassign users first.",
      });
    }

    // Clear organizationId for platform owner users in this org so they can log in with no tenant
    const usersInOrg = await storage.getUsersByOrg(id, 1000, 0);
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

  app.get("/api/branches", requireAuth, requireTenantScope, requirePermission("read:branch"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getBranchesByOrg(user.organizationId));
  });

  app.post("/api/branches", requireAuth, requireTenantScope, requirePermission("write:branch"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertBranchSchema.parse({ ...req.body, organizationId: user.organizationId });
      const branch = await storage.createBranch(parsed);
      await auditLog(req, "CREATE_BRANCH", "Branch", branch.id, null, branch);
      return res.status(201).json(branch);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/branches failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Users ──────────────────────────────────────────────────

  app.get("/api/users", requireAuth, requireTenantScope, requirePermission("read:user"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const usersList = await storage.getUsersByOrg(user.organizationId, limit, offset);
    const rolesByUser = await storage.getUserRolesBatch(usersList.map(u => u.id), user.organizationId);
    const usersWithRoles = usersList.map((u) => ({
      id: u.id, email: u.email, displayName: u.displayName,
      avatarUrl: u.avatarUrl, isActive: u.isActive, createdAt: u.createdAt,
      referralCode: u.referralCode, branchId: u.branchId,
      phone: u.phone, address: u.address, nationalId: u.nationalId,
      dateOfBirth: u.dateOfBirth, gender: u.gender, maritalStatus: u.maritalStatus,
      nextOfKinName: u.nextOfKinName, nextOfKinPhone: u.nextOfKinPhone,
      roles: (rolesByUser[u.id] || []).map(r => ({ id: r.id, name: r.name })),
    }));
    return res.json(usersWithRoles);
  });

  app.get("/api/agents", requireAuth, requireTenantScope, requirePermission("read:user"), async (req, res) => {
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
    const currentUser = req.user as any;
    const targetUser = await storage.getUser(req.params.id as string, currentUser.organizationId);
    if (!targetUser) return res.status(404).json({ message: "User not found" });
    if (targetUser.organizationId !== currentUser.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const userRoles = await storage.getUserRoles(targetUser.id, currentUser.organizationId);
    const { passwordHash: _ph, googleId: _gi, ...safeTargetUser } = targetUser as any;
    return res.json({
      ...safeTargetUser,
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
    const hasAgentRole = roles.some((r) => r?.name === "agent");
    if (hasAgentRole && (!password || String(password).length < 8)) {
      return res.status(400).json({ message: "Agents require a password of at least 8 characters" });
    }

    let passwordHash: string | undefined;
    if (password && String(password).length >= 8) {
      passwordHash = await argon2.hash(String(password), { type: argon2.argon2id });
    }

    const refCode = `AGT${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    let newUser: any;
    try {
      newUser = await storage.createUser({
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
        const validRoles = await storage.getRolesByIds(roleIds, currentUser.organizationId);
        if (validRoles.length !== roleIds.length) {
          return res.status(400).json({ message: "One or more roles are invalid for this organization" });
        }
        for (const roleId of roleIds) {
          await storage.addUserRole(newUser.id, roleId, currentUser.organizationId);
        }
      }
    } catch (err: any) {
      structuredLog("error", "POST /api/users failed", { error: err?.message, email });
      return res.status(500).json({ message: safeError(err) });
    }

    const userRoles = await storage.getUserRoles(newUser.id, currentUser.organizationId);
    const { passwordHash: _alph, googleId: _algi, ...safeNewUserAudit } = newUser as any;
    await auditLog(req, "CREATE_USER", "User", newUser.id, null, { ...safeNewUserAudit, roles: userRoles.map((r: any) => r.name) });
    const { passwordHash: _nph, googleId: _ngi, ...safeNewUser } = newUser as any;
    return res.status(201).json({ ...safeNewUser, roles: userRoles.map((r: any) => ({ id: r.id, name: r.name })) });
  });

  app.patch("/api/users/:id", requireAuth, requireTenantScope, requirePermission("write:user"), async (req, res) => {
    const currentUser = req.user as any;
    const targetUser = await storage.getUser(req.params.id as string, currentUser.organizationId);
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
    const { department } = req.body;
    if (department !== undefined) updates.department = department || null;
    const updated = await storage.updateUser(req.params.id as string, updates);

    if (roleIds && Array.isArray(roleIds)) {
      const roles = await storage.getRolesByIds(roleIds, currentUser.organizationId);
      if (roles.length !== roleIds.length) {
        return res.status(400).json({ message: "One or more roles are invalid for this organization" });
      }
      await storage.clearUserRoles(req.params.id as string);
      for (const roleId of roleIds) {
        await storage.addUserRole(req.params.id as string, roleId, currentUser.organizationId);
      }
    }

    const userRoles = await storage.getUserRoles(req.params.id as string, currentUser.organizationId);
    await auditLog(req, "UPDATE_USER", "User", req.params.id as string, before, { ...updated, roles: userRoles.map(r => r.name) });
    const { passwordHash: _uph, googleId: _ugi, ...safeUpdated } = (updated || {}) as any;
    return res.json({ ...safeUpdated, roles: userRoles.map(r => ({ id: r.id, name: r.name })) });
  });

  app.delete("/api/users/:id", requireAuth, requireTenantScope, requirePermission("delete:user"), async (req, res) => {
    const currentUser = req.user as any;
    const targetUser = await storage.getUser(req.params.id as string, currentUser.organizationId);
    if (!targetUser || targetUser.organizationId !== currentUser.organizationId) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.id === currentUser.id) {
      return res.status(400).json({ message: "Cannot deactivate yourself" });
    }
    const updated = await storage.updateUser(req.params.id as string, { isActive: false });
    // Immediately revoke all active sessions for the deactivated user
    await pool.query(`DELETE FROM session WHERE sess->>'passport' IS NOT NULL AND (sess->'passport'->>'user')::text = $1`, [req.params.id]);
    await auditLog(req, "DEACTIVATE_USER", "User", req.params.id as string, targetUser, updated);
    return res.json(updated);
  });

  app.get("/api/users/:id/agent-policies", requireAuth, requireTenantScope, requirePermission("read:user"), async (req, res) => {
    const user = req.user as any;
    const target = await storage.getUser(req.params.id as string, user.organizationId);
    if (!target || target.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "User not found" });
    }
    const agentPolicies = await storage.getPoliciesByAgent(target.id, user.organizationId);
    return res.json({ count: agentPolicies.length, policies: agentPolicies.map(p => ({ id: p.id, policyNumber: p.policyNumber, status: p.status })) });
  });

  app.post("/api/users/:id/reassign-policies", requireAuth, requireTenantScope, requirePermission("delete:user"), async (req, res) => {
    const user = req.user as any;
    const { toAgentId } = req.body;
    const target = await storage.getUser(req.params.id as string, user.organizationId);
    if (!target || target.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "User not found" });
    }
    if (toAgentId) {
      const toAgent = await storage.getUser(toAgentId as string, user.organizationId);
      if (!toAgent || toAgent.organizationId !== user.organizationId) {
        return res.status(404).json({ message: "Target agent not found" });
      }
      const count = await storage.reassignAgentPolicies(target.id, toAgentId as string, user.organizationId);
      await auditLog(req, "REASSIGN_AGENT_POLICIES", "User", target.id, { fromAgentId: target.id }, { toAgentId, count });
    }
    const updated = await storage.updateUser(target.id, { isActive: false });
    await pool.query(`DELETE FROM session WHERE sess->>'passport' IS NOT NULL AND (sess->'passport'->>'user')::text = $1`, [target.id]);
    await auditLog(req, "DEACTIVATE_USER", "User", target.id, target, updated);
    return res.json({ ok: true });
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
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const filters: { search?: string; action?: string; from?: string; to?: string } = {};
    if (req.query.search) filters.search = String(req.query.search);
    if (req.query.action) filters.action = String(req.query.action);
    if (req.query.from) filters.from = String(req.query.from);
    if (req.query.to) filters.to = String(req.query.to);
    return res.json(await storage.getAuditLogs(user.organizationId, limit, offset, filters));
  });

  // ─── Dashboard Stats ───────────────────────────────────────

  app.get("/api/dashboard/stats", requireAuth, requireTenantScope, requireAnyPermission("read:finance", "read:policy", "read:client"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const filters: { dateFrom?: string; dateTo?: string; status?: string; branchId?: string } = {};
    if (req.query.dateFrom) filters.dateFrom = String(req.query.dateFrom);
    if (req.query.dateTo) filters.dateTo = String(req.query.dateTo);
    if (req.query.status) filters.status = String(req.query.status);
    if (req.query.branchId) filters.branchId = String(req.query.branchId);
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    const agentId = isAgent ? user.id : undefined;
    return res.json(await storage.getDashboardStats(user.organizationId, filters, agentId));
  });

  // ─── Reminders ──────────────────────────────────────────────

  app.get("/api/reminders", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try {
      const list = await storage.getReminders(user.id, user.organizationId);
      return res.json(list);
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/reminders", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try {
      if (!req.body.title?.trim()) return res.status(400).json({ message: "Title is required" });
      const reminder = await storage.createReminder({
        ...req.body,
        userId: user.id,
        organizationId: user.organizationId,
      });
      return res.status(201).json(reminder);
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/reminders/:id", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try {
      const updated = await storage.updateReminder(req.params.id as string, req.body, user.id, user.organizationId);
      if (!updated) return res.status(404).json({ message: "Not found" });
      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.delete("/api/reminders/:id", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try {
      await storage.deleteReminder(req.params.id as string, user.id, user.organizationId);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Clients ────────────────────────────────────────────────

  app.get("/api/clients", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const search = typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
    if (isAgent) {
      const hasAccess = await storage.isClientAccessibleByAgent(user.id, client.id, user.organizationId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
    }
    const { passwordHash: _cph, securityAnswerHash: _csah, activationCode: _cac, ...safeClient } = client as any;
    return res.json(safeClient);
  });

  app.post("/api/clients", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;

    if (req.body.nationalId && String(req.body.nationalId).trim()) {
      const existing = await storage.getClientByNationalId(user.organizationId, String(req.body.nationalId).trim());
      if (existing) {
        // Return existing client for auto-population instead of blocking
        return res.status(200).json({
          message: "Client found - existing client data returned",
          code: "EXISTING_CLIENT",
          existingClient: {
            id: existing.id,
            firstName: existing.firstName,
            lastName: existing.lastName,
            nationalId: existing.nationalId,
            phone: existing.phone,
            email: existing.email,
            dateOfBirth: existing.dateOfBirth,
            gender: existing.gender,
            address: existing.address,
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

    const activationCode = `ACT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const userRolesForCreate = await storage.getUserRoles(user.id, user.organizationId);
    const creatorHasAgentRole = userRolesForCreate.some((r: { name?: string }) => r?.name === "agent");
    const creatorIsAgentScoped = isAgentScoped(userRolesForCreate);
    if (creatorHasAgentRole) {
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id, user.branchId || undefined);
    }
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
      agentId: creatorIsAgentScoped ? user.id : undefined,
    });
    let client: any;
    try {
      client = await storage.createClient(parsed);
      await auditLog(req, "CREATE_CLIENT", "Client", client.id, null, client);
      const lead = await storage.createLead({
        organizationId: user.organizationId,
        branchId: user.branchId || undefined,
        agentId: creatorIsAgentScoped ? user.id : undefined,
        clientId: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone || undefined,
        email: client.email || undefined,
        source: creatorIsAgentScoped ? "agent_capture" : "walk_in",
        stage: "lead",
      });
      await auditLog(req, "CREATE_LEAD", "Lead", lead.id, null, lead);
    } catch (err: any) {
      // Log prominently — client exists but lead creation failed; admin will need to manually link or retry
      if (client?.id) {
        structuredLog("error", "Client created but lead creation failed — orphaned client record", { clientId: client.id, orgId: user.organizationId });
      }
      structuredLog("error", "Client creation failed (rolled back)", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
    const org = await storage.getOrganization(user.organizationId);
    await notifyClient(user.organizationId, client.id, "Welcome!", `Welcome to ${org?.name || "our platform"}. Your account has been created.`);
    const { passwordHash: _ncph, securityAnswerHash: _ncsah, activationCode: _ncac, ...safeNewClient } = client as any;
    return res.status(201).json(safeNewClient);
  });

  app.patch("/api/clients/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getClient(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    if (isAgent) {
      const hasAccess = await storage.isClientAccessibleByAgent(user.id, before.id, user.organizationId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
    }
    delete req.body.id;
    delete req.body.organizationId;
    delete req.body.createdAt;
    const sanitizedClient = nullifyEmptyFields(req.body, ["dateOfBirth", "branchId", "agentId"]);
    const updated = await storage.updateClient(req.params.id as string, sanitizedClient, user.organizationId);
    await auditLog(req, "UPDATE_CLIENT", "Client", req.params.id as string, before, updated);
    const { passwordHash: _ucph, securityAnswerHash: _ucsah, activationCode: _ucac, ...safeUpdatedClient } = (updated || {}) as any;
    return res.json(safeUpdatedClient);
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
    let dep: any;
    try {
      dep = await storage.createDependent(parsed);
    } catch (err: any) {
      structuredLog("error", "POST /api/clients/:clientId/dependents failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
    await auditLog(req, "CREATE_DEPENDENT", "Dependent", dep.id, null, dep);
    return res.status(201).json(dep);
  });

  app.patch("/api/clients/:clientId/dependents/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    const updated = await storage.updateDependent(req.params.id as string, nullifyEmptyFields(req.body, ["dateOfBirth"]), user.organizationId);
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

  // ─── Client Documents (ID copies, proof of address, etc.) ───

  app.get("/api/clients/:clientId/documents", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    // Agent scope: agent must have access to this client
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    if (isAgent) {
      const hasAccess = await storage.isClientAccessibleByAgent(user.id, client.id, user.organizationId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });
    }
    return res.json(await storage.getClientDocuments(client.id, user.organizationId));
  });

  app.post("/api/clients/:clientId/documents", requireAuth, requireTenantScope, requirePermission("write:client"), memUpload.single("file"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const documentType = (req.body.documentType || "other") as string;
    const label = (req.body.label || req.file.originalname) as string;

    // Upload to DO Spaces under client-documents/ prefix
    const { url, key } = await objectStorage.uploadFile(
      req.file.buffer, req.file.originalname, req.file.mimetype, "client-documents"
    );

    const doc = await storage.createClientDocument({
      organizationId: user.organizationId,
      clientId: client.id,
      documentType,
      label,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileUrl: url,
      storageKey: key,
      fileSize: req.file.size,
      uploadedBy: user.id,
    });

    await auditLog(req, "UPLOAD_CLIENT_DOCUMENT", "ClientDocument", doc.id, null, { clientId: client.id, documentType, fileName: req.file.originalname });
    return res.status(201).json(doc);
  });
  app.use("/api/clients/:clientId/documents", handleMulterError);

  app.delete("/api/clients/:clientId/documents/:docId", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });

    // Fetch the doc to get the storage key for deletion
    const docs = await storage.getClientDocuments(client.id, user.organizationId);
    const doc = docs.find(d => d.id === req.params.docId);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    // Delete from object storage
    if (doc.storageKey) {
      await objectStorage.deleteFile(doc.storageKey);
    }

    await storage.deleteClientDocument(doc.id, user.organizationId);
    await auditLog(req, "DELETE_CLIENT_DOCUMENT", "ClientDocument", doc.id, { fileName: doc.fileName }, null);
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

  // ─── Client Policies ─────────────────────────────────────────

  app.get("/api/clients/:clientId/policies", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string, user.organizationId);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    const clientPolicies = await storage.getPoliciesByClient(req.params.clientId as string, user.organizationId);
    return res.json(clientPolicies);
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
    try {
      const parsed = insertBenefitCatalogItemSchema.parse({ ...req.body, organizationId: user.organizationId });
      const item = await storage.createBenefitCatalogItem(parsed);
      await auditLog(req, "CREATE_BENEFIT_CATALOG_ITEM", "BenefitCatalogItem", item.id, null, item);
      return res.status(201).json(item);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/benefit-catalog failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/benefit-catalog/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    try {
      const updated = await storage.updateBenefitCatalogItem(req.params.id as string, req.body, user.organizationId);
      if (!updated) return res.status(404).json({ message: "Not found" });
      await auditLog(req, "UPDATE_BENEFIT_CATALOG_ITEM", "BenefitCatalogItem", req.params.id as string, null, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/benefit-catalog/:id failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/benefit-bundles", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getBenefitBundles(user.organizationId));
  });

  app.post("/api/benefit-bundles", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertBenefitBundleSchema.parse({ ...req.body, organizationId: user.organizationId });
      const bundle = await storage.createBenefitBundle(parsed);
      await auditLog(req, "CREATE_BENEFIT_BUNDLE", "BenefitBundle", bundle.id, null, bundle);
      return res.status(201).json(bundle);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/benefit-bundles failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/benefit-bundles/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    try {
      const updated = await storage.updateBenefitBundle(req.params.id as string, req.body, user.organizationId);
      if (!updated) return res.status(404).json({ message: "Not found" });
      await auditLog(req, "UPDATE_BENEFIT_BUNDLE", "BenefitBundle", req.params.id as string, null, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/benefit-bundles/:id failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/add-ons", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getAddOns(user.organizationId));
  });

  app.post("/api/add-ons", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertAddOnSchema.parse({ ...req.body, organizationId: user.organizationId });
      const addon = await storage.createAddOn(parsed);
      await auditLog(req, "CREATE_ADD_ON", "AddOn", addon.id, null, addon);
      return res.status(201).json(addon);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/add-ons failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/add-ons/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    try {
      const updated = await storage.updateAddOn(req.params.id as string, req.body, user.organizationId);
      if (!updated) return res.status(404).json({ message: "Not found" });
      await auditLog(req, "UPDATE_ADD_ON", "AddOn", req.params.id as string, null, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/add-ons/:id failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // Per-member add-on management on existing policies
  app.get("/api/policies/:id/add-ons", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const addOns = await storage.getPolicyAddOns(req.params.id as string, user.organizationId);
    return res.json(addOns);
  });

  // PUT /api/policies/:id/members/:memberId/add-ons  — replace add-ons for one member
  app.put("/api/policies/:id/members/:memberId/add-ons", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const { id: policyId, memberId } = req.params as { id: string; memberId: string };
    const addOnIds: string[] = Array.isArray(req.body.addOnIds) ? req.body.addOnIds : [];
    // IDOR guard: verify the member belongs to this policy in this org
    const policyMemberList = await storage.getPolicyMembers(policyId, user.organizationId);
    if (!policyMemberList.some((m) => m.id === memberId)) {
      return res.status(404).json({ message: "Member not found on this policy" });
    }
    const before = await storage.getPolicyAddOns(policyId, user.organizationId);
    await storage.setMemberAddOns(policyId, memberId, addOnIds, user.organizationId);
    await auditLog(req, "UPDATE_MEMBER_ADD_ONS", "Policy", policyId, before, { memberId, addOnIds });
    // Recalculate premium after add-on change
    const policy = await storage.getPolicy(policyId, user.organizationId);
    if (policy) {
      const updated = await recalculatePolicyPremiumIfNeeded(policy, user.organizationId);
      if (updated?.premiumAmount !== policy.premiumAmount) {
        await storage.updatePolicy(policyId, { premiumAmount: updated.premiumAmount }, user.organizationId);
      }
    }
    return res.json({ ok: true });
  });

  app.get("/api/age-bands", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getAgeBandConfigs(user.organizationId));
  });

  app.post("/api/age-bands", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertAgeBandConfigSchema.parse({ ...req.body, organizationId: user.organizationId });
      const config = await storage.createAgeBandConfig(parsed);
      await auditLog(req, "CREATE_AGE_BAND", "AgeBandConfig", config.id, null, config);
      return res.status(201).json(config);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/age-bands failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/age-bands/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    try {
      const updated = await storage.updateAgeBandConfig(req.params.id as string, req.body, user.organizationId);
      if (!updated) return res.status(404).json({ message: "Not found" });
      await auditLog(req, "UPDATE_AGE_BAND", "AgeBandConfig", req.params.id as string, null, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/age-bands/:id failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Policies ───────────────────────────────────────────────

  app.get("/api/policies", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    schedulePolicyPremiumBackfill(user.organizationId);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const branchId = typeof req.query.branchId === "string" && req.query.branchId ? req.query.branchId : undefined;
    const productId = typeof req.query.productId === "string" && req.query.productId ? req.query.productId : undefined;
    const agentIdParam = typeof req.query.agentId === "string" && req.query.agentId ? req.query.agentId : undefined;
    const qRaw = typeof req.query.q === "string" ? req.query.q : typeof req.query.search === "string" ? req.query.search : "";
    const search = qRaw.trim() || undefined;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
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

    const wallet = await storage.getPolicyCreditBalance(user.organizationId, policy.id);
    const walletBalance = parseFloat(String(wallet?.balance ?? "0")) || 0;
    const { totalDue, balance, outstanding, periodsElapsed } = computePolicyOutstanding({ policy, totalPaid, walletBalance });

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
      outstanding: outstanding.toFixed(2),
      walletBalance: walletBalance.toFixed(2),
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
      const benPhone = toUpperTrim(beneficiary.phone, false) || null;
      // Dependent-linked beneficiary (dependentId is set) — phone and nationalId are optional because
      // the dependent record is the authoritative source; the policy row just caches them for convenience.
      const isDepLinked = !!beneficiary.dependentId;
      if (!benFirst || !benLast) {
        structuredLog("warn", "POST /api/policies 400", { reason: "beneficiary name missing", userId: user?.id, orgId: user?.organizationId });
        return res.status(400).json({ message: "Beneficiary first and last name are required." });
      }
      if (!benRel) {
        structuredLog("warn", "POST /api/policies 400", { reason: "beneficiary relationship missing", userId: user?.id, orgId: user?.organizationId });
        return res.status(400).json({ message: "Beneficiary relationship is required." });
      }
      if (!isDepLinked) {
        if (!benNationalId) {
          structuredLog("warn", "POST /api/policies 400", { reason: "manual beneficiary national ID missing", userId: user?.id, orgId: user?.organizationId });
          return res.status(400).json({ message: "Beneficiary national ID is required." });
        }
        if (!isValidNationalId(beneficiary.nationalId)) {
          structuredLog("warn", "POST /api/policies 400", { reason: "manual beneficiary national ID invalid", userId: user?.id, orgId: user?.organizationId });
          return res.status(400).json({ message: "Beneficiary national ID must be digits, one letter, then two digits (e.g. 08833089H38)." });
        }
        if (!benPhone) {
          structuredLog("warn", "POST /api/policies 400", { reason: "manual beneficiary phone missing", userId: user?.id, orgId: user?.organizationId });
          return res.status(400).json({ message: "Beneficiary phone is required." });
        }
      } else if (benNationalId && !isValidNationalId(beneficiary.nationalId)) {
        structuredLog("warn", "POST /api/policies 400", { reason: "dep-linked beneficiary national ID invalid format", userId: user?.id, orgId: user?.organizationId });
        return res.status(400).json({ message: "Beneficiary national ID must be digits, one letter, then two digits (e.g. 08833089H38)." });
      }
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

    const clientRow = await storage.getClient(parsed.clientId, user.organizationId);
    if (!clientRow) {
      structuredLog("warn", "POST /api/policies 400", { reason: "client not found", clientId: parsed.clientId, userId: user?.id, orgId: user?.organizationId });
      return res.status(400).json({
        message: "The selected client was not found in this organization. Refresh the page and select the client again.",
      });
    }
    const productVersion = await storage.getProductVersion(parsed.productVersionId, user.organizationId);
    if (!productVersion) {
      structuredLog("warn", "POST /api/policies 400", { reason: "product version not found", productVersionId: parsed.productVersionId, userId: user?.id, orgId: user?.organizationId });
      return res.status(400).json({
        message: "The selected product is no longer available. Please refresh and choose a product again.",
      });
    }
    const resolvedAgentId = await resolveUserIdForOrgDatabase(parsed.agentId, user.organizationId);
    let resolvedBranchId = parsed.branchId ?? null;
    if (resolvedBranchId) {
      const branchRow = await storage.getBranch(resolvedBranchId, user.organizationId);
      if (!branchRow) resolvedBranchId = null;
    }
    const changedBy = await resolveUserIdForOrgDatabase(user.id, user.organizationId);
    const policyInsert = {
      ...parsed,
      agentId: resolvedAgentId,
      branchId: resolvedBranchId,
    };

    // Prevent duplicate policies: same client + same product version (unless existing is cancelled)
    const existingForClient = await storage.getPoliciesByClient(policyInsert.clientId, user.organizationId);
    const duplicate = existingForClient.find(
      (p) => p.productVersionId === policyInsert.productVersionId && p.status !== "cancelled"
    );
    if (duplicate) {
      structuredLog("warn", "POST /api/policies 400", { reason: "duplicate policy", clientId: policyInsert.clientId, productVersionId: policyInsert.productVersionId, existingPolicyId: duplicate.id, userId: user?.id, orgId: user?.organizationId });
      return res.status(400).json({
        error: "Duplicate policy",
        message: "This client already has an active policy for this product. Cancel the existing policy first if you need to create a new one.",
      });
    }

    const authorizedDeps = cachedClientDependents ?? await storage.getDependentsByClient(policyInsert.clientId, user.organizationId);
    const authorizedDepIds = new Set(authorizedDeps.map((d: any) => d.id));

    let dependentsToAdd = members;
    if (dependentsToAdd.length === 0) {
      dependentsToAdd = authorizedDeps.map((d: any) => ({ dependentId: d.id, role: "dependent" }));
    } else {
      const illegalDep = dependentsToAdd.find((m: any) => m.dependentId && !authorizedDepIds.has(m.dependentId));
      if (illegalDep) {
        structuredLog("warn", "POST /api/policies 400", { reason: "unauthorized dependent", dependentId: illegalDep.dependentId, clientId: policyInsert.clientId, userId: user?.id, orgId: user?.organizationId });
        return res.status(400).json({ message: "One or more selected dependents do not belong to this client." });
      }
    }
    const memberRows: Array<{ clientId?: string | null; dependentId?: string | null; role: string }> = [
      { clientId: policyInsert.clientId, role: "policy_holder" },
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
    // Use per-member add-ons if provided; fall back to flat addOnIds mapped to "holder"
    const resolvedMemberAddOns: { memberRef: string; addOnId: string }[] =
      memberAddOns.length > 0
        ? memberAddOns
        : (addOnIds as string[]).map((id: string) => ({ memberRef: "holder", addOnId: id }));

    const { policy } = await storage.createPolicyWithInitialSetup(user.organizationId, {
      policy: policyInsert,
      statusHistory: {
        fromStatus: null,
        toStatus: "inactive",
        reason: "Policy created",
        changedBy,
      },
      members: memberRows,
      memberAddOns: resolvedMemberAddOns,
    });

    await auditLog(req, "CREATE_POLICY", "Policy", policy.id, null, policy);

    // Legacy/backfilled policies: auto-activate and waive waiting period immediately.
    if ((policyInsert as any).isLegacy) {
      const today = new Date().toISOString().split("T")[0];
      await storage.updatePolicy(policy.id, {
        status: "active",
        isLegacy: true,
        waitingPeriodEndDate: today,
        inceptionDate: (policyInsert as any).inceptionDate || today,
        ...(!( policyInsert as any).effectiveDate ? { effectiveDate: today } : {}),
      }, user.organizationId);
      await storage.createPolicyStatusHistory(policy.id, "inactive", "active", "Legacy policy — auto-activated on capture", changedBy || undefined, user.organizationId);
      await auditLog(req, "LEGACY_POLICY_ACTIVATED", "Policy", policy.id, { status: "inactive" }, { status: "active", isLegacy: true });
    }

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

    // Notify the issuing agent that a new policy has been created
    if (policy.agentId) {
      notifyUser(user.organizationId, policy.agentId, {
        type: "POLICY_ISSUED",
        title: "Policy Issued",
        body: `Policy ${policy.policyNumber} has been successfully created.`,
        metadata: { policyId: policy.id, policyNumber: policy.policyNumber },
      }).catch(() => {});
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

  // ─── Policy Documents ─────────────────────────────────────────────────────
  app.get("/api/policies/:id/documents", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });
    return res.json(await storage.getPolicyDocuments(policy.id, user.organizationId));
  });

  app.post("/api/policies/:id/documents", requireAuth, requireTenantScope, requirePermission("write:policy"), policyDocUpload.single("file"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    if (req.file.size === 0) return res.status(400).json({ message: "Uploaded file is empty" });
    const documentType = (req.body.documentType || "other") as string;
    const label = (req.body.label || req.file.originalname) as string;
    const { url, key } = await objectStorage.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype, "policy-documents");
    const doc = await storage.createPolicyDocument({
      organizationId: user.organizationId,
      policyId: policy.id,
      documentType,
      label,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileUrl: url,
      storageKey: key,
      fileSize: req.file.size,
      uploadedBy: user.id,
    });
    await auditLog(req, "UPLOAD_POLICY_DOCUMENT", "PolicyDocument", doc.id, null, { policyId: policy.id, documentType, fileName: req.file.originalname });
    return res.status(201).json(doc);
  });
  app.use("/api/policies/:id/documents", handleMulterError);

  app.delete("/api/policies/:id/documents/:docId", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });
    const docs = await storage.getPolicyDocuments(policy.id, user.organizationId);
    const doc = docs.find(d => d.id === req.params.docId);
    if (!doc) return res.status(404).json({ message: "Document not found" });
    if (doc.storageKey) await objectStorage.deleteFile(doc.storageKey);
    await storage.deletePolicyDocument(doc.id, user.organizationId);
    await auditLog(req, "DELETE_POLICY_DOCUMENT", "PolicyDocument", doc.id, { fileName: doc.fileName }, null);
    return res.status(204).send();
  });

  // ─── Waiting Period Waivers ───────────────────────────────────────────────
  app.post("/api/policies/:id/waiver-request", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });
    const existing = await storage.getWaiverForPolicy(policy.id, user.organizationId);
    if (existing && existing.status === "pending") return res.status(409).json({ message: "A waiver request is already pending for this policy." });
    const requestedBy = await resolveUserIdForOrgDatabase(user.id, user.organizationId) ?? user.id;
    const waiver = await storage.createWaiverRequest({
      organizationId: user.organizationId,
      policyId: policy.id,
      requestedBy,
      status: "pending",
      reason: req.body.reason || null,
      supportingNotes: req.body.supportingNotes || null,
    });
    await auditLog(req, "CREATE_WAIVER_REQUEST", "WaitingPeriodWaiver", waiver.id, null, { policyId: policy.id, reason: waiver.reason });
    return res.status(201).json(waiver);
  });

  app.get("/api/policies/:id/waiver-request", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Policy not found" });
    const waiver = await storage.getWaiverForPolicy(policy.id, user.organizationId);
    return res.json(waiver || null);
  });

  app.get("/api/waivers", requireAuth, requireTenantScope, requirePermission("manage:approvals"), async (req, res) => {
    const user = req.user as any;
    const all = await storage.getAllWaivers(user.organizationId);
    const status = req.query.status as string | undefined;
    if (status) return res.json(all.filter(w => w.status === status));
    return res.json(all);
  });

  app.post("/api/waivers/:id/resolve", requireAuth, requireTenantScope, requirePermission("manage:approvals"), async (req, res) => {
    const user = req.user as any;
    const { action, rejectionReason } = req.body;
    if (action !== "approve" && action !== "reject") return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    const waiver = await storage.getWaiverById(req.params.id as string, user.organizationId);
    if (!waiver) return res.status(404).json({ message: "Waiver not found" });
    if (waiver.status !== "pending") return res.status(400).json({ message: "This waiver has already been resolved." });
    const result = await withOrgTransaction(user.organizationId, async (txDb) => {
      // Lock the waiver row to prevent concurrent approvals
      await txDb.execute(sql`SELECT id FROM waiting_period_waivers WHERE id = ${waiver.id} FOR UPDATE`);
      const [recheck] = await txDb.select({ status: waitingPeriodWaivers.status }).from(waitingPeriodWaivers).where(eq(waitingPeriodWaivers.id, waiver.id)).limit(1);
      if (!recheck || recheck.status !== "pending") throw Object.assign(new Error("This waiver has already been resolved."), { statusCode: 400 });
      const [updated] = await txDb.update(waitingPeriodWaivers).set({
        status: action === "approve" ? "approved" : "rejected",
        resolvedBy: user.id,
        resolvedAt: new Date(),
        rejectionReason: rejectionReason || null,
      }).where(eq(waitingPeriodWaivers.id, waiver.id)).returning();
      if (action === "approve") {
        const today = new Date().toISOString().split("T")[0];
        await txDb.update(policies).set({ waitingPeriodEndDate: today }).where(eq(policies.id, waiver.policyId));
        const [policy] = await txDb.select().from(policies).where(eq(policies.id, waiver.policyId)).limit(1);
        if (policy?.status === "inactive") {
          await txDb.update(policies).set({ status: "active", inceptionDate: today, ...(!policy.effectiveDate ? { effectiveDate: today } : {}) }).where(eq(policies.id, policy.id));
          await storage.createPolicyStatusHistory(policy.id, "inactive", "active", "Waiting period waiver approved", user.id, user.organizationId);
        }
      }
      return updated;
    });
    await auditLog(req, `WAIVER_${action.toUpperCase()}`, "WaitingPeriodWaiver", waiver.id, waiver, result);
    return res.json(result);
  });

  app.patch("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    try {
    const before = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    if (isAgent && (before as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });
    // Manual premium override is gated by the dedicated edit:premium permission.
    const effPerms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const canEditPremium = !!user.isPlatformOwner || effPerms.includes("edit:premium");

    const body = { ...req.body };
    const rawPremium = body.premiumAmount;
    const premiumEffectiveDate = typeof body.premiumEffectiveDate === "string" && body.premiumEffectiveDate.trim()
      ? body.premiumEffectiveDate.trim()
      : new Date().toISOString().split("T")[0];
    const premiumChangeReason = typeof body.premiumChangeReason === "string" ? body.premiumChangeReason : null;
    delete body.premiumAmount;
    delete body.premiumEffectiveDate;
    delete body.premiumChangeReason;
    delete body.organizationId;
    delete body.id;
    delete body.createdAt;
    delete body.policyNumber;
    delete body.members;
    delete body.memberAddOns;
    delete body.addOnIds;
    delete body.beneficiary;
    if (!canEditPremium) delete body.agentId;

    const isLegacyRequest = canEditPremium && body.isLegacy === true && !before.isLegacy;
    delete body.isLegacy;

    const ALLOWED_FIELDS = new Set([
      "currency", "paymentSchedule", "effectiveDate", "branchId", "agentId", "groupId",
      "beneficiaryFirstName", "beneficiaryLastName", "beneficiaryRelationship",
      "beneficiaryNationalId", "beneficiaryPhone", "beneficiaryDependentId",
    ]);
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      sanitized[key] = value === "" ? null : value;
    }

    // Resolve a manual premium override (if permitted and actually different).
    let manualPremium: number | null = null;
    if (rawPremium != null && rawPremium !== "" && canEditPremium) {
      const parsed = parseFloat(String(rawPremium));
      const current = parseFloat(String(before.premiumAmount ?? "0"));
      if (Number.isFinite(parsed) && parsed >= 0 && Math.abs(parsed - current) >= 0.01) {
        manualPremium = parsed;
      }
    }

    if (Object.keys(sanitized).length === 0 && manualPremium == null) {
      return res.json(before);
    }

    let updated = before;
    if (Object.keys(sanitized).length > 0) {
      updated = (await storage.updatePolicy(req.params.id as string, sanitized, user.organizationId)) ?? updated;
    }

    if (manualPremium != null) {
      await reconcilePremiumChange({
        orgId: user.organizationId,
        policy: updated,
        oldPremium: before.premiumAmount,
        newPremium: manualPremium,
        effectiveDate: premiumEffectiveDate,
        changeType: "manual",
        reason: premiumChangeReason,
        actorId: user.id,
      });
      updated = (await storage.updatePolicy(req.params.id as string, { premiumAmount: manualPremium.toFixed(2) }, user.organizationId)) ?? updated;
    }

    if (isLegacyRequest) {
      const today = new Date().toISOString().split("T")[0];
      updated = (await storage.updatePolicy(req.params.id as string, {
        isLegacy: true,
        status: "active",
        waitingPeriodEndDate: today,
        inceptionDate: updated.inceptionDate || today,
        ...(!updated.effectiveDate ? { effectiveDate: today } : {}),
      }, user.organizationId)) ?? updated;
      await storage.createPolicyStatusHistory(req.params.id as string, before.status, "active", "Legacy policy — marked by admin on edit", user.id, user.organizationId);
      await auditLog(req, "LEGACY_POLICY_ACTIVATED", "Policy", req.params.id as string, before, updated);
    }

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
      const isAgent = isAgentScoped(userRoles);
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

      // "Effective from" date drives arrears/credit reconciliation — it does NOT
      // change the policy's inception (effectiveDate). Defaults to today.
      const reconcileFrom = typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
        ? req.body.effectiveDate.trim()
        : new Date().toISOString().split("T")[0];

      const oldPremium = parseFloat(String(policy.premiumAmount ?? "0"));
      const newPremium = parseFloat(String(premiumAmount));
      const recon = await reconcilePremiumChange({
        orgId: user.organizationId,
        policy,
        oldPremium,
        newPremium,
        effectiveDate: reconcileFrom,
        changeType: newPremium >= oldPremium ? "upgrade" : "downgrade",
        reason: typeof req.body.reason === "string" ? req.body.reason : "Product change",
        actorId: user.id,
      });

      const updated = await storage.updatePolicy(policy.id, {
        productVersionId: targetPv.id,
        currency,
        paymentSchedule,
        premiumAmount,
      }, user.organizationId);
      await auditLog(req, "UPGRADE_POLICY_PRODUCT", "Policy", policy.id, policy, { ...updated, reconciliation: recon });
      return res.json({ ...updated, reconciliation: recon });
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
    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(req.params.id as string, user.organizationId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }
    const policy = accessCheck.policy;

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
    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(req.params.id as string, user.organizationId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }
    const policy = accessCheck.policy;
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
    const PAYMENT_EDIT_FIELDS = new Set(["notes", "postedDate", "valueDate", "reference", "paymentMethod", "amount", "currency", "status", "branchId"]);
    const FINANCIAL_FIELDS = new Set(["amount", "currency", "status"]);
    const body: Record<string, any> = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (PAYMENT_EDIT_FIELDS.has(key)) body[key] = value;
    }
    if (before.status === "cleared") {
      for (const key of Object.keys(body)) {
        if (FINANCIAL_FIELDS.has(key)) {
          return res.status(400).json({ message: "Cannot edit amount, currency, or status on cleared payments" });
        }
      }
    }
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
    if (tx.status === "cleared") {
      return res.status(400).json({ message: "Cannot delete cleared payments. Create a reversal instead." });
    }
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
    const RECEIPT_EDIT_FIELDS = new Set(["notes", "status", "amount", "currency", "paymentChannel", "printFormat", "branchId"]);
    const FINANCIAL_RECEIPT_FIELDS = new Set(["amount", "currency", "status"]);
    const body: Record<string, any> = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (RECEIPT_EDIT_FIELDS.has(key)) body[key] = value;
    }
    if (before.status === "issued") {
      for (const key of Object.keys(body)) {
        if (FINANCIAL_RECEIPT_FIELDS.has(key)) {
          return res.status(400).json({ message: "Cannot edit amount, currency, or status on issued receipts" });
        }
      }
    }
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
    if (receipt.status === "issued") {
      return res.status(400).json({ message: "Cannot delete issued receipts. Create a reversal instead." });
    }
    await storage.deletePaymentReceipt(receipt.id, user.organizationId);
    await auditLog(req, "DELETE_RECEIPT", "PaymentReceipt", receipt.id, receipt, null);
    structuredLog("warn", "Hard-deleted receipt", { userId: user.id, email: user.email, receiptId: receipt.id, receiptNumber: receipt.receiptNumber });
    return res.json({ message: "Receipt permanently deleted" });
  });

  app.get("/api/policies/:id/members", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(req.params.id as string, user.organizationId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }
    const policy = accessCheck.policy;
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

      // Use policy.waitingPeriodEndDate as the authoritative cover date when set —
      // this is written by waiver approval, legacy flag, and manual overrides.
      // Fall back to formula only when it is absent.
      const policyWaitingEndDate = policy.waitingPeriodEndDate ? String(policy.waitingPeriodEndDate) : null;
      let coverDate: string | null = policyWaitingEndDate;
      if (!coverDate && inceptionForWaiting) {
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
      } else if (policyWaitingEndDate && policyWaitingEndDate <= today) {
        claimableReason = "Eligible for claim — waiting period waived.";
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
    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(req.params.id as string, user.organizationId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }
    const policy = accessCheck.policy;

    const { dependentId, clientId, role } = req.body;
    if (!dependentId && !clientId) return res.status(400).json({ message: "dependentId or clientId is required" });

    const oldPremium = parseFloat(String(policy.premiumAmount ?? "0"));
    const member = await storage.createPolicyMember({
      policyId: policy.id,
      organizationId: user.organizationId,
      dependentId: dependentId || null,
      clientId: clientId || null,
      role: role || "dependent",
    });
    const recalced = await recalculatePolicyPremiumIfNeeded(policy, user.organizationId);
    const newPremium = parseFloat(String(recalced?.premiumAmount ?? oldPremium));
    let reconciliation: any = null;
    if (Math.abs(newPremium - oldPremium) >= 0.01) {
      const effDate = typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
        ? req.body.effectiveDate.trim()
        : new Date().toISOString().split("T")[0];
      reconciliation = await reconcilePremiumChange({
        orgId: user.organizationId,
        policy: recalced,
        oldPremium,
        newPremium,
        effectiveDate: effDate,
        changeType: "member_add",
        reason: "Member added",
        actorId: user.id,
      });
    }
    await auditLog(req, "ADD_POLICY_MEMBER", "PolicyMember", member.id, null, { ...member, reconciliation });

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

    return res.status(201).json({ ...member, reconciliation });
  });

  app.delete("/api/policies/:id/members/:memberId", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(req.params.id as string, user.organizationId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }
    const policy = accessCheck.policy;

    const members = await storage.getPolicyMembers(policy.id, user.organizationId);
    const target = members.find((m: any) => String(m.id) === String(req.params.memberId));
    if (!target) return res.status(404).json({ message: "Member not found on this policy" });
    if (target.role === "policy_holder") {
      return res.status(400).json({ message: "The policy holder cannot be removed." });
    }

    const oldPremium = parseFloat(String(policy.premiumAmount ?? "0"));
    const removed = await storage.deactivatePolicyMember(target.id, policy.id, user.organizationId);
    const recalced = await recalculatePolicyPremiumIfNeeded(policy, user.organizationId);
    const newPremium = parseFloat(String(recalced?.premiumAmount ?? oldPremium));
    let reconciliation: any = null;
    if (Math.abs(newPremium - oldPremium) >= 0.01) {
      const effDate = typeof req.body?.effectiveDate === "string" && req.body.effectiveDate.trim()
        ? req.body.effectiveDate.trim()
        : new Date().toISOString().split("T")[0];
      reconciliation = await reconcilePremiumChange({
        orgId: user.organizationId,
        policy: recalced,
        oldPremium,
        newPremium,
        effectiveDate: effDate,
        changeType: "member_remove",
        reason: "Member removed",
        actorId: user.id,
      });
    }
    await auditLog(req, "REMOVE_POLICY_MEMBER", "PolicyMember", target.id, target, { ...removed, reconciliation });
    return res.json({ ...removed, reconciliation });
  });

  // Preview the premium + arrears/credit impact of a prospective change (product
  // switch or manual premium) before committing. Read-only — persists nothing.
  app.post("/api/policies/:id/preview-change", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(req.params.id as string, user.organizationId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }
    const policy = accessCheck.policy;
    const oldPremium = parseFloat(String(policy.premiumAmount ?? "0"));

    const currency = typeof req.body.currency === "string" && req.body.currency.trim() ? req.body.currency.trim() : (policy.currency || "USD");
    const paymentSchedule = typeof req.body.paymentSchedule === "string" && req.body.paymentSchedule.trim() ? req.body.paymentSchedule.trim() : (policy.paymentSchedule || "monthly");

    let newPremium = oldPremium;
    if (req.body.premiumAmount != null && req.body.premiumAmount !== "") {
      const effPerms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
      const canEditPremium = !!user.isPlatformOwner || effPerms.includes("edit:premium");
      const parsed = parseFloat(String(req.body.premiumAmount));
      if (canEditPremium && Number.isFinite(parsed) && parsed >= 0) newPremium = parsed;
    } else if (typeof req.body.productVersionId === "string" && req.body.productVersionId.trim()) {
      const dependentDobs = await getActivePolicyDependentDobList(policy, user.organizationId);
      const addOnIds = await getPolicyAddOnIds(policy.id, user.organizationId);
      newPremium = parseFloat(String(await computePolicyPremium(
        user.organizationId, req.body.productVersionId.trim(), currency, paymentSchedule, addOnIds, undefined, undefined, dependentDobs,
      )));
    }

    const effectiveDate = typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
      ? req.body.effectiveDate.trim()
      : new Date().toISOString().split("T")[0];
    const periods = periodsBetween(effectiveDate, new Date(), paymentSchedule);
    const reconciliation = Number(((newPremium - oldPremium) * periods).toFixed(2));
    const direction = reconciliation > 0 ? "arrears" : reconciliation < 0 ? "credit" : "none";

    return res.json({
      oldPremium: oldPremium.toFixed(2),
      newPremium: newPremium.toFixed(2),
      currency,
      effectiveDate,
      periods,
      reconciliation: reconciliation.toFixed(2),
      direction,
    });
  });

  app.post("/api/policies/:id/sync-members", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(req.params.id as string, user.organizationId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }
    const policy = accessCheck.policy;

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
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const filters = (fromDate || toDate) ? { fromDate, toDate } : undefined;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    const agentId = isAgent ? user.id : undefined;
    return res.json(await storage.getPaymentsByOrg(user.organizationId, limit, offset, filters, agentId));
  });

  app.get("/api/policies/:id/payments", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const policyId = req.params.id as string;
    const orgId = user.organizationId;

    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(policyId, orgId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }

    return res.json(await storage.getPaymentsByPolicy(policyId, orgId));
  });

  app.post("/api/payments", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer"), async (req, res) => {
    const user = req.user as any;
    try {
    const userRolesForPayment = await storage.getUserRoles(user.id, user.organizationId);
    const isAgentPayment = isAgentScoped(userRolesForPayment);
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

      // Advance the policy cover cycle N times for multi-month receipts (only when a policy is linked).
      // When months is not explicitly sent, derive it from amount / premium so advance payments
      // (e.g. paying 2× the monthly premium) automatically cover the correct number of periods.
      const monthCount = (() => {
        const explicit = req.body.months != null ? parseInt(String(req.body.months), 10) : null;
        if (explicit && Number.isFinite(explicit) && explicit >= 1) return Math.min(12, explicit);
        if (policy?.premiumAmount) {
          const prem = parseFloat(String(policy.premiumAmount));
          const amt = parseFloat(String(req.body.amount ?? 0));
          if (prem > 0 && amt > 0 && Number.isFinite(amt)) {
            return Math.min(12, Math.max(1, Math.floor(amt / prem)));
          }
        }
        return 1;
      })();
      let currentPolicy = policy;
      let paymentPeriod: { periodFrom: string; periodTo: string } = { periodFrom: today, periodTo: today };
      if (isClearedWithPolicy && parsed.policyId) {
        for (let m = 0; m < monthCount; m++) {
          const period = await advancePolicyCycle(txDb, parsed.policyId, currentPolicy, String(parsed.postedDate || today));
          if (m === 0) paymentPeriod = { periodFrom: period.periodFrom, periodTo: period.periodTo };
          else paymentPeriod.periodTo = period.periodTo;
          if (m < monthCount - 1) {
            const [refreshed] = await txDb.select().from(policies).where(eq(policies.id, parsed.policyId)).limit(1);
            if (refreshed) currentPolicy = refreshed;
          }
        }
      }

      const [tx] = await txDb.insert(paymentTransactions).values({
        ...parsed,
        periodFrom: paymentPeriod.periodFrom,
        periodTo: paymentPeriod.periodTo,
      }).returning();

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
          periodFrom: paymentPeriod.periodFrom,
          periodTo: paymentPeriod.periodTo,
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

      if (tx.status === "cleared" && tx.policyId && policy?.status === "lapsed") {
        await rollbackClawbacksInTx(txDb, user.organizationId, policy);
      }
      return { tx, receipt, policyStatusChange };
    });

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
      // Duplicate idempotency key only (not every 23505 — receipt number etc. must not map here)
      const dupMsg = String(err?.message || "");
      const dupDetail = String((err as { detail?: string })?.detail || "");
      const dupConstraint = String((err as { constraint?: string })?.constraint || "");
      const isIdempotencyDup =
        err?.code === "23505" &&
        (dupConstraint.toLowerCase().includes("idempotency") ||
          dupMsg.includes("idempotency_key") ||
          dupDetail.includes("idempotency_key"));
      if (isIdempotencyDup) {
        return res.status(409).json({
          code: "duplicate_payment_request",
          message:
            "This payment was already submitted. It was not processed twice. Check payments or receipts for the existing entry, or wait a moment and try again if you do not see it yet.",
        });
      }
      structuredLog("error", "POST /api/payments failed", { error: err?.message || String(err), stack: err?.stack });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/policies/:id/receipts", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const policyId = req.params.id as string;
    const orgId = user.organizationId;

    const accessCheck = await enforceAgentPolicyAccess(req, await storage.getPolicy(policyId, orgId));
    if (!accessCheck.hasAccess) {
      return res.status(accessCheck.errorResponse.status).json(accessCheck.errorResponse.json);
    }

    return res.json(await storage.getPaymentReceiptsByPolicy(policyId, orgId));
  });

  // ─── Payment intents (Paynow) & receipts ─────────────────────
  app.get("/api/payment-intents", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    const agentId = isAgent ? user.id : undefined;
    return res.json(await storage.getPaymentIntentsByOrg(user.organizationId, limit, agentId));
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
    const { policyId, clientId, amount, currency, purpose, idempotencyKey: clientKey } = req.body;
    if (!policyId || !clientId || amount == null) return res.status(400).json({ message: "policyId, clientId, and amount are required" });
    const parsedAmount = parsePositiveAmount(amount);
    if (parsedAmount == null) return res.status(400).json({ message: "Amount must be a positive number." });
    try {
      const policy = await storage.getPolicy(policyId, user.organizationId);
      if (!policy || policy.clientId !== clientId) {
        return res.status(400).json({ message: "clientId does not match policy owner" });
      }
      const idempotencyKey = clientKey || `staff-${user.id}-${policyId}-${String(parsedAmount)}-${purpose || "premium"}`;
      const result = await createPaymentIntent({
        organizationId: user.organizationId,
        clientId,
        policyId,
        amount: String(parsedAmount),
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

  app.get("/api/receipts/:id/download", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!user.organizationId) return res.status(400).json({ message: "Select a tenant before downloading receipts" });
    const format = req.query.format as string | undefined; // "thermal" | "a4" (default a4)
    const inline = req.query.inline === "1" || req.query.view === "1";
    if (format === "thermal") {
      const { streamThermalReceiptToResponse } = await import("./receipt-pdf");
      const rawSize = parseInt(String(req.query.size || "80"), 10);
      const size = ([48, 58, 80] as const).includes(rawSize as any) ? rawSize as 48 | 58 | 80 : 80;
      return streamThermalReceiptToResponse(id, user.organizationId, res, { attachment: !inline, size });
    }
    const { streamReceiptToResponse } = await import("./receipt-pdf");
    return streamReceiptToResponse(id, user.organizationId, res, { attachment: !inline });
  });

  // View endpoint — inline by default; ?format=thermal&size=48|58|80 for thermal roll preview
  app.get("/api/receipts/:id/view", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!user.organizationId) return res.status(400).json({ message: "Select a tenant" });
    const format = req.query.format as string | undefined;
    if (format === "thermal") {
      const { streamThermalReceiptToResponse } = await import("./receipt-pdf");
      const rawSize = parseInt(String(req.query.size || "80"), 10);
      const size = ([48, 58, 80] as const).includes(rawSize as any) ? rawSize as 48 | 58 | 80 : 80;
      return streamThermalReceiptToResponse(id, user.organizationId, res, { attachment: false, size });
    }
    const { streamReceiptToResponse } = await import("./receipt-pdf");
    return streamReceiptToResponse(id, user.organizationId, res, { attachment: false });
  });

  app.post("/api/admin/receipts/cash", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    try {
    const userRolesForCash = await storage.getUserRoles(user.id, user.organizationId);
    const isAgentCash = isAgentScoped(userRolesForCash);
    if (isAgentCash) {
      return res.status(403).json({ message: "Agents cannot process cash payments. Use a Paynow method instead." });
    }
    const { policyId, amount, currency, notes, receivedAt, idempotencyKey } = req.body;
    if (!policyId || amount == null) return res.status(400).json({ message: "policyId and amount required" });
    const parsedAmount = parsePositiveAmount(amount);
    if (parsedAmount == null) {
      return res.status(400).json({ message: "Amount must be a positive number." });
    }

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
        amount: String(parsedAmount),
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
        amount: String(parsedAmount),
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

      if (policy.status === "lapsed") {
        await rollbackClawbacksInTx(txDb, user.organizationId, policy);
      }
      return { tx, receipt };
    });

    await auditLog(req, "CASH_RECEIPT", "PaymentReceipt", result.receipt.id, null, result.receipt);

    requestOutboxDrain(user.organizationId);

    return res.status(201).json({ transaction: result.tx, receipt: result.receipt });
    } catch (err: any) {
      structuredLog("error", "POST /api/admin/receipts/cash failed", { error: err?.message || String(err), stack: err?.stack });
      return res.status(500).json({ message: safeError(err) });
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

  const memoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/\.(csv|xlsx?)$/i.test(path.extname(file.originalname))) cb(null, true);
      else cb(new Error("Only CSV or Excel files are allowed"));
    },
  });
  const MONTH_END_LOCK_KEY = 555666777;
  app.post("/api/month-end-run", requireAuth, requireTenantScope, requirePermission("write:finance"), memoryUpload.single("file"), async (req, res) => {
    const user = req.user as any;
    if (!req.file?.buffer) return res.status(400).json({ message: "No file uploaded" });
    const orgPool = await getPoolForOrg(user.organizationId);
    const lockClient = await orgPool.connect();
    const lockAcquired = (await lockClient.query("SELECT pg_try_advisory_lock($1::bigint) as acquired", [MONTH_END_LOCK_KEY])).rows[0]?.acquired;
    if (!lockAcquired) {
      lockClient.release();
      return res.status(409).json({ message: "A month-end run is already in progress for this organisation. Please wait and try again." });
    }
    try {
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
        const merKey = `MER-${runNumber}-${policyNumber}`;
        const existingMer = await storage.getPaymentTransactionByIdempotencyKey(merKey, user.organizationId);
        if (existingMer) {
          receipted++;
          continue;
        }
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
            idempotencyKey: merKey,
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
          if (policy.status === "lapsed") {
            await rollbackClawbacksInTx(txDb, user.organizationId, policy);
          }
        });
        receipted++;
        // 2.5% platform fee on month-end cleared receipt
        storage.createPlatformReceivable({
          organizationId: user.organizationId,
          amount: (premium * 0.025).toFixed(2),
          currency: policy.currency || "USD",
          description: `2.5% on month-end receipt (policy ${policyNumber})`,
          isSettled: false,
        }).catch((err: Error) => structuredLog("error", "Platform fee failed (month-end)", { policyId: policy.id, error: err.message }));
        // Post-transaction best-effort side effects
        if (policy.status === "lapsed") {
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
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1::bigint)", [MONTH_END_LOCK_KEY]).catch(() => {});
      lockClient.release();
    }
  });
  app.use("/api/month-end-run", handleMulterError);

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
    const results: { policyId: string; policyNumber: string; amount: string; receiptNumber: string; currency: string }[] = [];
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
        if (policy.status === "lapsed") {
          await rollbackClawbacksInTx(txDb, user.organizationId, policy);
        }
        results.push({ policyId: policy.id, policyNumber: policy.policyNumber, amount, receiptNumber: receiptNum, currency: polyCurrency });
      }
    });
    // 2.5% platform fee on each cleared group receipt
    for (const r of results) {
      storage.createPlatformReceivable({
        organizationId: user.organizationId,
        amount: (parseFloat(r.amount) * 0.025).toFixed(2),
        currency: r.currency,
        description: `2.5% on group receipt ${r.receiptNumber} (policy ${r.policyNumber})`,
        isSettled: false,
      }).catch((err: Error) => structuredLog("error", "Platform fee failed (group receipt)", { policyId: r.policyId, error: err.message }));
    }
    return res.status(201).json({ receipted: results.length, results });
    } catch (err: any) {
      structuredLog("error", "POST /api/group-receipt failed", { error: err?.message || String(err), stack: err?.stack });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Group PayNow (create intent, initiate, poll) ───
  app.post("/api/group-payment-intents", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const { groupId, policyIds, totalAmount, currency, idempotencyKey: clientKey } = req.body;
    if (!groupId || !Array.isArray(policyIds) || policyIds.length === 0 || totalAmount == null) {
      return res.status(400).json({ message: "groupId, policyIds (array), and totalAmount required" });
    }
    const policies = await storage.getPoliciesByIds(policyIds, user.organizationId);
    const valid = policies.filter((p) => p.groupId === groupId);
    if (valid.length === 0) return res.status(400).json({ message: "No valid policies in group" });
    const totalPremium = valid.reduce((s, p) => s + parseFloat(String(p.premiumAmount || 0)), 0);
    const amountNum = parseFloat(String(totalAmount));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ message: "totalAmount must be greater than zero" });
    }
    const cur = currency || "USD";
    const idempotencyKey = clientKey || `grp-${groupId}-${amountNum.toFixed(2)}-${valid.map((p) => p.id).sort().join(",")}`;
    const existing = await storage.getGroupPaymentIntentByOrgAndIdempotencyKey(user.organizationId, idempotencyKey);
    if (existing) return res.json(existing);
    const org = await storage.getOrganization(user.organizationId);
    const orgCode = (org?.name ?? "ORG").replace(/\s+/g, "").slice(0, 8).toUpperCase();
    const merchantReference = generateGroupMerchantReference(orgCode, groupId);
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
    const allocSum = allocations.reduce((s, a) => s + parseFloat(a.amount), 0);
    const remainder = Math.round((amountNum - allocSum) * 100) / 100;
    if (allocations.length > 0 && Math.abs(remainder) >= 0.01) {
      const last = allocations[allocations.length - 1];
      last.amount = (parseFloat(last.amount) + remainder).toFixed(2);
    }
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

  app.get("/api/paynow-config", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const cfg = await getOrgPaynowConfig(user.organizationId);
    return res.json({
      enabled: cfg.enabled,
      integrationId: cfg.integrationId,
      authEmail: cfg.authEmail,
      returnUrl: cfg.returnUrl,
      resultUrl: cfg.resultUrl,
      mode: cfg.mode,
      // Never return the key — only indicate whether one is set
      hasKey: !!cfg.integrationKey,
    });
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
    if (!date) return res.status(400).json({ message: "Query 'date' (YYYY-MM-DD) is required" });
    const result = await storage.getReceiptTotalsByUserDate(user.organizationId, user.id, date);
    return res.json(result);
  });

  app.get("/api/cashups", requireAuth, requireTenantScope, requireAnyPermission("read:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    const perms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const canReadFinance = perms.includes("read:finance");
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const filters: { fromDate?: string; toDate?: string; preparedBy?: string; status?: string } = {};
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    if (status) filters.status = status;
    if (isAgent) filters.preparedBy = user.id;
    else if (canReadFinance && userId) filters.preparedBy = userId;
    else if (!canReadFinance) filters.preparedBy = user.id;
    const list = await storage.getCashups(user.organizationId, 100, filters);
    return res.json(list);
  });

  app.post("/api/cashups", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
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
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    if ((isAgent || !perms.includes("read:finance")) && cashup.preparedBy !== user.id) return res.status(403).json({ message: "You can only view your own cashups" });
    return res.json(cashup);
  });

  app.patch("/api/cashups/:id", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group"), async (req, res) => {
    const user = req.user as any;
    const cashup = await storage.getCashup(req.params.id as string, user.organizationId);
    if (!cashup) return res.status(404).json({ message: "Not found" });
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
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

    return res.status(400).json({ message: "Invalid action or state", status: cashup.status });
  });

  // ─── Claims ─────────────────────────────────────────────────

  app.get("/api/claims", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
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
    try {
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
      const parsed = insertClaimSchema.parse({
        ...req.body,
        organizationId: user.organizationId,
        claimNumber: "PENDING",
        status: "submitted",
        submittedBy: user.id,
      });
      const claim = await withOrgTransaction(user.organizationId, async () => {
        // Generate claim number inside the transaction to prevent race-condition duplicates
        const claimNumber = await storage.generateClaimNumber(user.organizationId);
        const created = await storage.createClaim({ ...parsed, claimNumber });
        await storage.createClaimStatusHistory(created.id, null, "submitted", "Claim submitted", user.id, created.organizationId);
        return created;
      });
      await auditLog(req, "CREATE_CLAIM", "Claim", claim.id, null, claim);
      // Auto-create approval request — all claims require manager approval
      try {
        const approvalReq = await storage.createApprovalRequest({
          organizationId: user.organizationId,
          requestType: "CLAIM_REVIEW",
          entityType: "Claim",
          entityId: claim.id,
          requestData: { claimNumber: claim.claimNumber, claimType: claim.claimType, amount: claim.cashInLieuAmount },
          status: "pending",
          initiatedBy: user.id,
        });
        await notifyUsersWithPermission(user.organizationId, "manage:approvals", {
          type: "APPROVAL_NEEDED",
          title: "Claim Requires Approval",
          body: `Claim ${claim.claimNumber} has been submitted and requires your approval.`,
          metadata: { claimId: claim.id, claimNumber: claim.claimNumber, approvalId: approvalReq.id },
        });
      } catch (approvalErr: any) {
        structuredLog("warn", "Failed to auto-create claim approval", { claimId: claim.id, error: approvalErr?.message });
      }
      return res.status(201).json(claim);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/claims failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.post("/api/claims/:id/transition", requireAuth, requireTenantScope, requirePermission("write:claim"), async (req, res) => {
    const user = req.user as any;
    const claim = await storage.getClaim(req.params.id as string, user.organizationId);
    if (!claim || claim.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);

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
    await storage.createClaimStatusHistory(claim.id, claim.status, toStatus, reason, user.id, claim.organizationId);
    await auditLog(req, "TRANSITION_CLAIM", "Claim", claim.id, before, updated);
    // Notify submitter of status change
    if (claim.submittedBy && claim.submittedBy !== user.id) {
      notifyUser(claim.organizationId, claim.submittedBy, {
        type: "CLAIM_STATUS",
        title: `Claim ${toStatus.charAt(0).toUpperCase() + toStatus.slice(1)}`,
        body: `Claim ${claim.claimNumber} has been ${toStatus}${reason ? `: ${reason}` : ""}.`,
        metadata: { claimId: claim.id, claimNumber: claim.claimNumber, toStatus },
      }).catch(() => {});
    }
    // Notify client
    if (claim.clientId) {
      const statusLabel = toStatus.charAt(0).toUpperCase() + toStatus.slice(1);
      notifyClientPush(claim.organizationId, claim.clientId, `Claim ${statusLabel}`, `Your claim ${claim.claimNumber} has been ${toStatus}.`, claim.policyId ?? undefined).catch(() => {});
    }
    return res.json(updated);
  });

  app.get("/api/claims/:id/documents", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getClaimDocuments(req.params.id as string, user.organizationId));
  });

  // ─── Funeral Cases ──────────────────────────────────────────

  app.get("/api/funeral-cases", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
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
    const quotationId = typeof req.body.quotationId === "string" && req.body.quotationId ? req.body.quotationId : null;
    if (req.body.serviceType === "cash") {
      if (!quotationId) {
        return res.status(422).json({ message: "A quotation must be linked before creating a cash service case." });
      }
      const quote = await storage.getQuotationById(quotationId, user.organizationId);
      if (!quote) return res.status(422).json({ message: "Quotation not found." });
      if (quote.funeralCaseId) return res.status(422).json({ message: "This quotation is already linked to another funeral case." });
    }
    const caseNumber = await storage.generateCaseNumber(user.organizationId);
    const caseBody = { ...req.body };
    for (const f of ["bodyWashTime", "burialDepartureTime", "memorialServiceStart", "memorialServiceEnd", "slaDeadline", "completedAt"]) {
      if (caseBody[f] && typeof caseBody[f] === "string") { const d = new Date(caseBody[f]); caseBody[f] = isNaN(d.getTime()) ? undefined : d; }
      else if (!caseBody[f]) caseBody[f] = undefined;
    }
    const userIdsToMirrorFuneralCreate = [user.id, caseBody.removalDriverId, caseBody.burialDriverId, caseBody.attendingAgentId, caseBody.assignedTo]
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    for (const uid of userIdsToMirrorFuneralCreate) {
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, uid);
    }
    const parsed = insertFuneralCaseSchema.parse({
      ...caseBody,
      organizationId: user.organizationId,
      caseNumber,
      status: "open",
    });
    const fc = await storage.createFuneralCase(parsed);
    if (req.body.serviceType === "cash" && quotationId) {
      await storage.linkQuotationToCase(quotationId, fc.id, user.organizationId);
    }
    await auditLog(req, "CREATE_FUNERAL_CASE", "FuneralCase", fc.id, null, fc);
    return res.status(201).json(fc);
  });

  app.patch("/api/funeral-cases/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const caseId = req.params.id as string;
    try {
      const before = await storage.getFuneralCase(caseId, user.organizationId);
      if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });

      // Whitelist: only pass known funeralCases column names to Drizzle
      const ALLOWED = new Set([
        "deceasedName", "deceasedDob", "deceasedGender", "deceasedNationalId", "deceasedRelationship",
        "dateOfDeath", "causeOfDeath", "placeOfDeath",
        "informantName", "informantPhone", "informantRelationship",
        "serviceType", "funeralDate", "funeralLocation",
        "removalLocation", "removalVehicleId", "removalDriverId",
        "burialVehicleId", "burialDriverId", "attendingAgentId",
        "bodyWashTime", "burialDepartureTime", "memorialServiceStart", "memorialServiceEnd",
        "bodyIdentifierName", "bodyIdentifierIdNumber",
        "status", "assignedTo", "notes", "slaDeadline", "completedAt",
        "branchId", "claimId", "policyId",
      ]);
      const VALID_CASE_STATUSES = new Set(["open", "in_progress", "completed", "cancelled"]);
      if ("status" in req.body && !VALID_CASE_STATUSES.has(req.body.status)) {
        return res.status(400).json({ message: `Invalid status "${req.body.status}". Must be one of: open, in_progress, completed, cancelled` });
      }
      const sanitized: Record<string, any> = {};
      for (const [k, v] of Object.entries(req.body)) {
        if (!ALLOWED.has(k)) continue;
        sanitized[k] = v === "" ? null : v;
      }
      // Coerce datetime-local strings to Date objects for timestamp columns
      for (const f of ["bodyWashTime", "burialDepartureTime", "memorialServiceStart", "memorialServiceEnd", "slaDeadline", "completedAt"]) {
        if (sanitized[f] && typeof sanitized[f] === "string") {
          const d = new Date(sanitized[f]);
          sanitized[f] = isNaN(d.getTime()) ? null : d;
        }
      }
      const userIdsToMirrorFuneralPatch = [sanitized.removalDriverId, sanitized.burialDriverId, sanitized.attendingAgentId, sanitized.assignedTo]
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      for (const uid of userIdsToMirrorFuneralPatch) {
        await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, uid);
      }
      const updated = await storage.updateFuneralCase(caseId, sanitized, user.organizationId);
      await auditLog(req, "UPDATE_FUNERAL_CASE", "FuneralCase", caseId, before, updated);

      // Notify newly assigned drivers/agents immediately with full trip details
      const tripDate = sanitized.funeralDate || sanitized.burialDepartureTime;
      const location = sanitized.funeralLocation || sanitized.removalLocation;
      const deceased = before.deceasedName || "Deceased";
      const notifyIfAssigned = async (fieldKey: string, newId: string | null | undefined, role: string) => {
        if (!newId || (before as any)[fieldKey] === newId) return;
        notifyUser(user.organizationId, newId, {
          type: "TRIP_ASSIGNED",
          title: "Trip Assignment",
          body: `You have been assigned as ${role} for ${deceased}'s funeral${tripDate ? ` on ${new Date(tripDate).toLocaleString("en-GB")}` : ""}${location ? ` at ${location}` : ""}.`,
          metadata: { funeralCaseId: caseId, role, funeralDate: tripDate, location, deceasedName: deceased },
        }).catch(() => {});
      };
      await Promise.all([
        notifyIfAssigned("removalDriverId", sanitized.removalDriverId, "Removal Driver"),
        notifyIfAssigned("burialDriverId", sanitized.burialDriverId, "Burial Driver"),
        notifyIfAssigned("attendingAgentId", sanitized.attendingAgentId, "Attending Agent"),
        notifyIfAssigned("assignedTo", sanitized.assignedTo, "Case Manager"),
      ]);

      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/funeral-cases/:id failed", { error: err?.message, stack: err?.stack, caseId });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/funeral-cases/:id/document", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamFuneralDocumentToResponse } = await import("./funeral-document");
    await streamFuneralDocumentToResponse(req.params.id as string, user.organizationId, res, {
      attachment: req.query.download === "1",
    });
  });

  app.get("/api/funeral-cases/:id/tasks", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getFuneralTasks(req.params.id as string, user.organizationId));
  });

  app.post("/api/funeral-cases/:id/tasks", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    try {
      const fc = await storage.getFuneralCase(req.params.id as string, user.organizationId);
      if (!fc || fc.organizationId !== user.organizationId) return res.status(404).json({ message: "Funeral case not found" });
      if (req.body.assignedTo && typeof req.body.assignedTo === "string") {
        await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, req.body.assignedTo);
      }
      const parsed = insertFuneralTaskSchema.parse({ ...req.body, funeralCaseId: req.params.id as string, organizationId: user.organizationId });
      const task = await storage.createFuneralTask(parsed);
      await auditLog(req, "CREATE_FUNERAL_TASK", "FuneralTask", task.id, null, task);
      return res.status(201).json(task);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/funeral-cases/:id/tasks failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/funeral-tasks/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    try {
      if (req.body.assignedTo && typeof req.body.assignedTo === "string") {
        await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, req.body.assignedTo);
      }
      const updated = await storage.updateFuneralTask(id, nullifyEmptyFields(req.body, ["dueDate", "completedAt"]), user.organizationId);
      if (!updated) return res.status(404).json({ message: "Funeral task not found" });
      await auditLog(req, "UPDATE_FUNERAL_TASK", "FuneralTask", id, null, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/funeral-tasks/:id failed", { error: err?.message, id });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // Driver checklist for a funeral case
  app.get("/api/funeral-cases/:id/driver-checklist", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const cl = await storage.getDriverChecklist(req.params.id as string, user.organizationId);
    return res.json(cl ?? null);
  });

  app.post("/api/funeral-cases/:id/driver-checklist", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    try {
      const fc = await storage.getFuneralCase(req.params.id as string, user.organizationId);
      if (!fc) return res.status(404).json({ message: "Funeral case not found" });
      // Mirror the authenticated user into the org DB so the preparedByUserId FK resolves
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
      // Also mirror the selected driver — driverId comes from req.body and is a different user
      if (req.body.driverId && typeof req.body.driverId === "string") {
        await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, req.body.driverId);
      }
      const clBody = { ...req.body };
      // Coerce datetime-local string to Date
      if (clBody.completedAt && typeof clBody.completedAt === "string") { const d = new Date(clBody.completedAt); clBody.completedAt = isNaN(d.getTime()) ? undefined : d; }
      else if (!clBody.completedAt) clBody.completedAt = undefined;
      // Coerce numeric fields: empty string → null, number → string (drizzle-zod numeric = z.string())
      for (const f of ["tollGateAmount", "driverAllowance"]) {
        if (clBody[f] === "" || clBody[f] === null || clBody[f] === undefined) clBody[f] = null;
        else if (typeof clBody[f] === "number") clBody[f] = String(clBody[f]);
      }
      const parsed = insertDriverChecklistSchema.parse({
        ...clBody,
        funeralCaseId: req.params.id as string,
        organizationId: user.organizationId,
        preparedByUserId: user.id,
      });
      const cl = await storage.upsertDriverChecklist(req.params.id as string, user.organizationId, parsed);
      await auditLog(req, "UPSERT_DRIVER_CHECKLIST", "DriverChecklist", cl.id, null, cl);
      return res.json(cl);
    } catch (err: any) {
      structuredLog("error", "POST driver-checklist failed", { error: err?.message, caseId: req.params.id });
      if (handleZodError(err, res)) return;
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/funeral-cases/:id/driver-checklist/pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamDriverChecklistPDF } = await import("./driver-checklist-pdf");
    await streamDriverChecklistPDF(req.params.id as string, user.organizationId, res, {
      attachment: req.query.download === "1",
    });
  });

  // ─── Daily Schedule of Service PDF ─────────────────────────

  app.get("/api/schedule/pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    // Default to tomorrow
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const defaultDate = tomorrow.toISOString().slice(0, 10);
    const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : defaultDate;
    const { streamDailyScheduleToResponse } = await import("./schedule-pdf");
    await streamDailyScheduleToResponse(user.organizationId, date, res, { attachment: req.query.download === "1" });
  });

  // ─── Department Reports PDF ────────────────────────────────

  app.get("/api/department-report/pdf", requireAuth, requireTenantScope, requirePermission("read:report"), async (req, res) => {
    const user = req.user as any;
    const validDepts = ["funeral", "finance", "hr", "mortuary", "sales", "claims"] as const;
    const dept = req.query.dept as string;
    if (!validDepts.includes(dept as any)) return res.status(400).json({ message: `dept must be one of: ${validDepts.join(", ")}` });

    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = today.slice(0, 8) + "01";
    const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : firstOfMonth;
    const to = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : today;

    const { streamDepartmentReportToResponse } = await import("./department-report-pdf");
    await streamDepartmentReportToResponse(user.organizationId, dept as any, from, to, res, { attachment: req.query.download === "1" });
  });

  // Linked mortuary intake for a funeral case
  app.get("/api/funeral-cases/:id/mortuary-intake", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const intakes = await storage.getMortuaryIntakesByOrg(user.organizationId, { funeralCaseId: req.params.id as string, limit: 1 });
    return res.json(intakes[0] ?? null);
  });

  // ─── Partner Parlours ─────────────────────────────────────────────────────────

  app.get("/api/partner-parlours", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getPartnerParlours(user.organizationId));
  });

  app.post("/api/partner-parlours", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertPartnerParlourSchema.parse({ ...req.body, organizationId: user.organizationId });
      const parlour = await storage.createPartnerParlour(parsed);
      await auditLog(req, "CREATE_PARTNER_PARLOUR", "PartnerParlour", parlour.id, null, parlour);
      return res.status(201).json(parlour);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/partner-parlours/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertPartnerParlourSchema.partial().parse(req.body);
      const parlour = await storage.updatePartnerParlour(req.params.id as string, parsed, user.organizationId);
      await auditLog(req, "UPDATE_PARTNER_PARLOUR", "PartnerParlour", parlour.id, null, parlour);
      return res.json(parlour);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Mortuary Register ──────────────────────────────────────

  app.get("/api/mortuary-intakes", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : undefined;
    return res.json(await storage.getMortuaryIntakesByOrg(user.organizationId, { status, limit, offset }));
  });

  app.post("/api/mortuary-intakes", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    try {
      const intakeNumber = await storage.generateIntakeNumber(user.organizationId);
      const body = { ...req.body };
      for (const f of ["removalDateTime", "receivedAt"]) {
        if (body[f] && typeof body[f] === "string") { const d = new Date(body[f]); body[f] = isNaN(d.getTime()) ? undefined : d; }
        else if (!body[f]) body[f] = undefined;
      }
      const userIdsToMirrorIntake = [body.removalDriverId, body.receivedByUserId]
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      for (const uid of userIdsToMirrorIntake) {
        await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, uid);
      }
      // Auto-calculate storage fee for partner parlour intakes
      if (body.partnerParlourId) {
        body.storageFeeAmount = body.storageCategory === "child" ? "10.00" : "20.00";
        body.storageFeeCurrency = "USD";
        if (!body.storageFeeStatus) body.storageFeeStatus = "unpaid";
        if (body.storageFeeStatus === "paid_at_admission" && !body.storageFeePaidAt) {
          body.storageFeePaidAt = new Date();
        }
      }
      const parsed = insertMortuaryIntakeSchema.parse({ ...body, organizationId: user.organizationId, intakeNumber });
      const intake = await storage.createMortuaryIntake(parsed);
      await auditLog(req, "CREATE_MORTUARY_INTAKE", "MortuaryIntake", intake.id, null, intake);
      return res.status(201).json(intake);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/mortuary-intakes failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/mortuary-intakes/:id", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const intake = await storage.getMortuaryIntake(req.params.id as string, user.organizationId);
    if (!intake) return res.status(404).json({ message: "Mortuary intake not found" });
    return res.json(intake);
  });

  app.patch("/api/mortuary-intakes/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getMortuaryIntake(req.params.id as string, user.organizationId);
    if (!before) return res.status(404).json({ message: "Mortuary intake not found" });
    const patchBody = { ...req.body };
    for (const f of ["removalDateTime", "receivedAt"]) {
      if (patchBody[f] && typeof patchBody[f] === "string") { const d = new Date(patchBody[f]); patchBody[f] = isNaN(d.getTime()) ? null : d; }
      else if (patchBody[f] === "" ) patchBody[f] = null;
    }
    const userIdsToMirrorIntakePatch = [patchBody.removalDriverId, patchBody.receivedByUserId]
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    for (const uid of userIdsToMirrorIntakePatch) {
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, uid);
    }
    const safeBody = insertMortuaryIntakeSchema.partial().parse(patchBody);
    const updated = await storage.updateMortuaryIntake(req.params.id as string, safeBody, user.organizationId);
    await auditLog(req, "UPDATE_MORTUARY_INTAKE", "MortuaryIntake", req.params.id as string, before, updated);
    return res.json(updated);
  });

  // Storage payment
  app.post("/api/mortuary-intakes/:id/storage-payment", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const intake = await storage.getMortuaryIntake(req.params.id as string, user.organizationId);
    if (!intake) return res.status(404).json({ message: "Mortuary intake not found" });
    if (!intake.partnerParlourId) return res.status(400).json({ message: "This intake is not attributed to a partner parlour" });
    if (intake.storageFeeStatus !== "unpaid") return res.status(400).json({ message: "Storage fee is already paid" });
    const { paidBy, paidAt, status } = req.body;
    if (!paidBy) return res.status(400).json({ message: "paidBy is required" });
    if (!["paid_at_admission", "paid_at_collection"].includes(status)) return res.status(400).json({ message: "status must be paid_at_admission or paid_at_collection" });
    const before = intake;
    const updated = await storage.recordStoragePayment(req.params.id as string, user.organizationId, {
      storageFeePaidBy: paidBy,
      storageFeePaidAt: paidAt ? new Date(paidAt) : new Date(),
      storageFeeStatus: status,
    });
    await auditLog(req, "RECORD_STORAGE_PAYMENT", "MortuaryIntake", req.params.id as string, before, updated);
    return res.json(updated);
  });

  // Dispatch
  app.get("/api/mortuary-intakes/:id/dispatch", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const dispatch = await storage.getMortuaryDispatch(req.params.id as string, user.organizationId);
    return res.json(dispatch ?? null);
  });

  app.post("/api/mortuary-intakes/:id/dispatch", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const intake = await storage.getMortuaryIntake(req.params.id as string, user.organizationId);
    if (!intake) return res.status(404).json({ message: "Mortuary intake not found" });
    // Block release if partner parlour storage fee is unpaid
    if (intake.partnerParlourId && intake.storageFeeStatus === "unpaid") {
      return res.status(400).json({ message: "Storage fee must be paid before this body can be released. Record payment first." });
    }
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
    const dispatchBody = { ...req.body };
    if (dispatchBody.dispatchedAt && typeof dispatchBody.dispatchedAt === "string") { const d = new Date(dispatchBody.dispatchedAt); dispatchBody.dispatchedAt = isNaN(d.getTime()) ? undefined : d; }
    else if (!dispatchBody.dispatchedAt) dispatchBody.dispatchedAt = undefined;
    const parsed = insertMortuaryDispatchSchema.parse({
      ...dispatchBody,
      intakeId: req.params.id as string,
      organizationId: user.organizationId,
      dispatchedByUserId: user.id,
    });
    // dispatchIntake atomically writes dispatch record + sets intake status in one transaction
    const dispatch = await storage.dispatchIntake(req.params.id as string, user.organizationId, parsed);
    await auditLog(req, "DISPATCH_BODY", "MortuaryDispatch", dispatch.id, null, dispatch);
    return res.json(dispatch);
  });

  // Belongings
  app.get("/api/mortuary-intakes/:id/belongings", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getDeceasedBelongings(req.params.id as string, user.organizationId));
  });

  app.post("/api/mortuary-intakes/:id/belongings", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const intake = await storage.getMortuaryIntake(req.params.id as string, user.organizationId);
    if (!intake) return res.status(404).json({ message: "Mortuary intake not found" });
    if (req.body.receivedByUserId && typeof req.body.receivedByUserId === "string") {
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, req.body.receivedByUserId);
    }
    const parsed = insertDeceasedBelongingSchema.parse({
      ...req.body,
      intakeId: req.params.id as string,
      organizationId: user.organizationId,
    });
    const item = await storage.addDeceasedBelonging(parsed);
    await auditLog(req, "CREATE_BELONGING", "DeceasedBelonging", item.id, null, item);
    return res.status(201).json(item);
  });

  app.delete("/api/belongings/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    await storage.deleteDeceasedBelonging(req.params.id as string, user.organizationId);
    await auditLog(req, "DELETE_BELONGING", "DeceasedBelonging", req.params.id as string, null, null);
    return res.status(204).end();
  });

  // Body wash requirements
  app.get("/api/mortuary-intakes/:id/body-wash", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const bw = await storage.getBodyWashRequirements(req.params.id as string, user.organizationId);
    return res.json(bw ?? null);
  });

  app.post("/api/mortuary-intakes/:id/body-wash", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const intake = await storage.getMortuaryIntake(req.params.id as string, user.organizationId);
    if (!intake) return res.status(404).json({ message: "Mortuary intake not found" });
    if (req.body.completedByUserId && typeof req.body.completedByUserId === "string") {
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, req.body.completedByUserId);
    }
    const washBody = { ...req.body };
    if (washBody.completedAt && typeof washBody.completedAt === "string") { const d = new Date(washBody.completedAt); washBody.completedAt = isNaN(d.getTime()) ? undefined : d; }
    else if (!washBody.completedAt) washBody.completedAt = undefined;
    const parsed = insertBodyWashRequirementSchema.parse({
      ...washBody,
      intakeId: req.params.id as string,
      organizationId: user.organizationId,
    });
    const bw = await storage.upsertBodyWashRequirements(req.params.id as string, user.organizationId, parsed);
    await auditLog(req, "UPSERT_BODY_WASH", "BodyWashRequirement", req.params.id as string, null, bw);
    return res.json(bw);
  });

  // Printable PDFs
  app.get("/api/mortuary-intakes/:id/receipt-pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamMortuaryReceiptPDF } = await import("./mortuary-document");
    await streamMortuaryReceiptPDF(req.params.id as string, user.organizationId, res, {
      attachment: req.query.download === "1",
    });
  });

  app.get("/api/mortuary-intakes/:id/dispatch-pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamMortuaryDispatchPDF } = await import("./mortuary-document");
    await streamMortuaryDispatchPDF(req.params.id as string, user.organizationId, res, {
      attachment: req.query.download === "1",
    });
  });

  // ─── Fleet ──────────────────────────────────────────────────

  app.get("/api/fleet", requireAuth, requireTenantScope, requirePermission("read:fleet"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const rows = await storage.getFleetVehicles(user.organizationId);
    return res.json(rows.slice(offset, offset + limit));
  });

  app.post("/api/fleet", requireAuth, requireTenantScope, requirePermission("write:fleet"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertFleetVehicleSchema.parse({ ...req.body, organizationId: user.organizationId });
      const vehicle = await storage.createFleetVehicle(parsed);
      await auditLog(req, "CREATE_VEHICLE", "FleetVehicle", vehicle.id, null, vehicle);
      return res.status(201).json(vehicle);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/fleet failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Commissions ────────────────────────────────────────────

  app.get("/api/commission-plans", requireAuth, requireTenantScope, requirePermission("read:commission"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getCommissionPlans(user.organizationId));
  });

  app.post("/api/commission-plans", requireAuth, requireTenantScope, requirePermission("write:commission"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertCommissionPlanSchema.parse({ ...req.body, organizationId: user.organizationId });
      const plan = await storage.createCommissionPlan(parsed);
      await auditLog(req, "CREATE_COMMISSION_PLAN", "CommissionPlan", plan.id, null, plan);
      return res.status(201).json(plan);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/commission-plans failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/commission-ledger", requireAuth, requireTenantScope, requirePermission("read:commission"), async (req, res) => {
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    const agentId = req.query.agentId as string | undefined;
    const filterAgent = isAgent ? user.id : agentId;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const rows = await storage.getCommissionLedgerDetailedByOrg(user.organizationId, filterAgent);
    return res.json(rows.slice(offset, offset + limit));
  });

  // ─── Leads / Pipeline ──────────────────────────────────────

  app.get("/api/leads", requireAuth, requireTenantScope, requirePermission("read:lead"), async (req, res) => {
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    const user = req.user as any;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    const list = isAgent
      ? (await storage.getLeadsByAgent(user.id, user.organizationId)).slice(offset, offset + limit)
      : await storage.getLeadsByOrg(user.organizationId, limit, offset);
    return res.json(list);
  });

  app.post("/api/leads", requireAuth, requireTenantScope, requirePermission("write:lead"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertLeadSchema.parse({ ...req.body, organizationId: user.organizationId });
      const lead = await storage.createLead(parsed);
      await auditLog(req, "CREATE_LEAD", "Lead", lead.id, null, lead);
      return res.status(201).json(lead);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/leads failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/leads/:id", requireAuth, requireTenantScope, requirePermission("write:lead"), async (req, res) => {
    const user = req.user as any;
    try {
      const before = await storage.getLead(req.params.id as string, user.organizationId);
      if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
      const userRoles = await storage.getUserRoles(user.id, user.organizationId);
      const isAgent = isAgentScoped(userRoles);
      if (isAgent && (before as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });
      const updated = await storage.updateLead(req.params.id as string, req.body, user.organizationId);
      await auditLog(req, "UPDATE_LEAD", "Lead", req.params.id as string, before, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/leads/:id failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
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
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
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
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = isAgentScoped(userRoles);
    if (isAgent) return res.json([]);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const filters = (fromDate || toDate) ? { fromDate, toDate } : undefined;
    return res.json(await storage.getExpenditures(user.organizationId, limit, offset, filters));
  });

  app.post("/api/expenditures", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    try {
      if (req.body.approvedBy && typeof req.body.approvedBy === "string") {
        await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, req.body.approvedBy);
      }
      const parsed = insertExpenditureSchema.parse({ ...req.body, organizationId: user.organizationId });
      const exp = await storage.createExpenditure(parsed);
      await auditLog(req, "CREATE_EXPENDITURE", "Expenditure", exp.id, null, exp);
      return res.status(201).json(exp);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/expenditures failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── FX Rates (USD base for consolidated statements) ────────

  app.get("/api/fx-rates", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getFxRates(user.organizationId));
  });

  app.put("/api/fx-rates/:currency", requireAuth, requireTenantScope, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    const currency = String(req.params.currency).toUpperCase();
    const rate = parseFloat(String(req.body.rateToUsd));
    if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ message: "rateToUsd must be a positive number" });
    const saved = await storage.upsertFxRate(user.organizationId, currency, rate.toString(), user.id);
    await auditLog(req, "UPSERT_FX_RATE", "FxRate", saved.id, null, saved);
    return res.json(saved);
  });

  // ─── Requisitions (expenditure request → approve → pay) ─────

  app.get("/api/requisitions", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const reqs = await storage.getRequisitions(user.organizationId, { status, fromDate, toDate });

    // Attach line items and requester profile in one pass.
    const ids = reqs.map(r => r.id);
    const seen = new Set<string>();
    const requesterIds: string[] = [];
    for (const r of reqs) { if (r.requestedBy && !seen.has(r.requestedBy)) { seen.add(r.requestedBy); requesterIds.push(r.requestedBy); } }
    const [allItems, requesterList] = await Promise.all([
      ids.length > 0 ? storage.getRequisitionItemsByIds(ids, user.organizationId) : Promise.resolve([]),
      requesterIds.length > 0 ? storage.getUsersByIds(requesterIds) : Promise.resolve([]),
    ]);
    const itemMap = new Map<string, any[]>();
    for (const item of allItems) {
      if (!itemMap.has(item.requisitionId)) itemMap.set(item.requisitionId, []);
      itemMap.get(item.requisitionId)!.push(item);
    }
    const requesterMap = new Map(requesterList.map((u: any) => [u.id, u]));
    return res.json(reqs.map(r => {
      const requester = requesterMap.get(r.requestedBy) as any;
      return {
        ...r,
        items: itemMap.get(r.id) ?? [],
        requesterName: requester?.displayName || requester?.email || "Unknown",
        requesterDepartment: requester?.department || null,
      };
    }));
  });

  app.post("/api/requisitions", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const requisitionNumber = `REQ-${Date.now().toString(36).toUpperCase()}`;
    const submit = req.body.submit === true || req.body.status === "submitted";

    // Calculate total from line items if provided.
    const rawItems: Array<{ description: string; category: string; qty: any; unitPrice: any }> =
      Array.isArray(req.body.items) ? req.body.items : [];
    const itemsTotal = rawItems.reduce((sum, it) => sum + Number(it.qty || 1) * Number(it.unitPrice || 0), 0);
    const amount = rawItems.length > 0 ? itemsTotal.toFixed(2) : req.body.amount;

    const parsed = insertRequisitionSchema.parse({
      ...req.body,
      amount,
      organizationId: user.organizationId,
      requisitionNumber,
      requestedBy: user.id,
      status: submit ? "submitted" : "draft",
      neededByDate: req.body.neededByDate || null,
      approvedBy: null, approvedAt: null, paidBy: null, paidAt: null,
    });
    let created: any;
    try {
      created = await storage.createRequisition(parsed);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/requisitions failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }

    let savedItems: any[] = [];
    if (rawItems.length > 0) {
      try {
        const toInsert = rawItems.map(it => insertRequisitionItemSchema.parse({
          requisitionId: created.id,
          organizationId: user.organizationId,
          description: String(it.description || "").trim(),
          category: String(it.category || "").trim(),
          qty: String(Number(it.qty) > 0 ? Number(it.qty) : 1),
          unitPrice: String(Number(it.unitPrice)),
          total: String((Number(it.qty || 1) * Number(it.unitPrice || 0)).toFixed(2)),
        }));
        savedItems = await storage.createRequisitionItems(toInsert);
      } catch (err: any) {
        structuredLog("error", "POST /api/requisitions items failed", { error: err?.message });
      }
    }

    await auditLog(req, "CREATE_REQUISITION", "Requisition", created.id, null, { ...created, items: savedItems });
    return res.status(201).json({ ...created, items: savedItems });
  });

  app.patch("/api/requisitions/:id", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const existing = await storage.getRequisition(req.params.id as string, user.organizationId);
    if (!existing) return res.status(404).json({ message: "Requisition not found" });
    const action = String(req.body.action || "");
    const effPerms = await storage.getUserEffectivePermissions(user.id, user.organizationId);
    const canApprove = !!user.isPlatformOwner || effPerms.includes("approve:finance");
    const today = new Date().toISOString().split("T")[0];
    const patch: Record<string, any> = {};

    if (action === "submit") {
      if (existing.status !== "draft") return res.status(400).json({ message: "Only draft requisitions can be submitted" });
      patch.status = "submitted";
    } else if (action === "approve" || action === "reject") {
      if (!canApprove) return res.status(403).json({ message: "Requires approve:finance" });
      if (existing.status !== "submitted") return res.status(400).json({ message: "Only submitted requisitions can be approved or rejected" });
      patch.status = action === "approve" ? "approved" : "rejected";
      patch.approvedBy = user.id;
      patch.approvedAt = new Date();
      if (action === "reject") patch.rejectionReason = typeof req.body.rejectionReason === "string" ? req.body.rejectionReason : "Rejected";
      // Approver may adjust the amount before approving
      if (action === "approve" && req.body.adjustedAmount !== undefined) {
        const adj = Number(req.body.adjustedAmount);
        if (!isNaN(adj) && adj > 0) patch.amount = adj.toFixed(2);
      }
      if (typeof req.body.approverNotes === "string" && req.body.approverNotes.trim()) {
        patch.approverNotes = req.body.approverNotes.trim();
      }
    } else if (action === "pay") {
      if (existing.status !== "approved") return res.status(400).json({ message: "Only approved requisitions can be marked paid" });
      patch.status = "paid";
      patch.paidBy = user.id;
      patch.paidAt = new Date();
      patch.paidDate = typeof req.body.paidDate === "string" && req.body.paidDate ? req.body.paidDate : today;
      if (typeof req.body.paymentMethod === "string") patch.paymentMethod = req.body.paymentMethod;
      if (typeof req.body.reference === "string") patch.reference = req.body.reference;
    } else {
      // Plain edit (only while draft)
      if (existing.status !== "draft") return res.status(400).json({ message: "Only draft requisitions can be edited" });
      for (const k of ["category", "description", "payee", "amount", "currency", "branchId", "notes", "neededByDate"]) {
        if (req.body[k] !== undefined) patch[k] = req.body[k] === "" ? null : req.body[k];
      }
    }

    const updated = await storage.updateRequisition(req.params.id as string, user.organizationId, patch);
    await auditLog(req, "UPDATE_REQUISITION", "Requisition", existing.id, existing, updated);

    // ── Notifications ──────────────────────────────────────
    const reqNum = existing.requisitionNumber;
    const orgId = user.organizationId;
    if (action === "submit") {
      // Tell approvers there's a new requisition waiting.
      notifyUsersWithPermission(orgId, "approve:finance", {
        type: "APPROVAL_NEEDED",
        title: "Requisition awaiting approval",
        body: `${reqNum} submitted by ${user.displayName || user.email} requires your approval.`,
        metadata: { requisitionId: existing.id },
      });
    } else if (action === "approve") {
      // Tell requester it was approved.
      notifyUser(orgId, existing.requestedBy, {
        type: "APPROVAL_RESOLVED",
        title: "Requisition approved",
        body: `Your requisition ${reqNum} has been approved${patch.approverNotes ? `: ${patch.approverNotes}` : "."}`,
        metadata: { requisitionId: existing.id },
      });
      // Tell finance team to make the payment.
      notifyUsersWithPermission(orgId, "write:finance", {
        type: "GENERAL",
        title: "Requisition ready for payment",
        body: `${reqNum} has been approved and is ready to be paid (${existing.currency} ${Number(patch.amount || existing.amount).toFixed(2)}).`,
        metadata: { requisitionId: existing.id },
      });
    } else if (action === "reject") {
      notifyUser(orgId, existing.requestedBy, {
        type: "APPROVAL_RESOLVED",
        title: "Requisition rejected",
        body: `Your requisition ${reqNum} was rejected${patch.rejectionReason ? `: ${patch.rejectionReason}` : "."}`,
        metadata: { requisitionId: existing.id },
      });
    } else if (action === "pay") {
      notifyUser(orgId, existing.requestedBy, {
        type: "PAYMENT_RECEIVED",
        title: "Requisition paid",
        body: `Your requisition ${reqNum} has been marked as paid.`,
        metadata: { requisitionId: existing.id },
      });
    }

    return res.json(updated);
  });

  // ─── Debit Orders (recurring premium-collection mandates) ────
  app.get("/api/debit-orders", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const policyId = typeof req.query.policyId === "string" && req.query.policyId ? req.query.policyId : undefined;
    return res.json(await storage.getDebitOrders(user.organizationId, { status, policyId }));
  });

  app.post("/api/debit-orders", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const mandateReference = typeof req.body.mandateReference === "string" && req.body.mandateReference.trim()
      ? req.body.mandateReference.trim()
      : `DO-${Date.now().toString(36).toUpperCase()}`;
    const parsed = insertDebitOrderSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      mandateReference,
      status: "active",
      createdBy: user.id,
    });
    let created: any;
    try {
      created = await storage.createDebitOrder(parsed);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/debit-orders failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
    await auditLog(req, "CREATE_DEBIT_ORDER", "DebitOrder", created.id, null, created);
    return res.status(201).json(created);
  });

  app.patch("/api/debit-orders/:id", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const existing = await storage.getDebitOrder(req.params.id as string, user.organizationId);
    if (!existing) return res.status(404).json({ message: "Debit order not found" });
    const patch: Record<string, any> = {};
    if (typeof req.body.status === "string") {
      if (!DEBIT_ORDER_STATUSES.includes(req.body.status)) return res.status(400).json({ message: "Invalid status" });
      patch.status = req.body.status;
    }
    for (const k of ["accountName", "bankName", "accountNumber", "branchCode", "amount", "currency", "frequency", "dayOfMonth", "startDate", "nextRunDate", "notes", "policyId", "clientId", "branchId"]) {
      if (req.body[k] !== undefined) patch[k] = req.body[k] === "" ? null : req.body[k];
    }
    const updated = await storage.updateDebitOrder(req.params.id as string, user.organizationId, patch);
    await auditLog(req, "UPDATE_DEBIT_ORDER", "DebitOrder", existing.id, existing, updated);
    return res.json(updated);
  });

  // ─── Funeral quotations & cash-service receipts (income) ────

  app.get("/api/funeral-cases/:id/quotation", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getFuneralQuotation(req.params.id as string, user.organizationId) ?? null);
  });

  app.post("/api/funeral-cases/:id/quotation", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const fc = await storage.getFuneralCase(req.params.id as string, user.organizationId);
    if (!fc || fc.organizationId !== user.organizationId) return res.status(404).json({ message: "Funeral case not found" });
    const currency = normalizeCurrency(req.body.currency || "USD");
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    const items = rawItems.map((it: any) => {
      const quantity = parseFloat(String(it.quantity ?? 1)) || 1;
      const unitPrice = parseFloat(String(it.unitPrice ?? 0)) || 0;
      return {
        priceBookItemId: it.priceBookItemId || null,
        description: String(it.description || "Item"),
        quantity: quantity.toFixed(2),
        unitPrice: unitPrice.toFixed(2),
        lineTotal: (quantity * unitPrice).toFixed(2),
      };
    });
    const quote = await storage.upsertFuneralQuotation(
      user.organizationId, fc.id,
      {
        currency, status: req.body.status, notes: req.body.notes, createdBy: user.id,
        informantFullNames: req.body.informantFullNames, informantPhone: req.body.informantPhone,
        informantAddress: req.body.informantAddress, deceasedName: req.body.deceasedName,
        deceasedAge: req.body.deceasedAge ? parseInt(req.body.deceasedAge) : undefined,
        deceasedSex: req.body.deceasedSex, casketType: req.body.casketType,
        quotationDate: req.body.quotationDate, vatRate: req.body.vatRate ? parseFloat(req.body.vatRate) : undefined,
        discountAmount: req.body.discountAmount ? parseFloat(req.body.discountAmount) : undefined,
        paymentType: req.body.paymentType,
      },
      items,
    );
    await auditLog(req, "UPSERT_FUNERAL_QUOTATION", "FuneralQuotation", quote.id, null, quote);
    return res.json(quote);
  });

  app.get("/api/funeral-cases/:id/receipts", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getServiceReceipts(user.organizationId, { funeralCaseId: req.params.id as string }));
  });

  app.post("/api/funeral-cases/:id/receipts", requireAuth, requireTenantScope, requireAnyPermission("receipt:cash", "write:finance"), async (req, res) => {
    const user = req.user as any;
    const fc = await storage.getFuneralCase(req.params.id as string, user.organizationId);
    if (!fc || fc.organizationId !== user.organizationId) return res.status(404).json({ message: "Funeral case not found" });
    const amount = parseFloat(String(req.body.amount));
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "amount must be a positive number" });
    const currency = normalizeCurrency(req.body.currency || "USD");
    const channel = typeof req.body.paymentChannel === "string" && req.body.paymentChannel ? req.body.paymentChannel : "cash";
    const idempotencyKey = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey ? req.body.idempotencyKey : null;

    const quote = await storage.getFuneralQuotation(fc.id, user.organizationId);
    if (!quote || !quote.items?.length) {
      return res.status(422).json({ message: "A quotation with at least one line item must exist before recording a payment." });
    }
    if (quote.status === "voided" || quote.status === "cancelled") {
      return res.status(422).json({ message: "Cannot record a payment against a voided or cancelled quotation." });
    }

    if (idempotencyKey) {
      const existing = await storage.getServiceReceiptByIdempotencyKey(user.organizationId, idempotencyKey);
      if (existing) return res.status(200).json({ ...existing, duplicate: true });
    }

    const receiptNumber = await storage.getNextPaymentReceiptNumber(user.organizationId);
    const created = await storage.createServiceReceipt({
      organizationId: user.organizationId,
      branchId: fc.branchId ?? null,
      funeralCaseId: fc.id,
      quotationId: quote?.id ?? null,
      receiptNumber,
      amount: amount.toFixed(2),
      currency,
      paymentChannel: channel,
      issuedByUserId: user.id,
      issuedAt: new Date(),
      status: "issued",
      idempotencyKey,
      notes: typeof req.body.notes === "string" ? req.body.notes : null,
    });

    // Auto-update quotation conversion status
    if (quote?.id) {
      const allReceipts = await storage.getServiceReceipts(user.organizationId, { funeralCaseId: fc.id });
      const totalPaid = allReceipts
        .filter(r => r.status === "issued")
        .reduce((s, r) => s + parseFloat(String(r.amount)), 0);
      const grandTotal = parseFloat(String(quote.grandTotal || quote.total || "0"));
      if (grandTotal > 0 && totalPaid >= grandTotal) {
        await storage.markQuotationConverted(quote.id, user.organizationId);
      } else if (totalPaid > 0) {
        await storage.markQuotationPartialPayment(quote.id, user.organizationId);
      }
    }

    await auditLog(req, "CREATE_SERVICE_RECEIPT", "ServiceReceipt", created.id, null, created);

    // Enqueue platform fee via outbox for reliability + idempotency
    await withOrgTransaction(user.organizationId, async (txDb) => {
      await insertOutboxMessageInTx(txDb, {
        organizationId: user.organizationId,
        type: OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP,
        dedupeKey: `service_receipt_followup:${created.id}`,
        payload: { serviceReceiptId: created.id, amount: String(amount), currency, receiptNumber: created.receiptNumber },
      });
    });
    requestOutboxDrain(user.organizationId);

    return res.status(201).json(created);
  });

  // ─── Standalone Quotations ──────────────────────────────────

  app.get("/api/quotations", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    return res.json(await storage.getQuotationsByOrg(user.organizationId, { q, status, limit, offset }));
  });

  app.post("/api/quotations", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const currency = normalizeCurrency(req.body.currency || "USD");
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    const items = rawItems.map((it: any) => {
      const quantity = parseFloat(String(it.quantity ?? 1)) || 1;
      const unitPrice = parseFloat(String(it.unitPrice ?? 0)) || 0;
      return {
        priceBookItemId: it.priceBookItemId || null,
        description: String(it.description || "Item"),
        quantity: quantity.toFixed(2),
        unitPrice: unitPrice.toFixed(2),
        lineTotal: (quantity * unitPrice).toFixed(2),
      };
    });
    const quote = await storage.createStandaloneQuotation(user.organizationId, {
      currency, status: req.body.status, notes: req.body.notes, createdBy: user.id,
      informantFullNames: req.body.informantFullNames, informantPhone: req.body.informantPhone,
      informantAddress: req.body.informantAddress, deceasedName: req.body.deceasedName,
      deceasedAge: req.body.deceasedAge ? parseInt(req.body.deceasedAge) : undefined,
      deceasedSex: req.body.deceasedSex, casketType: req.body.casketType,
      quotationDate: req.body.quotationDate || new Date().toISOString().split("T")[0],
      vatRate: req.body.vatRate != null && req.body.vatRate !== "" ? parseFloat(req.body.vatRate) : 0,
      discountAmount: req.body.discountAmount ? parseFloat(req.body.discountAmount) : 0,
      paymentType: req.body.paymentType,
    }, items);
    await auditLog(req, "CREATE_QUOTATION", "FuneralQuotation", quote.id, null, quote);
    return res.status(201).json(quote);
  });

  app.get("/api/quotations/:id", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const quote = await storage.getQuotationById(req.params.id as string, user.organizationId);
    if (!quote) return res.status(404).json({ message: "Quotation not found" });
    const [guarantor, collateral] = await Promise.all([
      storage.getQuotationGuarantor(quote.id, user.organizationId),
      storage.getQuotationCollateral(quote.id, user.organizationId),
    ]);
    return res.json({ ...quote, guarantor: guarantor ?? null, collateral });
  });

  app.patch("/api/quotations/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const existing = await storage.getQuotationById(req.params.id as string, user.organizationId);
    if (!existing) return res.status(404).json({ message: "Quotation not found" });
    // Re-use upsertFuneralQuotation if linked to a case, otherwise createStandaloneQuotation update path
    const currency = normalizeCurrency(req.body.currency || existing.currency || "USD");
    const rawItems = Array.isArray(req.body.items) ? req.body.items : existing.items;
    const items = rawItems.map((it: any) => {
      const quantity = parseFloat(String(it.quantity ?? 1)) || 1;
      const unitPrice = parseFloat(String(it.unitPrice ?? 0)) || 0;
      return {
        priceBookItemId: it.priceBookItemId || null,
        description: String(it.description || "Item"),
        quantity: quantity.toFixed(2),
        unitPrice: unitPrice.toFixed(2),
        lineTotal: (quantity * unitPrice).toFixed(2),
      };
    });
    const dataPayload = {
      currency, status: req.body.status, notes: req.body.notes, createdBy: user.id,
      informantFullNames: req.body.informantFullNames, informantPhone: req.body.informantPhone,
      informantAddress: req.body.informantAddress, deceasedName: req.body.deceasedName,
      deceasedAge: req.body.deceasedAge ? parseInt(req.body.deceasedAge) : undefined,
      deceasedSex: req.body.deceasedSex, casketType: req.body.casketType,
      quotationDate: req.body.quotationDate,
      vatRate: req.body.vatRate ? parseFloat(req.body.vatRate) : undefined,
      discountAmount: req.body.discountAmount ? parseFloat(req.body.discountAmount) : undefined,
      paymentType: req.body.paymentType,
    };
    let quote: any;
    if (existing.funeralCaseId) {
      quote = await storage.upsertFuneralQuotation(user.organizationId, existing.funeralCaseId, dataPayload, items);
    } else {
      quote = await storage.updateStandaloneQuotation(existing.id, user.organizationId, dataPayload, items);
      if (!quote) return res.status(404).json({ message: "Quotation not found" });
    }
    await auditLog(req, "UPDATE_QUOTATION", "FuneralQuotation", existing.id, existing, quote);
    return res.json(quote);
  });

  app.get("/api/quotations/:id/pdf", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { streamQuotationPDF } = await import("./quotation-pdf");
    await streamQuotationPDF(req.params.id as string, user.organizationId, res, {
      attachment: req.query.download === "1",
    });
  });

  app.post("/api/quotations/:id/link-case", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const { funeralCaseId } = req.body;
    if (!funeralCaseId) return res.status(400).json({ message: "funeralCaseId required" });
    const updated = await storage.linkQuotationToCase(req.params.id as string, funeralCaseId, user.organizationId);
    if (!updated) return res.status(404).json({ message: "Quotation not found" });
    await auditLog(req, "LINK_QUOTATION_TO_CASE", "FuneralQuotation", req.params.id as string, null, updated);
    return res.json(updated);
  });

  app.post("/api/quotations/:id/guarantor", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const guarantor = await storage.upsertQuotationGuarantor(req.params.id as string, user.organizationId, req.body);
    return res.json(guarantor);
  });

  app.get("/api/quotations/:id/guarantor", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getQuotationGuarantor(req.params.id as string, user.organizationId) ?? null);
  });

  app.get("/api/quotations/:id/collateral", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getQuotationCollateral(req.params.id as string, user.organizationId));
  });

  app.post("/api/quotations/:id/collateral", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const quote = await storage.getQuotationById(req.params.id as string, user.organizationId);
    if (!quote) return res.status(404).json({ message: "Quotation not found" });
    const item = await storage.addQuotationCollateral({
      ...req.body,
      quotationId: quote.id,
      organizationId: user.organizationId,
    });
    return res.status(201).json(item);
  });

  app.delete("/api/quotations/collateral/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const collateralId = req.params.id as string;
    await storage.deleteQuotationCollateral(collateralId, user.organizationId);
    await auditLog(req, "DELETE_QUOTATION_COLLATERAL", "QuotationCollateral", collateralId, { id: collateralId }, null);
    return res.status(204).end();
  });

  app.post("/api/quotations/:id/send-for-authorization", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const quote = await storage.getQuotationById(req.params.id as string, user.organizationId);
    if (!quote) return res.status(404).json({ message: "Quotation not found" });
    const [guarantor, collateral] = await Promise.all([
      storage.getQuotationGuarantor(quote.id, user.organizationId),
      storage.getQuotationCollateral(quote.id, user.organizationId),
    ]);
    const approval = await storage.createApprovalRequest({
      organizationId: user.organizationId,
      requestType: "QUOTATION_CONDITIONS",
      entityType: "FuneralQuotation",
      entityId: quote.id,
      requestData: { quotationNumber: quote.quotationNumber, deceasedName: quote.deceasedName, guarantor, collateral },
      status: "pending",
      initiatedBy: user.id,
      approvedBy: null,
      rejectionReason: null,
      resolvedAt: null,
    });
    await auditLog(req, "SEND_QUOTATION_FOR_AUTHORIZATION", "FuneralQuotation", quote.id, null, approval);
    return res.status(201).json(approval);
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

  app.patch("/api/price-book/:id", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const itemId = req.params.id as string;
    try {
      const before = (await storage.getPriceBookItems(user.organizationId)).find((i: any) => i.id === itemId);
      if (!before) return res.status(404).json({ message: "Item not found" });
      const allowed = ["name", "unit", "priceAmount", "currency", "category", "effectiveFrom", "effectiveTo", "isActive"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) { if (k in req.body) patch[k] = req.body[k]; }
      if (Object.keys(patch).length === 0) return res.status(400).json({ message: "No fields to update" });
      if ("priceAmount" in patch) {
        const n = parseFloat(String(patch.priceAmount));
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: "priceAmount must be a non-negative number" });
        patch.priceAmount = n.toFixed(2);
      }
      const updated = await storage.updatePriceBookItem(itemId, patch as any, user.organizationId);
      await auditLog(req, "UPDATE_PRICE_BOOK_ITEM", "PriceBookItem", itemId, before, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/price-book/:id failed", { error: err?.message, itemId });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Approvals (Maker-Checker) ──────────────────────────────

  app.get("/api/approvals", requireAuth, requireTenantScope, requirePermission("manage:approvals"), async (req, res) => {
    const user = req.user as any;
    const status = req.query.status as string | undefined;
    return res.json(await storage.getApprovalRequests(user.organizationId, status));
  });

  app.post("/api/approvals", requireAuth, requireTenantScope, requireAnyPermission("write:policy", "write:claim", "write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
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
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
    const updated = await storage.updateApprovalRequest(approval.id, {
      status: action === "approve" ? "approved" : "rejected",
      approvedBy: user.id,
      rejectionReason: rejectionReason || null,
    }, user.organizationId);
    await auditLog(req, `RESOLVE_APPROVAL_${action.toUpperCase()}`, "ApprovalRequest", approval.id, approval, updated);
    // Notify the submitter of the decision
    if (approval.initiatedBy) {
      const label = action === "approve" ? "Approved" : "Rejected";
      notifyUser(user.organizationId, approval.initiatedBy, {
        type: "APPROVAL_RESOLVED",
        title: `Request ${label}`,
        body: `Your ${approval.requestType.replace(/_/g, " ")} request has been ${label.toLowerCase()}${rejectionReason ? `: ${rejectionReason}` : ""}.`,
        metadata: { approvalId: approval.id, action, entityType: approval.entityType, entityId: approval.entityId },
      }).catch(() => {});
    }
    return res.json(updated);
  });

  // ─── Payroll ────────────────────────────────────────────────

  app.get("/api/payroll/employees", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 2000);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const rows = await storage.getPayrollEmployees(user.organizationId);
    return res.json(rows.slice(offset, offset + limit));
  });

  app.post("/api/payroll/employees", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    try {
      // Auto-generate employee number; ignore any value sent by client
      const employeeNumber = await storage.generateEmployeeNumber(user.organizationId);
      const parsed = insertPayrollEmployeeSchema.parse({ ...req.body, organizationId: user.organizationId, employeeNumber });
      const emp = await storage.createPayrollEmployee(parsed);
      await auditLog(req, "CREATE_PAYROLL_EMPLOYEE", "PayrollEmployee", emp.id, null, emp);
      return res.status(201).json(emp);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/payroll/employees failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/payroll/runs", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const rows = await storage.getPayrollRuns(user.organizationId);
    return res.json(rows.slice(offset, offset + limit));
  });

  app.post("/api/payroll/runs", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    try {
      await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
      const parsed = insertPayrollRunSchema.parse({ ...req.body, organizationId: user.organizationId, preparedBy: user.id, status: "draft" });
      const run = await storage.createPayrollRun(parsed);
      await auditLog(req, "CREATE_PAYROLL_RUN", "PayrollRun", run.id, null, run);
      return res.status(201).json(run);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/payroll/runs failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ─── Attendance Logging ─────────────────────────────────────

  // Admin/manager: get all logs (filter by date, status, employeeId)
  app.get("/api/attendance", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    const filters = {
      date: typeof req.query.date === "string" ? req.query.date : undefined,
      status: typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : undefined,
      employeeId: typeof req.query.employeeId === "string" ? req.query.employeeId : undefined,
    };
    return res.json(await storage.getAttendanceLogs(user.organizationId, filters));
  });

  // Employee: get own logs
  app.get("/api/attendance/my", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const emp = await storage.getPayrollEmployeeByUserId(user.id, user.organizationId);
    if (!emp) return res.json([]);
    return res.json(await storage.getMyAttendanceLogs(emp.id, user.organizationId));
  });

  // Employee: log attendance for a date
  app.post("/api/attendance", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try {
      const emp = await storage.getPayrollEmployeeByUserId(user.id, user.organizationId);
      if (!emp) return res.status(422).json({ message: "No payroll employee record linked to your account. Ask your administrator to link your user account." });

      // Validate date: must be a valid ISO date, not more than 7 days in the past, not in the future
      const rawDate = typeof req.body.date === "string" ? req.body.date : "";
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRe.test(rawDate)) return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD." });
      const logDate = new Date(rawDate + "T00:00:00");
      if (isNaN(logDate.getTime())) return res.status(400).json({ message: "Invalid date." });
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const diffDays = (today.getTime() - logDate.getTime()) / 86_400_000;
      if (diffDays < 0) return res.status(400).json({ message: "Cannot log attendance for a future date." });
      if (diffDays > 7) return res.status(400).json({ message: "Cannot log attendance more than 7 days in the past." });

      const log = await storage.createAttendanceLog({
        organizationId: user.organizationId,
        employeeId: emp.id,
        date: rawDate,
        notes: typeof req.body.notes === "string" ? req.body.notes.trim() || null : null,
        status: "pending",
      });
      await auditLog(req, "LOG_ATTENDANCE", "AttendanceLog", log.id, null, log);
      return res.status(201).json(log);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(409).json({ message: "Attendance already logged for this date." });
      return res.status(500).json({ message: err?.message || "Failed to log attendance" });
    }
  });

  // Admin/manager: approve a log (only if still pending)
  app.post("/api/attendance/:id/approve", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const existing = await storage.getAttendanceLogById(req.params.id as string, user.organizationId);
    if (!existing) return res.status(404).json({ message: "Log not found" });
    if (existing.status !== "pending") return res.status(409).json({ message: `Cannot approve a log that is already ${existing.status}.` });
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
    const updated = await storage.updateAttendanceLog(existing.id, {
      status: "approved",
      approvedBy: user.id,
      approvedAt: new Date(),
      approvalNotes: typeof req.body.notes === "string" ? req.body.notes.trim() || null : null,
    }, user.organizationId);
    await auditLog(req, "APPROVE_ATTENDANCE", "AttendanceLog", existing.id, existing, updated);
    return res.json(updated);
  });

  // Admin/manager: reject a log (only if still pending)
  app.post("/api/attendance/:id/reject", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const existing = await storage.getAttendanceLogById(req.params.id as string, user.organizationId);
    if (!existing) return res.status(404).json({ message: "Log not found" });
    if (existing.status !== "pending") return res.status(409).json({ message: `Cannot reject a log that is already ${existing.status}.` });
    await ensureRegistryUserMirroredToOrgDataDb(user.organizationId, user.id);
    const updated = await storage.updateAttendanceLog(existing.id, {
      status: "rejected",
      approvedBy: user.id,
      approvedAt: new Date(),
      approvalNotes: typeof req.body.notes === "string" ? req.body.notes.trim() || null : null,
    }, user.organizationId);
    await auditLog(req, "REJECT_ATTENDANCE", "AttendanceLog", existing.id, existing, updated);
    return res.json(updated);
  });

  app.patch("/api/payroll/employees/:id", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    try {
      const allEmps = await storage.getPayrollEmployees(user.organizationId);
      const before = allEmps.find((e) => e.id === req.params.id);
      if (!before) return res.status(404).json({ message: "Employee not found" });
      const body = { ...req.body };
      for (const f of ["baseSalary", "housingAllowance", "transportAllowance", "funeralPolicyDeduction", "otherInsuranceDeduction"]) {
        if (body[f] === "" || body[f] === undefined) body[f] = null;
        else if (typeof body[f] === "number") body[f] = String(body[f]);
      }
      const updated = await storage.updatePayrollEmployee(req.params.id as string, body, user.organizationId);
      if (!updated) return res.status(404).json({ message: "Employee not found" });
      await auditLog(req, "UPDATE_PAYROLL_EMPLOYEE", "PayrollEmployee", updated.id, before, updated);
      return res.json(updated);
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to update employee" });
    }
  });

  app.get("/api/payroll/runs/:id/payslips", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getPayslipsForRun(req.params.id as string, user.organizationId));
  });

  // ── Print payslip PDF (inline preview or download) ──────────
  app.get("/api/payroll/runs/:id/payslips/:employeeId/pdf", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    const { streamPayslipToResponse } = await import("./payslip-pdf");
    await streamPayslipToResponse(req.params.id as string, req.params.employeeId as string, user.organizationId, res, { attachment: req.query.download === "1" });
  });

  // ── Email payslip to employee ────────────────────────────────
  app.post("/api/payroll/runs/:id/payslips/:employeeId/send", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const { sendPayslipEmail } = await import("./payslip-email");
    const result = await sendPayslipEmail(req.params.id as string, req.params.employeeId as string, user.organizationId);
    if (result.ok) {
      await auditLog(req, "SEND_PAYSLIP_EMAIL", "Payslip", `${req.params.id}:${req.params.employeeId}`, null, { sentTo: result.sentTo });
      return res.json(result);
    }
    return res.status(422).json(result);
  });

  // ── Send all payslips in a run ───────────────────────────────
  app.post("/api/payroll/runs/:id/send-all", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const runId = req.params.id as string;
    const { sendPayslipEmail } = await import("./payslip-email");
    const slips = await storage.getPayslipsForRun(runId, user.organizationId);
    const results = await Promise.all(
      slips.map(async (s: any) => {
        const empId: string = s.employeeId ?? s.employee?.id;
        const r = await sendPayslipEmail(runId, empId, user.organizationId);
        return { employeeId: empId, ...r };
      })
    );
    await auditLog(req, "SEND_ALL_PAYSLIPS", "PayrollRun", runId, null, { results });
    const sent = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    return res.json({ sent, failed, results });
  });

  app.put("/api/payroll/runs/:id/payslips/:employeeId", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const { id: runId, employeeId } = req.params as { id: string; employeeId: string };
    try {
      // Verify the run and employee both belong to this org
      const [runs, employees] = await Promise.all([
        storage.getPayrollRuns(user.organizationId),
        storage.getPayrollEmployees(user.organizationId),
      ]);
      if (!runs.find((r) => r.id === runId)) return res.status(404).json({ message: "Payroll run not found" });
      if (!employees.find((e) => e.id === employeeId)) return res.status(404).json({ message: "Employee not found" });

      const body = req.body as { daysWorked?: number | null; totalDays?: number; earnings?: any; deductionsDetail?: any; grossAmount: string; netAmount: string; currency?: string; };

      const gross = parseFloat(body.grossAmount);
      const net = parseFloat(body.netAmount);
      if (isNaN(gross) || isNaN(net)) return res.status(400).json({ message: "grossAmount and netAmount must be valid numbers." });

      const slip = await storage.upsertPayslip(runId, employeeId, user.organizationId, {
        daysWorked: body.daysWorked ?? null,
        totalDays: body.totalDays ?? null,
        earnings: body.earnings ?? null,
        deductionsDetail: body.deductionsDetail ?? null,
        grossAmount: gross.toFixed(2),
        netAmount: net.toFixed(2),
        currency: body.currency || "USD",
        deductions: body.deductionsDetail ?? null,
      });
      await storage.updatePayrollRunTotals(runId, user.organizationId);
      await auditLog(req, "UPSERT_PAYSLIP", "Payslip", slip.id, null, slip);
      return res.json(slip);
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to save payslip" });
    }
  });

  // ─── Security Questions (for client auth) ───────────────────

  app.get("/api/security-questions", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getSecurityQuestions(user.organizationId));
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

  // ─── Shared logic for both public registration paths ───────────────────────
  async function handlePublicPolicyRegistration(
    req: any,
    res: any,
    orgId: string,
    agentId: string | null,
    effectiveBranchId: string | null,
  ): Promise<void> {
    const { firstName, lastName, email, phone, dateOfBirth, nationalId, productVersionId, currency, paymentSchedule, paymentMethod: rawPaymentMethod, dependents: rawDeps, beneficiary: rawBeneficiary } = req.body;
    const nationalIdNorm = normalizeNationalId(nationalId)!;
    const normalizedPaymentMethod = normalizePaymentMethodInput(rawPaymentMethod);
    const pv = await storage.getProductVersion(productVersionId, orgId);
    if (!pv) { res.status(400).json({ message: "Invalid product version" }); return; }
    const product = await storage.getProduct(pv.productId, orgId);
    if (!product) { res.status(400).json({ message: "Product not found" }); return; }

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
      if (!client.activationCode) updates.activationCode = `ACT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      if (agentId && !(client as any).agentId) updates.agentId = agentId;
      if (Object.keys(updates).length > 0) {
        const updated = await storage.updateClient(client.id, updates, orgId);
        if (updated) client = updated;
      }
    } else {
      const activationCode = `ACT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      client = await storage.createClient(insertClientSchema.parse({
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
        agentId: agentId || null,
      }));
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
        if (!dFirst || !dLast || !dRel || !dDob || !dGender) continue;
        if (dNationalId && !isValidNationalId(dNationalId)) continue;
        createdDeps.push(await storage.createDependent({
          organizationId: orgId,
          clientId: client.id,
          firstName: dFirst,
          lastName: dLast,
          relationship: dRel,
          dateOfBirth: dDob,
          nationalId: dNationalId || null,
          gender: dGender,
        }));
      }
      const premium = await computePolicyPremium(
        orgId, productVersionId, currency || "USD", paymentSchedule || "monthly",
        [], [], undefined, createdDeps.map((d) => d.dateOfBirth || null),
      );
      let ben = rawBeneficiary && rawBeneficiary.firstName && rawBeneficiary.lastName ? rawBeneficiary : null;
      if (ben) {
        const bf = toUpperTrim(ben.firstName, false); const bl = toUpperTrim(ben.lastName, false);
        const br = toUpperTrim(ben.relationship, false); const bn = ben.nationalId ? normalizeNationalId(ben.nationalId) : null;
        const bp = toUpperTrim(ben.phone, false);
        if (!bf || !bl || !br || !bn || !bp || !isValidNationalId(ben.nationalId)) ben = null;
        else ben = { firstName: bf, lastName: bl, relationship: br, nationalId: bn, phone: bp };
      }
      const policyParsed = insertPolicySchema.parse({
        organizationId: orgId, branchId: effectiveBranchId, policyNumber,
        clientId: client.id, productVersionId: pv.id, agentId: agentId || null,
        status: "inactive", premiumAmount: premium, currency: currency || "USD",
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
      if (existingForClient.find((p) => p.productVersionId === policyParsed.productVersionId && p.status !== "cancelled")) {
        res.status(400).json({ error: "Duplicate policy", message: "This client already has an active policy for this product." });
        return;
      }
      const memberRows: Array<{ clientId?: string | null; dependentId?: string | null; role: string }> = [
        { clientId: client.id, role: "policy_holder" },
        ...createdDeps.map((dep) => ({ dependentId: dep.id, role: "dependent" as const })),
      ];
      const { policy } = await storage.createPolicyWithInitialSetup(orgId, {
        policy: policyParsed,
        statusHistory: {
          fromStatus: null, toStatus: "inactive",
          reason: agentId ? "Registered via agent link" : "Walk-in self-registration",
          changedBy: null,
        },
        members: memberRows, memberAddOns: [],
      });
      if (normalizedPaymentMethod) {
        await storage.upsertDefaultClientPaymentMethod(orgId, client.id, {
          organizationId: orgId, clientId: client.id, ...normalizedPaymentMethod, isDefault: true, isActive: true,
        } as any);
      }
      await storage.createLead({
        organizationId: orgId, branchId: effectiveBranchId || undefined,
        agentId: agentId || undefined, clientId: client.id,
        firstName: client.firstName, lastName: client.lastName,
        phone: client.phone || undefined, email: client.email || undefined,
        source: agentId ? "agent_link" : "walk_in", stage: "lead",
      });
      res.status(201).json({
        policyNumber: policy.policyNumber, activationCode: client.activationCode, clientId: client.id,
        message: agentId
          ? "Policy registered. Use your policy number and activation code to claim your account, then sign in."
          : "Policy registered. Use your policy number and activation code to claim your account.",
      });
    } catch (e) {
      if (e instanceof z.ZodError) { res.status(400).json({ message: "Validation failed", details: e.errors }); return; }
      throw e;
    }
  }

  app.post("/api/public/register-policy", express.json(), async (req, res) => {
    const { referralCode, firstName, lastName, nationalId, phone, dateOfBirth, productVersionId } = req.body;
    const missingFields: string[] = [];
    if (!referralCode) missingFields.push("referralCode");
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!productVersionId) missingFields.push("productVersionId");
    if (missingFields.length > 0) return res.status(400).json({ message: `Missing required fields: ${missingFields.join(", ")}` });
    const nationalIdNorm = normalizeNationalId(nationalId);
    if (!nationalIdNorm) return res.status(400).json({ message: "National ID is required (format: digits + check letter + 2 digits, e.g. 08833089H38)." });
    if (!isValidNationalId(nationalId)) return res.status(400).json({ message: "National ID must be digits, one letter, then two digits (e.g. 08833089H38)." });
    if (!phone || !String(phone).trim()) return res.status(400).json({ message: "Phone is required." });
    if (!dateOfBirth) return res.status(400).json({ message: "Date of birth is required." });
    if (!req.body.gender) return res.status(400).json({ message: "Gender is required." });
    const agent = await storage.getUserByReferralCode(referralCode);
    if (!agent) return res.status(400).json({ message: "Invalid referral code" });
    if (!agent.organizationId) return res.status(400).json({ message: "Agent has no organization" });
    return handlePublicPolicyRegistration(req, res, agent.organizationId, agent.id, req.body.branchId || agent.branchId || null);
  });

  // ─── (legacy unused block — kept for diff continuity, removed below) ─────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // ─── User (staff/agent) notifications ───────────────────

  // SSE stream — agent-app and web keep this open for real-time delivery
  app.get("/api/notifications/stream", requireAuth, (req, res) => {
    const user = (req as any).user as { id: string };
    sseConnect(user.id, req, res);
  });

  app.get("/api/notifications", requireAuth, requireTenantScope, async (req, res) => {
    const user = (req as any).user as { id: string; organizationId: string };
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const notifications = await storage.getUserNotifications(user.organizationId, user.id, limit, offset);
    const unreadCount = await storage.getUnreadUserNotificationCount(user.organizationId, user.id);
    return res.json({ notifications, unreadCount });
  });

  app.get("/api/notifications/unread-count", requireAuth, requireTenantScope, async (req, res) => {
    const user = (req as any).user as { id: string; organizationId: string };
    const count = await storage.getUnreadUserNotificationCount(user.organizationId, user.id);
    return res.json({ count });
  });

  app.patch("/api/notifications/:id/read", requireAuth, requireTenantScope, async (req, res) => {
    const user = (req as any).user as { id: string; organizationId: string };
    await storage.markUserNotificationRead(req.params.id as string, user.id, user.organizationId);
    return res.json({ ok: true });
  });

  app.patch("/api/notifications/mark-all-read", requireAuth, requireTenantScope, async (req, res) => {
    const user = (req as any).user as { id: string; organizationId: string };
    await storage.markAllUserNotificationsRead(user.organizationId, user.id);
    return res.json({ ok: true });
  });

  // Push token registration — staff/agent
  app.post("/api/agent-auth/push-token", requireAuth, requireTenantScope, async (req, res) => {
    const user = (req as any).user as { id: string; organizationId: string };
    const { token, platform } = req.body;
    if (!token || typeof token !== "string") return res.status(400).json({ message: "token required" });
    await storage.upsertUserDeviceToken(user.organizationId, user.id, token, platform || "unknown");
    return res.json({ ok: true });
  });

  // SSE diagnostics (admin only)
  app.get("/api/notifications/sse-stats", requireAuth, (req, res) => {
    res.json({ activeConnections: sseActiveCount() });
  });

  // Push token registration — clients
  app.post("/api/client-auth/push-token", async (req, res) => {
    const clientId = (req.session as any)?.clientId as string | undefined;
    if (!clientId) return res.status(401).json({ message: "Unauthorized" });
    const orgId = (req.session as any)?.clientOrgId as string | undefined;
    if (!orgId) return res.status(401).json({ message: "Unauthorized" });
    const { token, platform } = req.body;
    if (!token || typeof token !== "string") return res.status(400).json({ message: "token required" });
    await storage.addClientDeviceToken(orgId, clientId, token, platform || "unknown");
    return res.json({ ok: true });
  });

  // ─── Public walk-in self-registration ───────────────────
  app.get("/api/public/walkin-options", async (req, res) => {
    const orgIdentifier = typeof req.query.org === "string" ? req.query.org.trim() : "";
    if (!orgIdentifier) return res.status(400).json({ message: "org param required" });
    const org = await storage.getOrganization(orgIdentifier);
    if (!org || org.name?.endsWith("(deleted)")) return res.status(404).json({ message: "Organisation not found" });
    const orgId = org.id;
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
      orgId,
      orgName: org.name,
      isWalkIn: true,
      products: withVersions,
      branches: branches.filter((b) => b.isActive),
    });
  });

  app.post("/api/public/walkin-register", express.json(), async (req, res) => {
    const { orgId, firstName, lastName, nationalId, phone, dateOfBirth, productVersionId } = req.body;
    const missingFields: string[] = [];
    if (!orgId) missingFields.push("orgId");
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!productVersionId) missingFields.push("productVersionId");
    if (missingFields.length > 0) return res.status(400).json({ message: `Missing required fields: ${missingFields.join(", ")}` });
    const nationalIdNorm = normalizeNationalId(nationalId);
    if (!nationalIdNorm) return res.status(400).json({ message: "National ID is required (format: digits + check letter + 2 digits, e.g. 08833089H38)." });
    if (!isValidNationalId(nationalId)) return res.status(400).json({ message: "National ID must be digits, one letter, then two digits (e.g. 08833089H38)." });
    if (!phone || !String(phone).trim()) return res.status(400).json({ message: "Phone is required." });
    if (!dateOfBirth) return res.status(400).json({ message: "Date of birth is required." });
    if (!req.body.gender) return res.status(400).json({ message: "Gender is required." });
    const org = await storage.getOrganization(orgId);
    if (!org) return res.status(400).json({ message: "Organisation not found" });
    return handlePublicPolicyRegistration(req, res, orgId, null, req.body.branchId || null);
  });

  // ─── Groups ──────────────────────────────────────────────

  app.get("/api/groups", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getGroupsByOrg(user.organizationId));
  });

  app.post("/api/groups", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    try {
      const parsed = insertGroupSchema.parse({ ...req.body, organizationId: user.organizationId });
      const group = await storage.createGroup(parsed);
      await auditLog(req, "CREATE_GROUP", "Group", group.id, null, group);
      return res.status(201).json(group);
    } catch (err: any) {
      if (handleZodError(err, res)) return;
      structuredLog("error", "POST /api/groups failed", { error: err?.message });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.patch("/api/groups/:id", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const id = String(req.params.id);
    const user = req.user as any;
    try {
      const existing = await storage.getGroup(id, user.organizationId);
      if (!existing) return res.status(404).json({ message: "Group not found" });
      if (existing.organizationId !== user.organizationId) return res.status(403).json({ message: "Forbidden" });
      const updated = await storage.updateGroup(id, req.body, user.organizationId);
      await auditLog(req, "UPDATE_GROUP", "Group", id, existing, updated);
      return res.json(updated);
    } catch (err: any) {
      structuredLog("error", "PATCH /api/groups/:id failed", { error: err?.message, id });
      return res.status(500).json({ message: safeError(err) });
    }
  });

  app.get("/api/groups/:id/policies", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const groupId = String(req.params.id);
    const group = await storage.getGroup(groupId, user.organizationId);
    if (!group) return res.status(404).json({ message: "Group not found" });
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

  // ─── Directory Contacts (undertakers, underwriters, transport, general) ──

  app.get("/api/directory-contacts", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const search = typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined;
    return res.json(await storage.getDirectoryContacts(user.organizationId, type, search));
  });

  app.post("/api/directory-contacts", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const data = { ...req.body, organizationId: user.organizationId };
    if (!data.name || !data.type) return res.status(400).json({ message: "name and type are required" });
    const created = await storage.createDirectoryContact(data);
    await auditLog(req, "create", "directory_contact", created.id, null, created);
    return res.status(201).json(created);
  });

  app.patch("/api/directory-contacts/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const id = req.params.id as string;
    const updated = await storage.updateDirectoryContact(id, user.organizationId, req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    await auditLog(req, "update", "directory_contact", id, null, updated);
    return res.json(updated);
  });

  app.delete("/api/directory-contacts/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const id = req.params.id as string;
    await storage.deleteDirectoryContact(id, user.organizationId);
    await auditLog(req, "delete", "directory_contact", id, null, null);
    return res.json({ ok: true });
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
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
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
    if (!settlement) return res.status(404).json({ message: "Settlement not found" });
    if (settlement.initiatedBy === user.id) return res.status(400).json({ message: "Cannot approve own settlement" });
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
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
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
    const isAgent = isAgentScoped(userRoles);
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
    const termsId = req.params.id as string;
    const termsBefore = (await storage.getTermsByOrg(user.organizationId)).find((t: any) => t.id === termsId) ?? { id: termsId };
    await storage.deleteTerms(termsId, user.organizationId);
    await auditLog(req, "DELETE_TERMS", "Terms", termsId, termsBefore, null);
    return res.status(204).send();
  });

  registerPolicyDocumentRoute(app);
  registerMortuaryFormRoutes(app);
  registerPolicyFormRoutes(app);
  registerFinanceFormRoutes(app);
  registerHrFleetFormRoutes(app);

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

  const defaultStatementRange = () => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] };
  };
  app.get("/api/reports/income-statement", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const def = defaultStatementRange();
    const from = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : def.from;
    const to = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : def.to;
    const branchId = typeof req.query.branchId === "string" && req.query.branchId ? req.query.branchId : undefined;
    return res.json(await buildIncomeStatement(user.organizationId, { from, to, branchId }));
  });
  app.get("/api/reports/cash-flow", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const def = defaultStatementRange();
    const from = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : def.from;
    const to = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : def.to;
    const branchId = typeof req.query.branchId === "string" && req.query.branchId ? req.query.branchId : undefined;
    return res.json(await buildCashFlowStatement(user.organizationId, { from, to, branchId }));
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
        // ─── Employee Report types ────────────────────────────────
        case "policies-per-agent": {
          const joinRaw = await storage.getNewJoiningsReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Client Name", "Client Phone", "Product", "Branch", "Group", "Agent", "Inception Date", "Capture Date"];
          rows = joinRaw.map((r: any) => [
            r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule,
            `${r.clientFirstName || ""} ${r.clientLastName || ""}`.trim(), r.clientPhone || "",
            r.productName || "", r.branchName || "", r.groupName || "",
            r.agentDisplayName || r.agentEmail || "", r.inceptionDate || "", r.policyCreatedAt || "",
          ]);
          break;
        }
        case "new-joinings-summary": {
          const joinRaw = await storage.getNewJoiningsReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          const agentMap: Record<string, { name: string; count: number; premium: number }> = {};
          for (const r of joinRaw) {
            const key = r.agentEmail || r.agentDisplayName || "Unknown";
            if (!agentMap[key]) agentMap[key] = { name: r.agentDisplayName || key, count: 0, premium: 0 };
            agentMap[key].count++;
            agentMap[key].premium += parseFloat(String(r.premiumAmount ?? 0)) || 0;
          }
          headers = ["Agent", "New Joinings", "Total Premium"];
          rows = Object.values(agentMap).sort((a, b) => b.count - a.count).map((a) => [a.name, a.count, a.premium.toFixed(2)]);
          break;
        }
        case "cashiers-summary": {
          const cashupsList = await storage.getCashups(user.organizationId, REPORT_EXPORT_MAX_ROWS, reportFilters);
          const cashierMap: Record<string, { name: string; count: number; total: number }> = {};
          for (const r of cashupsList) {
            const key = (r as any).preparedBy || "Unknown";
            if (!cashierMap[key]) cashierMap[key] = { name: key, count: 0, total: 0 };
            cashierMap[key].count++;
            cashierMap[key].total += parseFloat(String((r as any).totalAmount ?? 0)) || 0;
          }
          headers = ["Cashier", "Cashup Count", "Total Amount"];
          rows = Object.values(cashierMap).map((c) => [c.name, c.count, c.total.toFixed(2)]);
          break;
        }
        case "audit-trail": {
          const { rows: auditRows } = await storage.getAuditLogs(user.organizationId, Math.min(REPORT_EXPORT_MAX_ROWS, 5000), 0, {
            from: reportFilters.fromDate,
            to: reportFilters.toDate,
          });
          headers = ["Action", "Entity Type", "Entity ID", "User", "IP Address", "Timestamp"];
          rows = auditRows.map((r: any) => [r.action, r.entityType, r.entityId, r.userName || r.userId || "", r.ipAddress || "", r.createdAt]);
          break;
        }
        case "irp5-reconciliation": {
          const employees = await storage.getPayrollEmployees(user.organizationId);
          headers = ["Employee Name", "ID Number", "Position", "Department", "Currency", "Basic Salary", "Status", "Tax Year"];
          rows = employees.map((r: any) => [r.employeeName, r.idNumber, r.position, r.department, r.currency || "USD", r.basicSalary, r.status, new Date().getFullYear()]);
          break;
        }
        case "deleted-receipts":
        case "edited-receipts":
        case "moved-receipts":
        case "backdated-receipts": {
          const receiptRows = await storage.getReceiptReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["DTSTAMP", "agentsName", "policy_number", "surname", "Product_Name", "DatePaid", "AmountCollected", "Currency", "ReceiptNumber", "CapturedBy"];
          rows = receiptRows.map((r: any) => [r.DTSTAMP ?? "", r.agentsName ?? "", r.policy_number ?? "", r.surname ?? "", r.Product_Name ?? "", r.DatePaid ?? "", r.AmountCollected ?? "", r.Currency ?? "", r.ReceiptNumber ?? "", r.CapturedBy ?? ""]);
          break;
        }
        case "employee-summary": {
          const empList = await storage.getUsersByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS);
          headers = ["Name", "Email", "Status", "Created"];
          rows = empList.map((r: any) => [r.displayName || r.email, r.email, r.isActive !== false ? "Active" : "Inactive", r.createdAt]);
          break;
        }
        case "arrears-breakdown": {
          const graceRaw = await storage.getNewJoiningsReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters });
          const graceOnly = graceRaw.filter((r: any) => r.status === "grace");
          headers = ["Policy Number", "Client", "Phone", "Status", "Currency", "Premium", "Agent", "Branch", "Grace End", "Days Overdue"];
          rows = graceOnly.map((r: any) => {
            const graceEnd = r.graceEndDate ? new Date(r.graceEndDate) : null;
            const daysOverdue = graceEnd ? Math.max(0, Math.floor((Date.now() - graceEnd.getTime()) / 86400000)) : 0;
            return [r.policyNumber, `${r.clientFirstName || ""} ${r.clientLastName || ""}`.trim(), r.clientPhone || "", r.status, r.currency, r.premiumAmount, r.agentDisplayName || "", r.branchName || "", r.graceEndDate || "", daysOverdue];
          });
          break;
        }
        case "outstanding-payments": {
          const awaitingRaw = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, statuses: ["active", "grace"] });
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = awaitingRaw.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
          break;
        }
        case "captured-per-employee": {
          const joinRaw2 = await storage.getNewJoiningsReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          const empMap: Record<string, { name: string; count: number; premium: number }> = {};
          for (const r of joinRaw2) {
            const key = r.agentEmail || r.agentDisplayName || "Unknown";
            if (!empMap[key]) empMap[key] = { name: r.agentDisplayName || key, count: 0, premium: 0 };
            empMap[key].count++;
            empMap[key].premium += parseFloat(String(r.premiumAmount ?? 0)) || 0;
          }
          headers = ["Agent / Employee", "Policies Captured", "Total Premium"];
          rows = Object.values(empMap).sort((a, b) => b.count - a.count).map((e) => [e.name, e.count, e.premium.toFixed(2)]);
          break;
        }
        case "complaint-report": {
          headers = ["Date", "Policy Number", "Client", "Complaint Type", "Description", "Status", "Resolved At"];
          rows = [];
          break;
        }
        // Agent commission reports — detailed ledger view
        case "agent-commission":
        case "agent-commission-mm-ext":
        case "commission-group-override":
        case "commission-group-benefits":
        case "joining-commission":
        case "joining-comms-detail":
        case "joining-comm-inception":
        case "dynamic-comm-summary":
        case "broker-commission-mm":
        case "broker-commission-2":
        case "broker-commission-ext":
        case "tier-commission":
        case "tier-commission-breakdown": {
          const ledger = await storage.getCommissionLedgerDetailedByOrg(user.organizationId, reportFilters.agentId || undefined);
          headers = ["Agent", "Policy Number", "Client", "Entry Type", "Amount", "Currency", "Payment Date", "Status", "Description", "Created"];
          rows = ledger.map((r: any) => [
            r.agentDisplayName || r.agentEmail || "",
            r.policyNumber || "",
            `${r.clientFirstName || ""} ${r.clientLastName || ""}`.trim(),
            r.entryType, r.amount, r.currency,
            r.paymentDate || "", r.status, r.description || "", r.createdAt,
          ]);
          break;
        }
        // Agent commission summary reports — grouped by agent
        case "agent-commission-summary":
        case "agent-total-commission":
        case "joining-comms-summary": {
          const ledger2 = await storage.getCommissionLedgerDetailedByOrg(user.organizationId, reportFilters.agentId || undefined);
          const summaryMap: Record<string, { name: string; total: number; currency: string; count: number }> = {};
          for (const r of ledger2) {
            const key = r.agentEmail || r.agentDisplayName || "Unknown";
            if (!summaryMap[key]) summaryMap[key] = { name: r.agentDisplayName || key, total: 0, currency: r.currency || "USD", count: 0 };
            summaryMap[key].total += parseFloat(String(r.amount ?? 0)) || 0;
            summaryMap[key].count++;
          }
          headers = ["Agent", "Entries", "Total Commission", "Currency"];
          rows = Object.values(summaryMap).sort((a, b) => b.total - a.total).map((a) => [a.name, a.count, a.total.toFixed(2), a.currency]);
          break;
        }
        case "agent-commission-by-count": {
          const ledger3 = await storage.getCommissionLedgerDetailedByOrg(user.organizationId, reportFilters.agentId || undefined);
          const countMap: Record<string, { name: string; total: number; receiptCount: number }> = {};
          for (const r of ledger3) {
            const key = r.agentEmail || r.agentDisplayName || "Unknown";
            if (!countMap[key]) countMap[key] = { name: r.agentDisplayName || key, total: 0, receiptCount: 0 };
            countMap[key].total += parseFloat(String(r.amount ?? 0)) || 0;
            if (r.transactionId) countMap[key].receiptCount++;
          }
          headers = ["Agent", "Receipt Count", "Total Commission"];
          rows = Object.values(countMap).sort((a, b) => b.receiptCount - a.receiptCount).map((a) => [a.name, a.receiptCount, a.total.toFixed(2)]);
          break;
        }
        case "manager-commission": {
          const mgrRows = await storage.getCommissionReportByOrg(user.organizationId, reportFilters);
          headers = ["Agent Name", "Number of Policies", "Total", "Net Pay"];
          rows = mgrRows.map((r: any) => [r.agentName, r.numberOfPolicies, r.total, r.netPay]);
          break;
        }
        case "select-count": {
          const scRaw = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          const scMap: Record<string, number> = {};
          for (const r of scRaw) {
            const key = (r as any).agentId || "unassigned";
            scMap[key] = (scMap[key] || 0) + 1;
          }
          headers = ["Agent ID", "Policy Count"];
          rows = Object.entries(scMap).map(([k, v]) => [k, v]);
          break;
        }
        case "broker-policies": {
          const bpRaw = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = bpRaw.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
          break;
        }
        case "branch-report": {
          const brRaw = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          const brMap: Record<string, { name: string; active: number; lapsed: number; grace: number; premium: number }> = {};
          for (const r of brRaw) {
            const key = (r as any).branchId || "no-branch";
            if (!brMap[key]) brMap[key] = { name: key, active: 0, lapsed: 0, grace: 0, premium: 0 };
            if ((r as any).status === "active") brMap[key].active++;
            else if ((r as any).status === "lapsed") brMap[key].lapsed++;
            else if ((r as any).status === "grace") brMap[key].grace++;
            brMap[key].premium += parseFloat(String((r as any).premiumAmount ?? 0)) || 0;
          }
          headers = ["Branch ID", "Active Policies", "Lapsed Policies", "Grace Policies", "Total Premium"];
          rows = Object.values(brMap).map((b) => [b.name, b.active, b.lapsed, b.grace, b.premium.toFixed(2)]);
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
      const { seedPermissions, seedOrgRoles } = await import("./seed");
      const permMap = await seedPermissions();
      await seedOrgRoles(user.organizationId, permMap);
      return res.json({ success: true, message: "Permissions and roles synchronized" });
    } catch (err: any) {
      return res.status(500).json({ message: safeError(err) });
    }
  });

  // ── Public document verification endpoint ────────────────────────
  // Called when a user scans the QR code on any generated document.
  // No auth required — returns just enough info to confirm authenticity.
  app.get("/api/public/verify", async (req, res) => {
    const { type, id } = req.query;
    if (!type || !id || typeof type !== "string" || typeof id !== "string") {
      return res.status(400).json({ valid: false, message: "type and id are required" });
    }
    try {
      if (type === "receipt") {
        const { findPaymentReceiptById } = await import("./storage");
        const receipt = await findPaymentReceiptById(id);
        if (!receipt) return res.json({ valid: false });
        const org = await storage.getOrganization(receipt.organizationId);
        return res.json({
          valid: true, type: "receipt",
          ref: receipt.receiptNumber || receipt.id.slice(0, 8).toUpperCase(),
          amount: receipt.amount, currency: receipt.currency,
          date: receipt.createdAt,
          org: org?.name || "POL263",
        });
      }
      if (type === "policy") {
        // Look up orgId first to route to the correct tenant DB
        const [policyRow] = await db.select({ organizationId: policies.organizationId, policyNumber: policies.policyNumber, status: policies.status, inceptionDate: policies.inceptionDate })
          .from(policies).where(eq(policies.id, id)).limit(1);
        if (!policyRow) return res.json({ valid: false });
        const org = await storage.getOrganization(policyRow.organizationId);
        return res.json({
          valid: true, type: "policy",
          policyNumber: policyRow.policyNumber,
          status: policyRow.status,
          startDate: policyRow.inceptionDate,
          org: org?.name || "POL263",
        });
      }
      if (type === "form") {
        return res.json({ valid: true, type: "form", id, message: "Document reference is valid." });
      }
      return res.json({ valid: false, message: "Unknown document type" });
    } catch (err: any) {
      return res.status(500).json({ valid: false, message: "Verification failed" });
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
