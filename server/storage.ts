import { eq, and, desc, sql, count, gte, lte, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  organizations, branches, users, roles, permissions, rolePermissions,
  userRoles, userPermissionOverrides, auditLogs, clients, dependents,
  products, productVersions, benefitCatalogItems, benefitBundles, addOns,
  ageBandConfigs, policies, policyMembers, policyStatusHistory, policyAddOns,
  paymentTransactions, receipts, reversalEntries, cashups,
  paymentIntents, paymentEvents, paymentReceipts,
  claims, claimDocuments, claimStatusHistory,
  funeralCases, funeralTasks, fleetVehicles, driverAssignments,
  fleetFuelLogs, fleetMaintenance, priceBookItems, costSheets, costLineItems,
  commissionPlans, commissionLedgerEntries, chibikhuluReceivables, settlements,
  payrollEmployees, payrollRuns, payslips,
  notificationTemplates, notificationLogs, leads, expenditures,
  approvalRequests, featureFlags, dependentChangeRequests, securityQuestions,
  productBenefitBundleLinks, groups, settlementAllocations, termsAndConditions,
  type Organization, type InsertOrganization,
  type Branch, type InsertBranch,
  type User, type InsertUser,
  type Role, type InsertRole,
  type Permission, type InsertPermission,
  type AuditLog, type InsertAuditLog,
  type Client, type InsertClient,
  type Dependent, type InsertDependent,
  type Product, type InsertProduct,
  type ProductVersion, type InsertProductVersion,
  type BenefitCatalogItem, type InsertBenefitCatalogItem,
  type BenefitBundle, type InsertBenefitBundle,
  type AddOn, type InsertAddOn,
  type AgeBandConfig, type InsertAgeBandConfig,
  type Policy, type InsertPolicy,
  type PolicyMember, type InsertPolicyMember,
  type PolicyAddOn, type InsertPolicyAddOn,
  type PaymentTransaction, type InsertPaymentTransaction,
  type Receipt, type InsertReceipt,
  type PaymentIntent, type InsertPaymentIntent,
  type PaymentEvent, type InsertPaymentEvent,
  type PaymentReceipt, type InsertPaymentReceipt,
  type Claim, type InsertClaim,
  type ClaimDocument, type InsertClaimDocument,
  type FuneralCase, type InsertFuneralCase,
  type FuneralTask, type InsertFuneralTask,
  type FleetVehicle, type InsertFleetVehicle,
  type CommissionPlan, type InsertCommissionPlan,
  type CommissionLedgerEntry, type InsertCommissionLedgerEntry,
  type NotificationTemplate, type InsertNotificationTemplate,
  type Lead, type InsertLead,
  type Expenditure, type InsertExpenditure,
  type PriceBookItem, type InsertPriceBookItem,
  type ApprovalRequest, type InsertApprovalRequest,
  type PayrollEmployee, type InsertPayrollEmployee,
  type PayrollRun, type InsertPayrollRun,
  type Cashup, type InsertCashup,
  type Group, type InsertGroup,
  type ChibikhuluReceivable, type InsertChibikhuluReceivable,
  type Settlement, type InsertSettlement,
  type TermsAndConditions, type InsertTerms,
} from "@shared/schema";

export interface ReinstatementEntry {
  policyId: string;
  policyNumber: string;
  clientId: string | null;
  clientName: string;
  fromStatus: string | null;
  toStatus: string;
  reinstatedAt: Date;
  reason: string | null;
  currentStatus: string;
}

export interface ReportFilters {
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;
  userId?: string;
  status?: string;
  statuses?: string[]; // for "in" filter e.g. ['active','grace']
}

export interface ActivationEntry {
  policyId: string;
  policyNumber: string;
  clientId: string | null;
  clientName: string;
  fromStatus: string | null;
  toStatus: string;
  activatedAt: Date;
  reason: string | null;
  currentStatus: string;
}

export interface IStorage {
  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizations(): Promise<Organization[]>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined>;
  getBranch(id: string): Promise<Branch | undefined>;
  getBranchesByOrg(organizationId: string): Promise<Branch[]>;
  createBranch(branch: InsertBranch): Promise<Branch>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  getUsersByOrg(organizationId: string, limit?: number, offset?: number): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  getRole(id: string): Promise<Role | undefined>;
  getRolesByOrg(organizationId: string): Promise<Role[]>;
  getRoleByName(name: string, organizationId: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  getPermissions(): Promise<Permission[]>;
  createPermission(perm: InsertPermission): Promise<Permission>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
  addRolePermission(roleId: string, permissionId: string): Promise<void>;
  getUserRoles(userId: string): Promise<(Role & { branchId: string | null })[]>;
  addUserRole(userId: string, roleId: string, branchId?: string): Promise<void>;
  removeUserRole(userId: string, roleId: string): Promise<void>;
  clearUserRoles(userId: string): Promise<void>;
  getUserPermissionOverrides(userId: string): Promise<{ permissionName: string; isGranted: boolean }[]>;
  addUserPermissionOverride(userId: string, permissionId: string, isGranted: boolean): Promise<void>;
  getUserEffectivePermissions(userId: string): Promise<string[]>;
  getAuditLogs(organizationId: string, limit?: number, offset?: number): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getClientsByOrg(organizationId: string, limit?: number, offset?: number): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  getClientByActivationCode(code: string, orgId: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined>;
  getDependentsByClient(clientId: string): Promise<Dependent[]>;
  createDependent(dep: InsertDependent): Promise<Dependent>;
  updateDependent(id: string, data: Partial<InsertDependent>): Promise<Dependent | undefined>;
  deleteDependent(id: string): Promise<void>;
  getProductsByOrg(organizationId: string): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined>;
  getProductVersions(productId: string): Promise<ProductVersion[]>;
  getProductVersion(id: string): Promise<ProductVersion | undefined>;
  createProductVersion(pv: InsertProductVersion): Promise<ProductVersion>;
  getBenefitCatalogItems(orgId: string): Promise<BenefitCatalogItem[]>;
  createBenefitCatalogItem(item: InsertBenefitCatalogItem): Promise<BenefitCatalogItem>;
  getBenefitBundles(orgId: string): Promise<BenefitBundle[]>;
  createBenefitBundle(bundle: InsertBenefitBundle): Promise<BenefitBundle>;
  getAddOns(orgId: string): Promise<AddOn[]>;
  createAddOn(addon: InsertAddOn): Promise<AddOn>;
  getAgeBandConfigs(orgId: string): Promise<AgeBandConfig[]>;
  createAgeBandConfig(config: InsertAgeBandConfig): Promise<AgeBandConfig>;
  getPoliciesByOrg(organizationId: string, limit?: number, offset?: number, filters?: ReportFilters & { status?: string; statuses?: string[] }): Promise<Policy[]>;
  getPoliciesByClient(clientId: string): Promise<Policy[]>;
  getPoliciesByAgent(agentId: string): Promise<Policy[]>;
  getPolicy(id: string): Promise<Policy | undefined>;
  getPolicyByNumber(policyNumber: string, orgId: string): Promise<Policy | undefined>;
  createPolicy(policy: InsertPolicy): Promise<Policy>;
  updatePolicy(id: string, data: Partial<InsertPolicy>): Promise<Policy | undefined>;
  createPolicyStatusHistory(policyId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void>;
  getReinstatementHistory(organizationId: string, filters?: ReportFilters): Promise<ReinstatementEntry[]>;
  getActivationHistory(organizationId: string, filters?: ReportFilters): Promise<ActivationEntry[]>;
  getPolicyMembers(policyId: string): Promise<PolicyMember[]>;
  createPolicyMember(member: InsertPolicyMember): Promise<PolicyMember>;
  getPolicyAddOns(policyId: string): Promise<PolicyAddOn[]>;
  addPolicyAddOns(policyId: string, addOnIds: string[]): Promise<void>;
  createPaymentTransaction(tx: InsertPaymentTransaction): Promise<PaymentTransaction>;
  getPaymentsByPolicy(policyId: string): Promise<PaymentTransaction[]>;
  getPaymentsByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<PaymentTransaction[]>;
  getPaymentTransaction(id: string): Promise<PaymentTransaction | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  getReceiptsByPolicy(policyId: string): Promise<Receipt[]>;
  getNextReceiptNumber(orgId: string): Promise<string>;
  getPaymentIntentById(id: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentByOrgAndIdempotencyKey(orgId: string, idempotencyKey: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentByMerchantReference(orgId: string, merchantReference: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentsByOrg(orgId: string, limit?: number): Promise<PaymentIntent[]>;
  getPaymentIntentsByClient(clientId: string): Promise<PaymentIntent[]>;
  createPaymentIntent(intent: InsertPaymentIntent): Promise<PaymentIntent>;
  updatePaymentIntent(id: string, data: Partial<InsertPaymentIntent>): Promise<PaymentIntent | undefined>;
  createPaymentEvent(event: InsertPaymentEvent): Promise<PaymentEvent>;
  getPaymentEventsByIntentId(paymentIntentId: string): Promise<PaymentEvent[]>;
  createPaymentReceipt(receipt: InsertPaymentReceipt): Promise<PaymentReceipt>;
  getPaymentReceiptById(id: string): Promise<PaymentReceipt | undefined>;
  getPaymentReceiptsByPolicy(policyId: string): Promise<PaymentReceipt[]>;
  getPaymentReceiptsByClient(clientId: string): Promise<PaymentReceipt[]>;
  getNextPaymentReceiptNumber(orgId: string): Promise<string>;
  updatePaymentReceipt(id: string, data: Partial<InsertPaymentReceipt>): Promise<PaymentReceipt | undefined>;
  getClaimsByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<Claim[]>;
  getClaimsByPolicy(policyId: string): Promise<Claim[]>;
  getClaim(id: string): Promise<Claim | undefined>;
  createClaim(claim: InsertClaim): Promise<Claim>;
  updateClaim(id: string, data: Partial<InsertClaim>): Promise<Claim | undefined>;
  createClaimStatusHistory(claimId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void>;
  getClaimDocuments(claimId: string): Promise<ClaimDocument[]>;
  createClaimDocument(doc: InsertClaimDocument): Promise<ClaimDocument>;
  getFuneralCasesByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<FuneralCase[]>;
  getFuneralCase(id: string): Promise<FuneralCase | undefined>;
  createFuneralCase(fc: InsertFuneralCase): Promise<FuneralCase>;
  updateFuneralCase(id: string, data: Partial<InsertFuneralCase>): Promise<FuneralCase | undefined>;
  getFuneralTasks(caseId: string): Promise<FuneralTask[]>;
  createFuneralTask(task: InsertFuneralTask): Promise<FuneralTask>;
  updateFuneralTask(id: string, data: Partial<InsertFuneralTask>): Promise<FuneralTask | undefined>;
  getFleetVehicles(orgId: string): Promise<FleetVehicle[]>;
  createFleetVehicle(vehicle: InsertFleetVehicle): Promise<FleetVehicle>;
  updateFleetVehicle(id: string, data: Partial<InsertFleetVehicle>): Promise<FleetVehicle | undefined>;
  getCommissionPlans(orgId: string): Promise<CommissionPlan[]>;
  createCommissionPlan(plan: InsertCommissionPlan): Promise<CommissionPlan>;
  getCommissionLedgerByAgent(agentId: string): Promise<CommissionLedgerEntry[]>;
  createCommissionLedgerEntry(entry: InsertCommissionLedgerEntry): Promise<CommissionLedgerEntry>;
  getNotificationTemplates(orgId: string): Promise<NotificationTemplate[]>;
  createNotificationTemplate(tmpl: InsertNotificationTemplate): Promise<NotificationTemplate>;
  getLeadsByOrg(orgId: string, limit?: number, offset?: number): Promise<Lead[]>;
  getLeadsByAgent(agentId: string): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, data: Partial<InsertLead>): Promise<Lead | undefined>;
  getExpenditures(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<Expenditure[]>;
  createExpenditure(exp: InsertExpenditure): Promise<Expenditure>;
  getPriceBookItems(orgId: string): Promise<PriceBookItem[]>;
  createPriceBookItem(item: InsertPriceBookItem): Promise<PriceBookItem>;
  updatePriceBookItem(id: string, data: Partial<InsertPriceBookItem>): Promise<PriceBookItem | undefined>;
  getApprovalRequests(orgId: string, status?: string): Promise<ApprovalRequest[]>;
  createApprovalRequest(req: InsertApprovalRequest): Promise<ApprovalRequest>;
  getTermsByOrg(orgId: string): Promise<TermsAndConditions[]>;
  createTerms(terms: InsertTerms): Promise<TermsAndConditions>;
  updateTerms(id: string, data: Partial<InsertTerms>): Promise<TermsAndConditions | undefined>;
  deleteTerms(id: string): Promise<void>;
  updateApprovalRequest(id: string, data: Partial<InsertApprovalRequest>): Promise<ApprovalRequest | undefined>;
  getPayrollEmployees(orgId: string): Promise<PayrollEmployee[]>;
  createPayrollEmployee(emp: InsertPayrollEmployee): Promise<PayrollEmployee>;
  getPayrollRuns(orgId: string): Promise<PayrollRun[]>;
  createPayrollRun(run: InsertPayrollRun): Promise<PayrollRun>;
  getCashups(orgId: string, limit?: number, filters?: ReportFilters & { preparedBy?: string }): Promise<Cashup[]>;
  createCashup(cashup: InsertCashup): Promise<Cashup>;
  updateCashup(id: string, data: Partial<InsertCashup>): Promise<Cashup | undefined>;
  getSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]>;
  getDashboardStats(orgId: string): Promise<any>;
  generatePolicyNumber(orgId: string): Promise<string>;
  generateClaimNumber(orgId: string): Promise<string>;
  generateCaseNumber(orgId: string): Promise<string>;
  getGroupsByOrg(orgId: string): Promise<Group[]>;
  getGroup(id: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroup(id: string, data: Partial<InsertGroup>): Promise<Group | undefined>;
  getChibikhuluReceivables(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<ChibikhuluReceivable[]>;
  createChibikhuluReceivable(entry: InsertChibikhuluReceivable): Promise<ChibikhuluReceivable>;
  getChibikhuluSummary(orgId: string): Promise<{ totalDue: string; totalSettled: string; outstanding: string }>;
  getSettlements(orgId: string): Promise<Settlement[]>;
  createSettlement(settlement: InsertSettlement): Promise<Settlement>;
  updateSettlement(id: string, data: Partial<InsertSettlement>): Promise<Settlement | undefined>;
  getCostSheetsByOrg(orgId: string): Promise<any[]>;
  getCostSheet(id: string): Promise<any>;
  createCostSheet(data: any): Promise<any>;
  getCostLineItems(costSheetId: string): Promise<any[]>;
  createCostLineItem(data: any): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }
  async getOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations);
  }
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [created] = await db.insert(organizations).values(org).returning();
    return created;
  }
  async updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined> {
    const [updated] = await db.update(organizations).set(data).where(eq(organizations.id, id)).returning();
    return updated;
  }
  async getBranch(id: string): Promise<Branch | undefined> {
    const [branch] = await db.select().from(branches).where(eq(branches.id, id));
    return branch;
  }
  async getBranchesByOrg(organizationId: string): Promise<Branch[]> {
    return db.select().from(branches).where(eq(branches.organizationId, organizationId));
  }
  async createBranch(branch: InsertBranch): Promise<Branch> {
    const [created] = await db.insert(branches).values(branch).returning();
    return created;
  }
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }
  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }
  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, code));
    return user;
  }
  async getUsersByOrg(organizationId: string, limit = 500, offset = 0): Promise<User[]> {
    return db.select().from(users).where(eq(users.organizationId, organizationId))
      .orderBy(desc(users.createdAt)).limit(limit).offset(offset);
  }
  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values({ ...user, email: user.email.toLowerCase() }).returning();
    return created;
  }
  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }
  async getRole(id: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role;
  }
  async getRolesByOrg(organizationId: string): Promise<Role[]> {
    return db.select().from(roles).where(eq(roles.organizationId, organizationId));
  }
  async getRoleByName(name: string, organizationId: string): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(and(eq(roles.name, name), eq(roles.organizationId, organizationId)));
    return role;
  }
  async createRole(role: InsertRole): Promise<Role> {
    const [created] = await db.insert(roles).values(role).returning();
    return created;
  }
  async getPermissions(): Promise<Permission[]> {
    return db.select().from(permissions);
  }
  async createPermission(perm: InsertPermission): Promise<Permission> {
    const [created] = await db.insert(permissions).values(perm).returning();
    return created;
  }
  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const rows = await db.select({ permission: permissions }).from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.permission);
  }
  async addRolePermission(roleId: string, permissionId: string): Promise<void> {
    await db.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
  }
  async getUserRoles(userId: string): Promise<(Role & { branchId: string | null })[]> {
    const rows = await db.select({ role: roles, branchId: userRoles.branchId }).from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return rows.map((r) => ({ ...r.role, branchId: r.branchId }));
  }
  async addUserRole(userId: string, roleId: string, branchId?: string): Promise<void> {
    await db.insert(userRoles).values({ userId, roleId, branchId: branchId ?? null });
  }
  async removeUserRole(userId: string, roleId: string): Promise<void> {
    await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  }
  async clearUserRoles(userId: string): Promise<void> {
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
  }
  async getUserPermissionOverrides(userId: string): Promise<{ permissionName: string; isGranted: boolean }[]> {
    const rows = await db.select({ permissionName: permissions.name, isGranted: userPermissionOverrides.isGranted })
      .from(userPermissionOverrides)
      .innerJoin(permissions, eq(userPermissionOverrides.permissionId, permissions.id))
      .where(eq(userPermissionOverrides.userId, userId));
    return rows;
  }
  async addUserPermissionOverride(userId: string, permissionId: string, isGranted: boolean): Promise<void> {
    await db.insert(userPermissionOverrides).values({ userId, permissionId, isGranted });
  }
  async getUserEffectivePermissions(userId: string): Promise<string[]> {
    const roleRows = await db
      .select({
        roleId: roles.id,
        roleName: roles.name,
        permissionName: permissions.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, userId));

    const hasSuperuserRole = roleRows.some((row) => row.roleName === "superuser");
    if (hasSuperuserRole) {
      const allPerms = await this.getPermissions();
      return allPerms.map((p) => p.name);
    }

    const permSet = new Set<string>();
    for (const row of roleRows) {
      if (row.permissionName) {
        permSet.add(row.permissionName);
      }
    }

    const overrides = await this.getUserPermissionOverrides(userId);
    for (const o of overrides) {
      if (o.isGranted) permSet.add(o.permissionName);
      else permSet.delete(o.permissionName);
    }

    return Array.from(permSet);
  }
  async getAuditLogs(organizationId: string, limit = 50, offset = 0): Promise<AuditLog[]> {
    return db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId))
      .orderBy(desc(auditLogs.timestamp)).limit(limit).offset(offset);
  }
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [created] = await db.insert(auditLogs).values(log).returning();
    return created;
  }

  // ─── Clients ───────────────────────────────────────────────
  async getClientsByOrg(organizationId: string, limit = 50, offset = 0): Promise<Client[]> {
    return db.select().from(clients).where(eq(clients.organizationId, organizationId))
      .orderBy(desc(clients.createdAt)).limit(limit).offset(offset);
  }
  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }
  async getClientByActivationCode(code: string, orgId: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients)
      .where(and(eq(clients.activationCode, code), eq(clients.organizationId, orgId)));
    return client;
  }
  async createClient(client: InsertClient): Promise<Client> {
    const [created] = await db.insert(clients).values(client).returning();
    return created;
  }
  async updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined> {
    const [updated] = await db.update(clients).set(data).where(eq(clients.id, id)).returning();
    return updated;
  }

  // ─── Dependents ────────────────────────────────────────────
  async getDependentsByClient(clientId: string): Promise<Dependent[]> {
    return db.select().from(dependents).where(eq(dependents.clientId, clientId)).orderBy(dependents.createdAt);
  }
  async createDependent(dep: InsertDependent): Promise<Dependent> {
    const [created] = await db.insert(dependents).values(dep).returning();
    return created;
  }
  async updateDependent(id: string, data: Partial<InsertDependent>): Promise<Dependent | undefined> {
    const [updated] = await db.update(dependents).set(data).where(eq(dependents.id, id)).returning();
    return updated;
  }
  async deleteDependent(id: string): Promise<void> {
    await db.delete(dependents).where(eq(dependents.id, id));
  }

  // ─── Products ──────────────────────────────────────────────
  async getProductsByOrg(organizationId: string): Promise<Product[]> {
    return db.select().from(products).where(eq(products.organizationId, organizationId));
  }
  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }
  async createProduct(product: InsertProduct): Promise<Product> {
    const [created] = await db.insert(products).values(product).returning();
    return created;
  }
  async updateProduct(id: string, data: Partial<InsertProduct>): Promise<Product | undefined> {
    const [updated] = await db.update(products).set(data).where(eq(products.id, id)).returning();
    return updated;
  }
  async getProductVersions(productId: string): Promise<ProductVersion[]> {
    return db.select().from(productVersions).where(eq(productVersions.productId, productId))
      .orderBy(desc(productVersions.version));
  }
  async getProductVersion(id: string): Promise<ProductVersion | undefined> {
    const [pv] = await db.select().from(productVersions).where(eq(productVersions.id, id));
    return pv;
  }
  async createProductVersion(pv: InsertProductVersion): Promise<ProductVersion> {
    const [created] = await db.insert(productVersions).values(pv).returning();
    return created;
  }
  async getBenefitCatalogItems(orgId: string): Promise<BenefitCatalogItem[]> {
    return db.select().from(benefitCatalogItems).where(eq(benefitCatalogItems.organizationId, orgId));
  }
  async createBenefitCatalogItem(item: InsertBenefitCatalogItem): Promise<BenefitCatalogItem> {
    const [created] = await db.insert(benefitCatalogItems).values(item).returning();
    return created;
  }
  async getBenefitBundles(orgId: string): Promise<BenefitBundle[]> {
    return db.select().from(benefitBundles).where(eq(benefitBundles.organizationId, orgId));
  }
  async createBenefitBundle(bundle: InsertBenefitBundle): Promise<BenefitBundle> {
    const [created] = await db.insert(benefitBundles).values(bundle).returning();
    return created;
  }
  async getAddOns(orgId: string): Promise<AddOn[]> {
    return db.select().from(addOns).where(eq(addOns.organizationId, orgId));
  }
  async createAddOn(addon: InsertAddOn): Promise<AddOn> {
    const [created] = await db.insert(addOns).values(addon).returning();
    return created;
  }
  async getAgeBandConfigs(orgId: string): Promise<AgeBandConfig[]> {
    return db.select().from(ageBandConfigs).where(eq(ageBandConfigs.organizationId, orgId));
  }
  async createAgeBandConfig(config: InsertAgeBandConfig): Promise<AgeBandConfig> {
    const [created] = await db.insert(ageBandConfigs).values(config).returning();
    return created;
  }

  // ─── Policies ──────────────────────────────────────────────
  async getPoliciesByOrg(organizationId: string, limit = 50, offset = 0, filters?: ReportFilters & { status?: string; statuses?: string[] }): Promise<Policy[]> {
    const conditions = [eq(policies.organizationId, organizationId)];
    if (filters?.fromDate) conditions.push(gte(policies.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policies.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.status) conditions.push(eq(policies.status, filters.status));
    if (filters?.statuses?.length) conditions.push(inArray(policies.status, filters.statuses));
    return db.select().from(policies).where(and(...conditions))
      .orderBy(desc(policies.createdAt)).limit(limit).offset(offset);
  }
  async getPoliciesByClient(clientId: string): Promise<Policy[]> {
    return db.select().from(policies).where(eq(policies.clientId, clientId));
  }
  async getPoliciesByAgent(agentId: string): Promise<Policy[]> {
    return db.select().from(policies).where(eq(policies.agentId, agentId));
  }
  async getPolicy(id: string): Promise<Policy | undefined> {
    const [policy] = await db.select().from(policies).where(eq(policies.id, id));
    return policy;
  }
  async getPolicyByNumber(policyNumber: string, orgId: string): Promise<Policy | undefined> {
    const [policy] = await db.select().from(policies)
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.organizationId, orgId)));
    return policy;
  }
  async createPolicy(policy: InsertPolicy): Promise<Policy> {
    const [created] = await db.insert(policies).values(policy).returning();
    return created;
  }
  async updatePolicy(id: string, data: Partial<InsertPolicy>): Promise<Policy | undefined> {
    const [updated] = await db.update(policies).set(data).where(eq(policies.id, id)).returning();
    return updated;
  }
  async createPolicyStatusHistory(policyId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void> {
    await db.insert(policyStatusHistory).values({ policyId, fromStatus, toStatus, reason, changedBy });
  }
  async getReinstatementHistory(organizationId: string, filters?: ReportFilters): Promise<ReinstatementEntry[]> {
    const reinstatementFromStatuses = ["lapsed", "reinstatement_pending"];
    const conditions = [
      eq(policies.organizationId, organizationId),
      eq(policyStatusHistory.toStatus, "active"),
      inArray(policyStatusHistory.fromStatus, reinstatementFromStatuses),
    ];
    if (filters?.fromDate) conditions.push(gte(policyStatusHistory.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policyStatusHistory.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    const rows = await db
      .select({
        policyId: policyStatusHistory.policyId,
        fromStatus: policyStatusHistory.fromStatus,
        toStatus: policyStatusHistory.toStatus,
        reinstatedAt: policyStatusHistory.createdAt,
        reason: policyStatusHistory.reason,
        policyNumber: policies.policyNumber,
        clientId: policies.clientId,
        currentStatus: policies.status,
        firstName: clients.firstName,
        lastName: clients.lastName,
      })
      .from(policyStatusHistory)
      .innerJoin(policies, eq(policyStatusHistory.policyId, policies.id))
      .leftJoin(clients, eq(policies.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(policyStatusHistory.createdAt));
    return rows.map((r) => ({
      policyId: r.policyId,
      policyNumber: r.policyNumber,
      clientId: r.clientId,
      clientName: [r.firstName, r.lastName].filter(Boolean).join(" ") || "—",
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      reinstatedAt: r.reinstatedAt,
      reason: r.reason,
      currentStatus: r.currentStatus ?? "active",
    }));
  }
  async getActivationHistory(organizationId: string, filters?: ReportFilters): Promise<ActivationEntry[]> {
    const conditions = [
      eq(policies.organizationId, organizationId),
      eq(policyStatusHistory.toStatus, "active"),
    ];
    if (filters?.fromDate) conditions.push(gte(policyStatusHistory.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policyStatusHistory.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    const rows = await db
      .select({
        policyId: policyStatusHistory.policyId,
        fromStatus: policyStatusHistory.fromStatus,
        toStatus: policyStatusHistory.toStatus,
        activatedAt: policyStatusHistory.createdAt,
        reason: policyStatusHistory.reason,
        policyNumber: policies.policyNumber,
        clientId: policies.clientId,
        currentStatus: policies.status,
        firstName: clients.firstName,
        lastName: clients.lastName,
      })
      .from(policyStatusHistory)
      .innerJoin(policies, eq(policyStatusHistory.policyId, policies.id))
      .leftJoin(clients, eq(policies.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(policyStatusHistory.createdAt));
    return rows.map((r) => ({
      policyId: r.policyId,
      policyNumber: r.policyNumber,
      clientId: r.clientId,
      clientName: [r.firstName, r.lastName].filter(Boolean).join(" ") || "—",
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      activatedAt: r.activatedAt,
      reason: r.reason,
      currentStatus: r.currentStatus ?? "active",
    }));
  }
  async getPolicyMembers(policyId: string): Promise<PolicyMember[]> {
    return db.select().from(policyMembers).where(eq(policyMembers.policyId, policyId));
  }
  async createPolicyMember(member: InsertPolicyMember): Promise<PolicyMember> {
    const [created] = await db.insert(policyMembers).values(member).returning();
    return created;
  }
  async getPolicyAddOns(policyId: string): Promise<PolicyAddOn[]> {
    return db.select().from(policyAddOns).where(eq(policyAddOns.policyId, policyId));
  }
  async addPolicyAddOns(policyId: string, addOnIds: string[]): Promise<void> {
    if (addOnIds.length === 0) return;
    await db.insert(policyAddOns).values(addOnIds.map((addOnId) => ({ policyId, addOnId })));
  }

  // ─── Payments ──────────────────────────────────────────────
  async createPaymentTransaction(tx: InsertPaymentTransaction): Promise<PaymentTransaction> {
    const [created] = await db.insert(paymentTransactions).values(tx).returning();
    return created;
  }
  async getPaymentsByPolicy(policyId: string): Promise<PaymentTransaction[]> {
    return db.select().from(paymentTransactions).where(eq(paymentTransactions.policyId, policyId))
      .orderBy(desc(paymentTransactions.receivedAt));
  }
  async getPaymentsByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<PaymentTransaction[]> {
    const conditions = [eq(paymentTransactions.organizationId, orgId)];
    const dateCol = paymentTransactions.receivedAt;
    if (filters?.fromDate) conditions.push(gte(dateCol, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(dateCol, new Date(filters.toDate + "T23:59:59.999Z")));
    return db.select().from(paymentTransactions).where(and(...conditions))
      .orderBy(desc(paymentTransactions.receivedAt)).limit(limit).offset(offset);
  }
  async getPaymentTransaction(id: string): Promise<PaymentTransaction | undefined> {
    const [tx] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, id));
    return tx;
  }
  async createReceipt(receipt: InsertReceipt): Promise<Receipt> {
    const [created] = await db.insert(receipts).values(receipt).returning();
    return created;
  }
  async getReceiptsByPolicy(policyId: string): Promise<Receipt[]> {
    return db.select().from(receipts).where(eq(receipts.policyId, policyId));
  }
  async getNextReceiptNumber(orgId: string): Promise<string> {
    const [result] = await db.select({ cnt: count() }).from(receipts).where(eq(receipts.organizationId, orgId));
    const num = (result?.cnt || 0) as number;
    return String(num + 1);
  }

  async getPaymentIntentById(id: string): Promise<PaymentIntent | undefined> {
    const [row] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, id));
    return row;
  }
  async getPaymentIntentByOrgAndIdempotencyKey(orgId: string, idempotencyKey: string): Promise<PaymentIntent | undefined> {
    const [row] = await db.select().from(paymentIntents).where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.idempotencyKey, idempotencyKey)));
    return row;
  }
  async getPaymentIntentByMerchantReference(orgId: string, merchantReference: string): Promise<PaymentIntent | undefined> {
    const [row] = await db.select().from(paymentIntents).where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.merchantReference, merchantReference)));
    return row;
  }
  async getPaymentIntentsByOrg(orgId: string, limit = 100): Promise<PaymentIntent[]> {
    return db.select().from(paymentIntents).where(eq(paymentIntents.organizationId, orgId))
      .orderBy(desc(paymentIntents.createdAt)).limit(limit);
  }
  async getPaymentIntentsByClient(clientId: string): Promise<PaymentIntent[]> {
    return db.select().from(paymentIntents).where(eq(paymentIntents.clientId, clientId))
      .orderBy(desc(paymentIntents.createdAt));
  }
  async createPaymentIntent(intent: InsertPaymentIntent): Promise<PaymentIntent> {
    const [created] = await db.insert(paymentIntents).values({ ...intent, updatedAt: new Date() }).returning();
    return created;
  }
  async updatePaymentIntent(id: string, data: Partial<InsertPaymentIntent>): Promise<PaymentIntent | undefined> {
    const [updated] = await db.update(paymentIntents).set({ ...data, updatedAt: new Date() }).where(eq(paymentIntents.id, id)).returning();
    return updated;
  }
  async createPaymentEvent(event: InsertPaymentEvent): Promise<PaymentEvent> {
    const [created] = await db.insert(paymentEvents).values(event).returning();
    return created;
  }
  async getPaymentEventsByIntentId(paymentIntentId: string): Promise<PaymentEvent[]> {
    return db.select().from(paymentEvents).where(eq(paymentEvents.paymentIntentId, paymentIntentId))
      .orderBy(desc(paymentEvents.createdAt));
  }
  async createPaymentReceipt(receipt: InsertPaymentReceipt): Promise<PaymentReceipt> {
    const [created] = await db.insert(paymentReceipts).values(receipt).returning();
    return created;
  }
  async getPaymentReceiptById(id: string): Promise<PaymentReceipt | undefined> {
    const [row] = await db.select().from(paymentReceipts).where(eq(paymentReceipts.id, id));
    return row;
  }
  async getPaymentReceiptsByPolicy(policyId: string): Promise<PaymentReceipt[]> {
    return db.select().from(paymentReceipts).where(eq(paymentReceipts.policyId, policyId))
      .orderBy(desc(paymentReceipts.issuedAt));
  }
  async getPaymentReceiptsByClient(clientId: string): Promise<PaymentReceipt[]> {
    return db.select().from(paymentReceipts).where(eq(paymentReceipts.clientId, clientId))
      .orderBy(desc(paymentReceipts.issuedAt));
  }
  async getNextPaymentReceiptNumber(orgId: string): Promise<string> {
    const [result] = await db.select({ cnt: count() }).from(paymentReceipts).where(eq(paymentReceipts.organizationId, orgId));
    const num = (result?.cnt || 0) as number;
    return String(num + 1);
  }
  async updatePaymentReceipt(id: string, data: Partial<InsertPaymentReceipt>): Promise<PaymentReceipt | undefined> {
    const [updated] = await db.update(paymentReceipts).set(data).where(eq(paymentReceipts.id, id)).returning();
    return updated;
  }

  // ─── Claims ────────────────────────────────────────────────
  async getClaimsByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<Claim[]> {
    const conditions = [eq(claims.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(claims.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(claims.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return db.select().from(claims).where(and(...conditions))
      .orderBy(desc(claims.createdAt)).limit(limit).offset(offset);
  }
  async getClaimsByPolicy(policyId: string): Promise<Claim[]> {
    return db.select().from(claims).where(eq(claims.policyId, policyId));
  }
  async getClaim(id: string): Promise<Claim | undefined> {
    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    return claim;
  }
  async createClaim(claim: InsertClaim): Promise<Claim> {
    const [created] = await db.insert(claims).values(claim).returning();
    return created;
  }
  async updateClaim(id: string, data: Partial<InsertClaim>): Promise<Claim | undefined> {
    const [updated] = await db.update(claims).set(data).where(eq(claims.id, id)).returning();
    return updated;
  }
  async createClaimStatusHistory(claimId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void> {
    await db.insert(claimStatusHistory).values({ claimId, fromStatus, toStatus, reason, changedBy });
  }
  async getClaimDocuments(claimId: string): Promise<ClaimDocument[]> {
    return db.select().from(claimDocuments).where(eq(claimDocuments.claimId, claimId));
  }
  async createClaimDocument(doc: InsertClaimDocument): Promise<ClaimDocument> {
    const [created] = await db.insert(claimDocuments).values(doc).returning();
    return created;
  }

  // ─── Funeral Cases ─────────────────────────────────────────
  async getFuneralCasesByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<FuneralCase[]> {
    const conditions = [eq(funeralCases.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(funeralCases.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(funeralCases.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return db.select().from(funeralCases).where(and(...conditions))
      .orderBy(desc(funeralCases.createdAt)).limit(limit).offset(offset);
  }
  async getFuneralCase(id: string): Promise<FuneralCase | undefined> {
    const [fc] = await db.select().from(funeralCases).where(eq(funeralCases.id, id));
    return fc;
  }
  async createFuneralCase(fc: InsertFuneralCase): Promise<FuneralCase> {
    const [created] = await db.insert(funeralCases).values(fc).returning();
    return created;
  }
  async updateFuneralCase(id: string, data: Partial<InsertFuneralCase>): Promise<FuneralCase | undefined> {
    const [updated] = await db.update(funeralCases).set(data).where(eq(funeralCases.id, id)).returning();
    return updated;
  }
  async getFuneralTasks(caseId: string): Promise<FuneralTask[]> {
    return db.select().from(funeralTasks).where(eq(funeralTasks.funeralCaseId, caseId));
  }
  async createFuneralTask(task: InsertFuneralTask): Promise<FuneralTask> {
    const [created] = await db.insert(funeralTasks).values(task).returning();
    return created;
  }
  async updateFuneralTask(id: string, data: Partial<InsertFuneralTask>): Promise<FuneralTask | undefined> {
    const [updated] = await db.update(funeralTasks).set(data).where(eq(funeralTasks.id, id)).returning();
    return updated;
  }

  // ─── Fleet ─────────────────────────────────────────────────
  async getFleetVehicles(orgId: string): Promise<FleetVehicle[]> {
    return db.select().from(fleetVehicles).where(eq(fleetVehicles.organizationId, orgId));
  }
  async createFleetVehicle(vehicle: InsertFleetVehicle): Promise<FleetVehicle> {
    const [created] = await db.insert(fleetVehicles).values(vehicle).returning();
    return created;
  }
  async updateFleetVehicle(id: string, data: Partial<InsertFleetVehicle>): Promise<FleetVehicle | undefined> {
    const [updated] = await db.update(fleetVehicles).set(data).where(eq(fleetVehicles.id, id)).returning();
    return updated;
  }

  // ─── Commissions ───────────────────────────────────────────
  async getCommissionPlans(orgId: string): Promise<CommissionPlan[]> {
    return db.select().from(commissionPlans).where(eq(commissionPlans.organizationId, orgId));
  }
  async createCommissionPlan(plan: InsertCommissionPlan): Promise<CommissionPlan> {
    const [created] = await db.insert(commissionPlans).values(plan).returning();
    return created;
  }
  async getCommissionLedgerByAgent(agentId: string): Promise<CommissionLedgerEntry[]> {
    return db.select().from(commissionLedgerEntries).where(eq(commissionLedgerEntries.agentId, agentId))
      .orderBy(desc(commissionLedgerEntries.createdAt));
  }
  async createCommissionLedgerEntry(entry: InsertCommissionLedgerEntry): Promise<CommissionLedgerEntry> {
    const [created] = await db.insert(commissionLedgerEntries).values(entry).returning();
    return created;
  }

  // ─── Notifications ─────────────────────────────────────────
  async getNotificationTemplates(orgId: string): Promise<NotificationTemplate[]> {
    return db.select().from(notificationTemplates).where(eq(notificationTemplates.organizationId, orgId));
  }
  async createNotificationTemplate(tmpl: InsertNotificationTemplate): Promise<NotificationTemplate> {
    const [created] = await db.insert(notificationTemplates).values(tmpl).returning();
    return created;
  }

  // ─── Leads ─────────────────────────────────────────────────
  async getLeadsByOrg(orgId: string, limit = 50, offset = 0): Promise<Lead[]> {
    return db.select().from(leads).where(eq(leads.organizationId, orgId))
      .orderBy(desc(leads.createdAt)).limit(limit).offset(offset);
  }
  async getLeadsByAgent(agentId: string): Promise<Lead[]> {
    return db.select().from(leads).where(eq(leads.agentId, agentId));
  }
  async getLead(id: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    return lead;
  }
  async createLead(lead: InsertLead): Promise<Lead> {
    const [created] = await db.insert(leads).values(lead).returning();
    return created;
  }
  async updateLead(id: string, data: Partial<InsertLead>): Promise<Lead | undefined> {
    const [updated] = await db.update(leads).set(data).where(eq(leads.id, id)).returning();
    return updated;
  }

  // ─── Expenditures ──────────────────────────────────────────
  async getExpenditures(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<Expenditure[]> {
    const conditions = [eq(expenditures.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(expenditures.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(expenditures.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return db.select().from(expenditures).where(and(...conditions))
      .orderBy(desc(expenditures.createdAt)).limit(limit).offset(offset);
  }
  async createExpenditure(exp: InsertExpenditure): Promise<Expenditure> {
    const [created] = await db.insert(expenditures).values(exp).returning();
    return created;
  }

  // ─── Price Book ────────────────────────────────────────────
  async getPriceBookItems(orgId: string): Promise<PriceBookItem[]> {
    return db.select().from(priceBookItems).where(eq(priceBookItems.organizationId, orgId));
  }
  async createPriceBookItem(item: InsertPriceBookItem): Promise<PriceBookItem> {
    const [created] = await db.insert(priceBookItems).values(item).returning();
    return created;
  }
  async updatePriceBookItem(id: string, data: Partial<InsertPriceBookItem>): Promise<PriceBookItem | undefined> {
    const [updated] = await db.update(priceBookItems).set(data).where(eq(priceBookItems.id, id)).returning();
    return updated;
  }

  // ─── Approvals ─────────────────────────────────────────────
  async getApprovalRequests(orgId: string, status?: string): Promise<ApprovalRequest[]> {
    if (status) {
      return db.select().from(approvalRequests)
        .where(and(eq(approvalRequests.organizationId, orgId), eq(approvalRequests.status, status)))
        .orderBy(desc(approvalRequests.createdAt));
    }
    return db.select().from(approvalRequests).where(eq(approvalRequests.organizationId, orgId))
      .orderBy(desc(approvalRequests.createdAt));
  }
  async createApprovalRequest(req: InsertApprovalRequest): Promise<ApprovalRequest> {
    const [created] = await db.insert(approvalRequests).values(req).returning();
    return created;
  }
  async updateApprovalRequest(id: string, data: Partial<InsertApprovalRequest>): Promise<ApprovalRequest | undefined> {
    const [updated] = await db.update(approvalRequests).set(data).where(eq(approvalRequests.id, id)).returning();
    return updated;
  }

  // ─── Terms & Conditions ────────────────────────────────────
  async getTermsByOrg(orgId: string): Promise<TermsAndConditions[]> {
    return db.select().from(termsAndConditions)
      .where(and(eq(termsAndConditions.organizationId, orgId), eq(termsAndConditions.isActive, true)))
      .orderBy(termsAndConditions.sortOrder);
  }
  async createTerms(terms: InsertTerms): Promise<TermsAndConditions> {
    const [created] = await db.insert(termsAndConditions).values(terms).returning();
    return created;
  }
  async updateTerms(id: string, data: Partial<InsertTerms>): Promise<TermsAndConditions | undefined> {
    const [updated] = await db.update(termsAndConditions).set(data).where(eq(termsAndConditions.id, id)).returning();
    return updated;
  }
  async deleteTerms(id: string): Promise<void> {
    await db.delete(termsAndConditions).where(eq(termsAndConditions.id, id));
  }

  // ─── Payroll ───────────────────────────────────────────────
  async getPayrollEmployees(orgId: string): Promise<PayrollEmployee[]> {
    return db.select().from(payrollEmployees).where(eq(payrollEmployees.organizationId, orgId));
  }
  async createPayrollEmployee(emp: InsertPayrollEmployee): Promise<PayrollEmployee> {
    const [created] = await db.insert(payrollEmployees).values(emp).returning();
    return created;
  }
  async getPayrollRuns(orgId: string): Promise<PayrollRun[]> {
    return db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, orgId))
      .orderBy(desc(payrollRuns.createdAt));
  }
  async createPayrollRun(run: InsertPayrollRun): Promise<PayrollRun> {
    const [created] = await db.insert(payrollRuns).values(run).returning();
    return created;
  }

  // ─── Cashups ───────────────────────────────────────────────
  async getCashups(orgId: string, limit = 30, filters?: ReportFilters & { preparedBy?: string }): Promise<Cashup[]> {
    const conditions = [eq(cashups.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(cashups.cashupDate, filters.fromDate));
    if (filters?.toDate) conditions.push(lte(cashups.cashupDate, filters.toDate));
    if (filters?.preparedBy) conditions.push(eq(cashups.preparedBy, filters.preparedBy));
    return db.select().from(cashups).where(and(...conditions))
      .orderBy(desc(cashups.createdAt)).limit(limit);
  }
  async createCashup(cashup: InsertCashup): Promise<Cashup> {
    const [created] = await db.insert(cashups).values(cashup).returning();
    return created;
  }
  async updateCashup(id: string, data: Partial<InsertCashup>): Promise<Cashup | undefined> {
    const [updated] = await db.update(cashups).set(data).where(eq(cashups.id, id)).returning();
    return updated;
  }

  // ─── Security Questions ────────────────────────────────────
  async getSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]> {
    return db.select({ id: securityQuestions.id, question: securityQuestions.question })
      .from(securityQuestions)
      .where(and(eq(securityQuestions.organizationId, orgId), eq(securityQuestions.isActive, true)));
  }

  // ─── Dashboard Stats ──────────────────────────────────────
  async getDashboardStats(orgId: string): Promise<any> {
    const [policyCount] = await db.select({ cnt: count() }).from(policies).where(eq(policies.organizationId, orgId));
    const [activePolicies] = await db.select({ cnt: count() }).from(policies)
      .where(and(eq(policies.organizationId, orgId), eq(policies.status, "active")));
    const [clientCount] = await db.select({ cnt: count() }).from(clients).where(eq(clients.organizationId, orgId));
    const [claimCount] = await db.select({ cnt: count() }).from(claims).where(eq(claims.organizationId, orgId));
    const [openClaims] = await db.select({ cnt: count() }).from(claims)
      .where(and(eq(claims.organizationId, orgId), inArray(claims.status, ["submitted", "verified"])));
    const [funeralCount] = await db.select({ cnt: count() }).from(funeralCases).where(eq(funeralCases.organizationId, orgId));
    const [leadCount] = await db.select({ cnt: count() }).from(leads).where(eq(leads.organizationId, orgId));
    const [txCount] = await db.select({ cnt: count() }).from(paymentTransactions).where(eq(paymentTransactions.organizationId, orgId));

    return {
      totalPolicies: policyCount?.cnt || 0,
      activePolicies: activePolicies?.cnt || 0,
      totalClients: clientCount?.cnt || 0,
      totalClaims: claimCount?.cnt || 0,
      openClaims: openClaims?.cnt || 0,
      totalFuneralCases: funeralCount?.cnt || 0,
      totalLeads: leadCount?.cnt || 0,
      totalTransactions: txCount?.cnt || 0,
    };
  }

  // ─── Number Generators ─────────────────────────────────────
  async generatePolicyNumber(orgId: string): Promise<string> {
    const [result] = await db.select({ cnt: count() }).from(policies).where(eq(policies.organizationId, orgId));
    const num = ((result?.cnt || 0) as number) + 1;
    return String(num);
  }
  async generateClaimNumber(orgId: string): Promise<string> {
    const [result] = await db.select({ cnt: count() }).from(claims).where(eq(claims.organizationId, orgId));
    const num = ((result?.cnt || 0) as number) + 1;
    return `CLM-${String(num).padStart(6, "0")}`;
  }
  async generateCaseNumber(orgId: string): Promise<string> {
    const [result] = await db.select({ cnt: count() }).from(funeralCases).where(eq(funeralCases.organizationId, orgId));
    const num = ((result?.cnt || 0) as number) + 1;
    return `FNC-${String(num).padStart(6, "0")}`;
  }

  // ─── Groups ──────────────────────────────────────────────
  async getGroupsByOrg(orgId: string): Promise<Group[]> {
    return db.select().from(groups).where(eq(groups.organizationId, orgId)).orderBy(desc(groups.createdAt));
  }
  async getGroup(id: string): Promise<Group | undefined> {
    const [g] = await db.select().from(groups).where(eq(groups.id, id));
    return g;
  }
  async createGroup(group: InsertGroup): Promise<Group> {
    const [created] = await db.insert(groups).values(group).returning();
    return created;
  }
  async updateGroup(id: string, data: Partial<InsertGroup>): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set(data).where(eq(groups.id, id)).returning();
    return updated;
  }

  // ─── Chibikhulu Receivables ──────────────────────────────
  async getChibikhuluReceivables(orgId: string, limit = 100, offset = 0, filters?: ReportFilters): Promise<ChibikhuluReceivable[]> {
    const conditions = [eq(chibikhuluReceivables.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(chibikhuluReceivables.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(chibikhuluReceivables.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return db.select().from(chibikhuluReceivables).where(and(...conditions))
      .orderBy(desc(chibikhuluReceivables.createdAt)).limit(limit).offset(offset);
  }
  async createChibikhuluReceivable(entry: InsertChibikhuluReceivable): Promise<ChibikhuluReceivable> {
    const [created] = await db.insert(chibikhuluReceivables).values(entry).returning();
    return created;
  }
  async getChibikhuluSummary(orgId: string): Promise<{ totalDue: string; totalSettled: string; outstanding: string }> {
    const [totals] = await db.select({
      totalDue: sql<string>`COALESCE(SUM(${chibikhuluReceivables.amount}), '0')`,
    }).from(chibikhuluReceivables).where(eq(chibikhuluReceivables.organizationId, orgId));
    const [settled] = await db.select({
      totalSettled: sql<string>`COALESCE(SUM(${chibikhuluReceivables.amount}), '0')`,
    }).from(chibikhuluReceivables).where(and(
      eq(chibikhuluReceivables.organizationId, orgId),
      eq(chibikhuluReceivables.isSettled, true)
    ));
    const due = parseFloat(totals?.totalDue || "0");
    const stl = parseFloat(settled?.totalSettled || "0");
    return {
      totalDue: due.toFixed(2),
      totalSettled: stl.toFixed(2),
      outstanding: (due - stl).toFixed(2),
    };
  }

  // ─── Settlements ────────────────────────────────────────
  async getSettlements(orgId: string): Promise<Settlement[]> {
    return db.select().from(settlements)
      .where(eq(settlements.organizationId, orgId))
      .orderBy(desc(settlements.createdAt));
  }
  async createSettlement(settlement: InsertSettlement): Promise<Settlement> {
    const [created] = await db.insert(settlements).values(settlement).returning();
    return created;
  }
  async updateSettlement(id: string, data: Partial<InsertSettlement>): Promise<Settlement | undefined> {
    const [updated] = await db.update(settlements).set(data).where(eq(settlements.id, id)).returning();
    return updated;
  }

  // ─── Cost Sheets ────────────────────────────────────────
  async getCostSheetsByOrg(orgId: string): Promise<any[]> {
    return db.select().from(costSheets)
      .where(eq(costSheets.organizationId, orgId))
      .orderBy(desc(costSheets.createdAt));
  }
  async getCostSheet(id: string): Promise<any> {
    const [cs] = await db.select().from(costSheets).where(eq(costSheets.id, id));
    return cs;
  }
  async createCostSheet(data: any): Promise<any> {
    const [created] = await db.insert(costSheets).values(data).returning();
    return created;
  }
  async getCostLineItems(costSheetId: string): Promise<any[]> {
    return db.select().from(costLineItems).where(eq(costLineItems.costSheetId, costSheetId));
  }
  async createCostLineItem(data: any): Promise<any> {
    const [created] = await db.insert(costLineItems).values(data).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
