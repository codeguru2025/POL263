import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { requireAuth, requirePermission, requireTenantScope } from "./auth";
import { structuredLog } from "./logger";
import { z } from "zod";
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
  VALID_POLICY_TRANSITIONS, VALID_CLAIM_TRANSITIONS,
} from "@shared/schema";

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

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ─── Organization / Tenant ──────────────────────────────────

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
    if (id !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const org = await storage.getOrganization(id);
    if (!org) return res.status(404).json({ message: "Not found" });
    return res.json(org);
  });

  app.patch("/api/organizations/:id", requireAuth, requireTenantScope, requirePermission("write:organization"), async (req, res) => {
    const user = req.user as any;
    const id = req.params.id as string;
    if (id !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const before = await storage.getOrganization(id);
    const updated = await storage.updateOrganization(id, req.body);
    await auditLog(req, "UPDATE_ORGANIZATION", "Organization", id, before, updated);
    return res.json(updated);
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
    const usersList = await storage.getUsersByOrg(user.organizationId);
    return res.json(usersList.map((u) => ({
      id: u.id, email: u.email, displayName: u.displayName,
      avatarUrl: u.avatarUrl, isActive: u.isActive, createdAt: u.createdAt,
    })));
  });

  // ─── Roles ──────────────────────────────────────────────────

  app.get("/api/roles", requireAuth, requireTenantScope, requirePermission("read:role"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getRolesByOrg(user.organizationId));
  });

  app.get("/api/roles/:id/permissions", requireAuth, requireTenantScope, requirePermission("read:role"), async (req, res) => {
    return res.json(await storage.getRolePermissions(req.params.id as string));
  });

  // ─── Permissions ────────────────────────────────────────────

  app.get("/api/permissions", requireAuth, requirePermission("read:role"), async (_req, res) => {
    return res.json(await storage.getPermissions());
  });

  // ─── Audit Logs ─────────────────────────────────────────────

  app.get("/api/audit-logs", requireAuth, requireTenantScope, requirePermission("read:audit_log"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getAuditLogs(user.organizationId, limit, offset));
  });

  // ─── Dashboard Stats ───────────────────────────────────────

  app.get("/api/dashboard/stats", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getDashboardStats(user.organizationId));
  });

  // ─── Clients ────────────────────────────────────────────────

  app.get("/api/clients", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getClientsByOrg(user.organizationId, limit, offset));
  });

  app.get("/api/clients/:id", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const client = await storage.getClient(req.params.id as string);
    if (!client) return res.status(404).json({ message: "Not found" });
    const user = req.user as any;
    if (client.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    return res.json(client);
  });

  app.post("/api/clients", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const activationCode = `ACT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const parsed = insertClientSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      branchId: req.body.branchId || user.branchId,
      activationCode,
    });
    const client = await storage.createClient(parsed);
    await auditLog(req, "CREATE_CLIENT", "Client", client.id, null, client);
    return res.status(201).json(client);
  });

  app.patch("/api/clients/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getClient(req.params.id as string);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateClient(req.params.id as string, req.body);
    await auditLog(req, "UPDATE_CLIENT", "Client", req.params.id as string, before, updated);
    return res.json(updated);
  });

  // ─── Products ───────────────────────────────────────────────

  app.get("/api/products", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getProductsByOrg(user.organizationId));
  });

  app.get("/api/products/:id", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const product = await storage.getProduct(req.params.id as string);
    if (!product) return res.status(404).json({ message: "Not found" });
    const user = req.user as any;
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
    const before = await storage.getProduct(req.params.id as string);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateProduct(req.params.id as string, req.body);
    await auditLog(req, "UPDATE_PRODUCT", "Product", req.params.id as string, before, updated);
    return res.json(updated);
  });

  app.get("/api/products/:id/versions", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    return res.json(await storage.getProductVersions(req.params.id as string));
  });

  app.post("/api/products/:id/versions", requireAuth, requireTenantScope, requirePermission("write:product"), async (req, res) => {
    const user = req.user as any;
    const versions = await storage.getProductVersions(req.params.id as string);
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

  // ─── Policies ───────────────────────────────────────────────

  app.get("/api/policies", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getPoliciesByOrg(user.organizationId, limit, offset));
  });

  app.get("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    const policy = await storage.getPolicy(req.params.id as string);
    if (!policy) return res.status(404).json({ message: "Not found" });
    const user = req.user as any;
    if (policy.organizationId !== user.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    return res.json(policy);
  });

  app.post("/api/policies", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const policyNumber = await storage.generatePolicyNumber(user.organizationId);
    const parsed = insertPolicySchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      policyNumber,
      status: "draft",
    });
    const policy = await storage.createPolicy(parsed);
    await storage.createPolicyStatusHistory(policy.id, null, "draft", "Policy created", user.id);
    await auditLog(req, "CREATE_POLICY", "Policy", policy.id, null, policy);
    return res.status(201).json(policy);
  });

  app.patch("/api/policies/:id", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const before = await storage.getPolicy(req.params.id as string);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updatePolicy(req.params.id as string, req.body);
    await auditLog(req, "UPDATE_POLICY", "Policy", req.params.id as string, before, updated);
    return res.json(updated);
  });

  app.post("/api/policies/:id/transition", requireAuth, requireTenantScope, requirePermission("write:policy"), async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string);
    if (!policy || policy.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });

    const { toStatus, reason } = req.body;
    const allowed = VALID_POLICY_TRANSITIONS[policy.status];
    if (!allowed || !allowed.includes(toStatus)) {
      return res.status(400).json({ message: `Invalid transition from ${policy.status} to ${toStatus}` });
    }

    const before = { ...policy };
    const updated = await storage.updatePolicy(policy.id, { status: toStatus });
    await storage.createPolicyStatusHistory(policy.id, policy.status, toStatus, reason, user.id);
    await auditLog(req, "TRANSITION_POLICY", "Policy", policy.id, before, updated);
    return res.json(updated);
  });

  app.get("/api/policies/:id/members", requireAuth, requireTenantScope, requirePermission("read:policy"), async (req, res) => {
    return res.json(await storage.getPolicyMembers(req.params.id as string));
  });

  // ─── Payments ───────────────────────────────────────────────

  app.get("/api/payments", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getPaymentsByOrg(user.organizationId, limit, offset));
  });

  app.get("/api/policies/:id/payments", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    return res.json(await storage.getPaymentsByPolicy(req.params.id as string));
  });

  app.post("/api/payments", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const user = req.user as any;
    const today = new Date().toISOString().split("T")[0];
    const parsed = insertPaymentTransactionSchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      recordedBy: user.id,
      postedDate: req.body.postedDate || today,
      valueDate: req.body.valueDate || today,
    });
    const tx = await storage.createPaymentTransaction(parsed);

    let receipt = null;
    if (tx.status === "cleared" && tx.policyId) {
      const receiptNumber = await storage.getNextReceiptNumber(user.organizationId);
      receipt = await storage.createReceipt({
        organizationId: user.organizationId,
        receiptNumber,
        transactionId: tx.id,
        policyId: tx.policyId,
        clientId: tx.clientId,
        amount: tx.amount,
        currency: tx.currency,
      });
    }

    await auditLog(req, "CREATE_PAYMENT", "PaymentTransaction", tx.id, null, tx);
    return res.status(201).json({ ...tx, receipt });
  });

  app.get("/api/policies/:id/receipts", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    return res.json(await storage.getReceiptsByPolicy(req.params.id as string));
  });

  // ─── Cashups ────────────────────────────────────────────────

  app.get("/api/cashups", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getCashups(user.organizationId));
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
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getClaimsByOrg(user.organizationId, limit, offset));
  });

  app.get("/api/claims/:id", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
    const claim = await storage.getClaim(req.params.id as string);
    if (!claim) return res.status(404).json({ message: "Not found" });
    const user = req.user as any;
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
    const claim = await storage.getClaim(req.params.id as string);
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

    const updated = await storage.updateClaim(claim.id, updateData);
    await storage.createClaimStatusHistory(claim.id, claim.status, toStatus, reason, user.id);
    await auditLog(req, "TRANSITION_CLAIM", "Claim", claim.id, before, updated);
    return res.json(updated);
  });

  app.get("/api/claims/:id/documents", requireAuth, requireTenantScope, requirePermission("read:claim"), async (req, res) => {
    return res.json(await storage.getClaimDocuments(req.params.id as string));
  });

  // ─── Funeral Cases ──────────────────────────────────────────

  app.get("/api/funeral-cases", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getFuneralCasesByOrg(user.organizationId, limit, offset));
  });

  app.get("/api/funeral-cases/:id", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    const fc = await storage.getFuneralCase(req.params.id as string);
    if (!fc) return res.status(404).json({ message: "Not found" });
    const user = req.user as any;
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
    const before = await storage.getFuneralCase(req.params.id as string);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateFuneralCase(req.params.id as string, req.body);
    await auditLog(req, "UPDATE_FUNERAL_CASE", "FuneralCase", req.params.id as string, before, updated);
    return res.json(updated);
  });

  app.get("/api/funeral-cases/:id/tasks", requireAuth, requireTenantScope, requirePermission("read:funeral_ops"), async (req, res) => {
    return res.json(await storage.getFuneralTasks(req.params.id as string));
  });

  app.post("/api/funeral-cases/:id/tasks", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const parsed = insertFuneralTaskSchema.parse({ ...req.body, funeralCaseId: req.params.id as string });
    const task = await storage.createFuneralTask(parsed);
    return res.status(201).json(task);
  });

  app.patch("/api/funeral-tasks/:id", requireAuth, requireTenantScope, requirePermission("write:funeral_ops"), async (req, res) => {
    const updated = await storage.updateFuneralTask(req.params.id as string, req.body);
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

  // ─── Leads / Pipeline ──────────────────────────────────────

  app.get("/api/leads", requireAuth, requireTenantScope, requirePermission("read:lead"), async (req, res) => {
    const user = req.user as any;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getLeadsByOrg(user.organizationId, limit, offset));
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
    const before = await storage.getLead(req.params.id as string);
    if (!before || before.organizationId !== user.organizationId) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateLead(req.params.id as string, req.body);
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
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    return res.json(await storage.getExpenditures(user.organizationId, limit, offset));
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
    });
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
    const orgs = await storage.getOrganizations();
    if (orgs.length > 0) {
      return res.json(await storage.getSecurityQuestions(orgs[0].id));
    }
    return res.json([]);
  });

  return httpServer;
}
