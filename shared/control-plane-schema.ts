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
 *   "sms_bulksms"       — BulkSMS
 *   "sms_twilio"        — Twilio SMS
 *
 * config shape examples:
 *   paynow:         { integrationId, integrationKey, mode, returnUrl, resultUrl }
 *   whatsapp_cloud: { phoneNumberId, accessToken, webhookVerifyToken }
 *   sms_bulksms:    { apiToken, senderId }
 *
 * Sensitive fields (keys, tokens) should be encrypted with TENANT_CONFIG_ENCRYPTION_KEY.
 * Phase 1: plaintext. Phase 2: AES-256-GCM encryption layer added.
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
  primaryColor: text("primary_color").default("#D4AF37"),
  footerText: text("footer_text"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  policyNumberPrefix: text("policy_number_prefix"),
  policyNumberPadding: text("policy_number_padding").default("5"),
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

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type Tenant = typeof tenants.$inferSelect;
export type TenantDatabase = typeof tenantDatabases.$inferSelect;
export type TenantIntegration = typeof tenantIntegrations.$inferSelect;
export type TenantBranding = typeof tenantBranding.$inferSelect;
