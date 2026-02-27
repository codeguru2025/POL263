# POL263 – Software Architecture Review

This document is a concise architecture review of the POL263 codebase from a software architect perspective. It covers structure, security, scalability, and deployment readiness.

---

## 1. High-level architecture

| Layer | Technology | Assessment |
|-------|------------|------------|
| **Frontend** | React 19, Vite 7, Tailwind v4, shadcn/ui, Wouter, TanStack Query | Modern, appropriate. Single SPA with staff and client portals. |
| **Backend** | Express 5, TypeScript, Passport (Google OAuth), Helmet, rate limiting | Solid. REST API under `/api`, tenant-scoped. |
| **Database** | PostgreSQL, Drizzle ORM, connect-pg-simple (sessions) | Good fit. Schema in `shared/schema.ts`; migrations in `migrations/`. |
| **Deploy** | Node 22, single process (`dist/index.cjs`), static client from server | App Platform / VPS friendly. Build uses `npm run build:do` for DO. |

**Verdict:** Layering is clear. Shared schema and types between client and server reduce drift. No unnecessary complexity.

---

## 2. Security

- **Authentication:** Staff via Google OIDC only (no staff passwords). Client portal: policy number + password (argon2), enrollment, security questions. Demo login gated for non-production.
- **Authorization:** RBAC with 41 permissions, 9 roles; permission guards on routes; tenant isolation via `organization_id` / `branch_id`.
- **Session:** PostgreSQL-backed sessions, HttpOnly, SameSite, secure in production. Session secret required in production.
- **Headers:** Helmet with CSP. CSRF optional via `ENABLE_CSRF_PROTECTION`. Rate limiting on auth endpoints.
- **Secrets:** No secrets in repo. `SESSION_SECRET`, `DATABASE_URL`, OAuth and Paynow keys from environment.
- **Audit:** Mutations and sensitive reads logged with actor, timestamp, before/after diffs.

**Verdict:** Auth model is coherent. Tenant isolation and RBAC are enforced server-side. Superuser provisioning via `SUPERUSER_EMAIL` is appropriate.

---

## 3. Multi-tenancy and data isolation

- All major tables carry `organization_id`; many have `branch_id`.
- API uses authenticated user’s tenant context; cross-tenant access is blocked.
- Optional per-tenant DB URL (e.g. `tenant_database_url`) for future scaling; single DB is supported and documented.

**Verdict:** Tenant model is consistent and suitable for SaaS.

---

## 4. Scalability and concurrency

- **Sessions:** Stored in PostgreSQL; no in-process session limit; suitable for multiple instances.
- **Policy / receipt numbers:** Documented risk of concurrent generation (COUNT+1); unique constraints prevent duplicates; atomic sequences recommended and noted in deployment docs.
- **Payments:** Idempotency keys and unique constraints; webhook handling idempotent.
- **Connection pool:** Configurable via `DB_POOL_MAX` (default 25); appropriate for App Platform and small-to-medium load.

**Verdict:** Fine for current scale. Concurrency caveats are documented; no blocking issues for initial production.

---

## 5. Deployment and configuration

- **Build:** `script/build.ts` runs Vite (client) and esbuild (server). `npm run build:do` runs `npm ci --include=dev` then build so App Platform has devDependencies.
- **Runtime:** Single entry `server/index.ts` → `dist/index.cjs`. Serves static client in production; health check at `/api/health`.
- **Database bootstrap:** Optional `RUN_DB_BOOTSTRAP=true` runs schema push + seed on startup (first deploy only).
- **Config:** Env-based (.env / platform env vars). No hardcoded credentials. `server/db.ts` validates `DATABASE_URL` and rejects placeholder host `"base"`.

**Verdict:** Ready for DigitalOcean App Platform (with inbuilt or external PostgreSQL). Build and run commands are clearly specified.

---

## 6. Codebase hygiene

- **Structure:** `client/`, `server/`, `shared/`, `script/`, `migrations/` are well separated.
- **Types:** Shared Drizzle schema and Zod where used; TypeScript throughout.
- **Docs:** README, HOW-TO-RUN, DATABASE-SETUP, DEPLOY-DIGITALOCEAN-APP, PRODUCTION-SETUP, SECURITY, and deployment checklists present. Replit-specific content can be de-emphasized in favor of App Platform.

**Verdict:** Structure and documentation are in good shape for onboarding and deployment.

---

## 7. Recommendations summary

| Area | Recommendation |
|------|----------------|
| **Deploy target** | Use DigitalOcean App Platform with its inbuilt PostgreSQL database component; link DB to app and set `DATABASE_URL` via bindable variable. |
| **First deploy** | Set `RUN_DB_BOOTSTRAP=true` and `SUPERUSER_EMAIL`; after successful deploy set `RUN_DB_BOOTSTRAP=false`. |
| **Build** | Use `npm run build:do` as the App Platform build command. |
| **Docs** | Keep one primary deploy guide (e.g. DEPLOY-DIGITALOCEAN-APP) for “from scratch” with inbuilt DB; reference PRODUCTION-SETUP and SECURITY from there. |
| **Concurrency** | Plan atomic sequences for policy and receipt numbers if traffic grows; current constraints are acceptable for launch. |

---

**Conclusion:** The application is architecturally sound, secure for production use with correct configuration, and ready for a from-scratch setup on DigitalOcean App Platform with its inbuilt database. No blocking issues identified.
