/**
 * Control plane schema — lives in pol263-control-plane (DigitalOcean).
 *
 * This database stores ONLY tenant metadata: who tenants are, how to reach
 * their data, and how they are configured. It never stores policy/client/payment
 * data — that belongs in tenant databases.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── TENANT REGISTRY ──────────────────────────────────────────────────────────

/**
 * One row per tenant (organization). This is the authoritative tenant list.
 * Mirrors/replaces the organizations table in the shared DB for routing purposes.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-readable name, e.g. "Acme Insurance" */
    name: text("name").notNull(),
    /** URL-safe identifier, e.g. "acme-insurance". Used for subdomain routing. */
    slug: text("slug").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    /** active | suspended | trial | expired */
    licenseStatus: text("license_status").default("active").notNull(),
    /** provisioning | ready | migrating | suspended */
    provisioningState: text("provisioning_state").default("ready").notNull(),
    /**
     * Whether this tenant's default subdomain ({slug}.pol263.com) has been added to
     * DigitalOcean App Platform's Domains list — required before DO will route traffic
     * or issue a cert for it. Defaults true (safe for all existing, already-working
     * tenants); provisionTenantCore explicitly sets this false for newly created ones.
     */
    domainCommissioned: boolean("domain_commissioned").default(true).notNull(),
    domainCommissionedAt: timestamp("domain_commissioned_at"),
    /** Set when automated commissioning (server/do-app-domains.ts) fails — either the DNS
     *  record couldn't be created/verified, or the DigitalOcean App Platform domain-list update
     *  failed. Cleared on the next successful attempt. Surfaced on the platform dashboard's
     *  "Pending domain commissioning" list instead of leaving a stuck tenant with no visible
     *  reason (see docs/BUGFIX-LOG.md, 2026-08-04 domain automation entry). */
    domainCommissionError: text("domain_commission_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    suspendedAt: timestamp("suspended_at"),
    suspendReason: text("suspend_reason"),
  },
  (t) => [uniqueIndex("tenants_slug_idx").on(t.slug)]
);

// ─── DOMAIN ROUTING ───────────────────────────────────────────────────────────

/**
 * Maps domains/subdomains to tenants.
 * e.g. "acme.pol263.app" → tenant "acme", or "portal.acme.co.zw" → tenant "acme"
 */
export const tenantDomains = pgTable(
  "tenant_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Full domain or subdomain, e.g. "acme.pol263.app" */
    domain: text("domain").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    isVerified: boolean("is_verified").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("tenant_domains_domain_idx").on(t.domain),
    index("tenant_domains_tenant_idx").on(t.tenantId),
  ]
);

/**
 * Per-tenant email domain state (Resend). One row per tenant that has opted into the
 * "email_inbound" module — subdomain, the Resend domain resource id, and verification/
 * receiving status. No secrets here (the Resend API key is a single global env var, not
 * per-tenant) — this is routing/status data only, same spirit as tenantDomains above.
 */
export const tenantEmailDomains = pgTable(
  "tenant_email_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** e.g. "falakhe.pol263.com" */
    subdomain: text("subdomain").notNull(),
    resendDomainId: text("resend_domain_id").notNull(),
    fromAddress: text("from_address"),
    sendingVerified: boolean("sending_verified").default(false).notNull(),
    receivingEnabled: boolean("receiving_enabled").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("tenant_email_domains_tenant_idx").on(t.tenantId),
    uniqueIndex("tenant_email_domains_subdomain_idx").on(t.subdomain),
  ]
);

// ─── DATABASE ROUTING ─────────────────────────────────────────────────────────

/**
 * Per-tenant database configuration.
 * databaseUrl = null  →  tenant uses the shared pol263 database (DEFAULT).
 * databaseUrl = set   →  tenant has an isolated database on DigitalOcean.
 */
export const tenantDatabases = pgTable("tenant_databases", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** Pooler URL for app connections. null = use shared pol263 DB. */
  databaseUrl: text("database_url"),
  /** Direct URL for migration scripts. null = use shared DATABASE_DIRECT_URL. */
  databaseDirectUrl: text("database_direct_url"),
  /** current | pending | running | failed */
  migrationState: text("migration_state").default("current").notNull(),
  lastMigratedAt: timestamp("last_migrated_at"),
  schemaVersion: text("schema_version"),
});

// ─── STORAGE ROUTING ──────────────────────────────────────────────────────────

/**
 * Per-tenant storage configuration.
 * When bucket/credentials are null, the tenant uses the shared DO Spaces bucket
 * with path isolation: tenants/{tenantId}/
 */
export const tenantStorage = pgTable("tenant_storage", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** Tenant's storage path prefix, always set. e.g. "tenants/uuid/" */
  prefix: text("prefix").notNull(),
  /** null = use shared DO_SPACES_BUCKET */
  bucket: text("bucket"),
  region: text("region"),
  endpoint: text("endpoint"),
  /** null = use shared DO_SPACES_KEY */
  accessKeyId: text("access_key_id"),
  /** NEVER store the secret here — use TENANT_CONFIG_ENCRYPTION_KEY to encrypt in config jsonb */
});

// ─── INTEGRATIONS ─────────────────────────────────────────────────────────────

/**
 * Per-tenant integration configurations.
 *
 * provider values:
 *   "paynow"            — PayNow Zimbabwe
 *   "stripe"            — Stripe
 *   "whatsapp_cloud"    — WhatsApp Cloud API (Meta)
 *   "sms_africala"      — Africala/SMSala (implemented — see server/sms-config.ts). Each
 *                          tenant is a distinct customer under our SMSala reseller account
 *                          with their own API token and Sender ID.
 *   "sms_bulksms"       — BulkSMS (not implemented — example of another SMS vendor shape)
 *   "sms_twilio"        — Twilio SMS (not implemented)
 *
 * config shape examples:
 *   paynow:         { integrationId, integrationKey, mode, returnUrl, resultUrl }
 *   whatsapp_cloud: { phoneNumberId, accessToken, webhookVerifyToken }
 *   sms_africala:   { apiToken, senderId }
 *   sms_bulksms:    { apiToken, senderId }
 *
 * Sensitive fields (keys, tokens) are encrypted with TENANT_CONFIG_ENCRYPTION_KEY
 * (server/tenant-config-crypto.ts) before being written to the config jsonb column.
 */
export const tenantIntegrations = pgTable(
  "tenant_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    config: jsonb("config").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("tenant_integrations_tenant_idx").on(t.tenantId),
    index("tenant_integrations_provider_idx").on(t.provider),
  ]
);

// ─── BRANDING ─────────────────────────────────────────────────────────────────

/**
 * Per-tenant branding/appearance config.
 * Loaded at request time and used for white-labeling, PDFs, and receipts.
 */
export const tenantBranding = pgTable("tenant_branding", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url").default("/assets/logo.png"),
  signatureUrl: text("signature_url"),
  primaryColor: text("primary_color").default("#0d9488"),
  footerText: text("footer_text"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  policyNumberPrefix: text("policy_number_prefix"),
  policyNumberPadding: integer("policy_number_padding").default(5),
  isWhitelabeled: boolean("is_whitelabeled").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── FEATURE FLAGS ────────────────────────────────────────────────────────────

/**
 * Per-tenant feature flag overrides.
 * Known flags: "claims_enabled", "mobile_payments", "agent_portal", "whatsapp_notifications"
 */
export const tenantFeatureFlags = pgTable(
  "tenant_feature_flags",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    flag: text("flag").notNull(),
    enabled: boolean("enabled").notNull(),
    setAt: timestamp("set_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("tenant_feature_flags_unique_idx").on(t.tenantId, t.flag),
  ]
);

// ─── BILLING: PLANS ───────────────────────────────────────────────────────────

/**
 * Platform-owner-defined pricing packages. Each plan bundles a set of gateable
 * app modules (see server/module-gate.ts) at a monthly USD price.
 *
 * Plans are never hard-deleted once a tenant has subscribed to them — retire
 * with isActive:false instead, so historical invoices keep a valid planId.
 */
export const billingPlans = pgTable(
  "billing_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable code referenced by module-gate config, e.g. "starter" */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceMonthlyUsd: numeric("price_monthly_usd").notNull(),
    /** v1: always 1 (monthly). Reserved for future quarterly/annual billing. */
    billingIntervalMonths: integer("billing_interval_months").default(1).notNull(),
    /** Module keys included in this plan, e.g. ["claims","funeral_ops"] */
    modules: jsonb("modules").notNull().default([]),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("billing_plans_key_idx").on(t.key)]
);

// ─── BILLING: SUBSCRIPTIONS ───────────────────────────────────────────────────

/**
 * One active subscription row per tenant. status lifecycle:
 * trialing → active → past_due → suspended, or → cancelled at any point.
 * currentPeriodEnd equals trialEndsAt while trialing, so the billing sweep
 * (server/tenant-billing-sweep.ts) uses one code path for both trial expiry
 * and ordinary renewals.
 */
export const tenantSubscriptions = pgTable(
  "tenant_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => billingPlans.id),
    /** trialing | active | past_due | suspended | cancelled */
    status: text("status").default("trialing").notNull(),
    /** monthly | annual. Drives both the renewal-invoice amount (annual = 12mo at 20% off, see
     *  tenant-billing-math.ts's computeInvoiceAmount) and the period length (see
     *  effectiveBillingIntervalMonths) — the plan's own billingIntervalMonths stays a fixed "1" and
     *  is only ever the *monthly* base price; this field is what actually varies per subscription. */
    billingCycle: text("billing_cycle").default("monthly").notNull(),
    trialEndsAt: timestamp("trial_ends_at"),
    currentPeriodStart: timestamp("current_period_start").notNull(),
    currentPeriodEnd: timestamp("current_period_end").notNull(),
    /** null = inherit billingSettings.graceDays (global default) */
    graceDaysOverride: integer("grace_days_override"),
    /** null = inherit billingSettings.platformFeeRatePercent (global default) */
    platformFeeRateOverride: numeric("platform_fee_rate_override", { precision: 5, scale: 2 }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("tenant_subscriptions_tenant_idx").on(t.tenantId)]
);

// ─── BILLING: INVOICES ────────────────────────────────────────────────────────

/**
 * One invoice per billing period. paymentToken is the ONLY identifier ever
 * exposed on an unauthenticated route (server/billing-public-routes.ts) — never
 * look up an invoice by id/tenantId on a public endpoint.
 */
export const tenantInvoices = pgTable(
  "tenant_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => tenantSubscriptions.id),
    /** Price snapshot at issue time — later plan-price edits never change an issued invoice */
    planId: uuid("plan_id")
      .notNull()
      .references(() => billingPlans.id),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    /** open | paid | void */
    status: text("status").default("open").notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    dueDate: timestamp("due_date").notNull(),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
    /** Opaque public identifier for the unauthenticated pay page, crypto.randomBytes(24).hex */
    paymentToken: text("payment_token").notNull(),
    merchantReference: text("merchant_reference"),
    paynowPollUrl: text("paynow_poll_url"),
    paynowStatus: text("paynow_status"),
    /** Platform-owner user id, set only when paid via the manual mark-paid escape hatch */
    markedPaidBy: text("marked_paid_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("tenant_invoices_token_idx").on(t.paymentToken),
    index("tenant_invoices_tenant_idx").on(t.tenantId),
    index("tenant_invoices_status_due_idx").on(t.status, t.dueDate),
  ]
);

// ─── SELF-SERVE SIGNUP ─────────────────────────────────────────────────────────

/**
 * A prospect's signup submission, staged here until their $1 PayNow verification charge
 * clears — only then does server/tenant-provisioning.ts turn this into a real tenant (see
 * server/tenant-signup-service.ts). paymentToken is the ONLY identifier ever exposed on an
 * unauthenticated route (server/tenant-signup-public-routes.ts), same convention as
 * tenantInvoices.paymentToken above. adminPasswordHash is hashed at submit time — this table
 * never holds a plaintext password, even transiently.
 */
export const pendingTenantSignups = pgTable(
  "pending_tenant_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessName: text("business_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    /** Mirrors organizations' own business-profile columns (shared/org-profile.ts) — copied
     *  onto the real org verbatim once provisioned. */
    orgType: text("org_type"),
    productTypes: jsonb("product_types").notNull().default([]),
    distributionChannels: jsonb("distribution_channels").notNull().default([]),
    bookStatus: text("book_status"),
    bookSizeCurrent: integer("book_size_current"),
    bookSizeProjected12mo: integer("book_size_projected_12mo"),
    staffComplement: integer("staff_complement"),
    adminEmail: text("admin_email").notNull(),
    adminDisplayName: text("admin_display_name"),
    adminPasswordHash: text("admin_password_hash").notNull(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => billingPlans.id),
    /** monthly | annual — the prospect's choice, carried onto the real subscription once provisioned. */
    billingCycle: text("billing_cycle").default("monthly").notNull(),
    verificationAmount: numeric("verification_amount").default("1.00").notNull(),
    currency: text("currency").default("USD").notNull(),
    /** awaiting_payment | provisioned | failed */
    status: text("status").default("awaiting_payment").notNull(),
    paymentToken: text("payment_token").notNull(),
    merchantReference: text("merchant_reference"),
    paynowPollUrl: text("paynow_poll_url"),
    paynowStatus: text("paynow_status"),
    /** Set once provisioning succeeds — makes the poll route idempotent (a second poll after
     *  success returns "already provisioned" instead of creating a second tenant). */
    provisionedTenantId: uuid("provisioned_tenant_id").references(() => tenants.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("pending_tenant_signups_token_idx").on(t.paymentToken),
    index("pending_tenant_signups_email_idx").on(t.adminEmail),
  ]
);

// ─── BILLING: GLOBAL SETTINGS ─────────────────────────────────────────────────

/** Singleton row (id always "global") — platform-owner-editable billing defaults. */
export const billingSettings = pgTable("billing_settings", {
  id: text("id").primaryKey().default("global"),
  trialDays: integer("trial_days").default(14).notNull(),
  graceDays: integer("grace_days").default(7).notNull(),
  reminderLeadDays: integer("reminder_lead_days").default(3).notNull(),
  /** Kill switch for module-gate enforcement — default off, see server/module-gate.ts */
  moduleEnforcementEnabled: boolean("module_enforcement_enabled").default(false).notNull(),
  /** Default platform revenue-share rate applied to cleared receipts, e.g. "2.50" = 2.5%. Per-tenant override: tenantSubscriptions.platformFeeRateOverride */
  platformFeeRatePercent: numeric("platform_fee_rate_percent", { precision: 5, scale: 2 }).default("2.50").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── BILLING: EVENT LOG ───────────────────────────────────────────────────────

/**
 * Append-only audit trail for system-triggered billing events (no req context
 * to hang an auditLog() call off of, unlike platform-owner-driven actions).
 */
export const tenantBillingEvents = pgTable(
  "tenant_billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id"),
    /** invoice_generated | reminder_sent | past_due | auto_suspended | auto_restored | manual_mark_paid */
    type: text("type").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("tenant_billing_events_tenant_idx").on(t.tenantId)]
);

// ─── BACKUP SYNC HISTORY ──────────────────────────────────────────────────────

/**
 * One row per backup-sync run (see server/backup-sync.ts), so backup health is
 * queryable instead of only visible in server logs. Kept in the control plane
 * since it's platform-wide operational state, not tenant data.
 */
export const backupSyncRuns = pgTable("backup_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull(), // 'running' | 'success' | 'partial' | 'failed'
  totalRows: text("total_rows"),
  tableCount: text("table_count"),
  errorCount: text("error_count"),
  errors: jsonb("errors"),
  triggeredBy: text("triggered_by"), // 'scheduler' | 'manual'
});

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type Tenant = typeof tenants.$inferSelect;
export type TenantDatabase = typeof tenantDatabases.$inferSelect;
export type TenantIntegration = typeof tenantIntegrations.$inferSelect;
export type TenantEmailDomain = typeof tenantEmailDomains.$inferSelect;
export type TenantBranding = typeof tenantBranding.$inferSelect;
export type BackupSyncRun = typeof backupSyncRuns.$inferSelect;
export type BillingPlan = typeof billingPlans.$inferSelect;
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
export type TenantInvoice = typeof tenantInvoices.$inferSelect;
export type BillingSettings = typeof billingSettings.$inferSelect;
export type TenantBillingEvent = typeof tenantBillingEvents.$inferSelect;
export type PendingTenantSignup = typeof pendingTenantSignups.$inferSelect;
