import { eq, and, desc, sql, count, gte, lte, inArray, or, ilike } from "drizzle-orm";
import { db } from "./db";
import { getDbForOrg } from "./tenant-db";
import { PLATFORM_SUPERUSER_EMAIL } from "./constants";
import {
  organizations, branches, users, roles, permissions, rolePermissions,
  userRoles, userPermissionOverrides, auditLogs, clients, dependents,
  products, productVersions, benefitCatalogItems, benefitBundles, addOns,
  ageBandConfigs, policies, policyMembers, policyStatusHistory, policyAddOns,
  orgMemberSequences, orgPolicySequences,
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
  clientFeedback,
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
  type ClientFeedback, type InsertClientFeedback,
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
  getBranch(id: string, organizationId: string): Promise<Branch | undefined>;
  getBranchesByOrg(organizationId: string): Promise<Branch[]>;
  createBranch(branch: InsertBranch): Promise<Branch>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  getUsersByOrg(organizationId: string, limit?: number, offset?: number): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  getRole(id: string, organizationId: string): Promise<Role | undefined>;
  getRolesByOrg(organizationId: string): Promise<Role[]>;
  getRoleByName(name: string, organizationId: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  getPermissions(): Promise<Permission[]>;
  createPermission(perm: InsertPermission): Promise<Permission>;
  getRolePermissions(roleId: string, organizationId: string): Promise<Permission[]>;
  addRolePermission(roleId: string, permissionId: string): Promise<void>;
  getUserRoles(userId: string, organizationId: string): Promise<(Role & { branchId: string | null })[]>;
  addUserRole(userId: string, roleId: string, branchId?: string): Promise<void>;
  removeUserRole(userId: string, roleId: string): Promise<void>;
  clearUserRoles(userId: string): Promise<void>;
  getUserPermissionOverrides(userId: string): Promise<{ permissionName: string; isGranted: boolean }[]>;
  addUserPermissionOverride(userId: string, permissionId: string, isGranted: boolean): Promise<void>;
  getUserEffectivePermissions(userId: string): Promise<string[]>;
  getAuditLogs(organizationId: string, limit?: number, offset?: number): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getClientsByOrg(organizationId: string, limit?: number, offset?: number, search?: string): Promise<Client[]>;
  getClient(id: string, orgId: string): Promise<Client | undefined>;
  getClientByActivationCode(code: string, orgId: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>, orgId: string): Promise<Client | undefined>;
  getDependentsByClient(clientId: string, orgId: string): Promise<Dependent[]>;
  createDependent(dep: InsertDependent): Promise<Dependent>;
  updateDependent(id: string, data: Partial<InsertDependent>, orgId: string): Promise<Dependent | undefined>;
  deleteDependent(id: string, orgId: string): Promise<void>;
  getProductsByOrg(organizationId: string): Promise<Product[]>;
  getProduct(id: string, orgId: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<InsertProduct>, orgId: string): Promise<Product | undefined>;
  getProductVersions(productId: string, orgId: string): Promise<ProductVersion[]>;
  getProductVersion(id: string, orgId: string): Promise<ProductVersion | undefined>;
  createProductVersion(pv: InsertProductVersion): Promise<ProductVersion>;
  getBenefitCatalogItems(orgId: string): Promise<BenefitCatalogItem[]>;
  createBenefitCatalogItem(item: InsertBenefitCatalogItem): Promise<BenefitCatalogItem>;
  getBenefitBundles(orgId: string): Promise<BenefitBundle[]>;
  createBenefitBundle(bundle: InsertBenefitBundle): Promise<BenefitBundle>;
  getAddOns(orgId: string): Promise<AddOn[]>;
  createAddOn(addon: InsertAddOn): Promise<AddOn>;
  getAgeBandConfigs(orgId: string): Promise<AgeBandConfig[]>;
  createAgeBandConfig(config: InsertAgeBandConfig): Promise<AgeBandConfig>;
  getPoliciesByOrg(organizationId: string, limit?: number, offset?: number, filters?: ReportFilters & { status?: string; statuses?: string[]; search?: string }): Promise<Policy[]>;
  getPoliciesByClient(clientId: string, orgId: string): Promise<Policy[]>;
  getPoliciesByAgent(agentId: string, orgId: string): Promise<Policy[]>;
  getPolicy(id: string, orgId: string): Promise<Policy | undefined>;
  getPolicyByNumber(policyNumber: string, orgId: string): Promise<Policy | undefined>;
  updatePolicy(id: string, data: Partial<InsertPolicy>, orgId: string): Promise<Policy | undefined>;
  createPolicyStatusHistory(policyId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void>;
  getReinstatementHistory(organizationId: string, filters?: ReportFilters): Promise<ReinstatementEntry[]>;
  getActivationHistory(organizationId: string, filters?: ReportFilters): Promise<ActivationEntry[]>;
  getPolicyMembers(policyId: string, orgId: string): Promise<PolicyMember[]>;
  createPolicyMember(member: InsertPolicyMember): Promise<PolicyMember>;
  getPolicyAddOns(policyId: string, orgId: string): Promise<PolicyAddOn[]>;
  addPolicyAddOns(policyId: string, addOnIds: string[], orgId: string): Promise<void>;
  createPaymentTransaction(tx: InsertPaymentTransaction): Promise<PaymentTransaction>;
  getPaymentsByPolicy(policyId: string, orgId: string): Promise<PaymentTransaction[]>;
  getPaymentsByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<PaymentTransaction[]>;
  getPaymentTransaction(id: string, orgId: string): Promise<PaymentTransaction | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  getReceiptsByPolicy(policyId: string, orgId: string): Promise<Receipt[]>;
  getNextReceiptNumber(orgId: string): Promise<string>;
  getPaymentIntentById(id: string, orgId: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentByOrgAndIdempotencyKey(orgId: string, idempotencyKey: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentByMerchantReference(orgId: string, merchantReference: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentsByOrg(orgId: string, limit?: number): Promise<PaymentIntent[]>;
  getPaymentIntentsByClient(clientId: string, orgId: string): Promise<PaymentIntent[]>;
  createPaymentIntent(intent: InsertPaymentIntent): Promise<PaymentIntent>;
  updatePaymentIntent(id: string, data: Partial<InsertPaymentIntent>, orgId: string): Promise<PaymentIntent | undefined>;
  createPaymentEvent(event: InsertPaymentEvent): Promise<PaymentEvent>;
  getPaymentEventsByIntentId(paymentIntentId: string, orgId: string): Promise<PaymentEvent[]>;
  createPaymentReceipt(receipt: InsertPaymentReceipt): Promise<PaymentReceipt>;
  getPaymentReceiptById(id: string, orgId: string): Promise<PaymentReceipt | undefined>;
  getPaymentReceiptsByPolicy(policyId: string, orgId: string): Promise<PaymentReceipt[]>;
  getPaymentReceiptsByClient(clientId: string, orgId: string): Promise<PaymentReceipt[]>;
  getNextPaymentReceiptNumber(orgId: string): Promise<string>;
  updatePaymentReceipt(id: string, data: Partial<InsertPaymentReceipt>, orgId: string): Promise<PaymentReceipt | undefined>;
  getClaimsByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<Claim[]>;
  getClaimsByPolicy(policyId: string, orgId: string): Promise<Claim[]>;
  getClaimsByClient(clientId: string, orgId: string): Promise<Claim[]>;
  getClaim(id: string, orgId: string): Promise<Claim | undefined>;
  createClaim(claim: InsertClaim): Promise<Claim>;
  updateClaim(id: string, data: Partial<InsertClaim>, orgId: string): Promise<Claim | undefined>;
  createClaimStatusHistory(claimId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void>;
  getClaimDocuments(claimId: string, orgId: string): Promise<ClaimDocument[]>;
  createClaimDocument(doc: InsertClaimDocument): Promise<ClaimDocument>;
  getFeedbackByClient(clientId: string, orgId: string): Promise<ClientFeedback[]>;
  createFeedback(feedback: InsertClientFeedback): Promise<ClientFeedback>;
  getFuneralCasesByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<FuneralCase[]>;
  getFuneralCase(id: string, orgId: string): Promise<FuneralCase | undefined>;
  createFuneralCase(fc: InsertFuneralCase): Promise<FuneralCase>;
  updateFuneralCase(id: string, data: Partial<InsertFuneralCase>, orgId: string): Promise<FuneralCase | undefined>;
  getFuneralTasks(caseId: string, orgId: string): Promise<FuneralTask[]>;
  createFuneralTask(task: InsertFuneralTask): Promise<FuneralTask>;
  updateFuneralTask(id: string, data: Partial<InsertFuneralTask>, orgId: string): Promise<FuneralTask | undefined>;
  getFleetVehicles(orgId: string): Promise<FleetVehicle[]>;
  createFleetVehicle(vehicle: InsertFleetVehicle): Promise<FleetVehicle>;
  updateFleetVehicle(id: string, data: Partial<InsertFleetVehicle>, orgId: string): Promise<FleetVehicle | undefined>;
  getCommissionPlans(orgId: string): Promise<CommissionPlan[]>;
  createCommissionPlan(plan: InsertCommissionPlan): Promise<CommissionPlan>;
  getCommissionLedgerByAgent(agentId: string, orgId: string): Promise<CommissionLedgerEntry[]>;
  createCommissionLedgerEntry(entry: InsertCommissionLedgerEntry): Promise<CommissionLedgerEntry>;
  getNotificationTemplates(orgId: string): Promise<NotificationTemplate[]>;
  createNotificationTemplate(tmpl: InsertNotificationTemplate): Promise<NotificationTemplate>;
  getLeadsByOrg(orgId: string, limit?: number, offset?: number): Promise<Lead[]>;
  getLeadsByAgent(agentId: string, orgId: string): Promise<Lead[]>;
  getLead(id: string, orgId: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, data: Partial<InsertLead>, orgId: string): Promise<Lead | undefined>;
  getExpenditures(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<Expenditure[]>;
  createExpenditure(exp: InsertExpenditure): Promise<Expenditure>;
  getPriceBookItems(orgId: string): Promise<PriceBookItem[]>;
  createPriceBookItem(item: InsertPriceBookItem): Promise<PriceBookItem>;
  updatePriceBookItem(id: string, data: Partial<InsertPriceBookItem>, orgId: string): Promise<PriceBookItem | undefined>;
  getApprovalRequests(orgId: string, status?: string): Promise<ApprovalRequest[]>;
  createApprovalRequest(req: InsertApprovalRequest): Promise<ApprovalRequest>;
  getTermsByOrg(orgId: string): Promise<TermsAndConditions[]>;
  getTermsByOrgAll(orgId: string): Promise<TermsAndConditions[]>;
  createTerms(terms: InsertTerms): Promise<TermsAndConditions>;
  updateTerms(id: string, data: Partial<InsertTerms>, orgId: string): Promise<TermsAndConditions | undefined>;
  deleteTerms(id: string, orgId: string): Promise<void>;
  updateApprovalRequest(id: string, data: Partial<InsertApprovalRequest>, orgId: string): Promise<ApprovalRequest | undefined>;
  getPayrollEmployees(orgId: string): Promise<PayrollEmployee[]>;
  createPayrollEmployee(emp: InsertPayrollEmployee): Promise<PayrollEmployee>;
  getPayrollRuns(orgId: string): Promise<PayrollRun[]>;
  createPayrollRun(run: InsertPayrollRun): Promise<PayrollRun>;
  getCashups(orgId: string, limit?: number, filters?: ReportFilters & { preparedBy?: string }): Promise<Cashup[]>;
  createCashup(cashup: InsertCashup): Promise<Cashup>;
  updateCashup(id: string, data: Partial<InsertCashup>, orgId: string): Promise<Cashup | undefined>;
  getSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]>;
  getDashboardStats(orgId: string): Promise<any>;
  generatePolicyNumber(orgId: string): Promise<string>;
  generateClaimNumber(orgId: string): Promise<string>;
  getNextMemberNumber(orgId: string): Promise<string>;
  generateCaseNumber(orgId: string): Promise<string>;
  getGroupsByOrg(orgId: string): Promise<Group[]>;
  getGroup(id: string, orgId: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroup(id: string, data: Partial<InsertGroup>, orgId: string): Promise<Group | undefined>;
  getChibikhuluReceivables(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<ChibikhuluReceivable[]>;
  createChibikhuluReceivable(entry: InsertChibikhuluReceivable): Promise<ChibikhuluReceivable>;
  getChibikhuluSummary(orgId: string): Promise<{ totalDue: string; totalSettled: string; outstanding: string }>;
  getSettlements(orgId: string): Promise<Settlement[]>;
  createSettlement(settlement: InsertSettlement): Promise<Settlement>;
  updateSettlement(id: string, data: Partial<InsertSettlement>, orgId: string): Promise<Settlement | undefined>;
  getCostSheetsByOrg(orgId: string): Promise<any[]>;
  getCostSheet(id: string, orgId: string): Promise<any>;
  createCostSheet(data: any): Promise<any>;
  getCostLineItems(costSheetId: string, orgId: string): Promise<any[]>;
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
  async getBranch(id: string, organizationId: string): Promise<Branch | undefined> {
    const tdb = await getDbForOrg(organizationId);
    const [branch] = await tdb.select().from(branches).where(eq(branches.id, id));
    return branch;
  }
  async getBranchesByOrg(organizationId: string): Promise<Branch[]> {
    const tdb = await getDbForOrg(organizationId);
    return tdb.select().from(branches).where(eq(branches.organizationId, organizationId));
  }
  async createBranch(branch: InsertBranch): Promise<Branch> {
    const tdb = await getDbForOrg(branch.organizationId);
    const [created] = await tdb.insert(branches).values(branch).returning();
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
  async getRole(id: string, organizationId: string): Promise<Role | undefined> {
    const tdb = await getDbForOrg(organizationId);
    const [role] = await tdb.select().from(roles).where(eq(roles.id, id));
    return role;
  }
  async getRolesByOrg(organizationId: string): Promise<Role[]> {
    const tdb = await getDbForOrg(organizationId);
    return tdb.select().from(roles).where(eq(roles.organizationId, organizationId));
  }
  async getRoleByName(name: string, organizationId: string): Promise<Role | undefined> {
    const tdb = await getDbForOrg(organizationId);
    const [role] = await tdb.select().from(roles).where(and(eq(roles.name, name), eq(roles.organizationId, organizationId)));
    return role;
  }
  async createRole(role: InsertRole): Promise<Role> {
    const orgId = role.organizationId!;
    const tdb = await getDbForOrg(orgId);
    const [created] = await tdb.insert(roles).values(role).returning();
    return created;
  }
  async getPermissions(): Promise<Permission[]> {
    return db.select().from(permissions);
  }
  async createPermission(perm: InsertPermission): Promise<Permission> {
    const [created] = await db.insert(permissions).values(perm).returning();
    return created;
  }
  async getRolePermissions(roleId: string, organizationId: string): Promise<Permission[]> {
    const tdb = await getDbForOrg(organizationId);
    const rows = await tdb.select({ permission: permissions }).from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.permission);
  }
  async addRolePermission(roleId: string, permissionId: string): Promise<void> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [role] = await tdb.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (role) {
        await tdb.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
        return;
      }
    }
    await db.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
  }
  async getUserRoles(userId: string, organizationId: string): Promise<(Role & { branchId: string | null })[]> {
    const tdb = await getDbForOrg(organizationId);
    const rows = await tdb.select({ role: roles, branchId: userRoles.branchId }).from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return rows.map((r) => ({ ...r.role, branchId: r.branchId }));
  }
  async addUserRole(userId: string, roleId: string, branchId?: string): Promise<void> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [role] = await tdb.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (role) {
        await tdb.insert(userRoles).values({ userId, roleId, branchId: branchId ?? null });
        return;
      }
    }
    await db.insert(userRoles).values({ userId, roleId, branchId: branchId ?? null });
  }
  async removeUserRole(userId: string, roleId: string): Promise<void> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      await tdb.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
    }
    await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  }
  async clearUserRoles(userId: string): Promise<void> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const orgId = user?.organizationId ?? null;
    if (orgId != null) {
      const tdb = await getDbForOrg(orgId as string);
      await tdb.delete(userRoles).where(eq(userRoles.userId, userId));
      return;
    }
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
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const orgId = user?.organizationId;
    const roleRows = orgId
      ? await (await getDbForOrg(orgId))
          .select({
            roleId: roles.id,
            roleName: roles.name,
            permissionName: permissions.name,
          })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(eq(userRoles.userId, userId))
      : await db
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

    if (user?.email?.toLowerCase() === PLATFORM_SUPERUSER_EMAIL.toLowerCase()) {
      permSet.add("create:tenant");
      permSet.add("delete:tenant");
    }

    return Array.from(permSet);
  }
  async getAuditLogs(organizationId: string, limit = 50, offset = 0): Promise<AuditLog[]> {
    const tdb = await getDbForOrg(organizationId);
    return tdb.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId))
      .orderBy(desc(auditLogs.timestamp)).limit(limit).offset(offset);
  }
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const orgId = log.organizationId;
    if (!orgId) throw new Error("createAuditLog: organizationId is required");
    const tdb = await getDbForOrg(orgId);
    const [created] = await tdb.insert(auditLogs).values(log).returning();
    return created;
  }

  // ─── Clients ───────────────────────────────────────────────
  async getClientsByOrg(organizationId: string, limit = 50, offset = 0, search?: string): Promise<Client[]> {
    const tdb = await getDbForOrg(organizationId);
    const conditions = [eq(clients.organizationId, organizationId)];
    if (search && search.trim()) {
      const raw = String(search).trim();
      const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const q = `%${esc}%`;
      conditions.push(
        or(
          ilike(clients.firstName, q),
          ilike(clients.lastName, q),
          ilike(clients.email, q),
          ilike(clients.phone, q)
        )!
      );
    }
    return tdb.select().from(clients).where(and(...conditions))
      .orderBy(desc(clients.createdAt)).limit(limit).offset(offset);
  }
  async getClient(id: string, orgId: string): Promise<Client | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [client] = await tdb.select().from(clients).where(eq(clients.id, id));
    return client;
  }
  async getClientByActivationCode(code: string, orgId: string): Promise<Client | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [client] = await tdb.select().from(clients)
      .where(and(eq(clients.activationCode, code), eq(clients.organizationId, orgId)));
    return client;
  }
  async getClientIdsByOrgSearch(organizationId: string, search: string): Promise<string[]> {
    if (!search || !search.trim()) return [];
    const tdb = await getDbForOrg(organizationId);
    const raw = String(search).trim();
    const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const q = `%${esc}%`;
    const rows = await tdb.select({ id: clients.id }).from(clients)
      .where(and(
        eq(clients.organizationId, organizationId),
        or(
          ilike(clients.firstName, q),
          ilike(clients.lastName, q),
          ilike(clients.email, q),
          ilike(clients.phone, q)
        )!
      ));
    return rows.map((r) => r.id);
  }
  async createClient(client: InsertClient): Promise<Client> {
    const tdb = await getDbForOrg(client.organizationId);
    const [created] = await tdb.insert(clients).values(client).returning();
    return created;
  }
  async updateClient(id: string, data: Partial<InsertClient>, orgId: string): Promise<Client | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(clients).set(data).where(eq(clients.id, id)).returning();
    return updated;
  }

  // ─── Dependents ────────────────────────────────────────────
  async getDependentsByClient(clientId: string, orgId: string): Promise<Dependent[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(dependents).where(eq(dependents.clientId, clientId)).orderBy(dependents.createdAt);
  }
  async createDependent(dep: InsertDependent): Promise<Dependent> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const client = await this.getClient(dep.clientId, org.id);
      if (client) {
        const tdb = await getDbForOrg(org.id);
        const memberNumber = await this.getNextMemberNumber(org.id);
        const [created] = await tdb.insert(dependents).values({ ...dep, memberNumber }).returning();
        return created;
      }
    }
    const [created] = await db.insert(dependents).values(dep).returning();
    return created;
  }
  async updateDependent(id: string, data: Partial<InsertDependent>, orgId: string): Promise<Dependent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(dependents).set(data).where(eq(dependents.id, id)).returning();
    return updated;
  }
  async deleteDependent(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(dependents).where(eq(dependents.id, id));
  }

  // ─── Products ──────────────────────────────────────────────
  async getProductsByOrg(organizationId: string): Promise<Product[]> {
    const tdb = await getDbForOrg(organizationId);
    return tdb.select().from(products).where(eq(products.organizationId, organizationId));
  }
  async getProduct(id: string, orgId: string): Promise<Product | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [product] = await tdb.select().from(products).where(eq(products.id, id));
    return product;
  }
  async createProduct(product: InsertProduct): Promise<Product> {
    const tdb = await getDbForOrg(product.organizationId);
    const [created] = await tdb.insert(products).values(product).returning();
    return created;
  }
  async updateProduct(id: string, data: Partial<InsertProduct>, orgId: string): Promise<Product | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(products).set(data).where(eq(products.id, id)).returning();
    return updated;
  }
  async getProductVersions(productId: string, orgId: string): Promise<ProductVersion[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(productVersions).where(eq(productVersions.productId, productId))
      .orderBy(desc(productVersions.version));
  }
  async getProductVersion(id: string, orgId: string): Promise<ProductVersion | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [pv] = await tdb.select().from(productVersions).where(eq(productVersions.id, id));
    return pv;
  }
  async createProductVersion(pv: InsertProductVersion): Promise<ProductVersion> {
    const orgId = (pv as InsertProductVersion & { organizationId?: string }).organizationId;
    if (orgId) {
      const tdb = await getDbForOrg(orgId);
      const [created] = await tdb.insert(productVersions).values(pv).returning();
      return created;
    }
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const product = await this.getProduct(pv.productId, org.id);
      if (product) {
        const tdb = await getDbForOrg(org.id);
        const [created] = await tdb.insert(productVersions).values({ ...pv, organizationId: org.id } as any).returning();
        return created;
      }
    }
    const [created] = await db.insert(productVersions).values(pv).returning();
    return created;
  }
  async getBenefitCatalogItems(orgId: string): Promise<BenefitCatalogItem[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(benefitCatalogItems).where(eq(benefitCatalogItems.organizationId, orgId));
  }
  async createBenefitCatalogItem(item: InsertBenefitCatalogItem): Promise<BenefitCatalogItem> {
    const tdb = await getDbForOrg(item.organizationId);
    const [created] = await tdb.insert(benefitCatalogItems).values(item).returning();
    return created;
  }
  async getBenefitBundles(orgId: string): Promise<BenefitBundle[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(benefitBundles).where(eq(benefitBundles.organizationId, orgId));
  }
  async createBenefitBundle(bundle: InsertBenefitBundle): Promise<BenefitBundle> {
    const tdb = await getDbForOrg(bundle.organizationId);
    const [created] = await tdb.insert(benefitBundles).values(bundle).returning();
    return created;
  }
  async getAddOns(orgId: string): Promise<AddOn[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(addOns).where(eq(addOns.organizationId, orgId));
  }
  async createAddOn(addon: InsertAddOn): Promise<AddOn> {
    const tdb = await getDbForOrg(addon.organizationId);
    const [created] = await tdb.insert(addOns).values(addon).returning();
    return created;
  }
  async getAgeBandConfigs(orgId: string): Promise<AgeBandConfig[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(ageBandConfigs).where(eq(ageBandConfigs.organizationId, orgId));
  }
  async createAgeBandConfig(config: InsertAgeBandConfig): Promise<AgeBandConfig> {
    const tdb = await getDbForOrg(config.organizationId);
    const [created] = await tdb.insert(ageBandConfigs).values(config).returning();
    return created;
  }

  // ─── Policies ──────────────────────────────────────────────
  async getPoliciesByOrg(organizationId: string, limit = 50, offset = 0, filters?: ReportFilters & { status?: string; statuses?: string[]; search?: string }): Promise<Policy[]> {
    const tdb = await getDbForOrg(organizationId);
    const conditions = [eq(policies.organizationId, organizationId)];
    if (filters?.fromDate) conditions.push(gte(policies.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policies.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.status) conditions.push(eq(policies.status, filters.status));
    if (filters?.statuses?.length) conditions.push(inArray(policies.status, filters.statuses));
    if (filters?.search && filters.search.trim()) {
      const raw = String(filters.search).trim();
      const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const q = `%${esc}%`;
      const clientIds = await this.getClientIdsByOrgSearch(organizationId, raw);
      conditions.push(
        clientIds.length > 0
          ? or(ilike(policies.policyNumber, q), inArray(policies.clientId, clientIds))!
          : ilike(policies.policyNumber, q)
      );
    }
    return tdb.select().from(policies).where(and(...conditions))
      .orderBy(desc(policies.createdAt)).limit(limit).offset(offset);
  }
  async getPoliciesByClient(clientId: string, orgId: string): Promise<Policy[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policies).where(eq(policies.clientId, clientId));
  }
  async getPoliciesByAgent(agentId: string, orgId: string): Promise<Policy[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policies).where(eq(policies.agentId, agentId));
  }
  async getPolicy(id: string, orgId: string): Promise<Policy | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [policy] = await tdb.select().from(policies).where(eq(policies.id, id));
    return policy;
  }
  async getPolicyByNumber(policyNumber: string, orgId: string): Promise<Policy | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [policy] = await tdb.select().from(policies)
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.organizationId, orgId)));
    return policy;
  }
  async createPolicy(policy: InsertPolicy): Promise<Policy> {
    const tdb = await getDbForOrg(policy.organizationId);
    const [created] = await tdb.insert(policies).values(policy).returning();
    return created;
  }
  async updatePolicy(id: string, data: Partial<InsertPolicy>, orgId: string): Promise<Policy | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(policies).set(data).where(eq(policies.id, id)).returning();
    return updated;
  }
  async createPolicyStatusHistory(policyId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [p] = await tdb.select().from(policies).where(eq(policies.id, policyId)).limit(1);
      if (p) {
        await tdb.insert(policyStatusHistory).values({ policyId, fromStatus, toStatus, reason, changedBy });
        return;
      }
    }
    await db.insert(policyStatusHistory).values({ policyId, fromStatus, toStatus, reason, changedBy });
  }
  async getReinstatementHistory(organizationId: string, filters?: ReportFilters): Promise<ReinstatementEntry[]> {
    const tdb = await getDbForOrg(organizationId);
    const reinstatementFromStatuses = ["lapsed", "reinstatement_pending"];
    const conditions = [
      eq(policies.organizationId, organizationId),
      eq(policyStatusHistory.toStatus, "active"),
      inArray(policyStatusHistory.fromStatus, reinstatementFromStatuses),
    ];
    if (filters?.fromDate) conditions.push(gte(policyStatusHistory.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policyStatusHistory.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    const rows = await tdb
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
    const tdb = await getDbForOrg(organizationId);
    const conditions = [
      eq(policies.organizationId, organizationId),
      eq(policyStatusHistory.toStatus, "active"),
    ];
    if (filters?.fromDate) conditions.push(gte(policyStatusHistory.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policyStatusHistory.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    const rows = await tdb
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
  async getPolicyMembers(policyId: string, orgId: string): Promise<PolicyMember[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policyMembers).where(eq(policyMembers.policyId, policyId));
  }
  async createPolicyMember(member: InsertPolicyMember): Promise<PolicyMember> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const [p] = await (await getDbForOrg(org.id)).select().from(policies).where(eq(policies.id, member.policyId)).limit(1);
      if (p) {
        const tdb = await getDbForOrg(org.id);
        const memberNumber = await this.getNextMemberNumber(org.id);
        const [created] = await tdb.insert(policyMembers).values({
          ...member,
          organizationId: p.organizationId,
          memberNumber,
        }).returning();
        return created;
      }
    }
    const [created] = await db.insert(policyMembers).values(member).returning();
    return created;
  }
  async getPolicyAddOns(policyId: string, orgId: string): Promise<PolicyAddOn[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policyAddOns).where(eq(policyAddOns.policyId, policyId));
  }
  async addPolicyAddOns(policyId: string, addOnIds: string[], orgId: string): Promise<void> {
    if (addOnIds.length === 0) return;
    const tdb = await getDbForOrg(orgId);
    await tdb.insert(policyAddOns).values(addOnIds.map((addOnId) => ({ policyId, addOnId })));
  }

  // ─── Payments ──────────────────────────────────────────────
  async createPaymentTransaction(tx: InsertPaymentTransaction): Promise<PaymentTransaction> {
    const tdb = await getDbForOrg(tx.organizationId);
    const [created] = await tdb.insert(paymentTransactions).values(tx).returning();
    return created;
  }
  async getPaymentsByPolicy(policyId: string, orgId: string): Promise<PaymentTransaction[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentTransactions).where(eq(paymentTransactions.policyId, policyId))
      .orderBy(desc(paymentTransactions.receivedAt));
  }
  async getPaymentsByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<PaymentTransaction[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(paymentTransactions.organizationId, orgId)];
    const dateCol = paymentTransactions.receivedAt;
    if (filters?.fromDate) conditions.push(gte(dateCol, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(dateCol, new Date(filters.toDate + "T23:59:59.999Z")));
    return tdb.select().from(paymentTransactions).where(and(...conditions))
      .orderBy(desc(paymentTransactions.receivedAt)).limit(limit).offset(offset);
  }
  async getPaymentTransaction(id: string, orgId: string): Promise<PaymentTransaction | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [tx] = await tdb.select().from(paymentTransactions).where(eq(paymentTransactions.id, id));
    return tx;
  }
  async createReceipt(receipt: InsertReceipt): Promise<Receipt> {
    const tdb = await getDbForOrg(receipt.organizationId);
    const [created] = await tdb.insert(receipts).values(receipt).returning();
    return created;
  }
  async getReceiptsByPolicy(policyId: string, orgId: string): Promise<Receipt[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(receipts).where(eq(receipts.policyId, policyId));
  }
  async getNextReceiptNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const [result] = await tdb.select({ cnt: count() }).from(receipts).where(eq(receipts.organizationId, orgId));
    const num = (result?.cnt || 0) as number;
    return String(num + 1);
  }

  async getPaymentIntentById(id: string, orgId: string): Promise<PaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(paymentIntents).where(eq(paymentIntents.id, id));
    return row;
  }
  async getPaymentIntentByOrgAndIdempotencyKey(orgId: string, idempotencyKey: string): Promise<PaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(paymentIntents).where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.idempotencyKey, idempotencyKey)));
    return row;
  }
  async getPaymentIntentByMerchantReference(orgId: string, merchantReference: string): Promise<PaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(paymentIntents).where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.merchantReference, merchantReference)));
    return row;
  }
  async getPaymentIntentsByOrg(orgId: string, limit = 100): Promise<PaymentIntent[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentIntents).where(eq(paymentIntents.organizationId, orgId))
      .orderBy(desc(paymentIntents.createdAt)).limit(limit);
  }
  async getPaymentIntentsByClient(clientId: string, orgId: string): Promise<PaymentIntent[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentIntents).where(eq(paymentIntents.clientId, clientId))
      .orderBy(desc(paymentIntents.createdAt));
  }
  async createPaymentIntent(intent: InsertPaymentIntent): Promise<PaymentIntent> {
    const tdb = await getDbForOrg(intent.organizationId);
    const [created] = await tdb.insert(paymentIntents).values({ ...intent, updatedAt: new Date() }).returning();
    return created;
  }
  async updatePaymentIntent(id: string, data: Partial<InsertPaymentIntent>, orgId: string): Promise<PaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(paymentIntents).set({ ...data, updatedAt: new Date() }).where(eq(paymentIntents.id, id)).returning();
    return updated;
  }
  async createPaymentEvent(event: InsertPaymentEvent): Promise<PaymentEvent> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [pi] = await tdb.select().from(paymentIntents).where(eq(paymentIntents.id, event.paymentIntentId)).limit(1);
      if (pi) {
        const [created] = await tdb.insert(paymentEvents).values(event).returning();
        return created;
      }
    }
    const [created] = await db.insert(paymentEvents).values(event).returning();
    return created;
  }
  async getPaymentEventsByIntentId(paymentIntentId: string, orgId: string): Promise<PaymentEvent[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentEvents).where(eq(paymentEvents.paymentIntentId, paymentIntentId))
      .orderBy(desc(paymentEvents.createdAt));
  }
  async createPaymentReceipt(receipt: InsertPaymentReceipt): Promise<PaymentReceipt> {
    const intentId = receipt.paymentIntentId ?? undefined;
    if (intentId) {
      const orgs = await db.select({ id: organizations.id }).from(organizations);
      for (const org of orgs) {
        const tdb = await getDbForOrg(org.id);
        const [pi] = await tdb.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
        if (pi) {
          const [created] = await tdb.insert(paymentReceipts).values(receipt).returning();
          return created;
        }
      }
    }
    const [created] = await db.insert(paymentReceipts).values(receipt).returning();
    return created;
  }
  async getPaymentReceiptById(id: string, orgId: string): Promise<PaymentReceipt | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(paymentReceipts).where(eq(paymentReceipts.id, id));
    return row;
  }
  async getPaymentReceiptsByPolicy(policyId: string, orgId: string): Promise<PaymentReceipt[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentReceipts).where(eq(paymentReceipts.policyId, policyId))
      .orderBy(desc(paymentReceipts.issuedAt));
  }
  async getPaymentReceiptsByClient(clientId: string, orgId: string): Promise<PaymentReceipt[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentReceipts).where(eq(paymentReceipts.clientId, clientId))
      .orderBy(desc(paymentReceipts.issuedAt));
  }
  async getNextPaymentReceiptNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const [result] = await tdb.select({ cnt: count() }).from(paymentReceipts).where(eq(paymentReceipts.organizationId, orgId));
    const num = (result?.cnt || 0) as number;
    return String(num + 1);
  }
  async updatePaymentReceipt(id: string, data: Partial<InsertPaymentReceipt>, orgId: string): Promise<PaymentReceipt | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(paymentReceipts).set(data).where(eq(paymentReceipts.id, id)).returning();
    return updated;
  }

  // ─── Claims ────────────────────────────────────────────────
  async getClaimsByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<Claim[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(claims.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(claims.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(claims.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return tdb.select().from(claims).where(and(...conditions))
      .orderBy(desc(claims.createdAt)).limit(limit).offset(offset);
  }
  async getClaimsByPolicy(policyId: string, orgId: string): Promise<Claim[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(claims).where(eq(claims.policyId, policyId));
  }
  async getClaimsByClient(clientId: string, orgId: string): Promise<Claim[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(claims).where(and(eq(claims.clientId, clientId), eq(claims.organizationId, orgId)))
      .orderBy(desc(claims.createdAt));
  }
  async getClaim(id: string, orgId: string): Promise<Claim | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [claim] = await tdb.select().from(claims).where(eq(claims.id, id));
    return claim;
  }
  async createClaim(claim: InsertClaim): Promise<Claim> {
    const tdb = await getDbForOrg(claim.organizationId);
    const [created] = await tdb.insert(claims).values(claim).returning();
    return created;
  }
  async updateClaim(id: string, data: Partial<InsertClaim>, orgId: string): Promise<Claim | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(claims).set(data).where(eq(claims.id, id)).returning();
    return updated;
  }
  async createClaimStatusHistory(claimId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string): Promise<void> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [c] = await tdb.select().from(claims).where(eq(claims.id, claimId)).limit(1);
      if (c) {
        await tdb.insert(claimStatusHistory).values({ claimId, fromStatus, toStatus, reason, changedBy });
        return;
      }
    }
    await db.insert(claimStatusHistory).values({ claimId, fromStatus, toStatus, reason, changedBy });
  }
  async getClaimDocuments(claimId: string, orgId: string): Promise<ClaimDocument[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(claimDocuments).where(eq(claimDocuments.claimId, claimId));
  }
  async createClaimDocument(doc: InsertClaimDocument): Promise<ClaimDocument> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [c] = await tdb.select().from(claims).where(eq(claims.id, doc.claimId)).limit(1);
      if (c) {
        const [created] = await tdb.insert(claimDocuments).values(doc).returning();
        return created;
      }
    }
    const [created] = await db.insert(claimDocuments).values(doc).returning();
    return created;
  }

  async getFeedbackByClient(clientId: string, orgId: string): Promise<ClientFeedback[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(clientFeedback).where(and(eq(clientFeedback.clientId, clientId), eq(clientFeedback.organizationId, orgId)))
      .orderBy(desc(clientFeedback.createdAt));
  }
  async createFeedback(feedback: InsertClientFeedback): Promise<ClientFeedback> {
    const tdb = await getDbForOrg(feedback.organizationId);
    const [created] = await tdb.insert(clientFeedback).values(feedback).returning();
    return created;
  }

  // ─── Funeral Cases ─────────────────────────────────────────
  async getFuneralCasesByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<FuneralCase[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(funeralCases.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(funeralCases.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(funeralCases.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return tdb.select().from(funeralCases).where(and(...conditions))
      .orderBy(desc(funeralCases.createdAt)).limit(limit).offset(offset);
  }
  async getFuneralCase(id: string, orgId: string): Promise<FuneralCase | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [fc] = await tdb.select().from(funeralCases).where(eq(funeralCases.id, id));
    return fc;
  }
  async createFuneralCase(fc: InsertFuneralCase): Promise<FuneralCase> {
    const tdb = await getDbForOrg(fc.organizationId);
    const [created] = await tdb.insert(funeralCases).values(fc).returning();
    return created;
  }
  async updateFuneralCase(id: string, data: Partial<InsertFuneralCase>, orgId: string): Promise<FuneralCase | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(funeralCases).set(data).where(eq(funeralCases.id, id)).returning();
    return updated;
  }
  async getFuneralTasks(caseId: string, orgId: string): Promise<FuneralTask[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(funeralTasks).where(eq(funeralTasks.funeralCaseId, caseId));
  }
  async createFuneralTask(task: InsertFuneralTask): Promise<FuneralTask> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [fc] = await tdb.select().from(funeralCases).where(eq(funeralCases.id, task.funeralCaseId)).limit(1);
      if (fc) {
        const [created] = await tdb.insert(funeralTasks).values(task).returning();
        return created;
      }
    }
    const [created] = await db.insert(funeralTasks).values(task).returning();
    return created;
  }
  async updateFuneralTask(id: string, data: Partial<InsertFuneralTask>, orgId: string): Promise<FuneralTask | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(funeralTasks).set(data).where(eq(funeralTasks.id, id)).returning();
    return updated;
  }

  // ─── Fleet ─────────────────────────────────────────────────
  async getFleetVehicles(orgId: string): Promise<FleetVehicle[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(fleetVehicles).where(eq(fleetVehicles.organizationId, orgId));
  }
  async createFleetVehicle(vehicle: InsertFleetVehicle): Promise<FleetVehicle> {
    const tdb = await getDbForOrg(vehicle.organizationId);
    const [created] = await tdb.insert(fleetVehicles).values(vehicle).returning();
    return created;
  }
  async updateFleetVehicle(id: string, data: Partial<InsertFleetVehicle>, orgId: string): Promise<FleetVehicle | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(fleetVehicles).set(data).where(eq(fleetVehicles.id, id)).returning();
    return updated;
  }

  // ─── Commissions ───────────────────────────────────────────
  async getCommissionPlans(orgId: string): Promise<CommissionPlan[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(commissionPlans).where(eq(commissionPlans.organizationId, orgId));
  }
  async createCommissionPlan(plan: InsertCommissionPlan): Promise<CommissionPlan> {
    const tdb = await getDbForOrg(plan.organizationId);
    const [created] = await tdb.insert(commissionPlans).values(plan).returning();
    return created;
  }
  async getCommissionLedgerByAgent(agentId: string, orgId: string): Promise<CommissionLedgerEntry[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(commissionLedgerEntries).where(eq(commissionLedgerEntries.agentId, agentId))
      .orderBy(desc(commissionLedgerEntries.createdAt));
  }
  async createCommissionLedgerEntry(entry: InsertCommissionLedgerEntry): Promise<CommissionLedgerEntry> {
    const tdb = await getDbForOrg(entry.organizationId);
    const [created] = await tdb.insert(commissionLedgerEntries).values(entry).returning();
    return created;
  }

  // ─── Notifications ─────────────────────────────────────────
  async getNotificationTemplates(orgId: string): Promise<NotificationTemplate[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(notificationTemplates).where(eq(notificationTemplates.organizationId, orgId));
  }
  async createNotificationTemplate(tmpl: InsertNotificationTemplate): Promise<NotificationTemplate> {
    const tdb = await getDbForOrg(tmpl.organizationId);
    const [created] = await tdb.insert(notificationTemplates).values(tmpl).returning();
    return created;
  }

  // ─── Leads ─────────────────────────────────────────────────
  async getLeadsByOrg(orgId: string, limit = 50, offset = 0): Promise<Lead[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(leads).where(eq(leads.organizationId, orgId))
      .orderBy(desc(leads.createdAt)).limit(limit).offset(offset);
  }
  async getLeadsByAgent(agentId: string, orgId: string): Promise<Lead[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(leads).where(eq(leads.agentId, agentId));
  }
  async getLead(id: string, orgId: string): Promise<Lead | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [lead] = await tdb.select().from(leads).where(eq(leads.id, id));
    return lead;
  }
  async createLead(lead: InsertLead): Promise<Lead> {
    const tdb = await getDbForOrg(lead.organizationId);
    const [created] = await tdb.insert(leads).values(lead).returning();
    return created;
  }
  async updateLead(id: string, data: Partial<InsertLead>, orgId: string): Promise<Lead | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(leads).set(data).where(eq(leads.id, id)).returning();
    return updated;
  }

  // ─── Expenditures ──────────────────────────────────────────
  async getExpenditures(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<Expenditure[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(expenditures.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(expenditures.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(expenditures.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return tdb.select().from(expenditures).where(and(...conditions))
      .orderBy(desc(expenditures.createdAt)).limit(limit).offset(offset);
  }
  async createExpenditure(exp: InsertExpenditure): Promise<Expenditure> {
    const tdb = await getDbForOrg(exp.organizationId);
    const [created] = await tdb.insert(expenditures).values(exp).returning();
    return created;
  }

  // ─── Price Book ────────────────────────────────────────────
  async getPriceBookItems(orgId: string): Promise<PriceBookItem[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(priceBookItems).where(eq(priceBookItems.organizationId, orgId));
  }
  async createPriceBookItem(item: InsertPriceBookItem): Promise<PriceBookItem> {
    const tdb = await getDbForOrg(item.organizationId);
    const [created] = await tdb.insert(priceBookItems).values(item).returning();
    return created;
  }
  async updatePriceBookItem(id: string, data: Partial<InsertPriceBookItem>, orgId: string): Promise<PriceBookItem | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(priceBookItems).set(data).where(eq(priceBookItems.id, id)).returning();
    return updated;
  }

  // ─── Approvals ─────────────────────────────────────────────
  async getApprovalRequests(orgId: string, status?: string): Promise<ApprovalRequest[]> {
    const tdb = await getDbForOrg(orgId);
    if (status) {
      return tdb.select().from(approvalRequests)
        .where(and(eq(approvalRequests.organizationId, orgId), eq(approvalRequests.status, status)))
        .orderBy(desc(approvalRequests.createdAt));
    }
    return tdb.select().from(approvalRequests).where(eq(approvalRequests.organizationId, orgId))
      .orderBy(desc(approvalRequests.createdAt));
  }
  async createApprovalRequest(req: InsertApprovalRequest): Promise<ApprovalRequest> {
    const tdb = await getDbForOrg(req.organizationId);
    const [created] = await tdb.insert(approvalRequests).values(req).returning();
    return created;
  }
  async updateApprovalRequest(id: string, data: Partial<InsertApprovalRequest>, orgId: string): Promise<ApprovalRequest | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(approvalRequests).set(data).where(eq(approvalRequests.id, id)).returning();
    return updated;
  }

  // ─── Terms & Conditions ────────────────────────────────────
  async getTermsByOrg(orgId: string): Promise<TermsAndConditions[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(termsAndConditions)
      .where(and(eq(termsAndConditions.organizationId, orgId), eq(termsAndConditions.isActive, true)))
      .orderBy(termsAndConditions.sortOrder);
  }
  async getTermsByOrgAll(orgId: string): Promise<TermsAndConditions[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(termsAndConditions)
      .where(eq(termsAndConditions.organizationId, orgId))
      .orderBy(termsAndConditions.sortOrder);
  }
  async createTerms(terms: InsertTerms): Promise<TermsAndConditions> {
    const tdb = await getDbForOrg(terms.organizationId);
    const [created] = await tdb.insert(termsAndConditions).values(terms).returning();
    return created;
  }
  async updateTerms(id: string, data: Partial<InsertTerms>, orgId: string): Promise<TermsAndConditions | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(termsAndConditions).set(data).where(eq(termsAndConditions.id, id)).returning();
    return updated;
  }
  async deleteTerms(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(termsAndConditions).where(eq(termsAndConditions.id, id));
  }

  // ─── Payroll ───────────────────────────────────────────────
  async getPayrollEmployees(orgId: string): Promise<PayrollEmployee[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(payrollEmployees).where(eq(payrollEmployees.organizationId, orgId));
  }
  async createPayrollEmployee(emp: InsertPayrollEmployee): Promise<PayrollEmployee> {
    const tdb = await getDbForOrg(emp.organizationId);
    const [created] = await tdb.insert(payrollEmployees).values(emp).returning();
    return created;
  }
  async getPayrollRuns(orgId: string): Promise<PayrollRun[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(payrollRuns).where(eq(payrollRuns.organizationId, orgId))
      .orderBy(desc(payrollRuns.createdAt));
  }
  async createPayrollRun(run: InsertPayrollRun): Promise<PayrollRun> {
    const tdb = await getDbForOrg(run.organizationId);
    const [created] = await tdb.insert(payrollRuns).values(run).returning();
    return created;
  }

  // ─── Cashups ───────────────────────────────────────────────
  async getCashups(orgId: string, limit = 30, filters?: ReportFilters & { preparedBy?: string }): Promise<Cashup[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(cashups.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(cashups.cashupDate, filters.fromDate));
    if (filters?.toDate) conditions.push(lte(cashups.cashupDate, filters.toDate));
    if (filters?.preparedBy) conditions.push(eq(cashups.preparedBy, filters.preparedBy));
    return tdb.select().from(cashups).where(and(...conditions))
      .orderBy(desc(cashups.createdAt)).limit(limit);
  }
  async createCashup(cashup: InsertCashup): Promise<Cashup> {
    const tdb = await getDbForOrg(cashup.organizationId);
    const [created] = await tdb.insert(cashups).values(cashup).returning();
    return created;
  }
  async updateCashup(id: string, data: Partial<InsertCashup>, orgId: string): Promise<Cashup | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(cashups).set(data).where(eq(cashups.id, id)).returning();
    return updated;
  }

  // ─── Security Questions ────────────────────────────────────
  async getSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select({ id: securityQuestions.id, question: securityQuestions.question })
      .from(securityQuestions)
      .where(and(eq(securityQuestions.organizationId, orgId), eq(securityQuestions.isActive, true)));
  }

  // ─── Dashboard Stats ──────────────────────────────────────
  async getDashboardStats(orgId: string): Promise<any> {
    const tdb = await getDbForOrg(orgId);
    const [policyCount] = await tdb.select({ cnt: count() }).from(policies).where(eq(policies.organizationId, orgId));
    const [activePolicies] = await tdb.select({ cnt: count() }).from(policies)
      .where(and(eq(policies.organizationId, orgId), eq(policies.status, "active")));
    const [clientCount] = await tdb.select({ cnt: count() }).from(clients).where(eq(clients.organizationId, orgId));
    const [claimCount] = await tdb.select({ cnt: count() }).from(claims).where(eq(claims.organizationId, orgId));
    const [openClaims] = await tdb.select({ cnt: count() }).from(claims)
      .where(and(eq(claims.organizationId, orgId), inArray(claims.status, ["submitted", "verified"])));
    const [funeralCount] = await tdb.select({ cnt: count() }).from(funeralCases).where(eq(funeralCases.organizationId, orgId));
    const [leadCount] = await tdb.select({ cnt: count() }).from(leads).where(eq(leads.organizationId, orgId));
    const [txCount] = await tdb.select({ cnt: count() }).from(paymentTransactions).where(eq(paymentTransactions.organizationId, orgId));

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
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, policy_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET policy_next = org_policy_sequences.policy_next + 1
      RETURNING policy_next
    `);
    const nextVal = (result as unknown as { rows?: { policy_next: number }[] }).rows?.[0]?.policy_next ?? 1;
    const org = await this.getOrganization(orgId);
    const padding = Math.max(1, org?.policyNumberPadding ?? 5);
    const prefix = (org?.policyNumberPrefix ?? "").trim();
    const padded = String(nextVal).padStart(padding, "0");
    return prefix ? `${prefix}${padded}` : padded;
  }
  async generateClaimNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const [result] = await tdb.select({ cnt: count() }).from(claims).where(eq(claims.organizationId, orgId));
    const num = ((result?.cnt || 0) as number) + 1;
    return `CLM-${String(num).padStart(6, "0")}`;
  }
  async getNextMemberNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(orgMemberSequences).where(eq(orgMemberSequences.organizationId, orgId));
    const nextVal = row ? row.memberNext + 1 : 1;
    if (row) {
      await tdb.update(orgMemberSequences).set({ memberNext: nextVal }).where(eq(orgMemberSequences.organizationId, orgId));
    } else {
      await tdb.insert(orgMemberSequences).values({ organizationId: orgId, memberNext: nextVal });
    }
    return `MEM-${String(nextVal).padStart(6, "0")}`;
  }
  async generateCaseNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const [result] = await tdb.select({ cnt: count() }).from(funeralCases).where(eq(funeralCases.organizationId, orgId));
    const num = ((result?.cnt || 0) as number) + 1;
    return `FNC-${String(num).padStart(6, "0")}`;
  }

  // ─── Groups ──────────────────────────────────────────────
  async getGroupsByOrg(orgId: string): Promise<Group[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(groups).where(eq(groups.organizationId, orgId)).orderBy(desc(groups.createdAt));
  }
  async getGroup(id: string, orgId: string): Promise<Group | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [g] = await tdb.select().from(groups).where(eq(groups.id, id));
    return g;
  }
  async createGroup(group: InsertGroup): Promise<Group> {
    const tdb = await getDbForOrg(group.organizationId);
    const [created] = await tdb.insert(groups).values(group).returning();
    return created;
  }
  async updateGroup(id: string, data: Partial<InsertGroup>, orgId: string): Promise<Group | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(groups).set(data).where(eq(groups.id, id)).returning();
    return updated;
  }

  // ─── Chibikhulu Receivables ──────────────────────────────
  async getChibikhuluReceivables(orgId: string, limit = 100, offset = 0, filters?: ReportFilters): Promise<ChibikhuluReceivable[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(chibikhuluReceivables.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(chibikhuluReceivables.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(chibikhuluReceivables.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return tdb.select().from(chibikhuluReceivables).where(and(...conditions))
      .orderBy(desc(chibikhuluReceivables.createdAt)).limit(limit).offset(offset);
  }
  async createChibikhuluReceivable(entry: InsertChibikhuluReceivable): Promise<ChibikhuluReceivable> {
    const tdb = await getDbForOrg(entry.organizationId);
    const [created] = await tdb.insert(chibikhuluReceivables).values(entry).returning();
    return created;
  }
  async getChibikhuluSummary(orgId: string): Promise<{ totalDue: string; totalSettled: string; outstanding: string }> {
    const tdb = await getDbForOrg(orgId);
    const [totals] = await tdb.select({
      totalDue: sql<string>`COALESCE(SUM(${chibikhuluReceivables.amount}), '0')`,
    }).from(chibikhuluReceivables).where(eq(chibikhuluReceivables.organizationId, orgId));
    const [settled] = await tdb.select({
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
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(settlements)
      .where(eq(settlements.organizationId, orgId))
      .orderBy(desc(settlements.createdAt));
  }
  async createSettlement(settlement: InsertSettlement): Promise<Settlement> {
    const tdb = await getDbForOrg(settlement.organizationId);
    const [created] = await tdb.insert(settlements).values(settlement).returning();
    return created;
  }
  async updateSettlement(id: string, data: Partial<InsertSettlement>, orgId: string): Promise<Settlement | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(settlements).set(data).where(eq(settlements.id, id)).returning();
    return updated;
  }

  // ─── Cost Sheets ────────────────────────────────────────
  async getCostSheetsByOrg(orgId: string): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(costSheets)
      .where(eq(costSheets.organizationId, orgId))
      .orderBy(desc(costSheets.createdAt));
  }
  async getCostSheet(id: string, orgId: string): Promise<any> {
    const tdb = await getDbForOrg(orgId);
    const [cs] = await tdb.select().from(costSheets).where(eq(costSheets.id, id));
    return cs;
  }
  async createCostSheet(data: any): Promise<any> {
    const orgId = data.organizationId;
    if (orgId) {
      const tdb = await getDbForOrg(orgId);
      const [created] = await tdb.insert(costSheets).values(data).returning();
      return created;
    }
    const [created] = await db.insert(costSheets).values(data).returning();
    return created;
  }
  async getCostLineItems(costSheetId: string, orgId: string): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(costLineItems).where(eq(costLineItems.costSheetId, costSheetId));
  }
  async createCostLineItem(data: any): Promise<any> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [cs] = await tdb.select().from(costSheets).where(eq(costSheets.id, data.costSheetId)).limit(1);
      if (cs) {
        const [created] = await tdb.insert(costLineItems).values(data).returning();
        return created;
      }
    }
    const [created] = await db.insert(costLineItems).values(data).returning();
    return created;
  }
}

/** Find a policy by id when orgId is unknown (e.g. public policy document URL). Tries each org's DB. */
export async function findPolicyById(policyId: string): Promise<Policy | undefined> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const org of orgs) {
    const policy = await (await getDbForOrg(org.id)).select().from(policies).where(eq(policies.id, policyId)).limit(1).then((r) => r[0]);
    if (policy) return policy;
  }
  return undefined;
}

/** Find a payment receipt by id when orgId is unknown. Tries each org's DB. */
export async function findPaymentReceiptById(receiptId: string): Promise<PaymentReceipt | undefined> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const org of orgs) {
    const [receipt] = await (await getDbForOrg(org.id)).select().from(paymentReceipts).where(eq(paymentReceipts.id, receiptId)).limit(1);
    if (receipt) return receipt;
  }
  return undefined;
}

/** Find a payment intent by id when orgId is unknown. Tries each org's DB. */
export async function findPaymentIntentById(intentId: string): Promise<PaymentIntent | undefined> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const org of orgs) {
    const [intent] = await (await getDbForOrg(org.id)).select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
    if (intent) return intent;
  }
  return undefined;
}

export const storage = new DatabaseStorage();
