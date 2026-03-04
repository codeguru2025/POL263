# POL263 — Performance, Security & Architecture Audit Report

**Date:** 2025-03-04  
**Scope:** Backend (Node/Express, Drizzle, Paynow), frontend (React, TanStack Query), DB (Postgres), payments, DDoS resilience, N+1 elimination.

---

## Executive summary

The codebase was audited for **performance**, **payment security**, **DDoS resilience**, **N+1 query risks**, and **architecture/engineering** best practices. Several improvements were implemented; remaining recommendations are documented for follow-up.

---

## 1. Performance & “lightning fast” optimization

### 1.1 Database layer

| Area | Status | Notes |
|------|--------|--------|
| **Connection pooling** | ✅ Good | `server/db.ts`: `pg.Pool` with configurable `DB_POOL_MAX` (default 25), `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`. |
| **Indexes** | ✅ Good | Unique and non-unique indexes on high-traffic columns: `policy_number`, `organization_id`, `payment_intents` (org, idempotency, merchant_reference), `payment_transactions` (org, policy, client, received), receipts, etc. |
| **Compression** | ✅ On | `compression()` middleware enabled in `server/index.ts`. |
| **JSON body limit** | ✅ Set | `express.json({ limit: process.env.JSON_BODY_LIMIT \|\| "1mb" })` to avoid oversized payloads. |

**Recommendations:**

- Tune `DB_POOL_MAX` per host (e.g. 10–50) and monitor pool usage.
- For heavy report endpoints, consider read replicas or materialized views if needed later.

### 1.2 N+1 query elimination (implemented)

| Location | Before | After |
|----------|--------|--------|
| **User create – roles** | `Promise.all(roleIds.map(id => storage.getRole(id, orgId)))` (N queries) | `storage.getRolesByIds(roleIds, orgId)` (1 query). |
| **Group receipt / group payment intents – policies** | `Promise.all(policyIds.map(id => storage.getPolicy(id, orgId)))` (N queries) | `storage.getPoliciesByIds(policyIds, orgId)` (1 query). |

**New storage APIs:**

- `getRolesByIds(roleIds: string[], organizationId: string): Promise<Role[]>`
- `getPoliciesByIds(ids: string[], orgId: string): Promise<Policy[]>`

**Remaining N+1 (acceptable or tenant-bound):**

- **Paynow webhook** (`handlePaynowResult`): loops over orgs to resolve `merchant_reference` (one query per tenant). Bounded by number of tenants; each query is indexed. Optional future: global lookup table `(merchant_reference → organization_id)` in main DB to reduce to 1–2 queries.
- **applyGroupPaymentToPolicies**: loop over allocations with per-allocation DB calls. Could be batched (e.g. batch `getPolicy`, batch receipt numbers) in a later iteration if group sizes grow large.
- **getUserEffectivePermissions / addRolePermission / addUserRole**: loop over orgs to find which tenant DB owns a role. Inherent to multi-tenant design; typically small org count.

---

## 2. Secure payments — duplicate & fake payment prevention

### 2.1 Idempotency

| Mechanism | Status | Details |
|-----------|--------|---------|
| **Payment intents (Paynow)** | ✅ | `idempotencyKey` per create; `getPaymentIntentByOrgAndIdempotencyKey` returns existing intent. Schema: `uniqueIndex("pi_idempotency_org_idx")` on `(organization_id, idempotency_key)`. |
| **Apply Paynow payment** | ✅ | `applyPaymentToPolicy` checks `intent.status === "paid"` and existing receipt by `paymentIntentId` before creating transaction/receipt. |
| **Manual payments (POST /api/payments)** | ✅ | `payment_transactions.idempotency_key` has `.unique()` in schema. Duplicate key now returns **409** with message *"A payment with this idempotency key already exists. Duplicate request ignored."* (implemented in this audit). |
| **Cash receipt (staff)** | ✅ | Idempotency key checked via `getPaymentTransactionByIdempotencyKey` before insert. |
| **Group payment intents** | ✅ | `gpi_idempotency_org_idx`; `getGroupPaymentIntentByOrgAndIdempotencyKey` used before create. |

### 2.2 Paynow webhook & fake payment prevention

| Control | Status | Details |
|---------|--------|---------|
| **Hash verification** | ✅ | `verifyPaynowHash()` in `server/paynow-hash.ts`: SHA512 over URL-decoded fields + integration key; used in `handlePaynowResult` and poll response. Invalid hash → `ok: false`, no payment applied. |
| **Webhook always 200** | ✅ | Result URL handler returns `200` even on internal error so Paynow does not retry indefinitely; payment application is idempotent. |
| **Idempotent apply** | ✅ | Same webhook delivered twice: first run marks intent `paid` and creates transaction; second run sees `intent.status === "paid"` and returns existing receipt. |
| **Transaction uniqueness** | ✅ | Paynow-applied transactions use `idempotencyKey: paynow-${intent.id}`; schema enforces unique `idempotency_key`. |

### 2.3 Implemented in this audit

- **Duplicate idempotency key on POST /api/payments**: catch DB unique constraint violation (`23505` or message containing `idempotency_key`) and return **409** with a clear message instead of 500.

---

## 3. DDoS & rate limiting

### 3.1 Current setup

| Endpoint / area | Limit | Notes |
|-----------------|--------|--------|
| **All /api*** | 200 req/min per IP | `apiLimiter` in `server/index.ts`; `standardHeaders: true` (RateLimit-*). |
| **Auth** (`/api/auth`, agent-auth, client-auth, security-questions, agents/by-referral) | 20 per 15 min per IP | `authLimiter`; reduces brute-force and credential stuffing. |
| **Paynow webhook** `/api/payments/paynow/result` | **60 req/min per IP** | **Added in this audit** to cap webhook traffic per IP and limit replay/DoS impact. |

### 3.2 Recommendations

- Consider **Redis (or other store) for rate limit state** in production so limits are shared across multiple server instances (`express-rate-limit` store).
- Optional: **per-user** or **per-tenant** limits on expensive endpoints (e.g. report exports) if abuse appears.
- Keep **webhook rate limit** below Paynow’s expected delivery rate; 60/min is conservative and can be increased if needed (e.g. 120/min).

---

## 4. Architecture & engineering checks

### 4.1 Security

| Item | Status |
|------|--------|
| **Helmet** | ✅ CSP, X-DNS-Prefetch-Control, etc. (CSP allows self, inline scripts, Google Fonts; `crossOriginEmbedderPolicy: false` for compatibility). |
| **CSRF** | ✅ Optional via `ENABLE_CSRF_PROTECTION=true`; cookie-based with SameSite/Secure. |
| **Auth** | ✅ Session-based staff auth; client-auth for client portal; tenant scoping and permission checks (`requireTenantScope`, `requirePermission`) on sensitive routes. |
| **Paynow secrets** | ✅ Integration key only in server env; never logged; used only in `paynow-hash` and `paynow-config`. |
| **Raw body for webhooks** | ✅ `req.rawBody` preserved for JSON; Paynow result uses `express.urlencoded` and does not need raw body for hash. |

### 4.2 Payments architecture

- **Single transaction scope**: Payment creation (transaction + receipt + policy status) uses `withOrgTransaction` where appropriate so all-or-nothing semantics hold.
- **Policy lock**: For POST /api/payments (cleared, with policy), `SELECT id FROM policies WHERE id = ? FOR UPDATE` inside the transaction to avoid double application.
- **Audit & notifications**: Audit log and client notifications run after commit (e.g. `setImmediate`) so failures do not roll back the payment.

### 4.3 Multi-tenancy

- **Tenant DB routing**: `getDbForOrg(organizationId)` routes to tenant DB when `database_url` is set; otherwise uses main DB. Payment and policy data are always scoped by `organizationId`.
- **Platform owner**: Effective tenant selection and scoping in Settings (e.g. `currentOrg` from `effectiveOrganizationId`) fixed in a previous change to avoid cross-tenant data mix-up.

### 4.4 Frontend non-functional requirements

| Item | Status |
|------|--------|
| **TanStack Query** | ✅ Default `staleTime: 5 min`, `gcTime: 10 min`, `refetchOnWindowFocus: false`, `retry: 1` to reduce redundant requests and improve perceived speed. |
| **Auth/branding** | ✅ Longer `staleTime` where used (e.g. auth, branding) to avoid flicker and extra round-trips. |
| **Build** | ✅ Vite production build; code-splitting per route. |

---

## 5. Summary of code changes (this audit)

1. **server/index.ts**  
   - Added **Paynow webhook rate limit**: 60 req/min per IP on `/api/payments/paynow/result`.

2. **server/storage.ts**  
   - **getRolesByIds(roleIds, organizationId)** — batch fetch roles.  
   - **getPoliciesByIds(ids, orgId)** — batch fetch policies.

3. **server/routes.ts**  
   - User create: use **getRolesByIds** instead of N× getRole.  
   - Group receipt and group payment intents: use **getPoliciesByIds** instead of N× getPolicy.  
   - POST /api/payments: on **duplicate idempotency key** (DB unique violation), return **409** with a clear message.

---

## 6. Checklist summary

| Category | Item | Done |
|----------|------|------|
| **Performance** | Connection pooling, compression, JSON limit | ✅ |
| **Performance** | N+1 reduced (roles, policies batch APIs) | ✅ |
| **Payments** | Idempotency (intents, manual, cash, group) | ✅ |
| **Payments** | Paynow hash verification | ✅ |
| **Payments** | Duplicate payment handling (409 on duplicate key) | ✅ |
| **DDoS** | Global API rate limit | ✅ |
| **DDoS** | Auth rate limit | ✅ |
| **DDoS** | Paynow webhook rate limit | ✅ |
| **Architecture** | Helmet, optional CSRF, tenant scoping | ✅ |
| **Frontend** | Sensible React Query defaults | ✅ |

---

## 7. Optional follow-ups

- **Redis (or similar) for rate limits** when scaling to multiple app instances.
- **Merchant reference lookup table** in main DB for Paynow webhook to avoid one query per tenant (minor win unless tenant count is large).
- **Batch allocation processing** in `applyGroupPaymentToPolicies` (batch getPolicy, batch receipt numbers) if group sizes become large.
- **Stricter CSP** over time (e.g. reduce `'unsafe-inline'` / `'unsafe-eval'` where possible).
- **Per-route or per-user rate limits** on heavy exports/reports if needed.

This report and the listed code changes keep the app **fast**, **secure for payments**, **resilient to abuse**, and **free of the main N+1 patterns** that were identified.
