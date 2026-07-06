# POL263 — Complete Architecture Reverse-Engineering Report

**Purpose:** Exhaustive technical documentation of the POL263 codebase — a Policy Management SaaS that evolved from bespoke software built for a single funeral company (Falakhe Funeral Parlour) — so that another architect can redesign it into an Enterprise Multi-Tenant SaaS platform without needing to read the source code directly.

**Method:** Produced via direct source reading (no invented content) across `shared/schema.ts`, `shared/control-plane-schema.ts`, `server/routes.ts` (~9,267 lines), `server/storage.ts` (~5,733 lines), every `client/src/pages/**` file, all `server/*.ts` support modules, all 66 files in `migrations/`, and 13 pre-existing internal architecture/planning documents in `docs/`. Findings are cited to file/line/table/endpoint wherever possible. Sections 9, 11, 12, 18, 19, and 20 are cross-cutting synthesis built on top of the fact-finding in Sections 1–8, 13–17 — those are clearly framed as judgment/recommendation, not fact, and say so explicitly where relevant.

**Snapshot date:** 2026-07-04. Repository state at time of writing: branch `main`, HEAD `60a43ca`, with uncommitted working-tree changes for legacy-group receipt fee dating, premium-override approvals, age-band member pricing, and chapel/wash-bay fees. Any finding silent on these features predates them.

---

## Table of Contents

1. [Project Overview](#section-1--project-overview)
2. [Complete Feature Inventory](#section-2--complete-feature-inventory)
3. [Menu Map](#section-3--menu-map-part-1-staff-pages-batch-abc--agentclientjoin-portals)
4. [Database Analysis](#section-4--database-analysis)
5. [Authentication](#section-5--authentication)
6. [Business Workflows](#section-6--business-workflows)
7. [Settings Inventory](#section-7--settings-inventory)
8. [Hardcoded Company Logic](#section-8--hardcoded-company-logic)
9. [Multi-Tenancy Readiness](#section-9--multi-tenancy-readiness)
10. [Module Classification](#section-10--module-classification)
11. [Control Plane Candidates](#section-11--control-plane-candidates)
12. [Tenant Features](#section-12--tenant-features)
13. [Permission Matrix](#section-13--permission-matrix)
14. [API Inventory](#section-14--api-inventory)
15. [Events](#section-15--events--existing-architecture-plans-research-dossier)
16. [Files](#section-16--files)
17. [Security Review](#section-17--security-review)
18. [SaaS Transformation Roadmap](#section-18--saas-transformation-roadmap)
19. [Architectural Debt](#section-19--architectural-debt)
20. [Final Recommendations (Executive Report)](#section-20--final-recommendations-executive-report)
- [Appendix A — Prior Internal Architecture Documentation Review](#appendix-a--prior-internal-architecture-documentation-review)

**Note on section grouping:** Sections were researched and are presented in logically-grouped clusters rather than strict ascending order in the underlying research files (e.g. Section 10 follows directly from Section 2's feature inventory; Section 13's permission matrix follows Section 5's authentication model; Sections 8 and 17 sit alongside Section 7's settings inventory since all three were researched together). The Table of Contents above reflects the numeric order requested; use it to navigate directly to any section regardless of its position in the underlying research narrative.

---

# Section 1 — Project Overview

## 1.1 Purpose

POL263 is a **multi-tenant Policy Management System (SaaS)** built for insurance companies and
funeral-assurance societies, with a strong Zimbabwean / Southern-African market focus: PayNow
mobile-money payment integration, multi-currency support (USD, ZAR, ZIG), funeral cover / burial
society workflows (mortuary intake, dispatch, fleet, chapel/wash-bay fees), and agent-driven
distribution (referral links, commissions).

A single TypeScript codebase serves three client surfaces, each with its own authentication model:

| Surface | Audience | Auth | Entry route |
|---|---|---|---|
| **Staff portal** | Insurer back-office (admins, managers, cashiers, claims officers, finance, fleet ops) | Google OAuth only | `/staff/login` → `/staff` |
| **Agent portal** | Field sales agents (web + native Android/iOS via Capacitor, plus a separate offline-first Expo app) | Email + password | `/agent/login` → `/staff` (agent-scoped) |
| **Client portal** | Policyholders (self-service) | Policy number + password, or Google OAuth | `/client/login` → `/client` |

The system is **white-labelable per tenant** (name, logo, colors, footer, signature). When not
white-labeled, the default brand shown everywhere is POL263; white-labeled tenants replace all
POL263 branding on login screens, sidebar, PDFs and receipts. RBAC (role-based access control) is
fully database-driven so that, e.g., an agent role only ever sees its own clients/policies/commissions
while staff roles see organization-wide data (subject to permission grants).

Current documented scale (per `docs/SYSTEM-SPEC.md`, a living document self-described as reflecting
the codebase at time of writing): **81 database tables**, **~226 HTTP API endpoints** in a single
Express registration file (`server/routes.ts`, ~241KB / ~9,267 lines as measured directly),
**~273 data-access methods** in `server/storage.ts` (~163KB / ~5,733 lines), **27 staff pages**
plus dedicated agent and client portals, **54 discrete RBAC permissions** across **9 seeded roles**.

Primary product requirements are documented in `docs/PRODUCT-REQUIREMENTS.md` (PRD v1.0) and a more
technical architecture briefing in `docs/SYSTEM-SPEC.md`, both of which were read in full/part for
this report and are treated as authoritative for scope/behavior (they are described as reflecting
actual source, not aspirational design).

## 1.2 Full Architecture

### 1.2.1 Monorepo layout

```
client/       React 19 SPA — staff, agent, client portals (Vite build; entry client/index.html, client/src/main.tsx)
server/       Express 5 API + business logic (34+ modules; entry server/index.ts)
shared/       Code shared by client & server
  schema.ts             All ~81 Drizzle table definitions for the DEFAULT/tenant database schema (source of truth), 3,068 lines
  control-plane-schema.ts  Tables for the separate control-plane DB (tenant registry/routing), 222 lines
  roles.ts               Small role-scoping helper (agent-scope override logic), 28 lines
  validation.ts           Shared Zod/plain validators: national ID format, currency normalization, amount parsing, 92 lines
migrations/   66 SQL migration files (sequential 000x_*.sql) generated by/for Drizzle, applied against the default schema
script/       Build script, DB migration/seed/reset tooling, Supabase↔DigitalOcean migration utilities, lockfile tooling
scripts/      Ad-hoc/operational one-off scripts (Falakhe tenant fixes, backfills, diagnostics) — see Section 16
docs/         29 markdown docs: PRD, system spec, deployment guides (DO App Platform, InterServer VPS, Netlify), ERD, audit reports
tests/        Vitest unit tests (tests/unit/*.test.ts) + one Playwright-style e2e spec (tests/e2e/staff-login.spec.ts)
android/ ios/ Capacitor 7 native project shells (synced via `npm run cap:sync`)
agent-app/    A SEPARATE standalone Expo/React Native app (see 1.2.3) — not part of the Capacitor web-wrapper
attached_assets/  Design/reference assets referenced via the "@assets" Vite alias
fxq/          Explicitly documented as a "legacy mirror" of an earlier project name (Falakhe) — README says to use root client/server/configs as the single source of truth, not this folder
testsprite_tests/  Config/fixtures for the TestSprite AI testing harness (see docs/TEST-WITH-TESTSPRITE.md)
```

The README (`README.md`) and `CLAUDE.md` both state the canonical `client/`, `server/`, `shared/`
folders are the single source of truth; `fxq/` is legacy and should be ignored for current work.

### 1.2.2 Client ⇄ Server ⇄ Shared relationship

- `shared/schema.ts` defines every Drizzle table plus `drizzle-zod`-derived insert schemas
  (`createInsertSchema`) that are imported by both `server/routes.ts` (for request validation) and
  potentially the client for form typing.
- `shared/validation.ts` holds business-rule validators (national ID regex, currency handling,
  `parsePositiveAmount` guarding against negative/overflow/NaN monetary input) used on both sides.
- The server never lets routes touch the DB directly — all queries funnel through
  `server/storage.ts`, which is imported by `server/routes.ts` handlers. This is a strict layering
  convention documented in `CLAUDE.md`.
- The client talks to the server exclusively over `/api/*` REST endpoints via
  `client/src/lib/queryClient.ts`'s `apiFetch`/`apiRequest` helpers (TanStack Query underneath).
- Path aliases (`tsconfig.json`, `vite.config.ts`): `@/*` → `client/src/*`, `@shared/*` → `shared/*`,
  `@assets` → `attached_assets` (Vite only).

### 1.2.3 Mobile: Capacitor wrapper

`capacitor.config.ts` configures a single native shell (`appId: com.pol263.app`, `appName: POL263`,
`webDir: dist/public`) that wraps the **same Vite web build** for Android and iOS. Two modes:

- **Bundled mode** (default, no `CAPACITOR_SERVER_URL`): the native app loads the built
  `dist/public` assets directly from the device — used for local dev/testing on a device via a
  manually uncommented `server.url` pointing at the dev machine's LAN IP.
- **Remote server mode** (production): setting `CAPACITOR_SERVER_URL` at build time makes the
  native WebView load the **live server** instead of bundled files. This is deliberately done so
  tenant subdomain routing (e.g. `falakhe.pol263.com`) works automatically inside the native shell
  without a separate `VITE_API_BASE` build per tenant, and avoids CORS.
- `npm run cap:sync` = `npm run build && npx cap sync`; `cap:android` / `cap:ios` open the native
  IDEs. GitHub Actions (`.github/workflows/build-web-mobile.yml`) builds web + Android APK + iOS
  simulator artifacts on every push to `main`.

**Separate native app**: `agent-app/` is a **second, independent** mobile codebase — an
**offline-first Expo/React Native app** (Expo SDK ~56, React Native 0.85.3, React 19.2.3) purpose-built
for field agents, distinct from the Capacitor-wrapped web app. It uses `expo-sqlite` for local
on-device storage, syncs clients/policies to the server when connectivity returns (auto-sync on
app foreground, connectivity change, and every 30s), and reuses the same agent email/password
session auth as the web agent portal. It has its own `package.json`, `app.json`, `eas.json` (Expo
Application Services build config), and its own nested `AGENTS.md`/`CLAUDE.md` guidance file
("Expo HAS CHANGED — read the exact versioned docs before writing any code"). This is a materially
different technical stack (React Native, not Capacitor-wrapped web) from the rest of the product
and should be treated as a semi-independent sub-project when assessing the codebase.

## 1.3 Frontend Technologies

Frontend is **React 19.2.3** + **Vite 5** (`@vitejs/plugin-react`), styled with **Tailwind CSS 3.4**
using the **shadcn/ui "new-york" style** (`components.json`: baseColor "neutral", CSS variables
enabled, lucide icon library) built on **Radix UI** primitives. Routing uses **wouter 3.3.5**
(`Switch`/`Route` in `client/src/App.tsx`), a lightweight alternative to react-router — chosen for
bundle size given the app is also shipped as a mobile WebView bundle.

Key libraries and how each is wired into this app specifically:

| Package | Version | Role in POL263 |
|---|---|---|
| `react` / `react-dom` | 19.2.3 | UI runtime |
| `vite` | ^5.4.14 | Dev server (port 5000) + production client bundler; outputs to `dist/public` |
| `wouter` | ^3.3.5 | Client-side routing; all non-landing pages are `lazy()`-loaded per route in `App.tsx` for code-splitting, with a custom `retryLazy()` wrapper that retries chunk loads up to 3 times and force-reloads the page on a stale-deploy `ChunkLoadError` (handles the "old tab hits new deploy's renamed JS chunk" failure mode) |
| `@tanstack/react-query` | ^5.60.5 | All server-state fetching/caching. Central `queryClient` (`client/src/lib/queryClient.ts`) sets `staleTime: 30s`, `gcTime: 10min`, `retry: 1`, and a default `queryFn` (`getQueryFn`) that treats HTTP 401 as "return null" (soft-auth) rather than throwing, so components can render as logged-out instead of crashing |
| `react-hook-form` + `@hookform/resolvers` | ^7.66 / ^3.10 | Form state + Zod schema resolution across all create/edit forms (policies, clients, claims, etc.) |
| `zod` + `zod-validation-error` | ^3.25 / ^3.4 | Runtime validation shared with server-side `drizzle-zod` insert schemas |
| Radix UI (`@radix-ui/react-*`, ~25 packages) | 1.x/2.x | Unstyled accessible primitives underlying every `client/src/components/ui/*` component (dialog, dropdown, select, tabs, tooltip, accordion, etc.) |
| `cmdk` | ^1.1.1 | Command-palette component, used by `command-center.tsx` / `global-command-bar.tsx` (a Cmd-K style global search/action bar) |
| `recharts` | ^2.15.4 | All dashboard charts (revenue trend, policy status breakdown, lead funnel, lapse/retention, product performance) |
| `framer-motion` | ^12.23 | Animation (transitions, micro-interactions) |
| `lucide-react` | ^0.545 | Icon set (also the shadcn/ui default) |
| `sonner` | ^2.0.7 | Toast notifications (paired with the custom `use-toast.ts` hook and `ui/toaster.tsx`) |
| `embla-carousel-react` | ^8.6 | Carousel component (`ui/carousel.tsx`) |
| `react-day-picker` | ^9.11 | Calendar/date-picker (`ui/calendar.tsx`) |
| `vaul` | ^1.1.2 | Drawer/bottom-sheet primitive (mobile-friendly modals) |
| `next-themes` | ^0.4.6 | Light/dark theme switching (`theme-provider.tsx`, `theme-switcher.tsx`) despite the app not using Next.js — just reused for its theme-context API |
| `class-variance-authority`, `clsx`, `tailwind-merge` | — | Component variant styling utilities (the shadcn/ui `cn()` helper pattern) |
| `input-otp` | ^1.4.2 | OTP/verification code input (used in `pages/verify.tsx`) |
| `qrcode` | ^1.5.4 | Client-side QR generation where needed (server also generates via the same package for receipts) |
| `@capacitor/*` (android, ios, core, cli, app, browser) | ^7.x | Native shell + Capacitor plugins (App state, in-app Browser for OAuth redirects) |

**Key client-side infrastructure files:**
- `client/src/lib/queryClient.ts` — defines `getApiBase()` (reads `VITE_API_BASE` so a Capacitor
  build can point at a remote API host instead of same-origin), CSRF token extraction from the
  `XSRF-TOKEN` cookie and injection as an `X-XSRF-TOKEN` header on all non-GET requests, and the
  shared `QueryClient` instance.
- `client/src/hooks/use-auth.ts` — `useAuth()` wraps `GET /api/auth/me` in a TanStack Query hook;
  deliberately **never throws** on failure (returns `null` session) so a 500 or network blip during
  reload doesn't trip the app's error boundary; exposes `user`, `roles`, `permissions`,
  `isAuthenticated`, `isPlatformOwner`, and a `logout` mutation.
- `client/src/hooks/use-branding.ts` — `useBranding(orgId?)` fetches `/api/public/branding` (a
  public, unauthenticated endpoint) to get tenant name/logo/color; falls back to the POL263 default
  brand (`#0d9488` teal) when the tenant is not white-labeled or the fetch fails; contains logic to
  detect and ignore a "stock" logo path (`/assets/logo.png`) so a non-customized tenant still shows
  the platform default rather than a broken/placeholder image.
- `client/src/hooks/use-mobile.tsx` — `useIsMobile()`, a `matchMedia`-based responsive breakpoint
  hook (768px) for conditionally rendering mobile vs desktop layouts (independent from the Capacitor
  native-mobile detection, which lives in `client/src/lib/mobile-payment.ts`'s `isNativeMobile()`).
- `client/src/lib/` also contains `mobile-payment.ts` (native-mobile PayNow flow helpers),
  `print-document.ts` / `share-document.ts` (PDF print/share across web and native), `table-utils.ts`,
  `flags.ts` (feature-flag helpers), `assetUrl.ts` (resolves logo/asset URLs consistently with the
  server's object-storage proxy pattern), and `staff-reports-nav.ts`.

## 1.4 Backend Technologies

Backend is **Express 5.0.1** on **Node 22.x** (`.nvmrc`/`package.json engines`), entirely TypeScript,
executed via `tsx` in development and bundled to a single CJS file (`dist/index.cjs`) via `esbuild`
for production. `server/index.ts` is the composition root; middleware order matters and is explicit:

1. `helmet` — CSP (locked to `'self'` in production, permissive `unsafe-inline`/`unsafe-eval` in
   dev for Vite HMR), `crossOriginEmbedderPolicy: false`.
2. `compression`, `cookie-parser`, a custom `requestIdMiddleware` (assigns/propagates
   `X-Request-Id` for log correlation, from `server/logger.ts`).
3. `express.json()` (1MB limit, captures `req.rawBody` for potential signature verification) and
   `express.urlencoded()` (100KB limit).
4. **CSRF** via `csurf`, enabled by default in production (`ENABLE_CSRF_PROTECTION` env override
   available). A short explicit exemption list covers PayNow's server-to-server result webhook,
   agent login/logout, mobile OAuth exchange, and client-auth login/logout (endpoints that can't
   carry a browser CSRF cookie). A dedicated `GET /api/agent-auth/csrf-token` endpoint lets the
   mobile app fetch a token before its first mutating call. Every response also mirrors the CSRF
   token into a readable `XSRF-TOKEN` cookie for the client's double-submit pattern.
5. **Rate limiting** via `express-rate-limit`, with an **optional Redis-backed store**
   (`server/rate-limit-redis-store.ts`) — when `REDIS_URL` is set, limits are shared across app
   instances (needed once the app scales beyond one DigitalOcean App Platform instance); otherwise
   falls back to per-process in-memory counting (a startup warning is logged in production when
   Redis isn't configured). Distinct limiters exist per concern: general `/api` (200/min),
   `/api/auth`+`/api/agent-auth`+`/api/client-auth`+`/api/security-questions` (20/15min in prod, 200
   in dev), PayNow result callback (60/min), report/dashboard exports (30/15min), and a write-limiter
   applied selectively to POST on `/api/policies`, `/api/payments`, `/api/month-end-run`,
   `/api/upload`, and public registration endpoints (30/min).
6. Request logging middleware (structured JSON via `structuredLog`), then `GET /api/health`
   (checks DB connectivity with `SELECT 1`).
7. `tenantResolverMiddleware` (see 1.6) runs before auth setup so subdomain-based tenant resolution
   is available to login routes.
8. `setupAuth(app)` (staff/Google OAuth, `server/auth.ts`) and `setupClientAuth(app)`
   (`server/client-auth.ts`), then `registerRoutes(httpServer, app)` (all API routes,
   `server/routes.ts`).
9. Production serves the built client via `serveStatic` (`server/static.ts`, 1-year immutable
   cache on assets, no-store on `index.html`, SPA fallback via a regex route since Express 5's
   `path-to-regexp` no longer accepts bare `*`); development instead mounts Vite in middleware mode
   (`server/vite.ts`).
10. A final error-handling middleware normalizes CSRF failures to a friendly "session expired"
    message, hides internal error text in production, and logs full stack traces via
    `structuredLog`.
11. On listen: starts the outbox background drain loop, the daily Supabase backup scheduler
    (`server/backup-sync.ts`), a startup RBAC role-sync pass across every org (ensures new roles
    like "driver" exist everywhere), and warns if `PLATFORM_OWNER_MFA_ENFORCED` isn't set in
    production (the platform-owner account bypasses all tenant RBAC). `SIGTERM`/`SIGINT` trigger a
    graceful shutdown that stops accepting connections and drains in-flight background jobs
    (30s budget) before exiting.

**Other backend dependencies and where they're used:**

| Package | Purpose in POL263 |
|---|---|
| `drizzle-orm` (^0.39.3) + `pg` (^8.16.3) | ORM + Postgres driver; every DB connection (`server/db.ts`, `control-plane-db.ts`, `tenant-db.ts`) is a `pg.Pool` wrapped by `drizzle(pool, { schema })` |
| `drizzle-zod` (^0.7.0) | Auto-derives Zod insert schemas from `shared/schema.ts` table defs, imported directly into `routes.ts` for request-body validation |
| `drizzle-kit` (dev, ^0.31.4) | CLI for `db:push`/migration generation against the 5 different `drizzle*.config.ts` targets |
| `connect-pg-simple` (^10.0.0) | Stores Express sessions in Postgres (`sessions` table) instead of memory, so sessions survive restarts/redeploys |
| `express-session` | Session middleware wired up in `server/auth.ts` with `PgSession` |
| `passport` + `passport-google-oauth20` + `passport-local` | Google OAuth strategy for staff (`server/auth.ts`); `passport-local` is present as a dependency though the primary client/agent password flows are hand-rolled in `client-auth.ts` rather than a Passport local strategy |
| `argon2` (^0.44.0) | Password hashing (`argon2id`) for client and agent accounts; `server/auth.ts` and `client-auth.ts` both contain a legacy-SHA256-hash detection/verification path (`isLegacySha256Hash`) to support gradual migration of old password hashes to Argon2 |
| `csurf` (^1.11.0) | CSRF token generation/validation (see above); no `@types` package exists so it's declared ambient in `server/ambient.d.ts` |
| `helmet` (^8.1.0) | Security headers / CSP |
| `express-rate-limit` (^8.2.1) | Rate limiting (paired with the custom Redis store adapter) |
| `redis` (^4.7.1) | Backing store for distributed rate limiting; optional, `REDIS_URL`-gated |
| `multer` (^2.0.2) | `multipart/form-data` file upload handling (client documents, ID scans, proof of address, etc.) feeding into `object-storage.ts` |
| `pdfkit` (^0.17.2) + `qrcode` (^1.5.4) | All PDF document generation (receipts, policy docs, funeral/mortuary forms, payslips, payment vouchers, requisitions) — see Section 16 for the full generator file list; QR codes embed a verification URL |
| `nodemailer` (^9.0.1) | SMTP email sending — used concretely for payslip emailing (`server/payslip-email.ts`), gated on `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM` env vars, falling back gracefully (logs and no-ops) if not configured |
| `expo-server-sdk` (^6.1.0) | Server-side push notification dispatch to Expo push tokens (`server/push.ts`) for both staff/agent devices and client devices; chunked delivery, `DeviceNotRegistered` tokens are pruned automatically |
| `ws` (^8.18.0) | Listed as a dependency and in the esbuild bundle allowlist, but **no direct `new WebSocket`/`ws.Server` usage was found in `server/`** — real-time delivery to the browser is done via Server-Sent Events (`server/sse.ts`) instead; `ws` is likely a transitive requirement of another package (e.g. Vite's dev server) rather than an active WebSocket server in this codebase |
| `@aws-sdk/client-s3` (^3.1003.0) | S3-compatible client used against DigitalOcean Spaces (see 1.7) |
| `uuid` | ID generation where `crypto.randomUUID`/Drizzle's `defaultRandom()` isn't used directly |
| `compression` | gzip response compression |
| `zod` / `zod-validation-error` | Server-side validation of request payloads, paired with `drizzle-zod` |
| `dotenv` | Loads `.env` in all entrypoints (`server/index.ts` and every `drizzle*.config.ts`) |
| `tsx` | TypeScript execution for `dev`, all `script/*.ts` tooling, and `db:*` npm scripts |
| `cross-env` (dev) | Cross-platform env var setting in npm scripts (important since this repo is developed on Windows per the environment info) |

## 1.5 Database

**PostgreSQL via Drizzle ORM.** There are **five separate Drizzle config files**, each pointing
`drizzle-kit push`/migrate at a different physical database — this is the clearest evidence of an
in-progress **control-plane / tenant-database split**:

| Config file | Target DB | Schema pushed | Notes |
|---|---|---|---|
| `drizzle.config.ts` | Default/shared app DB (`DATABASE_URL`, prefers `DATABASE_DIRECT_URL` for DDL) | `shared/schema.ts` | The original single-database mode; still the default for orgs without a dedicated DB. Auto-detects DigitalOcean hosts to relax TLS cert verification. |
| `drizzle.control-plane.config.ts` | `pol263-control-plane` (`CONTROL_PLANE_DIRECT_URL`/`CONTROL_PLANE_DATABASE_URL`) | `shared/control-plane-schema.ts` | Tenant registry / routing metadata only — never policy/client/payment data. Migrations output to `migrations/control-plane` (directory not yet present on disk at time of writing — the control-plane DB appears to be managed via `db:push` rather than committed SQL migrations so far). |
| `drizzle.tenant.config.ts` | Any isolated tenant DB, via `TENANT_DIRECT_URL` env var at invocation time | `shared/schema.ts` | Generic "push the tenant schema to whichever tenant DB you point it at" — used for onboarding new isolated tenants (e.g. `db:push:tenant`). |
| `drizzle.falakhe.config.ts` | The Falakhe tenant's dedicated DB (`FALAKHE_DIRECT_URL`) | `shared/schema.ts` | A named convenience config for the first (and, per user memory, so-far only) tenant migrated to database-level isolation. Filters out `schema_migrations`, an internally-managed tracking table, from Drizzle's own diffing. |
| `drizzle.backup.config.ts` | Supabase backup DB (`SUPABASE_BACKUP_URL`, forced onto the session pooler port 5432 since the transaction pooler on 6543 can block DDL) | **Both** `shared/schema.ts` and `shared/control-plane-schema.ts` | Used to provision one consolidated backup database that mirrors every tenant + control-plane table (see `server/backup-sync.ts`). |

### 1.5.1 Three-tier routing model (current state)

The system is mid-migration from a single shared database toward a **control-plane + per-tenant
database** architecture. Today, all three tiers coexist:

1. **Default/shared "registry" database** (`server/db.ts`, `DATABASE_URL`) — holds `organizations`,
   `users`, `roles`/permissions, and (for tenants that have not been migrated to an isolated DB) all
   of their operational data too. `db.ts` builds a `pg.Pool` (default `max: 25`) with automatic
   self-signed-cert tolerance detection for Supabase/DigitalOcean hosts, and a guard that fails fast
   if `DATABASE_URL`'s host literally resolves to the placeholder string `"base"` (a known
   DigitalOcean App Platform misconfiguration when a database component binding isn't linked
   correctly).

2. **Control-plane database** (`server/control-plane-db.ts`, `cpDb`/`cpPool`) — a small, dedicated
   pool (`max: 5`, since it only serves low-volume routing lookups) holding **only** tenant metadata:
   `tenants` (the authoritative tenant list — name, slug, license/provisioning status),
   `tenant_domains` (subdomain/custom-domain → tenant mapping), `tenant_databases` (per-tenant
   `databaseUrl`/`databaseDirectUrl`/migration state — `null` means "use the shared DB"),
   `tenant_storage` (per-tenant object-storage bucket override), `tenant_integrations` (per-tenant
   provider configs — PayNow, Stripe, WhatsApp Cloud API, BulkSMS/Twilio SMS — documented in schema
   comments as "Phase 1: plaintext, Phase 2: AES-256-GCM encryption" for secrets, i.e. **not yet
   encrypted at rest**), `tenant_branding` (whitelabel config), `tenant_feature_flags`, and
   `backup_sync_runs` (operational history of the daily backup job). The module explicitly falls
   back to `DATABASE_URL` with a warning if no dedicated `CONTROL_PLANE_DATABASE_URL` is configured
   yet, so the split is backward-compatible during migration.

3. **Per-tenant isolated databases** (`server/tenant-db.ts`) — the operational layer that actually
   decides, per request, which physical database a tenant's policies/clients/payments live in.
   Key mechanics:
   - `getPoolForOrg(orgId)` looks up `tenant_databases.databaseUrl` in the **control plane** first
     (authoritative); if the control-plane lookup throws (e.g. control-plane DB temporarily
     unreachable), it falls back to reading `organizations.databaseUrl` on the **shared** DB — a
     deliberate resilience measure so the control-plane split doesn't become a single point of
     failure during its rollout. If no dedicated URL is found either way, the tenant is pinned to
     the shared `defaultPool`.
   - Pools are cached (`poolCache`/`dbCache`/`poolLastAccess` maps), capped at
     `MAX_TENANT_POOLS` (default 50) with **least-recently-used eviction** (`evictLeastRecentPool`)
     to bound total open connections as tenant count grows; concurrent cache-misses for the same
     org are coalesced via an in-flight-creation map so a burst of simultaneous first-requests for
     a newly-provisioned tenant doesn't spawn duplicate pools.
   - When a dedicated pool is created, `applyPendingMigrations()` (`server/migrate-tenant-db.ts`)
     automatically runs any `migrations/*.sql` files not yet recorded in that tenant DB's own
     `schema_migrations` table — this guards against a tenant DB restored from an old backup silently
     drifting behind the shared schema.
   - **User mirroring for FK integrity**: because isolated tenant DBs enforce foreign keys locally
     (e.g. `payment_transactions.recorded_by → users.id`), and staff/agent identity actually lives in
     the shared registry DB, `ensureRegistryUserMirroredToOrgDataDb()` /
     `...InTx()` copy (upsert) a registry user row into the tenant DB on demand, restricted to
     same-org staff or the platform owner. `resolveUserIdForOrgDatabase()` is the safe wrapper routes
     call before writing an audit/recorded-by field, returning `null` (rather than throwing) if the
     user genuinely doesn't belong there.
   - **`withOrgTransaction(orgId, fn)`** is the ACID primitive for money-moving operations: it opens
     one BEGIN…COMMIT/ROLLBACK on the **correct** pool for that org (shared or dedicated) so that
     payment_transaction + receipt + policy-status writes either all land or all roll back together;
     rollback failures are logged without masking the original error.
   - Per-tenant **sequence counters** (`org_policy_sequences` — policy/receipt/claim/case numbers,
     etc.) intentionally live in the **same database as the tenant's rows**, not the control plane,
     specifically so they can be incremented inside the same transaction as the row they number and
     roll back together on failure (documented directly in the file's header comment).

### 1.5.2 Tenant resolution (which tenant is this request for)

`server/tenant-resolver.ts` implements `tenantResolverMiddleware`, run early in the Express chain,
determining `req.tenantId` by first match of:
1. `X-Tenant-ID` header (only honored for the platform owner or a user already in that org — an
   internal/mobile-app mechanism).
2. Subdomain against `APP_BASE_DOMAIN` (e.g. `falakhe.pol263.com` → tenant "falakhe"), resolved
   against `tenants.slug` in the control plane.
3. Full custom domain lookup against `tenant_domains.domain` (for tenants using their own domain).
4. Fallback to the authenticated session's `user.organizationId` (covers existing sessions
   established before domain-based routing existed).

Resolution is cached in-process for 5 minutes (slug and domain lookups separately keyed) and the
middleware **never blocks a request** on failure — it's advisory; routes that require a resolved
tenant call `requireTenant()` explicitly, which 400s if `req.tenantId` is still unset.

### 1.5.3 Migrations

66 sequential `migrations/000x_*.sql` files exist against the default/tenant schema (up through
`0058_requisition_department_costflag.sql`, matching the two new files visible in git status). No
`migrations/control-plane/` or `migrations/backup/` directories exist on disk yet despite being
configured as output targets in `drizzle.control-plane.config.ts` / `drizzle.backup.config.ts` —
suggesting those two databases have so far been provisioned via `drizzle-kit push` (schema sync)
rather than versioned SQL migrations, or that migration files exist but simply haven't been
generated/committed yet. `npm run db:migrate` runs `script/run-migrations.ts` against
`DATABASE_URL` (and `DATABASE_URL_TENANT` if distinct); `npm run db:migrate:status` compares
applied vs. on-disk migrations.

## 1.6 Authentication (brief — full RBAC detail is another section)

- **Staff**: Google OAuth exclusively via Passport's `GoogleStrategy` (`server/auth.ts`); no
  password login path exists for staff by design (reduces attack surface, per README/CLAUDE.md).
  Only pre-registered emails can sign in.
- **Agents**: email + password (`server/client-auth.ts` handles both agent and client credential
  flows in one file, despite the name), Argon2-hashed with a legacy-SHA256 verify/upgrade path.
  Per-account login-attempt lockout is tracked in-memory (5 failures → 15-minute lock), explicitly
  noted in a `TODO(scalability)` comment as needing to move to a DB-backed column once the app runs
  more than one instance (in-memory lockout resets per process today).
  A **mobile OAuth exchange** mechanism (`mobileAuthTokens` map with short-lived one-time tokens)
  lets a Capacitor WebView complete Google OAuth via the system browser and hand a token back to the
  in-app session, since the WebView can't share the external browser's session cookie.
- **Clients**: email/password (Argon2) or Google OAuth, plus a security-questions recovery flow
  (`security_questions` table, seeded with 5 default questions in `server/seed.ts`).
- Sessions are stored in PostgreSQL (`connect-pg-simple`, `sessions` table) rather than in-memory,
  so restarts/redeploys don't log everyone out.
- A single **Platform Owner** super-account (env `SUPERUSER_EMAIL`, required in production, defaults
  to a hardcoded dev email otherwise) sits above all tenants with implicit full permissions plus
  platform powers (`create:tenant`, `delete:tenant`, `manage:whitelabel`) and can switch into any
  tenant's context.

## 1.7 Storage

`server/object-storage.ts` implements an **S3-compatible abstraction** targeting **DigitalOcean
Spaces** (documented as primary) with **Cloudflare R2** as a documented legacy-compatible fallback
naming scheme, and finally **local disk (`uploads/`)** as the last-resort fallback when neither is
configured (`isObjectStorageEnabled` is computed from the presence of endpoint/keys/bucket).

- Env vars: `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION`, `DO_SPACES_BUCKET`, `DO_SPACES_KEY`,
  `DO_SPACES_SECRET`, `DO_SPACES_CDN_URL` (canonical); `R2_*` and generic `AWS_*` variants are
  accepted as fallbacks for the same fields.
- Uses `@aws-sdk/client-s3` (`PutObjectCommand`/`GetObjectCommand`/`DeleteObjectCommand`) against
  the configured endpoint with virtual-hosted-style addressing (`forcePathStyle: false`), matching
  DO Spaces' convention (`https://{bucket}.{region}.digitaloceanspaces.com`).
  Keys are generated as `{prefix}/{timestamp}-{12-byte-hex}{ext}` (or unprefixed).
- **Files are never served directly from the bucket to the browser.** `uploadFile()` returns a
  `/uploads/<key>` **proxy URL**; the server streams the object back to the browser using its own
  S3 credentials (`resolveImage()`/`fetchFile()`), which lets the bucket stay fully private (no
  public ACLs/bucket policies needed) while still working from arbitrary client contexts (web,
  native WebView).
- `resolveImage()` is the general-purpose "give me bytes for this stored URL" resolver used
  throughout the PDF generators (logos, signatures, receipt adverts): it handles absolute
  `https://` URLs (routing through the authenticated S3 client if the URL matches this tenant's own
  public storage URL prefix, otherwise doing a direct fetch guarded by an **SSRF blocklist** —
  `isSsrfSafeUrl()` rejects private/loopback/link-local ranges (`10.x`, `172.16-31.x`, `192.168.x`,
  `127.x`, `169.254.x` including the cloud metadata IP, `::1`, `fc00::/7`) and re-resolves the
  hostname's DNS answer to catch DNS-rebinding), relative `/uploads/...` paths (tries object storage
  first, then several local filesystem base-path candidates for backward compatibility with
  pre-migration local uploads), and finally an `APP_BASE_URL`-relative fetch as a last resort.
- The **control plane's `tenant_storage` table** (see 1.5.1) anticipates future **per-tenant bucket
  isolation** (`prefix: "tenants/{tenantId}/"`, optional per-tenant bucket/region/endpoint/key) but
  as implemented today, `object-storage.ts` itself reads only the platform-wide `DO_SPACES_*` env
  vars — the per-tenant storage-routing table exists in schema but is not yet wired into
  `object-storage.ts`'s upload/fetch logic (a "phase 2" item, consistent with the control-plane
  migration being in progress generally).
- The local `uploads/` directory (present at repo root) is both the **hard fallback** when no
  object storage is configured at all, and a historical location `resolveImage()` still checks for
  files uploaded before object storage was introduced.

## 1.8 APIs (brief characterization — full inventory is a separate section)

- **Style**: REST over Express 5, JSON request/response, one flat `server/routes.ts` file
  (~241KB / ~9,267 lines) registering essentially all ~226 endpoints, organized internally by
  domain-labeled comment sections rather than split into per-domain router files. Several PDF-form
  route groups are factored out into their own registration functions
  (`registerPolicyDocumentRoute`, `registerMortuaryFormRoutes`, `registerPolicyFormRoutes`,
  `registerFinanceFormRoutes`, `registerHrFleetFormRoutes` — each in its own `routes-pdf-*.ts` file)
  and called from within `routes.ts`.
- **Middleware chain pattern** (`server/route-helpers.ts`, 530 lines): typical mutation flow is
  `requireAuth → requireTenantScope → requirePermission("write:x")` guard chain, then a
  `storage.ts` call, then `auditLog(req, action, entityType, id, before, after)` — every audited
  mutation writes a JSONB before/after diff plus actor/IP/request-id via `storage.createAuditLog`.
  `route-helpers.ts` also centralizes cross-cutting business logic reused by many routes:
  `computePolicyPremium()` (base + add-ons + age-banded additional-member rates, currency- and
  schedule-aware), `getAddOnPrice()`, `enforceAgentScope()`/`enforceAgentPolicyAccess()` (the RBAC
  agent-restriction logic, delegated to `shared/roles.ts`'s `isAgentScoped()`), commission
  recording/rollback (`recordClawback`/`rollbackClawbacks`), and `safeError()` (hides internal error
  text from clients in production, same convention as the global error handler in `index.ts`).
- **CSRF token flow**: server issues a `csurf`-signed token, mirrored into a readable `XSRF-TOKEN`
  cookie on every response; the client (`queryClient.ts`) reads that cookie and attaches it as
  `X-XSRF-TOKEN` on every non-GET request. A short explicit path allowlist bypasses CSRF entirely
  for endpoints that can't carry the browser cookie (PayNow server-to-server callback, mobile/agent
  auth exchange).
- **Real-time**: Server-Sent Events, not WebSocket, is the live-update mechanism
  (`server/sse.ts`). `GET /api/notifications/stream` keeps a per-user open HTTP response in an
  in-process `Map<userId, Set<Response>>`; `sseEmit(userId, event)` fan-out-writes to every open
  tab/device for that user. A 25-second keep-alive ping avoids proxy idle timeouts, and
  `X-Accel-Buffering: no` disables nginx response buffering. The file's own header comment documents
  an explicit **upgrade path** for >500 concurrent users: swap the in-process Map for Redis pub/sub
  (`REALTIME_BACKEND=redis`), with a full code sketch included but **not yet activated**. The `ws`
  package is present in `package.json`/the esbuild bundle allowlist, but no direct WebSocket server
  usage was found in `server/` — it's likely a transitive dependency (e.g. of Vite) rather than an
  active real-time channel in this app; SSE is the actual mechanism in production.
- **Async work**: a **transactional outbox pattern** (`server/outbox.ts` + `outbox-handlers.ts` +
  `outbox-constants.ts`) — rows are inserted into `outbox_messages` **in the same DB transaction**
  as the domain change they follow from (e.g. a payment), then drained asynchronously
  (`drainOutboxForOrg`, triggered via `requestOutboxDrain` → the lightweight in-process
  `job-queue.ts` dispatcher, plus a periodic background drain loop started at server boot). Handlers
  must be idempotent since a row can be retried after partial failure (max 8 attempts). Current
  outbox types: payment-staff-followup, cash-receipt-followup, PayNow-apply-followup,
  service-receipt-followup — each dispatches commission recording, push notifications
  (`server/push.ts`), templated notifications (`server/notifications.ts`), and SSE events.

## 1.9 Third-Party Integrations (exhaustive)

| Integration | Status | Where |
|---|---|---|
| **PayNow** (Zimbabwean mobile-money/card gateway) | **Active, primary payment rail** | `server/paynow-config.ts` (resolves per-org credentials from the `organizations` table — `paynowIntegrationId/Key/AuthEmail/ReturnUrl/ResultUrl/Mode` — falling back to platform-level env vars `PAYNOW_INTEGRATION_ID/KEY/AUTH_EMAIL/...`; explicitly refuses to silently fall back to the platform merchant account if an org lookup fails, to avoid misrouting a tenant's payments to the wrong merchant); `server/paynow-hash.ts` (SHA-512 hash generation for outbound requests and **constant-time** (`crypto.timingSafeEqual`) verification of inbound result-URL POSTs, trying both insertion-order and alphabetical key ordering since PayNow's docs are ambiguous on order); `server/payment-service.ts` (creates idempotent payment intents keyed by an idempotency key, initiates transactions against `https://www.paynow.co.zw/interface/initiatetransaction`, polls status via `.../remotetransaction`, verifies the posted paid amount matches the expected amount within 1 cent before activating a policy, and applies confirmed payments to policy status via `policy-status-on-payment.ts`). Supports methods: EcoCash, OneMoney, InnBucks, Omari, Visa/Mastercard. |
| **Google OAuth 2.0** | **Active** | Staff login exclusively (`server/auth.ts`, `passport-google-oauth20`); also offered as an alternate client login method (`server/client-auth.ts`). |
| **DigitalOcean Spaces** (S3-compatible object storage) | **Active** (primary); Cloudflare R2 and generic AWS S3 supported as compatible fallbacks by env var naming | `server/object-storage.ts`, via `@aws-sdk/client-s3`. |
| **Redis** | **Optional, active when configured** | Rate limiting (`server/rate-limit-redis-store.ts`) for multi-instance deployments; also documented (not yet implemented) as the upgrade path for SSE real-time (`REALTIME_BACKEND=redis`) and push dispatch (`PUSH_BACKEND=redis`, BullMQ-style). |
| **Expo Push Notification API** | **Active** | `server/push.ts` via `expo-server-sdk`; sends to staff/agent and client Expo device tokens, chunked delivery, prunes tokens on `DeviceNotRegistered`. |
| **SMTP email** (via `nodemailer`) | **Active for one concrete flow** | `server/payslip-email.ts` — payslip emailing, gated on `SMTP_HOST/PORT/USER/PASS` + `EMAIL_FROM`; gracefully no-ops if unconfigured. No broader transactional-email system was found wired up beyond this. |
| **Google Translate (unofficial public endpoint)** | **Active, undocumented/unofficial** | `server/routes-pdf-finance.ts`'s `translateText()` calls `https://translate.googleapis.com/translate_a/single` (the free, unauthenticated `gtx` client endpoint used by browser extensions) to translate funeral quotation PDF text into ~13 languages (Shona, Ndebele, Zulu, Xhosa, Afrikaans, French, Portuguese, Swahili, Sesotho, Setswana, Chichewa, Spanish, English). No API key; not a supported/stable Google Cloud Translation API integration — a fragile dependency worth flagging. |
| **Supabase** | **Active, but only as a backup/legacy-migration target**, not the primary DB | `SUPABASE_BACKUP_URL` env var, `drizzle.backup.config.ts`, `server/backup-sync.ts` (daily full mirror of all three DO databases into one Supabase DB, upsert-only/idempotent, no deletes propagated). Several `docs/MIGRATE-SUPABASE-TO-DIGITALOCEAN-DB.md` / `script/migrate-supabase-to-do.ts` artifacts confirm Supabase was likely the **original** production database before a DigitalOcean migration; it now serves purely as an off-platform disaster-recovery mirror. |
| **WhatsApp Cloud API, Twilio SMS, BulkSMS, Stripe** | **Schema-modeled, NOT implemented** | `shared/control-plane-schema.ts`'s `tenantIntegrations.provider` doc-comment lists these as supported provider *values* (`whatsapp_cloud`, `sms_bulksms`, `sms_twilio`, `stripe`) and `.env.example` has commented-out `SMS_PROVIDER`/`SMS_API_TOKEN`/`SMS_SENDER_ID` placeholders ("per-tenant config lives in control plane — fallback/dev only"), but **no actual HTTP client code, SDK dependency, or route wiring exists in `server/` for any of these** — confirmed by grep across the codebase. `server/notifications.ts` is a templated in-app/push notification dispatcher (merge tags, event types) that does **not** send SMS or WhatsApp messages today; it is the wiring point these providers would plug into once implemented. **No Firebase reference exists anywhere in the codebase.** These should be treated as planned/scaffolded, not live, integrations. |
| **`ws` (WebSocket)** | **Dependency present, not actively used as a server** | See 1.8 — likely transitive; SSE is the real mechanism. |

## 1.10 Deployment

Multiple deployment paths are documented; the **actual production target confirmed by committed
config** (`.do/app.yaml`, a DigitalOcean App Platform spec checked into the repo) is:

- **DigitalOcean App Platform**, app name `pol263`, region `lon`, Ubuntu 22 buildpack stack, a
  single web service (`instance_count: 1`, `apps-s-1vcpu-1gb`), `http_port: 5000`.
  - **Build command**: `npm run build:do` (= `npm ci --include=dev && npm run build`) — forces
    devDependencies to install even under a production-mode buildpack install, because the build
    needs `tsx`/`vite`/`tailwindcss` which are devDependencies (`docs/DEPLOY-DIGITALOCEAN-APP.md`
    documents this exact failure mode: "Deploy fails, Restart works" happens when devDeps are
    skipped at install time).
  - **Run command**: `npm run start:with-migrate` = `npm run db:migrate && npm run start`
    (`node dist/index.cjs`), i.e. migrations run automatically before each deploy's server start.
  - **Source**: GitHub repo `codeguru2025/POL263`, branch **`deploy`** (deliberately not `main`).
  - **Why a separate `deploy` branch**: a GitHub Actions workflow
    (`.github/workflows/lockfile-linux.yml`) regenerates `package-lock.json` **on Linux** on pushes
    to `main` (so Linux-only optional native deps — esbuild, rollup, tailwindcss-oxide,
    lightningcss — resolve correctly for `npm ci` on Ubuntu buildpacks) and then fast-forwards
    `deploy` to that verified commit. DigitalOcean tracks only `deploy`, guaranteeing every build it
    picks up has a Linux-correct lockfile. Nobody should push directly to `deploy` or hand-edit the
    lockfile.
  - App-level env vars set directly in the committed spec (with real secrets marked
    `SET_IN_DASHBOARD`): `NODE_ENV=production`, `HOST=0.0.0.0`, `APP_BASE_URL`/`API_BASE_URL`/
    `VITE_APP_PUBLIC_URL` all pinned to `https://pol263-hl5ef.ondigitalocean.app`, PayNow
    return/result URLs pinned to `https://pol263.com/...` (i.e. the custom domain, not the DO
    subdomain), `PAYNOW_MODE=live`, `GOOGLE_CALLBACK_URL`, `SUPERUSER_EMAIL=ausiziba@gmail.com`,
    `APP_BASE_DOMAIN=pol263.com` (the base domain subdomain-tenant-resolution compares against),
    `FALAKHE_DATABASE_URL` and `CONTROL_PLANE_DATABASE_URL` (both `SET_IN_DASHBOARD`), and
    `DB_ACCEPT_SELF_SIGNED=true` (DigitalOcean managed Postgres uses certs Node doesn't trust by
    default).
- **Build output**: `npm run build` (`script/build.ts`) does two things — (1) `viteBuild()`
  compiles the client SPA to `dist/public/`; (2) `esbuild` bundles `server/index.ts` into a single
  minified CJS file, `dist/index.cjs`, targeting `platform: "node"`, with `NODE_ENV` hard-baked to
  `"production"` via `define`. An explicit `allowlist` of packages gets **bundled into** the output
  (to reduce cold-start `openat(2)` syscalls) while everything else in `dependencies`/
  `devDependencies` is left `external` (resolved from `node_modules` at runtime). Notably, the
  allowlist includes `@google/generative-ai`, `axios`, `cors`, `jsonwebtoken`, `openai`, `stripe`,
  and `xlsx` — **none of which appear in `package.json`'s actual dependencies** — suggesting
  `script/build.ts` was copied from a different/earlier project template and not fully pruned; this
  is harmless (esbuild only bundles packages it can resolve) but is a piece of stale/misleading
  config worth cleaning up.
- **Database**: DigitalOcean Managed PostgreSQL is the recommended production DB
  (`docs/DEPLOYMENT-AND-CONCURRENCY.md` explicitly recommends "App Platform (app) + Managed
  Database (DB)"), with Supabase/Neon documented as viable alternates and migration tooling
  (`script/migrate-supabase-to-do.ts`, `docs/MIGRATE-SUPABASE-TO-DIGITALOCEAN-DB.md`) confirming a
  real historical migration off Supabase.
- **Alternate/secondary deployment docs** (present but not the confirmed live target):
  - `docs/DEPLOY-INTERSERVER-VPS.md` — full manual walkthrough for a bare VPS (SSH/web-console
    login, `apt install nodejs postgresql git`, PM2-style process management implied) — written for
    a non-technical operator (very hand-holdy, screenshots-in-prose style).
  - `netlify.toml` — deploys **only the static client** (`npm run build:client` → `dist/public`),
    explicitly noting "The Express API must be hosted elsewhere (Railway, Render, etc.)" and
    requiring `VITE_API_BASE` to point at wherever the API actually runs. This is a documented
    option, not the primary path, since the API can't run on Netlify.
  - `docs/PRODUCTION-SETUP.md` — generic guidance for `NODE_ENV`, `SESSION_SECRET` generation,
    `DATABASE_URL` formats (self-hosted Postgres vs. managed providers), Google OAuth credential
    setup — provider-agnostic.
  - `docs/DEPLOY-CHECKLIST.md` — a simple "pull, build, restart" checklist for any host, noting
    `index.html` is served with `no-store` cache headers so users get fresh HTML on reload after a
    deploy, with an in-app "Reload to update" affordance for chunk-load errors.
- **Native app store deployment**: `docs/GOOGLE-PLAY-AND-APP-STORE.md` covers Android
  keystore/signing and iOS builds via GitHub Actions artifacts; `.github/workflows/build-web-mobile.yml`
  builds web + Android APK + iOS simulator on every push to `main`.
- **CI**: two GitHub Actions workflows — `build-web-mobile.yml` (build artifacts for web/Android/iOS
  on push to main) and `lockfile-linux.yml` (the lockfile-regeneration + `deploy`-branch
  fast-forward described above).

## 1.11 Dependency Tree by Category (from `package.json`)

**UI / Design system**: `@radix-ui/react-*` (~25 primitives), `lucide-react`, `class-variance-authority`,
`clsx`, `tailwind-merge`, `tailwindcss` + `tailwindcss-animate` + `autoprefixer` + `postcss` (dev),
`cmdk`, `vaul`, `embla-carousel-react`, `react-day-picker`, `next-themes`, `sonner`, `input-otp`,
`react-resizable-panels`.

**Forms / validation**: `react-hook-form`, `@hookform/resolvers`, `zod`, `zod-validation-error`,
`drizzle-zod` (server-side schema generation consumed by forms indirectly).

**Data / state**: `@tanstack/react-query`, `wouter` (routing-as-data-flow), `date-fns`,
`recharts` (charting).

**Auth / security**: `passport`, `passport-google-oauth20`, `passport-local`, `argon2`, `csurf`,
`helmet`, `express-rate-limit`, `express-session`, `connect-pg-simple`, `cookie-parser`.

**Payments**: no dedicated payment SDK package — PayNow is integrated via raw `fetch`/hash logic in
hand-rolled `server/payment-service.ts`/`paynow-*.ts` (no npm SDK exists for PayNow Zimbabwe).

**PDF / documents**: `pdfkit`, `qrcode`.

**Mobile**: `@capacitor/android`, `@capacitor/ios`, `@capacitor/core`, `@capacitor/cli`,
`@capacitor/app`, `@capacitor/browser` (all ^7.x); separately, `agent-app/` carries its own Expo/RN
stack (`expo` ~56, `react-native` 0.85.3, `expo-sqlite`, `expo-notifications`, `expo-secure-store`,
`@react-navigation/*`) — entirely independent from the root `package.json`.

**Object storage / infra clients**: `@aws-sdk/client-s3`, `redis`, `ws`, `multer`, `nodemailer`,
`expo-server-sdk`, `qrcode`.

**Dev / build / test tooling**: `vite`, `@vitejs/plugin-react`, `esbuild`, `tsx`, `cross-env`,
`typescript` (pinned `5.6.3`), `vitest`, `drizzle-kit`, `husky` (git hooks, `prepare` script),
`@types/*` packages for the above.

**Misc**: `uuid`, `compression`, `dotenv`, `@jridgewell/trace-mapping` (source-map utility, likely a
transitive-pin), `bufferutil` (optional — a native accelerator for the `ws` package's frame masking,
reinforcing that `ws` is present primarily as a supporting/transitive dependency rather than a
first-class real-time server in this app).

## 1.12 Notable Cross-Cutting Observations (for the report's risk/architecture-seam framing)

- The **control-plane/tenant-DB split is real but partial**: schema, routing code, and one migrated
  tenant (Falakhe) exist; most tenants still live on the shared default database. Fallback paths
  are deliberately layered everywhere (control-plane lookup → shared DB lookup → default pool) so
  the migration can proceed tenant-by-tenant without a hard cutover.
- **Secrets in `tenant_integrations.config` (control plane) are documented as plaintext today**
  ("Phase 1: plaintext. Phase 2: AES-256-GCM encryption layer added" — not yet built).
- **In-memory state that won't survive horizontal scaling**: SSE connections (`sse.ts`), agent
  login-lockout counters (`auth.ts`), rate-limit counts without Redis, and the in-process job queue
  (`job-queue.ts`) are all explicitly called out in code comments as needing a Redis/DB-backed
  upgrade before running more than one app instance — currently `instance_count: 1` in `.do/app.yaml`,
  consistent with this limitation.
- **`ws` package and `@google/generative-ai`/`stripe`/`openai`/`jsonwebtoken`/`xlsx`/`cors` in
  `script/build.ts`'s bundling allowlist** are both signs of template/dependency drift worth a
  cleanup pass — none of the latter group are real dependencies of this project.
- The **Google Translate integration in `routes-pdf-finance.ts`** hits an unofficial, unauthenticated
  public endpoint and should not be relied upon for production-critical translation.


---

# SECTION 2 — COMPLETE FEATURE INVENTORY

Synthesized from Section 1 (Overview/Files), Section 3 parts 1–2 (Menu Map), Section 4 (Database), Section 6 (Workflows), and Section 14 (API Inventory). Each feature ties together its UI location, backing tables, key APIs, and business logic into one entry. Fields are kept terse by design — full detail lives in the source sections.

---

## A. Insurance Core

#### A1. Policy Sales / Issuance
- **Purpose**: Create and price a new insurance policy for a client (individual, group member, or legacy conversion).
- **Location**: `client/src/pages/staff/policies.tsx` (4,480 lines, largest page in the app); `POST /api/policies`; `storage.createPolicyWithInitialSetup`; premium math in `route-helpers.ts::computePolicyPremium()`.
- **Who uses it**: Staff (`write:policy`), Agents (own clients only, via `enforceAgentScope`), public self-registration (`/join/register`).
- **Screens**: Policies list + 6-tab detail view (Overview/Members/Financials/Payments/Documents/Waivers); 19+ dialogs incl. Create-policy wizard (flag-gated `policyWizard`).
- **Database tables**: `policies`, `policyMembers`, `policyStatusHistory`, `policyAddOns`, `productVersions`, `orgPolicySequences`, `orgMemberSequences`.
- **APIs**: `POST/GET/PATCH/DELETE /api/policies[/:id]`, `/api/policies/:id/members`, `/api/policies/:id/upgrade`, `/api/policies/:id/transition`.
- **Permissions**: `read:policy`, `write:policy`, `edit:premium` (premium overrides).
- **Dependencies**: Product/ProductVersion pricing engine, org policy-number sequence, client/dependent records.
- **Business logic**: Base + add-ons + age-banded/flat/legacy-underwriter dependant surcharge; policy starts `inactive`, only becomes `active` on first cleared payment; status machine `inactive→active|cancelled`, `active→grace|cancelled`, `grace→active|lapsed|cancelled`, `lapsed→active|cancelled`.
- **Known assumptions**: Currency fixed per policy (USD/ZAR/ZIG); premium math never negative.
- **Current limitations**: `/staff/tools/print-policy-cards` is an unbuilt stub; policy numbering is per-tenant but the *format* (prefix+padding) is tenant-configurable while the underlying counter mechanism is not user-facing.

#### A2. Products & Pricing (Product Builder)
- **Purpose**: Define insurance products, versioned pricing configs, benefits, bundles, add-ons, and age bands.
- **Location**: `client/src/pages/staff/products.tsx` (2,200 lines, 6 tabs); `server/routes.ts` §A12.
- **Who uses it**: Staff with `write:product`/`read:product`.
- **Screens**: Products / Benefits / Bundles / Add-Ons / Age Bands / Terms & Conditions tabs.
- **Database tables**: `products`, `productVersions`, `benefitCatalogItems`, `benefitBundles`, `productBenefitBundleLinks`, `addOns`, `ageBandConfigs`, `termsAndConditions`.
- **APIs**: `/api/products`, `/api/product-versions`, `/api/product-versions/:id/recalculate-premiums`, `/api/benefit-catalog`, `/api/benefit-bundles`, `/api/add-ons`, `/api/age-bands`, `/api/terms`.
- **Permissions**: `read:product`, `write:product`.
- **Dependencies**: Feeds Policy Sales' premium engine directly.
- **Business logic**: `productVersions` is effective-dated/versioned so rate changes don't retroactively alter in-force policies; 4 age-banded additional-member rate tiers (child/21-65/66-84/85+) × 2 currencies; commission schedule and underwriter cost-sharing configured per version.
- **Known assumptions**: Two hardcoded currencies (USD/ZAR) baked into column names rather than a generic currency table.
- **Current limitations**: `maxAdditionalMembers` null = unlimited (implicit, not obvious in UI).

#### A3. Price Book & Cost Sheets
- **Purpose**: Master catalogue of billable funeral-service line items (Price Book) and internal cost breakdowns per case/claim (Cost Sheets) — distinct from client-facing quotations.
- **Location**: `client/src/pages/staff/pricebook.tsx` (898 lines, 2 tabs).
- **Who uses it**: Staff (`write:product` for price book; `write:finance`/`read:finance` for cost sheets).
- **Database tables**: `priceBookItems`, `costSheets`, `costLineItems`.
- **APIs**: `/api/price-book`, `/api/cost-sheets`, `/api/cost-sheets/:id/items`.
- **Business logic**: Fixed category taxonomy (Casket & Coffin, Transport, Mortuary Services, etc.) and casket-type list shared with Products and Quotations; items versioned with `effectiveFrom`/`effectiveTo`.
- **Current limitations**: Cost sheets have a `status`/`approvedBy` column but no approval-workflow UI was found wired to them (CRUD only, per Section 6).

#### A4. Waiting Period Waivers
- **Purpose**: Maker-checker exception process to waive a policy's underwriting waiting period.
- **Location**: `policies.tsx` Waivers tab; `waitingPeriodWaivers` table; `staff/approvals.tsx` "Waivers" tab.
- **APIs**: `POST /api/policies/:id/waiver-request`, `GET /api/waivers`, `POST /api/waivers/:id/resolve`.
- **Permissions**: `write:policy` (request), `manage:approvals` (resolve).
- **Business logic**: Approving a waiver auto-activates the policy if currently inactive — tight coupling between waiver resolution and policy-status logic.

---

## B. Claims & Funeral Operations

#### B1. Claims Management
- **Purpose**: Insurance payout workflow from submission through payment/closure.
- **Location**: `client/src/pages/staff/claims.tsx` (681 lines); `client/src/pages/client/claims.tsx` (client-portal lodging).
- **Who uses it**: Staff (`write:claim`/`approve:claim`), clients (self-lodge).
- **Database tables**: `claims`, `claimDocuments`, `claimStatusHistory`.
- **APIs**: `/api/claims`, `/api/claims/:id/transition`, `/api/client-auth/claims`.
- **Business logic**: Status machine `submitted→verified|rejected→approved|rejected→scheduled|payable→completed/paid→closed`; every submission auto-creates an `approvalRequests` row and notifies `manage:approvals` holders; `approvalNotes` is a single text field the UI parses into "Assessment"/"Recommendation" via regex rather than separate columns.
- **Claim types**: death, accidental_death, disability, repatriation, cash_in_lieu.
- **Current limitations**: Structured recommendation data stored as unstructured text (regex-parsed), a fragile pattern.

#### B2. Funeral Case Management (Booking/Scheduling)
- **Purpose**: Operational case file coordinating a funeral service — logistics, vehicles, drivers, mortuary, and billing in one hub.
- **Location**: `client/src/pages/staff/funerals.tsx` (3 tabs: Cases/Fleet/Parlours).
- **Database tables**: `funeralCases`, `funeralTasks`, `driverChecklists`.
- **APIs**: `/api/funeral-cases[/:id]`, `/api/funeral-cases/:id/tasks`, `/api/funeral-cases/:id/driver-checklist`.
- **Permissions**: `read:funeral_ops`/`write:funeral_ops`.
- **Business logic**: Two service types — `claim` (policy-linked) or `cash` (requires a pre-existing unused quotation); fixed 90-minute service-window auto-fill with a 15-minute clash-detection buffer across cases; billing tracks Quoted vs Received vs Outstanding.
- **Dependencies**: Fleet (vehicles/drivers), Mortuary (linked intake), Quotations (cash jobs), Claims (claim-linked jobs).

#### B3. Mortuary Register
- **Purpose**: Body intake, storage, post-mortem out/return, and dispatch/release tracking, including partner-parlour billing.
- **Location**: `client/src/pages/staff/mortuary.tsx` (1,432 lines, master/detail, no tabs).
- **Database tables**: `mortuaryIntakes`, `mortuaryDispatches`, `mortuaryPostMortemMovements` (new, migration 0057), `deceasedBelongings`, `bodyWashRequirements`, `partnerParlourVehicleUsage` (new, migration 0057), `partnerParlours`, `parlourPersonnel`.
- **APIs**: `/api/mortuary-intakes[/:id]`, `.../dispatch`, `.../storage-payment`, `.../chapel-wash-bay-payment`, `.../post-mortem`, `/api/post-mortem-movements/:id/return`, `/api/partner-parlour-vehicle-usage`.
- **Business logic**: `serviceScope` = full_service/storage_only/removal_only; storage fee auto-calculated $10 child / $20 adult for partner-parlour intakes; dispatch blocked if unpaid storage fee or body currently out for post-mortem; chapel/wash-bay fee is separate from storage fee.
- **Current limitations**: Storage/chapel fee rates ($10/$20/$20) are hardcoded, not tenant-configurable.

#### B4. Fleet Management
- **Purpose**: Vehicle registry, fuel logs, maintenance, driver assignments, and trip logs.
- **Location**: `funerals.tsx` "Fleet Vehicles" tab; standalone reporting.
- **Database tables**: `fleetVehicles`, `fleetFuelLogs`, `fleetMaintenance`, `driverAssignments`, `vehicleTripLogs`.
- **APIs**: `/api/fleet[/:id]`.
- **Permissions**: `read:fleet`/`write:fleet`.
- **Business logic**: Vehicles referenced by both funeral cases (removal/burial) and mortuary intakes (removal); PDF generators for registration, fuel log, maintenance, driver assignment, trip log (Forms 23–28).

#### B5. Driver Checklist
- **Purpose**: Pre-departure readiness checklist per funeral case (equipment, fuel, toll gate, driver allowance).
- **Location**: `DriverChecklistDialog` in `funerals.tsx`.
- **Database tables**: `driverChecklists` (UNIQUE per case).
- **APIs**: `/api/funeral-cases/:id/driver-checklist[/pdf]`.
- **Business logic**: One checklist per case (DB-enforced uniqueness); PDF pulls vehicle + driver + attending-agent contact detail including emergency contacts.

#### B6. Partner Parlour Management
- **Purpose**: Manage external parlour relationships (storage referrals, vehicle borrowing) and their personnel.
- **Location**: `funerals.tsx` "Partner Parlours" tab.
- **Database tables**: `partnerParlours`, `parlourPersonnel`.
- **APIs**: `/api/partner-parlours[/:id]`, `.../personnel`.
- **Permissions**: `write:funeral_ops` gates edit actions specifically (`canWriteFuneralOps`).

#### B7. Funeral Quotations (Cash Service Quotes)
- **Purpose**: Client-facing price quote for non-policy ("cash") funeral jobs, with VAT/discount and guarantor/collateral support for part-payment plans.
- **Location**: `client/src/pages/staff/quotations.tsx` (937 lines).
- **Database tables**: `funeralQuotations`, `funeralQuotationItems`, `quotationGuarantors`, `quotationCollateral`, `serviceReceipts`.
- **APIs**: `/api/quotations[/:id]`, `.../guarantor`, `.../collateral`, `.../link-case`, `.../send-for-authorization`, `/api/funeral-cases/:id/quotation`, `/api/funeral-cases/:id/receipts`.
- **Business logic**: `STANDARD_ITEMS` — a hardcoded 15-line default cost breakdown pre-seeded into every new quote; `grandTotal = max(0, subtotal + VAT − discount)`; `conversionStatus` pending/partial/converted once linked to a case and paid; 2.5% platform fee posted on each service receipt via outbox.
- **Current limitations**: `STANDARD_ITEMS` catalogue is hardcoded in the frontend, not tenant-configurable.

---

## C. Groups, Clients & CRM

#### C1. Client Management (Lead-to-Policyholder Registry)
- **Purpose**: Manage the client/policyholder record from lead capture through conversion, including dependents/beneficiaries and documents.
- **Location**: `client/src/pages/staff/clients.tsx` — list/detail view (not tabbed).
- **Database tables**: `clients`, `dependents`, `dependentChangeRequests`, `clientDocuments`, `clientDeviceTokens`, `clientPaymentMethods`.
- **APIs**: `/api/clients[/:id]`, `.../dependents`, `.../documents`, `.../payment-methods`.
- **Permissions**: `read:client`/`write:client`.
- **Business logic**: A client is a "lead" until a policy is issued; once linked, the client record becomes read-only ("Locked — edit via policy"); activation-code flow issues a one-time code for client-portal self-enrollment.
- **Current limitations**: No DB-level UNIQUE constraint on national ID/email (composite indexes are lookup aids only) — duplicate national IDs are technically permitted.

#### C2. Groups & Legacy Groups
- **Purpose**: Manage collective policyholder entities (employer/community/church groups), including pre-migration "legacy" groups with simplified lump-sum billing.
- **Location**: `client/src/pages/staff/groups.tsx`.
- **Database tables**: `groups` (flag `isLegacy`), `groupPaymentIntents`, `groupPaymentAllocations`; legacy receipts are raw-SQL rows, not a Drizzle table (`legacy_group_receipts`).
- **APIs**: `/api/groups[/:id]`, `.../policies`, `.../receipts`, `/api/groups/legacy-receipts`, `/api/group-payment-intents`, `/api/group-receipt`.
- **Business logic**: Legacy groups allow name-only member capture (no national ID/DOB) until any policy exists; group receipts require single-currency selection across chosen policies; backdated group receipts route to an approval queue instead of posting immediately; 2.5% platform fee posted per receipt, stamped with the receipt's own payment date for legacy receipts (not "now").
- **Current limitations**: "Legacy group" is not a separate schema — it's an `isLegacy` boolean plus a raw-SQL receipts table, which is harder to evolve than a first-class Drizzle model.

#### C3. Leads / CRM Pipeline
- **Purpose**: Sales pipeline tracking from prospect capture through policy conversion.
- **Location**: `client/src/pages/staff/leads.tsx` — 6-column Kanban board (drag-and-drop, native HTML5, not a library).
- **Database tables**: `leads`.
- **APIs**: `/api/leads[/:id]`.
- **Permissions**: `read:lead`/`write:lead`; agents see only their own leads.
- **Business logic**: `effectiveStage()` maps multiple historical/legacy DB stage strings onto 6 canonical Kanban columns (New/Contacted/Qualified/Quoted/Converted/Lost); "Issue Policy" deep-links a converted lead directly into policy creation pre-filled with `clientId`.

#### C4. Directory Contacts (Undertakers / Underwriters / Brokers / Transport / Agents / Branches)
- **Purpose**: Shared reference directories for external parties and internal org structure.
- **Location**: `staff/admin/{agents,branches,brokers,undertakers,underwriters}.tsx`, `staff/tools/{contacts,transport-companies}.tsx` — 5 of these are thin wrappers around a shared `DirectoryPage` component.
- **Database tables**: `directoryContacts` (type discriminator: undertaker/underwriter/transport_company/contact/emergency/supplier), `branches`.
- **APIs**: `/api/directory-contacts[/:id]`, `/api/branches`, `/api/agents`.
- **Current limitations**: Agent Admin page is read-only (directory join of `/api/agents` + commission report) — actual agent account management happens in Users, not here; Branch Admin has create+list only, no edit/delete UI.

---

## D. Payments, Finance & Accounting

#### D1. Premium Payments — PayNow (Online)
- **Purpose**: End-to-end mobile-money/card premium collection via Zimbabwe's PayNow gateway.
- **Location**: `staff/finance.tsx` "Mobile & Cash" tab; `client/src/pages/client/payments.tsx` (client-initiated).
- **Server**: `server/payment-service.ts`, `paynow-config.ts`, `paynow-hash.ts`, `policy-status-on-payment.ts`.
- **Database tables**: `paymentIntents`, `paymentEvents`, `paymentTransactions`, `paymentReceipts`.
- **APIs**: `/api/payment-intents[/:id/{initiate,poll,otp}]`, `/api/client-auth/payment-intents/*`, `POST /api/payments/paynow/result` (webhook).
- **Business logic**: Idempotent intent creation; per-org PayNow credentials take priority over platform env vars, and an org-lookup failure disables config rather than falling back to the platform merchant (prevents cross-tenant leakage); amount-mismatch guard (within 1 cent) before activating; both a result webhook AND client-side polling exist since PayNow's webhook delivery is unreliable; supports EcoCash, OneMoney, InnBucks, O'Mari (OTP step), Visa/Mastercard.
- **Dependencies**: Outbox pattern for post-payment side effects (PDF, platform fee, commission, notifications).

#### D2. Premium Payments — Manual/Cash Receipting
- **Purpose**: Staff-recorded cash/EFT/other payments against a policy.
- **Location**: `staff/finance.tsx` "Payments & Receipts" tab.
- **APIs**: `POST /api/payments`, `POST /api/admin/receipts/cash`.
- **Business logic**: Premium-override guard — a submitted amount not matching `premium × months` (within 1 cent) is held for approval (`approvalStatus: pending`) rather than clearing instantly, requiring `edit:premium` + a submitter note, and `approve:finance` to release; duplicate idempotency key returns 409 rather than 500.

#### D3. Credit Balance Auto-Apply
- **Purpose**: Automatically apply a policy's positive wallet/credit balance to due premiums.
- **Location**: `staff/finance.tsx` "Apply credit balances" button; `server/credit-apply.ts`.
- **Database tables**: `policyCreditBalances`, `policyPremiumChanges`.
- **APIs**: `POST /api/apply-credit-balances`.
- **Business logic**: `computePolicyOutstanding()` is the single source of truth for a policy's arrears/credit figure (`periodsElapsed × premium − totalPaid`, folded with signed wallet balance), used across reports and the client portal alike.

#### D4. Month-End Batch Receipting
- **Purpose**: Bulk-process an uploaded bank-statement CSV to receipt many policies at once.
- **Location**: `staff/finance.tsx` "Month-End Close" tab (`MonthEndRunUpload`).
- **Database tables**: `monthEndRuns`, `creditNotes`.
- **APIs**: `GET /api/month-end-run/template`, `POST /api/month-end-run`.
- **Business logic**: Postgres advisory lock serializes concurrent runs; full/over-payment → cleared transaction + receipt + 2.5% platform fee; underpayment → credit balance + credit note instead.

#### D5. Cashups (Cash Reconciliation)
- **Purpose**: Daily shift/day-end reconciliation of cash collected vs. counted, by payment method.
- **Location**: `staff/finance.tsx` "Cash-up Reconciliation" tab.
- **Database tables**: `cashups`.
- **APIs**: `/api/cashups[/:id]`, `/api/cashups/my-receipt-totals`.
- **Business logic**: Maker-checker (draft→submitted→confirmed), with `discrepancyAmount` computed between expected and counted totals; cashup can be locked once confirmed.

#### D6. Requisitions & Disbursements
- **Purpose**: Formal spend-request → approve/reject → pay workflow, supporting partial/installment payment and departmental cost-center tagging.
- **Location**: `staff/finance.tsx` "Requisitions" tab.
- **Database tables**: `requisitions`, `requisitionItems`, `paymentDisbursements` (polymorphic entityType/entityId, shared with Expenditures).
- **APIs**: `/api/requisitions[/:id]`, `.../payments`, `/api/requisitions/:id/pdf`.
- **Permissions**: `write:finance` (raise), `approve:finance` (approve/reject).
- **Business logic**: `department`/`costFlag` free-text tagging added migration 0058 for cost-center reporting (e.g. `CEO_PERSONAL`); `paymentDisbursements` is the single unified cash-out ledger feeding both the income statement and cash-flow statement.
- **Current limitations**: `entityId` on `paymentDisbursements` is a polymorphic FK with no real database-level referential-integrity constraint.

#### D7. Expenditures
- **Purpose**: General operating expense recording, simpler than the full requisition workflow, supporting partial payment.
- **Location**: `staff/finance.tsx` "Expenditures" tab.
- **Database tables**: `expenditures`.
- **APIs**: `/api/expenditures[/:id/payments]`.

#### D8. Banking (Accounts, Deposits, Statement Balances)
- **Purpose**: Track the org's bank accounts, physical cash deposits, and periodic statement reconciliation.
- **Location**: `staff/finance.tsx` "Banking & Cash" tab.
- **Database tables**: `bankAccounts`, `bankDeposits`, `bankStatementBalances`.
- **APIs**: `/api/bank-accounts`, `/api/bank-deposits[/:id/verify]`, `/api/bank-statement-balances`.
- **Business logic**: Maker-checker on deposits (depositedBy/verifiedBy); statement balances feed the balance sheet's bank-asset line.

#### D9. Debit Orders
- **Purpose**: Recurring bank-debit mandates as an alternative premium-collection channel to PayNow.
- **Location**: `staff/transactions/debit-orders.tsx` — the only real page among 7 sibling `/staff/transactions/*` routes (others are stubs).
- **Database tables**: `debitOrders`.
- **APIs**: `/api/debit-orders[/:id]`.
- **Business logic**: Frequencies weekly/biweekly/monthly/quarterly; Pause/Resume/Cancel actions; KPI tile sums only active + monthly-frequency mandates for "Monthly Value".

#### D10. FX Rates
- **Purpose**: USD-base currency conversion rates for consolidated multi-currency financial statements.
- **Location**: `staff/finance.tsx` "FX Rates" tab.
- **Database tables**: `fxRates` (per-org, UNIQUE per currency).
- **APIs**: `/api/fx-rates`, `PUT /api/fx-rates/:currency`.
- **Permissions**: `manage:settings`.
- **Current limitations**: Per-org, not shared/global — every tenant must maintain its own FX table even though real-world FX rates are the same for everyone (flagged for control-plane discussion).

#### D11. Financial Statements (Income Statement, Cash Flow, Balance Sheet)
- **Purpose**: Auto-generated cash-basis financial reporting derived from transactional tables plus manual entries.
- **Location**: `staff/reports.tsx` "Finance" section.
- **Server**: `server/financial-statements.ts`.
- **Database tables**: Derived from `paymentTransactions`/`serviceReceipts`/`legacy_group_receipts`/`paymentDisbursements`/`commissionLedgerEntries`/`claims`/`platformReceivables`; manual entries in `balanceSheetEntries`.
- **APIs**: `/api/reports/income-statement`, `/api/reports/cash-flow`, `/api/reports/balance-sheet`, `/api/balance-sheet-entries`.
- **Business logic**: Income = individual + group + cash-service + legacy-group premium income; balance sheet includes unsettled `platformReceivables` as a liability (see Platform Fee finding below); equity = retained earnings derived by re-running the income statement from `2000-01-01`.

#### D12. Platform Fee / Revenue Share
- **Purpose**: POL263's own 2.5% cut of nearly every cleared premium/service payment across all tenants.
- **Location**: `staff/finance.tsx` "Platform Fees" tab.
- **Database tables**: `platformReceivables`, `settlements`, `settlementAllocations` (defined but unused).
- **APIs**: `/api/platform/receivables`, `/api/platform/summary`, `/api/settlements[/:id/approve]`.
- **Business logic**: Charged uniformly across 10 distinct code paths (individual/group PayNow, cash, credit-balance, month-end, legacy group, service receipts, approved backdated/override receipts) — always `amount × 0.025`, hardcoded, not tenant-configurable.
- **Current limitations (verified, not guesses)**: `isSettled` is never set `true` anywhere in the codebase, so "Total Settled" always reads $0 and the balance sheet's "Platform fees payable" liability only ever grows; `settlementAllocations` exists in schema but is never referenced by any query; no clawback/reversal exists for platform fees on payment reversal (unlike agent commissions, which do have clawback); the Finance page's Daily-Due/MTD/Aging tiles compute client-side from a single unpaginated page (up to 100 rows) rather than a true aggregate, understating figures for high-volume tenants; no cross-tenant aggregate view exists anywhere for POL263 itself to see total revenue owed across all tenants (each tenant's ledger is siloed in its own database).

#### D13. Commissions & Agent P&L
- **Purpose**: Agent commission earning, clawback, and self-service profitability view.
- **Location**: `staff/finance.tsx` "Commissions" and "My P&L" tabs.
- **Database tables**: `commissionPlans`, `commissionLedgerEntries`.
- **APIs**: `/api/commission-plans`, `/api/commission-ledger`, `/api/agent/pnl`.
- **Business logic**: Rate schedule from product version or org's active commission plan; first-N-months rate then recurring rate; clawback reverses unpaid commission if a policy lapses within a threshold, with a matching rollback if later reinstated (net-zero over a lapse→reinstate cycle).

#### D14. Approvals (Maker-Checker Hub)
- **Purpose**: Central review queue for actions requiring a second approver.
- **Location**: `staff/approvals.tsx` — Pending / Resolved / Waivers tabs.
- **Database tables**: `approvalRequests`, `waitingPeriodWaivers`.
- **APIs**: `/api/approvals[/:id/resolve]`, `/api/waivers/:id/resolve`.
- **Business logic**: Generic polymorphic envelope (`entityType`/`entityId`/`requestData` JSON) reused for policy/receipt/quote deletion, claim review, waiver resolution, quotation-conditions authorization, and settlement approval; self-approval is explicitly blocked wherever checked.

---

## E. HR & Payroll

#### E1. Payroll
- **Purpose**: Employee records, payroll runs, and payslip generation/emailing.
- **Location**: `staff/payroll.tsx` — Employees / Payroll Runs tabs.
- **Database tables**: `payrollEmployees`, `payrollRuns`, `payslips`.
- **APIs**: `/api/payroll/employees[/:id]`, `/api/payroll/runs[/:id]`, `.../payslips/:employeeId[/pdf|/send]`, `.../send-all`.
- **Business logic**: `calcPayslip` — gross = (base+housing+transport+otherAllowances) × prorated-day factor; deductions = funeral policy + other insurance + NSSA/PAYE/AIDS-levy (each toggle-gated per employee); statutory amounts entered manually per run, not auto-calculated from a formula; proration excludes weekends.
- **Current limitations**: Zimbabwe-specific statutory deduction toggles (NSSA/PAYE/AIDS Levy) are hardcoded to Zimbabwean tax categories — not generalized for other jurisdictions.

#### E2. Attendance
- **Purpose**: Daily attendance logging with supervisor approval.
- **Location**: `staff/attendance.tsx` — My Attendance / Team Attendance tabs.
- **Database tables**: `attendanceLogs` (UNIQUE per employee+date).
- **APIs**: `/api/attendance`, `/api/attendance/my`, `.../:id/approve|reject`.
- **Business logic**: Self-logged entries start `pending`; unauthorized users viewing "Team Attendance" get an empty list (403 silently swallowed) rather than an error.

---

## F. Notifications, Communication & Personal Tools

#### F1. Client Notification Templates & Automation
- **Purpose**: Configurable multi-channel messaging to clients keyed to system events, plus automated payment-reminder scheduling.
- **Location**: `staff/notifications.tsx` — Payment Automation Triggers / Automation Activity / Message Templates.
- **Database tables**: `notificationTemplates`, `notificationLogs`, `paymentAutomationSettings`, `paymentAutomationRuns`.
- **APIs**: `/api/notification-templates[/:id]`, `/api/notification-merge-tags`, `/api/admin/notifications/broadcast`, `/api/payment-automation-settings`, `/api/payment-automation-runs`, `/api/admin/run-payment-automation`.
- **Business logic**: 18 built-in event types with a `DEFAULT_MESSAGES` fallback if no org template configured; ~23 merge tags; automation config drives push reminders + mobile-wallet payment prompts (not unattended card billing).
- **Current limitations**: No SMS/WhatsApp send capability actually wired despite schema/UI scaffolding for those channels (see Section 7/9 for detail) — only in-app/push/email actually fire.

#### F2. Staff/Agent In-App Notifications
- **Purpose**: Internal notification inbox for staff/agents, delivered via three parallel channels.
- **Server**: `server/user-notifications.ts`, `push.ts`, `sse.ts`.
- **Database tables**: `userNotifications`, `userDeviceTokens`.
- **APIs**: `/api/notifications[/stream|/unread-count|/:id/read|/mark-all-read]`, `/api/agent-auth/push-token`.
- **Business logic**: One call fires in-app persistence + SSE (if a tab is open) + Expo push, in parallel; documented (not yet built) Redis-backed upgrade path past 500 concurrent users.

#### F3. Reminders
- **Purpose**: Personal per-user to-do list, synced across devices.
- **Location**: `staff/reminders.tsx`.
- **Database tables**: `reminders`.
- **APIs**: `/api/reminders[/:id]`.
- **Current limitations**: `priority`/`isCompleted` fields exist in schema but aren't exposed in the UI (create/delete only).

#### F4. Help Center
- **Purpose**: Static FAQ + quick links; doubles as an informal plain-English feature map.
- **Location**: `staff/help-center.tsx` — no API calls, hardcoded content.

#### F5. Order Services (Landing Hub)
- **Purpose**: Redirect hub for deprecated "Order SMS & Prepaid" functionality, now consolidated elsewhere.
- **Location**: `staff/order-services.tsx` — pure links to Notifications/Finance/Products, no forms or API calls of its own.

#### F6. Diagnostics
- **Purpose**: Ops-facing system health, notification failure, unallocated-payment, and error-log views.
- **Location**: `staff/diagnostics.tsx` — 4 tabs.
- **APIs**: `/api/diagnostics/health|notification-failures|unallocated-payments|recent-errors`.
- **Current limitations**: "Unallocated Payments" tab is an unimplemented stub (`always returns []`).

---

## G. Reports & Analytics

#### G1. Dashboard (Home)
- **Purpose**: At-a-glance KPI overview, executive financial summary, and (flag-gated) role-based command centers.
- **Location**: `staff/dashboard.tsx`.
- **APIs**: `/api/dashboard/stats|revenue-trend|policy-status-breakdown|lead-funnel|covered-lives|product-performance|lapse-retention|executive-summary`.
- **Business logic**: Control-plane mode (platform owner, no tenant selected) shows a different cross-tenant KPI view entirely; admin-cash "staleness" rule flags unbanked cash on-hand for >2 days.

#### G2. Dynamic Reports
- **Purpose**: The main ad-hoc reporting surface — 6 sections / 29 tabs covering policies, finance, agents, claims, operations, payroll.
- **Location**: `staff/reports.tsx` (2,463 lines) + `client/src/lib/staff-reports-nav.ts`.
- **APIs**: ~25 `GET /api/reports/*` endpoints plus the mega-export `GET /api/reports/export/:type` (~50 supported types).
- **Current limitations**: The export mega-route is gated by a single permission (`read:policy`) even for finance/commission/payroll report types — a broad-authorization design choice worth flagging; several `:type` values are unimplemented stubs (e.g. `complaint-report`); `pre-lapse` and `overdue` report types return identical query logic (duplicate).

#### G3. Statistics & Statistical Graphs
- **Purpose**: Read-only KPI tables and chart visualizations (revenue trend, policy status mix, retention/lapse, per-product performance).
- **Location**: `staff/statistics.tsx`, `staff/statistical-graphs.tsx` — legacy-nav only, no mutation capability.

#### G4. Employee Reports (Legacy Commission/Payroll Export Catalogue)
- **Purpose**: A large catalogue (41 report types across 7 groups) of legacy agent/cashier/audit/payroll/commission CSV exports.
- **Location**: `staff/employee-reports.tsx`.
- **APIs**: `/api/reports/export/:type` (shared with G2).
- **Current limitations**: Appears to be a port of an older desktop insurance system's report menu (naming like "Select Count"); all reports share the same 4 filter params regardless of shape.

#### G5. Schedule & Department Reports
- **Purpose**: Daily service schedule PDF and per-department (6 departments) operational reports.
- **Location**: `staff/schedule-reports.tsx`.
- **APIs**: `/api/schedule/pdf`, `/api/department-report/pdf`.

#### G6. Audit Trail
- **Purpose**: Searchable viewer over the universal before/after change ledger.
- **Location**: `staff/audit.tsx`.
- **Database tables**: `auditLogs`.
- **APIs**: `/api/audit-logs`.
- **Business logic**: Every mutation across the app calls `auditLog()`; UI shows raw before/after JSON diff per entry.

#### G7. Asset Register
- **Purpose**: Nominally an asset checklist; actually a component-local-state-only placeholder.
- **Location**: `staff/assets-register.tsx` (58 lines).
- **Current limitations**: Explicitly documented in its own UI copy as session-only — **not wired to any backend table** despite being reachable via real navigation with a permission gate (`read:audit_log`).

---

## H. Identity, Tenancy & Platform Administration

#### H1. User & RBAC Management
- **Purpose**: Staff account CRUD, role assignment, and permission matrix management.
- **Location**: `staff/users.tsx`; `staff/settings.tsx` "RBAC" tab.
- **Database tables**: `users`, `roles`, `permissions`, `rolePermissions`, `userRoles`, `userPermissionOverrides`.
- **APIs**: `/api/users[/:id]`, `.../reassign-policies`, `/api/roles[/:id/permissions/:permId]`, `/api/permissions`, `/api/admin/sync-permissions`.
- **Business logic**: Agent-role deletion triggers a mandatory reassignment-or-unassign step for that agent's policies; deletion is a soft "deactivate," not hard delete; superuser role hidden from the picker unless the acting user already holds `create:tenant`.

#### H2. Tenant Management
- **Purpose**: Create/edit/switch/delete tenant organizations (platform-owner function).
- **Location**: `staff/settings.tsx` "Tenants" tab (the standalone `/staff/tenants` route is an orphaned redirect to this same tab).
- **Database tables**: `organizations` (main schema) + `tenants`/`tenantDatabases`/`tenantDomains` (control-plane schema).
- **APIs**: `/api/organizations[/:id]`, `/api/platform/switch-tenant`, `/api/platform/active-tenant`, `/api/platform/dashboard`.
- **Permissions**: `create:tenant`, `delete:tenant`.
- **Business logic**: Creating a tenant seeds a default "Head Office" branch and the full role/permission map; deletion is blocked if the org has any non-platform-owner users, and soft-renames rather than hard-deletes.

#### H3. Branding / White-Label
- **Purpose**: Per-tenant visual identity across UI, PDFs, and receipts.
- **Location**: `staff/settings.tsx` "Branding" tab.
- **Database tables**: `organizations` branding columns + duplicated `tenantBranding` in the control-plane schema.
- **APIs**: `PATCH /api/organizations/:id`, `/api/upload/logo|signature|receipt-advert-image`.
- **Current limitations**: Branding fields are duplicated across two schemas (main `organizations` vs. control-plane `tenantBranding`) with at least one type inconsistency (`policyNumberPadding` integer vs. text) — a data-consistency risk.

#### H4. Receipt Adverts
- **Purpose**: Promotional image/text shown at the bottom of printed thermal receipts.
- **Location**: `staff/settings.tsx` "Branding" tab, "Receipt Adverts" section.
- **Database tables**: `receiptAdverts`.
- **APIs**: `/api/receipt-adverts[/:id/activate|/deactivate]`.
- **Business logic**: Single-active-advert-per-org pattern enforced server-side.

#### H5. Terms & Conditions Library
- **Purpose**: Legal clauses attachable to product versions, shown on policy documents.
- **Location**: `staff/settings.tsx` "Terms" tab; also `products.tsx` "Terms & Conditions" tab.
- **Database tables**: `termsAndConditions`.
- **APIs**: `/api/terms[/:id]`.

#### H6. Payment Gateway Configuration (PayNow, per-tenant)
- **Purpose**: Each tenant's own PayNow merchant credentials.
- **Location**: `staff/settings.tsx` "Payments" tab.
- **Database tables**: `organizations` (paynow* columns).
- **APIs**: `PATCH /api/organizations/:id` (whitelisted fields), `GET /api/paynow-config`.
- **Business logic**: Integration Key is never round-tripped to the UI in cleartext once set (blank = unchanged).

#### H7. App Release Management
- **Purpose**: Track native app (APK) releases for version-enforcement across all tenants.
- **Location**: No dedicated staff UI found; consumed by `agent/download.tsx`.
- **Database tables**: `appReleases` (global, no organizationId).
- **APIs**: `/api/platform/app-release[s]`, `/api/public/agent-app-latest`, `/api/app-info`.
- **Permissions**: Platform-owner only for writes.

---

## I. Client, Agent & Public-Facing Surfaces

#### I1. Client Portal
- **Purpose**: Self-service policyholder portal — policy overview, payments, dependents/beneficiary management, claims, documents, feedback, notification settings.
- **Location**: `client/src/pages/client/*` — Overview/Payments/Members/Alerts/Account tabs on the dashboard; separate Claims/Documents/Feedback/Payments pages.
- **Auth**: Policy number + password (or Google OAuth), separate session domain from staff.
- **APIs**: `/api/client-auth/*` (~35 endpoints).
- **Business logic**: `isPolicyClaimable()` (status active/grace AND waiting period elapsed) encoded directly in client UI; "pay for someone else" lookup (phone/policy/national-ID) with a 10-minute session grant; beneficiary capped at exactly 1 per policy.

#### I2. Agent Portal (Web + Native)
- **Purpose**: Field-agent access to own book of business, referrals, and commission.
- **Location**: `client/src/pages/agent/{login,download}.tsx` (web); separate standalone Expo/React Native app (`agent-app/`, offline-first with local SQLite sync).
- **Auth**: Email + password only (explicitly no Google OAuth for agents).
- **Business logic**: Agent-scoped data access (`enforceAgentScope`) but NOT applied to users who hold an agent role alongside a superior role; referral codes drive client-to-agent auto-assignment on enrollment.
- **Current limitations**: The native agent app is a materially different tech stack (React Native/Expo vs. Capacitor-wrapped web) requiring separate maintenance.

#### I3. Public Registration / Onboarding Funnel
- **Purpose**: End-to-end self-service policy purchase, from agent-referral or walk-in landing page through account claim and first login.
- **Location**: `client/src/pages/join.tsx` → `join/register.tsx` → `client/claim.tsx` → `client/login.tsx`.
- **APIs**: `/api/public/registration-options|walkin-options`, `/api/public/register-policy|walkin-register`, `/api/client-auth/claim|enroll`.
- **Business logic**: Registration produces a policy number + activation code, consumed by the claim flow to set up portal credentials — one continuous funnel across 4 pages.

#### I4. Document Verification (QR)
- **Purpose**: Public, unauthenticated authenticity check for receipts/policies/forms via a QR code.
- **Location**: `client/src/pages/verify.tsx`.
- **APIs**: `GET /api/public/verify`.
- **Business logic**: No auth required; explicitly an anti-fraud/document-integrity feature.

---

## J. Cross-Cutting Infrastructure (not user-facing "features" but load-bearing)

#### J1. Outbox Pattern
- **Purpose**: Transactional at-least-once delivery of post-payment side effects (PDF generation, platform fee, commission, notifications).
- **Server**: `outbox.ts`/`outbox-handlers.ts`/`outbox-constants.ts`.
- **Database tables**: `outboxMessages`.
- **Business logic**: Insert-in-same-transaction, drain asynchronously with row-locking (`FOR UPDATE SKIP LOCKED`), max 8 retry attempts before permanent failure.

#### J2. Job Queue
- **Purpose**: Minimal in-process fire-and-forget background dispatcher.
- **Server**: `job-queue.ts`.
- **Current limitations**: In-memory only — explicitly documented as needing a Redis/BullMQ swap before running more than one app instance (currently `instance_count: 1`).

#### J3. Backup / Sync
- **Purpose**: Daily full mirror of all tenant + control-plane + registry data into an off-platform Supabase instance for disaster recovery.
- **Server**: `backup-sync.ts`.
- **Business logic**: Full (not incremental) daily sync; upsert-only (deletes never propagate, by design); guarded by a Postgres advisory lock so only one instance runs it.

---



---

# Section 3 — Menu Map (Part 1: Staff pages batch A/B/C + Agent/Client/Join portals)

> This is part 1 of 2. See `section03-menumap-part2.md` for App.tsx route table, the sidebar/nav component structure (Legacy vs New Nav), and the remaining large staff pages (dashboard, finance, mortuary, policies, claims, products, pricebook, quotations, reports, assets-register, audit) plus admin/tools/transactions subdirectories.

## Batch A — clients.tsx / funerals.tsx / groups.tsx / users.tsx / payroll.tsx / attendance.tsx

### 1. `client/src/pages/staff/clients.tsx` — Route: `/staff/clients`

**Sidebar location(s):** Legacy nav — Administration menu → "Clients". New nav — Clients bucket → "Clients".

**Tabs/sub-sections:** No `Tabs` component. Two view modes controlled by local state (`viewMode: "list" | "detail"`), not URL-routed tabs:
- **List view**: KPI cards (Total records, Leads (no policy), Converted, Conversion rate) + "Lead & client registry" table (EnhancedDataTable).
- **Detail view** (opened via row click or `?openClient=<id>` deep link): sections — "Personal Information", "Linked Policies", "Dependents & Beneficiaries", "Client Documents", "Enrollment & Access".

**Dialogs/modals:**
- `CreateClientDialog` — "Add New Client" (capture a lead).
- `EditClientDialog` — "Edit Client" (only available while client has no linked policy — becomes "Locked — edit via policy" once converted).
- `DependentDialog` (reused for add/edit) — "Add Dependent / Beneficiary" and "Edit Dependent / Beneficiary".
- Upload Document `Dialog` — "Upload Document" (file drop zone, document type select: national_id/passport/proof_of_address/birth_certificate/other, optional label).
- "Client Created Successfully" `Dialog` — shows activation code with Copy/Done buttons after create.
- Native `confirm()` used (not a Dialog component) for delete-dependent and delete-document confirmations.
- Blank Forms `DropdownMenu` (not a dialog) — links to Client Registration Form / Dependent Registration Form PDFs.

**Key actions/buttons:**
- List: "Capture Lead" (create), "Blank Forms" dropdown, per-row View / Edit (leads only) / Issue Policy (leads only, routes to `/staff/policies?create=1&clientId=`), search box, status filter (all/leads/converted/active/inactive), export (via EnhancedDataTable `exportable`).
- Detail: Back, Edit (leads only), Issue Policy (leads only), Add Dependent, Edit/Remove dependent, Upload Document, View (external link)/Delete document, Copy activation code.

**Business logic notes:**
- Clients are explicitly "leads" until a policy is issued against them; once a linked policy exists, the client record becomes read-only ("Locked — edit via policy") and Edit/Issue-Policy actions disappear.
- National ID validated client-side via `isValidNationalId` from `@shared/validation` before create.
- Activation-code flow: on creation, an activation code is generated and shown once for the staff member to hand to the client for client-portal enrollment (paired with policy number).

### 2. `client/src/pages/staff/funerals.tsx` — Route: `/staff/funerals`

**Sidebar location(s):** Legacy nav — Transactions menu → "Funeral Files". New nav — Claims bucket → "Funeral Cases".

**Tabs (top-level `Tabs defaultValue="cases"`):**
- `TabsTrigger value="cases"` — "Funeral Cases"
- `TabsTrigger value="fleet"` — "Fleet Vehicles"
- `TabsTrigger value="parlours"` — "Partner Parlours"

Within the Cases tab, selecting a case swaps the "Logistics Board" list for a `CaseDetailView` with these card sections: Deceased, Informant (Next of Kin), Service Details (+ Timeline sub-section), Logistics (Body Removal + Burial Logistics), Attending Agent, Case Status, Mortuary Record (conditional, when linked), Notes (conditional), Cash Service Billing, Task Checklist.

Case create/edit form (`CaseFormDialog`) uses an `Accordion` with items: Deceased Details, Informant (Next of Kin), Service & Burial, Service Timing, Body Identification, Logistics & Attending Agent, Notes.

**Dialogs/modals:**
- `CaseFormDialog` (shared create/edit) — "New Funeral Case" / "Edit Case".
- `AddTaskDialog` — "Add Task" (task name + description for case checklist).
- `CreateVehicleDialog` — "Add Fleet Vehicle".
- `EditVehicleDialog` — "Edit Vehicle".
- Payment `Dialog` — "Record Payment" (amount, currency USD/ZAR/ZiG, payment channel cash/paynow_ecocash/paynow_card/other) against the case quotation.
- `DriverChecklistDialog` — "Driver Checklist — {caseNumber}" (pre-departure checklist: grave tent, lowering device, gloves, masks, fuel gauge, toll gate + amount, driver allowance, burial order ref, driver assignment, completion time; downloadable as PDF).
- `QuoteDialog` (imported from `./quotations`) — full quotation builder reused for cash-service billing on a case.
- Parlour `Dialog` — "Add Partner Parlour" / "Edit Parlour" (name, contact person, phone, email, address).
- Personnel `Dialog` — "Add Contact" / "Edit Contact" (name, role, phone, email) scoped to a selected parlour.
- `AlertDialog` (in `StatusChanger`) — "Confirm status change" (extra warning copy when cancelling a case).

**Key actions/buttons:**
- Header: "Blank Forms" dropdown (Case Worksheet, Funeral Quotation, Driver Checklist, Vehicle Registration, Fuel Log, Maintenance Record, Driver Assignment, Vehicle Trip Log — all open PDFs in new tab), "New Case".
- Case detail: Edit, Share (share/export document), Download PDF, Worksheet PDF, Task Sheet PDF, Driver Checklist; status buttons Open/In Progress/Completed/Cancelled (via `StatusChanger`, guarded by AlertDialog for irreversible changes); Task Checklist: Add Task, per-task checkbox toggle completed/pending; Cash Service Billing: "Quotation" (edit) and "Record Payment" (disabled until quotation has line items).
- Fleet tab: "Add Vehicle", per-row Edit.
- Parlours tab: Add (parlour), Edit (parlour, pencil icon, gated by `write:funeral_ops` permission), Add Contact, Edit/Delete contact (all gated by `canWriteFuneralOps`).

**Business logic notes:**
- Service type drives the whole case form: "cash" service requires an existing linked quotation (created first via the quotations page/dialog) before the case can be submitted; "claim" service requires policy lookup + selecting the deceased covered member, which auto-fills deceased identity fields from `/api/policies/:id/members`.
- Scheduling: a fixed 90-minute service window (body wash → +30min memorial start → +30min memorial end → +30min burial departure) auto-fills empty time fields from whichever one is entered, and `detectClash()` warns (destructive toast) if the proposed window overlaps another case's window within a 15-minute buffer.
- Cash Service Billing tracks Quoted vs Received (sum of non-voided receipts) vs Outstanding, and shows a "PAID IN FULL"/"PARTIALLY PAID" badge based on `quotation.conversionStatus`.
- Driver/Agent dropdowns are populated only from staff users explicitly holding the `driver` / `agent` role, with inline warnings if no such staff exist.
- Times stored in UTC on the server; conversion helpers `utcToDatetimeLocal`/`datetimeLocalToUtc` handle the browser-local `datetime-local` input format.

### 3. `client/src/pages/staff/groups.tsx` — Route: `/staff/groups`

**Sidebar location(s):** Legacy nav — Administration menu → "Employer Admin". New nav — Clients bucket → "Schemes/Employer/Society" (this same route also stands in for "Society Admin" / "Sub Groups" per the nav ground truth, though the page itself shows no separate tabs for those — it's one flat groups registry).

**Tabs/sub-sections:**
- Main page has no top-level `Tabs`; it is a `CardSection` "Group registry" table where clicking a row expands an inline `GroupDetailPanel`.
- `GroupDetailPanel` has its own local section switcher (styled as underline tabs, not `Tabs` component) with three sections: **Members** (`Members (${count})`), **Issue Receipt** (labelled "Issue Receipt" in the tab, content shows `InlineGroupReceiptForm` or `LegacyGroupReceiptForm`), **Receipt History** (labelled "Receipt History", shows `GroupReceiptPrintView`).
- Below the main registry, two more full-width `CardSection`s: **"Legacy Policy Premiums"** (bulk premium override editor) and **"Legacy Group Receipts"** (searchable/filterable receipt ledger with per-currency totals).

**Dialogs/modals:**
- Create Group `Dialog` — "Create New Group" (uses shared `GroupFormFields`).
- Edit Group `Dialog` — "Edit Group".
- Legacy member capture `Dialog` — "Capture Legacy Member — {group.name}" (first/last name only, then redirects to `/staff/policies?create=1&clientId=&groupId=` to issue a policy).
- Assign Existing Policy `Dialog` — "Assign Existing Policy — {group.name}" (select from unassigned policies).
- No dedicated print dialog component — `GroupReceiptPrintView` renders inline within the History tab with a `window.print()` button.

**Key actions/buttons:**
- Registry: "New Group", search, per-row Edit (pencil), row-click to expand detail panel.
- Detail panel header: "Issue Policy" (routes to policy creation, or opens legacy-member dialog if `group.isLegacy`), "Assign Existing".
- Members section: per-member "Print latest receipt", "Remove" (unassign from group).
- Issue Receipt section: For legacy groups with zero policies → `LegacyGroupReceiptForm` (lump-sum receipt: amount, currency, payment date, notes, "Record Payment"). Otherwise → `InlineGroupReceiptForm` (select members who paid via checkboxes + Select All/Deselect All, total amount, receipt date [backdating triggers a required "Notes for approver" field and routes to approval], notes, "Issue receipts (N selected)" / "Submit for approval (N)", optional "Pay via PayNow" button with polling).
- Legacy Policy Premiums section: inline per-row override amount + note inputs, "Clear" per row, batch "Save N changes" button (dirty-tracking).
- Legacy Group Receipts section: search, date-range filter, read-only ledger with per-currency running totals.

**Business logic notes:**
- **Backdated receipt approval workflow**: if the selected receipt date is before today, the inline group receipt form requires an approver note and the mutation returns `pendingApproval: true` instead of issuing receipts immediately — routed to manager review rather than posting to financials right away.
- **Mixed-currency guard**: the group receipt form derives currency from the selected policies and blocks submission if selected policies span more than one currency.
- **PayNow group payments**: creates a `group-payment-intent`, opens the PayNow redirect URL in a new tab, and polls `/poll` every 3s until paid/failed.
- **Legacy groups**: a group flagged `isLegacy` allows members to be captured with name-only (no national ID/DOB/phone), and until any policy exists uses the simpler lump-sum legacy receipt form instead of per-member receipting.
- **Legacy premium override**: lets staff override the system-calculated premium per legacy policy with a note/reason, batch-saved via `/api/policies/legacy/bulk-override`.

### 4. `client/src/pages/staff/users.tsx` — Route: `/staff/users`

**Sidebar location(s):** Legacy nav — Administration menu → "User Admin". New nav — Setup bucket → "Users".

**Tabs/sub-sections:** No `Tabs` component. Single flat page: KPI cards (Total users, Active, Agents) + "Team members" table.

**Dialogs/modals:**
- Add User `Dialog` (`DialogTrigger` on the header "Add User" button) — "Add New User": email, display name, branch (if branches exist), role badges (toggle chips, superuser role hidden unless `isSuperuser`), conditional agent password field (min 8 chars, shown only if "agent" role selected), and a "Personal Details" block (phone, national ID, address, DOB, gender, marital status, next of kin name/phone).
- Edit User `Dialog` — "Edit User", same fields plus Status (Active/Inactive) and optional "New password"; fields are read-only unless `canEditUsers` (`write:user` permission); includes Department field (not in create dialog) and inline "Delete user" button routed to the delete AlertDialog.
- Delete/Reassign `AlertDialog` — "Delete {name}?" — deactivates account; if the target is an agent with assigned policies, shows count and a reassignment `Select` (reassign to another active agent or "Leave unassigned").
- Reset Password `Dialog` — "Reset password" (new password + confirm, min 8 chars, live mismatch/length validation).
- User View `Dialog` (opened by clicking a table row) — read-only full profile card (name, email, phone, national ID, address, DOB, gender, marital status, branch, next of kin, next of kin phone, status, joined date, roles, referral link) with an "Edit" button (if `canEditUsers`) that hands off to the Edit dialog.

**Key actions/buttons:**
- Header: "Add User".
- Table row: click opens View dialog; row actions (stop-propagation): Edit (pencil, always visible), Reset password (key icon, gated `canEditUsers`), Delete (trash icon, gated `canDeleteUsers` and `u.isActive`).
- Referral code: click-to-copy button per user (`/join?ref=<code>` link) shown in both table and view dialog.
- Role assignment via clickable badge chips (multi-select) in both Create and Edit dialogs.

**Business logic notes:**
- **Permission-gated field editing**: non-privileged viewers can open Edit dialog but all fields render read-only (`readOnly`/`disabled` + muted styling) unless `write:user` permission is present; only `canDeleteUsers` sees delete controls.
- **Agent deletion cascade check**: deleting a user who holds the "agent" role triggers a lookup of that agent's assigned policies (`/api/users/:id/agent-policies`); if any exist, staff must choose a reassignment target (or leave unassigned) before the delete/deactivate proceeds via `/api/users/:id/reassign-policies`.
- Deletion is a soft "deactivate" (audit trail and historical policy data preserved), not a hard delete.
- Superuser role is hidden from the role-picker UI unless the acting user already holds `create:tenant` (superuser) permission.

### 5. `client/src/pages/staff/payroll.tsx` — Route: `/staff/payroll`

**Sidebar location(s):** Legacy nav — Finance menu → "Payroll". New nav — Finance bucket → "Payroll".

**Tabs (`Tabs defaultValue="employees"`):**
- `TabsTrigger value="employees"` — "Employees"
- `TabsTrigger value="runs"` — "Payroll Runs"

**Dialogs/modals:**
- Employee `Dialog` — "Add Employee" / "Edit Employee" (large form): System User Account link (optional Select), Personal Details (first/last name, position, department, currency), Employment Details (employment type: permanent/contract/fixed_term/probation/casual, contract start/end dates with expiry warnings), Banking Details (bank name/branch/account number/account type/branch code/SWIFT), Earnings (basic salary, housing allowance, transport allowance, dynamic "Other Allowances" list editor), Fixed Monthly Deductions (funeral policy, other insurance), Zimbabwe Statutory Deductions (NSSA/PAYE/AIDS Levy toggles).
- New Payroll Run `Dialog` — "Create Payroll Run" (period start/end dates, shows computed working-days count).
- No separate payslip dialog — payslip entry happens inline as expandable `PayslipRow` cards under the selected run (not a modal).

**Key actions/buttons:**
- Header: "Blank Enrollment Form" (download link), "Add Employee", "New Payroll Run".
- Employees tab: per-row Edit (pencil).
- Payroll Runs tab: per-run "Enter Payslips" (toggles the selected-run payslip panel open/closed) and "Send All" (emails all payslips in the run, with confirm dialog via native `confirm()`).
- Per-payslip-row (expandable): Switch "Worked full month" / days-worked input with proration %, live-editable NSSA/PAYE/AIDS Levy amounts, "Save Payslip"; once saved — "Print / Preview" PDF, "Download PDF", "Send Email" (per employee).

**Business logic notes:**
- **Payslip calculation** (`calcPayslip`, mirrored server-side): gross = (base + housing + transport + sum(otherAllowances)) × prorated day factor; deductions = funeral policy + other insurance + NSSA + PAYE + AIDS levy (each only applied if enabled per employee); net = gross − deductions, floored at 0 with an amber warning if it would go negative.
- **Proration**: `daysWorked / totalWorkingDaysInPeriod` (weekends excluded via `workingDaysInPeriod`), capped at 1; "full month" toggle bypasses proration entirely (factor = 1).
- **Contract expiry warnings**: both the employee list (badge "Expired"/"Nd left") and the edit dialog compute days-until-contract-end and surface red/amber warnings within 30 days or after expiry, for non-permanent employment types.
- Statutory deduction toggles (NSSA/PAYE/AIDS Levy) are configured per employee as on/off flags; actual amounts are entered manually per payroll run rather than auto-calculated from a formula.
- Payslip send: bulk "Send All" only reaches employees who have a linked user account with an email address (failures reported per-employee count).

### 6. `client/src/pages/staff/attendance.tsx` — Route: `/staff/attendance`

**Sidebar location(s):** Legacy nav — Finance menu → "Attendance". New nav — Finance bucket → "Attendance".

**Tabs (`Tabs defaultValue="my"`):**
- `TabsTrigger value="my"` — "My Attendance"
- `TabsTrigger value="team"` — "Team Attendance" (shows a destructive-badge count of pending approvals when > 0)

Within "My Attendance": two `CardSection`s — "Log Today's Attendance" and "My Attendance History". Within "Team Attendance": one `CardSection` "Team Attendance" with filters + table.

**Dialogs/modals:**
- Approve `Dialog` — "Approve Attendance" (optional approval notes textarea, confirm button "Approve").
- Reject `Dialog` — "Reject Attendance" (reason textarea, required in spirit though not enforced disabled state shown, "Reject" button).

**Key actions/buttons:**
- Header: "Blank Attendance Log" (download link).
- My Attendance: date picker + notes + "Log Attendance" button (self-service daily log).
- Team Attendance: Date filter, Status filter (all/pending/approved/rejected), "Clear" filters button; per-pending-row "Approve" / "Reject" action buttons; approved/rejected rows show timestamp instead.

**Business logic notes:**
- **Approval workflow**: every self-logged attendance entry starts as `pending` and requires a manager/admin (someone with attendance-approval access, gated server-side — team tab query treats a 403 as an empty list rather than throwing) to Approve or Reject via the two dialogs, each optionally annotated with notes/reason.
- The "Team Attendance" tab is effectively permission-gated: unauthorized users simply see an empty table (403 silently swallowed to `[]`) rather than an error, so this tab's usefulness depends on the `write:payroll`-style permission mentioned in code comments.
- Query key includes filter values (`{ date, status }`) so each filter combination is cached independently by TanStack Query.

---

## Batch B — notifications.tsx / reminders.tsx / order-services.tsx / leads.tsx / approvals.tsx / diagnostics.tsx / help-center.tsx / coming-soon.tsx / login.tsx

### 1. notifications.tsx

**File path**: `client/src/pages/staff/notifications.tsx`
**Route(s)**: `/staff/notifications` → `StaffNotifications`

**Sidebar location(s)**:
- LEGACY NAV: Tools menu → "SMS Tools"
- NEW NAV: Setup bucket → "Notifications / SMS"
- Also linked from `order-services.tsx` ("Open notifications" button) and `help-center.tsx` ("SMS templates" quick link)

**Tabs/sub-sections**: None (no `Tabs`/`TabsTrigger` component used). Page is organized into stacked `CardSection`s instead:
1. Payment Automation Triggers (settings form)
2. Automation Activity (table of recent automation runs)
3. Message Templates (table of notification templates)

**Dialogs/modals**:
- **Send Broadcast** (`Dialog`, triggered by "Broadcast" button in page header) — subject + body fields with a merge-tag inserter, sends a one-off notification to all clients via `POST /api/admin/notifications/broadcast`.
- **Create/Edit Notification Template** (`Dialog`, triggered by "New Template" button or row's Edit pencil icon) — form with Template Name, Event Trigger (`Select`, dynamic list from `/api/notification-merge-tags` eventTypes), Channel (`Select`: In-App/SMS/Email/WhatsApp), Subject, Message Body (with `MergeTagPicker` popover for inserting dynamic tags like `{client_name}`), and a live preview panel that substitutes sample data into merge tags before saving.
- Inline `MergeTagPicker` is a custom absolutely-positioned popover (not a real Radix component) listing available merge tags with descriptions/examples — used inside both the broadcast and template dialogs.

**Key actions/buttons**: Broadcast (header), New/Edit Template (header + row), Insert Tag (popover), toggle template Active (`Switch` per row), Edit template (pencil icon), Delete template (trash icon, uses native `confirm()`), Save Triggers (automation settings), Run Now (manually triggers `/api/admin/run-payment-automation` immediately).

**Business logic notes**:
- Payment Automation Triggers configure a scheduled job: after N days since last payment, and repeating every M days, the system can (a) send push reminders and (b) send a mobile wallet payment prompt (EcoCash-style) to the client's saved number for PIN-based approval — explicitly "not unattended card billing."
- Automation Activity table surfaces `actionType`, `status`, `methodType` per run — useful for auditing automated dunning behavior.
- Merge tag preview substitutes ~20 different placeholder types (client name, policy number, premium, currency, payment schedule, birthday, waiting-period end, etc.), indicating notification templates are reused across many trigger event types (payment receipt, birthdays, anniversaries, grace period, waiting period).

### 2. reminders.tsx

**File path**: `client/src/pages/staff/reminders.tsx`
**Route(s)**: `/staff/reminders` → `StaffReminders`

**Sidebar location(s)**:
- LEGACY NAV: Tools menu → "Reminders"
- Also in the user account dropdown menu
- Also linked from `help-center.tsx` ("My reminders" quick link)

**Tabs/sub-sections**: None. Two stacked `CardSection`s: "New reminder" (create form) and "Your list" (list view).

**Dialogs/modals**: None.

**Key actions/buttons**: "Add reminder" (submit new reminder: title, optional due date, optional notes), per-item Delete (trash icon button, no confirmation dialog — immediate delete via mutation).

**Business logic notes**: Simple personal-scope CRUD list (title/description/dueDate/priority/isCompleted) synced per staff user account across devices — no organization-wide visibility implied, straightforward `/api/reminders` REST resource with no bulk actions, priority editing, or completion toggle exposed in the UI despite the type including `priority` and `isCompleted` fields.

### 3. order-services.tsx

**File path**: `client/src/pages/staff/order-services.tsx`
**Route(s)**: `/staff/order-services` → `StaffOrderServices`

**Sidebar location(s)**:
- LEGACY NAV: Tools menu → "Order SMS & Prepaid"
- NEW NAV: Setup bucket → "Order Services"

**Tabs/sub-sections**: None. Purely a 3-column grid of `CardSection`s: "SMS & messaging", "Prepaid & receipts", "Products & add-ons".

**Dialogs/modals**: None.

**Key actions/buttons**: Three outline buttons that are pure `Link`s (not API calls) redirecting elsewhere: "Open notifications" → `/staff/notifications`, "Open finance" → `/staff/finance`, "Product builder" → `/staff/products`.

**Business logic notes**: This page is effectively a **redirect/landing hub**, not a functional feature page — its description explicitly states "POL263 routes financial work through Finance and configuration through Settings," meaning legacy "Order SMS & Prepaid" functionality has been deliberately deprecated/consolidated into Notifications, Finance, and Products rather than implemented here. No forms, no API queries/mutations exist in this file at all.

### 4. leads.tsx

**File path**: `client/src/pages/staff/leads.tsx`
**Route(s)**: `/staff/leads` → `StaffLeads`

**Sidebar location(s)**:
- LEGACY NAV: Transactions menu → "Quotations"
- NEW NAV: Sales bucket → "Leads / Pipeline"

**Tabs/sub-sections**: No `Tabs` component — instead a **6-column Kanban/pipeline board** (drag-and-drop), which functions as the page's "sections": New, Contacted, Qualified, Quoted, Converted, Lost. Each column maps multiple legacy DB stage values onto one display column (e.g., "Quoted" absorbs `quoted`, `quote_generated`, `approved`, `agreed_to_pay`).

**Dialogs/modals**:
- **Capture New Lead** (`Dialog`, triggered by "Capture Lead" button, also auto-opens if URL has `?create=1`) — First Name*, Last Name*, Phone, Email, Product of Interest, Source (`Select`: Walk-in / Agent Referral / Campaign / Website). Creates lead with `stage: "new"`.
- **Lead Detail** (`Dialog`, opened by clicking any Kanban card) — shows contact info, source/stage badges, a "client linked" badge if converted, a row of stage-transition buttons (click to move directly to any stage), editable Product of Interest + Notes fields with a Save button, a "Lost reason" display if present, an "Issue Policy" button (only shown if `clientId` exists and stage is "converted" — routes to `/staff/policies?create=1&clientId=...`), and a "Mark Lost" button.

**Key actions/buttons**: "Blank Lead Form" (opens a printable/downloadable blank PDF-style form via `/api/forms/blank/lead-capture` in new tab), "Capture Lead", drag-and-drop cards between columns (calls `PATCH /api/leads/:id` with new stage), in-dialog Save/Mark Lost/Issue Policy.

**Business logic notes**:
- Full drag-and-drop Kanban CRM pipeline with native HTML5 drag events (`draggable`, `onDragStart/Over/Drop/End`), not a library — supports both drag-drop and dialog-button stage changes.
- `effectiveStage()` maps arbitrary/legacy raw DB stage strings into 6 canonical display buckets, meaning the underlying `leads` table stage column has accumulated multiple historical naming conventions that the UI normalizes.
- "Issue Policy" deep-links leads that converted into clients directly into policy creation, pre-filled with `clientId` — a lead-to-policy conversion shortcut.

### 5. approvals.tsx

**File path**: `client/src/pages/staff/approvals.tsx`
**Route(s)**: `/staff/approvals` → `StaffApprovals`

**Sidebar location(s)**:
- LEGACY NAV: Administration menu → "Approvals"
- NEW NAV: Finance bucket → "Approvals"

**Tabs/sub-sections** (`Tabs`/`TabsTrigger`, `value=` on `TabsContent`):
1. `pending` — "Pending" (badge shows live pending count)
2. `resolved` — "Resolved"
3. `waivers` — "Waivers" (badge shows live pending waiver count)

**Dialogs/modals**:
- **Approval Request Details** (`Dialog`, opened via "View" button per row) — shows Request Type, Status badge, Entity Type, Entity ID, Created/Resolved timestamps, raw Request Data JSON dump, Rejection Reason if present; footer has Approve/Reject buttons if still pending.
- **Approve/Reject Request confirmation** (`Dialog`, opened from either the row action buttons or the detail dialog's footer buttons) — for reject, requires a free-text Rejection Reason (`Textarea`, required to enable Confirm); calls `POST /api/approvals/:id/resolve`.
- **Approve/Reject Waiver confirmation** (`Dialog`, opened from Waivers tab row buttons) — approve copy warns "waiting period will be marked complete and the policy will be auto-activated if inactive"; reject requires a reason; calls `POST /api/waivers/:id/resolve`.

**Key actions/buttons**: KPI cards (Pending/Approved/Rejected counts) at top, per-row View/Approve/Reject (approvals table), per-row Approve/Reject (waivers table, and a "View policy" link button that routes to `/staff/policies?openPolicy=:id`), Cancel/Confirm in both resolution dialogs.

**Business logic notes**:
- This is the **maker-checker** approval workflow page. Known `requestType` values requiring approval: `CLAIM_REVIEW`, `delete_policy`, `delete_receipt`, `delete_quote`, `legacy_policy` (legacy policy activation) — labelled via a lookup map.
- Waivers are a distinct approval flow for waiting-period exceptions; approving one auto-activates the underlying policy if it's currently inactive, indicating tight coupling between the waiver resolution route and policy status transition logic on the backend.
- Both approvals and waivers use the shared `EnhancedDataTable` (`EnhancedDataTable`/`EdtColumn` from `@/components/ds`) with search, export (CSV), and persisted table state (`storageKey`).

### 6. diagnostics.tsx

**File path**: `client/src/pages/staff/diagnostics.tsx`
**Route(s)**: `/staff/diagnostics` → `StaffDiagnostics`

**Sidebar location(s)**:
- LEGACY NAV: Reports menu → "System Issue Reports"
- NEW NAV: Reports bucket → "System Issue Reports"

**Tabs/sub-sections** (`Tabs`/`TabsTrigger`, `value=` on `TabsContent`):
1. `health` — "System Health" (Server icon)
2. `notifications` — "Notifications" (Bell icon)
3. `payments` — "Payments" (CreditCard icon)
4. `errors` — "Recent Errors" (AlertTriangle icon)

**Dialogs/modals**: None.

**Key actions/buttons**: "Refresh" button in page header (bumps a `refreshKey` state to force-refetch all 4 queries — `/api/diagnostics/health`, `/api/diagnostics/notification-failures`, `/api/diagnostics/unallocated-payments`, `/api/diagnostics/recent-errors`).

**Business logic notes**:
- 4 top KPI cards: Database connection status, Uptime (formatted d/h/m/s), Notification Failures count, Unallocated Payments count — all admin/ops-facing, no client-facing meaning.
- System Health tab shows raw per-table row counts (`health.tableCounts`), useful for verifying migrations/data integrity at a glance.
- Notifications tab surfaces failed notification deliveries with `failureReason` and `attempts` count — direct visibility into the notification/SMS pipeline's dead-letter state.
- Payments tab is an **unallocated payments queue** — payments received (e.g., via PayNow/EcoCash) that haven't been matched/applied to a policy yet, a reconciliation aid.
- Errors tab pulls from the audit log filtered to error-level entries (`actorEmail`, `action`, `entityType`), effectively a lightweight in-app log viewer.

### 7. help-center.tsx

**File path**: `client/src/pages/staff/help-center.tsx`
**Route(s)**: `/staff/help` → `StaffHelpCenter`

**Sidebar location(s)**:
- LEGACY NAV: Tools menu → "Help Centre" (also in account dropdown menu)

**Tabs/sub-sections**: None (no `Tabs` component). Two `CardSection`s: "Frequently asked questions" and "Quick links".

**Dialogs/modals**: None — FAQ items use a custom collapsible `FaqItem` (button + conditional paragraph, chevron icon toggle), not a Dialog/Accordion component.

**Key actions/buttons**: Each FAQ question is a clickable expand/collapse toggle (12 FAQ entries hardcoded in a `FAQ` array). Quick Links section has 6 outline buttons linking to: Organization settings, SMS templates (`/staff/notifications`), User accounts, Products, Reports, My reminders.

**Business logic notes**:
- Entirely static/hardcoded content (no API calls) — the 12 FAQs describe real workflows (issuing policies, receipting payments, policy lapse/reinstate, claims, adding clients/dependants, burial society/scheme creation, report generation, inviting staff via Google login, product configuration, bulk group payments, client self-service via PayNow) which double as a **plain-English feature map of the whole system** — useful cross-reference since it names the canonical action labels used elsewhere (e.g., "Issue New Policy", "Reinstate", "Bulk payment", Ctrl+K command palette for "Receipt a Payment").

### 8. coming-soon.tsx

**File path**: `client/src/pages/staff/coming-soon.tsx`
**Route(s)**: Generic stub mounted at ~26 placeholder routes (per App.tsx), including: `/staff/transactions/society`, `/staff/transactions/tombstone`, `/staff/transactions/credit-notes`, `/staff/transactions/invoices`, `/staff/transactions/petty-cash`, `/staff/transactions/bank-deposits`, `/staff/transactions/debit-orders`, `/staff/transactions/fax`, `/staff/reports/dynamic-generic`, `/staff/tools/easypay`, `/staff/tools/print-policy-cards`, `/staff/tools/statistics`, `/staff/tools/statistical-graphs`, `/staff/tools/claims-form`, `/staff/tools/transport-companies`, `/staff/tools/contacts`, `/staff/admin/society`, `/staff/admin/tombstones`, `/staff/admin/invoice-items`, `/staff/admin/agents`, `/staff/admin/brokers`, `/staff/admin/member-cards`, `/staff/admin/terminals`, `/staff/admin/sub-groups`, `/staff/admin/underwriters`, `/staff/admin/undertakers`.

**How it works as a generic stub**: `ComingSoon` takes **no props** — it self-parametrizes by reading the current route via `useLocation()` from `wouter` and looking itself up in a hardcoded `STUBS: Record<string, StubInfo>` map keyed by exact path. Each `StubInfo` entry has: `title`, `blurb` (description of what the feature will do), and optional `related` (array of `{label, href}` link buttons pointing to the real page that currently covers part of that functionality, e.g., Petty Cash → Collections/Requisitions tabs in Finance). If the current path isn't found in `STUBS`, it falls back to a generic `{title: "Coming Soon", blurb: "This feature is being built and will be available in a future release."}`.

**UI rendered**: `StaffLayout` → `PageShell` → `PageHeader` (title = stub title, description hardcoded to "Planned module — not yet available.") → one `CardSection` titled "What this will do" with a `Construction` icon, showing the blurb, and — if `related` links exist — a "In the meantime, use" label followed by outline buttons linking to existing pages that partially substitute for the missing feature.

**Dialogs/modals**: None.

**Business logic notes**: This is a documentation-as-code pattern — the `STUBS` map itself is effectively a punch list of unbuilt legacy features (society/tombstone/credit notes/invoices/petty cash/bank deposits/debit orders/fax transactions; dynamic generic reports; EasyPay, policy card printing, statistics, claims-form config, transport companies, contacts tools; society/tombstone/invoice-items/agent/broker/member-card/terminal/sub-group/underwriter/undertaker admin screens) with per-feature guidance on which real, already-built page to use meanwhile.

### 9. login.tsx (staff)

**File path**: `client/src/pages/staff/login.tsx`
**Route(s)**: `/staff/login` → `StaffLogin`

**Sidebar location(s)**: N/A (unauthenticated entry page). Cross-links to `/agent/login` and `/` ("Back to Home").

**Tabs/sub-sections**: None.

**Dialogs/modals**: None — single centered `Card` (via `AppChrome center`).

**Auth flow description**:
- On mount, if `useAuth()` reports `isAuthenticated`, immediately redirects to `/staff`. While loading/authenticated, shows a full-screen spinner instead of the form.
- Fetches `/api/public/auth-config` (`demoLoginEnabled`, `googleConfigured`) to decide which login options to render; defaults to Google-only if the fetch fails.
- **Google OAuth button**: builds a URL to `/api/auth/google`. On native mobile, opens the URL in the system browser via Capacitor's `Browser.open()` (avoids Google blocking WebViews), with `returnTo=mobile`/`origin` params; server redirects back to deep link `pol263://auth/callback?token=xxx`, handled by a `DeepLinkHandler` routing to `/auth/callback`. On web, full `window.location.href` redirect with `returnTo=/staff`.
- **Dev/local login fallback** ("demo login", only rendered if `authConfig.demoLoginEnabled === true`): email-only input (no password), "Sign in (Dev)" button, `POST /api/auth/demo-login`.
- **Error states**: reads `?error=` query param; `error=session` shows a fixed message; otherwise shows the raw decoded error string.
- Branding: uses `useBranding(orgIdFromUrl)` for whitelabeled org logo/name if present, else generic "Staff Portal".
- Copy explicitly states Google sign-in requires a pre-provisioned staff email — no self-registration for staff.

**Business logic notes**: Confirms CLAUDE.md's stated architecture ("Staff: Google OAuth only") while revealing an additional, config-gated **demo/dev login backdoor** (`demoLoginEnabled` flag from `/api/public/auth-config`, backed by `POST /api/auth/demo-login`) — a second, password-free auth path gated purely by a runtime config flag rather than an environment check in this file. Worth flagging for the security review.

---

## Batch C — statistics.tsx / statistical-graphs.tsx / employee-reports.tsx / schedule-reports.tsx / settings.tsx / tenants.tsx

### 1. `client/src/pages/staff/statistics.tsx`

**Route:** `/staff/tools/statistics` (`StaffStatistics`)
**Sidebar location(s):** Legacy nav → Tools menu → "Statistics".

**Tabs/sub-sections:** None — single-page. Sections (via `CardSection`): KPI strip (6 `KpiStatCard`s: Total policies, Active policies, Covered lives, Total clients, Retention rate, Lapse rate); "Policies by status" table; "Product performance" table (product/total/active/lapsed/revenue per currency); "Lead conversion funnel" table.

**Dialogs/modals:** None.

**Key actions/buttons:** None — entirely read-only reporting.

**Business logic notes:** Pulls from six dashboard endpoints (`/api/dashboard/stats`, `policy-status-breakdown`, `product-performance`, `covered-lives`, `lapse-retention`, `lead-funnel`). Pure "at a glance" ops dashboard, no mutation capability.

### 2. `client/src/pages/staff/statistical-graphs.tsx`

**Route:** `/staff/tools/statistical-graphs` (`StaffStatisticalGraphs`)
**Sidebar location(s):** Legacy nav → Tools menu → "Statistical Graphs".

**Tabs/sub-sections:** None. Sections: "Revenue collected over time" (Recharts area chart); "Policy status mix" (pie, colored per status); "Retention vs lapse rate" (pie); "Policies per product" (grouped bar, Active vs Lapsed).

**Dialogs/modals:** None.

**Key actions/buttons:** None — pure visualization, chart tooltips only.

**Business logic notes:** Same four dashboard endpoints as statistics.tsx (minus covered-lives/clients), rendered visually. Charts only render when data arrays are non-empty.

### 3. `client/src/pages/staff/employee-reports.tsx`

**Route:** `/staff/employee-reports` (`StaffEmployeeReports`)
**Sidebar location(s):** Legacy nav → Reports menu → "Employee Reports"; New Nav → Reports bucket → "Employee Reports".

**Tabs/sub-sections:** No `Tabs` — 7 `CardSection` report groups, each a labeled group of downloadable report rows:
1. **"Agents, Cashier, Audit and Payroll Reports"** (19 items) — Prepare All Policies Per Agent, All New Joinings Per Agent, New Joinings Summary, Agent Productivity, Cashiers Detailed/Summary, Audit Trail, Payslips, Employer IRP5 Reconciliation, Deleted/Edited/Moved/Back Dated Receipts, Employee Summary, Arrears Breakdown, Outstanding Payments, Policy Receipts (by branch), Captured Policies Per Employee, Complaint Report
2. **"Agent Static Commission Reports"** (8 items)
3. **"Joining Commission Reports"** (4 items)
4. **"Agent Dynamic Commission Reports"** (3 items)
5. **"Broker Commission Reports"** (4 items)
6. **"Policy Referrer Commission Reports"** (2 items)
7. **"Branch Reports"** (1 item)

Plus a top "Report Filters" `CardSection` (From Date, To Date, Agent ID, Branch ID) shared by all report rows.

**Dialogs/modals:** None.

**Key actions/buttons:** Each report row has a single "CSV" download button opening `/api/reports/export/{type}` with query filters in a new tab. 41 distinct report types total, all export-only via `window.open`.

**Business logic notes:** A giant catalogue of legacy payroll/commission report exports (looks like a port of an older desktop insurance system's report menu). All reports share the same 4 filter params; no per-report custom filter UI.

### 4. `client/src/pages/staff/schedule-reports.tsx`

**Route:** `/staff/schedule-reports` (`StaffScheduleReports`)
**Sidebar location(s):** Legacy nav → Reports menu → "Schedule & Department Reports"; New Nav → Reports bucket → "Schedule & Dept Reports".

**Tabs/sub-sections:** No `Tabs` — two `CardSection`s: "Daily Schedule of Service" (date picker defaulting to tomorrow + Download/Preview PDF listing all funeral cases for that date); "Department Reports" (department tile picker: Funeral/Finance/HR & Payroll/Mortuary/Sales & Policy Admin/Claims + date range + quick-range buttons).

**Dialogs/modals:** None.

**Key actions/buttons:** "Download PDF"/"Preview" (daily schedule), department tile selector, "This Month"/"Last Month" quick ranges, "Download Report PDF"/"Preview" (department reports).

**Business logic notes:** Both PDF endpoints support inline "Preview" mode vs. force-download. Documents stated to be printed on company letterhead with logo/address/contact, summary stats, page/confidentiality footers.

### 5. `client/src/pages/staff/settings.tsx` — MOST DETAILED PAGE IN THE APP

**Route:** `/staff/settings` (also `?tab=X` for tenants/branding/account/terms/payments/rbac)
**Sidebar location(s):**
- Legacy nav → Administration → "System Setup" (`/staff/settings`) and "Tenants" (`/staff/settings?tab=tenants`)
- New Nav → Setup bucket → "Organization & Branding" (`/staff/settings`) and "Tenants" (`/staff/settings?tab=tenants`)
- `/staff/tenants` route (`StaffTenants`) is a client-side redirect stub → `/staff/settings?tab=tenants`, not linked from any nav item (orphan/legacy-compat URL only).

Single 1808-line monolithic file, no nested sub-component imports for tab bodies.

**Tab visibility gating logic:**
- `isControlPlaneMode` = platform owner with no active tenant selected (effectiveOrgId null) → forces "tenants" tab and hides org-scoped tabs.
- Tenants tab only if `canManageTenants` (create:tenant or delete:tenant); Branding/Payments tabs only if `canOrgAdmin` (isPlatformOwner or write:organization) AND not control-plane mode; Terms/RBAC shown whenever not control-plane mode; Account always shown.

**Tab: "Tenants"** — grid of tenant/org cards (logo, name, email, phone, ID); actions: Switch (platform owner switches active tenant), Edit (platform-owner only), gear icon (jump to that org's Branding tab), Delete (requires `canDeleteTenant`). "New tenant" dialog: org name/email/phone + platform-owner-only fields (White-Label Mode switch, Dedicated Database URL) + optional "Tenant administrator account" bootstrap (name/email/password). "Edit tenant" dialog mirrors this, fetching full org record separately since list endpoint omits `databaseUrl`. "Remove tenant?" AlertDialog requires tenant to have no active users.

**Tab: "Branding"** (hidden in control-plane mode) — Organization branding CardSection: Logo upload, Authorized Signature upload, Name/Address/Phone/Email/Website, Primary Color (picker + hex + 13 preset swatches), Footer Text, Policy Number Prefix + Policy Number Padding (1-20 digits), plus platform-owner-only Dedicated Database URL + White-Label Mode toggle inline. "Receipt Adverts" CardSection (hidden in control-plane mode): list with image/title/Active badge/body preview; Activate/Deactivate/Edit/Delete actions; "New Advert" dialog (image upload max 5MB, title, message).

**Tab: "Account"** (always visible) — "Change password" CardSection (current/new/confirm, min 8 chars). "Experience (beta features)" CardSection (`FeatureFlagsCard` component) — 5 client-side/localStorage-only feature flags: New navigation, Global search bar, Command palette (⌘K), Quick create button, Role command centers. This is the opt-in kill-switch for the New Nav UX transformation.

**Tab: "Terms"** (hidden in control-plane mode) — Terms & Conditions library table (Title/Category/Order/Active/Actions); "Add term" dialog (Title, Content, Category, Sort order, Active checkbox); only active terms appear on generated policy PDFs.

**Tab: "Payments"** (hidden in control-plane mode, requires `canOrgAdmin`) — per-tenant PayNow config: Integration ID, Integration Key (password-masked, blank=unchanged), Auth Email, Mode (Test/Live), Return URL, Result URL (with a "Suggested Result URL" auto-generated helper `https://yourapp.com/api/payments/paynow/result?org={id}`). No "test connection" button.

**Tab: "RBAC"** (hidden in control-plane mode) — "Sync Permissions" button (requires `manage:permissions`, reconciles DB role/permission rows with hardcoded permission set in code). Permission × role matrix table; superuser column always checked (not togglable); other cells are clickable checkboxes if `canEditRbac` (write:role or create:tenant), else read-only; each toggle is an individual POST/DELETE to `/api/roles/{roleId}/permissions/{permId}`.

**All dialogs/modals in settings.tsx:** Create new tenant; Edit tenant; Remove tenant? (AlertDialog); New/Edit Receipt Advert; Delete Advert? (AlertDialog); Add/Edit term; Delete term? (AlertDialog). No Sheet or DropdownMenu components used.

**Notable architecture/business-logic points:**
- Control-plane mode is a distinct UX state for platform owners with no tenant selected — most tabs vanish, forcing tenant selection/creation first.
- PayNow credentials are per-tenant with never-round-tripped-in-cleartext Integration Key (blank = "unchanged"), consistent with "never expose PAYNOW_INTEGRATION_KEY" guidance.
- Feature flags in the Account tab are purely client-side/localStorage (not server-persisted, not per-org) — New Nav rollout is opt-in per browser/user, not centrally enforced (see Part 2 for the actual default state finding: New Nav is default-on).
- Full org record fetched separately to backfill PayNow fields the list endpoint's control-plane query path omits for admins — a two-tier query design gotcha worth flagging (list endpoint privacy-strips certain fields; single-org endpoint doesn't).

### 6. `client/src/pages/staff/tenants.tsx`

**Route:** `/staff/tenants` (`StaffTenants`)
**Sidebar location(s):** NOT linked from any nav item in either nav variant — orphaned route reachable only by direct URL/old bookmarks.

**Tabs/sub-sections:** None — 15-line component: `useEffect` immediately calls `setLocation("/staff/settings?tab=tenants", { replace: true })`, renders a full-screen spinner during redirect.

**Dialogs/modals:** None. **Key actions/buttons:** None — pure redirect stub.

**Business logic notes:** Confirms this is a legacy/compatibility redirect shim, not a distinct page — exists so old links/bookmarks to `/staff/tenants` still land correctly after Tenants functionality was folded into Settings as a tab.

---

## Batch D — Agent App, Client Portal, Public/Join pages

### 1. `client/src/pages/agent/download.tsx` — Route: `/agent/download`

Public/unauthenticated agent-app distribution page. Sections: Download button area, "Installation Instructions" (4 steps: Allow Unknown Sources, Download APK, Install, Updates). No dialogs. Actions: "Retry" (refetch on error), "Download APK v{version}" (opens `data.url` from `/api/public/agent-app-latest`), "Already installed? Sign in on the web →" (`/agent/login`). Business logic: Android sideload distribution (no Play Store), APK metadata (url/version/updatedAt) served from a public endpoint, described as "over-the-air" updates.

### 2. `client/src/pages/agent/login.tsx` — Route: `/agent/login` (`?orgId=` for whitelabel)

Public page. No tabs/dialogs. Actions: "Sign in" (POST `/api/agent-auth/login` with email/password), "Download Agent App" link, "staff login" link, "← Back to Home". Business logic: agents authenticate via **email/password only** ("Agents cannot use Google sign-in" — distinct from staff Google OAuth). On success, if server returns a `redirect` path, does a full-page navigation to `/?returnTo=<path>` (crosses subdomain/base-URL boundary) rather than SPA routing — for multi-tenant subdomain routing. Already-authenticated staff sessions redirect to `/staff`.

### 3. `client/src/pages/client/claim.tsx` — Route: `/client/claim`

Public pre-login account-claiming flow. 3-step wizard (local `step` state, not Tabs): Step 1 "Verify identity", Step 2 "Set up password & security question", Step 3 "Success". No dialogs (toasts for errors). Actions: "Verify Identity" (POST `/api/client-auth/claim` with activation code + policy number), "Complete Setup" (POST `/api/client-auth/enroll` with password, security question, answer), "Sign In Now" → `/client/login`. Business logic: **account activation/policy-claiming flow** — a policyholder registered by an agent (policy number + activation code) sets up self-service portal credentials for the first time. Reads `agent_referral_code` from sessionStorage to pass through to enrollment. Security question list falls back to 4 hardcoded defaults if server doesn't supply custom ones.

### 4. `client/src/pages/client/claims.tsx` — Route: `/client/claims`

"Claims" client-portal nav item. No Tabs; toggleable "Lodge claim" inline form + "Claims" list. No dialogs. Actions: "Lodge claim" (reveals form), "Submit claim" (POST `/api/client-auth/claims` with policyId/claimType/deceased details), "Cancel", "Back to dashboard". Business logic: claim types hardcoded `death, accidental_death, disability, repatriation, cash_in_lieu`; form conditionally captures deceased name/relationship/date of death/cause of death (funeral-insurance-specific). Claims list shows claim number/type/status/submission date only.

### 5. `client/src/pages/client/dashboard.tsx` — Route: `/client` (Overview nav item — this IS Overview)

**Tabs (5, `activeTab` state):**
1. **Overview** — Active Policy card (premium, effective date, current cycle, balance/advance/arrears, waiting period banner, "Pay Now" button, claimability note), Summary card (policy counts by status), Policy Balances (`ClientCreditBalances`), All Policies list with expandable `PolicyCard` rows (recent payments table).
2. **Payments** — Payment History per policy (`PaymentSection`: date/amount/method/status/reference).
3. **Members** — `DependentsSection` (add/list/remove) + `BeneficiarySection` per policy (max 1 beneficiary, appoint-from-dependent or manual).
4. **Alerts** — Grace period alert, waiting period alert, `ClientNotificationsList`, `ClientCreditNotesList`, `ClientNotificationSettings` (sound tone + push toggle), "all clear" empty state.
5. **Account** — `ClientChangePassword` (current/new/confirm).

No dialogs — all sub-forms inline expand/collapse. Actions: "Pay Now" → `/client/payments?policyId={id}`, policy card expand/collapse, Add/Save/Remove dependent, Add/Save/Remove beneficiary, notification settings (Sound select, Push switch), "Change password", Logout.

Business logic: top banners (grace-period warning, lapsed-policy warning) shown above tabs regardless of active tab; `isPolicyClaimable()` requires status active/grace AND waiting period elapsed — waiting-period business rule encoded directly in client UI; balance display negative=Arrears(red)/positive=Advance(emerald)/zero=Up to date; beneficiary capped at exactly 1 per policy.

### 6. `client/src/pages/client/document-view.tsx` — Route: `/client/documents/view/:policyId`

Sub-page of Documents nav item. No tabs/dialogs. Actions: "Back to documents", "Print" (`printDocument`), inline `<iframe>` renders PDF at `/api/client-auth/policies/{policyId}/document`. Business logic: renders policy certificate inline via iframe rather than forced download, better UX for the Capacitor mobile wrapper.

### 7. `client/src/pages/client/documents.tsx` — Route: `/client/documents`

"Documents" nav item. No tabs; single "Your policies" list. No dialogs. Per-policy actions: "View" (iframe viewer), "Download" (`?download=1`), "Print". Business logic: one "policy document" (certificate) per policy; no other document categories exposed client-side.

### 8. `client/src/pages/client/feedback.tsx` — Route: `/client/feedback`

"Feedback" nav item. No tabs; toggleable inline "Submit complaint or feedback" form + "Submitted items" list. No dialogs. Actions: "New" (reveal form), Type select (Complaint/Feedback), "Submit" (POST `/api/client-auth/feedback`), "Cancel". Business logic: single unified endpoint for both complaints and feedback, distinguished by `type` field; items show status presumably updated by staff.

### 9. `client/src/pages/client/login.tsx` — Route: `/client/login` (`?orgId=` for whitelabel)

Public page. No tabs/dialogs. Actions: "Sign In" (POST `/api/client-auth/login` with **policyNumber** + password — not email), "Forgot password?" → `/client/reset-password`, "Claim your policy" → `/client/claim`, "← Back to Home". Business logic: clients log in with policy number, not email. 429 responses surfaced as "Account temporarily locked."

### 10. `client/src/pages/client/payments.tsx` — Route: `/client/payments` (`?policyId=`, `?returned=1`; `/client/payments/return` redirects here)

"Pay" nav item. No Tabs. Sections: "Pay premium" form, "Group Receipting" (`GroupReceiptSection`, conditional on group membership), "My receipts" (`ReceiptsList`). **One Dialog**: Receipt viewer ("Receipt #{number}") — inline iframe of receipt PDF + Download/Print actions inside the dialog.

Actions: "Continue to payment" (creates idempotent payment intent), "Pay now", "Verify OTP" (O'Mari only), "Look up" (pay for someone else by phone/policy/national ID), "Show my policies instead", Group Receipting checkboxes + Select all/Process, receipts "View"/"Print".

Business logic — **most business-logic-dense client page**: PayNow methods are EcoCash/OneMoney (USSD PIN approval, poll every 5s), InnBucks (auth code + deep link `schinn.wbpycode://innbucks.co.zw?...`), O'Mari (SMS OTP step via separate endpoint), Visa/Mastercard (redirect to PayNow hosted page via system browser on native mobile, requires payer email). Native-mobile return flow (`redirectToAppIfMobileReturn`, sessionStorage flag `paynow_return_handled` prevents duplicate toast). "Pay for someone else" lookup expires in 5 minutes. Group Receipting for "group executives" records one cash collection split across multiple group members' policies. PayNow integration key never exposed client-side — all initiation server-side.

### 11. `client/src/pages/client/reset-password.tsx` — Route: `/client/reset-password`

Public page. No tabs/dialogs. Actions: "Reset password" (POST `/api/client-auth/reset-password` with policyNumber/securityAnswer/newPassword), "Sign in" (post-success), "Back to sign in". Business logic: self-service reset via **security question answer** (set at claim/enrollment), not email token — clients have no email/password-reset-link infrastructure like staff's Google OAuth.

### 12. `client/src/pages/join.tsx` — Route: `/join`

Public marketing/landing page. No tabs/dialogs. Actions: "Client Login" → `/client/login`, "Claim Policy" → `/client/claim`, "Register for a new policy" (only if `?ref=` present) → `/join/register?ref={code}`. Business logic: landing page reached via agent referral link; persists ref code to sessionStorage as `agent_referral_code`, looks up referring agent's display name via `/api/agents/by-referral/{refCode}` for attribution. Marketing bullets (funeral cover plans, family coverage, fast claims, nationwide delivery).

### 13. `client/src/pages/join/register.tsx` — Route: `/join/register` (`?ref=` agent-referral or `?org=` walk-in)

Public page. No tabs (logical sections in one form): personal details, product/plan selection, dependents, beneficiary, branch selection. 4 alternate full-page states: Invalid link, loading, error, success. No dialogs — inline expandable sub-forms.

Actions: Add/Appoint/Remove dependent, Enter/Confirm/Cancel beneficiary, "Back" (`/join`), "Save & get policy number" (POST `/api/public/register-policy` referral flow or `/api/public/walkin-register` walk-in flow), "Go to client login" (success).

Business logic: **Two registration modes** — agent-referral (`ref` param → `/api/public/registration-options?ref=`) vs. org walk-in (`org` param → `/api/public/walkin-options?org=`), driven by `isWalkIn` flag. Product/version selection auto-populates monthly premium (USD/ZAR), read-only field. National ID validated client-side. On success, server returns policy number + activation code — feeding directly into `client/claim.tsx`'s claim flow, tying registration → claim → login together as one pipeline.

### 14. `client/src/pages/home.tsx` — Route: `/`

Public landing page, app's true root/entry point (eagerly loaded). No tabs. Two rendering modes: no `tenantId` resolved → single "Platform Administration" card (platform-owner login only); tenant resolved → 3-card portal grid (Staff/Agent/Client). No dialogs.

Actions: "Platform Owner Login" → `/staff/login` (no-tenant-context only), "Access Staff/Agent/Client Portal" → respective login pages with `?orgId=`.

Business logic: auto-redirect if a staff/client session is already authenticated (to `/staff`/`/client`), supporting `?returnTo=` for deep-linking after auth resolves. Determines multi-tenancy context via `/api/public/tenant-context` (derived from subdomain) and fetches whitelabel branding keyed to that tenant ID — mechanism by which `yourorg.pol263.com` shows an org's own logo/name while the bare root domain shows the generic "Platform Administration" gate.

### 15. `client/src/pages/auth-callback.tsx` — Route: `/auth/callback`

Public technical bridge page (not user-facing nav). No tabs/dialogs. Action: "Back to sign in" (error state only) → `/staff/login`. Business logic: **native-mobile OAuth token exchange bridge** for staff Google login — reads `token` query param (delivered after mobile app opens OAuth flow in system browser and redirects back), POSTs to `/api/auth/mobile-exchange` to establish session cookie, invalidates `/api/auth/me` cache, routes to `/staff`.

### 16. `client/src/pages/verify.tsx` — Route: `/verify` (`?type=`, `?id=`)

Public, standalone document-authenticity checker (own minimal styled page, no `AppChrome`). No tabs (conditionally renders one of 3 sub-views based on `result.type`: `receipt`, `policy`, `form`). No dialogs, no interactive actions — read-only verification result display.

Business logic: **public QR-code/link verification endpoint landing page** — a QR code printed on receipts/policy documents/forms encodes a link to `/verify?type=receipt&id=...`, confirming the document is authentic/not voided via `/api/public/verify`. Anti-fraud/document-integrity feature. Fully public, no auth required.

### 17. `client/src/pages/not-found.tsx` — Catch-all route

404 fallback. Actions: "Go to home", "Client login", "Staff login". Offers three recovery links since the app serves three distinct user populations.

---

## Cross-cutting notes (from Batch D research)

- **Grep for `TabsTrigger`/`TabsContent`:** Only `client/dashboard.tsx` uses `Tabs` among these 17 files (5 tabs).
- **Grep for `Dialog`/`AlertDialog`/`Sheet`:** Only `client/payments.tsx` opens a `Dialog` (receipt viewer). No `AlertDialog`/`Sheet` in any of these 17 files.
- **Grep for `DropdownMenu`:** None of these 17 files use it.
- **Recurring UI pattern**: Many client pages (claims, feedback, dashboard's dependents/beneficiary sections, registration) use an inline toggle-form pattern rather than modals — a deliberate design-system convention (`@/components/ds`) favoring inline expansion over dialogs for CRUD-style secondary actions.
- **Shared session-guard pattern**: claims/documents/document-view/feedback/payments/dashboard all repeat the same "session expired" fallback UI (calls `/api/client-auth/me`, "Please sign in again" + Sign In button).
- **Registration → Claim → Login pipeline**: `join.tsx` → `join/register.tsx` (produces policyNumber + activationCode) → `client/claim.tsx` (consumes to set password/security question) → `client/login.tsx` (policy number + password) — one continuous onboarding funnel.
- **PayNow flow** in `client/payments.tsx` is the most business-logic-dense file of the 17 client-facing pages.



# Section 03 — Menu Map / Navigation (Part 2)

Covers: App.tsx route table; both staff nav variants (Legacy Nav and New Nav, feature-flag gated);
and per-page detail for dashboard, finance, mortuary, policies, claims, products, pricebook,
quotations, reports, assets-register, audit, plus everything under `staff/admin/`, `staff/tools/`,
`staff/transactions/`.

---

## 0. Feature flags governing navigation

File: `client/src/lib/flags.ts`. LocalStorage key `pol263.flags` (JSON `{flagName: boolean}`),
read via `useFlag(name)` (React `useSyncExternalStore`), written via `setFlag(name, value)`. No
server state — pure client kill-switch. In-product toggle UI lives in
`client/src/components/feature-flags-card.tsx` ("Experience (beta features)" card, likely embedded
in Settings), which exposes 5 of the 7 flags as switches.

| Flag | Default | Effect |
|---|---|---|
| `newNav` | **true** | Switches the whole top nav + mobile sheet from the 5-bucket Legacy Nav to the 9-bucket job-based New Nav. **New Nav is the shipped default; Legacy Nav is what you get if a user (or their browser) has disabled it.** |
| `globalSearch` | true | Header search: `GlobalCommandBar` (cross-entity) vs. `PolicySearchInput` (policy-only jump box). |
| `commandPalette` | true | ⌘K keyboard launcher (not directly gating a menu structure, but part of the same UX transformation). |
| `quickCreate` | true | Shows `QuickCreateMenu` ("+ New") button in the header, tenant mode only. |
| `commandCenters` | true | Dashboard: replaces the "Quick access" card with `<CommandCenter />` role-based work queues. |
| `receiptDrawer` | true | Not wired into StaffLayout directly but `ReceiptDrawerProvider` always wraps the shell. |
| `policyWizard` | true | Read in `policies.tsx` (`useFlag("policyWizard")`) — gates a wizard-style policy creation flow vs. the classic dialog. |

Revert everything from the browser console:
`localStorage.setItem('pol263.flags', JSON.stringify({newNav:false, globalSearch:false, commandPalette:false, quickCreate:false, commandCenters:false}))`

Nav item visibility within both trees is further gated per-item by `permission` / `permissions`
(checked against the logged-in user's `permissions` array via `hasAny()`), and by `agentHidden` /
`agentOnly` booleans (checked via `isAgentScoped(roles)`). Items failing either check are filtered
out of the menu entirely (`filterNav()`), not merely disabled.

Both nav trees are defined in `client/src/components/layout/staff-layout.tsx`, together with the
desktop top-bar (`StaffNavDropdown` components in a horizontal bar) and the mobile `Sheet`-based
drawer (`mobileNavSections`). Home is always a standalone link before the bucket dropdowns.
Control-plane mode (platform owner with no tenant selected) collapses navigation down to just
Home + Tenants + Settings regardless of flag state.

---

## 1. Menu tree — LEGACY NAV (`newNav = false`)

Five top-level dropdown buckets in the primary nav bar, each rendered via `StaffNavDropdown`.

- **Home** (standalone link, not a bucket)
- **Transactions** (`transactionsMenu`)
  - Policy Transactions — `/staff/policies` (icon FileStack; perm `read:policy`; **agentOnly** — only agents see this label here, since it's duplicated under Administration for non-agents)
  - Funeral Files — `/staff/funerals` (Truck; perm `read:funeral_ops`)
  - Mortuary Register — `/staff/mortuary` (Archive; perm `read:funeral_ops`)
  - Cash Service Quotes — `/staff/quotations` (Receipt; perm `read:funeral_ops`)
  - Society Transactions — `/staff/transactions/society` (Building2; **agentHidden**; stub page)
  - Tombstone Transactions — `/staff/transactions/tombstone` (Milestone; **agentHidden**; stub page)
  - Quotations — `/staff/leads` (Target; perm `read:lead`) — note: label "Quotations" here actually points at the leads pipeline, distinct from "Cash Service Quotes" above
  - Invoices — `/staff/transactions/invoices` (FileText; **agentHidden**; stub)
  - Credit Notes — `/staff/transactions/credit-notes` (FileMinus; **agentHidden**; stub)
  - Fax — `/staff/transactions/fax` (Printer; **agentHidden**; stub)
- **Finance** (`financeMenu`)
  - Receipts & Payments — `/staff/finance?tab=payments` (Receipt; perms `read:finance`/`read:commission`)
  - Mobile & Cash — `/staff/finance?tab=paynow` (Smartphone; same perms)
  - Group Receipt — `/staff/finance?tab=group-receipt` (Layers; perm `write:finance`; agentHidden)
  - Cash-up Reconciliation — `/staff/finance?tab=cashups` (Wallet2; read:finance/read:commission)
  - Requisitions — `/staff/finance?tab=requisitions` (ClipboardList; read:finance; agentHidden)
  - Expenditures — `/staff/finance?tab=expenditures` (FileMinus; read:finance; agentHidden)
  - Petty Cash — `/staff/transactions/petty-cash` (Coins; agentHidden; stub)
  - Bank Deposits — `/staff/transactions/bank-deposits` (Landmark; agentHidden; stub)
  - Debit Orders — `/staff/transactions/debit-orders` (CreditCard; agentHidden; **real page**)
  - Commissions — `/staff/finance?tab=commissions` (TrendingUp; perm `read:commission`)
  - Payroll — `/staff/payroll` (Wallet2; perm `read:payroll`)
  - Attendance — `/staff/attendance` (ClipboardList; perm `read:payroll`)
  - Month-End Close — `/staff/finance?tab=month-end` (CalendarDays; write:finance; agentHidden)
  - FX Rates — `/staff/finance?tab=fx-rates` (RefreshCw; manage:settings; agentHidden)
  - Platform Fees — `/staff/finance?tab=platform` (Building2; read:finance; agentHidden)
- **Reports** (`reportsMenu`)
  - Schedule & Department Reports — `/staff/schedule-reports` (CalendarDays; read:report)
  - Dynamic Reports — `/staff/reports` (BarChart3; read:report)
  - Dynamic Reports (Generic) — `/staff/reports/dynamic-generic` (BarChart2; agentHidden; **stub**)
  - Policy Reports — `/staff/reports?section=policies` (FileStack; read:report)
  - Financial Reports — `/staff/reports?section=finance` (Receipt; read:report)
  - Agent Reports — `/staff/reports?section=agents` (UserCircle; read:report)
  - Claims Reports — `/staff/reports?section=claims` (Shield; read:report)
  - Employee Reports — `/staff/employee-reports` (Users; read:report; agentHidden)
  - System Issue Reports — `/staff/diagnostics` (Stethoscope; read:audit_log)
- **Administration** (`administrationMenu`)
  - Policy Admin — `/staff/policies` (FileStack; read:policy; agentHidden — this is the non-agent-facing label for the same route as "Policy Transactions" above)
  - Claims Admin — `/staff/claims` (FileText; read:claim)
  - Society Admin — `/staff/admin/society` (Building2; agentHidden — **redirects to `/staff/groups`**)
  - Tombstones Admin — `/staff/admin/tombstones` (Milestone; agentHidden; stub)
  - Product Admin — `/staff/products` (Box; write:product)
  - Price Book — `/staff/pricebook` (BookOpen; write:product)
  - Invoice Items Admin — `/staff/admin/invoice-items` (ClipboardList; agentHidden; stub)
  - Clients / My Clients — `/staff/clients` (Users; read:client)
  - Employer Admin — `/staff/groups` (Layers; write:policy; agentHidden)
  - Sub Group Admin — `/staff/admin/sub-groups` (GitBranch; agentHidden; stub)
  - Member Card Admin — `/staff/admin/member-cards` (CreditCard; agentHidden; stub)
  - Terminals + Cards Admin — `/staff/admin/terminals` (Monitor; agentHidden; stub)
  - Agent Admin — `/staff/admin/agents` (UserCheck; agentHidden; **real page**)
  - Broker Admin — `/staff/admin/brokers` (Briefcase; agentHidden; **real page** — thin `DirectoryPage` wrapper)
  - Underwriter Admin — `/staff/admin/underwriters` (Shield; agentHidden; **real page** — `DirectoryPage` wrapper)
  - Undertaker Admin — `/staff/admin/undertakers` (HeartHandshake; agentHidden; **real page** — `DirectoryPage` wrapper)
  - Branch Admin — `/staff/admin/branches` (MapPin; agentHidden; **real page**)
  - User Admin — `/staff/users` (UserCog; read:user)
  - Approvals — `/staff/approvals` (ShieldCheck; manage:approvals)
  - System Setup — `/staff/settings` (Settings; agentHidden)
  - Tenants — `/staff/settings?tab=tenants` (Building2; create:tenant)
- **Tools** (`toolsMenu`)
  - Audit Trail — `/staff/audit` (History; read:audit_log)
  - Asset Register — `/staff/tools/assets` (Archive; read:audit_log)
  - Statistics — `/staff/tools/statistics` (BarChart2; agentHidden)
  - Statistical Graphs — `/staff/tools/statistical-graphs` (LineChart; agentHidden)
  - SMS Tools — `/staff/notifications` (Bell; read:notification)
  - Print Policy Cards — `/staff/tools/print-policy-cards` (Printer; no perm gate; stub)
  - Manage Online Claims Form — `/staff/tools/claims-form` (ClipboardList; agentHidden; stub)
  - Manage EasyPay — `/staff/tools/easypay` (Zap; agentHidden; stub)
  - Transport Companies — `/staff/tools/transport-companies` (Truck; agentHidden; **real page** — `DirectoryPage` wrapper)
  - Contacts Manager — `/staff/tools/contacts` (BookOpen; no perm gate; **real page** — `DirectoryPage` wrapper)
  - Reminders — `/staff/reminders` (Clock)
  - Order SMS & Prepaid — `/staff/order-services` (DollarSign; agentHidden)
  - Help Centre — `/staff/help` (HelpCircle)

## 2. Menu tree — NEW NAV (`newNav = true`, the shipped default)

Nine job-based buckets ("command centers" IA). Same routes/permissions reorganized around a
workflow rather than a data-type taxonomy. Per code comment: "Preserves every route/permission;
reorganizes access paths only." Ref: `docs/POL263-TRANSFORMATION-PLAN.md`.

- **Home** (standalone)
- **Sales**
  - Leads / Pipeline — `/staff/leads` (Target; read:lead)
  - New Policy — `/staff/policies` (FileStack; write:policy)
- **Clients**
  - Clients / My Clients — `/staff/clients` (Users; read:client)
  - Schemes (Employer / Society) — `/staff/groups` (Layers; write:policy; agentHidden)
  - Society Admin — `/staff/admin/society` (Building2; agentHidden — redirects to `/staff/groups`)
  - Sub Groups — `/staff/admin/sub-groups` (GitBranch; agentHidden; stub)
- **Policies**
  - Policies — `/staff/policies` (FileStack; read:policy)
  - Member Cards — `/staff/admin/member-cards` (CreditCard; agentHidden; stub)
- **Collections**
  - Receipt a Payment — `/staff/finance?tab=payments` (Receipt)
  - Mobile & Cash — `/staff/finance?tab=paynow` (Smartphone)
  - Cash-up — `/staff/finance?tab=cashups` (Wallet2)
  - Group Receipt — `/staff/finance?tab=group-receipt` (Layers; write:finance; agentHidden)
  - Month-End Close — `/staff/finance?tab=month-end` (CalendarDays; write:finance; agentHidden)
  - Debit Orders — `/staff/transactions/debit-orders` (CreditCard; agentHidden; real page)
  - Bank Deposits — `/staff/transactions/bank-deposits` (Landmark; agentHidden; stub)
  - Petty Cash — `/staff/transactions/petty-cash` (Coins; agentHidden; stub)
  - Print Policy Cards — `/staff/tools/print-policy-cards` (Printer; stub)
- **Claims**
  - Claims — `/staff/claims` (FileText; read:claim)
  - Funeral Cases — `/staff/funerals` (Truck; read:funeral_ops)
  - Mortuary Register — `/staff/mortuary` (Archive; read:funeral_ops)
  - Cash Service Quotes — `/staff/quotations` (Receipt; read:funeral_ops)
  - Funeral Pricing — `/staff/pricebook` (BookOpen; write:product)
  - Online Claims Form — `/staff/tools/claims-form` (ClipboardList; agentHidden; stub)
  - Transport Companies — `/staff/tools/transport-companies` (Truck; agentHidden; real page)
- **Finance**
  - Requisitions — `/staff/finance?tab=requisitions` (ClipboardList; read:finance; agentHidden)
  - Expenses — `/staff/finance?tab=expenditures` (FileMinus; read:finance; agentHidden)
  - Commissions — `/staff/finance?tab=commissions` (TrendingUp; read:commission)
  - Payroll — `/staff/payroll` (Wallet2; read:payroll)
  - Attendance — `/staff/attendance` (ClipboardList; read:payroll)
  - FX Rates — `/staff/finance?tab=fx-rates` (RefreshCw; manage:settings; agentHidden)
  - Platform Fees — `/staff/finance?tab=platform` (Building2; read:finance; agentHidden)
  - Approvals — `/staff/approvals` (ShieldCheck; manage:approvals)
  - Credit Notes — `/staff/transactions/credit-notes` (FileMinus; agentHidden; stub)
  - Invoices — `/staff/transactions/invoices` (FileText; agentHidden; stub)
- **Reports**
  - Schedule & Dept Reports — `/staff/schedule-reports` (CalendarDays; read:report)
  - Policy Reports — `/staff/reports?section=policies`
  - Financial Reports — `/staff/reports?section=finance`
  - Agent Reports — `/staff/reports?section=agents`
  - Claims Reports — `/staff/reports?section=claims`
  - Dynamic Reports — `/staff/reports` (BarChart3; read:report)
  - Employee Reports — `/staff/employee-reports` (Users; read:report; agentHidden)
  - System Issue Reports — `/staff/diagnostics` (Stethoscope; read:audit_log)
- **Setup**
  - Products — `/staff/products` (Box; write:product)
  - Price Book — `/staff/pricebook` (BookOpen; write:product)
  - Users — `/staff/users` (UserCog; read:user)
  - Organization & Branding — `/staff/settings` (Settings; manage:settings; agentHidden)
  - Notifications / SMS — `/staff/notifications` (Bell; read:notification)
  - Order Services — `/staff/order-services` (DollarSign; manage:settings; agentHidden)
  - Branch Admin — `/staff/admin/branches` (MapPin; read:branch; agentHidden)
  - Agent Admin — `/staff/admin/agents` (UserCheck; read:user; agentHidden)
  - Broker Admin — `/staff/admin/brokers` (Briefcase; read:user; agentHidden)
  - Underwriter Admin — `/staff/admin/underwriters` (Shield; manage:settings; agentHidden)
  - Undertaker Admin — `/staff/admin/undertakers` (HeartHandshake; manage:settings; agentHidden)
  - Terminals + Cards — `/staff/admin/terminals` (Monitor; manage:settings; agentHidden; stub)
  - Invoice Items — `/staff/admin/invoice-items` (ClipboardList; write:product; agentHidden; stub)
  - Audit Trail — `/staff/audit` (History; read:audit_log)
  - Asset Register — `/staff/tools/assets` (Archive; read:audit_log)
  - Manage EasyPay — `/staff/tools/easypay` (Zap; manage:settings; agentHidden; stub)
  - Contacts Manager — `/staff/tools/contacts` (BookOpen; read:user)
  - Tenants — `/staff/settings?tab=tenants` (Building2; create:tenant)

Buckets whose filtered item list is empty are dropped entirely from both the desktop bar and the
mobile sheet (`.filter((s) => s.items.length > 0)`).

Header bar (both nav variants) also always shows: brand logo/name, tenant switcher (platform owner
only), branch name, user display name + role badge, live clock, avatar dropdown (Settings,
Reminders, Help Centre, Change avatar, Log out), Quick Create button (if `quickCreate` flag + has
tenant), theme switcher, and (if available) an "Agent App" APK download button. Mobile drawer
(`Sheet`) additionally surfaces a personal referral-link box and the same Agent App download link.

---

## 3. App.tsx route table

All routes wrapped in `SafeRoute` (adds an `ErrorBoundary`) except `/`, `/client/payments/return`,
and the final catch-all. All components are lazy-loaded via `retryLazy()` (auto-retries chunk load
failures 3x, then hard-reloads on final failure — handles stale-deploy chunk-hash mismatches).

| Route Path | Component | Notes |
|---|---|---|
| `/` | `Home` (eager) | Landing page, not lazy-loaded |
| `/staff/login` | StaffLogin | |
| `/agent/login` | AgentLogin | |
| `/agent/download` | AgentDownload | |
| `/staff`, `/staff/` | StaffDashboard | Same component both paths |
| `/staff/audit` | AuditLogs | |
| `/staff/settings`, `/staff/settings/` | StaffSettings | |
| `/staff/products` | ProductBuilder | |
| `/staff/policies` | StaffPolicies | |
| `/staff/clients` | StaffClients | |
| `/staff/claims` | StaffClaims | |
| `/staff/funerals` | StaffFunerals | |
| `/staff/mortuary` | StaffMortuary | |
| `/staff/quotations` | StaffQuotations | |
| `/staff/finance` | StaffFinance | |
| `/staff/reports` | StaffReports | |
| `/staff/leads` | StaffLeads | |
| `/staff/notifications` | StaffNotifications | |
| `/staff/groups` | StaffGroups | |
| `/staff/approvals` | StaffApprovals | |
| `/staff/diagnostics` | StaffDiagnostics | Not in either nav's item list under that exact name — reachable via "System Issue Reports" |
| `/staff/pricebook` | StaffPriceBook | |
| `/staff/payroll` | StaffPayroll | |
| `/staff/attendance` | StaffAttendance | |
| `/staff/schedule-reports` | StaffScheduleReports | |
| `/staff/users` | StaffUsers | |
| `/staff/tenants` | StaffTenants | **Registered but NOT referenced by any nav item** — both nav trees link to `/staff/settings?tab=tenants` instead. Hidden/orphan route. |
| `/staff/help` | StaffHelpCenter | |
| `/staff/reminders` | StaffReminders | |
| `/staff/order-services` | StaffOrderServices | |
| `/staff/tools/assets` | StaffAssetsRegister | |
| `/staff/employee-reports` | StaffEmployeeReports | |
| `/staff/transactions/society` | StaffComingSoon | Stub |
| `/staff/transactions/tombstone` | StaffComingSoon | Stub |
| `/staff/transactions/credit-notes` | StaffComingSoon | Stub |
| `/staff/transactions/invoices` | StaffComingSoon | Stub |
| `/staff/transactions/petty-cash` | StaffComingSoon | Stub |
| `/staff/transactions/bank-deposits` | StaffComingSoon | Stub |
| `/staff/transactions/debit-orders` | StaffDebitOrders | Real page |
| `/staff/transactions/fax` | StaffComingSoon | Stub |
| `/staff/reports/dynamic-generic` | StaffComingSoon | Stub |
| `/staff/tools/easypay` | StaffComingSoon | Stub |
| `/staff/tools/print-policy-cards` | StaffComingSoon | Stub |
| `/staff/tools/statistics` | StaffStatistics | Real page |
| `/staff/tools/statistical-graphs` | StaffStatisticalGraphs | Real page |
| `/staff/tools/claims-form` | StaffComingSoon | Stub |
| `/staff/tools/transport-companies` | StaffTransportCompanies | Real page (DirectoryPage) |
| `/staff/tools/contacts` | StaffContacts | Real page (DirectoryPage) |
| `/staff/admin/society` | StaffSocietyAdmin | Redirect-only component → `/staff/groups` |
| `/staff/admin/tombstones` | StaffComingSoon | Stub |
| `/staff/admin/invoice-items` | StaffComingSoon | Stub |
| `/staff/admin/agents` | StaffAgentsAdmin | Real page |
| `/staff/admin/brokers` | StaffBrokers | Real page (DirectoryPage) |
| `/staff/admin/member-cards` | StaffComingSoon | Stub |
| `/staff/admin/terminals` | StaffComingSoon | Stub |
| `/staff/admin/branches` | StaffBranchAdmin | Real page |
| `/staff/admin/sub-groups` | StaffComingSoon | Stub |
| `/staff/admin/underwriters` | StaffUnderwriters | Real page (DirectoryPage) |
| `/staff/admin/undertakers` | StaffUndertakers | Real page (DirectoryPage) |
| `/auth/callback` | AuthCallback | |
| `/join` | JoinPage | |
| `/join/register` | JoinRegisterPage | |
| `/verify` | VerifyPage | |
| `/client/login` | ClientLogin | |
| `/client/claim` | ClientClaim | |
| `/client/reset-password` | ClientResetPassword | |
| `/client` | ClientDashboard | |
| `/client/payments` | ClientPayments | |
| `/client/documents` | ClientDocuments | |
| `/client/documents/view/:policyId` | ClientDocumentView | |
| `/client/claims` | ClientClaims | |
| `/client/feedback` | ClientFeedback | |
| `/client/payments/return` | `PaynowReturnRedirect` (inline) | Redirects to `/client/payments?returned=1` |
| *(any other path)* | `NotFound` | Catch-all |

**Hidden/unreachable-from-nav routes** (registered in App.tsx, not linked from either StaffLayout
nav tree): `/staff/tenants` (orphaned — superseded by `/staff/settings?tab=tenants`), and
`/staff/diagnostics` is reachable only via the "System Issue Reports" label (name mismatch vs.
route path, easy to miss when grepping for "diagnostics" in the UI). `StaffDiagnostics` itself is
otherwise a normal nav destination, just under a differently-worded label. All `StaffComingSoon`
stub routes ARE linked from nav (by design — placeholders for future modules).

---

## 4. Per-page detail — Steps 3 & 4 files

### staff/dashboard.tsx
- **Route**: `/staff`, `/staff/`
- **Sidebar location**: "Home" standalone link (both nav variants)
- **Tabs**: None (single scrolling page). Renders conditionally based on mode:
  - **Control-plane mode** (platform owner, no tenant selected): KPI cards (Tenants/Users/Policies/Clients) + "Tenants" list with "Enter Tenant" buttons (calls `/api/platform/switch-tenant`) and an empty-state "Create first tenant" CTA.
  - **Tenant mode**: PageHeader → optional `<CommandCenter />` (if `commandCenters` flag) OR legacy "Quick access" card (links to Notifications/Help/Order services/Reminders/Finance) → Filters card (Date From/To, Policy Status select, Branch select) → KPI stat-card grid (Total Policies, Covered Lives, Leads&Clients/My Clients, Claims, Funeral Cases, Lead Conversion %, Transactions, Retention Rate — each gated by permission) → Revenue trend (AreaChart) + Policy status breakdown (PieChart) side by side, gated `canReadFinance` → Lead conversion funnel (BarChart, gated `canReadLead` + not agent) + Lapse & retention metrics card → Executive Finance Dashboard (`ExecutiveSummarySection`, gated `canReadFinance` and not agent): KPI row (Total income/expenses/net surplus/unbanked cash USD), New policies/Claims submitted/Claims approved/Income-individual-premiums row, Income-by-branch list, Admin cash positions list (flags stale unbanked cash >2 days with amber highlight + TriangleAlert icon).
- **Dialogs/Modals**: None.
- **Key actions**: "Enter Tenant" (switch-tenant mutation, redirects to `/staff`), date-range/status/branch filters (drive several queries), `PeriodSelector` widget reused for revenue trend and executive summary independently.
- **Notable business logic**: Executive summary explicitly labeled "cash-basis P&L... derived from issued receipts and paid disbursements." Admin cash "staleness" rule: `stale = onHand > 0 && (days === null || days > 2)`. Retention/lapse rate percentages computed server-side and just displayed. Lead funnel stage ordering hardcoded: lead → captured → contacted → quote_generated → application_started → submitted → approved → agreed_to_pay → activated → lost.

### staff/finance.tsx (3477 lines — largest finance surface)
- **Route**: `/staff/finance` (tab selected via `?tab=` query param)
- **Sidebar location**: Finance bucket (both nav variants), many items point here with different `?tab=`
- **Tabs** (14, each with a descriptive tooltip on the trigger): Payments & Receipts (`payments`), Receipting by Staff (`receipting-by-staff`, hidden for agents/commission-only), Mobile & Cash (`paynow`), Cash-up Reconciliation (`cashups`), Commissions (`commissions`, gated `canReadCommission`), My P&L (`my-pnl`, commission-only users), Requisitions (`requisitions`), FX Rates (`fx-rates`, gated `canManageSettings`), Expenditures (`expenditures`), Platform Fees (`platform` — tooltip: "Platform revenue owed to POL263 (2.5% on all cleared receipts — policy premiums and funeral service payments)"), Month-End Close (`month-end`, gated `canWriteFinance`), Group Receipt (`group-receipt`, gated `canWriteFinance`), Pending Approvals (`approvals`, gated `canApproveFinance` — tooltip: "Review and approve backdated group receipts before they are applied"), Banking & Cash (`banking`).
- **Dialogs/Modals** (14): approval action dialog (approve/reject a pending item), Bank account create dialog, Deposit dialog, Balance-adjustment dialog, Create Cashup dialog, Confirm Cashup dialog, Payment dialog, Cash Receipt dialog, Requisition create/edit dialog, Requisition approve dialog, Requisition mark-paid dialog, Settlement dialog, Receipt dialog (view/print).
- **Key actions/business logic**: Month-End Close panel (`MonthEndRunUpload`) uploads a CSV to `/api/month-end-run` to batch-collect overdue premiums, plus a separate "Apply credit balances (due premiums)" button hitting `/api/apply-credit-balances` that auto-applies existing credit balance to policies with amounts due. Receipting-by-staff panel breaks down receipted totals by user and by branch for a selected period, plus a "legacy unattributed" bucket for old receipts with no user/branch. Cash-up reconciliation = "count cash collected against receipts issued." Admin cash-position staleness logic mirrors dashboard.tsx. Platform fee is a hardcoded 2.5% rate per the tooltip text (actual calc lives server-side).

### staff/mortuary.tsx (1432 lines)
- **Route**: `/staff/mortuary`
- **Sidebar location**: Transactions bucket (Legacy) / Claims bucket (New Nav), label "Mortuary Register"
- **Tabs**: None — master/detail pattern (intake list ↔ selected-intake detail view), not `Tabs` components.
- **Dialogs/Modals**: Create Intake, Record Dispatch, Add Belonging, Body Wash requirements, Record (storage) Payment, Chapel & Wash Bay Payment, Send For Post-Mortem.
- **Key actions**: "Blank Forms" dropdown (Intake Form, Dispatch Note, Deceased Belongings, Body Wash Form, Storage Receipt — all open server-generated blank PDFs in a new tab); "Record Intake" primary button; per-intake action bar: Print Receipt, Belongings PDF, Body Wash Form PDF, Storage Receipt PDF (only if a partner parlour is attached), Print Dispatch Note (only once dispatched), "Record Dispatch" button (only while not yet dispatched).
- **Notable business logic**: `serviceScope` enum = full_service / storage_only / removal_only. Storage fee status enum = unpaid / paid_at_admission / paid_at_collection, each with distinct badge coloring. KPI row: In Storage count, Dispatched count, Total Intakes, Unpaid Fees (only counts intakes that have a `partnerParlourId` — i.e., fees owed to a partner mortuary, not internal storage). Post-mortem movement tracking is a separate sub-entity with its own "send" and "return" mutations (body can be sent out for post-mortem and later recorded as returned).

### staff/policies.tsx (4480 lines — largest single page in the app)
- **Route**: `/staff/policies` (supports `?openPolicy=<id>` deep link from global policy search)
- **Sidebar location**: appears under multiple labels in both nav trees ("Policy Transactions"/"New Policy"/"Policies"/"Policy Admin" — all the same route)
- **Tabs** (policy detail view, 6): Overview, Members, Financials, Payments, Documents, Waivers.
- **Dialogs/Modals** (19+): Edit Add-Ons, e-Statement viewer, Policy Document viewer, Waiver dialog, Receipt-success dialog (with A4/other view-format toggle), Transition-status dialog, Edit-policy dialog, Edit-member dialog, Upgrade dialog, Payment-method dialog, Add-dependent dialog, In-policy receipt dialog, Confirm-delete-policy (AlertDialog), Edit-payment dialog, Confirm-delete-payment (AlertDialog), Edit-receipt dialog, Confirm-delete-receipt (AlertDialog), Create-policy dialog (multi-step, `createStep` state — likely the `policyWizard`-flag-gated flow), second Transition-status dialog instance, second Confirm-delete-policy instance for the list view.
- **Key actions**: Policy transitions restricted to a fixed graph: `inactive→cancelled`; `active→grace|cancelled`; `grace→lapsed`; `lapsed→cancelled` (no path back to active except reinstatement, handled elsewhere). National ID validated client-side against regex `^\d+[A-Z]\d{2}$` (Zimbabwean ID format). Print/share document actions via `printDocument`/`shareDocument` helpers. Permission-gated edit/delete for premium (`edit:premium` or platform owner), payments (`edit:payment`/`delete:payment`), receipts (`edit:receipt`/`delete:receipt`), policy delete (`delete:policy`). `policyWizard` feature flag toggles the creation UX.
- **Notable business logic**: PayNow-paid-like statuses normalized via `isPaynowPaidLike()` (paid/sent/awaiting delivery/delivered treated as equivalent for a check). Status color coding consistent with dashboard's `STATUS_COLORS`.

### staff/claims.tsx (681 lines)
- **Route**: `/staff/claims` (supports `?create=1` to auto-open the create dialog)
- **Sidebar location**: Transactions/Administration (Legacy) or Claims bucket (New Nav)
- **Tabs**: None — single register table with a status Select filter.
- **Dialogs/Modals**: Create Claim (multi-step form embedded in one dialog: policy search → covered-member picker (auto-fills deceased name/relationship) → claim type → deceased details → cash-in-lieu amount+currency → assessment notes → recommendation), Transition Status dialog, Claim Details view dialog.
- **Key actions**: "Blank Claim Form" (opens server PDF), "Log New Claim". Status transition graph: `submitted→verified|rejected`; `verified→approved|rejected`; `approved→scheduled|payable`; `scheduled→completed`; `payable→paid`; `completed→closed`; `paid→closed`. Claim types: death, accidental_death, disability, repatriation, cash_in_lieu.
- **Notable business logic**: `approvalNotes` field is a single text column but the UI parses/reconstructs it into "Assessment:" and "Recommendation:" sections via regex (`parseApprovalNotes`), so structured data is stored as formatted free text rather than separate columns. Recommendation options: approve / reject / investigate ("Further Investigation Required"). Submitting a claim always routes to an "approvals queue" regardless of recommendation.

### staff/products.tsx (2200 lines)
- **Route**: `/staff/products`
- **Sidebar location**: Administration/Setup bucket, "Product Admin"/"Products"
- **Tabs** (6): Products, Benefits, Bundles, Add-Ons, Age Bands, Terms & Conditions.
- **Dialogs/Modals**: CreateProductDialog, delete-product AlertDialog, CreateBenefitDialog, CreateBundleDialog, CreateAddOnDialog, CreateAgeBandDialog, plus ~9 more generic `Dialog` instances (edit variants of each, terms/conditions editor with title/content/category/sortOrder fields).
- **Key actions**: Create/delete for each of Products, Benefit catalog items, Bundles, Add-ons, Age bands; product image/casket-image upload.
- **Notable business logic**: `Product` shape carries `maxAdults`/`maxChildren`/`maxExtendedMembers`/`maxAdditionalMembers` caps and a `casketType`/`casketImageUrl`. `ProductVersion` (versioned pricing config) carries: premium by schedule×currency (monthly/weekly/biweekly, USD/ZAR), eligibility min/max age, dependent max age, waiting-period days (general / accidental death / suicide — three distinct waiting periods), grace-period days, cash-in-lieu amounts (adult/child), commission structure (first-N-months rate, recurring-start-month, recurring rate, clawback threshold, funeral incentive), underwriter amounts (adult/child) + advance months, additional-member premium tiers split by age band (child / 21-65 / 66-84 / 85+) × currency, and reinstatement rules (`reinstatementRequiresArrears`, `reinstatementNewWaitingPeriod`). This confirms the product-versioning and age-banded pricing model described in CLAUDE.md.

### staff/pricebook.tsx (898 lines)
- **Route**: `/staff/pricebook`
- **Sidebar location**: Administration/Setup or Claims bucket (New Nav), "Price Book"
- **Tabs** (2): Price Book, Cost Sheets.
- **Dialogs/Modals**: Create/edit Price Book Item dialog, Create Cost Sheet dialog (plus likely line-item add dialogs within cost sheets, not individually enumerated here).
- **Key actions**: Create/edit/deactivate price book items scoped optionally per-branch; build a Cost Sheet against a funeral case or claim, adding line items referencing price-book items with computed line totals.
- **Notable business logic**: Fixed category list (Casket & Coffin, Transport, Mortuary Services, Flowers & Wreaths, Venue & Catering, Burial & Cemetery, Documentation, Clothing & Dressing, Religious Services, Other) and fixed casket-type list (Flat Lid, Dome, Mini Dome, Executive Dome, 2-Tier, 3-Tier, Coffin Shaped) — same casket taxonomy as products.tsx and quotations.tsx. Pricing items are versioned (`version` field) and have `effectiveFrom`/`effectiveTo` date ranges. Cost sheets have a `status` and `approvedBy` — implying an approval workflow for funeral cost estimates.

### staff/quotations.tsx (937 lines) — "Cash Service Quotes"
- **Route**: `/staff/quotations`
- **Sidebar location**: Transactions/Claims bucket, "Cash Service Quotes"
- **Tabs**: None — list + status filter (`statusFilter`), heavy dialog-driven detail work.
- **Dialogs/Modals**: `QuoteDialog` (new + edit, largest — captures informant details, deceased details, casket type, payment type, VAT rate, discount, line items against `STANDARD_ITEMS` catalog), `GuarantorDialog`, `CollateralDialog`, `LinkCaseDialog` (links a quote to a funeral case).
- **Key actions**: New Quote, Add Guarantor, Add Collateral, Link to Case.
- **Notable business logic**: `STANDARD_ITEMS` is a hardcoded 15-line default cost breakdown (Type of Coffin, Admin Fees, Removal Fee, Undertakers Fees, Storage, Overnight Charge, Diversion of Route, Grave Fee, Doctor's Fee, Embalming, Tent, Lowering Device, Home Tent, Bus, Handling Fee) pre-seeded into every new quote. `computeTotals()`: subtotal = Σ(qty×unitPrice); VAT = subtotal × vatRate/100; grand total = max(0, subtotal + VAT − discount) (floors at zero). Conversion-status badges: converted (green) / partial (blue, "Partial Payment") / pending (amber, default). This is the "cash sale" (non-policy) funeral-service quoting flow, distinct from the policy-based Claims flow — quotations can later be linked to a funeral case or converted to payment.

### staff/reports.tsx (2463 lines) + client/src/lib/staff-reports-nav.ts
- **Route**: `/staff/reports` (section/tab driven by `?section=` & `?tab=` query params, parsed by `parseReportSearchParams`)
- **Sidebar location**: Reports bucket (both variants) — each nav item is a deep link into a specific `section`
- **Sections → Tabs** (6 sections, 29 tabs total, each independently permission/dataset-gated):
  - **Policies**: Overview, Policy details, Active, Awaiting payment, Overdue/grace, Pre-lapse, Lapsed, New joinings, Activations, Conversions, Reinstatements
  - **Finance** (requires `canReadFinance`): Income Statement, Cash Flow, Balance Sheet, Finance, Underwriter payable, Receipts, Payments, Expenditure, Cashups, POL263 revenue ("platform")
  - **Agents**: Agent portfolio, Agent productivity, Commissions summary (requires `canReadCommission`), Commission by payment (requires `canReadCommission`)
  - **Claims** (requires `canReadClaim`): Claims
  - **Operations**: Funerals (requires `canReadFuneralOps`), Fleet (requires `canReadFleet`)
  - **Payroll** (requires `canReadPayroll`): Payroll
- **Dialogs/Modals**: Balance-sheet entry add/edit dialog (only one directly identified — reports are mostly read-only/export views).
- **Key actions**: "Download CSV" export button per report tab (`/api/reports/export/:reportType`), shared filter bar (From/To dates, Branch, Product, Agent, Status — the Status options vary per tab, e.g. claim statuses vs. policy statuses), Balance Sheet supports inline add/edit of manual entries (asset/liability sections, current/non-current subsections) alongside the computed report.
- **Notable business logic**: Sections and their tab lists are centrally defined in `staff-reports-nav.ts` (`SECTION_TAB_DEFS`, `TAB_DATASETS` map each tab to the API dataset(s) it needs so queries can be `enabled` conditionally, `visibleReportSections()` computes which of the 6 section tabs to show at all based on permissions). This is the single most page/permission-dense screen in the app.

### staff/assets-register.tsx (58 lines) — trivial/local-only stub
- **Route**: `/staff/tools/assets`
- **Sidebar location**: Tools/Setup bucket, "Asset Register"
- **Tabs/Dialogs**: None.
- **Key actions**: "Add row" — appends to component-local React state only (`useState<Row[]>`), no API call, no persistence.
- **Notable business logic**: Explicitly documented as a placeholder in its own description text: "Optional checklist... Stored in this session only until a dedicated module is added." Confirms this is NOT wired to a backend table despite being reachable from real navigation with a `read:audit_log` permission gate.

### staff/audit.tsx (256 lines)
- **Route**: `/staff/audit`
- **Sidebar location**: Tools/Setup bucket, "Audit Trail"
- **Tabs**: None — filterable, paginated table (page size 50).
- **Dialogs/Modals**: None (uses inline `<details>`/`<summary>` disclosure per-row for before/after diff, not a modal).
- **Key actions**: Search (debounced 300ms) across actor/action/entity; Action-type filter (fixed list: CREATE_CLIENT, CREATE_POLICY, CREATE_PAYMENT, UPDATE_ORGANIZATION, CASH_RECEIPT, UPDATE_CLIENT, UPDATE_POLICY, DELETE_CLIENT, CREATE_CLAIM, UPDATE_CLAIM, CREATE_PRODUCT, UPDATE_PRODUCT); date-range filter; Previous/Next pagination.
- **Notable business logic**: Each row can expand a "View diff" disclosure showing raw JSON `before`/`after` state (red-tinted BEFORE block, green-tinted AFTER block) — direct UI reflection of the `auditLog()` before/after JSONB pattern described in CLAUDE.md.

---

## 5. staff/admin/* (Glob: 6 files)

| File | Route | Sidebar | Tabs | Dialogs | Key actions | Notes |
|---|---|---|---|---|---|---|
| `admin/agents.tsx` | `/staff/admin/agents` | Administration/Setup — "Agent Admin" | None | None | Search by name/email/referral code; "Manage user accounts" link out to `/staff/users` | Read-only directory joining `/api/agents` with `/api/reports/commissions-summary` per agent (shows policy count, commission earned, clawback if non-zero). No create/edit here — actual agent account management happens in Users. |
| `admin/branches.tsx` | `/staff/admin/branches` | Administration/Setup — "Branch Admin" | None | New Branch dialog (name, address, phone, active toggle) | "New Branch" button; `EnhancedDataTable` with search/export | Real CRUD-lite page (create + list only, no edit/delete UI) built on existing `/api/branches` GET/POST. KPI cards: Branches count, Active count. |
| `admin/brokers.tsx` | `/staff/admin/brokers` | Administration/Setup — "Broker Admin" | — | — | — | Thin wrapper around shared `DirectoryPage` component, `type="broker"`. Note in UI: "Broker commission calculations are recorded under Reports → Commissions Summary." |
| `admin/society.tsx` | `/staff/admin/society` | Administration/Clients — "Society Admin" | — | — | — | **Not a real page** — pure redirect component, `useEffect` → `setLocation("/staff/groups")`. Society management has been consolidated into the Groups module. |
| `admin/undertakers.tsx` | `/staff/admin/undertakers` | Setup — "Undertaker Admin" | — | — | — | `DirectoryPage` wrapper, `type="undertaker"`. Note: referenced from claims/funeral coordination flow. |
| `admin/underwriters.tsx` | `/staff/admin/underwriters` | Setup — "Underwriter Admin" | — | — | — | `DirectoryPage` wrapper, `type="underwriter"`. Note: "Each product can be linked to an underwriter for reinsurance tracking and reporting" — ties to `underwriterAmountAdult/Child` fields seen in products.tsx. |

## 6. staff/tools/* (Glob: 2 files)

| File | Route | Sidebar | Tabs | Dialogs | Key actions | Notes |
|---|---|---|---|---|---|---|
| `tools/contacts.tsx` | `/staff/tools/contacts` | Tools/Setup — "Contacts Manager" | — | — | — | `DirectoryPage` wrapper, `type="contact"`. Described as "General address book — lawyers, regulators, suppliers, emergency contacts." |
| `tools/transport-companies.tsx` | `/staff/tools/transport-companies` | Tools/Claims — "Transport Companies" | — | — | — | `DirectoryPage` wrapper, `type="transport_company"`. Notes field recommended for fleet/pricing details. |

Both `admin/brokers|undertakers|underwriters` and `tools/contacts|transport-companies` (5 files
total) share one generic `DirectoryPage` component (not read in full here — likely at
`client/src/components/directory-page.tsx`) that presumably provides its own CRUD list/dialog
internally, parameterized by `type`/`singularLabel`/`extraNotes`.

## 7. staff/transactions/* (Glob: 1 file)

| File | Route | Sidebar | Tabs | Dialogs | Key actions | Notes |
|---|---|---|---|---|---|---|
| `transactions/debit-orders.tsx` | `/staff/transactions/debit-orders` | Finance/Collections — "Debit Orders" | None | New Debit Order dialog (account holder, bank, account number, branch code, amount, currency, frequency, day of month, start date, notes) | Pause / Resume / Cancel per-row actions (icon buttons, permission-gated by `write:finance`) | Real page (only non-stub file in this folder — the other 6 sibling routes under `/staff/transactions/*` all render `StaffComingSoon`). KPI cards: Mandates count, Active count, Monthly Value (USD, sums active+monthly-frequency orders only). Frequencies: weekly/biweekly/monthly/quarterly. Status badge colors: active=emerald, paused=amber, cancelled=red. |

---

## 6. Cross-reference: hidden / not-in-nav routes (recap)

- `/staff/tenants` — registered, has its own lazy component (`StaffTenants`), but **no nav item links to it** in either Legacy or New Nav; both trees use `/staff/settings?tab=tenants` for the "Tenants" label instead. True orphan route (still reachable by direct URL).
- `/staff/diagnostics` — reachable, but only under the label "System Issue Reports" in the Reports bucket, not literally named "Diagnostics" anywhere in the UI.
- `/staff/admin/society` — technically a route/nav item, but immediately redirects client-side to `/staff/groups`; functionally not a distinct page.
- 13 `StaffComingSoon` stub routes ARE all linked from nav (by design, as forward-placeholders): transactions/{society,tombstone,credit-notes,invoices,petty-cash,bank-deposits,fax}, reports/dynamic-generic, tools/{easypay,print-policy-cards,claims-form}, admin/{tombstones,invoice-items,member-cards,terminals,sub-groups}.


---

# SECTION 4 — DATABASE ANALYSIS

Source of truth for this section: `shared/schema.ts` (3,069 lines, ~103 `pgTable` definitions, read in full) and `shared/control-plane-schema.ts` (223 lines, read in full, defines a **separate** database used only for tenant routing/metadata). ORM: Drizzle ORM on PostgreSQL. Zod insert schemas are auto-derived from the Drizzle tables via `drizzle-zod`'s `createInsertSchema()`.

Every table below is annotated with: Purpose, Columns, Relationships, Indexes, Constraints, Foreign Keys, Tenant awareness, Soft delete, and Audit fields, per the request. Where a table has no interesting index/constraint beyond the primary key, that is stated explicitly rather than omitted.

---

## 0. How Tenancy Is Encoded (read this first)

Almost every tenant-owned table in `schema.ts` carries an `organization_id uuid` column with `.references(() => organizations.id)`, usually `NOT NULL`, and usually has a btree index on it (`*_org_idx`). A handful of tables are **global/platform-level** with no `organization_id` at all — these are called out explicitly in each section and summarized in §11.

Additionally, `shared/control-plane-schema.ts` defines an **entirely separate physical database** (lives in a separate DigitalOcean Postgres instance called `pol263-control-plane`) that stores only tenant metadata/routing — never business data. This is architecturally distinct from "global tables inside the main schema" (like `organizations`, `permissions`) — see §10 for the full contrast.

Multi-tenancy has a second axis beyond row-level `organization_id` scoping: **database-level** isolation. `organizations.databaseUrl` (nullable) and the control-plane's `tenantDatabases.databaseUrl` indicate that a given tenant's *entire* schema (all tables in this document) may live in a dedicated Postgres instance rather than the shared multi-tenant database, routed at runtime by `server/tenant-db.ts`. So "tenant-owned" tables are tenant-owned twice over: scoped by `organization_id` row-filtering AND potentially physically isolated to a per-tenant database.

---

## 1. Core Platform / Multi-Tenancy

### `organizations`
- **Purpose**: The tenant record itself — one row per insurance company/funeral parlour customer of the SaaS. Holds branding, policy numbering config, and per-tenant PayNow merchant credentials.
- **Columns**:
  | Column | Type | Nullable | Default |
  |---|---|---|---|
  | id | uuid PK | no | `defaultRandom()` |
  | name | text | no | — |
  | logoUrl | text | yes | `/assets/logo.png` |
  | signatureUrl | text | yes | — |
  | primaryColor | text | yes | `#0d9488` |
  | footerText | text | yes | — |
  | address, phone, email, website | text | yes | — |
  | policyNumberPrefix | text | yes | — |
  | policyNumberPadding | integer | no | 5 |
  | createdAt | timestamp | no | `now()` |
  | databaseUrl | text | yes | — (set ⇒ tenant has isolated DB) |
  | isWhitelabeled | boolean | no | false |
  | paynowIntegrationId / paynowIntegrationKey / paynowAuthEmail / paynowReturnUrl / paynowResultUrl | text | yes | — |
  | paynowMode | text (`"test"\|"live"`) | yes | — |
- **Relationships**: Referenced by nearly every other tenant table (1:N parent). No FKs out of this table.
- **Indexes**: none beyond PK.
- **Constraints**: none beyond PK/NOT NULL.
- **Foreign keys**: none (root of the tenancy tree).
- **Tenant awareness**: **This IS the tenant.** No `organization_id` column (it would be self-referential).
- **Soft delete**: none (hard delete only, though in practice tenants are likely never deleted).
- **Audit fields**: `createdAt` only, no `updatedAt`/`createdBy`.

### `branches`
- **Purpose**: Sub-locations of an organization (physical branch offices).
- **Columns**: id (uuid PK), organizationId (uuid, FK, NOT NULL), name (text, NOT NULL), address (text), phone (text), isActive (boolean, default true), createdAt (timestamp, default now).
- **Relationships**: N:1 → `organizations`. Referenced (1:N) by dozens of tables (policies, clients, claims, requisitions, fleet vehicles, etc.) as an optional `branchId`.
- **Indexes**: `branches_org_idx` on organizationId.
- **Constraints**: organizationId NOT NULL.
- **Foreign keys**: organizationId → organizations.id.
- **Tenant awareness**: tenant-owned (org-scoped).
- **Soft delete**: none (isActive flag serves as a soft-disable, not a delete marker).
- **Audit fields**: createdAt only.

### `orgMemberSequences`
- **Purpose**: Per-org atomic counter for generating unique member numbers (e.g. `MEM-000001`), avoiding race conditions under concurrent inserts.
- **Columns**: organizationId (uuid, PK, FK, cascade delete), memberNext (integer, default 1, NOT NULL).
- **Relationships**: 1:1 → organizations (PK is the FK itself).
- **Indexes**: none beyond PK.
- **Constraints**: PK = organizationId; `onDelete: "cascade"`.
- **Tenant awareness**: tenant-owned, singleton-per-org.
- **Soft delete**: n/a (counter row).
- **Audit fields**: none.

### `orgPolicySequences`
- **Purpose**: Per-org atomic counters for policy numbers, receipt numbers, payment-receipt numbers, claim numbers, case numbers, mortuary numbers, quotation numbers, employee numbers, requisition numbers, and disbursement numbers — one shared row per org holding 10 independent counters to guarantee gap-free, concurrency-safe numbering per sequence type.
- **Columns**: organizationId (uuid PK, FK, cascade), policyNext, receiptNext, paymentReceiptNext, claimNext, caseNext, mortuaryNext, quotationNext, employeeNext, requisitionNext, disbursementNext — all `integer NOT NULL` with defaults (policyNext defaults 1; all others default 0).
- **Relationships**: 1:1 → organizations.
- **Indexes**: none beyond PK.
- **Tenant awareness**: tenant-owned, singleton-per-org.
- **Soft delete**: n/a.
- **Audit fields**: none.

---

## 2. Identity & RBAC

### `users` (staff/agents — internal actors)
- **Purpose**: Internal system users: staff, agents, managers. Authenticated via Google OAuth only (per CLAUDE.md).
- **Columns**: id (uuid PK), email (text, NOT NULL, UNIQUE), googleId (text, UNIQUE), passwordHash (text, nullable — vestigial/unused per Google-only auth policy), displayName, avatarUrl, referralCode (UNIQUE), organizationId (uuid, FK, nullable — **nullable so platform owners can be unlinked from any tenant**, see migration 0010), branchId (uuid, FK, nullable), isActive (boolean, default true), phone, address, nationalId, dateOfBirth (date), gender, maritalStatus, nextOfKinName, nextOfKinPhone, department (text), createdAt (timestamp).
- **Relationships**: N:1 → organizations (nullable), N:1 → branches (nullable). Referenced (1:N) extremely widely as `agentId`/`actorId`/`createdBy`/`approvedBy`/etc. across claims, policies, payments, funerals, fleet, payroll, etc.
- **Indexes**: `users_org_idx` on organizationId.
- **Constraints**: UNIQUE(email), UNIQUE(googleId), UNIQUE(referralCode).
- **Foreign keys**: organizationId → organizations.id; branchId → branches.id.
- **Tenant awareness**: tenant-scoped but organizationId is **nullable** — this is the mechanism for the platform-owner "super-admin above all tenants" concept (see migration `0010_platform_owner_unlink.sql` and `0011_rename_chibikhulu_to_platform.sql`).
- **Soft delete**: none (isActive is a disable flag, not deletion).
- **Audit fields**: createdAt only.

### `roles`
- **Purpose**: RBAC role definitions (e.g. Superuser, Policy Manager, Finance).
- **Columns**: id (uuid PK), organizationId (uuid, FK, **nullable** — null = system/global role available to all tenants), name (text NOT NULL), description (text), isSystem (boolean, default false), createdAt.
- **Relationships**: N:1 → organizations (nullable). Referenced by rolePermissions (1:N) and userRoles (1:N).
- **Indexes**: `roles_org_idx`.
- **Tenant awareness**: hybrid — org-scoped custom roles + nullable-org system roles shared globally.
- **Soft delete**: none.
- **Audit fields**: createdAt only.

### `permissions`
- **Purpose**: Atomic permission catalog (e.g. `write:policy`), platform-wide (not per tenant).
- **Columns**: id (uuid PK), name (text, NOT NULL, UNIQUE), description (text), category (text).
- **Relationships**: Referenced by rolePermissions and userPermissionOverrides (1:N each).
- **Constraints**: UNIQUE(name).
- **Tenant awareness**: **GLOBAL** — no organizationId column at all. Permission catalog is shared across all tenants.
- **Soft delete**: none. **Audit fields**: none (no createdAt).

### `rolePermissions`
- **Purpose**: Join table — grants a permission to a role.
- **Columns**: roleId (uuid, FK, cascade), permissionId (uuid, FK, cascade).
- **Relationships**: N:1 → roles (cascade delete), N:1 → permissions (cascade delete). Composite semantics for role↔permission M:N.
- **Indexes**: `rp_role_idx` on roleId; `rp_role_perm_unique_idx` UNIQUE on (roleId, permissionId).
- **Constraints**: uniqueness on the pair prevents duplicate grants.
- **Tenant awareness**: inherits tenancy from `roles` (indirect).
- **Soft delete/Audit**: none.

### `userRoles`
- **Purpose**: Join table assigning a role to a user, optionally scoped to one branch.
- **Columns**: id (uuid PK), userId (FK, cascade), roleId (FK, cascade), branchId (FK, nullable — null = org-wide), createdAt.
- **Indexes**: `ur_user_idx` on userId.
- **Foreign keys**: userId → users.id (cascade); roleId → roles.id (cascade); branchId → branches.id.
- **Tenant awareness**: inherits tenancy via users/roles.
- **Audit fields**: createdAt only.

### `userPermissionOverrides`
- **Purpose**: Per-user permission grant/revoke overrides layered on top of role-derived permissions.
- **Columns**: id (uuid PK), userId (FK, cascade), permissionId (FK, cascade), isGranted (boolean, NOT NULL — true=explicit grant, false=explicit revoke).
- **Indexes**: `upo_user_idx` on userId.
- **Audit fields**: none (no createdAt — notable gap).

---

## 3. Clients (Policyholders) & Related

### `securityQuestions`
- **Purpose**: Catalog of security questions clients can select for account recovery.
- **Columns**: id (uuid PK), organizationId (FK, nullable — null = global/shared question bank), question (text NOT NULL), isActive (boolean, default true).
- **Tenant awareness**: hybrid (nullable org, like roles).
- **Soft delete/Audit**: none.

### `clients`
- **Purpose**: The policyholder/customer record — the "client portal" identity and personal profile, including CRM-style fields (selling point, objections faced) captured by agents at sale time.
- **Columns** (abridged, ~30 columns): id (uuid PK), organizationId (FK NOT NULL), branchId (FK), title, firstName (NOT NULL), lastName (NOT NULL), nationalId, dateOfBirth (date), gender, maritalStatus, phone, email, address, physicalAddress, postalAddress, preferredCommMethod, location, sellingPoint, objectionsFaced, responseToObjections, clientFeedback, passwordHash, securityQuestionId (FK), securityAnswerHash, activationCode, isEnrolled (boolean, default false), failedLoginAttempts (integer, default 0), lockedUntil (timestamp), agentId (FK → users), isActive (boolean, default true), notificationTone (text, default "default"), pushEnabled (boolean, default false), createdAt.
- **Relationships**: N:1 → organizations, N:1 → branches, N:1 → securityQuestions, N:1 → users (agentId, the assigned agent). Referenced (1:N) by policies, dependents, claims, leads, clientDocuments, clientDeviceTokens, clientPaymentMethods, clientFeedback, debitOrders, dependentChangeRequests, etc.
- **Indexes**: `clients_org_idx`, `clients_branch_idx`, `clients_agent_idx`, `clients_org_email_idx` (org+email composite), `clients_org_national_id_idx` (org+nationalId composite).
- **Constraints**: none beyond indexes (no explicit UNIQUE on email/nationalId — composite indexes are non-unique lookup aids, not uniqueness constraints, meaning duplicate national IDs are technically permitted at the DB layer).
- **Foreign keys**: organizationId, branchId, securityQuestionId, agentId.
- **Tenant awareness**: tenant-owned (org-scoped, NOT NULL).
- **Soft delete**: none (isActive flag only — hard delete otherwise).
- **Audit fields**: createdAt only; no updatedAt/updatedBy despite being a frequently-edited entity.

### `clientDocuments`
- **Purpose**: Uploaded ID copies, proof-of-address, etc. for a client, stored in object storage (S3-compatible).
- **Columns**: id (uuid PK), organizationId (FK NOT NULL), clientId (FK NOT NULL), documentType (text NOT NULL — national_id/proof_of_address/passport/birth_certificate/other), label, fileName (NOT NULL), mimeType, fileUrl (NOT NULL), storageKey, fileSize (integer), uploadedBy (FK → users), createdAt.
- **Indexes**: `client_docs_org_idx`, `client_docs_client_idx`.
- **Tenant awareness**: tenant-owned. **Soft delete**: none. **Audit**: createdAt + uploadedBy (actor) only.

### `policyDocuments`
- **Purpose**: Documents attached to a specific policy (contract PDFs, endorsements, etc.).
- **Columns**: id, organizationId (FK NOT NULL), policyId (FK NOT NULL, **cascade delete**), documentType (NOT NULL), label, fileName (NOT NULL), mimeType, fileUrl (NOT NULL), storageKey, fileSize, uploadedBy (FK), createdAt.
- **Indexes**: `policy_docs_org_idx`, `policy_docs_policy_idx`.
- **Foreign keys**: policyId → policies.id ON DELETE CASCADE (hardened in migration 0042).
- **Tenant awareness**: tenant-owned.

### `waitingPeriodWaivers`
- **Purpose**: Requests to waive a policy's underwriting waiting period (e.g. compassionate exception), with an approval workflow.
- **Columns**: id, organizationId (FK NOT NULL), policyId (FK NOT NULL, cascade delete), requestedBy (FK NOT NULL → users), status (text, default "pending"), reason, supportingNotes, resolvedBy (FK), resolvedAt, rejectionReason, createdAt.
- **Indexes**: `wpw_org_idx`, `wpw_policy_idx`, `wpw_status_idx`.
- **Tenant awareness**: tenant-owned. **Audit**: createdAt + requestedBy/resolvedBy actors (maker-checker pattern).

### `clientDeviceTokens`
- **Purpose**: Push-notification device tokens registered by the client mobile app.
- **Columns**: id, organizationId (FK NOT NULL), clientId (FK NOT NULL), token (NOT NULL), platform (NOT NULL — ios/android/web), createdAt.
- **Indexes**: `cdt_org_idx`, `cdt_client_idx`, `cdt_token_org_idx` UNIQUE(organizationId, token).
- **Tenant awareness**: tenant-owned.

### `clientPaymentMethods`
- **Purpose**: Tokenized/obfuscated stored payment methods for automated premium collection (mobile money or legacy card).
- **Columns**: id, organizationId (FK NOT NULL), clientId (FK NOT NULL), methodType (NOT NULL — mobile/card), provider (ecocash/onemoney/visa_mastercard/other), mobileNumber, cardLast4, cardBrand, cardExpiryMonth/Year (integer), cardToken, isDefault (boolean, default true), isActive (boolean, default true), createdAt, updatedAt.
- **Indexes**: `cpm_org_idx`, `cpm_client_idx`.
- **Tenant awareness**: tenant-owned. **Audit**: createdAt + updatedAt (only table so far with both).

### `paymentAutomationSettings`
- **Purpose**: Per-org configuration for auto-collecting overdue premiums (cadence, toggles).
- **Columns**: id, organizationId (FK NOT NULL), isEnabled (boolean, default false), daysAfterLastPayment (integer, default 30), repeatEveryDays (integer, default 30), sendPushNotifications (boolean, default true), autoRunPayments (boolean, default true), createdAt, updatedAt.
- **Constraints**: `pas_org_unique_idx` UNIQUE(organizationId) — singleton settings row per org.
- **Tenant awareness**: tenant-owned, singleton.

### `paymentAutomationRuns`
- **Purpose**: Log of each automated reminder/collection attempt (audit trail for the automation engine).
- **Columns**: id, organizationId (FK NOT NULL), policyId (uuid, **no FK reference declared** — plain uuid, likely intentional to avoid hard FK churn on a high-volume log table), clientId (FK, nullable), actionType (NOT NULL — reminder/auto_payment_attempt), status (NOT NULL — success/failed/skipped), methodType, message, metadata (jsonb), createdAt.
- **Indexes**: `par_org_idx`, `par_policy_idx`, `par_created_idx`.
- **Tenant awareness**: tenant-owned.

### `dependents`
- **Purpose**: Family members / beneficiaries linked to a client (spouse, children, extended family) who can be added to policies as covered members.
- **Columns**: id, organizationId (FK NOT NULL), clientId (FK NOT NULL), memberNumber (text), firstName (NOT NULL), lastName (NOT NULL), nationalId, dateOfBirth (date), gender, relationship (NOT NULL), isActive (boolean, default true), createdAt.
- **Indexes**: `deps_client_idx`, `deps_org_idx`, `deps_member_number_org_idx` UNIQUE(organizationId, memberNumber).
- **Tenant awareness**: tenant-owned. **Soft delete**: none (isActive flag).

### `dependentChangeRequests`
- **Purpose**: Client-submitted requests to add/change/remove a dependent, subject to staff review.
- **Columns**: id, organizationId (FK NOT NULL), clientId (FK NOT NULL), policyId (uuid, no FK declared), requestType (NOT NULL), data (jsonb NOT NULL — arbitrary change payload), status (default "pending"), reviewedBy (FK), reviewNotes, createdAt, reviewedAt.
- **Indexes**: `dcr_client_idx`.
- **Tenant awareness**: tenant-owned.

---

## 4. Insurance Policies & Products

### `products`
- **Purpose**: A funeral/insurance product definition (e.g. "Family Cover Gold") — the parent of versioned pricing.
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), code (NOT NULL), description, maxAdults (integer, default 2), maxChildren (integer, default 4), maxExtendedMembers (integer, default 0), maxAdditionalMembers (integer, nullable = unlimited), casketType, casketImageUrl, coverAmount (numeric), coverCurrency (default "USD"), isActive (boolean, default true), createdAt.
- **Indexes**: `products_org_idx`, `products_code_org_idx` UNIQUE(code, organizationId).
- **Relationships**: 1:N → productVersions.
- **Tenant awareness**: tenant-owned.

### `productVersions`
- **Purpose**: Versioned, effective-dated pricing/config snapshot for a product — the actual premium rates, age eligibility, waiting periods, commission structure, and underwriter cost. This is the entity policies actually attach to (not `products` directly), enabling rate changes without altering in-force policies.
- **Columns** (~35 columns): id, productId (FK NOT NULL), organizationId (FK NOT NULL), version (integer NOT NULL), effectiveFrom (date NOT NULL), effectiveTo (date), premiumMonthlyUsd/Zar, premiumWeeklyUsd/Zar, premiumBiweeklyUsd/Zar (all numeric), eligibilityMinAge (default 18), eligibilityMaxAge (default 70), dependentMaxAge (default 20), waitingPeriodDays (default 90), waitingPeriodAccidentalDeath (default 0), waitingPeriodSuicide (default 0), gracePeriodDays (default 30), cashInLieuAdult/Child (numeric), reinstatementRequiresArrears (boolean, default true), reinstatementNewWaitingPeriod (boolean, default true), coverageRules (jsonb), exclusions (jsonb), commissionFirstMonthsCount/Rate, commissionRecurringStartMonth/Rate, commissionClawbackThreshold, commissionFuneralIncentive, underwriterAmountAdult/Child (numeric), underwriterAdvanceMonths (integer, default 0), additionalMemberPremiumMonthlyUsd/Zar, additionalMemberRateChildUsd/Zar, additionalMemberRate21To65Usd/Zar, additionalMemberRate66To84Usd/Zar, additionalMemberRate85PlusUsd/Zar (age-banded pricing, added migrations 0052/0055), isActive (default true), createdAt.
- **Indexes**: `pv_product_idx`, `pv_org_idx`.
- **Foreign keys**: productId → products.id; organizationId → organizations.id.
- **Tenant awareness**: tenant-owned.
- **Notes**: This table alone models most of the product-pricing complexity: multi-currency (USD/ZAR), multi-schedule (monthly/weekly/biweekly), age-banded add-on pricing, commission schedules, and underwriter cost-sharing — evolved incrementally via migrations 0016, 0018, 0052, 0053, 0055.

### `benefitCatalogItems`
- **Purpose**: Catalog of individual benefit items (e.g. "Tombstone", "Grocery hamper") usable in bundles.
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), description, internalCostDefault (numeric), isActive (default true), createdAt.
- **Indexes**: `bci_org_idx`. **Tenant awareness**: tenant-owned.

### `benefitBundles`
- **Purpose**: A named group of benefit items attachable to a product version.
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), description, items (jsonb), isActive (default true), createdAt.
- **Indexes**: `bb_org_idx`. **Tenant awareness**: tenant-owned.

### `productBenefitBundleLinks`
- **Purpose**: Join table linking a product version to a benefit bundle (M:N).
- **Columns**: id, productVersionId (FK NOT NULL), benefitBundleId (FK NOT NULL).
- **Indexes**: `pbbl_pv_idx`. **Tenant awareness**: inherited (no direct organizationId column — a rare case where tenancy is only reachable via join).

### `addOns`
- **Purpose**: Priced add-on products/riders a client can attach to a policy (e.g. extra cover, chapel use).
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), description, pricingMode (default "flat"), priceAmount, priceMonthly, priceWeekly, priceBiweekly (numeric), isActive (default true), createdAt.
- **Indexes**: `addons_org_idx`. **Tenant awareness**: tenant-owned.

### `ageBandConfigs`
- **Purpose**: Defines named age bands (e.g. "Senior 66-84") for versioned age-based pricing rules.
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), minAge (integer NOT NULL), maxAge (integer NOT NULL), version (integer, default 1), effectiveFrom (date), isActive (default true), createdAt.
- **Indexes**: `abc_org_idx`. **Tenant awareness**: tenant-owned.

### `policies`
- **Purpose**: The core insurance policy record — one row per active/lapsed/cancelled policy sold to a client.
- **Columns** (~30 columns): id, organizationId (FK NOT NULL), branchId (FK), policyNumber (NOT NULL), clientId (FK NOT NULL), productVersionId (FK NOT NULL), agentId (FK → users), groupId (FK → groups), status (default "inactive"), currency (default "USD" NOT NULL), premiumAmount (numeric NOT NULL), paymentSchedule (default "monthly"), effectiveDate (date), inceptionDate (date — set on first payment), waitingPeriodEndDate, currentCycleStart/End (date), graceEndDate (date), graceUsedDays (integer, default 0), lastAutoPaymentAttemptAt, lastAutoReminderAt (timestamp), cancelledAt (timestamp), cancelReason, beneficiaryFirstName/LastName/Relationship/NationalId/Phone (text), beneficiaryDependentId (FK → dependents), version (integer, default 1 — optimistic-concurrency style versioning), isLegacy (boolean, default false), premiumOverride (numeric(12,2) — manual override of computed premium), premiumOverrideNote, createdAt, **deletedAt (timestamp, nullable — SOFT DELETE)**.
- **Indexes**: `policy_number_org_idx` UNIQUE(policyNumber, organizationId), `policies_org_idx`, `policies_client_idx`, `policies_agent_idx`, `policies_status_idx`, `policies_branch_idx`, `policies_group_idx`, `policies_org_status_created_idx` (composite, org+status+createdAt — likely for dashboard/reporting queries).
- **Foreign keys**: organizationId, branchId, clientId, productVersionId, agentId, groupId, beneficiaryDependentId.
- **Tenant awareness**: tenant-owned.
- **Soft delete**: **YES — `deletedAt`** (added in migration 0051, one of only 3 tables with this column: policies, paymentTransactions, paymentReceipts).
- **Audit fields**: createdAt only (no updatedAt — `policyStatusHistory` serves as the change log instead).

### `policyMembers`
- **Purpose**: Join table representing each covered person on a policy (principal member or dependent), assigning member numbers.
- **Columns**: id, organizationId (FK, nullable), policyId (FK NOT NULL, cascade delete), clientId (FK, nullable), dependentId (FK, nullable), memberNumber, role (NOT NULL — e.g. principal/spouse/child), isActive (default true), createdAt.
- **Indexes**: `pm_policy_idx`, `pm_org_idx`, `pm_member_number_org_idx` UNIQUE(organizationId, memberNumber).
- **Foreign keys**: policyId → policies.id ON DELETE CASCADE.
- **Tenant awareness**: tenant-owned (though organizationId is nullable here, unusually).

### `policyStatusHistory`
- **Purpose**: Append-only audit trail of policy status transitions (inactive→active→grace→lapsed→cancelled).
- **Columns**: id, policyId (FK NOT NULL, cascade delete), fromStatus, toStatus (NOT NULL), reason, changedBy (FK → users), createdAt.
- **Indexes**: `psh_policy_idx`, composite `policy_status_history_policy_to_status_idx` (policyId, toStatus, createdAt).
- **Tenant awareness**: no direct organizationId (inherited via policyId join) — history/log table.
- **Audit fields**: this table *is* an audit mechanism (createdAt + changedBy actor).

### `policyAddOns`
- **Purpose**: Join table attaching an add-on to a policy, optionally scoped to one specific member.
- **Columns**: id, policyId (FK NOT NULL, cascade), addOnId (FK NOT NULL, cascade), policyMemberId (FK, nullable, cascade — null = applies to whole policy).
- **Indexes**: `pao_policy_idx`, `pao_member_idx`. Comment notes uniqueness is enforced via partial SQL indexes added out-of-band (not in Drizzle schema).
- **Tenant awareness**: no direct organizationId (inherited).

---

## 5. Payments & Finance Ledger (Policy-Attached)

### `paymentTransactions`
- **Purpose**: The immutable core payment ledger — every premium payment received, regardless of channel.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), policyId (FK, nullable), clientId (FK, nullable), amount (numeric NOT NULL), currency (default "USD"), paymentMethod (NOT NULL), status (default "pending"), reference, paynowReference, idempotencyKey (text, UNIQUE), receivedAt (timestamp, default now), postedDate (date), valueDate (date), notes, periodFrom/periodTo (date), recordedBy (FK → users), createdAt, **deletedAt (soft delete)**.
- **Indexes**: `pt_org_idx`, `pt_policy_idx`, `pt_posted_idx`, `pt_received_idx`, `pt_client_idx`.
- **Constraints**: UNIQUE(idempotencyKey) — global uniqueness (not per-org) guards against double payment processing.
- **Tenant awareness**: tenant-owned. **Soft delete**: YES (deletedAt, migration 0051).

### `receipts`
- **Purpose**: Legacy/simple receipt record tied 1:1 to a payment transaction (superseded in practice by the richer `paymentReceipts` table below, but still present).
- **Columns**: id, organizationId (FK NOT NULL), receiptNumber (NOT NULL), transactionId (FK NOT NULL → paymentTransactions), policyId (FK, nullable), clientId (FK, nullable), amount (numeric NOT NULL), currency (default "USD"), issuedAt (timestamp, default now).
- **Indexes**: `receipts_org_idx`, `receipt_number_org_idx` UNIQUE(receiptNumber, organizationId).
- **Tenant awareness**: tenant-owned.

### `paymentIntents`
- **Purpose**: PayNow payment-gateway intent — tracks a client-initiated payment attempt through the PayNow flow (created → pending → paid/failed).
- **Columns**: id, organizationId (FK NOT NULL), clientId (FK NOT NULL), policyId (FK NOT NULL), currency (default "USD"), amount (numeric(12,2) NOT NULL), purpose (default "premium" — enum-like: premium/arrears/reinstatement/topup/other via `PAYMENT_PURPOSES` const), status (default "created" — enum-like via `PAYMENT_INTENT_STATUSES`: created/pending_user/pending_paynow/paid/failed/cancelled/expired), idempotencyKey (varchar(255) NOT NULL), merchantReference (varchar(255) NOT NULL), paynowReference (varchar(255)), paynowPollUrl, paynowRedirectUrl (text), methodSelected (default "unknown" — enum-like via `PAYNOW_METHODS`), createdAt, updatedAt.
- **Indexes**: `pi_org_idx`, `pi_client_idx`, `pi_policy_idx`, `pi_status_idx`, `pi_idempotency_org_idx` UNIQUE(organizationId, idempotencyKey), `pi_merchant_ref_org_idx` UNIQUE(organizationId, merchantReference).
- **Tenant awareness**: tenant-owned. **Audit**: createdAt + updatedAt.

### `paymentEvents`
- **Purpose**: Append-only event log for a payment intent's lifecycle (initiated, redirect_issued, ussd_push_sent, status_update_received, polled, marked_paid, marked_failed, receipt_issued, manual_cash_receipted, reprint, reconciled — via `PAYMENT_EVENT_TYPES` const).
- **Columns**: id, paymentIntentId (FK NOT NULL, cascade delete), organizationId (FK NOT NULL), type (NOT NULL), payloadJson (jsonb), actorType (NOT NULL — client/admin/system), actorId (FK → users), createdAt.
- **Indexes**: `pe_intent_idx`, `pe_org_idx`, `pe_created_idx`.
- **Tenant awareness**: tenant-owned. This is the audit/event-sourcing layer for payments.

### `paymentReceipts`
- **Purpose**: The authoritative, richly-detailed receipt record issued after a payment (thermal-printable, PDF-backed, with an approval workflow for backdated/manual entries).
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), receiptNumber (NOT NULL), paymentIntentId (FK, nullable), policyId (FK NOT NULL), clientId (FK NOT NULL), amount (numeric(12,2) NOT NULL), currency (default "USD"), paymentChannel (NOT NULL — paynow_ecocash/paynow_card/cash/other), periodFrom/periodTo (date), issuedByUserId (FK), issuedAt (default now), pdfStorageKey, printFormat (default "thermal_80mm"), status (default "issued" — issued/voided), approvalStatus (nullable — null=instant-applied/pending/approved/rejected), approvedByUserId (FK), approvedAt, approvalNote, submitterNote, backdatedDate (date), metadataJson (jsonb), createdAt, **deletedAt (soft delete)**.
- **Indexes**: `pr_org_idx`, `pr_branch_idx`, `pr_intent_idx`, `pr_policy_idx`, `pr_receipt_org_idx` UNIQUE(receiptNumber, organizationId), composite `payment_receipts_policy_status_issued_idx`.
- **Tenant awareness**: tenant-owned. **Soft delete**: YES.
- **Audit fields**: createdAt + issuedByUserId/approvedByUserId (maker-checker actors).

### `outboxMessages`
- **Purpose**: Transactional outbox pattern — rows inserted in the same DB transaction as a payment so downstream side-effects (PDF generation, commission posting, notifications) survive process crashes and are processed asynchronously/idempotently.
- **Columns**: id, organizationId (FK NOT NULL, cascade delete), type (NOT NULL), payloadJson (jsonb NOT NULL, default {}), dedupeKey (NOT NULL), status (default "pending" — pending/done/failed), attempts (integer, default 0), lastError, createdAt, processedAt.
- **Indexes**: `outbox_org_dedupe_idx` UNIQUE(organizationId, dedupeKey), `outbox_org_status_created_idx` composite.
- **Tenant awareness**: tenant-owned.

### `monthEndRuns`
- **Purpose**: Represents a batch receipting run from an uploaded bank statement file (bulk-matches payments to policies at month end).
- **Columns**: id, organizationId (FK NOT NULL), runNumber (NOT NULL), fileName, totalRows (integer, default 0), receiptedCount, creditNoteCount (integer, default 0), status (default "completed"), runBy (FK), createdAt.
- **Indexes**: `mer_org_idx`, `mer_number_org_idx` UNIQUE(runNumber, organizationId).
- **Tenant awareness**: tenant-owned.

### `policyCreditBalances`
- **Purpose**: Per-policy running credit/debit wallet balance, used to track over/underpayments (e.g. from month-end run reconciliation).
- **Columns**: id, organizationId (FK NOT NULL), policyId (FK NOT NULL), balance (numeric(12,2), default "0" — signed), currency (default "USD"), updatedAt.
- **Indexes**: `pcb_org_idx`, `pcb_policy_idx`, `pcb_policy_org_idx` UNIQUE(policyId, organizationId).
- **Tenant awareness**: tenant-owned. **Audit**: updatedAt only, no createdAt.

### `policyPremiumChanges`
- **Purpose**: Effective-dated audit ledger of every premium-affecting change (upgrade/downgrade/member add/remove/manual override), recording the reconciliation amount posted to `policyCreditBalances`.
- **Columns**: id, organizationId (FK NOT NULL), policyId (FK NOT NULL), oldPremium/newPremium (numeric(12,2) NOT NULL), currency (default "USD"), effectiveDate (date NOT NULL), periods (integer, default 0 — whole billing periods since effective date), reconciliation (numeric(12,2), default "0", signed: + = arrears charged, - = credit), changeType (NOT NULL — upgrade/downgrade/member_add/member_remove/manual), reason, actorId (FK → users), createdAt.
- **Indexes**: `ppc_org_idx`, `ppc_policy_idx`.
- **Tenant awareness**: tenant-owned. This table is explicitly commented as the audit + source-of-record for premium changes.

### `creditNotes`
- **Purpose**: Formal credit note issued to a client/policy (e.g. from month-end run underpayment reconciliation).
- **Columns**: id, organizationId (FK NOT NULL), policyId (FK NOT NULL), clientId (FK NOT NULL), creditNoteNumber (NOT NULL), amount (numeric(12,2) NOT NULL), currency (default "USD"), reason, monthEndRunId (FK, nullable), createdAt.
- **Indexes**: `cn_org_idx`, `cn_policy_idx`, `cn_client_idx`, `cn_number_org_idx` UNIQUE(creditNoteNumber, organizationId).
- **Tenant awareness**: tenant-owned.

### `reversalEntries`
- **Purpose**: Links an original payment transaction to its reversal transaction (for corrections/refunds), with an approver.
- **Columns**: id, organizationId (FK NOT NULL), originalTransactionId (FK NOT NULL → paymentTransactions), reversalTransactionId (FK NOT NULL → paymentTransactions), reason (NOT NULL), approvedBy (FK), createdAt.
- **Indexes**: `re_org_idx`. **Tenant awareness**: tenant-owned. Maker-checker via approvedBy.

### `cashups`
- **Purpose**: End-of-shift/day cash reconciliation submitted by a cashier/preparer and confirmed by finance, tracking expected vs. counted amounts by payment method with discrepancy tracking. Statuses: `CASHUP_STATUSES` const (draft/submitted/confirmed/discrepancy). Methods: `CASHUP_PAYMENT_METHODS` const (cash/paynow_ecocash/paynow_card/other).
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), cashupDate (date NOT NULL), totalAmount (numeric NOT NULL), currency (default "USD"), transactionCount (integer NOT NULL), amountsByMethod (jsonb), status (default "draft"), isLocked (boolean, default false), lockedBy (FK), lockedAt, preparedBy (FK NOT NULL), notes, submittedAt/submittedBy, confirmedAt/confirmedBy, countedAmountsByMethod (jsonb), countedTotal (numeric), discrepancyAmount (numeric), discrepancyNotes, createdAt.
- **Indexes**: `cashups_org_idx`. **Tenant awareness**: tenant-owned. Maker-checker workflow (prepared→submitted→confirmed).

---

## 6. Claims

### `claims`
- **Purpose**: A claim against a policy — the core insurance-payout workflow entity.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), policyId (FK NOT NULL), clientId (FK NOT NULL), claimNumber (NOT NULL), claimType (NOT NULL), status (default "submitted" — enum via `CLAIM_STATUSES` const: submitted/verified/approved/scheduled/payable/completed/paid/closed/rejected, with `VALID_CLAIM_TRANSITIONS` state machine defined in code), deceasedName, deceasedRelationship, dateOfDeath (date), causeOfDeath, cashInLieuAmount (numeric), currency (default "USD"), isWaitingPeriodWaived (boolean, default false), fraudFlags (jsonb), submittedBy/verifiedBy/approvedBy (FK → users), approvalNotes, createdAt.
- **Indexes**: `claims_org_idx`, `claims_policy_idx`, `claims_status_idx`, `claim_number_org_idx` UNIQUE(claimNumber, organizationId).
- **Tenant awareness**: tenant-owned. Maker-checker via submittedBy/verifiedBy/approvedBy.

### `claimDocuments`
- **Purpose**: Supporting documents for a claim (death certificate, etc.), with a verification flag.
- **Columns**: id, claimId (FK NOT NULL), documentType (NOT NULL), fileName (NOT NULL), filePath, isVerified (boolean, default false), verifiedBy (FK), uploadedAt (default now).
- **Indexes**: `cd_claim_idx`. **Tenant awareness**: no direct organizationId (inherited via claimId).

### `claimStatusHistory`
- **Purpose**: Append-only audit trail of claim status transitions.
- **Columns**: id, claimId (FK NOT NULL), fromStatus, toStatus (NOT NULL), reason, changedBy (FK), createdAt.
- **Indexes**: `csh_claim_idx`. **Tenant awareness**: inherited via claimId.

---

## 7. Funeral Operations, Mortuary, Groups & Fleet

### `funeralCases`
- **Purpose**: The operational case file for handling a funeral — covers both insurance-claim-triggered funerals and walk-in "cash" services. Central hub linking claims, logistics (vehicles/drivers), and mortuary/quotation records.
- **Columns** (~30 columns): id, organizationId (FK NOT NULL), branchId (FK), claimId (FK, nullable), policyId (FK, nullable), caseNumber (NOT NULL); Deceased block: deceasedName (NOT NULL), deceasedDob, deceasedGender, deceasedNationalId, deceasedRelationship, dateOfDeath, causeOfDeath, placeOfDeath; Informant block: informantName/Phone/Relationship; Service: serviceType ('cash'|'claim'), funeralDate, funeralLocation; Logistics: removalLocation, removalVehicleId (FK → fleetVehicles), removalDriverId (FK → users), burialVehicleId (FK → fleetVehicles), burialDriverId (FK → users), attendingAgentId (FK → users); Timing: bodyWashTime, burialDepartureTime, memorialServiceStart/End (timestamp); Identification: bodyIdentifierName/IdNumber; status (default "open"), assignedTo (FK), notes, slaDeadline (timestamp), completedAt, createdAt.
- **Indexes**: `fc_org_idx`, `fc_claim_idx`, `fc_policy_idx`, `fc_status_idx`, `fc_assigned_idx`.
- **Tenant awareness**: tenant-owned. This is the "hub" entity for the whole funeral-operations domain (§7 tables mostly hang off `funeralCaseId`).

### `funeralTasks`
- **Purpose**: Checklist/to-do items attached to a funeral case with assignment and due dates.
- **Columns**: id, funeralCaseId (FK NOT NULL), taskName (NOT NULL), description, status (default "pending"), assignedTo (FK), dueDate (timestamp), completedAt, createdAt.
- **Indexes**: `ft_case_idx`. **Tenant awareness**: inherited via funeralCaseId.

### `partnerParlours`
- **Purpose**: External funeral parlours the org partners with (for storage referrals, vehicle borrowing, etc.).
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), phone, contactPerson, address, isActive (default true), createdAt.
- **Tenant awareness**: tenant-owned. No index array defined beyond PK (single-object literal form, no explicit index() calls beyond implicit org FK).

### `parlourPersonnel`
- **Purpose**: Contact people at a partner parlour.
- **Columns**: id, organizationId (FK NOT NULL), parlourId (FK NOT NULL, cascade delete), name (NOT NULL), role, phone, email, isActive (default true), createdAt.
- **Indexes**: `parlour_personnel_parlour_idx`. **Tenant awareness**: tenant-owned.

### `mortuaryIntakes`
- **Purpose**: Records a body being received into mortuary storage — for the org's own cases and for partner-parlour storage-only referrals (with storage fee tracking).
- **Columns** (~25 columns): id, organizationId (FK NOT NULL), branchId (FK), funeralCaseId (FK, nullable), intakeNumber (NOT NULL), serviceScope (NOT NULL — full_service/storage_only/removal_only), status (default "in_storage" — in_storage/dispatched); Deceased: deceasedName (NOT NULL), deceasedGender, deceasedAge (integer), deceasedNationalId, dateOfDeath, causeOfDeath, placeOfDeath; Referring party: clientOrganizationName, informantName/Phone/Relationship; Removal: removalLocation, removalDateTime (timestamp), removalVehicleId (FK), removalDriverId (FK); Receipt: receivedByUserId (FK), receivedAt, receiverAcknowledgedName/IdNumber, notes; Partner storage: partnerParlourId (FK, nullable), storageCategory (adult/child), storageFeeAmount (numeric(10,2)), storageFeeCurrency (default "USD"), storageFeeStatus (default "unpaid" — unpaid/paid_at_admission/paid_at_collection), storageFeePaidAt, storageFeePaidBy; createdAt.
- **Indexes**: `mi_org_idx`, `mi_case_idx`. **Tenant awareness**: tenant-owned.

### `mortuaryDispatches`
- **Purpose**: Records a body being released from mortuary storage (to family, to another party), including chapel/wash-bay usage fees for partner-parlour cases.
- **Columns**: id, organizationId (FK NOT NULL), intakeId (FK NOT NULL), funeralCaseId (FK, nullable), dispatchedByUserId (FK), dispatchedAt (timestamp), collectedByName/IdNumber/Organization, destination, collectorAcknowledgedName, notes, chapelWashBayUsed (boolean, default false), chapelWashBayFeeAmount (numeric(10,2)), chapelWashBayFeeCurrency (default "USD"), chapelWashBayFeeStatus (default "unpaid"), chapelWashBayFeePaidAt, chapelWashBayFeePaidBy, createdAt.
- **Indexes**: `md_intake_idx`. Chapel/wash-bay fee columns added in migration 0056 (2026 — most recent domain feature before this snapshot).
- **Tenant awareness**: tenant-owned (indirectly, no direct org index shown but organizationId column exists per migration).

### `deceasedBelongings`
- **Purpose**: Inventory log of personal effects submitted with the deceased (clothing, jewelry, etc.).
- **Columns**: id, organizationId (FK NOT NULL), intakeId (FK, nullable), funeralCaseId (FK, nullable), itemDescription (NOT NULL), quantity (integer, default 1), submittedByName, receivedByUserId (FK), notes, createdAt.
- **Indexes**: `db_intake_idx`. **Tenant awareness**: tenant-owned.

### `bodyWashRequirements`
- **Purpose**: Tracks what was provided for body preparation (clothes/blanket/wreath) and who performed/confirmed the wash.
- **Columns**: id, organizationId (FK NOT NULL), intakeId (FK NOT NULL), funeralCaseId (FK, nullable), clothesProvided/blanketProvided/wreathProvided (boolean, default false), otherItems, washedByName, completedAt, completedByUserId (FK), createdAt.
- **Indexes**: `bwr_intake_idx`. **Tenant awareness**: tenant-owned.

### `mortuaryPostMortemMovements` *(new — migration 0057)*
- **Purpose**: Tracks a body leaving the mortuary for post-mortem examination and its return, supporting multiple out-and-back trips per intake.
- **Columns**: id, organizationId (FK NOT NULL), intakeId (FK NOT NULL), funeralCaseId (FK, nullable), takenOutAt (timestamp NOT NULL), takenOutByUserId (FK), takenToLocation, authorizedBy, collectedByName, returnedAt, receivedBackByUserId (FK), notes, createdAt.
- **Indexes**: `pmm_intake_idx`. **Tenant awareness**: tenant-owned.

### `partnerParlourVehicleUsage` *(new — migration 0057)*
- **Purpose**: Tracks partner parlours borrowing the org's vehicles/drivers for their own (not this org's) removals/burials, with fee tracking.
- **Columns**: id, organizationId (FK NOT NULL), partnerParlourId (FK NOT NULL), vehicleId (FK NOT NULL → fleetVehicles), driverId (FK, nullable), purpose (NOT NULL — removal/burial), deceasedName, usageDateTime (timestamp NOT NULL), destination, returnedAt, feeAmount (numeric(10,2)), feeCurrency (default "USD"), feeStatus (default "unpaid"), feePaidAt, feePaidBy, notes, createdAt.
- **Indexes**: `ppvu_org_idx`, `ppvu_parlour_idx`. **Tenant awareness**: tenant-owned.

### `driverChecklists`
- **Purpose**: Pre-departure vehicle/equipment checklist for a funeral case (grave tent, gloves, masks, fuel gauge, toll gate) plus driver allowance.
- **Columns**: id, organizationId (FK NOT NULL), funeralCaseId (FK NOT NULL, **UNIQUE** — one checklist per case), driverId (FK), graveTent/loweringDevice/gloves/masks (boolean, default false), fuelGauge (text — full/three_quarter/half/quarter), tollGateRequired (boolean), tollGateAmount (numeric(10,2)), driverAllowance (numeric(10,2)), burialOrderRef, preparedByUserId (FK), completedAt, createdAt.
- **Indexes**: `dc_case_idx`. **Constraints**: funeralCaseId UNIQUE. **Tenant awareness**: tenant-owned.

### `fleetVehicles`
- **Purpose**: The org's vehicle fleet (hearses, vans, etc.).
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), registration (NOT NULL), make, model, year (integer), vehicleType, status (default "available"), currentMileage (integer), createdAt.
- **Indexes**: `fv_org_idx`. **Tenant awareness**: tenant-owned.

### `driverAssignments`
- **Purpose**: Assigns a driver to a vehicle, optionally for a specific funeral case, with a start/end window.
- **Columns**: id, vehicleId (FK NOT NULL), driverId (FK NOT NULL), funeralCaseId (FK, nullable), startDate (timestamp, default now), endDate, notes.
- **Indexes**: `da_vehicle_idx`. **Tenant awareness**: no direct organizationId (inherited via vehicleId). **Audit**: no createdAt (uses startDate).

### `fleetFuelLogs`
- **Purpose**: Fuel fill-up log per vehicle.
- **Columns**: id, vehicleId (FK NOT NULL), organizationId (FK NOT NULL), litres (numeric NOT NULL), costAmount (numeric NOT NULL), currency (default "USD"), mileageAtFill (integer), filledBy (FK), filledAt (default now).
- **Indexes**: `ffl_vehicle_idx`. **Tenant awareness**: tenant-owned.

### `fleetMaintenance`
- **Purpose**: Vehicle maintenance/service scheduling and cost tracking.
- **Columns**: id, vehicleId (FK NOT NULL), organizationId (FK NOT NULL), description (NOT NULL), costAmount (numeric), currency (default "USD"), scheduledDate/completedDate (date), status (default "scheduled"), createdAt.
- **Indexes**: `fm_vehicle_idx`. **Tenant awareness**: tenant-owned.

### `vehicleTripLogs`
- **Purpose**: Detailed trip log (odometer readings, fuel used, purpose, times) per vehicle use.
- **Columns**: id, organizationId (FK NOT NULL), vehicleId (FK NOT NULL), driverId (FK, nullable), funeralCaseId (FK, nullable), tripDate (date NOT NULL), purpose, startLocation, destination, startOdometer/endOdometer (integer), distanceKm (integer), timeDeparted/timeReturned (text), fuelUsedLitres (numeric(6,2)), driverNotes, authorizedBy, createdAt.
- **Indexes**: `vtl_vehicle_idx`, `vtl_org_idx`. **Tenant awareness**: tenant-owned.

### `priceBookItems`
- **Purpose**: Master catalog of billable line items for funeral cost sheets and quotations (with versioning and date-effective pricing).
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), name (NOT NULL), unit (NOT NULL), priceAmount (numeric NOT NULL), currency (default "USD"), category, effectiveFrom/effectiveTo (date), version (integer, default 1), isActive (default true), createdAt.
- **Indexes**: `pbi_org_idx`. **Tenant awareness**: tenant-owned.

### `costSheets`
- **Purpose**: Internal cost breakdown for servicing a funeral case or claim (distinct from client-facing quotations).
- **Columns**: id, organizationId (FK NOT NULL), funeralCaseId (FK, nullable), claimId (FK, nullable), totalAmount (numeric, default "0"), currency (default "USD"), status (default "draft"), approvedBy (FK), createdAt.
- **Indexes**: `cs_org_idx`. **Tenant awareness**: tenant-owned.

### `costLineItems`
- **Purpose**: Individual line items within a cost sheet.
- **Columns**: id, costSheetId (FK NOT NULL), priceBookItemId (FK, nullable), description (NOT NULL), quantity (numeric, default "1"), unitPrice (numeric NOT NULL), totalPrice (numeric NOT NULL), createdAt.
- **Indexes**: `cli_sheet_idx`. **Tenant awareness**: inherited via costSheetId.

### `groups`
- **Purpose**: A collective policyholder entity — community group, company, or church group — with rich contact metadata for its leadership (chairperson/secretary/treasurer/HR manager/contact person). Supports both new and "legacy" (pre-migration) groups.
- **Columns** (~20 columns): id, organizationId (FK NOT NULL), name (NOT NULL), type (default "community"), description, chairpersonName/Phone/Email, secretaryName/Phone/Email, treasurerName/Phone/Email, companyName, hrManagerName/Phone/Email, contactPersonName/Phone/Email, capacity (integer), isActive (default true), **isLegacy (boolean, default false)**, createdAt.
- **Indexes**: `groups_org_idx`. **Tenant awareness**: tenant-owned.
- **Note on "legacy groups & receipts"**: the codebase's "legacy group" concept (per recent commit history: "legacy receipt fee dating, group receipt currency... legacy policy premium override") is modeled *not* via separate dedicated tables but via the `isLegacy` flag on `groups` and `policies`, combined with the general-purpose `paymentTransactions`/`paymentReceipts`/`receipts` ledger tables — i.e., legacy groups are ordinary `groups` rows flagged `isLegacy=true`, and their historical receipts are ordinary rows in the standard receipt tables (see `scripts/record-historical-service-receipt.mjs` and `scripts/backfill-requisition-*.mjs` in the working tree for the backfill tooling used to migrate this historical data).

### `groupPaymentIntents`
- **Purpose**: PayNow payment intent for a group executive paying premiums for multiple member policies in one transaction.
- **Columns**: id, organizationId (FK NOT NULL), groupId (FK NOT NULL), totalAmount (numeric(12,2) NOT NULL), currency (default "USD"), status (default "created"), idempotencyKey (varchar(255) NOT NULL), merchantReference (varchar(255) NOT NULL), paynowReference (varchar(255)), paynowPollUrl, paynowRedirectUrl, methodSelected (default "unknown"), initiatedByClientId (FK, nullable), initiatedByUserId (FK, nullable), createdAt, updatedAt.
- **Indexes**: `gpi_org_idx`, `gpi_group_idx`, `gpi_status_idx`, `gpi_idempotency_org_idx` UNIQUE(organizationId, idempotencyKey).
- **Tenant awareness**: tenant-owned.

### `groupPaymentAllocations`
- **Purpose**: Splits a group payment intent's total across the individual member policies it covers.
- **Columns**: id, groupPaymentIntentId (FK NOT NULL, cascade delete), policyId (FK NOT NULL), amount (numeric(12,2) NOT NULL), currency (default "USD"), createdAt.
- **Indexes**: `gpa_intent_idx`, `gpa_policy_idx`. **Tenant awareness**: inherited via groupPaymentIntentId.

---

## 8. HR / Payroll / Attendance

### `payrollEmployees`
- **Purpose**: Employee master record for payroll purposes (may or may not correspond to a `users` login).
- **Columns** (~25 columns): id, organizationId (FK NOT NULL), userId (FK, nullable — links to a system login if the employee also has one), employeeNumber (NOT NULL), firstName/lastName (NOT NULL), position, department, baseSalary (numeric); Allowances: housingAllowance, transportAllowance (numeric), otherAllowances (jsonb array of {name, amount}); Deductions: funeralPolicyDeduction, otherInsuranceDeduction (numeric); Zimbabwe statutory toggles: nssaEnabled, payeEnabled, aidsLevyEnabled (boolean, default false); currency (default "USD"); Employment: employmentType (default "permanent" — permanent/contract/fixed_term/probation/casual), contractStartDate/EndDate (date); Banking: bankName, bankBranch, bankAccountNumber, bankAccountType (savings/current/cheque), bankBranchCode, bankSwiftCode; isActive (default true), createdAt.
- **Indexes**: `payroll_employees_org_idx`. **Tenant awareness**: tenant-owned.

### `attendanceLogs`
- **Purpose**: Daily attendance record per employee, with a supervisor approval workflow.
- **Columns**: id, organizationId (FK NOT NULL), employeeId (FK NOT NULL → payrollEmployees), date (date NOT NULL), loggedAt (timestamp, default now), notes, status (default "pending" — pending/approved/rejected), approvedBy (FK), approvedAt, approvalNotes, createdAt.
- **Indexes**: `al_org_idx`, `al_emp_date_idx` (employeeId, date), `al_status_idx`, `al_emp_date_unique` UNIQUE(employeeId, date) — enforces one attendance record per employee per day.
- **Tenant awareness**: tenant-owned. Maker-checker via approvedBy.

### `payrollRuns`
- **Purpose**: A payroll processing batch for a pay period, with aggregate totals and an approval step.
- **Columns**: id, organizationId (FK NOT NULL), periodStart/periodEnd (date NOT NULL), status (default "draft"), totalGross, totalDeductions, totalNet (numeric), preparedBy (FK), approvedBy (FK), createdAt.
- **Indexes**: `payroll_runs_org_idx`. **Tenant awareness**: tenant-owned. Maker-checker via preparedBy/approvedBy.

### `payslips`
- **Purpose**: Individual employee payslip within a payroll run, with full earnings/deductions breakdown stored as JSON for audit trail plus summary numeric columns for reporting.
- **Columns**: id, payrollRunId (FK NOT NULL), employeeId (FK NOT NULL), daysWorked/totalDays (integer, nullable — null = full month), earnings (jsonb — {base, housing, transport, otherAllowances, totalGross}), deductionsDetail (jsonb — {funeralPolicy, otherInsurance, nssa, paye, aidsLevy, totalDeductions}), grossAmount (numeric NOT NULL), deductions (jsonb, legacy/backward-compat field), netAmount (numeric NOT NULL), currency (default "USD"), createdAt.
- **Indexes**: `payslips_run_idx`, `payslips_emp_run_idx` (employeeId, payrollRunId). **Tenant awareness**: no direct organizationId (inherited via payrollRunId/employeeId).

---

## 9. Accounting / Finance — Requisitions, Disbursements, Bank, Balance Sheet

### `expenditures`
- **Purpose**: General operating expense record (separate from the requisition-approval workflow below), supporting partial payment.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), funeralCaseId (FK, nullable), category (NOT NULL), description (NOT NULL), amount (numeric NOT NULL), currency (default "USD"), approvedBy (FK), receiptRef, spentAt (date), status (default "pending" — pending/partial/paid), amountPaid (numeric(12,2), default "0"), paidBy (FK), receivedBy (text), receivedByUserId (FK), paymentMethod, paidDate (date), reference, createdAt.
- **Indexes**: `exp_org_idx`. **Tenant awareness**: tenant-owned.

### `requisitions`
- **Purpose**: The formal expenditure-request workflow: raise → submit → approve/reject → pay, supporting partial payment and departmental/cost-center tagging.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), requisitionNumber (NOT NULL), raisedDate (date), category (NOT NULL), description (NOT NULL), payee, amount (numeric(12,2) NOT NULL), currency (default "USD"), status (default "draft" — via `REQUISITION_STATUSES` const: draft/submitted/approved/rejected/partial/paid), requestedBy (FK NOT NULL), approvedBy (FK), approvedAt, rejectionReason, paidBy (FK), paidAt, paidDate (date), paymentMethod, reference, receivedBy (text), receivedByUserId (FK), amountPaid (numeric(12,2), default "0"), notes, neededByDate (date), approverNotes, **department (text)**, **costFlag (text — e.g. 'CEO_PERSONAL'/'SOUTH_AFRICA')** (both added migration 0058, in the working tree's pending diff), createdAt.
- **Indexes**: `req_org_idx`, `req_status_idx`, `req_number_org_idx` UNIQUE(organizationId, requisitionNumber).
- **Tenant awareness**: tenant-owned. Maker-checker workflow (requestedBy→approvedBy→paidBy).

### `requisitionItems`
- **Purpose**: Line items within a requisition.
- **Columns**: id, requisitionId (FK NOT NULL, cascade delete), organizationId (FK NOT NULL), description (NOT NULL), category (NOT NULL), qty (numeric(10,2), default "1"), unitPrice (numeric(12,2) NOT NULL), total (numeric(12,2) NOT NULL).
- **Indexes**: `req_item_req_idx`. **Tenant awareness**: tenant-owned (redundant org column alongside requisitionId FK).

### `paymentDisbursements`
- **Purpose**: A generic "cash-out" event record covering both requisition and expenditure partial payments (polymorphic via entityType/entityId), each with its own voucher number.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), entityType (NOT NULL — 'requisition'|'expenditure'), entityId (uuid NOT NULL, **polymorphic FK — not a declared references(), points to requisitions.id or expenditures.id depending on entityType**), amount (numeric(12,2) NOT NULL), currency (default "USD"), paidByUserId (FK), receivedBy (text), receivedByUserId (FK, nullable), paidDate (date NOT NULL), paymentMethod (default "cash" — cash/bank_transfer/cheque/mobile_money), reference, notes, voucherNumber (text — e.g. PV-00001), createdByUserId (FK), createdAt.
- **Indexes**: `disb_org_idx`, `disb_entity_idx` (entityType, entityId), `disb_date_idx`.
- **Tenant awareness**: tenant-owned. **Note**: polymorphic association (entityType discriminator) is a schema pattern not used elsewhere in this codebase — worth flagging for referential-integrity review since `entityId` has no real FK constraint.

### `bankAccounts`
- **Purpose**: The org's bank account master list.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), accountName (NOT NULL), bankName (NOT NULL), accountNumber (NOT NULL), currency (default "USD"), isActive (default true), notes, createdAt.
- **Indexes**: `ba_org_idx`. **Tenant awareness**: tenant-owned.

### `bankDeposits`
- **Purpose**: Records physical banking of collected cash, with a verification step.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), bankAccountId (FK, nullable), depositedByUserId (FK NOT NULL), verifiedByUserId (FK, nullable), amount (numeric(12,2) NOT NULL), currency (default "USD"), depositDate (date NOT NULL), reference, notes, verifiedAt, createdAt.
- **Indexes**: `bd_org_idx`, `bd_user_idx`, `bd_date_idx`. **Tenant awareness**: tenant-owned. Maker-checker (depositedBy/verifiedBy).

### `bankStatementBalances`
- **Purpose**: Manually-entered closing balance from an actual bank statement, for reconciliation.
- **Columns**: id, organizationId (FK NOT NULL), bankAccountId (FK NOT NULL), statementDate (date NOT NULL), closingBalance (numeric(12,2) NOT NULL), currency (default "USD"), enteredByUserId (FK), notes, createdAt.
- **Indexes**: `bsb_org_idx`, `bsb_account_idx`. **Tenant awareness**: tenant-owned.

### `balanceSheetEntries`
- **Purpose**: Manual entries for non-derived balance sheet items (fixed assets, loans, capital contributions) that can't be computed from transactional tables, tagged by point-in-time date.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), section (NOT NULL — 'asset'/'liability'/'equity'), subsection ('current'/'non_current', null for equity), label (NOT NULL), amount (numeric(15,2) NOT NULL), currency (default "USD"), asOfDate (date NOT NULL), notes, enteredByUserId (FK), createdAt, updatedAt.
- **Indexes**: `bse_org_idx`, `bse_section_idx` (organizationId, section), `bse_date_idx`.
- **Tenant awareness**: tenant-owned. **Audit**: createdAt + updatedAt.

### `debitOrders`
- **Purpose**: Recurring bank-debit mandates for automated premium collection (as an alternative/complement to PayNow automation).
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), clientId (FK, nullable), policyId (FK, nullable), mandateReference (NOT NULL), accountName (NOT NULL), bankName (NOT NULL), accountNumber (NOT NULL), branchCode, amount (numeric(12,2) NOT NULL), currency (default "USD"), frequency (default "monthly" — via `DEBIT_ORDER_FREQUENCIES` const: weekly/biweekly/monthly/quarterly), dayOfMonth (integer), startDate/nextRunDate (date), status (default "active" — via `DEBIT_ORDER_STATUSES` const: active/paused/cancelled), notes, createdBy (FK), createdAt.
- **Indexes**: `debit_order_org_idx`, `debit_order_status_idx`, `debit_order_policy_idx`, `debit_order_ref_org_idx` UNIQUE(organizationId, mandateReference).
- **Tenant awareness**: tenant-owned.

### `fxRates`
- **Purpose**: USD-base currency conversion rates for producing consolidated multi-currency financial statements. `rateToUsd` = USD value of 1 unit of `currency`.
- **Columns**: id, organizationId (FK NOT NULL), currency (NOT NULL), rateToUsd (numeric(18,8) NOT NULL), updatedBy (FK), updatedAt.
- **Indexes**: `fx_org_currency_idx` UNIQUE(organizationId, currency). **Tenant awareness**: tenant-owned.

### `funeralQuotations`
- **Purpose**: Client-facing cash-service price quote (pre-service or standalone), with VAT/discount breakdown and a conversion-to-service-receipt workflow.
- **Columns** (~25 columns): id, organizationId (FK NOT NULL), funeralCaseId (FK, nullable — standalone quotes exist before a case), quotationNumber (NOT NULL), currency (default "USD"), total (numeric(12,2), default "0" — legacy field), status (default "draft" — draft/sent/accepted/converted), notes, createdBy (FK), createdAt; Extended capture: informantFullNames/Phone/Address, deceasedName, deceasedAge (integer), deceasedSex, casketType, quotationDate (date); Financial breakdown: subtotal, vatRate (default "15"), vatAmount, discountAmount, grandTotal (numeric(12,2)); Payment terms: paymentType ('full'|'part'), conversionStatus (default "pending" — pending/partial/converted), convertedAt.
- **Indexes**: `fq_org_idx`, `fq_number_org_idx` UNIQUE(organizationId, quotationNumber); plus a partial-unique `fq_org_case_idx` on (organizationId, funeralCaseId) added out-of-band in migration 0033 enforcing one quotation per case.
- **Tenant awareness**: tenant-owned.

### `quotationGuarantors`
- **Purpose**: Guarantor details for a "pay later" funeral quotation (part-payment plan).
- **Columns**: id, organizationId (FK NOT NULL), quotationId (FK NOT NULL, **UNIQUE** — one guarantor record per quotation), guarantorName/Phone/Address/IdNumber, createdAt.
- **Indexes**: `qg_quotation_idx`. **Constraints**: quotationId UNIQUE. **Tenant awareness**: tenant-owned.

### `quotationCollateral`
- **Purpose**: Collateral items pledged against a part-payment quotation, with condition and forfeiture date.
- **Columns**: id, organizationId (FK NOT NULL), quotationId (FK NOT NULL), itemDescription (NOT NULL), condition ('good'/'fair'/'poor'), value (numeric(12,2)), dueDate/forfeitureDate (date), createdAt.
- **Indexes**: `qc_quotation_idx`. **Tenant awareness**: tenant-owned.

### `funeralQuotationItems`
- **Purpose**: Line items within a funeral quotation.
- **Columns**: id, quotationId (FK NOT NULL), priceBookItemId (FK, nullable), description (NOT NULL), quantity (numeric(12,2), default "1"), unitPrice (numeric(12,2) NOT NULL), lineTotal (numeric(12,2) NOT NULL).
- **Indexes**: `fqi_quotation_idx`. **Tenant awareness**: no direct organizationId (inherited via quotationId).

### `serviceReceipts`
- **Purpose**: Cash-service income receipt not tied to an insurance policy (walk-in funeral services), with idempotency protection.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), funeralCaseId (FK, nullable), quotationId (FK, nullable), receiptNumber (NOT NULL), amount (numeric(12,2) NOT NULL), currency (default "USD"), paymentChannel (NOT NULL — cash/paynow_ecocash/paynow_card/other), issuedByUserId (FK), issuedAt (default now), status (default "issued" — issued/voided), idempotencyKey (text, nullable), notes, metadataJson (jsonb), createdAt.
- **Indexes**: `sr_org_idx`, `sr_case_idx`, `sr_quot_idx`, `sr_receipt_org_idx` UNIQUE(organizationId, receiptNumber), `sr_idempotency_org_idx` UNIQUE(organizationId, idempotencyKey).
- **Tenant awareness**: tenant-owned. This is the table underlying the "legacy group receipt" backfill scripts noted in §7.

### `receiptAdverts`
- **Purpose**: Promotional content printed on the bottom of thermal receipts.
- **Columns**: id, organizationId (FK NOT NULL), title, body, imageUrl, isActive (default false), createdAt.
- **Indexes**: `ra_org_idx`. **Tenant awareness**: tenant-owned.

---

## 10. Commissions & Platform Revenue Share

### `commissionPlans`
- **Purpose**: Versioned commission rate schedule for agents (first-N-months rate, recurring rate, clawback threshold, funeral-service incentive).
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), description, firstMonthsCount (integer, default 2), firstMonthsRate (numeric, default "50"), recurringStartMonth (integer, default 5), recurringRate (numeric, default "10"), clawbackThresholdPayments (integer, default 4), funeralServiceIncentive (numeric, default "50"), version (integer, default 1), effectiveFrom (date), isActive (default true), createdAt.
- **Indexes**: `cp_org_idx`. **Tenant awareness**: tenant-owned.

### `commissionLedgerEntries`
- **Purpose**: Per-agent commission earnings ledger, tied to a policy/payment transaction where applicable.
- **Columns**: id, organizationId (FK NOT NULL), agentId (FK NOT NULL), policyId (FK, nullable), transactionId (FK, nullable), entryType (NOT NULL), amount (numeric NOT NULL), currency (default "USD"), description, periodStart/periodEnd (date), status (default "earned"), createdAt.
- **Indexes**: `cle_org_idx`, `cle_agent_idx`, `cle_policy_idx`, composite `commission_ledger_org_agent_created_idx`.
- **Tenant awareness**: tenant-owned.

### `platformReceivables`
- **Purpose**: POL263's own 2.5% platform revenue share owed by the tenant, generated from either a payment transaction or a service receipt.
- **Columns**: id, organizationId (FK NOT NULL), sourceTransactionId (FK, nullable → paymentTransactions), sourceServiceReceiptId (FK, nullable → serviceReceipts), amount (numeric NOT NULL), currency (default "USD"), description, isSettled (boolean, default false), createdAt.
- **Indexes**: `pr_recv_org_idx`. **Tenant awareness**: tenant-owned (per-tenant receivable, but conceptually this *is* platform/SaaS-vendor revenue — flagged for closer look in the tenancy-boundary section of the larger report since it represents money owed *to* the platform *by* the tenant, tracked inside the tenant's own schema).

### `settlements`
- **Purpose**: Records the tenant settling its platform-fee liability (bank transfer, etc.), with an approval step.
- **Columns**: id, organizationId (FK NOT NULL), amount (numeric NOT NULL), currency (default "USD"), method (NOT NULL), reference, attachments (jsonb), status (default "pending"), initiatedBy (FK), approvedBy (FK), createdAt.
- **Indexes**: `settlements_org_idx`. **Tenant awareness**: tenant-owned.

### `settlementAllocations`
- **Purpose**: Allocates a settlement payment across specific outstanding platform receivables.
- **Columns**: id, settlementId (FK NOT NULL → settlements), receivableId (FK NOT NULL → platformReceivables), amount (numeric NOT NULL), createdAt.
- **Indexes**: none beyond PK (no index() calls defined — a gap for a join table). **Tenant awareness**: no direct organizationId (inherited).

---

## 11. Notifications / Messaging / CRM / Misc

### `notificationTemplates`
- **Purpose**: Versioned, effective-dated message templates per event type/channel (client notifications).
- **Columns**: id, organizationId (FK NOT NULL), name (NOT NULL), eventType (NOT NULL), channel (default "in_app"), subject, bodyTemplate (NOT NULL), mergeTags (jsonb), version (integer, default 1), effectiveFrom (date), isActive (default true), createdAt.
- **Indexes**: `nt_org_idx`. **Tenant awareness**: tenant-owned.

### `notificationLogs`
- **Purpose**: Client-facing sent-notification log (delivery attempts, read receipts).
- **Columns**: id, organizationId (FK NOT NULL), templateId (FK, nullable), recipientType (NOT NULL), recipientId (uuid, no FK declared — polymorphic recipient), policyId (uuid, no FK declared), channel (NOT NULL), subject, body, status (default "pending"), attempts (integer, default 0), failureReason, readAt, sentAt, createdAt.
- **Indexes**: `nl_org_idx`, `nl_recipient_idx`, `nl_policy_idx`, composite `notification_logs_recipient_read_idx`.
- **Tenant awareness**: tenant-owned.

### `userNotifications`
- **Purpose**: Staff/agent-facing notification log — kept deliberately separate from `notificationLogs` (client-only) so field shapes don't collide. Powers the agent-app notifications screen.
- **Columns**: id, organizationId (FK NOT NULL), recipientId (FK NOT NULL → users), type (NOT NULL — TRIP_ASSIGNED/CLAIM_SUBMITTED/CLAIM_STATUS/APPROVAL_NEEDED/APPROVAL_RESOLVED/PAYMENT_RECEIVED/COMMISSION_EARNED/POLICY_ISSUED/ATTENDANCE_RESOLVED/GENERAL), title (NOT NULL), body (NOT NULL), metadata (jsonb), isRead (boolean, default false), readAt, createdAt.
- **Indexes**: `un_org_idx`, `un_recipient_idx`, `un_read_idx` (recipientId, isRead), `un_created_idx`.
- **Tenant awareness**: tenant-owned.

### `userDeviceTokens`
- **Purpose**: Expo push tokens for staff/agent mobile app users (mirrors `clientDeviceTokens`).
- **Columns**: id, organizationId (FK NOT NULL), userId (FK NOT NULL), token (NOT NULL), platform (NOT NULL), createdAt, updatedAt.
- **Indexes**: `udt_org_idx`, `udt_user_idx`, `udt_token_unique` UNIQUE(token) — global uniqueness on token (not per-org).
- **Tenant awareness**: tenant-owned. **Audit**: createdAt + updatedAt.

### `leads`
- **Purpose**: CRM-lite sales pipeline entity — a prospective client tracked from capture through activation.
- **Columns**: id, organizationId (FK NOT NULL), branchId (FK), agentId (FK, nullable), clientId (FK, nullable — set once converted), firstName/lastName (NOT NULL), phone, email, source (default "walk_in"), stage (default "captured" — via `LEAD_STAGES` const: captured/contacted/quote_generated/application_started/submitted/approved/activated/lost), productInterest, lostReason, notes, createdAt.
- **Indexes**: `leads_org_idx`, `leads_agent_idx`, `leads_stage_idx`, `leads_client_idx`.
- **Tenant awareness**: tenant-owned.

### `clientFeedback`
- **Purpose**: Client-submitted complaints or general feedback, with a resolution workflow.
- **Columns**: id, organizationId (FK NOT NULL), clientId (FK NOT NULL), type (NOT NULL — 'complaint'|'feedback'), subject (NOT NULL), message (NOT NULL), status (default "open" — open/acknowledged/closed), createdAt, updatedAt.
- **Indexes**: `client_feedback_org_idx`, `client_feedback_client_idx`. **Tenant awareness**: tenant-owned. **Audit**: createdAt + updatedAt.

### `approvalRequests`
- **Purpose**: Generic maker-checker approval-request envelope for arbitrary entity types (polymorphic via entityType/entityId + a JSON snapshot of the requested change).
- **Columns**: id, organizationId (FK NOT NULL), requestType (NOT NULL), entityType (NOT NULL), entityId (text, polymorphic — no FK), requestData (jsonb), status (default "pending"), initiatedBy (FK NOT NULL), approvedBy (FK), rejectionReason, createdAt, resolvedAt.
- **Indexes**: `ar_org_idx`, `ar_status_idx`. **Tenant awareness**: tenant-owned. This is the generic approval mechanism used across several other domain-specific maker-checker flows.

### `termsAndConditions`
- **Purpose**: Legal T&C clauses attachable to a product version, categorized and orderable for display.
- **Columns**: id, organizationId (FK NOT NULL), productVersionId (FK, nullable), title (NOT NULL), content (NOT NULL), category (default "general"), sortOrder (integer, default 0), isActive (default true), createdAt.
- **Indexes**: `tc_org_idx`, `tc_pv_idx`. **Tenant awareness**: tenant-owned.

### `reminders`
- **Purpose**: Personal per-user to-do reminders (server-persisted, not organization-facing data).
- **Columns**: id, organizationId (FK NOT NULL, cascade delete), userId (FK NOT NULL, cascade delete), title (NOT NULL), description, dueDate (text, not a `date` type — notable inconsistency), priority (default "medium"), isCompleted (boolean, default false), createdAt, updatedAt.
- **Indexes**: `reminders_org_idx`, `reminders_user_idx`. **Tenant awareness**: tenant-owned. **Audit**: createdAt + updatedAt.

### `directoryContacts`
- **Purpose**: Shared contact directory (undertakers, underwriters, transport companies, general/emergency contacts, suppliers), differentiated by a `type` discriminator.
- **Columns**: id, organizationId (FK NOT NULL), type (NOT NULL — undertaker/underwriter/transport_company/contact/emergency/supplier), name (NOT NULL), contactPerson, phone, altPhone, email, address, city, notes, isActive (default true), createdAt.
- **Indexes**: `directory_contacts_org_type_idx` (organizationId, type), `directory_contacts_org_idx`. **Tenant awareness**: tenant-owned.

---

## 12. Audit, Sessions & Platform-Global Tables

### `auditLogs`
- **Purpose**: Universal before/after change ledger — every mutation in the system calls `auditLog()` per CLAUDE.md's stated convention.
- **Columns**: id, organizationId (FK, **nullable** — platform-owner actions may have no org context), actorId (FK, nullable), actorEmail (text — denormalized copy in case actor is later deleted/unlinked), action (NOT NULL), entityType (NOT NULL), entityId (text, polymorphic, nullable), before (jsonb), after (jsonb), requestId (text — for tracing), ipAddress (text), timestamp (default now, NOT NULL — note: named `timestamp` not `createdAt`).
- **Indexes**: `audit_org_idx`, `audit_ts_idx`.
- **Tenant awareness**: hybrid/nullable-org (works for both tenant actions and platform-owner actions).
- **Soft delete**: n/a (append-only ledger, never mutated or deleted by design).
- **Audit fields**: this table *is* the audit mechanism.

### `sessions`
- **Purpose**: Server-side session store for `connect-pg-simple` (Express session middleware), backing both staff (Google OAuth) and client (email/password) authentication.
- **Columns**: sid (varchar, PK), sess (jsonb NOT NULL), expire (timestamp(6) NOT NULL).
- **Indexes**: none beyond PK (connect-pg-simple typically adds its own index on `expire` at setup time, not shown here as a Drizzle-managed index).
- **Tenant awareness**: **GLOBAL** — no organizationId; a single session store serves all tenants (session payload presumably carries org context internally in `sess` jsonb).
- **Soft delete**: none (rows expire and are pruned by the session middleware).

### `appDownloadInterests`
- **Purpose**: Captures name/email of visitors who click the App Store/Play Store badges on the public login screen — explicitly platform-level marketing data, not tied to any tenant.
- **Columns**: id, fullName (NOT NULL), email (NOT NULL), platform (NOT NULL — 'ios'|'android'), createdAt.
- **Indexes**: `app_dl_created_idx`.
- **Tenant awareness**: **GLOBAL** — explicitly commented in the source as "Platform-level (not org-scoped)".

### `appReleases`
- **Purpose**: Tracks each mobile app release (APK/build), minimum supported version, and download URL — used for in-app version-enforcement / forced-upgrade checks across ALL tenants' mobile app installs.
- **Columns**: id, version (text NOT NULL — e.g. "1.2.0"), buildNumber (integer NOT NULL — EAS auto-incremented versionCode), minVersion (text, default "1.0.0"), minBuildNumber (integer, default 1), downloadUrl (NOT NULL), releaseNotes, isActive (default true), createdAt.
- **Indexes**: `app_releases_active_idx` (isActive, createdAt).
- **Tenant awareness**: **GLOBAL** — explicitly commented "Platform-level".

---

## 13. Control Plane (`shared/control-plane-schema.ts`) — A Separate Database

This file's header comment states it plainly: it lives in a **physically separate** database — `pol263-control-plane` on DigitalOcean — and **"stores ONLY tenant metadata: who tenants are, how to reach their data, and how they are configured. It never stores policy/client/payment data — that belongs in tenant databases."**

This is architecturally different from the "global tables" in §12 (like `sessions`, `appReleases`) which live *inside* the same shared application database as tenant data, just without an `organization_id` column. The control-plane tables below live in an *entirely different database instance*, queried by a separate connection, used purely for **routing** — i.e. "given this request, which tenant is it, and which database/bucket/PayNow key should serve it?"

### `tenants`
- **Purpose**: The authoritative tenant registry — mirrors/replaces `organizations` for routing purposes.
- **Columns**: id (uuid PK), name (NOT NULL), slug (NOT NULL — URL-safe, subdomain routing key), isActive (boolean, default true), licenseStatus (default "active" — active/suspended/trial/expired), provisioningState (default "ready" — provisioning/ready/migrating/suspended), createdAt, suspendedAt, suspendReason.
- **Indexes**: `tenants_slug_idx` UNIQUE(slug).
- **Tenant awareness**: this IS the control-plane's tenant record (analogous to `organizations` in the main schema but decoupled).

### `tenantDomains`
- **Purpose**: Maps a domain/subdomain (e.g. `acme.pol263.app`) to a tenant, for request routing.
- **Columns**: id (uuid PK), tenantId (FK NOT NULL, cascade delete), domain (NOT NULL), isPrimary (boolean, default false), isVerified (boolean, default false), createdAt.
- **Indexes**: `tenant_domains_domain_idx` UNIQUE(domain), `tenant_domains_tenant_idx`.

### `tenantDatabases`
- **Purpose**: Per-tenant database connection routing. `databaseUrl = null` means the tenant uses the shared pol263 database (the default); set means an isolated DB.
- **Columns**: tenantId (uuid, PK, FK, cascade delete), databaseUrl (text, nullable — pooler URL), databaseDirectUrl (text, nullable — direct URL for migrations), migrationState (default "current" — current/pending/running/failed), lastMigratedAt (timestamp), schemaVersion (text).
- **Tenant awareness**: this table's entire purpose is to be the "isolated-DB switch" referenced in CLAUDE.md's `server/tenant-db.ts` description.

### `tenantStorage`
- **Purpose**: Per-tenant object-storage (S3-compatible) routing config. When bucket/credentials are null, the tenant uses the shared DO Spaces bucket with path isolation (`tenants/{tenantId}/`).
- **Columns**: tenantId (uuid PK, FK, cascade delete), prefix (NOT NULL — always set, e.g. "tenants/uuid/"), bucket (nullable), region, endpoint, accessKeyId (nullable). Explicit code comment: the secret key must NEVER be stored here — only in encrypted config jsonb elsewhere.

### `tenantIntegrations`
- **Purpose**: Per-tenant third-party integration configuration (PayNow, Stripe, WhatsApp Cloud API, BulkSMS, Twilio SMS), config stored as flexible jsonb per provider.
- **Columns**: id (uuid PK), tenantId (FK NOT NULL, cascade delete), provider (NOT NULL), isActive (default true), config (jsonb NOT NULL), createdAt, updatedAt.
- **Indexes**: `tenant_integrations_tenant_idx`, `tenant_integrations_provider_idx`.
- **Security note** (from source comment): Phase 1 stores config in plaintext; Phase 2 is planned to add AES-256-GCM encryption via `TENANT_CONFIG_ENCRYPTION_KEY` for sensitive fields (keys/tokens).

### `tenantBranding`
- **Purpose**: Per-tenant white-label branding config, loaded at request time for UI/PDF/receipt theming — a control-plane mirror of the branding fields also present on `organizations` in the main schema (data duplication across the tenancy boundary, presumably to avoid a cross-database join on every request).
- **Columns**: tenantId (uuid PK, FK, cascade delete), logoUrl (default "/assets/logo.png"), signatureUrl, primaryColor (default "#0d9488"), footerText, address, phone, email, website, policyNumberPrefix, policyNumberPadding (text, default "5" — note: stored as **text** here vs. **integer** on `organizations.policyNumberPadding`, a type inconsistency between the two schemas), isWhitelabeled (boolean, default false), updatedAt.

### `tenantFeatureFlags`
- **Purpose**: Per-tenant feature flag overrides (known flags per comment: claims_enabled, mobile_payments, agent_portal, whatsapp_notifications).
- **Columns**: tenantId (FK NOT NULL, cascade delete), flag (NOT NULL), enabled (boolean NOT NULL), setAt (timestamp, default now).
- **Indexes**: `tenant_feature_flags_unique_idx` UNIQUE(tenantId, flag).

### `backupSyncRuns`
- **Purpose**: One row per backup-sync run (see `server/backup-sync.ts`), making backup health queryable rather than log-only. Explicitly kept in the control plane "since it's platform-wide operational state, not tenant data."
- **Columns**: id (uuid PK), startedAt (timestamp NOT NULL), completedAt (timestamp), status (NOT NULL — 'running'/'success'/'partial'/'failed'), totalRows (text — odd choice, numeric stored as text), tableCount (text), errorCount (text), errors (jsonb), triggeredBy (text — 'scheduler'/'manual').
- **Tenant awareness**: GLOBAL/platform-wide by design (no tenantId column at all — this describes the whole-platform backup job, not any one tenant).

---

## 14. ERD Docs vs. Actual Schema — Discrepancies

`ERD.md` and `ERD_SUMMARY.md` were both read and cross-referenced against `shared/schema.ts`. Both documents are **severely stale** and should not be trusted as current documentation:

- `ERD_SUMMARY.md` (root) is explicitly titled "ERD Summary - POL263 (Phase 0-1)" and states it covers only "the core tables required for multi-tenancy, authentication, and RBAC **before** specific product features (policies, claims, payments) are fully modeled." It lists only ~10 tables (Organization, Branch, User, Role, Permission, RolePermission, UserRole, UserPermissionOverride, AuditLog) — roughly 10% of the ~103 tables that now exist.
- `ERD.md` (root) is even thinner — a thumbnail sketch naming Organization, Branch, User, Role, Permission, RolePermission, UserRole, Policy, Claim, AuditLog (10 entities) with one line each, no columns.
- Neither doc mentions: products/productVersions, any payment/finance table, funeral operations, mortuary, fleet, payroll/attendance, requisitions/disbursements, groups, commissions, leads, notifications, or anything in the control-plane schema.
- Neither doc reflects the `deletedAt` soft-delete columns, the outbox pattern, the maker-checker approval workflows, or the age-banded/multi-currency pricing model.
- **Recommendation for the report**: treat `ERD.md`/`ERD_SUMMARY.md` as historical scaffolding from an early project phase, not current documentation. `shared/schema.ts` is the only reliable source of truth, consistent with the project's own CLAUDE.md statement that schema.ts is "the source of truth."
- There is also a duplicate copy of both files under `fxq/ERD.md` and `fxq/ERD_SUMMARY.md` (an unrelated subdirectory in the repo, likely a stray copy/import) — not reviewed further as out of scope, but flagged in case the report's file inventory needs to note it.

---

## 15. Migrations Directory — Evolution Narrative

`migrations/` contains ~66 SQL files (Drizzle-generated + a handful of hand-written hardening/backfill scripts). Two independent numbering sequences are visible, both starting at 0000-0001 and both continuing to overlap — this indicates the migration numbering was reset or forked at least once (visible in the interleaving of `0000_fancy_union_jack.sql` / `0001_per_tenant_paynow.sql` / `0002_oval_bullseye.sql` / `0003_living_cloak.sql` / `0004_add_vehicle_trip_logs.sql` / `0005_fearless_grandmaster.sql` appearing *after* `0046` in the directory listing — these look like Drizzle's auto-generated adjective-noun names from a second `drizzle-kit generate` lineage, likely tenant-database-specific migrations kept in the same folder as the main sequence).

**Chronological/thematic groupings** (by filename, low → high):

**Foundational tenancy & auth (0001–0013)**
`0001_add_organizations_signature_url` → `0002_add_policy_number_format` → `0003_add_tenant_database_url` (introduces the per-tenant isolated-DB concept) → `0004_add_users_password_hash` → `0005_add_policies_inception_date` → `0006_policy_credit_group_payment_month_end` (bundles policyCreditBalances/groupPaymentIntents/monthEndRuns in one migration) → `0007_client_notification_prefs_device_tokens` → `0008_add_org_whitelabel` → `0009_fix_policy_default_status` → `0010_platform_owner_unlink` (unlinks the platform superuser from any org) → `0011_rename_chibikhulu_to_platform` (renames an internal codename to "platform") → `0012_fix_role_permissions_unique` → `0013_add_user_profile_fields`.

**Product/pricing config & groups (0014–0021)**
`0014_add_group_company_fields` → `0015_org_policy_sequences_receipt` → `0016_product_versions_underwriter` (adds underwriter cost-sharing columns) → `0017_cashup_workflow` → `0018_product_version_weekly_biweekly_zar` (multi-currency/multi-schedule pricing) → `0019_multi_currency_cashup_claims` / `0019_payment_automation_and_methods` (duplicate 0019 — numbering collision) → `0020_notification_enhancements` / `0020_payment_automation_runs` (another duplicate number) → `0021_sequences_credit_note_month_end`.

**Payments hardening & documents (0022–0030)**
`0022_outbox_messages` (transactional outbox pattern introduced) → `0023_client_documents` → `0024_app_download_interests` → `0025_app_releases` → `0026_users_branch_id` → `0027_funeral_case_details` → `0028_funeral_deceased_details` → `0029_policy_premium_changes` (premium-change audit ledger) → `0030_fx_rates`.

**Finance suite build-out (0031–0043)**
`0031_requisitions` → `0032_funeral_quotations_service_receipts` → `0033_finance_hardening` (idempotency + one-quote-per-case constraints) → `0034_debit_orders` → `0035_mortuary_dispatch_driver_checklist` → `0036_quotation_enhancements` → `0037_policy_documents_legacy_waivers` (introduces `isLegacy` concept for policies) → `0038_payment_period_columns` → `0039_grace_used_days` → `0041_leads_product_interest` (note: 0040 is missing from the directory) → `0042_policy_cascade_deletes` (retrofits ON DELETE CASCADE onto policy child FKs) → `0043_receipt_adverts`.

**HR/payroll and requisition maturity (0044–0050)**
`0044_payroll_enhancements` → `0045_attendance_logs` → `0046_employee_enhancements` → `0047_requisition_items` → `0048_requisitions_enhancements` → `0049_platform_service_receipt_id` (links platformReceivables to serviceReceipts) → `0050_backfill_cash_service_fees` (data backfill, not just DDL).

**Second/parallel Drizzle-generated sequence (interleaved, likely tenant-DB specific)**
`0000_fancy_union_jack`, `0001_per_tenant_paynow`, `0002_oval_bullseye`, `0003_living_cloak`, `0004_add_vehicle_trip_logs`, `0005_fearless_grandmaster` — auto-generated adjective-noun names strongly suggest a separate `drizzle-kit` migration lineage (possibly the isolated tenant database's own migration history, generated independently from the shared-DB sequence).

**Most recent changes — soft delete, age-banded pricing, and mortuary/vehicle detail (0051–0058)**, all opened and read in full:
- `0051_add_soft_delete_columns` — idempotent `ADD COLUMN IF NOT EXISTS deleted_at` on `policies`, `payment_transactions`, `payment_receipts`. Comment explains this is a defensive re-add for tenant databases whose migration history was seeded from a snapshot rather than replayed from `0002_oval_bullseye`, i.e. **schema drift between tenant databases is an acknowledged operational risk** the team actively patches for.
- `0052_additional_member_premium` — adds flat additional-member premium rate columns (USD/ZAR) to `product_versions`.
- `0053_max_additional_members` — adds `max_additional_members` cap to `products` (null = unlimited).
- `0054_fix_missing_tenant_columns` — another defensive backfill migration re-adding columns from 0013/0052/0053 that may be missing on isolated tenant DBs — reinforces the schema-drift risk noted above.
- `0055_additional_member_age_band_rates` — adds 8 age-banded additional-member rate columns (child/21-65/66-84/85+ × USD/ZAR) to `product_versions`, all nullable so existing versions are unaffected (explicit fallback-to-flat-rate design noted in the migration's own comment).
- `0056_chapel_wash_bay_fee` — adds chapel/wash-bay usage fee columns to `mortuary_dispatches` for partner-parlour cases using the org's facilities on dispatch (flat $20 fee, mirrors the existing storage-fee pattern).
- `0057_post_mortem_and_vehicle_usage` — creates two brand-new tables: `mortuary_post_mortem_movements` and `partner_parlour_vehicle_usage` (both described in §7 above).
- `0058_requisition_department_costflag` — adds `department` and `cost_flag` columns to `requisitions` for departmental spend reporting and special cost-center tagging (e.g. `CEO_PERSONAL`, `SOUTH_AFRICA`).

**Working-tree-only (uncommitted) schema changes** at time of writing (per `git status`): `migrations/0057_post_mortem_and_vehicle_usage.sql` and `migrations/0058_requisition_department_costflag.sql` are both untracked new files, and `shared/schema.ts` / `shared/control-plane-schema.ts` are both modified-but-uncommitted — i.e. this documentation captures the schema **as currently staged**, including the two newest migrations, ahead of their commit.

**Overall narrative**: the schema evolved from a thin 3-table tenancy/RBAC skeleton (matching the stale ERD docs) into a full funeral-insurance operations platform in a steady incremental cadence — each migration typically adds one bounded feature area (a table group or a handful of columns) rather than large sweeping schema rewrites. Recent activity (0051–0058) shows two parallel concerns: (a) closing gaps around **soft-delete and schema-drift on isolated tenant databases** (0051, 0054), and (b) deepening the **mortuary/funeral operations** and **finance departmental-reporting** domains (0055–0058), consistent with the git log's recent commit messages about legacy receipts, premium overrides, and age-band pricing.

---

## 16. Preliminary Control-Plane vs. Tenant-Owned Flag (schema-shape only; full analysis is a later report section)

**Clearly control-plane / global (no organization_id, or explicitly a separate DB):**
- Everything in `shared/control-plane-schema.ts` (`tenants`, `tenantDomains`, `tenantDatabases`, `tenantStorage`, `tenantIntegrations`, `tenantBranding`, `tenantFeatureFlags`, `backupSyncRuns`) — physically separate database.
- `permissions` — global permission catalog, no organizationId.
- `sessions` — global session store, no organizationId.
- `appDownloadInterests` — explicitly commented "Platform-level (not org-scoped)".
- `appReleases` — explicitly commented "Platform-level".
- `organizations` itself — the row that *defines* a tenant, sits in the shared DB (not control-plane) but has no organizationId (it can't reference itself) — conceptually control-plane-ish even though physically co-located with tenant data today.

**Hybrid (nullable organization_id — shared/system rows possible alongside tenant-specific ones):**
- `users` (nullable — platform owner has null org).
- `roles` (nullable — system roles available to all tenants).
- `securityQuestions` (nullable).
- `auditLogs` (nullable — platform-owner actions may lack org context).

**Everything else (~90 tables)** carries a NOT NULL `organization_id` (or inherits tenancy transitively through a parent FK with no direct column, e.g. `claimDocuments`, `claimStatusHistory`, `funeralQuotationItems`, `driverAssignments`, `productBenefitBundleLinks`, `settlementAllocations`, `payslips`) and is squarely tenant-owned. This is the overwhelming majority of the schema — the platform is designed so that essentially all business/operational data belongs to exactly one tenant, physically or at minimum logically isolated, with only identity-adjacent (permissions, sessions, roles-when-null) and platform-operational (backup runs, app releases, tenant registry/routing) concerns living outside that boundary.

**Anomaly worth flagging for the later full analysis**: `platformReceivables` and `settlements` (§10) represent money owed *to* POL263 (the platform vendor) *by* the tenant, yet they live as ordinary org-scoped rows inside the tenant's own schema rather than in the control plane. This is a plausible design choice (the tenant needs to see/manage its own liability), but it means platform-revenue reporting must aggregate across every tenant database rather than reading one central ledger — worth a closer look in the report's cross-cutting-concerns section.

---

## 17. Table Count Summary

- **`shared/schema.ts`**: 103 tables defined via `pgTable(...)`.
- **`shared/control-plane-schema.ts`**: 8 tables (separate database).
- **Total distinct tables documented**: 111.


---

# Section 5 — Authentication

## 5.1 Overview

POL263 has **three distinct authentication subjects**, each with its own session shape and no shared token format:

| Subject | Mechanism | File |
|---|---|---|
| Staff (Google Workspace users) | Google OAuth 2.0 via Passport, `req.user` populated by `passport.deserializeUser` | `server/auth.ts` |
| Agents (a staff sub-type without Google access) | Email + password (argon2), still uses `req.login()` / Passport session | `server/auth.ts` (`/api/agent-auth/login`) |
| Clients (policyholders) | Email/policy-number + password, **not** Passport — raw `req.session.clientId` / `req.session.clientOrgId` | `server/client-auth.ts` |

There is **no JWT anywhere in the runtime code**. A repo-wide search for `jsonwebtoken`/`jwt` (case-insensitive) only turns up transitive `package-lock.json` entries (unrelated deps pulled in by something else) — no `import jwt`/`require("jsonwebtoken")` exists in `server/`, `client/`, or `shared/`. **Authentication is 100% server-side-session/cookie based** (`connect-pg-simple`-backed Express session), for staff, agents, and clients alike. The one exception is the **native-mobile OAuth handoff**, which uses a short-lived, single-use, in-memory opaque token (`mobileAuthTokens` Map in `server/auth.ts:24`) — not a JWT — that is exchanged for a normal session cookie via `POST /api/auth/mobile-exchange`.

---

## 5.2 Session storage mechanics

- `server/auth.ts:19,92-128` wires `express-session` with `connect-pg-simple` (`PgSession`) pointed at table `sessions` (`tableName: "sessions"`, `createTableIfMissing: false` — the table must already exist via migration, defined in `shared/schema.ts:2117-2121` as `sessions(sid varchar PK, sess jsonb, expire timestamp)`).
- `pruneSessionInterval: 15 * 60` seconds — expired sessions are swept periodically.
- Cookie: `httpOnly: true`, `sameSite: "lax"`, `secure` only in production, `maxAge: 24h`.
- **Cross-subdomain cookie sharing**: in production the cookie `domain` is derived from `APP_BASE_URL` and prefixed with a leading dot (e.g. `pol263.com` → `.pol263.com`), so the same session cookie is valid on `falakhe.pol263.com`, `pol263.com`, etc. This is required because the Google OAuth callback always lands on the main domain even when login was initiated from a tenant subdomain (`server/auth.ts:109-125`).
- `SESSION_SECRET` is required in production (throws if missing); in dev it falls back to a random 32-byte secret with a warning (not persisted across restarts, so dev sessions invalidate on restart).
- **Client sessions reuse the exact same Express session/cookie store** — they are not Passport-authenticated (no `req.user`), instead `client-auth.ts` writes `req.session.clientId` / `req.session.clientOrgId` directly onto the same session object. So a browser can simultaneously carry a staff Passport identity and a client identity only if using different cookies/browsers — same `connect.sid` cookie name is used for both (`res.clearCookie("connect.sid")` appears both in `/api/auth/logout` and `/api/client-auth/logout`).
- Session fixation is mitigated: `req.session.regenerate()` is called after both staff Google OAuth login (`auth.ts:375-392`) and agent password login (`auth.ts:684-694`) and client password login (`client-auth.ts:261-263`) — the old session ID is discarded and a fresh one issued post-authentication, with the passport payload manually copied over for the Passport-based flows.

### Passport serialize/deserialize (staff & agent)
- `passport.serializeUser` (`auth.ts:133-138`) encodes the session payload as the string `"<userId>:<organizationId>"` (or just `userId` if the user has no org yet, e.g. platform owner pre-tenant-selection).
- `passport.deserializeUser` (`auth.ts:140-170`) splits on the first `:`, and if an orgId is present, tries to look the user up in **that tenant's own database first** (via `getDbForOrg(orgId)`), falling back to the shared/default DB. This is how a user record that lives only in an isolated tenant DB (e.g. Falakhe) still deserializes correctly on every request. Deactivated users (`isActive === false`) are rejected immediately at deserialize time (near-real-time revocation, not gated on cookie maxAge).
- A middleware right after `passport.session()` (`auth.ts:174-188`) special-cases the **platform owner**: if `req.session.activeTenantId` is set, `user.organizationId` is overridden in-memory to that tenant for the duration of the request, and `user.isPlatformOwner = true` is stamped on. This is how one physical account (the platform owner) can operate against many different tenants without re-authenticating — it's a session-stored "currently impersonating tenant X" flag, not a re-login.

---

## 5.3 Staff login flow (Google OAuth) — step by step

1. Client hits `GET /api/auth/google?returnTo=...` (`auth.ts:325-356`). Optional `returnTo` is validated to reject protocol-relative/cross-origin values. If the request carries `req.tenantId` (set upstream by `tenantResolverMiddleware`, e.g. because the user is on `falakhe.pol263.com`), that tenant id is stashed as `session.authTenantId` **before** redirecting to Google — this is critical because Google's OAuth callback always returns to the main domain, so the tenant context would otherwise be lost.
2. Session is explicitly `.save()`d before calling `passport.authenticate("google", {scope:["profile","email"]})` to guarantee `authTenantId`/`authReturnTo`/`isMobileAuth` are durably persisted before the redirect away from the app.
3. Google redirects back to `GET /api/auth/google/callback`. The Passport `GoogleStrategy` verify callback (`auth.ts:198-322`) runs:
   - Extracts email + Google's `email_verified` assertion.
   - If the authenticating email matches `PLATFORM_OWNER_EMAIL` (from `SUPERUSER_EMAIL` env, `server/constants.ts:11-22`), tenant scoping is bypassed — the owner always resolves against the shared DB.
   - Otherwise, if `session.authTenantId` was set in step 1, the user is looked up **in that tenant's DB** by `googleId` first, then (only if Google asserts the email verified) by `email`.
   - If no `authTenantId`, lookup falls back to the shared DB via `storage.getUserByGoogleId` / `storage.getUserByEmail`.
   - If still not found and the email is the platform owner's, a **fresh account is auto-created** (first-run bootstrap) with no `organizationId` — the owner must create/select a tenant afterward.
   - If not found and not the owner: login is rejected with "Not authorized. Ask your administrator to add your email to the system." — **staff accounts are never self-service-created via Google; an admin must have pre-created the `users` row.**
   - If the user is tenant-scoped, roles are fetched and `isAgentScoped(roles)` (from `shared/roles.ts`) is checked — **pure agents (role="agent" with no superior role) are explicitly blocked from Google login** and told to use the agent (password) login page instead.
   - Google id / display name / avatar are linked/refreshed on the matched user row (written to whichever DB the user was found in).
   - Deactivated accounts (`isActive === false`) are rejected.
4. On success, `req.login(user, ...)` establishes the Passport session, then the session is **regenerated** (fixation defense) while preserving the `passport` sub-object.
5. **Mobile branch**: if `session.isMobileAuth` was set, a one-time opaque token is minted (`crypto.randomBytes(32)`, 5-minute TTL, single-use, in-memory `Map`) and the response redirects to the custom URL scheme `pol263://auth/callback?token=...` so the native WebView (which cannot share the external browser's session cookie) can later `POST /api/auth/mobile-exchange` with that token to obtain a normal session.
6. **Web redirect resolution** (post-login, non-mobile): priority order is (a) explicit `returnTo` path if present, (b) if `authTenantId` was set, activate that tenant (`session.activeTenantId = authTenantId`) and redirect home with `returnTo=/staff`, (c) if the logged-in user is the platform owner with no org yet, redirect to `/staff/tenants` (tenant setup/selection screen), (d) if a regular (non-owner) staff member logged in from the *main* domain rather than their tenant subdomain, the code looks up their tenant's `slug` in the control-plane `tenants` table and 302s them to `https://<slug>.<mainHost>/?returnTo=/staff` — staff are never allowed to operate the app from the bare root domain, (e) otherwise same-origin redirect to `/staff`.

## 5.4 Agent login flow (email + password) — step by step

Endpoint: `POST /api/agent-auth/login` (`auth.ts:586-706`).

1. Per-**account** lockout (in addition to the IP-based `authLimiter` in `index.ts`): 5 failed attempts (`AGENT_LOCKOUT_THRESHOLD`) locks the account for 15 minutes (`AGENT_LOCKOUT_DURATION_MS`), tracked in an in-memory `Map` keyed by lower-cased email. **This is per-process** — under horizontal scaling each instance has its own counter (a `TODO` in the source calls this out explicitly as a known gap, recommending migration to a DB-backed `lockedUntil` column mirroring the pattern already used for `clients.lockedUntil`).
2. Tenant resolution for lookup: `req.tenantId` (set by subdomain/header middleware) takes priority over a `orgId` field in the request body (dev/direct-URL fallback).
3. User lookup order: (a) shared/default DB by email, (b) if a tenant id is known, that tenant's own DB by email, (c) last resort — scan **every** organization that has a `databaseUrl` (dedicated DB) looking for the email, to cover users migrated from elsewhere before the registry mirror existed.
4. Checks in order: user exists → `isActive` → `passwordHash` is set (Google-only accounts have none, so they can't log in here) → `organizationId` is set → the user's roles include `"agent"` (`roles.some(r => r.name === "agent")` — note this is the **raw** role-name check, not `isAgentScoped`, since this endpoint's whole purpose is to gate the agent password login page itself) → `argon2.verify(user.passwordHash, password)`.
5. On any failure past the initial lookup, `recordAgentLoginFailure(email)` increments the lockout counter; success calls `clearAgentLoginFailures(email)`.
6. On success: `req.login(user, ...)`, then session regeneration (same fixation defense as staff), returns `{ user: sanitizeUser(user), redirect: "/staff" }`.

## 5.5 Client login flow (policy number + password) — step by step

Endpoint: `POST /api/client-auth/login` (`client-auth.ts:208-279`). Clients authenticate with **policy number + password**, not email + password.

1. All client-auth endpoints wrap responses in `constantTimeResponse()` — a flat 200ms artificial delay before responding — to reduce timing side-channels that could distinguish "policy not found" from "wrong password" etc.
2. Because clients aren't tied to a resolved tenant before login (a policy number alone doesn't imply a subdomain), the login **fans out across every organization** (`findAcrossOrgs`, using `Promise.allSettled` so one unreachable tenant DB doesn't break login for clients in healthy tenants) searching for a policy with that number.
3. Once the owning policy/client is found: must be `isEnrolled`, must have a `passwordHash`, must not be `lockedUntil` in the future.
4. Password check via `verifySecret()`, which supports a **legacy fallback**: if the stored hash matches a bare SHA-256 hex pattern (`isLegacySha256Hash`), it's compared via plain SHA-256 instead of argon2 — but a successful legacy-hash match is then explicitly **blocked** (`CLIENT_LOGIN_LEGACY_HASH_BLOCKED`, HTTP 403, code `LEGACY_PASSWORD_RESET_REQUIRED`) forcing the client through the security-question reset flow, since SHA-256-without-salt is not an acceptable password KDF.
5. On wrong password: `failedLoginAttempts` increments; at 5 (`LOCKOUT_THRESHOLD`) sets `lockedUntil = now + 15min` (`LOCKOUT_DURATION_MS`) — this is **persisted to the DB** (`clients.lockedUntil` / `clients.failedLoginAttempts` columns), unlike the agent lockout which is in-memory only.
6. On success: `req.session.regenerate()`, then `session.clientId` / `session.clientOrgId` are set directly (no Passport involved for clients at all).

### Client onboarding (claim + enroll) and password reset
- `POST /api/client-auth/claim`: given an activation code + policy number (cross-org search), returns the client's first name + the org's security questions, without yet setting a password.
- `POST /api/client-auth/enroll`: sets `passwordHash` (argon2id) + a hashed security answer (`securityAnswerHash`, normalized to lowercase-trimmed before hashing) and flips `isEnrolled = true`, clearing the activation code. Optionally auto-assigns an agent to the client's un-assigned policies via a `referralCode` looked up against `users.referralCode`.
- `POST /api/client-auth/reset-password`: security-question-answer based reset (no email flow) — verifies the hashed answer, then sets a new argon2 hash and clears lockout state.
- `POST /api/client-auth/change-password`: requires current password verified first (works with the legacy-SHA256 verify path too, so an already-logged-in legacy client can rotate to argon2 by changing password from within the portal).

### Client-only "act on behalf of" pattern (paying for someone else)
- `GET /api/client-auth/lookup-by-phone`: a logged-in client can search for another client by phone/policy-number/national-ID and the found client's id is cached in the session (`lookedUpClientId`, `lookedUpClientIdAt`) with a **10-minute TTL** (`LOOKED_UP_CLIENT_TTL_MS`). `clientCanAccessPaymentIntent()` (`client-auth.ts:87-95`) then allows that session to create/initiate/poll a payment intent for the looked-up client's policy within that TTL window — this is how one client can pay a relative's premium.

---

## 5.6 Password rules & hashing

- **Hashing algorithm**: `argon2id` exclusively for new hashes, via the `argon2` npm package — `argon2.hash(value, { type: argon2.argon2id })` (both `server/auth.ts` for staff/agent password changes and `server/client-auth.ts`'s `hashSecret()` helper for clients).
- **Verification**: `argon2.verify(hash, input)`.
- **Legacy compatibility (clients only)**: `client-auth.ts:37-51` detects a raw 64-hex-char string (`/^[a-f0-9]{64}$/i`) as a legacy unsalted SHA-256 hash and verifies against that, but — as noted above — a successful *legacy* match on **login** is deliberately still rejected, forcing a reset; only the security-answer hash and the password-*change* flow tolerate reading a legacy hash to validate current credentials before overwriting with argon2id. There is no equivalent legacy path for staff/agent password hashes — `users.passwordHash` is presumed argon2id-only.
- **Minimum length**: 8 characters, enforced at several endpoints (`/api/auth/change-password`, `/api/users/:id/reset-password`, `/api/client-auth/enroll`, `/api/client-auth/reset-password`, `/api/client-auth/change-password`) — there is no additional complexity rule (no uppercase/digit/symbol requirement found).
- **Reset by admin**: `POST /api/users/:id/reset-password` requires `requireAuth` + `requireTenantScope`, then manually checks the caller's effective permissions include `write:user` OR `isPlatformOwner` (this is a rare example of a permission check done inline rather than via `requirePermission()` middleware, likely because it also needs to load+compare the *target* user's org first).

---

## 5.7 Tenant resolution mechanism

Two closely related files implement this:

### `server/tenant-resolver.ts` — `tenantResolverMiddleware`
Resolution order, **first match wins**, and this middleware **never blocks** a request (routes must call `requireTenant`/`requireTenantScope` themselves to enforce presence):
1. **`X-Tenant-ID` header** — only honored if the already-authenticated `req.user` is the platform owner, or the header equals the user's own `organizationId` (prevents a non-owner from spoofing another tenant via header).
2. **Subdomain** — `req.hostname` is compared against `APP_BASE_DOMAIN` env (default `localhost`); if it's a subdomain of the base domain, the slug portion is looked up in the control-plane `tenants` table (`tenants.slug`).
3. **Custom domain** — if the host isn't the bare base domain or `www.<base>`, it's looked up in `tenant_domains.domain` (control-plane table) — this is how a tenant can bring their own domain (e.g. `portal.acme.co.zw`) rather than using a POL263 subdomain.
4. **Authenticated session fallback** — if none of the above resolved and `req.user.organizationId` is set, that becomes `req.tenantId` (covers existing logged-in sessions hitting the resolver before any domain-based routing was fully wired, or same-origin API calls).

Both slug→tenant and domain→tenant lookups are cached in-process for 5 minutes (`CACHE_TTL_MS`), invalidated on process restart, with a `clearTenantCache()` export for tests.

`requireTenant` (route guard): 400s if `req.tenantId` was never set by the resolver.

### `server/tenant-db.ts` — physical database routing
- Each `organizations` row *may* have a dedicated Postgres database (`organizations.databaseUrl` in the shared schema, and mirrored authoritatively in the control-plane `tenant_databases.databaseUrl`). If unset, the tenant's data lives in the shared/default database (`DATABASE_URL`).
- `getPoolForOrg(orgId)`: looks up `tenant_databases.databaseUrl` from the **control plane DB first** (authoritative), falling back to the shared DB's `organizations.databaseUrl` column if the control plane is unreachable (keeps auth/data flowing during a control-plane outage). If no dedicated URL is found, returns the shared `defaultPool`. Dedicated pools are cached (`poolCache`/`dbCache` Maps keyed by orgId), capped at `MAX_TENANT_POOLS` (default 50, env `MAX_TENANT_POOLS`) with **LRU eviction** (`evictLeastRecentPool`) tracked via a `poolLastAccess` Map, and concurrent cache-misses for the same org are coalesced onto a single in-flight creation promise so load doesn't spawn duplicate pools.
- Self-signed TLS certs are tolerated for tenant/managed-Postgres connections (`rejectUnauthorized: false`) — always for `forTenant` pools, and additionally for the default pool if the URL contains `supabase`/`neon.tech` or `DB_ACCEPT_SELF_SIGNED=true`.
- On first connecting a new tenant pool, `applyPendingMigrations()` is run automatically (`migrate-tenant-db.ts`) so a tenant DB restored from an old backup can't silently drift from schema — this runs **before** first use, every time a fresh pool is created (not cached across the pool's lifetime beyond that first connect).
- `getDbForOrg(orgId)` wraps the pool in a Drizzle instance bound to `@shared/schema` and caches it per org.
- **`withOrgTransaction(orgId, fn)`**: opens exactly one `BEGIN...COMMIT`/`ROLLBACK` on that tenant's pool for ACID-sensitive writes (payments, receipts, ledger rows) — used so a payment + receipt + ledger entry either all land or all roll back together, even on isolated tenant databases.
- **User mirroring**: because `users` in the shared/registry DB is the source of truth for identity but policies/payments live in the tenant's own DB, any FK reference to a user (e.g. `payment_transactions.recorded_by`) requires that user's row to *also* exist in the tenant DB. `ensureRegistryUserMirroredToOrgDataDb()` / the `...InTx` variant upsert a copy of the registry user row into the tenant DB (only for same-org staff or the platform owner) before FK-dependent writes.

### `server/control-plane-db.ts`
- A **separate physical Postgres database** (`pol263-control-plane` on DigitalOcean) reached via `CONTROL_PLANE_DATABASE_URL` (or `CONTROL_PLANE_DIRECT_URL`, or finally falls back to the shared `DATABASE_URL` if neither is set — with a warning that `tenant_databases` etc. may not exist yet).
- Explicitly documented in its own header comment: **"USE THIS FOR: tenant registry, DB routing, integrations, branding, feature flags. NEVER USE FOR: policies, clients, payments, claims — those live in tenant databases."**
- Small dedicated pool (`max: 5`) since it's low-volume metadata-only traffic; always `rejectUnauthorized: false` (DO managed DBs use self-signed certs).
- Tables it owns (`shared/control-plane-schema.ts`): `tenants` (id, name, slug unique, isActive, licenseStatus, provisioningState, suspendedAt/suspendReason), `tenant_domains` (tenantId→domain, isPrimary/isVerified), `tenant_databases` (tenantId→databaseUrl/databaseDirectUrl, migrationState, schemaVersion), `tenant_storage` (per-tenant object-storage bucket/credential overrides), `tenant_branding`, `backup_sync_runs`.

**Summary of the multi-tenancy layering**: control-plane DB (who/where) → tenant's own Postgres database *or* the shared default database (what) → every row within that database still carries `organization_id` for defense-in-depth query scoping even on dedicated single-tenant databases.

---

## 5.8 CSRF protection

`server/index.ts:65-104`: `csurf` middleware (cookie-mode) is enabled whenever `ENABLE_CSRF_PROTECTION` is truthy, defaulting to **on in production, off otherwise** (`enableCsrf = ENABLE_CSRF_PROTECTION ?? (NODE_ENV === "production")`). A short exemption list bypasses CSRF validation for specific paths that can't carry a CSRF token by nature — the PayNow server-to-server result callback, and the login/logout endpoints themselves (`/api/agent-auth/login`, `/api/agent-auth/logout`, `/api/client-auth/logout`, etc. — full list at `index.ts:77-85`). On every non-exempt request, if a CSRF token exists it's re-mirrored into a **non-httpOnly** `XSRF-TOKEN` cookie so client JS can read it. The frontend (`client/src/lib/queryClient.ts:8-15,17-26,48-68`) reads that cookie via `document.cookie` regex and attaches it as the `X-XSRF-TOKEN` header on every mutating (`!GET/HEAD`) request via `apiFetch`/`apiRequest`, in both the double-submit-cookie style expected by `csurf`. `EBADCSRFTOKEN` errors are translated server-side into a friendly "Session expired. Please reload the page and try again." message (`index.ts:262-263`).

---

## 5.9 RBAC data model (`shared/schema.ts`)

```
organizations (id, name, ..., database_url, is_whitelabeled, paynow_*)
      │
      ├─ branches (id, organization_id→orgs, name, address, phone, is_active)
      │
      ├─ users (id, email unique, google_id unique, password_hash, display_name,
      │         organization_id→orgs (nullable — null for platform owner pre-tenant-select),
      │         branch_id→branches, is_active, ...personal fields)
      │
      ├─ roles (id, organization_id→orgs [nullable-typed but always populated per seed],
      │         name, description, is_system, created_at)
      │         — roles are PER-ORGANIZATION rows, not global: seedOrgRoles() creates one
      │           roles row per (org, roleName) pair, so "administrator" in Org A and
      │           "administrator" in Org B are different DB rows with independently
      │           editable role_permissions (an org admin CAN reassign role_permissions
      │           for their own org's roles without affecting other tenants).
      │
      ├─ permissions (id, name UNIQUE globally, description, category)
      │         — permission rows are GLOBAL (seeded once into the shared/registry DB via
      │           seedPermissions()); a permission is represented purely as a
      │           "verb:noun" string slug, e.g. "read:policy", "write:finance",
      │           "manage:approvals", "edit:premium", "receipt:cash". No numeric
      │           bitmask — string set membership only.
      │
      ├─ role_permissions (role_id→roles CASCADE, permission_id→permissions CASCADE,
      │         unique(role_id, permission_id))
      │         — join table; a role's permission set = the permission names
      │           reachable via this table for that role_id.
      │
      ├─ user_roles (id, user_id→users CASCADE, role_id→roles CASCADE,
      │              branch_id→branches NULLABLE, created_at)
      │         — a user can hold MULTIPLE roles simultaneously (no unique constraint
      │           on user_id alone). branch_id on this join row is intended to scope
      │           "this specific role assignment applies to branch X" (e.g. a
      │           "manager" role granted only for Branch 2) — see note below on
      │           enforcement.
      │
      └─ user_permission_overrides (id, user_id→users CASCADE, permission_id→permissions CASCADE,
                is_granted boolean)
              — per-user allow/deny override layered ON TOP of the role-derived set.
```

**Effective permission computation** — `storage.getUserEffectivePermissions(userId, orgId)` (`server/storage.ts:870-926`):
1. Resolve the user row (tenant DB first if `orgId` given, else shared DB).
2. Join `user_roles → roles → (left join) role_permissions` scoped to that org, collecting `(roleName, permissionId)` pairs.
3. **If any held role is literally named `"superuser"`, short-circuit and return *every* permission in the system** — `superuser`'s `ROLE_PERMISSION_MAP` entry is deliberately an empty array (`superuser: []` in `server/constants.ts:85`) because it never needs an explicit list; membership alone grants everything.
4. Otherwise, resolve permission ids → names against the **shared/registry DB** (permission definitions are only ever seeded there, even for orgs on a dedicated tenant database — `role_permissions` rows reference permission ids that only resolve to names via the shared DB).
5. Apply `user_permission_overrides`: `isGranted=true` adds the permission name to the set even if no role granted it; `isGranted=false` **removes** it even if a role granted it — i.e. **explicit per-user deny wins over role-derived grant.**
6. **Platform owner override**: if the resolved user's email matches `PLATFORM_SUPERUSER_EMAIL`, every permission is force-added plus three platform-only permissions not in any tenant role map: `create:tenant`, `delete:tenant`, `manage:whitelabel`.

**Branch scoping — data model support only, not enforced in the read path found.** `user_roles.branch_id` and `users.branch_id` exist and are populated (e.g. new users default to their creator's branch, `routes.ts:1200,1571`), and `GET /api/auth/me` returns `{ name, branchId }` per role so the **frontend** can filter/display branch context. However, `getUserEffectivePermissions()` does **not** filter by `branch_id` at all — a user's permission *set* is branch-agnostic; branch_id is carried through as descriptive/reporting metadata (many report/finance endpoints accept an optional `?branchId=` **query filter** for the caller to narrow results, e.g. `routes.ts:2144,5919,7779,7925,8089,8097,8104`) rather than as an access-control boundary automatically applied server-side. **This is an inference from the absence of branch-filtering logic in `requirePermission`/`requireAnyPermission`/`getUserEffectivePermissions` — flagging as a gap for a future architect rather than asserting it never matters**: it's possible some individual route handlers manually compare `user.branchId` to a resource's `branchId` inline (a full audit of every route would be needed to rule this out completely), but no generic branch-scoping middleware exists alongside `requireTenantScope`.

**Agent data-scoping (distinct from branch scoping)** — `shared/roles.ts` (28 lines, read in full):
```ts
export const AGENT_SCOPE_OVERRIDE_ROLES = new Set(["superuser", "administrator", "manager"]);
export function isAgentScoped(roles: { name: string }[]): boolean {
  const hasAgent = roles.some((r) => r.name === "agent");
  if (!hasAgent) return false;
  const hasSuperior = roles.some((r) => AGENT_SCOPE_OVERRIDE_ROLES.has(r.name));
  return !hasSuperior;
}
```
A user holding **only** the `agent` role (no superior role) is restricted to their own clients/policies. A user holding `agent` **plus** `administrator`/`manager`/`superuser` (e.g. an admin who also carries an agent role for a personal referral code) is treated as the superior role and is **not** scoped down. This gate is used in two enforcement helpers in `server/route-helpers.ts`:
- `enforceAgentScope(req, filters)` (`route-helpers.ts:484-494`) — injects `agentId: user.id` into a query-filter object when the caller is agent-scoped.
- `enforceAgentPolicyAccess(req, policy)` (`route-helpers.ts:505-530`) — per-resource check: 404 if the policy isn't in the user's org, 403 if the caller is agent-scoped and isn't that policy's assigned agent.

---

## 5.10 Route guard functions (`server/route-helpers.ts` is calculation/audit helpers; the actual guards live in `server/auth.ts:834-929`)

- **`requireAuth(req,res,next)`** — 401 if `!req.isAuthenticated() || !req.user`. Pure "is someone logged in" check (Passport-session based; does not apply to the client portal, which uses its own `session.clientId` presence checks inline in every `client-auth.ts` handler rather than a shared middleware).
- **`requirePermission(...perms)`** — returns middleware requiring **all** listed permission strings. Platform owners bypass unconditionally. Otherwise resolves `effectiveOrgId` (accounting for the owner's `activeTenantId` override) and calls `storage.getUserEffectivePermissions`; also side-effects `user.organizationId = effectiveOrgId` so any handler that reads `req.user.organizationId` directly downstream stays correctly tenant-scoped even for an owner impersonating a tenant. 403 + a structured warn log (`Permission denied`, including `requestId`) on failure.
- **`requireAnyPermission(...perms)`** — same shape, but passes if **any** one of the listed permissions is present.
- **`requireTenantScope(req,res,next)`** — 403 if no effective org id resolvable (with a distinct `NO_TENANT_SELECTED` code for a platform owner who hasn't picked a tenant yet vs. a generic message for anyone else). Also defends against **tenant-header spoofing**: if a non-owner sends `X-Tenant-ID` that doesn't match their own session org, the request is rejected (403) rather than silently trusting the header — this guards any route that might read `req.tenantId` instead of `req.user.organizationId`.

Typical route composition seen throughout `routes.ts`: `requireAuth, requireTenantScope, requirePermission("write:policy")` — i.e. "must be logged in" → "must resolve to a tenant" → "must hold this specific permission within that tenant."

### Sample of permission slugs actually used in `requirePermission(...)` calls in `server/routes.ts` (~40+ distinct strings found, grouped by area)

- **Identity/RBAC/platform**: `read:user`, `write:user`, `delete:user`, `read:role`, `write:role`, `manage:permissions`, `create:tenant`, `delete:tenant`, `read:branch`, `write:branch`
- **Audit**: `read:audit_log`
- **Policies/products**: `read:policy`, `write:policy`, `delete:policy`, `edit:premium`, `read:product`, `write:product`
- **Claims**: `read:claim`, `write:claim`
- **Clients**: `read:client`, `write:client`
- **Finance**: `read:finance`, `write:finance`, `edit:payment`, `delete:payment`, `edit:receipt`, `delete:receipt`
- **Funeral operations / mortuary**: `read:funeral_ops`, `write:funeral_ops`
- **Fleet**: `read:fleet`, `write:fleet`
- **Commission**: `read:commission`, `write:commission`
- **Payroll**: `read:payroll`, `write:payroll`
- **Leads/CRM**: `read:lead`, `write:lead`
- **Notifications**: `read:notification`, `write:notification`
- **Settings**: `manage:settings`
- **Reports**: `read:report` (also `write:report` exists in `SYSTEM_PERMISSIONS`/role maps though not observed gated by `requirePermission` in the sampled routes — likely enforced via `requireAnyPermission` or a different mechanism for export endpoints; not confirmed by this pass)
- **Approvals (maker-checker)**: `manage:approvals`

Full canonical list of all defined permission slugs (`server/constants.ts:27-82`, `SYSTEM_PERMISSIONS`) additionally includes ones not directly sampled above but present in the map: `read:organization`, `write:organization`, `approve:claim`, `view:own_clients`, `view:all_clients`, `approve:finance`, `backdate:payment`, `receipt:cash`, `receipt:mobile`, `receipt:transfer`, `receipt:group`.

---



---

# Section 6 — Business Workflows

Sources: `server/storage.ts` (full, 5733 lines), `server/route-helpers.ts`, `server/payment-service.ts`, `server/policy-status-on-payment.ts`, `server/financial-statements.ts`, `server/credit-apply.ts`, `server/paynow-config.ts`, `server/paynow-hash.ts`, `server/backup-sync.ts`, `server/outbox.ts` + `outbox-handlers.ts` + `outbox-constants.ts`, `server/job-queue.ts`, `server/notifications.ts`, `server/user-notifications.ts`, `server/push.ts`, `server/sse.ts`, `server/payslip-pdf.ts`, `server/payslip-email.ts`, `server/driver-checklist-pdf.ts`, `server/agent-portfolio-pdf.ts`, `server/department-report-pdf.ts`, `server/client-auth.ts`, targeted excerpts of `server/routes.ts` (~241KB — grepped/read by section), `shared/schema.ts` (status enums, table shapes), and migrations `0057_post_mortem_and_vehicle_usage.sql` / `0058_requisition_department_costflag.sql`.

---

## 1. Policy Sales / Issuance

**Trigger:** Staff/agent creates a policy application (backed by `storage.createPolicyWithInitialSetup`).

**Flow:**
1. Client + dependents captured (`clients`, `dependents` tables). `dependents.dateOfBirth` drives age-band pricing later.
2. Product selection: `products` → `productVersions` (versioned pricing config). `getProductVersion(id, orgId)` / `getProduct(id, orgId)`.
3. Premium computed by `computePolicyPremium()` in `route-helpers.ts`:
   - **Base premium**: looked up from the product version by `paymentSchedule` (`monthly`/`weekly`/`biweekly`) × `currency` (`USD` or `ZAR` fields, e.g. `premiumMonthlyUsd`/`premiumMonthlyZar`).
   - **Add-ons**: `getAddOnPrice()` — either `pricingMode: "percentage"` (base × pct/100) or flat rate per schedule (`priceWeekly`/`priceBiweekly`/`priceMonthly`). Applied per-member (`memberAddOns`) or per-policy × member count (`addOnIds`).
   - **Dependant surcharge** — three mutually exclusive strategies, chosen by what data exists on the product version:
     a. **Age-band mode** (`hasAgeBandRates(pv)` true — any of `additionalMemberRateChildUsd/Zar`, `...21To65...`, `...66To84...`, `...85Plus...` set): members beyond the product's included count (`maxAdults + maxChildren + maxExtendedMembers`) are charged individually by their own age band. Members are covered free in the order added (policy holder first); the **last-added** members past the included count are the "extra" ones charged. Child threshold age = `productVersion.dependentMaxAge` (default 20). Bands: child (< threshold), 21–65, 66–84, 85+.
     b. **Flat additional-member rate** (`additionalMemberPremiumMonthlyUsd/Zar` > 0): one flat rate × all excess members (adults+children combined) over the included count.
     c. **Legacy underwriter-rate fallback**: `underwriterAmountAdult` / `underwriterAmountChild` per excess adult/child, computed separately.
   - `monthlyToScheduleFactor()` converts a monthly rate to the policy's schedule (weekly = 12/52, biweekly = 12/26, quarterly = 3×, annually = 12×).
   - Total = base + addOnTotal + dependantSurcharge, floored at 0, `.toFixed(2)`.
4. **Atomic creation** — `storage.createPolicyWithInitialSetup(orgId, {...})` (single `withOrgTransaction`):
   - Inserts the `policies` row.
   - Inserts initial `policyStatusHistory` (`fromStatus: null → toStatus`, typically `"inactive"`).
   - Bumps the `org_member_sequences` sequence to stay ahead of any pre-migration data, then allocates a `MEM-######` member number per member row inserted into `policyMembers` (role: `policy_holder`/`dependent`/etc.).
   - Inserts deduped `policyAddOns` rows, resolving `memberRef: "holder"` to the policy_holder member row or a dependent UUID.
5. Policy number generated via `generatePolicyNumber(orgId)` — sequence `org_policy_sequences.policy_next`, padded per org config (`policyNumberPadding`, `policyNumberPrefix`).
6. **Status machine** (`shared/schema.ts` `VALID_POLICY_TRANSITIONS`):
   ```
   inactive  → active | cancelled
   active    → grace | cancelled
   grace     → active | lapsed | cancelled
   lapsed    → active | cancelled
   cancelled → (terminal)
   ```
   A policy starts `inactive` and only becomes `active` on **first cleared payment** (see §2) — inception/effective dates are stamped at that point, not at creation.
7. Side effects: `dispatchNotification(orgId, "policy_capture", clientId, ctx)` (client-facing), audit log `CREATE_POLICY`.

**Business rules:** currency is per-policy (`USD`/`ZAR`/`ZIG` supported elsewhere); premium math never goes negative (`Math.max`-guarded); `additionalMemberRate*` fields on `productVersions` are the newer "premium-override / age-band member pricing" mechanism referenced in recent commits.

---

## 2. Premium Payments

### 2a. PayNow (online) — end to end

Files: `server/payment-service.ts`, `paynow-config.ts`, `paynow-hash.ts`, `policy-status-on-payment.ts`.

1. **Create intent** — `createPaymentIntent()`:
   - Validates amount > 0, resolves policy, checks `validatePolicyPayable()` (must have a policy number, must not be `cancelled`).
   - **Idempotent**: looks up `getPaymentIntentByOrgAndIdempotencyKey()` first; returns the existing intent if found instead of creating a duplicate.
   - Generates `merchantReference` = `{ORGCODE}-POL{policyNumber}-{yyyymmdd}-{hhmmss}-{rand}` (a `GRP-`-prefixed variant, `generateGroupMerchantReference`, exists for group payments).
   - Inserts `paymentIntents` row (`status: "created"`) + a `paymentEvents` row (`type: "initiated"`).
2. **Initiate** — `initiatePaynowPayment()`:
   - Loads per-org PayNow config (`getOrgPaynowConfig`) — **per-tenant integration ID/key take priority over platform env vars**; if the org lookup itself fails, config is explicitly disabled rather than silently falling back to the platform merchant account (prevents cross-tenant payment leakage).
   - Builds either a **standard redirect** (`buildInitParams`, card/EFT) or **remote/mobile-money** request (`buildRemoteParams` — EcoCash, OneMoney, InnBucks, O'Mari), each hashed via `generatePaynowHash()` (SHA-512 of concatenated field values + integration key, per PayNow spec, uppercase hex).
   - POSTs form-encoded to PayNow's `initiatetransaction` or `remotetransaction` endpoint.
   - On `status=ok`, extracts `pollurl`, `browserurl`/`redirecturl`, and (InnBucks) `authorizationcode`/`authorizationexpires`, or (O'Mari) `remoteotpurl`/`otpreference`. Persists these on the intent; status becomes `pending_otp` (O'Mari) or `pending_paynow` (others).
   - On failure, intent → `status: "failed"`, event `marked_failed`.
3. **O'Mari OTP step** — `submitOmariOtp()`: POSTs the OTP to the stored `otpUrl` with a fresh hash; on paid status calls `applyPaymentToPolicy()` directly.
4. **Result webhook** — `handlePaynowResult()` (PayNow does not support proper server callbacks reliably, so both webhook and polling exist):
   - Hash-verifies posted fields against the **per-org key** if `orgId` is known in the URL (`?org=`), else falls back to scanning every org's key (legacy path) — `verifyPaynowHash()` uses `crypto.timingSafeEqual` for the comparison.
   - Matches `reference` to a `paymentIntent` (or, if none, a `groupPaymentIntent` — searched across all orgs in parallel).
   - **Amount-mismatch guard**: `paynowAmountMatches()` requires the gateway-reported amount be within 1 cent of the expected amount before applying a "paid" status — a lesser amount is held (`amount_mismatch_hold` event) rather than silently activating the policy.
   - On confirmed paid status → `applyPaymentToPolicy()` (or `applyGroupPaymentToPolicies()` for group refs). On failed/cancelled/disputed → intent marked `"failed"`.
5. **Poll** — `pollPaynowStatus()`: client/staff-triggered POST to the stored poll URL; same hash verification, amount check, and `applyPaymentToPolicy()` call as the webhook path. Returns `paid_pending_apply` if the gateway confirms payment but the apply step itself throws (so the client can retry safely).
6. **Apply payment** — `applyPaymentToPolicy(intentId, actorType, actorId)` — the canonical, **idempotent**, single-transaction (`withOrgTransaction`) mutation:
   - Row-locks the intent (`SELECT ... FOR UPDATE`) and re-checks `status === "paid"` inside the transaction to close a race window; also checks for an existing transaction by idempotency key `paynow-{intentId}`.
   - Infers **month count** from `paidAmount / premiumAmount` (rounded, clamped 1–12) — supports advance/bulk payments in one PayNow charge.
   - Calls `advancePolicyCycle()` (see §2c) once per inferred month to roll `currentCycleStart/End`, `graceEndDate`, `graceUsedDays` forward.
   - Inserts `paymentTransactions` (`status: "cleared"`, `paymentMethod: "paynow"`, idempotency key `paynow-{intentId}`) and `paymentReceipts` (`printFormat: "thermal_80mm"`, metadata carries `transactionId`/`paynowReference`).
   - Marks intent `"paid"`; calls `applyPolicyStatusForClearedPayment()` (see §2c) to flip policy status.
   - Enqueues a **transactional outbox** message (`OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP`) inside the same transaction — PDF generation, platform-fee receivable, commission, and notifications are deferred to the outbox handler (see §17) so they can't be lost if the HTTP request is interrupted, and are naturally deduped/idempotent on retry.
   - Post-transaction: if the policy had been `lapsed`, fires `rollbackClawbacks()` (best-effort, logged if it fails — "manual correction required").
7. **Group PayNow** — `applyGroupPaymentToPolicies()`: same shape but iterates `groupPaymentAllocations` (one per policy in the group), each in its **own** `withOrgTransaction`, each idempotency-keyed `grp-{groupIntentId}-{policyId}`. A **2.5% platform fee** (`platformReceivables`) is created per allocation (`amount × 0.025`). Notifies each unique client once. If not all allocations succeed, returns an explicit partial-failure count rather than silently marking the group intent paid.

### 2b. Manual / cash receipting (`routes.ts` `POST /api/payments`)

- Permission gated per method (`receipt:cash`, `receipt:mobile`, `receipt:transfer`, etc. via `methodPermMap`).
- **Premium-override guard**: if the submitted amount doesn't match `policy.premiumAmount × months` (within 1 cent), the receipt is **held for approval** (`paymentReceipts.approvalStatus = "pending"`, `metadataJson.premiumOverride = true`) instead of clearing — requires `edit:premium` to even submit a mismatched amount, plus a mandatory `submitterNote`. Actual clearing requires `approve:finance` via `POST /api/payment-receipts/:id/approve` (mandatory `approvalNote`), which then creates the real `paymentTransactions`/policy-status-update inside a transaction, dated to `receipt.backdatedDate` if set (so late/backdated approvals land in the correct accounting period) and posts the 2.5% platform fee.
- Otherwise: transaction created directly, `monthCount` inferred from `amount / premium` (same advance-payment logic as PayNow), `advancePolicyCycle()` run per month, receipt issued, `applyPolicyStatusForClearedPayment()` called, outbox message `OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP` enqueued (drives PDF + platform fee + commission + client/agent notifications, same pattern as PayNow), clawback rollback if reinstating from `lapsed`.
- Duplicate idempotency key → HTTP 409 `duplicate_payment_request` rather than a 500.

### 2c. Shared status-transition + cycle logic (`policy-status-on-payment.ts`)

- `advancePolicyCycle(db, policyId, policy, postedDate)`: computes the new `currentCycleStart/End` **anchored to the due date** (not the actual payment date) so early/late payments don't shift future due dates. Grace: `graceUsedDays` accumulates if paid late (`daysLate`), resets to 0 if paid on-time/early; `graceEndDate = nextDueDate + remainingGraceDays`. `gracePeriodDays` sourced from the product version (default 30). Cycle length by schedule: weekly=7, biweekly=14, yearly=365, else 30 (monthly).
- `applyPolicyStatusForClearedPayment()`: `inactive→active` (stamps `inceptionDate`, `effectiveDate` if unset, `version+1`), `grace→active` (clears `graceEndDate`), `lapsed→active` (reinstatement, clears `graceEndDate`) — each writes a `policyStatusHistory` row with a human-readable reason (`"First premium paid — conversion"`, `"Payment received"`, `"Reinstatement — payment received"`) plus an optional suffix (` (cash)`, ` (PayNow)`, ` (group receipt)`, ` (month-end)`, ` (credit balance)`, ` (premium override, approved)`, etc. so the audit trail records the payment channel). No-op if already `active`.

### 2d. Credit balance auto-apply (`credit-apply.ts`)

- `runApplyCreditBalances(orgId)` (scheduled/triggered job): scans `policyCreditBalances` with positive balance; for each, if `balance >= premium` and the policy is due (`currentCycleEnd <= today`) or in `inactive|grace|lapsed`, calls `applyCreditBalanceToPolicy()`.
- That function atomically deducts the balance (`UPDATE ... WHERE balance >= amount`, fails cleanly on insufficient funds) inside a transaction, creates a `paymentTransactions` row (`paymentMethod: "credit_balance"`, idempotency key `credit-apply-{policyId}-{today}`) + receipt (`paymentChannel: "credit_balance"`), calls `applyPolicyStatusForClearedPayment()`. Posts the 2.5% platform fee and a client notification afterward; reverses agent-commission clawback if reinstating from `lapsed`.
- **Credit balance / premium-change reconciliation** (`reconcilePremiumChange()` in route-helpers): when a premium changes (upgrade/downgrade/member add/remove/manual), the **signed delta × whole periods elapsed since the effective date** is posted to the wallet (`addPolicyCreditBalance`, inverse sign — arrears reduce the wallet, overpayment increases it) and recorded in `policyPremiumChanges`. `computePolicyOutstanding()` is the single source of truth for a policy's arrears/credit figure: `periodsElapsed × currentPremium − totalPaid`, folded with the signed wallet balance, to a `{ outstanding, balance }` pair used across reports and the client portal.

### 2e. Receipting & receipt numbering

- Every paid-and-cleared transaction gets a `paymentReceipts` row with an org-sequential `receiptNumber` (`org_policy_sequences.payment_receipt_next`) allocated either standalone (`getNextPaymentReceiptNumber`) or **inside the caller's existing transaction** (`allocatePaymentReceiptNumberInTx`) so the sequence bump rolls back together with the payment if anything fails.
- PDF generation for receipts is deferred to the outbox handler (`generateReceiptPdf`, imported lazily) — not generated synchronously in the request path.
- `getReceiptTotalsByUserDate()` / `getReceiptingByUserAndBranch()` power cash-up and per-staff/per-branch collection reporting (used by cashups, §8).

---

## 3. Claims

**Status machine** (`shared/schema.ts` `VALID_CLAIM_TRANSITIONS`):
```
submitted → verified | rejected
verified  → approved | rejected
approved  → scheduled | payable
scheduled → completed
payable   → paid
completed → closed
paid      → closed
```
1. **Submission** — `POST /api/claims` (`requirePermission("write:claim")`): `insertClaimSchema.parse()`, claim number generated **inside the same transaction** as the insert (`generateClaimNumber` → `CLM-######`) to avoid race-condition duplicates, initial `claimStatusHistory` row (`null → submitted`). Fields captured: `claimType`, `deceasedName/Relationship`, `dateOfDeath`, `causeOfDeath`, `cashInLieuAmount`, `currency`, `isWaitingPeriodWaived`, `fraudFlags` (jsonb).
2. **Auto-approval-request**: every claim submission auto-creates an `approvalRequests` row (`requestType: "CLAIM_REVIEW"`) and notifies every user holding `manage:approvals`.
3. **Transition** — `POST /api/claims/:id/transition`: validated against `VALID_CLAIM_TRANSITIONS[claim.status]`; transitioning to `approved` or `paid` additionally requires the `approve:claim` permission. Sets `verifiedBy`/`approvedBy` as appropriate; writes `claimStatusHistory`; notifies the original submitter (in-app `notifyUser`) and the client (push, `notifyClientPush`).
4. Claim documents (`claimDocuments`) are isolated by resolving the owning tenant DB via the parent claim (`resolveClaimOrgDb`) since the table has no direct `organizationId` column.
5. Claims feed into **funeral case creation** (`funeralCases.claimId`) and the **balance sheet** as a current liability line (`claims.status = "approved"` and unpaid → "Claims payable" in `buildBalanceSheet`).

---

## 4. Funeral Booking / Scheduling

Table: `funeralCases` (+ `funeralTasks`).

1. **Creation** — `POST /api/funeral-cases`: two service types —
   - `claim` (policy-linked, `claimId`/`policyId` set), or
   - `cash` (must have a **quotation** linked first — `quotationId` required, the quotation must not already be linked to another case; enforced server-side before insert).
   - Deceased details (name, DOB, gender, national ID, cause/place/date of death), informant (name/phone/relationship), removal logistics (`removalLocation`, `removalVehicleId` → `fleetVehicles`, `removalDriverId` → `users`), burial logistics (separate `burialVehicleId`/`burialDriverId` — can differ from removal), `attendingAgentId`, service timing (`bodyWashTime`, `burialDepartureTime`, `memorialServiceStart/End`), `slaDeadline`.
   - `caseNumber` generated (`FNC-######`), `status: "open"` initially.
   - All referenced user IDs (drivers/agent/assignee) are mirrored into the tenant DB (`ensureRegistryUserMirroredToOrgDataDb`) before the FK insert, since dedicated-DB tenants keep a partial mirror of the shared `users` table.
2. **Tasks** (`funeralTasks`): ad-hoc checklist items per case, `status` default `"pending"`, `assignedTo`, `dueDate`/`completedAt`.
3. **Driver checklist** (`driverChecklists`, one per case, upserted): tracks pre-departure readiness — `graveTent`, `loweringDevice`, `gloves`, `masks`, `fuelGauge` (`full/three_quarter/half/quarter`), `tollGateRequired`/`tollGateAmount`, `driverAllowance`, `burialOrderRef`. Rendered to PDF by `driver-checklist-pdf.ts` (`streamDriverChecklistPDF`) — pulls removal/burial vehicle + driver + attending-agent contact detail (with emergency-contact fields) plus the checklist, printable/attachable.
4. **Resources consumed**: fleet vehicles (2 possible — removal + burial, can be the same), 2+ drivers, an attending agent, and (if the case is claim-linked) a mortuary intake.
5. `funeralCases.status` values seen in code: `open`, `in_progress`, `completed` (plus whatever else the UI drives) — department report PDF groups by these.

---

## 5. Mortuary

Tables: `mortuaryIntakes`, `mortuaryDispatches`, `mortuaryPostMortemMovements`, `deceasedBelongings`, `bodyWashRequirements`, `partnerParlourVehicleUsage`, `partnerParlours`/`parlourPersonnel`.

1. **Intake** — `createMortuaryIntake()`: `intakeNumber` generated (`MTR-######`), `serviceScope` (`full_service|storage_only|removal_only`), `status` defaults `"in_storage"`. Captures deceased detail, referring/informant party, removal logistics, receiving staff (`receivedByUserId`/`receivedAt`, plus an acknowledgement name/ID of whoever physically handed over the body). Optionally tied to a **partner parlour** (`partnerParlourId`) with its own `storageCategory` (`adult|child`) and `storageFeeAmount/Currency/Status` (`unpaid|paid_at_admission|paid_at_collection`) — `recordStoragePayment()` stamps `storageFeePaidBy/At/Status`.
2. **Storage** — while `status: "in_storage"`, `bodyWashRequirements` (upserted 1:1 per intake) and `deceasedBelongings` (add/list/delete, itemized personal effects) are tracked against the intake.
3. **Post-mortem out-and-back** (migration 0057): `createPostMortemMovement()` records `takenOutAt`/`takenOutBy`/`takenToLocation`/`authorizedBy`, and **flips the intake to `status: "out_for_post_mortem"`** in the same transaction. `recordPostMortemReturn()` records `returnedAt`/`receivedBackByUserId` and flips the intake back to `"in_storage"`. Applies to both the org's own bodies and partner-parlour bodies.
4. **Release / dispatch** — `dispatchIntake()`: upserts a `mortuaryDispatches` row (or updates the existing one) and sets `mortuaryIntakes.status = "dispatched"` — all in one transaction. `recordChapelWashBayPayment()` on the dispatch row tracks a separate chapel/wash-bay fee (`chapelWashBayFeePaidBy/At/Status`), distinct from the storage fee.
5. **Partner parlour vehicle usage** (migration 0057): `partner_parlour_vehicle_usage` records a partner parlour's own vehicle trips (`purpose`, `deceasedName`, `usageDateTime`, `destination`, `returnedAt`, `feeAmount/Currency/Status`) — billed back via `recordVehicleUsageFeePayment()`.
6. Department report PDF (`mortuary` dept) surfaces: total intakes, currently-in-storage count, dispatched count, "days in storage" per current occupant, and a full register.

---

## 6. Groups / Legacy Groups & Receipts

Table: `groups` — represents a **community, company, or association** that sponsors multiple individual policies (fields: `type` default `"community"`, chairperson/secretary/treasurer/HR-manager/contact-person name+phone+email, `companyName`, `capacity`). `getGroupsWhereClientIsExecutive()` matches a client to groups where their phone matches any of the chairperson/secretary/treasurer numbers (used to grant a client "group admin" view).

**Group PayNow (bulk payment for many policies at once):**
- `createGroupPaymentIntent` / `groupPaymentAllocations`: one `groupPaymentIntents` row with a `GRP-`-prefixed merchant reference, fanned out into per-policy `groupPaymentAllocations` (`amount`, `currency` per policy). `applyGroupPaymentToPolicies()` (see §2a) processes each allocation in its own transaction, idempotent per `grp-{groupIntentId}-{policyId}`.
- Cash **group receipts** (routes.ts, not PayNow) similarly loop policies, insert `paymentTransactions`/`paymentReceipts` tagged `metadataJson: { groupId, groupRef }`, and post the 2.5% platform fee per receipt — with a **backdated-approval path** identical in spirit to the premium-override flow: a backdated group receipt is held `approvalStatus: "pending"` until `approve:finance` approves it (`POST /api/payment-receipts/:id/approve`), at which point it's applied with the **original (backdated) date** as the effective date.

**"Legacy groups"**: groups that predate the per-policy PayNow/receipt model — their premium collection isn't tracked per member policy at all, just a lump cash subscription recorded directly against the group as a `legacy_group_receipts` row (raw SQL table, not a Drizzle schema object — queried/inserted via `tdb.execute(sql\`...\`)` in routes.ts and `financial-statements.ts`).
- `POST /api/groups/legacy-receipts`: requires `groupId, amount, currency, paymentDate`; generates a receipt number `LGR-{yyyymmdd}-{seq:3}`, inserts the row, posts the 2.5% platform fee **stamped with the receipt's own `paymentDate`** (not "now") so backdated entries land in the correct accounting month.
- These feed `buildIncomeStatement()`'s `legacyGroupIncome` line — a **separate income bucket** distinct from individual-policy premium and cash-services income (see §8).

**Premium-override** (recent commit): `policies.premium_override` / `premium_override_note` columns — a manually-set premium that overrides the computed `premiumAmount` for legacy-priced policies, editable in bulk (`bulk_update` audit action) or inline per-policy (guarded by `canEditPremium`).

**Age-band member pricing** (recent commit): the `hasAgeBandRates()` / `ageBandRate()` logic in `computePolicyPremium()` (see §1) — replaces one flat "additional member" rate with four age-banded rates (child / 21–65 / 66–84 / 85+) so larger families/groups are priced per-member by actual age rather than a blanket surcharge.

---

## 7. Fleet

Tables: `fleetVehicles`, `fleetFuelLogs`, `fleetMaintenance`, `driverAssignments`, `vehicleTripLogs`.

- `getFleetVehicles`/`getFleetVehicleById`/`createFleetVehicle`/`updateFleetVehicle` — basic vehicle registry (registration, make, model — referenced by funeral cases' removal/burial vehicle fields and mortuary intake removal vehicle).
- `getFuelLogs(orgId, vehicleId?)` — ordered by `filledAt` desc.
- `getMaintenanceRecords(orgId, vehicleId?)` — ordered by `scheduledDate` desc.
- `getDriverAssignments(orgId)` — joins `driverAssignments` to `fleetVehicles`, ordered by `startDate` desc (which driver is assigned to which vehicle, over what period).
- `getVehicleTripLogs`/`createVehicleTripLog` (`vehicleTripLogs`) — discrete trip records (`tripDate`-ordered), separate from the funeral-case-level vehicle assignment and from `partnerParlourVehicleUsage` (§5, which is specifically for partner-parlour billing).
- Driver checklist PDF (§4) is the primary "fleet meets funeral ops" document — pulls vehicle registration/make/model plus driver contact + emergency-contact info for the printed checklist.

---

## 8. Accounting / Cashbook / Financial Statements

### Income Statement (`buildIncomeStatement`, `financial-statements.ts`)
Cash-basis. **Income** = `premiumIndividual` (policy receipts where `policies.groupId IS NULL`) + `premiumGroup` (policy receipts where a group is set) + `cashServices` (service receipts, funeral cash jobs) + `legacyGroupIncome` (`legacy_group_receipts`). **Expenses** = `payment_disbursements` grouped by `entityType` (`requisition`/`expenditure`) joined to each entity's `category` label, plus `commissionLedgerEntries` with `status = "paid"` (labeled "Agent commissions"). Net = income − expenses, per currency, plus a **consolidated USD total** using `fx_rates` (currencies without a configured rate are excluded and listed as `unconvertible`).

### Cash Flow Statement (`buildCashFlowStatement`)
Cash **in** grouped by `paymentChannel` (cash/paynow_ecocash/paynow_card/etc.), cash **out** split into `requisitionsOut`/`expendituresOut`/`commissionsOut` (same `payment_disbursements` + paid-commission source as the income statement). Also surfaces the period's `cashups` (reconciliation) and `bankDeposits` totals for cross-checking cash actually banked vs. collected.

### Balance Sheet (`buildBalanceSheet`)
Point-in-time (`asOf`). **Assets**: cash on hand (`getAdminCashPosition` — per-admin `cashups.amounts_by_method.cash` collected minus `bank_deposits` banked, i.e. unbanked float), bank account balances (latest `bankStatementBalances` ≤ `asOf` per active account), premium receivables (conservative 1×-premium estimate for `grace`-status policies and `active` policies whose cycle has already ended but haven't been auto-transitioned to grace yet). **Liabilities**: approved-but-unpaid `claims.cashInLieuAmount`, unsettled `platformReceivables`. **Equity**: retained earnings **derived** by running the income statement from `2000-01-01` to `asOf`. Plus fully **manual** entries (`balanceSheetEntries`, sectioned `asset/liability/equity` × `current/non_current`) for fixed assets, loans, capital contributions etc. Reports an accounting-equation check (assets vs. liabilities+equity) implicitly via the two totals returned.

### Per-admin cash position (`getAdminCashPosition`)
Raw SQL: sums `cashups.amounts_by_method->>'cash'` for `submitted|confirmed` cashups per preparer, minus `bank_deposits` per depositor, yielding `onHand` (unbanked float) per user/currency — feeds both the balance sheet and a dedicated cash-position report.

### Requisition → Disbursement workflow
1. `POST /api/requisitions` — `status: "draft"`, `department`/`costFlag` (migration 0058 — free-text department + special cost-center tag like `CEO_PERSONAL`/`SOUTH_AFRICA`, no schema change needed per new flag), `requisitionNumber` (`REQ-#####`), optional `requisitionItems` (line items).
2. **Submit** (`action: "submit"`, only from `draft`) → `status: "submitted"`; notifies everyone with `approve:finance`.
3. **Approve/Reject** (`action: "approve"|"reject"`, requires `approve:finance`, only from `submitted`) — approver may adjust the amount (`adjustedAmount`) before approving; rejection requires a reason. Notifies the requester either way; on approval also notifies everyone with `write:finance` that it's ready to pay.
4. **Pay** — two paths: (a) legacy single-shot `action: "pay"` patch (kept for backward compat, computes `amountPaid`, flips `status` to `paid` or `partial`), or (b) the dedicated `POST /api/requisitions/:id/payments` disbursement endpoint (only from `approved|partial`). Both write a `paymentDisbursements` row (`entityType: "requisition"`, `entityId`, `paidByUserId`, `paidDate`, `paymentMethod`, `reference`, `receivedBy`/`receivedByUserId`) — this is the **single unified cash-out ledger** also used by `expenditures`, and is what both the income statement and cash flow statement key off for "expenses"/"cash out". `backfill-requisition-disbursements.mjs` / `backfill-requisition-workflow.mjs` (scripts/) exist to retrofit this ledger onto historical requisitions.
5. Requisitions can be paid in **installments** (`status: "partial"` until `amountPaid >= amount`).

### Funeral quotations & service receipts (cash, non-policy funeral jobs)
- `upsertFuneralQuotation()` / `createStandaloneQuotation()` (a quote can exist before any funeral case) — computes `subtotal` (sum of item `lineTotal`), `vatAmount = subtotal × vatRate/100` (default 15%), `grandTotal = subtotal + vat − discount`, all inside one transaction alongside replacing `funeralQuotationItems`. Extended fields: informant contact, deceased age/sex, `casketType`, `paymentType` (`full|part`), `conversionStatus` (`pending|partial|converted`).
- Optional **guarantor** (`quotationGuarantors`, 1:1) and **collateral** (`quotationCollateral`, list — item description/condition/value/due-forfeiture dates) for part-payment/credit arrangements.
- `markQuotationConverted()` / `markQuotationPartialPayment()` update `conversionStatus` once a `funeralCase` is linked and paid.
- **Service receipts** (`serviceReceipts`) — the cash-in record for the actual funeral service (separate from policy `paymentReceipts`): idempotency-keyed (`onConflictDoNothing` on `[organizationId, idempotencyKey]`, with a defensive re-read + explicit conflict error if the row isn't visible yet to avoid a duplicate-insert race). Feeds `cashServices` income and the 2.5% platform fee via outbox (`OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP`).

### Bank accounts / deposits / statement balances / debit orders
- `bankAccounts` (per-org accounts), `bankDeposits` (cash physically banked, by user/account/date — reconciled against cash collected for the "on hand" calc), `bankStatementBalances` (periodic snapshot of an account's closing balance, used for the balance sheet's "bank" asset line), `debitOrders` (recurring premium-collection mandates — `mandateReference`, `dayOfMonth`; surfaced on the "all policies" export as `MandateReference`/`Debit_day`).
- `balanceSheetEntries` — fully manual line items (see above).

### Cashups
- Daily reconciliation per user: `getReceiptTotalsByUserDate()` sums the day's issued policy + service receipts by payment channel for a user; a `cashups` row records `amountsByMethod`, `countedTotal`, `discrepancyAmount`, `status` (`draft/submitted/confirmed`), `preparedBy`.

### Cost sheets
- `getCostSheetsByOrg`/`getCostSheet`/`createCostSheet` + `getCostLineItems`/`createCostLineItem` — a lightweight internal costing tool (e.g. build up a funeral package's internal cost breakdown separate from the client-facing price book), CRUD only, no approval workflow surfaced in `storage.ts`.

### Receipt adverts
- `getReceiptAdverts`/`getActiveReceiptAdvert`/`createReceiptAdvert`/`updateReceiptAdvert`/`deleteReceiptAdvert`/`setActiveReceiptAdvert` (`receiptAdverts` table) — an image/text advert an org can configure to print on the bottom of thermal payment/service receipts; `setActiveReceiptAdvert` deactivates any other advert and activates the chosen one (single-active-advert-per-org pattern), read at receipt-render time via `getActiveReceiptAdvert`.

### Client payment methods & payment automation
- `clientPaymentMethods` (`getClientPaymentMethods`/`upsertDefaultClientPaymentMethod`/`getDefaultClientPaymentMethod`) — a client's saved default payment method/channel, used to pre-fill the PayNow method selector.
- `paymentAutomationSettings` (`getPaymentAutomationSettings`/`upsertPaymentAutomationSettings`, one row per org) + `paymentAutomationRuns` (`createPaymentAutomationRun`/`getPaymentAutomationRuns`) — infrastructure for an org-level "auto-charge saved payment method on due date" feature; `storage.ts` only exposes the settings/run-log CRUD, the actual charge-triggering logic (presumably a scheduled job analogous to `runApplyCreditBalances`) lives at the route/scheduler layer.

---

## 9. HR / Payroll

Tables: `payrollEmployees`, `payrollRuns`, `payslips`, `attendanceLogs`.

1. **Employee record** — `createPayrollEmployee`/`updatePayrollEmployee`; `generateEmployeeNumber()` → `EMP-#####`. Linked optionally to a `userId` (so payslip emails resolve a recipient address).
2. **Attendance**:
   - Employee logs their own attendance (`POST /api/attendance`) — date must be `YYYY-MM-DD`, not in the future, not more than 7 days in the past; unique per employee+date (`23505` → 409 "already logged"). Starts `status: "pending"`.
   - Manager approves/rejects (`POST /api/attendance/:id/approve|reject`, `write:payroll`, only from `pending`) — stamps `approvedBy`/`approvedAt`/`approvalNotes`.
3. **Payroll run** — `POST /api/payroll/runs` creates a `payrollRuns` row (`status: "draft"`, `preparedBy`). `upsertPayslip(runId, employeeId, ...)` creates/updates one `payslips` row per employee with `earnings` (base/housing/transport/otherAllowances jsonb) and `deductionsDetail` (funeralPolicy/otherInsurance/NSSA/PAYE/AIDS-levy jsonb), `grossAmount`, `netAmount`, optional `daysWorked`/`totalDays` for **prorated** salaries (partial-month starters/leavers). `updatePayrollRunTotals()` re-sums all payslips in the run into `totalGross`/`totalDeductions`/`totalNet` on the run row.
4. **Payslip PDF** (`payslip-pdf.ts`, `buildPayslipPdf`): company letterhead, employee info, masked bank account (`****1234`), a proration banner if partial-month, side-by-side earnings/deductions tables, net-pay band, signature blocks.
5. **Payslip email** (`payslip-email.ts`, `sendPayslipEmail`): resolves recipient via the linked user's email; SMTP via `nodemailer` (gracefully no-ops with a clear message if `SMTP_HOST/USER/PASS` unset); attaches the same PDF buffer. Triggered per-employee (`POST /api/payroll/runs/:id/payslips/:employeeId/send`) or for the whole run (`.../send-all`).

---

## 10. Inventory / Procurement

**Not present as a distinct module.** The closest analogues are the **price book** (`priceBookItems` — a flat catalogue of billable funeral-service items/prices used to build quotation line items, no stock/quantity tracking) and **requisitions** (a pure spend-request/approval/disbursement workflow, §8) — neither tracks stock levels, reorder points, or supplier POs. There is no inventory/stock-count/warehouse concept in `storage.ts` or the schema excerpts reviewed.

---

## 11. Tasks / Calendar / Reminders

- **Reminders** (`reminders` table): personal, per-user (`getReminders(userId, orgId)`, `createReminder`, `updateReminder`, `deleteReminder` — all scoped to the owning `userId` so one user cannot edit another's reminder).
- **Funeral tasks** (`funeralTasks`, §4): case-scoped checklist items with `assignedTo`/`dueDate`/`completedAt` — the closest thing to a shared task list, but scoped to funeral operations only.
- No standalone shared team calendar / scheduling-conflict system was found in `storage.ts`.

---

## 12. Reports / Statistics

Report-row builders in `storage.ts` (all return flat, spreadsheet-shaped rows for export):
- `getPolicyReportByOrg` / `getAllPoliciesReportByOrg` (45-column full export incl. debit-order mandate ref, default payment method, member number) / `getNewJoiningsReportByOrg` (policies captured in a date range with franchise/branch/agent columns) / `getAgentProductivityReportByOrg` (policies created **and** receipted-in-period, per agent, with a status colour code for UI) / `getFinanceReportByOrg` (adds `datePaid`, `dueDate`, `receiptCount`, `monthsPaid`, `graceDaysUsed/Remaining`, `outstandingPremium`, `advancePremium` on top of the policy report) / `getUnderwriterPayableReport` (computes what's payable to the underwriter per policy: adults×adultRate + children×childRate, × (1 + advance months), with org-wide summary totals) / `getReceiptReportByOrg` (very wide banking-style export — internal reference, default payment method, months paid/in advance, iCal `DTSTAMP`, etc.) / `getCommissionReportByOrg` (payroll-style per-agent commission aggregation: groups vs individuals commission, clawback, cash settlement) / `getCommissionPaymentReportByOrg` (per-receipt commission detail) / `getClaimsReportByOrg` / reinstatement/conversion/activation **history** reports (derived from `policyStatusHistory` transitions, e.g. `lapsed→active` = reinstatement, `inactive→active` = conversion).
- **Dashboard stats** (`getDashboardStats`) — org-wide or **agent-scoped** (separate code path filtering every count to the agent's own policies/clients/claims/leads/transactions) counts: total/active policies, total clients, total/open claims, funeral case count, lead count, transaction count, filterable by date range/status/branch.
- **Department report PDFs** (`department-report-pdf.ts`) — one function serving 6 department views (`funeral`, `finance`, `hr`, `mortuary`, `sales`, `claims`), each with its own summary stat row + detail table(s) pulled live from the tenant DB for the given date range.
- **Agent portfolio PDF** (`agent-portfolio-pdf.ts`) — landscape, grouped by agent, includes blank "Call Outcome"/"Next Engagement" columns for the agent to fill in by hand, active/lapsed/other subtotal per agent.
- **Legacy group receipts / receipting-by-user-and-branch** (`getReceiptingByUserAndBranch`) — collections broken down by staff member and by branch, plus a separate "legacy unattributed" bucket for `legacy_group_receipts` (which have no per-user/branch attribution).

---

## 13. Notifications / Messaging

Three delivery mechanisms, used together depending on audience and urgency:

1. **Client notification templates** (`notifications.ts`): `dispatchNotification(orgId, eventType, clientId, ctx)` — looks up admin-configured `notificationTemplates` for the org+eventType (multi-channel: a single event can fan out to several templates/channels); falls back to a built-in `DEFAULT_MESSAGES` map (18 event types: `policy_capture`, `policy_activated`, `payment_received`, `payment_receipt`, `premium_due`, `grace_start`, `pre_lapse_warning`, `policy_lapsed`, `policy_cancelled`, `reinstatement`, `status_change`, `member_added/removed`, `birthday`, `anniversary`, `policy_update`, `general_notice`, `activation`) if none configured. Templates support **merge tags** (`{client_name}`, `{policy_number}`, `{premium_amount}`, `{balance}`, `{outstanding}`, `{cycle_end}`, etc. — 23 tags documented in `MERGE_TAGS`). Writes to `notificationLogs` (audit trail of what was sent). `broadcastNotification()` fans a template out to every client in the org.
2. **Staff/agent notifications** (`user-notifications.ts`): `notifyUser(orgId, userId, {type, title, body, metadata})` — persists to `userNotifications` (the in-app inbox), emits an **SSE** event immediately if the user has an open tab (`sseEmit`), and sends an **Expo push** to their registered devices (`pushToUser`) — three channels fired in parallel for one call. `notifyUsersWithPermission(orgId, permission, payload)` fans out to every user holding a given permission (e.g. all `approve:finance` holders for a new requisition).
3. **Push** (`push.ts`): Expo Server SDK, chunked (`expo.chunkPushNotifications`), validates tokens (`isExpoPushToken`) before sending, and **prunes stale tokens** on `DeviceNotRegistered` errors. Separate helpers for client devices (`pushToClient`) vs staff/agent devices (`pushToUser`) vs org-wide broadcast (`pushToOrgUsers`). Documented upgrade path: swap direct Expo calls for a Redis-backed queue at >500 concurrent users (env `PUSH_BACKEND=redis`, not yet implemented).
4. **SSE** (`sse.ts`): in-process `Map<userId, Set<Response>>`, one open `GET /api/notifications/stream` connection per browser tab/device; 25s keep-alive pings; documented (commented-out) Redis pub/sub upgrade path for horizontal scaling.

**What triggers notifications:** policy creation, activation, first-time/every payment receipt, commission earned, claim submission/status change, requisition submit/approve/reject/pay, group/legacy-group receipt, credit-balance auto-apply, reinstatement, month-end run reinstatements, attendance approval — essentially every state-changing mutation that has a natural "recipient."

---

## 14. Customer / Client Portal Workflows

Auth: `server/client-auth.ts` (separate from staff Google-OAuth auth). Session fields: `session.clientId` / `session.clientOrgId`.

1. **Claim policy (activation)** — `POST /api/client-auth/claim`: matches `activationCode` + `policyNumber` **across all orgs** (`findAcrossOrgs`, tolerant of per-tenant DB failures via `Promise.allSettled`) — a client doesn't know their org up front. Rejects if already enrolled. Returns the org's security questions.
2. **Enroll** — `POST /api/client-auth/enroll`: sets password (Argon2id hash, min 8 chars) + a security question/answer (also hashed) — validates the question ID is a real UUID belonging to that org (defense against replay/tamper). Clears `activationCode`. Optional `referralCode` auto-assigns an agent to any of the client's policies that don't already have one. Sends a welcome notification.
3. **Login** — `POST /api/client-auth/login`: by **policy number** + password (not email) — again searched across all orgs. Account lockout after 5 failed attempts (15 min). **Legacy SHA-256 hashes** (pre-Argon2 migration) are detected and force a password-reset flow rather than being accepted (`isLegacySha256Hash` / `LEGACY_PASSWORD_RESET_REQUIRED`). Session ID regenerated on success (fixation defense). Constant-time-ish responses (`constantTimeResponse`, fixed 200ms delay) on the whole auth surface to reduce timing side-channels.
4. **View policies** — `GET /api/client-auth/policies`: enriches each policy with `totalPaid` (sum of cleared transactions), `totalDue` (periods elapsed × premium, schedule-aware), `walletBalance` (credit balance), signed `balance`/`outstanding` — same math as `computePolicyOutstanding()` used server-side.
5. **Pay for another client's policy** — `GET /api/client-auth/lookup-by-phone` (also supports policy-number/national-ID lookup) lets a logged-in client find and pay for a relative's/dependent's policy; a short-lived (`LOOKED_UP_CLIENT_TTL_MS` = 10 min) session grant (`session.lookedUpClientId`) authorizes paying on that intent without a full second login (`clientCanAccessPaymentIntent`).
6. Other client-portal capabilities implied by the wider codebase (not all read in full but referenced): pay premium (PayNow flow, §2a, from the client side — `actorType: "client"`), file a claim, view/download policy + client documents, submit feedback (`clientFeedback`), view notifications (`notificationLogs`), manage payment methods (`clientPaymentMethods`) and payment automation settings, register push device tokens (`clientDeviceTokens`).

---

## 15. Agent Portal Workflows

- **Scoped data access**: `enforceAgentScope()` / `enforceAgentPolicyAccess()` (route-helpers.ts) gate agents to only their own policies/clients/leads — but explicitly **do not** scope down a user who holds the `agent` role alongside a superior role (admin/manager/superuser), via the canonical `isAgentScoped()` check, so an admin who also carries an agent record (e.g. for a referral code) isn't wrongly restricted.
- **Portfolio management**: `getPoliciesByAgent`, `getClientsByAgent` (matches via policy ownership, lead ownership, or a direct `clients.agentId`), `getLeadsByAgent`, `reassignAgentPolicies(fromAgentId, toAgentId, orgId)` (bulk-transfer book of business, e.g. on agent termination — mirrors the target agent into the tenant DB first for the FK).
- **Commission** — agents earn commission per cleared payment via `recordAgentCommission()`: rate schedule can come from the **product version** (`commissionFirstMonthsRate`/`Count`, `commissionRecurringStartMonth`/`Rate`) or fall back to the org's active `commissionPlans`. First N months at `firstRate`, thereafter at `recurringRate`. **Clawback**: `recordClawback()` reverses unpaid/uncleared commission if the policy lapses within `commissionClawbackThreshold` months of inception; `rollbackClawbacks()`/`rollbackClawbacksInTx()` reverse the clawback again if the policy is later reinstated (net-zero over a lapse→reinstate cycle). Commission ledger entry types: `first_months`, `recurring`, `clawback`, `clawback_reversal`, `rollback`.
- **Agent portfolio PDF** (`agent-portfolio-pdf.ts`) — printable call/engagement worksheet, grouped by agent, with blank hand-fill columns.
- Referral codes (`users.referralCode`) let an agent get auto-assigned to any client who enrolls citing that code (§14).

---

## 16. Backup / Sync

`server/backup-sync.ts` — a **full daily mirror** (not incremental) of every tenant/registry/control-plane table into a Supabase Postgres instance.

- **Why full, not incremental**: a prior created_at-keyed incremental sync silently missed any row that changed *after* creation (e.g. a requisition moving submitted→approved→paid, a mortuary intake being dispatched) and had a "last 24h" window that left permanent gaps after any missed run. At current data scale (thousands of rows/table) a full daily `SELECT *` is cheap enough to always reflect current state.
- **Scope**: 3 sources — (1) the shared registry DB (`organizations`, shared `users`, `sessions`, app-release/download-interest tables), (2) the control-plane DB (`tenants`, `tenant_domains`, `tenant_databases`, `tenant_storage`, `tenant_integrations`, `tenant_branding`, `tenant_feature_flags`), (3) every tenant data DB — ~90 tables (policies, payments, claims, funeral/mortuary, payroll, commissions, notifications, audit logs, sequences, etc.) — synced per-org, dedicated-DB tenants first then shared-DB tenants (skipping ones already covered).
- **Mechanism**: `upsertRows()` — chunked (100 rows/batch) `INSERT ... ON CONFLICT (pk) DO UPDATE`, with `session_replication_role = replica` toggled around the batch to bypass FK-order dependency issues (data arrives table-by-table, not in dependency order). JSON/JSONB values are `JSON.stringify`'d before insert.
- **Scheduling**: computed to run at 00:00 UTC+2 (22:00 UTC) daily, via a self-rescheduling `setTimeout` chain (`startBackupScheduler`). Guarded by a Postgres **advisory lock** (`pg_try_advisory_lock(987654321)`) so only one server instance runs the backup under horizontal scaling.
- **Known limitation** (explicitly documented in the code): this is upsert-only — rows **deleted** at the source are never deleted from the backup, by design (a transient query failure should never be able to delete backup data), which means the backup can accumulate stale rows over time.
- **Run history**: each run logs to `backupSyncRuns` (control-plane DB) with `status: running|success|partial|failed`, row/table/error counts — queryable via `getRecentBackupRuns()` for a health-check UI.
- `scripts/_tmp-test-backup.ts` exists as an ad hoc test harness for this module.

---

## 17. Outbox Pattern

`server/outbox.ts` / `outbox-handlers.ts` / `outbox-constants.ts` — classic transactional outbox: side effects that must not be lost, but also must not block or fail the originating DB transaction, are written as a durable `outboxMessages` row **inside the same transaction** as the domain change, then processed asynchronously.

- **Insert** — `insertOutboxMessageInTx(tx, {organizationId, type, payload, dedupeKey})`: `onConflictDoNothing` on `[organizationId, dedupeKey]` — naturally idempotent even if the same business event tries to enqueue twice (e.g. retried webhook).
- **Message types** (`outbox-constants.ts`): `payment_staff_followup`, `cash_receipt_followup`, `paynow_apply_followup`, `service_receipt_followup` — one per money-in-the-door pathway (§2).
- **Drain** — `drainOutboxForOrg(orgId, limit)`: snapshots pending IDs, then processes each in its **own** `withOrgTransaction`, row-locking with `FOR UPDATE SKIP LOCKED` (so concurrent workers don't double-process), calling `handleOutboxMessage()`, and marking `done`/`processedAt` — or incrementing `attempts` and staying `pending` (up to `MAX_ATTEMPTS = 8`, after which it's marked `failed` permanently) on error.
- **Triggering**: `requestOutboxDrain(orgId)` enqueues an in-process job (via `job-queue.ts`) to drain right after the HTTP handler returns — low latency without blocking the response. A **background sweep** (`startOutboxBackgroundDrain`, default every 60s via `OUTBOX_DRAIN_INTERVAL_MS`) catches anything missed (deploy restart, a dropped `requestOutboxDrain` call), processing orgs in batches of 5 to cap concurrent DB connections, with a re-entrancy guard so a slow tick can't overlap the next.
- **Handlers** (`outbox-handlers.ts`, all idempotent — check-before-act on every side effect since a message may be retried after partial failure):
  - `runPaymentStaffFollowup` / `runCashReceiptFollowup` / `runPaynowApplyFollowup`: generate the receipt PDF if not already generated, create the 2.5% platform-fee receivable if not already created (`hasPlatformReceivableForTransaction`), record agent commission if not already recorded (`hasCommissionLedgerForTransaction`), dispatch the client "payment received" notification + push, notify the agent that their client paid.
  - `runServiceReceiptFollowup`: platform-fee receivable for a service (cash funeral) receipt.

---

## 18. Job Queue

`server/job-queue.ts` — a minimal **in-process** fire-and-forget dispatcher (explicitly documented as swappable for BullMQ/Redis at scale, env `REDIS_URL`, no API contract change needed).

- `enqueueJob(name, data, fn)`: tracked in a bounded ring buffer (`MAX_RECENT = 200`) for observability (`getJobStats()`), concurrency-capped (`JOB_MAX_CONCURRENT`, default 5) with a pending queue capped at `JOB_MAX_PENDING` (default 500) — jobs are **dropped** (logged, not queued) if the pending queue is full, to bound memory under burst load rather than growing unboundedly.
- `drainActiveJobs(timeoutMs)`: waits for in-flight jobs to finish (polling every 100ms) — intended to be called from the SIGTERM handler before `process.exit()` so a deploy/restart doesn't silently drop in-flight work.
- Used by: outbox draining (`requestOutboxDrain`), month-end-run reinstatement notifications, and any other "don't block the HTTP response" background task.

---

## 19. Audit Logging

`auditLog(req, action, entityType, entityId, before, after, orgIdOverride?)` (route-helpers.ts) → `storage.createAuditLog()`.

- Captures `organizationId` (from the request user or an override — used when acting cross-tenant as platform owner), `actorId`/`actorEmail`, `action`, `entityType`, `entityId`, `before`/`after` (arbitrary JSONB snapshots), `requestId`, `ipAddress`.
- **Graceful degradation**: if `organizationId` can't be resolved, the call is skipped with a warning log rather than throwing (never blocks the actual mutation). If the actor's user ID doesn't exist in the **target tenant DB** (a platform owner switching into an isolated tenant they have no local user row in) — a `audit_logs_actor_id_users_id_fk` FK violation — the log is retried once with `actorId: null`, preserving `actorEmail` instead of losing the audit event entirely.
- **Call sites span nearly every mutation workflow covered above**: policy create/update, payment/receipt creation and approval, claim creation/transition, funeral case creation, requisition submit/approve/reject/pay, bulk premium-override updates, legacy group receipt creation, group/legacy receipt approval, attendance approval/rejection, payroll run creation, month-end run completion, directory contact CRUD, terms & conditions changes, and more. The staff UI exposes a searchable/filterable audit viewer (`getAuditLogs` supports free-text search across actor email/action/entity, action filter, date range) backed directly by this table.

---

## Cross-cutting notes

- **Multi-tenancy**: virtually every `storage.ts` method resolves `getDbForOrg(orgId)` first — routes to either the shared registry DB or a dedicated per-tenant Postgres instance (`tenant-db.ts`). Cross-DB user mirroring (`ensureRegistryUserMirroredToOrgDataDb[InTx]`) is a recurring pattern anywhere a dedicated-DB tenant needs to satisfy an FK to `users` for a registry-only user (e.g. platform owner acting cross-tenant, or an agent just referenced by ID for the first time in that tenant).
- **Idempotency is a first-class concern** throughout money-movement code: PayNow intents (idempotency key), PayNow-applied payments (idempotency key `paynow-{intentId}` / `grp-{groupIntentId}-{policyId}` / `credit-apply-{policyId}-{date}` / `MER-{runNumber}-{policyNumber}`), service receipts (`onConflictDoNothing`), outbox messages (`onConflictDoNothing` on dedupe key).
- **The 2.5% platform fee** (`platformReceivables`) is charged uniformly on essentially every cleared premium/service payment channel — PayNow (individual + group), cash/manual receipts, credit-balance auto-apply, month-end run, legacy group receipts, service receipts, approved premium-override/backdated receipts — always computed as `amount × 0.025` and always tagged with a `sourceTransactionId`/`sourceServiceReceiptId` for traceability and de-duplication (`hasPlatformReceivableForTransaction`/`hasPlatformReceivableForServiceReceipt`).


---

# POL263 Architecture Report — Sections 7, 8, 17

Research scope: read-only fact-finding across `shared/schema.ts`, `shared/control-plane-schema.ts`, `server/routes.ts`, `server/storage.ts`, `server/paynow-config.ts`, `server/auth.ts`, `server/client-auth.ts`, `server/index.ts`, `server/object-storage.ts`, `server/constants.ts`, `server/seed.ts`, `server/notifications.ts`, `server/payslip-email.ts`, `shared/validation.ts`, `client/src/pages/staff/settings.tsx`, `client/src/components/feature-flags-card.tsx`, `.env.example`, `SECURITY.md`, and a repo-wide grep for "Falakhe" and related hardcode patterns. No code was modified.

Key architectural context that shapes every recommendation below: the codebase is **mid-migration** from a single-tenant Falakhe deployment to a real multi-tenant SaaS. A `shared/control-plane-schema.ts` (tables: `tenants`, `tenantDomains`, `tenantDatabases`, `tenantStorage`, `tenantIntegrations`, `tenantBranding`, `tenantFeatureFlags`, `backupSyncRuns`) already exists as the intended future home for tenant-scoped config, but as of this snapshot most of it is either unused by server code or duplicated by equivalent columns still living directly on `shared/schema.ts`'s `organizations` table. Several of the control-plane tables (`tenantStorage`, `tenantIntegrations` for WhatsApp/SMS) are schema-only — defined but never queried by `server/`.

---

## SECTION 7 — SETTINGS INVENTORY

### 7.1 Organization / branding settings (`organizations` table, `shared/schema.ts:21-46`)

| Setting Name | Purpose | Current Location | Who Can Edit Today | Risk | Recommended Scope & Rationale |
|---|---|---|---|---|---|
| `organizations.name` | Tenant display name | `organizations` table; edited via `PATCH /api/organizations/:id` (routes.ts:941), UI: settings.tsx Branding tab | `write:organization` perm or platform owner | Low | TENANT — already correctly scoped. |
| `logoUrl` | Company logo shown on portal, PDFs, receipts | `organizations.logoUrl`, default `/assets/logo.png`; upload via `POST /api/upload/logo` (routes.ts:529) | `manage:settings` | Low | TENANT — already correct; default fallback path is a shared static asset, fine as global default only. |
| `signatureUrl` | Signatory signature image for PDFs (policy docs, payslips) | `organizations.signatureUrl`; `POST /api/upload/signature` (routes.ts:542) | `manage:settings` | Low | TENANT — correct today. |
| `primaryColor` | Theme accent color, default `#0d9488` (teal) | `organizations.primaryColor` | `manage:settings` | Low | TENANT — correct. |
| `footerText`, `address`, `phone`, `email`, `website` | Receipt/PDF footer & contact block | `organizations` columns | `manage:settings` | Low | TENANT — correct. |
| `policyNumberPrefix` / `policyNumberPadding` | Format of generated policy numbers (e.g. `FAL-00001`) | `organizations` columns; consumed in `generatePolicyNumber()` (storage.ts:4105-4118) | `manage:settings`, UI in Branding tab | Low | TENANT — correctly configurable; the ONLY number format that is. See 7.4 below — all other number formats (claims, cases, members, employees, requisitions, vouchers) are hardcoded. |
| `isWhitelabeled` | Whether tenant branding fully replaces "POL263" branding across login/splash/sidebar | `organizations.isWhitelabeled` | Platform owner only (settings.tsx:463-466) | Low | TENANT, but edit right correctly restricted to platform owner (business/licensing decision) — keep as is. |
| `databaseUrl` | Points tenant at an isolated Postgres DB instead of the shared DB | `organizations.databaseUrl`; consumed by `server/tenant-db.ts` `getDbForOrg()` | Platform owner only | **Critical** | GLOBAL CONTROL PLANE — this is effectively infrastructure routing, not a "setting"; storing a raw connection string (potentially with credentials) in an app-editable text field editable through the same PATCH endpoint as branding is a risk. Duplicated by `tenantDatabases.databaseUrl` in the control-plane schema — the two need to be reconciled into one source of truth. |
| `paynowIntegrationId` / `paynowIntegrationKey` / `paynowAuthEmail` / `paynowReturnUrl` / `paynowResultUrl` / `paynowMode` | Per-tenant PayNow (Zimbabwe payment gateway) merchant credentials | `organizations` columns, plaintext; UI: settings.tsx Payments tab; resolved by `server/paynow-config.ts::getOrgPaynowConfig()` | `manage:settings`/org admin | **Critical** | TENANT is right scope, but storage must move to `tenantIntegrations.config` (control-plane) **encrypted** with `TENANT_CONFIG_ENCRYPTION_KEY` — right now `paynowIntegrationKey` sits in plaintext in the same row/table as everything else and is returned to the client in `fullOrg` queries (masked client-side only via `showPnKey` UI toggle, not a server-side redaction). See Section 17. |

### 7.2 Sequences / numbering (`shared/schema.ts:64-83`, generators in `server/storage.ts:4104-4181`)

| Setting | Format | Configurable? | Location | Risk | Recommended Scope |
|---|---|---|---|---|---|
| Policy number | `{prefix}{padded n}`, prefix + padding configurable | **Yes** | `organizations.policyNumberPrefix/Padding`, `orgPolicySequences.policyNext` | Low | TENANT (already done) |
| Claim number | Hardcoded `CLM-{6-digit}` | No | `generateClaimNumber()` storage.ts:4119-4128 | Med | TENANT — add `claimNumberPrefix`/padding columns, same pattern as policy number |
| Member number | Hardcoded `MEM-{6-digit}` | No | `getNextMemberNumber()` storage.ts:4129-4138 | Med | TENANT |
| Funeral case number | Hardcoded `FNC-{6-digit}` | No | `generateCaseNumber()` storage.ts:4139-4148 | Med | TENANT |
| Employee number | Hardcoded `EMP-{5-digit}` | No | `generateEmployeeNumber()` storage.ts:4150-4159 | Low | TENANT |
| Requisition number | Hardcoded `REQ-{5-digit}` | No | `generateRequisitionNumber()` storage.ts:4161-4170 | Low | TENANT |
| Payment voucher number | Hardcoded `PV-{5-digit}` | No | `generateVoucherNumber()` storage.ts:4172-4181 | Low | TENANT |
| Legacy group receipt number | Hardcoded `LGR-{yyyymmdd}-{3-digit}` | No | inline in routes.ts:7414-7416 | Low | TENANT |
| Quotation / mortuary / disbursement sequences | Counters exist (`orgPolicySequences.quotationNext`, `mortuaryNext`, etc.) | Prefix hardcoded per call site | `orgPolicySequences` table | Low | TENANT |

All sequence counters ARE already per-org (`org_member_sequences`, `org_policy_sequences` both keyed by `organizationId`, atomic via `ON CONFLICT ... DO UPDATE`) — good multi-tenant hygiene at the counter level. The gap is purely that prefixes/padding for everything except policy numbers are string-literal in code, so every tenant gets identically-formatted claim/case/member/employee/requisition/voucher numbers regardless of their own numbering convention.

### 7.3 Currency / exchange rates

| Setting | Location | Editable? | Risk | Recommended Scope |
|---|---|---|---|---|
| `SUPPORTED_CURRENCIES = ["USD","ZAR","ZIG"]` | `shared/validation.ts:11` | **No — hardcoded constant**, duplicated at `server/routes.ts:8175` (`const CURRENCIES = [...]`) and re-declared inline as UI dropdown options in ≥8 client files (`receipt-drawer.tsx:243`, `claims.tsx:472`, `finance.tsx:917/962/1020/2248`, `funerals.tsx:841`, `groups.tsx:767`, `reports.tsx:327`, `transactions/debit-orders.tsx:172`) | Med-High | GLOBAL CONTROL PLANE default list + TENANT override — a tenant outside Zimbabwe/South Africa (the only 2 currencies plus USD supported) cannot transact in any other currency without a code change. Should become a `tenant_currencies` table (or reuse `fxRates.currency` as the source of truth for allowed currencies) with USD/ZAR/ZIG as seed defaults, not a compiled-in enum. |
| `CURRENCY_CONFIG` (symbol/name/locale per currency) | `shared/validation.ts:14-18` | No | Med | Same as above — move symbol/locale metadata to the same per-tenant currency table. |
| `normalizeCurrency()` special-casing `ZWL`/`RTGS` → `ZIG` | `shared/validation.ts:24-29` | No | Low | Zimbabwe-specific historical-currency alias logic; harmless as a normalization helper but confirms the currency model was built for one country. |
| FX / exchange rates (rate to USD) | `fxRates` table — **already per-org** (`shared/schema.ts:2126-2137`, unique on `organizationId + currency`); `GET/PUT /api/fx-rates` (routes.ts:5690-5703), gated by `manage:settings` | Yes, per tenant | Low | TENANT — this one is done correctly and is a good model for how currency lists should also work. |

### 7.4 Branding — control-plane duplication

`shared/control-plane-schema.ts:158-174` defines a **second** `tenantBranding` table (logoUrl, signatureUrl, primaryColor, footerText, address, phone, email, website, policyNumberPrefix, policyNumberPadding, isWhitelabeled) that exactly duplicates fields already on `organizations`. Nothing in `server/routes.ts` or `server/storage.ts` was found querying `tenantBranding` — it appears to be a planned-but-unused future home for this data in the control-plane DB, while the actual live code path still reads/writes `organizations` in the (shared or per-tenant) app DB. This split needs to be resolved (single source of truth) before going fully multi-tenant, otherwise branding could drift between the control plane and the tenant DB the app actually renders from.

### 7.5 Payment gateway / integrations

| Setting | Location | Scope Today | Risk | Recommendation |
|---|---|---|---|---|
| PayNow (`PAYNOW_INTEGRATION_ID/KEY/RETURN_URL/RESULT_URL/MODE`, `PAYMENTS_PAYNOW_ENABLED`) | `.env.example`; `server/paynow-config.ts::platformConfig()` | GLOBAL (env) fallback, overridden per-tenant via `organizations.paynow*` columns if set | **Critical** if key leaked | Already has a working per-tenant override mechanism (`getOrgPaynowConfig`) — good. Needs encryption at rest (see 7.1) and migration into `tenantIntegrations` (schema already modeled for this, provider `"paynow"`, plus future `"stripe"`). |
| Stripe | Modeled as a `provider` value in `tenantIntegrations.provider` comment (control-plane-schema.ts:119) | **Not implemented** — no server code found wiring Stripe | N/A | Confirm as future work in the report; currently vaporware. |
| WhatsApp Cloud API (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) | `.env.example` documents these as "per-tenant config lives in control plane — fallback/dev only", `tenantIntegrations` provider `"whatsapp_cloud"` modeled | **Not implemented** — no matches for `whatsapp` in `server/*.ts` outside comments/docs; `tenantFeatureFlags` even lists a `whatsapp_notifications` flag that has nothing behind it | N/A (schema-only) | Note explicitly in the architecture report: WhatsApp is speced but not built. When built, must be per-TENANT (`tenantIntegrations`), never global, since each tenant needs its own WhatsApp Business number. |
| SMS (BulkSMS / Twilio) (`SMS_PROVIDER`, `SMS_API_TOKEN`, `SMS_SENDER_ID`) | `.env.example`; `tenantIntegrations` providers `sms_bulksms`/`sms_twilio` modeled | **Not implemented** — no `Twilio`/`sms` sending code found in `server/` | N/A (schema-only) | Same as WhatsApp — absent today, must be TENANT-scoped when built. |
| Firebase | Not referenced anywhere in `server/` (push notifications use `clientDeviceTokens`/`userDeviceTokens` tables, presumably APNs/FCM tokens stored generically) | **Absent** — no Firebase Admin SDK config found | N/A | Confirm as absent in report. If push notifications are sent via FCM, credentials would need to be GLOBAL CONTROL PLANE (one Firebase project can serve many tenants via topics) or TENANT if each tenant needs its own Firebase project — flag as an open design question. |
| DigitalOcean Spaces / S3 object storage (`DO_SPACES_ENDPOINT/REGION/BUCKET/KEY/SECRET`, `DO_SPACES_CDN_URL`) | `.env.example`; `server/object-storage.ts:8-39` reads only `process.env.*` | **GLOBAL only** — single bucket/credentials for the entire platform; uploads for all tenants land in the same bucket | Med (blast radius: one leaked key exposes every tenant's documents) | `tenantStorage` (control-plane-schema.ts:98-111) already models a per-tenant `bucket`/`accessKeyId`/`prefix` override with fallback to the shared bucket via `tenants/{tenantId}/` path prefix — but **this table is not wired into `server/object-storage.ts`** at all; only path-prefixing by tenant ID inside the one shared bucket exists in the design, not the code. Recommend: implement path-prefix isolation now (cheap, high value) as an interim step; true per-tenant bucket/credentials later. |
| SMTP email (`SMTP_HOST/PORT/SECURE/USER/PASS`, `EMAIL_FROM`) | `.env.example`; `server/payslip-email.ts:13-55` reads only `process.env.*` | **GLOBAL only** | Med | Used today only for payslip delivery (internal, staff-facing) — lower urgency than customer-facing channels, but still: one SMTP account sends mail "from" every tenant. Recommend TENANT-scoped SMTP (or at minimum a per-tenant `EMAIL_FROM`/display name) before this is used for client-facing notifications. |
| Encryption key for tenant secrets (`TENANT_CONFIG_ENCRYPTION_KEY`) | `.env.example`; referenced only in comments (`control-plane-schema.ts:110,131`) — **no code found that actually encrypts/decrypts using it yet** | GLOBAL (necessarily — it's the root key) | High if the referenced encryption layer isn't actually implemented yet, since `tenantIntegrations.config` comment (control-plane-schema.ts:131) says "Phase 1: plaintext" | Confirm in the report whether Phase 2 (AES-256-GCM) has landed; as of this snapshot it appears not to have (no crypto code found referencing this env var). |

### 7.6 RBAC / permissions & roles

| Item | Location | Configurable? | Risk | Recommended Scope |
|---|---|---|---|---|
| Permission catalog (`SYSTEM_PERMISSIONS`, ~65 entries) | Hardcoded array, `server/constants.ts:27-82` | No — fixed in code | Low | GLOBAL CONTROL PLANE — a platform-wide permission catalog is correct; permissions are code capabilities, not business data, so this is the right scope as-is. |
| Default role → permission templates (`ROLE_PERMISSION_MAP`: superuser, executive, manager, administrator, cashier, agent, claims_officer, fleet_ops, driver, mortuary_attendant, staff) | Hardcoded, `server/constants.ts:84-153` | Only consumed at org-provisioning time (`routes.ts:1009`, iterated per new org) to seed that org's `roles`/`role_permissions` rows | Low | GLOBAL CONTROL PLANE as a *seed template*, but each tenant's actual `roles`/`role_permissions` rows are already TENANT-scoped (`roles.organizationId`, `shared/schema.ts:116-127`) and independently editable per tenant via the RBAC tab + "Sync Permissions" (`POST /api/admin/sync-permissions`, routes.ts:9186). This is the correct pattern; no change needed beyond documenting it. |
| Per-user permission overrides | `userPermissionOverrides` table (`shared/schema.ts:168-181`) | Yes, per user | Low | USER — correctly scoped already. |
| Role scoping to branch | `userRoles.branchId` (`shared/schema.ts:152-166`) | Yes | Low | BRANCH — correctly scoped already. |

### 7.7 Notification templates

`notificationTemplates` (`shared/schema.ts:1902-1921`) is **already fully TENANT-scoped** (`organizationId` NOT NULL, unique per org), versioned (`version`, `effectiveFrom`), supports multiple channels (`channel` default `in_app`), and is editable via `GET/POST/PUT/DELETE /api/notification-templates` (routes.ts:5571-5599) gated by `read:notification`/`write:notification`. This is a good existing pattern — no gap found here, aside from the fact that the actual send-channels behind it (WhatsApp/SMS, 7.5 above) don't exist yet, so today templates can only be used for the `in_app` and (via `payslip-email.ts`) direct SMTP-email channels.

### 7.8 Feature flags

| Flag | Location | Scope | Risk | Recommendation |
|---|---|---|---|---|
| `newNav`, `globalSearch`, `commandPalette`, `quickCreate`, `commandCenters` | `client/src/components/feature-flags-card.tsx:7-13`, backed by `@/lib/flags` (`useFlag`/`setFlag`) | **Per-browser localStorage only** — not server-side, not per-user, not per-tenant | Low (UX-only toggles, no security implication) but architecturally inconsistent | These are pure client opt-in toggles for a UX migration, unrelated to `tenantFeatureFlags` (control-plane-schema.ts:182-195) which models `claims_enabled`, `mobile_payments`, `agent_portal`, `whatsapp_notifications` as true per-TENANT feature flags. The two systems should be named/documented distinctly in the report — "experience flags" (USER/browser scope, self-service) vs. "tenant feature flags" (TENANT scope, admin/platform-controlled, currently **schema-only, no route or storage method found wiring `tenantFeatureFlags` into any read path**). |
| `tenantFeatureFlags` (`claims_enabled`, `mobile_payments`, `agent_portal`, `whatsapp_notifications`) | `control-plane-schema.ts:182-195` | Modeled as TENANT, but **not read anywhere in `server/`** (no matches found) | N/A | Confirm as unused/aspirational in the report. |

### 7.9 Security questions

`securityQuestions` table (`shared/schema.ts:185-190`) has an optional `organizationId` (nullable — implies both global default questions and org-specific ones are possible), seeded from `DEFAULT_SECURITY_QUESTIONS` at org creation (`server/seed.ts:94-99`). TENANT scope with a GLOBAL CONTROL PLANE default set is the right existing model.

### 7.10 Backup settings

| Setting | Location | Scope | Risk |
|---|---|---|---|
| `SUPABASE_BACKUP_URL` | `.env.example`; `server/backup-sync.ts:31,164-166` | **GLOBAL** — one nightly backup destination for the whole platform (all tenants' data mirrored into one Supabase project) | Med — acceptable for a single-tenant-shared-DB deployment, but once tenants have isolated DBs (`organizations.databaseUrl` set), `server/backup-sync.ts:278` shows the sync loop iterates "TENANT DBS (Falakhe + any future isolated tenants)" and backs each one up to the *same* shared Supabase destination — meaning disaster-recovery data for different tenants co-mingles in one non-primary datastore. Recommended: GLOBAL CONTROL PLANE (the platform operator legitimately needs one DR story), but flag the co-mingling as a data-residency/compliance question if tenants ever require data isolation guarantees. |
| Backup run history | `backupSyncRuns` (control-plane-schema.ts:204-214) | GLOBAL (platform-wide operational log, correctly scoped as such — explicitly commented "not tenant data") | Low | Correct as-is. |

### 7.11 Scale / ops tuning (all GLOBAL by nature — process-level env vars)

`DB_POOL_MAX`, `MAX_TENANT_POOLS`, `DASHBOARD_MAX_ROWS`, `REPORT_EXPORT_MAX_ROWS`, `JOB_MAX_CONCURRENT`, `JOB_MAX_PENDING`, `DB_ACCEPT_SELF_SIGNED` — all `.env.example`, single-process tuning knobs. Correctly GLOBAL/SYSTEM scope; no per-tenant meaning would make sense for most of these except perhaps `DASHBOARD_MAX_ROWS`/`REPORT_EXPORT_MAX_ROWS` if usage tiers are ever introduced (e.g., a "Pro" tenant gets higher export limits) — flagged as a possible future TENANT override, not a current gap.

### 7.12 Full `.env.example` inventory with scope classification

| Variable | Purpose | Current Scope | Should Be |
|---|---|---|---|
| `NODE_ENV`, `PORT` | Runtime mode / listen port | GLOBAL | GLOBAL (correct) |
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | Shared/default tenant DB connection | GLOBAL | GLOBAL, but per-tenant overrides already exist via `organizations.databaseUrl` / `tenantDatabases` — fine as a default. |
| `CONTROL_PLANE_DATABASE_URL`, `CONTROL_PLANE_DIRECT_URL` | Control-plane DB connection | GLOBAL | GLOBAL (correct — there is only one control plane) |
| `FALAKHE_DATABASE_URL`, `FALAKHE_DIRECT_URL` | The one real tenant's isolated DB | GLOBAL env var **named after a specific customer** | Should not exist as a named env var at all once multi-tenant; belongs entirely in `tenantDatabases` rows. This is the clearest example of single-tenant residue in configuration. |
| `SUPABASE_DATABASE_URL`, `SUPABASE_HOST`, `SUPABASE_PASSWORD` | One-time migration source | GLOBAL, migration-only | Fine as a dev/ops-only var; should be removed after migration completes per its own comment. |
| `SESSION_SECRET` | Express session signing key | GLOBAL | GLOBAL (correct — session infra is platform-wide) |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_CALLBACK_URL`, `APP_BASE_URL` | Staff Google OAuth app registration | **GLOBAL** — one Google OAuth app for every tenant's staff | Likely acceptable if all tenants are OK authenticating through one shared Google OAuth client (common SaaS pattern, Google restricts by Workspace domain elsewhere) — but flag as a decision point: if tenants want their *own* Google Workspace / OAuth client, this needs to move to TENANT (`tenantIntegrations` or similar). |
| `PAYNOW_*`, `PAYMENTS_PAYNOW_ENABLED` | Platform fallback PayNow merchant | GLOBAL fallback, TENANT override exists | Already has the right layered model (7.5). |
| `RECEIPT_ISSUER_NAME`, `RECEIPT_FOOTER_TEXT` | Fallback receipt branding text | GLOBAL — **duplicates** `organizations.footerText`/`name` | Should be removed once every tenant has branding rows populated; currently redundant global fallback for what is otherwise a TENANT setting. |
| `APP_BASE_DOMAIN` | Base domain for subdomain tenant routing (e.g. `pol263.app`) | GLOBAL | GLOBAL (correct — the platform only has one apex domain; per-tenant custom domains are separately modeled via `tenantDomains`). |
| `TENANT_CONFIG_ENCRYPTION_KEY` | Encrypts tenant secrets in control plane | GLOBAL (root key, necessarily) | GLOBAL (correct by definition), but see 7.5 — implementation appears incomplete. |
| `DO_SPACES_*` | Object storage credentials | GLOBAL only | Should support TENANT override per `tenantStorage` model (not yet wired — 7.5). |
| `SMTP_*`, `EMAIL_FROM` | Outbound email | GLOBAL only | Should become TENANT for client-facing notification email (7.5). |
| `WHATSAPP_*`, `SMS_*` | Messaging channel credentials | GLOBAL fallback documented, TENANT intended via `tenantIntegrations` | Not implemented at all yet (7.5). |
| `DB_POOL_MAX`, `MAX_TENANT_POOLS`, `DASHBOARD_MAX_ROWS`, `REPORT_EXPORT_MAX_ROWS`, `JOB_MAX_CONCURRENT`, `JOB_MAX_PENDING` | Scale tuning | GLOBAL | GLOBAL (correct) — see 7.11 |
| `PLATFORM_OWNER_MFA_ENFORCED` | Suppresses a startup warning once the platform owner's Google Workspace account has MFA turned on externally | GLOBAL | GLOBAL (correct — there's exactly one platform owner) — but note this is not actual MFA *enforcement* in-app, just a self-attested flag (see Section 17). |
| `DB_ACCEPT_SELF_SIGNED` | TLS trust setting for managed Postgres | GLOBAL | GLOBAL (correct) |
| `SUPABASE_BACKUP_URL` | Nightly DR backup destination | GLOBAL | GLOBAL, with the co-mingling caveat noted in 7.10 |

---



---

## SECTION 8 — HARDCODED COMPANY LOGIC

Grep for `falakhe` (case-insensitive) across `client/`, `server/`, `shared/`, migrations, and `scripts/` returned 62 files. The overwhelming majority (≈45 files) are one-off operational scripts in `scripts/` and `script/` (e.g. `fix-falakhe-paynow-urls.mjs`, `check-falakhe-groups.mjs`, `migrate-falakhe-data.ts`, `setup-fresh-with-falakhe.ts`) that exist specifically to migrate/repair the real Falakhe tenant's data during the platform's build-out — these are legitimate one-time ops tooling, not application logic, and were excluded from the table below (they don't run in the served app). The table covers hits that are **inside runtime application code, comments describing runtime behavior, or config that ships with the app**.

| Location | What's Hardcoded | Category | Why It's a Problem | Recommended Fix |
|---|---|---|---|---|
| `agent-app/src/config.ts:2-4` | `API_BASE` for the Agent mobile app hardcodes `"https://falakhe.pol263.com"` as the production API base URL | name / infrastructure | The compiled Agent mobile app (Android/iOS via Capacitor) will **only ever talk to the Falakhe tenant's subdomain** in production, regardless of which tenant's staff installed it. Any other tenant's agents cannot use this app build at all today. | Build the app per-tenant with the tenant's subdomain injected at build time (already partially supported via `CAPACITOR_SERVER_URL`, per `capacitor.config.ts:3-7`), or make the app prompt for / discover the tenant subdomain at first launch instead of compiling one in. |
| `server/constants.ts:19` and `server/seed.ts:101` | Fallback default `SUPERUSER_EMAIL` of `"ausiziba@gmail.com"` (the developer's personal Gmail) when the env var is unset | contact / identity | Only applies when `NODE_ENV !== "production"` (production throws instead, per `constants.ts:13-17`), so blast radius is limited to dev/staging — but it is a specific person's real email compiled into the shipped source, which `SECURITY.md:20` explicitly claims does NOT happen ("This email is NOT hardcoded in the source code"). The claim is true for production but not for the dev/seed fallback path. | Use a clearly fake placeholder (`dev-owner@localhost` or similar) as the dev fallback instead of a real personal address, to keep the code and `SECURITY.md` claim consistent in every environment. |
| `client/src/pages/staff/notifications.tsx:306-310` and `server/notifications.ts:23` | Merge-tag preview/example text hardcodes `"Falakhe Funeral"` as the sample `{org_name}` value | template / example text | Cosmetic only — it's example/preview text shown to admins editing a notification template, not data sent to real clients. Low risk, but confusing branding leakage: a non-Falakhe tenant's admin sees a competitor/predecessor company's name in the template editor preview. | Use a generic placeholder like `"Acme Insurance"` or interpolate the *current* tenant's real `organizations.name` into the preview instead. |
| `package.json:28-39` | npm scripts `db:push:falakhe`, `db:migrate:falakhe`, `db:cp:set-falakhe-db`, `db:setup:falakhe` | tooling / business-rule | Build tooling permanently named after one customer; harmless to runtime but signals the codebase still treats "Falakhe" as a first-class special case rather than "a tenant" in its own tooling vocabulary. | Rename to generic tenant-migration scripts parameterized by tenant slug/env var once the migration to full multi-tenancy is complete; keep Falakhe-specific ones only in a clearly labeled one-off ops folder if still needed historically. |
| `drizzle.falakhe.config.ts` (repo root) | A dedicated Drizzle config file whose entire purpose is targeting the Falakhe tenant's isolated DB | infrastructure | Same issue as above — per-tenant DB migration tooling is name-specific rather than parameterized (e.g. `drizzle.tenant.config.ts --tenant=falakhe`). `drizzle.tenant.config.ts` already exists alongside it, suggesting the generic version is the intended long-term replacement. | Consolidate onto the generic `drizzle.tenant.config.ts` (already present) driven by an env var / CLI arg for which tenant DB to target. |
| `server/backup-sync.ts:7-9,41,278` (comments only) | Comments describe the three DBs as "pol263 (shared)", "pol263-control-plane", and **"pol263-falakhe (+ any future tenant DBs)"** | naming / documentation | Comments, not logic — but they reveal the backup-sync code was written and tested against exactly one real tenant DB; worth an explicit pass once a second isolated-DB tenant exists to confirm the loop at line 278 (`TENANT_FULL_SYNC_TABLES`) generalizes correctly rather than being tuned for Falakhe's specific table set. | No code change required now; flag for regression testing when tenant #2 gets an isolated DB. |
| `shared/validation.ts:7` `NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/` | Zimbabwean national ID format (digits + check letter + 2 digits) is the **only** supported ID format, applied via `isValidNationalId()`/`normalizeNationalId()` used across client capture flows | business-rule / country-specific | Any tenant operating outside Zimbabwe (or any client without a Zimbabwean ID — e.g. a foreign national, or a future South African/other-country tenant) cannot pass ID validation. This is domain logic masquerading as a generic "national ID" concept but is really "Zimbabwean national ID." | Make ID format validation configurable per tenant/country (e.g. a `nationalIdFormat` regex or a country code on `organizations`, with Zimbabwe's format as the default/seed value). |
| `shared/validation.ts:11,14-18` `SUPPORTED_CURRENCIES`/`CURRENCY_CONFIG` | Currency list limited to USD/ZAR/ZIG, each with hardcoded symbol/locale | currency | Already covered in Section 7.3 as a settings gap; listed here too because it is also a hardcoded-business-assumption (Zimbabwe/South Africa multi-currency cash economy) baked into shared validation code rather than tenant config. | See Section 7.3 recommendation — per-tenant currency table. |
| `shared/validation.ts:28` `if (upper === "ZWL" || upper === "RTGS") return "ZIG"` | Historical Zimbabwean currency renaming (ZWL bond notes / RTGS dollars → ZiG) hard-baked as an alias | business-rule / country-specific | Reasonable as a *migration* helper for Zimbabwe's actual currency history, but it's dead weight/confusing for any tenant that never touched ZWL/RTGS. Not dangerous, just non-portable. | Move this alias table into Zimbabwe-specific seed/tenant config rather than the shared generic currency normalizer. |
| Funeral-domain vocabulary (`mortuary`, `casket`, `next of kin`, `chapel`, `wash bay`, etc.) across `shared/schema.ts` (e.g. `mortuaryIntakes`, `bodyWashRequirements`, `chapelWashBayFeeCurrency` line 1402) and PDF/UI templates | — | **Not flagged as a problem** per task instructions — this is legitimate funeral-industry domain vocabulary, appropriate as long as the *product catalog* (which products/services a tenant offers) stays configurable per tenant rather than assuming every tenant is a funeral parlour. Confirmed elsewhere in the schema that `products`/`productVersions` are already tenant-defined catalogs, so the domain vocabulary is fine; only the underlying *table names* (e.g. `mortuaryIntakes`) are funeral-specific, which is an acceptable modeling choice for a vertical SaaS, not a bug. | No action — included here only to explicitly confirm it was reviewed and correctly not flagged. |

No hardcoded organization-ID UUID special-casing (e.g. `if (organizationId === '<uuid>')`) was found anywhere in `.ts`/`.tsx` source (grep for `organizationId === '...'` / UUID literal comparisons returned only a generic query-param variable declaration, not a real special case) — this is a genuinely clean result worth noting positively in the report: business logic branches are not secretly gated to one tenant's ID.

---



---

# Section 9 — Multi-Tenancy Readiness

## 9.0 Where POL263 actually stands

POL263 is **mid-transformation, not pre-transformation**. A control plane (`shared/control-plane-schema.ts`, a physically separate `pol263-control-plane` Postgres database) already exists and its Phase 1 ("Control Plane Extraction") is marked **complete** per `docs/REFACTOR-PROGRESS.md` (dated 2026-04-14, the most recent dated doc in the repo): tenant registry (`tenants`), domain routing (`tenant_domains`), per-tenant DB routing (`tenant_databases`), and a real isolated-DB tenant (Falakhe, fully migrated off Supabase). Every one of the ~103 tables in the main schema is either `organization_id`-scoped (≈90 tables), a handful of explicitly-documented global/hybrid tables, or transitively scoped through a parent FK. This is a materially better starting point than a typical "single-tenant app that needs retrofitting" — the punch list below is about **finishing** an already-well-shaped migration, not starting one.

REFACTOR-PROGRESS.md's own roadmap: Phase 1 (control plane extraction) done; **Phase 2 (payment/integration provider abstraction) not started**; **Phase 3 (remaining tenant DB isolation) not started**; **Phase 4 (tenant-aware queue/worker architecture) not started**. Everything below is consistent with — and adds concrete, code-verified detail to — that self-assessment.

## 9.1 Punch list (severity-ordered)

| # | Severity | Issue | Where | Fix direction |
|---|---|---|---|---|
| 1 | **Critical** | Platform's own revenue (the 2.5% `platform_receivables` fee) is tracked **per-tenant, inside each tenant's own database**, with no control-plane aggregate. POL263 (the vendor) has no single query/dashboard showing "how much do all my tenants owe me combined" — it must switch into each tenant individually. Compounding this: `isSettled` is **never set to `true` anywhere in the codebase** (verified: only write sites are `isSettled:false`; the only other reference is a `WHERE isSettled=true` read filter), and the `settlement_allocations` join table is imported but never used — so even the per-tenant "Outstanding" figure is permanently wrong (always = full lifetime total, since nothing ever marks anything settled). | `shared/schema.ts` (`platformReceivables`, `settlements`, `settlementAllocations`), `server/routes.ts` `/api/settlements/:id/approve` | This is the single highest-value fix for the platform's own business viability: (a) wire settlement approval to actually flip `isSettled`/populate `settlement_allocations`, (b) move platform-revenue aggregation into the control plane (a cross-tenant read, or a denormalized rollup table updated by the outbox handlers) so POL263 has one source of truth for its own AR. |
| 2 | **Critical** | Two parallel "per-tenant config" systems coexist for the *same* settings. `organizations` (main schema, co-located with tenant data) already holds live, working per-tenant branding + PayNow credentials + policy numbering. `shared/control-plane-schema.ts`'s `tenantBranding` and `tenantIntegrations` model the *same* data in the control plane — but nothing in `server/routes.ts`/`storage.ts` reads or writes `tenantBranding`/`tenantIntegrations` at all. Worse, `tenantBranding.policyNumberPadding` is typed **text**, while `organizations.policyNumberPadding` is typed **integer** — the two schemas have already drifted in shape, not just in wiring. | `shared/schema.ts` vs `shared/control-plane-schema.ts` | Pick one source of truth per setting (this report recommends: keep `organizations` live for now, since it's the one actually serving traffic; either delete the unused control-plane duplicates or commit to REFACTOR-PROGRESS.md Phase 2 and migrate deliberately, not let both exist silently). |
| 3 | **Critical** | PayNow, and every other payment/messaging integration, is still configured via **global env vars** (`PAYNOW_INTEGRATION_ID/KEY`, `WHATSAPP_*`, `SMS_*`) as the primary/fallback path, even though a per-tenant override already exists for PayNow (`organizations.paynow*` columns) and is unencrypted in that table. `tenantIntegrations` (control-plane, designed for exactly this, with an explicit "Phase 2: AES-256-GCM encryption" comment) is schema-only — zero call sites in `server/`. | `.env.example`, `server/paynow-config.ts`, `shared/control-plane-schema.ts:tenantIntegrations` | This is precisely REFACTOR-PROGRESS.md's own **Phase 2**, already scoped: `PaymentAdapter`/`PaynowAdapter`/`StripeAdapter` interfaces, `WhatsAppAdapter`/`SMSAdapter`, an `integration-loader.ts`, encryption via `TENANT_CONFIG_ENCRYPTION_KEY`. Treat as the next concrete milestone, not a new idea. |
| 4 | **High** | Cross-tenant data leakage: `storage.getGroup(id, orgId)` / `updateGroup(id, data, orgId)` use `orgId` only to select the DB connection, **not** in the `WHERE` clause (unlike `getClient`/`getPolicy`/`getClaim`, which correctly do `and(eq(id), eq(organizationId))`). On the **shared** database (any tenant without an isolated DB), a guessed/enumerated group UUID from another tenant returns real row data. Route-layer checks partially mitigate this (`PATCH /api/groups/:id` re-checks org ownership before writing), but `GET /api/groups/:id/policies`, `GET /api/groups/:id/receipts`, and `POST /api/groups/legacy-receipts` only check `if (!group) 404` — an existence/enumeration leak at minimum. | `server/storage.ts` `getGroup`/`updateGroup` | Add `eq(groups.organizationId, orgId)` to both WHERE clauses, matching the established pattern elsewhere. Then do the broader follow-up already flagged in the security review: grep every `storage.ts` function taking an `orgId` param and confirm it's in the WHERE, not just used to pick a pool. |
| 5 | **High** | The Agent mobile app (Capacitor/Android) hardcodes `API_BASE = "https://falakhe.pol263.com"` at `agent-app/src/config.ts:2-4`. Every compiled Agent app build talks to exactly one tenant's subdomain in production — no other tenant's agents can use this app at all today. | `agent-app/src/config.ts` | Build per-tenant with the subdomain injected at build time (`CAPACITOR_SERVER_URL` already partially supports this per `capacitor.config.ts`), or have the app discover/prompt for tenant subdomain at first launch. |
| 6 | **High** | Numbering formats: only **policy numbers** are tenant-configurable (`organizations.policyNumberPrefix/Padding`). Claim, member, funeral-case, employee, requisition, and payment-voucher numbers are all hardcoded string literals (`CLM-{6-digit}`, `MEM-{6-digit}`, `FNC-{6-digit}`, `EMP-{5-digit}`, `REQ-{5-digit}`, `PV-{5-digit}`) in `server/storage.ts`. Every tenant gets identical formats for everything except policies, regardless of their own numbering conventions. The underlying atomic-counter mechanism (`orgPolicySequences`, one row per org with 10 independent counters) is already correctly per-tenant — only the prefix/padding text is not exposed as config. | `server/storage.ts:4104-4181` | Add prefix/padding columns to `organizations` (or the eventual control-plane branding table) for each number type, same pattern as `policyNumberPrefix/Padding`. Low-risk, mechanical, and the counter infrastructure is already there. |
| 7 | **High** | Currency list (`SUPPORTED_CURRENCIES = ["USD","ZAR","ZIG"]`, `shared/validation.ts:11`) and per-currency symbol/locale metadata are **hardcoded constants**, duplicated inline in ≥8 client files' dropdown options. A tenant operating outside Zimbabwe/South Africa cannot transact in any other currency without a code change — this is the single clearest "built for one country" artifact in the business-logic layer. Contrast with `fxRates`, which **is** already correctly per-org. | `shared/validation.ts:11-18`, 8+ client files | Move to a `tenant_currencies` table (or extend `fxRates` to double as the source of truth for which currencies a tenant supports), seeded with USD/ZAR/ZiG as defaults — mirroring the FX-rate table's already-correct pattern. |
| 8 | **High** | National ID validation (`NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/`, `shared/validation.ts:7`) accepts **only** the Zimbabwean national-ID format. Any tenant outside Zimbabwe, or any client without a Zimbabwean ID, fails validation entirely. | `shared/validation.ts:7` | Make ID format configurable per tenant/country (e.g. a `nationalIdFormat` regex or ISO country code on `organizations`), Zimbabwe's format as the seed default. |
| 9 | **Medium** | Object storage (DigitalOcean Spaces) and outbound SMTP email are both **global-only** — one bucket/credential set and one SMTP account serve every tenant. `tenantStorage` (control-plane) already models a per-tenant bucket/prefix override with fallback to `tenants/{tenantId}/` path-prefix isolation in the shared bucket, but it is **not wired into `server/object-storage.ts`** — only global env vars are read there today. SMTP is currently used only for internal payslip delivery (lower urgency), but would need to become tenant-scoped before use for client-facing notifications. | `server/object-storage.ts`, `server/payslip-email.ts`, `.env.example` | Interim, cheap fix: implement the path-prefix isolation that's already designed (`tenants/{tenantId}/...` inside the one shared bucket) even before true per-tenant credentials. SMTP: at minimum a per-tenant `EMAIL_FROM`/display name before any client-facing email feature ships. |
| 10 | **Medium** | Backup/DR: `server/backup-sync.ts` mirrors the shared registry DB, the control-plane DB, **and every tenant DB (isolated or shared)** into **one** consolidated Supabase backup destination. Disaster-recovery data for different tenants co-mingles in one non-primary datastore. Acceptable today (single real isolated tenant), but a data-residency/compliance question the moment a second tenant requires isolation guarantees for its own DR copy too. | `server/backup-sync.ts:278` (`TENANT_FULL_SYNC_TABLES` loop) | Flag as an explicit compliance decision point before onboarding any tenant with data-residency requirements; consider per-tenant backup destinations as an option, not a default. |
| 11 | **Medium** | `TENANT_CONFIG_ENCRYPTION_KEY` is referenced only in comments (`control-plane-schema.ts`) — no code found that actually performs AES-256-GCM encrypt/decrypt using it. `tenantIntegrations.config`'s own comment says "Phase 1: plaintext" — meaning any secret written there today (once wired up) would be stored unencrypted, same as the current plaintext `paynowIntegrationKey` on `organizations`. | `shared/control-plane-schema.ts` comments | Bundle with punch-list item 3 (Phase 2 integration abstraction) — don't wire `tenantIntegrations` into production traffic before the encryption layer actually exists. |
| 12 | **Medium** | RBAC: `roles` are already **per-organization rows** (good — an org's own "manager" role can be independently edited via `role_permissions` without touching any other tenant's manager role), seeded from a single hardcoded `ROLE_PERMISSION_MAP` template (`server/constants.ts`). This is architecturally correct multi-tenancy, but means the **permission matrix in Section 13 reflects only the seed defaults** — nothing in the runtime prevents any tenant admin from later editing their own org's `role_permissions` away from that template, so the matrix can silently drift per-tenant over time with no central visibility into which tenants have diverged. | `server/constants.ts`, `shared/schema.ts:roles/rolePermissions` | Not a bug, but worth a "config drift" dashboard/report in the control plane if divergence-tracking ever matters to support/compliance. |
| 13 | **Medium** | Branch-scoping exists as a data model (`userRoles.branchId`, `users.branchId`) but is **not enforced** in `getUserEffectivePermissions()` or any generic guard — it's carried through as descriptive/reporting metadata (many report endpoints accept an optional `?branchId=` filter) rather than an access-control boundary. Not strictly a multi-tenancy issue (it's an intra-tenant scoping gap) but adjacent enough to flag here since it affects how confidently a tenant with multiple branches can rely on data segregation between its own branches. | `server/route-helpers.ts`, `server/storage.ts:getUserEffectivePermissions` | A full per-route audit is needed before claiming branch-level isolation; not asserted as broken, flagged as unverified. |
| 14 | **Low** | Schema drift between tenant databases is an **acknowledged, actively-patched** operational risk — migrations 0051 and 0054 are explicitly defensive `ADD COLUMN IF NOT EXISTS` re-adds for tenant DBs "whose migration history was seeded from a snapshot rather than replayed" (per migration comments). This is already being managed, not ignored, but is evidence that Phase 3 (remaining tenant DB isolation) will need a robust migration-consistency story before scaling past 1-2 isolated tenants. | `migrations/0051_*.sql`, `migrations/0054_*.sql` | Formalize a migration-verification step (e.g. `db:migrate:status` — which already exists per CLAUDE.md's command list — run automatically before/after any tenant DB provisioning) rather than relying on ad hoc defensive migrations after the fact. |
| 15 | **Low** | Client-side "feature flags" (`newNav`, `globalSearch`, `commandPalette`, `quickCreate`, `commandCenters` in `client/src/components/feature-flags-card.tsx`) are **per-browser localStorage only** — not server-side, not per-tenant. This is a distinct, correctly-scoped-for-its-purpose system (self-service UX opt-in), but is easily confused with `tenantFeatureFlags` (control-plane, per-tenant, currently unread by any server code) and with the *nonexistent* generic `feature_flags` table some older internal docs (MEGA-PROMPT.md) describe. All three are different things; only `tenantFeatureFlags` is genuinely tenant-scoped infrastructure, and it is not yet wired to gate anything. | `client/src/components/feature-flags-card.tsx`, `shared/control-plane-schema.ts:tenantFeatureFlags` | No urgent fix; document the three-way distinction clearly so a future architect doesn't conflate them (this report does so in Section 11). |
| 16 | **Low** | No CORS middleware is configured; the code has its own `TODO(security)` comment flagging this, relying on same-origin + cookies today. Matters more once genuinely multi-tenant custom domains (`tenantDomains`) are common and the Capacitor mobile app needs to hit a remote host cross-origin. | `server/index.ts:46-49` | Install `cors` with an explicit allow-list once custom domains / mobile cross-origin calls are a real requirement, per the existing TODO. |

## 9.2 What is already correctly built (don't re-litigate these)

To avoid a future architect "fixing" things that already work: dedicated-database-per-tenant routing (`organizations.databaseUrl` + control-plane `tenant_databases`, LRU-capped connection pooling, automatic pending-migration application on first connect) is real and working, proven against one live isolated tenant (Falakhe). Row-level `organization_id` scoping is the default and overwhelmingly consistent (documented gap: `groups`, item 4 above). FX rates, notification templates, per-user permission overrides, branch-scoped role assignment, and security-question banks are all already correctly tenant-scoped with sensible global-default fallbacks where appropriate. Subdomain- and custom-domain-based tenant resolution (`tenant-resolver.ts`) already supports both a POL263 subdomain and a tenant's own custom domain. Session/cookie infrastructure is tenant-agnostic by design (one session store, cross-subdomain cookie sharing deliberately engineered for the OAuth-callback-always-lands-on-main-domain problem) and needs no change for additional tenants.

---



---

# SECTION 10 — MODULE CLASSIFICATION

| Module | Classification | Notes |
|---|---|---|
| Multi-tenancy / org routing (tenant-db, tenant-resolver, control-plane) | **Infrastructure** | Cross-cutting; not a "feature" a user opens |
| Auth (staff Google OAuth, agent/client password) | **Core Platform** | |
| RBAC (Users, Roles, Permissions) | **Core Platform** / Administration | |
| Tenant Management, Branding, White-label | **Administration** | Also Control-Plane-adjacent — see Section 11 |
| Policy Sales/Issuance, Products & Pricing, Price Book, Waiting Period Waivers | **Insurance** | |
| Claims Management | **Insurance** | Overlaps Funeral (claim-linked funeral cases) |
| Funeral Case Management, Mortuary Register, Driver Checklist, Partner Parlours, Funeral Quotations | **Funeral** | |
| Fleet Management | **Fleet** | Also feeds Funeral (vehicle/driver assignment) |
| Premium Payments (PayNow, cash, credit-balance, month-end), Cashups, Requisitions/Disbursements, Expenditures, Banking, Debit Orders, FX Rates, Financial Statements, Platform Fee, Commissions, Approvals | **Accounting** | Approvals is also cross-cutting (used by Insurance/Funeral too) |
| Payroll, Attendance | **HR** | |
| Client Management, Groups/Legacy Groups, Leads/CRM Pipeline, Directory Contacts | **CRM** | Groups also touches Insurance (group policies) |
| Client Notification Templates & Automation, Staff/Agent In-App Notifications, Reminders | **Communications** | |
| Help Center, Order Services (landing hub), Diagnostics | **Administration** / Infrastructure (Diagnostics is ops-facing) | |
| Dashboard, Dynamic Reports, Statistics/Statistical Graphs, Employee Reports, Schedule & Department Reports, Audit Trail | **Analytics** | Audit Trail also security-relevant |
| Asset Register | **Analytics** (nominally) | Actually a non-persisted stub — see Section 2 G7 |
| Client Portal, Agent Portal, Public Registration Funnel, Document Verification (QR) | **Core Platform** | These are the three external-facing "surfaces" of the SaaS product itself |
| Outbox Pattern, Job Queue, Backup/Sync, Object Storage | **Infrastructure** | |
| App Release Management | **Infrastructure** / Administration | Platform-owner-only, global scope |

**Categories with nothing in this codebase** (stated explicitly per instructions, not invented):
- **Inventory**: no stock/warehouse/reorder-point concept exists anywhere. The nearest analogues (Price Book, Requisitions) are pricing/spend-request tools, not inventory management.
- **Marketing**: no campaign management, email/SMS marketing, or lead-source analytics beyond the single `source` field on `leads`. The "Order SMS & Prepaid" page is a deprecated stub redirecting elsewhere, not a marketing feature.

**Modules that legitimately span multiple categories** (called out rather than forced into one bucket): Groups (CRM + Insurance), Fleet (Fleet + Funeral), Approvals (Accounting + Insurance + Funeral, it's a generic maker-checker envelope), Directory Contacts (CRM + Funeral + Administration, since it covers undertakers/underwriters/transport as well as general contacts), Branding (Administration + Core Platform, since it's also part of the client-facing product surface via white-labeling).


---

# Section 11 — Control Plane Candidates

For each candidate, **Current state** reflects what the code actually does today (verified), and **Recommendation** states target ownership with rationale. "Control-plane-already" means the control-plane schema/table exists AND is wired into live server code; "control-plane-modeled-only" means the table exists but has zero read/write call sites.

| Candidate | Current state today | Recommended control-plane ownership & why |
|---|---|---|
| **Tenant Management** (create/suspend/switch tenant, license status) | **Control-plane-already**, substantially. `tenants` table (control plane) has `licenseStatus`/`provisioningState`/`suspendedAt`; `organizations` (main schema) is the live row the app actually reads for most fields; Platform Owner can create tenants, switch active tenant (session-stored `activeTenantId`), and impersonate any tenant without re-authenticating. | Control plane, correctly, and mostly already there. Remaining work: reconcile `organizations` vs control-plane `tenants` as truly one source of truth rather than two rows describing the same tenant (see Section 9 item 2). |
| **Subscriptions / Billing / Licensing** | **Absent.** `tenants.licenseStatus` exists as an enum (`active/suspended/trial/expired`) but nothing charges, meters, or automates a transition between these states — it's a manually-set flag today. | Control plane, unambiguously — billing/entitlement logic must never live inside a tenant's own database (a tenant should not be able to see or tamper with its own billing state via its own DB access). This is a genuinely greenfield build, not a migration. |
| **Feature Flags** | **Split across three unrelated systems** (see Section 9 item 15): (1) client-only localStorage UX flags (correctly USER-scoped, not a control-plane concern), (2) `tenantFeatureFlags` in the control plane (`claims_enabled`, `mobile_payments`, `agent_portal`, `whatsapp_notifications`) — schema-only, zero server call sites, (3) a generic app-level `feature_flags` table described in the oldest internal doc (MEGA-PROMPT.md) that does not exist in the current schema at all. | Control plane for (2) — genuinely tenant-scoped entitlement/rollout flags belong there once actually wired into route guards. (1) should stay USER/browser-scoped as-is. (3) should be treated as never-built; don't resurrect it without deciding it's distinct from (2). |
| **Global Branding Templates** (default/fallback branding before a tenant customizes) | **Partially control-plane-modeled.** `tenantBranding` exists in the control-plane schema but is unused; the live default is simply `organizations.logoUrl` defaulting to a shared static asset path. | Keep a GLOBAL fallback (generic POL263 branding) in the control plane as the seed template, but the live per-tenant override should be exactly one table, not two (resolve the `organizations`/`tenantBranding` duplication, Section 9 item 2). |
| **Marketplace** (product/add-on marketplace across tenants) | **Absent.** No code, schema, or docs reference anything like this. | Would be control plane if built (cross-tenant catalog), but this is pure greenfield — not a migration candidate, a net-new feature. |
| **Payments Configuration** | **Split, correctly in spirit, incorrectly in mechanics.** PayNow: per-tenant override already exists (`organizations.paynow*` columns) with a GLOBAL env-var fallback — the right shape, wrong storage location (plaintext in a shared-purpose table rather than encrypted in `tenantIntegrations`). Stripe/other gateways: `tenantIntegrations.provider` models it, nothing implements it. | The **tenant's own merchant credentials** (their PayNow account, their eventual Stripe account) are correctly TENANT-scoped data — but should live in `tenantIntegrations`, encrypted, once Phase 2 lands (Section 9 item 3), not as plaintext columns on `organizations`. Separately, **POL263's own PayNow/bank account for collecting tenant settlements** (see Platform Fee row below) is a genuinely different, GLOBAL CONTROL PLANE concern — don't conflate "the tenant's payment gateway" with "the platform's own collection mechanism." |
| **Platform Fee / Revenue collection & aggregation** | **Broken/siloed today** (Section 9 item 1) — 2.5% fee accrual lives correctly per-tenant (it's that tenant's liability), but settlement reconciliation is non-functional (`isSettled` never flips) and there is zero cross-tenant rollup. | This is the clearest "should have a control-plane half" item in the whole report: the **accrual** (how much does *this* tenant owe) can stay tenant-local for transparency, but **aggregation and dunning across all tenants** — "which tenants are overdue, how much total revenue is outstanding platform-wide, trigger a settlement reminder" — is inherently a control-plane function and has zero home for it today. |
| **Exchange Rates** | **Tenant-scoped already, correctly** — `fxRates` unique per (organizationId, currency), editable via `manage:settings`. | Keep TENANT — this is genuinely per-tenant data (each tenant may want to use different published rates or timing), and is already the best-implemented example of correct per-tenant config in the whole codebase. A GLOBAL CONTROL PLANE reference-rate feed (e.g. a daily official rate) could be offered as a *default/suggestion* tenants can accept or override, but the authoritative per-tenant rate should remain tenant-owned. |
| **SMS / WhatsApp / Email providers** | **Not implemented at all** (Section 7.5) — env vars and `tenantIntegrations` provider slots exist in config/schema only; no send logic exists anywhere in `server/`. | When built: TENANT-scoped via `tenantIntegrations`, never global — each tenant needs its own WhatsApp Business number / SMS sender ID / (arguably) SMTP identity for client-facing communication to look legitimate and avoid shared-reputation deliverability problems. |
| **API Keys / Env Vars generally** | Mixed — infra-level vars (`DATABASE_URL`, `SESSION_SECRET`, `APP_BASE_DOMAIN`, control-plane connection strings) are correctly GLOBAL; integration credentials (PayNow/SMS/WhatsApp/SMTP/storage) are incorrectly GLOBAL-only today when they should be TENANT via `tenantIntegrations`. | See rows above; the pattern is consistent — infra config stays global env vars, business-integration credentials move to `tenantIntegrations`. |
| **Monitoring / Logs / Backups** | Backup: **control-plane-already** for run *history* (`backupSyncRuns`, correctly global/platform-wide per its own code comment), but the backup *job itself* mirrors all tenants into one shared destination (Section 9 item 10). Logs: `auditLogs` lives in each tenant's own DB (org-scoped, nullable org for platform-owner actions) — there is no cross-tenant audit-log viewer. | Backup orchestration/history: correctly GLOBAL CONTROL PLANE as-is. A cross-tenant audit/log aggregation view for platform support purposes would be a new control-plane capability, not a migration of existing data (tenant audit logs should stay in tenant DBs for the tenant's own audit viewer; a control-plane read-replica/aggregation for platform support is additive). |
| **Security / Audit (platform-level)** | No platform-wide security dashboard exists; each tenant's `auditLogs` is siloed to that tenant/DB. | A control-plane-level security/anomaly view (e.g. "which tenants have had N failed logins today") is a legitimate greenfield control-plane feature — not present today. |
| **System Health** | `getJobStats()` (in-process job queue introspection) and the Finance "Diagnostics" tab (per-tenant: DB connection, uptime, notification failures, unallocated payments) exist, but are **per-server-process and per-tenant** respectively — there is no cross-tenant/whole-fleet system health view. | GLOBAL CONTROL PLANE — a platform operator needs one view across all tenant DBs/processes; today they'd have to check each tenant's diagnostics tab individually (same gap pattern as the platform-fee aggregation problem). |
| **Release channels** (mobile app version enforcement) | **Control-plane-adjacent-already** in spirit — `appReleases` (main schema, explicitly commented "Platform-level") tracks APK version/build/min-version for forced-upgrade checks across **all** tenants' installs; `POST/PATCH /api/platform/app-release*` endpoints are platform-owner-gated. | Correctly GLOBAL already (app releases are inherently a single artifact serving every tenant's mobile install base) — no change needed, just confirm it belongs conceptually in the control plane rather than the main tenant-data schema (it currently lives in `shared/schema.ts`, not `control-plane-schema.ts`, an organizational nit rather than a functional bug). |
| **Storage / CDN** | GLOBAL only today (Section 9 item 9) — `tenantStorage` modeled, unwired. | TENANT (or at minimum path-prefix-isolated within one shared bucket) once wired — each tenant's documents/receipts/logos should be logically (and eventually physically) separated for both data-residency and blast-radius reasons if one credential set is ever compromised. |
| **Global Notifications** (platform-wide broadcast, e.g. "scheduled maintenance tonight") | **Absent** — the existing `broadcastNotification()` is a **per-tenant** admin-to-clients broadcast (loops that org's own clients), not a platform-to-all-tenants announcement mechanism. | Would be a new GLOBAL CONTROL PLANE capability if built (e.g. platform operator announcing maintenance windows to all tenant admins) — currently no equivalent exists at any layer. |
| **Usage Limits / Rate Limits** | Rate limiting (`express-rate-limit` + optional Redis store) is GLOBAL/per-deployment, not per-tenant-tiered — every tenant gets the same limits (e.g. `DASHBOARD_MAX_ROWS`, `REPORT_EXPORT_MAX_ROWS`). | Currently correctly GLOBAL for infra protection; **flagged as a possible future TENANT override** if usage tiers/plans are ever introduced (e.g. a higher-tier tenant gets larger export limits) — not a gap today, a design option for when billing (still absent) exists. |
| **Tenant Provisioning** | **Control-plane-already**, largely — `db:push:tenant` → migrate → `cp:set-*-db` script sequence is a proven, documented (`docs/TENANT-DATABASES-WITHOUT-SUPABASE.md`) manual runbook, exercised for Falakhe. Not yet automated/self-service (Phase 3 of REFACTOR-PROGRESS.md, not started). | Control plane, correctly targeted; remaining work is automation (turn the manual script sequence into an API-triggered provisioning flow), not a re-architecture. |
| **Database Management** (per-tenant DB assignment/migration state) | **Control-plane-already** — `tenantDatabases` (migrationState, schemaVersion, lastMigratedAt) is exactly this, and `tenant-db.ts` auto-applies pending migrations on first pool connection per tenant. | Correctly GLOBAL CONTROL PLANE already; no change needed beyond continuing to close the schema-drift gaps noted in Section 9 item 14. |
| **Impersonation / Support tools** | **Control-plane-adjacent-already** — Platform Owner tenant-switching (`session.activeTenantId`, `POST /api/platform/switch-tenant`) is effectively impersonation-without-re-authentication, and is audit-logged. No separate "support agent impersonates a tenant's specific *user*" tool exists (only whole-tenant switching, not per-user impersonation). | Keep the existing tenant-switch mechanism as the control-plane-owned capability it already is; a narrower per-user impersonation tool (if needed for support) would be a new, carefully audited addition — not present today. |
| **Global Reports** (cross-tenant analytics for the platform operator) | **Absent** — all reports (`employee-reports.tsx`'s 41 export types, statistics/statistical-graphs) are strictly per-tenant, run against that tenant's own data. | Would be GLOBAL CONTROL PLANE if built (e.g. "total premium collected across all tenants this month") — genuinely new, not a migration. |
| **System Jobs / Queues / Cron** | **Not control-plane-orchestrated** — the in-memory job queue and the outbox background sweep both run inside the same Node process as the web server, per-instance, with no dedicated worker process and no tenant-aware job routing beyond `organizationId` being carried in outbox rows. This is explicitly REFACTOR-PROGRESS.md's **Phase 4, not started**. | Long-term, a genuinely tenant-aware worker architecture (jobs carrying `tenantId`, resolving the correct DB before processing, running in dedicated worker processes) is the target — but this is an infrastructure evolution, not something that belongs in "the control plane" as a settings/data concern the way the other rows do. Track separately as an ops/infrastructure roadmap item (see Section 18). |
| **Domains / SSL / Custom Domains / DNS** | **Control-plane-already, partially** — `tenantDomains` (domain→tenant mapping, isPrimary/isVerified) is real schema, and `tenant-resolver.ts` actively resolves custom domains through it as one of its four resolution strategies (header → subdomain → custom domain → session fallback). No code found for actual SSL/certificate provisioning/automation (e.g. no ACME/Let's Encrypt integration) — domain *mapping* exists, domain *provisioning* (getting a cert issued) does not appear automated. | Correctly control-plane for the mapping (already there); SSL/cert automation, if not handled by the hosting platform (DigitalOcean App Platform) automatically, would be a control-plane-adjacent ops concern to verify/document rather than assume. |

---



---

# Section 12 — Tenant Features

Everything a tenant should own and keep at the tenant level — the inverse of Section 11. For each, this confirms current tenant-scoping is already correct per the Section 4 database analysis, or flags a specific gap (cross-referencing Section 9).

| Tenant-owned area | Confirmed correctly tenant-scoped today? | Notes / cross-reference |
|---|---|---|
| **Users & Staff** | Yes — `users.organizationId` (nullable only for the Platform Owner pre-tenant-selection, a deliberate exception, not a gap). | RBAC roles are per-org rows (Section 9 item 12) — correct design, drift-monitoring is the only open question. |
| **Roles & Permissions (per-tenant customization)** | Yes — `roles.organizationId`, `role_permissions`, `user_roles`, `user_permission_overrides` all correctly scoped; the global `permissions` catalog (the *available* permission slugs) is intentionally GLOBAL (a platform-wide capability list, not business data) — correct split. | See Section 11's Feature Flags/Permissions rows for the global-vs-tenant boundary reasoning. |
| **Policies** | Yes — `policies.organizationId` NOT NULL, plus the only table with a proper `deletedAt` soft-delete alongside `paymentTransactions`/`paymentReceipts`. | Best-modeled entity in the schema; no gaps found. |
| **Clients** | Yes — `clients.organizationId` NOT NULL, composite indexes on org+email and org+nationalId (though note: these are non-unique lookup indexes, not uniqueness constraints — duplicate national IDs are technically permitted within one tenant, a data-quality rather than tenancy gap). | — |
| **Funerals / Mortuary** | Yes — `funeralCases`, `mortuaryIntakes`, `mortuaryDispatches`, `driverChecklists`, and the newest additions (`mortuaryPostMortemMovements`, `partnerParlourVehicleUsage`, migration 0057) are all org-scoped. | This is the most actively-developed domain right now (per recent migrations/commits) and is being built tenant-correctly from the start. |
| **Products / Pricing** | Yes — `products`, `productVersions` (the actual versioned rate card, ~35 columns modeling multi-currency/multi-schedule/age-banded pricing), `benefitBundles`, `addOns`, `ageBandConfigs` all org-scoped. | Genuinely sophisticated per-tenant pricing model already — a strong asset to carry forward, not something needing rework. |
| **Branches / Departments** | Yes — `branches.organizationId`; "department" exists as a free-text column on `users`/`payrollEmployees`/`requisitions` rather than its own table (no dedicated `departments` table found) — a modeling simplification, not a tenancy gap. | If department-level reporting/permissions ever need to be first-class, that would be a schema addition, not a re-scoping. |
| **Reports** | Yes, structurally — every report-generating endpoint queries only that caller's `organizationId`. The **content/format** of some report types (numbering schemes feeding into them, Section 9 item 6) isn't tenant-customizable, which is a settings gap, not a tenancy-boundary gap (no cross-tenant data ever appears in a tenant's reports). | — |
| **Assets / Vehicles / Fleet** | Yes — `fleetVehicles`, `fleetFuelLogs`, `fleetMaintenance`, `vehicleTripLogs`, `driverAssignments` (inherits org-scoping via `vehicleId`) all tenant-owned. | — |
| **Inventory** | **N/A — no inventory module exists in this codebase at all** (confirmed absent in the Section 2/10 feature and module inventories; `priceBookItems` is a billable-line-item catalog for quotations, not a stock/inventory system). Do not describe a tenant-owned "inventory" feature that doesn't exist. | Flag explicitly rather than infer one. |
| **Accounting** | Yes — the entire finance suite (`expenditures`, `requisitions`, `paymentDisbursements`, `bankAccounts`, `bankDeposits`, `bankStatementBalances`, `balanceSheetEntries`, `debitOrders`, `cashups`) is org-scoped, with maker-checker workflows throughout. | One schema oddity worth flagging for a future architect, not a tenancy gap: `paymentDisbursements.entityId` is a **polymorphic FK with no declared `references()`** (entityType discriminator instead) — a referential-integrity soft spot, unique in this codebase to this one table. |
| **Templates** (notification templates, T&Cs) | Yes — `notificationTemplates` and `termsAndConditions` are both fully org-scoped, versioned, effective-dated. Called out in Section 7 as a genuinely good existing pattern. | The channels behind notification templates (WhatsApp/SMS) don't exist yet (Section 11), but the template *data model* itself is correctly tenant-owned already. |
| **Groups / Legacy Groups** | Yes, **with the one confirmed cross-tenant leak in this report** — `groups.organizationId` NOT NULL at the schema level, but `storage.getGroup()`/`updateGroup()` don't filter by it in the WHERE clause (Section 9 item 4). Fix is a one-line change per function; the schema/data model itself is correctly designed. | "Legacy" groups/receipts are not a separate table family — just `groups`/`policies` rows flagged `isLegacy=true`, layered onto the same tenant-scoped tables as regular groups/policies. |
| **Leads / CRM** | Yes — `leads.organizationId` NOT NULL, with agent/branch/stage indexes. | No dedicated `*:group` or `*:lead`-adjacent gaps found beyond the general permission-matrix caveats in Section 13. |

**Summary judgment for Section 12**: with the single exception of the `groups` WHERE-clause gap (already flagged, already has a one-line fix), **every tenant-owned business domain in this codebase is already correctly `organization_id`-scoped**, frequently with genuinely sophisticated per-tenant customization (versioned pricing, per-org numbering counters, per-org FX rates, per-org RBAC). The multi-tenancy work remaining is concentrated almost entirely in **settings/config that should move from global-env-var to per-tenant** (Section 9/11) and in **finishing the control-plane wiring that's already been designed** (REFACTOR-PROGRESS.md Phases 2–4) — not in re-scoping business data, which was done correctly from a much earlier point in this codebase's history than the settings/integration layer was.


---

# Section 13 — Permission Matrix

## 13.1 Roles that actually exist in the codebase

Source of truth: `server/constants.ts:84-153` (`ROLE_PERMISSION_MAP`), seeded per-organization by `seedOrgRoles()` in `server/seed.ts:38-64`. **These 11 role names are the complete, exhaustive set found in code** — no other role slugs appear anywhere in `ROLE_PERMISSION_MAP`, `shared/roles.ts`, or the seed script:

`superuser`, `executive`, `manager`, `administrator`, `cashier`, `agent`, `claims_officer`, `fleet_ops`, `driver`, `mortuary_attendant`, `staff`

Plus one identity that sits **above** all tenant roles and is not itself a `roles` table row per se: the **Platform Owner** (`SUPERUSER_EMAIL` env, matched by email in `server/constants.ts:11-22` and enforced in `requirePermission`/`getUserEffectivePermissions`). The platform owner bypasses permission checks entirely regardless of any role assignment, and additionally holds `create:tenant`/`delete:tenant`/`manage:whitelabel` which no tenant role ever grants.

Also distinct: the **Client** — not a `users`/`roles` row at all, but a separate `clients` table + its own session mechanism (Section 5.5/5.9 above); clients only ever reach their own record's data (`client-auth.ts` scopes every query to `session.clientId`/`session.clientOrgId`), so they don't participate in the permission-slug system at all.

**Gap note for the architecture report**: role names like "CEO", "Marketing", or "Guest" that a report template might expect **do not exist anywhere in this codebase**. The closest analogues actually present are `executive` (read-only across nearly everything — plausibly a "CEO/board" viewing role) and `staff` (a minimal generic read-only default). There is no "Marketing" or "Guest" role, no anonymous/public authenticated tier beyond the unauthenticated client-portal login screens themselves. Any report row for those labels should be marked **N/A — not implemented**, not inferred.

## 13.2 Permission matrix

Legend: **Full** = both read+write (and typically delete/approve) permissions for the area; **Read-only** = only `read:*` permissions in that category; **Scoped-to-own-records** = permission granted but narrowed by `isAgentScoped`/session-based ownership checks at the data layer (agent role); **None** = no permission slug for that category appears in the role's `ROLE_PERMISSION_MAP` entry at all. Where a cell required interpretation beyond a literal slug match (e.g. mapping "HR" or "Groups" onto the closest actual permission category), this is called out in the notes column — **treat those as inferred, not literal code citations**.

| Capability area (permission slug family) | superuser | executive | manager | administrator | cashier | agent | claims_officer | fleet_ops | driver | mortuary_attendant | staff |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Policies (`*:policy`, `edit:premium`, `delete:policy`) | Full (implicit) | Read-only | Full (no delete) | Full incl. delete + premium override | None | Scoped-to-own-records (read/write own clients' policies) | Read-only | None | None | None | Read-only |
| Claims (`*:claim`, `approve:claim`) | Full | Read-only | Full incl. approve | Full incl. approve | None | None | Full incl. approve | None | None | None | Read-only |
| Finance (`*:finance`, `approve:finance`, `edit/delete:payment`, `edit/delete:receipt`, `backdate:payment`, `receipt:*`) | Full | Read-only | Read + all receipt-creation types (cash/mobile/transfer/group), no delete/edit/approve | Full incl. approve, backdate, edit/delete payment & receipt | Read + write:finance + all receipt types (no approve/delete/edit/backdate) | Read-only + receipt:mobile & receipt:transfer only (no cash/group, no write:finance) | Read-only | None | None | None | None |
| Users / Identity (`*:user`) | Full | Read-only | Full (no delete) | Full incl. delete | None | None | None | None | None | None | None |
| Roles / RBAC (`*:role`, `manage:permissions`) | Full (implicit) | Read-only | Read-only | Full incl. manage:permissions | None | None | None | None | None | None | None |
| Branches (`*:branch`) | Full | Read-only | Full | Full | None | None | None | None | None | None | Read-only |
| Organization settings (`*:organization`, `manage:settings`) | Full | Read-only (org) | manage:settings only (no write:organization) | Full incl. write:organization + manage:settings | None | None | None | None | None | None | None |
| Products (`*:product`) | Full | None | Full | Full | None | Read-only | None | None | None | None | Read-only |
| Funeral operations / Mortuary (`*:funeral_ops`) | Full | Read-only | Full | Full | None | None | Read + write | Read + write | Read-only | Read + write | Read-only |
| Fleet (`*:fleet`) | Full | Read-only | Read + write | Read + write | None | None | None | Read + write | Read-only | Read-only | None |
| Commission (`*:commission`) | Full | Read-only | Read-only | Full | None | Read-only | None | None | None | None | None |
| Payroll (`*:payroll`) | Full | Read-only | None | Full | None | None | None | None | None | None | None |
| Reports (`*:report`) | Full | Read-only | Read + write | Full | Read-only | Read-only | Read-only | Read-only | None | None | Read-only |
| Leads / CRM (`*:lead`) | Full | Read-only | Full | Full | None | Full | None | None | None | None | None |
| Notifications (`*:notification`) | Full | Read-only | Read-only | Full | None | None | None | None | None | None | None |
| Approvals (maker-checker) (`manage:approvals`) | Full | None | Full | Full | None | None | None | None | None | None | None |
| Audit log (`read:audit_log`) | Full | Read-only | Read-only | Read-only | None | None | None | None | None | None | None |
| Tenant management (`create:tenant`, `delete:tenant`) | Full — **but only for the actual Platform Owner email; ordinary superuser-role tenant admins do NOT get platform-level tenant CRUD** — see note below | None | None | None | None | None | None | None | None | None | None |
| Client records (`*:client`, `view:own_clients`, `view:all_clients`) | Full | Read-only | Full + view:all_clients | Full + view:own_clients + view:all_clients | Read-only | Scoped-to-own-records (read/write own only, `view:own_clients`) | Read-only | None | None | Read-only | Read-only |

**Important nuance on `superuser` vs. Platform Owner**: `ROLE_PERMISSION_MAP.superuser = []` (empty) is not an oversight — `getUserEffectivePermissions()` special-cases *any* role literally named `superuser` to receive **every** permission in `SYSTEM_PERMISSIONS`, unconditionally (`server/storage.ts:896-899`). So a tenant's own `superuser` role (assigned via `user_roles` like any other role) is a **full/unrestricted user within that one tenant** — but does **not** get `create:tenant`/`delete:tenant`/`manage:whitelabel`, since those three are added only when the *email* matches `PLATFORM_SUPERUSER_EMAIL` (`storage.ts:917-923`), not when the role name matches. In other words: **"superuser" role = tenant god-mode; Platform Owner email = tenant god-mode + cross-tenant/platform powers.** The matrix row above reflects the role, not the email-based platform owner (which is documented separately in 13.1/5.3).

**HR / Payroll**: no distinct "HR" permission category exists; payroll (`read:payroll`/`write:payroll`) is the closest analogue and is mapped above. There is no separate leave-management, hiring, or personnel-file permission slug found — likely folded under `write:user` (user/employee record CRUD) plus `write:payroll`, but this is an inference, not a direct citation.

**Groups** (funeral society/group policies): no dedicated `*:group` permission slug exists in `SYSTEM_PERMISSIONS`; group-related endpoints observed elsewhere in the codebase (e.g. `client-auth.ts`'s group-executive routes) are gated by ordinary `*:policy`/`*:client` permissions on the staff side, and by client-session + "is this client a recognized executive of the group" checks on the client-portal side (`storage.getGroupsWhereClientIsExecutive`) — not a distinct RBAC category.

## 13.3 Cross-cutting notes for the architecture report

1. **All effective-permission computation is per-organization** (roles are org-scoped rows), so two tenants can independently customize `role_permissions` for e.g. their own `manager` role without affecting each other — the `ROLE_PERMISSION_MAP` in `constants.ts` is only the **seed default**, applied by `seedOrgRoles()`; nothing in the runtime prevents a tenant admin (holding `write:role`/`manage:permissions`) from later editing their org's actual `role_permissions` rows away from that default via `POST/DELETE /api/roles/:id/permissions/:permId`. **The matrix above reflects the seeded defaults, not necessarily any given live tenant's current state** — flagging this explicitly since it's the single biggest reason the matrix could drift from reality over time.
2. **Per-user overrides can move any single user off this matrix** in either direction (grant an extra permission, or revoke one their role would otherwise give) via `user_permission_overrides` — the matrix reflects role defaults only, not any individual user's actual effective set.
3. **Branch-scoping is a modeled dimension (branch_id on `user_roles`/`users`) but not an enforced row-level-security boundary** in the generic permission-check path — see Section 5.9 for full discussion. Any "Scoped-to-own-branch" claim in a hypothetical future matrix version would need per-route verification, not a blanket statement.
4. **Agent scoping (`isAgentScoped`) is the one form of data-level (not just permission-slug-level) restriction actually enforced in shared helper code** (`enforceAgentScope`, `enforceAgentPolicyAccess` in `route-helpers.ts`), and it composes with roles: an `agent`+`manager` combo user is NOT scoped down, only a pure `agent` is.


---

# SECTION 14 — API INVENTORY

Source: `server/routes.ts` (~9267 lines, central Express route registration point via `registerRoutes(httpServer, app)`), plus `server/auth.ts`, `server/client-auth.ts`, `server/index.ts`, `server/policy-document.ts`, `server/static.ts`, and the four split-out PDF route files (`server/routes-pdf-finance.ts`, `server/routes-pdf-hr-fleet.ts`, `server/routes-pdf-mortuary.ts`, `server/routes-pdf-policy.ts`).

Coverage: the entirety of `routes.ts` (lines 1–9267) was read sequentially in 6 chunks, plus all 5 auxiliary route files and 4 PDF route files were read in full. Sections below are presented in file order (routes.ts first, then auxiliary files, then PDF form files) and grouped into functional-module subheadings matching route path prefixes. Minor route-boundary overlaps between chunks are intentional (a route split across a chunk boundary is documented once fully, by whichever chunk captured its complete body).

Total distinct route registrations documented: **approximately 430–450** (routes.ts ~360-380, auth/client-auth/policy-document/index/static ~55, PDF form files ~40).

---

## PART A — `server/routes.ts`

### A1. File Uploads / Documents (generic)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /uploads/logos/*path | Serve org logo asset | Public | Proxies object storage or local disk; cached 24h |
| GET | /uploads/signatures/*path | Serve signature image asset | Public | Same serveUpload helper |
| GET | /uploads/receipt-adverts/*path | Serve receipt advert image | Public | Same serveUpload helper |
| GET | /uploads/*path | Serve generic uploaded file (docs, PDFs, receipts) | requireAuth | Path-traversal guarded; streams from object storage w/ server creds if enabled, else local disk |
| POST | /api/payments/paynow/result | PayNow webhook (result URL) | Public (hash-verified in handler) | in: PayNow form-urlencoded body, ?org= query; calls handlePaynowResult(); always returns 200 "OK"/"Error" to stop PayNow retries |
| POST | /api/upload | Generic image upload (client/claim/policy/funeral-ops docs) | requireAuth, requireTenantScope, requireAnyPermission(write:client/write:claim/write:policy/write:funeral_ops) | multer memory upload, 5MB, jpg/png/gif/webp only (SVG blocked—XSS); out: {url,filename} |
| POST | /api/upload/logo | Upload org logo | requireAuth, requireTenantScope, requirePermission(manage:settings) | multer, 5MB, png/jpg/webp; stores under "logos" prefix |
| POST | /api/upload/signature | Upload signature image | requireAuth, requireTenantScope, requirePermission(manage:settings) | stores under "signatures" prefix |
| POST | /api/upload/receipt-advert-image | Upload receipt advert image | requireAuth, requireTenantScope, requirePermission(manage:settings) | stores under "receipt-adverts" prefix |
| POST | /api/upload/avatar | Upload own avatar | requireAuth | Any authenticated staff user; updates users.avatarUrl; auditLog UPDATE_AVATAR |

### A2. Receipt Adverts

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/receipt-adverts | List receipt adverts for org | requireAuth, requireTenantScope, requirePermission(manage:settings) | out: advert[] |
| POST | /api/receipt-adverts | Create receipt advert | requireAuth, requireTenantScope, requirePermission(manage:settings) | auditLog CREATE_RECEIPT_ADVERT |
| PATCH | /api/receipt-adverts/:id | Update receipt advert | requireAuth, requireTenantScope, requirePermission(manage:settings) | auditLog UPDATE_RECEIPT_ADVERT |
| DELETE | /api/receipt-adverts/:id | Delete receipt advert | requireAuth, requireTenantScope, requirePermission(manage:settings) | auditLog DELETE_RECEIPT_ADVERT |
| POST | /api/receipt-adverts/:id/activate | Mark advert active (single active enforced) | requireAuth, requireTenantScope, requirePermission(manage:settings) | auditLog ACTIVATE_RECEIPT_ADVERT |
| POST | /api/receipt-adverts/:id/deactivate | Deactivate advert | requireAuth, requireTenantScope, requirePermission(manage:settings) | sets isActive:false |

### A3. App Release Management

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/public/agent-app-latest | Latest active app release info (public, for agent APK download page) | Public | out: {url,version,buildNumber,updatedAt}; Cache-Control 60s |
| GET | /api/app-info | Latest release info for logged-in app instance version-check | requireAuth | out: version/buildNumber/minVersion/minBuildNumber/downloadUrl/releaseNotes |
| GET | /api/platform/app-releases | List last 20 releases | requireAuth (isPlatformOwner check) | Platform-owner only, 403 otherwise |
| POST | /api/platform/app-release | Create new app release record | requireAuth (isPlatformOwner check) | in: version,buildNumber,minVersion,minBuildNumber,downloadUrl,releaseNotes |
| PATCH | /api/platform/app-release/:id | Update app release record | requireAuth (isPlatformOwner check) | partial update of release fields incl. isActive |

### A4. Platform Owner: Tenant Switching / Platform Dashboard

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| POST | /api/platform/backup-sync | Trigger manual backup sync job | requireAuth (isPlatformOwner) | Fire-and-forget import of ./backup-sync runBackupSync("manual") |
| GET | /api/platform/backup-status | Get recent backup sync runs | requireAuth (isPlatformOwner) | out: {runs: last 20} |
| POST | /api/platform/switch-tenant | Platform owner switches active tenant context (impersonation) | requireAuth (isPlatformOwner) | in: {tenantId}; sets session.activeTenantId; auditLog SWITCH_TENANT |
| GET | /api/platform/active-tenant | Get current active tenant for platform owner session | requireAuth (isPlatformOwner) | out: {activeTenantId, tenant} |
| GET | /api/platform/dashboard | Cross-tenant summary dashboard (counts per tenant) | requireAuth (isPlatformOwner or create:tenant/delete:tenant perm) | Iterates all tenants (batched 5 at a time) querying each tenant DB for users/policies/clients/claims/leads/branches counts |

### A5. Organizations / Tenants

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/organizations | List organizations (all tenants if platform-manager perms, else own org only) | requireAuth | Reads control-plane DB (cpTenants+cpTenantBranding join) for tenant managers |
| GET | /api/organizations/:id | Get single organization | requireAuth (cross-tenant check unless create/delete:tenant perm) | Strips paynowIntegrationKey/databaseUrl/paynowAuthEmail unless platform owner |
| PATCH | /api/organizations/:id | Update organization/tenant settings | requireAuth (perm-gated: write:organization or tenant-manager) | Whitelisted TENANT_WRITE_FIELDS (branding, PayNow config); PLATFORM_ONLY_ORG_FIELDS gated to platform owner; auditLog UPDATE_ORGANIZATION |
| POST | /api/organizations | Create new tenant/organization | requireAuth, requirePermission(create:tenant) | Creates default "Head Office" branch, seeds all system roles+permissions via ROLE_PERMISSION_MAP, optionally creates admin user w/ argon2 hash; auditLog CREATE_ORGANIZATION; soft-deletes org on failure to avoid orphan tenant |
| DELETE | /api/organizations/:id | Soft-delete an organization | requireAuth, requirePermission(delete:tenant) | Blocks if org has non-platform-owner users; renames org "(deleted)"; auditLog DELETE_ORGANIZATION |

### A6. Branches

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/branches | List branches for org | requireAuth, requireTenantScope, requirePermission(read:branch) | |
| POST | /api/branches | Create branch | requireAuth, requireTenantScope, requirePermission(write:branch) | auditLog CREATE_BRANCH |

### A7. Staff/User Management

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/users | List org users w/ roles | requireAuth, requireTenantScope, requirePermission(read:user) | Paginated (limit≤500); batches role lookup; strips passwordHash |
| GET | /api/agents | List users with "agent" role | requireAuth, requireTenantScope, requirePermission(read:user) | out: {id,email,displayName,referralCode}[] |
| GET | /api/users/:id | Get single user | requireAuth, requireTenantScope, requirePermission(read:user) | Cross-tenant 403; strips passwordHash/googleId |
| POST | /api/users | Create staff user | requireAuth, requireTenantScope, requirePermission(write:user) | Agent role requires password≥8 chars; argon2 hash; assigns roles; auditLog CREATE_USER |
| PATCH | /api/users/:id | Update staff user | requireAuth, requireTenantScope, requirePermission(write:user) | Email uniqueness check, password reset, role reassignment; auditLog UPDATE_USER |
| DELETE | /api/users/:id | Deactivate (soft-delete) user | requireAuth, requireTenantScope, requirePermission(delete:user) | Cannot deactivate self; kills all active sessions for user via raw SQL DELETE FROM session; auditLog DEACTIVATE_USER |
| GET | /api/users/:id/agent-policies | List policies owned by an agent user | requireAuth, requireTenantScope, requirePermission(read:user) | out: {count, policies} |
| POST | /api/users/:id/reassign-policies | Reassign an agent's policies to another agent then deactivate | requireAuth, requireTenantScope, requirePermission(delete:user) | auditLog REASSIGN_AGENT_POLICIES + DEACTIVATE_USER |

### A8. Roles & Permissions

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/roles | List org roles | requireAuth, requireTenantScope, requirePermission(read:role) | |
| GET | /api/roles/:id/permissions | List permissions for a role | requireAuth, requireTenantScope, requirePermission(read:role) | |
| POST | /api/roles/:id/permissions/:permId | Grant permission to role | requireAuth, requireTenantScope, requirePermission(write:role) | auditLog ADD_ROLE_PERMISSION |
| DELETE | /api/roles/:id/permissions/:permId | Revoke permission from role | requireAuth, requireTenantScope, requirePermission(write:role) | auditLog REMOVE_ROLE_PERMISSION |
| GET | /api/permissions | List all system permissions | requireAuth, requirePermission(read:role) | |

### A9. Audit Logs

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/audit-logs | List/search audit log entries | requireAuth, requireTenantScope, requirePermission(read:audit_log) | Paginated; filters: search, action, from, to |

### A10. Dashboard Stats & Reminders

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/dashboard/stats | Main staff dashboard aggregate stats | requireAuth, requireTenantScope, requireAnyPermission(read:finance/read:policy/read:client) | Filters dateFrom/To/status/branchId; agent-scoped users see only own stats; Cache-Control 30s |
| GET | /api/reminders | List current user's reminders | requireAuth, requireTenantScope | |
| POST | /api/reminders | Create reminder | requireAuth, requireTenantScope | Requires title |
| PATCH | /api/reminders/:id | Update reminder | requireAuth, requireTenantScope | Scoped to user+org |
| DELETE | /api/reminders/:id | Delete reminder | requireAuth, requireTenantScope | Scoped to user+org |

### A11. Clients

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/clients | List clients (org-wide or agent-scoped) | requireAuth, requireTenantScope, requirePermission(read:client) | Paginated, search by `q`; agent-scoped users see only own clients; Cache-Control 30s |
| GET | /api/clients/:id | Get single client | requireAuth, requireTenantScope, requirePermission(read:client) | Cross-tenant 403; agent access check; strips passwordHash/securityAnswerHash/activationCode |
| POST | /api/clients | Create client | requireAuth, requireTenantScope, requirePermission(write:client) | National-ID existing-client short-circuit returns 200 w/ existingClient for auto-populate; relaxed validation for legacy-group capture; generates activationCode; auto-creates a Lead; auditLog CREATE_CLIENT(_LEGACY_GROUP) + CREATE_LEAD |
| PATCH | /api/clients/:id | Update client record | requireAuth, requireTenantScope, requirePermission("write:client") | Agent-scope check; strips id/orgId/createdAt; nullifies empty dateOfBirth/branchId/agentId; auditLog UPDATE_CLIENT |
| GET | /api/clients/:clientId/dependents | List client's dependents/beneficiaries | requireAuth, requireTenantScope, requirePermission("read:client") | |
| POST | /api/clients/:clientId/dependents | Create dependent | requireAuth, requireTenantScope, requirePermission("write:client") | Validates nationalId; auditLog CREATE_DEPENDENT |
| PATCH | /api/clients/:clientId/dependents/:id | Update dependent | requireAuth, requireTenantScope, requirePermission("write:client") | auditLog UPDATE_DEPENDENT |
| DELETE | /api/clients/:clientId/dependents/:id | Delete dependent | requireAuth, requireTenantScope, requirePermission("write:client") | auditLog DELETE_DEPENDENT |
| GET | /api/clients/:clientId/documents | List client documents (ID copies etc.) | requireAuth, requireTenantScope, requirePermission("read:client") | agent access-check |
| POST | /api/clients/:clientId/documents | Upload client document | requireAuth, requireTenantScope, requirePermission("write:client"), memUpload | Uploads to object storage (client-documents/); auditLog UPLOAD_CLIENT_DOCUMENT |
| DELETE | /api/clients/:clientId/documents/:docId | Delete client document | requireAuth, requireTenantScope, requirePermission("write:client") | Deletes from object storage then DB; auditLog DELETE_CLIENT_DOCUMENT |
| GET | /api/clients/:clientId/payment-methods | List client saved payment methods | requireAuth, requireTenantScope, requirePermission("read:client") | |
| PUT | /api/clients/:clientId/payment-methods/default | Set default payment method | requireAuth, requireTenantScope, requirePermission("write:client") | Rejects card-type (must be mobile money for automation); auditLog UPSERT_CLIENT_PAYMENT_METHOD |
| GET | /api/clients/:clientId/policies | List client's policies | requireAuth, requireTenantScope, requirePermission("read:policy") | |

### A12. Products, Versions, Benefits & Add-ons

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/products | List org products | requireAuth, requireTenantScope, requirePermission("read:product") | |
| GET | /api/products/:id | Get product | requireAuth, requireTenantScope, requirePermission("read:product") | |
| POST | /api/products | Create product | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog CREATE_PRODUCT |
| PATCH | /api/products/:id | Update product | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog UPDATE_PRODUCT |
| DELETE | /api/products/:id | Delete product | requireAuth, requireTenantScope, requirePermission("write:product") | Guard against in-use; auditLog DELETE_PRODUCT |
| GET | /api/product-versions | List all product versions for org | requireAuth, requireTenantScope, requirePermission("read:product") | |
| GET | /api/products/:id/versions | List versions of a product | requireAuth, requireTenantScope, requirePermission("read:product") | |
| POST | /api/products/:id/versions | Create new product version | requireAuth, requireTenantScope, requirePermission("write:product") | Auto-increments version number; auditLog CREATE_PRODUCT_VERSION |
| PATCH | /api/product-versions/:id | Update product version | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog UPDATE_PRODUCT_VERSION |
| POST | /api/product-versions/:id/recalculate-premiums | Batch recalc premiums for all active policies on a version | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog BATCH_RECALCULATE_PREMIUMS; out: {total,updated,skipped} |
| GET | /api/benefit-catalog | List benefit catalog items | requireAuth, requireTenantScope, requirePermission("read:product") | |
| POST | /api/benefit-catalog | Create benefit catalog item | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog CREATE_BENEFIT_CATALOG_ITEM |
| PATCH | /api/benefit-catalog/:id | Update benefit catalog item | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog UPDATE_BENEFIT_CATALOG_ITEM |
| GET | /api/benefit-bundles | List benefit bundles | requireAuth, requireTenantScope, requirePermission("read:product") | |
| POST | /api/benefit-bundles | Create benefit bundle | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog CREATE_BENEFIT_BUNDLE |
| PATCH | /api/benefit-bundles/:id | Update benefit bundle | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog UPDATE_BENEFIT_BUNDLE |
| GET | /api/add-ons | List add-ons | requireAuth, requireTenantScope, requirePermission("read:product") | |
| POST | /api/add-ons | Create add-on | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog CREATE_ADD_ON |
| PATCH | /api/add-ons/:id | Update add-on | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog UPDATE_ADD_ON |
| GET | /api/age-bands | List age band configs | requireAuth, requireTenantScope, requirePermission("read:product") | |
| POST | /api/age-bands | Create age band config | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog CREATE_AGE_BAND |
| PATCH | /api/age-bands/:id | Update age band config | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog UPDATE_AGE_BAND |
| GET | /api/price-book | List price book items | requireAuth, requireTenantScope, requirePermission("read:product") | |
| POST | /api/price-book | Create price book item | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog CREATE_PRICE_BOOK_ITEM |
| PATCH | /api/price-book/:id | Update price book item | requireAuth, requireTenantScope, requirePermission("write:product") | Validates priceAmount≥0; auditLog UPDATE_PRICE_BOOK_ITEM |
| GET | /api/terms | List T&C records for org (filter productVersionId/all) | requireAuth, requireTenantScope | |
| POST | /api/terms | Create T&C entry | requireAuth, requireTenantScope, requirePermission("write:product") | |
| PATCH | /api/terms/:id | Update T&C entry | requireAuth, requireTenantScope, requirePermission("write:product") | |
| DELETE | /api/terms/:id | Delete T&C entry | requireAuth, requireTenantScope, requirePermission("write:product") | auditLog DELETE_TERMS |

### A13. Policies (core CRUD, members, transitions, legacy)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/policies/legacy | List legacy policies w/ premium override info | requireAuth, requireTenantScope, requirePermission("read:policy") | Raw SQL join policies+clients+groups filtered is_legacy=true |
| POST | /api/policies/legacy/bulk-override | Bulk set premium overrides on legacy policies | requireAuth, requireTenantScope, requirePermission("edit:premium") | Raw SQL UPDATE per row; auditLog bulk_update |
| GET | /api/policies | List policies (paginated/filterable) | requireAuth, requireTenantScope, requirePermission("read:policy") | Cache-Control 30s; triggers schedulePolicyPremiumBackfill; agent-scoped forced to own agentId; recalculates premium per policy |
| GET | /api/policies/:id | Get single policy w/ enriched fields | requireAuth, requireTenantScope, requirePermission("read:policy") | Computes waitingPeriodEndDate, claimable/claimableReason, totalPaid/Due/balance/outstanding/walletBalance |
| POST | /api/policies | Create new policy | requireAuth, requireTenantScope, requirePermission("write:policy") | Generates policyNumber; resolves agent via referralCode; validates beneficiary; computes premium; storage.createPolicyWithInitialSetup (transactional); auditLog CREATE_POLICY; legacy auto-activated; enqueueJob("notify:policy_capture"); notifyUser to agent |
| PATCH | /api/policies/:id | Update policy fields / manual premium override / legacy flag | requireAuth, requireTenantScope, requirePermission("write:policy") | Premium edits require "edit:premium"; triggers reconcilePremiumChange; isLegacy flip triggers auto-activation; auditLog UPDATE_POLICY |
| POST | /api/policies/:id/upgrade | Change policy's product version (upgrade/downgrade) | requireAuth, requireTenantScope, requirePermission("write:policy") | Blocks duplicate policy for client+target version; reconcilePremiumChange; auditLog UPGRADE_POLICY_PRODUCT |
| POST | /api/policies/:id/transition | Change policy status (state machine) | requireAuth, requireTenantScope, requirePermission("write:policy") | Validates VALID_POLICY_TRANSITIONS; enqueueJob("notify:transition"); recordClawback on lapsed/cancelled; auditLog TRANSITION_POLICY |
| DELETE | /api/policies/:id | Request policy deletion (approval workflow) | requireAuth, requireTenantScope, requirePermission("delete:policy") | Creates ApprovalRequest instead of deleting; notifyUsersWithPermission("manage:approvals"); 202 |
| GET | /api/policies/:id/members | List enriched policy members | requireAuth, requireTenantScope, requirePermission("read:policy") | Per-member computes age, coverDate/waitingPeriodEndDate, claimable |
| POST | /api/policies/:id/members | Add member (dependent/client) to policy | requireAuth, requireTenantScope, requirePermission("write:policy") | Enforces product member limits; recalculatePolicyPremiumIfNeeded + reconcilePremiumChange (member_add); auditLog ADD_POLICY_MEMBER; enqueueJob("notify:member_added") |
| DELETE | /api/policies/:id/members/:memberId | Remove (deactivate) a policy member | requireAuth, requireTenantScope, requirePermission("write:policy") | Blocks removing role="policy_holder"; recalcs premium/reconciles; auditLog REMOVE_POLICY_MEMBER |
| GET | /api/policies/:id/add-ons | List add-ons on a policy | requireAuth, requireTenantScope, requirePermission("read:policy") | |
| PUT | /api/policies/:id/members/:memberId/add-ons | Replace add-ons for one policy member | requireAuth, requireTenantScope, requirePermission("write:policy") | IDOR guard; auditLog UPDATE_MEMBER_ADD_ONS; recalculates premium |
| PATCH | /api/policies/:id/members/:memberId | Edit dependent/policy-holder personal details | requireAuth, requireTenantScope, requirePermission("edit:premium") | Routes to updateDependent or updateClient; auditLog UPDATE_DEPENDENT or UPDATE_CLIENT |
| POST | /api/policies/:id/preview-change | Read-only preview of premium + arrears/credit impact of prospective change | requireAuth, requireTenantScope, requirePermission("write:policy") | Persists nothing; out: {oldPremium,newPremium,reconciliation,direction} |
| POST | /api/policies/:id/sync-members | Sync policy members from client's current dependents | requireAuth, requireTenantScope, requirePermission("write:policy") | out: {synced,total} |
| GET | /api/policies/:id/documents | List policy documents | requireAuth, requireTenantScope, requirePermission("read:policy") | |
| POST | /api/policies/:id/documents | Upload policy document | requireAuth, requireTenantScope, requirePermission("write:policy"), policyDocUpload | Uploads to object storage (policy-documents/); auditLog UPLOAD_POLICY_DOCUMENT |
| DELETE | /api/policies/:id/documents/:docId | Delete policy document | requireAuth, requireTenantScope, requirePermission("write:policy") | auditLog DELETE_POLICY_DOCUMENT |
| POST | /api/policies/:id/waiver-request | Request waiting-period waiver for a policy | requireAuth, requireTenantScope, requirePermission("write:policy") | Blocks duplicate pending request; auditLog CREATE_WAIVER_REQUEST |
| GET | /api/policies/:id/waiver-request | Get waiver for a policy | requireAuth, requireTenantScope, requirePermission("read:policy") | |
| GET | /api/waivers | List all waivers (org-wide) | requireAuth, requireTenantScope, requirePermission("manage:approvals") | query status filter |
| POST | /api/waivers/:id/resolve | Approve/reject a waiver | requireAuth, requireTenantScope, requirePermission("manage:approvals") | Transactional w/ row lock to prevent concurrent double-approval; auto-activates inactive policy on approve; auditLog WAIVER_APPROVE/REJECT |

### A14. Payments, Receipts, Payment Intents & PayNow

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| PATCH | /api/payments/:id | Edit a payment transaction | requireAuth, requireTenantScope, requirePermission("edit:payment") | Blocks amount/currency/status edits once cleared; auditLog UPDATE_PAYMENT |
| DELETE | /api/payments/:id | Hard-delete a payment transaction | requireAuth, requireTenantScope, requirePermission("delete:payment") | Blocks deletion of cleared payments; auditLog DELETE_PAYMENT |
| PATCH | /api/receipts/:id | Edit a receipt | requireAuth, requireTenantScope, requirePermission("edit:receipt") | Blocks amount/currency/status edits once issued; auditLog UPDATE_RECEIPT |
| DELETE | /api/receipts/:id | Request receipt deletion (approval workflow) | requireAuth, requireTenantScope, requirePermission("delete:receipt") | Creates ApprovalRequest; 202 |
| GET | /api/payments | List payment transactions for org | requireAuth, requireTenantScope, requirePermission("read:finance") | Paginated/date-filtered; agent-scoped |
| GET | /api/policies/:id/payments | List payments for a specific policy | requireAuth, requireTenantScope, requirePermission("read:finance") | enforceAgentPolicyAccess |
| POST | /api/payments | Create payment transaction (and receipt if cleared) | requireAuth, requireTenantScope, requireAnyPermission("write:finance","receipt:cash","receipt:mobile","receipt:transfer") | Blocks agents from cash; mismatched amount → pending-approval receipt; within withOrgTransaction: advances policy cycle, inserts tx+receipt, applies status transition, writes outbox (OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP), rolls back clawbacks; auditLog CREATE_PAYMENT/CREATE_RECEIPT; idempotency-key dedupe |
| GET | /api/policies/:id/receipts | List receipts for a policy | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| GET | /api/payment-intents | List PayNow payment intents for org | requireAuth, requireTenantScope, requirePermission("read:finance") | agent-scoped |
| GET | /api/payment-intents/:id | Get single payment intent + events | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/payment-intents/:id/poll | Poll PayNow for intent status | requireAuth, requireTenantScope, requirePermission("read:finance") | Calls PayNow API pollPaynowStatus |
| POST | /api/payment-intents | Staff-side: create PayNow payment intent | requireAuth, requireTenantScope, requirePermission("write:finance") | Validates client==policy owner; auditLog CREATE_PAYMENT_INTENT |
| POST | /api/payment-intents/:id/initiate | Initiate PayNow payment for staff-created intent | requireAuth, requireTenantScope, requirePermission("write:finance") | Calls PayNow API initiatePaynowPayment |
| POST | /api/payment-intents/:id/otp | Submit O'Mari OTP to complete PayNow payment | requireAuth, requireTenantScope, requirePermission("write:finance") | Calls PayNow API submitOmariOtp |
| GET | /api/receipts/:id/download | Download receipt PDF (A4 or thermal) | requireAuth, requireTenantScope, requirePermission("read:finance") | Streams PDF |
| GET | /api/receipts/:id/view | Inline view of receipt PDF | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/admin/receipts/cash | Record a cash receipt directly (admin quick path) | requireAuth, requireTenantScope, requirePermission("write:finance") | Blocks agents; idempotency check; transaction inserts tx(cleared)+receipt; outbox OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP; auditLog CASH_RECEIPT |
| POST | /api/admin/receipts/reprint | Log a receipt reprint event | requireAuth, requireTenantScope, requirePermission("read:finance") | auditLog RECEIPT_REPRINT |
| GET | /api/month-end-run/template | Download CSV template for bulk bank-file receipting | requireAuth, requireTenantScope, requirePermission("read:finance") | Static CSV text |
| POST | /api/month-end-run | Bulk-process bank statement file: receipt policies or issue credit notes | requireAuth, requireTenantScope, requirePermission("write:finance"), multer | Postgres advisory lock to serialize runs; per row full/over → cleared tx+receipt+2.5% platform fee; underpayment → credit balance+credit note; auditLog MONTH_END_RUN |
| GET | /api/credit-notes | List credit notes by policy or client | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/group-receipt | Batch-receipt multiple policies in a group, pro-rated by premium | requireAuth, requireTenantScope, requireAnyPermission("write:finance","receipt:group") | Backdated receipts → pending-approval queue; else cleared per policy w/ 2.5% platform fee |
| GET | /api/payment-receipts/pending-approvals | List receipts pending approval | requireAuth, requireTenantScope, requireAnyPermission("approve:finance","write:finance") | |
| POST | /api/payment-receipts/:id/approve | Approve a pending receipt, applying retroactively | requireAuth, requireTenantScope, requireAnyPermission("approve:finance") | Creates cleared tx at effectiveDate; 2.5% platform fee; auditLog APPROVE_RECEIPT |
| POST | /api/payment-receipts/:id/reject | Reject a pending receipt | requireAuth, requireTenantScope, requireAnyPermission("approve:finance") | auditLog REJECT_RECEIPT |
| POST | /api/group-payment-intents | Create PayNow group payment intent, pro-rated allocations | requireAuth, requireTenantScope, requirePermission("write:finance") | Dedupes by idempotencyKey; generates merchantReference |
| GET | /api/group-payment-intents/:id | Get group payment intent | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/group-payment-intents/:id/initiate | Initiate PayNow for a group intent | requireAuth, requireTenantScope, requirePermission("write:finance") | Calls PayNow API initiatePaynowForGroup |
| POST | /api/group-payment-intents/:id/poll | Poll PayNow status for group intent | requireAuth, requireTenantScope, requirePermission("write:finance") | Calls PayNow API pollGroupPaynowStatus |
| GET | /api/paynow-config | Get org's PayNow config (no secret exposed) | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/apply-credit-balances | Apply outstanding policy credit balances to arrears/premiums | requireAuth, requireTenantScope, requirePermission("write:finance") | Calls runApplyCreditBalances |

### A15. Cashups

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/cashups/my-receipt-totals | Get current user's receipt totals for a date | requireAuth, requireTenantScope, requireAnyPermission("read:finance","receipt:cash","receipt:mobile","receipt:transfer","receipt:group") | |
| GET | /api/cashups | List cashups (agents/non-finance see only own) | requireAuth, requireTenantScope, requireAnyPermission(same) | |
| POST | /api/cashups | Create draft cashup | requireAuth, requireTenantScope, requireAnyPermission("write:finance",...) | auditLog CREATE_CASHUP |
| GET | /api/cashups/:id | Get single cashup | requireAuth, requireTenantScope, requireAnyPermission(same) | 403 if not preparer and lacks read:finance |
| PATCH | /api/cashups/:id | Submit/confirm/confirm_discrepancy a cashup | requireAuth, requireTenantScope, requireAnyPermission("write:finance",...) | Computes discrepancy, locks cashup; auditLog SUBMIT_CASHUP/CONFIRM_CASHUP |

### A16. Claims

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/claims | List claims for org | requireAuth, requireTenantScope, requirePermission("read:claim") | Cache-Control 30s |
| GET | /api/claims/:id | Get single claim | requireAuth, requireTenantScope, requirePermission("read:claim") | |
| POST | /api/claims | Submit new claim | requireAuth, requireTenantScope, requirePermission("write:claim") | Generates claimNumber; creates claimStatusHistory; auditLog CREATE_CLAIM; auto-creates approvalRequest + notifies "manage:approvals" |
| POST | /api/claims/:id/transition | Transition claim status | requireAuth, requireTenantScope, requirePermission("write:claim") | Validates VALID_CLAIM_TRANSITIONS; approved/paid require "approve:claim"; notifies submitter + client push |
| GET | /api/claims/:id/documents | List documents attached to a claim | requireAuth, requireTenantScope, requirePermission("read:claim") | |

### A17. Funerals / Mortuary — Funeral Cases, Tasks, Driver Checklist

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/funeral-cases | List funeral cases for org | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | Paginated/date-filtered |
| GET | /api/funeral-cases/:id | Get single funeral case | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/funeral-cases | Create funeral case | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | "cash" serviceType requires linked unused quotation; generates caseNumber; auditLog CREATE_FUNERAL_CASE |
| PATCH | /api/funeral-cases/:id | Update funeral case fields | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Whitelisted fields; mirrors newly assigned drivers/agents; notifies newly assigned staff; auditLog UPDATE_FUNERAL_CASE |
| GET | /api/funeral-cases/:id/document | Stream funeral case document | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamFuneralDocumentToResponse |
| GET | /api/funeral-cases/:id/tasks | List tasks for a funeral case | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/funeral-cases/:id/tasks | Create a funeral task | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog CREATE_FUNERAL_TASK |
| PATCH | /api/funeral-tasks/:id | Update a funeral task | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog UPDATE_FUNERAL_TASK |
| GET | /api/funeral-cases/:id/driver-checklist | Get driver checklist | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/funeral-cases/:id/driver-checklist | Upsert driver checklist | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog UPSERT_DRIVER_CHECKLIST |
| GET | /api/funeral-cases/:id/driver-checklist/pdf | Stream driver-checklist PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamDriverChecklistPDF |
| GET | /api/schedule/pdf | Daily schedule-of-service PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamDailyScheduleToResponse |
| GET | /api/department-report/pdf | Department report PDF | requireAuth, requireTenantScope, requirePermission("read:report") | streamDepartmentReportToResponse |
| GET | /api/funeral-cases/:id/mortuary-intake | Get linked mortuary intake for a case | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |

### A18. Funeral Quotations & Standalone Quotations

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/funeral-cases/:id/quotation | Fetch quotation for a funeral case | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/funeral-cases/:id/quotation | Create/upsert quotation with line items for a case | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Computes lineTotal per item; auditLog UPSERT_FUNERAL_QUOTATION |
| GET | /api/funeral-cases/:id/receipts | List service receipts for a case | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/funeral-cases/:id/receipts | Record cash/other payment against a quotation | requireAuth, requireTenantScope, requireAnyPermission("receipt:cash","write:finance") | Idempotency dedupe; auto-marks quotation converted/partial; auditLog CREATE_SERVICE_RECEIPT; outbox OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP |
| GET | /api/quotations | List/search standalone quotations | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/quotations | Create standalone quotation (no case link) | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog CREATE_QUOTATION |
| GET | /api/quotations/:id | Get quotation with guarantor & collateral | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| PATCH | /api/quotations/:id | Update quotation | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog UPDATE_QUOTATION |
| GET | /api/quotations/:id/pdf | Stream quotation PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/quotations/:id/link-case | Link a standalone quotation to a funeral case | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog LINK_QUOTATION_TO_CASE |
| POST | /api/quotations/:id/guarantor | Upsert guarantor for quotation | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | |
| GET | /api/quotations/:id/guarantor | Get quotation guarantor | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| GET | /api/quotations/:id/collateral | List quotation collateral items | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/quotations/:id/collateral | Add collateral item to quotation | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | |
| DELETE | /api/quotations/:id | Request deletion of quotation (maker-checker) | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Creates ApprovalRequest; 202 |
| DELETE | /api/quotations/collateral/:id | Delete a collateral item | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog DELETE_QUOTATION_COLLATERAL |
| POST | /api/quotations/:id/send-for-authorization | Submit quotation conditions for approval | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Creates ApprovalRequest type QUOTATION_CONDITIONS |

### A19. Partner Parlours

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/partner-parlours | List partner parlours | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/partner-parlours | Create partner parlour | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog CREATE_PARTNER_PARLOUR |
| PATCH | /api/partner-parlours/:id | Update partner parlour | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog UPDATE_PARTNER_PARLOUR |
| GET | /api/partner-parlours/:parlourId/personnel | List personnel for a parlour | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/partner-parlours/:parlourId/personnel | Add personnel to parlour | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog CREATE_PARLOUR_PERSONNEL |
| PATCH | /api/parlour-personnel/:id | Update personnel | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog UPDATE_PARLOUR_PERSONNEL |
| DELETE | /api/parlour-personnel/:id | Delete personnel | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog DELETE_PARLOUR_PERSONNEL |

### A20. Mortuary Register (Intakes, Dispatch, Belongings, Post-Mortem, Body Wash, Vehicle Usage)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/mortuary-intakes | List mortuary intakes | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/mortuary-intakes | Create mortuary intake | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Generates intakeNumber; auto-calcs storage fee ($10 child/$20 adult) for partner-parlour intakes; auditLog CREATE_MORTUARY_INTAKE |
| GET | /api/mortuary-intakes/:id | Get single intake | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| PATCH | /api/mortuary-intakes/:id | Update intake | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog UPDATE_MORTUARY_INTAKE w/ before/after |
| POST | /api/mortuary-intakes/:id/storage-payment | Record partner-parlour storage fee payment | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Blocks if not partner or already paid; auditLog RECORD_STORAGE_PAYMENT |
| GET | /api/mortuary-intakes/:id/dispatch | Get dispatch record | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/mortuary-intakes/:id/dispatch | Dispatch (release) a body | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Blocks if unpaid storage fee or out for post-mortem; auto-calcs chapel/wash-bay fee; atomic dispatchIntake txn; auditLog DISPATCH_BODY |
| POST | /api/mortuary-intakes/:id/chapel-wash-bay-payment | Record chapel/wash-bay fee payment | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog RECORD_CHAPEL_WASH_BAY_PAYMENT |
| GET | /api/mortuary-intakes/:id/belongings | List deceased belongings | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/mortuary-intakes/:id/belongings | Add deceased belonging | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog CREATE_BELONGING |
| DELETE | /api/belongings/:id | Delete a belonging | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog DELETE_BELONGING |
| GET | /api/mortuary-intakes/:id/post-mortem | List post-mortem out/return movements | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/mortuary-intakes/:id/post-mortem | Record body taken out for post-mortem | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | Blocks if already out/dispatched; auditLog CREATE_POST_MORTEM_MOVEMENT |
| POST | /api/post-mortem-movements/:id/return | Record body returned from post-mortem | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog RECORD_POST_MORTEM_RETURN |
| GET | /api/partner-parlour-vehicle-usage | List vehicle-usage-by-partner-parlour records | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/partner-parlour-vehicle-usage | Record partner parlour borrowing our vehicle/driver | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog CREATE_VEHICLE_USAGE |
| POST | /api/partner-parlour-vehicle-usage/:id/return | Mark vehicle usage returned | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog RECORD_VEHICLE_RETURN |
| POST | /api/partner-parlour-vehicle-usage/:id/fee-payment | Record vehicle usage fee payment | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog RECORD_VEHICLE_USAGE_FEE_PAYMENT |
| GET | /api/mortuary-intakes/:id/body-wash | Get body-wash requirements record | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | |
| POST | /api/mortuary-intakes/:id/body-wash | Upsert body-wash requirements | requireAuth, requireTenantScope, requirePermission("write:funeral_ops") | auditLog UPSERT_BODY_WASH |
| GET | /api/mortuary-intakes/:id/receipt-pdf | Mortuary intake receipt PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamMortuaryReceiptPDF |
| GET | /api/mortuary-intakes/:id/dispatch-pdf | Mortuary dispatch PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamMortuaryDispatchPDF |

### A21. Fleet

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/fleet | List fleet vehicles | requireAuth, requireTenantScope, requirePermission("read:fleet") | |
| POST | /api/fleet | Create fleet vehicle | requireAuth, requireTenantScope, requirePermission("write:fleet") | auditLog CREATE_VEHICLE |
| PUT | /api/fleet/:id | Update fleet vehicle | requireAuth, requireTenantScope, requirePermission("write:fleet") | Whitelisted fields; auditLog UPDATE_VEHICLE |

### A22. Commissions & Agent P&L

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/commission-plans | List commission plans | requireAuth, requireTenantScope, requirePermission("read:commission") | |
| POST | /api/commission-plans | Create commission plan | requireAuth, requireTenantScope, requirePermission("write:commission") | auditLog CREATE_COMMISSION_PLAN |
| GET | /api/commission-ledger | List commission ledger entries | requireAuth, requireTenantScope, requirePermission("read:commission") | Agents auto-scoped to own |
| GET | /api/agent/pnl | Agent profit & loss dashboard | requireAuth, requireTenantScope, requirePermission("read:commission") | Large aggregated JSON: collections, commission earned/paid/outstanding/clawbacks |

### A23. Leads / CRM

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/leads | List leads | requireAuth, requireTenantScope, requirePermission("read:lead") | Cache-Control 30s; agents see own leads only |
| POST | /api/leads | Create lead | requireAuth, requireTenantScope, requirePermission("write:lead") | auditLog CREATE_LEAD |
| PATCH | /api/leads/:id | Update lead | requireAuth, requireTenantScope, requirePermission("write:lead") | Agents blocked from editing others' leads; auditLog UPDATE_LEAD |

### A24. Notifications, Templates & Payment Automation

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/notification-templates | List notification templates | requireAuth, requireTenantScope, requirePermission("read:notification") | |
| POST | /api/notification-templates | Create template | requireAuth, requireTenantScope, requirePermission("write:notification") | auditLog CREATE_NOTIFICATION_TEMPLATE |
| PUT | /api/notification-templates/:id | Update template | requireAuth, requireTenantScope, requirePermission("write:notification") | auditLog UPDATE_NOTIFICATION_TEMPLATE |
| DELETE | /api/notification-templates/:id | Delete template | requireAuth, requireTenantScope, requirePermission("write:notification") | auditLog DELETE_NOTIFICATION_TEMPLATE |
| GET | /api/notification-merge-tags | Get merge-tag & event-type reference lists | requireAuth, requireTenantScope, requirePermission("read:notification") | |
| POST | /api/admin/notifications/broadcast | Broadcast a message to org users | requireAuth, requireTenantScope, requirePermission("write:notification") | auditLog BROADCAST_NOTIFICATION |
| GET | /api/payment-automation-settings | Get payment automation settings | requireAuth, requireTenantScope, requirePermission("read:notification") | |
| PUT | /api/payment-automation-settings | Update payment automation settings | requireAuth, requireTenantScope, requirePermission("manage:settings") | auditLog UPDATE_PAYMENT_AUTOMATION_SETTINGS |
| GET | /api/payment-automation-runs | List past automation runs | requireAuth, requireTenantScope, requirePermission("read:notification") | |
| POST | /api/admin/run-payment-automation | Manually trigger payment automation job for org | requireAuth, requireTenantScope, requirePermission("manage:settings") | Calls runPaymentAutomationForOrg; auditLog RUN_PAYMENT_AUTOMATION |
| GET | /api/notifications/stream | SSE stream for real-time notifications | requireAuth | sseConnect |
| GET | /api/notifications | List user notifications | requireAuth, requireTenantScope | out: {notifications, unreadCount} |
| GET | /api/notifications/unread-count | Get unread notification count | requireAuth, requireTenantScope | |
| PATCH | /api/notifications/:id/read | Mark one notification read | requireAuth, requireTenantScope | |
| PATCH | /api/notifications/mark-all-read | Mark all notifications read | requireAuth, requireTenantScope | |
| POST | /api/agent-auth/push-token | Register staff/agent device push token | requireAuth, requireTenantScope | storage.upsertUserDeviceToken |
| GET | /api/notifications/sse-stats | SSE connection diagnostics | requireAuth | out: {activeConnections} |
| POST | /api/client-auth/push-token | Register client device push token | Session-based (clientId) | |

### A25. Finance — Expenditures, FX Rates, Requisitions, Disbursements, Banking, Debit Orders

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/expenditures | List expenditures | requireAuth, requireTenantScope, requirePermission("read:finance") | Agents get empty list |
| POST | /api/expenditures | Create expenditure | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog CREATE_EXPENDITURE |
| GET | /api/fx-rates | List FX rates (USD base) | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| PUT | /api/fx-rates/:currency | Upsert FX rate for a currency | requireAuth, requireTenantScope, requirePermission("manage:settings") | auditLog UPSERT_FX_RATE |
| GET | /api/requisitions | List requisitions with items & requester info | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/requisitions | Create requisition (+ line items) | requireAuth, requireTenantScope, requirePermission("write:finance") | Generates requisitionNumber; auditLog CREATE_REQUISITION |
| PATCH | /api/requisitions/:id | Requisition workflow actions: submit/approve/reject/pay/edit | requireAuth, requireTenantScope, requirePermission("write:finance") (+approve:finance for approve/reject) | Action-based state machine; notifies approvers/requester/finance team; auditLog UPDATE_REQUISITION |
| GET | /api/requisitions/blank-form | Blank requisition PDF template | requireAuth, requireTenantScope, requirePermission("read:finance") | generateBlankRequisitionPdf |
| GET | /api/requisitions/:id/pdf | Requisition PDF | requireAuth, requireTenantScope, requirePermission("read:finance") | generateRequisitionPdf |
| GET | /api/payment-vouchers/blank-form | Blank payment voucher PDF template | requireAuth, requireTenantScope, requirePermission("read:finance") | generateBlankPaymentVoucherPdf |
| GET | /api/payment-disbursements/:id/pdf | Payment voucher PDF for a disbursement | requireAuth, requireTenantScope, requirePermission("read:finance") | generatePaymentVoucherPdf |
| GET | /api/payment-disbursements | List disbursements enriched w/ payer/receiver names | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/requisitions/:id/payments | Record a (partial) payment against a requisition | requireAuth, requireTenantScope, requirePermission("write:finance") | Generates voucherNumber; auditLog PAY_REQUISITION/PARTIAL_PAY_REQUISITION; notifies requester |
| POST | /api/expenditures/:id/payments | Record a (partial) payment against an expenditure | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog PAY_EXPENDITURE/PARTIAL_PAY_EXPENDITURE |
| GET | /api/bank-accounts | List bank accounts | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/bank-accounts | Create bank account | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog CREATE_BANK_ACCOUNT |
| PATCH | /api/bank-accounts/:id | Update bank account | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog UPDATE_BANK_ACCOUNT |
| GET | /api/bank-deposits | List bank deposits, enriched | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/bank-deposits | Record a bank deposit | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog CREATE_BANK_DEPOSIT |
| POST | /api/bank-deposits/:id/verify | Verify a bank deposit | requireAuth, requireTenantScope, requireAnyPermission("approve:finance","write:finance") | 409 if already verified; auditLog VERIFY_BANK_DEPOSIT |
| GET | /api/cash-position | Get admin cash position per user | requireAuth, requireTenantScope, requireAnyPermission("approve:finance","read:finance") | |
| GET | /api/bank-statement-balances | List bank statement balances | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/bank-statement-balances | Record a bank statement closing balance | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog CREATE_BANK_STATEMENT_BALANCE |
| GET | /api/debit-orders | List recurring premium-collection mandates | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/debit-orders | Create debit order mandate | requireAuth, requireTenantScope, requirePermission("write:finance") | Auto-generates mandateReference; status forced "active"; auditLog CREATE_DEBIT_ORDER |
| PATCH | /api/debit-orders/:id | Update debit order | requireAuth, requireTenantScope, requirePermission("write:finance") | Validates status against DEBIT_ORDER_STATUSES; auditLog UPDATE_DEBIT_ORDER |
| GET | /api/cost-sheets | List cost sheets | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/cost-sheets | Create cost sheet | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog CREATE_COST_SHEET |
| GET | /api/cost-sheets/:id/items | List line items for a cost sheet | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/cost-sheets/:id/items | Add cost line item | requireAuth, requireTenantScope, requirePermission("write:finance") | |
| GET | /api/balance-sheet-entries | List manual balance sheet entries | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/balance-sheet-entries | Create manual entry (asset/liability/equity) | requireAuth, requireTenantScope, requirePermission("write:finance") | Validates section enum, positive amount; auditLog CREATE_BALANCE_SHEET_ENTRY |
| PATCH | /api/balance-sheet-entries/:id | Update manual entry | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog UPDATE_BALANCE_SHEET_ENTRY |
| DELETE | /api/balance-sheet-entries/:id | Delete manual entry | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog DELETE_BALANCE_SHEET_ENTRY |

### A26. Payroll & Attendance (HR)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/payroll/employees | List payroll employees | requireAuth, requireTenantScope, requirePermission("read:payroll") | |
| POST | /api/payroll/employees | Create payroll employee | requireAuth, requireTenantScope, requirePermission("write:payroll") | Auto-generates employeeNumber; auditLog CREATE_PAYROLL_EMPLOYEE |
| PATCH | /api/payroll/employees/:id | Update payroll employee | requireAuth, requireTenantScope, requirePermission("write:payroll") | auditLog UPDATE_PAYROLL_EMPLOYEE |
| GET | /api/payroll/runs | List payroll runs | requireAuth, requireTenantScope, requirePermission("read:payroll") | |
| POST | /api/payroll/runs | Create payroll run (status draft) | requireAuth, requireTenantScope, requirePermission("write:payroll") | auditLog CREATE_PAYROLL_RUN |
| GET | /api/payroll/runs/:id/payslips | List payslips for run | requireAuth, requireTenantScope, requirePermission("read:payroll") | |
| GET | /api/payroll/runs/:id/payslips/:employeeId/pdf | Stream payslip PDF | requireAuth, requireTenantScope, requirePermission("read:payroll") | |
| POST | /api/payroll/runs/:id/payslips/:employeeId/send | Email payslip to employee | requireAuth, requireTenantScope, requirePermission("write:payroll") | Email via payslip-email module; auditLog SEND_PAYSLIP_EMAIL |
| POST | /api/payroll/runs/:id/send-all | Bulk-send all payslips for a run | requireAuth, requireTenantScope, requirePermission("write:payroll") | auditLog SEND_ALL_PAYSLIPS; out: {sent,failed,results} |
| PUT | /api/payroll/runs/:id/payslips/:employeeId | Upsert individual payslip values | requireAuth, requireTenantScope, requirePermission("write:payroll") | auditLog UPSERT_PAYSLIP |
| GET | /api/attendance | Admin/manager: list attendance logs | requireAuth, requireTenantScope, requirePermission("read:payroll") | |
| GET | /api/attendance/my | Employee: own attendance logs | requireAuth, requireTenantScope | |
| POST | /api/attendance | Employee: log attendance for a date | requireAuth, requireTenantScope | Validates date range; status "pending"; auditLog LOG_ATTENDANCE; 409 on duplicate |
| POST | /api/attendance/:id/approve | Approve pending attendance log | requireAuth, requireTenantScope, requirePermission("write:payroll") | auditLog APPROVE_ATTENDANCE |
| POST | /api/attendance/:id/reject | Reject pending attendance log | requireAuth, requireTenantScope, requirePermission("write:payroll") | auditLog REJECT_ATTENDANCE |

### A27. Security Questions, Agent Referral & Public Registration (unauthenticated)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/security-questions | List org's client security questions | requireAuth, requireTenantScope, requirePermission("read:client") | |
| GET | /api/agents/by-referral/:code | Public lookup of agent by referral code | Public | out: {name,referralCode} |
| GET | /api/public/tenant-context | Resolve tenant from subdomain/custom domain | Public | Reads control-plane DB |
| GET | /api/public/branding | Public branding for login/splash screens | Public | out: {name,logoUrl,primaryColor,...} |
| GET | /api/public/registration-options | List products/branches available via agent referral link | Public | query ref |
| POST | /api/public/register-policy | Public self-registration of policy via agent referral link | Public | Delegates to handlePublicPolicyRegistration; creates client/dependents/policy(status inactive)/default payment method/Lead |
| GET | /api/public/walkin-options | List products/branches for walk-in self-registration | Public | query org |
| POST | /api/public/walkin-register | Public walk-in self-registration (no agent) | Public | Same flow as register-policy, agentId=null |
| GET | /api/public/verify | QR-code scan verification for receipts/policies/forms | Public | Tenant-DB lookup w/ hintOrgId then main-DB fallback; out: {valid,...} per doc type |

Note: `handlePublicPolicyRegistration` (helper, not a route) — shared logic for both public registration endpoints: dedupes Client by email/nationalId, creates Dependents, computes premium via computePolicyPremium, validates Beneficiary, creates Policy (status "inactive") via storage.createPolicyWithInitialSetup, upserts default payment method, creates Lead (source agent_link/walk_in). Guards against duplicate active policy for same product version.

### A28. Groups & Legacy Group Receipts

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/groups | List groups for org | requireAuth, requireTenantScope, requireAnyPermission("read:policy","read:finance","write:finance") | |
| POST | /api/groups | Create group | requireAuth, requireTenantScope, requirePermission("write:policy") | auditLog CREATE_GROUP |
| PATCH | /api/groups/:id | Update group | requireAuth, requireTenantScope, requirePermission("write:policy") | auditLog UPDATE_GROUP |
| GET | /api/groups/:id/policies | List policies in a group, enriched w/ client info | requireAuth, requireTenantScope | |
| GET | /api/groups/:id/receipts | List payment receipts tagged to a group | requireAuth, requireTenantScope, requirePermission("read:finance") | Raw SQL filtered by metadata_json->>'groupId' |
| GET | /api/groups/legacy-receipts | List legacy group receipts | requireAuth, requireTenantScope, requirePermission("read:finance") | query from/to/groupId; raw SQL |
| POST | /api/groups/legacy-receipts | Record a legacy group receipt | requireAuth, requireTenantScope, requirePermission("write:finance") | Auto-generates receiptNumber (LGR-YYYYMMDD-NNN); auditLog "create"/legacy_group_receipt; async createPlatformReceivable (2.5% fee) |

### A29. Directory Contacts

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/directory-contacts | List directory contacts (undertakers, underwriters, transport), filterable | requireAuth, requireTenantScope, requirePermission("read:client") | |
| POST | /api/directory-contacts | Create directory contact | requireAuth, requireTenantScope, requirePermission("write:client") | auditLog "create"/directory_contact |
| PATCH | /api/directory-contacts/:id | Update directory contact | requireAuth, requireTenantScope, requirePermission("write:client") | auditLog "update"/directory_contact |
| DELETE | /api/directory-contacts/:id | Delete directory contact | requireAuth, requireTenantScope, requirePermission("write:client") | auditLog "delete"/directory_contact |

### A30. Platform Revenue Share / Settlements

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/platform/receivables | List platform fee receivables | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| GET | /api/platform/summary | Platform revenue summary | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| GET | /api/reports/receipting-by-user | Receipting activity report by staff/branch | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| GET | /api/settlements | List settlements | requireAuth, requireTenantScope, requirePermission("read:finance") | |
| POST | /api/settlements | Create settlement (status pending) | requireAuth, requireTenantScope, requirePermission("write:finance") | auditLog CREATE_SETTLEMENT |
| POST | /api/settlements/:id/approve | Approve a settlement (maker-checker) | requireAuth, requireTenantScope, requirePermission("manage:approvals") | Blocks self-approval; auditLog APPROVE_SETTLEMENT |

### A31. Client Feedback (staff-side)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/feedback | List client feedback (search/status/type filters) | requireAuth, requireTenantScope, requirePermission("read:client") | |
| PATCH | /api/feedback/:id/status | Update feedback status | requireAuth, requireTenantScope, requirePermission("write:client") | Validates status enum; auditLog UPDATE_FEEDBACK_STATUS |

### A32. Approvals (Maker-Checker)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/approvals | List approval requests | requireAuth, requireTenantScope, requirePermission("manage:approvals") | |
| POST | /api/approvals | Create generic approval request | requireAuth, requireTenantScope, requireAnyPermission("write:policy","write:claim","write:funeral_ops") | auditLog CREATE_APPROVAL_REQUEST |
| POST | /api/approvals/:id/resolve | Approve/reject a pending approval | requireAuth, requireTenantScope, requirePermission("manage:approvals") | Blocks self-approval; on approve executes side-effects (delete_policy/delete_receipt/delete_quote); auditLog RESOLVE_APPROVAL_APPROVE/REJECT; notifies submitter |

### A33. Dashboard Widgets / Executive Summary / Diagnostics (business-facing)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/diagnostics | System/process diagnostics + table counts | requireAuth, requireTenantScope | out: uptime, memoryUsage, tableCounts |
| GET | /api/dashboard/revenue-trend | Daily cleared-payment revenue trend | requireAuth, requireTenantScope | Agent-scoped; Cache-Control 60s |
| GET | /api/dashboard/policy-status-breakdown | Policy counts by status | requireAuth, requireTenantScope | Cache-Control 60s |
| GET | /api/dashboard/lead-funnel | Lead counts by stage | requireAuth, requireTenantScope | Agent-scoped |
| GET | /api/dashboard/covered-lives | Count of covered lives (active policy members) | requireAuth, requireTenantScope | Cache-Control 30s |
| GET | /api/dashboard/product-performance | Per-product policy/revenue performance | requireAuth, requireTenantScope | Cache-Control 60s |
| GET | /api/dashboard/lapse-retention | Policy retention/lapse rate stats | requireAuth, requireTenantScope | Cache-Control 60s; out incl. retentionRate/lapseRate |
| GET | /api/dashboard/executive-summary | Executive financial summary (income statement + cash positions + branch breakdown + claim stats + new-policy count) | requireAuth, requireTenantScope, requireAnyPermission("approve:finance","read:finance") | Builds via buildIncomeStatement + getAdminCashPosition + raw SQL branch/claims queries |

### A34. Reports (list/JSON endpoints)

All share `requireAuth, requireTenantScope`; use common `parseReportFilters(query)` (fromDate,toDate,userId,branchId,productId,agentId,status,statuses); most call `enforceAgentScope`.

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/reports/policy-details | Detailed per-policy report incl. dependents | requirePermission("read:policy") | limit up to REPORT_EXPORT_MAX_ROWS |
| GET | /api/reports/finance | Finance report rows | requirePermission("read:finance") | |
| GET | /api/reports/underwriter-payable | Underwriter payable summary | requirePermission("read:finance") | |
| GET | /api/reports/reinstatements | Policy reinstatement history | requirePermission("read:policy") | |
| GET | /api/reports/conversions | Policy conversion history | requirePermission("read:policy") | |
| GET | /api/reports/activations | Policy activation history | requirePermission("read:policy") | |
| GET | /api/reports/active-policies | Active policies only | requirePermission("read:policy") | |
| GET | /api/reports/awaiting-payments | Active+grace policies | requirePermission("read:policy") | |
| GET | /api/reports/overdue | Grace-status policies | requirePermission("read:policy") | |
| GET | /api/reports/pre-lapse | Grace-status policies (duplicate logic of overdue) | requirePermission("read:policy") | |
| GET | /api/reports/lapsed | Lapsed policies | requirePermission("read:policy") | |
| GET | /api/reports/claims | Claims report | requirePermission("read:claim") | Does NOT call enforceAgentScope |
| GET | /api/reports/issued-policies | New joinings report (issued) | requirePermission("read:policy") | |
| GET | /api/reports/new-joinings | Same data as issued-policies (duplicate) | requirePermission("read:policy") | |
| GET | /api/reports/agent-productivity | Agent productivity metrics | requirePermission("read:policy") | |
| GET | /api/reports/cashups | Cashup records | requirePermission("read:finance") | |
| GET | /api/reports/receipts | Receipt report | requirePermission("read:finance") | |
| GET | /api/reports/commissions-summary | Commission summary | requirePermission("read:commission") | |
| GET | /api/reports/commission-payments | Commission payment report | requirePermission("read:commission") | |
| GET | /api/reports/agent-portfolio | Agent's policy portfolio (JSON) | requirePermission("read:policy") | default limit 2000 |
| GET | /api/reports/agent-portfolio/pdf | Agent portfolio as streamed PDF | requirePermission("read:policy") | Dynamic import ./agent-portfolio-pdf |
| GET | /api/reports/income-statement | Income statement for date range/branch | requirePermission("read:finance") | buildIncomeStatement() |
| GET | /api/reports/cash-flow | Cash flow statement | requirePermission("read:finance") | buildCashFlowStatement() |
| GET | /api/reports/balance-sheet | Balance sheet as-of date | requirePermission("read:finance") | buildBalanceSheet() |
| GET | /api/reports/export/:type | Generate CSV export for ~50 distinct report types via `:type` switch | requirePermission("read:policy") (single perm gates ALL types incl. finance/commission/payroll) | out: text/csv attachment; ~50 supported `:type` values (policies, finance, claims, payments, funerals, fleet, expenditures, payroll, commissions, platform, and many commission-variant aliases); several types are unimplemented stubs (e.g. complaint-report returns empty) |

### A35. Diagnostics / Admin Tools

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/diagnostics/health | System health check: DB connectivity, table counts, pool stats, job stats, uptime | requirePermission("read:audit_log") | Runs SELECT 1 + per-table COUNT(*) |
| GET | /api/diagnostics/notification-failures | List last 50 failed notification_logs | requirePermission("read:notification") | |
| GET | /api/diagnostics/unallocated-payments | Stub endpoint | requirePermission("read:finance") | Always returns [] (unimplemented) |
| GET | /api/diagnostics/recent-errors | List last 50 audit_logs w/ action ILIKE '%error%' | requirePermission("read:audit_log") | |
| POST | /api/admin/migrate-tc-pv | Ad-hoc migration: adds product_version_id column+index to terms_and_conditions | requirePermission("manage:settings") | Raw ALTER TABLE/CREATE INDEX bypassing normal migrations dir |
| POST | /api/admin/run-notifications | Manually trigger daily notification sweep (birthdays, anniversaries, pre-lapse, lapse, premium-due) | requirePermission("manage:settings") | Iterates all clients/policies in org (up to 100k each); dispatchNotification per match |
| POST | /api/admin/sync-permissions | Re-seed permission catalog and org roles | requirePermission("manage:permissions") | Dynamic import ./seed; seedPermissions()+seedOrgRoles() |

### A36. End of File

| Item | Detail |
|---|---|
| Global error handler | `app.use((err, req, res, next) => ...)` — catches z.ZodError (400 w/ first error message), else structuredLog + generic 500 |
| Function close | `return httpServer;` — final close of `registerRoutes()` |
| No catch-all 404 | No explicit `app.use("*", ...)` in routes.ts (SPA fallback handled separately in `server/static.ts`) |

---

## PART B — Auxiliary Route Files

### B1. Staff Auth & Session (server/auth.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/auth/google | Initiate Google OAuth (staff) | Public (redirects to Google) | Stashes returnTo, mobile flag, tenant id in session |
| GET | /api/auth/google (fallback) | Redirect to login with "not configured" error (only if Google OAuth not configured) | Public | |
| GET | /api/auth/google/callback | OAuth callback: find/create user, block agent-only accounts, link googleId, log in | passport.authenticate("google") | Session regenerate (fixation prevention); mobile one-time token + deep link pol263://auth/callback |
| POST | /api/auth/mobile-exchange | Exchange native-WebView one-time token for a session | Public (token-gated) | req.login; single-use in-memory token map |
| GET | /api/public/auth-config | Report whether demo login / Google OAuth are enabled | Public | |
| POST | /api/auth/demo-login | Dev-only login by email, auto-creates user | Public, only when ENABLE_DEMO_LOGIN=true & non-production | req.login |
| POST | /api/agent-auth/login | Agent (email/password) login, cross-tenant + cross-DB lookup | Public (password + lockout gated) | Per-account lockout (5 attempts/15min); argon2 verify; session regenerate |
| POST | /api/auth/logout | Destroy staff session | Public (any session) | req.logout, session.destroy, clears connect.sid cookie |
| POST | /api/auth/change-password | Self-service password change | requireAuth | argon2 verify+rehash; rejects Google-only accounts |
| POST | /api/users/:id/reset-password | Admin resets another user's password | requireAuth, requireTenantScope | Requires write:user perm or platform owner |
| GET | /api/auth/me | Return current session user, roles, effective permissions | req.isAuthenticated() | Auto-clears org if org deleted/soft-deleted |

### B2. Client Auth & Session (server/client-auth.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| POST | /api/client-auth/claim | Validate activation code + policy number, return security questions | Public | Constant-time response (200ms) |
| POST | /api/client-auth/enroll | Set password/security Q&A, activate client portal account | Public | argon2 hash; optional agent auto-assign via referral code; notifyClient email/notification |
| POST | /api/client-auth/login | Client login by policy number + password | Public (lockout gated) | Legacy SHA-256 hash detection (forces reset); 5-attempt/15min lockout; session regenerate |
| GET | /api/client-auth/me | Return logged-in client basic info | Session clientId | |
| GET | /api/client-auth/tenant | Return branding info for client's org | Session clientId/clientOrgId | |
| GET | /api/client-auth/policies | List client's policies enriched w/ balance/arrears | Session clientId | Computes periods elapsed, wallet credit balance |
| GET | /api/client-auth/lookup-by-phone | Look up another client to pay on their behalf | Session | Writes lookedUpClientId/TTL to session (10 min) |
| GET | /api/client-auth/policies/:id/payments | List payments for client's own policy | Session, ownership check | |
| GET | /api/client-auth/policies/:id/members | List members on a policy | Session, ownership check | |
| GET | /api/client-auth/policies/:id/document | Stream policy certificate PDF | Session, ownership check | streamPolicyDocumentToResponse |
| GET | /api/client-auth/claims | List claims filed by client | Session | |
| POST | /api/client-auth/claims | Submit a new claim | Session, ownership check | generateClaimNumber, createClaimStatusHistory |
| GET | /api/client-auth/feedback | List client's feedback/complaints | Session | |
| POST | /api/client-auth/feedback | Submit feedback/complaint | Session | |
| POST | /api/client-auth/reset-password | Reset password via security question | Public | Constant-time response; argon2 |
| POST | /api/client-auth/change-password | Change password (logged in) | Session | |
| GET | /api/client-auth/credit-balance | Wallet/credit balance per policy | Session | |
| POST | /api/client-auth/logout | Destroy client session | Session | session.destroy, clears cookie |
| POST | /api/client-auth/payment-intents | Create a PayNow payment intent | Session (incl. looked-up client) | Calls createPaymentIntent; idempotency key required |
| POST | /api/client-auth/payment-intents/:id/initiate | Kick off PayNow payment | Session, ownership check | initiatePaynowPayment |
| POST | /api/client-auth/payment-intents/:id/otp | Submit O'Mari OTP for pending payment | Session | submitOmariOtp |
| GET | /api/client-auth/payment-intents/:id/status | Poll PayNow payment status | Session | pollPaynowStatus |
| GET | /api/client-auth/payment-intents | List client's payment intents | Session | |
| GET | /api/client-auth/receipts | List client's payment receipts | Session | |
| GET | /api/client-auth/receipts/:id/download | Download receipt PDF | Session, ownership check | getReceiptPdfPath |
| GET | /api/client-auth/paynow-config | Return PayNow public config | Session optional | |
| GET | /api/client-auth/notifications | List recent notifications (50) | Session | |
| GET | /api/client-auth/notifications/unread-count | Unread notification count | Session | |
| PATCH | /api/client-auth/notifications/:id/read | Mark one notification read | Session | |
| PATCH | /api/client-auth/notifications/mark-all-read | Mark all read | Session | |
| GET | /api/client-auth/credit-notes | List credit notes for client | Session | |
| GET | /api/client-auth/settings | Get notification tone / push settings | Session | |
| PATCH | /api/client-auth/settings | Update notification tone / push settings | Session | |
| POST | /api/client-auth/register-device | Register push device token | Session | addClientDeviceToken |
| DELETE | /api/client-auth/register-device | Remove push device token | Session | removeClientDeviceToken |
| GET | /api/client-auth/my-groups | List groups where client is executive | Session | |
| GET | /api/client-auth/group/:groupId/policies | List policies in a group (exec only) | Session, executive check | |
| POST | /api/client-auth/group-receipt | Submit bulk group payment for staff approval | Session, executive check | Creates pending payment_transaction per policy (cash, split evenly) |
| GET | /api/client-auth/dependents | List client's dependents | Session | |
| POST | /api/client-auth/dependents | Add a dependent | Session | createDependent |
| DELETE | /api/client-auth/dependents/:id | Remove a dependent | Session, ownership check | deleteDependent |
| GET | /api/client-auth/my-documents | List client's uploaded documents | Session | |
| GET | /api/client-auth/policies/:id/beneficiary | Get beneficiary on a policy | Session, ownership check | |
| PUT | /api/client-auth/policies/:id/beneficiary | Set/appoint beneficiary | Session, ownership check | updatePolicy |
| DELETE | /api/client-auth/policies/:id/beneficiary | Clear beneficiary | Session, ownership check | updatePolicy (nulls fields) |

### B3. Server Bootstrap (server/index.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/agent-auth/csrf-token | Issue CSRF token for mobile/agent app | csrfProtection middleware (generation only) | Only registered when CSRF protection enabled |
| GET | /api/health | Health check / DB connectivity probe | Public | pool.query("SELECT 1") |

Non-route middleware registered here (not endpoints, but part of the API surface's cross-cutting behavior): Helmet CSP, compression, cookie-parser, request-id middleware, body parsing, CSRF middleware (exempts PayNow result, agent/client login+logout, mobile-exchange), several express-rate-limit instances scoped to `/api`, `/api/auth`, `/api/agent-auth`, `/api/client-auth`, `/api/security-questions`, `/api/agents/by-referral`, `/api/payments/paynow/result`, `/api/reports`, POST-only limiters on policies/payments/month-end-run/upload/public registration/admin-run-notifications, tenant resolver middleware, setupAuth/setupClientAuth/registerRoutes calls, static/Vite serving, global error-handling middleware.

### B4. Policy Documents (server/policy-document.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/languages | List supported PDF translation languages | Public | |
| GET | /api/policies/:id/document | Stream policy certificate/schedule PDF (optionally translated) | requireAuth (org from session or ?orgId for mobile) | pdfkit generation; embeds logo/signature; builds verify QR; Google Translate API calls for non-English terms |
| GET | /api/policies/:id/estatement | Stream policy e-statement PDF (premium summary + payment history) | requireAuth | pdfkit generation; dateFrom/dateTo filtering; computes balance incl. wallet credit |

### B5. Static File Serving (server/static.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| — | express.static(distPath) | Serve built client assets w/ 1y immutable cache | Public | |
| GET | /(.*) (SPA fallback) | Serve index.html for all non-asset paths | Public | no-store cache headers; 404s for unmatched asset-like paths |

---

## PART C — PDF Form Generation Route Files

### C1. PDF Generation: Finance (server/routes-pdf-finance.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/payments/:id/receipt-pdf | Payment receipt PDF (Form 16) | requireAuth, requireTenantScope, requirePermission("read:finance") | streamPaymentReceiptPDF; ?download=1 |
| GET | /api/cashups/:id/cashup-pdf | Daily cashup sheet PDF (Form 17) | requireAuth, requireTenantScope, requirePermission("read:finance") | streamCashupSheetPDF |
| GET | /api/requisitions/:id/requisition-pdf | Requisition form PDF (Form 18) | requireAuth, requireTenantScope, requirePermission("read:finance") | streamRequisitionFormPDF |
| GET | /api/expenditures/:id/voucher-pdf | Expenditure voucher PDF (Form 19) | requireAuth, requireTenantScope, requirePermission("read:finance") | streamExpenditureVoucherPDF |
| GET | /api/forms/blank/payment-receipt | Blank receipt template | requireAuth | streamPaymentReceiptBlankPDF |
| GET | /api/forms/blank/cashup-sheet | Blank cashup sheet template | requireAuth | streamCashupSheetBlankPDF |
| GET | /api/forms/blank/requisition-form | Blank requisition template | requireAuth | streamRequisitionBlankPDF |
| GET | /api/forms/blank/expenditure-voucher | Blank expenditure voucher template | requireAuth | streamExpenditureVoucherBlankPDF |

### C2. PDF Generation: HR/Fleet (server/routes-pdf-hr-fleet.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/attendance/log-pdf | Attendance log PDF (Form 20), date-filterable | requireAuth, requireTenantScope, requirePermission("read:payroll") | streamAttendanceLogPDF |
| GET | /api/payroll/employees/:id/enrollment-pdf | Employee enrollment PDF (Form 21) | requireAuth, requireTenantScope, requirePermission("read:payroll") | streamEmployeeEnrollmentPDF |
| GET | /api/fleet/:id/registration-pdf | Vehicle registration record PDF (Form 23) | requireAuth, requireTenantScope, requirePermission("read:fleet") | streamVehicleRegistrationPDF |
| GET | /api/fleet/:id/fuel-log-pdf | Fuel log PDF (Form 24) | requireAuth, requireTenantScope, requirePermission("read:fleet") | streamFuelLogPDF |
| GET | /api/fleet/:id/maintenance-pdf | Maintenance record PDF (Form 25) | requireAuth, requireTenantScope, requirePermission("read:fleet") | streamMaintenanceRecordPDF |
| GET | /api/fleet/driver-assignments/:id/assignment-pdf | Driver assignment slip PDF (Form 26) | requireAuth, requireTenantScope, requirePermission("read:fleet") | streamDriverAssignmentPDF |
| GET | /api/leads/:id/lead-pdf | Lead capture form PDF (Form 27) | requireAuth, requireTenantScope, requirePermission("read:lead") | streamLeadCapturePDF |
| GET | /api/fleet/:id/trip-log-pdf | Vehicle trip/mileage log PDF (Form 28) | requireAuth, requireTenantScope, requirePermission("read:fleet") | streamVehicleTripLogPDF |
| GET | /api/forms/blank/attendance-log | Blank attendance log | requireAuth, requireTenantScope | streamAttendanceLogBlankPDF |
| GET | /api/forms/blank/employee-enrollment | Blank employee enrollment | requireAuth, requireTenantScope | streamEmployeeEnrollmentBlankPDF |
| GET | /api/forms/blank/payslip | Blank payslip | requireAuth, requireTenantScope | streamPayslipBlankPDF |
| GET | /api/forms/blank/vehicle-registration | Blank vehicle registration | requireAuth, requireTenantScope | streamVehicleRegistrationBlankPDF |
| GET | /api/forms/blank/fuel-log | Blank fuel log | requireAuth, requireTenantScope | streamFuelLogBlankPDF |
| GET | /api/forms/blank/maintenance-record | Blank maintenance record | requireAuth, requireTenantScope | streamMaintenanceRecordBlankPDF |
| GET | /api/forms/blank/driver-assignment | Blank driver assignment slip | requireAuth, requireTenantScope | streamDriverAssignmentBlankPDF |
| GET | /api/forms/blank/lead-capture | Blank lead capture form | requireAuth, requireTenantScope | streamLeadCaptureBlankPDF |
| GET | /api/forms/blank/vehicle-trip-log | Blank vehicle trip log | requireAuth, requireTenantScope | streamVehicleTripLogBlankPDF |

### C3. PDF Generation: Mortuary (server/routes-pdf-mortuary.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/forms/blank/mortuary-intake | Blank mortuary intake form | requireAuth | streamMortuaryIntakeBlankPDF |
| GET | /api/forms/blank/mortuary-dispatch | Blank mortuary dispatch form | requireAuth | streamMortuaryDispatchBlankPDF |
| GET | /api/forms/blank/deceased-belongings | Blank belongings form | requireAuth | streamBelongingsBlankPDF |
| GET | /api/forms/blank/body-wash | Blank body wash form | requireAuth | streamBodyWashBlankPDF |
| GET | /api/forms/blank/driver-checklist | Blank driver checklist | requireAuth | streamDriverChecklistBlankPDF |
| GET | /api/forms/blank/funeral-case-worksheet | Blank funeral case worksheet | requireAuth | streamFuneralCaseWorksheetBlankPDF |
| GET | /api/forms/blank/storage-receipt | Blank storage receipt | requireAuth | streamStorageReceiptBlankPDF |
| GET | /api/forms/blank/funeral-quotation | Blank funeral quotation | requireAuth | streamFuneralQuotationBlankPDF |
| GET | /api/mortuary-intakes/:id/belongings-pdf | Filled belongings form PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamBelongingsFormPDF |
| GET | /api/mortuary-intakes/:id/body-wash-pdf | Filled body wash form PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamBodyWashFormPDF |
| GET | /api/mortuary-intakes/:id/storage-receipt-pdf | Filled storage receipt PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamStorageReceiptPDF |
| GET | /api/funeral-cases/:id/worksheet-pdf | Filled funeral case worksheet PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamFuneralCaseWorksheetPDF |
| GET | /api/funeral-cases/:id/tasks-pdf | Funeral task sheet PDF | requireAuth, requireTenantScope, requirePermission("read:funeral_ops") | streamFuneralTaskSheetPDF |

### C4. PDF Generation: Policy (server/routes-pdf-policy.ts)

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| GET | /api/clients/:id/registration-pdf | Client registration PDF (Form 10) | requireAuth, requireTenantScope, requirePermission("read:client") | streamClientRegistrationPDF |
| GET | /api/clients/:id/dependents-pdf | Dependent registration PDF (Form 12) | requireAuth, requireTenantScope, requirePermission("read:client") | streamDependentRegistrationPDF |
| GET | /api/policies/:id/application-pdf | Policy application PDF (Form 11) | requireAuth, requireTenantScope, requirePermission("read:policy") | streamPolicyApplicationPDF |
| GET | /api/waiting-period-waivers/:id/waiver-pdf | Waiting period waiver request PDF (Form 13) | requireAuth, requireTenantScope, requirePermission("manage:approvals") | streamWaiverRequestPDF |
| GET | /api/claims/:id/submission-pdf | Claim submission PDF (Form 15) | requireAuth, requireTenantScope, requirePermission("read:claim") | streamClaimSubmissionPDF |
| GET | /api/forms/blank/client-registration | Blank client registration form | requireAuth | streamClientRegistrationBlankPDF |
| GET | /api/forms/blank/policy-application | Blank policy application form | requireAuth | streamPolicyApplicationBlankPDF |
| GET | /api/forms/blank/dependent-registration | Blank dependent registration form | requireAuth | streamDependentRegistrationBlankPDF |
| GET | /api/forms/blank/waiver-request | Blank waiver request form | requireAuth | streamWaiverRequestBlankPDF |
| GET | /api/forms/blank/debit-order-mandate | Blank debit order mandate | requireAuth | streamDebitOrderMandateBlankPDF |
| GET | /api/forms/blank/claim-submission | Blank claim submission form | requireAuth | streamClaimSubmissionBlankPDF |

---

## Cross-Cutting Observations

- **Auth middleware pattern**: nearly every staff route uses `requireAuth, requireTenantScope, requirePermission("x")` or `requireAnyPermission([...])`. Agent-role users are further restricted at the query layer (agent-scoped filtering via `isAgentScoped()`, `enforceAgentScope()`, `enforceAgentPolicyAccess()`, `isClientAccessibleByAgent()`) rather than by a separate middleware — permission checks gate the endpoint, row-level scoping happens inside handlers.
- **Client portal** (`/api/client-auth/*`) uses session-based auth (`req.session.clientId`/`clientOrgId`) rather than the staff Passport session, and is a fully separate auth domain from `/api/auth/*` (staff) — see `server/client-auth.ts`.
- **Public/no-auth routes** are a small, deliberate set: PayNow webhook, public branding/tenant-context, public policy self-registration (agent-link and walk-in), public verify (QR), agent-by-referral lookup, health check, app-latest-release, and the SPA/static asset serving.
- **Maker-checker/approval workflow** is reused across several delete/backdated operations: policy deletion, receipt deletion, quotation deletion, settlement approval, waiver resolution, and claim review all route through `approval_requests` + `/api/approvals/:id/resolve` rather than immediate mutation.
- **Idempotency** is explicitly enforced (via client-supplied `idempotencyKey`) on: payment creation, cash receipt creation, group payment intents, and the auto-payment-automation scheduler's daily attempt key.
- **PDF generation** is extensive — roughly 40 distinct "Form N" documents (policy, HR/fleet, finance, mortuary) plus blank templates for each, all funneled through 4 dedicated route files registered from `routes.ts`.
- **Outbox pattern** (`insertOutboxMessageInTx` / `requestOutboxDrain`) is used for asynchronous platform-fee/follow-up side effects tied to payment receipts (`OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP`, `OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP`, `OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP`).
- **Report export mega-route** (`GET /api/reports/export/:type`) is a single endpoint gated by one permission (`read:policy`) covering ~50 report types spanning finance, commissions, and payroll — this is a notable authorization design choice (broad single-permission gate) and contains several unimplemented/stub report types (e.g. `complaint-report`).


---

# Section 15 — Events & Existing Architecture Plans (Research Dossier)

> Fact-finding only. Compiled from direct source reading (`server/*.ts`) and the repo's own `docs/*.md`.
> Repo state at time of writing: branch `main`, working tree has uncommitted changes for legacy-group
> receipt fee dating, premium-override approvals, age-band member pricing, chapel/wash-bay fees
> (per `git log` HEAD `60a43ca`). Any doc silent on these features predates them.

---

# PART A — EVENTS: cron jobs, background jobs, queues, webhooks, notifications

## A.1 Job queue (`server/job-queue.ts`)

**Mechanism:** Pure **in-memory, in-process** fire-and-forget dispatcher. No Redis, no DB table, no
external broker. A `pendingQueue: (() => void)[]` array plus an `activeCount` counter implement a
simple concurrency-capped scheduler:

- `enqueueJob(name, data, fn)` records a `JobEntry` (name/data/status/timestamps) in a capped ring
  buffer (`recentJobs`, max 200, for the `/diagnostics`-style `getJobStats()` introspection) and either:
  - runs `fn()` immediately via `setImmediate` if under the concurrency cap, or
  - queues the closure if `pendingQueue.length < MAX_PENDING_JOBS`, or
  - **drops the job** and logs an error if the pending queue is already full.
- `MAX_CONCURRENT` = `JOB_MAX_CONCURRENT` env (default **5**).
- `MAX_PENDING_JOBS` = `JOB_MAX_PENDING` env (default **500**) — a deliberate OOM guard ("Fix 10" in
  comments) so a burst of jobs can't grow the heap unboundedly; excess jobs are dropped, not queued.
- On completion (`.then`/`.catch`/`.finally`), `tryRunNext()` pulls the next pending closure.
- Failures are caught per-job and logged via `structuredLog("error", …)`; **no automatic retry** —
  once a job's promise rejects it is marked `failed` and abandoned (retry, if any, is the caller's
  responsibility, e.g. the outbox pattern below re-enqueues itself independently).
- `drainActiveJobs(timeoutMs = 30_000)` — polls every 100 ms until `activeCount === 0` or timeout;
  called from the SIGTERM/SIGINT graceful-shutdown handler in `server/index.ts` so in-flight jobs
  (PDF generation, commission calc, notification dispatch) get a chance to finish before the process
  exits.
- The module's own doc comment says: *"When REDIS_URL is available in production, this module can be
  swapped for BullMQ workers"* — this is aspirational, not implemented. Today Redis is used only for
  rate limiting (`rate-limit-redis-store.ts`), never for jobs.
- **Not durable.** A process crash/restart loses all pending and in-flight (non-outbox) jobs silently.
  This matters for the direct `enqueueJob("notify:*", …)` call sites below, which have no persistence
  fallback (unlike the outbox-backed payment follow-ups).

**Job types actually registered** (grep of `enqueueJob(` call sites):
| Job name | Enqueued from | Purpose |
|---|---|---|
| `outbox:drain` | `server/outbox.ts` `requestOutboxDrain()` | Drain a specific org's outbox soon after an HTTP handler returns |
| `policy_premium_backfill` | `server/routes.ts:147` | Backfill/recompute premium data for an org (admin-triggered) |
| `notify:policy_capture` | `server/routes.ts:2463` | Fire policy-created notification async |
| `notify:transition` | `server/routes.ts:2865` | Fire policy status-transition notification async |
| `notify:member_added` | `server/routes.ts:3180` | Fire member-added notification async |
| `notify:reinstatement` | `server/routes.ts:3965` | Fire policy-reinstatement notification async |

| Trigger | Frequency | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| HTTP request completes a mutation that needs an async side-effect | On-demand, per request | Runs the given closure off the request/response cycle | Logged, no retry, job dropped silently if queue full (>500 pending) | None (pure in-process) |

---

## A.2 Transactional outbox (`server/outbox.ts`, `server/outbox-handlers.ts`, `server/outbox-constants.ts`)

**Backing store:** the `outbox_messages` Postgres table (per-tenant, via `getDbForOrg`/`withOrgTransaction`).
Columns implied by usage: `id, organizationId, type, payloadJson, dedupeKey, status, attempts, lastError,
processedAt, createdAt`. A **unique constraint on `(organizationId, dedupeKey)`** backs
`.onConflictDoNothing()` for idempotent enqueue.

**Event types handled** (`outbox-constants.ts`):
- `payment_staff_followup` — after a staff-recorded payment (`OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP`)
- `cash_receipt_followup` — after a cash receipt (`OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP`)
- `paynow_apply_followup` — after a PayNow payment is applied (`OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP`)
- `service_receipt_followup` — after a funeral-service cash receipt (`OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP`)

**How/when drained:**
1. **Immediate path:** `requestOutboxDrain(orgId)` calls `enqueueJob("outbox:drain", …)` right after the
   row is inserted in the same DB transaction as the domain write — so the drain attempt happens
   almost immediately after the HTTP response, via the in-memory job queue above.
2. **Background sweep (safety net):** `startOutboxBackgroundDrain()` — a `setInterval` (default
   `OUTBOX_DRAIN_INTERVAL_MS` = **60,000 ms**, i.e. every 60s) that iterates **all organizations** in
   batches of 5 (`OUTBOX_SWEEP_BATCH`) and calls `drainOutboxForOrg(id, 15)` for each, catching stuck
   rows left over from a missed `requestOutboxDrain` call or a crash between insert and drain. A
   `backgroundDrainRunning` boolean guard prevents overlapping ticks if one sweep runs longer than the
   interval. Started once, at server boot, in `server/index.ts` (`startOutboxBackgroundDrain()` inside
   the `httpServer.listen()` callback).
3. **Draining mechanics** (`drainOutboxForOrg`): selects up to `limit` (25 for immediate, 15 for sweep)
   pending message IDs (ordered by `createdAt`), then for each row opens its **own** DB transaction,
   re-selects the row with `SELECT … FOR UPDATE SKIP LOCKED` (so concurrent drainers/instances never
   double-process the same message), and either:
   - calls `handleOutboxMessage(orgId, row)` and marks `status: "done"`, or
   - on handler throw, increments `attempts`; if `attempts >= MAX_ATTEMPTS` (**8**), marks
     `status: "failed"` (dead-letter, no further retries); otherwise leaves `status: "pending"` so the
     next sweep retries it. Errors are logged via `structuredLog("error", …)`.

**Handlers (`outbox-handlers.ts`)** — must be idempotent since a message can be retried:
- `runPaymentStaffFollowup` — generates the receipt PDF if missing, creates the 2.5% platform
  receivable (idempotent via `hasPlatformReceivableForTransaction` check), records agent commission
  (idempotent via `hasCommissionLedgerForTransaction`), dispatches the `payment_received` client
  notification/template, pushes an Expo notification to the client, and notifies the policy's agent
  via `notifyUser`.
- `runCashReceiptFollowup` — same PDF/platform-receivable/commission/notification pattern for cash
  receipts, dispatches `payment_receipt` notification.
- `runPaynowApplyFollowup` — records `marked_paid`/`receipt_issued` payment events (idempotent via
  checking existing event types), generates the receipt PDF, creates the platform receivable,
  writes an in-app notification log, and computes agent commission from the active `CommissionPlan`
  (first-N-months rate vs recurring rate based on count of prior cleared payments).
- `runServiceReceiptFollowup` — creates the 2.5% platform receivable for a funeral-service cash
  receipt (idempotent via `hasPlatformReceivableForServiceReceipt`).

| Trigger | Frequency/mechanism | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| Domain write (payment/receipt) commits, inserts outbox row | Immediate (job-queue) + 60s background sweep per org, batched 5 orgs at a time | PDF generation, platform-fee accrual, commission ledger entries, client/agent notifications | Per-row transaction with `FOR UPDATE SKIP LOCKED`; retried up to 8 attempts, then `status: "failed"` (dead-lettered, needs manual/DB intervention — no dead-letter UI found) | Postgres row locking; `job-queue.ts` for immediate path; `notifications.ts`, `push.ts`, `route-helpers.ts` (commission), `receipt-pdf.ts` |

---

## A.3 Backup sync (`server/backup-sync.ts`)

**Trigger:** Fully **time-scheduled**, not event-driven. `startBackupScheduler()` computes ms until
next **00:00 UTC+2 (22:00 UTC)** using `setTimeout` (self-rescheduling — after each run it calls
`scheduleNext()` again), i.e. a **daily** cron-like job implemented without a cron library. Can also
be invoked manually (`runBackupSync("manual")` — the function signature supports a `triggeredBy`
discriminator, implying a manual-trigger admin action exists elsewhere, e.g. a diagnostics/admin route).
Gated entirely on `SUPABASE_BACKUP_URL` env var being set — if absent, both the scheduler and any
manual run are silently skipped.

**What it backs up:** a **full re-select** (not incremental/delta) of ~100 tenant tables (see the
`TENANT_FULL_SYNC_TABLES` array — clients, policies, payments, claims, funeral ops, fleet, payroll,
groups, requisitions, mortuary/partner-parlour tables, etc.) plus 7 control-plane tables (`tenants`,
`tenant_domains`, `tenant_databases`, `tenant_storage`, `tenant_integrations`, `tenant_branding`,
`tenant_feature_flags`) plus 5 registry/shared tables (`organizations`, `users`, `sessions`,
`app_download_interests`, `app_releases`). The doc comment explains the earlier version was
**incremental** (`created_at`-windowed, "now minus 24h") and had two silent-drift bugs: (1) it never
re-synced rows whose fields changed after creation (status transitions, voided receipts), and (2) a
missed run created a permanent gap for anything older than the 24h window. The full-resync design
deliberately trades some daily cost for correctness at current data scale (a few thousand rows/table).

**Where to:** one **Supabase** database (`SUPABASE_BACKUP_URL`, presumably the pooler on port 6543) —
a single consolidated mirror of all three source DBs (shared registry, control-plane, and every
tenant DB whether isolated or shared). Upserts use `ON CONFLICT (pk) DO UPDATE` (idempotent, safe to
re-run) with `SET session_replication_role = replica` to bypass FK-order constraints during load
(since a full snapshot is inserted without dependency ordering). **Known limitation, explicitly
documented in code:** this is upsert-only — rows deleted from the source are **never** deleted from
the backup, so the backup can accumulate stale rows.

**Concurrency control:** a Postgres advisory lock (`pg_try_advisory_lock(987654321)`) on the main pool
ensures only one instance/process runs the backup at a time under horizontal scaling; if another
instance holds the lock, the run is skipped (logged, not an error).

**Run history:** each run inserts/updates a row in `backupSyncRuns` (control-plane schema) with
`startedAt/completedAt/status(running|success|partial|failed)/totalRows/tableCount/errorCount/errors`
— queryable via `getRecentBackupRuns()`, presumably surfaced in a diagnostics/health screen.

**Shutdown:** `stopBackupScheduler()` is called from the graceful-shutdown handler in `server/index.ts`
to clear the pending `setTimeout` on SIGTERM/SIGINT.

| Trigger | Frequency/mechanism | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| Daily self-rescheduling `setTimeout` at 00:00 UTC+2, or manual invocation | Daily (or on-demand) | Full-table mirror of registry + control-plane + every tenant DB into one Supabase backup DB | Per-table try/catch (accumulates into an `errors[]` list, run marked `partial` if any occurred, `failed` on fatal exception); advisory lock prevents concurrent runs across instances | `SUPABASE_BACKUP_URL` env; `pg.Pool`; `getDbForOrg`; `control-plane-db.ts` |

---

## A.4 In-app notifications (`server/notifications.ts`, `server/user-notifications.ts`)

Two parallel notification systems exist:

**Client-facing (`notifications.ts`)** — event-driven templating for **clients** (policyholders).
- `EVENT_TYPES` (18 types): `policy_capture`, `policy_activated`, `payment_received`,
  `payment_receipt`, `premium_due`, `grace_start`, `pre_lapse_warning`, `policy_lapsed`,
  `policy_cancelled`, `reinstatement`, `status_change`, `member_added`, `member_removed`, `birthday`,
  `anniversary`, `policy_update`, `general_notice`, `activation`.
- `DEFAULT_MESSAGES` provides a subject/body template per event with merge tags (`{client_name}`,
  `{policy_number}`, `{premium_amount}`, etc. — 23 tags total, `MERGE_TAGS` export documents them for
  an admin UI).
- `dispatchNotification(orgId, eventType, clientId, ctx)` — looks up admin-configured
  `notification_templates` for the org+event (per-channel; multiple templates possible); if none
  exist, falls back to the built-in `DEFAULT_MESSAGES`. Always ends by writing a
  `notification_logs` row (`storage.createNotificationLog`) — this is the single source of truth for
  "was this notification sent."
- `notifyClientPush` additionally calls `pushToClient` (Expo) alongside the log write.
- `broadcastNotification(orgId, subject, bodyTemplate)` — iterates **all** clients of an org
  (`storage.getClientsByOrg(orgId, 100000, 0)` — loads up to 100k rows into memory) and writes one
  notification log per client; used for admin broadcast/announcement features.
- This module is called both synchronously from route handlers and asynchronously from the outbox
  handlers and the payment-automation scheduler (below).

**Staff/agent-facing (`user-notifications.ts`)** — `notifyUser(orgId, userId, payload)`:
1. Persists a row via `storage.createUserNotification` (the agent-app inbox, `user_notifications` table).
2. Emits an **SSE event** (`sseEmit`) for instant delivery to any open browser/app tab, including a
   freshly computed unread count.
3. Sends an **Expo push** (`pushToUser`) for background/locked-screen delivery.
`notifyUsersWithPermission(orgId, permission, payload)` fans this out to every user holding a given
permission (e.g. "all claims managers"). Documented notification types: `TRIP_ASSIGNED`,
`CLAIM_SUBMITTED`, `CLAIM_STATUS`, `APPROVAL_NEEDED`, `APPROVAL_RESOLVED`, `PAYMENT_RECEIVED`,
`COMMISSION_EARNED`, `POLICY_ISSUED`, `ATTENDANCE_RESOLVED`, `GENERAL`.

| Trigger | Frequency/mechanism | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| Domain event (payment, policy transition, claim, approval, etc.) in route handlers or outbox handlers | On-demand, synchronous call | Writes notification log (client) or user_notification row (staff) + push + (staff only) SSE | try/catch around each call site; logs error, never throws to caller (best-effort, `.catch(() => {})` common) | `storage.ts`, `push.ts`, `sse.ts` |

---

## A.5 Push notifications (`server/push.ts`)

**Mechanism:** Expo Push API via the `expo-server-sdk` npm package (`Expo` client, no custom queue).
- `pushToUser(orgId, userId, payload)` / `pushToClient(orgId, clientId, payload)` — load all device
  tokens for the target, filter to valid Expo push tokens (`Expo.isExpoPushToken`), chunk via
  `expo.chunkPushNotifications`, and send each chunk with `expo.sendPushNotificationsAsync`.
- `pushToOrgUsers(orgId, payload, filter?)` — fan-out to every device token in an org, with an
  optional per-user filter predicate (e.g. only users matching a role).
- **Stale token cleanup:** if a push ticket comes back with `status: "error"` and
  `details.error === "DeviceNotRegistered"`, the token is deleted (`removeUserDeviceToken` /
  `removeClientDeviceToken`) — self-healing token hygiene.
- **Failure handling:** a failed Expo API call for one chunk is logged and does not abort other
  chunks; individual bad tickets are handled per-token (best-effort, `try { await onInvalid(...) } catch {}`).
- **Documented scale upgrade path** (comment in file): for >500 concurrent users, replace direct Expo
  HTTP calls with a Redis queue (Bull/BullMQ) behind `PUSH_BACKEND=redis` — **not implemented**, purely
  a design note for later.

| Trigger | Frequency/mechanism | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| Called from `notifications.ts`, `user-notifications.ts`, `outbox-handlers.ts` | On-demand | Sends Expo push notification(s) to one/many device tokens | Logs chunk failures; auto-deletes `DeviceNotRegistered` tokens; never throws | `expo-server-sdk`; `storage.ts` device-token tables |

---

## A.6 Server-Sent Events (`server/sse.ts`)

**Mechanism:** In-process `Map<userId, Set<Response>>` of open SSE connections — **no Redis pub/sub
today** (a full Redis-backed design is sketched in a comment for the `REALTIME_BACKEND=redis` upgrade
path, again unimplemented). Deliberately scoped to **staff/agent users only** — there is no client
(policyholder) SSE channel; clients get push + notification_logs only.
- `sseConnect(userId, req, res)` — sets SSE headers (`text/event-stream`, no caching/buffering,
  `X-Accel-Buffering: no` for nginx compatibility), registers the response stream, sends a `connected`
  confirmation event, and starts a **25-second keep-alive ping** (`setInterval` writing `: ping\n\n`)
  to prevent proxy/load-balancer idle timeouts. Cleans up on `req.on("close"/"error")`.
- `sseEmit(userId, event)` — writes a `data: {...}\n\n` payload to every open connection (tab/device)
  for that user; no-op if the user has no open connection (fire-and-forget, not queued for later
  delivery — a disconnected user simply misses the real-time event and relies on the persisted
  `user_notifications` row + push for eventual delivery).
- Endpoint: `GET /api/notifications/stream` (per the file's doc comment) — kept open by the client.
- **Events pushed over SSE:** exclusively `type: "notification"` events from `notifyUser()` (title,
  body, metadata, unreadCount, createdAt). No other event types are pushed via SSE currently (e.g. no
  live dashboard updates, no live payment-status push — those use client-side polling instead, see A.7).

| Trigger | Frequency/mechanism | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| `notifyUser()` call anywhere in the backend | On-demand, per notification | Instant in-app delivery of a notification to open staff/agent tabs | No-op if disconnected (relies on DB row + push as fallback); 25s keepalive ping | In-process `Map`; Express response streaming |

---

## A.7 PayNow polling (`server/payment-service.ts`)

PayNow has **no webhooks for polling** in the traditional sense from the client's perspective, but
POL263 actually implements **both** an inbound webhook AND client-driven polling:

### A.7.1 Inbound webhook (real webhook, not polling)
`POST /api/payments/paynow/result` (registered in `server/routes.ts` around line 450) — **no auth**,
hash-verified in-handler, **always returns HTTP 200** (even on internal error) so PayNow does not
retry indefinitely (payment application is idempotent so a benign duplicate delivery is harmless).
Rate-limited to 60 req/min per IP (`server/index.ts`). Handled by `handlePaynowResult()`:
- Resolves which tenant/integration-key to verify against: prefers `?org=<orgId>` query param
  (embedded in the per-tenant result URL given to PayNow); falls back to scanning all orgs' keys for
  a legacy/single-tenant setup.
- Verifies SHA-512 hash (`verifyPaynowHash`); rejects (`ok:false`) on mismatch, logged as a warning.
- Looks up the payment intent (or group payment intent) by `merchantReference` across the resolved
  org(s) in parallel (`Promise.all`).
- On a "paid" status: validates amount matches expectation (`paynowAmountMatches`) — mismatch is
  logged as an error and **held** (not applied) rather than silently trusting the webhook.
- Calls `applyPaymentToPolicy()` (or `applyGroupPaymentToPolicies()`), which is idempotent (checks
  `intent.status === "paid"` before reapplying).
- On "failed" status: marks the intent `failed` (unless already failed) and logs a `marked_failed`
  payment event.

### A.7.2 Client-driven polling (the actual "PayNow has no webhooks so we poll" mechanism)
`pollPaynowStatus(intentId, orgId)` / `pollGroupPaynowStatus(...)` — calls PayNow's `pollUrl`
(returned at intent-initiation time) via `POST` with an 8-second fetch timeout
(`AbortSignal.timeout(8000)`), parses the URL-encoded response, verifies the hash, and applies the
payment on a "paid" status (same amount-match guard as the webhook path) or marks it `failed`.

**Trigger for polling is entirely client-side**, via TanStack Query `refetchInterval` on the frontend:
- `POST /api/payment-intents/:id/poll` route (staff) — called by `client/src/pages/staff/finance.tsx`,
  `client/src/pages/staff/policies.tsx`, `client/src/components/receipt-drawer.tsx` with
  `refetchInterval: 3000–5000` ms (3–5 seconds), `refetchIntervalInBackground: true`, and a dynamic
  stop condition (`(q) => q.state.data?.paid === true || status === "failed" ? false : 3000`) — i.e.
  the frontend polls every 3–5s **until** the intent resolves to paid/failed, then stops automatically.
- Same pattern for group payments (`/api/group-payment-intents/:id/poll`) in `staff/groups.tsx` and
  `staff/finance.tsx`.
- Client portal (`client/src/pages/client/payments.tsx`) polls its own
  `/api/client-auth/payment-intents/:id` at a flat 5000ms while a payment intent is in flight.

**Give-up/timeout behavior:** There is **no server-side timeout state machine** that auto-expires a
stuck intent — the intent simply stays in `pending_user`/`pending_paynow` status until (a) the client
stops polling (tab closed / user navigates away) or (b) a poll eventually returns paid/failed. The
`PAYMENT_INTENT_STATUSES` enum does include an `expired` state but no code path was found that
actively transitions an intent to `expired` on a timer — it appears to be a defined-but-unused status,
or set manually/administratively. This is flagged as a documented risk in
`docs/POL263-FUNCTIONAL-BLUEPRINT.md` and `docs/SYSTEM-SPEC.md §9.3` ("worth reviewing … what happens
to in-flight intents on restart").

| Trigger | Frequency/mechanism | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| (a) PayNow inbound webhook POST; (b) frontend TanStack Query poll every 3–5s while intent pending | (a) event-driven, whenever PayNow calls back; (b) fixed-interval client poll, self-stopping on resolution | Verifies hash + amount, applies payment/receipt/commission via outbox, transitions policy status | (a) always HTTP 200 to stop PayNow retries, amount-mismatch held not applied; (b) 8s fetch timeout per poll, hash-mismatch returns a "verifying" transient state rather than erroring; no automatic intent expiry timer found | `paynow-hash.ts`, `paynow-config.ts`, outbox (`paynow_apply_followup`) |

---

## A.8 Payment automation scheduler (`server/routes.ts`, inside `registerRoutes`)

A **separate** recurring job from the outbox/backup schedulers, found via grepping `setInterval` in
`routes.ts` (line ~371), registered once at server boot (inside `registerRoutes`, called from
`server/index.ts`).

- **Interval:** `automationTickMs = max(60_000, PAYMENT_AUTOMATION_TICK_MS env || 6 hours)` — default
  **every 6 hours**. Overlap-guarded with a `paymentAutomationTickRunning` boolean plus a **Postgres
  advisory lock** (`withAdvisoryLock(PAYMENT_AUTO_LOCK_KEY = 9_002_630_001, …)`) so only one server
  instance runs the tick even under horizontal scaling.
- **What it does (`runPaymentAutomationForOrg`)**, per organization, only if that org's
  `payment_automation_settings.isEnabled` is true:
  1. Bulk-loads each policy's last-cleared-payment date (one GROUP BY query, not N+1).
  2. Paginates active/grace policies (200/page) to avoid loading the whole book into memory.
  3. For each policy overdue by `settings.daysAfterLastPayment` (default 30) since baseline, and not
     already touched within `settings.repeatEveryDays` (default 30):
     - If `settings.autoRunPayments` is on: looks up the client's default saved payment method. Only
       **mobile wallet** methods (EcoCash/OneMoney/InnBucks/O'Mari) are auto-charged — legacy saved
       **cards** are explicitly skipped (comment: automation can only trigger a PayNow USSD/PIN flow,
       not silently charge a stored card). Creates a `PaymentIntent` + calls `initiatePaynowPayment`
       with an idempotency key scoped to the policy+day (`auto-${policy.id}-${date}`), so re-running
       the tick same-day is a no-op.
     - Always dispatches a `premium_due` notification (and optional push) regardless of auto-pay outcome.
     - Every scan outcome (reminded/attempted/skipped, with a reason) is recorded as a
       `payment_automation_runs` row for audit/observability (surfaced presumably in
       `StaffNotifications` per the functional blueprint).
- **Failure handling:** the whole tick's try/catch logs `structuredLog("error", "Payment automation
  scheduler failed", …)`; a failure for one org does not appear to abort the loop over remaining orgs
  (each `runPaymentAutomationForOrg` call is awaited sequentially inside the loop, and errors thrown
  from inside it would propagate to the outer catch — worth flagging as a possible one-org failure
  cascading to skip remaining orgs in that tick; not fully verified without reading the full function
  body around the loop).

| Trigger | Frequency/mechanism | What it does | Failure handling | Dependencies |
|---|---|---|---|---|
| `setInterval` started at server boot | Every 6h by default (`PAYMENT_AUTOMATION_TICK_MS`) | Scans overdue active/grace policies per org, sends premium-due reminders, optionally auto-initiates PayNow mobile-wallet collection | Advisory lock + in-process boolean prevent overlap/duplication across instances/ticks; per-org run logged to `payment_automation_runs`; whole-tick errors logged, not retried until next interval | `advisory-lock.ts`, `storage.ts`, `payment-service.ts`, `notifications.ts`, `push.ts` |

---

## A.9 Other `setInterval`/scheduling found (exhaustive grep of `setInterval|node-cron|cron.schedule|schedule`)

| Location | Purpose | Interval |
|---|---|---|
| `server/auth.ts:25` | Sweeps expired one-time mobile-OAuth exchange tokens (`mobileAuthTokens` in-memory Map) | Every 60s (`.unref()`'d so it doesn't keep the process alive on its own) |
| `server/job-queue.ts:115` | Internal polling loop inside `drainActiveJobs()` to detect when `activeCount` hits 0 | Every 100ms, until timeout (30s default) |
| `server/outbox.ts:117` | Background outbox sweep (see A.2) | Every 60s (`OUTBOX_DRAIN_INTERVAL_MS`) |
| `server/routes.ts:371` | Payment automation scheduler (see A.8) | Every 6h default |
| `server/sse.ts:47` | Per-connection SSE keep-alive ping | Every 25s per open connection |
| `server/backup-sync.ts` | Uses `setTimeout` (self-rescheduling), not `setInterval` — daily backup (see A.3) | Daily at 00:00 UTC+2 |
| `client/src/components/layout/client-layout.tsx:170`, `staff-layout.tsx:233` | Frontend clock tick to refresh a displayed "current time" | Every 60s (client-side only, not a backend job) |

**No `node-cron` or any cron library is used anywhere in the repo** — all scheduling is hand-rolled
via native `setInterval`/`setTimeout`, confirmed by grep across `server/`.

## A.10 Webhooks — inbound and outbound (exhaustive grep of "webhook")

- **Inbound:** exactly one real webhook — PayNow's result URL, `POST /api/payments/paynow/result`
  (see A.7.1). No other inbound webhook endpoints exist in `server/routes.ts`.
- **Outbound:** none found. POL263 does not call out to any external webhook URL (e.g. it does not
  notify third parties of events); all outbound integration is either the PayNow API (payment
  gateway calls, not webhooks) or Expo push (a push API, not a webhook).
- A duplicate/mirrored copy of the same webhook code exists under `fxq/server/routes.ts` and
  `fxq/server/payment-service.ts` (an apparent alternate/older copy of the server tree inside an `fxq/`
  subfolder) — not investigated further as it is outside `server/`; flagged here only because the
  grep for "webhook" surfaced it.

---
---


---

# Section 16 — Files

## 16.1 Top-level folder structure

```
POL263/
├── client/               React 19 + Vite frontend (SPA, served by Express in production)
│   └── src/
│       ├── App.tsx           Route table (wouter), lazy-loaded pages
│       ├── pages/             staff/, agent/, client/, join/, + top-level public pages
│       ├── components/        UI primitives (shadcn/radix wrappers), layout, feature-specific widgets
│       ├── hooks/              useAuth, useBranding, useMobile
│       └── lib/                queryClient (TanStack Query + CSRF injection), flags.ts, utils
├── server/                Express 5 backend — ~50 files, see 16.3
├── shared/                 Code shared between client and server (schema, validation, roles)
├── migrations/             66 hand/Drizzle-generated SQL migration files
├── scripts/ and script/    ~80 one-off ops/build/migration scripts (see 16.4)
├── tests/                  Vitest unit + e2e tests
├── docs/                   30+ architecture/deployment/planning documents (see Section 15 Part B)
├── android/, ios/          Capacitor native project shells
├── agent-app/              Separate Capacitor-wrapped Agent mobile app source
├── attached_assets/        Static design/reference assets
├── uploads/                Local-disk fallback for file uploads (dev/non-S3 mode)
├── fxq/                    An apparent duplicate/older copy of the server tree (server/routes.ts,
│                           server/payment-service.ts, shared/schema.ts, shared/storage.ts under fxq/)
│                           — surfaced only incidentally during a "webhook" grep; not investigated
│                           further as out of scope, but flagged for a future architect to confirm
│                           whether this is dead code, a staging fork, or a packaging artifact that
│                           should be excluded from the report/attention entirely.
└── testsprite_tests/       TestSprite QA tool config/output
```

## 16.2 Root configuration files

| File | Purpose |
|---|---|
| `package.json` | npm scripts (dev/build/test/db:*/cap:*), full dependency manifest |
| `tsconfig.json` | TypeScript compiler config, shared across client/server/shared via path aliases (`@/`, `@shared/`) |
| `vite.config.ts` | Frontend build config — React plugin, path aliases, dev server proxy to Express API |
| `vitest.config.ts` | Test runner config — points at `tests/unit` and `tests/e2e` |
| `drizzle.config.ts` | Default/shared-DB Drizzle Kit config (schema → migrations) |
| `drizzle.control-plane.config.ts` | Points Drizzle Kit at the separate control-plane database (`shared/control-plane-schema.ts`) |
| `drizzle.tenant.config.ts` | Generic per-tenant isolated-DB config (parameterized, the intended long-term pattern) |
| `drizzle.falakhe.config.ts` | Falakhe-specific isolated-DB config (should be superseded by `drizzle.tenant.config.ts`, Section 8) |
| `drizzle.backup.config.ts` | Config pointed at the Supabase backup destination |
| `tailwind.config.ts` / `postcss.config.js` | Tailwind v3 (deliberately, not v4 — a documented build constraint) + PostCSS pipeline |
| `components.json` | shadcn/ui component-generator config (paths, aliases, style) |
| `capacitor.config.ts` | Mobile wrapper config — app ID, web dir, server URL override for native builds |
| `netlify.toml` | Present but not the actual deploy target (real deploys are DigitalOcean per `docs/DEPLOY-*.md`) — likely a leftover/alternate option |
| `.env.example` | Full environment variable inventory — cross-referenced exhaustively in Section 7 |

## 16.3 Server files (`server/`) — one-line purpose each

| File | Purpose |
|---|---|
| `index.ts` | Express app bootstrap: helmet/CSP, CSRF, rate limiting, session middleware, route registration, graceful shutdown (drains job queue, stops backup scheduler, stops outbox sweep) |
| `routes.ts` | Central registration point for ~226 API endpoints (see Section 14) |
| `storage.ts` | Database access layer — ~273 methods, all Drizzle queries (see Section 6) |
| `route-helpers.ts` | Shared middleware: `requireAuth`, `requireTenantScope`, `requirePermission`/`requireAnyPermission`, `auditLog`, premium calculation (`computePolicyPremium`), agent-commission recording/clawback, agent-scope enforcement |
| `auth.ts` | Staff Google OAuth (Passport), demo-login dev fallback, agent-login in-memory lockout, mobile OAuth token-exchange sweep |
| `client-auth.ts` | Client portal auth: email/password + Google OAuth, argon2id hashing, legacy SHA-256 migration path, security-question reset flow |
| `tenant-db.ts` | `getDbForOrg(orgId)` — resolves and caches a Drizzle connection pool per organization (shared pool or dedicated isolated DB) |
| `tenant-resolver.ts` | Resolves `req.tenantId` per request: header → subdomain → custom domain → session fallback |
| `control-plane-db.ts` | Dedicated connection pool (max 5) to the separate control-plane Postgres cluster |
| `payment-service.ts` | PayNow payment initiation, hash verification, polling (`pollPaynowStatus`), group-payment handling |
| `paynow-config.ts` | Resolves per-org vs. global-fallback PayNow credentials |
| `paynow-hash.ts` | SHA-512 hash generation/verification for PayNow request/response integrity |
| `policy-status-on-payment.ts` | Applies a cleared payment's effect on policy status (activation, grace clearance, etc.) |
| `credit-apply.ts` | Applies a client's credit balance toward a premium, including the 2.5% platform-fee accrual |
| `financial-statements.ts` | Builds the auto-generated balance sheet / income statement across currencies |
| `outbox.ts` | Transactional outbox core: enqueue, `SELECT...FOR UPDATE SKIP LOCKED` drain, retry/dead-letter logic |
| `outbox-handlers.ts` | The actual side-effect handlers invoked per outbox event type (PDF generation, platform-fee accrual, commission, notifications) |
| `outbox-constants.ts` | Outbox event-type string constants |
| `job-queue.ts` | In-memory, in-process concurrency-capped job dispatcher (see Section 15) |
| `backup-sync.ts` | Daily full-table mirror of registry + control-plane + all tenant DBs into one Supabase backup destination |
| `notifications.ts` | Client-facing event-driven notification templating (18 event types, merge tags, DB template lookup with built-in fallback) |
| `user-notifications.ts` | Staff/agent-facing notification persistence + SSE emit + push fan-out |
| `push.ts` | Expo push notification sending, chunking, stale-token cleanup |
| `sse.ts` | Server-Sent Events for real-time staff/agent notification delivery |
| `object-storage.ts` | DigitalOcean Spaces (S3-compatible) upload/fetch, global bucket/credentials only today |
| `advisory-lock.ts` | Postgres advisory-lock helper used by the backup scheduler and payment-automation scheduler to prevent overlapping runs across instances |
| `rate-limit-redis-store.ts` | Redis-backed store for `express-rate-limit`, with in-memory fallback if `REDIS_URL` unset |
| `logger.ts` | `structuredLog()` — leveled structured logging helper used throughout the backend |
| `constants.ts` | `SYSTEM_PERMISSIONS` catalog, `ROLE_PERMISSION_MAP` seed templates, `SUPERUSER_EMAIL` resolution |
| `seed.ts` | Database seeding: default roles/permissions, security questions, demo data |
| `static.ts` | Static asset serving for the built client bundle in production |
| `vite.ts` | Dev-mode Vite middleware integration (HMR) for the Express server |
| `ambient.d.ts`, `global.d.ts` | TypeScript ambient/global type declarations (e.g. `req.user`, `req.tenantId` augmentation) |
| **PDF/document generators** (one purpose-built module per document type): `receipt-pdf.ts`, `policy-document.ts`, `policy-client-forms.ts`, `quotation-pdf.ts`, `requisition-pdf.ts`, `payment-voucher-pdf.ts`, `payslip-pdf.ts`, `payslip-email.ts`, `funeral-document.ts`, `mortuary-document.ts`, `hr-fleet-document.ts`, `driver-checklist-pdf.ts`, `department-report-pdf.ts`, `schedule-pdf.ts`, `finance-document.ts`, `agent-portfolio-pdf.ts`, `pdf-utils.ts` (shared PDFKit helpers) | Each generates one specific PDF artifact; `pdf-utils.ts` centralizes shared layout/branding helpers (logo, footer, signature block) so every generated document uses the org's own branding consistently |
| **Route-splitting for PDFs**: `routes-pdf-finance.ts`, `routes-pdf-hr-fleet.ts`, `routes-pdf-mortuary.ts`, `routes-pdf-policy.ts` | The one place the backend is already split out of the `routes.ts` monolith — a precedent worth extending to the rest of the codebase per Section 19 item 1 |

## 16.4 Shared libraries (`shared/`)

- **`schema.ts`** (~3,068 lines) — the single source of truth for the main application's Drizzle table definitions, covering every tenant-owned business domain (policies, clients, claims, funerals, mortuary, groups, HR/payroll, accounting, RBAC, notifications, audit). See Section 4 for the full table-by-table breakdown.
- **`control-plane-schema.ts`** (222 lines) — the parallel, physically separate schema for the control-plane database: tenant registry/routing/branding/integrations/storage/feature-flags/backup-run-history. Currently only partially wired into live server code (Section 9/11).
- **`roles.ts`** (28 lines) — role-name constants/types referenced by both client and server.
- **`validation.ts`** — shared Zod validation used by both client forms and server route handlers, including the Zimbabwe-specific national-ID regex and the hardcoded currency list/config (Section 8).

## 16.5 Scripts (`scripts/` and `script/`) — grouped by purpose

| Group | Representative files | Purpose |
|---|---|---|
| Falakhe tenant fix/migration scripts (~15) | `fix-falakhe-*.mjs`, `check-falakhe-*.mjs`, `migrate-falakhe-data.ts`, `setup-fresh-with-falakhe.ts`, `sync-falakhe-schema.mts` | One-time ops tooling used to migrate/repair the real Falakhe tenant's data during platform build-out; not part of the served app (Section 8) |
| Backfill scripts | `backfill-requisition-disbursements.mjs`, `backfill-requisition-workflow.mjs`, `backfill-legacy-group-receipt-fees.mjs` | Retroactively populate/fix data for features added after initial data existed |
| Diagnostic/check scripts | `check-db.ts`, `check-org.ts`, `check-policies.ts`, `check-control-plane.mjs`, `check-payment-intent.mjs`, `check-paynow-config.mjs`, `list-falakhe-tables.mjs` | Read-only inspection scripts for debugging specific data/config states |
| Seed/setup scripts | `run-seed.ts`, `db-reset.ts`, `setup-falakhe-legacy-groups.mjs` | Wrap the `db:seed`/`db:reset` npm scripts and one-time legacy-groups bootstrap |
| Migration orchestration (`script/`, singular) | `run-migrations.ts`, `migration-status.ts`, `migrate-orgs-to-control-plane.ts`, `migrate-orgs-users-to-do.ts`, `migrate-supabase-to-do.ts`, `cp-set-tenant-db.ts`, `export-tenant-users.ts`, `seed-tenant-from-backup.ts`, `build.ts`, `lockfile-check.cjs`, `relock.cjs` | The actual provisioning/migration runbook scripts referenced throughout `docs/REFACTOR-PROGRESS.md` and `docs/TENANT-DATABASES-WITHOUT-SUPABASE.md` |
| Simulation scripts | `simulate-payment-receipt.ts`, `simulate-issue-policy.ts` | Manual end-to-end smoke-test helpers (`npm run simulate:*`) |
| Misc record/repair | `record-historical-service-receipt.mjs`, `record-legacy-receipt.mjs`, `delete-legacy-receipt.mjs`, `add-legacy-group-and-receipt.mjs` | One-off data-correction scripts tied to specific past incidents, same category as the Falakhe fix scripts but not Falakhe-specific by name |

## 16.6 Tests (`tests/`)

- `tests/unit/` — Vitest unit tests (e.g. RBAC permission checks per CLAUDE.md's example command `npm run test -- rbac.test.ts`).
- `tests/e2e/` — end-to-end test scenarios.
- `testsprite_tests/` (root-level, separate from `tests/`) — configuration/output for the third-party TestSprite QA tool referenced in `docs/TEST-WITH-TESTSPRITE.md`/`TESTSPRITE-SETUP.md`/`TESTSPRITE-PRD.md`.
- Per Section 19 item 11, this report did not independently verify coverage depth against the ~226-endpoint API surface — flagged as a follow-up, not measured here.


---

## SECTION 17 — SECURITY REVIEW

### 17.1 `SECURITY.md` summary (repo root)

Documents: Google Workspace-only OIDC for staff (no local passwords for staff), secure/HttpOnly/SameSite session cookies, rate limiting on auth endpoints, tenant/branch row-level checks, permission-guarded sensitive operations, full audit trail (before/after JSONB + actor + IP + timestamp), strict CSP, CSRF on mutation endpoints, and platform-owner provisioning via `SUPERUSER_EMAIL` env var ("NOT hardcoded in source code"). Verified below against actual code; one nuance found (dev-only fallback email, Section 8).

### 17.2 Hardcoded secrets / committed credentials

No API keys matching `sk-`/`AKIA` patterns, and no literal `password = "..."`/`apiKey = "..."` assignments with real-looking values were found in `server/`, `client/src/`, `shared/`, `scripts/`, `script/`. All connection strings and keys in `.env.example` use placeholder values (`PASSWORD`, `YOUR_REGION`, `XXXX`, etc.) and the repo's `.gitignore` excludes `.env`. The one real personal credential-adjacent value found is the dev fallback email in `server/constants.ts:19`/`server/seed.ts:101` (Section 8) — not a secret, but a real identity.

### 17.3 CSRF protection

Implemented via `csurf` in `server/index.ts:16,65-110`. Enabled by default whenever `NODE_ENV === "production"` (or explicitly via `ENABLE_CSRF_PROTECTION`). Cookie is `httpOnly`, `sameSite: "lax"`, `secure` in production. A double-submit token is also set as a **non-httpOnly** `XSRF-TOKEN` cookie (line 100) for the client to read and echo back (`client/src/lib/queryClient.ts` presumably injects it — consistent with CLAUDE.md's description). Explicit exemptions (`CSRF_EXEMPT_PATHS`, lines 77-85): PayNow result webhook, agent/client auth login/logout, and mobile token exchange — all reasonable exemptions (no browser session exists yet for these, or the endpoint is a server-to-server webhook). Coverage looks appropriately broad since it's applied as global middleware to all non-exempt paths, not opt-in per route.

### 17.4 Helmet / security headers

`server/index.ts:28-44`. CSP `defaultSrc: 'self'`; `scriptSrc` allows `'unsafe-inline'`/`'unsafe-eval'` only outside production; `styleSrc`/`fontSrc` allow Google Fonts; `imgSrc` is broad (`data:`, `https:`, `blob:` — necessary for user-uploaded logos/receipts from arbitrary CDNs but does widen the CSP considerably); `connectSrc` allows `ws:`/`wss:`/`https:` broadly (needed for API calls but also fairly permissive). `crossOriginEmbedderPolicy: false` (loosened, likely for PDF/image embedding compatibility). No explicit CORS middleware is configured — the code has a `TODO(security)` comment at `server/index.ts:46-49` explicitly flagging that the `cors` package should be installed with an explicit allow-list (needed for the Capacitor mobile app hitting a remote host); today the app apparently relies on same-origin + cookies rather than a CORS policy, which is an open gap the developers already know about.

### 17.5 Rate limiting

`express-rate-limit` with optional Redis-backed store (`server/rate-limit-redis-store.ts`), falling back to per-process in-memory limiting with an explicit production warning if `REDIS_URL` is unset (`server/index.ts:116-118`). Layered limits: global `/api` (200/min), auth endpoints (`/api/auth`, `/api/agent-auth`, `/api/client-auth`, `/api/security-questions`, `/api/agents/by-referral`) at 20/15min in production (200/15min in dev), PayNow result webhook (60/min), report/dashboard export endpoints (30/15min), and a write limiter (30/min) on policy/payment/month-end POSTs and uploads. This is a solid, well-thought-out layered scheme.

### 17.6 SQL injection

Reviewed all `sql\`...\`` tagged-template usages in `server/storage.ts` and raw `.execute(sql\`...\`)` calls used for number-generator upserts and receipt/statement filters (e.g. storage.ts:997-1124, 4107-4180; routes.ts:7359-7420). All interpolations use Drizzle's `sql` tag, which parameterizes `${...}` expressions rather than concatenating raw strings — this is safe by construction, not string concatenation. No matches found for raw `pg` `pool.query()`/`client.query()` calls built by string concatenation in `server/storage.ts` or any `scripts/*.mjs` file (spot-checked `scripts/*.mjs` for `sql\`` patterns — none use raw concatenation either; the .mjs migration scripts appear to use parameterized `pg` client calls). No SQL injection vectors found in the reviewed surface.

### 17.7 XSS risk

Only one `dangerouslySetInnerHTML` usage found in all of `client/src`: `client/src/components/ui/chart.tsx:79`, which is part of the shadcn/ui chart component library's standard pattern for injecting a `<style>` block built from a fixed chart-config color map (not user-controlled free text). Low risk — no instance of rendering raw user/client-submitted text via `dangerouslySetInnerHTML` was found anywhere in the staff/agent/client portal pages.

### 17.8 Cross-tenant data leakage — spot check (NOT exhaustive; ~5,700 lines of `storage.ts` were not fully reviewed line-by-line)

- **Good pattern, confirmed repeatedly**: `getClient(id, orgId)` (storage.ts:1068-1072), `getPolicy(id, orgId)` (storage.ts:2164-2168), `getClaim(id, orgId)` (storage.ts:3101), `getRequisition(id, orgId)` (storage.ts:4364) all filter with `and(eq(table.id, id), eq(table.organizationId, orgId))` — org filter is baked into the storage layer itself, not just the caller.
- **Gap found**: `getGroup(id, orgId)` (storage.ts:4188-4192) and `updateGroup(id, data, orgId)` (storage.ts:4198-4202) accept `orgId` (used only to pick the correct tenant DB connection via `getDbForOrg(orgId)`) but their `WHERE` clause filters **only on `eq(groups.id, id)`** — no `eq(groups.organizationId, orgId)` guard at the storage layer. For any tenant on the **shared** database (no isolated `organizations.databaseUrl`), this means `storage.getGroup()` will happily return another tenant's group row if you know/guess its UUID.
  - Impact is partially mitigated at the route layer: `PATCH /api/groups/:id` (routes.ts:7315-7329) explicitly re-checks `existing.organizationId !== user.organizationId` → 403 before allowing the update, so the **write** path is safe.
  - However, `GET /api/groups/:id/policies` (routes.ts:7331-7350), `GET /api/groups/:id/receipts` (routes.ts:7352-7377), and `POST /api/groups/legacy-receipts` (routes.ts:7401-7421) call `storage.getGroup(groupId, user.organizationId)` and only check `if (!group) return 404` — they do **not** verify `group.organizationId === user.organizationId`. Because the subsequent data queries in those same handlers (`getPoliciesByGroupId`, the receipts SQL, the legacy-receipts insert) are themselves correctly scoped by `user.organizationId`, the practical leak is limited to **existence/enumeration** (a 200 vs. 404 response reveals whether a given group UUID belongs to *some* tenant on the shared DB) rather than a full data leak — but it is still a defense-in-depth gap: the storage function's own name/signature (`getGroup(id, orgId)`) implies org-scoping that isn't actually enforced in the SQL.
  - **Recommendation**: add `eq(groups.organizationId, orgId)` to the `WHERE` clause in both `getGroup()` and `updateGroup()` in `server/storage.ts`, matching the pattern already used for `getClient`/`getPolicy`/`getClaim`.
- This was a targeted spot-check of a handful of entities (clients, policies, claims, requisitions, groups) — a full audit of every one of the ~150+ storage methods for org-scoping consistency was out of scope here and should be a follow-up task (grep for every `.select()...from(...)` in `storage.ts` that takes an `orgId`/`organizationId` parameter and confirm it appears in the `WHERE`, not just to pick a DB connection).

### 17.9 Authentication weaknesses

- **No MFA for staff or client accounts in-app.** Staff auth is delegated entirely to Google OAuth (`server/auth.ts`), so MFA is only as strong as whatever the tenant's Google Workspace enforces externally — the app has no visibility into or control over this. `PLATFORM_OWNER_MFA_ENFORCED` (env var, `.env.example`) is **self-attested** — it only suppresses a startup log warning (per its own comment) and does not gate login or verify MFA status via any Google Admin API call. Client portal (`client-auth.ts`) uses email/password with **no MFA option at all** (no TOTP/SMS/email-OTP second factor found).
- **Password hashing**: uses `argon2id` (`argon2.hash(..., { type: argon2.argon2id })`) for both staff local passwords (`auth.ts:740,759`) and client passwords (`client-auth.ts:41`) — modern, correct choice. `client-auth.ts:252` (`isLegacySha256Hash`) indicates a past migration away from SHA-256 hashing, with backward-compatible verification for not-yet-migrated legacy hashes — worth confirming in a follow-up that the legacy SHA-256 path is being actively phased out (rehash-on-login) rather than permanently supported.
- **Account lockout**: implemented for agent (staff email/password) login only, **in-memory, per-process** (`server/auth.ts:30-61`; 5 attempts / 15-minute lockout). The code's own comment (lines 30-34) flags the scalability gap: under horizontal scaling, each instance tracks its own counter, so an attacker gets `threshold × N-instances` attempts before being locked out anywhere, and a restart resets all counters. A `TODO(scalability)` in the same comment already proposes the fix (DB-backed `lockedUntil` column, mirroring the pattern the code says is already used for `clients.lockedUntil`). No equivalent lockout was found for the Google OAuth staff path (reasonable — Google handles that) or verified for the client-portal login path beyond the IP-based `authLimiter` in `index.ts`.
- **Session secret**: falls back to a random-per-boot secret in dev if `SESSION_SECRET` is unset (`auth.ts:73-86`), with a warning logged; throws in production if unset — correct fail-safe behavior.
- **No password complexity policy beyond minimum length** found — `client-auth.ts:145` enforces `password.length < 8` as the only rule (no character-class/entropy requirement). Given argon2id hashing this is a reasonable minimum-viable policy, but worth flagging as "length-only" for completeness.

---

## Cross-cutting theme for the larger report

Across all three sections, the same pattern recurs: **the multi-tenant control plane (`control-plane-schema.ts`) has already been designed with the right shape** (per-tenant DB, storage, integrations, branding, feature flags) **but large parts of it are not yet wired into the running server** — `tenantStorage`, `tenantIntegrations` (WhatsApp/SMS/Stripe), and `tenantFeatureFlags` were all defined but had zero read/write call sites found in `server/routes.ts` or `server/storage.ts`. Meanwhile the fields that *are* live and working per-tenant today (branding on `organizations`, PayNow credentials, FX rates, notification templates, RBAC) live on the older `organizations`/`shared/schema.ts` tables rather than the newer control-plane tables — so there are effectively two parallel "per-tenant config" systems mid-migration, and reconciling them (picking one source of truth per setting) is the highest-leverage next step for the SaaS transformation.


---

# Section 18 — SaaS Transformation Roadmap

**Framing note before the phases**: POL263 is not starting a multi-tenant transformation from zero. A control plane already exists (`shared/control-plane-schema.ts`, a physically separate `pol263-control-plane` Postgres cluster), Phase 1 of the team's own internal migration plan (`docs/REFACTOR-PROGRESS.md`, dated 2026-04-14) is marked complete, one tenant (Falakhe) is fully running on an isolated database, and ~90 of ~103 tables are already correctly `organization_id`-scoped. The roadmap below is written against that reality — each phase states what's already done, what's partially done, and what's genuinely greenfield, rather than assuming a blank slate.

## Phase 1 — Immediate Refactoring (0–4 weeks)
Low-risk, high-value fixes that don't require architectural decisions:
1. Add `eq(groups.organizationId, orgId)` to `storage.getGroup()`/`updateGroup()` WHERE clauses — closes the one confirmed cross-tenant data leak (Section 9 item 4).
2. Wire `POST /api/settlements/:id/approve` to actually flip `isSettled` on the relevant `platform_receivables` rows (and populate `settlement_allocations`, or drop that table if a simpler running-total model is preferred) — fixes the platform's own revenue reconciliation, which is silently broken today (Section 9 item 1).
3. Replace the dev-fallback `SUPERUSER_EMAIL` default with a placeholder, not a real personal address (Section 8) — brings the code in line with `SECURITY.md`'s own claim.
4. Extend the `organizations.policyNumberPrefix/Padding` pattern to claim/case/member/employee/requisition/voucher numbers (Section 9 item 6) — mechanical, the counter infrastructure already exists per-org.
5. Install the `cors` package with an explicit allow-list per the codebase's own existing `TODO(security)` comment (Section 9 item 16).
6. Consolidate `drizzle.falakhe.config.ts` into the already-existing generic `drizzle.tenant.config.ts`, and rename the `db:*:falakhe` npm scripts to be tenant-slug-parameterized (Section 8).

## Phase 2 — Tenant Isolation (1–3 months) — largely already done; this phase is about *finishing*, not starting
- **Already done**: `organizations.databaseUrl` + control-plane `tenantDatabases` routing, LRU-capped per-tenant connection pooling, automatic pending-migration application on first connect, proven against Falakhe in production.
- **Remaining work** (this is REFACTOR-PROGRESS.md's own Phase 3, "not started"): provision isolated DBs for the other tracked tenants (Sunrest, Valleyside) using the same proven `db:push:tenant` → migrate → `cp:set-*-db` sequence; formalize `db:migrate:status` as an automated pre/post-provisioning check rather than an ad hoc manual step (Section 9 item 14).
- **Also in this phase**: move the currency list (`SUPPORTED_CURRENCIES`) and national-ID validation format from hardcoded constants to per-tenant configuration (Section 9 items 7–8) — these are the clearest remaining "built for one country" artifacts in the business-logic layer, and they block onboarding any tenant outside Zimbabwe/South Africa regardless of how good the DB isolation is.
- **Also in this phase**: reconcile the `organizations` vs `control-plane-schema.ts`'s `tenantBranding`/`tenantIntegrations` duplication (Section 9 item 2) — pick one source of truth before adding more tenants, since every new tenant onboarded under the current dual-system increases the migration cost later.

## Phase 3 — Control Plane (2–4 months) — this is explicitly REFACTOR-PROGRESS.md's own Phase 2, already scoped
- Build the `PaymentAdapter` interface (`PaynowAdapter`, later `StripeAdapter`), `WhatsAppAdapter`/`SMSAdapter` interfaces, and an `integration-loader.ts` that reads from `tenantIntegrations` instead of global env vars.
- Implement the AES-256-GCM encryption layer for `tenantIntegrations.config` using `TENANT_CONFIG_ENCRYPTION_KEY` (currently referenced only in comments — no encrypt/decrypt code exists yet, Section 9 item 11). Do not wire real tenant secrets into `tenantIntegrations` before this lands.
- Wire `tenantStorage`'s path-prefix isolation (`tenants/{tenantId}/...` inside the shared DigitalOcean Spaces bucket) into `server/object-storage.ts` — cheap, high-value, and already fully designed (Section 9 item 9).
- Build the cross-tenant platform-fee aggregation view described in Section 11 — a control-plane-level rollup of `platform_receivables`/`settlements` across all tenants, since today POL263 (the vendor) has no single query showing total revenue outstanding across its whole tenant base.
- Wire `tenantFeatureFlags` (claims_enabled, mobile_payments, agent_portal, whatsapp_notifications) into actual route guards — the schema exists, nothing reads it yet.

## Phase 4 — Subscription Engine (2–3 months, can run parallel to Phase 3)
This is **genuinely greenfield** — `tenants.licenseStatus` exists as a manually-set enum (`active/suspended/trial/expired`) but nothing meters usage, charges a card, or automates a status transition today.
- Design a billing/entitlement data model in the control plane (plans, usage meters, invoices) — deliberately kept out of any tenant's own database so a tenant can never see or tamper with its own billing state via its normal DB access.
- Decide the metering unit(s) — likely candidates given the existing schema: active policies under management, cleared premium volume (which conveniently already flows through the existing 2.5% `platform_receivables` mechanism once Phase 3's aggregation view exists), or seats/users.
- Automate `licenseStatus` transitions (trial→active on payment, active→suspended on non-payment) and gate login/tenant-switch on status, rather than leaving it a manually-flipped field.
- This phase is a natural place to also formalize `DASHBOARD_MAX_ROWS`/`REPORT_EXPORT_MAX_ROWS`-style limits as genuine per-plan tiers rather than the single global constants they are today (Section 11, Usage Limits row).

## Phase 5 — Marketplace (later, opportunistic — no urgency signal found in the codebase)
No code, schema, or internal doc references anything like a cross-tenant product/add-on marketplace. Not a migration candidate — pure net-new product scope, and should be sequenced after Phase 4's billing engine exists (a marketplace without a billing engine to settle through has nowhere to attach revenue).

## Phase 6 — White Label (mostly already done)
`organizations.isWhitelabeled` already exists and is respected across login/splash/sidebar per the settings-tab research; `tenantDomains` (custom domain → tenant mapping) is real schema and actively used by `tenant-resolver.ts`. Remaining gap: no SSL/certificate automation was found (no ACME/Let's Encrypt integration) — verify whether the hosting platform (DigitalOcean App Platform) handles this automatically before treating it as a gap requiring in-app work.

## Phase 7 — Enterprise Features (ongoing, demand-driven)
Candidates visible in the current gap analysis rather than invented: a genuine tenant-aware worker/queue architecture (REFACTOR-PROGRESS.md's own Phase 4, not started — see Section 19), per-user impersonation for support (today only whole-tenant switching exists), a cross-tenant audit/security dashboard for the platform operator, SSO/SAML for tenants who want their own identity provider rather than sharing POL263's single Google OAuth client (Section 9's `GOOGLE_CLIENT_ID` flag), and MFA enforcement options for the client portal (currently absent entirely, Section 17).

---



---

# Section 19 — Architectural Debt

| # | Debt item | Where | Impact | Direction |
|---|---|---|---|---|
| 1 | **Monolithic route/storage files**: `server/routes.ts` (~9,267 lines / ~226 endpoints) and `server/storage.ts` (~5,733 lines / ~273 methods) are both single files acting as the central registration point for effectively the whole backend. | `server/routes.ts`, `server/storage.ts` | Maintainability/onboarding cost, merge-conflict surface, hard to reason about which permissions/tenancy checks apply where without full-file search. Confirmed as a known concern in the team's own `SYSTEM-SPEC.md §9`. | Split by domain (policies, claims, finance, HR, mortuary, etc.) into separate route modules and storage repositories, mounted/composed centrally — mechanical refactor, not a redesign, since the underlying Express/Drizzle patterns are already consistent. |
| 2 | **Two parallel per-tenant config systems mid-migration** — `organizations` (live, working) vs. `control-plane-schema.ts`'s `tenantBranding`/`tenantIntegrations` (modeled, unwired, already schema-drifted — e.g. `policyNumberPadding` is `text` in one and `integer` in the other). | `shared/schema.ts` vs `shared/control-plane-schema.ts` | Every day this persists, more tenant data is written against the "wrong" (soon-to-be-migrated-away-from) table, increasing eventual migration cost. Also a source of confusion for any new engineer who finds two tables that look like they do the same thing. | Treat as the single highest-leverage next architectural decision (see Section 9/11) — pick one, deprecate the other explicitly, don't let both accumulate data. |
| 3 | **Platform-fee settlement reconciliation is non-functional** — `isSettled` on `platform_receivables` is never set to `true` anywhere in the codebase; `settlement_allocations` is imported but never used. | `shared/schema.ts`, `server/routes.ts` `/api/settlements/:id/approve` | The platform operator's own "how much are we owed" and "how much has been paid" figures are permanently wrong (Outstanding always = lifetime total). This is a real, already-shipped bug affecting the vendor's own accounts receivable, not a hypothetical. | Fix in Phase 1 (Section 18) — small, contained change with outsized business impact. |
| 4 | **No dedicated background-job/worker process** — the in-memory job queue and the outbox background sweep both run inside the same Node process as the web server; a process crash/restart silently loses any non-outbox-backed pending job (e.g. `enqueueJob("notify:*", ...)` calls have no persistence fallback, unlike the outbox-backed payment follow-ups). Explicitly REFACTOR-PROGRESS.md's own Phase 4, not started. | `server/job-queue.ts`, `server/outbox.ts` | Notification delivery for policy-creation/status-transition/member-added/reinstatement events can be silently dropped on a bad-timed restart. Outbox-backed flows (payments, platform fees, commissions) are safe by design; the direct job-queue-only flows are not. | Migrate the direct `enqueueJob("notify:*")` call sites onto the outbox pattern (already proven, already idempotent-by-design) rather than building a whole new worker architecture just for this; save the bigger tenant-aware dedicated-worker-process investment for when job volume genuinely requires horizontal worker scaling. |
| 5 | **Hand-rolled scheduling, no cron library, no managed broker** — every recurring job (outbox sweep, backup sync, payment automation, SSE keepalive, auth-token sweep) is a native `setInterval`/`setTimeout`, each independently reimplementing overlap-guards (advisory locks, boolean flags). | `server/outbox.ts`, `server/backup-sync.ts`, `server/routes.ts` (payment automation), `server/sse.ts`, `server/auth.ts` | Works correctly today (each has been individually hardened with locks/guards) but is five separate hand-rolled scheduling mechanisms rather than one, increasing the surface area for a future subtle bug (e.g. an engineer adding a sixth scheduled job who doesn't know the established overlap-guard pattern). | Not urgent to unify given each is individually correct, but worth consolidating onto one lightweight in-process scheduler abstraction (still no need for a managed broker at current scale) the next time a new recurring job is added. |
| 6 | **Numbering formats hardcoded except policy numbers** — claim/member/case/employee/requisition/voucher number prefixes and padding are string literals in `storage.ts`, unlike policy numbers which are already tenant-configurable. | `server/storage.ts:4104-4181` | Every tenant gets identical formats for six of seven number types regardless of their own convention — a small but real "one customer's assumptions baked into the code" pattern, same root cause as the currency/national-ID issues. | Mechanical fix, bundled into Phase 1/2 of the roadmap. |
| 7 | **Doc sprawl** — 13+ overlapping internal architecture/strategy documents (three separate nav-redesign proposals at 4/7/9 top-level buckets; three "system spec"-style docs; a 1,384-line from-scratch rebuild spec that is now the most stale document in the set) with no single maintained source of truth. The team's own `SYSTEM-SPEC.md §9` independently flags this same problem. | `docs/*.md` | New engineers (or a future architect, per this very report's stated purpose) risk relying on a stale doc — confirmed contradictions exist today (permission count 41 vs 54, table name `revenue_share_receivables` vs `platform_receivables`, client-login identifier description). | Consolidate into one maintained architecture doc (this report, plus a living addendum) and archive/delete the superseded drafts rather than accumulating a 14th. |
| 8 | **Global-only integration credentials for features that should be per-tenant** — PayNow (partially fixed, per-tenant override exists), WhatsApp/SMS/SMTP/object storage (not fixed) all read only `process.env.*` today despite `tenantIntegrations`/`tenantStorage` being designed for exactly this. | `server/object-storage.ts`, `server/payslip-email.ts`, `.env.example` | Blast radius: one leaked credential set exposes every tenant's documents/messages; also blocks any tenant wanting brand-legitimate (their own WhatsApp number, their own "from" email) client communication. | Covered in Section 18 Phase 3 — this is the concrete content of that phase, not a separate initiative. |
| 9 | **Currency and national-ID validation hardcoded to Zimbabwe/South Africa** — `SUPPORTED_CURRENCIES`, `CURRENCY_CONFIG`, and `NATIONAL_ID_REGEX` are compiled-in constants duplicated across 8+ client files. | `shared/validation.ts`, 8+ client dropdown implementations | Blocks onboarding any tenant outside the currently-supported countries without a code change and redeploy — the single clearest "single-tenant assumption in shared business logic" in the codebase (contrast with `fxRates`, which is already correctly per-tenant). | Covered in Section 18 Phase 2. |
| 10 | **Minor schema soft spots**: `paymentDisbursements.entityId` is a polymorphic FK with no declared `references()` (entityType discriminator instead) — unique in the schema to this one table; `clients` has non-unique lookup indexes on (org, email) and (org, nationalId) rather than uniqueness constraints, so duplicate national IDs are technically possible within one tenant. | `shared/schema.ts` | Low-frequency data-quality risk rather than a security/tenancy issue — a duplicate-national-ID client record or an orphaned polymorphic disbursement reference wouldn't leak across tenants, just create bad data within one. | Worth a follow-up data-integrity pass (add the uniqueness constraint where business rules allow; consider a check constraint or application-level validation for the polymorphic FK) but not urgent relative to the multi-tenancy items above. |
| 11 | **Test coverage vs. surface area** — `SYSTEM-SPEC.md` itself flags an unquantified but likely thin test-coverage ratio against ~226 API endpoints; this report's own research did not independently verify current coverage (out of scope for this pass) but the concern is worth carrying forward given the number of maker-checker/status-machine workflows (policy, claim, payment, waiver, settlement) where a regression would be high-impact and easy to miss without tests per state transition. | `tests/unit/`, `tests/e2e/` | Regressions in status-transition logic (e.g. the platform-fee bug found in this very report) can ship silently. | A follow-up task: enumerate the ~6 state machines identified across the report (policy, claim, lead, payment-intent, cashup, requisition) and confirm each transition has at least one test. |
| 12 | **Account lockout is in-memory/per-process only** (agent login), meaning horizontal scaling weakens the lockout guarantee (`threshold × N-instances` attempts before lockout takes effect anywhere, and a restart resets all counters) — already flagged as a `TODO(scalability)` in the code itself, with the fix pattern (DB-backed `lockedUntil`, already used for `clients.lockedUntil`) identified but not yet applied to agent login. | `server/auth.ts:30-61` | Security control weakens silently as the deployment scales horizontally, with no error or warning at runtime to signal the degradation. | Apply the same `lockedUntil`-column pattern already used for clients to agent accounts — small, contained fix. |

---



---

# Section 20 — Final Recommendations (Executive Report)

## Current maturity
POL263 is a **functionally mature, single-codebase, mid-multi-tenancy-migration** product — not a prototype, and not a from-scratch rebuild candidate. Roughly 50 distinct features across insurance, funeral operations, accounting, HR, and CRM domains are built and in production for at least one real tenant (Falakhe), with genuinely sophisticated sub-systems (versioned multi-currency/age-banded pricing, maker-checker workflows across claims/finance/settlements, a working transactional-outbox pattern, dual DB-isolation models already proven). The multi-tenancy foundation — row-level `organization_id` scoping plus an optional dedicated-database-per-tenant control plane — is real, working, and already validated against a production tenant, which is a materially stronger starting point than most "single-tenant app needs to become SaaS" engagements.

## Estimated readiness
**Not ready for self-service SaaS onboarding today; ready for a second and third hand-held/ops-assisted tenant onboarding now, with the Phase 1–2 fixes in this report.** The gating items for genuine self-service multi-tenant SaaS (a prospective customer signs up and provisions their own tenant with no engineer involved) are, in order of blocking severity: (1) no billing/subscription engine exists at all (Section 18 Phase 4 — pure greenfield), (2) tenant provisioning is a manual script sequence, not an API-triggered flow (Section 9/11), (3) integration credentials (messaging, storage) are global-only, meaning a new tenant cannot bring their own WhatsApp/SMS identity without an engineer editing env vars, (4) currency/national-ID validation is hardcoded to two countries. None of these are architecturally hard problems — the underlying data model and control-plane shape already anticipate all four — but all four require real engineering effort before "sign up and go" is possible.

## Critical blockers (must fix before onboarding tenant #2 for real production use)
1. Platform-fee settlement reconciliation bug (Section 9 item 1 / Section 19 item 3) — the vendor's own revenue tracking is currently wrong for every tenant, every day.
2. The `organizations` vs. control-plane config duplication (Section 9 item 2 / Section 19 item 2) — must be resolved before a second isolated-DB tenant accumulates more data in the "wrong" table.
3. The `groups` cross-tenant read leak (Section 9 item 4) — a one-line fix, but a real confirmed vulnerability on the shared database.
4. Currency and national-ID hardcoding (Section 9 items 7–8) — a hard blocker for any tenant outside Zimbabwe/South Africa specifically, not a general SaaS concern otherwise.

## Recommended architecture
Keep the current shape — it's correct. Express 5 + Drizzle ORM + PostgreSQL, React 19 + Vite frontend, Capacitor for mobile, is a sound, boring, maintainable stack for this problem size. Do not rewrite the monolith into microservices; instead split `routes.ts`/`storage.ts` by domain (Section 19 item 1) while keeping one deployable service — the operational complexity of microservices is not justified at this scale (single-digit tenants today, an insurance/funeral vertical with no indication of needing independent scaling per domain).

## Recommended SaaS model
**Hybrid isolation, tenant-choice, not tenant-forced** — continue the existing three-tier model already documented in `docs/TENANT-DATABASES-WITHOUT-SUPABASE.md`: shared database by default (cheapest, fastest to onboard), with dedicated isolated database available per-tenant for compliance/data-residency/scale needs (already proven for Falakhe). This is a genuinely good SaaS packaging story once the billing engine exists: "Standard" tier on shared DB, "Enterprise" tier with isolated DB and custom domain, priced accordingly.

## Recommended database model
Keep row-level `organization_id` scoping as the default/primary isolation mechanism (it is overwhelmingly consistently applied already — Section 9.2), with the control-plane database as the single source of truth for tenant registry, routing, and (once Phase 3 lands) billing/entitlement state. Resolve the `organizations`/`control-plane-schema.ts` duplication in favor of **one** live table per setting — this report recommends keeping business-adjacent per-tenant settings (branding, numbering, PayNow credentials once encrypted) in the control plane long-term, since that's the architecturally correct home and is already where the schema was designed to converge, but do not migrate live traffic away from `organizations` until the control-plane read/write paths are actually built and tested, per REFACTOR-PROGRESS.md's own phased approach.

## Recommended deployment model
No change needed to hosting (DigitalOcean App Platform per current deploy docs) — the documented DO-specific gotchas (build must include devDependencies, restart-does-not-rebuild, pooler port/URL quirks) are already diagnosed and workable. Prioritize closing the CORS gap (Section 9 item 16) before custom-domain/mobile-cross-origin traffic grows, and treat the current backup-to-one-shared-Supabase-destination model (Section 9 item 10) as acceptable for now but revisit the moment any tenant has a data-residency requirement.

## Recommended scaling strategy
Current single-instance capacity estimate (per the team's own `SCALABILITY-REPORT.md`, ~100–250 concurrent users) is adequate for the current tenant count. The clearest scaling investment, in priority order: (1) migrate the direct-job-queue notification call sites onto the outbox pattern (Section 19 item 4) before scaling horizontally, since the in-memory job queue's non-durability becomes a bigger practical risk the more instances/restarts occur; (2) require `REDIS_URL` (shared rate-limit store) in any horizontally-scaled deployment, since the in-memory fallback silently weakens both rate limiting and the agent-login lockout counter across instances (Section 19 item 12); (3) defer the full tenant-aware dedicated-worker-process rebuild (REFACTOR-PROGRESS.md Phase 4) until job volume genuinely demands it — today's per-org-batched outbox sweep is adequate for the current tenant count.

## Recommended control-plane architecture
Converge on the already-designed shape in `shared/control-plane-schema.ts` as the target, in this order: (1) tenant registry/routing/DB-assignment (already done, keep as-is), (2) integration credentials with encryption (Section 18 Phase 3 — build the encryption layer before wiring any real secret into it), (3) cross-tenant platform-revenue aggregation (net-new, but small, and high-value given the confirmed reconciliation bug), (4) billing/entitlement engine (net-new, the single biggest remaining build). Do not add a fifth parallel "per-tenant config" location — every future per-tenant setting should go into the control plane from day one rather than repeating the `organizations`-table pattern that now needs unwinding.

## Recommended tenant architecture
Each tenant owns, without exception: users/roles/permissions (already correctly per-org rows, independently editable), all business data (policies, clients, claims, funerals, mortuary, groups, fleet, HR/payroll, accounting — all already correctly `organization_id`-scoped per Section 12), and their own numbering/branding/notification-template configuration (once the remaining hardcoded number formats are fixed). Each tenant does **not** own: the permission catalog itself (correctly global — permissions are platform capabilities, not business data), billing/subscription state (must never be tenant-writable, even indirectly), or the platform-fee ledger's settlement status (a tenant should see what it owes, but only the platform, via the control plane, should be able to mark it settled).

## Recommended licensing model
Given the existing `tenants.licenseStatus` enum (active/suspended/trial/expired) and the fact that premium volume already flows through a working 2.5% revenue-share mechanism (`platform_receivables`), the path of least resistance is a **usage-based revenue-share model** (a percentage of premium/service volume processed) rather than a flat per-seat SaaS subscription — this is already the commercial model implicitly encoded in the codebase (every cleared payment already generates a platform fee), it just needs the control-plane billing engine (Phase 4) and the settlement-reconciliation fix (Critical Blocker #1) to actually function as a real billing system rather than an unreconciled ledger. A flat/tiered subscription model (with usage limits like `DASHBOARD_MAX_ROWS` becoming real plan-tier differentiators) can be layered on top later without conflicting with the revenue-share model.

## Recommended enterprise roadmap
In priority order once the Critical Blockers are closed: (1) SSO/SAML per-tenant identity (today all staff share one Google OAuth client — fine for early tenants, a real ask once a large enterprise tenant wants their own IdP); (2) per-user impersonation for support (today only whole-tenant switching exists); (3) a cross-tenant audit/security dashboard for the platform operator (today each tenant's audit log is siloed, with no fleet-wide view); (4) formal SLA/uptime tooling once tenant count and revenue justify it. None of these are urgent relative to the Critical Blockers and Phase 1–4 roadmap items above, but they are the natural next tier once POL263 has paying, self-service tenants rather than the current hand-onboarded few.


---

# Appendix A — Prior Internal Architecture Documentation Review

> This appendix is supporting research, not one of the 20 requested report sections. It is the raw material Sections 9, 11, 18, 19, and 20 above were validated against.

# PART B — Harvested Prior Architecture / SaaS-Transformation Docs

All 13 requested docs **exist** in `docs/`. Below is a dense summary of each, in the order requested,
with explicit contradiction flags and a recency assessment at the end.

## B.1 `docs/POL263-TRANSFORMATION-PLAN.md`
**Type:** UI/UX + navigation transformation plan (capstone doc). **No dates in the doc itself.**
Explicitly says *"No code is changed in this document"* — pure planning artifact, builds on
FUNCTIONAL-BLUEPRINT and DOMAIN-AND-NAVIGATION-BLUEPRINT (which it calls "already the foundation").

Key decisions:
- Adopts a **9-bucket top-level nav**: HOME · SALES · CLIENTS · POLICIES · COLLECTIONS · CLAIMS ·
  FINANCE · REPORTS · SETUP (refining an earlier 8-bucket proposal from the Domain/Nav blueprint and a
  4-bucket "Work/Money/Insights/Setup" idea from UX-PRODUCT-STRATEGY — **these three docs propose
  three different top-level menu counts: 4, 7, and 9** — see recency note below).
- Full role→menu visibility matrix, a 20-row quantified task matrix (current clicks vs proposed
  clicks), ASCII wireframes per persona Home ("Command Center"), and a component architecture section
  naming specific new components to build: `CommandPalette`, `GlobalSearch` (needs one new
  **additive** `GET /api/search` aggregator endpoint — explicitly says "no existing API changes"),
  `QuickCreateButton`, `CommandCenter`+`Widget`, `ReceiptDrawer`, `PolicyWizard`, `EnhancedDataTable`.
- **Feature-flag strategy (Part H):** proposes introducing flags from scratch — either an env-var
  default + reused per-tenant settings JSON, or (if none exists) "a single nullable `feature_flags
  jsonb` column — additive" on organizations. **States explicitly: "POL263 has no flag system
  today."** This is a direct, actionable statement for a later Feature-Flags/SaaS-config section.
- **Migration roadmap (Part G):** 7 phases, each behind a flag, each independently reversible:
  0 (done: finance tab fix) → 1 nav config swap → 2 global search+palette → 3 quick-create+receipt
  drawer → 4 role command centers → 5 enhanced tables/forms → 6 policy wizard/visual polish → 7 build
  the `StaffComingSoon` stub screens.
- **Rollback strategy (Part J):** flag-off is primary; no destructive migrations in any phase; the
  only additive DB change is the optional nullable `feature_flags jsonb`.
- Explicitly preserves **every** existing route/permission/workflow — this is a relabeling/regrouping
  exercise, not a rewrite.

## B.2 `docs/POL263-FUNCTIONAL-BLUEPRINT.md`
**Type:** Pure discovery/audit (no redesign) — the factual foundation the Transformation Plan builds
on. No date, but content matches current architecture closely (mentions legacy groups implicitly via
"Group / Society Business" concepts but not the *newest* legacy-receipt/premium-override features).

Headline finding (§0): **only ~24 of ~60 exposed staff menu items are real screens** — the rest render
`StaffComingSoon` stubs. Full stub inventory given per top-level menu (Transactions: 6/8 stubs;
Administration: 11/21 stubs; Tools: 7/13 stubs).

Also documents, precisely and load-bearingly for later sections:
- **43 conceptual entities over 81 tables**, all org-scoped (branch_id often too).
- **12 workflows / 6 state machines** (policy, claim, lead, payment-intent, cashup, requisition) with
  exact status enums and API endpoints for each.
- **9 seeded roles + Platform Owner**; superuser is a **sentinel** (empty permission list in
  `ROLE_PERMISSION_MAP` = "all permissions within tenant", not literally zero permissions).
- **54 permissions, 20 categories** (this document says 54; MEGA-PROMPT.md — an older doc — says 41;
  see contradiction note below).
- **11 duplicate/overlapping concept pairs** flagged from actual FK inspection, most importantly:
  "`receipts` vs `payment_receipts` — likely redundant… **worth confirming which is authoritative**"
  — this is an explicit, unresolved data-model ambiguity flagged for follow-up, not yet resolved as of
  this doc.
- Cross-cutting facts called out at the end (§9), directly relevant to later Section sub-topics:
  tenancy is `organization_id` row-scoping + optional isolated per-org DB coordinated by a control
  plane; **money is idempotent & polled** (PayNow has no webhooks — though as Part A above shows, a
  webhook path *does* exist alongside polling); every mutation is audited; async side-effects go
  through outbox+job-queue; maker-checker enforced for claims/finance/settlements.

## B.3 `docs/POL263-DOMAIN-AND-NAVIGATION-BLUEPRINT.md`
**Type:** Canonical domain model + IA redesign, explicitly builds on FUNCTIONAL-BLUEPRINT. No date.

- Defines **12 operational domains** (Sales & Distribution, Client Management, Policy Management,
  Collections & Receipting, Claims, Funeral Operations, Group/Society Business, Finance & Accounting,
  Product & Pricing Config, Reporting & Analytics, Administration & Access, **Platform Management**)
  each with frequency/criticality ratings — Policy Management and Collections & Receipting are rated
  **"Mission-critical."**
- **8 entity hierarchies (A–H)** mapping parent/child/shared/reference relationships across Sales,
  Claims/Funeral, Group/Society, Membership, Product/Pricing, Finance, Access/Governance, and
  **Platform** (Hierarchy H: `Organization-as-Tenant → AppRelease, AppDownloadInterest,
  PlatformReceivable`, explicitly noting *"control-plane registry coordinates isolated tenant DBs"* —
  a direct, named control-plane statement).
- **Terminology fixes (Phase 3):** 12 documented naming conflicts with recommended user-facing labels
  vs unchanged internal table names — e.g. "Group / Employer Scheme / Burial Society / Sub Group" all
  map to one `groups` table, recommended label "Scheme"; flags `receipts` vs `payment_receipts` again
  as **"unproven duplicate — investigate before any merge."**
- Proposes a **7+Home top-level nav** (HOME · SALES · POLICIES · COLLECTIONS · CLAIMS · FINANCE ·
  REPORTS · SETUP) — this is the version the Transformation Plan later revises to 9 buckets by
  splitting POLICIES into POLICIES+CLIENTS. **This document's 7-bucket model and the Transformation
  Plan's 9-bucket model are sequential drafts, not a contradiction** (the Transformation Plan explicitly
  says "My earlier blueprint proposed 8" — actually this doc is the "earlier blueprint" being revised).
- Full migration sequencing (5 steps, low-risk-first) and an explicit "what does NOT change" section:
  every route, API, permission, workflow, table stays the same — access-path/label reorganization only.

## B.4 `docs/SYSTEM-SPEC.md`
**Type:** Advisor-facing architecture briefing, most comprehensive and internally consistent single
doc of the three "system spec" style docs; states figures are **"derived directly from source, not
aspirational"** and calls itself a "living document."

Precise current-state numbers claimed: **81 tables, ~226 API endpoints, ~273 storage methods, 27
staff pages, 54 permissions across 9 roles.** (Matches FUNCTIONAL-BLUEPRINT's 54-permission count —
these two are mutually consistent and both post-date MEGA-PROMPT's 41-permission figure.)

Explicit **multi-tenancy model** statement (§3.3): two isolation layers — (1) row-level
`organization_id` scoping via `requireTenantScope` (default/primary), (2) optional per-tenant isolated
database via `organizations.databaseUrl`, coordinated by a control-plane DB holding the shared
org/user registry. Platform Owner sits above all tenants (implicit all-permissions + `create:tenant`,
`delete:tenant`, `manage:whitelabel`, tenant switching).

**§9 "Observations for the advisor"** — a candid list of architectural risks explicitly worth
validating in a later Multi-Tenancy Readiness section:
1. Monolithic `routes.ts` (241KB/226 endpoints) and `storage.ts` (163KB/273 methods) — maintainability
   risk, candidate for domain-based modular split.
2. **Two tenancy models coexisting** — row-scoping + optional isolated DB — flags the operational
   complexity of running both (migration consistency across tenant DBs, control plane as single
   point of coordination) as something to assess.
3. PayNow polling-not-webhooks — flags reviewing cadence/reconciliation/in-flight-intent-on-restart
   behavior (Part A of this doc found this is a **polling+webhook hybrid**, not polling-only).
4. Hand-rolled outbox/job-queue vs managed broker — flags durability/retry/back-off/dead-lettering/
   observability as review points (Part A confirms: 8-attempt retry, dead-letter via `status:"failed"`
   row with no dead-letter UI found, no managed broker).
5. Auth surface (client email/password+OAuth+security-Qs) — review password reset/lockout/brute-force.
6. Permission breadth (54×9 roles + per-user overrides) — risk of least-privilege drift.
7. Reporting load — in-process multi-currency statement building (`financial-statements.ts`) — assess
   query cost / read-replica / pre-aggregation needs at scale.
8. Test coverage ratio vs 226-endpoint surface area.
9. **"Single mega-PRD + many ad-hoc docs… 30+ documents including overlapping reports… Consolidating
   into a maintained source-of-truth set would help onboarding."** — SYSTEM-SPEC.md itself flags the
   doc sprawl this Part B is now cataloguing.

## B.5 `docs/SCALABILITY-REPORT.md`
**Type:** Capacity/scaling numbers doc, no date, framed as living estimates ("run load tests to confirm").

Key figures: default `DB_POOL_MAX=25`; dashboard cap `DASHBOARD_MAX_ROWS=50,000`; report export cap
`REPORT_EXPORT_MAX_ROWS=15,000`; most list endpoints paginate at 100/page default, 500/page max;
JSON body limit 1MB. Estimated single-instance capacity: **~100–250 concurrent users**, **~60–180
req/s mixed API**, **~200–600 req/s for light endpoints**. Sessions are Postgres-backed
(`connect-pg-simple`) so horizontal scaling needs no sticky sessions, but **file uploads are on local
disk** (`uploads/`) and are **not shared across instances** without an external store/S3 — flagged as
a blocker for true horizontal scaling until object storage (S3) is fully adopted everywhere (note:
`server/object-storage.ts` / DigitalOcean Spaces is documented elsewhere as already provisioned per
project memory — this doc may understate current object-storage adoption). Recommends `DB_POOL_MAX`
40–80 for higher concurrency, Redis for shared rate limiting across instances, and moving heavy
dashboard aggregations into SQL/materialized views if a tenant exceeds tens of thousands of policies.

## B.6 `docs/AUDIT-PERFORMANCE-SECURITY-ARCHITECTURE.md`
**Type:** Dated point-in-time audit report. **Date: 2025-03-04.** This is one of only two dated docs
in this set (the other is POL263-DEPLOY-ANALYSIS-REPORT.md, 2025-02-27) — both are **over a year
stale relative to "today" (2026-07-04)** and predate essentially all the multi-tenant control-plane
work (REFACTOR-PROGRESS.md is dated 2026-04-14, over a year later) and all recent legacy-group/premium
-override feature work.

Documents specific *already-implemented-at-that-time* fixes: 409 response on duplicate idempotency
key for `POST /api/payments`; `getRolesByIds`/`getPoliciesByIds` batch APIs replacing N+1 loops;
Paynow webhook rate limit (60/min per IP) added; Redis-backed rate-limit store when `REDIS_URL` set.
Confirms hash verification (`verifyPaynowHash`, SHA-512) is mandatory on both the result-URL webhook
and the poll response, and that webhook handler always returns 200 to stop PayNow retry storms — all
independently confirmed still true by direct code reading in Part A.

Flags remaining/acceptable N+1 patterns as of that date: Paynow webhook loops over all orgs to resolve
`merchant_reference` (bounded by tenant count); `applyGroupPaymentToPolicies` loops per allocation;
`getUserEffectivePermissions`/role-management loop over orgs to find which tenant DB owns a role.
Suggests (as a still-open follow-up) a global `merchant_reference → organization_id` lookup table in
the main DB to collapse the webhook's per-tenant scan to O(1) — **not implemented as of current code**
(Part A confirms `handlePaynowResult` still does `Promise.all(orgs.map(...))` lookups).

## B.7 `docs/PRODUCT-REQUIREMENTS.md`
**Type:** QA/TestSprite-oriented PRD (v1.0), acceptance-criteria style, no date. Describes client login
as **"policy number + password"** in the acceptance-criteria section title, but body text elsewhere
in the same repo generation (MEGA-PROMPT) also uses "national ID + password" language for the client
auth flow narrative — **these two docs disagree on the client login identifier** (policy number vs
national ID); current `docs/POL263-FUNCTIONAL-BLUEPRINT.md` and `SYSTEM-SPEC.md` describe client auth
simply as "email/password or Google OAuth," which matches the CLAUDE.md project instructions
("Clients: Email/password or Google OAuth") and should be treated as authoritative — this PRD and
MEGA-PROMPT's login-identifier descriptions are stale.

Otherwise a straightforward feature/acceptance-criteria catalogue per portal (staff, agent, client)
and cross-cutting RBAC/whitelabel/responsive/error-handling requirements — useful mainly as a QA
checklist, not an architecture source.

## B.8 `docs/OVERHAUL-REPORT.md`
**Type:** Short completed-work + recommendations log from an earlier codebase-review pass, no date.
Completed items listed: error-handling hardening in `client-search-input.tsx`, `client/payments.tsx`,
`join/register.tsx`; a `server/routes.ts` month-end-run logging fix; README architecture correction
(Drizzle not Prisma). **Recommended next steps** (still likely relevant / worth re-checking against
current code): introduce `AuthenticatedRequest` type instead of `req.user as any`; extend Zod
validation to all mutable routes; align RBAC unit tests with real permission names; move
`PLATFORM_SUPERUSER_EMAIL` to env (**note:** current code/CLAUDE.md uses `SUPERUSER_EMAIL`, suggesting
this recommendation was later acted on / the var was renamed); standardize on one fetch wrapper
(`apiRequest`); `npm audit`/`npm outdated`. This is a low-stakes internal QA log, not a strategic doc.

## B.9 `docs/UX-PRODUCT-STRATEGY.md`
**Type:** Companion strategy doc to SYSTEM-SPEC, answering "12 discovery questions" with explicit
**operating assumptions** flagged as defaults-not-facts (branch count ≤20, sales mix
walk-in≈group>agent, mobile split ~55/35/10, top user = cashier+agent). No date.

This is the **earliest** of the three navigation-redesign docs in the design lineage: proposes a
**4-bucket** nav (WORK · MONEY · INSIGHTS · SETUP) — later superseded by the Domain/Nav Blueprint's
7-bucket model, which was itself superseded by the Transformation Plan's 9-bucket model. **All three
share the same underlying diagnosis** (users can't tell menus apart; "Platform Fees"/App Releases
leak tenant-visible platform revenue data and should be Owner-only; FX/Audit/Diagnostics/Terms should
be demoted to Setup) — the bucket-count evolution is refinement, not disagreement, and the
Transformation Plan is the most recent/authoritative of the three (it explicitly cites and revises the
other two).

Five-phase roadmap: (1) stop-the-bleeding tab-fix/de-dup (marked done at time of writing), (2)
re-architect nav to Work/Money/Insights/Setup + Ctrl-K palette, (3) role-based Home, (4) hero-flow
polish, (5) visual system (50% Linear/30% Stripe/20% Salesforce blend — this visual-language decision
is repeated verbatim in the later Transformation Plan, confirming continuity between the two docs).

## B.10 `docs/MEGA-PROMPT.md`
**Type:** The single largest and **most stale** doc in this set (1384 lines) — a from-scratch
comprehensive rebuild specification. Strong internal evidence of staleness relative to current code:
- Claims **41 permissions across 14 categories** and **9 roles**, whereas FUNCTIONAL-BLUEPRINT and
  SYSTEM-SPEC both independently state **54 permissions, 20 categories** — a clear count mismatch;
  the higher, more recent figure should be treated as authoritative (permissions were added over time).
- Uses table name **`revenue_share_receivables`** for the platform's 2.5% cut, whereas current
  `backup-sync.ts` (read directly from source in Part A) uses `platform_receivables` — the table was
  renamed since this doc was written.
- Describes a standalone **`feature_flags`** table (org-scoped toggle rows) — SYSTEM-SPEC's 81-table
  inventory does **not** list a `feature_flags` table at all, and the Transformation Plan's Part H
  states outright **"POL263 has no flag system today"** and proposes introducing one via a nullable
  JSONB column — meaning either the `feature_flags` table was removed/never shipped, or MEGA-PROMPT
  described a planned-but-unbuilt table. Either way, **do not treat `feature_flags` as an existing
  table** without verifying against current `shared/schema.ts`.
- Describes client login as **"national ID + password."** As noted in B.7, current docs/CLAUDE.md say
  email/password.
- No mention anywhere of legacy groups, premium overrides, age-band member pricing, mortuary/
  post-mortem/partner-parlour features, or the control-plane/tenant-database architecture from
  REFACTOR-PROGRESS.md — confirming it predates all of that work.
- Still useful as a **very detailed, mechanically precise walkthrough** of core workflows (policy
  lifecycle state machine, claim transitions, PayNow flow steps, month-end processing, commission
  calculation formulas, audit log shape) that are structurally still accurate even if some field/table
  names have since evolved — treat as directionally correct but **verify every table/column name
  against current `shared/schema.ts` before relying on it.**
- Also contains detailed **build-constraint** documentation (Tailwind v3-not-v4, Vite 5-not-6/7,
  esbuild native-binary handling, Linux-generated lockfile) for the DigitalOcean deploy target — this
  section appears independently corroborated by POL263-DEPLOY-ANALYSIS-REPORT.md and is likely still
  accurate (build-tooling constraints change less often than feature schema).

## B.11 `docs/REFACTOR-PROGRESS.md`
**Type:** Living progress tracker for the **multi-tenant control-plane extraction**, explicitly dated
**"Last updated: 2026-04-14"** — this is the **most recent dated doc in the entire set** and should be
treated as authoritative for anything about the control-plane/tenant-database architecture, superseding
any conflicting older description in MEGA-PROMPT or SYSTEM-SPEC's more general "two isolation layers"
framing.

**Architecture target (from initial brief):** three separate DigitalOcean Postgres clusters —
`pol263-control-plane` (tenant registry/routing), `pol263-falakhe` (Falakhe's isolated data),
`pol263` (shared fallback DB for non-isolated tenants) — one shared codebase, per-request tenant
resolution, with **provider abstraction layers for payments/WhatsApp/SMS planned as Phase 2** and
**tenant-aware queue/worker architecture planned as Phase 4.**

**Phase 1 — Control Plane Extraction: marked COMPLETE.** Concrete artifacts built and listed by
filename: `shared/control-plane-schema.ts` (tenants, tenant_domains, tenant_databases, tenant_storage,
tenant_integrations, tenant_branding, tenant_feature_flags — **this is the actual, current
feature-flags-adjacent schema**, living in the control-plane DB, not a generic `feature_flags` table
as MEGA-PROMPT described), `server/control-plane-db.ts` (dedicated pool, max 5), `server/tenant-
resolver.ts` (resolves `req.tenantId` from header → subdomain → custom domain → session fallback),
updated `server/tenant-db.ts` (control-plane-driven routing with shared-DB fallback if control plane
is unreachable). Falakhe fully migrated off Supabase onto its own isolated `pol263-falakhe` DB; 6 orgs
total copied into the control plane (Falakhe production-isolated; Sunrest, Test Tenant, Valleyside,
Shego all marked "Test," one Sunrest duplicate marked deleted/`isActive=false`).

**Phase 2 — Payment + Integration Abstraction: NOT STARTED.** Explicit goal: move PayNow credentials
out of env vars into `tenant_integrations` rows in the control plane, add a `PaymentAdapter` interface
with `PaynowAdapter`/`StripeAdapter` implementations, `WhatsAppAdapter`/`SMSAdapter` interfaces, an
`integration-loader.ts`, and AES-256-GCM encryption for secrets via `TENANT_CONFIG_ENCRYPTION_KEY`.
**This is a clean, actionable, already-scoped candidate for a later "Control Plane Candidates" /
provider-abstraction section** — current code (per Part A / CLAUDE.md) still reads
`PAYNOW_INTEGRATION_ID/KEY` from env, confirming Phase 2 genuinely has not started.

**Phase 3 — Remaining Tenant Data Isolation: NOT STARTED.** Goal: provision isolated DBs for Sunrest
and Valleyside when they go live for real, using the same `db:push:tenant` → migrate → `cp:set-*-db`
script sequence already proven for Falakhe.

**Phase 4 — Queue/Worker Architecture: NOT STARTED.** Goal: a tenant-aware job queue (notifications,
receipts, commission recalc, reports) where every job carries `tenantId` so a worker resolves the
correct DB before processing, plus per-tenant scheduled jobs (month-end runs, premium reminders).
**Directly relevant to Part A of this doc:** the current job-queue/outbox implementation (A.1–A.2) is
already somewhat tenant-aware (outbox rows carry `organizationId`, background sweep iterates per-org),
but there is **no dedicated worker process** — everything still runs in the same Node process as the
web server. This doc confirms that gap is a known, planned-but-unstarted phase, not an oversight.

Also documents **known DO-specific infra gotchas** (worth carrying into a deployment section):
DO managed Postgres blocks `session_replication_role` (doadmin isn't superuser — migration scripts
insert in strict FK order instead; note this differs from `backup-sync.ts`, which *does* use
`session_replication_role = replica` successfully against the **Supabase** backup target, not a DO
target — consistent, not contradictory); DO pooler URLs use the pool name as the URL path segment,
not the real database name (`defaultdb`); `connect-pg-simple` needed `createTableIfMissing: false` in
bundled production builds; DO pooler port 25061 needs a named pool configured in the dashboard or
migrations must use the direct port 25060; `drizzle-kit push` against DO needs
`NODE_TLS_REJECT_UNAUTHORIZED=0` for its self-signed cert chain.

Ends with a **Supabase decommission checklist** (unchecked as of 2026-04-14): verify Falakhe row-count
parity, confirm OAuth/payments work in prod, then remove `SUPABASE_DATABASE_URL` from DO env and local
`.env`, then pause/delete the Supabase project — **note this is in tension with `backup-sync.ts`
(current code, read in Part A), which actively targets `SUPABASE_BACKUP_URL`** — i.e. Supabase is
being decommissioned as the *primary* tenant database but simultaneously (re)adopted as the *backup*
target. Not a contradiction once you note the two are different Supabase roles/projects/purposes, but
worth flagging explicitly so a later section doesn't mistakenly read backup-sync.ts as evidence that
the Supabase migration-away effort stalled.

## B.12 `docs/TENANT-DATABASES-WITHOUT-SUPABASE.md`
**Type:** Provider-agnostic explainer of the existing per-tenant DB mechanism, no date, but content is
consistent with (and simpler/clearer than) SYSTEM-SPEC's §3.3 and REFACTOR-PROGRESS's Phase 1.

Confirms precisely: `getDbForOrg(orgId)` in `server/tenant-db.ts` loads `organization.databaseUrl`
from the default/registry DB; if unset, returns the default pool; if set, returns a **cached dedicated
pool** to that URL. Registry data (`organizations`, `users`) **always** stays on the default DB
regardless of any tenant's dedicated DB, so the app can always resolve routing. States explicitly:
**"It does not depend on Supabase. Any PostgreSQL … works"** and **"no code change is required for
multi-tenancy"** to move off Supabase — i.e. the tenant-database mechanism itself is already fully
generic/provider-agnostic; only the *specific* URLs configured need to change. Gives three named
deployment patterns: Option A (single shared DB, separation by `organization_id` only), Option B/
Hybrid (some tenants isolated, most shared), Option C/Full isolation (one DB per tenant, registry on
its own small DB) — useful vocabulary for a later Multi-Tenancy Readiness section since it names the
exact spectrum POL263 already supports today, not aspirationally.

## B.13 `docs/POL263-DEPLOY-ANALYSIS-REPORT.md`
**Type:** Dated incident/root-cause doc. **Date: 2025-02-27** (the oldest dated doc, one week before
the AUDIT-PERFORMANCE-SECURITY doc). Diagnoses why DigitalOcean builds silently kept serving stale
code: (1) App Platform's default `npm ci` skips `devDependencies`, but the build needs `tsx`/`vite`/
`tailwindcss`/`esbuild` from devDependencies — fix is `npm run build:do` (= `npm ci --include=dev &&
npm run build`) or setting `NPM_CONFIG_PRODUCTION=false`; (2) an out-of-sync `package-lock.json`
breaks `npm ci` entirely; (3) critically, **"Restart" on DO does not rebuild** — it only restarts the
last successfully built container image, so a failed build silently leaves the live app on old code
indefinitely until a successful **Deploy/Force Rebuild** occurs. Notes the analysis environment was a
Cursor worktree pointed at `codeguru2025/POL263` on GitHub (different remote naming than the current
session's `origin`, but same logical repo) with **uncommitted changes at analysis time** in `.npmrc`,
README, client components, server routes, deploy docs — i.e. this was a live-debugging session doc,
not a design doc. Cross-references `docs/DEPLOY-DIGITALOCEAN-APP.md` and `docs/DEPLOY-CHECKLIST.md`
(not read for this task) as the canonical deploy runbooks this analysis supplements.

---

## B.14 Recency ranking & contradiction summary (for the later synthesis step)

**Explicit dates found:** REFACTOR-PROGRESS.md (2026-04-14, newest) > AUDIT-PERFORMANCE-SECURITY-
ARCHITECTURE.md (2025-03-04) > POL263-DEPLOY-ANALYSIS-REPORT.md (2025-02-27). All other docs are
undated; recency was inferred from feature/schema references.

**Inferred staleness ranking (oldest → newest), by content evidence:**
1. **MEGA-PROMPT.md** — most stale: 41 permissions (vs current 54), `revenue_share_receivables` (vs
   current `platform_receivables`), a standalone `feature_flags` table that the Transformation Plan
   says doesn't exist, "national ID + password" client login (vs current email/password), no
   control-plane/tenant-isolation architecture mentioned at all.
2. **PRODUCT-REQUIREMENTS.md** — also uses a stale client-login description ("policy number +
   password" in one place); otherwise generic enough to still mostly hold.
3. **UX-PRODUCT-STRATEGY.md** — first draft of the nav redesign (4-bucket WORK/MONEY/INSIGHTS/SETUP);
   superseded by the Domain/Nav Blueprint and then the Transformation Plan, but its underlying
   diagnosis (menu confusion, Platform Fees leaking tenant-visible platform data) still stands and is
   carried forward verbatim into the newer docs.
4. **POL263-DOMAIN-AND-NAVIGATION-BLUEPRINT.md** — second draft (7-bucket nav); explicitly superseded
   by the Transformation Plan's 9-bucket refinement, but its domain model / entity hierarchy / FK
   chains are foundational and still directly checkable against `shared/schema.ts`.
5. **POL263-FUNCTIONAL-BLUEPRINT.md** — discovery doc feeding both nav docs; permission/table counts
   (54 permissions, 81 tables via cross-reference to SYSTEM-SPEC) match the more recent SYSTEM-SPEC,
   suggesting this and SYSTEM-SPEC were written close together and are mutually current.
6. **SYSTEM-SPEC.md** — most comprehensive and self-aware ("living document," counts "derived from
   source"); best single-doc snapshot of current architecture apart from the control-plane specifics.
7. **POL263-TRANSFORMATION-PLAN.md** — most recent nav-design doc (explicitly revises the other two
   nav docs); best source for the *final* proposed IA if a later section needs "what was decided."
8. **REFACTOR-PROGRESS.md** — dated 2026-04-14, the newest artifact in the whole set, and the
   **authoritative source for control-plane/tenant-database architecture state** (Phase 1 done, Phases
   2–4 explicitly not started). Given the current session's git log shows commits from 2026-07 (legacy
   groups, premium overrides), this doc is ~3 months stale relative to "today" but still describes the
   control-plane skeleton that is presumably still in place (not contradicted by anything read in Part
   A — `backup-sync.ts`, `tenant-db.ts` usage patterns in `outbox.ts`, all consistent with this doc's
   description of `getDbForOrg`/control-plane routing).
9. **TENANT-DATABASES-WITHOUT-SUPABASE.md**, **AUDIT-PERFORMANCE-SECURITY-ARCHITECTURE.md**,
   **POL263-DEPLOY-ANALYSIS-REPORT.md**, **OVERHAUL-REPORT.md** — narrow-scope, single-purpose docs
   (explainer, point-in-time audit, incident analysis, QA log respectively) that don't compete for
   "most authoritative" status on any topic besides their own narrow one; treat each as authoritative
   only within its stated scope and date.

**Concrete contradictions to carry into synthesis:**
- **Permission count:** 41 (MEGA-PROMPT, stale) vs 54 (FUNCTIONAL-BLUEPRINT + SYSTEM-SPEC, current) —
  use 54, verify against `shared/schema.ts`/`constants.ts` `ROLE_PERMISSION_MAP` directly if exact
  count matters.
- **Platform-revenue table name:** `revenue_share_receivables` (MEGA-PROMPT, stale) vs
  `platform_receivables` (current code, `backup-sync.ts` + `outbox-handlers.ts`, confirmed by direct
  read) — use `platform_receivables`.
- **Client login identifier:** "national ID + password" / "policy number + password" (MEGA-PROMPT,
  PRODUCT-REQUIREMENTS — both stale) vs "email/password or Google OAuth" (FUNCTIONAL-BLUEPRINT,
  SYSTEM-SPEC, CLAUDE.md — current) — use email/password + Google OAuth.
- **Feature-flag existence:** MEGA-PROMPT describes a standalone `feature_flags` table; the
  Transformation Plan states outright "POL263 has no flag system today" and proposes building one;
  REFACTOR-PROGRESS.md's actual shipped schema has `tenant_feature_flags` in the **control-plane** DB
  (per-tenant, not per-org-row) — these are three different things. Treat `tenant_feature_flags`
  (control-plane) as the only currently-real one; the generic app-level `feature_flags` concept is
  either removed or was never built.
- **Top-level nav bucket count:** 4 (UX-PRODUCT-STRATEGY) → 7 (DOMAIN-AND-NAVIGATION-BLUEPRINT) → 9
  (TRANSFORMATION-PLAN) — sequential refinement, not a real contradiction; use the 9-bucket model as
  the "decided" version since the Transformation Plan explicitly supersedes the other two.
- **PayNow "no webhooks" framing:** Nearly every doc (FUNCTIONAL-BLUEPRINT, SYSTEM-SPEC, MEGA-PROMPT)
  says "PayNow has no webhooks, payment status is polled." Part A of this doc, from direct code
  reading, found this is **imprecise**: POL263 does register and handle an inbound PayNow result-URL
  webhook (`POST /api/payments/paynow/result`) *in addition to* client-driven polling. The docs are
  describing PayNow's *historical* reputation/design (which is why polling exists at all as a
  fallback/primary confirmation path) rather than being factually wrong about POL263's own webhook
  endpoint — but a later section should state precisely that **both** mechanisms exist, with polling
  as the primary confirmation path.

**Docs requested but confirmed present (none missing):** all 13 files listed in the task existed and
were read in full: POL263-TRANSFORMATION-PLAN.md, POL263-FUNCTIONAL-BLUEPRINT.md,
POL263-DOMAIN-AND-NAVIGATION-BLUEPRINT.md, SYSTEM-SPEC.md, SCALABILITY-REPORT.md,
AUDIT-PERFORMANCE-SECURITY-ARCHITECTURE.md, PRODUCT-REQUIREMENTS.md, OVERHAUL-REPORT.md,
UX-PRODUCT-STRATEGY.md, MEGA-PROMPT.md, REFACTOR-PROGRESS.md,
TENANT-DATABASES-WITHOUT-SUPABASE.md, POL263-DEPLOY-ANALYSIS-REPORT.md.
