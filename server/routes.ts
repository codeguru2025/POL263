import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { requireAuth, requirePermission, requireTenantScope } from "./auth";
import { structuredLog } from "./logger";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";
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
  insertGroupSchema, insertChibikhuluReceivableSchema, insertSettlementSchema,
  insertDependentSchema, insertTermsSchema,
  VALID_POLICY_TRANSITIONS, VALID_CLAIM_TRANSITIONS,
} from "@shared/schema";
import PDFDocument from "pdfkit";

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

  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use("/uploads", express.static(uploadsDir));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
      if (allowed.test(path.extname(file.originalname))) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = `/uploads/${req.file.filename}`;
    return res.json({ url, filename: req.file.filename });
  });

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
    const usersWithRoles = await Promise.all(usersList.map(async (u) => {
      const userRoles = await storage.getUserRoles(u.id);
      return {
        id: u.id, email: u.email, displayName: u.displayName,
        avatarUrl: u.avatarUrl, isActive: u.isActive, createdAt: u.createdAt,
        referralCode: u.referralCode, branchId: u.branchId,
        roles: userRoles.map(r => ({ id: r.id, name: r.name })),
      };
    }));
    return res.json(usersWithRoles);
  });

  app.get("/api/users/:id", requireAuth, requireTenantScope, requirePermission("read:user"), async (req, res) => {
    const targetUser = await storage.getUser(req.params.id as string);
    if (!targetUser) return res.status(404).json({ message: "User not found" });
    const currentUser = req.user as any;
    if (targetUser.organizationId !== currentUser.organizationId) return res.status(403).json({ message: "Cross-tenant access denied" });
    const userRoles = await storage.getUserRoles(targetUser.id);
    return res.json({
      ...targetUser,
      roles: userRoles.map(r => ({ id: r.id, name: r.name })),
    });
  });

  app.post("/api/users", requireAuth, requireTenantScope, requirePermission("write:user"), async (req, res) => {
    const currentUser = req.user as any;
    const { email, displayName, roleIds, branchId } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const existing = await storage.getUserByEmail(email);
    if (existing) return res.status(409).json({ message: "A user with this email already exists" });

    const refCode = `AGT${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const newUser = await storage.createUser({
      email,
      displayName: displayName || email.split("@")[0],
      organizationId: currentUser.organizationId,
      branchId: branchId || currentUser.branchId,
      referralCode: refCode,
      isActive: true,
    });

    if (roleIds && Array.isArray(roleIds)) {
      for (const roleId of roleIds) {
        await storage.addUserRole(newUser.id, roleId);
      }
    }

    const userRoles = await storage.getUserRoles(newUser.id);
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
    const { displayName, isActive, branchId, roleIds } = req.body;
    const updates: any = {};
    if (displayName !== undefined) updates.displayName = displayName;
    if (isActive !== undefined) updates.isActive = isActive;
    if (branchId !== undefined) updates.branchId = branchId;
    const updated = await storage.updateUser(req.params.id as string, updates);

    if (roleIds && Array.isArray(roleIds)) {
      await storage.clearUserRoles(req.params.id as string);
      for (const roleId of roleIds) {
        await storage.addUserRole(req.params.id as string, roleId);
      }
    }

    const userRoles = await storage.getUserRoles(req.params.id as string);
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

  // ─── Dependents / Beneficiaries ─────────────────────────────

  app.get("/api/clients/:clientId/dependents", requireAuth, requireTenantScope, requirePermission("read:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    return res.json(await storage.getDependentsByClient(req.params.clientId as string));
  });

  app.post("/api/clients/:clientId/dependents", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string);
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
    const client = await storage.getClient(req.params.clientId as string);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    const updated = await storage.updateDependent(req.params.id as string, req.body);
    if (!updated) return res.status(404).json({ message: "Dependent not found" });
    await auditLog(req, "UPDATE_DEPENDENT", "Dependent", req.params.id as string, null, updated);
    return res.json(updated);
  });

  app.delete("/api/clients/:clientId/dependents/:id", requireAuth, requireTenantScope, requirePermission("write:client"), async (req, res) => {
    const user = req.user as any;
    const client = await storage.getClient(req.params.clientId as string);
    if (!client || client.organizationId !== user.organizationId) return res.status(404).json({ message: "Client not found" });
    await storage.deleteDependent(req.params.id as string);
    await auditLog(req, "DELETE_DEPENDENT", "Dependent", req.params.id as string, null, null);
    return res.status(204).send();
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

    let agentId = req.body.agentId || null;
    if (!agentId && req.body.referralCode) {
      const agent = await storage.getUserByReferralCode(req.body.referralCode);
      if (agent && agent.organizationId === user.organizationId) {
        agentId = agent.id;
      }
    }

    const parsed = insertPolicySchema.parse({
      ...req.body,
      organizationId: user.organizationId,
      policyNumber,
      status: "draft",
      agentId,
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

    if (tx.status === "cleared") {
      const chibAmount = (parseFloat(tx.amount) * 0.025).toFixed(2);
      await storage.createChibikhuluReceivable({
        organizationId: user.organizationId,
        sourceTransactionId: tx.id,
        amount: chibAmount,
        currency: tx.currency,
        description: `2.5% on payment ${tx.id}`,
        isSettled: false,
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

  // ─── Agent Referral Links ─────────────────────────────────

  app.get("/api/agents/by-referral/:code", async (req, res) => {
    const code = String(req.params.code);
    const orgs = await storage.getOrganizations();
    if (orgs.length === 0) return res.status(404).json({ error: "Not found" });
    const allUsers = await storage.getUsersByOrg(orgs[0].id);
    const agent = allUsers.find((u: any) => u.referralCode === code);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    return res.json({ name: agent.displayName || agent.email, referralCode: code });
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
    const existing = await storage.getGroup(id);
    if (!existing) return res.status(404).json({ error: "Group not found" });
    const user = req.user as any;
    if (existing.organizationId !== user.organizationId) return res.status(403).json({ error: "Forbidden" });
    const updated = await storage.updateGroup(id, req.body);
    await auditLog(req, "UPDATE_GROUP", "Group", id, existing, updated);
    return res.json(updated);
  });

  // ─── Chibikhulu Revenue Share ────────────────────────────

  app.get("/api/chibikhulu/receivables", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    const limit = parseInt(String(req.query.limit) || "100");
    const offset = parseInt(String(req.query.offset) || "0");
    return res.json(await storage.getChibikhuluReceivables(user.organizationId, limit, offset));
  });

  app.get("/api/chibikhulu/summary", requireAuth, requireTenantScope, requirePermission("read:finance"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getChibikhuluSummary(user.organizationId));
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
    const updated = await storage.updateSettlement(id, { status: "approved", approvedBy: user.id });
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
    const id = String(req.params.id);
    return res.json(await storage.getCostLineItems(id));
  });

  app.post("/api/cost-sheets/:id/items", requireAuth, requireTenantScope, requirePermission("write:finance"), async (req, res) => {
    const costSheetId = String(req.params.id);
    const item = await storage.createCostLineItem({ ...req.body, costSheetId });
    return res.status(201).json(item);
  });

  // ─── Diagnostics ────────────────────────────────────────

  app.get("/api/diagnostics", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const stats = await storage.getDashboardStats(user.organizationId);
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
    const payments = await storage.getPaymentsByOrg(user.organizationId, 1000, 0);
    const cleared = payments.filter((p: any) => p.status === "cleared");
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
    const allPolicies = await storage.getPoliciesByOrg(user.organizationId, 10000, 0);
    const breakdown: Record<string, number> = {};
    allPolicies.forEach((p: any) => {
      breakdown[p.status] = (breakdown[p.status] || 0) + 1;
    });
    return res.json(breakdown);
  });

  app.get("/api/dashboard/lead-funnel", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const allLeads = await storage.getLeadsByOrg(user.organizationId, 10000, 0);
    const stages: Record<string, number> = {};
    allLeads.forEach((l: any) => {
      stages[l.stage] = (stages[l.stage] || 0) + 1;
    });
    return res.json(stages);
  });

  app.get("/api/dashboard/covered-lives", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const activePolicies = await storage.getPoliciesByOrg(user.organizationId, 100000, 0);
    const active = activePolicies.filter((p: any) => p.status === "active");
    let totalMembers = 0;
    for (const p of active) {
      totalMembers += (p as any).numberOfMembers || 1;
    }
    return res.json({ coveredLives: totalMembers, activePolicyCount: active.length });
  });

  app.get("/api/dashboard/product-performance", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const allProducts = await storage.getProductsByOrg(user.organizationId);
    const allPolicies = await storage.getPoliciesByOrg(user.organizationId, 100000, 0);
    const allPayments = await storage.getPaymentsByOrg(user.organizationId, 100000, 0);

    const policyByProduct: Record<string, { total: number; active: number; lapsed: number }> = {};
    allPolicies.forEach((p: any) => {
      const pid = p.productId || "unknown";
      if (!policyByProduct[pid]) policyByProduct[pid] = { total: 0, active: 0, lapsed: 0 };
      policyByProduct[pid].total++;
      if (p.status === "active") policyByProduct[pid].active++;
      if (p.status === "lapsed") policyByProduct[pid].lapsed++;
    });

    const revenueByProduct: Record<string, number> = {};
    allPayments.filter((p: any) => p.status === "cleared").forEach((p: any) => {
      const pol = allPolicies.find((pol: any) => pol.id === p.policyId);
      const pid = pol?.productId || "unknown";
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
    const allPolicies = await storage.getPoliciesByOrg(user.organizationId, 100000, 0);
    const total = allPolicies.length;
    const active = allPolicies.filter((p: any) => p.status === "active").length;
    const lapsed = allPolicies.filter((p: any) => p.status === "lapsed").length;
    const grace = allPolicies.filter((p: any) => p.status === "grace").length;
    const cancelled = allPolicies.filter((p: any) => p.status === "cancelled").length;
    const retentionRate = total > 0 ? ((active / total) * 100).toFixed(1) : "0";
    const lapseRate = total > 0 ? ((lapsed / total) * 100).toFixed(1) : "0";
    return res.json({ total, active, lapsed, grace, cancelled, retentionRate, lapseRate });
  });

  // ─── Terms & Conditions ──────────────────────────────────

  app.get("/api/terms", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getTermsByOrg(user.organizationId));
  });

  app.post("/api/terms", requireAuth, requireTenantScope, requirePermission("write:settings"), async (req, res) => {
    const user = req.user as any;
    const parsed = insertTermsSchema.parse({ ...req.body, organizationId: user.organizationId });
    const created = await storage.createTerms(parsed);
    return res.status(201).json(created);
  });

  app.patch("/api/terms/:id", requireAuth, requireTenantScope, requirePermission("write:settings"), async (req, res) => {
    const updated = await storage.updateTerms(req.params.id as string, req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  });

  app.delete("/api/terms/:id", requireAuth, requireTenantScope, requirePermission("write:settings"), async (req, res) => {
    await storage.deleteTerms(req.params.id as string);
    return res.status(204).send();
  });

  // ─── Policy Document PDF ───────────────────────────────────

  app.get("/api/policies/:id/document", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const policy = await storage.getPolicy(req.params.id as string);
    if (!policy || policy.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "Policy not found" });
    }

    const org = await storage.getOrganization(policy.organizationId);
    const client = await storage.getClient(policy.clientId);
    const dependentsList = await storage.getDependentsByClient(policy.clientId);
    const terms = await storage.getTermsByOrg(policy.organizationId);

    let productName = "N/A";
    let productVersion: any = null;
    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId);
      if (pv) {
        productVersion = pv;
        const prod = await storage.getProduct(pv.productId);
        if (prod) productName = `${prod.name} (${prod.code})`;
      }
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Policy-${policy.policyNumber}.pdf"`);
    doc.pipe(res);

    const primaryColor = org?.primaryColor || "#2563EB";

    doc.rect(0, 0, doc.page.width, 100).fill(primaryColor);
    doc.fillColor("#FFFFFF").fontSize(22).font("Helvetica-Bold")
      .text(org?.name || "Falakhe PMS", 50, 25, { align: "left" });
    doc.fontSize(10).font("Helvetica")
      .text("POLICY SCHEDULE", 50, 55, { align: "left" });

    const headerRight: string[] = [];
    if (org?.address) headerRight.push(org.address);
    if (org?.phone) headerRight.push(`Tel: ${org.phone}`);
    if (org?.email) headerRight.push(org.email);
    if (org?.website) headerRight.push(org.website);
    if (headerRight.length > 0) {
      doc.fontSize(8).text(headerRight.join(" | "), 50, 75, { align: "right", width: doc.page.width - 100 });
    }

    let y = 120;

    doc.fillColor("#000000").fontSize(16).font("Helvetica-Bold")
      .text("Policy Certificate", 50, y);
    y += 25;

    doc.fontSize(9).font("Helvetica").fillColor("#666666")
      .text(`Date Issued: ${new Date().toLocaleDateString("en-GB")}`, 50, y);
    y += 20;

    // Policy Details
    doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("Policy Details", 50, y);
    y += 5;
    doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(primaryColor).lineWidth(1).stroke();
    y += 20;

    const policyFields = [
      ["Policy Number", policy.policyNumber],
      ["Status", (policy.status || "draft").toUpperCase()],
      ["Product", productName],
      ["Currency", policy.currency],
      ["Premium Amount", `${policy.currency} ${parseFloat(policy.premiumAmount).toFixed(2)}`],
      ["Payment Schedule", (policy.paymentSchedule || "monthly").charAt(0).toUpperCase() + (policy.paymentSchedule || "monthly").slice(1)],
      ["Effective Date", policy.effectiveDate || "Not set"],
      ["Waiting Period End", policy.waitingPeriodEndDate || "N/A"],
    ];

    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    for (const [label, value] of policyFields) {
      doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font("Helvetica").text(`  ${value}`, { width: 350 });
      y += 15;
    }
    y += 10;

    // Principal Member Details
    if (client) {
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("Principal Member", 50, y);
      y += 5;
      doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(primaryColor).lineWidth(1).stroke();
      y += 20;

      const fullName = [client.title, client.firstName, client.lastName].filter(Boolean).join(" ");
      const clientFields = [
        ["Full Name", fullName],
        ["National ID", client.nationalId || "—"],
        ["Date of Birth", client.dateOfBirth || "—"],
        ["Gender", client.gender ? client.gender.charAt(0).toUpperCase() + client.gender.slice(1) : "—"],
        ["Marital Status", client.maritalStatus || "—"],
        ["Phone", client.phone || "—"],
        ["Email", client.email || "—"],
        ["Address", client.address || "—"],
      ];

      doc.font("Helvetica").fontSize(9).fillColor("#000000");
      for (const [label, value] of clientFields) {
        doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
        doc.font("Helvetica").text(`  ${value}`, { width: 350 });
        y += 15;
      }
      y += 10;
    }

    // Dependents
    if (dependentsList.length > 0) {
      if (y > 620) { doc.addPage(); y = 50; }
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("Dependents / Beneficiaries", 50, y);
      y += 5;
      doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(primaryColor).lineWidth(1).stroke();
      y += 20;

      doc.font("Helvetica-Bold").fontSize(8).fillColor("#333333");
      doc.text("Name", 50, y, { width: 140 });
      doc.text("Relationship", 195, y, { width: 80 });
      doc.text("National ID", 280, y, { width: 90 });
      doc.text("DOB", 375, y, { width: 70 });
      doc.text("Gender", 450, y, { width: 60 });
      y += 14;
      doc.moveTo(50, y).lineTo(545, y).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
      y += 4;

      doc.font("Helvetica").fontSize(8).fillColor("#000000");
      for (const dep of dependentsList) {
        if (y > 750) { doc.addPage(); y = 50; }
        doc.text(`${dep.firstName} ${dep.lastName}`, 50, y, { width: 140 });
        doc.text(dep.relationship, 195, y, { width: 80 });
        doc.text(dep.nationalId || "—", 280, y, { width: 90 });
        doc.text(dep.dateOfBirth || "—", 375, y, { width: 70 });
        doc.text(dep.gender ? dep.gender.charAt(0).toUpperCase() + dep.gender.slice(1) : "—", 450, y, { width: 60 });
        y += 14;
      }
      y += 10;
    }

    // Product Coverage Details
    if (productVersion) {
      if (y > 620) { doc.addPage(); y = 50; }
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("Coverage Details", 50, y);
      y += 5;
      doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(primaryColor).lineWidth(1).stroke();
      y += 20;

      const covFields = [
        ["Waiting Period", `${productVersion.waitingPeriodDays} days`],
        ["Grace Period", `${productVersion.gracePeriodDays} days`],
        ["Eligible Age Range", `${productVersion.eligibilityMinAge} - ${productVersion.eligibilityMaxAge} years`],
        ["Dependent Max Age", `${productVersion.dependentMaxAge} years`],
      ];

      doc.font("Helvetica").fontSize(9).fillColor("#000000");
      for (const [label, value] of covFields) {
        doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
        doc.font("Helvetica").text(`  ${value}`, { width: 350 });
        y += 15;
      }
      y += 10;
    }

    // Terms and Conditions
    if (terms.length > 0) {
      if (y > 500) { doc.addPage(); y = 50; }
      doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("Terms and Conditions", 50, y);
      y += 5;
      doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(primaryColor).lineWidth(1).stroke();
      y += 20;

      for (const term of terms) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000").text(term.title, 50, y);
        y += 14;
        doc.font("Helvetica").fontSize(8).fillColor("#333333").text(term.content, 50, y, {
          width: 495,
          lineGap: 3,
        });
        y = doc.y + 12;
      }
    }

    // Footer
    if (y > 700) { doc.addPage(); y = 50; }
    y = Math.max(y, 700);
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
    y += 8;
    doc.font("Helvetica").fontSize(7).fillColor("#999999")
      .text(org?.footerText || `${org?.name || "Falakhe PMS"} — All rights reserved`, 50, y, { align: "center", width: 495 });

    doc.end();
  });

  // ─── Add-ons by org ─────────────────────────────────────────

  app.get("/api/add-ons", requireAuth, requireTenantScope, requirePermission("read:product"), async (req, res) => {
    const user = req.user as any;
    return res.json(await storage.getAddOns(user.organizationId));
  });

  // ─── Reports CSV Export ────────────────────────────────────

  app.get("/api/reports/export/:type", requireAuth, requireTenantScope, async (req, res) => {
    const user = req.user as any;
    const reportType = req.params.type as string;

    try {
      let rows: any[] = [];
      let headers: string[] = [];

      switch (reportType) {
        case "policies": {
          rows = await storage.getPoliciesByOrg(user.organizationId, 5000, 0);
          headers = ["Policy Number", "Status", "Currency", "Premium", "Payment Schedule", "Created"];
          rows = rows.map((r: any) => [r.policyNumber, r.status, r.currency, r.premiumAmount, r.paymentSchedule, r.createdAt]);
          break;
        }
        case "claims": {
          rows = await storage.getClaimsByOrg(user.organizationId, 5000, 0);
          headers = ["Claim Number", "Type", "Status", "Deceased Name", "Created"];
          rows = rows.map((r: any) => [r.claimNumber, r.claimType, r.status, r.deceasedName || "", r.createdAt]);
          break;
        }
        case "payments": {
          rows = await storage.getPaymentsByOrg(user.organizationId, 5000, 0);
          headers = ["Reference", "Amount", "Currency", "Method", "Status", "Received At"];
          rows = rows.map((r: any) => [r.reference || "", r.amount, r.currency, r.paymentMethod, r.status, r.receivedAt]);
          break;
        }
        case "funerals": {
          const cases = await storage.getFuneralCasesByOrg(user.organizationId);
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
          const exps = await storage.getExpenditures(user.organizationId, 5000, 0);
          headers = ["Description", "Category", "Amount", "Currency", "Date", "Status"];
          rows = exps.map((r: any) => [r.description, r.category, r.amount, r.currency, r.expenseDate, r.status]);
          break;
        }
        case "payroll": {
          const employees = await storage.getPayrollEmployees(user.organizationId);
          headers = ["Employee Name", "ID Number", "Position", "Department", "Basic Salary", "Status"];
          rows = employees.map((r: any) => [r.employeeName, r.idNumber, r.position, r.department, r.basicSalary, r.status]);
          break;
        }
        case "commissions": {
          const plans = await storage.getCommissionPlans(user.organizationId);
          headers = ["Plan Name", "Type", "Rate (%)", "Status", "Created"];
          rows = plans.map((r: any) => [r.name, r.commissionType, r.ratePercent, r.isActive ? "Active" : "Inactive", r.createdAt]);
          break;
        }
        case "chibikhulu": {
          const receivables = await storage.getChibikhuluReceivables(user.organizationId, 5000, 0);
          headers = ["Description", "Amount", "Currency", "Settled", "Created"];
          rows = receivables.map((r: any) => [r.description, r.amount, r.currency, r.isSettled ? "Yes" : "No", r.createdAt]);
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

  app.get("/api/diagnostics/health", requireAuth, async (_req, res) => {
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

  app.get("/api/diagnostics/notification-failures", requireAuth, requireTenantScope, async (req, res) => {
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

  app.get("/api/diagnostics/unallocated-payments", requireAuth, requireTenantScope, async (req, res) => {
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

  app.get("/api/diagnostics/recent-errors", requireAuth, requireTenantScope, async (req, res) => {
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

  return httpServer;
}
