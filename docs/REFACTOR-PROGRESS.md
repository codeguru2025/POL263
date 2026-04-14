# Multi-Tenant Refactor Progress

This file tracks the ongoing architectural refactor of POL263 from a shared-database
monolith into a control plane + isolated tenant data plane architecture.

**Last updated:** 2026-04-14  
**Session summary:** Phase 1 complete, deployed to production on DigitalOcean.

---

## Architecture Target (from initial brief)

```
pol263-control-plane (DO)     — WHO tenants are, HOW to reach them
pol263-falakhe (DO)           — Falakhe's isolated data
pol263 (DO)                   — Shared fallback for non-production tenants
```

One shared codebase serving all tenants. Per-request tenant resolution.
Provider abstraction layers for payments, WhatsApp, SMS (Phase 2).
Tenant-aware queue/worker architecture (Phase 4).

---

## Infrastructure

### DigitalOcean Databases

| Cluster | Purpose | Pool name | Direct DB |
|---|---|---|---|
| `pol263-control-plane` | Tenant registry, routing, integrations | `pol263` (port 25061) | `defaultdb` (port 25060) |
| `pol263` | Shared default tenant DB | `pol263` (port 25061) | `defaultdb` (port 25060) |
| `pol263-falakhe` | Falakhe isolated tenant DB | `pol263-falakhe` (port 25061) | `defaultdb` (port 25060) |

### Key Tenant IDs (from Supabase migration)

| Tenant | ID | Status |
|---|---|---|
| FALAKHE FUNERAL PARLOUR | `4eadab0e-c61b-40ee-b511-1243e9790179` | Production — isolated DB |
| SUNREST FUNERAL HOME | `ced0df49-9b78-4b52-96ad-c380975592e0` | Test |
| SUNREST FUNERAL HOME (deleted) | `c22e3c70-6a63-416d-80e9-7442a4f7da2c` | Deleted — set isActive=false |
| TEST TENANT | `65664e01-310b-4ec3-906e-e95226cb14d1` | Test |
| VALLEYSIDE FUNERAL SERVICES | `56e7fee7-38b2-423c-974d-9dd1891faea8` | Test |
| SHEGO FUNERAL GROUP | `ecab8765-9147-4570-b95f-573b16a6b0b6` | Test |

---

## Phase 1: Control Plane Extraction — COMPLETE ✓

### What was built

| File | Description |
|---|---|
| `shared/control-plane-schema.ts` | Drizzle schema for pol263-control-plane: tenants, tenant_domains, tenant_databases, tenant_storage, tenant_integrations, tenant_branding, tenant_feature_flags |
| `server/control-plane-db.ts` | Dedicated pg connection pool for control plane (max: 5) |
| `server/tenant-resolver.ts` | Per-request middleware: resolves req.tenantId from X-Tenant-ID header → subdomain → custom domain → session fallback |
| `server/tenant-db.ts` | Updated: reads DB routing from control plane, falls back to shared DB if control plane unreachable |
| `server/index.ts` | Updated: tenantResolverMiddleware wired after auth, before routes |
| `server/auth.ts` | Fixed: createTableIfMissing=false (bundled prod build can't find connect-pg-simple table.sql) |
| `drizzle.control-plane.config.ts` | Drizzle config for control plane schema push |
| `drizzle.falakhe.config.ts` | Drizzle config for pol263-falakhe schema push |
| `drizzle.tenant.config.ts` | Generic tenant DB schema push (uses TENANT_DIRECT_URL) |
| `drizzle.config.ts` | Updated: prefers DATABASE_DIRECT_URL for DDL (poolers block DDL) |
| `script/migrate-orgs-to-control-plane.ts` | Copies organizations from Supabase → control plane (run once, idempotent) |
| `script/migrate-supabase-to-do.ts` | Migrates Falakhe's data from Supabase → pol263-falakhe (run once) |
| `script/cp-set-tenant-db.ts` | Updates tenant's databaseUrl in control plane after migration |

### npm scripts added

```bash
npm run db:push:cp            # Push control plane schema to pol263-control-plane
npm run db:push:falakhe       # Push tenant schema to pol263-falakhe
npm run db:migrate:cp         # Copy orgs from Supabase → control plane
npm run db:migrate:falakhe    # Migrate Falakhe data from Supabase → pol263-falakhe
npm run db:cp:set-falakhe-db  # Update control plane: point Falakhe at pol263-falakhe
```

### Migration steps completed

1. ✓ `npm run db:push:cp` — control plane schema created in pol263-control-plane
2. ✓ `npm run db:migrate:cp` — 6 orgs copied from Supabase to control plane
3. ✓ `npm run db:push:falakhe` — full tenant schema created in pol263-falakhe
4. ✓ `npm run db:migrate:falakhe` — all Falakhe data copied from Supabase
5. ✓ `npm run db:cp:set-falakhe-db` — control plane now routes Falakhe → pol263-falakhe
6. ✓ `npm run db:push:do` — sessions + all tables created in pol263 (shared tenant DB)
7. ✓ Committed and pushed to main — DO App Platform redeploys automatically

### Current data routing

```
Request for Falakhe (org id 4eadab0e...)
  → tenant-resolver sets req.tenantId
  → getDbForOrg() queries control plane
  → control plane returns pol263-falakhe URL
  → query runs against isolated Falakhe DB ✓

Request for any other tenant
  → control plane returns databaseUrl = null
  → falls back to DATABASE_URL (pol263 shared DB)
```

### Known issues / gotchas discovered

- DO managed DBs block `session_replication_role` — doadmin is not superuser.
  Migration script inserts in strict FK dependency order instead.
- DO connection pooler URLs use pool NAME as database name in URL path,
  not the actual PostgreSQL database name (which is `defaultdb`).
- `connect-pg-simple` reads `table.sql` from node_modules at runtime —
  this fails in bundled production. Fixed with `createTableIfMissing: false`.
  Sessions table must exist before app starts (created via `db:push:do`).
- DO pooler port 25061 requires a named pool to be configured in DO dashboard.
  If pool doesn't exist, use direct port 25060 for both app and migrations.
- `drizzle-kit push` against DO requires `NODE_TLS_REJECT_UNAUTHORIZED=0`
  due to self-signed cert in chain.

---

## Phase 2: Payment + Integration Abstraction — NOT STARTED

### Goal

Move PayNow credentials out of environment variables and into `tenant_integrations`
in the control plane. Add provider abstraction layer so different tenants can use
different payment providers.

### What needs to be built

- `server/adapters/payment/PaymentAdapter.ts` — interface
- `server/adapters/payment/PaynowAdapter.ts` — PayNow implementation
- `server/adapters/payment/StripeAdapter.ts` — Stripe stub
- `server/adapters/whatsapp/WhatsAppAdapter.ts` — interface
- `server/adapters/sms/SMSAdapter.ts` — interface
- `server/integration-loader.ts` — loads tenant config from control plane, returns adapter
- Encryption layer for secrets in `tenant_integrations.config` (AES-256-GCM using TENANT_CONFIG_ENCRYPTION_KEY)
- Migration: move PAYNOW_INTEGRATION_ID/KEY from env vars → tenant_integrations rows

---

## Phase 3: Remaining Tenant Data Isolation — NOT STARTED

### Goal

Provision isolated databases for SUNREST and VALLEYSIDE when they go live.
Same process as Falakhe:

```bash
# For each new production tenant:
npm run db:push:tenant        # TENANT_DIRECT_URL=<url>
tsx script/migrate-supabase-to-do.ts  # with TENANT_ORG_ID set
npm run db:cp:set-falakhe-db  # TENANT_ID=<uuid> TENANT_DB_URL=<pooler_url>
```

---

## Phase 4: Queue / Worker Architecture — NOT STARTED

### Goal

- Tenant-aware job queue (notifications, receipts, commission recalc, reports)
- Each job carries tenantId — worker resolves correct DB before processing
- Scheduled jobs (month-end runs, premium reminders) per tenant

---

## Environment Variables Reference

See `.env` (local, gitignored) and `.env.example` (template, committed).

Key variables:
- `DATABASE_URL` — pol263 pooler (default tenant DB)
- `DATABASE_DIRECT_URL` — pol263 direct (migrations)
- `CONTROL_PLANE_DATABASE_URL` — pol263-control-plane pooler
- `CONTROL_PLANE_DIRECT_URL` — pol263-control-plane direct
- `FALAKHE_DATABASE_URL` — pol263-falakhe pooler
- `FALAKHE_DIRECT_URL` — pol263-falakhe direct
- `SUPABASE_DATABASE_URL` — source DB (keep until Supabase decommissioned)
- `TENANT_CONFIG_ENCRYPTION_KEY` — 64-char hex, encrypts integration secrets
- `APP_BASE_DOMAIN` — `pol263.com` (prod) / `localhost` (dev)

---

## Supabase Decommission Checklist

Do this after confirming production is stable on DO:

- [ ] Verify all Falakhe data matches between Supabase and pol263-falakhe (row counts)
- [ ] Confirm Google OAuth works in production
- [ ] Confirm payments work end-to-end
- [ ] Remove `SUPABASE_DATABASE_URL` from DO App Platform env vars
- [ ] Remove `SUPABASE_DATABASE_URL` from local `.env`
- [ ] Pause or delete Supabase project
