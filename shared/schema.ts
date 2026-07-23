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
import type { OrgType, ProductType, DistributionChannel } from "./org-profile";

// ─── MULTI-TENANCY ──────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  logoUrl: text("logo_url").default("/assets/logo.png"),
  signatureUrl: text("signature_url"),
  primaryColor: text("primary_color").default("#0d9488"),
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
  /** Per-tenant PayNow merchant credentials. When set, these override the platform-level env vars. */
  paynowIntegrationId: text("paynow_integration_id"),
  paynowIntegrationKey: text("paynow_integration_key"),
  paynowAuthEmail: text("paynow_auth_email"),
  paynowReturnUrl: text("paynow_return_url"),
  paynowResultUrl: text("paynow_result_url"),
  paynowMode: text("paynow_mode").$type<"test" | "live">(),
  /**
   * Business-profile fields captured at onboarding — drive which product builder(s), claims
   * workflow, nav items, and report sections a tenant sees. Additive/nullable by design: existing
   * tenants (created before this existed) have null here until explicitly backfilled — the
   * capability resolver (server/org-capabilities.ts) must never silently default an unprofiled
   * tenant to "show nothing," only ever to "show everything" (fail open), same convention as
   * hasModule()'s "no subscription row" case.
   */
  orgType: text("org_type").$type<OrgType>(),
  /** Which product types this tenant actually sells — drives which builder(s) activate. Distinct
   *  from orgType: a funeral services company and a funeral assurer can both sell funeral_cash_plan. */
  productTypes: jsonb("product_types").$type<ProductType[]>().notNull().default([]),
  distributionChannels: jsonb("distribution_channels").$type<DistributionChannel[]>().notNull().default([]),
  bookStatus: text("book_status").$type<"existing" | "new">(),
  /** Active policy/member count as of onboarding, for an existing book. */
  bookSizeCurrent: integer("book_size_current"),
  /** Projected policy/member count at 12 months, for a new book. */
  bookSizeProjected12mo: integer("book_size_projected_12mo"),
  staffComplement: integer("staff_complement"),
  onboardingProfileCompletedAt: timestamp("onboarding_profile_completed_at"),
});

/** Central-DB-only routing pointer: the public /pay/:token page has no session, so it can't
 *  resolve which tenant database to query (isolated-tenant orgs like Falakhe have their own DB —
 *  see server/tenant-db.ts). This tiny table lives in the main DB and is queried with the plain
 *  `db` export (never getDbForOrg) purely to answer "which org does this token belong to", the
 *  same bootstrapping role `users.referralCode` already plays for the public registration flow.
 *  The real payment_links row (with its policy/client FKs) lives in that org's own database. */
export const paymentLinkTokens = pgTable("payment_link_tokens", {
  token: text("token").primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
    // The org-wide default branch — policies/funeral cases/mortuary intakes fall
    // back to this branch when none is explicitly selected. At most one per org
    // (enforced by the partial unique index below).
    isHeadOffice: boolean("is_head_office").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("branches_org_idx").on(t.organizationId),
    uniqueIndex("branches_one_head_office_per_org")
      .on(t.organizationId)
      .where(sql`is_head_office = true`),
  ]
);

/** Tenant-configurable geographic/country flagging (one row per org). Generalizes
 *  Falakhe's original hardcoded "South Africa" flag on policies — other tenants
 *  can enable this with their own labels, or leave it off entirely. See
 *  docs memory "project_multi_country_tenants" for background. */
export const countryFlagSettings = pgTable("country_flag_settings", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").default(false).notNull(),
  /** Label for the flagged/cross-border case, e.g. "South Africa". */
  flagLabel: text("flag_label").default("South Africa").notNull(),
  /** Label for the default/home case, e.g. "Zimbabwe". */
  homeLabel: text("home_label").default("Zimbabwe").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertCountryFlagSettingsSchema = createInsertSchema(countryFlagSettings).omit({ updatedAt: true });
export type CountryFlagSettings = typeof countryFlagSettings.$inferSelect;
export type InsertCountryFlagSettings = z.infer<typeof insertCountryFlagSettingsSchema>;

/** Org-wide membership-card template settings (one row per org) — used to render the
 *  printable member card PDF for a policyholder. */
export const memberCardSettings = pgTable("member_card_settings", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  cardTitle: text("card_title").default("Membership Card").notNull(),
  showLogo: boolean("show_logo").default(true).notNull(),
  showPolicyNumber: boolean("show_policy_number").default(true).notNull(),
  showSurname: boolean("show_surname").default(true).notNull(),
  showIdNumber: boolean("show_id_number").default(true).notNull(),
  showDateOfBirth: boolean("show_date_of_birth").default(true).notNull(),
  showPlan: boolean("show_plan").default(true).notNull(),
  showQrCode: boolean("show_qr_code").default(true).notNull(),
  /** Gold subtitle under the organization name, e.g. "For a Service Beyond Ubuntu". */
  tagline: text("tagline"),
  /** Bold statement in the footer bar, e.g. "You are not just a client, you are family." */
  footerNote: text("footer_note"),
  /** Italic tagline on the right of the footer bar, e.g. "With Dignity. With Care. With Ubuntu." */
  footerSlogan: text("footer_slogan"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertMemberCardSettingsSchema = createInsertSchema(memberCardSettings).omit({ updatedAt: true });
export type MemberCardSettings = typeof memberCardSettings.$inferSelect;
export type InsertMemberCardSettings = z.infer<typeof insertMemberCardSettingsSchema>;

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
  mortuaryNext: integer("mortuary_next").default(0).notNull(),
  quotationNext: integer("quotation_next").default(0).notNull(),
  employeeNext: integer("employee_next").default(0).notNull(),
  requisitionNext: integer("requisition_next").default(0).notNull(),
  disbursementNext: integer("disbursement_next").default(0).notNull(),
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
    phone: text("phone"),
    address: text("address"),
    nationalId: text("national_id"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    nextOfKinName: text("next_of_kin_name"),
    nextOfKinPhone: text("next_of_kin_phone"),
    department: text("department"),
    /** Short bio shown on the agent's public vCard page (/join/:refCode). */
    bio: text("bio"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("users_org_idx").on(t.organizationId)]
);

export const AGENT_CONTENT_POST_TYPES = ["video", "post"] as const;

/** Org-wide training/education content pushed to every agent's public vCard page —
 *  authored by an org admin (manage:settings), shared to all agents, not per-agent. */
export const agentContentPosts = pgTable(
  "agent_content_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(), // video | post
    title: text("title").notNull(),
    body: text("body"),
    videoUrl: text("video_url"), // external embed link (YouTube/Vimeo) — no video hosting
    thumbnailUrl: text("thumbnail_url"),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("acp_org_idx").on(t.organizationId)]
);
export const insertAgentContentPostSchema = createInsertSchema(agentContentPosts).omit({ id: true, createdAt: true });
export type AgentContentPost = typeof agentContentPosts.$inferSelect;
export type InsertAgentContentPost = z.infer<typeof insertAgentContentPostSchema>;

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
    physicalAddress: text("physical_address"),
    postalAddress: text("postal_address"),
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
    index("clients_org_email_idx").on(t.organizationId, t.email),
    index("clients_org_national_id_idx").on(t.organizationId, t.nationalId),
  ]
);

// ─── CLIENT DOCUMENTS (uploaded ID copies, proof of address, etc.) ───
export const clientDocuments = pgTable(
  "client_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    /** e.g. national_id, proof_of_address, passport, birth_certificate, other */
    documentType: text("document_type").notNull(),
    /** Display name / description */
    label: text("label"),
    /** Original file name */
    fileName: text("file_name").notNull(),
    /** MIME type */
    mimeType: text("mime_type"),
    /** URL in object storage */
    fileUrl: text("file_url").notNull(),
    /** Object storage key (for deletion) */
    storageKey: text("storage_key"),
    /** File size in bytes */
    fileSize: integer("file_size"),
    /** Who uploaded it */
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("client_docs_org_idx").on(t.organizationId),
    index("client_docs_client_idx").on(t.clientId),
  ]
);

// ─── POLICY DOCUMENTS ────────────────────────────────────────
export const policyDocuments = pgTable(
  "policy_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    policyId: uuid("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    label: text("label"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    fileUrl: text("file_url").notNull(),
    storageKey: text("storage_key"),
    fileSize: integer("file_size"),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("policy_docs_org_idx").on(t.organizationId),
    index("policy_docs_policy_idx").on(t.policyId),
  ]
);

// ─── WAITING PERIOD WAIVERS ─────────────────────────────────
export const waitingPeriodWaivers = pgTable(
  "waiting_period_waivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    policyId: uuid("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    status: text("status").default("pending").notNull(),
    reason: text("reason"),
    supportingNotes: text("supporting_notes"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("wpw_org_idx").on(t.organizationId),
    index("wpw_policy_idx").on(t.policyId),
    index("wpw_status_idx").on(t.status),
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

// ─── CLIENT PAYMENT METHODS (tokenized/obfuscated only) ───
export const clientPaymentMethods = pgTable(
  "client_payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    methodType: text("method_type").notNull(), // mobile | card (card legacy read-only; automation uses mobile + Paynow)
    provider: text("provider"), // ecocash | onemoney | visa_mastercard | other
    mobileNumber: text("mobile_number"),
    cardLast4: text("card_last4"),
    cardBrand: text("card_brand"),
    cardExpiryMonth: integer("card_expiry_month"),
    cardExpiryYear: integer("card_expiry_year"),
    cardToken: text("card_token"),
    isDefault: boolean("is_default").default(true).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("cpm_org_idx").on(t.organizationId),
    index("cpm_client_idx").on(t.clientId),
  ]
);

// ─── PAYMENT AUTOMATION SETTINGS ────────────────────────────
export const paymentAutomationSettings = pgTable(
  "payment_automation_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    isEnabled: boolean("is_enabled").default(false).notNull(),
    /** Start automation after this many days since last cleared payment. */
    daysAfterLastPayment: integer("days_after_last_payment").default(30).notNull(),
    /** Repeat notification/collection attempts every N days while unpaid. */
    repeatEveryDays: integer("repeat_every_days").default(30).notNull(),
    sendPushNotifications: boolean("send_push_notifications").default(true).notNull(),
    autoRunPayments: boolean("auto_run_payments").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("pas_org_unique_idx").on(t.organizationId),
  ]
);

export const paymentAutomationRuns = pgTable(
  "payment_automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    policyId: uuid("policy_id").notNull(),
    clientId: uuid("client_id").references(() => clients.id),
    actionType: text("action_type").notNull(), // reminder | auto_payment_attempt
    status: text("status").notNull(), // success | failed | skipped
    methodType: text("method_type"), // mobile | card
    message: text("message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("par_org_idx").on(t.organizationId),
    index("par_policy_idx").on(t.policyId),
    index("par_created_idx").on(t.createdAt),
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
    maxAdditionalMembers: integer("max_additional_members"),
    casketType: text("casket_type"),
    casketImageUrl: text("casket_image_url"),
    coverAmount: numeric("cover_amount"),
    coverCurrency: text("cover_currency").default("USD"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Generalizes the risk/protection engine beyond funeral cash plans (see
     * shared/product-types.ts). Nullable/additive — existing products (funeral cash plans) are
     * left null rather than force-backfilled, and every place that reads these must treat null
     * the same as {benefitTrigger:"death", insuredEntityType:"person_household"} (today's only
     * real behavior) so no existing product's premium/claim logic changes. maxAdults/maxChildren/
     * casketType/etc. above stay exactly as-is — they're the person_household+death shape, not
     * replaced by this.
     */
    // Plain text (not .$type<>()-branded) to match this schema's convention for enum-like
    // columns (status, claimType, etc.) — drizzle-zod's auto-generated insert schema widens a
    // branded text column back to string anyway, so branding here just fights the inferred
    // InsertProduct type for no real safety gain. Validated against BENEFIT_TRIGGERS/
    // INSURED_ENTITY_TYPES at the route layer instead; use resolveBenefitTrigger()/
    // resolveInsuredEntityType() (shared/product-types.ts) to read these with the null-means-
    // death/person_household default applied.
    benefitTrigger: text("benefit_trigger"),
    insuredEntityType: text("insured_entity_type"),
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
    premiumWeeklyZar: numeric("premium_weekly_zar"),
    premiumBiweeklyUsd: numeric("premium_biweekly_usd"),
    premiumBiweeklyZar: numeric("premium_biweekly_zar"),
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
    /** Amount tenant pays to underwriter per adult member per month (product currency). */
    underwriterAmountAdult: numeric("underwriter_amount_adult"),
    /** Amount tenant pays to underwriter per child member per month. If null and underwriterAmountAdult set, same as adult. */
    underwriterAmountChild: numeric("underwriter_amount_child"),
    /** Months to pay underwriter in advance (e.g. 3 = tenant pays 3 months ahead). Total payable = monthly × (1 + advance). */
    underwriterAdvanceMonths: integer("underwriter_advance_months").default(0).notNull(),
    /** Client-facing premium per additional member (per month, USD) for members beyond the product's included count. */
    additionalMemberPremiumMonthlyUsd: numeric("additional_member_premium_monthly_usd"),
    /** Client-facing premium per additional member (per month, ZAR) for members beyond the product's included count. */
    additionalMemberPremiumMonthlyZar: numeric("additional_member_premium_monthly_zar"),
    /**
     * Optional age-band rates for additional (paying) members, on top of the flat rate above.
     * All nullable — a version with none of these set keeps using the flat rate untouched.
     * The "child" band uses this same version's dependentMaxAge cutoff; the other three
     * bands cover 21-65, 66-84, and 85+.
     */
    additionalMemberRateChildUsd: numeric("additional_member_rate_child_usd"),
    additionalMemberRateChildZar: numeric("additional_member_rate_child_zar"),
    additionalMemberRate21To65Usd: numeric("additional_member_rate_21_65_usd"),
    additionalMemberRate21To65Zar: numeric("additional_member_rate_21_65_zar"),
    additionalMemberRate66To84Usd: numeric("additional_member_rate_66_84_usd"),
    additionalMemberRate66To84Zar: numeric("additional_member_rate_66_84_zar"),
    additionalMemberRate85PlusUsd: numeric("additional_member_rate_85_plus_usd"),
    additionalMemberRate85PlusZar: numeric("additional_member_rate_85_plus_zar"),
    /**
     * Hospital cash benefit config (server/hospital-cash-claims.ts) — only relevant when the
     * parent product's benefitTrigger is 'hospitalization'; null/unused for the funeral cash-
     * plan shape every other product uses. Premium pricing above (premiumMonthlyUsd etc.) is
     * shared/reused as-is — hospital cash charges the same way any other product does, only the
     * claim payout math differs.
     */
    dailyBenefitRateUsd: numeric("daily_benefit_rate_usd"),
    dailyBenefitRateZar: numeric("daily_benefit_rate_zar"),
    maxDaysPerClaim: integer("max_days_per_claim"),
    maxDaysPerYear: integer("max_days_per_year"),
    /**
     * Underwriting (server/underwriting.ts) — false/null for every product version today
     * (funeral cash plans are guaranteed-acceptance), so this whole block is a no-op unless a
     * product version explicitly opts in. underwritingQuestions is an array of
     * { id, text, options: [{ value, label, outcome: 'accept'|'rate_up'|'decline', loadingPercent? }] }.
     */
    requiresUnderwriting: boolean("requires_underwriting").default(false).notNull(),
    underwritingQuestions: jsonb("underwriting_questions"),
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
    graceUsedDays: integer("grace_used_days").default(0).notNull(),
    lastAutoPaymentAttemptAt: timestamp("last_auto_payment_attempt_at"),
    lastAutoReminderAt: timestamp("last_auto_reminder_at"),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    beneficiaryFirstName: text("beneficiary_first_name"),
    beneficiaryLastName: text("beneficiary_last_name"),
    beneficiaryRelationship: text("beneficiary_relationship"),
    beneficiaryNationalId: text("beneficiary_national_id"),
    beneficiaryPhone: text("beneficiary_phone"),
    beneficiaryDependentId: uuid("beneficiary_dependent_id").references(() => dependents.id),
    version: integer("version").default(1).notNull(),
    isLegacy: boolean("is_legacy").default(false).notNull(),
    /** South African-based policy (paid in ZAR, or by a client based in SA) — surfaced as a badge/filter in the UI. */
    isSouthAfrica: boolean("is_south_africa").default(false).notNull(),
    /** Free-text reference to an external system's record for this policy — e.g. an RSA branch's
     *  own policy number for a cross-border policy. Not validated/parsed, just carried along. */
    externalReference: text("external_reference"),
    /** Manually set premium that overrides the system-calculated premiumAmount. When set, this is the effective premium. */
    premiumOverride: numeric("premium_override", { precision: 12, scale: 2 }),
    premiumOverrideNote: text("premium_override_note"),
    /**
     * Underwriting decision (server/underwriting.ts), recorded at policy creation when the
     * product version has requiresUnderwriting set. Null for every policy on a product that
     * doesn't require underwriting (the overwhelming majority today).
     */
    underwritingStatus: text("underwriting_status"), // null | 'accepted' | 'rated_up' | 'declined'
    underwritingAnswers: jsonb("underwriting_answers"),
    /** Extra premium loading applied on top of the base premium when underwritingStatus = 'rated_up'. */
    underwritingLoadingPercent: numeric("underwriting_loading_percent", { precision: 5, scale: 2 }),
    underwritingDecidedAt: timestamp("underwriting_decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("policy_number_org_idx").on(t.policyNumber, t.organizationId),
    index("policies_org_idx").on(t.organizationId),
    index("policies_client_idx").on(t.clientId),
    index("policies_agent_idx").on(t.agentId),
    index("policies_status_idx").on(t.status),
    index("policies_branch_idx").on(t.branchId),
    index("policies_group_idx").on(t.groupId),
    index("policies_org_status_created_idx").on(t.organizationId, t.status, t.createdAt),
  ]
);

export const policyMembers = pgTable(
  "policy_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
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
      .references(() => policies.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("psh_policy_idx").on(t.policyId),
    index("policy_status_history_policy_to_status_idx").on(t.policyId, t.toStatus, t.createdAt),
  ]
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
    // Which policy member this add-on belongs to. NULL = applies to the whole policy (legacy / fallback).
    policyMemberId: uuid("policy_member_id").references(() => policyMembers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pao_policy_idx").on(t.policyId),
    index("pao_member_idx").on(t.policyMemberId),
    // Uniqueness enforced via partial SQL indexes in the migration script (see script/add-policy-addon-member.ts)
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
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
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

export const PAYMENT_LINK_STATUSES = ["active", "paid", "expired", "cancelled"] as const;

/** A shareable, unauthenticated pay-by-link URL for a specific policy/amount/method — the
 *  client opens /pay/:token and pays without a staff member present. Cash is deliberately not
 *  a valid method here (it's not a Paynow method at all); currency is USD-only, matching the
 *  Paynow integration's own USD-only constraint (see payment-service.ts). */
export const paymentLinks = pgTable(
  "payment_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    policyId: uuid("policy_id").notNull().references(() => policies.id),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    token: text("token").notNull().unique(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    method: text("method").notNull(), // ecocash | onemoney | innbucks | omari | visa_mastercard
    payerPhone: text("payer_phone"),
    status: text("status").default("active").notNull(), // active | paid | expired | cancelled
    paymentIntentId: uuid("payment_intent_id").references(() => paymentIntents.id),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pl_org_idx").on(t.organizationId),
    index("pl_policy_idx").on(t.policyId),
    index("pl_status_idx").on(t.status),
  ]
);
export const insertPaymentLinkSchema = createInsertSchema(paymentLinks).omit({ id: true, createdAt: true });
export type PaymentLink = typeof paymentLinks.$inferSelect;
export type InsertPaymentLink = z.infer<typeof insertPaymentLinkSchema>;

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
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    pdfStorageKey: text("pdf_storage_key"),
    printFormat: text("print_format").default("thermal_80mm"),
    status: text("status").default("issued").notNull(), // issued | voided
    approvalStatus: text("approval_status"), // null=instant-applied | pending | approved | rejected
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at"),
    approvalNote: text("approval_note"),
    submitterNote: text("submitter_note"),
    backdatedDate: date("backdated_date"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("pr_org_idx").on(t.organizationId),
    index("pr_branch_idx").on(t.branchId),
    index("pr_intent_idx").on(t.paymentIntentId),
    index("pr_policy_idx").on(t.policyId),
    uniqueIndex("pr_receipt_org_idx").on(t.receiptNumber, t.organizationId),
    index("payment_receipts_policy_status_issued_idx").on(t.policyId, t.status, t.issuedAt),
    index("pr_org_pending_idx").on(t.organizationId).where(sql`${t.approvalStatus} = 'pending'`),
  ]
);

/**
 * Transactional outbox: rows are INSERTed in the same DB transaction as payments,
 * then processed asynchronously so PDF / commission / notifications survive process crashes.
 */
export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").notNull().default({}),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").default("pending").notNull(), // pending | done | failed
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    uniqueIndex("outbox_org_dedupe_idx").on(t.organizationId, t.dedupeKey),
    index("outbox_org_status_created_idx").on(t.organizationId, t.status, t.createdAt),
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

// ─── PREMIUM CHANGE LEDGER (effective-dated upgrades/downgrades/overrides) ───
// Audit + source-of-record for each premium-affecting change. The reconciliation
// amount (delta × periods since the effective date) is posted to the signed
// policy_credit_balances wallet; this row records why and how much.
export const policyPremiumChanges = pgTable(
  "policy_premium_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    oldPremium: numeric("old_premium", { precision: 12, scale: 2 }).notNull(),
    newPremium: numeric("new_premium", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    effectiveDate: date("effective_date").notNull(),
    periods: integer("periods").default(0).notNull(),          // whole billing periods since effectiveDate
    reconciliation: numeric("reconciliation", { precision: 12, scale: 2 }).default("0").notNull(), // signed: + = arrears charged, - = credit
    changeType: text("change_type").notNull(),                 // 'upgrade' | 'downgrade' | 'member_add' | 'member_remove' | 'manual'
    reason: text("reason"),
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("ppc_org_idx").on(t.organizationId),
    index("ppc_policy_idx").on(t.policyId),
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
    currency: text("currency").default("USD").notNull(),
    transactionCount: integer("transaction_count").notNull(),
    /** Expected amounts per payment method: cash, paynow_ecocash, paynow_card, other. */
    amountsByMethod: jsonb("amounts_by_method"),
    /** Status: draft (preparer editing) -> submitted (sent to finance) -> confirmed | discrepancy. */
    status: text("status").default("draft").notNull(),
    isLocked: boolean("is_locked").default(false).notNull(),
    lockedBy: uuid("locked_by").references(() => users.id),
    lockedAt: timestamp("locked_at"),
    preparedBy: uuid("prepared_by")
      .notNull()
      .references(() => users.id),
    notes: text("notes"),
    /** When preparer submitted to finance. */
    submittedAt: timestamp("submitted_at"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    /** When finance confirmed (or accepted with discrepancy). */
    confirmedAt: timestamp("confirmed_at"),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    /** Counted amounts per method (finance entry). */
    countedAmountsByMethod: jsonb("counted_amounts_by_method"),
    countedTotal: numeric("counted_total"),
    discrepancyAmount: numeric("discrepancy_amount"),
    discrepancyNotes: text("discrepancy_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cashups_org_idx").on(t.organizationId)]
);

/** Cashup workflow statuses. */
export const CASHUP_STATUSES = ["draft", "submitted", "confirmed", "discrepancy"] as const;
/** Payment method keys for cashup breakdown (aligned with payment_receipts.paymentChannel where applicable). */
export const CASHUP_PAYMENT_METHODS = ["cash", "paynow_ecocash", "paynow_card", "other"] as const;

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
    /** Hospital cash claims only (server/hospital-cash-claims.ts) — null for death claims. */
    admissionDate: date("admission_date"),
    dischargeDate: date("discharge_date"),
    cashInLieuAmount: numeric("cash_in_lieu_amount"),
    currency: text("currency").default("USD").notNull(),
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
    index("claims_client_idx").on(t.clientId),
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
    // Deceased
    deceasedName: text("deceased_name").notNull(),
    deceasedDob: date("deceased_dob"),
    deceasedGender: text("deceased_gender"),
    deceasedNationalId: text("deceased_national_id"),
    deceasedRelationship: text("deceased_relationship"),  // relationship to the policyholder (claim cases)
    dateOfDeath: date("date_of_death"),
    causeOfDeath: text("cause_of_death"),
    placeOfDeath: text("place_of_death"),
    // Informant (person who reported the death)
    informantName: text("informant_name"),
    informantPhone: text("informant_phone"),
    informantRelationship: text("informant_relationship"),
    // Service
    serviceType: text("service_type"),   // 'cash' | 'claim'
    funeralDate: date("funeral_date"),   // date of burial
    funeralLocation: text("funeral_location"),  // place of burial
    // Body removal logistics
    removalLocation: text("removal_location"),
    removalVehicleId: uuid("removal_vehicle_id").references(() => fleetVehicles.id),
    removalDriverId: uuid("removal_driver_id").references(() => users.id),
    // Burial logistics (can be different vehicle/driver)
    burialVehicleId: uuid("burial_vehicle_id").references(() => fleetVehicles.id),
    burialDriverId: uuid("burial_driver_id").references(() => users.id),
    // Overnighting — some bodies are taken from the mortuary the day before burial to spend the
    // night at the deceased's residence; that leg can use a different vehicle/driver than burial.
    overnightUsed: boolean("overnight_used").default(false).notNull(),
    overnightDate: date("overnight_date"),
    overnightLocation: text("overnight_location"),
    overnightVehicleId: uuid("overnight_vehicle_id").references(() => fleetVehicles.id),
    overnightDriverId: uuid("overnight_driver_id").references(() => users.id),
    // Optional structured link to the cemeteries registry — layered on top of the free-text
    // funeralLocation above (picking a cemetery auto-fills that field but doesn't replace it,
    // so ad-hoc/unregistered burial locations still work).
    cemeteryId: uuid("cemetery_id").references(() => cemeteries.id),
    // Attending agent
    attendingAgentId: uuid("attending_agent_id").references(() => users.id),
    // Service timing
    bodyWashTime: timestamp("body_wash_time"),
    burialDepartureTime: timestamp("burial_departure_time"),
    memorialServiceStart: timestamp("memorial_service_start"),
    memorialServiceEnd: timestamp("memorial_service_end"),
    // Body identification
    bodyIdentifierName: text("body_identifier_name"),
    bodyIdentifierIdNumber: text("body_identifier_id_number"),
    status: text("status").default("open").notNull(),
    assignedTo: uuid("assigned_to").references(() => users.id),
    notes: text("notes"),
    slaDeadline: timestamp("sla_deadline"),
    completedAt: timestamp("completed_at"),
    // Tenant-configurable cross-border flag (see countryFlagSettings) — only
    // rendered/editable when the org has the feature enabled.
    isCrossBorderFlag: boolean("is_cross_border_flag").default(false).notNull(),
    crossBorderReference: text("cross_border_reference"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("fc_org_idx").on(t.organizationId),
    index("fc_claim_idx").on(t.claimId),
    index("fc_policy_idx").on(t.policyId),
    index("fc_status_idx").on(t.status),
    index("fc_assigned_idx").on(t.assignedTo),
    index("fc_org_created_idx").on(t.organizationId, t.createdAt),
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

export const partnerParlours = pgTable("partner_parlours", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  phone: text("phone"),
  contactPerson: text("contact_person"),
  address: text("address"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const parlourPersonnel = pgTable("parlour_personnel", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  parlourId: uuid("parlour_id").notNull().references(() => partnerParlours.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role"),
  phone: text("phone"),
  email: text("email"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("parlour_personnel_parlour_idx").on(t.parlourId)]);

export const insertParlourPersonnelSchema = createInsertSchema(parlourPersonnel).omit({ id: true, createdAt: true });
export type ParlourPersonnel = typeof parlourPersonnel.$inferSelect;
export type InsertParlourPersonnel = typeof parlourPersonnel.$inferInsert;

export const mortuaryIntakes = pgTable(
  "mortuary_intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    intakeNumber: text("intake_number").notNull(),
    serviceScope: text("service_scope").notNull(), // 'full_service' | 'storage_only' | 'removal_only'
    status: text("status").default("in_storage").notNull(), // 'in_storage' | 'dispatched'
    // Deceased
    deceasedName: text("deceased_name").notNull(),
    deceasedGender: text("deceased_gender"),
    deceasedAge: integer("deceased_age"),
    deceasedNationalId: text("deceased_national_id"),
    dateOfDeath: date("date_of_death"),
    causeOfDeath: text("cause_of_death"),
    placeOfDeath: text("place_of_death"),
    // Referring party
    clientOrganizationName: text("client_organization_name"),
    informantName: text("informant_name"),
    informantPhone: text("informant_phone"),
    informantRelationship: text("informant_relationship"),
    // Removal logistics
    removalLocation: text("removal_location"),
    removalDateTime: timestamp("removal_date_time"),
    removalVehicleId: uuid("removal_vehicle_id").references(() => fleetVehicles.id),
    removalDriverId: uuid("removal_driver_id").references(() => users.id),
    // Receipt into mortuary
    receivedByUserId: uuid("received_by_user_id").references(() => users.id),
    receivedAt: timestamp("received_at"),
    receiverAcknowledgedName: text("receiver_acknowledged_name"),
    receiverAcknowledgedIdNumber: text("receiver_acknowledged_id_number"),
    notes: text("notes"),
    // Partner parlour storage receipting
    partnerParlourId: uuid("partner_parlour_id").references(() => partnerParlours.id),
    storageCategory: text("storage_category"), // 'adult' | 'child'
    storageFeeAmount: numeric("storage_fee_amount", { precision: 10, scale: 2 }),
    storageFeeCurrency: text("storage_fee_currency").default("USD"),
    storageFeeStatus: text("storage_fee_status").default("unpaid"), // 'unpaid' | 'paid_at_admission' | 'paid_at_collection'
    storageFeePaidAt: timestamp("storage_fee_paid_at"),
    storageFeePaidBy: text("storage_fee_paid_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("mi_org_idx").on(t.organizationId),
    index("mi_case_idx").on(t.funeralCaseId),
  ]
);

export const mortuaryDispatches = pgTable(
  "mortuary_dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    intakeId: uuid("intake_id").notNull().references(() => mortuaryIntakes.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    dispatchedByUserId: uuid("dispatched_by_user_id").references(() => users.id),
    dispatchedAt: timestamp("dispatched_at"),
    collectedByName: text("collected_by_name"),
    collectedByIdNumber: text("collected_by_id_number"),
    collectedByOrganization: text("collected_by_organization"),
    destination: text("destination"),
    collectorAcknowledgedName: text("collector_acknowledged_name"),
    notes: text("notes"),
    // Chapel & wash bay usage — for partner-parlour cases that use our facilities on dispatch.
    chapelWashBayUsed: boolean("chapel_wash_bay_used").default(false),
    chapelWashBayFeeAmount: numeric("chapel_wash_bay_fee_amount", { precision: 10, scale: 2 }),
    chapelWashBayFeeCurrency: text("chapel_wash_bay_fee_currency").default("USD"),
    chapelWashBayFeeStatus: text("chapel_wash_bay_fee_status").default("unpaid"), // 'unpaid' | 'paid'
    chapelWashBayFeePaidAt: timestamp("chapel_wash_bay_fee_paid_at"),
    chapelWashBayFeePaidBy: text("chapel_wash_bay_fee_paid_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("md_intake_idx").on(t.intakeId)]
);

export const deceasedBelongings = pgTable(
  "deceased_belongings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    intakeId: uuid("intake_id").references(() => mortuaryIntakes.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    itemDescription: text("item_description").notNull(),
    quantity: integer("quantity").default(1),
    submittedByName: text("submitted_by_name"),
    receivedByUserId: uuid("received_by_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("db_intake_idx").on(t.intakeId)]
);

export const bodyWashRequirements = pgTable(
  "body_wash_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    intakeId: uuid("intake_id").notNull().references(() => mortuaryIntakes.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    clothesProvided: boolean("clothes_provided").default(false),
    blanketProvided: boolean("blanket_provided").default(false),
    wreathProvided: boolean("wreath_provided").default(false),
    otherItems: text("other_items"),
    washedByName: text("washed_by_name"),
    completedAt: timestamp("completed_at"),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("bwr_intake_idx").on(t.intakeId)]
);

// Post-mortem out-and-back: a body (ours or a partner parlour's) leaves the
// mortuary for post-mortem examination and later returns. Multiple rows per
// intake are allowed (rare, but a body could go out more than once).
export const mortuaryPostMortemMovements = pgTable(
  "mortuary_post_mortem_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    intakeId: uuid("intake_id").notNull().references(() => mortuaryIntakes.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    takenOutAt: timestamp("taken_out_at").notNull(),
    takenOutByUserId: uuid("taken_out_by_user_id").references(() => users.id),
    takenToLocation: text("taken_to_location"),
    authorizedBy: text("authorized_by"),
    collectedByName: text("collected_by_name"),
    returnedAt: timestamp("returned_at"),
    receivedBackByUserId: uuid("received_back_by_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("pmm_intake_idx").on(t.intakeId)]
);

// Org-scoped rate card for ancillary funeral/mortuary services (body wash, chapel, removal,
// burial, gravesite chairs, tents, PA system, carpets, flowers, pulpit, livestreaming,
// videography, photography, vehicle hire, etc). Two rows per service — one per clientType —
// since a partner-parlour case and a direct (family) client may be charged differently.
export const MORTUARY_SERVICE_CLIENT_TYPES = ["partner_parlour", "direct_client"] as const;
export const MORTUARY_SERVICE_PRICING_TYPES = ["flat", "per_km", "tiered_group"] as const;
export const mortuaryServiceRates = pgTable(
  "mortuary_service_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    serviceKey: text("service_key").notNull(),        // stable slug, e.g. 'body_wash', 'removal'
    name: text("name").notNull(),                     // display label
    clientType: text("client_type").notNull(),         // 'partner_parlour' | 'direct_client'
    category: text("category"),                        // 'mortuary' | 'event_services' | 'transport' (UI grouping)
    pricingType: text("pricing_type").notNull(),        // 'flat' | 'per_km' | 'tiered_group'
    baseAmount: numeric("base_amount", { precision: 10, scale: 2 }).notNull(),
    perKmRate: numeric("per_km_rate", { precision: 10, scale: 4 }),
    tierGroupSize: integer("tier_group_size"),
    tierGroupPrice: numeric("tier_group_price", { precision: 10, scale: 2 }),
    currency: text("currency").default("USD").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("msr_org_idx").on(t.organizationId),
    uniqueIndex("msr_org_key_clienttype_idx").on(t.organizationId, t.serviceKey, t.clientType),
  ]
);

// Actual charges applied to a specific case, computed server-side from mortuaryServiceRates at
// the time they're added. serviceKey/name are snapshotted so a later rate edit or deactivation
// never rewrites a historical charge.
export const caseServiceCharges = pgTable(
  "case_service_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    funeralCaseId: uuid("funeral_case_id").notNull().references(() => funeralCases.id),
    mortuaryIntakeId: uuid("mortuary_intake_id").references(() => mortuaryIntakes.id),
    serviceRateId: uuid("service_rate_id").references(() => mortuaryServiceRates.id),
    serviceKey: text("service_key").notNull(),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).default("1").notNull(),
    distanceKm: numeric("distance_km", { precision: 10, scale: 2 }),
    computedAmount: numeric("computed_amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    status: text("status").default("unpaid").notNull(),  // 'unpaid' | 'paid'
    paidAt: timestamp("paid_at"),
    paidBy: text("paid_by"),
    paidByUserId: uuid("paid_by_user_id").references(() => users.id),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("csc_case_idx").on(t.funeralCaseId)]
);

// ─── Cemeteries (org-scoped registry) ────────────────────────
export const cemeteries = pgTable(
  "cemeteries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cem_org_idx").on(t.organizationId)]
);

// ─── Equipment Items (named, individually-tracked gravesite/event equipment) ──
export const equipmentItems = pgTable(
  "equipment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    name: text("name").notNull(),            // e.g. "Tent #1", "Lowering Device A"
    equipmentType: text("equipment_type").notNull(),  // org-defined free text, e.g. 'tent' | 'lowering_device' | 'coffin_stand'
    status: text("status").default("available").notNull(),  // 'available' | 'in_use'
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("eq_org_idx").on(t.organizationId)]
);

// ─── Pitching Assignments (cross-case cemetery/equipment/staff scheduling) ──
// One row per case+cemetery+date — a vehicle/crew commonly serves multiple cemeteries for
// multiple different cases on the same day, so this is intentionally NOT nested under a single
// funeral case; it's queried/managed by date across all cases (see Pitching Schedule page).
export const pitchingAssignments = pgTable(
  "pitching_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    funeralCaseId: uuid("funeral_case_id").notNull().references(() => funeralCases.id),
    cemeteryId: uuid("cemetery_id").references(() => cemeteries.id),
    assignmentDate: date("assignment_date").notNull(),
    vehicleId: uuid("vehicle_id").references(() => fleetVehicles.id),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("pa_date_idx").on(t.organizationId, t.assignmentDate),
    index("pa_case_idx").on(t.funeralCaseId),
  ]
);

export const pitchingAssignmentStaff = pgTable(
  "pitching_assignment_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pitchingAssignmentId: uuid("pitching_assignment_id").notNull().references(() => pitchingAssignments.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
  },
  (t) => [index("pas_assignment_idx").on(t.pitchingAssignmentId)]
);

export const pitchingAssignmentEquipment = pgTable(
  "pitching_assignment_equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pitchingAssignmentId: uuid("pitching_assignment_id").notNull().references(() => pitchingAssignments.id, { onDelete: "cascade" }),
    equipmentItemId: uuid("equipment_item_id").notNull().references(() => equipmentItems.id),
  },
  (t) => [index("pae_assignment_idx").on(t.pitchingAssignmentId)]
);

// Free-text notes/insights staff attach to a given day's daily report (e.g. operational
// context, management decisions) — surfaced alongside the auto-fetched financial/operations
// data on that report, not derived from any other table.
export const dailyReportNotes = pgTable(
  "daily_report_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    reportDate: date("report_date").notNull(),
    note: text("note").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("drn_org_date_idx").on(t.organizationId, t.reportDate)]
);

// Partner parlours borrowing our vehicles/drivers for their own removals or
// burials — not tied to one of our funeral cases, since it's the other
// parlour's case.
export const partnerParlourVehicleUsage = pgTable(
  "partner_parlour_vehicle_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    partnerParlourId: uuid("partner_parlour_id").notNull().references(() => partnerParlours.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => fleetVehicles.id),
    driverId: uuid("driver_id").references(() => users.id),
    purpose: text("purpose").notNull(), // 'removal' | 'burial'
    deceasedName: text("deceased_name"),
    usageDateTime: timestamp("usage_date_time").notNull(),
    destination: text("destination"),
    returnedAt: timestamp("returned_at"),
    feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }),
    feeCurrency: text("fee_currency").default("USD"),
    feeStatus: text("fee_status").default("unpaid"), // 'unpaid' | 'paid'
    feePaidAt: timestamp("fee_paid_at"),
    feePaidBy: text("fee_paid_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("ppvu_org_idx").on(t.organizationId),
    index("ppvu_parlour_idx").on(t.partnerParlourId),
  ]
);

export const driverChecklists = pgTable(
  "driver_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    funeralCaseId: uuid("funeral_case_id").notNull().references(() => funeralCases.id).unique(),
    driverId: uuid("driver_id").references(() => users.id),
    graveTent: boolean("grave_tent").default(false),
    loweringDevice: boolean("lowering_device").default(false),
    gloves: boolean("gloves").default(false),
    masks: boolean("masks").default(false),
    fuelGauge: text("fuel_gauge"), // 'full' | 'three_quarter' | 'half' | 'quarter'
    tollGateRequired: boolean("toll_gate_required").default(false),
    tollGateAmount: numeric("toll_gate_amount", { precision: 10, scale: 2 }),
    driverAllowance: numeric("driver_allowance", { precision: 10, scale: 2 }),
    burialOrderRef: text("burial_order_ref"),
    preparedByUserId: uuid("prepared_by_user_id").references(() => users.id),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("dc_case_idx").on(t.funeralCaseId)]
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
    speedLimitKmh: integer("speed_limit_kmh").default(120).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("fv_org_idx").on(t.organizationId)]
);

export const driverAssignments = pgTable(
  "driver_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id),
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
  (t) => [
    index("da_vehicle_idx").on(t.vehicleId),
    uniqueIndex("da_one_open_per_vehicle_idx")
      .on(t.vehicleId)
      .where(sql`${t.endDate} is null`),
  ]
);

export const vehicleLocationPings = pgTable(
  "vehicle_location_pings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    assignmentId: uuid("assignment_id").notNull().references(() => driverAssignments.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => fleetVehicles.id),
    driverId: uuid("driver_id").notNull().references(() => users.id),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    speedKmh: numeric("speed_kmh", { precision: 6, scale: 2 }),
    recordedAt: timestamp("recorded_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("vlp_org_idx").on(t.organizationId),
    index("vlp_assignment_recorded_idx").on(t.assignmentId, t.recordedAt),
  ]
);

export const vehicleAlerts = pgTable(
  "vehicle_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    assignmentId: uuid("assignment_id").notNull().references(() => driverAssignments.id),
    vehicleId: uuid("vehicle_id").notNull().references(() => fleetVehicles.id),
    type: text("type").notNull(), // speeding | parked_too_long | no_signal | clocked_out_with_vehicle
    triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
    details: jsonb("details"),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("va_org_idx").on(t.organizationId),
    index("va_assignment_idx").on(t.assignmentId),
  ]
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

export const vehicleTripLogs = pgTable("vehicle_trip_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  vehicleId: uuid("vehicle_id").notNull().references(() => fleetVehicles.id),
  driverId: uuid("driver_id").references(() => users.id),
  funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
  tripDate: date("trip_date").notNull(),
  purpose: text("purpose"),
  startLocation: text("start_location"),
  destination: text("destination"),
  startOdometer: integer("start_odometer"),
  endOdometer: integer("end_odometer"),
  distanceKm: integer("distance_km"),
  timeDeparted: text("time_departed"),
  timeReturned: text("time_returned"),
  fuelUsedLitres: numeric("fuel_used_litres", { precision: 6, scale: 2 }),
  driverNotes: text("driver_notes"),
  authorizedBy: text("authorized_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(t) => [index("vtl_vehicle_idx").on(t.vehicleId), index("vtl_org_idx").on(t.organizationId)]
);

export const insertVehicleTripLogSchema = createInsertSchema(vehicleTripLogs).omit({ id: true, createdAt: true });

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
    // When set, this line represents an *actual* paid cost (from a real requisition) rather
    // than a price-book estimate — used so per-case profit/loss reflects real spend.
    requisitionId: uuid("requisition_id").references(() => requisitions.id),
    description: text("description").notNull(),
    quantity: numeric("quantity").default("1").notNull(),
    unitPrice: numeric("unit_price").notNull(),
    totalPrice: numeric("total_price").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cli_sheet_idx").on(t.costSheetId), index("cli_requisition_idx").on(t.requisitionId)]
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
    index("commission_ledger_org_agent_created_idx").on(t.organizationId, t.agentId, t.createdAt),
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
    sourceServiceReceiptId: uuid("source_service_receipt_id").references(() => serviceReceipts.id),
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
    // Allowances (monthly defaults, prorated when partial month)
    housingAllowance: numeric("housing_allowance"),
    transportAllowance: numeric("transport_allowance"),
    otherAllowances: jsonb("other_allowances"), // [{name: string, amount: string}]
    // Fixed monthly deductions
    funeralPolicyDeduction: numeric("funeral_policy_deduction"),
    otherInsuranceDeduction: numeric("other_insurance_deduction"),
    // Zimbabwe statutory deductions (toggled per employee; amounts entered manually per payslip)
    nssaEnabled: boolean("nssa_enabled").default(false).notNull(),
    payeEnabled: boolean("paye_enabled").default(false).notNull(),
    aidsLevyEnabled: boolean("aids_levy_enabled").default(false).notNull(),
    currency: text("currency").default("USD").notNull(),
    // Employment details
    employmentType: text("employment_type").default("permanent"), // permanent | contract | fixed_term | probation | casual
    contractStartDate: date("contract_start_date"),
    contractEndDate: date("contract_end_date"),
    // Banking details (structured)
    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    bankAccountNumber: text("bank_account_number"),
    bankAccountType: text("bank_account_type"), // savings | current | cheque
    bankBranchCode: text("bank_branch_code"),
    bankSwiftCode: text("bank_swift_code"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("payroll_employees_org_idx").on(t.organizationId)]
);

export const attendanceLogs = pgTable(
  "attendance_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    employeeId: uuid("employee_id").notNull().references(() => payrollEmployees.id),
    date: date("date").notNull(),
    loggedAt: timestamp("logged_at").defaultNow().notNull(),
    notes: text("notes"),
    status: text("status").default("pending").notNull(), // pending | approved | rejected
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at"),
    approvalNotes: text("approval_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // QR clock-in/out (source: 'manual' | 'qr')
    source: text("source").default("manual").notNull(),
    clockInAt: timestamp("clock_in_at"),
    clockOutAt: timestamp("clock_out_at"),
    hoursWorked: numeric("hours_worked", { precision: 5, scale: 2 }),
    clockInLat: numeric("clock_in_lat", { precision: 9, scale: 6 }),
    clockInLng: numeric("clock_in_lng", { precision: 9, scale: 6 }),
    clockOutLat: numeric("clock_out_lat", { precision: 9, scale: 6 }),
    clockOutLng: numeric("clock_out_lng", { precision: 9, scale: 6 }),
    // Geofence: set when a scan lands outside the kiosk's configured radius. Advisory only
    // — never blocks the scan (staff sent off-site for removals/errands are a normal case,
    // not fraud) — a manager can dismiss the flag once reviewed.
    clockInOffSite: boolean("clock_in_off_site").default(false).notNull(),
    clockInDistanceMeters: integer("clock_in_distance_meters"),
    clockOutOffSite: boolean("clock_out_off_site").default(false).notNull(),
    clockOutDistanceMeters: integer("clock_out_distance_meters"),
    offSiteReviewedBy: uuid("off_site_reviewed_by").references(() => users.id),
    offSiteReviewedAt: timestamp("off_site_reviewed_at"),
  },
  (t) => [
    index("al_org_idx").on(t.organizationId),
    index("al_emp_date_idx").on(t.employeeId, t.date),
    index("al_status_idx").on(t.status),
    uniqueIndex("al_emp_date_unique").on(t.employeeId, t.date),
  ]
);

export const attendanceQrCodes = pgTable(
  "attendance_qr_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    label: text("label").notNull(),
    token: text("token").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Geofence centre + radius for this kiosk. Optional — null lat/lng means no geofence
    // is enforced for scans at this kiosk (backward compatible with kiosks created before
    // this feature).
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    geofenceRadiusMeters: integer("geofence_radius_meters").default(500),
  },
  (t) => [
    index("aqc_org_idx").on(t.organizationId),
    uniqueIndex("aqc_token_unique").on(t.token),
  ]
);

export const attendanceScans = pgTable(
  "attendance_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    employeeId: uuid("employee_id").notNull().references(() => payrollEmployees.id),
    qrCodeId: uuid("qr_code_id").references(() => attendanceQrCodes.id),
    eventType: text("event_type").notNull(), // clock_in | clock_out
    scannedAt: timestamp("scanned_at").defaultNow().notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("as_org_idx").on(t.organizationId),
    index("as_emp_scanned_idx").on(t.employeeId, t.scannedAt),
  ]
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
    // Proration
    daysWorked: integer("days_worked"),    // null = full month
    totalDays: integer("total_days"),      // working days in period
    // Earnings breakdown (stored as jsonb for full audit trail)
    earnings: jsonb("earnings"),           // {base, housing, transport, otherAllowances:[{name,amount}], totalGross}
    // Deductions breakdown
    deductionsDetail: jsonb("deductions_detail"), // {funeralPolicy, otherInsurance, nssa, paye, aidsLevy, totalDeductions}
    // Summary columns (computed, kept for reporting queries)
    grossAmount: numeric("gross_amount").notNull(),
    deductions: jsonb("deductions"),       // legacy / backward compat
    netAmount: numeric("net_amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("payslips_run_idx").on(t.payrollRunId),
    index("payslips_emp_run_idx").on(t.employeeId, t.payrollRunId),
  ]
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
    policyId: uuid("policy_id"),
    channel: text("channel").notNull(),
    subject: text("subject"),
    body: text("body"),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    failureReason: text("failure_reason"),
    readAt: timestamp("read_at"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("nl_org_idx").on(t.organizationId),
    index("nl_recipient_idx").on(t.recipientId),
    index("nl_policy_idx").on(t.policyId),
    index("notification_logs_recipient_read_idx").on(t.recipientId, t.readAt),
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
    productInterest: text("product_interest"),
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
    status: text("status").default("pending").notNull(),  // pending | partial | paid
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).default("0").notNull(),
    paidBy: uuid("paid_by").references(() => users.id),
    receivedBy: text("received_by"),
    receivedByUserId: uuid("received_by_user_id").references(() => users.id),
    paymentMethod: text("payment_method"),
    paidDate: date("paid_date"),
    reference: text("reference"),
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

// ─── FX RATES ───────────────────────────────────────────────
// USD-base conversion rates for consolidated financial statements.
// rateToUsd = USD value of 1 unit of `currency` (USD = 1). Consolidated USD = amount * rateToUsd.
export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    currency: text("currency").notNull(),
    rateToUsd: numeric("rate_to_usd", { precision: 18, scale: 8 }).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("fx_org_currency_idx").on(t.organizationId, t.currency)]
);

// ─── REQUISITIONS (expenditure request → approve → pay) ──────
export const REQUISITION_STATUSES = ["draft", "submitted", "approved", "rejected", "partial", "paid"] as const;
export const requisitions = pgTable(
  "requisitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    requisitionNumber: text("requisition_number").notNull(),
    raisedDate: date("raised_date"),                  // user-set date of raising; defaults to createdAt on display
    category: text("category").notNull(),
    description: text("description").notNull(),
    payee: text("payee"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    status: text("status").default("draft").notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at"),
    rejectionReason: text("rejection_reason"),
    paidBy: uuid("paid_by").references(() => users.id),
    paidAt: timestamp("paid_at"),
    paidDate: date("paid_date"),                 // value date used for cash-basis statements
    paymentMethod: text("payment_method"),
    reference: text("reference"),
    receivedBy: text("received_by"),             // free-text recipient name
    receivedByUserId: uuid("received_by_user_id").references(() => users.id),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).default("0").notNull(),
    notes: text("notes"),
    neededByDate: date("needed_by_date"),
    approverNotes: text("approver_notes"),
    department: text("department"), // classification for departmental spend reporting
    costFlag: text("cost_flag"), // e.g. 'CEO_PERSONAL' | 'SOUTH_AFRICA' — special cost-center tagging
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id), // ties the spend to a case for per-case profit/loss
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("req_org_idx").on(t.organizationId),
    index("req_status_idx").on(t.status),
    index("req_case_idx").on(t.funeralCaseId),
    uniqueIndex("req_number_org_idx").on(t.organizationId, t.requisitionNumber),
  ]
);

// ─── FUNERAL QUOTATIONS (cash-service pricing to the family) ──
export const funeralQuotations = pgTable(
  "funeral_quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    // Nullable: standalone quotes exist before a funeral case is created.
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    quotationNumber: text("quotation_number").notNull(),
    currency: text("currency").default("USD").notNull(),
    // Legacy total field kept for backward compat; new code uses grandTotal.
    total: numeric("total", { precision: 12, scale: 2 }).default("0").notNull(),
    status: text("status").default("draft").notNull(), // draft | sent | accepted | converted
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Extended client / deceased capture
    informantFullNames: text("informant_full_names"),
    informantPhone: text("informant_phone"),
    informantAddress: text("informant_address"),
    deceasedName: text("deceased_name"),
    deceasedAge: integer("deceased_age"),
    deceasedSex: text("deceased_sex"),
    casketType: text("casket_type"),
    quotationDate: date("quotation_date"),
    // Financial breakdown
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).default("15"),
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).default("0"),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
    grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).default("0"),
    // Payment terms
    paymentType: text("payment_type"), // 'full' | 'part'
    conversionStatus: text("conversion_status").default("pending"), // 'pending' | 'partial' | 'converted'
    convertedAt: timestamp("converted_at"),
  },
  (t) => [
    index("fq_org_idx").on(t.organizationId),
    // Partial uniqueness (one quote per case) is enforced in the migration via a partial index WHERE funeral_case_id IS NOT NULL.
    uniqueIndex("fq_number_org_idx").on(t.organizationId, t.quotationNumber),
  ]
);

export const quotationGuarantors = pgTable(
  "quotation_guarantors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    quotationId: uuid("quotation_id").notNull().references(() => funeralQuotations.id).unique(),
    guarantorName: text("guarantor_name"),
    guarantorPhone: text("guarantor_phone"),
    guarantorAddress: text("guarantor_address"),
    guarantorIdNumber: text("guarantor_id_number"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("qg_quotation_idx").on(t.quotationId)]
);

export const quotationCollateral = pgTable(
  "quotation_collateral",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    quotationId: uuid("quotation_id").notNull().references(() => funeralQuotations.id),
    itemDescription: text("item_description").notNull(),
    condition: text("condition"), // 'good' | 'fair' | 'poor'
    value: numeric("value", { precision: 12, scale: 2 }),
    dueDate: date("due_date"),
    forfeitureDate: date("forfeiture_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("qc_quotation_idx").on(t.quotationId)]
);

export const funeralQuotationItems = pgTable(
  "funeral_quotation_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quotationId: uuid("quotation_id").notNull().references(() => funeralQuotations.id),
    priceBookItemId: uuid("price_book_item_id").references(() => priceBookItems.id),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).default("1").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [index("fqi_quotation_idx").on(t.quotationId)]
);

// ─── SERVICE RECEIPTS (cash-service income, not tied to a policy) ──
export const serviceReceipts = pgTable(
  "service_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    funeralCaseId: uuid("funeral_case_id").references(() => funeralCases.id),
    quotationId: uuid("quotation_id").references(() => funeralQuotations.id),
    receiptNumber: text("receipt_number").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    paymentChannel: text("payment_channel").notNull(), // cash | paynow_ecocash | paynow_card | other
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    status: text("status").default("issued").notNull(),  // issued | voided
    idempotencyKey: text("idempotency_key"),             // optional client key to dedupe double-submits
    notes: text("notes"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("sr_org_idx").on(t.organizationId),
    index("sr_case_idx").on(t.funeralCaseId),
    index("sr_quot_idx").on(t.quotationId),
    uniqueIndex("sr_receipt_org_idx").on(t.organizationId, t.receiptNumber),
    uniqueIndex("sr_idempotency_org_idx").on(t.organizationId, t.idempotencyKey),
  ]
);

export const insertFxRateSchema = createInsertSchema(fxRates).omit({ id: true, updatedAt: true });
export type FxRate = typeof fxRates.$inferSelect;
export type InsertFxRate = z.infer<typeof insertFxRateSchema>;

export const insertRequisitionSchema = createInsertSchema(requisitions).omit({ id: true, createdAt: true });
export type Requisition = typeof requisitions.$inferSelect;
export type InsertRequisition = z.infer<typeof insertRequisitionSchema>;

// ─── REQUISITION LINE ITEMS ────────────────────────────────
export const requisitionItems = pgTable(
  "requisition_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requisitionId: uuid("requisition_id").notNull().references(() => requisitions.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    description: text("description").notNull(),
    category: text("category").notNull(),
    qty: numeric("qty", { precision: 10, scale: 2 }).default("1").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [index("req_item_req_idx").on(t.requisitionId)]
);

export const insertRequisitionItemSchema = createInsertSchema(requisitionItems).omit({ id: true });
export type RequisitionItem = typeof requisitionItems.$inferSelect;
export type InsertRequisitionItem = z.infer<typeof insertRequisitionItemSchema>;

// ─── PAYMENT DISBURSEMENTS ────────────────────────────────
// One row per cash-out event — covers requisition AND expenditure partial payments.
// entityType: 'requisition' | 'expenditure'
export const paymentDisbursements = pgTable(
  "payment_disbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    entityType: text("entity_type").notNull(),          // 'requisition' | 'expenditure'
    entityId: uuid("entity_id").notNull(),              // FK to requisitions.id or expenditures.id
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    paidByUserId: uuid("paid_by_user_id").references(() => users.id),  // staff who made payment
    receivedBy: text("received_by"),                   // free-text (supplier, staff, vendor)
    receivedByUserId: uuid("received_by_user_id").references(() => users.id),  // optional system user
    paidDate: date("paid_date").notNull(),              // cash-basis value date → hits P&L on this date
    paymentMethod: text("payment_method").default("cash").notNull(),  // cash|bank_transfer|cheque|mobile_money
    reference: text("reference"),
    notes: text("notes"),
    // Cross-currency payout support: `currency`/`amount` above are always the cash that actually
    // left the till (what P&L should count). When that differs from the requisition/expenditure's
    // own currency (e.g. a USD requisition settled with Rand cash on hand), `entityAmount` holds
    // the amount in the entity's own currency this payment settles (drives amountPaid tracking)
    // and `fxRateApplied` records the rate used (units of `currency` per 1 unit of entity currency),
    // for audit/voucher display. Both null when paid in the entity's own currency (the common case).
    entityAmount: numeric("entity_amount", { precision: 12, scale: 2 }),
    fxRateApplied: numeric("fx_rate_applied", { precision: 18, scale: 8 }),
    voucherNumber: text("voucher_number"),            // PV-00001 — set on creation
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("disb_org_idx").on(t.organizationId),
    index("disb_entity_idx").on(t.entityType, t.entityId),
    index("disb_date_idx").on(t.paidDate),
  ]
);

export const insertPaymentDisbursementSchema = createInsertSchema(paymentDisbursements).omit({ id: true, createdAt: true });

// ─── BANK ACCOUNTS ────────────────────────────────────────
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    accountName: text("account_name").notNull(),       // e.g. "FBC Main Account"
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    currency: text("currency").default("USD").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ba_org_idx").on(t.organizationId)]
);

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true, createdAt: true });
export type BankAccount = typeof bankAccounts.$inferSelect;
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;

// ─── SAFES ─────────────────────────────────────────────────
// Physical cash safes — an alternative destination to a bank account. Collected cash doesn't
// always make it to the bank; sometimes it's secured in a safe instead, which should still count
// as "accounted for" (reduces admin cash-on-hand) even though it never left the premises.
export const safes = pgTable(
  "safes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    name: text("name").notNull(),          // e.g. "Head Office Safe"
    currency: text("currency").default("USD").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("safe_org_idx").on(t.organizationId)]
);

export const insertSafeSchema = createInsertSchema(safes).omit({ id: true, createdAt: true });
export type Safe = typeof safes.$inferSelect;
export type InsertSafe = z.infer<typeof insertSafeSchema>;

// ─── BANK DEPOSITS ────────────────────────────────────────
// Records when an admin physically banks collected cash — or, since cash doesn't always make
// it to the bank, moves it into a safe instead (`safeId`, mutually exclusive with `bankAccountId`).
// Either destination equally reduces the admin's cash-on-hand in getAdminCashPosition().
export const bankDeposits = pgTable(
  "bank_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
    safeId: uuid("safe_id").references(() => safes.id),
    depositedByUserId: uuid("deposited_by_user_id").notNull().references(() => users.id),  // admin who banked
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),              // manager who confirmed slip
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    depositDate: date("deposit_date").notNull(),
    reference: text("reference"),          // deposit slip number / EFT ref
    notes: text("notes"),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("bd_org_idx").on(t.organizationId),
    index("bd_user_idx").on(t.depositedByUserId),
    index("bd_date_idx").on(t.depositDate),
  ]
);

export const insertBankDepositSchema = createInsertSchema(bankDeposits).omit({ id: true, createdAt: true });
export type BankDeposit = typeof bankDeposits.$inferSelect;
export type InsertBankDeposit = z.infer<typeof insertBankDepositSchema>;

// ─── BANK STATEMENT BALANCES ──────────────────────────────
// Manual closing-balance entry from the actual bank statement.
export const bankStatementBalances = pgTable(
  "bank_statement_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
    statementDate: date("statement_date").notNull(),
    closingBalance: numeric("closing_balance", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    enteredByUserId: uuid("entered_by_user_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("bsb_org_idx").on(t.organizationId), index("bsb_account_idx").on(t.bankAccountId)]
);

export const insertBankStatementBalanceSchema = createInsertSchema(bankStatementBalances).omit({ id: true, createdAt: true });
export type BankStatementBalance = typeof bankStatementBalances.$inferSelect;
export type InsertBankStatementBalance = z.infer<typeof insertBankStatementBalanceSchema>;
export type PaymentDisbursement = typeof paymentDisbursements.$inferSelect;
export type InsertPaymentDisbursement = z.infer<typeof insertPaymentDisbursementSchema>;

// ─── BALANCE SHEET MANUAL ENTRIES ─────────────────────────────────────────
// Holds non-derived items: fixed assets, loans, capital contributions, etc.
export const balanceSheetEntries = pgTable(
  "balance_sheet_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    /** 'asset' | 'liability' | 'equity' */
    section: text("section").notNull(),
    /** 'current' | 'non_current' — equity entries leave this null */
    subsection: text("subsection"),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    /** Date this entry is effective as at (for point-in-time balance sheets). */
    asOfDate: date("as_of_date").notNull(),
    notes: text("notes"),
    enteredByUserId: uuid("entered_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("bse_org_idx").on(t.organizationId),
    index("bse_section_idx").on(t.organizationId, t.section),
    index("bse_date_idx").on(t.asOfDate),
  ]
);

export const insertBalanceSheetEntrySchema = createInsertSchema(balanceSheetEntries).omit({ id: true, createdAt: true, updatedAt: true });
export type BalanceSheetEntry = typeof balanceSheetEntries.$inferSelect;
export type InsertBalanceSheetEntry = z.infer<typeof insertBalanceSheetEntrySchema>;

// ── Debit Orders: recurring bank-debit mandates for premium collection ──
export const DEBIT_ORDER_STATUSES = ["active", "paused", "cancelled"] as const;
export const DEBIT_ORDER_FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly"] as const;

export const debitOrders = pgTable(
  "debit_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    clientId: uuid("client_id").references(() => clients.id),
    policyId: uuid("policy_id").references(() => policies.id),
    mandateReference: text("mandate_reference").notNull(),
    accountName: text("account_name").notNull(),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    branchCode: text("branch_code"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").default("USD").notNull(),
    frequency: text("frequency").default("monthly").notNull(),
    dayOfMonth: integer("day_of_month"),
    startDate: date("start_date"),
    nextRunDate: date("next_run_date"),
    status: text("status").default("active").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("debit_order_org_idx").on(t.organizationId),
    index("debit_order_status_idx").on(t.status),
    index("debit_order_policy_idx").on(t.policyId),
    uniqueIndex("debit_order_ref_org_idx").on(t.organizationId, t.mandateReference),
  ]
);

export const insertDebitOrderSchema = createInsertSchema(debitOrders).omit({ id: true, createdAt: true });
export type DebitOrder = typeof debitOrders.$inferSelect;
export type InsertDebitOrder = z.infer<typeof insertDebitOrderSchema>;

export const insertFuneralQuotationSchema = createInsertSchema(funeralQuotations).omit({ id: true, createdAt: true });
export type FuneralQuotation = typeof funeralQuotations.$inferSelect;
export type InsertFuneralQuotation = z.infer<typeof insertFuneralQuotationSchema>;

export const insertFuneralQuotationItemSchema = createInsertSchema(funeralQuotationItems).omit({ id: true });
export type FuneralQuotationItem = typeof funeralQuotationItems.$inferSelect;
export type InsertFuneralQuotationItem = z.infer<typeof insertFuneralQuotationItemSchema>;

export const insertQuotationGuarantorSchema = createInsertSchema(quotationGuarantors).omit({ id: true, createdAt: true });
export type QuotationGuarantor = typeof quotationGuarantors.$inferSelect;
export type InsertQuotationGuarantor = z.infer<typeof insertQuotationGuarantorSchema>;

export const insertQuotationCollateralSchema = createInsertSchema(quotationCollateral).omit({ id: true, createdAt: true });
export type QuotationCollateralItem = typeof quotationCollateral.$inferSelect;
export type InsertQuotationCollateralItem = z.infer<typeof insertQuotationCollateralSchema>;

export const insertServiceReceiptSchema = createInsertSchema(serviceReceipts).omit({ id: true, createdAt: true });
export type ServiceReceipt = typeof serviceReceipts.$inferSelect;
export type InsertServiceReceipt = z.infer<typeof insertServiceReceiptSchema>;

// ─── INSERT SCHEMAS ─────────────────────────────────────────

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertBranchSchema = createInsertSchema(branches).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true });
export const insertClientDocumentSchema = createInsertSchema(clientDocuments).omit({ id: true, createdAt: true });
export const insertPolicyDocumentSchema = createInsertSchema(policyDocuments).omit({ id: true, createdAt: true });
export const insertWaiverSchema = createInsertSchema(waitingPeriodWaivers).omit({ id: true, createdAt: true });
export const insertDependentSchema = createInsertSchema(dependents).omit({ id: true, createdAt: true });
export const insertClientPaymentMethodSchema = createInsertSchema(clientPaymentMethods).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaymentAutomationSettingsSchema = createInsertSchema(paymentAutomationSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaymentAutomationRunSchema = createInsertSchema(paymentAutomationRuns).omit({ id: true, createdAt: true });
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
export const insertOutboxMessageSchema = createInsertSchema(outboxMessages).omit({
  id: true,
  createdAt: true,
  processedAt: true,
  attempts: true,
  lastError: true,
});
export const insertPolicyCreditBalanceSchema = createInsertSchema(policyCreditBalances).omit({ id: true });
export const insertPolicyPremiumChangeSchema = createInsertSchema(policyPremiumChanges).omit({ id: true, createdAt: true });
export const insertCreditNoteSchema = createInsertSchema(creditNotes).omit({ id: true, createdAt: true });
export const insertMonthEndRunSchema = createInsertSchema(monthEndRuns).omit({ id: true, createdAt: true });
export const insertClaimSchema = createInsertSchema(claims).omit({ id: true, createdAt: true });
export const insertClaimDocumentSchema = createInsertSchema(claimDocuments).omit({ id: true, uploadedAt: true });
export const insertFuneralCaseSchema = createInsertSchema(funeralCases).omit({ id: true, createdAt: true });
export const insertFuneralTaskSchema = createInsertSchema(funeralTasks).omit({ id: true, createdAt: true });
export const insertPartnerParlourSchema = createInsertSchema(partnerParlours).omit({ id: true, createdAt: true });
export const insertMortuaryIntakeSchema = createInsertSchema(mortuaryIntakes).omit({ id: true, createdAt: true });
export const insertMortuaryDispatchSchema = createInsertSchema(mortuaryDispatches).omit({ id: true, createdAt: true });
export const insertMortuaryServiceRateSchema = createInsertSchema(mortuaryServiceRates).omit({ id: true, createdAt: true });
export type MortuaryServiceRate = typeof mortuaryServiceRates.$inferSelect;
export type InsertMortuaryServiceRate = z.infer<typeof insertMortuaryServiceRateSchema>;
export const insertCaseServiceChargeSchema = createInsertSchema(caseServiceCharges).omit({ id: true, createdAt: true });
export type CaseServiceCharge = typeof caseServiceCharges.$inferSelect;
export type InsertCaseServiceCharge = z.infer<typeof insertCaseServiceChargeSchema>;
export const insertCemeterySchema = createInsertSchema(cemeteries).omit({ id: true, createdAt: true });
export type Cemetery = typeof cemeteries.$inferSelect;
export type InsertCemetery = z.infer<typeof insertCemeterySchema>;
export const insertEquipmentItemSchema = createInsertSchema(equipmentItems).omit({ id: true, createdAt: true });
export type EquipmentItem = typeof equipmentItems.$inferSelect;
export type InsertEquipmentItem = z.infer<typeof insertEquipmentItemSchema>;
export const insertPitchingAssignmentSchema = createInsertSchema(pitchingAssignments).omit({ id: true, createdAt: true });
export type PitchingAssignment = typeof pitchingAssignments.$inferSelect;
export type InsertPitchingAssignment = z.infer<typeof insertPitchingAssignmentSchema>;
export const insertDeceasedBelongingSchema = createInsertSchema(deceasedBelongings).omit({ id: true, createdAt: true });
export const insertBodyWashRequirementSchema = createInsertSchema(bodyWashRequirements).omit({ id: true, createdAt: true });
export const insertMortuaryPostMortemMovementSchema = createInsertSchema(mortuaryPostMortemMovements).omit({ id: true, createdAt: true });
export const insertDailyReportNoteSchema = createInsertSchema(dailyReportNotes).omit({ id: true, createdAt: true });
export const insertPartnerParlourVehicleUsageSchema = createInsertSchema(partnerParlourVehicleUsage).omit({ id: true, createdAt: true });
export const insertDriverChecklistSchema = createInsertSchema(driverChecklists).omit({ id: true, createdAt: true });
export const insertFleetVehicleSchema = createInsertSchema(fleetVehicles).omit({ id: true, createdAt: true });
export const insertCommissionPlanSchema = createInsertSchema(commissionPlans).omit({ id: true, createdAt: true });
export const insertCommissionLedgerEntrySchema = createInsertSchema(commissionLedgerEntries).omit({ id: true, createdAt: true });
export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({ id: true, createdAt: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export const insertClientFeedbackSchema = createInsertSchema(clientFeedback).omit({ id: true, createdAt: true, updatedAt: true });
export const insertExpenditureSchema = createInsertSchema(expenditures).omit({ id: true, createdAt: true });
export const insertPriceBookItemSchema = createInsertSchema(priceBookItems).omit({ id: true, createdAt: true });
export const insertApprovalRequestSchema = createInsertSchema(approvalRequests).omit({ id: true, createdAt: true });
export const insertAttendanceLogSchema = createInsertSchema(attendanceLogs).omit({ id: true, createdAt: true, loggedAt: true });
export const insertAttendanceQrCodeSchema = createInsertSchema(attendanceQrCodes).omit({ id: true, createdAt: true });
export const insertAttendanceScanSchema = createInsertSchema(attendanceScans).omit({ id: true, createdAt: true });
export const insertDriverAssignmentSchema = createInsertSchema(driverAssignments).omit({ id: true });
export const insertVehicleLocationPingSchema = createInsertSchema(vehicleLocationPings).omit({ id: true, createdAt: true });
export const insertVehicleAlertSchema = createInsertSchema(vehicleAlerts).omit({ id: true });
export const insertPayrollEmployeeSchema = createInsertSchema(payrollEmployees).omit({ id: true, createdAt: true });
export const insertPayrollRunSchema = createInsertSchema(payrollRuns).omit({ id: true, createdAt: true });
export const insertPayslipSchema = createInsertSchema(payslips).omit({ id: true, createdAt: true });
export const insertCashupSchema = createInsertSchema(cashups).omit({ id: true, createdAt: true });

// ─── RECEIPT ADVERTS ────────────────────────────────────────

export const receiptAdverts = pgTable(
  "receipt_adverts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    title: text("title"),
    body: text("body"),
    imageUrl: text("image_url"),
    isActive: boolean("is_active").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ra_org_idx").on(t.organizationId)]
);

export const insertReceiptAdvertSchema = createInsertSchema(receiptAdverts).omit({ id: true, createdAt: true });
export type ReceiptAdvert = typeof receiptAdverts.$inferSelect;
export type InsertReceiptAdvert = z.infer<typeof insertReceiptAdvertSchema>;

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
export type ClientDocument = typeof clientDocuments.$inferSelect;
export type InsertClientDocument = z.infer<typeof insertClientDocumentSchema>;
export type PolicyDocument = typeof policyDocuments.$inferSelect;
export type InsertPolicyDocument = z.infer<typeof insertPolicyDocumentSchema>;
export type WaitingPeriodWaiver = typeof waitingPeriodWaivers.$inferSelect;
export type InsertWaiver = z.infer<typeof insertWaiverSchema>;
export type Dependent = typeof dependents.$inferSelect;
export type InsertDependent = z.infer<typeof insertDependentSchema>;
export type ClientPaymentMethod = typeof clientPaymentMethods.$inferSelect;
export type InsertClientPaymentMethod = z.infer<typeof insertClientPaymentMethodSchema>;
export type PaymentAutomationSettings = typeof paymentAutomationSettings.$inferSelect;
export type InsertPaymentAutomationSettings = z.infer<typeof insertPaymentAutomationSettingsSchema>;
export type PaymentAutomationRun = typeof paymentAutomationRuns.$inferSelect;
export type InsertPaymentAutomationRun = z.infer<typeof insertPaymentAutomationRunSchema>;
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
export type OutboxMessage = typeof outboxMessages.$inferSelect;
export type InsertOutboxMessage = z.infer<typeof insertOutboxMessageSchema>;
export type PolicyCreditBalance = typeof policyCreditBalances.$inferSelect;
export type InsertPolicyCreditBalance = z.infer<typeof insertPolicyCreditBalanceSchema>;
export type PolicyPremiumChange = typeof policyPremiumChanges.$inferSelect;
export type InsertPolicyPremiumChange = z.infer<typeof insertPolicyPremiumChangeSchema>;
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
export type PartnerParlour = typeof partnerParlours.$inferSelect;
export type InsertPartnerParlour = z.infer<typeof insertPartnerParlourSchema>;
export type MortuaryIntake = typeof mortuaryIntakes.$inferSelect;
export type InsertMortuaryIntake = z.infer<typeof insertMortuaryIntakeSchema>;
export type MortuaryDispatch = typeof mortuaryDispatches.$inferSelect;
export type InsertMortuaryDispatch = z.infer<typeof insertMortuaryDispatchSchema>;
export type DeceasedBelonging = typeof deceasedBelongings.$inferSelect;
export type InsertDeceasedBelonging = z.infer<typeof insertDeceasedBelongingSchema>;
export type BodyWashRequirement = typeof bodyWashRequirements.$inferSelect;
export type InsertBodyWashRequirement = z.infer<typeof insertBodyWashRequirementSchema>;
export type MortuaryPostMortemMovement = typeof mortuaryPostMortemMovements.$inferSelect;
export type DailyReportNote = typeof dailyReportNotes.$inferSelect;
export type InsertDailyReportNote = typeof dailyReportNotes.$inferInsert;
export type InsertMortuaryPostMortemMovement = z.infer<typeof insertMortuaryPostMortemMovementSchema>;
export type PartnerParlourVehicleUsage = typeof partnerParlourVehicleUsage.$inferSelect;
export type InsertPartnerParlourVehicleUsage = z.infer<typeof insertPartnerParlourVehicleUsageSchema>;
export type DriverChecklist = typeof driverChecklists.$inferSelect;
export type InsertDriverChecklist = z.infer<typeof insertDriverChecklistSchema>;
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
export type AttendanceLog = typeof attendanceLogs.$inferSelect;
export type InsertAttendanceLog = z.infer<typeof insertAttendanceLogSchema>;
export type AttendanceQrCode = typeof attendanceQrCodes.$inferSelect;
export type InsertAttendanceQrCode = z.infer<typeof insertAttendanceQrCodeSchema>;
export type AttendanceScan = typeof attendanceScans.$inferSelect;
export type InsertAttendanceScan = z.infer<typeof insertAttendanceScanSchema>;
export type DriverAssignment = typeof driverAssignments.$inferSelect;
export type InsertDriverAssignment = z.infer<typeof insertDriverAssignmentSchema>;
export type VehicleLocationPing = typeof vehicleLocationPings.$inferSelect;
export type InsertVehicleLocationPing = z.infer<typeof insertVehicleLocationPingSchema>;
export type VehicleAlert = typeof vehicleAlerts.$inferSelect;
export type InsertVehicleAlert = z.infer<typeof insertVehicleAlertSchema>;
export type PayrollEmployee = typeof payrollEmployees.$inferSelect;
export type InsertPayrollEmployee = z.infer<typeof insertPayrollEmployeeSchema>;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type Payslip = typeof payslips.$inferSelect;
export type InsertPayslip = z.infer<typeof insertPayslipSchema>;
export type Cashup = typeof cashups.$inferSelect;
export type InsertCashup = z.infer<typeof insertCashupSchema>;
export type VehicleTripLog = typeof vehicleTripLogs.$inferSelect;
export type InsertVehicleTripLog = z.infer<typeof insertVehicleTripLogSchema>;

// ─── POLICY STATUS ENUM ────────────────────────────────────

export const POLICY_STATUSES = ["inactive", "active", "grace", "lapsed", "cancelled"] as const;
export type PolicyStatus = typeof POLICY_STATUSES[number];

export const VALID_POLICY_TRANSITIONS: Record<string, string[]> = {
  inactive: ["active", "cancelled"],
  active: ["grace", "cancelled"],
  grace: ["active", "lapsed", "cancelled"],
  lapsed: ["active", "cancelled"],
  cancelled: [],
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
    companyName: text("company_name"),
    hrManagerName: text("hr_manager_name"),
    hrManagerPhone: text("hr_manager_phone"),
    hrManagerEmail: text("hr_manager_email"),
    contactPersonName: text("contact_person_name"),
    contactPersonPhone: text("contact_person_phone"),
    contactPersonEmail: text("contact_person_email"),
    capacity: integer("capacity"),
    isActive: boolean("is_active").default(true).notNull(),
    isLegacy: boolean("is_legacy").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("groups_org_idx").on(t.organizationId)]
);

export const insertGroupSchema = createInsertSchema(groups).omit({ id: true, createdAt: true });
export type Group = typeof groups.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;

// ─── REMINDERS ─────────────────────────────────────────────
// Personal per-user reminders, persisted server-side.

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: text("due_date"),
    priority: text("priority").default("medium"),
    isCompleted: boolean("is_completed").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("reminders_org_idx").on(t.organizationId),
    index("reminders_user_idx").on(t.userId),
  ]
);

export const insertReminderSchema = createInsertSchema(reminders).omit({ id: true, createdAt: true, updatedAt: true });
export type Reminder = typeof reminders.$inferSelect;
export type InsertReminder = z.infer<typeof insertReminderSchema>;

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
    // Amount always in the receivable's own currency (how much of it this allocation covers).
    // When the settlement's currency differs from the receivable's, fxRateApplied records the
    // rate used (units of settlement currency per 1 unit of receivable currency) for audit —
    // null when both are the same currency (the common case, no conversion needed).
    amount: numeric("amount").notNull(),
    fxRateApplied: numeric("fx_rate_applied", { precision: 18, scale: 8 }),
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

// ─── APP DOWNLOAD INTEREST REGISTRATIONS ──────────────────────
// Platform-level (not org-scoped): captures name + email of people who
// click the App Store / Play Store badges on the login screen.

export const appDownloadInterests = pgTable(
  "app_download_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    platform: text("platform").notNull(), // 'ios' | 'android'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("app_dl_created_idx").on(t.createdAt)]
);

export const insertAppDownloadInterestSchema = createInsertSchema(appDownloadInterests).omit({ id: true, createdAt: true });
export type AppDownloadInterest = typeof appDownloadInterests.$inferSelect;
export type InsertAppDownloadInterest = z.infer<typeof insertAppDownloadInterestSchema>;

// ─── USER (STAFF/AGENT) NOTIFICATIONS ─────────────────────
// Separate from notification_logs (which is client-only) so the field
// shapes don't collide. The agent-app NotificationsScreen reads from here.

export const userNotifications = pgTable(
  "user_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    /** Notification category — drives icon/colour in the app UI. */
    type: text("type").notNull(), // TRIP_ASSIGNED | CLAIM_SUBMITTED | CLAIM_STATUS | APPROVAL_NEEDED | APPROVAL_RESOLVED | PAYMENT_RECEIVED | COMMISSION_EARNED | POLICY_ISSUED | ATTENDANCE_RESOLVED | GENERAL
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Arbitrary JSON payload — entity IDs, deep-link targets, etc. */
    metadata: jsonb("metadata"),
    isRead: boolean("is_read").default(false).notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("un_org_idx").on(t.organizationId),
    index("un_recipient_idx").on(t.recipientId),
    index("un_read_idx").on(t.recipientId, t.isRead),
    index("un_created_idx").on(t.createdAt),
  ]
);

export const insertUserNotificationSchema = createInsertSchema(userNotifications).omit({ id: true, createdAt: true });
export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = z.infer<typeof insertUserNotificationSchema>;

// ─── USER (STAFF/AGENT) DEVICE TOKENS ─────────────────────
// Stores Expo push tokens for staff/agent users. Mirrors client_device_tokens
// but references users.id instead of clients.id.

export const userDeviceTokens = pgTable(
  "user_device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull(),
    platform: text("platform").notNull(), // ios | android | web
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("udt_org_idx").on(t.organizationId),
    index("udt_user_idx").on(t.userId),
    uniqueIndex("udt_token_unique").on(t.token),
  ]
);

export const insertUserDeviceTokenSchema = createInsertSchema(userDeviceTokens).omit({ id: true, createdAt: true, updatedAt: true });
export type UserDeviceToken = typeof userDeviceTokens.$inferSelect;
export type InsertUserDeviceToken = z.infer<typeof insertUserDeviceTokenSchema>;

// ─── APP RELEASES ──────────────────────────────────────────────
// Platform-level: tracks each APK release, minimum supported version,
// and download URL. Used for in-app version enforcement and OTA checks.

export const appReleases = pgTable(
  "app_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull(),              // e.g. "1.2.0"
    buildNumber: integer("build_number").notNull(),  // EAS auto-incremented versionCode
    minVersion: text("min_version").notNull().default("1.0.0"),
    minBuildNumber: integer("min_build_number").notNull().default(1),
    downloadUrl: text("download_url").notNull(),
    releaseNotes: text("release_notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("app_releases_active_idx").on(t.isActive, t.createdAt),
  ]
);

export const insertAppReleaseSchema = createInsertSchema(appReleases).omit({ id: true, createdAt: true });
export type AppRelease = typeof appReleases.$inferSelect;
export type InsertAppRelease = z.infer<typeof insertAppReleaseSchema>;

// ─── DIRECTORY CONTACTS ────────────────────────────────────────
// Shared contact directory: undertakers, underwriters, transport companies,
// general contacts. Differentiated by `type` field.

export const directoryContacts = pgTable(
  "directory_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    type: text("type").notNull(), // "undertaker" | "underwriter" | "transport_company" | "contact" | "emergency" | "supplier"
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    phone: text("phone"),
    altPhone: text("alt_phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("directory_contacts_org_type_idx").on(t.organizationId, t.type),
    index("directory_contacts_org_idx").on(t.organizationId),
  ]
);

export const insertDirectoryContactSchema = createInsertSchema(directoryContacts).omit({ id: true, createdAt: true });
export type DirectoryContact = typeof directoryContacts.$inferSelect;
export type InsertDirectoryContact = z.infer<typeof insertDirectoryContactSchema>;
