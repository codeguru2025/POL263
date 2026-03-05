import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import argon2 from "argon2";
import { storage, findPaymentReceiptById } from "./storage";
import { withOrgTransaction } from "./tenant-db";
import { requireAuth, requirePermission, requireAnyPermission, requireTenantScope } from "./auth";
import { structuredLog } from "./logger";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
import { registerPolicyDocumentRoute } from "./policy-document";
import { createPaymentIntent, initiatePaynowPayment, handlePaynowResult, pollPaynowStatus, applyPaymentToPolicy, initiatePaynowForGroup, pollGroupPaynowStatus, generateGroupMerchantReference } from "./payment-service";
import { getPaynowConfig } from "./paynow-config";
import { getReceiptPdfPath } from "./receipt-pdf";
import { PLATFORM_OWNER_EMAIL } from "./constants";
import { runApplyCreditBalances } from "./credit-apply";
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
  policies, paymentTransactions, paymentReceipts,
} from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { notifyClient } from "./notifications";


async function recordAgentCommission(orgId: string, policy: any, transactionId: string, paymentAmount: string) {
  if (!policy.agentId) return;
  try {
    // Product-version-level commission takes priority over org-wide plan
    let firstMonths = 0, firstRate = 0, recurringStart = 0, recurringRate = 0;
    let sourceLabel = "org plan";

    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId, orgId);
      if (pv?.commissionFirstMonthsRate != null) {
        firstMonths = Number(pv.commissionFirstMonthsCount) || 2;
        firstRate = Number(pv.commissionFirstMonthsRate) || 0;
        recurringStart = Number(pv.commissionRecurringStartMonth) || firstMonths + 1;
        recurringRate = Number(pv.commissionRecurringRate) || 0;
        sourceLabel = "product version";
      }
    }

    if (firstRate === 0 && recurringRate === 0) {
      const plans = await storage.getCommissionPlans(orgId);
      const activePlan = plans.find((p) => p.isActive);
      if (!activePlan) return;
      firstMonths = Number(activePlan.firstMonthsCount) || 2;
      firstRate = Number(activePlan.firstMonthsRate) || 50;
      recurringStart = Number(activePlan.recurringStartMonth) || 5;
      recurringRate = Number(activePlan.recurringRate) || 10;
      sourceLabel = "org plan";
    }

    const existingPayments = await storage.getPaymentsByPolicy(policy.id, orgId);
    const clearedCount = existingPayments.filter((p: any) => p.status === "cleared").length;

    let rate = 0;
    let entryType = "recurring";
    if (clearedCount <= firstMonths) {
      rate = firstRate;
      entryType = "first_months";
    } else {
      rate = recurringRate;
      entryType = "recurring";
    }

    if (rate <= 0) return;

    const amount = (parseFloat(paymentAmount) * rate / 100).toFixed(2);
    await storage.createCommissionLedgerEntry({
      organizationId: orgId,
      agentId: policy.agentId,
      policyId: policy.id,
      transactionId,
      entryType,
      amount,
      currency: policy.currency || "USD",
      description: `${rate}% commission on payment #${clearedCount} (${entryType === "first_months" ? "initial" : "recurring"}, ${sourceLabel})`,
      status: "earned",
    });
  } catch (err) {
    structuredLog("error", "Commission calculation failed", { error: (err as Error).message, policyId: policy.id });
  }
}

async function recordClawback(orgId: string, policy: any, reason: string) {
  if (!policy.agentId) return;
  try {
    let clawbackThreshold = 4;
    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId, orgId);
      if (pv?.commissionClawbackThreshold != null) {
        clawbackThreshold = Number(pv.commissionClawbackThreshold);
      }
    }
    if (clawbackThreshold <= 0) {
      const plans = await storage.getCommissionPlans(orgId);
      const activePlan = plans.find((p) => p.isActive);
      if (activePlan) clawbackThreshold = Number(activePlan.clawbackThresholdPayments) || 4;
    }

    const existingPayments = await storage.getPaymentsByPolicy(policy.id, orgId);
    const clearedCount = existingPayments.filter((p: any) => p.status === "cleared").length;
    if (clearedCount >= clawbackThreshold) return;

    const entries = await storage.getCommissionEntriesByPolicy(policy.id, orgId);
    const earnedEntries = entries.filter((e) => e.status === "earned" && (e.entryType === "first_months" || e.entryType === "recurring"));
    if (earnedEntries.length === 0) return;

    const totalClawback = earnedEntries.reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
    if (totalClawback <= 0) return;

    await storage.createCommissionLedgerEntry({
      organizationId: orgId,
      agentId: policy.agentId,
      policyId: policy.id,
      entryType: "clawback",
      amount: (-totalClawback).toFixed(2),
      currency: policy.currency || "USD",
      description: `Clawback — ${reason} (${clearedCount} of ${clawbackThreshold} threshold payments)`,
      status: "earned",
    });
  } catch (err) {
    structuredLog("error", "Clawback recording failed", { error: (err as Error).message, policyId: policy.id });
  }
}

async function rollbackClawbacks(orgId: string, policy: any) {
  if (!policy.agentId) return;
  try {
    const entries = await storage.getCommissionEntriesByPolicy(policy.id, orgId);
    const clawbacks = entries.filter((e) => e.entryType === "clawback" && e.status === "earned");
    const existingRollbacks = entries.filter((e) => e.entryType === "rollback");

    const clawbackTotal = clawbacks.reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
    const rollbackTotal = existingRollbacks.reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
    const unreversed = clawbackTotal + rollbackTotal;
    if (unreversed >= 0) return;

    await storage.createCommissionLedgerEntry({
      organizationId: orgId,
      agentId: policy.agentId,
      policyId: policy.id,
      entryType: "rollback",
      amount: Math.abs(unreversed).toFixed(2),
      currency: policy.currency || "USD",
      description: `Rollback — policy reinstated, clawback reversed`,
      status: "earned",
    });
  } catch (err) {
    structuredLog("error", "Rollback recording failed", { error: (err as Error).message, policyId: policy.id });
  }
}

function auditLog(req: any, action: string, entityType: string, entityId: string | undefined, before: any, after: any) {
  const user = req.user as any;
  return storage.createAuditLog({
    organizationId: user.organizationId,
    actorId: user.id,
    actorEmail: user.email,
    action,
    entityType,
    entityId,
    before,
    after,
    requestId: req.requestId,
  });
}

function getAddOnPrice(ao: any, paymentSchedule: string): number {
  if (ao.pricingMode === "percentage") {
    return parseFloat(String(ao.priceAmount ?? ao.priceMonthly ?? 0));
  }
  if (paymentSchedule === "weekly" && ao.priceWeekly) {
    return parseFloat(String(ao.priceWeekly));
  }
  if (paymentSchedule === "biweekly" && ao.priceBiweekly) {
    return parseFloat(String(ao.priceBiweekly));
  }
  return parseFloat(String(ao.priceMonthly ?? ao.priceAmount ?? 0));
}

/**
 * Compute policy premium from product version and per-member add-ons.
 * Add-on prices are matched to the policy's payment schedule using explicit
 * priceMonthly / priceWeekly / priceBiweekly fields set in the product builder.
 */
async function computePolicyPremium(
  orgId: string,
  productVersionId: string,
  currency: string,
  paymentSchedule: string,
  addOnIds: string[],
  memberAddOns?: { memberRef: string; addOnId: string }[],
  memberCount?: number,
): Promise<string> {
  const pv = await storage.getProductVersion(productVersionId, orgId);
  if (!pv) return "0";
  let base = 0;
  if (paymentSchedule === "monthly") {
    base = currency === "ZAR" ? parseFloat(String(pv.premiumMonthlyZar ?? 0)) : parseFloat(String(pv.premiumMonthlyUsd ?? 0));
  } else if (paymentSchedule === "weekly") {
    base = parseFloat(String(pv.premiumWeeklyUsd ?? 0));
  } else if (paymentSchedule === "biweekly") {
    base = parseFloat(String(pv.premiumBiweeklyUsd ?? 0));
  }

  let addOnTotal = 0;
  const orgAddOns = await storage.getAddOns(orgId);

  if (memberAddOns && memberAddOns.length > 0) {
    for (const ma of memberAddOns) {
      const ao = orgAddOns.find((a: any) => a.id === ma.addOnId);
      if (!ao) continue;
      const price = getAddOnPrice(ao, paymentSchedule);
      if (ao.pricingMode === "percentage") {
        addOnTotal += base * (price / 100);
      } else {
        addOnTotal += price;
      }
    }
  } else if (addOnIds.length > 0) {
    const count = memberCount || 1;
    for (const id of addOnIds) {
      const ao = orgAddOns.find((a: any) => a.id === id);
      if (!ao) continue;
      const price = getAddOnPrice(ao, paymentSchedule);
      if (ao.pricingMode === "percentage") {
        addOnTotal += base * (price / 100) * count;
      } else {
        addOnTotal += price * count;
      }
    }
  }

  const total = Number.isFinite(base + addOnTotal) && (base + addOnTotal) >= 0 ? base + addOnTotal : 0;
  return total.toFixed(2);
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  const DASHBOARD_MAX_ROWS =
    (process.env.DASHBOARD_MAX_ROWS && parseInt(process.env.DASHBOARD_MAX_ROWS, 10)) || 50000;
  const REPORT_EXPORT_MAX_ROWS =
    (process.env.REPORT_EXPORT_MAX_ROWS && parseInt(process.env.REPORT_EXPORT_MAX_ROWS, 10)) || 15000;

  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use("/uploads", express.static(uploadsDir, { maxAge: "1d" }));

  // Paynow result URL (webhook) — no auth; hash verified in handler. Always return 200 to avoid Paynow retries.
  app.post("/api/payments/paynow/result", express.urlencoded({ extended: false }), async (req, res) => {
    const body = req.body as Record<string, string>;
    const result = await handlePaynowResult(body);
    return res.status(200).send(result.ok ? "OK" : "Error");
  });

  const uploadStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  });

  const upload = multer({
    storage: uploadStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
      const hasAllowedExtension = allowed.test(path.extname(file.originalname));
      const isImageMime = file.mimetype.startsWith("image/");
      if (hasAllowedExtension && isImageMime) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  const logoUpload = multer({
    storage: uploadStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(png|webp|svg)$/i;
      const hasAllowedExtension = allowed.test(path.extname(file.originalname));
      const allowedMimes = ["image/png", "image/webp", "image/svg+xml"];
      if (hasAllowedExtension && allowedMimes.includes(file.mimetype)) cb(null, true);
      else cb(new Error("Logo and signature files must be PNG, WebP, or SVG (formats that support transparency)"));
    },
  });

  app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = `/uploads/${req.file.filename}`;
    return res.json({ url, filename: req.file.filename });
  });

  app.post("/api/upload/logo", requireAuth, logoUpload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = `/uploads/${req.file.filename}`;
    return res.json({ url, filename: req.file.filename });
  });

  // ─── Platform Owner: Tenant Switching ──────────────────────────

  app.post("/api/platform/switch-tenant", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) {
      return res.status(403).json({ message: "Platform owner access required" });
    }
    const { tenantId } = req.body;
    if (!tenantId) {
      delete (req.session as any).activeTenantId;
      return res.json({ activeTenantId: null });
    }
    const org = await storage.getOrganization(tenantId);
    if (!org) return res.status(404).json({ message: "Tenant not found" });
    (req.session as any).activeTenantId = tenantId;
    return res.json({ activeTenantId: tenantId, tenantName: org.name });
  });

  app.get("/api/platform/active-tenant", requireAuth, async (req, res) => {
    const user = req.user as any;
    if (!user.isPlatformOwner) {
      return res.status(403).json({ message: "Platform owner access required" });
    }
    const activeTenantId = (req.session as any)?.activeTenantId || user.organizationId || null;
    if (!activeTenantId) return res.json({ activeTenantId: null, tenant: null });
    const org = await storage.getOrganization(activeTenantId);
    return res.json({ activeTenantId, tenant: org || null });
  });

  // ─── Organization / Tenant ──────────────────────────────────

  app.get("/api/organizations", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const perms = await storage.getUserEffectivePermissions(user.id);
      const canManageTenants = perms.includes("create:tenant") || perms.includes("delete:tenant");
      if (canManageTenants) {
        const allOrgs = await storage.getOrganizations();
        const active = (Array.isArray(allOrgs) ? allOrgs : []).filter((o) => !o.name?.endsWith(" (deleted)"));
        return res.json(active);
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
    const perms = await storage.getUserEffectivePermissions(user.id);
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
    const perms = await storage.getUserEffectivePermissions(user.id);
    const canManageTenants = perms.includes("create:tenant") || perms.includes("delete:tenant");
    const canWriteOrg = perms.includes("write:organization");
    if (!canManageTenants && (id !== user.organizationId || !canWriteOrg)) {
      return res.status(403).json({ message: "Cross-tenant access denied or insufficient permissions" });
    }
    const isPlatformOwner = user.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
    if (!isPlatformOwner) {
      delete req.body.databaseUrl;
      delete req.body.isWhitelabeled;
    }
    const before = await storage.getOrganization(id);
    if (!before) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateOrganization(id, req.body);
    await auditLog(req, "UPDATE_ORGANIZATION", "Organization", id, before, updated);
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
            if (permId) await storage.addRolePermission(role.id, permId);
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
        if (adminRoleId) await storage.addUserRole(adminUser.id, adminRoleId);
      }

      await auditLog(req, "CREATE_ORGANIZATION", "Organization", org.id, null, {
        ...org,
        defaultBranchId: defaultBranch.id,
        ...(adminUser ? { adminUserId: adminUser.id, adminEmail } : {}),
      });
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
    }

    await storage.updateOrganization(id, { name: org.name + " (deleted)" });
    await auditLog(req, "DELETE_ORGANIZATION", "Organization", id, org, null);
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
    const usersWithRoles = await Promise.all(usersList.map(async (u) => {
      const userRoles = await storage.getUserRoles(u.id, user.organizationId);
      return {
        id: u.id, email: u.email, displayName: u.displayName,
        avatarUrl: u.avatarUrl, isActive: u.isActive, createdAt: u.createdAt,
        referralCode: u.referralCode, branchId: u.branchId,
        roles: userRoles.map(r => ({ id: r.id, name: r.name })),
      };
    }));
    return res.json(usersWithRoles);
  });

  app.get("/api/agents", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const usersList = await storage.getUsersByOrg(user.organizationId, 500, 0);
    const agentsList = [];
    for (const u of usersList) {
      const userRoles = await storage.getUserRoles(u.id, user.organizationId);
      if (userRoles.some(r => r.name === "agent")) {
        agentsList.push({
          id: u.id, email: u.email, displayName: u.displayName,
          referralCode: u.referralCode,
        });
      }
    }
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
        await storage.addUserRole(newUser.id, roleId);
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
        await storage.addUserRole(req.params.id as string, roleId);
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
    await storage.addRolePermission(req.params.id as string, req.params.permId as string);
    return res.json({ ok: true });
  });

  app.delete("/api/roles/:id/permissions/:permId", requireAuth, requireTenantScope, requirePermission("write:role"), async (req, res) => {
    await storage.removeRolePermission(req.params.id as string, req.params.permId as string);
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

    const activationCode = `ACT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const userRolesForCreate = await storage.getUserRoles(user.id, user.organizationId);
    const creatorIsAgent = userRolesForCreate.some((r: { name?: string }) => r?.name === "agent");
    const parsed = insertClientSchema.parse({
      ...req.body,
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
    const parsed = insertDependentSchema.parse({
      ...req.body,
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
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const search = typeof req.query.q === "string" ? req.query.q.trim() || undefined : undefined;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    let list: any[];
    if (isAgent) {
      list = await storage.getPoliciesByAgent(user.id, user.organizationId);
      if (fromDate) list = list.filter((p: any) => p.createdAt >= fromDate + "T00:00:00.000Z");
      if (toDate) list = list.filter((p: any) => p.createdAt <= toDate + "T23:59:59.999Z");
      if (status) list = list.filter((p: any) => p.status === status);
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const matchingClientIds = new Set(await storage.getClientIdsByOrgSearch(user.organizationId, search));
        list = list.filter((p: any) =>
          (p.policyNumber && p.policyNumber.toLowerCase().includes(q)) ||
          (p.clientId && matchingClientIds.has(p.clientId))
        );
      }
      list = list.slice(offset, offset + limit);
    } else {
      const filters = (fromDate || toDate || status || search) ? { fromDate, toDate, status, search } : undefined;
      list = await storage.getPoliciesByOrg(user.organizationId, limit, offset, filters);
    }
    return res.json(list);
  });

  app.get("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy) return res.status(404).json({ message: "Not found" });
    if (policy.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent && (policy as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });
    const today = new Date().toISOString().split("T")[0];
    const statusOk = policy.status === "active" || policy.status === "grace";
    const waitingOver = !policy.waitingPeriodEndDate || policy.waitingPeriodEndDate <= today;
    const claimable = !!(statusOk && waitingOver);
    const claimableReason = !statusOk
      ? `Policy status is ${policy.status}; must be active or in grace to lodge a claim.`
      : !waitingOver
        ? `Waiting period ends ${policy.waitingPeriodEndDate}. Claims allowed after that date.`
        : "Policy and covered members are eligible for claims.";

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

    let clientActivationCode: string | null = null;
    if (policy.clientId) {
      const policyClient = await storage.getClient(policy.clientId, user.organizationId);
      if (policyClient && policyClient.activationCode && !policyClient.isEnrolled) {
        clientActivationCode = policyClient.activationCode;
      }
    }

    return res.json({
      ...policy,
      claimable,
      claimableReason,
      productName,
      productVersionLabel,
      waitingPeriodDays,
      clientActivationCode,
    });
  });

  app.post("/api/policies", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
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
      );
    }

    const body = { ...req.body };
    delete body.premiumAmount;

    const beneficiary = req.body.beneficiary || null;
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
      res.status(400).json({
        error: "Duplicate policy",
        message: "This client already has an active policy for this product. Cancel the existing policy first if you need to create a new one.",
      });
      return;
    }

    const policy = await storage.createPolicy(parsed);
    try {
      await storage.createPolicyStatusHistory(policy.id, null, "inactive", "Policy created", user.id);

      await storage.createPolicyMember({
        policyId: policy.id,
        clientId: policy.clientId,
        role: "policy_holder",
      });

      let dependentsToAdd = members;
      if (dependentsToAdd.length === 0 && policy.clientId) {
        const clientDeps = await storage.getDependentsByClient(policy.clientId, user.organizationId);
        dependentsToAdd = clientDeps.map((d: any) => ({ dependentId: d.id, role: "dependent" }));
      }
      for (const m of dependentsToAdd) {
        if (m.clientId || m.dependentId) {
          await storage.createPolicyMember({
            policyId: policy.id,
            clientId: m.clientId || null,
            dependentId: m.dependentId || null,
            role: m.role || "dependent",
          });
        }
      }

      const uniqueAddOnIds = Array.from(new Set(memberAddOns.map((ma) => ma.addOnId)));
      const allAddOnIds = uniqueAddOnIds.length > 0 ? uniqueAddOnIds : addOnIds;
      if (allAddOnIds.length > 0) {
        await storage.addPolicyAddOns(policy.id, allAddOnIds, user.organizationId);
      }

      await auditLog(req, "CREATE_POLICY", "Policy", policy.id, null, policy);
      return res.status(201).json(policy);
    } catch (err) {
      // cleanup: policy will be orphaned but detected by audit
      console.error(`Policy creation failed after creating policy ${policy.id}, orphaned record may remain:`, err);
      throw err;
    }
  });

  app.patch("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent && (before as any).agentId !== user.id) return res.status(403).json({ message: "Access denied" });
    // Premium cannot be updated manually; strip it if sent
    const body = { ...req.body };
    delete body.premiumAmount;
    const updated = await storage.updatePolicy(req.params.id as string, body, user.organizationId);
    await auditLog(req, "UPDATE_POLICY", "Policy", req.params.id as string, before, updated);
    return res.json(updated);
  });

  app.post("/api/policies/:id/transition", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });

    const { toStatus, reason } = req.body;
    const allowed = VALID_POLICY_TRANSITIONS[policy.status];
    if (!allowed || !allowed.includes(toStatus)) {
      return res.status(400).json({ message: `Invalid transition from ${policy.status} to ${toStatus}` });
    }

    const before = { ...policy };
    const updated = await storage.updatePolicy(policy.id, { status: toStatus }, user.organizationId);
    await storage.createPolicyStatusHistory(policy.id, policy.status, toStatus, reason, user.id);
    await storage.createNotificationLog(user.organizationId, {
      recipientType: "client",
      recipientId: policy.clientId,
      channel: "in_app",
      subject: "Policy status updated",
      body: `Policy ${policy.policyNumber} status has been updated to ${toStatus}.${reason ? ` Reason: ${reason}` : ""}`,
      status: "sent",
    });
    if (toStatus === "lapsed" || toStatus === "cancelled") {
      await recordClawback(user.organizationId, policy, `Policy ${toStatus}`);
    }
    await auditLog(req, "TRANSITION_POLICY", "Policy", policy.id, before, updated);
    return res.json(updated);
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
      const inceptionDate = policy.inceptionDate || policy.effectiveDate || memberCreatedAt;

      let coverDate: string | null = null;
      if (inceptionDate) {
        const inception = new Date(inceptionDate);
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
    await auditLog(req, "ADD_POLICY_MEMBER", "PolicyMember", member.id, null, member);
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
    return res.json(await storage.getPaymentsByPolicy(req.params.id as string, user.organizationId));
  });

  app.post("/api/payments", requireAuth, requireTenantScope, requireAnyPermission("write:finance", "receipt:cash", "receipt:mobile", "receipt:transfer"), async (req, res) => {
    const user = req.user as any;
    try {
    const userRolesForPayment = await storage.getUserRoles(user.id, user.organizationId);
    const isAgentPayment = userRolesForPayment.some((r: { name?: string }) => r?.name === "agent");
    if (isAgentPayment && req.body.paymentMethod === "cash") {
      return res.status(403).json({ message: "Agents cannot process cash payments. Use a Paynow method instead." });
    }

    const effectivePerms = await storage.getUserEffectivePermissions(user.id);
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
    const today = new Date().toISOString().split("T")[0];
    const parsed = insertPaymentTransactionSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      recordedBy: user.id,
      postedDate: req.body.postedDate || today,
      valueDate: req.body.valueDate || today,
    });

    const policyId = parsed.policyId;
    const isClearedWithPolicy = parsed.status === "cleared" && !!policyId;

    let policy: Awaited<ReturnType<typeof storage.getPolicy>> | null = null;
    if (isClearedWithPolicy) {
      policy = await storage.getPolicy(policyId!, user.organizationId) ?? null;
    }

    const result = await withOrgTransaction(user.organizationId, async (txDb) => {
      if (isClearedWithPolicy && policyId) {
        await txDb.execute(sql`SELECT id FROM policies WHERE id = ${policyId} FOR UPDATE`);
      }

      const [tx] = await txDb.insert(paymentTransactions).values(parsed).returning();

      let receipt = null;
      if (tx.status === "cleared" && tx.policyId && tx.clientId) {
        const receiptNumber = await storage.getNextPaymentReceiptNumber(user.organizationId);
        const [newReceipt] = await txDb.insert(paymentReceipts).values({
          organizationId: user.organizationId,
          branchId: policy?.branchId || user.branchId || undefined,
          receiptNumber,
          policyId: tx.policyId,
          clientId: tx.clientId,
          amount: tx.amount,
          currency: tx.currency,
          paymentChannel: tx.paymentMethod || "cash",
          issuedByUserId: user.id,
          status: "issued",
          printFormat: "thermal_80mm",
          metadataJson: { transactionId: tx.id, notes: tx.notes },
        }).returning();
        receipt = newReceipt;
      }

      if (tx.status === "cleared" && tx.policyId && policy) {
        if (policy.status === "inactive") {
          const todayDate = new Date().toISOString().split("T")[0];
          await txDb.update(policies).set({
            status: "active",
            inceptionDate: todayDate,
            ...(!policy.effectiveDate ? { effectiveDate: todayDate } : {}),
            version: sql`version + 1`,
          }).where(eq(policies.id, tx.policyId));
        } else if (policy.status === "grace") {
          await txDb.update(policies).set({
            status: "active",
            graceEndDate: null,
            version: sql`version + 1`,
          }).where(eq(policies.id, tx.policyId));
        } else if (policy.status === "lapsed") {
          await txDb.update(policies).set({
            status: "active",
            graceEndDate: null,
            version: sql`version + 1`,
          }).where(eq(policies.id, tx.policyId));
        }
      }

      return { tx, receipt, policyStatusChange: (tx.status === "cleared" && tx.policyId && policy) ? { from: policy.status, to: "active" as const, reason: policy.status === "inactive" ? "First premium paid — conversion" : policy.status === "grace" ? "Payment received" : "Reinstatement — payment received" } : null };
    });

    if (result.policyStatusChange) {
      const policyId = result.tx.policyId!;
      const { from, to, reason } = result.policyStatusChange;
      const orgId = user.organizationId;
      const changedBy = user.id;
      setImmediate(() => {
        storage.createPolicyStatusHistory(policyId, from, to, reason, changedBy, orgId).catch((e) => {
          structuredLog("warn", "createPolicyStatusHistory after payment failed", { error: (e as Error).message, policyId });
        });
      });
    }

    if (result.tx.status === "cleared" && result.tx.policyId && policy?.status === "lapsed") {
      await rollbackClawbacks(user.organizationId, policy);
    }

    try {
      if (result.receipt) {
        const { generateReceiptPdf } = await import("./receipt-pdf");
        const pdfPath = await generateReceiptPdf(result.receipt.id);
        if (pdfPath) await storage.updatePaymentReceipt(result.receipt.id, { pdfStorageKey: pdfPath }, user.organizationId);
      }
      if (result.tx.status === "cleared") {
        const chibAmount = (parseFloat(result.tx.amount) * 0.025).toFixed(2);
        await storage.createPlatformReceivable({
          organizationId: user.organizationId,
          sourceTransactionId: result.tx.id,
          amount: chibAmount,
          currency: result.tx.currency,
          description: `2.5% on payment ${result.tx.id}`,
          isSettled: false,
        });
      }
      await auditLog(req, "CREATE_PAYMENT", "PaymentTransaction", result.tx.id, null, result.tx);
      if (result.receipt) await auditLog(req, "CREATE_RECEIPT", "PaymentReceipt", result.receipt.id, null, result.receipt);
      if (result.tx.status === "cleared" && result.tx.policyId) {
        const commPolicy = await storage.getPolicy(result.tx.policyId, user.organizationId);
        if (commPolicy) await recordAgentCommission(user.organizationId, commPolicy, result.tx.id, result.tx.amount);
      }
      if (result.tx.status === "cleared" && result.tx.clientId && result.tx.policyId && policy) {
        await notifyClient(user.organizationId, result.tx.clientId, "Payment received", `Your payment of ${result.tx.currency} ${result.tx.amount} for policy ${policy.policyNumber} has been received. Thank you.`);
      }
    } catch (postErr: any) {
      structuredLog("warn", "POST /api/payments post-commit step failed (payment already saved)", { error: postErr?.message || String(postErr), stack: postErr?.stack });
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
    return res.json(await storage.getReceiptsByPolicy(req.params.id as string, user.organizationId));
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

  app.get("/api/receipts/:id/download", requireAuth, async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const receipt = user.organizationId
      ? await storage.getPaymentReceiptById(id, user.organizationId)
      : await findPaymentReceiptById(id);
    if (!receipt) return res.status(404).json({ message: "Not found" });
    if (user.organizationId && receipt.organizationId !== user.organizationId) return res.status(403).json({ message: "Forbidden" });
    const filePath = getReceiptPdfPath(receipt.pdfStorageKey);
    if (!filePath) return res.status(404).json({ message: "Receipt PDF not available" });
    return res.download(filePath, `receipt-${receipt.receiptNumber}.pdf`);
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
        recordedBy: user.id,
      }).returning();

      const receiptNumber = await storage.getNextPaymentReceiptNumber(user.organizationId);
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
        issuedByUserId: user.id,
        status: "issued",
        printFormat: "thermal_80mm",
        metadataJson: { transactionId: tx.id, notes },
      }).returning();

      // Transition policy status atomically within the same transaction
      if (policy.status === "inactive") {
        const todayDate = new Date().toISOString().split("T")[0];
        await txDb.update(policies).set({
          status: "active",
          inceptionDate: todayDate,
          ...(!policy.effectiveDate ? { effectiveDate: todayDate } : {}),
          version: sql`version + 1`,
        }).where(eq(policies.id, policyId));
        await storage.createPolicyStatusHistory(policyId, "inactive", "active", "First premium paid — conversion (cash)", user.id);
      } else if (policy.status === "grace") {
        await txDb.update(policies).set({
          status: "active",
          graceEndDate: null,
          version: sql`version + 1`,
        }).where(eq(policies.id, policyId));
        await storage.createPolicyStatusHistory(policyId, "grace", "active", "Payment received (cash)", user.id);
      } else if (policy.status === "lapsed") {
        await txDb.update(policies).set({
          status: "active",
          graceEndDate: null,
          version: sql`version + 1`,
        }).where(eq(policies.id, policyId));
        await storage.createPolicyStatusHistory(policyId, "lapsed", "active", "Reinstatement — payment received (cash)", user.id);
        await rollbackClawbacks(user.organizationId, policy);
      }

      return { tx, receipt };
    });

    // Non-transactional follow-ups (PDF generation, commission, revenue share)
    const { generateReceiptPdf } = await import("./receipt-pdf");
    const pdfPath = await generateReceiptPdf(result.receipt.id);
    if (pdfPath) await storage.updatePaymentReceipt(result.receipt.id, { pdfStorageKey: pdfPath }, result.receipt.organizationId);

    const chibAmount = (parseFloat(String(amount)) * 0.025).toFixed(2);
    await storage.createPlatformReceivable({
      organizationId: user.organizationId,
      sourceTransactionId: result.tx.id,
      amount: chibAmount,
      currency: result.tx.currency,
      description: `2.5% on cash payment ${result.tx.id}`,
      isSettled: false,
    });

    await auditLog(req, "CASH_RECEIPT", "PaymentReceipt", result.receipt.id, null, result.receipt);
    await recordAgentCommission(user.organizationId, policy, result.tx.id, String(amount));
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
    const runNumber = await storage.getNextMonthEndRunNumber(user.organizationId);
    const run = await storage.createMonthEndRun({
      organizationId: user.organizationId,
      runNumber,
      fileName: (req.file as any).originalname || "upload.csv",
      totalRows: 0,
      receiptedCount: 0,
      creditNoteCount: 0,
      status: "processing",
      runBy: user.id,
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
      const currency = (parts[2] || "USD").toUpperCase();
      const amount = parseFloat(amountStr);
      if (!policyNumber || !Number.isFinite(amount) || amount < 0) continue;
      const policy = await storage.getPolicyByNumber(policyNumber, user.organizationId);
      if (!policy) continue;
      const premium = parseFloat(String(policy.premiumAmount || 0));
      if (amount >= premium) {
        const tx = await storage.createPaymentTransaction({
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
          recordedBy: user.id,
        });
        const receiptNum = await storage.getNextPaymentReceiptNumber(user.organizationId);
        await storage.createPaymentReceipt({
          organizationId: user.organizationId,
          branchId: policy.branchId ?? undefined,
          receiptNumber: receiptNum,
          policyId: policy.id,
          clientId: policy.clientId!,
          amount: String(premium),
          currency: policy.currency || "USD",
          paymentChannel: "bank",
          issuedByUserId: user.id,
          status: "issued",
          metadataJson: { monthEndRunId: run.id },
        });
        receipted++;
        if (policy.status === "inactive") {
          await storage.updatePolicy(policy.id, { status: "active", inceptionDate: today, effectiveDate: policy.effectiveDate || today }, user.organizationId);
          await storage.createPolicyStatusHistory(policy.id, "inactive", "active", "First premium paid — conversion (month-end)", user.id);
        } else if (policy.status === "grace") {
          await storage.updatePolicy(policy.id, { status: "active", graceEndDate: null }, user.organizationId);
          await storage.createPolicyStatusHistory(policy.id, "grace", "active", "Payment received (month-end)", user.id);
        } else if (policy.status === "lapsed") {
          await storage.updatePolicy(policy.id, { status: "active", graceEndDate: null }, user.organizationId);
          await storage.createPolicyStatusHistory(policy.id, "lapsed", "active", "Reinstatement — payment received (month-end)", user.id);
          await rollbackClawbacks(user.organizationId, policy);
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
    for (const policy of valid) {
      const premium = parseFloat(String(policy.premiumAmount || 0));
      const amount = totalPremium > 0 ? (amountNum * (premium / totalPremium)).toFixed(2) : (amountNum / valid.length).toFixed(2);
      const tx = await storage.createPaymentTransaction({
        organizationId: user.organizationId,
        policyId: policy.id,
        clientId: policy.clientId!,
        amount,
        currency: currency || policy.currency || "USD",
        paymentMethod: "cash",
        status: "cleared",
        reference: `GRP-${groupId.slice(0, 8)}-${Date.now()}`,
        receivedAt: new Date(),
        postedDate: today,
        valueDate: today,
        notes: "Group batch receipt",
        recordedBy: user.id,
      });
      const receiptNum = await storage.getNextPaymentReceiptNumber(user.organizationId);
      await storage.createPaymentReceipt({
        organizationId: user.organizationId,
        branchId: policy.branchId ?? undefined,
        receiptNumber: receiptNum,
        policyId: policy.id,
        clientId: policy.clientId!,
        amount,
        currency: currency || policy.currency || "USD",
        paymentChannel: "cash",
        issuedByUserId: user.id,
        status: "issued",
        metadataJson: { groupId },
      });
      if (policy.status === "inactive") {
        await storage.updatePolicy(policy.id, { status: "active", inceptionDate: today, effectiveDate: policy.effectiveDate || today }, user.organizationId);
        await storage.createPolicyStatusHistory(policy.id, "inactive", "active", "First premium paid — conversion (group receipt)", user.id);
      } else if (policy.status === "grace") {
        await storage.updatePolicy(policy.id, { status: "active", graceEndDate: null }, user.organizationId);
        await storage.createPolicyStatusHistory(policy.id, "grace", "active", "Payment received (group receipt)", user.id);
      } else if (policy.status === "lapsed") {
        await storage.updatePolicy(policy.id, { status: "active", graceEndDate: null }, user.organizationId);
        await storage.createPolicyStatusHistory(policy.id, "lapsed", "active", "Reinstatement — payment received (group receipt)", user.id);
        await rollbackClawbacks(user.organizationId, policy);
      }
      results.push({ policyId: policy.id, policyNumber: policy.policyNumber, amount, receiptNumber: receiptNum });
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
    const intent = await storage.createGroupPaymentIntent({
      organizationId: user.organizationId,
      groupId,
      totalAmount: amountNum.toFixed(2),
      currency: cur,
      status: "created",
      idempotencyKey,
      merchantReference,
      initiatedByUserId: user.id,
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

  app.get("/api/cashups", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const fromDate = typeof req.query.fromDate === "string" && req.query.fromDate ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === "string" && req.query.toDate ? req.query.toDate : undefined;
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
    const filters = (fromDate || toDate || userId) ? { fromDate, toDate, preparedBy: userId } : undefined;
    return res.json(await storage.getCashups(user.organizationId, 100, filters));
  });

  app.post("/api/cashups", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertCashupSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      preparedBy: user.id,
    });
    const cashup = await storage.createCashup(parsed);
    await auditLog(req, "CREATE_CASHUP", "Cashup", cashup.id, null, cashup);
    return res.status(201).json(cashup);
  });

  // ─── Claims ─────────────────────────────────────────────────

  app.get("/api/claims", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
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
      const perms = await storage.getUserEffectivePermissions(user.id);
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
    const parsed = insertFuneralTaskSchema.parse({ ...req.body, funeralCaseId: req.params.id as string });
    const task = await storage.createFuneralTask(parsed);
    return res.status(201).json(task);
  });

  app.patch("/api/funeral-tasks/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await storage.updateFuneralTask(id, req.body, user.organizationId);
    return res.json(updated);
  });

  // ─── Fleet ──────────────────────────────────────────────────

  app.get("/api/fleet", requireAuth, requireTenantScope, requirePermission("read:fleet"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getFleetVehicles(user.organizationId));
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
    return res.json(await storage.getCommissionLedgerDetailedByOrg(user.organizationId, filterAgent));
  });

  // ─── Leads / Pipeline ──────────────────────────────────────

  app.get("/api/leads", requireAuth, requireTenantScope, requirePermission("read:lead"), async (req, res) => {
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
    return res.json(await storage.getPayrollEmployees(user.organizationId));
  });

  app.post("/api/payroll/employees", requireAuth, requireTenantScope, requirePermission("write:payroll"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertPayrollEmployeeSchema.parse({ ...req.body, organizationId: user.organizationId });
    const emp = await storage.createPayrollEmployee(parsed);
    return res.status(201).json(emp);
  });

  app.get("/api/payroll/runs", requireAuth, requireTenantScope, requirePermission("read:payroll"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getPayrollRuns(user.organizationId));
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

  app.get("/api/security-questions", async (req, res) => {
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

  // ─── Public branding (no auth required, for login/splash screens) ──
  app.get("/api/public/branding", async (req, res) => {
    const NEUTRAL = { name: "POL263", logoUrl: "/assets/logo.png", isWhitelabeled: false, primaryColor: "#D4AF37" };
    const orgIdParam = typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
    if (!orgIdParam) {
      return res.json(NEUTRAL);
    }
    const org = await storage.getOrganization(orgIdParam);
    if (!org || org.name?.endsWith("(deleted)")) return res.json(NEUTRAL);
    return res.json({
      name: org.name,
      logoUrl: org.logoUrl || "/assets/logo.png",
      primaryColor: org.primaryColor || "#D4AF37",
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
    const withVersions = await Promise.all(
      products.filter((p) => p.isActive).map(async (p) => {
        const versions = await storage.getProductVersions(p.id, orgId);
        return { ...p, versions: versions.filter((v) => v.isActive !== false) };
      })
    );
    const branches = await storage.getBranchesByOrg(orgId);
    return res.json({
      agentName: agent.displayName || agent.email,
      referralCode: ref,
      products: withVersions,
      branches: branches.filter((b) => b.isActive),
    });
  });

  app.post("/api/public/register-policy", express.json(), async (req, res) => {
    const { referralCode, firstName, lastName, email, phone, dateOfBirth, nationalId, productVersionId, branchId, premiumAmount, currency, paymentSchedule, dependents: rawDeps, beneficiary: rawBeneficiary } = req.body;
    const missingFields: string[] = [];
    if (!referralCode) missingFields.push("referralCode");
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!productVersionId) missingFields.push("productVersionId");
    if (missingFields.length > 0) {
      return res.status(400).json({ message: `Missing required fields: ${missingFields.join(", ")}` });
    }
    const agent = await storage.getUserByReferralCode(referralCode);
    if (!agent) return res.status(400).json({ message: "Invalid referral code" });
    if (!agent.organizationId) return res.status(400).json({ message: "Agent has no organization" });
    const orgId = agent.organizationId;
    const pv = await storage.getProductVersion(productVersionId, orgId);
    if (!pv) return res.status(400).json({ message: "Invalid product version" });
    const product = await storage.getProduct(pv.productId, orgId);
    if (!product) return res.status(400).json({ message: "Product not found" });
    const effectiveBranchId = branchId || agent.branchId || null;

    // Reuse existing client when identified by email or national ID (no duplicate clients)
    let client: Awaited<ReturnType<typeof storage.createClient>>;
    const emailTrim = email ? String(email).trim() : "";
    const nationalIdTrim = nationalId ? String(nationalId).trim() : "";
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
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: emailTrim || null,
        phone: phone ? String(phone).trim() : null,
        dateOfBirth: dateOfBirth || null,
        nationalId: nationalIdTrim || null,
        activationCode,
        isEnrolled: false,
        agentId: agent.id,
      });
      client = await storage.createClient(clientParsed);
    }

    try {
      const policyNumber = await storage.generatePolicyNumber(orgId);
      const premium = await computePolicyPremium(
        orgId,
        productVersionId,
        currency || "USD",
        paymentSchedule || "monthly",
        [],
      );
      const depsList = Array.isArray(rawDeps) ? rawDeps : [];
      const createdDeps: Awaited<ReturnType<typeof storage.createDependent>>[] = [];
      for (const d of depsList) {
        if (d.firstName && d.lastName && d.relationship) {
          const dep = await storage.createDependent({
            organizationId: orgId,
            clientId: client.id,
            firstName: String(d.firstName).trim(),
            lastName: String(d.lastName).trim(),
            relationship: String(d.relationship).trim(),
            dateOfBirth: d.dateOfBirth || null,
            nationalId: d.nationalId ? String(d.nationalId).trim() : null,
            gender: d.gender || null,
          });
          createdDeps.push(dep);
        }
      }

      const ben = rawBeneficiary && rawBeneficiary.firstName && rawBeneficiary.lastName ? rawBeneficiary : null;
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
      const policy = await storage.createPolicy(policyParsed);
      await storage.createPolicyStatusHistory(policy.id, null, "inactive", "Registered via agent link");
      await storage.createPolicyMember({
        policyId: policy.id,
        clientId: client.id,
        role: "policy_holder",
      });
      for (const dep of createdDeps) {
        await storage.createPolicyMember({
          policyId: policy.id,
          dependentId: dep.id,
          role: "dependent",
        });
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

  app.get("/api/groups", requireAuth, requireTenantScope, async (req, res) => {
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
    return res.json(await storage.getSettlements(user.organizationId));
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
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent) {
      const agentPolicies = await storage.getPoliciesByAgent(user.id, user.organizationId);
      const activePolicies = agentPolicies.filter((p: any) => p.status === "active");
      let coveredLives = 0;
      for (const p of activePolicies) {
        const members = await storage.getPolicyMembers(p.id, user.organizationId);
        coveredLives += members.length;
      }
      return res.json({ coveredLives, activePolicyCount: activePolicies.length });
    }
    const result = await storage.countCoveredLives(user.organizationId);
    return res.json(result);
  });

  app.get("/api/dashboard/product-performance", requireAuth, requireTenantScope, async (req, res) => {
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
    for (const prod of allProducts) {
      const versions = await storage.getProductVersions(prod.id, user.organizationId);
      versions.forEach((v: { id: string }) => { pvToProductId[v.id] = prod.id; });
    }
    const policyByProduct: Record<string, { total: number; active: number; lapsed: number }> = {};
    allPolicies.forEach((p: any) => {
      const pid = pvToProductId[p.productVersionId] || "unknown";
      if (!policyByProduct[pid]) policyByProduct[pid] = { total: 0, active: 0, lapsed: 0 };
      policyByProduct[pid].total++;
      if (p.status === "active") policyByProduct[pid].active++;
      if (p.status === "lapsed") policyByProduct[pid].lapsed++;
    });

    const revenueByProduct: Record<string, number> = {};
    allPayments.filter((p: any) => p.status === "cleared").forEach((p: any) => {
      const pol = allPolicies.find((pol: any) => pol.id === p.policyId);
      const pid = pol ? (pvToProductId[pol.productVersionId] || "unknown") : "unknown";
      revenueByProduct[pid] = (revenueByProduct[pid] || 0) + parseFloat(p.amount || "0");
    });

    const performance = allProducts.map((prod: any) => ({
      id: prod.id,
      name: prod.name,
      totalPolicies: policyByProduct[prod.id]?.total || 0,
      activePolicies: policyByProduct[prod.id]?.active || 0,
      lapsedPolicies: policyByProduct[prod.id]?.lapsed || 0,
      revenue: revenueByProduct[prod.id] || 0,
    }));

    return res.json(performance);
  });

  app.get("/api/dashboard/lapse-retention", requireAuth, requireTenantScope, async (req, res) => {
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

  async function enforceAgentScope(req: Request, filters: ReturnType<typeof parseReportFilters>) {
    const user = req.user as any;
    const userRoles = await storage.getUserRoles(user.id, user.organizationId);
    const isAgent = userRoles.some((r: { name?: string }) => r?.name === "agent");
    if (isAgent) {
      filters.agentId = user.id;
    }
    return filters;
  }

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
    return res.json(await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...filters, statuses: ["inactive", "active", "grace", "lapsed", "cancelled"] }));
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

  app.get("/api/reports/export/:type", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const reportType = req.params.type as string;
    const reportFilters = await enforceAgentScope(req, parseReportFilters(req.query));

    try {
      let rows: any[] = [];
      let headers: string[] = [];

      switch (reportType) {
        case "policies": {
          rows = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = rows.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
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
            "Policy Number", "Status", "Currency", "Premium", "Capture Date", "Inception Date", "Cover Date", "Due Date", "Date Paid", "Receipt Count", "Months Paid", "Grace Days Used", "Grace Days Remaining", "Outstanding Premium", "Advance Premium",
            "Client Name", "Product", "Product Code", "Branch", "Group", "Agent",
          ];
          rows = reportRows.map((r: any) => [
            r.policyNumber, r.status, r.currency, r.premiumAmount, r.policyCreatedAt ?? "", r.inceptionDate ?? "", r.waitingPeriodEndDate ?? "", r.dueDate ?? "", r.datePaid ?? "", r.receiptCount, r.monthsPaid, r.graceDaysUsed, r.graceDaysRemaining ?? "", r.outstandingPremium, r.advancePremium,
            [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" "), r.productName ?? "", r.productCode ?? "", r.branchName ?? "", r.groupName ?? "", r.agentDisplayName ?? r.agentEmail ?? "",
          ]);
          break;
        }
        case "underwriter-payable": {
          const result = await storage.getUnderwriterPayableReport(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = [
            "Policy Number", "Status", "Client First Name", "Client Last Name", "Client Phone", "Client Email", "Product Name", "Product Code", "Branch",
            "Adults", "Children", "Underwriter Amount Adult", "Underwriter Amount Child", "Advance Months", "Monthly Payable", "Total Payable",
          ];
          rows = result.rows.map((r: any) => [
            r.policyNumber, r.status, r.clientFirstName ?? "", r.clientLastName ?? "", r.clientPhone ?? "", r.clientEmail ?? "",
            r.productName ?? "", r.productCode ?? "", r.branchName ?? "",
            r.adults, r.children, r.underwriterAmountAdult ?? "", r.underwriterAmountChild ?? "", r.underwriterAdvanceMonths,
            r.monthlyPayable.toFixed(2), r.totalPayable.toFixed(2),
          ]);
          break;
        }
        case "claims": {
          rows = await storage.getClaimsByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Claim Number", "Type", "Status", "Deceased Name", "Created"];
          rows = rows.map((r: any) => [r.claimNumber, r.claimType, r.status, r.deceasedName || "", r.createdAt]);
          break;
        }
        case "payments": {
          rows = await storage.getPaymentsByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Reference", "Amount", "Currency", "Method", "Status", "Received At"];
          rows = rows.map((r: any) => [r.reference || "", r.amount, r.currency, r.paymentMethod, r.status, r.receivedAt]);
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
          headers = ["Description", "Category", "Amount", "Currency", "Date", "Receipt Ref"];
          rows = exps.map((r: any) => [r.description, r.category, r.amount, r.currency, r.spentAt || r.createdAt, r.receiptRef || ""]);
          break;
        }
        case "payroll": {
          const employees = await storage.getPayrollEmployees(user.organizationId);
          headers = ["Employee Name", "ID Number", "Position", "Department", "Basic Salary", "Status"];
          rows = employees.map((r: any) => [r.employeeName, r.idNumber, r.position, r.department, r.basicSalary, r.status]);
          break;
        }
        case "commissions": {
          const agentFilter = typeof req.query.agentId === "string" ? req.query.agentId : null;
          if (agentFilter) {
            const ledger = await storage.getCommissionLedgerByAgent(agentFilter, user.organizationId);
            headers = ["Agent ID", "Entry Type", "Amount", "Currency", "Description", "Period Start", "Period End", "Status", "Created"];
            rows = ledger.map((r: any) => [r.agentId, r.entryType, r.amount, r.currency, r.description || "", r.periodStart || "", r.periodEnd || "", r.status, r.createdAt]);
          } else {
            const plans = await storage.getCommissionPlans(user.organizationId);
            headers = ["Plan Name", "Type", "Rate (%)", "Status", "Created"];
            rows = plans.map((r: any) => [r.name, r.commissionType, r.ratePercent, r.isActive ? "Active" : "Inactive", r.createdAt]);
          }
          break;
        }
        case "platform": {
          const receivables = await storage.getPlatformReceivables(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = ["Description", "Amount", "Currency", "Settled", "Created"];
          rows = receivables.map((r: any) => [r.description, r.amount, r.currency, r.isSettled ? "Yes" : "No", r.createdAt]);
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
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = active.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
          break;
        }
        case "awaiting-payments": {
          const awaiting = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, statuses: ["active", "grace"] });
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = awaiting.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
          break;
        }
        case "overdue":
        case "pre-lapse": {
          const grace = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, status: "grace" });
          headers = ["Policy Number", "Status", "Currency", "Premium", "Grace End Date", "Created"];
          rows = grace.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.graceEndDate || "", r.createdAt]);
          break;
        }
        case "lapsed": {
          const lapsed = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, status: "lapsed" });
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = lapsed.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
          break;
        }
        case "issued-policies": {
          const issued = await storage.getPoliciesByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, { ...reportFilters, statuses: ["inactive", "active", "grace", "lapsed", "cancelled"] });
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = issued.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
          break;
        }
        case "cashups": {
          const cashupsList = await storage.getCashups(user.organizationId, REPORT_EXPORT_MAX_ROWS, { ...reportFilters, preparedBy: reportFilters.userId });
          headers = ["Cashup Date", "Total Amount", "Transaction Count", "Locked", "Prepared By", "Created"];
          rows = cashupsList.map((r: any) => [r.cashupDate, r.totalAmount, r.transactionCount, r.isLocked ? "Yes" : "No", r.preparedBy, r.createdAt]);
          break;
        }
        case "receipts": {
          const receiptRows = await storage.getReceiptReportByOrg(user.organizationId, REPORT_EXPORT_MAX_ROWS, 0, reportFilters);
          headers = [
            "Receipt Number", "Date Paid", "Timestamp", "Payment Method", "Total",
            "Premium Amount", "Remarks", "Agent", "Months Paid", "Policy / Surname",
            "Reference", "Product", "Inception Date", "Month Number", "Year Number",
            "Receipt Counter", "Receipt Branch", "Payment Branch", "Policy Status",
          ];
          rows = receiptRows.map((r: any, idx: number) => [
            r.receiptNumber,
            r.issuedAt ? new Date(r.issuedAt).toISOString().split("T")[0] : "",
            r.issuedAt ? new Date(r.issuedAt).toISOString() : "",
            r.paymentChannel || r.txPaymentMethod || "",
            r.amount,
            r.premiumAmount || "",
            r.txNotes || "",
            r.agentDisplayName || r.agentEmail || "",
            r.paymentSchedule || "",
            `${r.policyNumber || ""} / ${[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}`,
            r.txReference || "",
            r.productName || "",
            r.inceptionDate || "",
            r.monthNumber ?? "",
            r.yearNumber ?? "",
            idx + 1,
            r.receiptBranchName || "",
            r.paymentBranchName || r.policyBranchName || "",
            r.policyStatus || "",
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

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${reportType}-report.csv"`);
      return res.send(csvLines.join("\n"));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
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
      return res.json({
        dbConnected,
        uptime: process.uptime(),
        tableCounts,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
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
      return res.status(500).json({ message: err.message });
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
      return res.status(500).json({ message: err.message });
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
      return res.status(500).json({ message: err.message });
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
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/run-notifications", requireAuth, requirePermission("manage:settings"), async (req, res) => {
    const user = req.user as any;
    const orgId = user.organizationId;
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    let birthdayCount = 0;
    let preLapseCount = 0;
    let lapseCount = 0;

    const allClients = await storage.getClientsByOrg(orgId, 100000, 0);
    for (const c of allClients) {
      if (c.dateOfBirth) {
        const dob = new Date(c.dateOfBirth);
        if (dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate()) {
          await notifyClient(orgId, c.id, "Happy Birthday!", `Wishing you a wonderful birthday, ${c.firstName}!`);
          birthdayCount++;
        }
      }
    }

    const allPolicies = await storage.getPoliciesByOrg(orgId, 100000, 0);
    for (const p of allPolicies) {
      if (p.status === "active" && p.clientId && p.graceEndDate) {
        const graceEnd = new Date(p.graceEndDate);
        const daysToGrace = Math.ceil((graceEnd.getTime() - today.getTime()) / 86400000);
        if (daysToGrace === 7) {
          await notifyClient(orgId, p.clientId, "Payment Reminder", `Your policy ${p.policyNumber} payment is due. Grace period ends in 7 days.`);
          preLapseCount++;
        } else if (daysToGrace <= 0) {
          await notifyClient(orgId, p.clientId, "Policy Lapsed", `Your policy ${p.policyNumber} has lapsed due to non-payment. Contact us to reinstate.`);
          lapseCount++;
        }
      }
    }

    return res.json({ birthdayCount, preLapseCount, lapseCount });
  });

  app.post("/api/admin/sync-permissions", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    try {
      const { seedDatabase } = await import("./seed");
      await seedDatabase();
      return res.json({ success: true, message: "Permissions and roles synchronized" });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
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
