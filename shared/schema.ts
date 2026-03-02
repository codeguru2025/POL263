import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  uuid,
  timestamp,
  boolean,
  jsonb,
  index,
  integer,
  numeric,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── MULTI-TENANCY ──────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  logoUrl: text("logo_url").default("/assets/logo.png"),
  signatureUrl: text("signature_url"),
  primaryColor: text("primary_color").default("#D4AF37"),
  footerText: text("footer_text"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  policyNumberPrefix: text("policy_number_prefix"),
  policyNumberPadding: integer("policy_number_padding").default(5).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** Optional: when set, this tenant's data can use a dedicated database (see server/tenant-db). */
  databaseUrl: text("database_url"),
  /** When true, the app is fully white-labeled: tenant branding replaces POL263 everywhere (splash, login, sidebar, etc.). When false, the app loads as POL263 but tenant details appear on documents and receipts. */
  isWhitelabeled: boolean("is_whitelabeled").default(false).notNull(),
});

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("branches_org_idx").on(t.organizationId)]
);

/** Per-org sequence for unique member numbers (MEM-000001, etc.). */
export const orgMemberSequences = pgTable("org_member_sequences", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  memberNext: integer("member_next").default(1).notNull(),
});

/** Per-org sequence for policy numbers, receipt numbers, claim numbers, etc. (atomic under concurrency). */
export const orgPolicySequences = pgTable("org_policy_sequences", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  policyNext: integer("policy_next").default(1).notNull(),
  receiptNext: integer("receipt_next").default(0).notNull(),
  paymentReceiptNext: integer("payment_receipt_next").default(0).notNull(),
  claimNext: integer("claim_next").default(0).notNull(),
  caseNext: integer("case_next").default(0).notNull(),
});

// ─── IDENTITY ───────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    googleId: text("google_id").unique(),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    referralCode: text("referral_code").unique(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("users_org_idx").on(t.organizationId)]
);

// ─── RBAC ───────────────────────────────────────────────────

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("roles_org_idx").on(t.organizationId)]
);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  category: text("category"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("rp_role_idx").on(t.roleId),
    uniqueIndex("rp_role_perm_unique_idx").on(t.roleId, t.permissionId),
  ]
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ur_user_idx").on(t.userId)]
);

export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    isGranted: boolean("is_granted").notNull(),
  },
  (t) => [index("upo_user_idx").on(t.userId)]
);

// ─── CLIENTS (POLICYHOLDERS) ────────────────────────────────

export const securityQuestions = pgTable("security_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  question: text("question").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    title: text("title"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    nationalId: text("national_id"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    preferredCommMethod: text("preferred_comm_method"),
    location: text("location"),
    sellingPoint: text("selling_point"),
    objectionsFaced: text("objections_faced"),
    responseToObjections: text("response_to_objections"),
    clientFeedback: text("client_feedback"),
    passwordHash: text("password_hash"),
    securityQuestionId: uuid("security_question_id").references(() => securityQuestions.id),
    securityAnswerHash: text("security_answer_hash"),
    activationCode: text("activation_code"),
    isEnrolled: boolean("is_enrolled").default(false).notNull(),
    failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
    lockedUntil: timestamp("locked_until"),
    agentId: uuid("agent_id").references(() => users.id),
    isActive: boolean("is_active").default(true).notNull(),
    /** Notification sound preference: default | silent | high */
    notificationTone: text("notification_tone").default("default"),
    /** Whether to send push notifications to registered devices */
    pushEnabled: boolean("push_enabled").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("clients_org_idx").on(t.organizationId),
    index("clients_branch_idx").on(t.branchId),
    index("clients_agent_idx").on(t.agentId),
  ]
);

// ─── CLIENT DEVICE TOKENS (for push notifications) ───
export const clientDeviceTokens = pgTable(
  "client_device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    token: text("token").notNull(),
    platform: text("platform").notNull(), // ios | android | web
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("cdt_org_idx").on(t.organizationId),
    index("cdt_client_idx").on(t.clientId),
    uniqueIndex("cdt_token_org_idx").on(t.organizationId, t.token),
  ]
);

// ─── DEPENDENTS ─────────────────────────────────────────────

export const dependents = pgTable(
  "dependents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    memberNumber: text("member_number"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    nationalId: text("national_id"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    relationship: text("relationship").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("deps_client_idx").on(t.clientId),
    index("deps_org_idx").on(t.organizationId),
    uniqueIndex("deps_member_number_org_idx").on(t.organizationId, t.memberNumber),
  ]
);

export const dependentChangeRequests = pgTable(
  "dependent_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    policyId: uuid("policy_id"),
    requestType: text("request_type").notNull(),
    data: jsonb("data").notNull(),
    status: text("status").default("pending").notNull(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at"),
  },
  (t) => [index("dcr_client_idx").on(t.clientId)]
);

// ─── PRODUCTS & CONFIG ──────────────────────────────────────

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    maxAdults: integer("max_adults").default(2),
    maxChildren: integer("max_children").default(4),
    maxExtendedMembers: integer("max_extended_members").default(0),
    casketType: text("casket_type"),
    casketImageUrl: text("casket_image_url"),
    coverAmount: numeric("cover_amount"),
    coverCurrency: text("cover_currency").default("USD"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("products_org_idx").on(t.organizationId),
    uniqueIndex("products_code_org_idx").on(t.code, t.organizationId),
  ]
);

export const productVersions = pgTable(
  "product_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    version: integer("version").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    premiumMonthlyUsd: numeric("premium_monthly_usd"),
    premiumMonthlyZar: numeric("premium_monthly_zar"),
    premiumWeeklyUsd: numeric("premium_weekly_usd"),
    premiumBiweeklyUsd: numeric("premium_biweekly_usd"),
    eligibilityMinAge: integer("eligibility_min_age").default(18),
    eligibilityMaxAge: integer("eligibility_max_age").default(70),
    dependentMaxAge: integer("dependent_max_age").default(20),
    waitingPeriodDays: integer("waiting_period_days").default(90),
    waitingPeriodAccidentalDeath: integer("waiting_period_accidental_death").default(0),
    waitingPeriodSuicide: integer("waiting_period_suicide").default(0),
    gracePeriodDays: integer("grace_period_days").default(30),
    cashInLieuAdult: numeric("cash_in_lieu_adult"),
    cashInLieuChild: numeric("cash_in_lieu_child"),
    reinstatementRequiresArrears: boolean("reinstatement_requires_arrears").default(true),
    reinstatementNewWaitingPeriod: boolean("reinstatement_new_waiting_period").default(true),
    coverageRules: jsonb("coverage_rules"),
    exclusions: jsonb("exclusions"),
    commissionFirstMonthsCount: integer("commission_first_months_count"),
    commissionFirstMonthsRate: numeric("commission_first_months_rate"),
    commissionRecurringStartMonth: integer("commission_recurring_start_month"),
    commissionRecurringRate: numeric("commission_recurring_rate"),
    commissionClawbackThreshold: integer("commission_clawback_threshold"),
    commissionFuneralIncentive: numeric("commission_funeral_incentive"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pv_product_idx").on(t.productId),
    index("pv_org_idx").on(t.organizationId),
  ]
);

// ─── BENEFITS & ADD-ONS ─────────────────────────────────────

export const benefitCatalogItems = pgTable(
  "benefit_catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    internalCostDefault: numeric("internal_cost_default"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("bci_org_idx").on(t.organizationId)]
);

export const benefitBundles = pgTable(
  "benefit_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    items: jsonb("items"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("bb_org_idx").on(t.organizationId)]
);

export const productBenefitBundleLinks = pgTable(
  "product_benefit_bundle_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productVersionId: uuid("product_version_id")
      .notNull()
      .references(() => productVersions.id),
    benefitBundleId: uuid("benefit_bundle_id")
      .notNull()
      .references(() => benefitBundles.id),
  },
  (t) => [index("pbbl_pv_idx").on(t.productVersionId)]
);

export const addOns = pgTable(
  "add_ons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    pricingMode: text("pricing_mode").default("flat").notNull(),
    priceAmount: numeric("price_amount"),
    priceMonthly: numeric("price_monthly"),
    priceWeekly: numeric("price_weekly"),
    priceBiweekly: numeric("price_biweekly"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("addons_org_idx").on(t.organizationId)]
);

export const ageBandConfigs = pgTable(
  "age_band_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    minAge: integer("min_age").notNull(),
    maxAge: integer("max_age").notNull(),
    version: integer("version").default(1).notNull(),
    effectiveFrom: date("effective_from"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("abc_org_idx").on(t.organizationId)]
);

// ─── POLICIES ───────────────────────────────────────────────

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    policyNumber: text("policy_number").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    productVersionId: uuid("product_version_id")
      .notNull()
      .references(() => productVersions.id),
    agentId: uuid("agent_id").references(() => users.id),
    groupId: uuid("group_id").references(() => groups.id),
    status: text("status").default("inactive").notNull(),
    currency: text("currency").default("USD").notNull(),
    premiumAmount: numeric("premium_amount").notNull(),
    paymentSchedule: text("payment_schedule").default("monthly").notNull(),
    effectiveDate: date("effective_date"),
    /** Set when first payment is received (issue/inception date). */
    inceptionDate: date("inception_date"),
    waitingPeriodEndDate: date("waiting_period_end_date"),
    currentCycleStart: date("current_cycle_start"),
    currentCycleEnd: date("current_cycle_end"),
    graceEndDate: date("grace_end_date"),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    beneficiaryFirstName: text("beneficiary_first_name"),
    beneficiaryLastName: text("beneficiary_last_name"),
    beneficiaryRelationship: text("beneficiary_relationship"),
    beneficiaryNationalId: text("beneficiary_national_id"),
    beneficiaryPhone: text("beneficiary_phone"),
    beneficiaryDependentId: uuid("beneficiary_dependent_id").references(() => dependents.id),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("policy_number_org_idx").on(t.policyNumber, t.organizationId),
    index("policies_org_idx").on(t.organizationId),
    index("policies_client_idx").on(t.clientId),
    index("policies_agent_idx").on(t.agentId),
    index("policies_status_idx").on(t.status),
    index("policies_branch_idx").on(t.branchId),
    index("policies_group_idx").on(t.groupId),
  ]
);

export const policyMembers = pgTable(
  "policy_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    clientId: uuid("client_id").references(() => clients.id),
    dependentId: uuid("dependent_id").references(() => dependents.id),
    memberNumber: text("member_number"),
    role: text("role").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pm_policy_idx").on(t.policyId),
    index("pm_org_idx").on(t.organizationId),
    uniqueIndex("pm_member_number_org_idx").on(t.organizationId, t.memberNumber),
  ]
);

export const policyStatusHistory = pgTable(
  "policy_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("psh_policy_idx").on(t.policyId)]
);

export const policyAddOns = pgTable(
  "policy_add_ons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    addOnId: uuid("add_on_id")
      .notNull()
      .references(() => addOns.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pao_policy_idx").on(t.policyId),
    uniqueIndex("policy_add_on_unique_idx").on(t.policyId, t.addOnId),
  ]
);

// ─── PAYMENTS & FINANCE (IMMUTABLE LEDGER) ──────────────────

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    policyId: uuid("policy_id").references(() => policies.id),
    clientId: uuid("client_id").references(() => clients.id),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    paymentMethod: text("payment_method").notNull(),
    status: text("status").default("pending").notNull(),
    reference: text("reference"),
    paynowReference: text("paynow_reference"),
    idempotencyKey: text("idempotency_key").unique(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    postedDate: date("posted_date"),
    valueDate: date("value_date"),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pt_org_idx").on(t.organizationId),
    index("pt_policy_idx").on(t.policyId),
    index("pt_posted_idx").on(t.postedDate),
    index("pt_received_idx").on(t.receivedAt),
    index("pt_client_idx").on(t.clientId),
  ]
);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    receiptNumber: text("receipt_number").notNull(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => paymentTransactions.id),
    policyId: uuid("policy_id").references(() => policies.id),
    clientId: uuid("client_id").references(() => clients.id),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
  },
  (t) => [
    index("receipts_org_idx").on(t.organizationId),
    uniqueIndex("receipt_number_org_idx").on(t.receiptNumber, t.organizationId),
  ]
);

// ─── PAYNOW PAYMENT INTENTS & EVENTS ─────────────────────────

export const PAYMENT_INTENT_STATUSES = ["created", "pending_user", "pending_paynow", "paid", "failed", "cancelled", "expired"] as const;
export const PAYMENT_PURPOSES = ["premium", "arrears", "reinstatement", "topup", "other"] as const;
export const PAYNOW_METHODS = ["ecocash", "onemoney", "innbucks", "omari", "visa_mastercard", "unknown"] as const;

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    currency: text("currency").default("USD").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    purpose: text("purpose").default("premium").notNull(),
    status: text("status").default("created").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    merchantReference: varchar("merchant_reference", { length: 255 }).notNull(),
    paynowReference: varchar("paynow_reference", { length: 255 }),
    paynowPollUrl: text("paynow_poll_url"),
    paynowRedirectUrl: text("paynow_redirect_url"),
    methodSelected: text("method_selected").default("unknown"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("pi_org_idx").on(t.organizationId),
    index("pi_client_idx").on(t.clientId),
    index("pi_policy_idx").on(t.policyId),
    index("pi_status_idx").on(t.status),
    uniqueIndex("pi_idempotency_org_idx").on(t.organizationId, t.idempotencyKey),
    uniqueIndex("pi_merchant_ref_org_idx").on(t.organizationId, t.merchantReference),
  ]
);

export const PAYMENT_EVENT_TYPES = [
  "initiated", "redirect_issued", "ussd_push_sent", "status_update_received", "polled",
  "marked_paid", "marked_failed", "receipt_issued", "manual_cash_receipted", "reprint", "reconciled",
] as const;

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentIntentId: uuid("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json"),
    actorType: text("actor_type").notNull(), // client | admin | system
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pe_intent_idx").on(t.paymentIntentId),
    index("pe_org_idx").on(t.organizationId),
    index("pe_created_idx").on(t.createdAt),
  ]
);

export const paymentReceipts = pgTable(
  "payment_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    receiptNumber: text("receipt_number").notNull(),
    paymentIntentId: uuid("payment_intent_id").references(() => paymentIntents.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    paymentChannel: text("payment_channel").notNull(), // paynow_ecocash | paynow_card | cash | other
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    pdfStorageKey: text("pdf_storage_key"),
    printFormat: text("print_format").default("thermal_80mm"),
    status: text("status").default("issued").notNull(), // issued | voided
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pr_org_idx").on(t.organizationId),
    index("pr_branch_idx").on(t.branchId),
    index("pr_intent_idx").on(t.paymentIntentId),
    index("pr_policy_idx").on(t.policyId),
    uniqueIndex("pr_receipt_org_idx").on(t.receiptNumber, t.organizationId),
  ]
);

// ─── MONTH-END RUN (batch receipt from bank file) ───
export const monthEndRuns = pgTable(
  "month_end_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    runNumber: text("run_number").notNull(),
    fileName: text("file_name"),
    totalRows: integer("total_rows").default(0),
    receiptedCount: integer("receipted_count").default(0),
    creditNoteCount: integer("credit_note_count").default(0),
    status: text("status").default("completed").notNull(),
    runBy: uuid("run_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("mer_org_idx").on(t.organizationId),
    uniqueIndex("mer_number_org_idx").on(t.runNumber, t.organizationId),
  ]
);

// ─── POLICY CREDIT BALANCE (for month-end run underpayments) ───
export const policyCreditBalances = pgTable(
  "policy_credit_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    balance: numeric("balance", { precision: 12, scale: 2 }).default("0").notNull(),
    currency: text("currency").default("USD").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("pcb_org_idx").on(t.organizationId),
    index("pcb_policy_idx").on(t.policyId),
    uniqueIndex("pcb_policy_org_idx").on(t.policyId, t.organizationId),
  ]
);

export const creditNotes = pgTable(
  "credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    creditNoteNumber: text("credit_note_number").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    reason: text("reason"),
    monthEndRunId: uuid("month_end_run_id").references(() => monthEndRuns.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("cn_org_idx").on(t.organizationId),
    index("cn_policy_idx").on(t.policyId),
    index("cn_client_idx").on(t.clientId),
    uniqueIndex("cn_number_org_idx").on(t.creditNoteNumber, t.organizationId),
  ]
);

export const reversalEntries = pgTable(
  "reversal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    originalTransactionId: uuid("original_transaction_id")
      .notNull()
      .references(() => paymentTransactions.id),
    reversalTransactionId: uuid("reversal_transaction_id")
      .notNull()
      .references(() => paymentTransactions.id),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("re_org_idx").on(t.organizationId)]
);

export const cashups = pgTable(
  "cashups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    cashupDate: date("cashup_date").notNull(),
    totalAmount: numeric("total_amount").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    isLocked: boolean("is_locked").default(false).notNull(),
    lockedBy: uuid("locked_by").references(() => users.id),
    lockedAt: timestamp("locked_at"),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cashups_org_idx").on(t.organizationId)]
);

// ─── CLAIMS ─────────────────────────────────────────────────

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    claimNumber: text("claim_number").notNull(),
    claimType: text("claim_type").notNull(),
    status: text("status").default("submitted").notNull(),
    deceasedName: text("deceased_name"),
    deceasedRelationship: text("deceased_relationship"),
    dateOfDeath: date("date_of_death"),
    causeOfDeath: text("cause_of_death"),
    cashInLieuAmount: numeric("cash_in_lieu_amount"),
    isWaitingPeriodWaived: boolean("is_waiting_period_waived").default(false),
    fraudFlags: jsonb("fraud_flags"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    verifiedBy: uuid("verified_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvalNotes: text("approval_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("claims_org_idx").on(t.organizationId),
    index("claims_policy_idx").on(t.policyId),
    index("claims_status_idx").on(t.status),
    uniqueIndex("claim_number_org_idx").on(t.claimNumber, t.organizationId),
  ]
);

export const claimDocuments = pgTable(
  "claim_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    documentType: text("document_type").notNull(),
    fileName: text("file_name").notNull(),
    filePath: text("file_path"),
    isVerified: boolean("is_verified").default(false),
    verifiedBy: uuid("verified_by").references(() => users.id),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [index("cd_claim_idx").on(t.claimId)]
);

export const claimStatusHistory = pgTable(
  "claim_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("csh_claim_idx").on(t.claimId)]
);

// ─── FUNERAL OPERATIONS ─────────────────────────────────────

export const funeralCases = pgTable(
  "funeral_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    claimId: uuid("claim_id").references(() => claims.id),
    policyId: uuid("policy_id").references(() => policies.id),
    caseNumber: text("case_number").notNull(),
    deceasedName: text("deceased_name").notNull(),
    funeralDate: date("funeral_date"),
    funeralLocation: text("funeral_location"),
    status: text("status").default("open").notNull(),
    assignedTo: uuid("assigned_to").references(() => users.id),
    notes: text("notes"),
    slaDeadline: timestamp("sla_deadline"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("fc_org_idx").on(t.organizationId),
    index("fc_claim_idx").on(t.claimId),
  ]
);

export const funeralTasks = pgTable(
  "funeral_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    funeralCaseId: uuid("funeral_case_id")
      .notNull()
      .references(() => funeralCases.id),
    taskName: text("task_name").notNull(),
    description: text("description"),
    status: text("status").default("pending").notNull(),
    assignedTo: uuid("assigned_to").references(() => users.id),
    dueDate: timestamp("due_date"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ft_case_idx").on(t.funeralCaseId)]
);

// ─── FLEET ──────────────────────────────────────────────────

export const fleetVehicles = pgTable(
  "fleet_vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    registration: text("registration").notNull(),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    vehicleType: text("vehicle_type"),
    status: text("status").default("available").notNull(),
    currentMileage: integer("current_mileage"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("fv_org_idx").on(t.organizationId)]
);

export const driverAssignments = pgTable(
  "driver_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => fleetVehicles.id),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => users.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    startDate: timestamp("start_date").defaultNow().notNull(),
    endDate: timestamp("end_date"),
    notes: text("notes"),
  },
  (t) => [index("da_vehicle_idx").on(t.vehicleId)]
);

export const fleetFuelLogs = pgTable(
  "fleet_fuel_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => fleetVehicles.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    litres: numeric("litres").notNull(),
    costAmount: numeric("cost_amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    mileageAtFill: integer("mileage_at_fill"),
    filledBy: uuid("filled_by").references(() => users.id),
    filledAt: timestamp("filled_at").defaultNow().notNull(),
  },
  (t) => [index("ffl_vehicle_idx").on(t.vehicleId)]
);

export const fleetMaintenance = pgTable(
  "fleet_maintenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => fleetVehicles.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    description: text("description").notNull(),
    costAmount: numeric("cost_amount"),
    currency: text("currency").default("USD"),
    scheduledDate: date("scheduled_date"),
    completedDate: date("completed_date"),
    status: text("status").default("scheduled").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("fm_vehicle_idx").on(t.vehicleId)]
);

// ─── PRICE BOOK & COSTING ───────────────────────────────────

export const priceBookItems = pgTable(
  "price_book_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    priceAmount: numeric("price_amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    category: text("category"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    version: integer("version").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("pbi_org_idx").on(t.organizationId)]
);

export const costSheets = pgTable(
  "cost_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    claimId: uuid("claim_id").references(() => claims.id),
    totalAmount: numeric("total_amount").default("0"),
    currency: text("currency").default("USD").notNull(),
    status: text("status").default("draft").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cs_org_idx").on(t.organizationId)]
);

export const costLineItems = pgTable(
  "cost_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    costSheetId: uuid("cost_sheet_id")
      .notNull()
      .references(() => costSheets.id),
    priceBookItemId: uuid("price_book_item_id").references(() => priceBookItems.id),
    description: text("description").notNull(),
    quantity: numeric("quantity").default("1").notNull(),
    unitPrice: numeric("unit_price").notNull(),
    totalPrice: numeric("total_price").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cli_sheet_idx").on(t.costSheetId)]
);

// ─── COMMISSIONS ────────────────────────────────────────────

export const commissionPlans = pgTable(
  "commission_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    firstMonthsCount: integer("first_months_count").default(2),
    firstMonthsRate: numeric("first_months_rate").default("50"),
    recurringStartMonth: integer("recurring_start_month").default(5),
    recurringRate: numeric("recurring_rate").default("10"),
    clawbackThresholdPayments: integer("clawback_threshold_payments").default(4),
    funeralServiceIncentive: numeric("funeral_service_incentive").default("50"),
    version: integer("version").default(1).notNull(),
    effectiveFrom: date("effective_from"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cp_org_idx").on(t.organizationId)]
);

export const commissionLedgerEntries = pgTable(
  "commission_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id),
    policyId: uuid("policy_id").references(() => policies.id),
    transactionId: uuid("transaction_id").references(() => paymentTransactions.id),
    entryType: text("entry_type").notNull(),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    description: text("description"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    status: text("status").default("earned").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("cle_org_idx").on(t.organizationId),
    index("cle_agent_idx").on(t.agentId),
    index("cle_policy_idx").on(t.policyId),
  ]
);

// ─── POL263 2.5% PLATFORM REVENUE SHARE ────────────────────

export const platformReceivables = pgTable(
  "platform_receivables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    sourceTransactionId: uuid("source_transaction_id").references(() => paymentTransactions.id),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    description: text("description"),
    isSettled: boolean("is_settled").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("pr_recv_org_idx").on(t.organizationId)]
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    attachments: jsonb("attachments"),
    status: text("status").default("pending").notNull(),
    initiatedBy: uuid("initiated_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("settlements_org_idx").on(t.organizationId)]
);

// ─── PAYROLL ────────────────────────────────────────────────

export const payrollEmployees = pgTable(
  "payroll_employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id").references(() => users.id),
    employeeNumber: text("employee_number").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    position: text("position"),
    department: text("department"),
    baseSalary: numeric("base_salary"),
    currency: text("currency").default("USD").notNull(),
    bankDetails: jsonb("bank_details"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("payroll_employees_org_idx").on(t.organizationId)]
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").default("draft").notNull(),
    totalGross: numeric("total_gross"),
    totalDeductions: numeric("total_deductions"),
    totalNet: numeric("total_net"),
    preparedBy: uuid("prepared_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("payroll_runs_org_idx").on(t.organizationId)]
);

export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => payrollEmployees.id),
    grossAmount: numeric("gross_amount").notNull(),
    deductions: jsonb("deductions"),
    netAmount: numeric("net_amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("payslips_run_idx").on(t.payrollRunId)]
);

// ─── NOTIFICATIONS ──────────────────────────────────────────

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    eventType: text("event_type").notNull(),
    channel: text("channel").default("in_app").notNull(),
    subject: text("subject"),
    bodyTemplate: text("body_template").notNull(),
    mergeTags: jsonb("merge_tags"),
    version: integer("version").default(1).notNull(),
    effectiveFrom: date("effective_from"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("nt_org_idx").on(t.organizationId)]
);

export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    templateId: uuid("template_id").references(() => notificationTemplates.id),
    recipientType: text("recipient_type").notNull(),
    recipientId: uuid("recipient_id"),
    channel: text("channel").notNull(),
    subject: text("subject"),
    body: text("body"),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    failureReason: text("failure_reason"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("nl_org_idx").on(t.organizationId),
    index("nl_recipient_idx").on(t.recipientId),
  ]
);

// ─── LEAD PIPELINE (CRM-LITE) ──────────────────────────────

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    agentId: uuid("agent_id").references(() => users.id),
    clientId: uuid("client_id").references(() => clients.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    source: text("source").default("walk_in").notNull(),
    stage: text("stage").default("captured").notNull(),
    lostReason: text("lost_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("leads_org_idx").on(t.organizationId),
    index("leads_agent_idx").on(t.agentId),
    index("leads_stage_idx").on(t.stage),
    index("leads_client_idx").on(t.clientId),
  ]
);

// ─── CLIENT FEEDBACK & COMPLAINTS ─────────────────────────────

export const clientFeedback = pgTable(
  "client_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    type: text("type").notNull(), // 'complaint' | 'feedback'
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    status: text("status").default("open").notNull(), // open | acknowledged | closed
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("client_feedback_org_idx").on(t.organizationId),
    index("client_feedback_client_idx").on(t.clientId),
  ]
);

// ─── EXPENDITURE ────────────────────────────────────────────

export const expenditures = pgTable(
  "expenditures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id),
    receiptRef: text("receipt_ref"),
    spentAt: date("spent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("exp_org_idx").on(t.organizationId)]
);

// ─── MAKER-CHECKER APPROVALS ────────────────────────────────

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    requestType: text("request_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    requestData: jsonb("request_data"),
    status: text("status").default("pending").notNull(),
    initiatedBy: uuid("initiated_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("ar_org_idx").on(t.organizationId),
    index("ar_status_idx").on(t.status),
  ]
);

// ─── TERMS AND CONDITIONS ───────────────────────────────────

export const termsAndConditions = pgTable(
  "terms_and_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    productVersionId: uuid("product_version_id").references(() => productVersions.id),
    title: text("title").notNull(),
    content: text("content").notNull(),
    category: text("category").default("general").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("tc_org_idx").on(t.organizationId), index("tc_pv_idx").on(t.productVersionId)]
);

export const insertTermsSchema = createInsertSchema(termsAndConditions).omit({ id: true, createdAt: true });
export type TermsAndConditions = typeof termsAndConditions.$inferSelect;
export type InsertTerms = z.infer<typeof insertTermsSchema>;

// ─── FEATURE FLAGS ──────────────────────────────────────────

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").default(false).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ff_org_idx").on(t.organizationId)]
);

// ─── AUDIT ──────────────────────────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    actorId: uuid("actor_id").references(() => users.id),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (t) => [
    index("audit_org_idx").on(t.organizationId),
    index("audit_ts_idx").on(t.timestamp),
  ]
);

// ─── SESSIONS ───────────────────────────────────────────────

export const sessions = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

// ─── INSERT SCHEMAS ─────────────────────────────────────────

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertBranchSchema = createInsertSchema(branches).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true });
export const insertDependentSchema = createInsertSchema(dependents).omit({ id: true, createdAt: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
export const insertProductVersionSchema = createInsertSchema(productVersions).omit({ id: true, createdAt: true });
export const insertBenefitCatalogItemSchema = createInsertSchema(benefitCatalogItems).omit({ id: true, createdAt: true });
export const insertBenefitBundleSchema = createInsertSchema(benefitBundles).omit({ id: true, createdAt: true });
export const insertAddOnSchema = createInsertSchema(addOns).omit({ id: true, createdAt: true });
export const insertAgeBandConfigSchema = createInsertSchema(ageBandConfigs).omit({ id: true, createdAt: true });
export const insertPolicySchema = createInsertSchema(policies).omit({ id: true, createdAt: true });
export const insertPolicyMemberSchema = createInsertSchema(policyMembers).omit({ id: true, createdAt: true });
export const insertPolicyAddOnSchema = createInsertSchema(policyAddOns).omit({ id: true, createdAt: true });
export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({ id: true, createdAt: true });
export const insertReceiptSchema = createInsertSchema(receipts).omit({ id: true });
export const insertPaymentIntentSchema = createInsertSchema(paymentIntents).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaymentEventSchema = createInsertSchema(paymentEvents).omit({ id: true, createdAt: true });
export const insertPaymentReceiptSchema = createInsertSchema(paymentReceipts).omit({ id: true, createdAt: true });
export const insertPolicyCreditBalanceSchema = createInsertSchema(policyCreditBalances).omit({ id: true });
export const insertCreditNoteSchema = createInsertSchema(creditNotes).omit({ id: true, createdAt: true });
export const insertMonthEndRunSchema = createInsertSchema(monthEndRuns).omit({ id: true, createdAt: true });
export const insertClaimSchema = createInsertSchema(claims).omit({ id: true, createdAt: true });
export const insertClaimDocumentSchema = createInsertSchema(claimDocuments).omit({ id: true, uploadedAt: true });
export const insertFuneralCaseSchema = createInsertSchema(funeralCases).omit({ id: true, createdAt: true });
export const insertFuneralTaskSchema = createInsertSchema(funeralTasks).omit({ id: true, createdAt: true });
export const insertFleetVehicleSchema = createInsertSchema(fleetVehicles).omit({ id: true, createdAt: true });
export const insertCommissionPlanSchema = createInsertSchema(commissionPlans).omit({ id: true, createdAt: true });
export const insertCommissionLedgerEntrySchema = createInsertSchema(commissionLedgerEntries).omit({ id: true, createdAt: true });
export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({ id: true, createdAt: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export const insertClientFeedbackSchema = createInsertSchema(clientFeedback).omit({ id: true, createdAt: true, updatedAt: true });
export const insertExpenditureSchema = createInsertSchema(expenditures).omit({ id: true, createdAt: true });
export const insertPriceBookItemSchema = createInsertSchema(priceBookItems).omit({ id: true, createdAt: true });
export const insertApprovalRequestSchema = createInsertSchema(approvalRequests).omit({ id: true, createdAt: true });
export const insertPayrollEmployeeSchema = createInsertSchema(payrollEmployees).omit({ id: true, createdAt: true });
export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({ id: true, createdAt: true });
export const insertCashupSchema = createInsertSchema(cashups).omit({ id: true, createdAt: true });

// ─── TYPES ──────────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Branch = typeof branches.$inferSelect;
export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Dependent = typeof dependents.$inferSelect;
export type InsertDependent = z.infer<typeof insertDependentSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type ProductVersion = typeof productVersions.$inferSelect;
export type InsertProductVersion = z.infer<typeof insertProductVersionSchema>;
export type BenefitCatalogItem = typeof benefitCatalogItems.$inferSelect;
export type InsertBenefitCatalogItem = z.infer<typeof insertBenefitCatalogItemSchema>;
export type BenefitBundle = typeof benefitBundles.$inferSelect;
export type InsertBenefitBundle = z.infer<typeof insertBenefitBundleSchema>;
export type AddOn = typeof addOns.$inferSelect;
export type InsertAddOn = z.infer<typeof insertAddOnSchema>;
export type AgeBandConfig = typeof ageBandConfigs.$inferSelect;
export type InsertAgeBandConfig = z.infer<typeof insertAgeBandConfigSchema>;
export type Policy = typeof policies.$inferSelect;
export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type PolicyMember = typeof policyMembers.$inferSelect;
export type InsertPolicyMember = z.infer<typeof insertPolicyMemberSchema>;
export type PolicyStatusHistoryEntry = typeof policyStatusHistory.$inferSelect;
export type PolicyAddOn = typeof policyAddOns.$inferSelect;
export type InsertPolicyAddOn = z.infer<typeof insertPolicyAddOnSchema>;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;
export type Receipt = typeof receipts.$inferSelect;
export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type InsertPaymentIntent = z.infer<typeof insertPaymentIntentSchema>;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type InsertPaymentEvent = z.infer<typeof insertPaymentEventSchema>;
export type PaymentReceipt = typeof paymentReceipts.$inferSelect;
export type InsertPaymentReceipt = z.infer<typeof insertPaymentReceiptSchema>;
export type PolicyCreditBalance = typeof policyCreditBalances.$inferSelect;
export type InsertPolicyCreditBalance = z.infer<typeof insertPolicyCreditBalanceSchema>;
export type CreditNote = typeof creditNotes.$inferSelect;
export type InsertCreditNote = z.infer<typeof insertCreditNoteSchema>;
export type MonthEndRun = typeof monthEndRuns.$inferSelect;
export type InsertMonthEndRun = z.infer<typeof insertMonthEndRunSchema>;
export type Claim = typeof claims.$inferSelect;
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type ClaimDocument = typeof claimDocuments.$inferSelect;
export type InsertClaimDocument = z.infer<typeof insertClaimDocumentSchema>;
export type FuneralCase = typeof funeralCases.$inferSelect;
export type InsertFuneralCase = z.infer<typeof insertFuneralCaseSchema>;
export type FuneralTask = typeof funeralTasks.$inferSelect;
export type InsertFuneralTask = z.infer<typeof insertFuneralTaskSchema>;
export type FleetVehicle = typeof fleetVehicles.$inferSelect;
export type InsertFleetVehicle = z.infer<typeof insertFleetVehicleSchema>;
export type CommissionPlan = typeof commissionPlans.$inferSelect;
export type InsertCommissionPlan = z.infer<typeof insertCommissionPlanSchema>;
export type CommissionLedgerEntry = typeof commissionLedgerEntries.$inferSelect;
export type InsertCommissionLedgerEntry = z.infer<typeof insertCommissionLedgerEntrySchema>;
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type ClientFeedback = typeof clientFeedback.$inferSelect;
export type InsertClientFeedback = z.infer<typeof insertClientFeedbackSchema>;
export type Expenditure = typeof expenditures.$inferSelect;
export type InsertExpenditure = z.infer<typeof insertExpenditureSchema>;
export type PriceBookItem = typeof priceBookItems.$inferSelect;
export type InsertPriceBookItem = z.infer<typeof insertPriceBookItemSchema>;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type PayrollEmployee = typeof payrollEmployees.$inferSelect;
export type InsertPayrollEmployee = z.infer<typeof insertPayrollEmployeeSchema>;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type Cashup = typeof cashups.$inferSelect;
export type InsertCashup = z.infer<typeof insertCashupSchema>;

// ─── POLICY STATUS ENUM ────────────────────────────────────

export const POLICY_STATUSES = ["inactive", "active", "grace", "lapsed", "cancelled"] as const;
export type PolicyStatus = typeof POLICY_STATUSES[number];

export const VALID_POLICY_TRANSITIONS: Record<string, string[]> = {
  inactive: ["active", "cancelled"],
  active: ["grace", "cancelled"],
  grace: ["active", "lapsed"],
  lapsed: ["active", "cancelled"],
};

export const CLAIM_STATUSES = ["submitted", "verified", "approved", "scheduled", "payable", "completed", "paid", "closed", "rejected"] as const;
export type ClaimStatus = typeof CLAIM_STATUSES[number];

export const VALID_CLAIM_TRANSITIONS: Record<string, string[]> = {
  submitted: ["verified", "rejected"],
  verified: ["approved", "rejected"],
  approved: ["scheduled", "payable"],
  scheduled: ["completed"],
  payable: ["paid"],
  completed: ["closed"],
  paid: ["closed"],
};

export const LEAD_STAGES = ["captured", "contacted", "quote_generated", "application_started", "submitted", "approved", "activated", "lost"] as const;
export type LeadStage = typeof LEAD_STAGES[number];

// ─── GROUPS ────────────────────────────────────────────────

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    type: text("type").default("community").notNull(),
    description: text("description"),
    chairpersonName: text("chairperson_name"),
    chairpersonPhone: text("chairperson_phone"),
    chairpersonEmail: text("chairperson_email"),
    secretaryName: text("secretary_name"),
    secretaryPhone: text("secretary_phone"),
    secretaryEmail: text("secretary_email"),
    treasurerName: text("treasurer_name"),
    treasurerPhone: text("treasurer_phone"),
    treasurerEmail: text("treasurer_email"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("groups_org_idx").on(t.organizationId)]
);

export const insertGroupSchema = createInsertSchema(groups).omit({ id: true, createdAt: true });
export type Group = typeof groups.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;

// ─── GROUP BULK PAYMENT (executive pays for multiple group policies at once) ───
export const groupPaymentIntents = pgTable(
  "group_payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    status: text("status").default("created").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    merchantReference: varchar("merchant_reference", { length: 255 }).notNull(),
    paynowReference: varchar("paynow_reference", { length: 255 }),
    paynowPollUrl: text("paynow_poll_url"),
    paynowRedirectUrl: text("paynow_redirect_url"),
    methodSelected: text("method_selected").default("unknown"),
    initiatedByClientId: uuid("initiated_by_client_id").references(() => clients.id),
    initiatedByUserId: uuid("initiated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("gpi_org_idx").on(t.organizationId),
    index("gpi_group_idx").on(t.groupId),
    index("gpi_status_idx").on(t.status),
    uniqueIndex("gpi_idempotency_org_idx").on(t.organizationId, t.idempotencyKey),
  ]
);

export const groupPaymentAllocations = pgTable(
  "group_payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupPaymentIntentId: uuid("group_payment_intent_id")
      .notNull()
      .references(() => groupPaymentIntents.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("gpa_intent_idx").on(t.groupPaymentIntentId),
    index("gpa_policy_idx").on(t.policyId),
  ]
);

export const insertGroupPaymentIntentSchema = createInsertSchema(groupPaymentIntents).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGroupPaymentAllocationSchema = createInsertSchema(groupPaymentAllocations).omit({ id: true, createdAt: true });
export type GroupPaymentIntent = typeof groupPaymentIntents.$inferSelect;
export type InsertGroupPaymentIntent = z.infer<typeof insertGroupPaymentIntentSchema>;
export type GroupPaymentAllocation = typeof groupPaymentAllocations.$inferSelect;
export type InsertGroupPaymentAllocation = z.infer<typeof insertGroupPaymentAllocationSchema>;

// ─── SETTLEMENT ALLOCATIONS ────────────────────────────────

export const settlementAllocations = pgTable(
  "settlement_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id),
    receivableId: uuid("receivable_id")
      .notNull()
      .references(() => platformReceivables.id),
    amount: numeric("amount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

// ─── PLATFORM + SETTLEMENT SCHEMAS ─────────────────────────

export const insertPlatformReceivableSchema = createInsertSchema(platformReceivables).omit({ id: true, createdAt: true });
export type PlatformReceivable = typeof platformReceivables.$inferSelect;
export type InsertPlatformReceivable = z.infer<typeof insertPlatformReceivableSchema>;

export const insertSettlementSchema = createInsertSchema(settlements).omit({ id: true, createdAt: true });
export type Settlement = typeof settlements.$inferSelect;
export type InsertSettlement = z.infer<typeof insertSettlementSchema>;
