import { eq, and, asc, desc, sql, count, sum, max, gte, lte, gt, inArray, or, ilike, isNull, exists, getTableColumns, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db";
import { getDbForOrg, withOrgTransaction, resolveUserIdForOrgDatabase, ensureRegistryUserMirroredToOrgDataDb, orgUsesDedicatedDatabase, type OrgDataDb } from "./tenant-db";
import { PLATFORM_SUPERUSER_EMAIL } from "./constants";
import { structuredLog } from "./logger";
import { cpDb } from "./control-plane-db";
import { tenantBranding as cpTenantBranding } from "../shared/control-plane-schema";
import { normalizeNationalId } from "../shared/validation";
import { todayInHarare } from "./date-utils";
import {
  organizations, branches, users, roles, permissions, rolePermissions,
  userRoles, userPermissionOverrides, auditLogs, clients, clientDocuments, dependents,
  products, productVersions, benefitCatalogItems, benefitBundles, addOns,
  policyDocuments, waitingPeriodWaivers,
  ageBandConfigs, policies, policyMembers, policyStatusHistory, policyAddOns,
  orgMemberSequences, orgPolicySequences,
  paymentTransactions, receipts, reversalEntries, cashups,
  paymentIntents, paymentEvents, paymentReceipts, paymentLinks, paymentLinkTokens,
  claims, claimDocuments, claimStatusHistory,
  funeralCases, funeralTasks, fleetVehicles, driverAssignments,
  partnerParlours, parlourPersonnel,
  mortuaryIntakes, mortuaryDispatches, deceasedBelongings, bodyWashRequirements, driverChecklists,
  mortuaryPostMortemMovements, partnerParlourVehicleUsage, dailyReportNotes,
  mortuaryServiceRates, caseServiceCharges,
  cemeteries, equipmentItems, pitchingAssignments, pitchingAssignmentStaff, pitchingAssignmentEquipment,
  fleetFuelLogs, fleetMaintenance, priceBookItems, costSheets, costLineItems,
  commissionPlans, commissionLedgerEntries, platformReceivables, settlements, platformFeeCredits,
  payrollEmployees, payrollRuns, payslips, attendanceLogs, attendanceQrCodes, attendanceScans,
  vehicleLocationPings, vehicleAlerts,
  notificationTemplates, notificationLogs, leads, expenditures,
  approvalRequests, dependentChangeRequests, securityQuestions,
  productBenefitBundleLinks, groups, groupMembers, groupContributions, groupPoolPayouts, settlementAllocations, termsAndConditions,
  accumulationAccounts, accumulationContributions, accumulationWithdrawals,
  clientFeedback,
  fxRates, requisitions, requisitionItems, paymentDisbursements,
  bankAccounts, safes, bankDeposits, bankStatementBalances, balanceSheetEntries, debitOrders, funeralQuotations, funeralQuotationItems, serviceReceipts,
  quotationGuarantors, quotationCollateral, receiptAdverts, reminders, agentContentPosts,
  policyCreditBalances, policyPremiumChanges, creditNotes, monthEndRuns, groupPaymentIntents, groupPaymentAllocations,
  clientDeviceTokens, clientPaymentMethods, paymentAutomationSettings, paymentAutomationRuns,
  userNotifications, userDeviceTokens,
  type Reminder, type InsertReminder,
  type FxRate, type InsertFxRate,
  type MortuaryServiceRate, type InsertMortuaryServiceRate,
  type CaseServiceCharge, type InsertCaseServiceCharge,
  type Cemetery, type InsertCemetery,
  type EquipmentItem, type InsertEquipmentItem,
  type PitchingAssignment, type InsertPitchingAssignment,
  type Requisition, type InsertRequisition,
  type RequisitionItem, type InsertRequisitionItem,
  type PaymentDisbursement, type InsertPaymentDisbursement,
  type BankAccount, type InsertBankAccount,
  type Safe, type InsertSafe,
  type BankDeposit, type InsertBankDeposit,
  type BankStatementBalance, type InsertBankStatementBalance,
  type ParlourPersonnel, type InsertParlourPersonnel,
  type BalanceSheetEntry, type InsertBalanceSheetEntry,
  type DebitOrder, type InsertDebitOrder,
  type FuneralQuotation, type InsertFuneralQuotation, type FuneralQuotationItem, type InsertFuneralQuotationItem,
  type QuotationGuarantor, type InsertQuotationGuarantor,
  type QuotationCollateralItem, type InsertQuotationCollateralItem,
  type ServiceReceipt, type InsertServiceReceipt,
  type GroupPaymentIntent, type InsertGroupPaymentIntent,
  type GroupPaymentAllocation, type InsertGroupPaymentAllocation,
  type PolicyCreditBalance, type CreditNote, type MonthEndRun,
  type InsertPolicyCreditBalance, type InsertCreditNote, type InsertMonthEndRun,
  type PolicyPremiumChange, type InsertPolicyPremiumChange,
  type Organization, type InsertOrganization,
  type Branch, type InsertBranch,
  type User, type InsertUser,
  type Role, type InsertRole,
  type Permission, type InsertPermission,
  type AuditLog, type InsertAuditLog,
  type Client, type InsertClient,
  type ClientDocument, type InsertClientDocument,
  type PolicyDocument, type InsertPolicyDocument,
  type WaitingPeriodWaiver, type InsertWaiver,
  type ClientPaymentMethod, type InsertClientPaymentMethod,
  type PaymentAutomationSettings, type InsertPaymentAutomationSettings,
  type PaymentAutomationRun, type InsertPaymentAutomationRun,
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
  type PaymentLink, type InsertPaymentLink,
  type PaymentReceipt, type InsertPaymentReceipt,
  type Claim, type InsertClaim,
  type ClaimDocument, type InsertClaimDocument,
  type FuneralCase, type InsertFuneralCase,
  type FuneralTask, type InsertFuneralTask,
  type FleetVehicle, type InsertFleetVehicle,
  type PartnerParlour, type InsertPartnerParlour,
  type MortuaryIntake, type InsertMortuaryIntake,
  type MortuaryDispatch, type InsertMortuaryDispatch,
  type DeceasedBelonging, type InsertDeceasedBelonging,
  type BodyWashRequirement, type InsertBodyWashRequirement,
  type MortuaryPostMortemMovement, type InsertMortuaryPostMortemMovement,
  type DailyReportNote, type InsertDailyReportNote,
  type PartnerParlourVehicleUsage, type InsertPartnerParlourVehicleUsage,
  type DriverChecklist, type InsertDriverChecklist,
  type CommissionPlan, type InsertCommissionPlan,
  type CommissionLedgerEntry, type InsertCommissionLedgerEntry,
  type NotificationTemplate, type InsertNotificationTemplate,
  type NotificationLog,
  type Lead, type InsertLead,
  type Expenditure, type InsertExpenditure,
  type PriceBookItem, type InsertPriceBookItem,
  type ApprovalRequest, type InsertApprovalRequest,
  type PayrollEmployee, type InsertPayrollEmployee,
  type PayrollRun, type InsertPayrollRun,
  type Payslip, type InsertPayslip,
  type AttendanceLog, type InsertAttendanceLog,
  type AttendanceQrCode, type InsertAttendanceQrCode,
  type AttendanceScan, type InsertAttendanceScan,
  type DriverAssignment, type InsertDriverAssignment,
  type VehicleLocationPing, type InsertVehicleLocationPing,
  type VehicleAlert, type InsertVehicleAlert,
  type Cashup, type InsertCashup,
  vehicleTripLogs,
  type VehicleTripLog, type InsertVehicleTripLog,
  type Group, type InsertGroup,
  type GroupMember, type InsertGroupMember,
  type GroupContribution, type InsertGroupContribution,
  type GroupPoolPayout, type InsertGroupPoolPayout,
  type AccumulationAccount, type InsertAccumulationAccount,
  type AccumulationContribution, type InsertAccumulationContribution,
  type AccumulationWithdrawal, type InsertAccumulationWithdrawal,
  type PlatformReceivable, type InsertPlatformReceivable,
  type Settlement, type InsertSettlement,
  type TermsAndConditions, type InsertTerms,
  type ClientFeedback, type InsertClientFeedback,
  directoryContacts,
  type DirectoryContact, type InsertDirectoryContact,
  type ReceiptAdvert, type InsertReceiptAdvert,
  type AgentContentPost, type InsertAgentContentPost,
  memberCardSettings,
  type MemberCardSettings, type InsertMemberCardSettings,
  countryFlagSettings,
  type CountryFlagSettings, type InsertCountryFlagSettings,
  type UserNotification, type InsertUserNotification,
  type UserDeviceToken,
} from "@shared/schema";

/** Drizzle handle for this org's data database (shared `DATABASE_URL` pool or isolated tenant Postgres). */
export type OrgDrizzleDb = Awaited<ReturnType<typeof getDbForOrg>>;

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
  branchId?: string;
  productId?: string;
  agentId?: string;
}

export interface PolicyReportRow {
  policyId: string;
  policyNumber: string;
  status: string;
  currency: string;
  premiumAmount: string;
  paymentSchedule: string;
  effectiveDate: string | null;
  /** Issue date: set when first payment is received. */
  inceptionDate: string | null;
  waitingPeriodEndDate: string | null;
  currentCycleStart: string | null;
  currentCycleEnd: string | null;
  graceEndDate: string | null;
  policyCreatedAt: string;
  clientId: string;
  clientTitle: string | null;
  clientFirstName: string;
  clientLastName: string;
  clientNationalId: string | null;
  clientDateOfBirth: string | null;
  clientGender: string | null;
  clientMaritalStatus: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  clientPreferredCommMethod: string | null;
  clientLocation: string | null;
  productName: string | null;
  productCode: string | null;
  coverAmount: string | null;
  coverCurrency: string | null;
  branchName: string | null;
  /** Group or company name when policy belongs to a group. */
  groupName: string | null;
  agentEmail: string | null;
  agentDisplayName: string | null;
  /** From product version; used for finance report. */
  gracePeriodDays: number | null;
  beneficiaryFirstName: string | null;
  beneficiaryLastName: string | null;
  beneficiaryRelationship: string | null;
  beneficiaryNationalId: string | null;
  beneficiaryPhone: string | null;
  memberNumber: string | null;
  dependents?: { firstName: string; lastName: string; nationalId: string | null; dateOfBirth: string | null; gender: string | null; relationship: string }[];
}

export interface FinanceReportRow extends PolicyReportRow {
  /** Last payment (receipt) date. */
  datePaid: string | null;
  /** Current cycle end = next due date. */
  dueDate: string | null;
  /** Number of receipts (payments) for this policy. */
  receiptCount: number;
  /** Months paid (same as receipt count when one receipt per period). */
  monthsPaid: number;
  /** Grace period days used (e.g. days into grace). */
  graceDaysUsed: number;
  /** Grace period days remaining until lapse. */
  graceDaysRemaining: number | null;
  /** Estimated outstanding premium (one period if due date passed). */
  outstandingPremium: string;
  /** Advance (overpayment) amount. */
  advancePremium: string;
}

export interface UnderwriterPayableRow {
  policyId: string;
  policyNumber: string;
  status: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  clientNationalId: string | null;
  productName: string | null;
  productCode: string | null;
  branchName: string | null;
  adults: number;
  children: number;
  underwriterAmountAdult: string | null;
  underwriterAmountChild: string | null;
  underwriterAdvanceMonths: number;
  monthlyPayable: number;
  totalPayable: number;
}

export interface UnderwriterPayableReportResult {
  rows: UnderwriterPayableRow[];
  summary: { totalMonthlyPayable: number; totalPayableIncludingAdvance: number; policyCount: number };
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

export interface ConversionEntry {
  policyId: string;
  policyNumber: string;
  clientId: string | null;
  clientName: string;
  convertedAt: Date;
  reason: string | null;
  currentStatus: string;
}

/** One roster member + their historical contributions, for formalizing an existing informal
 *  burial society/cash club in one atomic import — see storage.bulkImportGroupMembers. */
export interface BulkImportGroupMemberRow {
  fullName: string;
  memberNumber?: string;
  joinedDate?: string;
  contributions?: { amount: string; currency: string; contributionDate: string; notes?: string }[];
}

export interface IStorage {
  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizations(): Promise<Organization[]>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined>;
  getBranch(id: string, organizationId: string): Promise<Branch | undefined>;
  getBranchesByOrg(organizationId: string): Promise<Branch[]>;
  createBranch(branch: InsertBranch): Promise<Branch>;
  updateBranch(id: string, organizationId: string, data: Partial<InsertBranch>): Promise<Branch | undefined>;
  getHeadOfficeBranch(organizationId: string): Promise<Branch | undefined>;
  getCountryFlagSettings(orgId: string): Promise<CountryFlagSettings>;
  upsertCountryFlagSettings(orgId: string, data: Partial<InsertCountryFlagSettings>): Promise<CountryFlagSettings>;
  getUser(id: string, organizationId?: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  getUsersByIds(ids: string[], organizationId?: string): Promise<User[]>;
  getUsersByOrg(organizationId: string, limit?: number, offset?: number): Promise<User[]>;
  getUsersWithPermission(organizationId: string, permission: string): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  getPoliciesByAgent(agentId: string, orgId: string): Promise<Policy[]>;
  reassignAgentPolicies(fromAgentId: string, toAgentId: string, orgId: string): Promise<number>;
  getRole(id: string, organizationId: string): Promise<Role | undefined>;
  getRolesByIds(roleIds: string[], organizationId: string): Promise<Role[]>;
  getRolesByOrg(organizationId: string): Promise<Role[]>;
  getRoleByName(name: string, organizationId: string): Promise<Role | undefined>;
  createRole(role: InsertRole): Promise<Role>;
  getPermissions(): Promise<Permission[]>;
  createPermission(perm: InsertPermission): Promise<Permission>;
  getRolePermissions(roleId: string, organizationId: string): Promise<Permission[]>;
  addRolePermission(roleId: string, permissionId: string, orgId: string): Promise<void>;
  removeRolePermission(roleId: string, permissionId: string, orgId: string): Promise<void>;
  clearRolePermissions(roleId: string, orgId: string): Promise<void>;
  getUserRoles(userId: string, organizationId: string): Promise<(Role & { branchId: string | null })[]>;
  getUserRolesBatch(userIds: string[], organizationId: string): Promise<Record<string, (Role & { branchId: string | null })[]>>;
  addUserRole(userId: string, roleId: string, orgId: string, branchId?: string): Promise<void>;
  removeUserRole(userId: string, roleId: string): Promise<void>;
  clearUserRoles(userId: string, organizationId?: string): Promise<void>;
  getUserPermissionOverrides(userId: string): Promise<{ permissionName: string; isGranted: boolean }[]>;
  setUserPermissionOverride(userId: string, permissionName: string, isGranted: boolean): Promise<void>;
  removeUserPermissionOverride(userId: string, permissionName: string): Promise<void>;
  getUserEffectivePermissions(userId: string, orgId?: string | null): Promise<string[]>;
  getAuditLogs(organizationId: string, limit?: number, offset?: number, filters?: { search?: string; action?: string; from?: string; to?: string }): Promise<{ rows: AuditLog[]; total: number }>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getClientsByOrg(organizationId: string, limit?: number, offset?: number, search?: string): Promise<Client[]>;
  getClientsByAgent(agentId: string, organizationId: string, limit?: number, offset?: number, search?: string): Promise<Client[]>;
  /** Returns true if the given agent has access to the client via a policy, lead, or direct assignment. */
  isClientAccessibleByAgent(agentId: string, clientId: string, organizationId: string): Promise<boolean>;
  getClient(id: string, orgId: string): Promise<Client | undefined>;
  getClientByActivationCode(code: string, orgId: string): Promise<Client | undefined>;
  /** Find first client in org by email (case-insensitive). */
  getClientByEmail(orgId: string, email: string): Promise<Client | undefined>;
  /** Find first client in org by national ID (exact match). */
  getClientByNationalId(orgId: string, nationalId: string): Promise<Client | undefined>;
  /** Find first client in org by phone (normalized digits match). */
  getClientByPhone(orgId: string, phone: string): Promise<Client | undefined>;
  /** Return IDs of clients matching a search term (name, email, phone, nationalId). */
  getClientIdsByOrgSearch(organizationId: string, search: string): Promise<string[]>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>, orgId: string): Promise<Client | undefined>;
  getClientDocuments(clientId: string, orgId: string): Promise<ClientDocument[]>;
  createClientDocument(doc: InsertClientDocument): Promise<ClientDocument>;
  deleteClientDocument(id: string, orgId: string): Promise<void>;
  verifyClientDocument(id: string, orgId: string, data: { verificationStatus: "verified" | "rejected"; verifiedBy: string; rejectionReason?: string | null }): Promise<ClientDocument | undefined>;
  getPolicyDocuments(policyId: string, orgId: string): Promise<PolicyDocument[]>;
  createPolicyDocument(doc: InsertPolicyDocument): Promise<PolicyDocument>;
  deletePolicyDocument(id: string, orgId: string): Promise<void>;
  createWaiverRequest(data: InsertWaiver): Promise<WaitingPeriodWaiver>;
  getWaiverForPolicy(policyId: string, orgId: string): Promise<WaitingPeriodWaiver | undefined>;
  getWaiverById(id: string, orgId: string): Promise<WaitingPeriodWaiver | undefined>;
  updateWaiver(id: string, data: Partial<WaitingPeriodWaiver>, orgId: string): Promise<WaitingPeriodWaiver>;
  getAllWaivers(orgId: string): Promise<WaitingPeriodWaiver[]>;
  getDependentsByClient(clientId: string, orgId: string): Promise<Dependent[]>;
  getDependent(id: string, orgId: string): Promise<Dependent | undefined>;
  createDependent(dep: InsertDependent): Promise<Dependent>;
  updateDependent(id: string, data: Partial<InsertDependent>, orgId: string): Promise<Dependent | undefined>;
  deleteDependent(id: string, orgId: string): Promise<void>;
  getProductsByOrg(organizationId: string): Promise<Product[]>;
  getProduct(id: string, orgId: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, data: Partial<InsertProduct>, orgId: string): Promise<Product | undefined>;
  deleteProduct(id: string, orgId: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  getProductVersions(productId: string, orgId: string): Promise<ProductVersion[]>;
  getProductVersion(id: string, orgId: string): Promise<ProductVersion | undefined>;
  createProductVersion(pv: InsertProductVersion): Promise<ProductVersion>;
  updateProductVersion(id: string, data: Partial<InsertProductVersion>, orgId: string): Promise<ProductVersion | undefined>;
  getBenefitCatalogItems(orgId: string): Promise<BenefitCatalogItem[]>;
  createBenefitCatalogItem(item: InsertBenefitCatalogItem): Promise<BenefitCatalogItem>;
  getBenefitBundles(orgId: string): Promise<BenefitBundle[]>;
  createBenefitBundle(bundle: InsertBenefitBundle): Promise<BenefitBundle>;
  getAddOns(orgId: string): Promise<AddOn[]>;
  createAddOn(addon: InsertAddOn): Promise<AddOn>;
  updateAddOn(id: string, data: Partial<InsertAddOn>, orgId: string): Promise<AddOn | undefined>;
  updateBenefitCatalogItem(id: string, data: Partial<InsertBenefitCatalogItem>, orgId: string): Promise<BenefitCatalogItem | undefined>;
  updateBenefitBundle(id: string, data: Partial<InsertBenefitBundle>, orgId: string): Promise<BenefitBundle | undefined>;
  getAgeBandConfigs(orgId: string): Promise<AgeBandConfig[]>;
  createAgeBandConfig(config: InsertAgeBandConfig): Promise<AgeBandConfig>;
  updateAgeBandConfig(id: string, data: Partial<InsertAgeBandConfig>, orgId: string): Promise<AgeBandConfig | undefined>;
  getPoliciesByOrg(organizationId: string, limit?: number, offset?: number, filters?: ReportFilters & { status?: string; statuses?: string[]; search?: string }): Promise<Policy[]>;
  /** Policy report rows with client, product, branch, agent details for reports/export. */
  getPolicyReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<PolicyReportRow[]>;
  /** All-policies report: 45-column spreadsheet export matching the standard template. */
  getAllPoliciesReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]>;
  /** Policies captured in date range (all statuses / paid or unpaid) with spreadsheet-style columns for new joinings. */
  getNewJoiningsReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]>;
  /**
   * Policies registered (created) in the period that also have at least one issued receipt in the same period.
   * Requires fromDate and toDate on filters; otherwise returns an empty list.
   */
  getAgentProductivityReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]>;
  getFinanceReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<FinanceReportRow[]>;
  getUnderwriterPayableReport(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<UnderwriterPayableReportResult>;
  getPoliciesByClient(clientId: string, orgId: string): Promise<Policy[]>;
  getPoliciesByAgent(agentId: string, orgId: string): Promise<Policy[]>;
  getPolicy(id: string, orgId: string): Promise<Policy | undefined>;
  getPoliciesByProductVersion(productVersionId: string, orgId: string): Promise<Policy[]>;
  getPoliciesByIds(ids: string[], orgId: string): Promise<Policy[]>;
  getPolicyByNumber(policyNumber: string, orgId: string): Promise<Policy | undefined>;
  updatePolicy(id: string, data: Partial<InsertPolicy>, orgId: string): Promise<Policy | undefined>;
  /**
   * Single transaction: policy row, status history, members (with org member numbers), and add-ons.
   */
  createPolicyWithInitialSetup(
    orgId: string,
    data: {
      policy: InsertPolicy;
      statusHistory: { fromStatus: string | null; toStatus: string; reason?: string; changedBy?: string | null };
      members: Array<{ clientId?: string | null; dependentId?: string | null; role: string }>;
      // Per-member add-ons. memberRef can be "holder" (→ policy_holder row) or a dependent UUID.
      memberAddOns?: Array<{ memberRef: string; addOnId: string }>;
    },
  ): Promise<{ policy: Policy; members: PolicyMember[] }>;
  createPolicyStatusHistory(policyId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string, organizationId?: string): Promise<void>;
  getReinstatementHistory(organizationId: string, filters?: ReportFilters): Promise<ReinstatementEntry[]>;
  getConversionHistory(organizationId: string, filters?: ReportFilters): Promise<ConversionEntry[]>;
  getActivationHistory(organizationId: string, filters?: ReportFilters): Promise<ActivationEntry[]>;
  getPolicyMembers(policyId: string, orgId: string): Promise<PolicyMember[]>;
  getPolicyMembersBatch(policyIds: string[], orgId: string): Promise<Record<string, PolicyMember[]>>;
  countCoveredLives(orgId: string): Promise<{ coveredLives: number; activePolicyCount: number }>;
  createPolicyMember(member: InsertPolicyMember): Promise<PolicyMember>;
  getPolicyAddOns(policyId: string, orgId: string): Promise<PolicyAddOn[]>;
  /** Replace all add-ons for a specific policy member (or policy-level when memberId is null). */
  setMemberAddOns(policyId: string, policyMemberId: string | null, addOnIds: string[], orgId: string): Promise<void>;
  addPolicyAddOns(policyId: string, addOnIds: string[], orgId: string): Promise<void>;
  createPaymentTransaction(tx: InsertPaymentTransaction): Promise<PaymentTransaction>;
  getPaymentsByPolicy(policyId: string, orgId: string): Promise<PaymentTransaction[]>;
  getPaymentsByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters, agentId?: string): Promise<(PaymentTransaction & { policyNumber: string | null })[]>;
  /** True totals for the Finance page KPI tiles — unlike getPaymentsByOrg, not capped by page size, and cleared totals are grouped per currency rather than blindly summed together. */
  getPaymentsSummary(orgId: string, filters?: ReportFilters, agentId?: string): Promise<{ totalCount: number; clearedByCurrency: { currency: string; count: number; total: string }[] }>;
  getPaymentTransaction(id: string, orgId: string): Promise<PaymentTransaction | undefined>;
  /** True if a platform receivable already exists for this payment transaction (idempotent outbox retries). */
  hasPlatformReceivableForTransaction(orgId: string, transactionId: string): Promise<boolean>;
  /** True if a platform receivable already exists for this service receipt (idempotent outbox retries). */
  hasPlatformReceivableForServiceReceipt(orgId: string, serviceReceiptId: string): Promise<boolean>;
  /** True if any commission ledger row references this payment transaction. */
  hasCommissionLedgerForTransaction(orgId: string, transactionId: string): Promise<boolean>;
  getPaymentTransactionByIdempotencyKey(key: string, orgId: string): Promise<PaymentTransaction | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  getReceiptsByPolicy(policyId: string, orgId: string): Promise<Receipt[]>;
  getNextReceiptNumber(orgId: string): Promise<string>;
  getReceiptReportByOrg(orgId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]>;
  getPaymentIntentById(id: string, orgId: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentByOrgAndIdempotencyKey(orgId: string, idempotencyKey: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentByMerchantReference(orgId: string, merchantReference: string): Promise<PaymentIntent | undefined>;
  getPaymentIntentsByOrg(orgId: string, limit?: number, agentId?: string): Promise<(PaymentIntent & { policyNumber: string | null })[]>;
  getPaymentIntentsByClient(clientId: string, orgId: string): Promise<PaymentIntent[]>;
  getPaymentIntentsByPolicy(policyId: string, orgId: string): Promise<PaymentIntent[]>;
  createPaymentIntent(intent: InsertPaymentIntent): Promise<PaymentIntent>;
  updatePaymentIntent(id: string, data: Partial<InsertPaymentIntent>, orgId: string): Promise<PaymentIntent | undefined>;
  /** Creates the tenant-DB payment_links row AND the central token->org routing pointer. */
  createPaymentLink(link: InsertPaymentLink): Promise<PaymentLink>;
  /** Central-DB lookup only — resolves which org a /pay/:token belongs to, before any tenant DB can be reached. */
  resolveOrgIdForPaymentLinkToken(token: string): Promise<string | undefined>;
  getPaymentLinkByToken(token: string, orgId: string): Promise<PaymentLink | undefined>;
  getPaymentLinksByPolicy(policyId: string, orgId: string): Promise<PaymentLink[]>;
  updatePaymentLink(id: string, data: Partial<InsertPaymentLink>, orgId: string): Promise<PaymentLink | undefined>;
  createPaymentEvent(event: InsertPaymentEvent): Promise<PaymentEvent>;
  getPaymentEventsByIntentId(paymentIntentId: string, orgId: string): Promise<PaymentEvent[]>;
  createPaymentReceipt(receipt: InsertPaymentReceipt): Promise<PaymentReceipt>;
  getPaymentReceiptById(id: string, orgId: string): Promise<PaymentReceipt | undefined>;
  getPaymentReceiptsByPolicy(policyId: string, orgId: string): Promise<PaymentReceipt[]>;
  getPaymentReceiptsByClient(clientId: string, orgId: string): Promise<PaymentReceipt[]>;
  /** Next receipt # in its own short transaction (use `allocatePaymentReceiptNumberInTx` when already inside `withOrgTransaction`). */
  getNextPaymentReceiptNumber(orgId: string): Promise<string>;
  /** Bump `org_policy_sequences.payment_receipt_next` on the same connection as `tx` (participates in outer BEGIN/COMMIT). */
  allocatePaymentReceiptNumberInTx(tx: OrgDrizzleDb, orgId: string): Promise<string>;
  updatePaymentReceipt(id: string, data: Partial<InsertPaymentReceipt>, orgId: string): Promise<PaymentReceipt | undefined>;
  updatePaymentTransaction(id: string, data: Partial<InsertPaymentTransaction>, orgId: string): Promise<PaymentTransaction | undefined>;
  deletePolicy(id: string, orgId: string): Promise<void>;
  deletePaymentTransaction(id: string, orgId: string): Promise<void>;
  deleteReceipt(id: string, orgId: string): Promise<void>;
  deletePaymentReceipt(id: string, orgId: string): Promise<void>;
  getClaimsByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<(Claim & { funeralCaseId: string | null; funeralCaseNumber: string | null })[]>;
  getClaimsReportByOrg(orgId: string, limit: number, offset: number, filters?: ReportFilters & { status?: string }): Promise<any[]>;
  getClaimsByPolicy(policyId: string, orgId: string): Promise<Claim[]>;
  getClaimsByClient(clientId: string, orgId: string): Promise<Claim[]>;
  getClaim(id: string, orgId: string): Promise<Claim | undefined>;
  createClaim(claim: InsertClaim): Promise<Claim>;
  updateClaim(id: string, data: Partial<InsertClaim>, orgId: string): Promise<Claim | undefined>;
  createClaimStatusHistory(claimId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string, orgId?: string): Promise<void>;
  getClaimDocuments(claimId: string, orgId: string): Promise<ClaimDocument[]>;
  createClaimDocument(doc: InsertClaimDocument, orgId: string): Promise<ClaimDocument>;
  getFeedbackByClient(clientId: string, orgId: string): Promise<ClientFeedback[]>;
  createFeedback(feedback: InsertClientFeedback): Promise<ClientFeedback>;
  getFeedbackByOrg(orgId: string, limit?: number, offset?: number, filters?: { search?: string; status?: string; type?: string }): Promise<{ rows: ClientFeedback[]; total: number }>;
  updateFeedbackStatus(id: string, status: string, orgId: string): Promise<ClientFeedback | undefined>;
  getFuneralCasesByOrg(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<FuneralCase[]>;
  getFuneralCase(id: string, orgId: string): Promise<FuneralCase | undefined>;
  getFuneralCaseByCaseNumber(caseNumber: string, orgId: string): Promise<FuneralCase | undefined>;
  createFuneralCase(fc: InsertFuneralCase): Promise<FuneralCase>;
  updateFuneralCase(id: string, data: Partial<InsertFuneralCase>, orgId: string): Promise<FuneralCase | undefined>;
  getFuneralTasks(caseId: string, orgId: string): Promise<FuneralTask[]>;
  createFuneralTask(task: InsertFuneralTask): Promise<FuneralTask>;
  updateFuneralTask(id: string, data: Partial<InsertFuneralTask>, orgId: string): Promise<FuneralTask | undefined>;
  getFleetVehicles(orgId: string): Promise<FleetVehicle[]>;
  getFleetVehicleById(id: string, orgId: string): Promise<FleetVehicle | undefined>;
  createFleetVehicle(vehicle: InsertFleetVehicle): Promise<FleetVehicle>;
  updateFleetVehicle(id: string, data: Partial<InsertFleetVehicle>, orgId: string): Promise<FleetVehicle | undefined>;
  getFuelLogs(orgId: string, vehicleId?: string): Promise<any[]>;
  getMaintenanceRecords(orgId: string, vehicleId?: string): Promise<any[]>;
  getDriverAssignments(orgId: string): Promise<any[]>;
  getCommissionPlans(orgId: string): Promise<CommissionPlan[]>;
  createCommissionPlan(plan: InsertCommissionPlan): Promise<CommissionPlan>;
  getCommissionLedgerByAgent(agentId: string, orgId: string): Promise<CommissionLedgerEntry[]>;
  getCommissionLedgerByOrg(orgId: string): Promise<CommissionLedgerEntry[]>;
  getCommissionLedgerDetailedByOrg(orgId: string, agentId?: string): Promise<any[]>;
  /** Per-agent commission totals for payroll-style report (uses ledger entry types + policy group / payment method). */
  getCommissionReportByOrg(orgId: string, filters?: ReportFilters): Promise<any[]>;
  getCommissionPaymentReportByOrg(orgId: string, limit: number, offset: number, filters?: ReportFilters & { agentId?: string }): Promise<any[]>;
  getCommissionEntriesByPolicy(policyId: string, orgId: string): Promise<CommissionLedgerEntry[]>;
  createCommissionLedgerEntry(entry: InsertCommissionLedgerEntry): Promise<CommissionLedgerEntry>;
  getNotificationTemplates(orgId: string): Promise<NotificationTemplate[]>;
  createNotificationTemplate(tmpl: InsertNotificationTemplate): Promise<NotificationTemplate>;
  createNotificationLog(orgId: string, data: { recipientType: string; recipientId: string | null; channel: string; subject?: string | null; body?: string | null; templateId?: string | null; policyId?: string | null; status?: string }): Promise<NotificationLog>;
  getLeadsByOrg(orgId: string, limit?: number, offset?: number): Promise<Lead[]>;
  getLeadsByAgent(agentId: string, orgId: string): Promise<Lead[]>;
  getLead(id: string, orgId: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, data: Partial<InsertLead>, orgId: string): Promise<Lead | undefined>;
  getExpenditures(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<Expenditure[]>;
  getExpenditure(id: string, orgId: string): Promise<Expenditure | undefined>;
  createExpenditure(exp: InsertExpenditure): Promise<Expenditure>;
  updateExpenditure(id: string, orgId: string, data: Partial<Expenditure>): Promise<Expenditure | undefined>;
  getPriceBookItems(orgId: string): Promise<PriceBookItem[]>;
  createPriceBookItem(item: InsertPriceBookItem): Promise<PriceBookItem>;
  updatePriceBookItem(id: string, data: Partial<InsertPriceBookItem>, orgId: string): Promise<PriceBookItem | undefined>;
  getMortuaryServiceRates(orgId: string): Promise<MortuaryServiceRate[]>;
  createMortuaryServiceRate(rate: InsertMortuaryServiceRate): Promise<MortuaryServiceRate>;
  updateMortuaryServiceRate(id: string, data: Partial<InsertMortuaryServiceRate>, orgId: string): Promise<MortuaryServiceRate | undefined>;
  getCaseServiceCharges(funeralCaseId: string, orgId: string): Promise<CaseServiceCharge[]>;
  createCaseServiceCharge(charge: InsertCaseServiceCharge): Promise<CaseServiceCharge>;
  getCemeteries(orgId: string): Promise<Cemetery[]>;
  createCemetery(data: InsertCemetery): Promise<Cemetery>;
  updateCemetery(id: string, data: Partial<InsertCemetery>, orgId: string): Promise<Cemetery | undefined>;
  getEquipmentItems(orgId: string): Promise<EquipmentItem[]>;
  createEquipmentItem(data: InsertEquipmentItem): Promise<EquipmentItem>;
  updateEquipmentItem(id: string, data: Partial<InsertEquipmentItem>, orgId: string): Promise<EquipmentItem | undefined>;
  getApprovalRequests(orgId: string, status?: string): Promise<ApprovalRequest[]>;
  createApprovalRequest(req: InsertApprovalRequest): Promise<ApprovalRequest>;
  getTermsByOrg(orgId: string): Promise<TermsAndConditions[]>;
  getTermsByOrgAll(orgId: string): Promise<TermsAndConditions[]>;
  createTerms(terms: InsertTerms): Promise<TermsAndConditions>;
  updateTerms(id: string, data: Partial<InsertTerms>, orgId: string): Promise<TermsAndConditions | undefined>;
  deleteTerms(id: string, orgId: string): Promise<void>;
  updateApprovalRequest(id: string, data: Partial<InsertApprovalRequest>, orgId: string): Promise<ApprovalRequest | undefined>;
  getAttendanceLogs(orgId: string, filters?: { date?: string; status?: string; employeeId?: string }): Promise<(AttendanceLog & { employee: PayrollEmployee })[]>;
  getAttendanceLogById(id: string, orgId: string): Promise<AttendanceLog | undefined>;
  getMyAttendanceLogs(employeeId: string, orgId: string): Promise<AttendanceLog[]>;
  createAttendanceLog(data: InsertAttendanceLog): Promise<AttendanceLog>;
  updateAttendanceLog(id: string, data: Partial<Pick<AttendanceLog, "status" | "approvedBy" | "approvedAt" | "approvalNotes">>, orgId: string): Promise<AttendanceLog | undefined>;
  getAttendanceLogForDate(employeeId: string, orgId: string, date: string): Promise<AttendanceLog | undefined>;
  correctAttendanceLog(id: string, orgId: string, data: Partial<Pick<AttendanceLog, "notes" | "clockInAt" | "clockOutAt" | "hoursWorked" | "status" | "approvedBy" | "approvedAt" | "approvalNotes">>): Promise<AttendanceLog | undefined>;
  getPayrollEmployeeByUserId(userId: string, orgId: string): Promise<PayrollEmployee | undefined>;
  listAttendanceQrCodes(orgId: string): Promise<AttendanceQrCode[]>;
  getAttendanceQrCodeByToken(token: string, orgId: string): Promise<AttendanceQrCode | undefined>;
  getAttendanceQrCodeById(id: string, orgId: string): Promise<AttendanceQrCode | undefined>;
  createAttendanceQrCode(data: InsertAttendanceQrCode): Promise<AttendanceQrCode>;
  updateAttendanceQrCode(id: string, orgId: string, data: Partial<Pick<AttendanceQrCode, "label" | "branchId" | "isActive" | "latitude" | "longitude" | "geofenceRadiusMeters">>): Promise<AttendanceQrCode | undefined>;
  getDriverAssignmentsForDriverOnDate(driverId: string, orgId: string, dayStart: Date, dayEnd: Date): Promise<DriverAssignment[]>;
  setAttendanceOffSiteFlag(logId: string, orgId: string, eventType: "clock_in" | "clock_out", distanceMeters: number): Promise<AttendanceLog | undefined>;
  dismissAttendanceOffSiteFlag(logId: string, orgId: string, reviewerUserId: string): Promise<AttendanceLog | undefined>;
  createAttendanceScan(data: InsertAttendanceScan): Promise<AttendanceScan>;
  recordAttendanceScan(employeeId: string, orgId: string, qrCodeId: string, lat?: number, lng?: number): Promise<{ log: AttendanceLog; eventType: "clock_in" | "clock_out" }>;
  getActiveDriverAssignment(vehicleId: string, orgId: string): Promise<DriverAssignment | undefined>;
  getDriverAssignmentById(id: string, orgId: string): Promise<DriverAssignment | undefined>;
  getActiveDriverAssignments(orgId: string): Promise<(DriverAssignment & { vehicle: FleetVehicle })[]>;
  createDriverAssignmentRecord(data: InsertDriverAssignment): Promise<DriverAssignment>;
  endDriverAssignment(id: string, orgId: string): Promise<DriverAssignment | undefined>;
  createVehicleLocationPings(pings: InsertVehicleLocationPing[]): Promise<VehicleLocationPing[]>;
  getRecentVehiclePings(assignmentId: string, orgId: string, sinceMinutes: number): Promise<VehicleLocationPing[]>;
  getLatestVehiclePing(assignmentId: string, orgId: string): Promise<VehicleLocationPing | undefined>;
  createVehicleAlert(data: InsertVehicleAlert): Promise<VehicleAlert>;
  getOpenVehicleAlert(assignmentId: string, orgId: string, type: string): Promise<VehicleAlert | undefined>;
  resolveVehicleAlert(id: string, orgId: string): Promise<VehicleAlert | undefined>;
  getPayrollEmployees(orgId: string): Promise<PayrollEmployee[]>;
  createPayrollEmployee(emp: InsertPayrollEmployee): Promise<PayrollEmployee>;
  updatePayrollEmployee(id: string, data: Partial<InsertPayrollEmployee>, orgId: string): Promise<PayrollEmployee | undefined>;
  getPayrollRuns(orgId: string): Promise<PayrollRun[]>;
  createPayrollRun(run: InsertPayrollRun): Promise<PayrollRun>;
  getPayslipsForRun(runId: string, orgId: string): Promise<(Payslip & { employee: PayrollEmployee })[]>;
  upsertPayslip(runId: string, employeeId: string, orgId: string, data: Omit<InsertPayslip, "payrollRunId" | "employeeId">): Promise<Payslip>;
  updatePayrollRunTotals(runId: string, orgId: string): Promise<void>;
  getVehicleTripLogs(orgId: string, filters?: { vehicleId?: string; funeralCaseId?: string }): Promise<VehicleTripLog[]>;
  getVehicleTripLog(id: string, orgId: string): Promise<VehicleTripLog | undefined>;
  createVehicleTripLog(data: InsertVehicleTripLog): Promise<VehicleTripLog>;
  updateVehicleTripLog(id: string, orgId: string, data: Partial<InsertVehicleTripLog>): Promise<VehicleTripLog | undefined>;
  getCashups(orgId: string, limit?: number, filters?: ReportFilters & { preparedBy?: string; status?: string }): Promise<Cashup[]>;
  getCashup(id: string, orgId: string): Promise<Cashup | undefined>;
  createCashup(cashup: InsertCashup): Promise<Cashup>;
  updateCashup(id: string, data: Partial<InsertCashup>, orgId: string): Promise<Cashup | undefined>;
  getReceiptTotalsByUserDate(orgId: string, userId: string, date: string): Promise<{ amountsByMethod: Record<string, string>; transactionCount: number }>;
  getSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]>;
  getOrCreateDefaultSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]>;
  getDashboardStats(orgId: string, filters?: { dateFrom?: string; dateTo?: string; status?: string; branchId?: string }, agentId?: string): Promise<any>;
  generatePolicyNumber(orgId: string): Promise<string>;
  generateClaimNumber(orgId: string): Promise<string>;
  getNextMemberNumber(orgId: string): Promise<string>;
  generateCaseNumber(orgId: string): Promise<string>;
  generateEmployeeNumber(orgId: string): Promise<string>;
  getGroupsByOrg(orgId: string): Promise<Group[]>;
  getGroup(id: string, orgId: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroup(id: string, data: Partial<InsertGroup>, orgId: string): Promise<Group | undefined>;
  getGroupsWhereClientIsExecutive(orgId: string, clientId: string): Promise<Group[]>;
  getPoliciesByGroupId(orgId: string, groupId: string): Promise<Policy[]>;
  // Pool-society engine (Phase 3d) — server/pool-society.ts.
  getGroupMembers(orgId: string, groupId: string): Promise<GroupMember[]>;
  createGroupMember(member: InsertGroupMember): Promise<GroupMember>;
  getGroupContributions(orgId: string, groupId: string): Promise<GroupContribution[]>;
  createGroupContribution(contribution: InsertGroupContribution): Promise<GroupContribution>;
  getGroupPoolPayouts(orgId: string, groupId: string): Promise<GroupPoolPayout[]>;
  getGroupPoolPayout(id: string, orgId: string): Promise<GroupPoolPayout | undefined>;
  createGroupPoolPayout(payout: InsertGroupPoolPayout): Promise<GroupPoolPayout>;
  updateGroupPoolPayout(id: string, data: Partial<InsertGroupPoolPayout>, orgId: string): Promise<GroupPoolPayout | undefined>;
  bulkImportGroupMembers(orgId: string, groupId: string, rows: BulkImportGroupMemberRow[]): Promise<{ membersCreated: number; contributionsCreated: number }>;
  // Accumulation engine (Phase 3e) — server/accumulation.ts.
  generateAccumulationAccountNumber(orgId: string): Promise<string>;
  getAccumulationAccountsByClient(orgId: string, clientId: string): Promise<AccumulationAccount[]>;
  getAccumulationAccount(id: string, orgId: string): Promise<AccumulationAccount | undefined>;
  createAccumulationAccount(account: InsertAccumulationAccount): Promise<AccumulationAccount>;
  updateAccumulationAccount(id: string, data: Partial<InsertAccumulationAccount>, orgId: string): Promise<AccumulationAccount | undefined>;
  getAccumulationContributions(orgId: string, accountId: string): Promise<AccumulationContribution[]>;
  createAccumulationContribution(contribution: InsertAccumulationContribution): Promise<AccumulationContribution>;
  getAccumulationWithdrawals(orgId: string, accountId: string): Promise<AccumulationWithdrawal[]>;
  getAccumulationWithdrawal(id: string, orgId: string): Promise<AccumulationWithdrawal | undefined>;
  createAccumulationWithdrawal(withdrawal: InsertAccumulationWithdrawal): Promise<AccumulationWithdrawal>;
  updateAccumulationWithdrawal(id: string, data: Partial<InsertAccumulationWithdrawal>, orgId: string): Promise<AccumulationWithdrawal | undefined>;
  createGroupPaymentIntent(intent: InsertGroupPaymentIntent): Promise<GroupPaymentIntent>;
  getGroupPaymentIntentById(id: string, orgId: string): Promise<GroupPaymentIntent | undefined>;
  getGroupPaymentIntentByOrgAndIdempotencyKey(orgId: string, key: string): Promise<GroupPaymentIntent | undefined>;
  updateGroupPaymentIntent(id: string, data: Partial<GroupPaymentIntent>, orgId: string): Promise<GroupPaymentIntent | undefined>;
  getGroupPaymentAllocations(intentId: string, orgId: string): Promise<GroupPaymentAllocation[]>;
  getGroupPaymentIntentByMerchantReference(orgId: string, merchantReference: string): Promise<GroupPaymentIntent | undefined>;
  createGroupPaymentAllocations(orgId: string, allocations: InsertGroupPaymentAllocation[]): Promise<void>;
  getOrCreatePolicyCreditBalance(orgId: string, policyId: string, currency: string): Promise<PolicyCreditBalance>;
  addPolicyCreditBalance(orgId: string, policyId: string, amount: string, currency: string): Promise<PolicyCreditBalance | undefined>;
  /** Same as `addPolicyCreditBalance` but runs on a transaction client already inside `withOrgTransaction`, so the credit and the payment that produced it commit atomically. */
  addPolicyCreditBalanceInTx(tx: OrgDrizzleDb, orgId: string, policyId: string, amount: string, currency: string): Promise<void>;
  getPolicyCreditBalance(orgId: string, policyId: string): Promise<PolicyCreditBalance | undefined>;
  getPolicyCreditBalancesWithPositiveBalance(orgId: string): Promise<PolicyCreditBalance[]>;
  deductPolicyCreditBalance(orgId: string, policyId: string, amount: string): Promise<PolicyCreditBalance | undefined>;
  createPolicyPremiumChange(change: InsertPolicyPremiumChange): Promise<PolicyPremiumChange>;
  getPolicyPremiumChanges(orgId: string, policyId: string): Promise<PolicyPremiumChange[]>;
  deactivatePolicyMember(memberId: string, policyId: string, orgId: string): Promise<PolicyMember | undefined>;
  // ── Finance: FX rates, requisitions, funeral quotations, service receipts ──
  getFxRates(orgId: string): Promise<FxRate[]>;
  upsertFxRate(orgId: string, currency: string, rateToUsd: string, updatedBy?: string): Promise<FxRate>;
  getRequisitions(orgId: string, filters?: { status?: string; fromDate?: string; toDate?: string }): Promise<Requisition[]>;
  getRequisition(id: string, orgId: string): Promise<Requisition | undefined>;
  createRequisition(req: InsertRequisition): Promise<Requisition>;
  updateRequisition(id: string, orgId: string, data: Partial<Requisition>): Promise<Requisition | undefined>;
  createRequisitionItems(items: InsertRequisitionItem[]): Promise<RequisitionItem[]>;
  getRequisitionItemsByOrg(orgId: string): Promise<RequisitionItem[]>;
  getRequisitionItemsByIds(requisitionIds: string[], orgId: string): Promise<RequisitionItem[]>;
  createPaymentDisbursement(data: InsertPaymentDisbursement): Promise<PaymentDisbursement>;
  getPaymentDisbursements(orgId: string, filters?: { entityType?: string; entityId?: string; fromDate?: string; toDate?: string; branchId?: string }): Promise<PaymentDisbursement[]>;
  getPaymentDisbursementsByEntity(entityType: string, entityId: string, orgId: string): Promise<PaymentDisbursement[]>;
  getBankAccounts(orgId: string): Promise<BankAccount[]>;
  getBankAccount(id: string, orgId: string): Promise<BankAccount | undefined>;
  createBankAccount(data: InsertBankAccount): Promise<BankAccount>;
  updateBankAccount(id: string, orgId: string, data: Partial<BankAccount>): Promise<BankAccount | undefined>;
  getSafes(orgId: string): Promise<Safe[]>;
  getSafe(id: string, orgId: string): Promise<Safe | undefined>;
  createSafe(data: InsertSafe): Promise<Safe>;
  updateSafe(id: string, orgId: string, data: Partial<Safe>): Promise<Safe | undefined>;
  getBankDeposits(orgId: string, filters?: { userId?: string; bankAccountId?: string; safeId?: string; fromDate?: string; toDate?: string }): Promise<BankDeposit[]>;
  getBankDepositById(id: string, orgId: string): Promise<BankDeposit | undefined>;
  createBankDeposit(data: InsertBankDeposit): Promise<BankDeposit>;
  updateBankDeposit(id: string, orgId: string, data: Partial<BankDeposit>): Promise<BankDeposit | undefined>;
  getBankStatementBalances(orgId: string, bankAccountId?: string): Promise<BankStatementBalance[]>;
  createBankStatementBalance(data: InsertBankStatementBalance): Promise<BankStatementBalance>;
  getAdminCashPosition(orgId: string, asOf?: string): Promise<Array<{ userId: string; totalCollected: number; totalDeposited: number; onHand: number; lastDepositDate: string | null; currency: string }>>;
  getBalanceSheetEntries(orgId: string, filters?: { section?: string; asOfDate?: string }): Promise<BalanceSheetEntry[]>;
  getBalanceSheetEntry(id: string, orgId: string): Promise<BalanceSheetEntry | undefined>;
  createBalanceSheetEntry(data: InsertBalanceSheetEntry): Promise<BalanceSheetEntry>;
  updateBalanceSheetEntry(id: string, orgId: string, data: Partial<BalanceSheetEntry>): Promise<BalanceSheetEntry | undefined>;
  deleteBalanceSheetEntry(id: string, orgId: string): Promise<void>;

  getDebitOrders(orgId: string, filters?: { status?: string; policyId?: string }): Promise<DebitOrder[]>;
  getDebitOrder(id: string, orgId: string): Promise<DebitOrder | undefined>;
  createDebitOrder(order: InsertDebitOrder): Promise<DebitOrder>;
  updateDebitOrder(id: string, orgId: string, data: Partial<DebitOrder>): Promise<DebitOrder | undefined>;
  getFuneralQuotation(funeralCaseId: string, orgId: string): Promise<(FuneralQuotation & { items: FuneralQuotationItem[] }) | undefined>;
  upsertFuneralQuotation(orgId: string, funeralCaseId: string, data: { currency: string; status?: string; notes?: string; createdBy?: string }, items: Omit<InsertFuneralQuotationItem, "quotationId">[]): Promise<FuneralQuotation>;
  deleteFuneralQuotation(id: string, orgId: string): Promise<void>;
  getServiceReceipts(orgId: string, opts?: { funeralCaseId?: string; fromDate?: string; toDate?: string }): Promise<ServiceReceipt[]>;
  getServiceReceiptByIdempotencyKey(orgId: string, idempotencyKey: string): Promise<ServiceReceipt | undefined>;
  createServiceReceipt(receipt: InsertServiceReceipt): Promise<ServiceReceipt>;
  getReceiptAdverts(orgId: string): Promise<ReceiptAdvert[]>;
  getActiveReceiptAdvert(orgId: string): Promise<ReceiptAdvert | null>;
  createReceiptAdvert(data: InsertReceiptAdvert): Promise<ReceiptAdvert>;
  updateReceiptAdvert(id: string, data: Partial<InsertReceiptAdvert>, orgId: string): Promise<ReceiptAdvert | undefined>;
  deleteReceiptAdvert(id: string, orgId: string): Promise<void>;
  setActiveReceiptAdvert(id: string, orgId: string): Promise<void>;
  getAgentContentPosts(orgId: string, activeOnly?: boolean): Promise<AgentContentPost[]>;
  createAgentContentPost(data: InsertAgentContentPost): Promise<AgentContentPost>;
  updateAgentContentPost(id: string, data: Partial<InsertAgentContentPost>, orgId: string): Promise<AgentContentPost | undefined>;
  deleteAgentContentPost(id: string, orgId: string): Promise<void>;
  /** Returns the org's member-card template settings, or the built-in defaults if the org
   *  hasn't configured one yet (Member Card Admin hasn't been saved before). */
  getMemberCardSettings(orgId: string): Promise<MemberCardSettings>;
  upsertMemberCardSettings(orgId: string, data: Partial<InsertMemberCardSettings>): Promise<MemberCardSettings>;
  getClientDeviceTokens(clientId: string, orgId: string): Promise<{ id: string; token: string; platform: string }[]>;
  addClientDeviceToken(orgId: string, clientId: string, token: string, platform: string): Promise<void>;
  removeClientDeviceToken(orgId: string, token: string, clientId?: string): Promise<void>;
  getClientPaymentMethods(clientId: string, orgId: string): Promise<ClientPaymentMethod[]>;
  upsertDefaultClientPaymentMethod(orgId: string, clientId: string, method: InsertClientPaymentMethod): Promise<ClientPaymentMethod>;
  getDefaultClientPaymentMethod(clientId: string, orgId: string): Promise<ClientPaymentMethod | undefined>;
  getPaymentAutomationSettings(orgId: string): Promise<PaymentAutomationSettings | undefined>;
  upsertPaymentAutomationSettings(orgId: string, data: Partial<InsertPaymentAutomationSettings>): Promise<PaymentAutomationSettings>;
  createPaymentAutomationRun(orgId: string, data: InsertPaymentAutomationRun): Promise<PaymentAutomationRun>;
  getPaymentAutomationRuns(orgId: string, limit?: number): Promise<PaymentAutomationRun[]>;
  getNextCreditNoteNumber(orgId: string): Promise<string>;
  createCreditNote(note: InsertCreditNote): Promise<CreditNote>;
  getCreditNotesByClient(clientId: string, orgId: string): Promise<CreditNote[]>;
  getCreditNotesByPolicy(policyId: string, orgId: string): Promise<CreditNote[]>;
  createMonthEndRun(run: InsertMonthEndRun): Promise<MonthEndRun>;
  getMonthEndRunById(id: string, orgId: string): Promise<MonthEndRun | undefined>;
  getNextMonthEndRunNumber(orgId: string): Promise<string>;
  getPlatformReceivables(orgId: string, limit?: number, offset?: number, filters?: ReportFilters): Promise<PlatformReceivable[]>;
  createPlatformReceivable(entry: InsertPlatformReceivable & { createdAt?: Date }): Promise<PlatformReceivable>;
  getPlatformRevenueSummary(orgId: string): Promise<{ totalDue: Record<string, string>; totalSettled: Record<string, string>; outstanding: Record<string, string> }>;
  getSettlements(orgId: string): Promise<Settlement[]>;
  createSettlement(settlement: InsertSettlement): Promise<Settlement>;
  updateSettlement(id: string, data: Partial<InsertSettlement>, orgId: string): Promise<Settlement | undefined>;
  /** Approves a settlement and auto-allocates its amount against the oldest unsettled
   *  platform_receivables (same currency) FIFO, atomically. Returns the updated settlement
   *  plus how much of it was actually allocated (can be less than the settlement amount if
   *  there aren't enough unsettled receivables to absorb it all). */
  approveSettlementWithAllocation(id: string, orgId: string, approvedBy: string): Promise<{ settlement: Settlement; allocated: string; receivablesSettled: number }>;
  getCostSheetsByOrg(orgId: string, filters?: { funeralCaseId?: string }): Promise<any[]>;
  getCostSheet(id: string, orgId: string): Promise<any>;
  createCostSheet(data: any): Promise<any>;
  getCostLineItems(costSheetId: string, orgId: string): Promise<any[]>;
  createCostLineItem(data: any): Promise<any>;
  // ── User notifications (staff/agent) ──
  createUserNotification(data: InsertUserNotification): Promise<UserNotification>;
  getUserNotifications(orgId: string, userId: string, limit?: number, offset?: number): Promise<UserNotification[]>;
  getUnreadUserNotificationCount(orgId: string, userId: string): Promise<number>;
  markUserNotificationRead(id: string, userId: string, orgId: string): Promise<void>;
  markAllUserNotificationsRead(orgId: string, userId: string): Promise<void>;
  // ── User device tokens (staff/agent push) ──
  getUserDeviceTokens(orgId: string, userId: string): Promise<{ id: string; token: string; platform: string }[]>;
  getAllUserDeviceTokensByOrg(orgId: string): Promise<{ id: string; userId: string; token: string; platform: string }[]>;
  upsertUserDeviceToken(orgId: string, userId: string, token: string, platform: string): Promise<void>;
  removeUserDeviceToken(token: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    if (!org) return org;
    try {
      const [branding] = await cpDb.select().from(cpTenantBranding).where(eq(cpTenantBranding.tenantId, id)).limit(1);
      if (branding) {
        return {
          ...org,
          logoUrl: branding.logoUrl ?? org.logoUrl,
          signatureUrl: branding.signatureUrl ?? org.signatureUrl,
          primaryColor: branding.primaryColor ?? org.primaryColor,
          footerText: branding.footerText ?? org.footerText,
          address: branding.address ?? org.address,
          phone: branding.phone ?? org.phone,
          email: branding.email ?? org.email,
          website: branding.website ?? org.website,
          policyNumberPrefix: branding.policyNumberPrefix ?? org.policyNumberPrefix,
          policyNumberPadding: branding.policyNumberPadding ?? org.policyNumberPadding,
          isWhitelabeled: branding.isWhitelabeled ?? org.isWhitelabeled,
        };
      }
    } catch (err) {
      structuredLog("error", "getOrganization: control-plane branding lookup failed, falling back to legacy row", {
        orgId: id, error: (err as Error).message,
      });
    }
    return org;
  }
  async getOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations);
  }
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [created] = await db.insert(organizations).values(org as any).returning();
    return created;
  }
  async updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined> {
    const [updated] = await db.update(organizations).set(data as any).where(eq(organizations.id, id)).returning();
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
  async updateBranch(id: string, organizationId: string, data: Partial<InsertBranch>): Promise<Branch | undefined> {
    if (data.isHeadOffice === true) {
      return withOrgTransaction(organizationId, async (tx) => {
        await tx.update(branches).set({ isHeadOffice: false })
          .where(and(eq(branches.organizationId, organizationId), eq(branches.isHeadOffice, true)));
        const [updated] = await tx.update(branches).set(data)
          .where(and(eq(branches.id, id), eq(branches.organizationId, organizationId)))
          .returning();
        return updated;
      });
    }
    const tdb = await getDbForOrg(organizationId);
    const [updated] = await tdb.update(branches).set(data)
      .where(and(eq(branches.id, id), eq(branches.organizationId, organizationId)))
      .returning();
    return updated;
  }
  async getHeadOfficeBranch(organizationId: string): Promise<Branch | undefined> {
    const tdb = await getDbForOrg(organizationId);
    // Require isActive too — a branch can be flagged isHeadOffice and later deactivated
    // without clearing the flag; treat that as "no head office" rather than silently
    // defaulting new records onto a branch nobody can pick from an active-branch dropdown.
    const [headOffice] = await tdb.select().from(branches)
      .where(and(eq(branches.organizationId, organizationId), eq(branches.isHeadOffice, true), eq(branches.isActive, true)));
    if (headOffice) return headOffice;
    // No (active) branch flagged — fall back to the org's oldest active branch.
    const [fallback] = await tdb.select().from(branches)
      .where(and(eq(branches.organizationId, organizationId), eq(branches.isActive, true)))
      .orderBy(asc(branches.createdAt))
      .limit(1);
    return fallback;
  }
  async getCountryFlagSettings(orgId: string): Promise<CountryFlagSettings> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(countryFlagSettings).where(eq(countryFlagSettings.organizationId, orgId));
    if (row) return row;
    // Not configured — feature defaults to off, matching the column defaults in schema.ts.
    return {
      organizationId: orgId,
      isEnabled: false,
      flagLabel: "South Africa",
      homeLabel: "Zimbabwe",
      updatedAt: new Date(),
    };
  }
  async upsertCountryFlagSettings(orgId: string, data: Partial<InsertCountryFlagSettings>): Promise<CountryFlagSettings> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.insert(countryFlagSettings)
      .values({ ...data, organizationId: orgId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: countryFlagSettings.organizationId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
  async getUser(id: string, organizationId?: string): Promise<User | undefined> {
    if (organizationId) {
      const tdb = await getDbForOrg(organizationId);
      const [user] = await tdb.select().from(users).where(eq(users.id, id)).limit(1);
      if (user) return user;
    }
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
  async getUsersByIds(ids: string[], organizationId?: string): Promise<User[]> {
    if (ids.length === 0) return [];
    if (organizationId) {
      // Tenant-scoped tables (requisitions, disbursements, etc.) can reference a user's
      // tenant-local mirrored id (see resolveOrSyncTenantUserId), which only exists in the
      // dedicated tenant DB, not the shared registry — look there first, then fill in any
      // remaining ids from the registry (e.g. staff who were never mirrored).
      const tdb = await getDbForOrg(organizationId);
      const tenantUsers = await tdb.select().from(users).where(inArray(users.id, ids));
      const foundIds = new Set(tenantUsers.map((u) => u.id));
      const remaining = ids.filter((id) => !foundIds.has(id));
      if (remaining.length === 0) return tenantUsers;
      const registryUsers = await db.select().from(users).where(inArray(users.id, remaining));
      return [...tenantUsers, ...registryUsers];
    }
    return db.select().from(users).where(inArray(users.id, ids));
  }
  async getUsersByOrg(organizationId: string, limit = 500, offset = 0): Promise<User[]> {
    const tdb = await getDbForOrg(organizationId);
    return tdb.select().from(users).where(eq(users.organizationId, organizationId))
      .orderBy(desc(users.createdAt)).limit(limit).offset(offset);
  }
  async getUsersWithPermission(organizationId: string, permission: string): Promise<User[]> {
    const tdb = await getDbForOrg(organizationId);
    // Fetch IDs of users with this permission, then hydrate full rows
    const matched = await tdb
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.organizationId, organizationId)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.name, permission)))
      .where(and(eq(users.organizationId, organizationId), eq(users.isActive, true)));
    if (!matched.length) return [];
    const ids = matched.map((r) => r.id);
    return tdb.select().from(users).where(inArray(users.id, ids));
  }
  async createUser(user: InsertUser): Promise<User> {
    const orgId = user.organizationId;
    // For dedicated-DB orgs, branches live only in the tenant DB — not the shared registry.
    // Storing a tenant branch ID in the shared DB would violate the branches FK constraint.
    // Strip it here; the correct value is written to the tenant DB via the mirror below.
    const isDedicated = orgId ? await orgUsesDedicatedDatabase(orgId) : false;
    const sharedRow = isDedicated ? { ...user, email: user.email.toLowerCase(), branchId: null } : { ...user, email: user.email.toLowerCase() };
    const [created] = await db.insert(users).values(sharedRow).returning();
    if (created.organizationId) {
      try {
        await ensureRegistryUserMirroredToOrgDataDb(created.organizationId, created.id, isDedicated ? (user.branchId ?? null) : undefined);
      } catch (err: any) {
        structuredLog("warn", "mirror user after createUser failed", { orgId: created.organizationId, userId: created.id, error: err?.message || String(err) });
      }
    }
    return created;
  }
  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const orgId = data.organizationId
      ?? (await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, id)).limit(1))[0]?.organizationId
      ?? undefined;
    const isDedicated = orgId ? await orgUsesDedicatedDatabase(orgId) : false;
    // Strip branchId from the shared-DB update for dedicated-DB orgs (same FK reason as createUser).
    const sharedUpdate = isDedicated && data.branchId !== undefined ? { ...data, branchId: null } : data;
    const [updated] = await db.update(users).set(sharedUpdate).where(eq(users.id, id)).returning();
    if (updated?.organizationId) {
      try {
        const branchOverride = isDedicated && data.branchId !== undefined ? (data.branchId ?? null) : undefined;
        await ensureRegistryUserMirroredToOrgDataDb(updated.organizationId, id, branchOverride);
      } catch (err: any) {
        structuredLog("warn", "mirror user after updateUser failed", { orgId: updated.organizationId, userId: id, error: err?.message || String(err) });
      }
    }
    return updated;
  }
  async getRole(id: string, organizationId: string): Promise<Role | undefined> {
    const tdb = await getDbForOrg(organizationId);
    const [role] = await tdb.select().from(roles).where(and(eq(roles.id, id), eq(roles.organizationId, organizationId)));
    return role;
  }
  /** Batch fetch roles by ids (avoids N+1 when resolving many role ids). */
  async getRolesByIds(roleIds: string[], organizationId: string): Promise<Role[]> {
    if (!roleIds?.length) return [];
    const tdb = await getDbForOrg(organizationId);
    return tdb.select().from(roles).where(and(inArray(roles.id, roleIds), eq(roles.organizationId, organizationId)));
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
    // Step 1: get permissionIds from the tenant DB (may be dedicated with empty permissions table)
    const rows = await tdb.select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    const permIds = rows.map((r) => r.permissionId).filter(Boolean) as string[];
    if (!permIds.length) return [];
    // Step 2: resolve Permission objects from the shared DB (single source of truth for permission defs)
    return db.select().from(permissions).where(inArray(permissions.id, permIds));
  }
  async addRolePermission(roleId: string, permissionId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    const [role] = await tdb.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, orgId))).limit(1);
    if (!role) throw new Error("Role not found in organization");
    // Mirror the permission row into the target DB so the FK constraint is satisfied.
    // For shared-DB tenants this is a no-op; for dedicated-DB tenants it copies the row.
    const [sharedPerm] = await db.select().from(permissions).where(eq(permissions.id, permissionId)).limit(1);
    if (!sharedPerm) throw new Error("Permission not found");
    await tdb.insert(permissions).values(sharedPerm).onConflictDoNothing();
    await tdb.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
  }
  async removeRolePermission(roleId: string, permissionId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    const [role] = await tdb.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role) throw new Error("Role not found in organization");
    await tdb.delete(rolePermissions).where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)));
  }
  async clearRolePermissions(roleId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  }
  async getUserRoles(userId: string, organizationId: string): Promise<(Role & { branchId: string | null })[]> {
    const tdb = await getDbForOrg(organizationId);
    const rows = await tdb.select({ role: roles, branchId: userRoles.branchId }).from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(userRoles.userId, userId), eq(roles.organizationId, organizationId)));
    return rows.map((r) => ({ ...r.role, branchId: r.branchId }));
  }
  async getUserRolesBatch(userIds: string[], organizationId: string): Promise<Record<string, (Role & { branchId: string | null })[]>> {
    if (userIds.length === 0) return {};
    const tdb = await getDbForOrg(organizationId);
    const rows = await tdb.select({ userId: userRoles.userId, role: roles, branchId: userRoles.branchId }).from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(inArray(userRoles.userId, userIds));
    const result: Record<string, (Role & { branchId: string | null })[]> = {};
    for (const uid of userIds) result[uid] = [];
    for (const r of rows) {
      if (!result[r.userId]) result[r.userId] = [];
      result[r.userId].push({ ...r.role, branchId: r.branchId });
    }
    return result;
  }
  async addUserRole(userId: string, roleId: string, orgId: string, branchId?: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    const [role] = await tdb.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.organizationId, orgId))).limit(1);
    if (!role) throw new Error("Role not found in organization");
    await tdb.insert(userRoles).values({ userId, roleId, branchId: branchId ?? null });
  }
  async removeUserRole(userId: string, roleId: string): Promise<void> {
    const [userRow] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
    if (userRow?.organizationId) {
      const tdb = await getDbForOrg(userRow.organizationId);
      await tdb.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
    }
    await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  }
  async clearUserRoles(userId: string, organizationId?: string): Promise<void> {
    const orgId = organizationId ?? (await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1))[0]?.organizationId ?? null;
    if (orgId) {
      const tdb = await getDbForOrg(orgId);
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
  async setUserPermissionOverride(userId: string, permissionName: string, isGranted: boolean): Promise<void> {
    const [perm] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.name, permissionName)).limit(1);
    if (!perm) throw new Error(`Unknown permission: ${permissionName}`);
    // No unique constraint on (userId, permissionId) — delete any existing override for this
    // permission first so re-toggling doesn't accumulate duplicate rows.
    await db.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.permissionId, perm.id)));
    await db.insert(userPermissionOverrides).values({ userId, permissionId: perm.id, isGranted });
  }
  async removeUserPermissionOverride(userId: string, permissionName: string): Promise<void> {
    const [perm] = await db.select({ id: permissions.id }).from(permissions).where(eq(permissions.name, permissionName)).limit(1);
    if (!perm) return;
    await db.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.permissionId, perm.id)));
  }
  async getUserEffectivePermissions(userId: string, orgId?: string | null): Promise<string[]> {
    const lookupDb = orgId ? await getDbForOrg(orgId) : db;
    const [tenantOrSharedUser] = await lookupDb.select().from(users).where(eq(users.id, userId)).limit(1);
    const user =
      tenantOrSharedUser ??
      (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    const effectiveOrgId = orgId ?? user?.organizationId;

    // Fetch role names and permission IDs from the tenant DB.
    // Permission *names* are resolved in a second step against the shared (registry) DB
    // because dedicated tenant DBs have the permissions schema but no rows — permissions
    // are only seeded into the shared DB.
    const roleRows = effectiveOrgId
      ? await (await getDbForOrg(effectiveOrgId))
          .select({ roleName: roles.name, permissionId: rolePermissions.permissionId })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .where(and(eq(userRoles.userId, userId), eq(roles.organizationId, effectiveOrgId)))
      : await db
          .select({ roleName: roles.name, permissionId: rolePermissions.permissionId })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .where(eq(userRoles.userId, userId));

    const hasSuperuserRole = roleRows.some((row) => row.roleName === "superuser");
    if (hasSuperuserRole) {
      const allPerms = await this.getPermissions();
      return allPerms.map((p) => p.name);
    }

    // Resolve permission IDs → names from the shared DB (single source of truth for permission definitions).
    const permIds = Array.from(new Set(roleRows.map((r) => r.permissionId).filter((id): id is string => !!id)));
    const permSet = new Set<string>();
    if (permIds.length > 0) {
      const permRows = await db.select({ name: permissions.name }).from(permissions)
        .where(inArray(permissions.id, permIds));
      for (const row of permRows) permSet.add(row.name);
    }

    const overrides = await this.getUserPermissionOverrides(userId);
    for (const o of overrides) {
      if (o.isGranted) permSet.add(o.permissionName);
      else permSet.delete(o.permissionName);
    }

    if (user?.email?.toLowerCase() === PLATFORM_SUPERUSER_EMAIL.toLowerCase()) {
      const allPermsForOwner = await db.select().from(permissions);
      for (const p of allPermsForOwner) permSet.add(p.name);
      permSet.add("create:tenant");
      permSet.add("delete:tenant");
      permSet.add("manage:whitelabel");
    }

    return Array.from(permSet);
  }
  async getAuditLogs(organizationId: string, limit = 50, offset = 0, filters?: { search?: string; action?: string; from?: string; to?: string }): Promise<{ rows: AuditLog[]; total: number }> {
    const tdb = await getDbForOrg(organizationId);
    const conditions: any[] = [eq(auditLogs.organizationId, organizationId)];

    if (filters?.search) {
      const term = `%${filters.search}%`;
      conditions.push(or(
        ilike(auditLogs.actorEmail, term),
        ilike(auditLogs.action, term),
        ilike(auditLogs.entityType, term),
        ilike(auditLogs.entityId, term),
      ));
    }
    if (filters?.action) {
      conditions.push(eq(auditLogs.action, filters.action));
    }
    if (filters?.from) {
      conditions.push(gte(auditLogs.timestamp, new Date(filters.from)));
    }
    if (filters?.to) {
      const toDate = new Date(filters.to);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogs.timestamp, toDate));
    }

    const where = and(...conditions);
    const [{ value: total }] = await tdb.select({ value: count() }).from(auditLogs).where(where);
    const rows = await tdb.select().from(auditLogs).where(where)
      .orderBy(desc(auditLogs.timestamp)).limit(limit).offset(offset);
    return { rows, total };
  }
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const orgId = log.organizationId;
    if (!orgId) throw new Error("createAuditLog: organizationId is required");
    const tdb = await getDbForOrg(orgId);
    try {
      const [created] = await tdb.insert(auditLogs).values(log).returning();
      return created;
    } catch (error: any) {
      const fkViolation =
        error?.message?.includes("audit_logs_actor_id_users_id_fk") ||
        error?.constraint === "audit_logs_actor_id_users_id_fk";
      if (fkViolation && log.actorId) {
        // Platform owners can switch into tenant DBs where their user row does not exist.
        // Keep the audit event by dropping actorId, but preserve actorEmail and request metadata.
        const [createdWithoutActor] = await tdb
          .insert(auditLogs)
          .values({ ...log, actorId: null })
          .returning();
        return createdWithoutActor;
      }
      throw error;
    }
  }

  // ─── Clients ───────────────────────────────────────────────
  async getClientsByOrg(organizationId: string, limit = 50, offset = 0, search?: string): Promise<Client[]> {
    const tdb = await getDbForOrg(organizationId);
    const conditions = [eq(clients.organizationId, organizationId)];
    if (search && search.trim()) {
      const raw = String(search).trim();
      const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const q = `%${esc}%`;
      const digits = raw.replace(/\D/g, "");
      const orClauses: any[] = [
        ilike(clients.firstName, q),
        ilike(clients.lastName, q),
        ilike(clients.email, q),
        ilike(clients.phone, q),
        ilike(clients.nationalId, q),
        sql`(${clients.firstName} || ' ' || ${clients.lastName}) ILIKE ${q}`,
      ];
      if (digits.length >= 9) {
        orClauses.push(sql`regexp_replace(${clients.phone}, '\\D', '', 'g') LIKE ${'%' + digits.slice(-9)}`);
      }
      conditions.push(or(...orClauses)!);
    }
    return tdb.select().from(clients).where(and(...conditions))
      .orderBy(desc(clients.createdAt)).limit(limit).offset(offset);
  }
  async getClientsByAgent(agentId: string, organizationId: string, limit = 50, offset = 0, search?: string): Promise<Client[]> {
    const tdb = await getDbForOrg(organizationId);
    const policyRows = await tdb.select({ clientId: policies.clientId }).from(policies).where(eq(policies.agentId, agentId)).limit(10000);
    const leadRows = await tdb.select({ clientId: leads.clientId }).from(leads).where(eq(leads.agentId, agentId)).limit(10000);
    let directRows: { id: string }[] = [];
    try {
      directRows = await tdb.select({ id: clients.id }).from(clients).where(and(eq(clients.agentId, agentId), eq(clients.organizationId, organizationId))).limit(10000);
    } catch { /* agentId column may not exist yet before migration */ }
    const clientIds = Array.from(new Set([
      ...policyRows.map((r) => r.clientId),
      ...leadRows.map((r) => r.clientId),
      ...directRows.map((r) => r.id),
    ].filter(Boolean))) as string[];
    structuredLog("debug", "getClientsByAgent", { agentId, policies: policyRows.length, leads: leadRows.length, direct: directRows.length, totalUnique: clientIds.length, search: search || "(none)" });
    if (clientIds.length === 0) return [];
    const conditions = [eq(clients.organizationId, organizationId), inArray(clients.id, clientIds)];
    if (search && search.trim()) {
      const raw = String(search).trim();
      const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const q = `%${esc}%`;
      const digits = raw.replace(/\D/g, "");
      const orClauses: any[] = [
        ilike(clients.firstName, q),
        ilike(clients.lastName, q),
        ilike(clients.email, q),
        ilike(clients.phone, q),
        ilike(clients.nationalId, q),
        sql`(${clients.firstName} || ' ' || ${clients.lastName}) ILIKE ${q}`,
      ];
      if (digits.length >= 9) {
        orClauses.push(sql`regexp_replace(${clients.phone}, '\\D', '', 'g') LIKE ${'%' + digits.slice(-9)}`);
      }
      conditions.push(or(...orClauses)!);
    }
    return tdb.select().from(clients).where(and(...conditions))
      .orderBy(desc(clients.createdAt)).limit(limit).offset(offset);
  }
  async isClientAccessibleByAgent(agentId: string, clientId: string, organizationId: string): Promise<boolean> {
    const tdb = await getDbForOrg(organizationId);
    const [byPolicy] = await tdb
      .select({ clientId: policies.clientId })
      .from(policies)
      .where(and(eq(policies.agentId, agentId), eq(policies.clientId, clientId), eq(policies.organizationId, organizationId)))
      .limit(1);
    if (byPolicy) return true;
    const [byLead] = await tdb
      .select({ clientId: leads.clientId })
      .from(leads)
      .where(and(eq(leads.agentId, agentId), eq(leads.clientId, clientId)))
      .limit(1);
    if (byLead) return true;
    try {
      const [direct] = await tdb
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.agentId, agentId), eq(clients.organizationId, organizationId)))
        .limit(1);
      if (direct) return true;
    } catch { /* agentId column may not exist before migration */ }
    return false;
  }
  async getClient(id: string, orgId: string): Promise<Client | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [client] = await tdb.select().from(clients).where(and(eq(clients.id, id), eq(clients.organizationId, orgId)));
    return client;
  }
  async getClientsByIds(ids: string[], orgId: string): Promise<Client[]> {
    if (!ids?.length) return [];
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(clients).where(and(inArray(clients.id, ids), eq(clients.organizationId, orgId)));
  }
  async getClientByActivationCode(code: string, orgId: string): Promise<Client | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [client] = await tdb.select().from(clients)
      .where(and(eq(clients.activationCode, code), eq(clients.organizationId, orgId)));
    return client;
  }
  async getClientByEmail(orgId: string, email: string): Promise<Client | undefined> {
    const trimmed = String(email).trim();
    if (!trimmed) return undefined;
    const tdb = await getDbForOrg(orgId);
    const [client] = await tdb.select().from(clients).where(and(
      eq(clients.organizationId, orgId),
      sql`lower(trim(${clients.email})) = lower(${trimmed})`
    ));
    return client;
  }
  async getClientByNationalId(orgId: string, nationalId: string): Promise<Client | undefined> {
    const normalized = normalizeNationalId(nationalId);
    if (!normalized) return undefined;
    const tdb = await getDbForOrg(orgId);
    const [client] = await tdb.select().from(clients).where(and(
      eq(clients.organizationId, orgId),
      ilike(clients.nationalId, normalized)
    ));
    return client;
  }
  /** Normalize phone to digits for matching. */
  async getClientByPhone(orgId: string, phone: string): Promise<Client | undefined> {
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length < 9) return undefined;
    const tdb = await getDbForOrg(orgId);
    const allClients = await tdb.select().from(clients).where(eq(clients.organizationId, orgId));
    const match = allClients.find((c) => c.phone && String(c.phone).replace(/\D/g, "").slice(-9) === digits.slice(-9));
    return match;
  }
  async getClientIdsByOrgSearch(organizationId: string, search: string): Promise<string[]> {
    if (!search || !search.trim()) return [];
    const tdb = await getDbForOrg(organizationId);
    const raw = String(search).trim();
    const esc = raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const q = `%${esc}%`;
    const digits = raw.replace(/\D/g, "");
    const orClauses: any[] = [
      ilike(clients.firstName, q),
      ilike(clients.lastName, q),
      ilike(clients.email, q),
      ilike(clients.phone, q),
      ilike(clients.nationalId, q),
      sql`(${clients.firstName} || ' ' || ${clients.lastName}) ILIKE ${q}`,
    ];
    if (digits.length >= 9) {
      orClauses.push(sql`regexp_replace(${clients.phone}, '\\D', '', 'g') LIKE ${'%' + digits.slice(-9)}`);
    }
    const rows = await tdb.select({ id: clients.id }).from(clients)
      .where(and(
        eq(clients.organizationId, organizationId),
        or(...orClauses)!
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

  // ─── Client Documents ──────────────────────────────────────
  async getClientDocuments(clientId: string, orgId: string): Promise<ClientDocument[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(clientDocuments)
      .where(and(eq(clientDocuments.clientId, clientId), eq(clientDocuments.organizationId, orgId)))
      .orderBy(desc(clientDocuments.createdAt));
  }
  async createClientDocument(doc: InsertClientDocument): Promise<ClientDocument> {
    const tdb = await getDbForOrg(doc.organizationId);
    const [created] = await tdb.insert(clientDocuments).values(doc).returning();
    return created;
  }
  async deleteClientDocument(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(clientDocuments).where(and(eq(clientDocuments.id, id), eq(clientDocuments.organizationId, orgId)));
  }
  async verifyClientDocument(id: string, orgId: string, data: { verificationStatus: "verified" | "rejected"; verifiedBy: string; rejectionReason?: string | null }): Promise<ClientDocument | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(clientDocuments).set({
      verificationStatus: data.verificationStatus,
      verifiedBy: data.verifiedBy,
      verifiedAt: new Date(),
      rejectionReason: data.verificationStatus === "rejected" ? (data.rejectionReason ?? null) : null,
    }).where(and(eq(clientDocuments.id, id), eq(clientDocuments.organizationId, orgId))).returning();
    return updated;
  }

  // ─── Policy Documents ──────────────────────────────────────
  async getPolicyDocuments(policyId: string, orgId: string): Promise<PolicyDocument[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policyDocuments)
      .where(and(eq(policyDocuments.policyId, policyId), eq(policyDocuments.organizationId, orgId)))
      .orderBy(desc(policyDocuments.createdAt));
  }
  async createPolicyDocument(doc: InsertPolicyDocument): Promise<PolicyDocument> {
    const tdb = await getDbForOrg(doc.organizationId);
    const [created] = await tdb.insert(policyDocuments).values(doc).returning();
    return created;
  }
  async deletePolicyDocument(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(policyDocuments).where(and(eq(policyDocuments.id, id), eq(policyDocuments.organizationId, orgId)));
  }

  // ─── Waiting Period Waivers ────────────────────────────────
  async createWaiverRequest(data: InsertWaiver): Promise<WaitingPeriodWaiver> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(waitingPeriodWaivers).values(data).returning();
    return created;
  }
  async getWaiverForPolicy(policyId: string, orgId: string): Promise<WaitingPeriodWaiver | undefined> {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select().from(waitingPeriodWaivers)
      .where(and(eq(waitingPeriodWaivers.policyId, policyId), eq(waitingPeriodWaivers.organizationId, orgId)))
      .orderBy(desc(waitingPeriodWaivers.createdAt))
      .limit(1);
    return rows[0];
  }
  async getWaiverById(id: string, orgId: string): Promise<WaitingPeriodWaiver | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(waitingPeriodWaivers)
      .where(and(eq(waitingPeriodWaivers.id, id), eq(waitingPeriodWaivers.organizationId, orgId)))
      .limit(1);
    return row;
  }
  async updateWaiver(id: string, data: Partial<WaitingPeriodWaiver>, orgId: string): Promise<WaitingPeriodWaiver> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(waitingPeriodWaivers).set(data as any).where(and(eq(waitingPeriodWaivers.id, id), eq(waitingPeriodWaivers.organizationId, orgId))).returning();
    return updated;
  }
  async getAllWaivers(orgId: string): Promise<WaitingPeriodWaiver[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(waitingPeriodWaivers)
      .where(eq(waitingPeriodWaivers.organizationId, orgId))
      .orderBy(desc(waitingPeriodWaivers.createdAt));
  }

  // ─── Dependents ────────────────────────────────────────────
  async getDependentsByClient(clientId: string, orgId: string): Promise<Dependent[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(dependents).where(and(eq(dependents.clientId, clientId), eq(dependents.organizationId, orgId))).orderBy(dependents.createdAt);
  }
  async getDependentsByClientsBatch(clientIds: string[], orgId: string): Promise<Record<string, Dependent[]>> {
    if (clientIds.length === 0) return {};
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select().from(dependents).where(and(inArray(dependents.clientId, clientIds), eq(dependents.organizationId, orgId))).orderBy(dependents.createdAt);
    const result: Record<string, Dependent[]> = {};
    for (const cid of clientIds) result[cid] = [];
    for (const r of rows) {
      if (!result[r.clientId]) result[r.clientId] = [];
      result[r.clientId].push(r);
    }
    return result;
  }
  async getDependent(id: string, orgId: string): Promise<Dependent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [dep] = await tdb.select().from(dependents).where(and(eq(dependents.id, id), eq(dependents.organizationId, orgId))).limit(1);
    return dep;
  }
  async createDependent(dep: InsertDependent): Promise<Dependent> {
    const tdb = await getDbForOrg(dep.organizationId);
    const memberNumber = await this.getNextMemberNumber(dep.organizationId);
    const [created] = await tdb.insert(dependents).values({ ...dep, memberNumber }).returning();
    return created;
  }
  async updateDependent(id: string, data: Partial<InsertDependent>, orgId: string): Promise<Dependent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb
      .update(dependents)
      .set(data)
      .where(and(eq(dependents.id, id), eq(dependents.organizationId, orgId)))
      .returning();
    return updated;
  }
  async deleteDependent(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(dependents).where(and(eq(dependents.id, id), eq(dependents.organizationId, orgId)));
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
  async deleteProduct(id: string, orgId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const tdb = await getDbForOrg(orgId);
    const versions = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, id));
    const versionIds = versions.map((v) => v.id);
    if (versionIds.length > 0) {
      const [row] = await tdb.select({ count: count() }).from(policies).where(inArray(policies.productVersionId, versionIds));
      if (row && Number(row.count) > 0) {
        return { ok: false, reason: "Cannot delete product: one or more policies use this product." };
      }
      await tdb.delete(productBenefitBundleLinks).where(inArray(productBenefitBundleLinks.productVersionId, versionIds));
      await tdb.delete(termsAndConditions).where(inArray(termsAndConditions.productVersionId, versionIds));
    }
    await tdb.delete(productVersions).where(eq(productVersions.productId, id));
    await tdb.delete(products).where(eq(products.id, id));
    return { ok: true };
  }
  async getProductVersions(productId: string, orgId: string): Promise<ProductVersion[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(productVersions).where(eq(productVersions.productId, productId))
      .orderBy(desc(productVersions.version));
  }
  async getAllProductVersions(orgId: string): Promise<(ProductVersion & { productName?: string })[]> {
    const tdb = await getDbForOrg(orgId);
    const pvs = await tdb.select().from(productVersions)
      .innerJoin(products, eq(productVersions.productId, products.id))
      .where(eq(products.organizationId, orgId))
      .orderBy(products.name, desc(productVersions.version));
    return pvs.map((r) => ({ ...r.product_versions, productName: r.products.name }));
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
  async updateProductVersion(id: string, data: Partial<InsertProductVersion>, orgId: string): Promise<ProductVersion | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(productVersions).set(data).where(eq(productVersions.id, id)).returning();
    return updated;
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
  async updateAddOn(id: string, data: Partial<InsertAddOn>, orgId: string): Promise<AddOn | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(addOns).set(data).where(eq(addOns.id, id)).returning();
    return updated;
  }
  async updateBenefitCatalogItem(id: string, data: Partial<InsertBenefitCatalogItem>, orgId: string): Promise<BenefitCatalogItem | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(benefitCatalogItems).set(data).where(eq(benefitCatalogItems.id, id)).returning();
    return updated;
  }
  async updateBenefitBundle(id: string, data: Partial<InsertBenefitBundle>, orgId: string): Promise<BenefitBundle | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(benefitBundles).set(data).where(eq(benefitBundles.id, id)).returning();
    return updated;
  }
  async getAgeBandConfigs(orgId: string): Promise<AgeBandConfig[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(ageBandConfigs).where(eq(ageBandConfigs.organizationId, orgId));
  }
  async updateAgeBandConfig(id: string, data: Partial<InsertAgeBandConfig>, orgId: string): Promise<AgeBandConfig | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(ageBandConfigs).set(data).where(eq(ageBandConfigs.id, id)).returning();
    return updated;
  }
  async createAgeBandConfig(config: InsertAgeBandConfig): Promise<AgeBandConfig> {
    const tdb = await getDbForOrg(config.organizationId);
    const [created] = await tdb.insert(ageBandConfigs).values(config).returning();
    return created;
  }

  // ─── Policies ──────────────────────────────────────────────
  async getPoliciesByOrg(organizationId: string, limit = 50, offset = 0, filters?: ReportFilters & { status?: string; statuses?: string[]; search?: string }): Promise<Policy[]> {
    const tdb = await getDbForOrg(organizationId);
    const conditions = [eq(policies.organizationId, organizationId), isNull(policies.deletedAt)];
    if (filters?.fromDate) conditions.push(gte(policies.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policies.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.status) conditions.push(eq(policies.status, filters.status));
    if (filters?.statuses?.length) conditions.push(inArray(policies.status, filters.statuses));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else conditions.push(sql`1 = 0`);
    }
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

  async getPolicyReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<PolicyReportRow[]> {
    const tdb = await getDbForOrg(organizationId);
    const conditions = [eq(policies.organizationId, organizationId)];
    if (filters?.fromDate) conditions.push(gte(policies.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policies.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.status) conditions.push(eq(policies.status, filters.status));
    if (filters?.statuses?.length) conditions.push(inArray(policies.status, filters.statuses));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else conditions.push(sql`1 = 0`);
    }
    const rows = await tdb
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        status: policies.status,
        currency: policies.currency,
        premiumAmount: policies.premiumAmount,
        paymentSchedule: policies.paymentSchedule,
        effectiveDate: policies.effectiveDate,
        inceptionDate: policies.inceptionDate,
        waitingPeriodEndDate: policies.waitingPeriodEndDate,
        currentCycleStart: policies.currentCycleStart,
        currentCycleEnd: policies.currentCycleEnd,
        graceEndDate: policies.graceEndDate,
        policyCreatedAt: policies.createdAt,
        clientId: clients.id,
        clientTitle: clients.title,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientNationalId: clients.nationalId,
        clientDateOfBirth: clients.dateOfBirth,
        clientGender: clients.gender,
        clientMaritalStatus: clients.maritalStatus,
        clientPhone: clients.phone,
        clientEmail: clients.email,
        clientAddress: clients.address,
        clientPreferredCommMethod: clients.preferredCommMethod,
        clientLocation: clients.location,
        productName: products.name,
        productCode: products.code,
        coverAmount: products.coverAmount,
        coverCurrency: products.coverCurrency,
        branchName: branches.name,
        groupName: groups.name,
        agentEmail: users.email,
        agentDisplayName: users.displayName,
        gracePeriodDays: productVersions.gracePeriodDays,
        beneficiaryFirstName: policies.beneficiaryFirstName,
        beneficiaryLastName: policies.beneficiaryLastName,
        beneficiaryRelationship: policies.beneficiaryRelationship,
        beneficiaryNationalId: policies.beneficiaryNationalId,
        beneficiaryPhone: policies.beneficiaryPhone,
      })
      .from(policies)
      .innerJoin(clients, eq(policies.clientId, clients.id))
      .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
      .innerJoin(products, eq(productVersions.productId, products.id))
      .leftJoin(branches, eq(policies.branchId, branches.id))
      .leftJoin(groups, eq(policies.groupId, groups.id))
      .leftJoin(users, eq(policies.agentId, users.id))
      .where(and(...conditions))
      .orderBy(desc(policies.createdAt))
      .limit(limit)
      .offset(offset);

    const policyIds = rows.map((r) => r.policyId);
    const memberMap: Record<string, string> = {};
    if (policyIds.length > 0) {
      const members = await tdb.select({ policyId: policyMembers.policyId, memberNumber: policyMembers.memberNumber })
        .from(policyMembers)
        .where(and(eq(policyMembers.role, "principal"), inArray(policyMembers.policyId, policyIds)));
      for (const m of members) {
        if (m.memberNumber && !memberMap[m.policyId]) memberMap[m.policyId] = m.memberNumber;
      }
    }

    return rows.map((r) => ({
      ...r,
      premiumAmount: String(r.premiumAmount ?? ""),
      effectiveDate: r.effectiveDate ? String(r.effectiveDate) : null,
      inceptionDate: r.inceptionDate ? String(r.inceptionDate) : null,
      waitingPeriodEndDate: r.waitingPeriodEndDate ? String(r.waitingPeriodEndDate) : null,
      currentCycleStart: r.currentCycleStart ? String(r.currentCycleStart) : null,
      currentCycleEnd: r.currentCycleEnd ? String(r.currentCycleEnd) : null,
      graceEndDate: r.graceEndDate ? String(r.graceEndDate) : null,
      policyCreatedAt: r.policyCreatedAt ? new Date(r.policyCreatedAt).toISOString() : "",
      clientDateOfBirth: r.clientDateOfBirth ? String(r.clientDateOfBirth) : null,
      groupName: r.groupName ?? null,
      gracePeriodDays: r.gracePeriodDays != null ? Number(r.gracePeriodDays) : null,
      coverAmount: r.coverAmount ? String(r.coverAmount) : null,
      coverCurrency: r.coverCurrency ?? null,
      memberNumber: memberMap[r.policyId] ?? null,
    }));
  }

  async getAllPoliciesReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]> {
    const tdb = await getDbForOrg(organizationId);
    const conditions: SQL[] = [eq(policies.organizationId, organizationId), isNull(policies.deletedAt)];
    if (filters?.fromDate) conditions.push(gte(policies.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policies.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.status) conditions.push(eq(policies.status, filters.status));
    if (filters?.statuses?.length) conditions.push(inArray(policies.status, filters.statuses));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else return [];
    }

    const rows = await tdb
      .select({
        policyId: policies.id,
        branchId: policies.branchId,
        branchName: branches.name,
        policyNumber: policies.policyNumber,
        status: policies.status,
        currency: policies.currency,
        premiumAmount: policies.premiumAmount,
        inceptionDate: policies.inceptionDate,
        policyCreatedAt: policies.createdAt,
        agentUserId: users.id,
        agentDisplayName: users.displayName,
        agentEmail: users.email,
        clientId: clients.id,
        clientTitle: clients.title,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientNationalId: clients.nationalId,
        clientDateOfBirth: clients.dateOfBirth,
        clientPhone: clients.phone,
        clientEmail: clients.email,
        clientAddress: clients.address,
        clientPhysicalAddress: clients.physicalAddress,
        clientPostalAddress: clients.postalAddress,
        productName: products.name,
        groupName: groups.name,
      })
      .from(policies)
      .innerJoin(clients, eq(policies.clientId, clients.id))
      .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
      .innerJoin(products, eq(productVersions.productId, products.id))
      .leftJoin(branches, eq(policies.branchId, branches.id))
      .leftJoin(groups, eq(policies.groupId, groups.id))
      .leftJoin(users, eq(policies.agentId, users.id))
      .where(and(...conditions))
      .orderBy(desc(policies.createdAt))
      .limit(limit)
      .offset(offset);

    const policyIds = rows.map((r) => r.policyId);
    const clientIds = Array.from(new Set(rows.map((r) => r.clientId).filter(Boolean)));

    const memberMap: Record<string, string> = {};
    if (policyIds.length > 0) {
      const mRows = await tdb
        .select({ policyId: policyMembers.policyId, memberNumber: policyMembers.memberNumber })
        .from(policyMembers)
        .where(and(inArray(policyMembers.role, ["principal", "policy_holder"]), inArray(policyMembers.policyId, policyIds)));
      for (const m of mRows) { if (m.memberNumber && !memberMap[m.policyId]) memberMap[m.policyId] = m.memberNumber; }
    }

    const debitOrderMap: Record<string, { mandateReference: string; dayOfMonth: number | null }> = {};
    if (policyIds.length > 0) {
      const doRows = await tdb
        .select({ policyId: debitOrders.policyId, mandateReference: debitOrders.mandateReference, dayOfMonth: debitOrders.dayOfMonth })
        .from(debitOrders)
        .where(and(inArray(debitOrders.policyId, policyIds), eq(debitOrders.organizationId, organizationId)))
        .orderBy(desc(debitOrders.createdAt));
      for (const d of doRows) { if (d.policyId && !debitOrderMap[d.policyId]) debitOrderMap[d.policyId] = { mandateReference: d.mandateReference, dayOfMonth: d.dayOfMonth }; }
    }

    const payMethodMap: Record<string, string> = {};
    if (clientIds.length > 0) {
      const cpmRows = await tdb
        .select({ clientId: clientPaymentMethods.clientId, methodType: clientPaymentMethods.methodType })
        .from(clientPaymentMethods)
        .where(and(inArray(clientPaymentMethods.clientId, clientIds), eq(clientPaymentMethods.isDefault, true), eq(clientPaymentMethods.isActive, true)));
      for (const c of cpmRows) { if (!payMethodMap[c.clientId]) payMethodMap[c.clientId] = c.methodType; }
    }

    return rows.map((r) => {
      const do_ = debitOrderMap[r.policyId];
      return {
        Branch_ID: r.branchId ?? "",
        BranchName: r.branchName ?? "",
        Member_ID: memberMap[r.policyId] ?? "",
        Policy_Number: r.policyNumber ?? "",
        MandateReference: do_?.mandateReference ?? "",
        InternalReferenceNumber: "",
        Inception_Date: r.inceptionDate ? String(r.inceptionDate) : "",
        fullname: [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ").trim(),
        ID_Number: r.clientNationalId ?? "",
        Passport_Number: "",
        Date_Of_Birth: r.clientDateOfBirth ? String(r.clientDateOfBirth) : "",
        ProductName: r.productName ?? "",
        physicalAddress: r.clientPhysicalAddress || r.clientAddress || "",
        postalAddress: r.clientPostalAddress ?? "",
        Cell_Number: r.clientPhone ?? "",
        EmailAddress: r.clientEmail ?? "",
        UsualPremium: `${r.currency || "USD"} ${r.premiumAmount ?? ""}`.trim(),
        Currency: r.currency ?? "",
        AgentsName: (r.agentDisplayName || r.agentEmail || "").trim(),
        Payment_Method: r.clientId ? (payMethodMap[r.clientId] ?? "") : "",
        IsDebiCheck: "",
        User_Code: "",
        currstatus: r.status ?? "",
        agentCode: "",
        ApplicationComplete: "",
        Notes: "",
        Date_Captured: r.policyCreatedAt ? new Date(r.policyCreatedAt).toISOString().split("T")[0] : "",
        maturityTerm: "",
        GroupName: r.groupName ?? "",
        EasyPayNumber: "",
        ConfidentialNotes: "",
        OverrideNAEDOWithEFT: "",
        EmployeeID: "",
        UserID: r.agentUserId ?? "",
        LanguageId: "",
        SalaryScaleID: "",
        PayAtNumber: "",
        Debit_day: do_?.dayOfMonth != null ? String(do_.dayOfMonth) : "",
        IsNaedo: "",
        CapturerName: "",
        LanguageName: "",
        SalaryScale: "",
        HomeTelephone: "",
        "Exclude Escalation": "",
        WhatsappNumber: "",
      };
    });
  }


  async getNewJoiningsReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]> {
    const tdb = await getDbForOrg(organizationId);

    // Fetch franchise (org) name from the registry database
    const [orgRow] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId));
    const franchiseName = orgRow?.name ?? "";

    const conditions = [eq(policies.organizationId, organizationId)];
    if (filters?.fromDate) conditions.push(gte(policies.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policies.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else conditions.push(sql`1 = 0`);
    }
    const rows = await tdb
      .select({
        policyId: policies.id,
        policyBranchId: policies.branchId,
        policyNumber: policies.policyNumber,
        status: policies.status,
        currency: policies.currency,
        premiumAmount: policies.premiumAmount,
        paymentSchedule: policies.paymentSchedule,
        effectiveDate: policies.effectiveDate,
        inceptionDate: policies.inceptionDate,
        waitingPeriodEndDate: policies.waitingPeriodEndDate,
        currentCycleStart: policies.currentCycleStart,
        currentCycleEnd: policies.currentCycleEnd,
        graceEndDate: policies.graceEndDate,
        policyCreatedAt: policies.createdAt,
        clientId: clients.id,
        clientTitle: clients.title,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientNationalId: clients.nationalId,
        clientPhone: clients.phone,
        clientAddress: clients.address,
        clientPhysicalAddress: clients.physicalAddress,
        clientPostalAddress: clients.postalAddress,
        clientActivationCode: clients.activationCode,
        clientDateOfBirth: clients.dateOfBirth,
        clientEmail: clients.email,
        productName: products.name,
        productCode: products.code,
        branchName: branches.name,
        groupName: groups.name,
        agentEmail: users.email,
        agentDisplayName: users.displayName,
        gracePeriodDays: productVersions.gracePeriodDays,
        waitingPeriodDays: productVersions.waitingPeriodDays,
      })
      .from(policies)
      .innerJoin(clients, eq(policies.clientId, clients.id))
      .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
      .innerJoin(products, eq(productVersions.productId, products.id))
      .leftJoin(branches, eq(policies.branchId, branches.id))
      .leftJoin(groups, eq(policies.groupId, groups.id))
      .leftJoin(users, eq(policies.agentId, users.id))
      .where(and(...conditions))
      .orderBy(desc(policies.createdAt))
      .limit(limit)
      .offset(offset);

    const policyIds = rows.map((r) => r.policyId);
    const memberMap: Record<string, string> = {};
    if (policyIds.length > 0) {
      const members = await tdb.select({ policyId: policyMembers.policyId, memberNumber: policyMembers.memberNumber })
        .from(policyMembers)
        .where(and(inArray(policyMembers.role, ["principal", "policy_holder"]), inArray(policyMembers.policyId, policyIds)));
      for (const m of members) {
        if (m.memberNumber && !memberMap[m.policyId]) memberMap[m.policyId] = m.memberNumber;
      }
    }

    const idate = filters?.fromDate ?? "";
    const tdate = filters?.toDate ?? "";

    const initialsFrom = (first: string, last: string) => {
      const a = (first || "").trim();
      const b = (last || "").trim();
      return `${a.charAt(0).toUpperCase()}${b.charAt(0).toUpperCase()}`.trim() || "";
    };

    const scheduleLabel = (s: string | null | undefined) => {
      if (!s) return "";
      return s.charAt(0).toUpperCase() + s.slice(1);
    };

    return rows.map((r) => {
      const memberNumber = memberMap[r.policyId] ?? "";
      const prem = String(r.premiumAmount ?? "");
      const usualPremium = prem ? `${r.currency || "USD"} ${prem}` : "";
      const policyHolder = [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ").trim();
      const wpDays = r.waitingPeriodDays != null ? Number(r.waitingPeriodDays) : null;
      const Waiting_Period = wpDays != null && !Number.isNaN(wpDays) ? `${wpDays} days` : "";
      const maturityParts: string[] = [];
      if (r.currentCycleEnd) maturityParts.push(`Cycle end ${r.currentCycleEnd}`);
      if (r.waitingPeriodEndDate) maturityParts.push(`Waiting end ${r.waitingPeriodEndDate}`);
      if (r.graceEndDate) maturityParts.push(`Grace end ${r.graceEndDate}`);
      const MaturityTerm = maturityParts.join(" · ") || "";
      const InternalReferenceNumber = [r.productCode, r.policyNumber].filter(Boolean).join(" · ") || String(r.policyId);
      const agentName = r.agentDisplayName || r.agentEmail || "";

      return {
        _policyId: r.policyId,
        _status: r.status,
        _policyCreatedAt: r.policyCreatedAt ? new Date(r.policyCreatedAt).toISOString() : "",
        Franchise_ID: organizationId,
        Branch_ID: r.policyBranchId ?? "",
        Franchise: franchiseName,
        BranchName: r.branchName ?? "",
        MarketingManager: agentName,
        Member_ID: memberNumber,
        Policy_number: r.policyNumber ?? "",
        Inception_Date: r.inceptionDate ? String(r.inceptionDate) : "",
        ID_Number: r.clientNationalId ?? "",
        First_Name: r.clientFirstName ?? "",
        Surname: r.clientLastName ?? "",
        PolicyHolder: policyHolder,
        Title: r.clientTitle ?? "",
        Initials: initialsFrom(r.clientFirstName ?? "", r.clientLastName ?? ""),
        UsualPremium: usualPremium,
        Cell_Number: r.clientPhone ?? "",
        PhysicalAddress: r.clientPhysicalAddress || r.clientAddress || "",
        PostalAddress: r.clientPostalAddress ?? "",
        EasyPayNumber: r.clientActivationCode ?? "",
        Payment_Method: scheduleLabel(r.paymentSchedule),
        StopOrderNumber: "",
        Product_Name: r.productName ?? "",
        Waiting_Period,
        InternalReferenceNumber,
        AgentName: agentName,
        MaturityTerm,
        GroupName: r.groupName ?? "",
        Date_Of_Birth: r.clientDateOfBirth ? String(r.clientDateOfBirth) : "",
        EmailAddress: r.clientEmail ?? "",
        Currency: r.currency ?? "",
        currstatus: r.status ?? "",
        Date_Captured: r.policyCreatedAt ? String(r.policyCreatedAt).split("T")[0] : "",
        fdate: idate,
        tdate,
      };
    });
  }

  async getAgentProductivityReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]> {
    if (!filters?.fromDate || !filters?.toDate) return [];
    const tdb = await getDbForOrg(organizationId);
    const fromStart = new Date(filters.fromDate + "T00:00:00.000Z");
    const toEnd = new Date(filters.toDate + "T23:59:59.999Z");
    const fdate = filters.fromDate;
    const tdate = filters.toDate;

    const branchPolicy = alias(branches, "policy_branch");
    const branchAgent = alias(branches, "agent_branch");

    const conditions: SQL[] = [
      eq(policies.organizationId, organizationId),
      gte(policies.createdAt, fromStart),
      lte(policies.createdAt, toEnd),
      exists(
        tdb
          .select({ id: paymentReceipts.id })
          .from(paymentReceipts)
          .where(
            and(
              eq(paymentReceipts.policyId, policies.id),
              eq(paymentReceipts.organizationId, organizationId),
              eq(paymentReceipts.status, "issued"),
              gte(paymentReceipts.issuedAt, fromStart),
              lte(paymentReceipts.issuedAt, toEnd),
            ),
          ),
      ),
    ];
    if (filters.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else return [];
    }

    const rows = await tdb
      .select({
        policyId: policies.id,
        agentId: policies.agentId,
        policyNumber: policies.policyNumber,
        status: policies.status,
        currency: policies.currency,
        premiumAmount: policies.premiumAmount,
        inceptionDate: policies.inceptionDate,
        clientTitle: clients.title,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        productName: products.name,
        agentDisplayName: users.displayName,
        agentEmail: users.email,
        memberBranchName: branchPolicy.name,
        agentBranchName: branchAgent.name,
      })
      .from(policies)
      .innerJoin(clients, eq(policies.clientId, clients.id))
      .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
      .innerJoin(products, eq(productVersions.productId, products.id))
      .leftJoin(branchPolicy, eq(policies.branchId, branchPolicy.id))
      .leftJoin(users, eq(policies.agentId, users.id))
      .leftJoin(branchAgent, eq(users.branchId, branchAgent.id))
      .where(and(...conditions))
      .orderBy(desc(policies.createdAt))
      .limit(limit)
      .offset(offset);

    const policyIds = rows.map((r) => r.policyId);
    const countMap = new Map<string, number>();
    if (policyIds.length > 0) {
      const cntRows = await tdb
        .select({ policyId: paymentReceipts.policyId, n: count() })
        .from(paymentReceipts)
        .where(
          and(
            inArray(paymentReceipts.policyId, policyIds),
            eq(paymentReceipts.organizationId, organizationId),
            eq(paymentReceipts.status, "issued"),
            gte(paymentReceipts.issuedAt, fromStart),
            lte(paymentReceipts.issuedAt, toEnd),
          ),
        )
        .groupBy(paymentReceipts.policyId);
      for (const c of cntRows) countMap.set(c.policyId, Number(c.n) || 0);
    }

    const statusDes = (s: string) => {
      const m: Record<string, string> = {
        inactive: "Inactive",
        active: "Active",
        grace: "Grace period",
        lapsed: "Lapsed",
        cancelled: "Cancelled",
      };
      return m[s] || s;
    };
    const statusColour = (s: string) => {
      const m: Record<string, string> = {
        inactive: "Gray",
        active: "Green",
        grace: "Amber",
        lapsed: "Red",
        cancelled: "DarkRed",
      };
      return m[s] || "";
    };

    return rows.map((r) => {
      const prem = String(r.premiumAmount ?? "");
      const usualPrem = prem ? `${r.currency || "USD"} ${prem}` : "";
      const fullName = [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ").trim();
      const receiptsC = countMap.get(r.policyId) ?? 0;
      return {
        policyId: r.policyId,
        agent_id: r.agentId ?? "",
        AgentsName: (r.agentDisplayName || r.agentEmail || "").trim(),
        Inception_Date: r.inceptionDate ? String(r.inceptionDate) : "",
        Policy_Number: r.policyNumber ?? "",
        FullName: fullName,
        Product_Name: r.productName ?? "",
        UsualPremium: usualPrem,
        StatusDesc: statusDes(r.status || ""),
        ReceiptsCollected: receiptsC,
        Colour: statusColour(r.status || ""),
        MembersBranch: r.memberBranchName ?? "",
        AgentsBranch: r.agentBranchName ?? "",
        Active: r.status === "active" ? "Yes" : "No",
        fdate,
        tdate,
      };
    });
  }

  /** Receipt aggregates by policy for finance report. */
  async getReceiptAggregatesByPolicyIds(
    orgId: string,
    policyIds: string[],
    opts?: { issuedFrom?: Date; issuedTo?: Date },
  ): Promise<Map<string, { lastPaymentAt: string; receiptCount: number; totalAmount: string }>> {
    if (policyIds.length === 0) return new Map();
    const tdb = await getDbForOrg(orgId);
    const conditions: SQL[] = [inArray(paymentReceipts.policyId, policyIds), eq(paymentReceipts.status, "issued")];
    if (opts?.issuedFrom) conditions.push(gte(paymentReceipts.issuedAt, opts.issuedFrom));
    if (opts?.issuedTo) conditions.push(lte(paymentReceipts.issuedAt, opts.issuedTo));
    const rows = await tdb.select({
      policyId: paymentReceipts.policyId,
      lastIssuedAt: max(paymentReceipts.issuedAt),
      receiptCount: count(),
      totalAmount: sum(paymentReceipts.amount),
    }).from(paymentReceipts).where(and(...conditions)).groupBy(paymentReceipts.policyId);
    const map = new Map<string, { lastPaymentAt: string; receiptCount: number; totalAmount: string }>();
    for (const p of policyIds) map.set(p, { lastPaymentAt: "", receiptCount: 0, totalAmount: "0" });
    for (const r of rows) {
      map.set(r.policyId, {
        lastPaymentAt: r.lastIssuedAt ? new Date(r.lastIssuedAt).toISOString() : "",
        receiptCount: Number(r.receiptCount),
        totalAmount: Number(r.totalAmount ?? 0).toFixed(2),
      });
    }
    return map;
  }

  async getFinanceReportByOrg(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<FinanceReportRow[]> {
    const rows = await this.getPolicyReportByOrg(organizationId, limit, offset, filters);
    const policyIds = rows.map((r) => r.policyId);
    const receiptOpts =
      filters?.fromDate || filters?.toDate
        ? {
            ...(filters.fromDate ? { issuedFrom: new Date(filters.fromDate + "T00:00:00.000Z") } : {}),
            ...(filters.toDate ? { issuedTo: new Date(filters.toDate + "T23:59:59.999Z") } : {}),
          }
        : undefined;
    const aggregates = await this.getReceiptAggregatesByPolicyIds(organizationId, policyIds, receiptOpts);
    const today = todayInHarare();
    return rows.map((r) => {
      const agg = aggregates.get(r.policyId) ?? { lastPaymentAt: "", receiptCount: 0, totalAmount: "0" };
      const dueDate = r.currentCycleEnd ?? null;
      const premium = parseFloat(r.premiumAmount || "0");
      const totalReceived = parseFloat(agg.totalAmount || "0");
      const monthsPaid = agg.receiptCount;
      let graceDaysUsed = 0;
      let graceDaysRemaining: number | null = null;
      const graceDays = r.gracePeriodDays ?? 0;
      if (r.status === "grace" && r.graceEndDate && graceDays > 0) {
        const graceEnd = new Date(r.graceEndDate);
        const now = new Date();
        graceDaysRemaining = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
        graceDaysUsed = Math.max(0, Math.min(graceDays, graceDays - graceDaysRemaining));
      }
      let outstandingPremium = "0";
      if (dueDate && dueDate < today && premium > 0) {
        outstandingPremium = r.premiumAmount;
      }
      const expectedPaid = monthsPaid * premium;
      const advancePremium = totalReceived > expectedPaid ? (totalReceived - expectedPaid).toFixed(2) : "0";
      return {
        ...r,
        datePaid: agg.lastPaymentAt || null,
        dueDate,
        receiptCount: monthsPaid,
        monthsPaid,
        graceDaysUsed,
        graceDaysRemaining,
        outstandingPremium,
        advancePremium,
      } as FinanceReportRow;
    });
  }

  async getUnderwriterPayableReport(organizationId: string, limit: number, offset: number, filters?: ReportFilters): Promise<UnderwriterPayableReportResult> {
    const tdb = await getDbForOrg(organizationId);
    const conditions = [eq(policies.organizationId, organizationId)];
    if (filters?.fromDate) conditions.push(gte(policies.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policies.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.status) conditions.push(eq(policies.status, filters.status));
    if (filters?.statuses?.length) conditions.push(inArray(policies.status, filters.statuses));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else conditions.push(sql`1 = 0`);
    }
    const baseRows = await tdb
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        status: policies.status,
        clientId: clients.id,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientPhone: clients.phone,
        clientEmail: clients.email,
        clientNationalId: clients.nationalId,
        productName: products.name,
        productCode: products.code,
        branchName: branches.name,
        underwriterAmountAdult: productVersions.underwriterAmountAdult,
        underwriterAmountChild: productVersions.underwriterAmountChild,
        underwriterAdvanceMonths: productVersions.underwriterAdvanceMonths,
        dependentMaxAge: productVersions.dependentMaxAge,
      })
      .from(policies)
      .innerJoin(clients, eq(policies.clientId, clients.id))
      .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
      .innerJoin(products, eq(productVersions.productId, products.id))
      .leftJoin(branches, eq(policies.branchId, branches.id))
      .where(and(...conditions))
      .orderBy(desc(policies.createdAt))
      .limit(limit)
      .offset(offset);

    const policyIds = baseRows.map((r) => r.policyId);
    const membersByPolicy: Record<string, { clientId: string | null; dependentId: string | null; role: string }[]> = {};
    let allMembers: { policyId: string; clientId: string | null; dependentId: string | null; role: string }[] = [];
    if (policyIds.length > 0) {
      const members = await tdb.select({
        policyId: policyMembers.policyId,
        clientId: policyMembers.clientId,
        dependentId: policyMembers.dependentId,
        role: policyMembers.role,
      }).from(policyMembers).where(and(inArray(policyMembers.policyId, policyIds), eq(policyMembers.isActive, true)));
      allMembers = members;
      for (const m of members) {
        if (!membersByPolicy[m.policyId]) membersByPolicy[m.policyId] = [];
        membersByPolicy[m.policyId].push({ clientId: m.clientId, dependentId: m.dependentId, role: m.role });
      }
    }
    const dependentIds = Array.from(new Set(allMembers.map((m) => m.dependentId).filter(Boolean) as string[]));
    const dependentDobMap: Record<string, string | null> = {};
    if (dependentIds.length > 0) {
      const deps = await tdb.select({ id: dependents.id, dateOfBirth: dependents.dateOfBirth }).from(dependents).where(inArray(dependents.id, dependentIds));
      for (const d of deps) dependentDobMap[d.id] = d.dateOfBirth ? String(d.dateOfBirth) : null;
    }
    const asOfDate = new Date();

    function ageAt(dob: string | null): number | null {
      if (!dob) return null;
      const birth = new Date(dob);
      let age = asOfDate.getFullYear() - birth.getFullYear();
      const m = asOfDate.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && asOfDate.getDate() < birth.getDate())) age--;
      return age;
    }

    const rows: UnderwriterPayableRow[] = [];
    let totalMonthlyPayable = 0;
    let totalPayableIncludingAdvance = 0;

    for (const r of baseRows) {
      const advanceMonths = Number(r.underwriterAdvanceMonths ?? 0);
      const maxAge = r.dependentMaxAge != null ? Number(r.dependentMaxAge) : 21;
      const amtAdult = r.underwriterAmountAdult != null ? parseFloat(String(r.underwriterAmountAdult)) : 0;
      const amtChild = r.underwriterAmountChild != null ? parseFloat(String(r.underwriterAmountChild)) : amtAdult;

      const members = membersByPolicy[r.policyId] ?? [];
      let adults = 0;
      let children = 0;
      for (const m of members) {
        if (m.role === "principal" || m.clientId) {
          adults += 1;
          continue;
        }
        if (m.dependentId) {
          const dob = dependentDobMap[m.dependentId];
          const a = ageAt(dob);
          if (a === null || a >= maxAge) adults += 1;
          else children += 1;
        }
      }

      const monthlyPayable = adults * amtAdult + children * amtChild;
      const totalPayable = monthlyPayable * (1 + advanceMonths);
      totalMonthlyPayable += monthlyPayable;
      totalPayableIncludingAdvance += totalPayable;

      rows.push({
        policyId: r.policyId,
        policyNumber: r.policyNumber,
        status: r.status,
        clientId: r.clientId,
        clientFirstName: r.clientFirstName,
        clientLastName: r.clientLastName,
        clientPhone: r.clientPhone,
        clientEmail: r.clientEmail,
        clientNationalId: r.clientNationalId,
        productName: r.productName,
        productCode: r.productCode,
        branchName: r.branchName,
        adults,
        children,
        underwriterAmountAdult: r.underwriterAmountAdult != null ? String(r.underwriterAmountAdult) : null,
        underwriterAmountChild: r.underwriterAmountChild != null ? String(r.underwriterAmountChild) : null,
        underwriterAdvanceMonths: advanceMonths,
        monthlyPayable,
        totalPayable,
      });
    }

    return {
      rows,
      summary: {
        totalMonthlyPayable,
        totalPayableIncludingAdvance,
        policyCount: rows.length,
      },
    };
  }

  async getPoliciesByClient(clientId: string, orgId: string): Promise<Policy[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policies).where(and(eq(policies.clientId, clientId), eq(policies.organizationId, orgId), isNull(policies.deletedAt))).limit(500);
  }
  async getPoliciesByAgent(agentId: string, orgId: string): Promise<Policy[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policies).where(and(eq(policies.agentId, agentId), eq(policies.organizationId, orgId), isNull(policies.deletedAt))).limit(500);
  }
  async reassignAgentPolicies(fromAgentId: string, toAgentId: string, orgId: string): Promise<number> {
    // Mirror toAgent into the tenant DB first — policies.agentId has an FK to users.id
    // and the tenant DB users table is a mirror that may not yet contain toAgent.
    await ensureRegistryUserMirroredToOrgDataDb(orgId, toAgentId);
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.update(policies).set({ agentId: toAgentId }).where(and(eq(policies.agentId, fromAgentId), eq(policies.organizationId, orgId))).returning({ id: policies.id });
    return result.length;
  }
  async getPolicy(id: string, orgId: string): Promise<Policy | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [policy] = await tdb.select().from(policies).where(and(eq(policies.id, id), eq(policies.organizationId, orgId)));
    return policy;
  }
  async getPoliciesByProductVersion(productVersionId: string, orgId: string): Promise<Policy[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policies).where(and(eq(policies.productVersionId, productVersionId), eq(policies.organizationId, orgId)));
  }
  /** Batch fetch policies by ids (avoids N+1 when resolving many policy ids). */
  async getPoliciesByIds(ids: string[], orgId: string): Promise<Policy[]> {
    if (!ids?.length) return [];
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policies).where(and(inArray(policies.id, ids), eq(policies.organizationId, orgId)));
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

  async createPolicyWithInitialSetup(
    orgId: string,
    data: {
      policy: InsertPolicy;
      statusHistory: { fromStatus: string | null; toStatus: string; reason?: string; changedBy?: string | null };
      members: Array<{ clientId?: string | null; dependentId?: string | null; role: string }>;
      memberAddOns?: Array<{ memberRef: string; addOnId: string }>;
    },
  ): Promise<{ policy: Policy; members: PolicyMember[] }> {
    return withOrgTransaction(orgId, async (tx) => {
      const [policy] = await tx.insert(policies).values(data.policy).returning();
      await tx.insert(policyStatusHistory).values({
        policyId: policy.id,
        fromStatus: data.statusHistory.fromStatus,
        toStatus: data.statusHistory.toStatus,
        reason: data.statusHistory.reason,
        changedBy: data.statusHistory.changedBy ?? undefined,
      });
      // Keep sequence ahead of existing member numbers (can drift after data migration)
      await tx.execute(sql`
        INSERT INTO org_member_sequences (organization_id, member_next) VALUES (${orgId}, 1)
        ON CONFLICT (organization_id) DO UPDATE SET member_next = GREATEST(
          org_member_sequences.member_next,
          COALESCE((
            SELECT MAX(CAST(SUBSTRING(member_number FROM 5) AS INTEGER))
            FROM policy_members
            WHERE organization_id = ${orgId}
              AND member_number ~ '^MEM-[0-9]+$'
          ), 0) + 1
        )
      `);
      const membersOut: PolicyMember[] = [];
      for (const m of data.members) {
        const seqResult = await tx.execute(sql`
          INSERT INTO org_member_sequences (organization_id, member_next) VALUES (${orgId}, 1)
          ON CONFLICT (organization_id) DO UPDATE SET member_next = org_member_sequences.member_next + 1
          RETURNING member_next
        `);
        const nextVal = (seqResult as unknown as { rows?: { member_next: number }[] }).rows?.[0]?.member_next ?? 1;
        const memberNumber = `MEM-${String(nextVal).padStart(6, "0")}`;
        const [createdMember] = await tx
          .insert(policyMembers)
          .values({
            organizationId: orgId,
            policyId: policy.id,
            clientId: m.clientId ?? null,
            dependentId: m.dependentId ?? null,
            role: m.role,
            memberNumber,
          })
          .returning();
        membersOut.push(createdMember);
      }
      // Store per-member add-ons. "holder" resolves to the policy_holder member row.
      const maoList = data.memberAddOns ?? [];
      if (maoList.length > 0) {
        const holderMember = membersOut.find((m) => m.role === "policy_holder");
        const addOnRows = maoList
          .map((mao) => {
            const resolvedMember = mao.memberRef === "holder"
              ? holderMember
              : membersOut.find((m) => m.dependentId === mao.memberRef);
            if (!resolvedMember) return null;
            return { policyId: policy.id, addOnId: mao.addOnId, policyMemberId: resolvedMember.id };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        // Deduplicate (same member + same add-on)
        const seen = new Set<string>();
        const dedupedRows = addOnRows.filter((r) => {
          const key = `${r.policyMemberId}:${r.addOnId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (dedupedRows.length > 0) {
          await tx.insert(policyAddOns).values(dedupedRows);
        }
      }
      return { policy, members: membersOut };
    });
  }

  async updatePolicy(id: string, data: Partial<InsertPolicy>, orgId: string): Promise<Policy | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(policies).set(data).where(eq(policies.id, id)).returning();
    return updated;
  }
  async createPolicyStatusHistory(policyId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string, organizationId?: string): Promise<void> {
    if (organizationId) {
      const tdb = await getDbForOrg(organizationId);
      await tdb.insert(policyStatusHistory).values({ policyId, fromStatus, toStatus, reason, changedBy });
      return;
    }
    const [policyRow] = await db.select({ organizationId: policies.organizationId }).from(policies).where(eq(policies.id, policyId)).limit(1);
    if (policyRow?.organizationId) {
      const tdb = await getDbForOrg(policyRow.organizationId);
      await tdb.insert(policyStatusHistory).values({ policyId, fromStatus, toStatus, reason, changedBy });
      return;
    }
    await db.insert(policyStatusHistory).values({ policyId, fromStatus, toStatus, reason, changedBy });
  }
  async getReinstatementHistory(organizationId: string, filters?: ReportFilters): Promise<ReinstatementEntry[]> {
    const tdb = await getDbForOrg(organizationId);
    const reinstatementFromStatuses = ["lapsed"];
    const conditions = [
      eq(policies.organizationId, organizationId),
      eq(policyStatusHistory.toStatus, "active"),
      inArray(policyStatusHistory.fromStatus, reinstatementFromStatuses),
    ];
    if (filters?.fromDate) conditions.push(gte(policyStatusHistory.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policyStatusHistory.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else conditions.push(sql`1 = 0`);
    }
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
      .orderBy(desc(policyStatusHistory.createdAt))
      .limit(1000);
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
  async getConversionHistory(organizationId: string, filters?: ReportFilters): Promise<ConversionEntry[]> {
    const tdb = await getDbForOrg(organizationId);
    const conditions = [
      eq(policies.organizationId, organizationId),
      eq(policyStatusHistory.toStatus, "active"),
      eq(policyStatusHistory.fromStatus, "inactive"),
    ];
    if (filters?.fromDate) conditions.push(gte(policyStatusHistory.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(policyStatusHistory.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else conditions.push(sql`1 = 0`);
    }
    const rows = await tdb
      .select({
        policyId: policyStatusHistory.policyId,
        convertedAt: policyStatusHistory.createdAt,
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
      .orderBy(desc(policyStatusHistory.createdAt))
      .limit(1000);
    return rows.map((r) => ({
      policyId: r.policyId,
      policyNumber: r.policyNumber,
      clientId: r.clientId,
      clientName: [r.firstName, r.lastName].filter(Boolean).join(" ") || "—",
      convertedAt: r.convertedAt,
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
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.branchId) conditions.push(eq(policies.branchId, filters.branchId));
    if (filters?.productId) {
      const versionIds = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = versionIds.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else conditions.push(sql`1 = 0`);
    }
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
      .orderBy(desc(policyStatusHistory.createdAt))
      .limit(1000);
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
  async getPolicyMembersBatch(policyIds: string[], orgId: string): Promise<Record<string, PolicyMember[]>> {
    if (policyIds.length === 0) return {};
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select().from(policyMembers).where(inArray(policyMembers.policyId, policyIds));
    const result: Record<string, PolicyMember[]> = {};
    for (const pid of policyIds) result[pid] = [];
    for (const r of rows) {
      if (!result[r.policyId]) result[r.policyId] = [];
      result[r.policyId].push(r);
    }
    return result;
  }
  async countCoveredLives(orgId: string): Promise<{ coveredLives: number; activePolicyCount: number }> {
    const tdb = await getDbForOrg(orgId);
    const [memberResult] = await tdb
      .select({ total: count() })
      .from(policyMembers)
      .innerJoin(policies, eq(policyMembers.policyId, policies.id))
      .where(and(
        eq(policies.organizationId, orgId),
        eq(policies.status, "active"),
        eq(policyMembers.isActive, true),
      ));
    const [policyResult] = await tdb
      .select({ total: count() })
      .from(policies)
      .where(and(eq(policies.organizationId, orgId), eq(policies.status, "active")));
    return {
      coveredLives: memberResult?.total ?? 0,
      activePolicyCount: policyResult?.total ?? 0,
    };
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
  async getPolicyAddOnsBatch(policyIds: string[], orgId: string): Promise<Record<string, PolicyAddOn[]>> {
    if (policyIds.length === 0) return {};
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select().from(policyAddOns).where(inArray(policyAddOns.policyId, policyIds));
    const result: Record<string, PolicyAddOn[]> = {};
    for (const pid of policyIds) result[pid] = [];
    for (const r of rows) {
      if (!result[r.policyId]) result[r.policyId] = [];
      result[r.policyId].push(r);
    }
    return result;
  }
  async setMemberAddOns(policyId: string, policyMemberId: string | null, addOnIds: string[], orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.transaction(async (tx) => {
      // Delete existing add-ons for this member scope
      if (policyMemberId !== null) {
        await tx.delete(policyAddOns).where(
          and(eq(policyAddOns.policyId, policyId), eq(policyAddOns.policyMemberId, policyMemberId))
        );
      } else {
        await tx.delete(policyAddOns).where(
          and(eq(policyAddOns.policyId, policyId), sql`${policyAddOns.policyMemberId} IS NULL`)
        );
      }
      if (addOnIds.length > 0) {
        const seen = new Set<string>();
        const rows = addOnIds.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }).map((addOnId) => ({ policyId, addOnId, policyMemberId }));
        await tx.insert(policyAddOns).values(rows);
      }
    });
  }
  async addPolicyAddOns(policyId: string, addOnIds: string[], orgId: string): Promise<void> {
    if (addOnIds.length === 0) return;
    const tdb = await getDbForOrg(orgId);
    await tdb.insert(policyAddOns).values(addOnIds.map((addOnId) => ({ policyId, addOnId, policyMemberId: null })));
  }

  // ─── Payments ──────────────────────────────────────────────
  async createPaymentTransaction(tx: InsertPaymentTransaction): Promise<PaymentTransaction> {
    const tdb = await getDbForOrg(tx.organizationId);
    let recordedBy = tx.recordedBy ?? undefined;
    if (recordedBy) {
      const inOrgDb = await resolveUserIdForOrgDatabase(recordedBy, tx.organizationId);
      recordedBy = inOrgDb ?? undefined;
    }
    const [created] = await tdb.insert(paymentTransactions).values({ ...tx, recordedBy }).returning();
    return created;
  }
  async getPaymentsByPolicy(policyId: string, orgId: string): Promise<PaymentTransaction[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentTransactions).where(eq(paymentTransactions.policyId, policyId))
      .orderBy(desc(paymentTransactions.receivedAt));
  }
  async getPaymentsByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters, agentId?: string): Promise<(PaymentTransaction & { policyNumber: string | null })[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: SQL[] = [eq(paymentTransactions.organizationId, orgId)];
    const dateCol = paymentTransactions.receivedAt;
    if (filters?.fromDate) conditions.push(gte(dateCol, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(dateCol, new Date(filters.toDate + "T23:59:59.999Z")));
    if (agentId) {
      conditions.push(
        exists(
          tdb.select({ id: policies.id }).from(policies)
            .where(and(eq(policies.id, paymentTransactions.policyId), eq(policies.agentId, agentId)))
        )
      );
    }
    // Join the policy so the policy number travels with each row — the client list is
    // paginated and can't reliably resolve policyId -> policyNumber on its own.
    return tdb
      .select({ ...getTableColumns(paymentTransactions), policyNumber: policies.policyNumber })
      .from(paymentTransactions)
      .leftJoin(policies, eq(policies.id, paymentTransactions.policyId))
      .where(and(...conditions))
      .orderBy(desc(paymentTransactions.receivedAt)).limit(limit).offset(offset);
  }
  async getPaymentsSummary(orgId: string, filters?: ReportFilters, agentId?: string): Promise<{ totalCount: number; clearedByCurrency: { currency: string; count: number; total: string }[] }> {
    const tdb = await getDbForOrg(orgId);
    const conditions: SQL[] = [eq(paymentTransactions.organizationId, orgId)];
    const dateCol = paymentTransactions.receivedAt;
    if (filters?.fromDate) conditions.push(gte(dateCol, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(dateCol, new Date(filters.toDate + "T23:59:59.999Z")));
    if (agentId) {
      conditions.push(
        exists(
          tdb.select({ id: policies.id }).from(policies)
            .where(and(eq(policies.id, paymentTransactions.policyId), eq(policies.agentId, agentId)))
        )
      );
    }
    const [{ value: totalCount }] = await tdb
      .select({ value: count() })
      .from(paymentTransactions)
      .where(and(...conditions));
    const clearedRows = await tdb
      .select({ currency: paymentTransactions.currency, value: count(), total: sum(paymentTransactions.amount) })
      .from(paymentTransactions)
      .where(and(...conditions, eq(paymentTransactions.status, "cleared")))
      .groupBy(paymentTransactions.currency);
    return {
      totalCount: Number(totalCount),
      clearedByCurrency: clearedRows.map((r) => ({ currency: r.currency, count: Number(r.value), total: r.total ?? "0.00" })),
    };
  }
  async getPaymentTransaction(id: string, orgId: string): Promise<PaymentTransaction | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [tx] = await tdb.select().from(paymentTransactions).where(eq(paymentTransactions.id, id));
    return tx;
  }
  async hasPlatformReceivableForTransaction(orgId: string, transactionId: string): Promise<boolean> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb
      .select({ id: platformReceivables.id })
      .from(platformReceivables)
      .where(
        and(eq(platformReceivables.organizationId, orgId), eq(platformReceivables.sourceTransactionId, transactionId)),
      )
      .limit(1);
    return !!row;
  }
  async hasPlatformReceivableForServiceReceipt(orgId: string, serviceReceiptId: string): Promise<boolean> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb
      .select({ id: platformReceivables.id })
      .from(platformReceivables)
      .where(
        and(eq(platformReceivables.organizationId, orgId), eq(platformReceivables.sourceServiceReceiptId, serviceReceiptId)),
      )
      .limit(1);
    return !!row;
  }
  async hasCommissionLedgerForTransaction(orgId: string, transactionId: string): Promise<boolean> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb
      .select({ id: commissionLedgerEntries.id })
      .from(commissionLedgerEntries)
      .where(
        and(eq(commissionLedgerEntries.organizationId, orgId), eq(commissionLedgerEntries.transactionId, transactionId)),
      )
      .limit(1);
    return !!row;
  }
  async getPaymentTransactionByIdempotencyKey(key: string, orgId: string): Promise<PaymentTransaction | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [tx] = await tdb.select().from(paymentTransactions)
      .where(and(eq(paymentTransactions.idempotencyKey, key), eq(paymentTransactions.organizationId, orgId)));
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
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, receipt_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET receipt_next = org_policy_sequences.receipt_next + 1
      RETURNING receipt_next
    `);
    const nextVal = (result as unknown as { rows?: { receipt_next: number }[] }).rows?.[0]?.receipt_next ?? 1;
    return String(nextVal);
  }
  async getReceiptReportByOrg(orgId: string, limit: number, offset: number, filters?: ReportFilters): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: any[] = [eq(paymentReceipts.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(paymentReceipts.issuedAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(paymentReceipts.issuedAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.branchId) conditions.push(eq(paymentReceipts.branchId, filters.branchId));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));

    const rows = await tdb
      .select({
        receiptId: paymentReceipts.id,
        receiptNumber: paymentReceipts.receiptNumber,
        receiptBranchId: paymentReceipts.branchId,
        issuedByUserId: paymentReceipts.issuedByUserId,
        metadataJson: paymentReceipts.metadataJson,
        amount: paymentReceipts.amount,
        currency: paymentReceipts.currency,
        paymentChannel: paymentReceipts.paymentChannel,
        issuedAt: paymentReceipts.issuedAt,
        status: paymentReceipts.status,
        createdAt: paymentReceipts.createdAt,
        policyId: paymentReceipts.policyId,
        clientId: paymentReceipts.clientId,
        policyNumber: policies.policyNumber,
        premiumAmount: policies.premiumAmount,
        policyStatus: policies.status,
        paymentSchedule: policies.paymentSchedule,
        policyCurrency: policies.currency,
        inceptionDate: policies.inceptionDate,
        policyBranchId: policies.branchId,
        productVersionId: policies.productVersionId,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientTitle: clients.title,
        clientNationalId: clients.nationalId,
        clientPhone: clients.phone,
        agentId: policies.agentId,
        agentDisplayName: users.displayName,
        agentEmail: users.email,
        groupName: groups.name,
        transactionId: paymentTransactions.id,
        txRecordedBy: paymentTransactions.recordedBy,
        txBranchId: paymentTransactions.branchId,
        txReceivedAt: paymentTransactions.receivedAt,
        txPaymentMethod: paymentTransactions.paymentMethod,
        txReference: paymentTransactions.reference,
        txPaynowReference: paymentTransactions.paynowReference,
        txNotes: paymentTransactions.notes,
        merchantReference: paymentIntents.merchantReference,
      })
      .from(paymentReceipts)
      .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
      .leftJoin(clients, eq(paymentReceipts.clientId, clients.id))
      .leftJoin(users, eq(policies.agentId, users.id))
      .leftJoin(groups, eq(policies.groupId, groups.id))
      .leftJoin(paymentIntents, eq(paymentReceipts.paymentIntentId, paymentIntents.id))
      .leftJoin(paymentTransactions, sql`${paymentTransactions.id} = (${paymentReceipts.metadataJson}->>'transactionId')::uuid`)
      .where(and(...conditions))
      .orderBy(desc(paymentReceipts.issuedAt))
      .limit(limit)
      .offset(offset);

    const branchIds = new Set<string>();
    const pvIds = new Set<string>();
    rows.forEach((r: any) => {
      if (r.receiptBranchId) branchIds.add(r.receiptBranchId);
      if (r.policyBranchId) branchIds.add(r.policyBranchId);
      if (r.txBranchId) branchIds.add(r.txBranchId);
      if (r.productVersionId) pvIds.add(r.productVersionId);
    });

    const branchMap: Record<string, string> = {};
    if (branchIds.size > 0) {
      const branchRows = await tdb.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, Array.from(branchIds)));
      branchRows.forEach((b) => { branchMap[b.id] = b.name; });
    }

    const productMap: Record<string, string> = {};
    if (pvIds.size > 0) {
      const pvRows = await tdb
        .select({ pvId: productVersions.id, productName: products.name })
        .from(productVersions)
        .innerJoin(products, eq(productVersions.productId, products.id))
        .where(inArray(productVersions.id, Array.from(pvIds)));
      pvRows.forEach((r) => { productMap[r.pvId] = r.productName; });
    }

    const policyIdsInPage = Array.from(new Set(rows.map((r: any) => r.policyId).filter(Boolean)));
    const receiptCountConditions: SQL[] = [
      eq(paymentReceipts.organizationId, orgId),
      eq(paymentReceipts.status, "issued"),
      inArray(paymentReceipts.policyId, policyIdsInPage),
    ];
    if (filters?.branchId) receiptCountConditions.push(eq(paymentReceipts.branchId, filters.branchId));
    if (filters?.fromDate) receiptCountConditions.push(gte(paymentReceipts.issuedAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) receiptCountConditions.push(lte(paymentReceipts.issuedAt, new Date(filters.toDate + "T23:59:59.999Z")));
    const receiptCountRows = policyIdsInPage.length
      ? await tdb
        .select({ policyId: paymentReceipts.policyId, cnt: count() })
        .from(paymentReceipts)
        .where(and(...receiptCountConditions))
        .groupBy(paymentReceipts.policyId)
      : [];
    const receiptCountByPolicy = new Map<string, number>();
    for (const rc of receiptCountRows) receiptCountByPolicy.set(rc.policyId, Number(rc.cnt));

    const clientIdsInPage = Array.from(new Set(rows.map((r: any) => r.clientId).filter(Boolean)));

    const defaultPayByClient = new Map<string, { methodType: string; provider: string | null }>();
    if (clientIdsInPage.length > 0) {
      const cpmRows = await tdb
        .select({
          clientId: clientPaymentMethods.clientId,
          methodType: clientPaymentMethods.methodType,
          provider: clientPaymentMethods.provider,
        })
        .from(clientPaymentMethods)
        .where(
          and(
            inArray(clientPaymentMethods.clientId, clientIdsInPage),
            eq(clientPaymentMethods.isDefault, true),
            eq(clientPaymentMethods.isActive, true),
          ),
        );
      for (const c of cpmRows) {
        if (!defaultPayByClient.has(c.clientId)) {
          defaultPayByClient.set(c.clientId, { methodType: c.methodType, provider: c.provider });
        }
      }
    }

    const userIds = new Set<string>();
    for (const r of rows as any[]) {
      if (r.issuedByUserId) userIds.add(r.issuedByUserId);
      if (r.txRecordedBy) userIds.add(r.txRecordedBy);
    }
    const userLabelById = new Map<string, string>();
    if (userIds.size > 0) {
      const urows = await tdb
        .select({ id: users.id, displayName: users.displayName, email: users.email })
        .from(users)
        .where(inArray(users.id, Array.from(userIds)));
      for (const u of urows) {
        userLabelById.set(u.id, (u.displayName || u.email || "").trim());
      }
    }

    const memberNumberByPolicy: Record<string, string> = {};
    if (policyIdsInPage.length > 0) {
      const members = await tdb
        .select({ policyId: policyMembers.policyId, memberNumber: policyMembers.memberNumber })
        .from(policyMembers)
        .where(and(inArray(policyMembers.role, ["principal", "policy_holder"]), inArray(policyMembers.policyId, policyIdsInPage)));
      for (const m of members) {
        if (m.memberNumber && !memberNumberByPolicy[m.policyId]) memberNumberByPolicy[m.policyId] = m.memberNumber;
      }
    }

    const fdate = filters?.fromDate ?? "";
    const tdate = filters?.toDate ?? "";

    const toICalDTSTAMP = (d: Date) => {
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      const h = String(d.getUTCHours()).padStart(2, "0");
      const mi = String(d.getUTCMinutes()).padStart(2, "0");
      const s = String(d.getUTCSeconds()).padStart(2, "0");
      return `${y}${mo}${day}T${h}${mi}${s}Z`;
    };

    return rows.map((r: any) => {
      const issuedDate = r.issuedAt ? new Date(r.issuedAt) : null;
      const productName = r.productVersionId ? productMap[r.productVersionId] || null : null;
      const periodPremium = parseFloat(String(r.premiumAmount ?? "0"));
      const amountNum = parseFloat(String(r.amount ?? "0"));
      const MonthsPaid =
        periodPremium > 0 && Number.isFinite(amountNum) ? Math.max(1, Math.floor(amountNum / periodPremium)) : (amountNum > 0 ? 1 : 0);
      const MonthsPaidInAdvance =
        periodPremium > 0 && Number.isFinite(amountNum) ? Math.max(0, Math.floor(amountNum / periodPremium) - 1) : 0;
      const meta = r.metadataJson as { internalReference?: string } | null;
      const internalRef =
        (meta?.internalReference && String(meta.internalReference)) ||
        (r.txReference && String(r.txReference)) ||
        (r.txPaynowReference && String(r.txPaynowReference)) ||
        (r.merchantReference && String(r.merchantReference)) ||
        (r.receiptNumber && String(r.receiptNumber)) ||
        "";
      const InternalRe = internalRef;
      const InternalReferenceNumber = internalRef;
      const policyBranchName = r.policyBranchId ? branchMap[r.policyBranchId] || "" : "";
      const dp = r.clientId ? defaultPayByClient.get(r.clientId) : undefined;
      const DefaultPay = dp?.methodType ?? "";
      const DebitMethod = dp?.provider ?? "";
      const PaymentMethod = String(r.paymentChannel || r.txPaymentMethod || "");
      const DatePaid = issuedDate ? issuedDate.toISOString().split("T")[0] : "";
      const Transaction = [r.transactionId, r.txReceivedAt ? new Date(r.txReceivedAt).toISOString() : ""].filter(Boolean).join(" ");
      const PremiumDue = `${r.policyCurrency || r.currency || "USD"} ${r.premiumAmount ?? ""}`.trim();
      const PaymentBy = [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ").trim();
      const ManualUser = r.issuedByUserId ? (userLabelById.get(r.issuedByUserId) || "") : "";
      const CollectedBy = r.txRecordedBy ? (userLabelById.get(r.txRecordedBy) || "") : "";
      const CapturedBy = CollectedBy || ManualUser;
      const inceptionStr = r.inceptionDate ? String(r.inceptionDate) : "";
      const ActualPen =
        periodPremium > 0 && Number.isFinite(amountNum) ? (amountNum - periodPremium).toFixed(2) : "";
      const agentsName = r.agentDisplayName || r.agentEmail || "";
      const ReceiptCount = receiptCountByPolicy.get(r.policyId) ?? 0;
      const DTSTAMP = issuedDate ? toICalDTSTAMP(issuedDate) : "";
      return {
        ...r,
        receiptBranchName: r.receiptBranchId ? branchMap[r.receiptBranchId] || null : null,
        paymentBranchName: r.txBranchId ? branchMap[r.txBranchId] || null : null,
        productName,
        /** Daily receipts (UTC DTSTAMP) + banking-style columns */
        DTSTAMP,
        agentsName,
        MonthsPaidInAdvance,
        policy_number: r.policyNumber ?? "",
        surname: r.clientLastName ?? "",
        InternalReferenceNumber,
        Product_Name: productName ?? "",
        Inception_Date: inceptionStr,
        MonthNumber: issuedDate ? issuedDate.getMonth() + 1 : "",
        YearNumber: issuedDate ? issuedDate.getFullYear() : "",
        ReceiptCount,
        fdate,
        tdate,
        /** Policy receipts report (spreadsheet columns) */
        Total: `${r.currency || "USD"} ${r.amount ?? ""}`.trim(),
        PaymentBy,
        ReceiptNumber: r.receiptNumber ?? "",
        ManualUser,
        DatePaid,
        Transaction,
        PremiumDue,
        Currency: r.currency ?? "",
        AmountCollected: r.amount ?? "",
        MonthsPaid,
        Remarks: r.txNotes ?? "",
        PaymentMethod,
        DefaultPay,
        DebitMethod,
        ReceiptMonth: issuedDate ? issuedDate.getMonth() + 1 : "",
        ReceiptYear: issuedDate ? issuedDate.getFullYear() : "",
        policy_num: r.policyNumber ?? "",
        PolicyBranch: policyBranchName,
        Inception_: inceptionStr,
        Sstatus: r.policyStatus ?? "",
        InternalRe,
        Product_N: productName ?? "",
        CollectedBy,
        fromDate: fdate,
        toDate: tdate,
        GroupName: r.groupName ?? "",
        InceptionD: inceptionStr,
        MemberID: memberNumberByPolicy[r.policyId] ?? "",
        ActualPen,
        ReceiptID: r.receiptId ?? "",
        CapturedBy,
      };
    });
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
  async getPaymentIntentsByOrg(orgId: string, limit = 100, agentId?: string): Promise<(PaymentIntent & { policyNumber: string | null })[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: SQL[] = [eq(paymentIntents.organizationId, orgId)];
    if (agentId) {
      conditions.push(
        exists(
          tdb.select({ id: policies.id }).from(policies)
            .where(and(eq(policies.id, paymentIntents.policyId), eq(policies.agentId, agentId)))
        )
      );
    }
    // Join the policy so the policy number travels with each intent — the client list is
    // paginated and can't reliably resolve policyId -> policyNumber on its own.
    return tdb
      .select({ ...getTableColumns(paymentIntents), policyNumber: policies.policyNumber })
      .from(paymentIntents)
      .leftJoin(policies, eq(policies.id, paymentIntents.policyId))
      .where(and(...conditions))
      .orderBy(desc(paymentIntents.createdAt)).limit(limit);
  }
  async getPaymentIntentsByClient(clientId: string, orgId: string): Promise<PaymentIntent[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentIntents).where(eq(paymentIntents.clientId, clientId))
      .orderBy(desc(paymentIntents.createdAt));
  }
  async getPaymentIntentsByPolicy(policyId: string, orgId: string): Promise<PaymentIntent[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentIntents).where(and(eq(paymentIntents.organizationId, orgId), eq(paymentIntents.policyId, policyId)))
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
  async createPaymentLink(link: InsertPaymentLink): Promise<PaymentLink> {
    const tdb = await getDbForOrg(link.organizationId);
    const [created] = await tdb.insert(paymentLinks).values(link).returning();
    // Central routing pointer so the public /pay/:token page (no session) can resolve an org
    // before it can reach that org's own tenant DB — see the paymentLinkTokens schema comment.
    await db.insert(paymentLinkTokens).values({ token: link.token, organizationId: link.organizationId });
    return created;
  }
  async resolveOrgIdForPaymentLinkToken(token: string): Promise<string | undefined> {
    const [row] = await db.select().from(paymentLinkTokens).where(eq(paymentLinkTokens.token, token));
    return row?.organizationId;
  }
  async getPaymentLinkByToken(token: string, orgId: string): Promise<PaymentLink | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(paymentLinks).where(and(eq(paymentLinks.token, token), eq(paymentLinks.organizationId, orgId)));
    return row;
  }
  async getPaymentLinksByPolicy(policyId: string, orgId: string): Promise<PaymentLink[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentLinks).where(and(eq(paymentLinks.policyId, policyId), eq(paymentLinks.organizationId, orgId)))
      .orderBy(desc(paymentLinks.createdAt));
  }
  async updatePaymentLink(id: string, data: Partial<InsertPaymentLink>, orgId: string): Promise<PaymentLink | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(paymentLinks).set(data).where(and(eq(paymentLinks.id, id), eq(paymentLinks.organizationId, orgId))).returning();
    return updated;
  }
  async createPaymentEvent(event: InsertPaymentEvent): Promise<PaymentEvent> {
    // Always route to the same DB as the intent — use event.organizationId directly to avoid
    // a cross-DB lookup that fails for tenant-isolated orgs where payment_intents lives in tdb.
    const orgId = event.organizationId;
    if (orgId) {
      const tdb = await getDbForOrg(orgId);
      const [created] = await tdb.insert(paymentEvents).values(event).returning();
      return created;
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
      const [intentRow] = await db.select({ organizationId: paymentIntents.organizationId })
        .from(paymentIntents)
        .where(eq(paymentIntents.id, intentId))
        .limit(1);
      if (intentRow?.organizationId) {
        const tdb = await getDbForOrg(intentRow.organizationId);
        const [created] = await tdb.insert(paymentReceipts).values(receipt).returning();
        return created;
      }
    }
    const tdb = await getDbForOrg(receipt.organizationId);
    const [created] = await tdb.insert(paymentReceipts).values(receipt).returning();
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
  async allocatePaymentReceiptNumberInTx(tx: OrgDrizzleDb, orgId: string): Promise<string> {
    const result = await tx.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, payment_receipt_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET payment_receipt_next = org_policy_sequences.payment_receipt_next + 1
      RETURNING payment_receipt_next
    `);
    const rows = (result as unknown as { rows?: { payment_receipt_next: number }[] }).rows;
    const nextVal = rows?.[0]?.payment_receipt_next ?? 1;
    return String(nextVal);
  }

  /**
   * Allocates the next payment receipt number on this org's data database.
   * When you already hold a transaction (e.g. payment + receipt), call `allocatePaymentReceiptNumberInTx` instead
   * so the sequence bump rolls back with the rest of the work.
   *
   * **Tenant migration:** If an org moved from shared DB to an isolated tenant DB, copy or reconcile
   * `org_policy_sequences.payment_receipt_next` onto the tenant before go-live so numbers stay monotonic.
   */
  async getNextPaymentReceiptNumber(orgId: string): Promise<string> {
    return withOrgTransaction(orgId, async (tx) => this.allocatePaymentReceiptNumberInTx(tx, orgId));
  }
  async updatePaymentReceipt(id: string, data: Partial<InsertPaymentReceipt>, orgId: string): Promise<PaymentReceipt | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(paymentReceipts).set(data).where(eq(paymentReceipts.id, id)).returning();
    return updated;
  }
  async updatePaymentTransaction(id: string, data: Partial<InsertPaymentTransaction>, orgId: string): Promise<PaymentTransaction | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(paymentTransactions).set(data).where(eq(paymentTransactions.id, id)).returning();
    return updated;
  }
  async deletePolicy(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(policies)
      .set({ deletedAt: new Date() })
      .where(and(eq(policies.id, id), eq(policies.organizationId, orgId)));
  }
  async deletePaymentTransaction(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(paymentTransactions)
      .set({ deletedAt: new Date() })
      .where(and(eq(paymentTransactions.id, id), eq(paymentTransactions.organizationId, orgId)));
  }
  async deleteReceipt(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(receipts).where(eq(receipts.id, id));
  }
  async deletePaymentReceipt(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(paymentReceipts).where(eq(paymentReceipts.id, id));
  }

  // ─── Claims ────────────────────────────────────────────────
  async getClaimsByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters): Promise<(Claim & { funeralCaseId: string | null; funeralCaseNumber: string | null })[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(claims.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(claims.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(claims.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    // Left-joined (not a separate per-claim lookup) so the claims list carries its linked
    // funeral case — if any — in one query, for the Claims<->Funerals cross-link in the UI.
    return tdb
      .select({ ...getTableColumns(claims), funeralCaseId: funeralCases.id, funeralCaseNumber: funeralCases.caseNumber })
      .from(claims)
      .leftJoin(funeralCases, eq(funeralCases.claimId, claims.id))
      .where(and(...conditions))
      .orderBy(desc(claims.createdAt)).limit(limit).offset(offset);
  }

  async getClaimsReportByOrg(orgId: string, limit = 200, offset = 0, filters?: ReportFilters & { status?: string }): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: SQL[] = [eq(claims.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(claims.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(claims.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.status) conditions.push(eq(claims.status, filters.status));
    if (filters?.branchId) conditions.push(eq(claims.branchId, filters.branchId));
    return tdb
      .select({
        claimId: claims.id,
        claimNumber: claims.claimNumber,
        claimType: claims.claimType,
        status: claims.status,
        currency: claims.currency,
        approvedAmount: claims.cashInLieuAmount,
        deceasedName: claims.deceasedName,
        deceasedRelationship: claims.deceasedRelationship,
        dateOfDeath: claims.dateOfDeath,
        causeOfDeath: claims.causeOfDeath,
        createdAt: claims.createdAt,
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        policyStatus: policies.status,
        clientId: clients.id,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientNationalId: clients.nationalId,
        clientPhone: clients.phone,
        clientEmail: clients.email,
        branchName: branches.name,
      })
      .from(claims)
      .innerJoin(policies, eq(claims.policyId, policies.id))
      .innerJoin(clients, eq(claims.clientId, clients.id))
      .leftJoin(branches, eq(claims.branchId, branches.id))
      .where(and(...conditions))
      .orderBy(desc(claims.createdAt))
      .limit(limit)
      .offset(offset);
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
    const [claim] = await tdb.select().from(claims).where(and(eq(claims.id, id), eq(claims.organizationId, orgId)));
    return claim;
  }
  async createClaim(claim: InsertClaim): Promise<Claim> {
    const tdb = await getDbForOrg(claim.organizationId);
    const [created] = await tdb.insert(claims).values(claim).returning();
    return created;
  }
  async updateClaim(id: string, data: Partial<InsertClaim>, orgId: string): Promise<Claim | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb
      .update(claims)
      .set(data)
      .where(and(eq(claims.id, id), eq(claims.organizationId, orgId)))
      .returning();
    return updated;
  }
  /** Resolve the tenant DB that owns a claim. Prefers the supplied orgId; falls back to scanning orgs. */
  private async resolveClaimOrgDb(claimId: string, orgId?: string): Promise<OrgDataDb | undefined> {
    if (orgId) {
      const tdb = await getDbForOrg(orgId);
      const [c] = await tdb
        .select({ id: claims.id })
        .from(claims)
        .where(and(eq(claims.id, claimId), eq(claims.organizationId, orgId)))
        .limit(1);
      return c ? tdb : undefined;
    }
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (const org of orgs) {
      const tdb = await getDbForOrg(org.id);
      const [c] = await tdb.select({ id: claims.id }).from(claims).where(eq(claims.id, claimId)).limit(1);
      if (c) return tdb;
    }
    return undefined;
  }
  async createClaimStatusHistory(claimId: string, fromStatus: string | null, toStatus: string, reason?: string, changedBy?: string, orgId?: string): Promise<void> {
    const tdb = (await this.resolveClaimOrgDb(claimId, orgId)) ?? db;
    await tdb.insert(claimStatusHistory).values({ claimId, fromStatus, toStatus, reason, changedBy });
  }
  async getClaimDocuments(claimId: string, orgId: string): Promise<ClaimDocument[]> {
    // claim_documents has no organization_id column, so isolate via the parent claim.
    const tdb = await this.resolveClaimOrgDb(claimId, orgId);
    if (!tdb) return [];
    return tdb.select().from(claimDocuments).where(eq(claimDocuments.claimId, claimId));
  }
  async createClaimDocument(doc: InsertClaimDocument, orgId: string): Promise<ClaimDocument> {
    const tdb = await this.resolveClaimOrgDb(doc.claimId, orgId);
    if (!tdb) throw new Error("Claim not found for organization");
    const [created] = await tdb.insert(claimDocuments).values(doc).returning();
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

  async getFeedbackByOrg(orgId: string, limit = 50, offset = 0, filters?: { search?: string; status?: string; type?: string }): Promise<{ rows: ClientFeedback[]; total: number }> {
    const tdb = await getDbForOrg(orgId);
    const conditions: SQL[] = [eq(clientFeedback.organizationId, orgId)];
    if (filters?.status) conditions.push(eq(clientFeedback.status, filters.status));
    if (filters?.type) conditions.push(eq(clientFeedback.type, filters.type));
    if (filters?.search) {
      conditions.push(or(
        ilike(clientFeedback.subject, `%${filters.search}%`),
        ilike(clientFeedback.message, `%${filters.search}%`),
      )!);
    }
    const where = and(...conditions);
    const [{ count }] = await tdb.select({ count: sql<number>`count(*)::int` }).from(clientFeedback).where(where);
    const rows = await tdb.select().from(clientFeedback).where(where)
      .orderBy(desc(clientFeedback.createdAt)).limit(limit).offset(offset);
    return { rows, total: count };
  }

  async updateFeedbackStatus(id: string, status: string, orgId: string): Promise<ClientFeedback | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(clientFeedback)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(clientFeedback.id, id), eq(clientFeedback.organizationId, orgId)))
      .returning();
    return updated;
  }

  // ─── Funeral Cases ─────────────────────────────────────────
  async getFuneralCasesByOrg(orgId: string, limit = 50, offset = 0, filters?: ReportFilters & { q?: string }): Promise<FuneralCase[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(funeralCases.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(funeralCases.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(funeralCases.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.q) {
      const term = `%${filters.q}%`;
      conditions.push(or(ilike(funeralCases.caseNumber, term), ilike(funeralCases.deceasedName, term))!);
    }
    return tdb.select().from(funeralCases).where(and(...conditions))
      .orderBy(desc(funeralCases.createdAt)).limit(limit).offset(offset);
  }
  async getFuneralCase(id: string, orgId: string): Promise<FuneralCase | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [fc] = await tdb.select().from(funeralCases).where(eq(funeralCases.id, id));
    return fc;
  }
  async getFuneralCaseByCaseNumber(caseNumber: string, orgId: string): Promise<FuneralCase | undefined> {
    const tdb = await getDbForOrg(orgId);
    // Case-insensitive exact match — case numbers are server-generated uppercase, but a
    // manually-typed lookup (from memory, a phone call, etc.) shouldn't 404 on casing alone.
    // sql`upper(...)` rather than ilike() so user input can't be interpreted as a wildcard pattern.
    const [fc] = await tdb.select().from(funeralCases).where(and(eq(funeralCases.organizationId, orgId), eq(sql`upper(${funeralCases.caseNumber})`, caseNumber.toUpperCase())));
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
  async getFleetVehicleById(id: string, orgId: string): Promise<FleetVehicle | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [v] = await tdb.select().from(fleetVehicles).where(and(eq(fleetVehicles.id, id), eq(fleetVehicles.organizationId, orgId)));
    return v;
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
  async getFuelLogs(orgId: string, vehicleId?: string): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(fleetFuelLogs.organizationId, orgId)];
    if (vehicleId) conditions.push(eq(fleetFuelLogs.vehicleId, vehicleId));
    return tdb.select().from(fleetFuelLogs).where(and(...conditions)).orderBy(desc(fleetFuelLogs.filledAt));
  }
  async getMaintenanceRecords(orgId: string, vehicleId?: string): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(fleetMaintenance.organizationId, orgId)];
    if (vehicleId) conditions.push(eq(fleetMaintenance.vehicleId, vehicleId));
    return tdb.select().from(fleetMaintenance).where(and(...conditions)).orderBy(desc(fleetMaintenance.scheduledDate));
  }
  async getDriverAssignments(orgId: string): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(driverAssignments)
      .innerJoin(fleetVehicles, eq(driverAssignments.vehicleId, fleetVehicles.id))
      .where(eq(fleetVehicles.organizationId, orgId))
      .orderBy(desc(driverAssignments.startDate));
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
  async getCommissionLedgerByOrg(orgId: string): Promise<CommissionLedgerEntry[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(commissionLedgerEntries)
      .where(eq(commissionLedgerEntries.organizationId, orgId))
      .orderBy(desc(commissionLedgerEntries.createdAt))
      .limit(500);
  }
  async createCommissionLedgerEntry(entry: InsertCommissionLedgerEntry): Promise<CommissionLedgerEntry> {
    const tdb = await getDbForOrg(entry.organizationId);
    const [created] = await tdb.insert(commissionLedgerEntries).values(entry).returning();
    return created;
  }
  async getCommissionLedgerDetailedByOrg(orgId: string, agentId?: string): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(commissionLedgerEntries.organizationId, orgId)];
    if (agentId) conditions.push(eq(commissionLedgerEntries.agentId, agentId));
    const rows = await tdb
      .select({
        id: commissionLedgerEntries.id,
        entryType: commissionLedgerEntries.entryType,
        amount: commissionLedgerEntries.amount,
        currency: commissionLedgerEntries.currency,
        description: commissionLedgerEntries.description,
        status: commissionLedgerEntries.status,
        createdAt: commissionLedgerEntries.createdAt,
        policyId: commissionLedgerEntries.policyId,
        transactionId: commissionLedgerEntries.transactionId,
        agentId: commissionLedgerEntries.agentId,
        policyNumber: policies.policyNumber,
        policyStatus: policies.status,
        clientId: policies.clientId,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientPhone: clients.phone,
        agentDisplayName: users.displayName,
        agentEmail: users.email,
        paymentDate: paymentTransactions.createdAt,
        paymentMethod: paymentTransactions.paymentMethod,
      })
      .from(commissionLedgerEntries)
      .leftJoin(policies, eq(commissionLedgerEntries.policyId, policies.id))
      .leftJoin(clients, eq(policies.clientId, clients.id))
      .leftJoin(users, eq(commissionLedgerEntries.agentId, users.id))
      .leftJoin(paymentTransactions, eq(commissionLedgerEntries.transactionId, paymentTransactions.id))
      .where(and(...conditions))
      .orderBy(desc(commissionLedgerEntries.createdAt))
      .limit(1000);
    return rows;
  }

  async getCommissionReportByOrg(orgId: string, filters?: ReportFilters): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: SQL[] = [eq(commissionLedgerEntries.organizationId, orgId)];
    if (filters?.fromDate) {
      conditions.push(gte(commissionLedgerEntries.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    }
    if (filters?.toDate) {
      conditions.push(lte(commissionLedgerEntries.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    }
    if (filters?.agentId) conditions.push(eq(commissionLedgerEntries.agentId, filters.agentId));
    if (filters?.branchId) {
      const branchId = filters.branchId;
      conditions.push(
        sql`(${commissionLedgerEntries.policyId} is null or ${policies.branchId} = ${branchId})`,
      );
    }
    const rows = await tdb
      .select({
        entryType: commissionLedgerEntries.entryType,
        amount: commissionLedgerEntries.amount,
        policyId: commissionLedgerEntries.policyId,
        policyGroupId: policies.groupId,
        paymentMethod: paymentTransactions.paymentMethod,
        agentId: commissionLedgerEntries.agentId,
        agentDisplayName: users.displayName,
        agentEmail: users.email,
      })
      .from(commissionLedgerEntries)
      .leftJoin(policies, eq(commissionLedgerEntries.policyId, policies.id))
      .leftJoin(users, eq(commissionLedgerEntries.agentId, users.id))
      .leftJoin(paymentTransactions, eq(commissionLedgerEntries.transactionId, paymentTransactions.id))
      .where(and(...conditions))
      .orderBy(desc(commissionLedgerEntries.createdAt))
      .limit(50_000);

    type Agg = {
      agentName: string;
      policies: Set<string>;
      groupPolicies: Set<string>;
      individPolicies: Set<string>;
      sumGroupsCommission: number;
      sumIndividualsCommission: number;
      sumBasic: number;
      sumClawb: number;
      sumOvertim: number;
      sumCash: number;
      sumAll: number;
    };
    const byAgent = new Map<string, Agg>();
    const getAgg = (agentId: string, name: string): Agg => {
      let a = byAgent.get(agentId);
      if (!a) {
        a = {
          agentName: name,
          policies: new Set(),
          groupPolicies: new Set(),
          individPolicies: new Set(),
          sumGroupsCommission: 0,
          sumIndividualsCommission: 0,
          sumBasic: 0,
          sumClawb: 0,
          sumOvertim: 0,
          sumCash: 0,
          sumAll: 0,
        };
        byAgent.set(agentId, a);
      }
      return a;
    };

    for (const r of rows as any[]) {
      const agentId = r.agentId as string;
      if (!agentId) continue;
      const name = (r.agentDisplayName || r.agentEmail || "").trim() || agentId;
      const a = getAgg(agentId, name);
      const amt = parseFloat(String(r.amount ?? 0)) || 0;
      a.sumAll += amt;
      const et = String(r.entryType || "");
      if (et === "first_months" || et === "recurring") a.sumBasic += amt;
      if (et === "clawback" || et === "rollback") a.sumClawb += amt;
      if (et === "clawback_reversal") a.sumOvertim += amt;
      const pm = String(r.paymentMethod || "").toLowerCase();
      if (pm === "cash") a.sumCash += amt;
      const pid = r.policyId as string | null;
      if (pid) {
        a.policies.add(pid);
        if (r.policyGroupId) {
          a.groupPolicies.add(pid);
          a.sumGroupsCommission += amt;
        } else {
          a.individPolicies.add(pid);
          a.sumIndividualsCommission += amt;
        }
      }
    }

    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

    const out = Array.from(byAgent.entries()).map(([agentId, a]) => {
      const total = a.sumAll;
      const net = total;
      return {
        agentId,
        agentName: a.agentName,
        numberOfPolicies: a.policies.size,
        groupsCount: a.groupPolicies.size,
        groupsCommission: fmt(a.sumGroupsCommission),
        individualsCount: a.individPolicies.size,
        individualsCommission: fmt(a.sumIndividualsCommission),
        investment: fmt(0),
        clawback: fmt(a.sumClawb),
        callCenter: fmt(0),
        trips: fmt(0),
        cashSettlement: fmt(a.sumCash),
        basic: fmt(a.sumBasic),
        overtime: fmt(a.sumOvertim),
        total: fmt(total),
        paye: "",
        taxLevy: "",
        credit: "",
        advance: "",
        policyDeduction: "",
        medicalAidDeduction: "",
        unpaidMonths: "",
        netPay: fmt(net),
      };
    });
    out.sort((a, b) => a.agentName.localeCompare(b.agentName));
    return out;
  }

  async getCommissionPaymentReportByOrg(orgId: string, limit: number, offset: number, filters?: ReportFilters & { agentId?: string }): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const policyBranches = alias(branches, "policy_branches");
    const paymentBranches = alias(branches, "payment_branches");
    const commissionAlias = alias(commissionLedgerEntries, "commission_alias");

    const conditions: SQL[] = [
      eq(paymentReceipts.organizationId, orgId),
      eq(paymentReceipts.status, "issued"),
      isNull(paymentReceipts.deletedAt),
    ];
    if (filters?.fromDate) conditions.push(gte(paymentReceipts.issuedAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(paymentReceipts.issuedAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.branchId) conditions.push(eq(paymentReceipts.branchId, filters.branchId));
    if (filters?.agentId) conditions.push(eq(policies.agentId, filters.agentId));
    if (filters?.productId) {
      const vids = await tdb.select({ id: productVersions.id }).from(productVersions).where(eq(productVersions.productId, filters.productId!));
      const ids = vids.map((v) => v.id);
      if (ids.length > 0) conditions.push(inArray(policies.productVersionId, ids));
      else return [];
    }

    const rows = await tdb
      .select({
        receiptId: paymentReceipts.id,
        receiptNumber: paymentReceipts.receiptNumber,
        amountPaid: paymentReceipts.amount,
        currency: paymentReceipts.currency,
        periodFrom: paymentReceipts.periodFrom,
        periodTo: paymentReceipts.periodTo,
        issuedAt: paymentReceipts.issuedAt,
        paymentChannel: paymentReceipts.paymentChannel,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientNationalId: clients.nationalId,
        clientPhone: clients.phone,
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        policyPremium: policies.premiumAmount,
        policyStatus: policies.status,
        agentDisplayName: users.displayName,
        agentEmail: users.email,
        policyBranchName: policyBranches.name,
        paymentBranchName: paymentBranches.name,
        commissionAmount: commissionAlias.amount,
        commissionType: commissionAlias.entryType,
      })
      .from(paymentReceipts)
      .innerJoin(clients, eq(paymentReceipts.clientId, clients.id))
      .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
      .leftJoin(users, eq(policies.agentId, users.id))
      .leftJoin(policyBranches, eq(policies.branchId, policyBranches.id))
      .leftJoin(paymentBranches, eq(paymentReceipts.branchId, paymentBranches.id))
      .leftJoin(commissionAlias, and(
        eq(commissionAlias.policyId, paymentReceipts.policyId),
        eq(commissionAlias.organizationId, orgId),
        eq(commissionAlias.periodStart, paymentReceipts.periodFrom),
      ))
      .where(and(...conditions))
      .orderBy(desc(paymentReceipts.issuedAt))
      .limit(limit)
      .offset(offset);

    const policyIds = Array.from(new Set(rows.map((r) => r.policyId).filter(Boolean)));
    const totalReceiptCounts: Record<string, number> = {};
    if (policyIds.length > 0) {
      const rcRows = await tdb
        .select({ policyId: paymentReceipts.policyId, cnt: sql<number>`count(*)::int` })
        .from(paymentReceipts)
        .where(and(inArray(paymentReceipts.policyId, policyIds), eq(paymentReceipts.status, "issued"), isNull(paymentReceipts.deletedAt)))
        .groupBy(paymentReceipts.policyId);
      for (const rc of rcRows) {
        if (rc.policyId) totalReceiptCounts[rc.policyId] = rc.cnt;
      }
    }

    const calcMonths = (from: string | null, to: string | null): number => {
      if (!from || !to) return 1;
      const d1 = new Date(from), d2 = new Date(to);
      return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (30 * 24 * 60 * 60 * 1000)) + 1);
    };

    return rows.map((r) => ({
      receiptId: r.receiptId,
      receiptNumber: r.receiptNumber,
      clientFirstName: r.clientFirstName,
      clientLastName: r.clientLastName,
      clientNationalId: r.clientNationalId,
      clientPhone: r.clientPhone,
      policyNumber: r.policyNumber,
      policyPremium: r.policyPremium,
      amountDue: r.policyPremium,
      amountPaid: r.amountPaid,
      currency: r.currency,
      commissionPayable: r.commissionAmount ?? null,
      commissionType: r.commissionType ?? null,
      agentName: (r.agentDisplayName || r.agentEmail || "").trim(),
      monthsPaidFor: calcMonths(r.periodFrom, r.periodTo),
      receiptCount: totalReceiptCounts[r.policyId] ?? 0,
      policyBranch: r.policyBranchName || "",
      paymentBranch: r.paymentBranchName || "",
      issuedAt: r.issuedAt,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      paymentChannel: r.paymentChannel,
      policyStatus: r.policyStatus,
    }));
  }

  async getCommissionEntriesByPolicy(policyId: string, orgId: string): Promise<CommissionLedgerEntry[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(commissionLedgerEntries)
      .where(and(eq(commissionLedgerEntries.policyId, policyId), eq(commissionLedgerEntries.organizationId, orgId)))
      .orderBy(desc(commissionLedgerEntries.createdAt));
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
  async createNotificationLog(orgId: string, data: {
    recipientType: string;
    recipientId: string | null;
    channel: string;
    subject?: string | null;
    body?: string | null;
    templateId?: string | null;
    policyId?: string | null;
    status?: string;
  }): Promise<NotificationLog> {
    const tdb = await getDbForOrg(orgId);
    const [created] = await tdb.insert(notificationLogs).values({
      organizationId: orgId,
      recipientType: data.recipientType,
      recipientId: data.recipientId,
      channel: data.channel,
      subject: data.subject ?? null,
      body: data.body ?? null,
      templateId: data.templateId ?? null,
      policyId: data.policyId ?? null,
      status: data.status ?? "sent",
      attempts: 1,
      sentAt: new Date(),
    }).returning();
    return created;
  }
  async updateNotificationTemplate(id: string, orgId: string, data: Partial<{
    name: string; eventType: string; channel: string; subject: string | null;
    bodyTemplate: string; isActive: boolean;
  }>): Promise<NotificationTemplate | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(notificationTemplates).set(data)
      .where(and(eq(notificationTemplates.id, id), eq(notificationTemplates.organizationId, orgId))).returning();
    return updated;
  }
  async deleteNotificationTemplate(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(notificationTemplates)
      .where(and(eq(notificationTemplates.id, id), eq(notificationTemplates.organizationId, orgId)));
  }
  async getActiveTemplatesByEvent(orgId: string, eventType: string): Promise<NotificationTemplate[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(notificationTemplates)
      .where(and(eq(notificationTemplates.organizationId, orgId), eq(notificationTemplates.eventType, eventType), eq(notificationTemplates.isActive, true)));
  }
  async getClientNotifications(clientId: string, orgId: string, limit = 50): Promise<NotificationLog[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(notificationLogs)
      .where(and(eq(notificationLogs.recipientId, clientId), eq(notificationLogs.organizationId, orgId)))
      .orderBy(desc(notificationLogs.createdAt)).limit(limit);
  }
  async getUnreadNotificationCount(clientId: string, orgId: string): Promise<number> {
    const tdb = await getDbForOrg(orgId);
    const [result] = await tdb.select({ value: count() }).from(notificationLogs)
      .where(and(eq(notificationLogs.recipientId, clientId), eq(notificationLogs.organizationId, orgId), isNull(notificationLogs.readAt)));
    return Number(result?.value ?? 0);
  }
  async markNotificationRead(id: string, clientId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(notificationLogs).set({ readAt: new Date() })
      .where(and(eq(notificationLogs.id, id), eq(notificationLogs.recipientId, clientId), eq(notificationLogs.organizationId, orgId)));
  }
  async markAllNotificationsRead(clientId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(notificationLogs).set({ readAt: new Date() })
      .where(and(eq(notificationLogs.recipientId, clientId), eq(notificationLogs.organizationId, orgId), isNull(notificationLogs.readAt)));
  }

  // ─── Leads ─────────────────────────────────────────────────
  async getLeadsByOrg(orgId: string, limit = 50, offset = 0): Promise<Lead[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(leads).where(eq(leads.organizationId, orgId))
      .orderBy(desc(leads.createdAt)).limit(limit).offset(offset);
  }
  async getLeadsByAgent(agentId: string, orgId: string): Promise<Lead[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(leads).where(eq(leads.agentId, agentId))
      .orderBy(desc(leads.createdAt)).limit(500);
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
  async getExpenditure(id: string, orgId: string): Promise<Expenditure | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(expenditures)
      .where(and(eq(expenditures.id, id), eq(expenditures.organizationId, orgId)));
    return row;
  }
  async createExpenditure(exp: InsertExpenditure): Promise<Expenditure> {
    const tdb = await getDbForOrg(exp.organizationId);
    const [created] = await tdb.insert(expenditures).values(exp).returning();
    return created;
  }
  async updateExpenditure(id: string, orgId: string, data: Partial<Expenditure>): Promise<Expenditure | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(expenditures).set(data).where(and(eq(expenditures.id, id), eq(expenditures.organizationId, orgId))).returning();
    return updated;
  }

  // ─── Price Book ────────────────────────────────────────────
  async getPriceBookItems(orgId: string): Promise<PriceBookItem[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(priceBookItems).where(eq(priceBookItems.organizationId, orgId)).limit(500);
  }
  async createPriceBookItem(item: InsertPriceBookItem): Promise<PriceBookItem> {
    const tdb = await getDbForOrg(item.organizationId);
    const [created] = await tdb.insert(priceBookItems).values(item).returning();
    return created;
  }
  async updatePriceBookItem(id: string, data: Partial<InsertPriceBookItem>, orgId: string): Promise<PriceBookItem | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(priceBookItems).set(data).where(and(eq(priceBookItems.id, id), eq(priceBookItems.organizationId, orgId))).returning();
    return updated;
  }

  // ─── Mortuary Service Rates (rate card for partner-parlour / direct-client ancillary services) ──
  async getMortuaryServiceRates(orgId: string): Promise<MortuaryServiceRate[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(mortuaryServiceRates).where(eq(mortuaryServiceRates.organizationId, orgId));
  }
  async getMortuaryServiceRateById(id: string, orgId: string): Promise<MortuaryServiceRate | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(mortuaryServiceRates)
      .where(and(eq(mortuaryServiceRates.id, id), eq(mortuaryServiceRates.organizationId, orgId)));
    return row;
  }
  async createMortuaryServiceRate(rate: InsertMortuaryServiceRate): Promise<MortuaryServiceRate> {
    const tdb = await getDbForOrg(rate.organizationId);
    const [created] = await tdb.insert(mortuaryServiceRates).values(rate).returning();
    return created;
  }
  async updateMortuaryServiceRate(id: string, data: Partial<InsertMortuaryServiceRate>, orgId: string): Promise<MortuaryServiceRate | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(mortuaryServiceRates).set(data)
      .where(and(eq(mortuaryServiceRates.id, id), eq(mortuaryServiceRates.organizationId, orgId)))
      .returning();
    return updated;
  }

  // ─── Case Service Charges ────────────────────────────────────
  async getCaseServiceCharges(funeralCaseId: string, orgId: string): Promise<CaseServiceCharge[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(caseServiceCharges)
      .where(and(eq(caseServiceCharges.funeralCaseId, funeralCaseId), eq(caseServiceCharges.organizationId, orgId)))
      .orderBy(desc(caseServiceCharges.createdAt));
  }
  async getCaseServiceChargeById(id: string, orgId: string): Promise<CaseServiceCharge | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(caseServiceCharges)
      .where(and(eq(caseServiceCharges.id, id), eq(caseServiceCharges.organizationId, orgId)));
    return row;
  }
  async createCaseServiceCharge(charge: InsertCaseServiceCharge): Promise<CaseServiceCharge> {
    const tdb = await getDbForOrg(charge.organizationId);
    const [created] = await tdb.insert(caseServiceCharges).values(charge).returning();
    return created;
  }
  async recordCaseServiceChargePayment(id: string, orgId: string, data: { paidBy: string; paidByUserId?: string }): Promise<CaseServiceCharge | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(caseServiceCharges)
      .set({ status: "paid", paidAt: new Date(), paidBy: data.paidBy, paidByUserId: data.paidByUserId })
      .where(and(eq(caseServiceCharges.id, id), eq(caseServiceCharges.organizationId, orgId)))
      .returning();
    return updated;
  }
  async deleteCaseServiceCharge(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(caseServiceCharges)
      .where(and(eq(caseServiceCharges.id, id), eq(caseServiceCharges.organizationId, orgId), eq(caseServiceCharges.status, "unpaid")));
  }

  // ─── Cemeteries ────────────────────────────────────────────
  async getCemeteries(orgId: string): Promise<Cemetery[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(cemeteries)
      .where(and(eq(cemeteries.organizationId, orgId), eq(cemeteries.isActive, true)))
      .orderBy(cemeteries.name);
  }
  async createCemetery(data: InsertCemetery): Promise<Cemetery> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(cemeteries).values(data).returning();
    return row;
  }
  async updateCemetery(id: string, data: Partial<InsertCemetery>, orgId: string): Promise<Cemetery | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(cemeteries).set(data)
      .where(and(eq(cemeteries.id, id), eq(cemeteries.organizationId, orgId)))
      .returning();
    return row;
  }

  // ─── Equipment Items ───────────────────────────────────────
  async getEquipmentItems(orgId: string): Promise<EquipmentItem[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(equipmentItems)
      .where(and(eq(equipmentItems.organizationId, orgId), eq(equipmentItems.isActive, true)))
      .orderBy(equipmentItems.name);
  }
  async createEquipmentItem(data: InsertEquipmentItem): Promise<EquipmentItem> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(equipmentItems).values(data).returning();
    return row;
  }
  async updateEquipmentItem(id: string, data: Partial<InsertEquipmentItem>, orgId: string): Promise<EquipmentItem | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(equipmentItems).set(data)
      .where(and(eq(equipmentItems.id, id), eq(equipmentItems.organizationId, orgId)))
      .returning();
    return row;
  }

  // ─── Pitching Assignments ──────────────────────────────────
  async getPitchingAssignmentsByDate(orgId: string, date: string): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select().from(pitchingAssignments)
      .where(and(eq(pitchingAssignments.organizationId, orgId), eq(pitchingAssignments.assignmentDate, date)))
      .orderBy(desc(pitchingAssignments.createdAt));
    return Promise.all(rows.map(async (r) => {
      const [staff, equipment] = await Promise.all([
        tdb.select().from(pitchingAssignmentStaff).where(eq(pitchingAssignmentStaff.pitchingAssignmentId, r.id)),
        tdb.select().from(pitchingAssignmentEquipment).where(eq(pitchingAssignmentEquipment.pitchingAssignmentId, r.id)),
      ]);
      return { ...r, staffUserIds: staff.map(s => s.userId), equipmentItemIds: equipment.map(e => e.equipmentItemId) };
    }));
  }
  async createPitchingAssignment(data: InsertPitchingAssignment, userIds: string[], equipmentItemIds: string[]): Promise<PitchingAssignment> {
    return withOrgTransaction(data.organizationId, async (tx) => {
      const [row] = await tx.insert(pitchingAssignments).values(data).returning();
      if (userIds.length > 0) {
        await tx.insert(pitchingAssignmentStaff).values(userIds.map(userId => ({ pitchingAssignmentId: row.id, userId })));
      }
      if (equipmentItemIds.length > 0) {
        await tx.insert(pitchingAssignmentEquipment).values(equipmentItemIds.map(equipmentItemId => ({ pitchingAssignmentId: row.id, equipmentItemId })));
      }
      return row;
    });
  }
  async updatePitchingAssignment(id: string, orgId: string, data: Partial<InsertPitchingAssignment>, userIds?: string[], equipmentItemIds?: string[]): Promise<PitchingAssignment | undefined> {
    return withOrgTransaction(orgId, async (tx) => {
      const [row] = await tx.update(pitchingAssignments).set(data)
        .where(and(eq(pitchingAssignments.id, id), eq(pitchingAssignments.organizationId, orgId)))
        .returning();
      if (!row) return row;
      if (userIds) {
        await tx.delete(pitchingAssignmentStaff).where(eq(pitchingAssignmentStaff.pitchingAssignmentId, id));
        if (userIds.length > 0) await tx.insert(pitchingAssignmentStaff).values(userIds.map(userId => ({ pitchingAssignmentId: id, userId })));
      }
      if (equipmentItemIds) {
        await tx.delete(pitchingAssignmentEquipment).where(eq(pitchingAssignmentEquipment.pitchingAssignmentId, id));
        if (equipmentItemIds.length > 0) await tx.insert(pitchingAssignmentEquipment).values(equipmentItemIds.map(equipmentItemId => ({ pitchingAssignmentId: id, equipmentItemId })));
      }
      return row;
    });
  }
  async deletePitchingAssignment(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(pitchingAssignments).where(and(eq(pitchingAssignments.id, id), eq(pitchingAssignments.organizationId, orgId)));
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
  async getTermsByProductVersion(productVersionId: string, orgId: string): Promise<TermsAndConditions[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(termsAndConditions)
      .where(and(
        eq(termsAndConditions.organizationId, orgId),
        eq(termsAndConditions.productVersionId, productVersionId),
        eq(termsAndConditions.isActive, true),
      ))
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

  // ─── Attendance ────────────────────────────────────────────
  async getAttendanceLogs(orgId: string, filters?: { date?: string; status?: string; employeeId?: string }): Promise<(AttendanceLog & { employee: PayrollEmployee })[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(attendanceLogs.organizationId, orgId)];
    if (filters?.date) conditions.push(eq(attendanceLogs.date, filters.date));
    if (filters?.status) conditions.push(eq(attendanceLogs.status, filters.status));
    if (filters?.employeeId) conditions.push(eq(attendanceLogs.employeeId, filters.employeeId));
    const rows = await tdb.select().from(attendanceLogs)
      .innerJoin(payrollEmployees, eq(attendanceLogs.employeeId, payrollEmployees.id))
      .where(and(...conditions))
      .orderBy(desc(attendanceLogs.date), desc(attendanceLogs.loggedAt));
    return rows.map((r) => ({ ...r.attendance_logs, employee: r.payroll_employees }));
  }
  async getAttendanceLogById(id: string, orgId: string): Promise<AttendanceLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(attendanceLogs)
      .where(and(eq(attendanceLogs.id, id), eq(attendanceLogs.organizationId, orgId)));
    return row;
  }
  async getMyAttendanceLogs(employeeId: string, orgId: string): Promise<AttendanceLog[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(attendanceLogs)
      .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.organizationId, orgId)))
      .orderBy(desc(attendanceLogs.date));
  }
  async createAttendanceLog(data: InsertAttendanceLog): Promise<AttendanceLog> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(attendanceLogs).values(data).returning();
    return created;
  }
  async updateAttendanceLog(id: string, data: Partial<Pick<AttendanceLog, "status" | "approvedBy" | "approvedAt" | "approvalNotes">>, orgId: string): Promise<AttendanceLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(attendanceLogs).set(data)
      .where(and(eq(attendanceLogs.id, id), eq(attendanceLogs.organizationId, orgId)))
      .returning();
    return updated;
  }
  async getAttendanceLogForDate(employeeId: string, orgId: string, date: string): Promise<AttendanceLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(attendanceLogs)
      .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.organizationId, orgId), eq(attendanceLogs.date, date)));
    return row;
  }
  async correctAttendanceLog(id: string, orgId: string, data: Partial<Pick<AttendanceLog, "notes" | "clockInAt" | "clockOutAt" | "hoursWorked" | "status" | "approvedBy" | "approvedAt" | "approvalNotes">>): Promise<AttendanceLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(attendanceLogs).set(data)
      .where(and(eq(attendanceLogs.id, id), eq(attendanceLogs.organizationId, orgId)))
      .returning();
    return updated;
  }

  async getPayrollEmployeeByUserId(userId: string, orgId: string): Promise<PayrollEmployee | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(payrollEmployees)
      .where(and(eq(payrollEmployees.userId, userId), eq(payrollEmployees.organizationId, orgId)));
    return row;
  }

  // ─── QR Attendance ─────────────────────────────────────────
  async listAttendanceQrCodes(orgId: string): Promise<AttendanceQrCode[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(attendanceQrCodes)
      .where(eq(attendanceQrCodes.organizationId, orgId))
      .orderBy(desc(attendanceQrCodes.createdAt));
  }
  async getAttendanceQrCodeByToken(token: string, orgId: string): Promise<AttendanceQrCode | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(attendanceQrCodes)
      .where(and(eq(attendanceQrCodes.token, token), eq(attendanceQrCodes.organizationId, orgId)));
    return row;
  }
  async getAttendanceQrCodeById(id: string, orgId: string): Promise<AttendanceQrCode | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(attendanceQrCodes)
      .where(and(eq(attendanceQrCodes.id, id), eq(attendanceQrCodes.organizationId, orgId)));
    return row;
  }
  async createAttendanceQrCode(data: InsertAttendanceQrCode): Promise<AttendanceQrCode> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(attendanceQrCodes).values(data).returning();
    return created;
  }
  async updateAttendanceQrCode(
    id: string,
    orgId: string,
    data: Partial<Pick<AttendanceQrCode, "label" | "branchId" | "isActive" | "latitude" | "longitude" | "geofenceRadiusMeters">>,
  ): Promise<AttendanceQrCode | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(attendanceQrCodes).set(data)
      .where(and(eq(attendanceQrCodes.id, id), eq(attendanceQrCodes.organizationId, orgId)))
      .returning();
    return updated;
  }
  /** Any vehicle checkout (active or already returned) overlapping the given day — the
   *  signal used to auto-suppress an off-site geofence flag for drivers/staff legitimately
   *  sent out on removals or errands that day. */
  async getDriverAssignmentsForDriverOnDate(driverId: string, orgId: string, dayStart: Date, dayEnd: Date): Promise<DriverAssignment[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(driverAssignments)
      .where(and(
        eq(driverAssignments.organizationId, orgId),
        eq(driverAssignments.driverId, driverId),
        lte(driverAssignments.startDate, dayEnd),
        or(isNull(driverAssignments.endDate), gte(driverAssignments.endDate, dayStart)),
      ));
  }
  /** Marks a single clock-in/out event as off-site. Advisory only — never blocks the scan. */
  async setAttendanceOffSiteFlag(logId: string, orgId: string, eventType: "clock_in" | "clock_out", distanceMeters: number): Promise<AttendanceLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const data = eventType === "clock_in"
      ? { clockInOffSite: true, clockInDistanceMeters: Math.round(distanceMeters) }
      : { clockOutOffSite: true, clockOutDistanceMeters: Math.round(distanceMeters) };
    const [updated] = await tdb.update(attendanceLogs).set(data)
      .where(and(eq(attendanceLogs.id, logId), eq(attendanceLogs.organizationId, orgId)))
      .returning();
    return updated;
  }
  /** Manager reviewed an off-site flag and confirmed it's fine (e.g. a legitimate errand
   *  not caught by the vehicle-checkout exemption). Clears both flags — distances are kept
   *  on the row for the audit trail even though the "needs review" flag is gone. */
  async dismissAttendanceOffSiteFlag(logId: string, orgId: string, reviewerUserId: string): Promise<AttendanceLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(attendanceLogs).set({
      clockInOffSite: false,
      clockOutOffSite: false,
      offSiteReviewedBy: reviewerUserId,
      offSiteReviewedAt: new Date(),
    }).where(and(eq(attendanceLogs.id, logId), eq(attendanceLogs.organizationId, orgId)))
      .returning();
    return updated;
  }
  async createAttendanceScan(data: InsertAttendanceScan): Promise<AttendanceScan> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(attendanceScans).values(data).returning();
    return created;
  }
  /**
   * MVP: one attendance_logs row per employee per day. The first scan of the day is
   * clock-in, the next is clock-out (no multi-session/lunch-break splitting yet).
   */
  async recordAttendanceScan(employeeId: string, orgId: string, qrCodeId: string, lat?: number, lng?: number): Promise<{ log: AttendanceLog; eventType: "clock_in" | "clock_out" }> {
    const tdb = await getDbForOrg(orgId);
    const today = todayInHarare();
    const now = new Date();
    const [existing] = await tdb.select().from(attendanceLogs)
      .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.organizationId, orgId), eq(attendanceLogs.date, today)));

    let log: AttendanceLog;
    let eventType: "clock_in" | "clock_out";
    try {
      if (!existing) {
        eventType = "clock_in";
        [log] = await tdb.insert(attendanceLogs).values({
          organizationId: orgId,
          employeeId,
          date: today,
          source: "qr",
          clockInAt: now,
          clockInLat: lat != null ? String(lat) : null,
          clockInLng: lng != null ? String(lng) : null,
        }).returning();
      } else if (!existing.clockInAt) {
        // A manual (note-only) row already exists for today with no clock-in time
        // recorded (e.g. created via the manual-correction form) — treat this scan as
        // the real clock-in rather than computing a bogus 0-hour clock-out against it.
        eventType = "clock_in";
        [log] = await tdb.update(attendanceLogs).set({
          source: "qr",
          clockInAt: now,
          clockInLat: lat != null ? String(lat) : null,
          clockInLng: lng != null ? String(lng) : null,
        }).where(eq(attendanceLogs.id, existing.id)).returning();
      } else if (!existing.clockOutAt) {
        eventType = "clock_out";
        const hoursWorked = Math.max(0, (now.getTime() - new Date(existing.clockInAt).getTime()) / 3_600_000);
        [log] = await tdb.update(attendanceLogs).set({
          clockOutAt: now,
          clockOutLat: lat != null ? String(lat) : null,
          clockOutLng: lng != null ? String(lng) : null,
          hoursWorked: hoursWorked.toFixed(2),
        }).where(eq(attendanceLogs.id, existing.id)).returning();
      } else {
        throw Object.assign(new Error("Already clocked in and out for today"), { statusCode: 409 });
      }
    } catch (err: any) {
      if (err?.code === "23505" && !existing) {
        // Two near-simultaneous clock-in scans (double-tap, or a client retry after a
        // dropped response) both saw "no row yet" and raced on the insert. This is the
        // same clock-in event twice, not a second real scan — echo back the row the
        // winner created instead of misreading it as a clock-out.
        const [winner] = await tdb.select().from(attendanceLogs)
          .where(and(eq(attendanceLogs.employeeId, employeeId), eq(attendanceLogs.organizationId, orgId), eq(attendanceLogs.date, today)));
        if (winner) return { log: winner, eventType: "clock_in" };
      }
      throw err;
    }

    await this.createAttendanceScan({
      organizationId: orgId,
      employeeId,
      qrCodeId,
      eventType,
      scannedAt: now,
      latitude: lat != null ? String(lat) : null,
      longitude: lng != null ? String(lng) : null,
    } as InsertAttendanceScan);

    return { log, eventType };
  }

  // ─── Vehicle Checkout / GPS Tracking ────────────────────────
  async getActiveDriverAssignment(vehicleId: string, orgId: string): Promise<DriverAssignment | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(driverAssignments)
      .where(and(eq(driverAssignments.vehicleId, vehicleId), eq(driverAssignments.organizationId, orgId), isNull(driverAssignments.endDate)));
    return row;
  }
  async getDriverAssignmentById(id: string, orgId: string): Promise<DriverAssignment | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(driverAssignments)
      .where(and(eq(driverAssignments.id, id), eq(driverAssignments.organizationId, orgId)));
    return row;
  }
  async getActiveDriverAssignments(orgId: string): Promise<(DriverAssignment & { vehicle: FleetVehicle })[]> {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select().from(driverAssignments)
      .innerJoin(fleetVehicles, eq(driverAssignments.vehicleId, fleetVehicles.id))
      .where(and(eq(driverAssignments.organizationId, orgId), isNull(driverAssignments.endDate)));
    return rows.map((r) => ({ ...r.driver_assignments, vehicle: r.fleet_vehicles }));
  }
  async createDriverAssignmentRecord(data: InsertDriverAssignment): Promise<DriverAssignment> {
    const tdb = await getDbForOrg(data.organizationId!);
    const [created] = await tdb.insert(driverAssignments).values(data).returning();
    return created;
  }
  async endDriverAssignment(id: string, orgId: string): Promise<DriverAssignment | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(driverAssignments).set({ endDate: new Date() })
      .where(and(eq(driverAssignments.id, id), eq(driverAssignments.organizationId, orgId)))
      .returning();
    return updated;
  }
  async createVehicleLocationPings(pings: InsertVehicleLocationPing[]): Promise<VehicleLocationPing[]> {
    if (pings.length === 0) return [];
    const tdb = await getDbForOrg(pings[0].organizationId);
    return tdb.insert(vehicleLocationPings).values(pings).returning();
  }
  async getRecentVehiclePings(assignmentId: string, orgId: string, sinceMinutes: number): Promise<VehicleLocationPing[]> {
    const tdb = await getDbForOrg(orgId);
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    return tdb.select().from(vehicleLocationPings)
      .where(and(eq(vehicleLocationPings.assignmentId, assignmentId), eq(vehicleLocationPings.organizationId, orgId), gte(vehicleLocationPings.recordedAt, since)))
      .orderBy(vehicleLocationPings.recordedAt);
  }
  async getLatestVehiclePing(assignmentId: string, orgId: string): Promise<VehicleLocationPing | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(vehicleLocationPings)
      .where(and(eq(vehicleLocationPings.assignmentId, assignmentId), eq(vehicleLocationPings.organizationId, orgId)))
      .orderBy(desc(vehicleLocationPings.recordedAt))
      .limit(1);
    return row;
  }
  async createVehicleAlert(data: InsertVehicleAlert): Promise<VehicleAlert> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(vehicleAlerts).values(data).returning();
    return created;
  }
  async getOpenVehicleAlert(assignmentId: string, orgId: string, type: string): Promise<VehicleAlert | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(vehicleAlerts)
      .where(and(eq(vehicleAlerts.assignmentId, assignmentId), eq(vehicleAlerts.organizationId, orgId), eq(vehicleAlerts.type, type), isNull(vehicleAlerts.resolvedAt)));
    return row;
  }
  async resolveVehicleAlert(id: string, orgId: string): Promise<VehicleAlert | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(vehicleAlerts).set({ resolvedAt: new Date() })
      .where(and(eq(vehicleAlerts.id, id), eq(vehicleAlerts.organizationId, orgId)))
      .returning();
    return updated;
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
  async updatePayrollEmployee(id: string, data: Partial<InsertPayrollEmployee>, orgId: string): Promise<PayrollEmployee | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(payrollEmployees).set(data)
      .where(and(eq(payrollEmployees.id, id), eq(payrollEmployees.organizationId, orgId)))
      .returning();
    return updated;
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
  async getPayslipsForRun(runId: string, orgId: string): Promise<(Payslip & { employee: PayrollEmployee })[]> {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select().from(payslips)
      .innerJoin(payrollEmployees, eq(payslips.employeeId, payrollEmployees.id))
      .where(and(eq(payslips.payrollRunId, runId), eq(payrollEmployees.organizationId, orgId)));
    return rows.map((r) => ({ ...r.payslips, employee: r.payroll_employees }));
  }
  async upsertPayslip(runId: string, employeeId: string, orgId: string, data: Omit<InsertPayslip, "payrollRunId" | "employeeId">): Promise<Payslip> {
    const tdb = await getDbForOrg(orgId);
    const [existing] = await tdb.select().from(payslips)
      .where(and(eq(payslips.payrollRunId, runId), eq(payslips.employeeId, employeeId)));
    if (existing) {
      const [updated] = await tdb.update(payslips).set(data).where(eq(payslips.id, existing.id)).returning();
      return updated;
    }
    const [created] = await tdb.insert(payslips).values({ ...data, payrollRunId: runId, employeeId }).returning();
    return created;
  }
  async updatePayrollRunTotals(runId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    const slips = await tdb.select().from(payslips)
      .innerJoin(payrollEmployees, eq(payslips.employeeId, payrollEmployees.id))
      .where(and(eq(payslips.payrollRunId, runId), eq(payrollEmployees.organizationId, orgId)));
    const totalGross = slips.reduce((s, p) => s + parseFloat(p.payslips.grossAmount || "0"), 0);
    const totalNet = slips.reduce((s, p) => s + parseFloat(p.payslips.netAmount || "0"), 0);
    const totalDeductions = totalGross - totalNet;
    await tdb.update(payrollRuns)
      .set({ totalGross: String(totalGross), totalDeductions: String(totalDeductions), totalNet: String(totalNet) })
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.organizationId, orgId)));
  }

  // ─── Cashups ───────────────────────────────────────────────
  async getCashups(orgId: string, limit = 30, filters?: ReportFilters & { preparedBy?: string; status?: string }): Promise<Cashup[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(cashups.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(cashups.cashupDate, filters.fromDate));
    if (filters?.toDate) conditions.push(lte(cashups.cashupDate, filters.toDate));
    if (filters?.preparedBy) conditions.push(eq(cashups.preparedBy, filters.preparedBy));
    if (filters?.status) conditions.push(eq(cashups.status, filters.status));
    return tdb.select().from(cashups).where(and(...conditions))
      .orderBy(desc(cashups.cashupDate), desc(cashups.createdAt)).limit(limit);
  }
  async getCashup(id: string, orgId: string): Promise<Cashup | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(cashups).where(and(eq(cashups.id, id), eq(cashups.organizationId, orgId)));
    return row;
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
  async getReceiptTotalsByUserDate(orgId: string, userId: string, date: string): Promise<{ amountsByMethod: Record<string, string>; transactionCount: number; currency: string }> {
    const tdb = await getDbForOrg(orgId);
    const dayStart = new Date(date + "T00:00:00.000Z");
    const dayEnd = new Date(date + "T23:59:59.999Z");
    const [policyRows, serviceRows] = await Promise.all([
      tdb
        .select({ paymentChannel: paymentReceipts.paymentChannel, amount: paymentReceipts.amount, currency: paymentReceipts.currency })
        .from(paymentReceipts)
        .where(and(
          eq(paymentReceipts.organizationId, orgId),
          eq(paymentReceipts.issuedByUserId, userId),
          eq(paymentReceipts.status, "issued"),
          gte(paymentReceipts.issuedAt, dayStart),
          lte(paymentReceipts.issuedAt, dayEnd),
        )),
      tdb
        .select({ paymentChannel: serviceReceipts.paymentChannel, amount: serviceReceipts.amount, currency: serviceReceipts.currency })
        .from(serviceReceipts)
        .where(and(
          eq(serviceReceipts.organizationId, orgId),
          eq(serviceReceipts.issuedByUserId, userId),
          eq(serviceReceipts.status, "issued"),
          gte(serviceReceipts.issuedAt, dayStart),
          lte(serviceReceipts.issuedAt, dayEnd),
        )),
    ]);
    const allRows = [...policyRows, ...serviceRows];
    const amountsByMethod: Record<string, string> = { cash: "0", paynow_ecocash: "0", paynow_card: "0", other: "0" };
    const currencyCounts: Record<string, number> = {};
    for (const r of allRows) {
      const ch = (r.paymentChannel || "other").toLowerCase();
      const key = ch === "cash" ? "cash" : ch === "paynow_ecocash" ? "paynow_ecocash" : ch === "paynow_card" ? "paynow_card" : "other";
      const prev = parseFloat(amountsByMethod[key] || "0");
      amountsByMethod[key] = (prev + parseFloat(String(r.amount || "0"))).toFixed(2);
      const cur = r.currency || "USD";
      currencyCounts[cur] = (currencyCounts[cur] || 0) + 1;
    }
    const currency = Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "USD";
    return { amountsByMethod, transactionCount: allRows.length, currency };
  }

  // ─── Security Questions ────────────────────────────────────
  async getSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select({ id: securityQuestions.id, question: securityQuestions.question })
      .from(securityQuestions)
      .where(and(eq(securityQuestions.organizationId, orgId), eq(securityQuestions.isActive, true)));
  }

  /** Ensure org has at least the default security questions (for claim flow). Returns questions. */
  async getOrCreateDefaultSecurityQuestions(orgId: string): Promise<{ id: string; question: string }[]> {
    const existing = await this.getSecurityQuestions(orgId);
    if (existing.length > 0) return existing;
    const defaults = [
      "What was the name of your first pet?",
      "In what city were you born?",
      "What is your mother's maiden name?",
      "What high school did you attend?",
    ];
    const tdb = await getDbForOrg(orgId);
    await tdb.insert(securityQuestions).values(
      defaults.map((question) => ({ organizationId: orgId, question, isActive: true }))
    );
    return this.getSecurityQuestions(orgId);
  }

  // ─── Dashboard Stats ──────────────────────────────────────
  async getDashboardStats(orgId: string, filters?: { dateFrom?: string; dateTo?: string; status?: string; branchId?: string }, agentId?: string): Promise<any> {
    const tdb = await getDbForOrg(orgId);

    if (agentId) {
      // Agent-scoped: only policies, clients, claims, leads, transactions belonging to this agent
      const agentPolicies = await this.getPoliciesByAgent(agentId, orgId);
      const agentPolicyIds = new Set(agentPolicies.map((p) => p.id));
      const policyList = agentPolicies.filter((p) => {
        if (filters?.dateFrom && p.createdAt && new Date(p.createdAt) < new Date(filters.dateFrom)) return false;
        if (filters?.dateTo && p.createdAt && new Date(p.createdAt) > new Date(filters.dateTo + "T23:59:59")) return false;
        if (filters?.status && filters.status !== "all" && p.status !== filters.status) return false;
        if (filters?.branchId && filters.branchId !== "all" && p.branchId !== filters.branchId) return false;
        return true;
      });
      const activePoliciesList = policyList.filter((p) => p.status === "active");
      const agentClients = await this.getClientsByAgent(agentId, orgId, 100000, 0);
      const clientList = agentClients.filter((c) => {
        if (filters?.dateFrom && c.createdAt && new Date(c.createdAt) < new Date(filters.dateFrom)) return false;
        if (filters?.dateTo && c.createdAt && new Date(c.createdAt) > new Date(filters.dateTo + "T23:59:59")) return false;
        if (filters?.branchId && filters.branchId !== "all" && c.branchId !== filters.branchId) return false;
        return true;
      });
      const agentLeads = await this.getLeadsByAgent(agentId, orgId);
      const leadList = agentLeads;
      const ids = Array.from(agentPolicyIds);
      let claimCount = 0;
      let openClaimsCount = 0;
      let funeralCount = 0;
      let txCount = 0;
      if (ids.length > 0) {
        const [cRow] = await tdb.select({ cnt: count() }).from(claims).where(and(eq(claims.organizationId, orgId), inArray(claims.policyId, ids)));
        claimCount = Number(cRow?.cnt ?? 0);
        const [oRow] = await tdb.select({ cnt: count() }).from(claims).where(and(eq(claims.organizationId, orgId), inArray(claims.policyId, ids), inArray(claims.status, ["submitted", "verified"])));
        openClaimsCount = Number(oRow?.cnt ?? 0);
        const agentClaimRows = await tdb.select({ id: claims.id }).from(claims).where(and(eq(claims.organizationId, orgId), inArray(claims.policyId, ids)));
        const agentClaimIds = agentClaimRows.map((r) => r.id);
        if (agentClaimIds.length > 0) {
          const [fRow] = await tdb.select({ cnt: count() }).from(funeralCases).where(and(eq(funeralCases.organizationId, orgId), or(inArray(funeralCases.policyId, ids), inArray(funeralCases.claimId, agentClaimIds))));
          funeralCount = Number(fRow?.cnt ?? 0);
        } else {
          const [fRow] = await tdb.select({ cnt: count() }).from(funeralCases).where(and(eq(funeralCases.organizationId, orgId), inArray(funeralCases.policyId, ids)));
          funeralCount = Number(fRow?.cnt ?? 0);
        }
        const txConds = [eq(paymentTransactions.organizationId, orgId), inArray(paymentTransactions.policyId, ids)];
        if (filters?.dateFrom) txConds.push(gte(paymentTransactions.createdAt, new Date(filters.dateFrom)));
        if (filters?.dateTo) txConds.push(lte(paymentTransactions.createdAt, new Date(filters.dateTo + "T23:59:59")));
        const [txRow] = await tdb.select({ cnt: count() }).from(paymentTransactions).where(and(...txConds));
        txCount = Number(txRow?.cnt ?? 0);
      }
      return {
        totalPolicies: policyList.length,
        activePolicies: activePoliciesList.length,
        totalClients: clientList.length,
        totalClaims: claimCount,
        openClaims: openClaimsCount,
        totalFuneralCases: funeralCount,
        totalLeads: leadList.length,
        totalTransactions: txCount,
      };
    }

    const pConds: any[] = [eq(policies.organizationId, orgId)];
    if (filters?.dateFrom) pConds.push(gte(policies.createdAt, new Date(filters.dateFrom)));
    if (filters?.dateTo) pConds.push(lte(policies.createdAt, new Date(filters.dateTo + "T23:59:59")));
    if (filters?.status && filters.status !== "all") pConds.push(eq(policies.status, filters.status));
    if (filters?.branchId && filters.branchId !== "all") pConds.push(eq(policies.branchId, filters.branchId));

    const [policyCount] = await tdb.select({ cnt: count() }).from(policies).where(and(...pConds));
    const activeConds = [...pConds, eq(policies.status, "active")];
    const [activePolicies] = await tdb.select({ cnt: count() }).from(policies).where(and(...activeConds));

    const cConds: any[] = [eq(clients.organizationId, orgId)];
    if (filters?.dateFrom) cConds.push(gte(clients.createdAt, new Date(filters.dateFrom)));
    if (filters?.dateTo) cConds.push(lte(clients.createdAt, new Date(filters.dateTo + "T23:59:59")));
    if (filters?.branchId && filters.branchId !== "all") cConds.push(eq(clients.branchId, filters.branchId));
    const [clientCount] = await tdb.select({ cnt: count() }).from(clients).where(and(...cConds));

    const clConds: any[] = [eq(claims.organizationId, orgId)];
    if (filters?.dateFrom) clConds.push(gte(claims.createdAt, new Date(filters.dateFrom)));
    if (filters?.dateTo) clConds.push(lte(claims.createdAt, new Date(filters.dateTo + "T23:59:59")));
    const [claimCount] = await tdb.select({ cnt: count() }).from(claims).where(and(...clConds));
    const [openClaims] = await tdb.select({ cnt: count() }).from(claims)
      .where(and(...clConds, inArray(claims.status, ["submitted", "verified"])));

    const fConds: any[] = [eq(funeralCases.organizationId, orgId)];
    if (filters?.dateFrom) fConds.push(gte(funeralCases.createdAt, new Date(filters.dateFrom)));
    if (filters?.dateTo) fConds.push(lte(funeralCases.createdAt, new Date(filters.dateTo + "T23:59:59")));
    const [funeralCount] = await tdb.select({ cnt: count() }).from(funeralCases).where(and(...fConds));

    const [leadCount] = await tdb.select({ cnt: count() }).from(leads).where(eq(leads.organizationId, orgId));

    const txConds: any[] = [eq(paymentTransactions.organizationId, orgId)];
    if (filters?.dateFrom) txConds.push(gte(paymentTransactions.createdAt, new Date(filters.dateFrom)));
    if (filters?.dateTo) txConds.push(lte(paymentTransactions.createdAt, new Date(filters.dateTo + "T23:59:59")));
    const [txCount] = await tdb.select({ cnt: count() }).from(paymentTransactions).where(and(...txConds));

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
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, claim_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET claim_next = org_policy_sequences.claim_next + 1
      RETURNING claim_next
    `);
    const nextVal = (result as unknown as { rows?: { claim_next: number }[] }).rows?.[0]?.claim_next ?? 1;
    return `CLM-${String(nextVal).padStart(6, "0")}`;
  }
  async getNextMemberNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_member_sequences (organization_id, member_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET member_next = org_member_sequences.member_next + 1
      RETURNING member_next
    `);
    const nextVal = (result as unknown as { rows?: { member_next: number }[] }).rows?.[0]?.member_next ?? 1;
    return `MEM-${String(nextVal).padStart(6, "0")}`;
  }
  async generateCaseNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, case_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET case_next = org_policy_sequences.case_next + 1
      RETURNING case_next
    `);
    const nextVal = (result as unknown as { rows?: { case_next: number }[] }).rows?.[0]?.case_next ?? 1;
    return `FNC-${String(nextVal).padStart(6, "0")}`;
  }

  async generateEmployeeNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, employee_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET employee_next = org_policy_sequences.employee_next + 1
      RETURNING employee_next
    `);
    const nextVal = (result as unknown as { rows?: { employee_next: number }[] }).rows?.[0]?.employee_next ?? 1;
    return `EMP-${String(nextVal).padStart(5, "0")}`;
  }

  async generateRequisitionNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, requisition_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET requisition_next = org_policy_sequences.requisition_next + 1
      RETURNING requisition_next
    `);
    const nextVal = (result as unknown as { rows?: { requisition_next: number }[] }).rows?.[0]?.requisition_next ?? 1;
    return `REQ-${String(nextVal).padStart(5, "0")}`;
  }

  async generateAccumulationAccountNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, accumulation_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET accumulation_next = org_policy_sequences.accumulation_next + 1
      RETURNING accumulation_next
    `);
    const nextVal = (result as unknown as { rows?: { accumulation_next: number }[] }).rows?.[0]?.accumulation_next ?? 1;
    return `ACC-${String(nextVal).padStart(6, "0")}`;
  }

  async generateVoucherNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    return this.generateVoucherNumberInTx(tdb, orgId);
  }
  /** Bump `org_policy_sequences.disbursement_next` on the same connection as `tx` (participates in outer BEGIN/COMMIT) — use inside `withOrgTransaction` so the sequence bump rolls back with the rest of the payment. */
  async generateVoucherNumberInTx(tx: OrgDrizzleDb, orgId: string): Promise<string> {
    const result = await tx.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, disbursement_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET disbursement_next = org_policy_sequences.disbursement_next + 1
      RETURNING disbursement_next
    `);
    const nextVal = (result as unknown as { rows?: { disbursement_next: number }[] }).rows?.[0]?.disbursement_next ?? 1;
    return `PV-${String(nextVal).padStart(5, "0")}`;
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

  async getGroupsWhereClientIsExecutive(orgId: string, clientId: string): Promise<Group[]> {
    const client = await this.getClient(clientId, orgId);
    if (!client?.phone) return [];
    const digits = String(client.phone).replace(/\D/g, "").slice(-9);
    if (digits.length < 9) return [];
    const all = await this.getGroupsByOrg(orgId);
    return all.filter((g) => {
      const phones = [g.chairpersonPhone, g.secretaryPhone, g.treasurerPhone].filter(Boolean);
      return phones.some((p) => String(p).replace(/\D/g, "").slice(-9) === digits);
    });
  }

  async getPoliciesByGroupId(orgId: string, groupId: string): Promise<Policy[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policies)
      .where(and(eq(policies.organizationId, orgId), eq(policies.groupId, groupId)))
      .orderBy(desc(policies.createdAt));
  }

  // ─── Pool-society engine (Phase 3d, server/pool-society.ts) ─────────────
  async getGroupMembers(orgId: string, groupId: string): Promise<GroupMember[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(groupMembers)
      .where(and(eq(groupMembers.organizationId, orgId), eq(groupMembers.groupId, groupId)))
      .orderBy(desc(groupMembers.createdAt));
  }
  async createGroupMember(member: InsertGroupMember): Promise<GroupMember> {
    const tdb = await getDbForOrg(member.organizationId);
    const [created] = await tdb.insert(groupMembers).values(member).returning();
    return created;
  }
  async getGroupContributions(orgId: string, groupId: string): Promise<GroupContribution[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(groupContributions)
      .where(and(eq(groupContributions.organizationId, orgId), eq(groupContributions.groupId, groupId)))
      .orderBy(desc(groupContributions.contributionDate));
  }
  async createGroupContribution(contribution: InsertGroupContribution): Promise<GroupContribution> {
    const tdb = await getDbForOrg(contribution.organizationId);
    const [created] = await tdb.insert(groupContributions).values(contribution).returning();
    return created;
  }
  async getGroupPoolPayouts(orgId: string, groupId: string): Promise<GroupPoolPayout[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(groupPoolPayouts)
      .where(and(eq(groupPoolPayouts.organizationId, orgId), eq(groupPoolPayouts.groupId, groupId)))
      .orderBy(desc(groupPoolPayouts.createdAt));
  }
  async getGroupPoolPayout(id: string, orgId: string): Promise<GroupPoolPayout | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [p] = await tdb.select().from(groupPoolPayouts)
      .where(and(eq(groupPoolPayouts.id, id), eq(groupPoolPayouts.organizationId, orgId)));
    return p;
  }
  async createGroupPoolPayout(payout: InsertGroupPoolPayout): Promise<GroupPoolPayout> {
    const tdb = await getDbForOrg(payout.organizationId);
    const [created] = await tdb.insert(groupPoolPayouts).values(payout).returning();
    return created;
  }
  async updateGroupPoolPayout(id: string, data: Partial<InsertGroupPoolPayout>, orgId: string): Promise<GroupPoolPayout | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(groupPoolPayouts).set(data)
      .where(and(eq(groupPoolPayouts.id, id), eq(groupPoolPayouts.organizationId, orgId)))
      .returning();
    return updated;
  }
  /** Formalizes an existing informal society in one commit — every roster member and their
   *  historical contributions, or none of them, never a half-imported society. */
  async bulkImportGroupMembers(orgId: string, groupId: string, rows: BulkImportGroupMemberRow[]): Promise<{ membersCreated: number; contributionsCreated: number }> {
    return withOrgTransaction(orgId, async (tx) => {
      let contributionsCreated = 0;
      for (const row of rows) {
        const [member] = await tx.insert(groupMembers).values({
          organizationId: orgId,
          groupId,
          fullName: row.fullName,
          memberNumber: row.memberNumber || undefined,
          joinedDate: row.joinedDate || undefined,
        }).returning();
        for (const c of row.contributions || []) {
          await tx.insert(groupContributions).values({
            organizationId: orgId,
            groupId,
            groupMemberId: member.id,
            amount: c.amount,
            currency: c.currency,
            contributionDate: c.contributionDate,
            notes: c.notes || undefined,
          });
          contributionsCreated++;
        }
      }
      return { membersCreated: rows.length, contributionsCreated };
    });
  }

  // ─── Accumulation engine (Phase 3e, server/accumulation.ts) ─────────────
  async getAccumulationAccountsByClient(orgId: string, clientId: string): Promise<AccumulationAccount[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(accumulationAccounts)
      .where(and(eq(accumulationAccounts.organizationId, orgId), eq(accumulationAccounts.clientId, clientId)))
      .orderBy(desc(accumulationAccounts.createdAt));
  }
  async getAccumulationAccount(id: string, orgId: string): Promise<AccumulationAccount | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [a] = await tdb.select().from(accumulationAccounts)
      .where(and(eq(accumulationAccounts.id, id), eq(accumulationAccounts.organizationId, orgId)));
    return a;
  }
  async createAccumulationAccount(account: InsertAccumulationAccount): Promise<AccumulationAccount> {
    const tdb = await getDbForOrg(account.organizationId);
    const [created] = await tdb.insert(accumulationAccounts).values(account).returning();
    return created;
  }
  async updateAccumulationAccount(id: string, data: Partial<InsertAccumulationAccount>, orgId: string): Promise<AccumulationAccount | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(accumulationAccounts).set(data)
      .where(and(eq(accumulationAccounts.id, id), eq(accumulationAccounts.organizationId, orgId)))
      .returning();
    return updated;
  }
  async getAccumulationContributions(orgId: string, accountId: string): Promise<AccumulationContribution[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(accumulationContributions)
      .where(and(eq(accumulationContributions.organizationId, orgId), eq(accumulationContributions.accumulationAccountId, accountId)))
      .orderBy(desc(accumulationContributions.contributionDate));
  }
  async createAccumulationContribution(contribution: InsertAccumulationContribution): Promise<AccumulationContribution> {
    const tdb = await getDbForOrg(contribution.organizationId);
    const [created] = await tdb.insert(accumulationContributions).values(contribution).returning();
    return created;
  }
  async getAccumulationWithdrawals(orgId: string, accountId: string): Promise<AccumulationWithdrawal[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(accumulationWithdrawals)
      .where(and(eq(accumulationWithdrawals.organizationId, orgId), eq(accumulationWithdrawals.accumulationAccountId, accountId)))
      .orderBy(desc(accumulationWithdrawals.createdAt));
  }
  async getAccumulationWithdrawal(id: string, orgId: string): Promise<AccumulationWithdrawal | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [w] = await tdb.select().from(accumulationWithdrawals)
      .where(and(eq(accumulationWithdrawals.id, id), eq(accumulationWithdrawals.organizationId, orgId)));
    return w;
  }
  async createAccumulationWithdrawal(withdrawal: InsertAccumulationWithdrawal): Promise<AccumulationWithdrawal> {
    const tdb = await getDbForOrg(withdrawal.organizationId);
    const [created] = await tdb.insert(accumulationWithdrawals).values(withdrawal).returning();
    return created;
  }
  async updateAccumulationWithdrawal(id: string, data: Partial<InsertAccumulationWithdrawal>, orgId: string): Promise<AccumulationWithdrawal | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(accumulationWithdrawals).set(data)
      .where(and(eq(accumulationWithdrawals.id, id), eq(accumulationWithdrawals.organizationId, orgId)))
      .returning();
    return updated;
  }

  async createGroupPaymentIntent(intent: InsertGroupPaymentIntent): Promise<GroupPaymentIntent> {
    const tdb = await getDbForOrg(intent.organizationId);
    const [created] = await tdb.insert(groupPaymentIntents).values({ ...intent, updatedAt: new Date() }).returning();
    return created;
  }
  async getGroupPaymentIntentById(id: string, orgId: string): Promise<GroupPaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(groupPaymentIntents).where(eq(groupPaymentIntents.id, id));
    return row;
  }
  async getGroupPaymentIntentByOrgAndIdempotencyKey(orgId: string, key: string): Promise<GroupPaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(groupPaymentIntents)
      .where(and(eq(groupPaymentIntents.organizationId, orgId), eq(groupPaymentIntents.idempotencyKey, key)));
    return row;
  }
  async updateGroupPaymentIntent(id: string, data: Partial<GroupPaymentIntent>, orgId: string): Promise<GroupPaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(groupPaymentIntents).set({ ...data, updatedAt: new Date() }).where(eq(groupPaymentIntents.id, id)).returning();
    return updated;
  }
  async getGroupPaymentAllocations(intentId: string, orgId: string): Promise<GroupPaymentAllocation[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(groupPaymentAllocations)
      .where(eq(groupPaymentAllocations.groupPaymentIntentId, intentId));
  }
  async getGroupPaymentIntentByMerchantReference(orgId: string, merchantReference: string): Promise<GroupPaymentIntent | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(groupPaymentIntents)
      .where(and(eq(groupPaymentIntents.organizationId, orgId), eq(groupPaymentIntents.merchantReference, merchantReference)));
    return row;
  }
  async createGroupPaymentAllocations(orgId: string, allocations: InsertGroupPaymentAllocation[]): Promise<void> {
    if (allocations.length === 0) return;
    const tdb = await getDbForOrg(orgId);
    await tdb.insert(groupPaymentAllocations).values(allocations);
  }

  async getOrCreatePolicyCreditBalance(orgId: string, policyId: string, currency: string): Promise<PolicyCreditBalance> {
    const tdb = await getDbForOrg(orgId);
    const [existing] = await tdb.select().from(policyCreditBalances)
      .where(and(eq(policyCreditBalances.organizationId, orgId), eq(policyCreditBalances.policyId, policyId)));
    if (existing) return existing;
    const [created] = await tdb.insert(policyCreditBalances).values({
      organizationId: orgId,
      policyId,
      balance: "0",
      currency,
      updatedAt: new Date(),
    }).returning();
    return created;
  }
  async addPolicyCreditBalance(orgId: string, policyId: string, amount: string, currency: string): Promise<PolicyCreditBalance | undefined> {
    const tdb = await getDbForOrg(orgId);
    // Atomic upsert: create if missing, otherwise add to existing balance
    const result = await tdb.execute(sql`
      INSERT INTO policy_credit_balances (organization_id, policy_id, balance, currency, updated_at)
      VALUES (${orgId}, ${policyId}, ${amount}::numeric, ${currency}, now())
      ON CONFLICT (policy_id, organization_id) DO UPDATE
        SET balance = policy_credit_balances.balance + ${amount}::numeric,
            updated_at = now()
      RETURNING *
    `);
    const rows = (result as unknown as { rows?: PolicyCreditBalance[] }).rows;
    return rows?.[0];
  }
  async addPolicyCreditBalanceInTx(tx: OrgDrizzleDb, orgId: string, policyId: string, amount: string, currency: string): Promise<void> {
    await tx.execute(sql`
      INSERT INTO policy_credit_balances (organization_id, policy_id, balance, currency, updated_at)
      VALUES (${orgId}, ${policyId}, ${amount}::numeric, ${currency}, now())
      ON CONFLICT (policy_id, organization_id) DO UPDATE
        SET balance = policy_credit_balances.balance + ${amount}::numeric,
            updated_at = now()
    `);
  }
  async getPolicyCreditBalance(orgId: string, policyId: string): Promise<PolicyCreditBalance | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(policyCreditBalances)
      .where(and(eq(policyCreditBalances.organizationId, orgId), eq(policyCreditBalances.policyId, policyId)));
    return row;
  }
  async getPolicyCreditBalancesWithPositiveBalance(orgId: string): Promise<PolicyCreditBalance[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policyCreditBalances)
      .where(and(eq(policyCreditBalances.organizationId, orgId), gt(policyCreditBalances.balance, "0")));
  }
  async deductPolicyCreditBalance(orgId: string, policyId: string, amount: string): Promise<PolicyCreditBalance | undefined> {
    const tdb = await getDbForOrg(orgId);
    // Atomic deduction: prevents race condition from read-then-write pattern
    const result = await tdb.execute(sql`
      UPDATE policy_credit_balances
      SET balance = GREATEST('0'::numeric, balance - ${amount}::numeric),
          updated_at = now()
      WHERE organization_id = ${orgId} AND policy_id = ${policyId}
      RETURNING *
    `);
    const rows = (result as unknown as { rows?: PolicyCreditBalance[] }).rows;
    return rows?.[0];
  }
  async createPolicyPremiumChange(change: InsertPolicyPremiumChange): Promise<PolicyPremiumChange> {
    const tdb = await getDbForOrg(change.organizationId);
    const [created] = await tdb.insert(policyPremiumChanges).values(change).returning();
    return created;
  }
  async getPolicyPremiumChanges(orgId: string, policyId: string): Promise<PolicyPremiumChange[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(policyPremiumChanges)
      .where(and(eq(policyPremiumChanges.organizationId, orgId), eq(policyPremiumChanges.policyId, policyId)))
      .orderBy(desc(policyPremiumChanges.createdAt));
  }
  async deactivatePolicyMember(memberId: string, policyId: string, orgId: string): Promise<PolicyMember | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(policyMembers)
      .set({ isActive: false })
      .where(and(
        eq(policyMembers.id, memberId),
        eq(policyMembers.policyId, policyId),
        eq(policyMembers.organizationId, orgId),
      ))
      .returning();
    return updated;
  }

  // ── Finance: FX rates ──
  async getFxRates(orgId: string): Promise<FxRate[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(fxRates).where(eq(fxRates.organizationId, orgId));
  }
  async upsertFxRate(orgId: string, currency: string, rateToUsd: string, updatedBy?: string): Promise<FxRate> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO fx_rates (organization_id, currency, rate_to_usd, updated_by, updated_at)
      VALUES (${orgId}, ${currency}, ${rateToUsd}::numeric, ${updatedBy ?? null}, now())
      ON CONFLICT (organization_id, currency) DO UPDATE
        SET rate_to_usd = ${rateToUsd}::numeric, updated_by = ${updatedBy ?? null}, updated_at = now()
      RETURNING *
    `);
    const rows = (result as unknown as { rows?: FxRate[] }).rows;
    return rows![0];
  }

  // ── Finance: requisitions ──
  async getRequisitions(orgId: string, filters?: { status?: string; fromDate?: string; toDate?: string; funeralCaseId?: string }): Promise<Requisition[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: any[] = [eq(requisitions.organizationId, orgId)];
    if (filters?.status) conditions.push(eq(requisitions.status, filters.status));
    if (filters?.fromDate) conditions.push(gte(requisitions.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(requisitions.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    if (filters?.funeralCaseId) conditions.push(eq(requisitions.funeralCaseId, filters.funeralCaseId));
    return tdb.select().from(requisitions).where(and(...conditions)).orderBy(desc(requisitions.createdAt));
  }
  async getRequisition(id: string, orgId: string): Promise<Requisition | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(requisitions)
      .where(and(eq(requisitions.id, id), eq(requisitions.organizationId, orgId)));
    return row;
  }
  async createRequisition(req: InsertRequisition): Promise<Requisition> {
    const tdb = await getDbForOrg(req.organizationId);
    const [created] = await tdb.insert(requisitions).values(req).returning();
    return created;
  }
  async updateRequisition(id: string, orgId: string, data: Partial<Requisition>): Promise<Requisition | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(requisitions).set(data)
      .where(and(eq(requisitions.id, id), eq(requisitions.organizationId, orgId)))
      .returning();
    return updated;
  }
  async createRequisitionItems(items: InsertRequisitionItem[]): Promise<RequisitionItem[]> {
    if (items.length === 0) return [];
    const tdb = await getDbForOrg(items[0].organizationId);
    return tdb.insert(requisitionItems).values(items).returning();
  }
  async getRequisitionItemsByOrg(orgId: string): Promise<RequisitionItem[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(requisitionItems).where(eq(requisitionItems.organizationId, orgId));
  }
  async getRequisitionItemsByIds(requisitionIds: string[], orgId: string): Promise<RequisitionItem[]> {
    if (requisitionIds.length === 0) return [];
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(requisitionItems)
      .where(and(inArray(requisitionItems.requisitionId, requisitionIds), eq(requisitionItems.organizationId, orgId)));
  }

  // ── Payment disbursements ──────────────────────────────────
  async createPaymentDisbursement(data: InsertPaymentDisbursement): Promise<PaymentDisbursement> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(paymentDisbursements).values(data).returning();
    return row;
  }

  async getPaymentDisbursements(orgId: string, filters?: {
    entityType?: string;
    entityId?: string;
    fromDate?: string;
    toDate?: string;
    branchId?: string;
  }): Promise<PaymentDisbursement[]> {
    const tdb = await getDbForOrg(orgId);
    const conds: any[] = [eq(paymentDisbursements.organizationId, orgId)];
    if (filters?.entityType) conds.push(eq(paymentDisbursements.entityType, filters.entityType));
    if (filters?.entityId) conds.push(eq(paymentDisbursements.entityId, filters.entityId));
    if (filters?.branchId) conds.push(eq(paymentDisbursements.branchId, filters.branchId));
    if (filters?.fromDate) conds.push(sql`${paymentDisbursements.paidDate} >= ${filters.fromDate}`);
    if (filters?.toDate) conds.push(sql`${paymentDisbursements.paidDate} <= ${filters.toDate}`);
    return tdb.select().from(paymentDisbursements)
      .where(and(...conds))
      .orderBy(desc(paymentDisbursements.paidDate))
      .limit(1000);
  }

  async getPaymentDisbursementsByEntity(entityType: string, entityId: string, orgId: string): Promise<PaymentDisbursement[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentDisbursements)
      .where(and(
        eq(paymentDisbursements.organizationId, orgId),
        eq(paymentDisbursements.entityType, entityType),
        eq(paymentDisbursements.entityId, entityId),
      ))
      .orderBy(paymentDisbursements.paidDate);
  }

  async getPaymentDisbursementById(id: string, orgId: string): Promise<PaymentDisbursement | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(paymentDisbursements)
      .where(and(eq(paymentDisbursements.id, id), eq(paymentDisbursements.organizationId, orgId)));
    return row;
  }

  // ── Bank accounts ──────────────────────────────────────────
  async getBankAccounts(orgId: string): Promise<BankAccount[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(bankAccounts)
      .where(eq(bankAccounts.organizationId, orgId))
      .orderBy(bankAccounts.accountName);
  }
  async getBankAccount(id: string, orgId: string): Promise<BankAccount | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId)));
    return row;
  }
  async createBankAccount(data: InsertBankAccount): Promise<BankAccount> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(bankAccounts).values(data).returning();
    return row;
  }
  async updateBankAccount(id: string, orgId: string, data: Partial<BankAccount>): Promise<BankAccount | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(bankAccounts).set(data).where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId))).returning();
    return row;
  }

  // ── Safes (alternative cash destination to a bank account) ──
  async getSafes(orgId: string): Promise<Safe[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(safes).where(eq(safes.organizationId, orgId)).orderBy(safes.name);
  }
  async getSafe(id: string, orgId: string): Promise<Safe | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(safes).where(and(eq(safes.id, id), eq(safes.organizationId, orgId)));
    return row;
  }
  async createSafe(data: InsertSafe): Promise<Safe> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(safes).values(data).returning();
    return row;
  }
  async updateSafe(id: string, orgId: string, data: Partial<Safe>): Promise<Safe | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(safes).set(data).where(and(eq(safes.id, id), eq(safes.organizationId, orgId))).returning();
    return row;
  }

  // ── Bank deposits ──────────────────────────────────────────
  async getBankDeposits(orgId: string, filters?: { userId?: string; bankAccountId?: string; safeId?: string; fromDate?: string; toDate?: string }): Promise<BankDeposit[]> {
    const tdb = await getDbForOrg(orgId);
    const conds: any[] = [eq(bankDeposits.organizationId, orgId)];
    if (filters?.userId) conds.push(eq(bankDeposits.depositedByUserId, filters.userId));
    if (filters?.bankAccountId) conds.push(eq(bankDeposits.bankAccountId, filters.bankAccountId));
    if (filters?.safeId) conds.push(eq(bankDeposits.safeId, filters.safeId));
    if (filters?.fromDate) conds.push(sql`${bankDeposits.depositDate} >= ${filters.fromDate}`);
    if (filters?.toDate) conds.push(sql`${bankDeposits.depositDate} <= ${filters.toDate}`);
    return tdb.select().from(bankDeposits).where(and(...conds)).orderBy(desc(bankDeposits.depositDate));
  }
  async getBankDepositById(id: string, orgId: string): Promise<BankDeposit | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(bankDeposits)
      .where(and(eq(bankDeposits.id, id), eq(bankDeposits.organizationId, orgId)));
    return row;
  }
  async createBankDeposit(data: InsertBankDeposit): Promise<BankDeposit> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(bankDeposits).values(data).returning();
    return row;
  }
  async updateBankDeposit(id: string, orgId: string, data: Partial<BankDeposit>): Promise<BankDeposit | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(bankDeposits).set(data).where(and(eq(bankDeposits.id, id), eq(bankDeposits.organizationId, orgId))).returning();
    return row;
  }

  // ── Bank statement balances ────────────────────────────────
  async getBankStatementBalances(orgId: string, bankAccountId?: string): Promise<BankStatementBalance[]> {
    const tdb = await getDbForOrg(orgId);
    const conds: any[] = [eq(bankStatementBalances.organizationId, orgId)];
    if (bankAccountId) conds.push(eq(bankStatementBalances.bankAccountId, bankAccountId));
    return tdb.select().from(bankStatementBalances).where(and(...conds)).orderBy(desc(bankStatementBalances.statementDate));
  }
  async createBankStatementBalance(data: InsertBankStatementBalance): Promise<BankStatementBalance> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(bankStatementBalances).values(data).returning();
    return row;
  }

  // ── Per-admin cash position ────────────────────────────────
  // Returns how much unbanked cash each admin currently holds.
  async getAdminCashPosition(orgId: string, asOf?: string): Promise<Array<{ userId: string; totalCollected: number; totalDeposited: number; onHand: number; lastDepositDate: string | null; currency: string }>> {
    const tdb = await getDbForOrg(orgId);
    // Cash collected: sum cashup cash amounts per admin (submitted or confirmed cashups)
    const cashupRows = await tdb.execute(sql`
      SELECT
        prepared_by   AS user_id,
        currency,
        COALESCE(SUM((amounts_by_method->>'cash')::numeric), 0) AS total_collected
      FROM cashups
      WHERE organization_id = ${orgId}
        AND status IN ('submitted','confirmed')
        ${asOf ? sql`AND cashup_date <= ${asOf}` : sql``}
      GROUP BY prepared_by, currency
    `);
    // Cash deposited: sum bank deposits per admin
    const depositRows = await tdb.execute(sql`
      SELECT
        deposited_by_user_id AS user_id,
        currency,
        COALESCE(SUM(amount::numeric), 0) AS total_deposited,
        MAX(deposit_date)                  AS last_deposit_date
      FROM bank_deposits
      WHERE organization_id = ${orgId}
        ${asOf ? sql`AND deposit_date <= ${asOf}` : sql``}
      GROUP BY deposited_by_user_id, currency
    `);

    const collected = new Map<string, { total: number; currency: string }>();
    for (const r of (cashupRows.rows ?? cashupRows) as any[]) {
      const key = `${r.user_id}:${r.currency}`;
      collected.set(key, { total: parseFloat(r.total_collected ?? 0), currency: r.currency });
    }
    const deposited = new Map<string, { total: number; lastDate: string | null }>();
    for (const r of (depositRows.rows ?? depositRows) as any[]) {
      const key = `${r.user_id}:${r.currency}`;
      deposited.set(key, { total: parseFloat(r.total_deposited ?? 0), lastDate: r.last_deposit_date });
    }

    // Merge into per-user position
    const positions: Record<string, { userId: string; totalCollected: number; totalDeposited: number; onHand: number; lastDepositDate: string | null; currency: string }> = {};
    collected.forEach((col, key) => {
      const parts = key.split(":");
      const userId = parts[0]; const currency = parts[1];
      const dep = deposited.get(key) ?? { total: 0, lastDate: null };
      const onHand = col.total - dep.total;
      positions[key] = { userId, totalCollected: col.total, totalDeposited: dep.total, onHand, lastDepositDate: dep.lastDate, currency };
    });
    // Include admins who only have deposits but no cashups (edge case)
    deposited.forEach((dep, key) => {
      if (!positions[key]) {
        const parts = key.split(":");
        const userId = parts[0]; const currency = parts[1];
        positions[key] = { userId, totalCollected: 0, totalDeposited: dep.total, onHand: -dep.total, lastDepositDate: dep.lastDate, currency };
      }
    });
    return Object.values(positions).filter(p => p.totalCollected > 0 || p.totalDeposited > 0);
  }

  // ── Balance sheet manual entries ──────────────────────────
  async getBalanceSheetEntries(orgId: string, filters?: { section?: string; asOfDate?: string }): Promise<BalanceSheetEntry[]> {
    const tdb = await getDbForOrg(orgId);
    const conds: any[] = [eq(balanceSheetEntries.organizationId, orgId)];
    if (filters?.section) conds.push(eq(balanceSheetEntries.section, filters.section));
    if (filters?.asOfDate) conds.push(sql`${balanceSheetEntries.asOfDate} <= ${filters.asOfDate}`);
    return tdb.select().from(balanceSheetEntries).where(and(...conds)).orderBy(balanceSheetEntries.section, balanceSheetEntries.subsection, balanceSheetEntries.label);
  }
  async getBalanceSheetEntry(id: string, orgId: string): Promise<BalanceSheetEntry | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(balanceSheetEntries)
      .where(and(eq(balanceSheetEntries.id, id), eq(balanceSheetEntries.organizationId, orgId)));
    return row;
  }
  async createBalanceSheetEntry(data: InsertBalanceSheetEntry): Promise<BalanceSheetEntry> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(balanceSheetEntries).values(data).returning();
    return row;
  }
  async updateBalanceSheetEntry(id: string, orgId: string, data: Partial<BalanceSheetEntry>): Promise<BalanceSheetEntry | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(balanceSheetEntries).set({ ...data, updatedAt: new Date() })
      .where(and(eq(balanceSheetEntries.id, id), eq(balanceSheetEntries.organizationId, orgId))).returning();
    return row;
  }
  async deleteBalanceSheetEntry(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(balanceSheetEntries).where(and(eq(balanceSheetEntries.id, id), eq(balanceSheetEntries.organizationId, orgId)));
  }

  // ── Finance: debit orders (recurring premium-collection mandates) ──
  async getDebitOrders(orgId: string, filters?: { status?: string; policyId?: string }): Promise<DebitOrder[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: any[] = [eq(debitOrders.organizationId, orgId)];
    if (filters?.status) conditions.push(eq(debitOrders.status, filters.status));
    if (filters?.policyId) conditions.push(eq(debitOrders.policyId, filters.policyId));
    return tdb.select().from(debitOrders).where(and(...conditions)).orderBy(desc(debitOrders.createdAt));
  }
  async getDebitOrder(id: string, orgId: string): Promise<DebitOrder | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(debitOrders)
      .where(and(eq(debitOrders.id, id), eq(debitOrders.organizationId, orgId)));
    return row;
  }
  async createDebitOrder(order: InsertDebitOrder): Promise<DebitOrder> {
    const tdb = await getDbForOrg(order.organizationId);
    const [created] = await tdb.insert(debitOrders).values(order).returning();
    return created;
  }
  async updateDebitOrder(id: string, orgId: string, data: Partial<DebitOrder>): Promise<DebitOrder | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(debitOrders).set(data)
      .where(and(eq(debitOrders.id, id), eq(debitOrders.organizationId, orgId)))
      .returning();
    return updated;
  }

  // ── Finance: funeral quotations ──
  async generateQuotationNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, quotation_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET quotation_next = org_policy_sequences.quotation_next + 1
      RETURNING quotation_next
    `);
    const nextVal = (result as unknown as { rows?: { quotation_next: number }[] }).rows?.[0]?.quotation_next ?? 1;
    return `QUO-${String(nextVal).padStart(6, "0")}`;
  }
  async getFuneralQuotation(funeralCaseId: string, orgId: string): Promise<(FuneralQuotation & { items: FuneralQuotationItem[] }) | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [quote] = await tdb.select().from(funeralQuotations)
      .where(and(eq(funeralQuotations.organizationId, orgId), eq(funeralQuotations.funeralCaseId, funeralCaseId)))
      .orderBy(desc(funeralQuotations.createdAt));
    if (!quote) return undefined;
    const items = await tdb.select().from(funeralQuotationItems).where(eq(funeralQuotationItems.quotationId, quote.id));
    return { ...quote, items };
  }
  async getQuotationById(id: string, orgId: string): Promise<(FuneralQuotation & { items: FuneralQuotationItem[] }) | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [quote] = await tdb.select().from(funeralQuotations)
      .where(and(eq(funeralQuotations.id, id), eq(funeralQuotations.organizationId, orgId)));
    if (!quote) return undefined;
    const items = await tdb.select().from(funeralQuotationItems).where(eq(funeralQuotationItems.quotationId, quote.id));
    return { ...quote, items };
  }
  async getQuotationsByOrg(orgId: string, opts?: { q?: string; status?: string; limit?: number; offset?: number }): Promise<FuneralQuotation[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: any[] = [eq(funeralQuotations.organizationId, orgId)];
    if (opts?.status && opts.status !== "all") conditions.push(eq(funeralQuotations.conversionStatus, opts.status));
    if (opts?.q) {
      const term = `%${opts.q}%`;
      conditions.push(or(ilike(funeralQuotations.quotationNumber, term), ilike(funeralQuotations.deceasedName, term)));
    }
    return tdb.select().from(funeralQuotations)
      .where(and(...conditions))
      .orderBy(desc(funeralQuotations.createdAt))
      .limit(opts?.limit ?? 200)
      .offset(opts?.offset ?? 0);
  }
  private _computeQuotationTotals(items: { lineTotal: string | number }[], vatRate: number, discountAmount: number) {
    const subtotal = items.reduce((s, it) => s + parseFloat(String(it.lineTotal || "0")), 0);
    const vatAmount = subtotal * (vatRate / 100);
    const grandTotal = subtotal + vatAmount - discountAmount;
    return {
      subtotal: subtotal.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
      total: grandTotal.toFixed(2),
    };
  }
  async upsertFuneralQuotation(
    orgId: string,
    funeralCaseId: string,
    data: {
      currency: string; status?: string; notes?: string; createdBy?: string;
      informantFullNames?: string; informantPhone?: string; informantAddress?: string;
      deceasedName?: string; deceasedAge?: number; deceasedSex?: string; casketType?: string;
      quotationDate?: string; vatRate?: number; discountAmount?: number; paymentType?: string;
    },
    items: Omit<InsertFuneralQuotationItem, "quotationId">[]
  ): Promise<FuneralQuotation> {
    const vatRate = data.vatRate ?? 15;
    const discountAmount = data.discountAmount ?? 0;
    const totals = this._computeQuotationTotals(items, vatRate, discountAmount);
    return withOrgTransaction(orgId, async (tx) => {
      // Find existing quote for this case (partial index allows null funeralCaseId without conflict).
      const [existing] = await tx.select({ id: funeralQuotations.id })
        .from(funeralQuotations)
        .where(and(eq(funeralQuotations.organizationId, orgId), eq(funeralQuotations.funeralCaseId, funeralCaseId)));
      let quote: FuneralQuotation;
      if (existing) {
        const [updated] = await tx.update(funeralQuotations)
          .set({
            currency: data.currency, ...totals,
            vatRate: String(vatRate), discountAmount: String(discountAmount),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
            ...(data.informantFullNames !== undefined ? { informantFullNames: data.informantFullNames } : {}),
            ...(data.informantPhone !== undefined ? { informantPhone: data.informantPhone } : {}),
            ...(data.informantAddress !== undefined ? { informantAddress: data.informantAddress } : {}),
            ...(data.deceasedName !== undefined ? { deceasedName: data.deceasedName } : {}),
            ...(data.deceasedAge !== undefined ? { deceasedAge: data.deceasedAge } : {}),
            ...(data.deceasedSex !== undefined ? { deceasedSex: data.deceasedSex } : {}),
            ...(data.casketType !== undefined ? { casketType: data.casketType } : {}),
            ...(data.quotationDate !== undefined ? { quotationDate: data.quotationDate } : {}),
            ...(data.paymentType !== undefined ? { paymentType: data.paymentType } : {}),
          })
          .where(eq(funeralQuotations.id, existing.id))
          .returning();
        quote = updated;
      } else {
        const quotationNumber = await this.generateQuotationNumber(orgId);
        const [inserted] = await tx.insert(funeralQuotations)
          .values({
            organizationId: orgId, funeralCaseId, quotationNumber,
            currency: data.currency, ...totals,
            vatRate: String(vatRate), discountAmount: String(discountAmount),
            status: data.status ?? "draft", notes: data.notes ?? null, createdBy: data.createdBy ?? null,
            informantFullNames: data.informantFullNames ?? null,
            informantPhone: data.informantPhone ?? null,
            informantAddress: data.informantAddress ?? null,
            deceasedName: data.deceasedName ?? null,
            deceasedAge: data.deceasedAge ?? null,
            deceasedSex: data.deceasedSex ?? null,
            casketType: data.casketType ?? null,
            quotationDate: data.quotationDate ?? null,
            paymentType: data.paymentType ?? null,
          })
          .returning();
        quote = inserted;
      }
      await tx.delete(funeralQuotationItems).where(eq(funeralQuotationItems.quotationId, quote.id));
      if (items.length > 0) {
        await tx.insert(funeralQuotationItems).values(items.map((it) => ({ ...it, quotationId: quote.id })));
      }
      return quote;
    });
  }
  async deleteFuneralQuotation(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(funeralQuotations).where(and(eq(funeralQuotations.id, id), eq(funeralQuotations.organizationId, orgId)));
  }
  async createStandaloneQuotation(
    orgId: string,
    data: {
      currency: string; status?: string; notes?: string; createdBy?: string;
      informantFullNames?: string; informantPhone?: string; informantAddress?: string;
      deceasedName?: string; deceasedAge?: number; deceasedSex?: string; casketType?: string;
      quotationDate?: string; vatRate?: number; discountAmount?: number; paymentType?: string;
    },
    items: Omit<InsertFuneralQuotationItem, "quotationId">[]
  ): Promise<FuneralQuotation> {
    const vatRate = data.vatRate ?? 15;
    const discountAmount = data.discountAmount ?? 0;
    const totals = this._computeQuotationTotals(items, vatRate, discountAmount);
    return withOrgTransaction(orgId, async (tx) => {
      const quotationNumber = await this.generateQuotationNumber(orgId);
      const [quote] = await tx.insert(funeralQuotations)
        .values({
          organizationId: orgId, funeralCaseId: null, quotationNumber,
          currency: data.currency, ...totals,
          vatRate: String(vatRate), discountAmount: String(discountAmount),
          status: data.status ?? "draft", notes: data.notes ?? null, createdBy: data.createdBy ?? null,
          informantFullNames: data.informantFullNames ?? null,
          informantPhone: data.informantPhone ?? null,
          informantAddress: data.informantAddress ?? null,
          deceasedName: data.deceasedName ?? null,
          deceasedAge: data.deceasedAge ?? null,
          deceasedSex: data.deceasedSex ?? null,
          casketType: data.casketType ?? null,
          quotationDate: data.quotationDate ?? null,
          paymentType: data.paymentType ?? null,
        })
        .returning();
      if (items.length > 0) {
        await tx.insert(funeralQuotationItems).values(items.map((it) => ({ ...it, quotationId: quote.id })));
      }
      return quote;
    });
  }
  async updateStandaloneQuotation(
    id: string,
    orgId: string,
    data: {
      currency: string; status?: string; notes?: string; createdBy?: string;
      informantFullNames?: string; informantPhone?: string; informantAddress?: string;
      deceasedName?: string; deceasedAge?: number; deceasedSex?: string; casketType?: string;
      quotationDate?: string; vatRate?: number; discountAmount?: number; paymentType?: string;
    },
    items: Omit<InsertFuneralQuotationItem, "quotationId">[]
  ): Promise<FuneralQuotation | undefined> {
    const vatRate = data.vatRate ?? 15;
    const discountAmount = data.discountAmount ?? 0;
    const totals = this._computeQuotationTotals(items, vatRate, discountAmount);
    return withOrgTransaction(orgId, async (tx) => {
      const [updated] = await tx.update(funeralQuotations)
        .set({
          currency: data.currency, ...totals,
          vatRate: String(vatRate), discountAmount: String(discountAmount),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.informantFullNames !== undefined ? { informantFullNames: data.informantFullNames } : {}),
          ...(data.informantPhone !== undefined ? { informantPhone: data.informantPhone } : {}),
          ...(data.informantAddress !== undefined ? { informantAddress: data.informantAddress } : {}),
          ...(data.deceasedName !== undefined ? { deceasedName: data.deceasedName } : {}),
          ...(data.deceasedAge !== undefined ? { deceasedAge: data.deceasedAge } : {}),
          ...(data.deceasedSex !== undefined ? { deceasedSex: data.deceasedSex } : {}),
          ...(data.casketType !== undefined ? { casketType: data.casketType } : {}),
          ...(data.quotationDate !== undefined ? { quotationDate: data.quotationDate } : {}),
          ...(data.paymentType !== undefined ? { paymentType: data.paymentType } : {}),
        })
        .where(and(eq(funeralQuotations.id, id), eq(funeralQuotations.organizationId, orgId)))
        .returning();
      if (!updated) return undefined;
      await tx.delete(funeralQuotationItems).where(eq(funeralQuotationItems.quotationId, id));
      if (items.length > 0) {
        await tx.insert(funeralQuotationItems).values(items.map((it) => ({ ...it, quotationId: id })));
      }
      return updated;
    });
  }
  async linkQuotationToCase(quotationId: string, funeralCaseId: string, orgId: string, blankFillPatch?: Record<string, any>): Promise<FuneralQuotation | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(funeralQuotations)
      .set({ funeralCaseId, ...(blankFillPatch || {}) })
      .where(and(eq(funeralQuotations.id, quotationId), eq(funeralQuotations.organizationId, orgId)))
      .returning();
    return updated;
  }
  async markQuotationConverted(quotationId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(funeralQuotations)
      .set({ conversionStatus: "converted", convertedAt: new Date(), status: "converted" })
      .where(and(eq(funeralQuotations.id, quotationId), eq(funeralQuotations.organizationId, orgId)));
  }
  async markQuotationPartialPayment(quotationId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(funeralQuotations)
      .set({ conversionStatus: "partial" })
      .where(and(eq(funeralQuotations.id, quotationId), eq(funeralQuotations.organizationId, orgId)));
  }
  async upsertQuotationGuarantor(quotationId: string, orgId: string, data: Omit<InsertQuotationGuarantor, "id" | "quotationId" | "organizationId" | "createdAt">): Promise<QuotationGuarantor> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.insert(quotationGuarantors)
      .values({ ...data, quotationId, organizationId: orgId })
      .onConflictDoUpdate({ target: quotationGuarantors.quotationId, set: data })
      .returning();
    return row;
  }
  async getQuotationGuarantor(quotationId: string, orgId: string): Promise<QuotationGuarantor | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(quotationGuarantors)
      .where(and(eq(quotationGuarantors.quotationId, quotationId), eq(quotationGuarantors.organizationId, orgId)));
    return row;
  }
  async getQuotationCollateral(quotationId: string, orgId: string): Promise<QuotationCollateralItem[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(quotationCollateral)
      .where(and(eq(quotationCollateral.quotationId, quotationId), eq(quotationCollateral.organizationId, orgId)))
      .orderBy(quotationCollateral.createdAt);
  }
  async addQuotationCollateral(data: InsertQuotationCollateralItem): Promise<QuotationCollateralItem> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(quotationCollateral).values(data).returning();
    return created;
  }
  async deleteQuotationCollateral(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(quotationCollateral)
      .where(and(eq(quotationCollateral.id, id), eq(quotationCollateral.organizationId, orgId)));
  }

  // ── Finance: service receipts (cash-service income) ──
  async getServiceReceipts(orgId: string, opts?: { funeralCaseId?: string; fromDate?: string; toDate?: string }): Promise<ServiceReceipt[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: any[] = [eq(serviceReceipts.organizationId, orgId)];
    if (opts?.funeralCaseId) conditions.push(eq(serviceReceipts.funeralCaseId, opts.funeralCaseId));
    if (opts?.fromDate) conditions.push(gte(serviceReceipts.issuedAt, new Date(opts.fromDate + "T00:00:00.000Z")));
    if (opts?.toDate) conditions.push(lte(serviceReceipts.issuedAt, new Date(opts.toDate + "T23:59:59.999Z")));
    return tdb.select().from(serviceReceipts).where(and(...conditions)).orderBy(desc(serviceReceipts.issuedAt)).limit(500);
  }
  async getServiceReceiptByIdempotencyKey(orgId: string, idempotencyKey: string): Promise<ServiceReceipt | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(serviceReceipts)
      .where(and(eq(serviceReceipts.organizationId, orgId), eq(serviceReceipts.idempotencyKey, idempotencyKey)));
    return row;
  }
  async createServiceReceipt(receipt: InsertServiceReceipt): Promise<ServiceReceipt> {
    const tdb = await getDbForOrg(receipt.organizationId);
    // No idempotency key → plain insert.
    if (!receipt.idempotencyKey) {
      const [created] = await tdb.insert(serviceReceipts).values(receipt).returning();
      return created;
    }
    // Idempotent path: dedupe atomically via the unique index sr_idempotency_org_idx so a
    // double-submit on the money path can't create two receipts.
    const [created] = await tdb.insert(serviceReceipts).values(receipt)
      .onConflictDoNothing({ target: [serviceReceipts.organizationId, serviceReceipts.idempotencyKey] })
      .returning();
    if (created) return created;
    // Conflict: a receipt with this key already exists (or is being committed concurrently).
    const existing = await this.getServiceReceiptByIdempotencyKey(receipt.organizationId, receipt.idempotencyKey);
    if (existing) return existing;
    // Conflict reported but the row isn't visible yet (concurrent uncommitted insert). Fail safe
    // rather than fall through to an unguarded insert that would hit the unique violation — the
    // caller can retry and will then read back the committed receipt.
    throw new Error("Service receipt idempotency conflict: a concurrent receipt with the same key is being created");
  }
  async getServiceReceiptById(id: string, orgId: string): Promise<ServiceReceipt | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(serviceReceipts)
      .where(and(eq(serviceReceipts.id, id), eq(serviceReceipts.organizationId, orgId)));
    return row;
  }
  async getClientDeviceTokens(clientId: string, orgId: string): Promise<{ id: string; token: string; platform: string }[]> {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb.select({ id: clientDeviceTokens.id, token: clientDeviceTokens.token, platform: clientDeviceTokens.platform })
      .from(clientDeviceTokens)
      .where(and(eq(clientDeviceTokens.organizationId, orgId), eq(clientDeviceTokens.clientId, clientId)));
    return rows;
  }
  async addClientDeviceToken(orgId: string, clientId: string, token: string, platform: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    const tok = token.trim();
    const plat = platform || "web";
    const existing = await tdb.select().from(clientDeviceTokens)
      .where(and(eq(clientDeviceTokens.organizationId, orgId), eq(clientDeviceTokens.token, tok)))
      .limit(1);
    if (existing.length > 0) {
      await tdb.update(clientDeviceTokens)
        .set({ clientId, platform: plat })
        .where(eq(clientDeviceTokens.id, existing[0].id));
    } else {
      await tdb.insert(clientDeviceTokens).values({
        organizationId: orgId,
        clientId,
        token: tok,
        platform: plat,
      });
    }
  }
  async removeClientDeviceToken(orgId: string, token: string, clientId?: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(clientDeviceTokens.organizationId, orgId), eq(clientDeviceTokens.token, token.trim())];
    if (clientId) conditions.push(eq(clientDeviceTokens.clientId, clientId));
    await tdb.delete(clientDeviceTokens).where(and(...conditions));
  }

  // ── User notifications ──────────────────────────────────────
  async createUserNotification(data: InsertUserNotification): Promise<UserNotification> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(userNotifications).values(data).returning();
    return row;
  }
  async getUserNotifications(orgId: string, userId: string, limit = 50, offset = 0): Promise<UserNotification[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(userNotifications)
      .where(and(eq(userNotifications.organizationId, orgId), eq(userNotifications.recipientId, userId)))
      .orderBy(desc(userNotifications.createdAt))
      .limit(limit).offset(offset);
  }
  async getUnreadUserNotificationCount(orgId: string, userId: string): Promise<number> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select({ cnt: count() }).from(userNotifications)
      .where(and(eq(userNotifications.organizationId, orgId), eq(userNotifications.recipientId, userId), eq(userNotifications.isRead, false)));
    return Number(row?.cnt ?? 0);
  }
  async markUserNotificationRead(id: string, userId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(userNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(userNotifications.id, id), eq(userNotifications.recipientId, userId), eq(userNotifications.organizationId, orgId)));
  }
  async markAllUserNotificationsRead(orgId: string, userId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.update(userNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(userNotifications.organizationId, orgId), eq(userNotifications.recipientId, userId), eq(userNotifications.isRead, false)));
  }

  // ── User device tokens ──────────────────────────────────────
  async getUserDeviceTokens(orgId: string, userId: string): Promise<{ id: string; token: string; platform: string }[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select({ id: userDeviceTokens.id, token: userDeviceTokens.token, platform: userDeviceTokens.platform })
      .from(userDeviceTokens)
      .where(and(eq(userDeviceTokens.organizationId, orgId), eq(userDeviceTokens.userId, userId)));
  }
  async getAllUserDeviceTokensByOrg(orgId: string): Promise<{ id: string; userId: string; token: string; platform: string }[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select({ id: userDeviceTokens.id, userId: userDeviceTokens.userId, token: userDeviceTokens.token, platform: userDeviceTokens.platform })
      .from(userDeviceTokens)
      .where(eq(userDeviceTokens.organizationId, orgId));
  }
  async upsertUserDeviceToken(orgId: string, userId: string, token: string, platform: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    const tok = token.trim();
    const existing = await tdb.select().from(userDeviceTokens).where(eq(userDeviceTokens.token, tok)).limit(1);
    if (existing.length > 0) {
      await tdb.update(userDeviceTokens).set({ userId, organizationId: orgId, platform, updatedAt: new Date() }).where(eq(userDeviceTokens.id, existing[0].id));
    } else {
      await tdb.insert(userDeviceTokens).values({ organizationId: orgId, userId, token: tok, platform });
    }
  }
  async removeUserDeviceToken(token: string): Promise<void> {
    const tdb = db; // token is unique globally, use main db
    await tdb.delete(userDeviceTokens).where(eq(userDeviceTokens.token, token.trim()));
  }
  async getClientPaymentMethods(clientId: string, orgId: string): Promise<ClientPaymentMethod[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(clientPaymentMethods)
      .where(and(eq(clientPaymentMethods.organizationId, orgId), eq(clientPaymentMethods.clientId, clientId)))
      .orderBy(desc(clientPaymentMethods.isDefault), desc(clientPaymentMethods.updatedAt));
  }
  async upsertDefaultClientPaymentMethod(orgId: string, clientId: string, method: InsertClientPaymentMethod): Promise<ClientPaymentMethod> {
    const tdb = await getDbForOrg(orgId);
    const existing = await this.getClientPaymentMethods(clientId, orgId);
    const activeDefault = existing.find((m) => m.isDefault && m.isActive);
    const normalized: InsertClientPaymentMethod = {
      ...method,
      organizationId: orgId,
      clientId,
      isDefault: true,
      isActive: true,
    };
    if (activeDefault) {
      const [updated] = await tdb.update(clientPaymentMethods).set({
        methodType: normalized.methodType,
        provider: normalized.provider ?? null,
        mobileNumber: normalized.mobileNumber ?? null,
        cardLast4: normalized.cardLast4 ?? null,
        cardBrand: normalized.cardBrand ?? null,
        cardExpiryMonth: normalized.cardExpiryMonth ?? null,
        cardExpiryYear: normalized.cardExpiryYear ?? null,
        cardToken: normalized.cardToken ?? null,
        isActive: true,
        updatedAt: new Date(),
      }).where(eq(clientPaymentMethods.id, activeDefault.id)).returning();
      return updated;
    }
    const [created] = await tdb.insert(clientPaymentMethods).values(normalized).returning();
    return created;
  }
  async getDefaultClientPaymentMethod(clientId: string, orgId: string): Promise<ClientPaymentMethod | undefined> {
    const methods = await this.getClientPaymentMethods(clientId, orgId);
    return methods.find((m) => m.isDefault && m.isActive) ?? methods.find((m) => m.isActive);
  }
  async getPaymentAutomationSettings(orgId: string): Promise<PaymentAutomationSettings | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(paymentAutomationSettings)
      .where(eq(paymentAutomationSettings.organizationId, orgId))
      .limit(1);
    return row;
  }
  async upsertPaymentAutomationSettings(orgId: string, data: Partial<InsertPaymentAutomationSettings>): Promise<PaymentAutomationSettings> {
    const tdb = await getDbForOrg(orgId);
    const existing = await this.getPaymentAutomationSettings(orgId);
    if (existing) {
      const [updated] = await tdb.update(paymentAutomationSettings).set({
        ...data,
        updatedAt: new Date(),
      }).where(eq(paymentAutomationSettings.id, existing.id)).returning();
      return updated;
    }
    const [created] = await tdb.insert(paymentAutomationSettings).values({
      organizationId: orgId,
      isEnabled: data.isEnabled ?? false,
      daysAfterLastPayment: data.daysAfterLastPayment ?? 30,
      repeatEveryDays: data.repeatEveryDays ?? 30,
      sendPushNotifications: data.sendPushNotifications ?? true,
      autoRunPayments: data.autoRunPayments ?? true,
    }).returning();
    return created;
  }
  async createPaymentAutomationRun(orgId: string, data: InsertPaymentAutomationRun): Promise<PaymentAutomationRun> {
    const tdb = await getDbForOrg(orgId);
    const [created] = await tdb.insert(paymentAutomationRuns).values({
      ...data,
      organizationId: orgId,
    }).returning();
    return created;
  }
  async getPaymentAutomationRuns(orgId: string, limit = 100): Promise<PaymentAutomationRun[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(paymentAutomationRuns)
      .where(eq(paymentAutomationRuns.organizationId, orgId))
      .orderBy(desc(paymentAutomationRuns.createdAt))
      .limit(Math.min(limit, 500));
  }
  async getNextCreditNoteNumber(orgId: string): Promise<string> {
    // org_policy_sequences lives in the main (registry) DB for cross-tenant consistency
    const result = await db.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, credit_note_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET credit_note_next = org_policy_sequences.credit_note_next + 1
      RETURNING credit_note_next
    `);
    const rows = (result as unknown as { rows?: { credit_note_next: number }[] }).rows;
    const nextVal = rows?.[0]?.credit_note_next ?? 1;
    return `CN-${String(nextVal).padStart(6, "0")}`;
  }
  async createCreditNote(note: InsertCreditNote): Promise<CreditNote> {
    const tdb = await getDbForOrg(note.organizationId);
    const [created] = await tdb.insert(creditNotes).values(note).returning();
    return created;
  }
  async getCreditNotesByClient(clientId: string, orgId: string): Promise<CreditNote[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(creditNotes)
      .where(and(eq(creditNotes.organizationId, orgId), eq(creditNotes.clientId, clientId)))
      .orderBy(desc(creditNotes.createdAt));
  }
  async getCreditNotesByPolicy(policyId: string, orgId: string): Promise<CreditNote[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(creditNotes)
      .where(and(eq(creditNotes.organizationId, orgId), eq(creditNotes.policyId, policyId)))
      .orderBy(desc(creditNotes.createdAt));
  }
  async createMonthEndRun(run: InsertMonthEndRun): Promise<MonthEndRun> {
    const tdb = await getDbForOrg(run.organizationId);
    const [created] = await tdb.insert(monthEndRuns).values(run).returning();
    return created;
  }
  async getMonthEndRunById(id: string, orgId: string): Promise<MonthEndRun | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(monthEndRuns).where(eq(monthEndRuns.id, id));
    return row;
  }
  async getNextMonthEndRunNumber(orgId: string): Promise<string> {
    // org_policy_sequences lives in the main (registry) DB for cross-tenant consistency
    const result = await db.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, month_end_run_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET month_end_run_next = org_policy_sequences.month_end_run_next + 1
      RETURNING month_end_run_next
    `);
    const rows = (result as unknown as { rows?: { month_end_run_next: number }[] }).rows;
    const nextVal = rows?.[0]?.month_end_run_next ?? 1;
    return `MER-${String(nextVal).padStart(6, "0")}`;
  }

  // ─── Platform Receivables ──────────────────────────────
  async getPlatformReceivables(orgId: string, limit = 100, offset = 0, filters?: ReportFilters): Promise<PlatformReceivable[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(platformReceivables.organizationId, orgId)];
    if (filters?.fromDate) conditions.push(gte(platformReceivables.createdAt, new Date(filters.fromDate + "T00:00:00.000Z")));
    if (filters?.toDate) conditions.push(lte(platformReceivables.createdAt, new Date(filters.toDate + "T23:59:59.999Z")));
    return tdb.select().from(platformReceivables).where(and(...conditions))
      .orderBy(desc(platformReceivables.createdAt)).limit(limit).offset(offset);
  }
  async createPlatformReceivable(entry: InsertPlatformReceivable & { createdAt?: Date }): Promise<PlatformReceivable> {
    return withOrgTransaction(entry.organizationId, async (tx) => {
      const [created] = await tx.insert(platformReceivables).values(entry).returning();

      // Immediately draw down any same-currency fee credit this org built up from a past
      // settlement overpayment (see approveSettlementWithAllocation) rather than leaving this
      // fee sitting unsettled while a credit for it is available. Conditional UPDATE avoids a
      // race against a concurrent draw-down of the same balance.
      const amount = parseFloat(String(created.amount));
      if (amount > 0.005) {
        const deduct = await tx.execute(sql`
          UPDATE platform_fee_credits
          SET balance = balance - ${amount.toFixed(2)}::numeric, updated_at = now()
          WHERE organization_id = ${entry.organizationId}
            AND currency = ${created.currency}
            AND balance >= ${amount.toFixed(2)}::numeric
          RETURNING id
        `);
        const deductedRows = (deduct as unknown as { rows?: { id: string }[] }).rows;
        if (deductedRows && deductedRows.length > 0) {
          const [settled] = await tx.update(platformReceivables).set({ isSettled: true })
            .where(eq(platformReceivables.id, created.id)).returning();
          return settled;
        }
      }
      return created;
    });
  }
  async getPlatformRevenueSummary(orgId: string): Promise<{ totalDue: Record<string, string>; totalSettled: Record<string, string>; outstanding: Record<string, string> }> {
    // Grouped by currency — platform_receivables holds USD, ZAR, and ZIG amounts,
    // and summing across currencies would silently blend them into one meaningless number.
    const tdb = await getDbForOrg(orgId);
    const dueRows = await tdb.select({
      currency: platformReceivables.currency,
      total: sql<string>`COALESCE(SUM(${platformReceivables.amount}), '0')`,
    }).from(platformReceivables)
      .where(eq(platformReceivables.organizationId, orgId))
      .groupBy(platformReceivables.currency);
    const settledRows = await tdb.select({
      currency: platformReceivables.currency,
      total: sql<string>`COALESCE(SUM(${platformReceivables.amount}), '0')`,
    }).from(platformReceivables).where(and(
      eq(platformReceivables.organizationId, orgId),
      eq(platformReceivables.isSettled, true)
    )).groupBy(platformReceivables.currency);

    const totalDue: Record<string, string> = {};
    for (const r of dueRows) totalDue[r.currency] = parseFloat(r.total).toFixed(2);
    const totalSettled: Record<string, string> = {};
    for (const r of settledRows) totalSettled[r.currency] = parseFloat(r.total).toFixed(2);
    const outstanding: Record<string, string> = {};
    for (const currency of Array.from(new Set([...Object.keys(totalDue), ...Object.keys(totalSettled)]))) {
      outstanding[currency] = (parseFloat(totalDue[currency] || "0") - parseFloat(totalSettled[currency] || "0")).toFixed(2);
    }
    return { totalDue, totalSettled, outstanding };
  }

  // ── Receipting activity by staff member and branch ────────────
  async getReceiptingByUserAndBranch(orgId: string, fromDate: string, toDate: string): Promise<{
    byUser: Array<{ userId: string | null; displayName: string; currency: string; total: string; count: number }>;
    byBranch: Array<{ branchId: string | null; branchName: string; currency: string; total: string; count: number }>;
    legacyUnattributed: Array<{ currency: string; total: string; count: number }>;
  }> {
    const tdb = await getDbForOrg(orgId);
    const fromTs = new Date(fromDate + "T00:00:00.000Z");
    const toTs = new Date(toDate + "T23:59:59.999Z");

    const rows = await tdb.execute(sql`
      SELECT issued_by_user_id AS user_id, branch_id, currency, amount
      FROM payment_receipts
      WHERE organization_id = ${orgId} AND status = 'issued'
        AND issued_at >= ${fromTs} AND issued_at <= ${toTs}
      UNION ALL
      SELECT issued_by_user_id AS user_id, branch_id, currency, amount
      FROM service_receipts
      WHERE organization_id = ${orgId} AND status = 'issued'
        AND issued_at >= ${fromTs} AND issued_at <= ${toTs}
    `);
    const allRows = (rows.rows ?? rows) as { user_id: string | null; branch_id: string | null; currency: string; amount: string }[];

    const legacyRows = await tdb.execute(sql`
      SELECT currency, amount FROM legacy_group_receipts
      WHERE organization_id = ${orgId} AND payment_date >= ${fromDate}::date AND payment_date <= ${toDate}::date
    `);
    const legacyAll = (legacyRows.rows ?? legacyRows) as { currency: string; amount: string }[];

    const userTotals = new Map<string, { userId: string | null; currency: string; total: number; count: number }>();
    const branchTotals = new Map<string, { branchId: string | null; currency: string; total: number; count: number }>();
    for (const r of allRows) {
      const uKey = `${r.user_id ?? "unattributed"}:${r.currency}`;
      const u = userTotals.get(uKey) ?? { userId: r.user_id, currency: r.currency, total: 0, count: 0 };
      u.total += parseFloat(r.amount); u.count += 1;
      userTotals.set(uKey, u);

      const bKey = `${r.branch_id ?? "unattributed"}:${r.currency}`;
      const b = branchTotals.get(bKey) ?? { branchId: r.branch_id, currency: r.currency, total: 0, count: 0 };
      b.total += parseFloat(r.amount); b.count += 1;
      branchTotals.set(bKey, b);
    }

    const userIds = Array.from(new Set(allRows.map(r => r.user_id).filter((id): id is string => !!id)));
    const userRows = userIds.length ? await tdb.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, userIds)) : [];
    const userNameMap = new Map(userRows.map(u => [u.id, u.displayName]));

    const branchIds = Array.from(new Set(allRows.map(r => r.branch_id).filter((id): id is string => !!id)));
    const branchRows = branchIds.length ? await tdb.select({ id: branches.id, name: branches.name }).from(branches).where(inArray(branches.id, branchIds)) : [];
    const branchNameMap = new Map(branchRows.map(b => [b.id, b.name]));

    const legacyTotals = new Map<string, { currency: string; total: number; count: number }>();
    for (const r of legacyAll) {
      const l = legacyTotals.get(r.currency) ?? { currency: r.currency, total: 0, count: 0 };
      l.total += parseFloat(r.amount); l.count += 1;
      legacyTotals.set(r.currency, l);
    }

    return {
      byUser: Array.from(userTotals.values()).map(u => ({
        userId: u.userId,
        displayName: u.userId ? (userNameMap.get(u.userId) ?? "Unknown user") : "Not recorded",
        currency: u.currency, total: u.total.toFixed(2), count: u.count,
      })).sort((a, b) => b.total.localeCompare(a.total, undefined, { numeric: true })),
      byBranch: Array.from(branchTotals.values()).map(b => ({
        branchId: b.branchId,
        branchName: b.branchId ? (branchNameMap.get(b.branchId) ?? "Unknown branch") : "Not recorded",
        currency: b.currency, total: b.total.toFixed(2), count: b.count,
      })).sort((a, b) => b.total.localeCompare(a.total, undefined, { numeric: true })),
      legacyUnattributed: Array.from(legacyTotals.values()).map(l => ({ currency: l.currency, total: l.total.toFixed(2), count: l.count })),
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

  async approveSettlementWithAllocation(id: string, orgId: string, approvedBy: string): Promise<{ settlement: Settlement; allocated: string; receivablesSettled: number }> {
    return withOrgTransaction(orgId, async (tx) => {
      const [settlement] = await tx.select().from(settlements)
        .where(and(eq(settlements.id, id), eq(settlements.organizationId, orgId)));
      if (!settlement) throw new Error("Settlement not found");
      if (settlement.status === "approved") {
        // Already approved (e.g. a retried request) — don't allocate a second time.
        return { settlement, allocated: "0.00", receivablesSettled: 0 };
      }

      // Unsettled receivables, across ALL currencies — a settlement's currency no longer has to
      // match a receivable's to cover it. Cross-currency conversion goes through the org's
      // fx_rates (USD-per-unit-of-currency, same convention as resolveCrossCurrencyPayout for
      // requisition/expenditure payments). Left join settlement_allocations to account for a
      // receivable that was already partially covered by an earlier settlement.
      const rows = await tx
        .select({
          id: platformReceivables.id,
          amount: platformReceivables.amount,
          currency: platformReceivables.currency,
          alreadyAllocated: sql<string>`COALESCE((SELECT SUM(sa.amount) FROM settlement_allocations sa WHERE sa.receivable_id = ${platformReceivables.id}), 0)`,
        })
        .from(platformReceivables)
        .where(and(
          eq(platformReceivables.organizationId, orgId),
          eq(platformReceivables.isSettled, false),
        ))
        .orderBy(platformReceivables.createdAt);

      const fxRateRows = await tx.select().from(fxRates).where(eq(fxRates.organizationId, orgId));
      const fx: Record<string, number> = { USD: 1 };
      for (const r of fxRateRows) fx[r.currency.toUpperCase()] = parseFloat(String(r.rateToUsd));

      let remaining = parseFloat(String(settlement.amount));
      let receivablesSettled = 0;
      let totalAllocated = 0;
      const settlementCurrency = settlement.currency.toUpperCase();

      // Allocation priority: same currency as the settlement first (a direct match, no
      // conversion needed), then USD (the platform's reference currency — any leftover after
      // covering the settlement's own currency is steered there before other currencies),
      // then everything else. Array.sort is stable, so createdAt order (oldest first) is
      // preserved within each tier since `rows` was already fetched in that order.
      const currencyTier = (c: string) => {
        const upper = c.toUpperCase();
        if (upper === settlementCurrency) return 0;
        if (upper === "USD") return 1;
        return 2;
      };
      rows.sort((a, b) => currencyTier(a.currency) - currencyTier(b.currency));

      for (const r of rows) {
        if (remaining <= 0.005) break;
        const owed = parseFloat(r.amount) - parseFloat(r.alreadyAllocated || "0");
        if (owed <= 0.005) continue;
        const receivableCurrency = r.currency.toUpperCase();

        // rate = units of settlement currency per 1 unit of the receivable's currency.
        let rate = 1;
        if (receivableCurrency !== settlementCurrency) {
          if (!(fx[receivableCurrency] > 0) || !(fx[settlementCurrency] > 0)) {
            // No platform rate configured for one side — can't safely convert; leave this
            // receivable unsettled rather than guess, same as requisition/expenditure payments.
            continue;
          }
          rate = fx[receivableCurrency] / fx[settlementCurrency];
        }

        const owedInSettlementCurrency = owed * rate;
        const appliedInSettlementCurrency = Math.min(remaining, owedInSettlementCurrency);
        const appliedInReceivableCurrency = appliedInSettlementCurrency / rate;
        await tx.insert(settlementAllocations).values({
          settlementId: settlement.id,
          receivableId: r.id,
          amount: appliedInReceivableCurrency.toFixed(2),
          fxRateApplied: receivableCurrency !== settlementCurrency ? rate.toFixed(8) : null,
        });
        totalAllocated += appliedInSettlementCurrency;
        remaining -= appliedInSettlementCurrency;
        if (appliedInReceivableCurrency >= owed - 0.005) {
          await tx.update(platformReceivables).set({ isSettled: true }).where(eq(platformReceivables.id, r.id));
          receivablesSettled++;
        }
      }

      // Settlement outlasted every currently-owed receivable — bank the true overpayment as a
      // per-currency credit rather than letting it vanish; createPlatformReceivable() draws it
      // down automatically the next time a same-currency fee is raised for this org.
      if (remaining > 0.005) {
        await tx.insert(platformFeeCredits)
          .values({ organizationId: orgId, currency: settlementCurrency, balance: remaining.toFixed(2) })
          .onConflictDoUpdate({
            target: [platformFeeCredits.organizationId, platformFeeCredits.currency],
            set: { balance: sql`${platformFeeCredits.balance} + ${remaining.toFixed(2)}::numeric`, updatedAt: new Date() },
          });
      }

      const [updated] = await tx.update(settlements).set({ status: "approved", approvedBy })
        .where(eq(settlements.id, id)).returning();
      return { settlement: updated, allocated: totalAllocated.toFixed(2), receivablesSettled };
    });
  }

  // ─── Cost Sheets ────────────────────────────────────────
  async getCostSheetsByOrg(orgId: string, filters?: { funeralCaseId?: string }): Promise<any[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(costSheets.organizationId, orgId)];
    if (filters?.funeralCaseId) conditions.push(eq(costSheets.funeralCaseId, filters.funeralCaseId));
    return tdb.select().from(costSheets)
      .where(and(...conditions))
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
  /** Any existing cost-line-item already linked to this requisition, org-wide — used to stop
   *  the same real cost being pulled into two different cost-sheet lines (double counting). */
  async getCostLineItemByRequisitionId(requisitionId: string, orgId: string): Promise<any | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(costLineItems).where(eq(costLineItems.requisitionId, requisitionId)).limit(1);
    return row;
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

  // ─── Directory Contacts ────────────────────────────────────────
  async getDirectoryContacts(orgId: string, type?: string, search?: string): Promise<DirectoryContact[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions: any[] = [eq(directoryContacts.organizationId, orgId)];
    if (type) conditions.push(eq(directoryContacts.type, type));
    if (search) {
      const q = `%${search}%`;
      conditions.push(
        or(
          ilike(directoryContacts.name, q),
          ilike(directoryContacts.contactPerson, q),
          ilike(directoryContacts.phone, q),
          ilike(directoryContacts.city, q),
        )
      );
    }
    return tdb.select().from(directoryContacts)
      .where(and(...conditions))
      .orderBy(directoryContacts.name);
  }
  async createDirectoryContact(data: InsertDirectoryContact): Promise<DirectoryContact> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(directoryContacts).values(data).returning();
    return created;
  }
  async updateDirectoryContact(id: string, orgId: string, data: Partial<InsertDirectoryContact>): Promise<DirectoryContact | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(directoryContacts)
      .set(data)
      .where(and(eq(directoryContacts.id, id), eq(directoryContacts.organizationId, orgId)))
      .returning();
    return updated;
  }
  async deleteDirectoryContact(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(directoryContacts)
      .where(and(eq(directoryContacts.id, id), eq(directoryContacts.organizationId, orgId)));
  }

  // ─── Receipt Adverts ────────────────────────────────────────
  async getReceiptAdverts(orgId: string): Promise<ReceiptAdvert[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(receiptAdverts)
      .where(eq(receiptAdverts.organizationId, orgId))
      .orderBy(desc(receiptAdverts.createdAt));
  }
  async getActiveReceiptAdvert(orgId: string): Promise<ReceiptAdvert | null> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(receiptAdverts)
      .where(and(eq(receiptAdverts.organizationId, orgId), eq(receiptAdverts.isActive, true)))
      .limit(1);
    return row ?? null;
  }
  async createReceiptAdvert(data: InsertReceiptAdvert): Promise<ReceiptAdvert> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(receiptAdverts).values(data).returning();
    return row;
  }
  async updateReceiptAdvert(id: string, data: Partial<InsertReceiptAdvert>, orgId: string): Promise<ReceiptAdvert | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(receiptAdverts)
      .set(data)
      .where(and(eq(receiptAdverts.id, id), eq(receiptAdverts.organizationId, orgId)))
      .returning();
    return row;
  }
  async deleteReceiptAdvert(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(receiptAdverts)
      .where(and(eq(receiptAdverts.id, id), eq(receiptAdverts.organizationId, orgId)));
  }
  async setActiveReceiptAdvert(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    // Deactivate all, then activate the chosen one
    await tdb.update(receiptAdverts).set({ isActive: false }).where(eq(receiptAdverts.organizationId, orgId));
    await tdb.update(receiptAdverts).set({ isActive: true })
      .where(and(eq(receiptAdverts.id, id), eq(receiptAdverts.organizationId, orgId)));
  }

  // ─── Agent Content Posts (vCard training/education feed) ─────
  async getAgentContentPosts(orgId: string, activeOnly = false): Promise<AgentContentPost[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = activeOnly
      ? and(eq(agentContentPosts.organizationId, orgId), eq(agentContentPosts.isActive, true))
      : eq(agentContentPosts.organizationId, orgId);
    return tdb.select().from(agentContentPosts).where(conditions)
      .orderBy(asc(agentContentPosts.sortOrder), desc(agentContentPosts.createdAt));
  }
  async createAgentContentPost(data: InsertAgentContentPost): Promise<AgentContentPost> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(agentContentPosts).values(data).returning();
    return row;
  }
  async updateAgentContentPost(id: string, data: Partial<InsertAgentContentPost>, orgId: string): Promise<AgentContentPost | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(agentContentPosts).set(data)
      .where(and(eq(agentContentPosts.id, id), eq(agentContentPosts.organizationId, orgId)))
      .returning();
    return row;
  }
  async deleteAgentContentPost(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(agentContentPosts).where(and(eq(agentContentPosts.id, id), eq(agentContentPosts.organizationId, orgId)));
  }

  // ─── Member Card Admin ────────────────────────────────────
  async getMemberCardSettings(orgId: string): Promise<MemberCardSettings> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(memberCardSettings).where(eq(memberCardSettings.organizationId, orgId));
    if (row) return row;
    // Not configured yet — built-in defaults, matching the column defaults in schema.ts,
    // so the admin page and card renderer both work before anyone has saved a template.
    return {
      organizationId: orgId,
      cardTitle: "Membership Card",
      showLogo: true,
      showPolicyNumber: true,
      showSurname: true,
      showIdNumber: true,
      showDateOfBirth: true,
      showPlan: true,
      showQrCode: true,
      tagline: null,
      footerNote: null,
      footerSlogan: null,
      updatedAt: new Date(),
    };
  }
  async upsertMemberCardSettings(orgId: string, data: Partial<InsertMemberCardSettings>): Promise<MemberCardSettings> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.insert(memberCardSettings)
      .values({ ...data, organizationId: orgId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: memberCardSettings.organizationId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  // ─── Mortuary Intakes ───────────────────────────────────────
  async generateIntakeNumber(orgId: string): Promise<string> {
    const tdb = await getDbForOrg(orgId);
    const result = await tdb.execute(sql`
      INSERT INTO org_policy_sequences (organization_id, mortuary_next) VALUES (${orgId}, 1)
      ON CONFLICT (organization_id) DO UPDATE SET mortuary_next = org_policy_sequences.mortuary_next + 1
      RETURNING mortuary_next
    `);
    const nextVal = (result as unknown as { rows?: { mortuary_next: number }[] }).rows?.[0]?.mortuary_next ?? 1;
    return `MTR-${String(nextVal).padStart(6, "0")}`;
  }
  async getMortuaryIntakesByOrg(
    orgId: string,
    opts?: { funeralCaseId?: string; status?: string; limit?: number; offset?: number }
  ): Promise<MortuaryIntake[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(mortuaryIntakes.organizationId, orgId)];
    if (opts?.funeralCaseId) conditions.push(eq(mortuaryIntakes.funeralCaseId, opts.funeralCaseId));
    if (opts?.status) conditions.push(eq(mortuaryIntakes.status, opts.status));
    return tdb.select().from(mortuaryIntakes)
      .where(and(...conditions))
      .orderBy(desc(mortuaryIntakes.createdAt))
      .limit(opts?.limit ?? 200)
      .offset(opts?.offset ?? 0);
  }
  async getMortuaryIntake(id: string, orgId: string): Promise<MortuaryIntake | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(mortuaryIntakes)
      .where(and(eq(mortuaryIntakes.id, id), eq(mortuaryIntakes.organizationId, orgId)));
    return row;
  }
  async createMortuaryIntake(data: InsertMortuaryIntake): Promise<MortuaryIntake> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(mortuaryIntakes).values(data).returning();
    return created;
  }
  async updateMortuaryIntake(id: string, data: Partial<InsertMortuaryIntake>, orgId: string): Promise<MortuaryIntake | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(mortuaryIntakes)
      .set(data)
      .where(and(eq(mortuaryIntakes.id, id), eq(mortuaryIntakes.organizationId, orgId)))
      .returning();
    return updated;
  }

  // ─── Daily Report Notes ─────────────────────────────────────
  async getDailyReportNotes(orgId: string, date: string): Promise<(DailyReportNote & { authorName: string | null })[]> {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb
      .select({
        id: dailyReportNotes.id,
        organizationId: dailyReportNotes.organizationId,
        reportDate: dailyReportNotes.reportDate,
        note: dailyReportNotes.note,
        createdByUserId: dailyReportNotes.createdByUserId,
        createdAt: dailyReportNotes.createdAt,
        authorName: users.displayName,
      })
      .from(dailyReportNotes)
      .leftJoin(users, eq(dailyReportNotes.createdByUserId, users.id))
      .where(and(eq(dailyReportNotes.organizationId, orgId), eq(dailyReportNotes.reportDate, date)))
      .orderBy(dailyReportNotes.createdAt);
    return rows;
  }
  async createDailyReportNote(data: InsertDailyReportNote): Promise<DailyReportNote> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(dailyReportNotes).values(data).returning();
    return created;
  }

  // ─── Mortuary Dispatches ────────────────────────────────────
  async getMortuaryDispatch(intakeId: string, orgId: string): Promise<MortuaryDispatch | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(mortuaryDispatches)
      .where(and(eq(mortuaryDispatches.intakeId, intakeId), eq(mortuaryDispatches.organizationId, orgId)));
    return row;
  }
  async upsertMortuaryDispatch(intakeId: string, orgId: string, data: Omit<InsertMortuaryDispatch, "intakeId" | "organizationId">): Promise<MortuaryDispatch> {
    return withOrgTransaction(orgId, async (tx) => {
      const [existing] = await tx.select({ id: mortuaryDispatches.id }).from(mortuaryDispatches)
        .where(and(eq(mortuaryDispatches.intakeId, intakeId), eq(mortuaryDispatches.organizationId, orgId)));
      if (existing) {
        const [updated] = await tx.update(mortuaryDispatches)
          .set(data)
          .where(eq(mortuaryDispatches.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await tx.insert(mortuaryDispatches)
        .values({ ...data, intakeId, organizationId: orgId })
        .returning();
      return created;
    });
  }
  async dispatchIntake(intakeId: string, orgId: string, data: Omit<InsertMortuaryDispatch, "intakeId" | "organizationId">): Promise<MortuaryDispatch> {
    return withOrgTransaction(orgId, async (tx) => {
      const [existingDispatch] = await tx.select({ id: mortuaryDispatches.id }).from(mortuaryDispatches)
        .where(and(eq(mortuaryDispatches.intakeId, intakeId), eq(mortuaryDispatches.organizationId, orgId)));
      let dispatch: MortuaryDispatch;
      if (existingDispatch) {
        const [updated] = await tx.update(mortuaryDispatches)
          .set(data)
          .where(eq(mortuaryDispatches.id, existingDispatch.id))
          .returning();
        dispatch = updated;
      } else {
        const [created] = await tx.insert(mortuaryDispatches)
          .values({ ...data, intakeId, organizationId: orgId })
          .returning();
        dispatch = created;
      }
      await tx.update(mortuaryIntakes)
        .set({ status: "dispatched" })
        .where(and(eq(mortuaryIntakes.id, intakeId), eq(mortuaryIntakes.organizationId, orgId)));
      return dispatch;
    });
  }

  // ─── Partner Parlours ───────────────────────────────────────
  async getPartnerParlours(orgId: string): Promise<PartnerParlour[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(partnerParlours)
      .where(and(eq(partnerParlours.organizationId, orgId), eq(partnerParlours.isActive, true)))
      .orderBy(partnerParlours.name);
  }

  async createPartnerParlour(data: InsertPartnerParlour): Promise<PartnerParlour> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(partnerParlours).values(data).returning();
    return row;
  }

  async updatePartnerParlour(id: string, data: Partial<InsertPartnerParlour>, orgId: string): Promise<PartnerParlour> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(partnerParlours)
      .set(data)
      .where(and(eq(partnerParlours.id, id), eq(partnerParlours.organizationId, orgId)))
      .returning();
    return row;
  }

  async getParlourPersonnel(orgId: string, parlourId?: string): Promise<ParlourPersonnel[]> {
    const tdb = await getDbForOrg(orgId);
    const conds: any[] = [eq(parlourPersonnel.organizationId, orgId)];
    if (parlourId) conds.push(eq(parlourPersonnel.parlourId, parlourId));
    return tdb.select().from(parlourPersonnel).where(and(...conds)).orderBy(parlourPersonnel.name);
  }
  async createParlourPersonnel(data: InsertParlourPersonnel): Promise<ParlourPersonnel> {
    const tdb = await getDbForOrg(data.organizationId);
    const [row] = await tdb.insert(parlourPersonnel).values(data).returning();
    return row;
  }
  async updateParlourPersonnel(id: string, orgId: string, data: Partial<ParlourPersonnel>): Promise<ParlourPersonnel | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(parlourPersonnel).set(data)
      .where(and(eq(parlourPersonnel.id, id), eq(parlourPersonnel.organizationId, orgId)))
      .returning();
    return row;
  }
  async deleteParlourPersonnel(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(parlourPersonnel).where(and(eq(parlourPersonnel.id, id), eq(parlourPersonnel.organizationId, orgId)));
  }

  async recordStoragePayment(intakeId: string, orgId: string, data: { storageFeePaidBy: string; storageFeePaidAt: Date; storageFeeStatus: string }): Promise<MortuaryIntake> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(mortuaryIntakes)
      .set(data)
      .where(and(eq(mortuaryIntakes.id, intakeId), eq(mortuaryIntakes.organizationId, orgId)))
      .returning();
    return row;
  }

  async recordChapelWashBayPayment(intakeId: string, orgId: string, data: { chapelWashBayFeePaidBy: string; chapelWashBayFeePaidAt: Date; chapelWashBayFeeStatus: string }): Promise<MortuaryDispatch> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(mortuaryDispatches)
      .set(data)
      .where(and(eq(mortuaryDispatches.intakeId, intakeId), eq(mortuaryDispatches.organizationId, orgId)))
      .returning();
    return row;
  }

  // ─── Post-Mortem Movements ───────────────────────────────────
  async getPostMortemMovements(intakeId: string, orgId: string): Promise<MortuaryPostMortemMovement[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(mortuaryPostMortemMovements)
      .where(and(eq(mortuaryPostMortemMovements.intakeId, intakeId), eq(mortuaryPostMortemMovements.organizationId, orgId)))
      .orderBy(desc(mortuaryPostMortemMovements.takenOutAt));
  }
  async createPostMortemMovement(data: InsertMortuaryPostMortemMovement): Promise<MortuaryPostMortemMovement> {
    return withOrgTransaction(data.organizationId, async (tx) => {
      const [created] = await tx.insert(mortuaryPostMortemMovements).values(data).returning();
      await tx.update(mortuaryIntakes)
        .set({ status: "out_for_post_mortem" })
        .where(and(eq(mortuaryIntakes.id, data.intakeId), eq(mortuaryIntakes.organizationId, data.organizationId)));
      return created;
    });
  }
  async recordPostMortemReturn(id: string, orgId: string, data: { returnedAt: Date; receivedBackByUserId?: string | null }): Promise<MortuaryPostMortemMovement> {
    return withOrgTransaction(orgId, async (tx) => {
      const [updated] = await tx.update(mortuaryPostMortemMovements)
        .set(data)
        .where(and(eq(mortuaryPostMortemMovements.id, id), eq(mortuaryPostMortemMovements.organizationId, orgId)))
        .returning();
      if (updated) {
        await tx.update(mortuaryIntakes)
          .set({ status: "in_storage" })
          .where(and(eq(mortuaryIntakes.id, updated.intakeId), eq(mortuaryIntakes.organizationId, orgId)));
      }
      return updated;
    });
  }

  // ─── Partner Parlour Vehicle Usage ───────────────────────────
  async getPartnerParlourVehicleUsage(orgId: string, filters?: { parlourId?: string }): Promise<PartnerParlourVehicleUsage[]> {
    const tdb = await getDbForOrg(orgId);
    const conds = [eq(partnerParlourVehicleUsage.organizationId, orgId)];
    if (filters?.parlourId) conds.push(eq(partnerParlourVehicleUsage.partnerParlourId, filters.parlourId));
    return tdb.select().from(partnerParlourVehicleUsage).where(and(...conds))
      .orderBy(desc(partnerParlourVehicleUsage.usageDateTime));
  }
  async createPartnerParlourVehicleUsage(data: InsertPartnerParlourVehicleUsage): Promise<PartnerParlourVehicleUsage> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(partnerParlourVehicleUsage).values(data).returning();
    return created;
  }
  async updatePartnerParlourVehicleUsage(id: string, orgId: string, data: Partial<InsertPartnerParlourVehicleUsage>): Promise<PartnerParlourVehicleUsage | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(partnerParlourVehicleUsage)
      .set(data)
      .where(and(eq(partnerParlourVehicleUsage.id, id), eq(partnerParlourVehicleUsage.organizationId, orgId)))
      .returning();
    return updated;
  }
  async recordVehicleUsageFeePayment(id: string, orgId: string, data: { feePaidBy: string; feePaidAt: Date; feeStatus: string }): Promise<PartnerParlourVehicleUsage> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.update(partnerParlourVehicleUsage)
      .set(data)
      .where(and(eq(partnerParlourVehicleUsage.id, id), eq(partnerParlourVehicleUsage.organizationId, orgId)))
      .returning();
    return row;
  }

  // ─── Deceased Belongings ────────────────────────────────────
  async getDeceasedBelongings(intakeId: string, orgId: string): Promise<DeceasedBelonging[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(deceasedBelongings)
      .where(and(eq(deceasedBelongings.intakeId, intakeId), eq(deceasedBelongings.organizationId, orgId)))
      .orderBy(deceasedBelongings.createdAt);
  }
  async addDeceasedBelonging(data: InsertDeceasedBelonging): Promise<DeceasedBelonging> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(deceasedBelongings).values(data).returning();
    return created;
  }
  async deleteDeceasedBelonging(id: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(deceasedBelongings)
      .where(and(eq(deceasedBelongings.id, id), eq(deceasedBelongings.organizationId, orgId)));
  }

  // ─── Body Wash Requirements ─────────────────────────────────
  async getBodyWashRequirements(intakeId: string, orgId: string): Promise<BodyWashRequirement | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(bodyWashRequirements)
      .where(and(eq(bodyWashRequirements.intakeId, intakeId), eq(bodyWashRequirements.organizationId, orgId)));
    return row;
  }
  async upsertBodyWashRequirements(intakeId: string, orgId: string, data: Omit<InsertBodyWashRequirement, "intakeId" | "organizationId">): Promise<BodyWashRequirement> {
    const tdb = await getDbForOrg(orgId);
    const existing = await this.getBodyWashRequirements(intakeId, orgId);
    if (existing) {
      const [updated] = await tdb.update(bodyWashRequirements)
        .set(data)
        .where(eq(bodyWashRequirements.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await tdb.insert(bodyWashRequirements)
      .values({ ...data, intakeId, organizationId: orgId })
      .returning();
    return created;
  }

  // ─── Driver Checklists ──────────────────────────────────────
  async getDriverChecklist(funeralCaseId: string, orgId: string): Promise<DriverChecklist | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(driverChecklists)
      .where(and(eq(driverChecklists.funeralCaseId, funeralCaseId), eq(driverChecklists.organizationId, orgId)));
    return row;
  }
  async upsertDriverChecklist(funeralCaseId: string, orgId: string, data: Omit<InsertDriverChecklist, "funeralCaseId" | "organizationId">): Promise<DriverChecklist> {
    const tdb = await getDbForOrg(orgId);
    const existing = await this.getDriverChecklist(funeralCaseId, orgId);
    if (existing) {
      const [updated] = await tdb.update(driverChecklists)
        .set(data)
        .where(eq(driverChecklists.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await tdb.insert(driverChecklists)
      .values({ ...data, funeralCaseId, organizationId: orgId })
      .returning();
    return created;
  }

  // ─── Reminders ──────────────────────────────────────────────
  async getReminders(userId: string, orgId: string): Promise<Reminder[]> {
    const tdb = await getDbForOrg(orgId);
    return tdb.select().from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.organizationId, orgId)))
      .orderBy(desc(reminders.createdAt));
  }

  async createReminder(data: InsertReminder): Promise<Reminder> {
    const tdb = await getDbForOrg(data.organizationId);
    const [r] = await tdb.insert(reminders).values(data).returning();
    return r;
  }

  async updateReminder(id: string, data: Partial<InsertReminder>, userId: string, orgId: string): Promise<Reminder | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [r] = await tdb.update(reminders)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId), eq(reminders.organizationId, orgId)))
      .returning();
    return r;
  }

  async deleteReminder(id: string, userId: string, orgId: string): Promise<void> {
    const tdb = await getDbForOrg(orgId);
    await tdb.delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId), eq(reminders.organizationId, orgId)));
  }

  // ─── Vehicle Trip Logs ──────────────────────────────────────
  async getVehicleTripLogs(orgId: string, filters?: { vehicleId?: string; funeralCaseId?: string }): Promise<VehicleTripLog[]> {
    const tdb = await getDbForOrg(orgId);
    const conditions = [eq(vehicleTripLogs.organizationId, orgId)];
    if (filters?.vehicleId) conditions.push(eq(vehicleTripLogs.vehicleId, filters.vehicleId));
    if (filters?.funeralCaseId) conditions.push(eq(vehicleTripLogs.funeralCaseId, filters.funeralCaseId));
    return tdb.select().from(vehicleTripLogs)
      .where(and(...conditions))
      .orderBy(desc(vehicleTripLogs.tripDate));
  }
  async getVehicleTripLog(id: string, orgId: string): Promise<VehicleTripLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [row] = await tdb.select().from(vehicleTripLogs)
      .where(and(eq(vehicleTripLogs.id, id), eq(vehicleTripLogs.organizationId, orgId)));
    return row;
  }
  async createVehicleTripLog(data: InsertVehicleTripLog): Promise<VehicleTripLog> {
    const tdb = await getDbForOrg(data.organizationId);
    const [created] = await tdb.insert(vehicleTripLogs).values(data).returning();
    return created;
  }
  async updateVehicleTripLog(id: string, orgId: string, data: Partial<InsertVehicleTripLog>): Promise<VehicleTripLog | undefined> {
    const tdb = await getDbForOrg(orgId);
    const [updated] = await tdb.update(vehicleTripLogs).set(data)
      .where(and(eq(vehicleTripLogs.id, id), eq(vehicleTripLogs.organizationId, orgId)))
      .returning();
    return updated;
  }
}

/** Find a policy by id when orgId is unknown (e.g. public policy document URL). Uses organizationId on the policy row to avoid an org-scan. */
export async function findPolicyById(policyId: string): Promise<Policy | undefined> {
  const [row] = await db.select({ organizationId: policies.organizationId }).from(policies).where(eq(policies.id, policyId)).limit(1);
  if (!row?.organizationId) return undefined;
  const tdb = await getDbForOrg(row.organizationId);
  return tdb.select().from(policies).where(eq(policies.id, policyId)).limit(1).then((r) => r[0]);
}

/** Find a payment receipt by id when orgId is unknown. Uses organizationId on the receipt row to avoid an org-scan. */
export async function findPaymentReceiptById(receiptId: string): Promise<PaymentReceipt | undefined> {
  const [row] = await db.select({ organizationId: paymentReceipts.organizationId }).from(paymentReceipts).where(eq(paymentReceipts.id, receiptId)).limit(1);
  if (!row?.organizationId) return undefined;
  const tdb = await getDbForOrg(row.organizationId);
  const [receipt] = await tdb.select().from(paymentReceipts).where(eq(paymentReceipts.id, receiptId)).limit(1);
  return receipt;
}

/** Find a payment intent by id when orgId is unknown. Uses organizationId on the intent row to avoid an org-scan. */
export async function findPaymentIntentById(intentId: string): Promise<PaymentIntent | undefined> {
  const [row] = await db.select({ organizationId: paymentIntents.organizationId }).from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
  if (!row?.organizationId) return undefined;
  const tdb = await getDbForOrg(row.organizationId);
  const [intent] = await tdb.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
  return intent;
}

export const storage = new DatabaseStorage();
