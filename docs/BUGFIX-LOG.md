# Bug Fix Log

Running log of bugs found and fixed in POL263, with root cause and the actual fix — not
just "what changed" but "why it broke." Read this before debugging something that smells
familiar; a five-minute read here can save an hour of re-diagnosing a problem already solved.

**Convention:** every time a real bug is fixed (not a feature addition), add an entry here
in the same session, before moving on. Newest entries at the top. See the "Documentation
convention" note in `CLAUDE.md`.

---

## 2026-08-12 — Mortuary/funeral-day fee payments never counted as income

Augustus noticed a mortuary fee paid that day didn't show up in the daily report's income total.

**Root cause:** three separate "mark this fee as paid" routes update a status flag directly on
their own domain table and stop there — none of them ever create a `service_receipts` row, which
is the only place `queryReceipts()` (`server/financial-statements.ts`) looks for cash-service
income when building the income statement / daily report:
- `POST /api/mortuary-intakes/:id/storage-payment` (partner-parlour storage fee) → only updated
  `mortuary_intakes.storage_fee_*`
- `POST /api/mortuary-intakes/:id/chapel-wash-bay-payment` (legacy combined fee, now dead for new
  dispatches — `chapelWashBayUsed` is force-set `false` on every new dispatch) → only updated
  `mortuary_dispatches.chapel_wash_bay_fee_*`
- `POST /api/case-service-charges/:id/payment` (the live path — chapel/body-wash/removal/etc.
  billed via the mortuary service rate card) → only updated `case_service_charges.status`

Each of these tables tracks "is this fee paid" as its own source of truth, completely disconnected
from the `service_receipts`/`payment_receipts` tables that `buildIncomeStatement` actually sums.
The daily report's "operations" section does list mortuary intakes/dispatches, but only as
informational counts — dollar figures come exclusively from `buildIncomeStatement`.

**Fix:** all three routes (`server/routes.ts`) now also call `storage.createServiceReceipt(...)`
(same helper `POST /api/funeral-cases/:id/receipts` already used) immediately after flipping the
status flag — issuing a real receipt with the fee amount/currency, linked `funeralCaseId`/
`branchId` where available, `paymentChannel` defaulting to `"cash"`. Each route now also guards
against a missing/zero fee amount (400) instead of silently issuing a $0 receipt.

**Backfill:** scanned Falakhe's tenant DB (the only org with any paid rows in these tables — the
shared platform DB had none for any other tenant) and found 25 storage-fee payments dating back to
2026-06-28, including the one Augustus flagged, that were paid but never got a receipt ($480
total, USD). Wrote `scripts/backfill-mortuary-storage-receipts.mjs` — issues one `service_receipts`
row per affected intake, backdated to the actual `storage_fee_paid_at`, attributed to the staff
member who recorded it (looked up from `audit_logs.actor_id` for the matching
`RECORD_STORAGE_PAYMENT` entry; 3 rows had no `actor_id` on the audit row and were attributed to
Augustus's tenant-local user id, consistent with the earlier blank-attribution cleanup convention
in [[project_falakhe_tenant]]). Idempotent via `metadata_json->>'mortuaryIntakeId'`, safe to rerun.
Ran once against Falakhe's DB — 25/25 created, 0 skipped. No paid chapel-wash-bay or
case-service-charge rows existed yet anywhere, so no backfill was needed for those two paths.

**Verified:** `npm run check` clean; 331/331 tests pass; queried `service_receipts` post-backfill —
today's (2026-08-12) $20 fee (MTONISELWA NYATHI) now appears, and the 25-row backfill sums to
exactly $480.00 USD.

**Lesson for next time:** in this codebase, a domain table that tracks its own `*_status`/`*_paid`
column (as opposed to going through `payment_receipts`/`service_receipts`) is a strong signal that
it's *invisible to every financial report* — `buildIncomeStatement`/`queryReceipts` only ever read
those two receipt tables (plus `legacy_group_receipts` via raw SQL), never the source domain
tables. When adding or auditing any "mark as paid" action anywhere in the app (new module, new fee
type, new one-off payment button), check whether it ends by mutating a status flag alone versus
actually issuing a receipt — if the former, it will silently never show up in income, no matter
how correct the rest of its logic is. `grep` for `.set({.*[Ss]tatus.*paid` across `routes.ts`
next time this class of report-mismatch bug is suspected.

---

## 2026-08-07 — Fixed-column form grids overlapped on mobile: 58 sites across 22 files with no responsive fallback

Augustus reported policy search "not filtering" (turned out to be a stale cached bundle from a
rocky mid-session deploy, not a real bug — resolved itself on reload) and, separately, sent a
real-device screenshot of the "Issue New Policy" wizard's New Client form on an Android phone:
labels and inputs rendering fused together ("NamEmail", "PhoneEmail", "National Date of Birth").

**Root cause:** several `<div className="grid grid-cols-N ...">` layouts (N=2 or 3) had zero
responsive breakpoint variation — Tailwind is mobile-first, so an unprefixed `grid-cols-N`
applies at *every* screen width, including phones (~360-430px). Two form-field columns forced
into that width left each `<Input>` a sliver wide, with labels crowding into the next field's
space. The specific quote-dependent mini-form inside `create-policy-wizard.tsx` (lines 957/961,
`grid-cols-2` with no breakpoint) was the immediate site behind the screenshot; a codebase-wide
grep for the same bare-`grid-cols-N` pattern turned up 58 more instances across 22 files —
staff dashboards, client detail panels, group/society forms, finance report KPI rows, and public
pages (agent vCard quote form, tenant signup, policy registration) that are disproportionately
opened on phones since they're shared as links.

**Fix:** `grid-cols-1 sm:grid-cols-N` — the pattern this codebase already used correctly
elsewhere (e.g. `create-policy-wizard.tsx:579`, `overview-tab.tsx:155`). Single column below
640px, identical N-column layout at `sm:` and up, so no desktop/tablet spacing or density
changed. Deliberately left alone: decorative "how it works" 3-icon strips and short two-button
toggle rows (WhatsApp/Call, Save/Share, Monthly/Yearly) — those aren't broken at N columns on a
narrow screen, only genuine multi-field forms are. Applied via two parallel subagents (batched
by risk area) plus direct edits for the public-facing signup/registration/vcard pages, each
verified as a single-token diff (`grid-cols-N` → `grid-cols-1 sm:grid-cols-N`, nothing else
touched) before `tsc`/build/331 tests were run as a final combined check.

**Verified:** `npm run check`, `npm run build`, `npm run test` (331/331) all clean; every diff
hunk spot-checked to confirm only the grid-cols token changed, no gap/spacing/text-size classes
touched. Not yet re-verified on a real device post-fix (my own browser-automation viewport
resize doesn't actually change `window.innerWidth` in this environment — confirmed stuck at
1536px across multiple resize attempts — so live mobile testing depends on Augustus's phone).

**Lesson for next time:** a bare `grid-cols-N` (N≥2) with no `sm:`/`md:` prefix anywhere on the
line is the single highest-signal grep for "broken on mobile" in this codebase — `grid grid-cols-[2-6]` catches candidates, but many are legitimate (KPI stat pairs that already vary
by breakpoint, e.g. `grid-cols-2 md:grid-cols-4`, or short button-pair rows) so each hit needs a
quick read to distinguish "form fields crammed into a fixed column count" (real bug) from
"intentionally short 2-3-up cards/buttons that are fine at any width" (not a bug). Also: this
session's own `resize_window` browser-automation tool does not reliably change the actual
rendered viewport in this sandboxed environment — don't trust it for mobile-viewport
verification without confirming `window.innerWidth` actually changed first.

---

## 2026-08-04 — Per-tenant dedicated-database provisioning had never actually worked: 8 latent bugs found by finally exercising it end-to-end

Augustus asked which database IFALAKHE FUNERAL SERVICES (a same-day self-signup tenant) was
using, then asked to commission it a dedicated database on the shared cluster — the intended
default architecture (`server/do-database-provisioning.ts`'s own header comment already
documented this: one logical database per tenant inside one shared DO cluster, not a cluster
per tenant, since DO caps accounts at 10 clusters). This was the first time this whole feature
was ever exercised against a real signup rather than the manual admin script it was extracted
from — every one of the 8 bugs below was latent, not new; nothing about IFALAKHE was special.

**1. Advisory lock class exceeded `int4` range.** `TENANT_DB_PROVISIONING_LOCK_CLASS =
9_002_630_005` (`server/tenant-db-commissioning.ts`) followed the naming convention of four
other lock constants (`PAYMENT_AUTO_LOCK_KEY` etc.) that are all called via `withAdvisoryLock`'s
single-argument form (routes to `pg_try_advisory_lock(bigint)`, tolerates ~9 billion fine) — but
this one is called via the two-argument class+key form (`pg_try_advisory_lock(int, int)`), where
*both* arguments must fit a 32-bit `int4` (~2.147 billion max). Every call threw immediately.
Resized to `900263005`, matching `BACKFILL_LOCK_CLASS` (900263002 in `server/routes.ts`), the
only other 2-arg advisory lock class in the codebase.

**2. SSL `sslmode` conflict on the provisioning admin connection.** DO's cluster connection URI
embeds `?sslmode=require`, which fights with an explicit `ssl: { rejectUnauthorized: false }`
pool option passed alongside it — Postgres still attempted full certificate-chain verification
and failed with `self-signed certificate in certificate chain`. Same class of issue already
worked around for every other DO/self-signed-tolerant pool (`buildPoolConfig` in
`server/tenant-db.ts`) — this provisioning flow's own connections had just been missed. Added
`stripSslMode()` in `server/do-database-provisioning.ts`, same fix.

**3. "Database name already exists" detection didn't match DO's actual error shape.**
`isDuplicateDbNameError` checked for `409` or `400`+`"already exists"` — DO's Managed Databases
API actually returns `422 unprocessable_entity` / `"database name is not available"`. A retry
after any partial failure (exactly the scenario a real retry hits) hard-failed instead of
treating the already-created logical database as idempotent success. Added the real observed
shape to the check.

**4. 6 tables missing from `migrations/` entirely.** `parlour_personnel`, `payment_disbursements`,
`bank_accounts`, `bank_deposits`, `bank_statement_balances`, `balance_sheet_entries` exist in
every real database (main, Falakhe) but were created via `npm run db:push` directly at some
point in the past and never captured as a tracked migration file — exactly the historical drift
this repo's "never use `db:push`" rule (see [[feedback_no_drizzle_push]]) already exists to
prevent going forward, just never backfilled from before that rule existed. Never noticed
because `npm run db:migrate` only ever runs against already-existing databases that already have
these tables — this only matters when building a database from `migrations/` alone from empty,
which per-tenant commissioning is the only code path that ever does. Added
`migrations/0004_baseline_missing_tables.sql`, generated from a direct introspection of the live
database's `information_schema`/`pg_catalog` (columns, FKs, indexes, constraints) — not
transcribed from `shared/schema.ts`, to avoid the exact kind of drift that caused this gap in the
first place. One FK (`bank_deposits.safe_id → safes`) had to be split into a separate migration
(`0065_zz_bank_deposits_safe_fk.sql`) positioned after `0065_safes.sql`, since `payment_disbursements`
(also in the baseline file) needs to exist before `0064_disbursement_cross_currency.sql` — no
single insertion point satisfies both orderings.

**5. `payment_receipts.approval_status` — the same class of gap, one column this time.** Also
`db:push`-only, never in a tracked migration; `0080_performance_indexes.sql`'s partial index on
it failed on a schema-only build. Added `migrations/0079_zz_payment_receipts_approval_status.sql`.
(A full static sweep for *every* other possibly-missing column was attempted and abandoned — two
regex-based attempts both produced unreliable results, one wildly over-counting via a shell-
escaping bug, one under/over-counting via cross-statement regex spanning. Real Postgres replay
against an actual empty database, fixing each error as it surfaces, proved far more reliable
than static analysis here and is what actually found every issue in this entry.)

**6. A tenant-specific data `INSERT` was bundled into the general migration stream.**
`0074_country_flag_settings.sql` hardcoded `INSERT INTO country_flag_settings VALUES
('4eadab0e-...' [Falakhe's org id], ...)` — correct for the shared registry DB and Falakhe's own
database (both contain that row), but every *other* tenant's fresh database doesn't have and
will never have Falakhe's organization row, so the FK constraint failed immediately.
`ON CONFLICT DO NOTHING` didn't help — that only suppresses a conflict on the insert target, not
an FK violation on a referenced row that doesn't exist. Rewrote as `INSERT ... SELECT ... WHERE
EXISTS (SELECT 1 FROM organizations WHERE id = ...)`, safe against any database regardless of
whether that specific org exists in it.

**7. json/jsonb round-trip bug in the tenant data-copy step.** `copyTenantTable`
(`server/tenant-data-migration.ts`) selects rows from the source database — node-postgres
auto-parses `json`/`jsonb` columns into JS objects — then re-inserts those same values as bind
parameters into the destination without re-serializing them. A plain object as a bind parameter
coerces to its string form (`"[object Object]"`), which Postgres rejects with `invalid input
syntax for type json`. Only triggers for tables with actual non-null json/jsonb data, which is
exactly why a freshly-signed-up tenant with minimal data (only `audit_logs`, in this case) was
the first thing to ever hit it. Now checks each column's `data_type` from `information_schema`
and `JSON.stringify()`s object/array values for `json`/`jsonb` columns before binding.

**8. The provisioned app role couldn't self-heal via the pool's own auto-migration safety net.**
`getDbForOrg` (`server/tenant-db.ts`) runs `applyPendingMigrations` automatically on first pool
creation for an org, specifically so a database restored from a stale backup catches back up
without manual intervention. That failed with `permission denied for schema public` for the
newly-provisioned role — Postgres 15+ revokes `CREATE` on the `public` schema from the `PUBLIC`
pseudo-role by default, so a least-privilege role doesn't get it for free the way it would have
on older Postgres, and `CREATE TABLE IF NOT EXISTS` still requires the `CREATE` privilege check
even when the table already exists. Already gracefully caught and logged ("pool still usable"),
so not fatal — real app usage (SELECT/INSERT/UPDATE/DELETE) worked throughout — but silently
degraded the safety net to a no-op for every dedicated-database tenant. Added
`GRANT USAGE, CREATE ON SCHEMA public TO ${roleName}` to provisioning.

**Verified:** ran the complete, real `commissionDedicatedTenantDatabase` flow against IFALAKHE
FUNERAL SERVICES's real tenant id end-to-end (not a dry run) after each fix, iterating on the
actual error Postgres returned each time rather than guessing ahead — confirmed final state:
`tenant_databases.migrationState = "current"`, `getDbForOrg` routes to the new isolated database,
querying `organizations` through it returns exactly IFALAKHE's own row (no cross-tenant leak),
and the auto-migration safety net now runs cleanly with no permission warning. `npm run check`
and `npm run test` (316/316) both clean.

**Lesson for next time:** a "provision X automatically" code path that has an existing manual
fallback UI (here: the platform dashboard's "Pending domain/database commissioning" queue) can
silently never have been exercised for real, even in a mature codebase — the fallback path
absorbs every failure so smoothly that nobody notices the automation itself is broken. When
asked to "just turn this feature on" for a real case, budget for the possibility that it's never
actually run before, and prefer iterating against the real target system's real errors over
predicting them — every bug in this entry was found by literally running the thing and reading
what Postgres/DigitalOcean actually said, not by reading the code and guessing.

---

## 2026-08-04 — New tenant's subdomain never went live: automated commissioning only told DO App Platform about the domain, never created its DNS record

A new self-signup tenant, IFALAKHE FUNERAL SERVICES, provisioned at 14:12:01 UTC; its subdomain
(`ifalakhe-funeral-services.pol263.com`) never became reachable. Augustus asked why the app
didn't create the DNS record automatically — he'd had to add it by hand.

**Root cause:** `server/tenant-provisioning.ts` fires `commissionTenantDomainOnDO()`
(`server/do-app-domains.ts`) on every new signup, and it worked exactly as designed — confirmed
by `domainCommissioned` flipping `true` 9 seconds after signup and a new deployment landing at
the same timestamp (that's what a successful `PUT /v2/apps/{id}` with the domain added to
`spec.domains` triggers). The bug is in the design itself: that function only ever added the
subdomain to the DigitalOcean App Platform *domain list* — it never called DO's separate DNS
*Records* API. It relied entirely on DO App Platform to auto-create the matching DNS record
once the domain was registered on the app (this normally works when the zone is on DO's own
nameservers, which `pol263.com`'s is), and never verified that this actually happened.
`domainCommissioned = true` therefore only ever meant "we told DO App Platform," not "the
subdomain resolves" — a distinction the code's own comments acknowledged but didn't act on. When
DO's auto-DNS step silently didn't produce a working record here, there was no error, no retry,
and no visibility anywhere — a human had to notice the site wasn't live and intervene manually,
which is exactly where a *second*, independent bug got introduced: the DNS record was created
by hand with the full FQDN as its "name" field instead of the zone-relative label, producing a
nonsense record for `ifalakhe-funeral-services.pol263.com.pol263.com` that never matched real
traffic — DNS for the real hostname fell through to the zone's catch-all wildcard
(`* → pol263.com`) instead, which is why DO's own domain verification stayed stuck on
`DomainCNAMEMismatch`. Diagnosed by cross-referencing the DO Apps API (domain phase +
per-step progress/error reasons), direct DNS/NS lookups, the DO Domain Records API (found the
literal malformed record), and the control-plane `tenants` table (`domain_commissioned_at`
timestamp pinpointing exactly which deployment corresponds to the automated attempt).

**Immediate fix (same day, before this entry):** deleted the malformed DNS record and recreated
it correctly (name `ifalakhe-funeral-services`, not the full FQDN) directly via the DO API. Site
confirmed live (`HTTP 200`, valid certificate) once DO's own domain verification re-ran.

**Root-cause fix (this entry):** `server/do-app-domains.ts` now creates/verifies the DNS CNAME
record itself, directly via DO's Domain Records API, instead of trusting DO App Platform to do
it silently:
- New `relativeRecordName(subdomain, zone)` computes the correct zone-relative label — the one
  place this computation happens in code now, instead of a human re-deriving it by hand in DO's
  dashboard (exactly what went wrong here). Throws rather than silently producing a wrong record
  if the subdomain isn't actually under the zone. Covered by `tests/unit/do-app-domains.test.ts`,
  including the exact real-world hyphenated-subdomain case.
- `ensureDnsRecord()` is idempotent and self-healing: no-ops if a correct record already exists,
  *corrects* it in place if one exists pointing at the wrong target (instead of requiring a human
  to notice and fix it by hand again), and creates it if missing.
- The target hostname (`default_ingress`) is read live from the DO Apps API rather than
  hardcoded, so it self-corrects if the app is ever recreated — same reasoning already used for
  `getDoAppId()`'s domain-match caching.
- **Transactional, per-subdomain semantics** (per Augustus's explicit ask): `commissionTenantDomainOnDO`
  now resolves per-subdomain with `{ ok: boolean; error?: string }`, not a batch-wide boolean. A
  subdomain is only ever reported successful once *both* the DNS record and the DO App Platform
  domain-list entry are confirmed; any failure in either step fails that subdomain completely and
  returns a specific, human-readable reason — never a silent partial state like the one that
  caused this incident.
- That failure reason is now persisted (`tenants.domain_commission_error`, new column —
  `migrations/control-plane/0002_domain_commission_error.sql`) and surfaced on the platform
  dashboard's "Pending domain commissioning" section and the tenant console, instead of a stuck
  tenant sitting with no visible explanation.
- The manual "commission domain" fallback (`POST /api/platform/tenants/:id/commission-domain`)
  used to just flip the `domainCommissioned` flag unconditionally, trusting whoever clicked it had
  already fixed things by hand outside the app — it now actually retries the same DNS-record +
  domain-list logic synchronously and reports the real result, turning it from a "trust me"
  checkbox into a real retry-with-verification action.

**Files:** `server/do-app-domains.ts`, `server/tenant-provisioning.ts`, `server/platform-routes.ts`,
`server/routes.ts`, `shared/control-plane-schema.ts`,
`migrations/control-plane/0002_domain_commission_error.sql`,
`client/src/pages/staff/dashboard.tsx`, `client/src/pages/staff/platform-tenant-console.tsx`,
`tests/unit/do-app-domains.test.ts`.

**Verified:** `npm run check` clean; `npm run test` (316/316, 7 new) passed. The live incident
itself: `ifalakhe-funeral-services.pol263.com` confirmed `HTTP 200` with a valid certificate
after DO's domain verification re-ran post-fix. The rewritten automation itself has **not** been
exercised against a real new signup yet (no tenant has signed up since this deployed) — next
real signup is the first live test of the new path; the manual "retry" button in the platform
console can also be used to test it against any currently-pending tenant.

**Lesson for next time:** "the code successfully told an external platform to do X" is not the
same claim as "X actually happened," especially when X is a second system's own automation you
don't control (here, DO App Platform's auto-DNS for a domain added to an app spec). Don't let a
boolean success flag collapse those two distinct claims into one — if there's a way to verify the
actual outcome directly (here, DO's separate DNS Records API), do that instead of trusting a
downstream system's undocumented internal behavior, and if a failure is possible, persist *why*,
not just *that*, so a stuck resource is diagnosable without re-deriving the whole investigation
from scratch.

---

## 2026-08-04 — Thorough system audit: 5 parallel domain audits, 11 fixes (1 critical PII leak, 1 critical ~12x billing error, 1 high-severity payment race, 6 revenue-durability gaps, 2 injection bugs)

Augustus asked for a thorough audit + edge-case sweep + optimization pass across the whole
system. Followed the established pattern from the 2026-07-28/2026-07-20 audits: parallel
read-only fork agents, each scoped to a non-overlapping domain (security/RBAC/tenant isolation,
financial/ACID integrity, core domain edge cases, newest unaudited features, performance/
scalability), each required to cite file:line and say "not found" rather than guess. Fixed
everything bounded/mechanical same session; flagged the rest.

1. **CRITICAL — `GET /api/clients` leaked every client's password hash, security-answer hash,
   and plaintext portal activation code** to any staff/agent holding basic `read:client`
   permission. `storage.getClientsByOrg`/`getClientsByAgent` do an unrestricted `SELECT *`; the
   sibling `GET /api/clients/:id` route already stripped these fields before responding, the list
   route never did. Fixed by scrubbing the same fields from the list response
   (`server/routes.ts`). Verified the frontend's client list view never reads those fields from
   the list response (they come from separate `:id`/create-response queries that were already
   safe) — no UI regression.
2. **CRITICAL — yearly-billed policies' outstanding/arrears overstated by ~12x.**
   `periodDaysForSchedule()` (`server/route-helpers.ts`) keyed its lookup map on `"annually"`,
   but `"yearly"` is the value actually used everywhere else for `policies.paymentSchedule` —
   every yearly policy silently fell through to the 30.44-day monthly default, inflating
   `computePolicyOutstanding`'s period count (and therefore total arrears) by roughly 12x on the
   policy detail page and the premium-change reconciliation. Added `yearly` to the map (kept
   `annually` too).
3. **HIGH — legacy `PATCH /api/requisitions/:id?action=pay` could double-record a payout.** Read
   `amountPaid` with no row lock before writing a disbursement + status update off that stale
   read; its replacement, `POST /api/requisitions/:id/payments`, already locks the row and
   re-validates under lock. No frontend/app caller used `action: "pay"` (grepped clean) — removed
   the branch (410 response) rather than duplicate the locked logic in two places.
4. **MEDIUM-HIGH — platform-fee crediting wasn't durable outside the direct-PayNow path.** Six
   call sites (`applyGroupPaymentToPolicies` in `server/payment-service.ts`,
   `server/credit-apply.ts`, and four sites in `server/routes.ts` — month-end billing, group
   receipts, approved backdated/premium-override receipts, legacy group receipts) computed the
   platform's fee and wrote `platform_receivables` via a detached, unawaited
   `computePlatformFee(...).then(() => createPlatformReceivable(...))` with only `.catch()`
   logging — a process crash/restart in that window durably loses the fee with no record it was
   ever owed. Split `storage.createPlatformReceivable` into a thin wrapper plus
   `createPlatformReceivableInTx(tx, entry)`; for the 3 sites where the fee amount is known
   before the payment's own transaction opens, moved the receivable write inside that same
   transaction (fully closes the gap — same atomic commit as the payment). For the other 3 (fee
   computed only after their transaction already committed — a loop over multiple already-posted
   receipts, or a raw-SQL insert with no transaction wrapper), properly `await`ed instead of
   detaching, so a failure is at least synchronous and logged before the response returns rather
   than an unwatched dangling promise.
5. **MEDIUM — HTML injection in outbound emails.** `server/notifications.ts` built HTML email
   bodies via `` `<p>${renderedBody...}</p>` ``, where `renderedBody` is plain string
   substitution of client-entered data (name, etc.) with no escaping — a client whose stored
   field contains markup gets it rendered verbatim in every automated email about them. Same bug
   independently in `server/payslip-email.ts`. Added `escapeHtml()` to `server/email-service.ts`
   (shared by both) and applied it at both notification call sites and the payslip email.
6. **MEDIUM — vCard CRLF/field injection.** `buildVCardFile` in
   `client/src/pages/public/agent-vcard.tsx` interpolated agent-editable profile fields
   (`displayName`, phone, website, org name — all settable via `PATCH /api/auth/me`) into `.vcf`
   lines with no escaping; an unescaped CR/LF lets an agent inject extra raw vCard properties into
   every visitor's downloaded contact file. Added RFC 6350 value escaping (backslash/comma/
   semicolon/newline).
7. **MEDIUM — N+1 query in `GET /api/my-vcard/leads`.** Fetched one quote per lead via
   `Promise.all` over `getQuoteByLeadId` (up to 500 leads). Added
   `storage.getQuotesByLeadIds()` (single batched query) and switched the route to it.
8. **MEDIUM — unbounded concurrent fan-out + redundant DB call in payroll "send all payslips."**
   `POST /api/payroll/runs/:id/send-all` fired one `Promise.all` entry per employee, each doing a
   CPU-bound PDF build + outbound SMTP send + a repeated `storage.getOrganization` lookup of the
   same row every time. Chunked to 4 concurrent sends and hoisted the org lookup out to once per
   run (`server/routes.ts`, `server/payslip-email.ts`).
9. **MEDIUM — Executive Report did 14+ sequential DB round-trips per load.** `server/
   executive-report.ts` awaited financials/funerals/quotes/mortuary/fleet/claims queries one at a
   time. Batched into one `Promise.all` (safe here — all reads, no lock contention like the
   write-fan-out bug below).
10. **MEDIUM — cross-instance module-flag cache staleness.** `server/module-gate.ts`'s cache has
    no invalidation broadcast across the app's 2 running instances — a write clears the cache only
    on whichever instance handled it, so the sibling can serve a stale flag for up to the TTL.
    Matters because `mobile_payments` gates real PayNow auto-charging. A full fix needs new
    infrastructure (pub/sub or a shared cache) — out of scope for a bounded fix. Shrunk the TTL
    from 5 minutes to 30 seconds as a stopgap, not a full close.
11. **LOW — no positive-amount validation on settlement creation.** A zero/negative settlement
    passed validation, got approved, and silently no-op'd in the allocation loop (`remaining <= 0`
    short-circuits both branches) with no error anywhere. Added an explicit check in
    `POST /api/settlements`.

**Also found — from the same `batchRecalculatePolicyPremiums` write-fan-out fix earlier today
(see the entry directly below this one): confirmed it was the actual cause of both production
500s pulled from DigitalOcean's runtime logs (`GET /api/policies`, `GET /api/requisitions`,
2026-08-02/03) — cross-referenced here since this audit's financial-integrity fork independently
flagged the same fan-out pattern as a systemic risk, not a one-off.**

**Update, same day, after Augustus's decision:** FLK00526's `premium_override` was in fact
deliberately set (see the 2026-07-29 entry below — the client's real agreed price was $21/mo vs.
the formula's $25), so this wasn't a leftover bug artifact. Asked Augustus explicitly rather than
guess; he chose to clear the override and move the client onto the standard formula price anyway.
Recomputed via the real production `computePolicyPremium` (same methodology as the 2026-08-01
correction of the other 25 policies — a one-off script using the actual `storage`/route-helpers
modules, not a reimplementation) and wrote `premiumAmount: 25.00`, clearing `premiumOverride`/
`premiumOverrideNote`, audit-logged. No retroactive wallet reconciliation for the period this
policy was billed at $21 — same "going-forward only" scope as the other 25, not revisited here.

**Deliberately NOT fixed — reported only, too large to blind-fix:**
1. **`schedulePolicyPremiumBackfill` (`server/routes.ts`) may now be partially redundant** with
   today's batched list-view premium recalc, and adds sustained sequential load against a tenant
   pool already shown to be under pressure. Serves a different purpose though (eventual full-table
   consistency vs. per-page consistency-on-read) — removing or changing it is a product/
   architecture call, not a bug fix.
2. **`server/backup-sync.ts` does `SELECT * FROM "table"` with no LIMIT**, once per table. Fine at
   current row counts (the file's own comment says so) but no ceiling exists as tables like
   `audit_logs`/`payment_transactions` grow over years on a 1GB instance. Not urgent.
3. Security/RBAC fork found no other new issues (core middleware, storage-layer tenant isolation,
   client-portal IDOR surface, SQL injection surface, secret exposure all checked clean) beyond
   the client-list PII leak fixed above. Core-domain fork found sweep locking, claim waiting-period
   boundaries, vehicle-checkout races, and mortuary dispatch upserts all clean beyond the
   `periodDaysForSchedule` fix above and item 1 here.

**Verified:** `npm run check` clean; `npm run test` full suite (309/309) passed after every fix.

**Lesson for next time:** when a fix threads a value (fee amount, computed rate, etc.) that
depends on a *different* database than the one already open in a transaction (control-plane DB
vs. org data DB here), don't assume "compute after commit" is the only option — check whether the
value can be computed *before* the transaction opens instead, so the actual write still lands
inside the same atomic commit. Only fall back to "await it properly afterward" when the
dependency genuinely can't be resolved until after commit (e.g. a loop over rows that were
already written in a prior transaction).

---

## 2026-08-04 — Production 500 investigation: tenant DB pool exhaustion, dead backup connection, silent approval failure, CSRF misclassified as 500

Augustus asked for an investigation into everything throwing an internal server error. Pulled the
last 5 days of runtime logs directly from the DigitalOcean App Platform API (no doctl needed —
`GET /v2/apps/{id}/deployments/{id}/logs?type=RUN` returns a signed URL to the raw log dump) and
traced every `level:"error"` entry and every `statusCode >= 500` access-log line back to its
source. Four distinct issues found; all four fixed.

**1. `GET /api/policies` and `GET /api/requisitions` returned real 500s** (one each, on
2026-08-02 and 2026-08-03) — both `"timeout exceeded when trying to connect"` against the
Falakhe tenant's isolated Postgres pool, capped at 10 connections
(`TENANT_DB_POOL_MAX`/`tenantMax` in `server/tenant-db.ts`). **Root cause:**
`batchRecalculatePolicyPremiums` (`server/routes.ts`, called from `GET /api/policies` on every
load) fired one `UPDATE` per drifted policy inside an **unbounded** `Promise.all` — a page with
dozens of policies drifting at once (e.g. right after a product price change, or last week's mass
premium correction) could spike concurrent connection demand well past the 10-connection cap,
starving every other request against that tenant, including unrelated ones like
`GET /api/requisitions` that happened to need a connection at the same moment. A third request
(`GET /api/clients`, 2026-08-02 11:10:48) hit the same contention as `Connection terminated due to
connection timeout`, and its error handler then crashed with `ERR_HTTP_HEADERS_SENT` trying to
write a response that had already been sent — a race that only manifests under this same
contention. **Fix:** split `batchRecalculatePolicyPremiums` into an unbounded in-memory compute
phase (cheap — `computePolicyPremium` makes no DB calls when given preloaded product/version/add-on
data) and a separate write phase that persists drifted premiums in chunks of 5 concurrent
`UPDATE`s instead of all-at-once. **Files:** `server/routes.ts`.

**2. Off-site backup sync has been 100% broken, every table, every night, since 2026-07-29** —
3,540+ `"Backup schema reconciliation failed for table"` errors, all `connect EHOSTUNREACH
2a05:d014:...`. **Root cause:** `getSupabaseUrl()` (`server/backup-sync.ts`) preferred
`SUPABASE_BACKUP_DIRECT_URL` (`db.<ref>.supabase.co:5432`) since the 2026-07-25 fix below. Confirmed
via direct DNS lookup that this host has **only an IPv6 (AAAA) record — no IPv4 (A) record at
all** — a fixed property of the hostname, not an environment quirk. DigitalOcean App Platform has
no IPv6 egress, so every connection attempt to it is permanently, unconditionally unreachable; the
2026-07-25 fix (preferring direct to route around a pooler TLS issue) traded one 100%-failure mode
for a different, permanent 100%-failure mode. **Fix:** reversed the preference back to
`SUPABASE_BACKUP_URL` (the Supavisor pooler, port 6543, IPv4-reachable). This is a step back toward
the 2026-07-14/2026-07-25 pooler TLS issue (`self-signed certificate in certificate chain`,
reproducible only from DO's network) if it's still present — **not verified against DO's network
from this session** (same limitation the 2026-07-25 entry had); needs confirmation via "Run Backup
Now" or the next scheduled run. If the TLS error reappears, the per-table error handling in
`reconcileSchemaForSource`/`upsertRows` already tolerates and logs individual failures rather than
crashing the whole run, and `script/test-backup-conn.ts` (already in the repo) should be run
directly on the production instance to compare both URLs side by side. **Files:**
`server/backup-sync.ts`.

**3. Approving a `delete_receipt` request could silently fail while reporting success** — hit
once, 2026-08-02, deleting a receipt whose linked `payment_transaction` still had a
`platform_receivables` row pointing at it via `platform_receivables_source_transaction_id_payment_transactions`
(FK, no cascade). The delete's own transaction correctly rolled back, but
`POST /api/approvals/:id/resolve` (`server/routes.ts`) committed the approval's `status: "approved"`
**before** running the side-effect, then swallowed the side-effect error into a log line only —
so the approver got a 200 telling them the receipt was deleted when it silently still existed, with
no way to know it needed retrying. Same swallow-and-report-success pattern applied to every
`approval` request type (`delete_policy`, `delete_quote`, `correct_paid_date`,
`correct_paid_currency`), not just `delete_receipt`. **Fix:** on side-effect failure, revert the
approval back to `status: "pending"` (clearing `approvedBy`/`rejectionReason`) so it isn't lost,
audit-log the reversion as `APPROVAL_SIDE_EFFECT_FAILED`, and return a 500 with a message telling
the caller it did not go through — instead of falling through to the success response. **Files:**
`server/routes.ts`.

**4. CSRF token rejections were misreported as 500 Internal Server Error instead of 403** — 167
occurrences, all vulnerability-scanner bot traffic hitting non-API WordPress paths
(`/xmlrpc.php`, `/wp-json/batch/v1`, `/wp/`) with no session, so not user-impacting, but a real
bug: `csurf` already classifies this as a 403 (`err.status`/`err.code === "EBADCSRFTOKEN"`), but
the global Express error handler mapped every non-`ZodError` to a generic 500, discarding that
classification. Also logged at `"error"` level, adding noise to exactly the log stream this
investigation had to search through. **Fix:** the global error handler now checks for
`err.code === "EBADCSRFTOKEN"` and returns 403, logged at `"warn"`. **Files:** `server/routes.ts`.

**Verified:** `npm run check` clean; `npm run test` full suite passed. Items 1, 3, 4 are pure logic
changes verifiable by type-check/tests; item 2 (backup connectivity) cannot be verified from this
session since the failure and any fix for it only reproduce from DigitalOcean's actual network —
needs a manual "Run Backup Now" check post-deploy.

**Lesson for next time:** DigitalOcean App Platform has no IPv6 egress — never prefer a direct
(non-pooler) Supabase connection string without first checking it actually resolves an A record;
`nslookup`/`dns.resolve4` a candidate host before trusting it as "the fix" for a connectivity
issue, the same way this entry's predecessor (2026-07-25) trusted a local repro that didn't
account for DO's network. Also: production runtime logs are pullable straight from the DO API
with the existing `DIGITALOCEAN_API_TOKEN` in `.env` (`GET /v2/apps` → find app id → `GET
.../deployments` → find the `ACTIVE` one → `GET .../logs?type=RUN` → fetch the returned URL) —
no `doctl` install needed, and this is the fastest way to find out what's *actually* erroring in
prod rather than guessing from a code audit alone.

---

## 2026-07-29 — Premium miscalculation on "Any N Members" products (maxChildren=0): children always charged from the first one

Augustus reported policy FLK00526 (UMTHUNZI, "Any 8 Members" plan, Falakhe tenant) wasn't
computing premiums correctly. Verified by running the real `computePolicyPremium` against the
policy's actual stored household (10 members: 8 adults, 2 children) — it returned exactly $18.00,
matching what was stored. Not a crash or a stale-value bug; the formula was doing precisely what
it was coded to do — the formula itself was wrong for this class of product.

**Root cause:** `computePolicyPremium` (and `quote-engine.ts`'s `surchargedMemberCount`) tracked
adults and children in **completely separate pools that never share capacity** — a deliberate fix
from an earlier audit (see the "no borrowing between pools" comments this replaced) to stop extra
adults silently riding free on unused child slots. That fix assumed every product meaningfully
configures both `maxAdults` and `maxChildren`. Products like UMTHUNZI don't — "Any 8 Members" is
modeled as `maxAdults: 8, maxChildren: 0` (no distinct children tier), which under the separate-
pool logic means **zero children are ever included free, from the very first one**, regardless of
how much of the 8-person allowance is unused. FLK00526's 8 adults exactly filled the 8-adult pool
(free) while both children were charged from a 0-capacity child pool ($3 each) — a household of 10
paying only $6/month more than a single adult, and for the wrong reason (bucket exhaustion, not
actual overflow).

**Fix:** `server/route-helpers.ts` — new `resolveChargeableMembers()` (exported, shared with
`quote-engine.ts`) branches on whether the product actually defines a children allowance:
- `maxChildren > 0` (product explicitly states adult/child counts): unchanged — separate pools, no
  borrowing between them, exactly as before.
- `maxChildren === 0` (no distinct children tier defined): single combined pool sized to
  `maxAdults`, members included free in enrollment order (policyholder first, dependents in the
  order added) regardless of age — only members enrolled beyond that combined count are
  chargeable. Their surcharge amount still varies by age band where the product defines one (a
  chargeable child still costs the child rate, not the adult rate) — only the *inclusion* decision
  stopped splitting by type.

All three pricing branches (age-band, flat per-additional-member, legacy underwriter rate) and
`quote-engine.ts`'s ranking-fit counter now call the same shared function, so recommendation
ranking and actual billing can't drift apart.

**Verified:** ran the real function against FLK00526's exact stored data before and after (was
$18.00, now $25.00 — 8 free slots go to the first 8 enrolled by order, the 2 members who enrolled
9th/10th are chargeable at their own age band: one 66-84 senior at $9 + one 21-65 adult at $4).
Added 2 regression tests in `tests/unit/premium-calculation.test.ts` covering both the
within-allowance case (a child enrolled inside the free count isn't charged) and the FLK00526
reproduction (children enrolled last, after the pool is full, are charged) plus a control case
(an adult enrolled last is charged too — confirms this isn't "children only" logic). 301/301 tests
passing, `npm run check` clean.

**Not yet done — needs Augustus's decision:** 66 active Falakhe policies sit on `maxChildren: 0`
products (UMTHUNZI, YEDWANA); their `policies.premium_amount` was computed and stored under the
old (buggy) formula and won't auto-correct — this fix only changes premiums computed *going
forward* (new policies, and any future recompute triggered by a membership edit). Whether to
retroactively recompute and adjust already-active policies' stored premiums (and notify affected
clients of a rate change) is a business decision, not something to do silently.

**Lesson for next time:** a "no borrowing between pools" fix that's correct for products which
define *both* categories can be silently wrong for products that only define one — check whether
the other side of a two-sided cap is genuinely configured (`> 0`) before assuming a `0` means
"deliberately excluded" rather than "not a category this product uses." Same shape of bug as
underrepresented product configurations elsewhere in this codebase (nullable/additive fields need
every read site to handle "not configured" distinctly from "configured to exclude").

---

## 2026-07-28 — Payment automation due-date trigger + notification digest scheduling: three bugs from self-review

Found during a requested "check for edge cases and bugs" pass immediately after building the
due-date-based payment automation trigger and the client-notification-sweep scheduler (both
same-day work, see the two entries below). None had shipped to a real automated run yet.

1. **`PUT /api/payment-automation-settings` couldn't actually save the new "0 = charge on due
   date" value.** `server/routes.ts`'s save handler had `Math.max(1, Number(body.daysAfterLastPayment
   || 30))` — the `|| 30` silently replaces a genuine `0` with `30` (0 is falsy), and
   `Math.max(1, ...)` then made a `0` floor structurally impossible even without that. So a staff
   member setting the new "0 = on the due date" option in the UI I'd just built would have it
   silently rewritten to 30 on save — a value with the *old* meaning (30 days past due, not past
   last payment), i.e. the opposite of the feature's whole point. **Fix:** `Math.max(0,
   Number(body.daysAfterLastPayment ?? 0))`, plus the matching `GET` fallback default
   (30→0) for consistency. Root cause pattern: I'd fixed the client-side default and the
   automation-logic read site for the 0-is-falsy trap, but not the save route — a reminder that
   every read site of a "0 is now meaningful" field needs auditing, not just the ones touched
   first.
2. **Notification digest had no per-day dedup — the new scheduler made a latent risk real.**
   `server/client-notification-sweep.ts`'s birthday/anniversary/premium-due/pre-lapse logic is
   date-based (matches "today"), not state-based like the policy lapse sweep (which naturally
   stops matching a policy once it's moved to grace/lapsed). Before this session the only way to
   trigger it was a manual admin click, so accidental double-sends were rare. Once I added (a) an
   automatic 05:00 UTC daily run and (b) a prominent "Run notification digest now" button right
   next to it, the realistic case of "staff clicks the button after the scheduled run already
   fired that day" would have double-sent every matching birthday/anniversary/premium-due/pre-lapse
   email — and `notification_logs` doesn't even store an event type, so there was no cheap way to
   detect this after the fact from existing data. **Fix:** added an in-memory
   `Map<orgId, harareDateString>` guard (`lastRunHarareDateByOrg`) — same per-process convention
   as `paymentAutomationTickRunning`/`parkedVehicleTickRunning` in `server/routes.ts` — checked
   before, and only set after, a successful per-org run; a second call same calendar day is a
   no-op that reports `orgsAlreadyRanToday` instead of resending. Resets on restart/deploy
   (acceptable gap — infrequent, and this covers the actual common case).
3. **Same file: raw `new Date()` for "today" instead of Harare-local date, violating the
   pattern `server/date-utils.ts` explicitly warns about.** Pre-existing in the original inline
   route handler this was extracted from, not introduced this session, but surfaced during the
   same review. A plain server-UTC "today" mis-attributes anything in the ~2h window just after
   midnight Harare time (still "yesterday" in UTC) to the wrong calendar day — harmless for the
   scheduled 05:00 UTC (07:00 CAT) run, but wrong for a manual click landing in that window.
   **Fix:** switched to `todayInHarare()` plus string-based month/day and whole-day-difference
   helpers (`isSameMonthDay`, `daysBetween`), matching the exact convention already used in
   `policy-lapse-sweep.ts` and `policy-status-on-payment.ts`.

**Verified:** `npm run check` clean, `npm run test` 298/298 passing after each fix.

**Lesson for next time:** when a field's "empty/zero" value changes from meaningless to
meaningful (here: `daysAfterLastPayment: 0` going from "unset, treat as 30" to "a deliberate,
common setting"), grep every read site for `|| ` fallbacks and every write site for `Math.max(1,
...)`-style floors before considering the change done — the bug is never in the one place you
were already looking at. And: turning a manual-only endpoint into a scheduled one changes its
risk profile even if its own logic didn't change — re-audit idempotency at that moment, don't
assume "it was safe as a manual button" still holds once it also fires unattended and gets an
easy-to-reach "run it again" button next to it.

---

## 2026-07-28 — Birthday/anniversary/pre-lapse email digest was never actually scheduled

**Symptom:** none reported yet — found while auditing every code path that sends email in
production (user asked for a full inventory), not from a user complaint.

**Root cause:** `POST /api/admin/run-notifications` (`server/routes.ts`) computed and sent the
daily digest of birthday, policy-anniversary, premium-due (3-days-out), pre-lapse-warning, and
today's-lapse client emails — but nothing in `server/index.ts` ever called it automatically.
The two sibling sweeps that *do* the equivalent work for policy status
(`server/policy-lapse-sweep.ts`) and tenant billing (`server/tenant-billing-sweep.ts`) both have
a `setTimeout`-based daily scheduler started at boot; this one only had the manual admin route
and was never wired to a scheduler when it was built. So every tenant relying on birthday touches
or pre-lapse nudges got zero of them, silently, with no error anywhere — the code worked
perfectly whenever a human happened to call it.

**Fix:** extracted the handler's inline logic into `server/client-notification-sweep.ts`
following the exact same shape as `policy-lapse-sweep.ts` (advisory-lock-guarded
`runClientNotificationSweep(trigger, orgId?)`, `start/stopClientNotificationSweepScheduler()`),
wired the scheduler into `server/index.ts` at boot/shutdown (daily 05:00 UTC, staggered between
policy lapse's 04:00 and tenant billing's 06:00), and pointed the existing route at it. Also
added the missing "Run now" UI buttons for this and the policy-lapse sweep to
`/staff/notifications`, and one for the tenant billing sweep to `/staff/platform/billing` — none
of the three manual-trigger routes had a frontend button before this.

**Verified:** `npm run check` clean, `npm run test` 298/298 passing. Scheduler correctness
(actually firing at 05:00 UTC in production) not independently verified beyond code review —
worth checking server logs for "Client notification sweep starting" after the next UTC 05:00.

**Lesson for next time:** when a new sweep/digest endpoint is built with only a manual
admin-triggered route and no scheduler, it will silently never run in production — nobody
gets an error, the feature just does nothing. If you build a `run-X-now` admin endpoint whose
job description implies "should happen daily," check `server/index.ts` for a matching
`start...Scheduler()` call before considering it done. This is also a good general signal to
watch for during any "list every place X happens" audit — cross-check every "manual trigger"
endpoint against whether it also has an automatic counterpart, the same way `email_inbound`'s
feature-flag-vs-actual-provisioning gap surfaced in the entry below.

---

## 2026-07-28 — Self-review of the per-tenant email domains + inbound receiving feature

Found by a dedicated bug/edge-case review pass right after building
(`server/email-domain-provisioning.ts`, `server/inbound-email-public-routes.ts`, the new
`POST /api/quotes/:id/email`, and the `email_notifications` module gate on client-auth's
password-reset email) — before any of it had shipped to a real user, so no user-facing
symptom for any of these.

1. **Quote-email endpoint had an ownership-check gap.** `POST /api/quotes/:id/email`
   (`server/routes.ts`) only checked lead ownership when `quote.leadId` was set *and* the
   lead still loaded — a lead-less quote, or one whose lead was later deleted, skipped the
   check entirely, letting an agent-scoped user email any other agent's quote by guessing its
   id. **Fix:** check `quote.agentId` directly (the actual ownership field) instead of
   deriving ownership through the lead.
2. **`hasModule()` isn't defensively wrapped** (unlike the rest of `module-gate.ts`, which
   fails open on every DB error) — a transient control-plane DB hiccup while checking it would
   throw uncaught. In `client-auth.ts`'s password-reset handler, that call sat *after* the
   password had already been successfully changed, so the failure mode was a client seeing
   "Internal server error" for a reset that had actually succeeded. **Fix:** moved the
   module-check + notification email into its own fire-and-forget async block with its own
   catch, so nothing after the real state change (the password update) can affect the
   response.
3. **Inbound webhook's `extractSubdomain` assumed a bare email address.** Real `to` headers
   can be RFC 5322 `"Display Name <addr@domain>"` — unhandled, this would have mis-parsed the
   subdomain and dropped/misrouted the email. **Fix:** strip `<...>` bracket formatting first.
4. **Turning `email_inbound` back off didn't actually stop new inbound mail from being
   stored.** The webhook receiver only checked `tenantEmailDomains.receivingEnabled` (DNS-level
   state) — Resend has no API to un-set receiving once granted, so that flag can't reflect a
   platform owner disabling the module later. **Fix:** webhook now also checks
   `hasModule(tenantId, "email_inbound")` before storing, so the tenantFeatureFlags toggle is
   the actual authority even though DNS-level receiving can't be instantly revoked.
5. **`createInboundEmail`'s return type lied about `onConflictDoNothing` semantics.** On a
   duplicate webhook delivery (Resend retry), `.returning()` yields an empty array —
   `InboundEmail` (non-optional) was the declared return type, `undefined` the actual
   possible runtime value. **Fix:** typed as `InboundEmail | undefined`.
6. **`PATCH /api/inbound-emails/:id` with an empty body** would call `.set()` with every
   field `undefined` — either a no-op update or malformed SQL depending on Drizzle's handling
   of an all-undefined set object, never exercised because nothing enforced at least one field
   being present. **Fix:** 400 if neither `status` nor `linkedNote` is provided.
7. **DNS record creation would drop an MX record with `priority: 0`** —
   `if (rec.type === "MX" && rec.priority)` treats `0` as falsy. Unlikely in practice (Resend's
   priorities are non-zero in what's been observed) but wrong regardless. **Fix:** check
   `rec.priority !== undefined`.

- **Verified:** `npm run check` clean, `npm run test` 298/298 passing after all seven fixes.
- **Files:** `server/routes.ts`, `server/client-auth.ts`, `server/inbound-email-public-routes.ts`,
  `server/storage.ts`, `server/email-domain-provisioning.ts`.
- **Lesson for next time:** when adding a `hasModule()`/`requireModule()` check to an existing
  handler, check what happens *after* the state-changing work if the module check itself
  throws — `hasModule` isn't wrapped defensively, so bolting it onto the tail of an
  already-successful operation (rather than the top, before anything happens) can turn a
  success into a false failure. And for any per-tenant resource resolved by parsing an
  attacker-controlled string (a subdomain out of an email address, here), check ownership on
  the resource's own foreign key, not through a second hop (lead → quote) that can be null or
  deleted.

---

## 2026-07-28 — Notification "Email" and "Push" channels were silently no-ops

- **Symptom:** none reported — found by code review while wiring up SMTP (Resend) for the
  first time and asking "which parts of the app send email." The staff notification-template
  UI (`client/src/pages/staff/notifications.tsx:277`) has always offered "Email" as a channel
  option alongside "In-App," "SMS," and "WhatsApp" for any of the 18 client-lifecycle events
  (policy created/activated, payment received/receipted, premium due, grace/lapse/cancel/
  reinstate, member added/removed, birthday, anniversary, broadcasts, etc.).
- **Root cause:** `dispatchNotification` (`server/notifications.ts`) looped over admin-
  configured templates and, for every one, only ever wrote a `notification_logs` row with
  `channel: tmpl.channel` — it never branched on the channel to actually deliver anything.
  So configuring an "Email" (or "Push") template appeared to save successfully and looked
  identical to "In-App" in the admin UI, but nothing was ever sent beyond the log entry. This
  had been true since the notification-template feature was built; it only became visible
  once real SMTP was available to test against.
- **Fix:** `dispatchNotification`'s template loop now branches on `tmpl.channel`: `"email"`
  resolves the client's email (`storage.getClient`) and sends via the new
  `server/email-service.ts` (`sendEmail`); `"push"` calls the existing `pushToClient`. Two
  new event types (`claim_status_change`, `activation`) were also added and wired in
  (`server/routes.ts` claims-transition handler and both public self-registration paths) —
  since these are brand-new events with no pre-existing per-org template to opt into, their
  no-template fallback path also emails by default when the client has an address, unlike the
  16 older event types where the existing "in-app only until an admin configures a channel"
  behavior was left untouched to avoid an unannounced burst of new email traffic to every
  existing tenant's client base. `payment_receipt` and `policy_activated`/`policy_capture`
  emails now attach the relevant PDF (receipt/policy certificate) via new buffer-returning
  variants of the existing streaming PDF builders (`server/receipt-pdf.ts`,
  `server/policy-document.ts`), reusing the exact same PDFKit drawing code rather than
  duplicating it. Also added: a direct (non-template) security-notice email on client
  password reset (`server/client-auth.ts`), since that flow previously gave the account owner
  no signal at all if someone else reset their password via the security-question flow.
- **Verified:** `npm run check` clean, `npm run test` 298/298 passing. Manual: sent a live
  test email through the Resend SMTP relay (see the sibling entry above) confirming the
  underlying transport works end-to-end.
- **Files:** `server/email-service.ts` (new — extracted shared `getTransporter`/`sendEmail`
  out of `payslip-email.ts` and `tenant-billing-email.ts`, which were duplicating it),
  `server/notifications.ts`, `server/routes.ts`, `server/client-auth.ts`,
  `server/outbox-handlers.ts`, `server/receipt-pdf.ts`, `server/policy-document.ts`.
  Follow-up in the same session: `runPaynowApplyFollowup` (`server/outbox-handlers.ts`) had
  its own separate, hardcoded in-app-only `createNotificationLog` call for payment
  confirmation instead of going through `dispatchNotification` like the cash-payment path did
  — so PayNow-paid clients got no email receipt even after the fix above, while cash-paid
  clients did. Replaced with the same `buildPolicyContext` + `dispatchNotification(...,
  "payment_receipt", ...)` call (passing `receiptId` for the PDF attachment), matching the
  cash path exactly.
- **Lesson for next time:** an admin-facing config option (a dropdown, a toggle) that writes
  to storage successfully is not proof it does anything — check whether the value is ever
  *read* by a real dispatch path, not just persisted. This class of bug (config accepted,
  never consumed) won't show up in tests unless a test asserts on the actual side effect
  (email sent, push delivered), not just on the log row existing.

---

## 2026-07-28 — Full-access Resend API key pasted directly into chat

Not a code bug — an operational credential-handling incident, logged because it set a
convention (scoped keys only, `.env.example` comment now warns future sessions).

- **Symptom:** none — caught by asking "what are the risks of this API" before using the key
  for anything beyond DNS/domain lookups.
- **Root cause:** user pasted a Resend API key directly into the chat to let Claude configure
  SMTP for payslip/billing email (`server/payslip-email.ts`, `server/tenant-billing-email.ts`).
  The key turned out to be **full account access**, not scoped to sending — confirmed by it
  successfully calling account-wide endpoints (`GET /domains`, `POST /domains/:id/verify`).
  The Resend account is shared across multiple unrelated projects (other API keys present:
  dakamela, Peicosy, salesguru intergrations, Onboarding), so a leaked full-access key's blast
  radius extended well beyond POL263 — it could send-as any verified domain on the account,
  create/delete domains, and create/delete/revoke other projects' keys.
- **Fix:** created a new key scoped to `sending_access` restricted to the `pol263.com`
  `domain_id` via `POST /api-keys`, wrote it directly to `.env` (`SMTP_PASS`) without ever
  printing the token value to the transcript, and deleted the scratchpad file holding the raw
  creation response. The original full-access key is being rotated/deleted by the user
  directly in the Resend dashboard — not deleted by Claude, since revoking is easy but a
  wrong deletion (e.g. of another project's key) is not something to risk doing programmatically
  without the user's own hands on it.
- **Verified:** confirmed via `GET /api-keys` that the pasted key had touched account-wide
  endpoints (proof of full-access scope); scoped key created and present in `.env`
  (value not echoed).
- **Files:** `.env` (local, gitignored), `.env.example` (SMTP section now documents the
  scoped-key requirement).
- **Lesson for next time:** when a user pastes a third-party API key inline, don't assume it's
  scoped to the minimum needed for the task — check by testing it against an endpoint outside
  that scope (e.g. an account-management endpoint a sending-only key should 403 on) before
  treating it as safe to use or store. If the provider account is shared with unrelated
  projects (visible via a "list all keys/resources" call), treat any destructive cleanup
  request ("delete every other key") as needing explicit per-item confirmation, not a blanket
  yes — the user may not be tracking what else lives in that account.

---

## 2026-07-28 — Public registration silently dropped every dependent; agent lead-access scoping gap

Found while reviewing the same-session vCard/quote-engine build for bugs before continuing.

### 1. Every dependent submitted through public self-registration was silently discarded
- **Symptom:** none observed yet — found by code review. Would have surfaced as "I added my kids
  as dependents during signup but they're not on the policy," with no error anywhere in the flow.
- **Root cause:** `handlePublicPolicyRegistration` (`server/routes.ts`, shared by
  `/api/public/register-policy` and `/api/public/walkin-register`) required `dGender` and `dDob`
  to be truthy for each submitted dependent, silently `continue`-ing (skipping creation, no error
  returned) otherwise. But `dependents.dateOfBirth`/`dependents.gender` are both nullable columns
  (`shared/schema.ts`), and the actual public registration UI
  (`client/src/pages/join/register.tsx`) never collects a dependent's gender at all — only
  firstName/lastName/relationship/dateOfBirth/nationalId. Every dependent added through this form,
  by every user, always failed the `!dGender` check and was quietly dropped.
- **Fix:** relaxed the skip condition to only require `dFirst`, `dLast`, `dRel` — matching what the
  UI actually collects and what the schema actually requires. DOB/gender now pass through as
  `null` when absent, same as the nullable columns already allow, and `computePolicyPremium`
  already treats a null DOB as an adult (`ageAt(null)`), so this doesn't introduce a new pricing
  gap either.
- **Verified:** `npm run check` clean, `npm run test` 298/298 passing.
- **Files:** `server/routes.ts`.
- **Lesson for next time:** a validation `continue`/skip with no error surfaced to the caller is
  much more dangerous than a hard failure — it looks like success. When a required-field check
  sits between "the UI collects this" and "the schema requires this," verify both, don't add a
  requirement that matches neither.

### 2. Agent-scoped users could view/quote any lead in their org, not just their own
- **Symptom:** none observed yet — found by code review while adding `GET /api/leads/:id` and
  `GET /api/leads/:id/quote` (new routes, same session) and comparing them against the existing
  `PATCH /api/leads/:id`, which has an explicit ownership check the new GET routes lacked.
- **Root cause:** the `agent` role holds `read:lead`/`write:lead` (`server/constants.ts`), and the
  existing `GET /api/leads` list route and `PATCH /api/leads/:id` both explicitly restrict an
  agent-scoped caller to leads where `lead.agentId` matches their own resolved id — but the two new
  routes (and the `leadId` path in `POST /api/quote`) only checked `requirePermission("read:lead")`
  and org membership, not per-agent ownership. Any agent could read, quote, or (via `/api/quote`)
  mutate another agent's lead by ID.
- **Fix:** added the same `isAgentScoped(userRoles) && lead.agentId !== resolveOrSyncTenantUserId(...)`
  → 403 check already used by `PATCH /api/leads/:id`, to `GET /api/leads/:id`,
  `GET /api/leads/:id/quote`, and the `leadId` validation branch in `POST /api/quote`.
- **Verified:** `npm run check` clean, `npm run test` 298/298 passing.
- **Files:** `server/routes.ts`.
- **Lesson for next time:** when adding a new route alongside an existing resource that already has
  an established ownership-scoping convention (list/update routes here), explicitly diff the new
  route's guards against a sibling route's guards — don't assume `requirePermission` alone is
  equivalent to the resource-level scoping a sibling route enforces.

---

## 2026-07-28 — Five bugs found via a 4-way parallel codebase audit (auth/RBAC, payments, core domain, frontend)

Ran a full read-only audit split across auth/RBAC/multi-tenancy, payments/financial, core
policy/claims/product CRUD, and frontend API contracts (fork agents, each required to cite
file:line and say "not found" rather than guess). Five findings were fixed same session;
four more (PII-enumeration risk in a client lookup endpoint, no dedicated lockout on the
security-question reset path, 365-day yearly-cycle leap-year drift, a low-probability
duplicate-product race in legacy import) were reported but deliberately left unfixed —
each needs a product decision or touches a wider blast radius than a mechanical fix covers.

### 1. Underpayment silently granted a full billing cycle of cover (revenue integrity)
- **Symptom:** none observed yet — found by code audit, not a user report.
- **Root cause:** `monthCount` (how many premium cycles a payment buys) was computed as
  `Math.min(12, Math.max(1, Math.round(paidAmt / premiumAmt)))` in three places
  (`server/payment-service.ts`, `server/routes.ts`'s manual-receipt route, and
  `server/storage.ts`'s legacy payment-replay). `Math.max(1, …)` floored the result at 1
  cycle *no matter how small the payment*, and `Math.round` (not `floor`) could also grant an
  extra half-cycle on a moderate overpayment. `advancePolicyCycle` then unconditionally
  extended `currentCycleEnd` by one full cycle length — it has no partial-period concept.
  Nothing upstream tied a payment's amount to the policy's actual premium, so a $1 payment on
  a $30/month policy extended cover by a full 30 days.
- **Fix:** changed all three sites to `Math.min(12, Math.max(0, Math.floor(paidAmt / premiumAmt)))`
  — floor (never round up past what was actually paid), and allow `0` so an underpayment
  advances nothing. The existing excess-payment credit-balance mechanism already banks
  `paidAmt - monthCount * premiumAmt`; with `monthCount` now allowed to be 0, that same code
  path correctly banks the *entire* underpayment as credit instead of silently granting a
  cycle. Also gated the three `applyPolicyStatusForClearedPayment` calls that sit next to
  each of these on `monthCount > 0` — without that guard, a token underpayment would still
  flip a lapsed/inactive policy to "active" while leaving `currentCycleEnd` stale or unset,
  which is worse than the original bug.
- **Verified:** `npm run check` (clean) and `npm run test` (289/289 passing, including
  `payment-service.test.ts`, `policy-billing.test.ts`).
- **Files:** `server/payment-service.ts`, `server/routes.ts`, `server/storage.ts`.
- **Lesson for next time:** any `Math.max(1, …)` floor on a computed count derived from a
  user-controlled amount is worth a second look — it silently converts "less than the
  minimum" into "exactly the minimum" instead of "zero/reject." Grep for `Math.max(1,` near
  payment or billing math specifically.

### 2. Auth rate limiter 429'd every real client-portal session within ~5 minutes
- **Symptom:** none observed yet — found by code audit, not a user report, but would have
  surfaced as clients getting logged out / blocked with "Too many authentication attempts"
  during completely normal use.
- **Root cause:** `server/index.ts` mounted the strict `authLimiter` (20 req/15min in
  production) on the *entire* `/api/client-auth` prefix, not just the login/credential
  routes. That prefix also serves 30+ authenticated data routes (policies, payments,
  receipts, notifications, etc.), and `client-layout.tsx` polls
  `/api/client-auth/notifications/unread-count` every 15 seconds for the whole session —
  which alone exhausts the 20-request budget in 5 minutes.
- **Fix:** scoped `authLimiter` to only the actual credential endpoints
  (`/login`, `/enroll`, `/claim`, `/reset-password`, `/change-password` for client-auth; the
  equivalent narrow set for `/api/auth` and `/api/agent-auth`). Everything else under those
  prefixes now falls under the general `/api` limiter (200/min).
- **Verified:** `npm run check` clean; behavior reasoned through against the actual route
  list (`server/client-auth.ts`) rather than reproduced live.
- **Files:** `server/index.ts`.
- **Lesson for next time:** a rate limiter mounted with `app.use(prefix, limiter)` applies to
  *every* route under that prefix, not just the ones it was designed for — check what else
  shares the prefix before assuming a limiter only affects login attempts.

### 3. `user_permission_overrides` had no organization scope — could leak across tenants
- **Symptom:** none observed yet — found by code audit.
- **Root cause:** `getUserEffectivePermissions` (`server/storage.ts`) correctly scopes
  **roles** to the effective org, but merged in **permission overrides** via
  `getUserPermissionOverrides(userId)` filtered by `userId` alone — the table
  (`shared/schema.ts`) had no `organization_id` column at all. A user whose registry row is
  reassigned between organizations (or reused across tenant DBs) would carry any override
  ever granted at one org into whatever org they're currently scoped to.
- **Fix:** added a nullable `organization_id` column to `user_permission_overrides`
  (migration `migrations/0095_permission_override_tenant_scope.sql`, backfilled from each
  existing row's user's current `organization_id`), and threaded `orgId` through
  `getUserPermissionOverrides`/`setUserPermissionOverride`/`removeUserPermissionOverride` and
  their three route call sites in `server/routes.ts` so every read/write is scoped by
  `(userId, organizationId)` rather than `userId` alone.
- **Verified:** `npm run check` clean; `npm run test` 289/289 passing.
- **Files:** `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`,
  `migrations/0095_permission_override_tenant_scope.sql`.
- **Not yet done:** the migration file is written but has **not been run** — apply it with
  `npm run db:migrate` before this fix takes effect against a real database.
- **Lesson for next time:** when auditing multi-tenant permission logic, check that *every*
  table feeding into the effective-permissions computation carries an org column — it's easy
  to scope roles correctly and miss that overrides (or any other per-user side table) don't.

### 4. Legacy payment-import rollback could delete an unrelated, still-committed batch's audit trail
- **Symptom:** none observed yet — found by code audit; only reachable if a policy has been
  the target of two separate legacy payment-import batches.
- **Root cause:** `rollbackPaymentReplay` (`server/storage.ts`) deleted
  `policy_status_history` rows by matching `reason ILIKE '%(legacy import)%'` — a
  policy-scoped but *not* batch-scoped match, since the table has no batch-id column. Rolling
  back the most recent of two batches on the same policy deleted every `(legacy import)`
  -tagged history row, including ones from an earlier, still-committed batch that was never
  rolled back.
- **Fix:** tagged each replayed status-history row with the specific batch's id
  (`" (legacy import ${batchId})"` instead of a generic `" (legacy import)"`), and changed the
  rollback delete to match that batch-specific tag. Batches committed *before* this fix still
  carry the old generic tag and won't match the new per-batch pattern — rolling one of those
  back will leave its old-format history rows in place rather than deleting them, which is a
  safe fail-static (extra data left over) rather than the previous fail-unsafe (real data
  deleted).
- **Verified:** `npm run check` clean; `npm run test` 289/289 passing.
- **Files:** `server/storage.ts`.
- **Lesson for next time:** a `LIKE`/`ILIKE` match used as a deletion filter needs to be as
  specific as the narrowest thing that could ever share that pattern — "tagged with a feature
  name" is not the same as "tagged with this specific invocation of that feature."

### 5. A real server outage during session-check was indistinguishable from "logged out"
- **Symptom:** none observed yet — found by code audit.
- **Root cause:** `fetchAuthSession` (`client/src/hooks/use-auth.ts`) wrapped its whole body
  in try/catch and returned `null` for *every* failure mode — a genuine 500, a network drop,
  and a real 401 all produced identical output, so `useAuth()`'s `isError` could never
  become `true`. `staff-layout.tsx` already had a branch to redirect with
  `?error=session` when `authError` is set, and `staff/login.tsx` already knew how to render
  that message — the branch was correctly built but permanently unreachable.
- **Fix:** rewrote `fetchAuthSession` to return `null` only for 401/403 (genuinely logged
  out) and `throw` for network failures or any other non-OK status, so `useQuery`'s
  `isError`/`error` now reflect a real outage. No changes needed to `staff-layout.tsx` or
  `staff/login.tsx` — the consuming code was already correct, just never reachable.
- **Verified:** `npm run check` clean.
- **Files:** `client/src/hooks/use-auth.ts`.
- **Lesson for next time:** a blanket `try { … } catch { return null }` around a fetch is a
  common way to accidentally make a "handle the expected failure case" function also swallow
  every *unexpected* failure case identically — check whether downstream code already has a
  branch for the unexpected case before assuming there's nothing to wire up.

---

## 2026-07-27 — Policy cycle dates silently off by a day per cycle on hosts with a positive UTC offset

- **Symptom:** discovered while building/verifying the legacy-import payment-replay feature — a
  policy that had received 3 monthly payments ended up with `currentCycleStart`/`currentCycleEnd`/
  `graceEndDate` 4-5 calendar days earlier than hand-computed expected values, with the drift
  growing by roughly one extra day per payment cycle. Not specific to import: `advancePolicyCycle`
  (`server/policy-status-on-payment.ts`) is the exact function every real PayNow/cash/group payment
  calls, so this is a live bug affecting any real tenant policy with more than one payment cycle —
  wherever the app server's local timezone is ahead of UTC (which includes `Africa/Harare`, this
  app's own tenant timezone, referenced elsewhere in the codebase — `server/date-utils.ts`).
- **Root cause:** `addDays(dateStr, n)` built `new Date(dateStr + "T00:00:00")` (parsed as LOCAL
  midnight per the ECMAScript date-time-string spec) then serialized the result via
  `.toISOString()` (always UTC). On a host with local time ahead of UTC, local midnight is earlier
  in UTC terms than the calendar date suggests, so `.toISOString().split("T")[0]` silently returns
  the **previous** calendar day on every single call. Since each cycle's `periodFrom` is derived
  from the *previous* cycle's `addDays` output (`dueDate = addDays(currentCycleEnd, 1)`), each
  fresh call reintroduces its own fresh −1-day error — the drift compounds by one full day per
  chained call (one call for cycle 1, two for cycle 2, and so on), not a one-off off-by-one.
  `daysBetween` in the same file uses the identical local-midnight construction but is unaffected:
  it only takes the *difference* of two such timestamps, so a constant host-timezone offset cancels
  out of the subtraction exactly. The same buggy `addDays` was independently copy-pasted into
  `server/policy-lapse-sweep.ts` (the scheduled job that ages active policies into grace/lapsed).
- **Fix:** rewrote `addDays` in both files to do the arithmetic entirely in UTC —
  `Date.UTC(y, m-1, d)` + `setUTCDate`/`getUTCDate` — instead of local-time Date construction, so
  the result no longer depends on the host's local timezone setting at all.
- **Verified:** a throwaway script (against the sandbox "TEST TENANT" org, cleaned up after)
  replayed 3 payments (2020-03-01, 2020-03-31, 2020-06-14 — the last ~45 days late) through
  `advancePolicyCycle`/`applyPolicyStatusForClearedPayment` and asserted every resulting date
  field against hand-computed values (`currentCycleStart`, `currentCycleEnd`, `graceUsedDays`
  capped at 30, `graceEndDate`) — all matched exactly after the fix, versus a consistent 4-5 day
  drift before it. Confirmed the host this session runs on has `getTimezoneOffset() === -120`
  (UTC+2), which is exactly the condition that triggers the bug.
- **Files:** `server/policy-status-on-payment.ts`, `server/policy-lapse-sweep.ts`.
- **Lesson for next time:** `new Date(dateOnlyStr + "T00:00:00")` is a landmine — adding an
  explicit time-of-day to a date-only string forces local-timezone parsing, whereas
  `new Date(dateOnlyStr)` alone (no time component) parses as UTC per spec. Grep for
  `T00:00:00.*setDate\|setDate.*T00:00:00` (or just `addDays`/date-math helpers) across the
  codebase before trusting any hand-rolled date-arithmetic helper — `routes.ts`,
  `route-helpers.ts`, and `policy-document.ts` all had similar-looking `setDate`/`getDate` patterns
  checked during this fix, but used the safer date-only (no explicit time) construction and were
  left alone; only the two files above had the dangerous variant. A day-level drift that grows by
  exactly one day per chained call, only reproducing on non-UTC-hosted environments, is the
  signature of this exact bug class — don't assume "it works in prod" rules it out if prod's host
  timezone isn't explicitly pinned to UTC somewhere.

---

## 2026-07-27 — App-wide: default text nearly invisible (light-on-light) anywhere colors weren't hardcoded

- **Symptom:** on the public tenant-signup page (`/signup`), form labels, unselected product
  badges, and select placeholders rendered as barely-visible pale text on white/light card
  backgrounds — only elements with explicit `text-gray-900`-style classes (like the h1) were
  legible.
- **Root cause:** `client/src/index.css` defines five theme palettes, each scoped to
  `[data-theme="..."]`. The "Obsidian Gold" block was written as `:root, [data-theme="obsidian-
  gold"] { ... }` — pairing the dark theme's variables directly to `:root`. `:root` always
  matches `<html>` unconditionally, with the same CSS specificity (0,1,0) as any
  `[data-theme="x"]` attribute selector. Because that block appeared *after* the
  `[data-theme="insurance-teal"]` block in source order, and equal-specificity ties go to the
  later rule, Obsidian Gold's light-cream `--foreground` (43 30% 95%) silently won as the
  effective default for `<html>` **regardless of which `data-theme` attribute was actually set**
  — including the app's real default, `insurance-teal` (set by `ThemeProvider`,
  `client/src/components/theme-provider.tsx:23`). Any element relying on the unstyled default
  (`text-foreground`/`text-muted-foreground` tokens — used by `Label`, outline `Badge`, Select
  placeholders, etc.) got near-white text. This was invisible on most authenticated pages
  because they hardcode Tailwind gray-scale classes instead of the theme tokens, but the public
  signup page leans on the token defaults and sits on explicit light backgrounds, so the bug was
  fully exposed there.
- **Fix:** Moved `:root,` off the Obsidian Gold block and onto the Insurance Teal block instead
  (`client/src/index.css:9-10, 59`), so the CSS default now matches the JS/`ThemeProvider`
  default. Obsidian Gold now only applies when `data-theme="obsidian-gold"` is explicitly set.
- **Verified:** loaded `/signup` in-browser before and after — labels, badges, and placeholders
  went from invisible pale text to fully legible dark text on the white card, with no other
  visual regressions.
- **Files:** `client/src/index.css`.
- **Lesson for next time:** never pair `:root` with a *non-default* themed selector in a
  multi-theme CSS-variable setup — `:root` has the same specificity as any attribute selector
  and always matches, so whichever themed block it's attached to silently becomes the tie-
  breaking default everywhere, independent of which theme is actually active. If a "why is this
  text invisible" bug only shows up on pages that lean on token-based classes (`text-foreground`,
  `text-muted-foreground`) rather than hardcoded Tailwind colors, check `index.css` for stray
  `:root` pairings before assuming it's a per-component issue.

---

## 2026-07-26 — Agents saw Fleet Tracking in the staff nav despite never having a vehicle to check out

- **Symptom:** logging in as an agent (Pesuate Mhlanga) showed a "Fleet Tracking" item in the
  staff sidebar, even though agents have no vehicle checkout/GPS-ping workflow of their own.
- **Root cause:** `use:fleet` (`server/constants.ts:71`, "Check out/return a company vehicle
  and report GPS location while driving it") was included in the `agent` role's
  `ROLE_PERMISSION_MAP` template (`server/constants.ts:121`) — a copy-paste artifact from a
  role list further up, not an intentional grant. The nav item was gated on
  `["use:fleet", "read:fleet"]`, so having either permission was enough to show it.
- **Fix:** Removed `use:fleet` from the `agent` entry in `server/constants.ts` (the seed
  template for newly-provisioned tenants) and added an explicit comment (`server/
  constants.ts:143`) recording that it was never intentional. Also added `agentHidden: true`
  to both Fleet Tracking nav entries in `client/src/components/layout/staff-layout.tsx:325,490`
  as defense in depth — belt-and-braces so an agent never sees the item even if a tenant's
  live `role_permissions` still has a stray grant. Separately, revoked the permission live via
  a direct SQL `DELETE` against `role_permissions` for the 7 already-provisioned orgs that had
  it (template edits only affect newly-provisioned tenants, not existing ones).
- **Verified:** confirmed via a targeted SQL count that all 7 affected orgs' `agent` role had
  the `use:fleet` row deleted (7 → 0), and that the nav item disappears for an agent-role login
  even before that DB fix, thanks to `agentHidden`.
- **Files:** `server/constants.ts`, `client/src/components/layout/staff-layout.tsx`.
- **Lesson for next time:** a permission-template fix (`ROLE_PERMISSION_MAP`) only changes
  what *new* tenants get — it does nothing for tenants already provisioned. Any RBAC template
  correction needs a paired live-data check (`SELECT`/`DELETE` against `role_permissions`)
  across existing orgs, not just a code diff. Also, gating a nav item on `permissions: [...]`
  (any-of) rather than a single specific permission makes a stray grant on an unrelated
  permission in that list enough to leak the whole item — worth a quick grep of
  `staff-layout.tsx` for other multi-permission nav gates when auditing role visibility.

---

## 2026-07-26 — Receipt PDF overstated "months paid for" (2 months shown for a 1-month payment, e.g. FLK00012)

- **Symptom:** a client who paid exactly one month's premium ($10 on a $10/month policy,
  covering 27 Jul–25 Aug) had their receipt read "2 months," overstating what they'd actually
  paid for.
- **Root cause:** `monthsFromPeriod` (previously duplicated locally in `server/receipt-pdf.ts`,
  and separately as `calcMonths` in the "Months Paid For" report in `server/storage.ts`) computed
  months as a calendar-month difference (`periodTo.getMonth() - periodFrom.getMonth() + 1`-style
  arithmetic). But `advancePolicyCycle` (`server/policy-status-on-payment.ts`) anchors pay-cycles
  to a fixed day-length per payment schedule (30/7/14/365 days) — not calendar months. A cycle
  starting late in one calendar month and ending in the next (27 Jul → 25 Aug, 30 days, still one
  cycle) crosses a month boundary, so calendar-month-diff arithmetic counted it as 2 months
  when it was actually 1 full cycle.
- **Fix:** Added a single exported `monthsFromPeriod(periodFrom, periodTo, paymentSchedule)` in
  `server/policy-status-on-payment.ts:41` that instead divides the inclusive day-span by
  `cycleDays(schedule)` (also exported, `:26`) and rounds — matching how `advancePolicyCycle`
  itself defines a "month" for that schedule. `server/receipt-pdf.ts` now imports this shared
  function instead of its own local copy (3 call sites updated to pass
  `policy.paymentSchedule || "monthly"`), and `calcMonths` in the "Months Paid For" report
  (`server/storage.ts`) now delegates to it too, with `paymentSchedule` added to that report's
  underlying `SELECT`.
- **Verified:** checked against real production data (Falakhe policy FLK00012: Jul27→Aug25
  cycle, $10 paid on a $10/month premium) — now correctly computes 1 month. Added a
  `monthsFromPeriod` describe block (4 tests) to `tests/unit/policy-billing.test.ts` covering
  monthly/weekly/biweekly/yearly schedules and a boundary-crossing case.
  All 289 tests pass.
- **Files:** `server/policy-status-on-payment.ts`, `server/receipt-pdf.ts`, `server/storage.ts`,
  `tests/unit/policy-billing.test.ts`.
- **Lesson for next time:** anywhere a payment period gets translated into "how many months"
  for display, the calculation must match the pay-cycle definition already used to *advance*
  that period (`cycleDays()` in `server/policy-status-on-payment.ts`), not generic calendar-month
  subtraction — the two silently disagree whenever a fixed-day cycle straddles a calendar-month
  boundary. Grep for local reimplementations of "months between two dates" before assuming one
  is correct; this bug existed as two separate, subtly different copies before being unified.

---

## 2026-07-26 — "Send payment link" returned Internal Server Error (and 2 related NOT-NULL FK routes)

- **Symptom:** clicking "Send payment link" on a policy threw a 500. The same class of bug was
  also live (not yet reported by a user) on the waiver-request and attendance off-site-dismiss
  routes.
- **Root cause:** all three routes resolved the acting user's id for the tenant's own database
  with `resolveUserIdForOrgDatabase(...) ?? user.id` — but `resolveUserIdForOrgDatabase` can
  return `null` (e.g. the staff member's mirrored row doesn't exist yet in a dedicated-database
  org), and the `?? user.id` fallback then wrote the *raw platform-registry* id into a column
  that is `NOT NULL` and FK'd to that tenant's own `users` table, violating the FK constraint.
  `resolveOrSyncTenantUserId` exists specifically to avoid this — it actively creates/syncs the
  mirrored row and never returns null — but these three call sites predated it and still used
  the older, null-capable helper with an unsafe fallback.
- **Fix:** Replaced `resolveUserIdForOrgDatabase(...) ?? user.id` with
  `resolveOrSyncTenantUserId(user.organizationId, user.id)` at all three sites:
  `POST /api/policies/:id/payment-links` (`server/routes.ts:4460`),
  `POST /api/policies/:id/waiver-request` (`server/routes.ts:3197`), and
  `POST /api/attendance/:id/dismiss-offsite` (`server/routes.ts:9436`). Left explanatory
  comments at each site cross-referencing the others, since this is the same defect pattern
  found and fixed at ~45 other call sites in the 2026-07-14 `resolveOrSyncTenantUserId` sweep
  (see that entry below) — these three had simply been missed.
- **Verified:** root-caused via the FK constraint definition and the helper's actual null-return
  behavior (not a live repro); type-checked clean; consistent with every other already-fixed
  call site of this exact pattern elsewhere in `routes.ts`.
- **Files:** `server/routes.ts`.
- **Lesson for next time:** `resolveUserIdForOrgDatabase(...) ?? user.id` is *always* wrong
  wherever the target column is `NOT NULL`/FK'd to a tenant-local table — the `??` fallback
  defeats the entire purpose of the null check by writing an id that doesn't exist in that
  table. When the 2026-07-14 sweep entry below says a pattern was fixed "across ~45 sites,"
  don't assume that was exhaustive — grep for `resolveUserIdForOrgDatabase(.*) ?? user.id`
  (or `?? user\.id` generally) across the whole file before treating that class of bug as
  closed.

---

## 2026-07-25 — Backup Sync Health showing "Partial", 0 rows/0 tables, 100+ errors every night since 2026-07-14

- **Symptom:** the platform-owner dashboard's Backup Sync Health panel showed every nightly
  run as "Partial" with `totalRows: 0`, `tableCount: 0`, and an error count slowly climbing
  (100 → 113 over 2026-07-19 through 2026-07-25) — i.e. the daily Supabase mirror has been
  completely non-functional, every single run, for at least a week.
- **Root cause:** confirmed by reading the actual stored `errors` array on `backup_sync_runs`
  (not just the dashboard's truncated count) — every single table, across all three source
  databases, fails with the identical `self-signed certificate in certificate chain` on the
  upsert step into the Supabase backup pool. This is the exact same root cause already
  diagnosed and left unresolved in the 2026-07-14 entry below: `getBackupPool()`
  (`server/backup-sync.ts`) only ever read `SUPABASE_BACKUP_URL`, Supabase's Supavisor/pgbouncer
  *pooler* endpoint (port 6543). Reproduced connecting to that same pooler URL, with the exact
  same `ssl: { rejectUnauthorized: false }` config, from this machine (works cleanly) and could
  not reproduce the failure outside DigitalOcean's network — confirming (again) it's a TLS
  chain quirk specific to that pooler endpoint reachable only from DO's egress path, not a
  code defect on its face. The missing piece the 2026-07-14 entry didn't have: `script/
  full-sync-to-supabase.ts` (the manual equivalent of this job) already works around exactly
  this by preferring `SUPABASE_BACKUP_DIRECT_URL` (direct port 5432) over `SUPABASE_BACKUP_URL`
  — that env var was already provisioned for this purpose and sitting unused by the scheduled
  job.
- **Fix:** `getSupabaseUrl()` in `server/backup-sync.ts` now prefers `SUPABASE_BACKUP_DIRECT_URL`
  and falls back to `SUPABASE_BACKUP_URL` only if the direct URL isn't set — bringing the
  scheduled job in line with the manual script's already-working pattern. Also a better fit
  independent of the TLS issue: this job holds a handful of long-lived connections for one run
  a day and issues DDL (`reconcileSchemaForSource`), none of which benefits from a transaction
  pooler designed for high-churn short connections.
- **Verified:** confirmed the direct URL connects cleanly from this machine and that
  `getSupabaseUrl()` now returns it when set; type-checked clean. **Could not verify this
  resolves the actual production failure** — the failure only reproduces from DigitalOcean's
  network, which this session has no access to. Needs confirmation via "Run Backup Now" on the
  dashboard (or waiting for the next scheduled run) after this deploys; if the direct URL hits
  the same TLS error in production, the issue is upstream of both endpoints (DO's egress path
  itself, e.g. an intercepting proxy/firewall) and `script/test-backup-conn.ts` (already
  present, built for exactly this) should be run directly on the production instance to compare
  both URLs side by side.
- **Also confirmed harmless while investigating:** ran the real `runBackupSync()` against
  production databases from this machine to attempt a repro; it was still in flight after 3
  minutes (vs. ~28s in production — network latency from here, not a hang) and was killed. The
  advisory lock (`pg_try_advisory_lock(987654321)`) briefly appeared held afterward in
  `pg_locks`, but re-checking with a single held connection showed it was actually free — a
  stale read caused by DigitalOcean's connection pooler reusing backend PIDs across short-lived
  connections, not a real stuck lock. No cleanup was needed.
- **Files:** `server/backup-sync.ts`.
- **Lesson for next time:** when an env var exists but is only consumed by one of two code
  paths that do the same thing (`script/full-sync-to-supabase.ts` used
  `SUPABASE_BACKUP_DIRECT_URL`, `server/backup-sync.ts` didn't), check whether the *other* path
  already worked around a problem you're diagnosing before assuming it needs a fresh fix —
  grep for the env var across the repo, not just the file you're debugging. Also: when
  investigating a prod-only issue by connecting directly to production databases from a
  local/dev machine, remember the connection pool is shared with production traffic and a
  local script hanging or being killed can look like a stuck lock from the DB side — re-verify
  with a live `pg_try_advisory_lock` probe rather than trusting a single `pg_locks` snapshot,
  since PID reuse by a managed pooler can misattribute a lock to an unrelated, currently-idle
  connection.

---

## 2026-07-22 — `recalculatePolicyPremiumIfNeeded` could silently zero a policy's premium if its product version was orphaned

- **Symptom:** none observed in production (Falakhe has zero policies with an orphaned
  `productVersionId` as of this fix — this was caught by an adversarial recheck of the Phase 4
  batching work, not by a real incident). But the code path was real and live on ~7 call sites.
- **Root cause:** `computePolicyPremium` (`server/route-helpers.ts:127-128`) returns `"0"` when
  the product version it's asked to price against doesn't resolve (deleted/orphaned
  `productVersionId`). `recalculatePolicyPremiumIfNeeded` (`server/routes.ts`, used by the
  ~7 single-policy call sites that touch a policy after this audit's Phase 4 introduced the
  separate batched `batchRecalculatePolicyPremiums` for the Policies list) called it with no
  guard: if the recomputed "0" differed from the policy's real stored premium by ≥ 0.01 (which a
  real premium always would), it flowed straight into `storage.updatePolicy(policy.id, {
  premiumAmount: recomputedPremium }, orgId)` — silently overwriting a real premium with 0 the
  next time any of those 7 routes touched that policy.
- **Fix:** added a guard — fetch the product version first; if it doesn't resolve, return the
  policy untouched instead of proceeding to a zero-premium update. Matches the batch path's
  existing behavior for the same case (`batchRecalculatePolicyPremiums` already skips a policy
  when `productVersionById.get(policy.productVersionId)` misses). Passes the already-fetched
  version through `computePolicyPremium`'s `preloaded` parameter to avoid a redundant second
  lookup.
- **Files:** `server/routes.ts`.
- **Verification:** typecheck clean, full test suite green (209/209). Live-verified against real
  Falakhe data: zero policies currently have an orphaned `productVersionId`, confirming this is a
  safety-net fix for a latent bug, not a fix for an active data-corruption incident.
- **Lesson for next time:** when adding a batched variant of an existing function (Phase 4's
  `batchRecalculatePolicyPremiums` next to the pre-existing `recalculatePolicyPremiumIfNeeded`),
  diff their edge-case handling against each other, not just their happy-path output — an
  adversarial recheck caught this exact divergence after the fact; checking it at the time the
  batch function was written would have caught it for free.

## 2026-07-22 — Resilience & cleanup: unbounded login fan-out, oversized tenant pools, midnight-window date bugs, and currencies silently blended into one number (Phase 6, final phase of the systems audit)

- **1. `/api/agent-auth/login`'s "scan every isolated tenant DB" fallback had no budget of
  its own.** When a login's email isn't found in the registry or the resolved tenant, the
  handler falls back to opening a connection to *every* isolated-DB tenant and querying each
  one — a legitimate need for users migrated before the registry mirror existed, but the
  existing per-email lockout (`agentLockRemaining`) doesn't stop an attacker who sends a
  different bogus email on every request; the existing IP-based `authLimiter` only bounds
  requests per IP, not per email, and the tenant-scan fallback runs on *every* email-not-found
  request regardless of which email was tried. Added a shared, email/IP-independent budget
  (`TENANT_SCAN_FALLBACK_LIMIT_PER_MINUTE = 10`, `server/auth.ts`) so the DB connection
  fan-out this path causes can't be forced unboundedly just by varying the login email.
- **2. Every isolated tenant pool reused the shared registry pool's `max` (25 connections)**,
  so `MAX_TENANT_POOLS` (50) × 25 could in theory open up to 1,250 connections against tenant
  DBs that are typically much smaller managed-Postgres plans than the registry DB — this is
  the same class of problem behind the "remaining connection slots reserved for SUPERUSER"
  errors hit against Falakhe's DB during migrations earlier in this audit (see the Phase 1 and
  Phase 4 entries below). Gave tenant pools their own, separate, much smaller default
  (`TENANT_DB_POOL_MAX`, default 10) instead of sharing `DB_POOL_MAX` with the registry pool
  (`server/tenant-db.ts`).
- **3. Six more raw-UTC "what day is it" computations**, on top of the ones already using
  `todayInHarare()` elsewhere: two independent "month-to-date default range" helpers
  (`defaultExecutiveSummaryRange` in `server/financial-statements.ts`, `defaultStatementRange`
  in `server/routes.ts`) computed "today" and "1st of this month" from the server's raw UTC
  clock; the auto-payment-automation idempotency key bucketed by raw-UTC date instead of
  Harare date (`server/routes.ts`); the Daily Schedule PDF's "tomorrow" default did the same.
  All of these mis-attribute the last ~2 hours of each Harare day (22:00–24:00 CAT, which is
  already the next calendar day in Harare but not yet in UTC) to the wrong day — a
  month-to-date report run in that window would silently exclude the day's own income; an
  auto-payment attempt near midnight could double up or skip a day. Also swept five smaller
  files (`credit-apply.ts`, `payment-service.ts`, `policy-document.ts`, `hr-fleet-document.ts`,
  `ai-context.ts`, `storage.ts`) that had the same literal `new Date().toISOString().split("T")[0]`
  pattern but weren't caught by earlier phases because those only touched files already
  importing `todayInHarare` from prior fixes.
- **4. Three currency-blind summation spots** — the exact bug class the "Unbanked cash (USD)"
  dashboard tile's mislabeling pointed at: `buildExecutiveSummary`'s admin cash-position
  totals (`server/financial-statements.ts`) summed every admin's on-hand/deposited cash across
  *all* currencies into one raw number, mislabeled "(USD)" on the dashboard regardless of what
  was actually in it — live-verified against real Falakhe data, which genuinely holds both USD
  and ZAR cash positions, confirming this wasn't a hypothetical. The branch-report CSV export
  did the same for per-branch premium totals, and the Sales/Claims department PDF did the same
  for total monthly premium and total cash-in-lieu. Fixed all three by grouping sums per
  currency (never adding a USD figure to a ZAR figure) and rendering each currency separately
  — the dashboard tile via the existing `fmtCur` per-currency formatter (already used
  elsewhere on the same page and never blends), the CSV via the same
  `currencyHeaders`/`currencyTotals` per-currency-column convention every other report type in
  that export function already follows, and the PDF via one `kv()` line per currency instead
  of cramming a multi-currency string into a fixed-height stat tile.
- **5. Two unauthenticated-endpoint classes had no dedicated rate limit** — `/api/public/quote`,
  `/agent-card`, `/verify`, `/tenant-context` (open to anyone, no session) were only covered by
  the blanket 200/min `/api` limiter, generous enough for enumeration/scraping; the
  cross-tenant `/api/platform/dashboard` and `/api/platform/tenant-health` endpoints (which
  fan out to every active tenant's DB per request) had no limit tighter than ordinary
  authenticated traffic. Added a 30/min public-endpoint limiter and a 20/5min platform-dashboard
  limiter (`server/index.ts`).
- **6. 122 dialog form-field grids used a bare `grid-cols-2/3/4`** with no responsive
  breakpoint, so multi-column field layouts stayed multi-column even in a narrow dialog on a
  phone screen — cramped, sometimes-unusable fields. Fixed by adding `grid-cols-1` (or
  `grid-cols-2` for 4-column grids) as the mobile default with the existing column count moved
  behind `sm:`, matching the responsive convention the dashboard KPI row already used
  elsewhere in the app (`grid-cols-2 sm:grid-cols-4`) — purely additive (desktop rendering is
  unchanged; only sub-640px viewports are affected), applied via a scoped script that only
  touched `className="grid grid-cols-N ..."` literals inside `<DialogContent>` blocks across
  17 files.
- **7. Outbox failures were invisible.** `outbox.ts` already marks a message `status: "failed"`
  with `lastError` after `MAX_ATTEMPTS` (8), but nothing surfaced that anywhere — the only
  trace was a `structuredLog("error", ...)` line in stdout. Added `GET
  /api/diagnostics/outbox-failures` (tenant-DB-aware, unlike the sibling
  `notification-failures`/`recent-errors` routes which only ever query the shared registry
  pool — noted but not touched, since fixing that is a separate, pre-existing bug outside this
  phase's scope) and a matching "Outbox" tab on the existing `/staff/diagnostics` page,
  following the exact same table/KPI pattern already used for notification failures on the
  same page.
- **Files:** `server/auth.ts`, `server/tenant-db.ts`, `server/financial-statements.ts`,
  `server/routes.ts`, `server/credit-apply.ts`, `server/payment-service.ts`,
  `server/policy-document.ts`, `server/hr-fleet-document.ts`, `server/ai-context.ts`,
  `server/storage.ts`, `server/department-report-pdf.ts`, `server/index.ts`, `.env.example`,
  `client/src/pages/staff/dashboard.tsx`, `client/src/pages/staff/diagnostics.tsx`, and 17
  files touched only by the dialog-grid responsive sweep.
- **Verification:** typecheck clean, full test suite green (209/209, unchanged — these are
  resilience/formatting changes with no behavior change in the currency-correct path). Live-
  verified against real Falakhe data: the new outbox-failures query ran cleanly against the
  isolated tenant DB (0 failures currently, as expected); the currency-grouped cash-position
  fix was cross-checked against a from-scratch recomputation off the raw per-admin positions —
  0 mismatches, and confirmed Falakhe genuinely holds both USD and ZAR cash, which the old
  blind-sum code would have silently combined into one meaningless number today.
- **Lesson for next time:** the `todayInHarare()` sweep in Phase 4 (see below) only caught the
  literal `new Date().toISOString().split("T")[0]` pattern — it missed every case where `new
  Date()` was first assigned to a variable (`const to = new Date()`) before being formatted,
  because the call site doesn't textually match. When sweeping a "wrong pattern" bug class,
  grep for the *effect* (`.toISOString().split("T")[0]` / `.slice(0, 10)` on any date, not just
  a literal `new Date()`) and then manually separate "this is computing 'today'" from "this is
  formatting an already-known historical date" — the former needs `todayInHarare()`, the
  latter doesn't and fixing it wouldn't do anything. Also: this phase closes the 6-phase audit
  from the earlier architecture review — see the Phase 1–5 entries below for the full arc from
  critical money-duplication bugs through UX polish.

## 2026-07-21 — UX/accessibility gaps: a real $0-submittable payment, unlabeled icon buttons, an orphaned nav path, and a keyboard-inaccessible search field (Phase 5 of the systems audit)

- **Context:** Phase 5 of the audit — UX/accessibility findings. Two items in the original
  roadmap (an app-wide `Label`/`htmlFor` sweep, and full consolidation of four
  domain-different "Record Payment" dialogs into one shared component) were assessed and
  deliberately **not** attempted in this pass: both have very large blast radius (700+ label
  instances across 161 files; five payment dialogs spanning policies/finance/groups/mortuary/
  funerals with genuinely different fields and flows) and no way to visually verify the result
  without a browser. Rather than risk a mechanical edit at that scale, this phase fixed the
  concrete, verifiable defects instead — including the specific bug the consolidation item was
  named after.
- **1. The funeral cash-service "Record Payment" dialog's submit button was only guarded by
  `!paymentForm.amount`** — a non-empty string check, so typing `"0"` left the button enabled;
  the request would round-trip to the server and get rejected (the server already validated
  `amount > 0`), a confusing dead-end for the person at the till rather than a same-screen
  explanation. Fixed the client-side guard to `!paymentForm.amount || parseFloat(paymentForm.amount) <= 0`
  (`client/src/pages/staff/funerals.tsx`) — audited every other "Record Payment"/pay dialog in
  the app for the same pattern; all others already guarded correctly.
- **2. Seven icon-only buttons in `funerals.tsx`** (edit/delete on partner parlours,
  personnel, transport rates, cemeteries, equipment, and service charges) had no accessible
  name — a screen reader announced them only as "button." Added `aria-label` to each, using the
  row's own name/label so the announcement is specific (e.g. "Edit St. Mary's Parlour", not
  just "Edit").
- **3. The new job-based nav IA (`newNavSections`, behind the `newNav` flag) was missing 10
  routes** that the legacy nav still exposed — Society/Tombstone Transactions, Tombstones
  Admin, Client Feedback, Dynamic Reports (Generic), Statistics, Statistical Graphs, Reminders,
  Help Centre, and Fax. The comment directly above `newNavSections`
  (`client/src/components/layout/staff-layout.tsx`) states the new IA is meant to "preserve
  every route/permission; reorganize access paths only" — these 10 pages still exist and still
  work if you type the URL directly, but a tenant on the new-nav flag had no menu path to
  reach them at all. Added each to its closest semantic bucket (Clients, Finance, Reports, or
  Setup) and verified programmatically that both nav trees now expose the identical 73-route
  set.
- **4. The global policy search box (`PolicySearchInput`) was a hand-rolled dropdown with zero
  ARIA semantics or keyboard support** — no `role="combobox"`/`listbox`/`option`, no arrow-key
  navigation, no `aria-activedescendant`; a keyboard-only or screen-reader user could type a
  query but had no way to select a result without a mouse. Rather than swap to the existing
  `SearchableSelect`/cmdk component (built for a pre-loaded option list, not this component's
  server-side type-ahead search — and its popover-oriented styling would have visually diverged
  from the plain bordered input used everywhere else, a regression this session had no browser
  to catch), added real combobox semantics and arrow/Enter/Escape keyboard handling directly
  onto the existing markup, leaving the visual layout and all four call sites' props unchanged.
- **5. Applied the policy-wizard's "live missing-fields hint" pattern** (an inline
  `To continue, provide: X, Y.` message next to a disabled submit button, instead of a
  silently-disabled button with no explanation) to the three payment-confirmation dialogs
  touched by fix #1: the funeral cash-service payment dialog, the funeral service-charge
  payment-confirmation dialog, and the mortuary storage-fee payment dialog
  (`client/src/pages/staff/funerals.tsx`, `client/src/pages/staff/mortuary.tsx`).
- **Files:** `client/src/pages/staff/funerals.tsx`, `client/src/pages/staff/mortuary.tsx`,
  `client/src/components/layout/staff-layout.tsx`, `client/src/components/policy-search-input.tsx`.
- **Verification:** typecheck clean, full test suite green (209/209, unchanged — these are
  frontend UI/accessibility changes with no unit-test surface). Verified nav-tree parity
  programmatically (a script diffing every `href:` between the legacy and new-IA nav
  definitions — 73/73 routes now match both ways, zero orphans either direction). Could not
  visually exercise the browser in this session — flagged explicitly per the "for UI changes,
  verify in a browser" rule, rather than claiming a look-and-feel guarantee this pass can't back
  up. The two deferred items (app-wide label association, full payment-dialog consolidation)
  remain open and are better suited to a dedicated pass with browser-based visual QA.
- **Lesson for next time:** when an audit item says "app-wide" or "consolidate N things," check
  the actual blast radius before starting (a five-minute grep) — some of these turn out to be a
  handful of files (the nav-tree fix, the search-box fix) and some turn out to be hundreds of
  call sites with no mechanical way to verify correctness (labels, dialog consolidation). Fixing
  the former well and explicitly deferring the latter with reasoning beats a rushed, unverifiable
  attempt at all of it. Also: "two systems marked as duplicates of each other" (old nav vs new
  nav here) is worth diffing programmatically rather than eyeballing — a script found all 10 gaps
  in seconds; the comment stating the new IA's intent ("preserve every route") had clearly
  drifted from what the code actually did, the same class of drift already seen twice this
  session (Phase 3's dead settings field, Phase 2's near-no-op waiting-period check).

## 2026-07-21 — N+1 query storms on the Policies list, reports, and finance pages (Phase 4 of the systems audit)

- **Context:** Phase 4 of the audit — performance findings, not correctness bugs. Several
  list/report endpoints issued one (or several) extra DB round-trips *per row* instead of
  batching, so cost scaled with result-set size rather than staying constant.
- **1. `GET /api/policies` recomputed every policy's premium serially, one full internal
  fetch-chain per row** (`recalculatePolicyPremiumIfNeeded` calling `computePolicyPremium`,
  which itself did 2-3 more internal lookups) — up to ~3,000 queries for a full page load.
  Fixed by adding a `batchRecalculatePolicyPremiums` path (`server/routes.ts`) that
  pre-fetches all products, product versions, add-ons, policy members, and dependents for the
  whole page in ~6 batched queries, then passes them into a new optional `preloaded` parameter
  on `computePolicyPremium` (`server/route-helpers.ts`) so the pricing math itself didn't need
  duplicating — call sites that still need single-policy recalculation (~7 of them) are
  untouched.
- **2. Three missing indexes** meant `claims` lookups by client, the finance pending-approvals
  queue, and the funeral-case date-sorted list all fell back to sequential/partial-index scans
  as those tables grew: `claims_client_idx`, `pr_org_pending_idx` (partial, `WHERE
  approval_status = 'pending'`), `fc_org_created_idx` (composite, matching the existing
  `policies_org_status_created_idx` pattern). Added in `shared/schema.ts` and
  `migrations/0080_performance_indexes.sql`.
- **3. Four more per-row N+1 loops**, same shape as #1 — a query inside `.map()`/`Promise.all`
  instead of one batched query up front:
  - `/api/reports/policy-details` (both the live JSON route and the duplicate CSV-export code
    path) fetched a client's dependents one client at a time — up to 15,000 queries at the
    report's row cap. Replaced both with the already-built `storage.getDependentsByClientsBatch`
    (added in Phase 4's first fix, for `batchRecalculatePolicyPremiums`, and previously unused
    elsewhere — same helper now serves three call sites).
  - `GET /api/payment-disbursements` looked up `paidByUserId`/`receivedByUserId` per
    disbursement; also had no `.limit()` at all (`server/storage.ts`, `getPaymentDisbursements`)
    despite every real caller filtering to a single requisition/expenditure — added a `.limit(1000)`
    safety cap regardless, since the route itself has no filter requirement.
  - `GET /api/payment-receipts/pending-approvals` looked up the policy and client per receipt.
    Added a `getClientsByIds` batch method (`server/storage.ts`, mirroring the existing
    `getPoliciesByIds`) and switched both lookups to one batched query each before the map.
- **Files:** `server/routes.ts`, `server/storage.ts`, `server/route-helpers.ts`,
  `shared/schema.ts`, `migrations/0080_performance_indexes.sql`.
- **Verification:** typecheck clean, full test suite green (209/209, unchanged — these are
  performance-only changes with no behavior difference, so no new tests were needed). Live-
  verified against real Falakhe data: for 200 real policy-report rows, the batched dependents
  lookup returned byte-for-byte the same dependent ID sets as the old per-client loop (0
  mismatches); for 50 real policies/clients, `getPoliciesByIds`/`getClientsByIds` matched the
  single-row `getPolicy`/`getClient` lookups exactly (0 mismatches); applied both migrations to
  main, Falakhe (isolated tenant DB), and the Supabase backup, confirmed all three indexes exist
  via `pg_indexes`.
- **Lesson for next time:** batch storage helpers pay for themselves fast — the same
  `getDependentsByClientsBatch` built for one call site (the Policies list premium recalc) ended
  up replacing three separate N+1 loops elsewhere in the same phase once it existed. When adding
  a batch method, grep for the singular version's call sites (`getDependentsByClient(` etc.)
  before considering the task done — the other N+1 loops calling it are usually sitting right
  there, not hidden.

## 2026-07-21 — Premium calculation correctness: age-band pooling, negative discounts, silent under-charging, and a dead reinstatement setting (Phase 3 of the systems audit)

- **1. Age-band pricing let extra adults "borrow" unused child slots.** The flat-rate pricing
  branch in `computePolicyPremium` (`server/route-helpers.ts`) already caps adults and children
  against their own limits *separately*, with a comment explicitly warning why pooling them would
  undercharge (a product with maxAdults=2/maxChildren=4 would let a 3rd adult ride free by
  borrowing an unused child slot). The newer, more precise age-band branch pooled them anyway:
  `totalIncluded = includedAdults + includedChildren + includedExtended`. A real scenario —
  policy holder + 5 adult dependents (6 adults, 0 children) against a 2-adult/4-child product —
  computed `6 - 6 = 0` chargeable extras instead of the correct 4. Fixed by building separate
  ordered adult/child member lists, capping each against its own limit, and treating
  `maxExtendedMembers` as what it's actually meant to be — a genuinely shared bonus pool applied
  *after* the two caps (freeing whichever otherwise-chargeable member joined earliest), not pooled
  into the caps themselves.
- **2. A misconfigured negative add-on price could zero out the entire premium**, not just the
  add-on. `total = base + addOnTotal + dependantSurcharge`, floored at 0 as one combined sum — a
  large negative `addOnTotal` (intended as a discount) could wipe out a legitimate dependent
  surcharge along with the base premium it was actually attached to. Fixed by clamping only the
  add-on component (`Math.max(addOnTotal, -base)` — a discount can zero the base premium, never
  push the total negative or erase an unrelated surcharge).
- **3. An age-band rate left unconfigured for one currency silently priced every extra member at
  $0** for policies in that currency — no error, no warning, just an unexplained revenue gap that
  only shows up as a shortfall report weeks later. Fixed by logging a warning identifying the
  exact product version and missing field whenever this happens, so it's visible in ops instead of
  silent. Deliberately did NOT fall back to the other currency's raw number — USD and ZAR rates
  aren't 1:1 interchangeable and no FX conversion happens in this function, so guessing a
  substitute would trade an obviously-wrong $0 for a plausible-but-still-wrong charge, which is
  *harder* to notice, not easier.
- **4. "Restart waiting period on reinstatement" was a fully-built, admin-configurable setting
  (two product admin forms) that zero server code ever read.** A lapsed policy that got
  reinstated always kept its original, already-expired waiting period regardless of the toggle —
  a real anti-selection control that silently did nothing. Root cause of the whole class: the
  actual, enforceable waiting-period end date is NOT stored on `policies.waitingPeriodEndDate` at
  issuance — that column stays NULL for almost every real policy and is only ever explicitly
  written by waiver approval or a manual staff override. Everywhere else that needs this value
  (the single-policy GET route, the policy-members route) derives it on the fly from
  `inceptionDate + productVersion.waitingPeriodDays` instead. Extracted that derivation into a
  shared `resolvePolicyWaitingPeriodEndDate` (`server/route-helpers.ts`) and used it in two places:
  wired the reinstatement setting into `applyPolicyStatusForClearedPayment`'s lapsed→active branch
  (`server/policy-status-on-payment.ts`) — a fresh waiting period anchored to the reinstatement
  date, stored as an explicit override, when the setting is on (default) — and **corrected the
  Phase 2 claim waiting-period check to use the same shared resolver**, since it was built reading
  the raw (usually-empty) column directly and would have been a near-total no-op in production
  despite passing its own tests, which only exercised the explicit-override path.
- **Files:** `server/route-helpers.ts`, `server/policy-status-on-payment.ts`, `server/routes.ts`,
  `tests/unit/premium-calculation.test.ts` (7 new tests — age-band separate-capping, the extended-
  members bonus pool, currency-fallback safety, and negative add-on clamping; none of this had
  test coverage before).
- **Verification:** typecheck clean, full test suite green (209/209, up from 202 — added real
  coverage for a pricing branch that had none). Live-verified against real Falakhe data: recomputed
  a live policy's premium and it matched the stored value exactly; confirmed
  `resolvePolicyWaitingPeriodEndDate` correctly returns null for legacy-waived and not-yet-active
  policies and correctly derives a real date for ordinary active ones, all against real rows.
- **Lesson for next time:** a settings column with a full admin UI and zero server-side readers is
  not a rare occurrence in this codebase — this is the second one found this session
  (`reinstatementNewWaitingPeriod` here, `fraudFlags` reused for the waiting-period flag in Phase
  2). When investigating "is X actually enforced," grep for the field name across `server/` before
  trusting that a UI control does anything. And when fixing a bug found by an audit, re-verify
  fixes from an *earlier* phase of the same audit if they touch overlapping data — Phase 2's
  waiting-period check and this phase's reinstatement fix both needed the same underlying value,
  and Phase 2 had gotten how to derive it wrong in a way its own scenario-based reasoning didn't
  surface until this phase's research went one level deeper into how the column is actually
  populated.

## 2026-07-21 — Policies could sit "active" forever past due, and claims had zero waiting-period enforcement (Phase 2 of the systems audit)

- **Context:** Phase 2 of the audit from the previous entry — the two "systemic absence" findings,
  where the gap wasn't a bug in existing logic but logic that never existed at all.
- **1. Nothing ever moved a policy from active → grace → lapsed on its own.** Every place that
  changes policy status is reactive — a payment clears and `applyPolicyStatusForClearedPayment`
  moves the policy forward. Nothing moved it the other way: a policy that simply stopped being
  paid stayed `"active"` indefinitely, with an expired grace period and mounting arrears, until a
  staff member happened to notice and manually transition it. Every downstream process that
  filters on status — commission clawback triggers, lapse-rate dashboards, portfolio health —
  never saw it. Added `server/policy-lapse-sweep.ts`, a daily sweep (04:00 UTC, staggered from
  the existing tenant-billing sweep at 06:00 and backup at 22:00) that finds active policies past
  their due date and moves them to `grace` (computing a fresh `graceEndDate` from the product
  version's grace period, same formula `advancePolicyCycle` already uses), and grace policies
  past their `graceEndDate` and moves them to `lapsed` (recording clawback and notifying the
  client, same side effects the manual transition route already produces). A severely-neglected
  policy that's already past both due date and grace deadline moves through both states in one
  pass, since `active → lapsed` isn't a valid direct transition — it always goes through `grace`
  first, immediately. Same self-rescheduling/advisory-lock shape as `tenant-billing-sweep.ts`, plus
  a per-org manual-trigger route (`POST /api/admin/run-policy-lapse-sweep`) for ops testing.
- **2. Claim submission and approval never checked the policy's waiting period at all** —
  `waitingPeriodEndDate` and the legacy-waiver flag were only ever displayed on screen, never read
  by any route. A claim submitted and approved before the waiting period ended was fully payable,
  with no system backstop — a direct anti-selection/fraud exposure. Fixed in two layers: claim
  *submission* now computes the violation and stamps it (non-blocking) onto the claim's existing,
  previously-unused `fraudFlags` column, so it's visible to whoever reviews it — every claim
  already requires manager approval, so this doesn't need to block creation. The *approval*
  transition (`POST /api/claims/:id/transition`, `toStatus === "approved"`) is where the hard stop
  lives, since that's the moment the payout actually gets committed: it now requires an explicit
  `waitingPeriodOverrideReason` to proceed if the claim's date of death is before the policy's
  waiting period ends and the policy isn't legacy-waived — same "let it through with a logged note,
  never silently" pattern already used for premium overrides in `POST /api/payments`. The override
  reason gets recorded on both `fraudFlags` and the claim's status-history reason, so it's visible
  through the app's existing history view with no new UI needed beyond the override input itself
  (added to the transition dialog in `claims.tsx`, shown only when transitioning to "approved").
- **Files:** `server/policy-lapse-sweep.ts` (new), `server/routes.ts`, `server/index.ts`,
  `client/src/pages/staff/claims.tsx`.
- **Verification:** typecheck clean, full test suite green (202/202). Live-verified against real
  Falakhe data: a read-only dry run confirmed zero policies currently match the overdue criteria
  across all 7 orgs (so activating this sweep causes no surprise mass-reclassification on first
  run), then the actual sweep function was run for real against Falakhe (safe no-op, confirmed —
  `{ orgsScanned: 1, movedToGrace: 0, movedToLapsed: 0, errors: [] }`), and real policy rows
  confirmed both the `isLegacy` short-circuit and null-`waitingPeriodEndDate` handling in the new
  waiting-period check behave correctly.
- **Lesson for next time:** when a report says "X is never enforced," check whether the underlying
  data the check would need (`fraudFlags`, `waitingPeriodEndDate`, `isLegacy`) already exists on
  the schema and is just unused — it usually is, which turns "design a new mechanism" into "wire
  up what's already there." And before activating any automated status-changing sweep for the
  first time, always run a read-only dry count against real production data first — a systemic gap
  that's been open a while can mean a large one-time batch of changes on first activation, and
  that's worth knowing about before it happens, not after.

## 2026-07-21 — Six critical money-duplication races closed (Phase 1 of a full systems audit)

- **Context:** a senior-architect-style audit (data integrity, N+1/performance, DoS resilience,
  core business-logic edge cases, UX) found 7 critical, 11 high, and 17 medium findings. This
  entry covers the 7 critical ones — all money-duplication or lost-update races with no database
  backstop, and one missing constraint. None required new architecture: every fix mirrors a
  pattern already proven correct elsewhere in the codebase.
- **1. Receipt approval could be double-applied.** `POST /api/payment-receipts/:id/approve`
  checked `approvalStatus === "pending"` before the transaction, but never re-checked it *inside*
  the transaction under a lock — two concurrent "Approve" clicks both passed the check and both
  posted a full payment transaction, double-advancing the policy's cover cycle. Fixed by locking
  and re-reading the receipt row (`SELECT ... FOR UPDATE`) as the first thing inside the
  transaction, throwing a `RECEIPT_ALREADY_RESOLVED` error mapped to a clean 409 if it lost the
  race, plus a deterministic `idempotencyKey` (`approve-receipt-${receiptId}`) on the transaction
  insert as a second line of defense. The sibling `/reject` route had the same gap in the other
  direction — a reject landing after a concurrent approve already posted money would silently
  flip the receipt's status back to "rejected" with no error to either caller. Fixed by making
  the reject `UPDATE` conditional on `approvalStatus = 'pending'` and checking the returned row.
- **2/3. The two main staff receipting routes, `POST /api/payments` and `POST /api/group-receipt`,
  never checked an idempotency key at all** — the unique DB column existed and `POST /api/payments`
  even had 23505-to-409 error mapping already written, but no frontend caller ever sent a key, so
  none of it ever engaged. A double-click, a retried request after a stalled network call, or two
  staff members receipting the same policy at once posted duplicate money. Fixed by generating a
  stable per-attempt key client-side (a `crypto.randomUUID()` seeded once per dialog-open/attempt,
  regenerated only on close or success — never on every mutation call) in all five call sites
  (`policies.tsx`, `finance.tsx` ×2, `receipt-drawer.tsx`, `groups.tsx`) and wiring the same
  `group-${key}-${policyId}` composite key + pre-check + 409 mapping into `/api/group-receipt`,
  which had no idempotency machinery at all.
- **4. The client portal's own idempotency key defeated itself** — it embedded `Date.now()`, so
  it was different on every single call by construction, meaning a retry after a stalled Paynow
  request could never be recognized as the same attempt and could double-charge a client. Fixed
  by replacing the timestamp with a key that's stable for the lifetime of one payment attempt
  (regenerated only when the selected policy changes or a payment completes), in
  `client/src/pages/client/payments.tsx`.
- **5. Requisition and expenditure payouts could exceed their approved amount.** Both routes read
  `amountPaid`/remaining balance before opening a transaction, then wrote unconditionally with no
  lock and no optimistic check — two concurrent partial payments both read the same stale balance,
  both passed the "within remaining balance" check, and the second `UPDATE` silently overwrote the
  first's running total (lost update + over-disbursement). Fixed by moving the balance read and
  validation *inside* the transaction, after `SELECT ... FOR UPDATE` on the requisition/expenditure
  row — mirrors the atomic-check pattern `credit-apply.ts` already used correctly for credit
  balances.
- **6. Linking a claim to a funeral case had no database constraint behind it** — two concurrent
  claim submissions for the same case both passed the "not already linked" pre-check, and the
  later `updateFuneralCase` call silently won, orphaning the other claim's case link with no error
  to either caller. Added `fc_org_claim_partial_idx` (`CREATE UNIQUE INDEX ... WHERE claim_id IS
  NOT NULL`) on `funeral_cases`, the exact pattern `fq_org_case_partial_idx` already uses correctly
  for quotation-to-case linking — `migrations/0079_funeral_case_claim_unique.sql`.
- **Files:** `server/routes.ts`, `client/src/pages/staff/policies.tsx`,
  `client/src/pages/staff/finance.tsx`, `client/src/pages/staff/groups.tsx`,
  `client/src/components/receipt-drawer.tsx`, `client/src/pages/client/payments.tsx`,
  `migrations/0079_funeral_case_claim_unique.sql`.
- **Verification:** typecheck clean, full test suite green (202/202). Live-verified against real
  Falakhe data inside a transaction that was always rolled back (no test data persisted): a second
  insert with a duplicate `idempotencyKey` was confirmed rejected by the real unique constraint
  (`23505 payment_transactions_idempotency_key_unique`), and the new `fc_org_claim_partial_idx`
  was confirmed present and correctly defined via `pg_indexes`. Migration applied to main +
  Falakhe + Supabase backup.
- **Lesson for next time:** an idempotency-key column and its error-mapping can be fully correct
  and still do nothing, if no caller ever populates the column — always check the frontend actually
  *sends* the key, not just that the backend *would* handle one. And a `SELECT` before
  `withOrgTransaction` is not the same as a `SELECT ... FOR UPDATE` inside it — the gap between
  those two lines is exactly where every race in this batch lived; the fix is almost always "move
  the read inside the transaction and lock the row," not new logic.

## 2026-07-21 — Six instances of re-asking for data the app already had, across funeral cases/claims/quotations/policies

- **Symptom reported:** recording a mortuary dispatch on a case that already had a payment
  recorded on the same file prompted for the deceased's name again. A full audit was requested
  ("if a document needs details found in a related file, it should auto-populate instead of
  asking me to retype them").
- **The literal reported bug didn't reproduce** — the dispatch form has no deceased-name field at
  all; it's pure read-only display sourced from the linked mortuary intake. The actual bug is one
  screen over, in the **exact same shape**: creating a funeral case by linking an existing cash
  service quotation. The quote's deceased name is fetched and shown on screen
  (`"Deceased: **John Doe**"`) but the "Deceased Full Name" input directly below it starts blank
  and is HTML `required` — blocking submission until retyped, even though the backend
  (`quoteToCaseBlankFillPatch`, `server/routes.ts`) was already fully built to auto-fill it. The
  client simply never called it. **Fix:** `lookupQuotation` in `client/src/pages/staff/funerals.tsx`
  now merges the quote's blanks into form state immediately (mirroring the sibling
  policy-claim path's `selectMember`, which already did this correctly).
- **Five more instances of the same pattern found during the audit**, all fixed:
  1. **Case→quote linking was one-directional.** `POST /api/quotations/:id/link-case` only
     backfilled the *case* from the quote, never the reverse. Added
     `caseToQuoteBlankFillPatch` (`server/routes.ts`) and a `blankFillPatch` param on
     `storage.linkQuotationToCase` so linking a case-with-data to a blank-ish quote now fills the
     quote too.
  2. **Claims never referenced an existing funeral case.** `funeralCases.claimId` was already a
     real FK — read by `storage.getClaimsByOrg`'s left-join and even whitelisted for case editing
     — but nothing in the UI ever set it. Added a "Link Funeral Case (optional)" lookup to the
     claim-creation dialog (`client/src/pages/staff/claims.tsx`); `POST /api/claims` now
     blank-fills `deceasedName`/`deceasedRelationship`/`dateOfDeath`/`causeOfDeath` from the
     linked case and sets `funeralCases.claimId` back onto the case afterward (409s if the case
     already has a different claim linked, mirroring the existing quote-link 409).
  3. **Funeral case "Informant" fields never pulled from the linked policy's beneficiary**, even
     though the Policy Claim path already fetches the full policy record. `lookupPolicy`
     (`funerals.tsx`) now blanks-only-fills `informantName`/`informantPhone` from
     `policy.beneficiaryFirstName/LastName/Phone`.
  4. **"Add Dependent to Policy" was a pure blank form**, unlike the policy-creation wizard's
     dependent step, which already lets staff pick from the client's existing dependents. Now
     shows the client's not-yet-linked dependents first (link with one click via
     `POST /api/policies/:id/members`), with "Add a New Dependent Instead" as a fallback.
  5. **Adding a dependent had no duplicate-record safety net** (client creation already has one,
     by national ID). `POST /api/clients/:clientId/dependents` now soft-matches on
     name + (national ID or date of birth) and returns the existing dependent (`code:
     "EXISTING_DEPENDENT"`) instead of silently creating a near-duplicate; both callers
     (`policies.tsx`) handle that response.
  6. **Group batch receipts made staff hand-total N policies' premiums.** Each policy's premium
     is already shown per-row; `groups.tsx` now auto-sums `totalAmount` as an editable default
     (never overwrites a value staff typed themselves — only updates while the field still holds
     the app's own last auto-sum).
- **Files:** `client/src/pages/staff/funerals.tsx`, `client/src/pages/staff/claims.tsx`,
  `client/src/pages/staff/policies.tsx`, `client/src/pages/staff/groups.tsx`, `server/routes.ts`,
  `server/storage.ts`.
- **Verification:** typecheck clean, full test suite green (202/202). Live-verified against real
  Falakhe data: `getFuneralCasesByOrg`'s new `q` filter correctly resolves an exact case number,
  `linkQuotationToCase`'s new signature is live, dependents lookup works.
- **Lesson for next time:** the codebase already had the right pattern in two places
  (`quoteToCaseBlankFillPatch`, `caseToIntakeBlankFillPatch`) before this fix — the bug wasn't
  architectural, it was that new linked-record flows kept getting added without checking whether
  a sibling flow already solved the same "pull from the linked record" problem. When a user
  reports "the app makes me retype X," grep for the entity's blank-fill patch function (if one
  exists) first — the fix is almost always "wire up the direction that was never called," not new
  logic. When none exists yet, check whether a *sibling* creation/link path already solved the
  identical case (e.g. `selectMember` for the claims path) before writing fresh merge logic.

## 2026-07-21 — "Delete Receipt" claimed success and permanent removal, but never deleted anything

- **Symptom:** user deleted a duplicate receipt from a policy, got a green "Receipt deleted /
  Receipt permanently removed" toast, but the receipt was still there afterward.
- **Root cause:** `DELETE /api/receipts/:id` (`server/routes.ts:3565`) never deletes a receipt
  directly — by design, it always creates a pending `delete_receipt` approval request
  (maker-checker: a different staff member with `approve:requests` must approve it on the
  Approvals page before the receipt and its linked payment transaction are actually removed) and
  returns HTTP 202 with `"Deletion request submitted for management approval"`. The frontend
  mutation (`client/src/pages/staff/policies.tsx`, `deleteReceiptMutation`) ignored that response
  entirely and unconditionally showed "Receipt deleted — Receipt permanently removed" on any
  2xx — so the UI actively lied about what had happened on literally every use of this button,
  not just an edge case.
- **Fix:** the confirm dialog now says "Request Receipt Deletion?" and explains it queues an
  approval rather than deleting immediately; the button reads "Submit for Approval" instead of
  "Delete"; the success toast reads "Deletion request submitted" with a pointer to the Approvals
  page, instead of claiming permanent removal. The backend approval-resolution logic itself
  (`POST /api/approvals/:id/resolve`, `requestType === "delete_receipt"`) was already correct —
  it properly deletes the receipt + linked transaction and recomputes the policy's cover cycle
  once actually approved; this was purely a frontend messaging bug, nothing server-side changed.
- **Files:** `client/src/pages/staff/policies.tsx`.
- **Verification:** typecheck clean. Not independently re-verified live (pure copy/messaging
  change, no logic touched) — if you have a real pending deletion request, confirm it now shows
  correctly as "submitted" rather than "deleted", and that it still requires a second person to
  approve it in Approvals before the receipt disappears.
- **Lesson for next time:** when a mutation's `onSuccess` toast is generic copy that doesn't
  branch on the actual response body/status code, check whether the endpoint always does what
  the toast claims — an async/approval-queued write returning 2xx is easy to mistake for "the
  thing happened" if the frontend never reads the response. Grep the mutation's `onSuccess` for
  hardcoded success copy whenever a "delete succeeded but nothing changed" report comes in before
  assuming the delete logic itself is broken.

## 2026-07-21 — Receipt "Issued By" printed blank/dash: two bugs, one config gap and one widespread lookup bug

- **Symptom:** user printed a payment receipt and the "Issued By" line was missing entirely
  (shows as a dash in the surrounding layout, since the row is simply omitted when the name
  can't be resolved).
- **Root cause 1 (the actual trigger here):** `applyCreditBalanceToPolicy`/`runApplyCreditBalances`
  (`server/credit-apply.ts`) — the "Apply Credit Balances" staff action — never accepted or
  recorded an acting user at all. Every other receipt-creating code path (`POST /api/payments`,
  cash receipts, month-end batch, group receipts, PayNow apply) resolves the acting user's
  tenant-DB id and stamps it onto both `paymentTransactions.recordedBy` and
  `paymentReceipts.issuedByUserId`; credit-balance auto-apply set neither, so any receipt
  generated that way had `issued_by_user_id = NULL` in the database — not a lookup failure,
  a genuine attribution gap (also missing from the audit log and commission ledger).
- **Root cause 2 (a separate, much wider bug found while fixing #1):** `storage.getUser(id)` is
  `getUser(id, organizationId?)` — when `organizationId` is omitted it *only* queries the
  central registry DB, skipping the tenant DB entirely. For isolated-tenant orgs (e.g. Falakhe,
  which has its own dedicated database) this silently fails to resolve a user that exists in the
  tenant DB but not (or under a different id) in the central registry. Confirmed live: the same
  user id resolved to "NOT FOUND" via `storage.getUser(id)` and to the correct display name via
  `storage.getUser(id, orgId)`, against a real Falakhe receipt. This exact unscoped-call pattern
  was duplicated across **every PDF-generation file that resolves a staff name**:
  `receipt-pdf.ts`, `quotation-pdf.ts`, `mortuary-document.ts` (four separate call sites),
  `driver-checklist-pdf.ts`, `funeral-document.ts`, `policy-document.ts`, `schedule-pdf.ts` — all
  silently degrade to a blank name for isolated-tenant orgs instead of erroring, which is exactly
  why this went unnoticed until someone actually looked at a printed document.
- **Fix:** `credit-apply.ts` now takes an `actorUserId` parameter threaded from
  `POST /api/apply-credit-balances` (`req.user.id`), resolves it inside the transaction the same
  way `routes.ts` already does elsewhere (`ensureRegistryUserMirroredToOrgDataDbInTx` + a
  tenant-DB `users` select, falling back to `null` if the mirror was skipped), and sets
  `recordedBy`/`issuedByUserId`/the `applyPolicyStatusForClearedPayment` actor from it. The
  automation-tick call site (`server/routes.ts`, the timer-driven sweep) intentionally still
  passes no actor — that one is correctly system-driven. Every `storage.getUser(id)` call site
  listed above now passes `orgId` as the second argument.
- **Files:** `server/credit-apply.ts`, `server/routes.ts` (`POST /api/apply-credit-balances`),
  `server/receipt-pdf.ts`, `server/quotation-pdf.ts`, `server/mortuary-document.ts`,
  `server/driver-checklist-pdf.ts`, `server/funeral-document.ts`, `server/policy-document.ts`,
  `server/schedule-pdf.ts`.
- **Verification:** typecheck clean, full test suite green (202/202). Live-verified against real
  Falakhe data: streamed the service-receipt, quotation, and funeral-case-worksheet PDFs
  end-to-end with no errors, and directly confirmed the orgId-scoped `getUser` fix resolves a
  real receipt's issuer name that the unscoped call returned "NOT FOUND" for.
- **Lesson for next time:** `storage.getUser(id)` has an *optional* `organizationId` — every
  call site that omits it is a latent isolated-tenant bug that won't show up against the shared
  DB in testing, only against a dedicated tenant DB like Falakhe's. When touching any function
  that resolves a user id to a display name for a document/PDF, grep `storage.getUser(` in the
  file and confirm `orgId` is actually passed, don't assume it is.

## 2026-07-16 — Self-approval (maker-checker) was silently unenforced in 3 of 6 approval flows

- **Symptom:** none reported directly — surfaced by an audit requested after the user asked
  how the app's various "approval" screens related to each other. POL263 turned out to have
  five separate approval systems (a generic `approval_requests` table, `waiting_period_waivers`,
  an inline `approvalStatus` column on `payment_receipts`, `requisitions`, and `settlements` —
  the platform-fee reconciliation mechanism), and while requisitions correctly blocked a person
  from approving their own request, three other flows didn't check at all, and two more checked
  but didn't exempt the platform owner (the intended sole exception).
- **Root cause:** each of the five approval flows was built independently, at different times,
  without a shared "who resolves this" convention to copy from. Waivers
  (`POST /api/waivers/:id/resolve`), payment-receipt approval
  (`POST /api/payment-receipts/:id/approve` and its `/reject` sibling), and claims entering
  `approved`/`paid` status (`POST /api/claims/:id/transition`) had **no same-person check at
  all** — whoever requested a waiver, issued a receipt, or submitted/verified a claim could
  approve their own request outright, given the right permission. Settlements
  (`POST /api/settlements/:id/approve`) and the generic `approval_requests` resolver
  (`POST /api/approvals/:id/resolve`) *did* block self-approval, but — unlike requisitions —
  neither exempted the platform owner, meaning even they were blocked from resolving their own
  settlement or request, contrary to intent.
- **Fix:** all five now follow the exact pattern requisitions already used correctly: resolve
  the acting user's id via `resolveOrSyncTenantUserId` (never compare the raw registry
  `user.id` — the stored initiator field is a tenant-DB id, which diverges from the registry id
  on isolated-tenant orgs), compare against the record's initiator field
  (`waiver.requestedBy` / `receipt.issuedByUserId` / `claim.submittedBy` or `claim.verifiedBy` /
  `settlement.initiatedBy` / `approval.initiatedBy`), and reject with a 403/400 unless
  `user.isPlatformOwner` is true.
- **Files:** `server/routes.ts` — `POST /api/waivers/:id/resolve`,
  `POST /api/payment-receipts/:id/approve` + `/reject`, `POST /api/claims/:id/transition`,
  `POST /api/settlements/:id/approve`, `POST /api/approvals/:id/resolve`.
- **Verification:** typecheck clean, full test suite green (202/202). Live-server verification
  was deliberately **not** done — see the permission-scoping entry immediately below for why
  starting the dev server in this environment is not currently a safe no-op action.
- **Lesson for next time:** when a codebase grows the same *kind* of control (maker-checker,
  rate limiting, audit logging, etc.) independently in multiple places over time, grep for
  every occurrence of the pattern's signature line (here, `initiatedBy ===` / `requestedBy ===`
  and the absence thereof) rather than assuming the one flow you're looking at is representative
  of all of them — this is the fourth time this session a "some call sites have it, some don't"
  gap was found by checking siblings rather than trusting one example (funeral case number
  lookup, Finance tab allowlist, attendance QR format, now this).

## 2026-07-16 — `manage:approvals` split into scoped permissions; the split changes tenant role_permissions on every server restart, not just this one

Not a bug fix — a design note worth logging because of an unusual side effect. `manage:approvals`
(previously gating three unrelated domains: generic requests, waivers, settlements) was split
into `approve:waivers`, `approve:settlements`, and `approve:requests` in `server/constants.ts`'s
`ROLE_PERMISSION_MAP`. **This is not a one-time migration** — `seedOrgRoles()`
(`server/seed.ts`), invoked for every organization on every server startup
(`server/index.ts:301-314`), does a full clear-and-reapply of each system role's permissions
from `ROLE_PERMISSION_MAP` every single time the process boots. That means the *next* time this
app's server process restarts for any reason (a deploy, a crash recovery, a manual restart —
not just this specific change), every tenant's `manager` and `administrator` roles will have
their `role_permissions` rows cleared and rebuilt from whatever `ROLE_PERMISSION_MAP` says at
that moment — which is by design and has been true since `seedOrgRoles` was written, but is easy
to forget when editing that map, since the blast radius is "every live tenant, next restart,"
not "the org I'm testing against, right now." **Consequence for this session specifically:**
starting even a local dev server pointed at this environment's configured database is not a
safe, side-effect-free verification step for anything touching `ROLE_PERMISSION_MAP` — it
immediately rewrites real tenants' real role permissions the moment the process boots. Verified
this change is net-safe (both new scoped permissions were added to exactly the two roles that
held the old broad one, so no access regresses) via static analysis of `ROLE_PERMISSION_MAP`
rather than a live restart.

---

## 2026-07-16 — Attendance kiosk QR code only offered "copy text" when scanned with a phone's native camera

- **Symptom:** user reported scanning the printed attendance QR code (with their phone's
  regular Camera app, the natural first instinct for any QR code) only ever gave a "copy
  text" option — no way to actually clock in/out.
- **Root cause:** `GET /api/attendance/qr-codes/:id/image` (`server/routes.ts:8375-8385`)
  encoded the QR as raw JSON — `{"orgId":"...","qrCodeId":"...","token":"..."}` — not a URL.
  A generic/native QR reader only offers actions it recognizes (open a URL, dial a number,
  connect to wifi, etc.); plain JSON isn't any of those, so it falls back to "copy text" or a
  web search. The code was only ever scannable by the app's own in-app scanner (the "Start
  Scan" button on `/staff/attendance`, using `html5-qrcode` to decode the camera feed
  in-page and `JSON.parse()` the result directly) — never by a phone's native camera.
  Checked the two other QR-generating call sites in the app (receipt PDFs and member cards,
  both via `buildVerifyQrBuffer` in `server/pdf-utils.ts`) and both already encode a real
  `/verify?type=...&id=...` URL — this was specific to the attendance kiosk code.
- **Fix:** the QR now encodes `${APP_BASE_URL}/staff/attendance?scan=<token>` — a real URL,
  so a native camera app offers "Open" and deep-links straight into the app. The in-app
  scanner (`client/src/pages/staff/attendance.tsx`) now accepts *both* formats (tries
  `JSON.parse()` first, falls back to reading the `scan` query param from a URL), so QR
  codes already printed and posted at a physical location keep working without needing to
  be reprinted. Landing on the Attendance page with `?scan=<token>` in the URL while already
  logged in now auto-fires the same clock-in/out request a camera-in-app scan would, via a
  `useRef`-guarded `useEffect` that also strips the query param immediately so a page
  refresh can't resubmit the same scan twice.
- **Deliberately left out of scope:** the staff Google OAuth login redirect
  (`client/src/pages/staff/login.tsx:73`) hardcodes `returnTo=/staff` — so a staff member
  who scans the physical QR with their camera *while logged out* lands on the login page,
  authenticates, reaches the normal dashboard, and needs to scan again from inside the app
  to actually complete the clock-in (the `?scan=` param is dropped, not carried through
  login). Making that fully seamless would mean changing the OAuth redirect default used by
  *every* staff login, not just this one flow — a much higher-blast-radius change than this
  fix warranted on its own.
- **Files:** `server/routes.ts`, `client/src/pages/staff/attendance.tsx`.
- **Verification:** typecheck clean, lint clean, full test suite green (202/202).
- **Lesson for next time:** any QR code meant to be scanned by a general-purpose device
  (a phone's native camera, not just this app's own in-app scanner) must encode a URL, not
  a bare data payload — a generic QR reader has no way to act on arbitrary JSON/text. When
  adding a new QR-code generator, check `buildVerifyQrBuffer`/`buildVerifyUrl` in
  `server/pdf-utils.ts` first; that's the established, already-correct pattern in this
  codebase, and reusing it costs nothing.

---

## 2026-07-16 — Edge-case sweep of the billing feature + Finance redesign turned up 9 real bugs

Asked to "check for edge cases in everything we did" (the tenant billing feature and the
earlier Finance grouped-tab redesign, both this session). Ran 4 parallel deep reviews rather
than skim — real, fixable bugs below, ranked by what they actually affect.

- **Lost-update race in `applyTenantInvoicePayment`** (`server/tenant-billing-service.ts`) —
  the invoice row was locked (`FOR UPDATE`) but the subscription row wasn't. Two *different*
  open invoices for the same subscription paid concurrently would both read the same stale
  `currentPeriodEnd` and the second UPDATE would silently overwrite the first's period
  extension — a tenant could pay twice and only get one cycle of access. **Fix:** added
  `.for("update")` to the subscription select inside the same transaction, so the second
  concurrent call blocks and re-reads the already-extended period instead of racing.
- **No guard against overlapping sweep runs, which enabled the race above** —
  `runTenantBillingSweep` had no lock, so the manual-trigger platform route could fire while
  the scheduled 06:00 UTC run was still in flight; `generateInvoiceForSubscription`'s
  idempotency check is a plain SELECT-then-INSERT with no backing unique index, so two
  overlapping runs could both create a duplicate open invoice for the same subscription+period
  (plus duplicate reminder emails) — exactly the precondition for the race above. **Fix:**
  wrapped the sweep body in `withAdvisoryLock` (`server/advisory-lock.ts`, an existing helper
  already used 3× elsewhere in this codebase for the identical problem — see
  `PAYMENT_AUTO_LOCK_KEY`/`PARKED_VEHICLE_LOCK_KEY` in `server/routes.ts`); a second concurrent
  call now returns `{ skipped: true }` instead of running.
- **`addBillingCycle` did calendar-month arithmetic in local server time, not UTC**
  (`server/tenant-billing-math.ts`) — `getMonth`/`setMonth`/`getDate` read the Node process's
  local timezone. No `TZ` is pinned anywhere in this deployment, so correctness silently
  depended on whatever timezone the host happens to run in; an instant near a month boundary
  (e.g. `2026-01-31T22:30:00Z` reading as local `2026-02-01T00:30` under `TZ=Africa/Harare`,
  UTC+2 — plausible for this product) would shift a billing period by a full month. **Fix:**
  switched to `getUTCMonth`/`setUTCMonth`/`getUTCDate` throughout so the result is
  deterministic regardless of server TZ config.
- **Plan `DELETE` could throw an unhandled Postgres FK violation** (`server/platform-billing-routes.ts`)
  — same bug *class* as the funeral-case-link crash fixed earlier today: the "in use" check
  only queried `tenantSubscriptions`, never `tenantInvoices` (which also FKs to `billingPlans.id`
  with no `onDelete` clause). A tenant paid under Plan A, then reassigned to Plan B, leaves
  Plan A with zero subscribers but a paid invoice still referencing it — deleting it then hit
  an uncaught `23503` straight to the global handler. **Fix:** check both tables, plus a
  try/catch around the delete itself catching `23503` as a safety net for the check-then-act
  race, matching the existing `23505` pattern already used elsewhere in this file.
- **Plan `modules` array wasn't validated against known module keys** — a typo'd module key
  (`"claim"` vs `"claims"`) would save silently and permanently exclude a feature the platform
  owner meant to include, with no error. **Fix:** validate against `ALL_KNOWN_MODULES`
  (already exported from `module-gate.ts`) on both create and update, 400 on unknown keys.
- **The funeral-case link-case fix from earlier today didn't trim whitespace or match
  case-insensitively** (`server/routes.ts`, `server/storage.ts`) — copy-pasting a case number
  with a leading/trailing space (very common from a PDF or another field) or typing it in
  lowercase both 404'd with "Funeral case not found" even though the case exists — the exact
  same failure *shape* as the bug fixed that same session, just a different trigger the first
  fix didn't cover. **Fix:** `.trim()` the raw input before the UUID/case-number check (which
  also fixes a whitespace-only string incorrectly skipping the "required" 400); case-number
  lookup now compares `upper(...)` on both sides rather than an exact match (`sql`upper(...)``,
  not `ilike()`, so user input can't be interpreted as a wildcard pattern).
- **Finance page: an unauthorized `?tab=X` deep-link could set `activeTab` to a tab with no
  visible group** (`client/src/pages/staff/finance.tsx`) — `resolveTab` validated the URL
  param against the full static list of all 14 tab values, not the current user's actually-
  visible subset (computed separately, later, in the render). A bookmarked/shared link to a
  tab the viewer lacks permission for (or a live mid-session permission downgrade — the effect
  only re-ran on `[search, commissionOnly]`) would light up the wrong group pill while still
  rendering the named tab's content underneath. No data leak (the backend was always properly
  gated), just a broken-looking page. **Fix:** hoisted the per-tab visibility computation to
  the top of the component (moved `canManageSettings`'s declaration up to make this possible)
  so `resolveTab` and the render use the exact same `visibleTabDefs`, and widened the
  re-resolve effect's dependencies to the underlying permission booleans, not just the URL.
- **Platform console: reassigning a tenant's plan silently broke if no active plans existed,
  or if the tenant's current plan had since been retired** (`platform-tenant-console.tsx`) —
  the `<select>` filtered to `isActive` plans only, so a retired-but-still-assigned plan
  matched no `<option>`, and zero active plans left an empty dropdown with no guidance.
  **Fix:** always include the tenant's currently-assigned plan (labeled "(retired)" if
  inactive), and show an inline message when the resulting list is empty.
- **Three minor UI edge cases**, all in the billing frontend added this session: a plan's
  Active toggle could flip the wrong direction on a rapid double-click before the first PATCH
  resolved (now disabled while its own mutation is pending); the public pay page kept showing
  a stale payment-error message after switching payment methods (now resets on method change);
  the public pay page had no explicit handling for a `"void"` invoice status, letting a
  no-longer-payable invoice fall through to a live payment form (now shows its own message).
- **Files:** `server/tenant-billing-service.ts`, `server/tenant-billing-sweep.ts`,
  `server/tenant-billing-math.ts`, `server/platform-billing-routes.ts`, `server/routes.ts`,
  `server/storage.ts`, `client/src/pages/staff/finance.tsx`,
  `client/src/pages/staff/platform-tenant-console.tsx`,
  `client/src/pages/staff/platform-billing.tsx`, `client/src/pages/public/pay-invoice.tsx`.
- **Verification:** typecheck clean, full test suite green (202/202) after every fix. Did
  **not** run a live concurrent-sweep test against production to confirm the advisory lock —
  that would mean executing the real production billing sweep (which can auto-suspend real
  tenants and send real emails) against live data with no seeded test tenant, and was
  correctly blocked by the permission system as outside the scope of the earlier PayNow-only
  test authorization. Confidence instead rests on `withAdvisoryLock` being an already-proven
  pattern used identically 3× elsewhere in this exact codebase, plus direct code review.
- **Lesson for next time:** when a fix closes one gap in a class of bug (e.g. "route trusts
  unresolved user input against a typed DB column," "route doesn't check every table that FKs
  to the thing it's deleting"), grep for every other occurrence of that same pattern in the
  same session rather than assuming the one reported instance was the only one — three of the
  nine bugs above are the *same* underlying mistake recurring in a different route. Also:
  after building anything with concurrent-write potential (a payment-application function, a
  scheduled sweep), explicitly ask "what happens if this runs twice at once" before shipping —
  it's cheap to check with a fresh review pass and expensive to discover in production.

---

## 2026-07-16 — Linking a funeral case to a quotation by case number threw "Internal Server Error"

- **Symptom:** User reported linking a funeral case to a quotation failed with a generic
  Internal Server Error. Production log line pinpointed it exactly:
  `"invalid input syntax for type uuid: \"FNC-000048\""`, thrown from `storage.getFuneralCase`.
- **Root cause:** `LinkCaseDialog` (`client/src/pages/staff/quotations.tsx`) has a single free-text
  input whose label says "Enter the Funeral Case ID" and whose placeholder literally reads
  **"UUID or case number"** — explicitly inviting the user to type either. But `POST
  /api/quotations/:id/link-case` (`server/routes.ts:7761`) passed whatever string was typed
  straight into `storage.getFuneralCase(funeralCaseId, orgId)`, `storage.getFuneralQuotation(...)`,
  and `storage.linkQuotationToCase(...)` — all three do `eq(<uuidColumn>, funeralCaseId)` against
  a `uuid`-typed Postgres column. Typing a case number like `"FNC-000048"` (not a UUID) makes
  Postgres itself throw `invalid input syntax for type uuid` on the very first query, which had no
  specific handling and fell through to the route's catch-all `safeError(err)` — in production that
  always returns the literal string "Internal server error" (`route-helpers.ts:33`), masking the
  real cause from both the user and (without checking the raw server log) from debugging.
  Same class of "route trusts the UI's promised input shape without validating it" bug as the
  2026-07-08 entry below, but a different failure mode: that one was a missing-conflict-check;
  this one is a missing-input-resolution step for a UI element that explicitly advertises two
  accepted formats but only one was ever actually implemented server-side.
- **Fix:** Added `storage.getFuneralCaseByCaseNumber(caseNumber, orgId)` (`server/storage.ts`,
  interface + implementation, sibling to `getFuneralCase`). The route now checks the incoming
  string against a UUID regex (the same one already used in `server/client-auth.ts:151`) and
  resolves via `getFuneralCase` (UUID) or `getFuneralCaseByCaseNumber` (anything else) *before*
  any query touches the `funeralCaseId` FK column, then uses the resolved real UUID
  (`existingCase.id`) for every downstream call. This makes the dialog's "UUID or case number"
  promise actually true instead of only working by accident when a UUID happens to be pasted in.
- **Files:** `server/routes.ts` (`POST /api/quotations/:id/link-case`), `server/storage.ts`
  (`getFuneralCaseByCaseNumber`, interface + implementation).
- **Verification:** typecheck clean, full test suite green (202/202). Did not query production
  data to confirm the specific case (`FNC-000048`) resolves — that would have printed a real
  deceased person's name into this session's transcript without the user having authorized direct
  production queries, and was correctly blocked by the permission system; the fix's correctness
  rests on code review (the UUID regex and the new lookup method both mirror existing, working
  patterns elsewhere in the codebase) rather than a live reproduction against that specific row.
- **Lesson for next time:** when a UI's label/placeholder text promises multiple accepted input
  formats ("UUID or case number", "email or phone", etc.), grep the server route it submits to and
  confirm every one of those formats is actually handled — it's easy for only the first-built
  format to work while the placeholder's promise silently bit-rots into a false claim. Also: any
  route that takes a user-suppliable string and passes it into a query against a `uuid`-typed
  column needs either an explicit UUID-shape check first, or a catch for Postgres's `22P02`
  invalid-text-representation error — `safeError()` masking the real message in production means
  the *server log* (not the client toast) is the only place this class of bug is diagnosable from,
  so always ask for or check the raw log line before guessing at a fix.

---

## 2026-07-16 — Finance page: hand-maintained tab allowlist had drifted out of sync with the actual tabs, silently swallowing 3 deep links

Surfaced while redesigning the Finance page's 13-tab (actually 14-tab) strip into grouped
navigation ("LETS MAKE THIS WORLD CLASS"). Investigating the flat tab strip before touching
layout turned up a real, pre-existing correctness bug riding along with the visual complaint.

- **Symptom:** Deep links to `/staff/finance?tab=banking`, `?tab=receipting-by-staff`, and
  `?tab=my-pnl` silently opened the Payments tab instead of the tab that was actually
  requested. No error, no console warning — just the wrong content on screen.
- **Root cause:** `client/src/pages/staff/finance.tsx`'s `resolveTab()` validated the URL's
  `?tab=` param against a hand-maintained `FINANCE_TABS` array (previously hardcoded at what
  is now line ~1391) that was supposed to mirror the `value` props of the page's
  `<TabsTrigger>` elements. It didn't: `receipting-by-staff`, `my-pnl`, and `banking` all had
  real, working `<TabsTrigger>`/`<TabsContent>` pairs in the JSX but were missing from the
  array, so `FINANCE_TABS.includes(raw)` returned `false` for them and `resolveTab()` fell
  back to `"payments"`. This is the same class of bug as a permission allowlist that isn't
  regenerated when a new permission is added — a list hand-copied from another list will
  eventually diverge, silently, because nothing forces them to stay equal.
  Compounding this: `banking` (the `BankingPanel` component, ~700 lines — the single largest
  section on the page) and `receipting-by-staff`/`my-pnl` had **zero nav entry point** in
  `client/src/components/layout/staff-layout.tsx` either, so in practice they were only
  reachable by already being on the Finance page and clicking around — the deep-link bug had
  gone unnoticed because almost nothing linked to the affected tabs in the first place.
- **Fix:** Introduced `FINANCE_TAB_META` (`finance.tsx`, module scope, ~line 1374) as the
  single source of truth for every tab's `value`/`label`/`title`/`group`. `FINANCE_TABS` is
  now `FINANCE_TAB_META.map(t => t.value)` — derived, not hand-copied, so it can't drift out
  of sync with the tabs again. Also added nav entries for `?tab=receipting-by-staff` and
  `?tab=banking` to both `newNavSections` and the legacy `financeMenu` in `staff-layout.tsx`,
  and removed the now-redundant "Bank Deposits" stub nav entry (`/staff/transactions/
  bank-deposits`, a `StaffComingSoon` placeholder) since `BankingPanel` already fully
  implements bank deposit recording.
- **Verified:** `npm run check`, `npm run lint`, `npm run test` (179/179 passing) all clean;
  confirmed via grep that all 14 `<TabsContent value="...">` blocks have a matching entry in
  `FINANCE_TAB_META`; confirmed via Vite dev-server transform check (curl against
  `/src/pages/staff/finance.tsx` and `/src/components/layout/staff-layout.tsx`, PID-tracked
  PowerShell server per this session's established pattern) that both files compile cleanly.
- **Lesson for next time:** when a component maintains a validation allowlist (valid tab
  values, valid enum strings, valid route names) that's meant to mirror a list that already
  exists elsewhere in the same file (JSX trigger values, a permission set, a route table),
  derive it with `.map()`/`.filter()` from the canonical list instead of hand-copying the
  values a second time. Two lists that are supposed to be equal but aren't mechanically tied
  together *will* diverge — and because the failure mode here was a silent fallback rather
  than a crash, it can ship and sit unnoticed for a long time. When auditing a tab/nav strip
  for UX reasons, also check reachability (does anything link to it?) and validation (does
  the deep-link allowlist actually match the tabs?) before assuming the only problem is visual.

---

## 2026-07-14 — Live production bugs found while chasing "confirm data parity"; backup sync rewritten to prevent recurrence

Follow-up to the two entries below (Supabase backup schema gap, deploy-time migration runner
never reaching Falakhe). Asked to "fix it so we don't face the same issue going forward" and
confirm data parity — doing the second thing surfaced three more, more serious problems than
the original schema gap, one of which was a live bug affecting every org except Falakhe.

- **Live bug: `groups.is_legacy` and three `payment_receipts` columns
  (`approved_by_user_id`, `submitter_note`, `backdated_date`) existed on Falakhe's schema but
  had never been pushed to the main/shared database at all.** `storage.getGroup`/
  `getGroupsByOrg` and `storage.getPaymentReceiptById`/`getPaymentReceiptsByPolicy`/
  `getPaymentReceiptsByClient` all use a blanket `tdb.select().from(table)`, which Drizzle
  compiles into an explicit column list matching the TypeScript schema — confirmed by directly
  running that exact query against the main DB: `column "is_legacy" does not exist` /
  `column "approved_by_user_id" does not exist`. This means the Groups feature and core
  receipt-lookup functions (viewing/downloading a receipt, payment history by policy/client)
  were **actively broken for every org except Falakhe** — Valleyside, Shego, Sunrest, Test
  Tenant — until fixed today. Root cause: same shape as the Supabase gap — these columns were
  pushed to Falakhe's isolated DB via `drizzle-kit push` (during the legacy-groups and
  receipt-approval-workflow feature work) but the equivalent push against main was never done.
  Main also turned out to have its own vestigial columns Falakhe lacked (`payment_receipts.
  approved_by`/`is_backdated` — an older, pre-rename shape no longer read by any code;
  `payroll_employees.bank_details` — explicitly superseded by structured banking fields per an
  earlier session; `org_policy_sequences.credit_note_next`/`month_end_run_next` — genuinely
  needed by Falakhe's credit-note/month-end-run features and was the one direction that *was*
  a live gap on Falakhe, not just main). Fixed with `scripts/reconcile-schema.mjs` (see below)
  run in both directions between `DATABASE_URL` and `FALAKHE_DIRECT_URL`; both are now fully
  column-for-column symmetric. Verified the exact previously-failing queries succeed on main now.
- **The actual daily backup sync had been failing on every single table, every single run**
  (`total_rows: 0`, `table_count: 0`, `error_count: 210`, every night for at least the prior
  week per `backup_sync_runs` history) — not just the 12-table schema gap from the earlier
  entry. Root cause: `getBackupPool()` sets `ssl: { rejectUnauthorized: false }` correctly, but
  something about the deployed production environment's route to Supabase specifically still
  produced `self-signed certificate in certificate chain` on every upsert — reproduced the
  *code* locally (identical config) and it worked cleanly, so this is an environment-specific
  TLS quirk in production, not a code defect; flagged for Augustus to check the deployed env's
  actual `SUPABASE_BACKUP_URL` value and DigitalOcean's outbound TLS path to a third-party host,
  since it couldn't be reproduced or fixed from here.
- **That failure was invisible because the error filter meant to skip "table doesn't exist"
  (an expected/tolerable case) was also silently swallowing "column doesn't exist"** — a much
  worse case, since it meant an *existing* table's entire multi-row upsert failed atomically
  and silently, forever, every run. `!msg.includes("does not exist")` matched both; replaced
  with `isMissingRelationError()`, checking Postgres error code `42P01` (undefined_table)
  specifically, so `42703` (undefined_column) now always surfaces as a real, visible error.
- **The advisory lock guarding against concurrent sync runs could get permanently stuck**,
  blocking every subsequent attempt forever with no data ever moving again. Root cause:
  `pool.query("SELECT pg_try_advisory_lock(...)")` and the matching unlock call at the end were
  two independent checkouts from a `pg.Pool` — nothing guarantees they land on the same
  underlying connection/session, and Postgres advisory locks are session-scoped, so the unlock
  can silently no-op on a different session while the original one keeps holding the lock.
  Reproduced this exact stuck state twice while testing today (had to `pg_terminate_backend`
  the orphaned session both times to unblock further testing). Fixed by checking out one
  dedicated client via `pool.connect()` and holding it for the lock's entire lifetime,
  acquire through release, instead of two separate `pool.query()` calls.
- **A related crash risk, likely what caused at least one of the two stuck-lock incidents
  above:** `pg.Pool` emits an `'error'` event when an already-idle pooled client hits a
  connection/network error; with no listener, Node treats this as an uncaught exception and
  kills the *entire process* instantly, bypassing every `try/catch/finally` in the call stack
  — including the lock-release `finally`. `getBackupPool()`'s pool had no `.on("error", ...)`
  handler (every other pool in this codebase — `control-plane-db.ts`, `tenant-db.ts` — already
  has one). Added it. **Then found `server/db.ts`'s main pool — the one backing the entire
  application, sessions, auth, everything — had the exact same gap.** This is a considerably
  more serious finding than the backup job: it means the whole running app server has been one
  dropped idle connection away from a full crash, this whole time, for reasons having nothing
  to do with backups. Added the same handler there.
- **Fix, structurally:** rewrote `server/backup-sync.ts` to discover tables, primary keys (and
  now unique indexes too, for tables like `role_permissions`/`tenant_feature_flags` that only
  have a `CREATE UNIQUE INDEX`, not a formal constraint — information_schema.table_constraints
  doesn't surface those, so the first rewrite silently skipped them until this was caught and
  fixed) directly from each source database's live schema every run, and to reconcile the
  backup's structure (create missing tables, add missing columns) automatically before syncing
  data — replacing the hardcoded `TENANT_FULL_SYNC_TABLES`/`CONTROL_PLANE_TABLES` arrays that
  were the root of the original schema-gap entry. `scripts/reconcile-schema.mjs` (generalized
  from the earlier Supabase-specific version) is kept as the manual/on-demand equivalent for
  other database pairs (e.g. it's what fixed main↔Falakhe above).
- **Verified for real, twice more:** ran the actual `runBackupSync()` end-to-end against
  production data after every fix. Final run: 12,828 rows across 89 tables, only the same 2
  pre-existing duplicate-key edge cases (unrelated, harmless), no crash, lock released cleanly.
  Followed with a full row-count parity check across every major table (clients, policies,
  payments, disbursements, requisitions, groups, leads, funeral cases, bank deposits, safes):
  full parity everywhere except two rows on two tables, both exactly matching this file's own
  documented "upsert-only, never deletes" limitation (a stale row from something later deleted
  at the source) — not a bug.
- **Files:** `server/backup-sync.ts`, `server/db.ts`, `scripts/reconcile-schema.mjs` (new,
  replaces the deleted `scripts/reconcile-supabase-backup-schema.mjs`).
- **Not fixed, flagged to Augustus:**
  1. The production TLS error connecting to Supabase specifically — couldn't reproduce outside
     production; check the deployed `SUPABASE_BACKUP_URL` value and DO's outbound TLS path.
  2. Connection pressure on the main DO database was tight throughout this session — 17-18 of
     25 max connections in use, and two separate `remaining connection slots are reserved for
     roles with the SUPERUSER attribute` failures were hit just running read-only diagnostic
     queries. Worth a look at whether the plan needs headroom, independent of anything above.
  3. `organizations.database_url`-based tenant discovery may still exist in other scripts under
     `script/`/`scripts/` beyond the three now fixed (migration-status.ts, run-migrations.ts,
     this backup-sync rewrite) — not audited exhaustively.
- **Lesson for next time:** three separate lessons stacked on top of each other here, worth
  reading independently: (1) a hardcoded "list of every table" — in a migration sequence, in a
  sync job, anywhere — will drift from `shared/schema.ts` the moment someone uses `drizzle-kit
  push` instead of writing a migration file, which is the normal/documented dev workflow in
  this repo, so treat any such list as guilty until proven current; (2) an error filter meant
  to tolerate one specific, narrow failure mode should match on the *error code*, not a
  substring of the message — "does not exist" is not one failure mode, it's several, with very
  different severities; (3) any `pg.Pool` without an `.on("error", ...)` handler is a
  process-crash waiting to happen, and any advisory lock acquired/released via a `pg.Pool`
  instead of a single held `pg.Client` is a stuck-forever lock waiting to happen — grep for
  both patterns if this class of "silent total failure" bug shows up again anywhere else.

---

## 2026-07-14 — Supabase backup DB was missing 12 tables and 31 columns; schema_migrations bookkeeping there was unreliable

Follow-up to the same-day entry below (deploy-time migration runner never reaching Falakhe) —
this is the other half of that investigation: why the backup DB migration attempt failed with
"relation payment_disbursements does not exist" in the first place.

- **Root cause, part 1 — the real gap:** `payment_disbursements`, `bank_accounts`,
  `bank_deposits`, `bank_statement_balances`, `balance_sheet_entries` (the whole 2026-06-30
  financial suite), plus 7 more tables/columns from later sessions, were pushed to the main DB
  via `npm run db:push` (drizzle-kit schema push, diffing directly against `shared/schema.ts`)
  and never had a corresponding hand-written file added to `migrations/`. Confirmed by grepping
  every migration file for `payment_disbursements`: only migration 0064 (an `ALTER TABLE`)
  mentions it — no file anywhere `CREATE`s it. This means `migrations/*.sql` was never actually
  a complete, replayable history of the schema; `run-migrations.ts` replaying it against a
  database that only ever went through that path (the Supabase backup, unlike the main DB and
  Falakhe, which both get `db:push`'d directly) can only ever reproduce a partial schema.
- **Root cause, part 2 — the bookkeeping lied about it:** the backup DB's `schema_migrations`
  table showed 70/74 files "applied" despite the structural gap going back to 0064-and-earlier
  — some earlier attempt (a partial `run-migrations.ts` run, or manual seeding) had marked files
  as applied without their `CREATE TABLE` objects actually existing, so `npm run
  db:migrate:status` and `npm run db:migrate` both looked "mostly fine" right up until a later
  migration's `ALTER TABLE payment_disbursements` hit the missing table and failed outright.
- **Why `npm run db:push:backup` (the tool that already existed for exactly this) couldn't
  fix it:** `drizzle-kit push` hit the same interactive rename-detection prompt already solved
  for Falakhe in an earlier session (`Error: Interactive prompts require a TTY terminal` —
  `tablesResolver` → `promptNamedWithSchemasConflict`), which can't be scripted around with
  `--force` (that flag only auto-approves *data-loss* confirmations, not the rename-vs-new
  ambiguity picker).
- **Fix:** wrote `scripts/reconcile-supabase-backup-schema.mjs` — same idea as
  `scripts/sync-falakhe-schema.mts` (add missing tables/columns without the interactive
  resolver) but generates DDL from live `information_schema` introspection of the main DB (the
  real, authoritative source) rather than mapping Drizzle's in-memory column metadata to SQL
  types, which is more accurate and catches every column regardless of when/how it was added.
  Skips foreign keys — the existing backup-sync jobs (`server/backup-sync.ts`,
  `script/full-sync-to-supabase.ts`) already run with `SET session_replication_role = replica`
  to bypass FK checking during upserts, so FK constraints aren't load-bearing on this DB — but
  preserves primary keys, since those upserts rely on `ON CONFLICT (pk)`. Ran with `--dry-run`
  first, caught and fixed a real bug in the script itself (see below), then ran for real:
  12 tables created, 31 columns added, 0 errors. Verified with a fresh diff: zero gaps left.
  Manually marked the 4 migration files whose *effects* are now present (`0064`–`0067`) as
  applied in `schema_migrations`, so a future `db:migrate` run doesn't try to replay old
  data-mutating migrations (backfills, status corrections) against a database that's now
  structurally caught up — replaying those for real, a second time, could double-apply data
  changes in a way plain `CREATE TABLE IF NOT EXISTS` never would.
- **Bug caught in the reconciliation script's own `--dry-run` output before running for real:**
  the `NOT NULL` clause was being incorrectly suppressed for any column that was NOT NULL but
  had no default (e.g. `organization_id UUID` — no default, since it's always provided
  explicitly — came out as nullable). Root cause: `col.is_nullable === "NO" &&
  !def.includes("DEFAULT") ? "" : ...` — backwards conditional, written while conflating "safe
  to add NOT NULL to an existing table with rows" (needs a default) with "safe to declare NOT
  NULL on a brand var new table" (always safe, no rows exist yet). Fixed to always request NOT
  NULL when the source says NOT NULL, and let the already-existing retry-on-23502 fallback
  (drop NOT NULL, log a warning) handle the one real failure case: adding a NOT NULL column
  with no default to an existing table that already has rows.
- **Files:** `scripts/reconcile-supabase-backup-schema.mjs` (new, kept — reusable if this drifts
  again or another external DR target needs the same treatment).
- **Lesson for next time:** `npm run db:push` (schema push against `shared/schema.ts`) and the
  hand-written `migrations/*.sql` sequence are two independent mechanisms in this repo that can
  silently diverge — main and Falakhe both stay correct because they're always pushed directly,
  but anything relying solely on replaying `migrations/*.sql` (the Supabase backup, and any
  future DR/reporting replica set up the same way) can only ever be as complete as that file
  sequence, which this incident proves is not guaranteed to be complete. When dry-running a
  DDL-generation script against a real database for the first time, actually read a few lines
  of its own output before trusting it and running for real — this is exactly how the NOT NULL
  bug above was caught before it reached the database, not after.

---

## 2026-07-14 — `npm run db:migrate` (the real deploy-time migration runner) never actually reached Falakhe

- **Context:** while adding a new migration (0067, for Member Card Admin — see feature notes),
  ran `npm run db:migrate` for real to apply it, expecting the same tenant-discovery bug
  already fixed in `script/migration-status.ts` on 2026-07-13 to be present here too — and it
  was, in the actual production migration runner this time, which is more consequential.
- **Root cause:** `script/run-migrations.ts`'s `loadTenantUrls()` had the identical bug: it
  discovered tenant databases by reading `organizations.database_url` on the shared registry
  DB, which is empty for isolated-tenant orgs like Falakhe (the real URL only lives in the
  control plane's `tenant_databases` table). Before this fix, `npm run db:migrate` — run at
  every deploy via `npm run start:with-migrate` — silently never migrated Falakhe ahead of
  traffic. It "worked" anyway only because of a separate runtime fallback
  (`applyPendingMigrations` in `server/tenant-db.ts`, triggered by `getPoolForOrg` the first
  time a request touches that tenant's DB in a fresh process) — meaning Falakhe's schema
  changes were actually being applied *inline, inside a live user's first request* after every
  deploy, not safely offline before traffic, and with no visibility into whether it succeeded.
- **Fix:** applied the same fix as the 2026-07-13 entry — `loadTenantUrls()` now also queries
  `tenant_databases` joined to `tenants` on the control plane connection, preferring
  `databaseDirectUrl`, merged with the registry lookup. Verified for real: ran `npm run
  db:migrate` after the fix and it now reports "Found 1 tenant DB(s) to migrate… Migrating
  tenant DB: FALAKHE FUNERAL PARLOUR… Applied 0067_member_card_settings.sql" — before the fix it
  found zero tenant DBs.
- **Files:** `script/run-migrations.ts`.
- **Also noticed, not fixed:** the same migration run reported the `SUPABASE_BACKUP_URL` backup
  database is significantly behind — missing even `payment_disbursements` (a much older table)
  — so it's not just missing recent migrations, it looks meaningfully out of sync as a
  disaster-recovery target. Flagged for Augustus, not investigated further; unrelated to this
  fix and the script already treats a backup-DB failure as non-fatal by design.
- **Lesson for next time:** any script that enumerates tenant DBs by reading
  `organizations.database_url` directly — instead of going through `tenant-db.ts` or the
  control plane — will silently miss or misroute isolated-tenant orgs. This is the third time
  this exact bug has been found in a different script (migration status, migration runner);
  worth grep'ing for `organizations.database_url`/`org.database_url` across `script/` and
  `scripts/` the next time this class of bug comes up, rather than waiting to hit each instance
  one at a time.

---

## 2026-07-14 — Home tab "Pending Approvals" counted every approval request ever made, not just pending ones

- **Symptom:** the Command Center widget on the staff home tab showed a "Pending Approvals"
  count (e.g. 20) even when every approval request in the org had already been approved.
- **Root cause:** `client/src/components/command-center.tsx` fetches `GET /api/approvals` with
  no `?status=` filter, which returns every approval request regardless of status (this is
  correct/intended API behavior — the actual Approvals page relies on it, filtering client-side
  into pending/resolved tabs). But the widget computed `pendingApprovals = arr(approvals).length`
  — the raw array length, with no status filter at all — so it was really showing "total
  approval requests ever created for this org," permanently overstating the count once any
  had been resolved.
- **Fix:** `pendingApprovals = arr(approvals).filter((a) => a?.status === "pending").length`,
  matching the exact filter already used correctly on the real Approvals page
  (`client/src/pages/staff/approvals.tsx:59`). Checked every other widget on the same
  component (requisitions, claims, leads, funerals) — all already filter by status client-side;
  this was the one spot that didn't.
- **Files:** `client/src/components/command-center.tsx`.
- **Lesson for next time:** any dashboard/summary widget that reuses a list-fetching query
  designed for a different (unfiltered) consumer needs its own filter applied at the point of
  counting — `.length` on a shared query's raw result is a red flag worth checking for exactly
  this bug whenever a "pending X" or "open Y" count looks too high. This is invisible to
  `npm run check` and the test suite; it only shows up as a wrong number on screen.

---

## 2026-07-14 — Group receipt "print" button 404'd because the API never returned the receipt's real id

- **Context:** while adding a consolidated "print group receipt" document (a feature add, see
  below), found that the print button on the immediate post-submit summary in
  `client/src/pages/staff/groups.tsx` (`POST /api/group-receipt` → "Receipts issued
  successfully" panel) opened `/api/receipts/${r.receiptNumber}/view` — but that route looks the
  receipt up by its UUID `id` (`storage.getPaymentReceiptById`), not its human-readable
  sequential `receiptNumber`. Clicking print on any receipt from a freshly-issued group batch
  would 404.
- **Root cause:** `POST /api/group-receipt` in `server/routes.ts` never captured `.returning()`
  on either of its two `payment_receipts` inserts (backdated and cleared paths), so the response
  `results` array only ever had `receiptNumber`, never the row's real `id` — the frontend had no
  correct value to link to even if it had used the right field name.
- **Fix:** both inserts now `.returning()` and the id is included in each result row; the
  frontend button was changed to use `r.id` instead of `r.receiptNumber`.
- **Files:** `server/routes.ts`, `client/src/pages/staff/groups.tsx`.
- **Lesson for next time:** any endpoint that inserts a row and later needs to reference it by
  id in the same response should capture `.returning()` at the insert site — a silent
  `receiptNumber`-instead-of-`id` mixup like this compiles fine and only surfaces as a runtime
  404 on click, so it won't be caught by `npm run check` or a green test suite either.

---

## 2026-07-14 — Notification bell, self-service attendance, and agent dashboards silently broken on isolated-tenant orgs

Deeper follow-up to the same-day `resolveOrSyncTenantUserId` sweep — the first pass only
grepped `<field>: user.id`-shaped literals; this pass grepped every remaining call of the form
`someStorageCall(user.id, ...)` and found the pattern was much more widespread than the object-
literal grep caught, including some genuinely high-impact ones:

- **The entire notification bell/inbox (built 2026-07-06) never showed anything to a Falakhe
  user.** `notifyUser()` writes/emits under the tenant-resolved recipient id (entity-derived ids
  like `policy.agentId` are already tenant ids), but all 6 notification routes — the SSE stream,
  list, unread-count, mark-read, mark-all-read, and push-token registration — read/subscribed
  under the raw registry `user.id`. On an isolated-tenant org this is a hard 0-for-0 mismatch:
  notifications are created correctly but the recipient can never see or receive them, silently.
- **Self-service attendance was broken for the same reason.** `GET /api/attendance/my` and
  `POST /api/attendance` (and the fleet vehicle-checkout clock-in guard) all looked up
  `payrollEmployees` by raw `user.id` — an isolated-tenant employee would see an empty
  attendance history and get "No payroll employee record linked to your account" when trying to
  clock in, even though they are linked, just under a different (resolved) id.
- **Six agent-facing dashboard widgets and 3 more list/access-check routes had the identical
  bug** (`GET /api/clients`, `GET /api/clients/:id` access check ×3, `GET
  /api/dashboard/revenue-trend`, `/policy-status-breakdown`, `/lead-funnel`, `/covered-lives`,
  `/product-performance`, `/lapse-retention`, `GET /api/leads`, `GET
  /api/cashups/my-receipt-totals`): each used `isAgent ? user.id : ...` as a query filter or
  `!== user.id` as an access check against a column actually holding the resolved tenant id, so
  an agent's own portfolio/dashboard came back empty or falsely 403'd on isolated-tenant orgs.
- **Also upgraded two sites that already partially guarded against this** (`GET /api/cashups`
  filter and `GET /api/cashups/:id` access check) from `resolveUserIdForOrgDatabase(...) ??
  user.id` to `resolveOrSyncTenantUserId(...)` — the null-degrading helper's fallback to the raw
  id doesn't actually help in the one case it exists for (an email-collision mirrored row under
  a different id), since the stored value is never the raw id in that case either.
- **Deliberately left alone:** the two `issuedByUserId` resolution sites in
  `POST /api/policies/:id/payments` premium-override branches, which already comment through
  *why* they degrade to `null` rather than resolve fully (the column is nullable, and losing
  attribution in the rare collision case was judged acceptable there) — not the same bug,
  already a considered decision.
- **Verified:** `npm run check` and `npm run test` (179/179) pass.
- **Files:** `server/routes.ts` only (~20 more call sites on top of the ~25 from the first pass
  the same day).
- **Lesson for next time:** the write-side grep (`<field>: user.id`) and the read-side grep
  (`someCall(user.id, ...)` / `!== user.id` / `isAgent ? user.id`) are genuinely two different
  searches — a route can pass every write-side check and still be completely broken on the read
  side, and it fails *silently* (empty list, 403, no live notification) rather than with a 500,
  which is why none of this surfaced in `npm run check` or the test suite. Any feature described
  as "self-service" or "my own X" (my attendance, my cashups, my P&L, my clients, my dashboard)
  is exactly the shape of code this bug hides in — audit those first if a report ever comes in
  as "works for [some staff] but not for [other staff] doing the identical action."

---

## 2026-07-14 — Full `resolveOrSyncTenantUserId` sweep across routes.ts

Follow-up to the open item logged 2026-07-06: the requisition/expenditure fix for the
registry/tenant user-id mismatch bug had never been audited across the rest of `routes.ts`.
Grepped every `<field>: user.id`, `<field> = user.id`, and `<field> !== user.id` / `isAgent ?
user.id` pattern (~45 hits) and classified each by whether the target table is written via
`getDbForOrg`/`tdb` with a `users.id`-referencing column, or lives on the shared registry DB
(the latter needed no change — mostly `structuredLog(...)` calls). Two distinct symptoms of the
same root cause turned up:

- **Writes**: raw `user.id` into a tenant-DB `users.id` FK. On an isolated-tenant org (Falakhe)
  where the mirrored tenant user id differs from the registry session id, a NOT NULL FK throws a
  500 (e.g. `approval_requests.initiated_by`); a nullable FK either 500s the same way (Postgres
  still enforces the FK when a non-null value is given) or silently drops the attribution.
  Fixed at every site found: reminders (all 4 routes), client/policy document uploads,
  `reconcilePremiumChange`'s `actorId` (fixed once, centrally, inside the helper — covers all 4
  callers), bank deposit create/verify (previous entry), approval requests (delete-policy,
  delete-receipt, delete-quote, claim-review, requisition-correction, generic `/api/approvals`),
  settlements, bank statement balances, debit orders, driver checklists (`preparedByUserId` and
  the `driverId` picked from `req.body`), mortuary dispatch, three PayNow-initiation call sites
  (`initiatePaynowPayment`, `initiatePaynowForGroup`, receipt-reprint payment event), payroll run
  `preparedBy`, and balance-sheet manual entries.
- **Comparisons**: raw `user.id` compared against a column that *was* written with the resolved
  tenant id (once a write path got fixed, or always had been) — same bug, opposite direction.
  Instead of a 500, this silently produces a false negative: an agent locked out of their own
  policy/lead (`agentId !== user.id` → 403), an approver able to approve their own
  requisition/settlement (`initiatedBy === user.id` never true, so the self-approval guard never
  fires), or an agent's own P&L/dashboard/payments/commission-ledger/payment-intents view coming
  back empty (`isAgent ? user.id : ...` used as a query filter). Fixed every site found:
  `GET/PATCH /api/policies/:id`, `POST /api/policies/:id/upgrade`, `PATCH /api/leads/:id`,
  `GET /api/policies` (list filter), `GET /api/agent/pnl`, `GET /api/dashboard/stats`,
  `GET /api/diagnostics`, `GET /api/payment-intents`, `GET /api/commission-ledger`,
  `GET /api/payments`, and the `/api/approvals/:id/resolve` /
  `/api/settlements/:id/approve` self-approval checks (also simplified — these had been calling
  `resolveUserIdForOrgDatabase`/`ensureRegistryUserMirroredToOrgDataDb` separately from the
  comparison, so the comparison used the *unresolved* id even though a resolved id was computed
  two lines later for the write).
- **Verified:** `npm run check` passes; `npm run test` initially broke 2 files
  (`tests/unit/policy-billing.test.ts`, `tests/unit/premium-calculation.test.ts`) because they
  stub `server/storage`/`server/logger` to import `route-helpers.ts` without pulling in a live
  DB connection, and the new `resolveOrSyncTenantUserId` import in `reconcilePremiumChange`
  transitively imports `server/db.ts`, which throws if `DATABASE_URL` isn't set. Fixed by adding
  the same stub pattern for `server/tenant-db.ts` to both test files. Full suite: 179/179 passing.
- **Files:** `server/routes.ts` (~25 call sites), `server/route-helpers.ts` (`reconcilePremiumChange`),
  `tests/unit/policy-billing.test.ts`, `tests/unit/premium-calculation.test.ts`.
- **Not found this pass, in scope for a future sweep:** `server/storage.ts` itself was not
  grepped for internal `user.id`-shaped parameters passed through from callers already fixed
  here — this pass only covered `routes.ts`. Also didn't check client-side code that might cache
  `user.id` and send it back as a body field expected to already be tenant-resolved (e.g. a
  `driverId` picker) — worth a spot-check if a similar 403/empty-view report comes in for a
  route not listed above.
- **Lesson for next time:** this bug class has two faces, not one — grepping only for
  `: user.id,` (the write side) misses the *comparison* side, which fails silently instead of
  500ing and is easy to mistake for "working as designed" (an agent just sees an empty list, no
  error). When auditing for this pattern, grep for both `<field>: user.id` and `<field> !==
  user.id` / `<field> === user.id` / `isAgent ? user.id`. Any storage method call that resolves a
  user id for a *write* right before calling `storage.updateX(...)` should resolve the *same* id
  before any comparison earlier in the same handler, not leave the comparison on the raw id.

---

## 2026-07-14 — Financial suite edge-case sweep: clawback netting, historical balance sheet, bank-deposit cross-tenant IDs

First real pass at the "edge case and bug testing" checklist left open since the financial
suite build (see `project-financial-suite` memory). No test-DB harness exists for the
DB-coupled report builders in `server/financial-statements.ts`, so this was a careful code
read against the specific checklist items rather than new integration tests — three real bugs
found and fixed:

- **Agent P&L permanently overstated outstanding commission after any clawback.** `GET
  /api/agent/pnl` computed `outstanding = earned - paid`, but its loop used `continue` to divert
  `clawback`/`rollback` ledger entries into separate display-only buckets (`commClawbacks`/
  `commRollbacks`) instead of also netting them into `commEarned`/`lifetimeEarned`. Clawback
  entries are created with a **negative** amount and `status: "earned"` (see
  `recordClawback()`/`rollbackClawbacks()` in `server/route-helpers.ts`); excluding them means
  the negative never reduces earned, while an offsetting `clawback_reversal` (positive, not
  excluded) still gets added — so every clawback inflates "outstanding" by the clawed-back
  amount, permanently if never reversed. Confirmed against `storage.ts`'s legacy commission
  summary report (~line 3471), which correctly nets every entry type into its total — this is
  the intended semantic. **Fix:** removed the `continue`; clawback/rollback amounts now both
  feed the separate display buckets *and* flow into commEarned/lifetimeEarned like any other
  entry. `server/routes.ts` (`GET /api/agent/pnl`, both the period and lifetime loops).
- **Balance sheet "as of" a past date silently used today's live cash position.** `reports.tsx`
  lets a user pick any `asOf`/`toDate` for the Balance Sheet, and bank balances/premium
  receivables/retained earnings all correctly scope to that date — but `buildBalanceSheet()`'s
  "Cash on hand" line called `storage.getAdminCashPosition(orgId)` with no date filter at all,
  which always sums *all* cashups and bank deposits ever recorded. Picking a historical date
  mixed a live, present-day cash figure into an otherwise-historical statement, which could
  make the Assets = Liabilities + Equity check fail (or falsely pass) for reasons unrelated to
  the actual historical position. **Fix:** `getAdminCashPosition(orgId, asOf?)` now takes an
  optional date and filters `cashups.cashup_date <= asOf` / `bank_deposits.deposit_date <=
  asOf`; `buildBalanceSheet` passes its `asOf`, `buildExecutiveSummary` passes its period's `to`
  (so a past-month executive summary doesn't show today's cash position either), and the live
  `GET /api/cash-position` endpoint is unchanged (omits `asOf`, same all-time-to-now behavior as
  before). `server/storage.ts`, `server/financial-statements.ts`.
  **Not fixed, flagged only:** claims-payable (`status = 'approved'`) and platform-fees-payable
  (`isSettled = false`) on the same balance sheet have the identical class of bug — both reflect
  *current* status, not status as of the historical date — but neither `claims` nor
  `platform_receivables` has a dated column to reconstruct history from (no `approvedAt`/
  `paidAt` on claims, no `settledAt` on platform_receivables). Fixing those needs a schema
  change or audit-log reconstruction; out of scope for this pass, left as a known gap.
- **Bank deposit create/verify wrote the raw registry `user.id` into a `users.id` FK on
  isolated-tenant orgs.** Same bug class as the requisition/expenditure fix from 2026-07-06
  (entry below, "resolveOrSyncTenantUserId"), just not yet applied here: `POST
  /api/bank-deposits` used `depositedByUserId || user.id` directly, and `POST
  /api/bank-deposits/:id/verify` wrote `verifiedByUserId: user.id` directly. On an
  isolated-tenant org (e.g. Falakhe) where the mirrored tenant-DB user id differs from the
  registry session id, this either violates the FK or silently attributes the deposit/
  verification to the wrong tenant user. **Fix:** both routes now resolve through
  `resolveOrSyncTenantUserId(orgId, ...)` first, same as every other write path that touches a
  `users.id` FK on a per-org table. `server/routes.ts`.
- **Verified:** `npm run check` and `npm run test` (179/179) pass after all three fixes.
- **Lesson for next time:** any DB-coupled report/route change should be checked against two
  recurring failure classes before considering it done: (1) does this loop's early-`continue`/
  `if...else` actually cover every entry type that can appear, or does it silently drop some
  into a side bucket that never reaches the total (the clawback bug); (2) does every storage
  call inside a function parameterized by a historical date (`asOf`, `to`) actually thread that
  date through, or does one of them quietly default to "now" (the cash-position bug). Neither
  is caught by `npm run check` or a green test suite — both require reading what each helper
  function actually queries, not just that it returns without throwing.

---

## 2026-07-13 — `npm run db:migrate:status` silently skipped tenants whose URL only lives in the control plane

- **Symptom:** running the status check reported only the main/registry DB; Falakhe's isolated
  tenant DB connection failed with `getaddrinfo ENOTFOUND base` and was never actually checked,
  even though migration 0066 had in fact been applied there.
- **Root cause:** `script/migration-status.ts`'s `loadTenantUrls()` discovered tenant DBs by
  reading `organizations.database_url` on the shared registry DB — but per the established
  pattern (entry below, "Legacy-issuance relaxation..."), that column is frequently empty for
  isolated-tenant orgs; the real routing lives in the control plane's `tenant_databases` table
  (same source `getPoolForOrg` in `server/tenant-db.ts` treats as authoritative). Falakhe's
  registry `database_url` held a stale/malformed value (hostname resolved to literally `base`),
  so the script tried to connect to garbage instead of skipping or using the real URL.
- **Fix:** `loadTenantUrls()` now also queries `tenant_databases` joined to `tenants` on the
  control plane connection (`CONTROL_PLANE_DIRECT_URL`/`CONTROL_PLANE_DATABASE_URL`, falling
  back to `DATABASE_URL` if neither is set), preferring `databaseDirectUrl` over the pooler
  `databaseUrl` for status/migration checks, and merges by tenant name with the registry lookup
  (control plane wins on conflict). Verified: `npm run check` passes; `npm run db:migrate:status`
  now correctly reports Falakhe as 73/73 applied, none pending.
- **Files:** `script/migration-status.ts`.
- **Lesson for next time:** any script that enumerates tenant DBs by reading
  `organizations.database_url` directly (rather than going through `tenant-db.ts` or the control
  plane) will silently miss or misroute isolated-tenant orgs — this is the same class of bug as
  the `resolveOrSyncTenantUserId` gap, just in a dev/ops script instead of a request handler.

---

## 2026-07-10 — QR attendance/fleet-tracking: manual-correction gap, silent tracking-loss gap, and clock-in/checkout relationship

Follow-up to the self-review below, addressing the three gaps that review flagged as needing
a product decision rather than a one-line fix.

- **Manual correction was non-functional:** `POST /api/attendance` always did a blind
  `INSERT`, so if a QR scan had already created today's row it 409'd, and even when it
  succeeded it only ever saved a note — never `clockInAt`/`clockOutAt` — so it could not
  actually fix a missed scan despite the UI copy telling employees to use it for that.
  **Fix:** the route is now an upsert (`storage.getAttendanceLogForDate` +
  `storage.correctAttendanceLog`/`createAttendanceLog`): if a row exists it fills in
  whichever of `clockInTime`/`clockOutTime` the employee provides without disturbing a value
  already set by a scan, recomputes `hoursWorked`, and resets the row to `pending` for
  re-approval. Added a matching manager-side `PATCH /api/attendance/:id/correct`
  (`write:payroll`) so a manager can fix a log directly instead of only approve/reject.
  Local times are converted with the new `harareLocalToUtcDate()` helper
  (`server/date-utils.ts`) to stay consistent with how QR scans store `clockInAt`/`clockOutAt`.
- **Silent tracking-loss gap:** if a device stops sending pings entirely (dead battery, app
  killed, or a driver deliberately evading tracking), the parked-vehicle tick job had nothing
  to alert on — it just skipped assignments with zero recent pings. Given the feature's
  explicit purpose is monitoring, "no data" is itself a signal worth raising. **Fix:** the
  tick job now fires a `no_signal` vehicle alert if an active checkout has had zero pings for
  10+ minutes (skipping the first 10 minutes after checkout so the app has time to send its
  first ping), and resolves it automatically once pings resume.
- **No relationship between clocking and vehicle checkout:** a driver could check out a
  company vehicle without ever being clocked in for the day, or after clocking out — tracking
  a vehicle in use by someone officially off duty. **Fix:** `POST /api/fleet/:vehicleId/checkout`
  now requires the driver to currently be clocked in (today's `attendance_logs` row has
  `clockInAt` set and no `clockOutAt`); the driver-facing "My Vehicle" panel shows this
  precondition up front instead of only surfacing it as an error toast after a failed attempt.
  Clock-out intentionally still does **not** force-return an active vehicle checkout (a trip
  legitimately running past shift end shouldn't be interrupted) — flagged as a deliberate
  half-measure, not a full solution, in case the business wants the opposite behavior later.
- **Verified:** `npm run check`, `npm run test` (179/179), and `npm run build:client` all pass
  after these changes.
- **Lesson for next time:** "the button exists and doesn't error" is not the same as "the
  button does what its label promises" — the manual-correction gap survived an initial
  typecheck+test+build pass because none of those exercise the actual business outcome of a
  route, only that it runs without throwing. Read the route's response and the schema it's
  writing to when reviewing self-service correction/override flows, not just its status code.

---

## 2026-07-10 — QR attendance/fleet-tracking build: timezone, race, and cross-tenant-ID bugs caught in self-review

Found while reviewing the QR attendance + vehicle GPS tracking feature added this session,
before any real usage — no user-reported symptom, but each is a real bug matching a known
recurring pattern in this codebase (see `feedback_debugging_patterns` memory).

- **Bug 1 — Pattern 12 (UTC+2 timezone):** `recordAttendanceScan()` in `server/storage.ts`
  computed "today" via `new Date().toISOString().slice(0, 10)`, which uses the server's UTC
  date. Zimbabwe is UTC+2 with no DST, so any scan between 10pm–midnight CAT would be
  attributed to the *next* day, and any scan 12am–2am CAT to the *previous* day's row (wrong
  employee-day, wrong hours-worked pairing). **Fix:** compute the date via
  `Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", ... })` instead.
- **Bug 2 — race on double-tap/retry:** two near-simultaneous clock-in scans for the same
  employee+day (double-tap, or a client retry after a dropped response) both read "no row
  yet" and raced on the insert; the loser hit the `attendance_logs` unique constraint
  (`al_emp_date_unique`) and surfaced as an uncaught 500. **Fix:** catch the `23505` on the
  insert path specifically and re-fetch/return the winner's row as the same clock-in event,
  rather than either 500ing or (worse) misreading the race as a second real scan and
  immediately clocking the person back out.
- **Bug 3 — Pattern 3 (cross-tenant user-ID mismatch):** the vehicle-checkout `/return` and
  `/pings` routes, and the `/checkouts/mine` lookup, compared `assignment.driverId` against
  the raw session `user.id`. Checkout itself correctly wrote `driverId` via
  `resolveOrSyncTenantUserId()` (since isolated-tenant orgs mirror users with a possibly
  different UUID), but the later routes never re-resolved before comparing — so on an
  isolated-tenant org where the mirrored ID differs, a driver could be locked out of
  returning/updating their own checkout. **Fix:** resolve `user.id` the same way in all
  three places before comparing.
- **Bug 4 — missing invariant, not just a bug:** nothing stopped one driver from checking
  out two vehicles at once (the checkout route only checked whether the *target vehicle*
  was already out, not whether the *driver* already had one out). The "My Vehicle" UI only
  ever shows/returns one assignment, so a second simultaneous checkout would become
  invisible and untrackable through the UI even though its GPS pings kept accumulating in
  the DB. **Fix:** checkout now also rejects if the resolved driver already has any other
  open assignment.
- **Verified:** `npm run check` and `npm run test` (179/179) pass after all four fixes.
- **Lesson for next time:** any new route that (a) computes "today" server-side, or
  (b) writes/compares a `users.id` FK, should be checked against Pattern 12 and Pattern 3
  immediately — both bugs were introduced by copying a working pattern (raw `Date`
  arithmetic; comparing `user.id` directly) from code elsewhere in the codebase that didn't
  need the tenant-aware version because it ran in a different context.

---

## 2026-07-10 — "Attendance" nav link was invisible to everyone except managers/admins

- **Symptom:** while building QR-based attendance clock-in/out (all staff should reach it),
  found that `client/src/components/layout/staff-layout.tsx` gated the `/staff/attendance`
  nav link (in both the desktop dropdown and the mobile/command-palette nav, two separate
  array literals) behind `permission: "read:payroll"` — a permission only `manager` and
  `administrator` roles hold. Every other role (agent, driver, cashier, claims_officer,
  fleet_ops, mortuary_attendant, staff) could never see the link, even though the backend
  route (`POST /api/attendance`) was always self-service with no permission check. Employees
  could only reach the page by typing the URL directly.
- **Root cause:** the nav entry's permission was copy-pasted from the "Payroll" line right
  above it (`{ href: "/staff/payroll", ..., permission: "read:payroll" }`,
  `{ href: "/staff/attendance", ..., permission: "read:payroll" }`) when attendance was
  originally added, conflating "can view payroll" with "can log my own attendance" — two
  unrelated permissions that happen to live on the same page.
- **Fix:** dropped the `permission: "read:payroll"` key from both `/staff/attendance` nav
  entries so the link is visible to all authenticated staff (`filterNav`'s `hasAny([])`
  treats an item with no `permission`/`permissions` as visible to everyone); the page's own
  internal tab gating (`read:payroll` for Team Attendance, the new `manage:attendance` for
  QR Kiosks) still restricts the sensitive parts.
- **Verified:** `npm run check` and `npm run test` (179/179) pass; confirmed via code read
  that `filterNav`/`hasAny` in `staff-layout.tsx` treat an empty permission list as
  unrestricted.
- **Lesson for next time:** when a nav link and a backend route disagree on who can access a
  feature — self-service backend route + narrowly-gated nav link — the nav gate is very
  likely a copy-paste mistake, not intentional. Grep both the route's middleware and the nav
  entry's `permission`/`permissions` field before assuming either is correct; also check for
  *duplicate* nav arrays (this codebase keeps a desktop dropdown and a separate mobile/search
  nav list in sync by hand — a fix applied to only one will silently miss the other).

---

## 2026-07-09 — approved premium-override receipts never advanced the policy's cover period; deleting a duplicate receipt never undid its effects

- **Symptom:** three Falakhe policies (FLK00382, FLK00383, FLK00385) each received a duplicate
  cash receipt for the same real-world payment on 2026-07-09. Investigation traced it to staff
  entering a payment amount that didn't match the system-computed premium (a legitimate,
  intentional override in these cases), which silently queues the receipt for manager approval
  instead of applying it — with no clear "this needs approval" feedback on screen. Staff, seeing
  nothing happen, re-entered the same payment moments later as a normal (non-overridden) receipt,
  which applied immediately. Both ended up as real, cleared transactions.
- **Root cause, two separate bugs found together:**
  1. `POST /api/payment-receipts/:id/approve` (`server/routes.ts`) recorded the approved payment
     as a `payment_transactions` row but never called `advancePolicyCycle` — so even the
     *correct*, approved payment never extended the policy's paid-through date. This is very
     likely why staff felt their first entry "hadn't worked" and re-entered it.
  2. `DELETE /api/receipts/:id` only ever created a maker-checker approval request; approving it
     (`POST /api/approvals/:id/resolve`, `delete_receipt` branch) called
     `storage.deletePaymentReceipt` and nothing else — the matching `payment_transactions` row,
     and any cover-period advance it caused, were left in place. Deleting a duplicate receipt
     never undid what the duplicate actually did to the policy.
- **Fix:**
  1. The approval route now advances the cycle the correct number of months (from the receipt's
     `metadataJson.months`), matching the pattern already used by `POST /api/payments`.
  2. The `delete_receipt` approval-resolve branch now also deletes the receipt's linked
     `payment_transactions` row (via `metadataJson.approvedTransactionId` /`.transactionId`) and,
     if it was `cleared`, recomputes the policy's cover period from scratch by replaying every
     remaining cleared transaction in posted-date order. Transactions from *before* fix #1 (no
     `periodFrom` stored) are handled without a manual backfill: their month count is derived by
     looking up the receipt that references them via `metadataJson.approvedTransactionId` and
     reading its `months` field, so a historical gap from the old bug doesn't get dropped from
     the replay and wrongly erase real, already-approved cover.
- **Files:** `server/routes.ts`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
  Traced the exact receipt/transaction/policy state for all three live Falakhe policies by hand
  against Falakhe's DB to confirm the fix's replay logic reconstructs the correct cover dates
  before writing it, rather than deploying and hoping. The actual deletions were deliberately
  **not** performed via a direct database script — an auto-mode safety classifier correctly
  blocked that twice (once for fabricating an approval trail, once for a scoped historical-data
  backfill attempt) on the grounds that production financial-record changes should go through
  the application's real approval workflow, not an agent-run script. The three pending
  `delete_receipt` approval requests remain genuinely pending, to be approved by a qualifying
  admin (not the original requester — maker-checker) through the real UI once this fix deploys.
- **Lesson for next time:** when a receipt/payment route has more than one insertion point
  (a normal path and an approval/override path), grep for every place a payment_transaction gets
  created and confirm each one calls the *same* set of side effects (`advancePolicyCycle`,
  `applyPolicyStatusForClearedPayment`, credit-balance logic) — this is the same "reachable only
  through one of several paths" bug class logged repeatedly in this file. Also: a "delete X"
  action that only removes the row named in the request, without reversing whatever that row's
  creation actually *did*, is incomplete by construction — check for this whenever a delete
  route exists for an entity that has side effects on creation.

---

## 2026-07-09 — overpayment above whole-month multiples silently vanished instead of crediting the policy

- **Symptom:** not reported by name, found while implementing overpayment-credit auto-apply — a
  client paying more than an exact multiple of their premium (e.g. premium $10/mo, pays $25) had
  the policy advanced by `floor(25/10) = 2` months, and the leftover $5 was recorded as part of
  the $25 transaction but never tracked anywhere as credit. It wasn't owed back, wasn't applied
  to a future month, and didn't show up on `policy_credit_balances` — it just disappeared from
  the policy's accounting even though the full $25 was banked.
- **Root cause:** `POST /api/payments` (`server/routes.ts`) and `applyPaymentToPolicy`
  (`server/payment-service.ts`, the PayNow completion path) both derive `monthCount` from
  `amount / premium` and advance the policy cycle that many whole periods, but neither ever did
  anything with the remainder. The exact same "amount over premium" case was already handled
  correctly one place over — the month-end bulk-run route (`POST /api/month-end-run`) already
  calls `storage.addPolicyCreditBalance` for its excess — it just was never applied to the two
  much more commonly used single-payment paths.
- **Fix:** added `storage.addPolicyCreditBalanceInTx` (`server/storage.ts`) — a transaction-safe
  variant of the existing `addPolicyCreditBalance` so the credit commits atomically with the
  payment that produced it, instead of the month-end route's pattern of crediting after the
  transaction closes. Both `POST /api/payments` and `applyPaymentToPolicy` now credit
  `amount - monthCount × premium` to `policy_credit_balances` whenever it's positive. Also wired
  `runApplyCreditBalances` (`server/credit-apply.ts`) — previously only reachable via a manual
  "Apply Credit Balances" button in Finance — into the existing payment-automation `setInterval`
  tick (`server/routes.ts`, next to `runPaymentAutomationForOrg`) so credit balances get spent
  against the next due premium automatically, not just when someone remembers to click the button.
- **Files:** `server/routes.ts`, `server/payment-service.ts`, `server/storage.ts`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
  Confirmed via Falakhe's live DB that `policy_credit_balances` and the wallet-balance display
  (`walletBalance` in `GET /api/policies/:id`, rendered in `client/src/pages/staff/policies.tsx`)
  were already fully wired end-to-end — the only missing piece was actually crediting the excess
  at the two write sites that needed it.
- **Lesson for next time:** when the same "excess/remainder" concept is handled correctly in one
  code path (month-end bulk run) but not in the more commonly used ones (single cash receipt,
  PayNow), that's the same "reachable only through one of several paths" bug class logged
  repeatedly in this file — grep for every place that derives `monthCount`/`periods` from
  `amount / premium` division, not just the one you're currently touching.

---

## 2026-07-09 — Legacy Individual/Group policies still refused to add dependants without DOB

- **Symptom:** user reported that LEGIND (Legacy Individual) policies still refuse to add
  dependants unless date of birth is filled in, even though Legacy Individual/Group issuance is
  supposed to relax full-detail capture (see 2026-07-08 entries below — the *client's own* DOB
  requirement was already relaxed for legacy issuance, but this is about *dependants*, a
  different form and a different endpoint).
- **Root cause:** the DOB/gender relaxation for legacy issuance was applied to the client record
  (`POST /api/clients`) and the beneficiary sub-form, but never to `POST
  /api/clients/:clientId/dependents` — that route unconditionally required `dateOfBirth` and
  `gender` with no legacy exception at all (`server/routes.ts`). Two client-side call sites hit
  this: the "Save Dependent" sub-form inside the policy-creation wizard
  (`client/src/pages/staff/policies.tsx`, `newDep`/`addDepMutation`) additionally *disabled its
  own submit button* whenever DOB or gender was blank, regardless of `isLegacyIssuance` — so for
  LEGIND/LEGGRP the user could not even submit the form, matching the reported symptom exactly.
  The "Add Dependent to Policy" dialog on an existing policy (`detailAddDepMutation`) didn't gate
  the button, but would still get a 400 back from the server since the server had no way to know
  the add was for a legacy policy.
- **Fix:** `POST /api/clients/:clientId/dependents` now accepts optional `policyId`,
  `legacyGroupId`, or `legacyProductVersionId` in the body and resolves legacy status
  server-side (looking up the real policy/group/product, never trusting a client-claimed
  boolean) — same pattern already used by `POST /api/clients`. DOB/gender are only required when
  none of those resolve to a legacy capture. Client-side: the wizard's "Save Dependent" button no
  longer requires DOB/gender when `isLegacyIssuance` is true, and both dependant-adding call
  sites now send the relevant flag (`legacyGroupId`/`legacyProductVersionId` from the wizard,
  `policyId` from the existing-policy dialog) so the server can verify it.
- **Files:** `server/routes.ts`, `client/src/pages/staff/policies.tsx`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
  Traced both call sites' request bodies and the server's new resolution branches by hand;
  no interactive click-through (staff auth is Google OAuth-only, no dev bypass — see prior
  entries).
- **Lesson for next time:** when relaxing a validation rule for a "legacy issuance" special case,
  grep for *every* endpoint that captures the same kind of data (client details, beneficiary,
  dependants, ...) rather than assuming one shared flag/pattern covers all of them — each had its
  own separate hardcoded requirement here, so fixing the client record alone (2026-07-08 entry)
  left dependants completely unfixed. This is the same "reachable only through one of several
  paths" bug class as the 2026-07-08 wizard-step-order entry, just surfacing on a different
  submission form instead of a different wizard step.

---

## 2026-07-08 — linking a quotation to a case threw a bare "Internal server error"

- **Symptom:** user reported linking a quote to a case fails with a generic internal server error,
  no useful detail.
- **Root cause:** `POST /api/quotations/:id/link-case` (`server/routes.ts:7194`) had **no
  try/catch at all**. A case can only have one quotation linked — enforced by a partial unique
  index, `fq_org_case_partial_idx` (`migrations/0036_quotation_enhancements.sql`, on
  `(organization_id, funeral_case_id) WHERE funeral_case_id IS NOT NULL`) — but the route never
  checked for this before attempting the update. Trying to link a second quotation to a case that
  already has one throws a Postgres unique-violation, which had nothing to catch it and fell
  through to the global error handler (`server/routes.ts:10057`), which returns the exact generic
  `{"message": "Internal server error"}` the user saw. Checked Falakhe's live data for the specific
  quote/case combination but found no currently-conflicting pair — the fix covers the mechanism
  regardless of the exact case, and now surfaces the real reason on the next attempt if it
  recurs (or logs it server-side via `structuredLog` for any other failure mode).
- **Fix:** wrapped the handler in try/catch; proactively checks (via `getFuneralQuotation`,
  which returns the quote already linked to a case if any) whether the target case already has a
  *different* quotation linked, returning a clear 409 naming the conflicting quotation number
  instead of attempting the update at all. Kept a `23505` catch as a safety net for the race
  between the check and the write, plus a generic catch-all that logs full error detail
  server-side instead of losing it to the global handler.
- **Files:** `server/routes.ts`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
- **Lesson for next time:** when a DB-level constraint enforces a business rule (a partial unique
  index, a check constraint, etc.), the route hitting it needs to either check for the conflict
  proactively or catch the specific Postgres error code (`23505` for unique violations) — never
  rely on the global error handler as the only backstop, since it can only ever return a generic
  message with no actionable detail for the user.

---

## 2026-07-08 — policyNumberPrefix silently flipped to null (produced 15 policies with no "FLK" prefix)

- **Symptom:** 15 Falakhe policies had bare numeric policy numbers ("00331", "00217", …) instead
  of the expected "FLK00331" format. `organizations` audit history showed `policy_number_prefix`
  repeatedly cycling `'FLK' → null → 'FLK'` over several unrelated settings saves across June/July.
- **Root cause:** `GET /api/organizations` (the list endpoint, used for `currentOrg` in
  `client/src/pages/staff/settings.tsx`) sources branding fields — including
  `policyNumberPrefix` — from `cp_tenant_branding`, a control-plane **mirror** table
  (`server/routes.ts:873-914`), not from the real `organizations` row. The Settings page seeded
  its local form state from this list value (not from `fullOrg`, the single-org endpoint that
  reads `storage.getOrganization()` directly — already used for PayNow fields specifically,
  per an existing comment flagging this same class of staleness). Because
  `handleSaveBranding()` unconditionally resends every one of these fields on *every* save
  (regardless of which field the user actually meant to change), any time the mirror lagged
  behind the real value, the next unrelated branding save (e.g. changing the phone number) wrote
  the stale/blank mirrored value straight back into the real `organizations` table — overwriting
  a correct 'FLK' with null. `generatePolicyNumber()` (`server/storage.ts:4126`) reads this
  column live on every policy creation, so policies created during a null window got no prefix.
- **Fix:** merged the two `useEffect`s that seed Settings' form state
  (`client/src/pages/staff/settings.tsx`) into one, sourcing every field — branding, policy
  numbering, `databaseUrl`/`isWhitelabeled`, and PayNow — from `fullOrg ?? currentOrg`
  consistently, the same pattern already used for PayNow fields alone. `fullOrg` always reads
  the real table, so it can't go stale the way the mirror can.
- **Data correction:** renamed the 15 affected policies to add the missing "FLK" prefix
  (`FLK00217`, `FLK00331`–`FLK00344`), each logged as an `UPDATE_POLICY` audit entry.
- **Files:** `client/src/pages/staff/settings.tsx`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
  Traced the exact audit-log cycle (`'FLK' → null → 'FLK'`) against policy creation timestamps to
  confirm every un-prefixed policy fell inside a null window before writing the fix.
- **Lesson for next time:** a control-plane mirror table that exists only for a dashboard list
  view becomes a live data-corruption vector the moment a form seeds its *editable* state from it
  instead of from the authoritative single-record endpoint — especially when the save handler
  resends the whole form on every submit rather than only the fields that actually changed. When
  auditing a "this field mysteriously reset" report, check whether the value display and the value
  being edited come from two different queries.

---

## 2026-07-08 — Policies list showed client IDs instead of names for most policies

- **Symptom:** many rows on the Policies list displayed a raw client id fragment instead of the
  client's name.
- **Root cause:** both `GET /api/clients` and `GET /api/policies` default to `limit=100` when no
  `limit` query param is sent (`server/routes.ts:1549`, `:2233`), and
  `client/src/pages/staff/policies.tsx` never passed one for either. Falakhe has 261 clients and
  300+ policies with no pagination UI on this page — so only the first 100 of each ever loaded.
  `getClientName()` looks up the policy's `clientId` in a map built from the (truncated) client
  fetch; any client past row 100 wasn't in the map, so the lookup fell through to displaying
  `clientId.slice(0, 8) + "..."` — and, separately, any policy past row 100 in its own list
  silently never rendered at all, a strictly worse version of the same root defect.
- **Fix:** added `limit=500` (the server's hard ceiling) to both the `/api/clients` and
  `/api/policies` fetch URLs in `policies.tsx`. Also changed `getClientName()`'s fallback from a
  truncated id to "Unknown client" for the genuine edge case (client actually missing/deleted),
  so a lookup miss is never confused with a real identifier again.
- **Files:** `client/src/pages/staff/policies.tsx`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
  Confirmed via direct count (261 clients, ~345 policies vs. the 100-row default) before writing
  the fix, rather than assuming from the symptom alone.
- **Lesson for next time:** `limit=500` is a stopgap, not a scalable fix — if either table grows
  past 500 rows for any org, this same symptom returns. The real fix is proper pagination (or
  having the policies endpoint return the client name embedded per row, removing the need for a
  separate full client fetch entirely) — flagged here, not built, since it's a bigger change than
  this bug report asked for.

---

## 2026-07-08 — no way to edit a policy holder's address from the Policy page

- **Context:** user reported "can't edit the address" while working on a policy. Traced this to a
  genuine gap, not a backend bug — `PATCH /api/clients/:id` has no field restriction and updates
  `physicalAddress`/`postalAddress` fine; the **Edit Client** dialog on the Clients page
  (`client/src/pages/staff/clients.tsx`) already works. But the Policy detail page's "Policy
  holder" section (`client/src/pages/staff/policies.tsx`) only ever displayed the client's contact
  info read-only, and the "Edit Policy Details" dialog only covers policy-level fields (currency,
  schedule, beneficiary, premium, etc.) — there was no route to edit the client's own details
  without leaving the policy entirely for the separate Clients page.
- **Fix (feature work, not a bug fix):** added an "Edit contact details" button to the Policy
  holder card that opens a lightweight dialog (phone, email, physical/postal address) PATCHing
  `/api/clients/:id` directly, invalidating the policy-detail client query on success. National
  ID/DOB/gender remain Clients-page-only for now (out of scope for what was reported).
- **Files:** `client/src/pages/staff/policies.tsx`.

---

## 2026-07-08 — editing premium on an already-saved policy silently reverted (PATCH missing the premiumOverride pairing that POST already had)

- **Symptom:** user reported FLK00360's premium was "$24" the day before, then after upgrading it
  to Legacy Individual and editing the premium to a custom $10.00 (twice), it kept reverting to
  $20.00 (LEGIND's flat catalog price). Editing premium while *first creating* a policy worked;
  editing it on an *already-saved* policy did not.
- **Root cause:** `recalculatePolicyPremiumIfNeeded()` (`server/routes.ts`, fires on every
  policy-list/detail view) skips recomputation only when `policy.premiumOverride` is non-null —
  this is the exact mechanism the 2026-07-07 entry above ("legacy policy premiums silently reset
  to $0.00") introduced to protect a manually-agreed Legacy Individual/Group premium. `POST
  /api/policies` (creation) correctly auto-sets `premiumOverride` alongside `premiumAmount`
  whenever the issued product is LEGIND/LEGGRP (`server/routes.ts:2496-2510`) — but `PATCH
  /api/policies/:id` (editing an existing policy) had no equivalent: it only ever sets
  `premiumOverride` if the **caller** sends that field explicitly as a separate value, which the
  Edit Policy dialog (`client/src/pages/staff/policies.tsx`) never does — it only sends
  `premiumAmount`. So every edit silently left `premiumOverride` null, and the very next list/
  detail view recalculated `premiumAmount` back to the product's catalog price, discarding the
  edit with no error and no audit trail for the revert itself (the only visible audit entries were
  the user's own edits, each showing `before: 20.00 (or whatever catalog price) -> after: 10.00`,
  looking successful right up until the next page load).
- **FLK00360 specifics traced from its full audit history:** created 2026-07-07 under UMTHUNZI
  (catalog $12) at $12.00, `premiumOverride` null throughout. By the next day it had silently
  drifted to $24.00 via this exact recalculation mechanism — for this client's age, UMTHUNZI's
  age-banded price is $24, not the flat $12 shown at creation (a legitimate recompute, not a
  second bug, since UMTHUNZI was never a custom-premium product and had no override protecting a
  deliberately-different number). It was then upgraded to LEGIND (catalog $20, note the 2026-07-01
  comment describing LEGIND as "always prices at 0" is stale — its `product_versions` row has
  since been set to a real $20 monthly base), and the user's two attempts to set it to $10.00 both
  reverted to $20.00 before being viewed again.
- **Fix:** `PATCH /api/policies/:id` now mirrors the creation route — when a manual premium change
  is being applied (`manualPremium != null`) and the caller didn't already send an explicit
  `premiumOverride` (including an explicit clear), it looks up the policy's product by
  `productVersionId` and, if it's LEGIND/LEGGRP, auto-sets `premiumOverride`/`premiumOverrideNote`
  to match the new `premiumAmount`. Reuses the existing `premiumOverrideUpdate` code path
  (storage update + audit log) rather than adding a new one.
- **Data correction:** FLK00360 directly corrected to `premiumAmount = premiumOverride = 10.00`
  (the value the user tried to set twice), recorded as an `UPDATE_POLICY` audit entry with the
  true before/after state, once the user confirmed $10.00 was still the intended value.
- **Files:** `server/routes.ts`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
  Traced the exact field-by-field audit history for FLK00360 to confirm the revert pattern before
  writing the fix, rather than guessing from the symptom alone.
- **Lesson for next time:** whenever a "protect this value from an automatic recompute" flag
  (like `premiumOverride`) is set automatically on **one** write path (creation) but that same
  entity can also be modified via a **second** write path (edit), audit whether the second path
  sets the same protective flag — it's easy to fix the first reported case (creation, per the
  2026-07-07 entry) and miss that the identical bug is still reachable via edit. Same root lesson
  as the wizard step-order entry directly above: a relaxation/protection mechanism is only as good
  as *every* path that can produce the state it's supposed to protect.

---

## 2026-07-08 — Legacy Individual/Group policy creation still demanded DOB/national ID

- **Symptom:** user reported trying to create a policy twice under a Legacy product without a
  date of birth, and being refused both times, even though Legacy Individual/Legacy Group
  policies are supposed to relax full-detail capture (see log entry below, 2026-07-07, "Legacy-
  issuance relaxation only covered legacy *groups*, not legacy *individuals*").
- **Root cause:** the relaxation *was* implemented for both, but only reachable through a legacy
  **group** — `client/src/pages/staff/policies.tsx` computes `isLegacyProductIssuance` from
  `createForm.selectedProductId` (line ~326), which is only set in **Step 2** of the 4-step
  "Add Policy" wizard (product selection). But client details — including DOB, national ID,
  phone, gender — are captured in **Step 1**, and Step 1's "Continue" button was disabled unless
  those fields were filled in *unless* `isLegacyIssuance` was already true. Since the product
  (and therefore whether this is a Legacy Individual/Group issuance) isn't chosen until Step 2,
  `isLegacyProductIssuance` is structurally always `false` while still on Step 1 — the relaxation
  could never activate for a client captured this way. The legacy-*group* path worked because
  `groupId` (and therefore `isLegacyGroupIssuance`) is already known before Step 1 renders (set
  when opening the wizard from a specific group), so it didn't hit this ordering problem.
- **Fix:** removed the national ID/phone/DOB/gender/beneficiary requirement from the Step 1
  "Continue" button's disabled condition entirely (`client/src/pages/staff/policies.tsx`) —
  confirmed via `calculatedPremium`'s useMemo that none of these fields are actually used to
  compute premium for a brand-new client, so gating an intermediate step on them served no
  purpose beyond blocking exactly this flow. Final validation (whether these fields are required)
  is deferred to the Save button (Step 4) and the `createMutation` function itself, both of which
  correctly resolve `isLegacyIssuance` against whichever product/group was actually selected by
  then. Also moved the "missing fields" hint text for these fields from the Step 1 block to Step
  4, so the amber hint under the button stays accurate to what's actually blocking submission.
- **Files:** `client/src/pages/staff/policies.tsx`.
- **Verification:** typecheck clean, full test suite green (179/179), production build succeeds.
  Full interactive click-through wasn't done (staff auth is Google OAuth-only, no dev bypass in
  this codebase — see prior entry) but traced the exact state dependency chain confirming
  `isLegacyProductIssuance` cannot be true during Step 1 under the old code, and that nothing
  downstream (premium calculation) depends on the new client's own DOB.
- **Lesson for next time:** a multi-step wizard that gates an early step on "is this a special
  case" cannot use a flag that's only derived from a *later* step's input — check what step sets
  the state a conditional depends on before adding relaxed-validation logic to an earlier step.
  This is the same "reachable only through one of two paths" mistake as the entry below, just
  found via wizard step order instead of a covering-a-code-path gap.

---

## 2026-07-08 — no way to record a requisition/expenditure paid in a different currency than raised

Follow-on from the same-day backfill below. After backfilling June's 253 missing disbursements,
user clarified that Falakhe's Rand till ended June at zero — the R7,460.00 gap between ZAR income
(R34,430.00) and ZAR-tagged expenses (R26,970.00) wasn't a surplus; it was Rand cash used to pay
$373.00 worth of requisitions that were raised/tagged in USD. At the org's configured FX rate
(`fx_rates`: ZAR rateToUsd = 0.05, i.e. 20 ZAR/USD), R7,460 ÷ 20 = $373.00 exactly, confirming the
math. True June position: ZAR net = R0.00 (all Rand received was spent), USD net improves from
-$6,214.50 to **-$5,841.50** (less USD cash actually left the till than the USD-tagged total
implied).

Root cause: `payment_disbursements.currency` was always hard-set to the requisition/expenditure's
own currency (`server/routes.ts`, both `POST /api/requisitions/:id/payments` and
`POST /api/expenditures/:id/payments`) with no way for staff to record that the cash handed over
was actually a different currency. This is exactly the kind of real-world mixed-currency-till
behavior a funeral-services cash business has day to day, and there was no field to capture it —
so it could only be reverse-engineered after the fact from aggregate currency gaps, and only at
the total level (checked description/notes text and `payment_method` for a per-transaction signal
first — found none; `payment_method` was uniformly `'cash'` and only one requisition's free-text
description mentioned a Rand figure, and even that didn't reconcile against its recorded amount).
**The 268 individual June USD-tagged requisitions were not and could not be corrected
individually** — this stays a top-level reconciling note for June, not a per-record rewrite.

Fix: added `entity_amount` and `fx_rate_applied` (nullable) to `payment_disbursements`
(`shared/schema.ts`, `migrations/0064_disbursement_cross_currency.sql`, applied to both the main
DB and Falakhe's isolated DB via `scripts/sync-falakhe-schema.mts` — note that script infers
`numeric` columns as TEXT due to a `dataType` mismatch in its type-inference table, so the two
columns needed a manual `ALTER COLUMN TYPE NUMERIC` after running it). Added
`resolveCrossCurrencyPayout()` in `server/routes.ts`: when a payment's optional `paidCurrency`
differs from the requisition/expenditure's own currency, `payment_disbursements.currency`/`amount`
now hold what actually left the till (converted at the caller-supplied `fxRateApplied`), while the
new `entityAmount` holds the amount in the requisition's own currency (unchanged math for
amountPaid/fully-paid tracking). Because `buildIncomeStatement()` already groups expenses by
`payment_disbursements.currency`, this was the only change needed for future cross-currency
payments to report correctly — no changes to `financial-statements.ts`. Added the toggle + fields
to the "Record Payment" dialog in `client/src/pages/staff/finance.tsx` (checkbox reveals a
currency picker + rate input, with a live "cash handed over" preview).

**Lesson for next time:** a cash-basis multi-currency system needs to distinguish "the currency
this line item is denominated in" from "the currency that physically changed hands" — collapsing
them (as the original disbursement insert did) is invisible until someone reconciles actual till
balances against reported P&L by currency, potentially months later. When Falakhe (or any
multi-currency tenant) reports a currency-net that looks too clean/too surplus, check whether it's
actually cross-currency substitution before treating it as real balance.

---

## 2026-07-08 — 253 "paid" requisitions invisible to the income statement (bulk data-entry gap)

Symptom: user asked for a June 2026 income statement summary and whether expenses entered the
previous day (2026-07-07) were accounted for. June's expenses looked implausibly low ($4,193 +
R5,640) against the volume of paper requisitions Falakhe staff had been transcribing.

Root cause: `buildIncomeStatement()` (`server/financial-statements.ts`) sums expenses strictly
from the `payment_disbursements` ledger by `paid_date` — it never reads `requisitions.status`.
On 2026-07-07 at 11:59:11 a single bulk transaction inserted 245 historical requisitions
(REQ-00102–REQ-00354, paper records from June being caught up in the system) directly with
`status = 'paid'` and `paid_date` set, but without going through `POST /api/requisitions/:id/payments`
— the only path that writes a matching `payment_disbursements` row. So the requisitions looked
"paid" everywhere in the UI (list, vouchers, PDFs) while being completely invisible to every
cash-basis financial statement. This is the exact drift already anticipated in a code comment at
`server/routes.ts:6467` ("exactly the drift a historical backfill script had to patch for
Falakhe") — `scripts/backfill-requisition-disbursements.mjs` already existed from an earlier,
smaller occurrence of this same gap (committed in 7bd1a7b) and is idempotent (targets any
currently-missing disbursement, no date filter), so it needed no changes — just a re-run.

Fix: ran `node scripts/backfill-requisition-disbursements.mjs` — created 253 disbursement rows
(210 USD requisitions totaling $10,837.50 + 43 ZAR totaling R21,330.00, plus a few outside June).
Verified 0 remaining `status='paid'` requisitions without a matching disbursement afterward.

Effect on reported numbers: June's real position was a **$6,214.50 USD net loss**, not the
originally-displayed **+$4,623.00 USD profit** — a ~$10.8k swing hidden by the gap. ZAR stayed
net positive (+R7,460 corrected vs. +R28,790 displayed).

**Lesson for next time:** any *new* raw-SQL or bulk-insert path that sets `requisitions.status`
or `expenditures.status` to `'paid'` directly must also create the matching `payment_disbursements`
row (mirror the field mapping in `POST /api/requisitions/:id/payments` /
`POST /api/expenditures/:id/payments`) or it silently vanishes from every income statement, cash
flow statement, and executive summary — the same class of bug as the legacy-receipt platform-fee
gap logged 2026-07-01 (`[[project_financial_suite]]`), just on the expense side instead of income.
When a bulk historical-data catch-up is about to happen again, run
`scripts/backfill-requisition-disbursements.mjs` (and add an equivalent for `expenditures` if that
table starts seeing the same treatment) right after, before anyone reads a financial report.

---

## 2026-07-07 — legacy policy premiums silently reset to $0.00 after ad-hoc creation

Symptom: 7 Legacy Individual policies created for real Falakhe clients (FLK00363–FLK00369) via
a one-off data-entry script showed `premium_amount: "0.00"` when checked shortly after creation,
despite the script inserting the correct premiums (250 ZAR, 11 USD, 290 ZAR, 8 USD, 20 USD,
20 USD, 8 USD).

Root cause: `recalculatePolicyPremiumIfNeeded()` (`server/routes.ts`, fires on every policies-list
view) recomputes `premiumAmount` from the product's own catalog pricing *unless*
`policy.premiumOverride` is set. LEGIND/LEGGRP always price at $0 from their own catalog — the
real premium only exists because a human typed it in. The real `POST /api/policies` route knows
this and sets both `premiumAmount` **and** `premiumOverride` (+`premiumOverrideNote`) for these
two product codes specifically. The ad-hoc script replicated the rest of the creation/activation/
payment flow faithfully but only set `premiumAmount`, so the very next policies-list view (by
Falakhe staff, minutes later) zeroed all 7 premiums out — the same failure mode already called
out in a comment on `recalculatePolicyPremiumIfNeeded` referencing a prior incident.

Diagnosis took three increasingly faithful isolated reproductions (single create+activate,
full payment flow, 3-record loop) that all succeeded with no corruption, ruling out the script's
own transaction logic before a broad grep for `premiumAmount` writes surfaced the real culprit.

Fix: ran a follow-up script calling `storage.updatePolicy(id, { premiumAmount, premiumOverride,
premiumOverrideNote: "Legacy custom premium set at issuance" }, orgId)` for all 7 policies.
Re-verified by direct query — all 7 now carry matching `premium_amount`/`premium_override`.
Payment transactions and receipts (already inserted correctly in the original run) were
unaffected, since that bug only touches the `policies` row.

- **Files:** none (data-only incident; no application code changed — the bug was in a throwaway
  script, not in `server/routes.ts`, which was already correct).
- **Verification:** direct SQL query against Falakhe's dedicated DB confirming
  `premium_amount = premium_override` for all 7 policies, matching intended values.
- **Lesson for next time:** any script that creates a LEGIND/LEGGRP policy outside the real
  `POST /api/policies` route (data backfills, migrations, support scripts) MUST set
  `premiumOverride` (+`premiumOverrideNote`) alongside `premiumAmount`, not just `premiumAmount`
  — grep `server/routes.ts` for `isCustomPremiumProduct` to see the exact fields the real route
  sets before writing a replacement script. `createPolicyWithInitialSetup()` itself does not
  protect against this; it inserts exactly what it's given.

---

## 2026-07-07 — bug/edge-case sweep of the same-day requisition/cost-sheet/mileage linking

Found by deliberately re-reviewing the linking features just built (requisitions <-> funeral
cases, cost sheets <-> requisitions, vehicle trip logs) for correctness gaps, not from a user
report. All six are fixed.

1. **Unpaid/rejected requisitions could be linked into a cost sheet as an "actual" cost.** The
   picker showed every requisition regardless of status, and the backend never checked it either
   — a draft or rejected requisition (no real cash spent) could inflate the per-case profit/loss
   report as if it were a real cost. Fixed: picker now only lists `status === "paid"` requisitions
   (`client/src/pages/staff/pricebook.tsx`); backend rejects linking anything else with a clear
   422 (`server/routes.ts`).
2. **The same requisition could be linked into two different cost-sheet lines**, double-counting
   one real expense in the profit/loss total. Fixed: picker excludes requisitions already used on
   the open sheet; backend added `getCostLineItemByRequisitionId` and rejects a second link
   org-wide with a 409.
3. **Editing `amount` on an already fully-paid requisition (platform-owner correction) left
   `amountPaid` stale**, making a fully-paid historical entry display as "partial" against its
   new amount. Fixed: the edit path now syncs `amountPaid` to the new amount when the requisition
   was previously fully paid (not touched for genuine partial-payment history).
4. **Deleting a requisition still linked to a cost-sheet line item raised a bare 500** (Postgres
   FK violation code 23503) instead of a clear message. Fixed: caught specifically and returned a
   409 telling the user to unlink it first.
5. **TOCTOU race on "Start Trip"**: the app-level "is there already an open trip for this
   vehicle+case" check had a window between two rapid clicks/requests where both could pass the
   check and insert. Fixed: added a partial unique index (migration 0062,
   `vtl_one_open_per_vehicle_case_idx` on `(vehicle_id, funeral_case_id) WHERE end_odometer IS
   NULL`) as the real guard, with the route translating the resulting 23505 into the same
   friendly 409 the app-level check already returned.
6. **Reassigning a case's removal/burial vehicle mid-workflow could orphan an open trip log** —
   the Vehicle Trips UI only rendered rows for the *currently* assigned vehicles, so a trip
   started under a vehicle that was later swapped off the case became invisible, yet still
   counted as "open" by the case-completion gate — permanently blocking completion with no way
   to see or close the offending trip. Fixed: the UI now also lists any trip whose vehicle no
   longer matches the case's current assignment, labeled "Reassigned Vehicle," still closeable.
- **Files:** `client/src/pages/staff/pricebook.tsx`, `client/src/pages/staff/funerals.tsx`,
  `server/routes.ts`, `server/storage.ts`, `migrations/0062_vehicle_trip_one_open_per_vehicle_case.sql`.
- **Verification:** typecheck + full test suite (179/179) green after each fix.
- **Lesson for next time:** when a new feature links table A to table B for a downstream report
  (here: profit/loss), check both directions of staleness — can B change status *after* linking
  (unpaid → never paid, or paid → edited) in a way the report doesn't notice, and can the same B
  row be linked from two different A rows. Both are easy to miss because the happy-path linking
  flow looks correct in isolation.

---

## 2026-07-07 — requisitions showing "Unknown" requester for the platform owner on a dedicated-DB tenant

- **Symptom:** user reported requisitions paid "yesterday" by Augustus (the platform owner)
  showed no name for who requested/paid them, on Falakhe (an isolated-DB tenant).
- **Root cause:** `storage.getUsersByIds(ids)` always queried the shared registry DB (`db`),
  never the tenant's own DB. For a dedicated-DB tenant, the platform owner's `requisitions.requested_by`
  / `paid_by` value is his **tenant-local mirrored id** (created by `resolveOrSyncTenantUserId` —
  see earlier entries in this log on the same registry/tenant id-mismatch bug class), which only
  exists in Falakhe's own database, not the shared registry. `getUsersByIds` found zero rows for
  that id and every caller fell back to `"Unknown"`.
- **Fix:** `getUsersByIds(ids, organizationId?)` now looks in the tenant DB first (via
  `getDbForOrg`) when an orgId is passed, then fills in any still-missing ids from the registry.
  For shared-DB orgs this is a no-op (their tenant DB *is* the registry DB). Updated all 7 call
  sites in `server/routes.ts` (requisition PDF, payment voucher PDF, requisition list, payment
  disbursements list, bank deposits list, cash position, admin cash position) to pass `organizationId`.
- **Files:** `server/storage.ts`, `server/routes.ts`.
- **Verification:** direct before/after check against Falakhe's real data — without orgId, 0
  users found for Augustus's tenant-mirrored id; with orgId, resolves to "Augustus Siziba".
  Typecheck + full test suite (179/179) green.
- **Lesson for next time:** any `getUsersByIds`-style helper that's org-agnostic will silently
  break the moment it's called with an id from a dedicated-DB tenant's local mirror — this is the
  same root cause class as the earlier registry/tenant user-id mismatch bugs in this log, just
  surfacing through a *display* path (name lookup) instead of a *write* path (FK violation). When
  auditing for this bug class, check read paths too, not just inserts/updates.

---

## 2026-07-07 — codebase-wide audit (architecture, ACID, edge cases, PayNow)

### Edge case: "yearly"-scheduled policies computed a $0 base premium and a 12x-undercharged surcharge

- **Symptom:** not yet reported — no Falakhe policy currently uses anything but `monthly`
  (checked live: 229/229 policies are monthly), so this has zero current production impact, but
  it's a real, confirmed bug that would bite the moment any tenant used yearly billing.
- **Root cause, two bugs in `computePolicyPremium()` / `monthlyToScheduleFactor()`
  (`server/route-helpers.ts`):**
  1. The base-premium calculation only handled `"monthly"`, `"weekly"`, `"biweekly"` — any other
     schedule (including `"yearly"`, the value actually used elsewhere, e.g. `cycleDays()` in
     `policy-status-on-payment.ts`) left `base` at its initial value of `0`.
  2. `monthlyToScheduleFactor()` (used for the extra-dependent surcharge) checked for
     `"annually"` — a string that appears nowhere else as a real schedule value — instead of
     `"yearly"`. So a yearly policy's surcharge silently used the factor-of-1 default (i.e.
     computed as if monthly), undercharging by 12x on top of the missing base.
  Also `product_versions` has no dedicated yearly/quarterly premium field at all (only
  monthly/weekly/biweekly), confirming yearly pricing was never fully wired up end-to-end.
- **Fix:** `monthlyToScheduleFactor` now matches `"yearly"` (keeping `"annually"` too, harmlessly,
  in case anything else ever used that spelling). Base premium calculation now falls back to
  `monthly rate × monthlyToScheduleFactor(schedule)` for any schedule without a dedicated field,
  instead of silently leaving `base = 0`.
- **Files:** `server/route-helpers.ts`.
- **Verification:** Confirmed via live query that no current policy is exposed to this (100%
  monthly). Typecheck + full test suite (179/179, including premium-calculation.test.ts) green.
- **Lesson for next time:** when a schedule/enum-like string is checked in multiple files, grep
  for every literal string used for that concept across the codebase before trusting any single
  file's spelling — `"yearly"` vs `"annually"` for the same concept in two files is exactly the
  kind of thing that looks like it works (both branches return a sensible-looking number) but
  silently computes the wrong one.

### ACID: group PayNow payment intent + allocations created as two separate, non-atomic writes

- **Symptom:** not yet reported. A crash between creating a group payment intent and creating
  its allocations would leave an intent with zero allocations — `applyGroupPaymentToPolicies`
  bails out on an empty allocation list (`"No allocations"`), so if Paynow later reported that
  intent as paid, there would be no way to ever apply the payment to any policy. Money collected,
  nothing credited.
- **Fix:** wrapped `POST /api/group-payment-intents`'s intent creation, allocation computation,
  and allocation insert in one `withOrgTransaction`, writing directly via `txDb` instead of the
  two separate `storage.createGroupPaymentIntent`/`storage.createGroupPaymentAllocations` calls
  (same defeated-transaction shape as the other ACID entries in this log).
- **Files:** `server/routes.ts`.
- **Verification:** Typecheck + full test suite (179/179) green. The proportional-allocation-
  with-remainder-correction math itself was already correct (verified by reading it) — only the
  atomicity of persisting it was the bug.

### Registry/tenant user-id mismatch: scoped the blast radius, then swept the highest-value remaining sites

- **Context:** earlier entries in this log fixed this bug (registry user id ≠ tenant-db user id
  for isolated-tenant orgs) on a handful of routes as they were hit, and flagged "not audited
  codebase-wide" as an open item. Before sweeping further, checked how many real users can
  actually hit this: queried Falakhe's 33 registry-linked staff accounts against the tenant DB —
  **zero** mismatches. The mismatch only exists for the **platform owner**, whose registry
  `organization_id` is `NULL` (they don't belong to any org row directly — they switch into
  tenants). So this bug is not "any staff member, any time" — it's specifically "the platform
  owner, when acting inside a tenant they've switched into."
- **New finding, higher severity than previously known:** `cashups.prepared_by` is **NOT NULL**.
  `POST /api/cashups` inserted `preparedBy: user.id` directly — for the platform owner this is
  the exact same FK-violation crash as the original requisition bug, just not yet reported.
  Fixed with `resolveOrSyncTenantUserId` (guarantees a valid, non-null id) rather than the
  nullable-column helper.
- **Related bug this surfaced:** once `preparedBy` is correctly stored as the *resolved tenant
  id*, every ownership check comparing `cashup.preparedBy !== user.id` (view-own-cashup, submit,
  list-filter-by-self) would wrongly deny the platform owner access to their own cashups, because
  the comparison used the raw registry id. Fixed all three comparison sites to resolve the same
  way before comparing.
- **Also fixed (nullable columns, `resolveUserIdForOrgDatabase`):** approval resolve
  (`approved_by`), payment-receipt approve/reject (`approved_by_user_id` — reused the already-
  resolved `recordedBy` from the same transaction instead of a second lookup), attendance
  approve/reject (`approved_by`), settlement approve (`approved_by`).
- **Gap in an earlier fix, closed:** the claim-creation ACID fix (previous entry) resolved the
  user id for the status-history row but missed that the claim's own `submitted_by` field was
  still built from raw `user.id` one line above it — fixed to use the same resolved id.
- **Files:** `server/routes.ts`.
- **Verification:** Typecheck + full test suite (179/179) green.
- **Lesson for next time:** when a column this bug affects is used for both a **write** and a
  **read-side ownership comparison** (`row.field !== user.id`), fixing only the write half-fixes
  it — the comparison must resolve the same way or it silently inverts into a new bug (denying
  the very user who owns the row). Also: before assuming a known bug pattern needs a full
  codebase sweep, check how many real accounts can actually trigger it — it changes whether
  "fix everything" or "fix the highest-traffic remaining sites" is the right amount of effort.
  Remaining un-swept sites (mortuary dispatch, quotation `createdBy`, balance-sheet
  `enteredByUserId`/`verifiedByUserId`, payroll run `preparedBy`): lower priority since they're
  narrower workflows less likely to be personally exercised by the platform owner — fix
  opportunistically if one of them throws.

### Security: Paynow merchant credentials stored as plaintext on the shared, multi-tenant DB

- **Context:** surfaced while diagnosing a live Paynow failure for Falakhe (see the same-day
  incident: Falakhe's Paynow account was stuck in test mode on Paynow's own servers — an
  external, account-activation issue, not a code bug). While investigating, confirmed
  `organizations.paynow_integration_key` (and every tenant's Paynow credentials) was plaintext
  on the **shared** registry database that every tenant's rows live in — a DB-level compromise or
  an over-privileged query on any one tenant's data would have exposed every other tenant's live
  payment-gateway credentials. A separate control-plane DB and an AES-256-GCM encryption key
  (`TENANT_CONFIG_ENCRYPTION_KEY`) already existed (fully provisioned) but were never wired into
  any application code — `tenant_integrations` had zero references outside its schema file.
- **Fix:**
  1. `server/tenant-config-crypto.ts` (new) — AES-256-GCM `encryptSecret`/`decryptSecret`/
     `encryptFields`/`decryptFields`, 12-byte IV, auth-tag tamper detection.
  2. `server/paynow-config.ts`'s `getOrgPaynowConfig()` now reads `control_plane.tenant_integrations`
     (provider `"paynow"`) first, decrypting `integrationKey`, and only falls back to the legacy
     `organizations.paynow_*` columns for an org not yet migrated (or if the control-plane query
     itself fails — logged, not silently swallowed). New `upsertOrgPaynowConfig()` writes there.
  3. `PATCH /api/organizations/:id` (`server/routes.ts`) now routes the six `paynow*` fields to
     `upsertOrgPaynowConfig()` instead of the shared `organizations` table, and the audit-log
     before/after snapshots for this route now strip `paynowIntegrationKey` so the plaintext key
     never lands in `audit_logs` either (a second, smaller instance of the same class of leak).
  4. `scripts/migrate-paynow-config-to-control-plane.mjs` (new, `--apply`/`--null-legacy` flags,
     dry-run by default) — moved Falakhe's existing plaintext config into an encrypted
     `tenant_integrations` row, verified the round-trip decrypts to the exact original key, then
     nulled `organizations.paynow_*` for Falakhe. Zero other orgs had Paynow configured yet.
- **Files:** `server/tenant-config-crypto.ts` (new), `server/paynow-config.ts`, `server/routes.ts`,
  `scripts/migrate-paynow-config-to-control-plane.mjs` (new).
- **Verification:** live round-trip check — after nulling Falakhe's legacy columns,
  `getOrgPaynowConfig(FALAKHE_ORG_ID)` still resolved the exact original `integrationId`,
  decrypted `integrationKey`, and `mode: "live"` purely from the control plane. Typecheck + full
  test suite (179/179, after adding `vi.mock("../../server/control-plane-db", ...)` to
  `payment-service.test.ts`/`paynow-hash.test.ts`, which now transitively import it) green.
- **Lesson for next time:** "we already built the secure infrastructure" and "the app actually
  uses it" are different claims — grep for real references (not just the schema/type definition)
  before assuming a security control is live. Also: when nulling out a legacy plaintext copy of a
  secret after migrating it, verify the *decrypted* new copy equals the *original* plaintext in
  the same script run, right before the null — don't trust "the insert succeeded" as proof the
  encrypted value is recoverable.

### Data drift: control_plane.tenant_branding never received writes, so the platform dashboard showed stale/empty branding

- **Symptom:** not directly reported, found during the same-day secrets audit. `GET
  /api/organizations` (platform-owner path) and `GET /api/platform/dashboard` both read
  branding (logo, colors, contact info, `isWhitelabeled`) from `control_plane.tenant_branding`,
  but `PATCH /api/organizations/:id` only ever wrote branding fields to the shared
  `organizations` table. Every org's `tenant_branding` row was either missing entirely or frozen
  at whatever it was during initial (manual) tenant setup — any branding change made through the
  app since then was invisible to the platform dashboard.
- **Root cause:** two different tables were each treated as "the" source for the same data by
  different read paths, and only one of them (`organizations`) ever got written to.
  `organizations` remains correct as the source of truth the live app actually uses (PDFs,
  receipts, `useBranding()`) — the bug was that the dashboard's mirror was never kept current.
- **Fix:** `PATCH /api/organizations/:id` (`server/routes.ts`) now mirrors every branding field
  write (`logoUrl`, `signatureUrl`, `primaryColor`, `footerText`, `address`, `phone`, `email`,
  `website`, `policyNumberPrefix`, `policyNumberPadding`, `isWhitelabeled`) into
  `control_plane.tenant_branding` (upsert) immediately after writing `organizations`.
  `scripts/backfill-tenant-branding.mjs` (new, idempotent) synced the *current* state for all 7
  existing orgs, since the drift already existed and waiting for the next edit per org wasn't
  good enough.
- **Files:** `server/routes.ts`, `scripts/backfill-tenant-branding.mjs` (new).
- **Verification:** backfill ran clean (7 inserted, 0 skipped — every org already had the
  control-plane `tenants` row needed for the FK). Typecheck + full test suite (179/179) green.
- **Lesson for next time:** when two tables (or a table and a mirror/cache) can answer "what's
  this tenant's branding," check whether *every* write path updates *every* read path's source —
  a read/write path pair that looks symmetric (both reference "branding") can silently diverge if
  one was added later and nobody wired the write side for it.

### Feature: trial-mode orgs on the shared DB, admin-driven dedicated-DB commissioning

- **Confirmed (not a bug, but worth recording):** `getPoolForOrg()` (`server/tenant-db.ts`)
  already defaults any org with no `control_plane.tenant_databases` row — or a null
  `databaseUrl` there — to the shared `DATABASE_URL` pool. Since new orgs get a
  `control_plane.tenants` row (task #20) but never a `tenant_databases` row, "trial-mode orgs
  use the shared platform DB" was already true by construction; nothing needed changing there.
- **Built:** `script/commission-tenant-db.ts` (new, `tsx`, wired as `npm run db:commission-tenant`)
  — the generalized, any-org version of the one-off Falakhe migration
  (`script/migrate-supabase-to-do.ts` + `script/cp-set-tenant-db.ts`). Takes `TENANT_ID` +
  `TENANT_DB_URL` (an admin manually provisions the destination Postgres DB first — this is a
  supervised workflow, not automated provisioning), builds the destination schema by calling the
  app's own migration runner (`applyPendingMigrations`), copies the org's rows table-by-table in
  FK-dependency order, verifies row counts, then flips `control_plane.tenant_databases` routing.
  Refuses to run if the tenant already has a dedicated DB registered (checked up front). Supports
  `--dry-run` (counts only, writes nothing) and `--activate` (bumps `licenseStatus` to `"active"`
  after a verified cutover).
- **Files:** `script/commission-tenant-db.ts` (new), `package.json` (new npm script).
- **Verification:** `--dry-run` against Falakhe's real org id correctly refused (already has a
  dedicated DB). `--dry-run` against a real trial-mode org (Shego Funeral Group, using the shared
  DB as a stand-in destination) ran every table query across all 9 dependency layers with no SQL
  errors and matching row counts — validates the full table list and FK-ordering against the real
  schema, without copying or mutating anything. Typecheck + full test suite (179/179) green.
- **Lesson for next time:** the copy-table list in `migrate-supabase-to-do.ts` was already stale
  against `shared/schema.ts` (missing ~30 tables added since, e.g. mortuary intake/dispatch,
  requisitions, bank reconciliation, funeral quotations) — when generalizing a one-off migration
  script, diff its hardcoded table list against `information_schema.columns` for
  `organization_id` first, don't assume the original list is still complete.

### ACID: 6 routes updated an entity's status and wrote its status-history row as two separate, non-atomic writes (one case: mixed-connection transaction that wasn't really atomic at all)

- **Symptom:** not yet reported, found during audit. A crash/DB blip between the two writes
  leaves an entity (claim/policy) at its new status with **no record** of who/when/why changed
  it — or, in the worst case found, a phantom history row for a change that got rolled back.
- **Root cause, three distinct variants of the same underlying mistake:**
  1. **No transaction at all** — `POST /api/claims/:id/transition` and
     `POST /api/policies/:id/transition` called `storage.updateX(...)` then
     `storage.createXStatusHistory(...)` as two plain sequential calls.
  2. **`withOrgTransaction` called but the callback ignored the `txDb` it was given** —
     `POST /api/claims` built a claim number, inserted the claim, and inserted its status
     history all via `storage.*` helpers inside a `withOrgTransaction(...)` block whose callback
     took no parameter at all. Every one of those `storage.*` calls opens its **own** connection
     via `getDbForOrg()`, so the surrounding transaction provided zero actual atomicity — pure
     decoration. `POST /api/client-auth/claims` (the client-portal equivalent) had the same
     three writes with no transaction wrapper at all.
  3. **Transaction real, but one write inside it used a `storage.*` helper anyway** —
     `POST /api/waivers/:id/resolve` correctly used `txDb` for the waiver + policy updates, but
     the policy-status-history insert still went through `storage.createPolicyStatusHistory()`,
     which opens its own connection and would commit **outside** the transaction — so a later
     rollback in that same callback would leave an orphaned history row behind instead of
     rolling back cleanly.
  All six sites also passed the acting user's raw `user.id` into a `users.id`-referencing
  column, the same registry/tenant id-mismatch risk documented in earlier entries below.
- **Fix:** rewrote all six to do every write directly against the transaction's `txDb` (no
  `storage.*` helper calls inside a transaction callback — `storage.generateClaimNumber` etc.
  each open their own connection and must never be called from inside one), and resolved the
  acting user id via `resolveOrSyncTenantUserId`/`resolveUserIdForOrgDatabase` (matching the
  column's nullability) before using it.
- **Files:** `server/routes.ts` (claim transition, policy transition, waiver resolve, claim
  creation, legacy-policy auto-activation on create), `server/client-auth.ts` (client-portal
  claim creation).
- **Verification:** Typecheck + full test suite (179/179) green after each fix.
- **Lesson for next time:** `withOrgTransaction(orgId, async (txDb) => {...})` only provides
  atomicity for statements that actually run on `txDb`. If the callback calls a `storage.*`
  method instead of `txDb.insert/update/select`, that write runs on a **different** connection
  and is not part of the transaction — grep for `storage\.` calls inside any `withOrgTransaction`
  callback as a smell; every one of them is a candidate for silently defeating the transaction
  around it. This is a repeat of the same defeated-transaction shape documented in the June 2026
  audit's clawback-rollback fix — it keeps recurring because it's an easy mistake to make when a
  `storage.*` helper already exists and looks like the "normal" way to do the write.

### PayNow: status polling verified against the wrong hash key for any tenant with its own dedicated integration

- **Symptom (inferred, not directly reported):** for an org with its own PayNow merchant
  account (integration ID/key stored on `organizations`, e.g. Falakhe — ID 25145, live mode),
  the client-facing "check my payment status" polling would never confirm a payment — it
  would keep returning "Verifying payment with gateway..." indefinitely. Plausibly connects to
  a previously-noted, previously-unexplained observation: two of Falakhe's payment intents
  (`96740ab6`, `fe51eae6`) were stuck in `status: 'failed'` with no clear cause.
- **Root cause:** `pollPaynowStatus()` and `pollGroupPaynowStatus()` in `server/payment-service.ts`
  called `verifyPaynowHash(fields)` with **no second argument**. `verifyPaynowHash`'s signature
  is `(fields, integrationKey?)` — when the key is omitted, it falls back to
  `getPaynowIntegrationKey()`, which reads **only** `process.env.PAYNOW_INTEGRATION_KEY` (the
  platform-level default), never the per-org key stored in `organizations.paynow_integration_key`.
  Every other Paynow-hash call site in the file (`handlePaynowResult`'s webhook, and the two
  `generatePaynowHash` calls for outbound requests) correctly resolves and passes the org-specific
  key via `getOrgPaynowConfig(orgId)` — only the two poll functions missed it. Confirmed live:
  Falakhe's `organizations` row has its own distinct `paynow_integration_id`/key in `live` mode,
  separate from the platform's env-var credentials, so polling for Falakhe was verifying against
  the wrong key on every call and always failing.
- **Fix:** both poll functions now call `getOrgPaynowConfig(orgId)` first and pass
  `config.integrationKey` into `verifyPaynowHash`.
- **Files:** `server/payment-service.ts`.
- **Verification:** Confirmed live that Falakhe's org row has a distinct integration ID/key from
  the platform env vars (so the bug was real, not theoretical). Typecheck + full test suite
  (179/179) green after the fix.
- **Lesson for next time:** in a multi-tenant integration with per-org credentials, **every**
  call to a hash/signature verification helper must be checked for whether it received the
  tenant-specific key — a helper with an "optional key, falls back to platform default" signature
  is exactly the shape that lets one call site quietly regress to single-tenant behavior. Grep for
  all call sites of `verifyPaynowHash`/`generatePaynowHash` (or any per-tenant-secret function)
  whenever touching Paynow code, not just the one you're editing.

### PayNow: 4 of 5 outbound HTTP calls had no timeout

- **Symptom:** not yet reported, found during audit. A slow/unresponsive Paynow endpoint (init,
  O'Mari OTP submit, or group init) would hang the awaiting request indefinitely — only
  `pollPaynowStatus`'s fetch had `AbortSignal.timeout(8000)`.
- **Fix:** added `AbortSignal.timeout(...)` to all remaining outbound fetches in
  `server/payment-service.ts` — 15s for user-initiated actions (initiate, OTP submit, group
  initiate), 8s for polls (matching the existing convention).
- **Files:** `server/payment-service.ts`.
- **Lesson for next time:** any new outbound HTTP call to an external gateway needs a timeout
  from the moment it's written — it's easy for this to get added to one call site (usually
  whichever one broke in production first) and never propagated to its siblings.

---

## 2026-07-06

### -3. PDF export: trailing blank pages, one per real page

- **Symptom:** Downloaded/previewed PDFs (Daily Report, Income Statement, Cash Flow) had extra
  blank pages appended after the real content — e.g. a 3-page report came out as 6 pages, pages
  4–6 each blank except for a lone footer line floating mid-page.
- **Root cause:** The footer-drawing loop in `finish()` (`server/financial-statement-pdf.ts`)
  drew the "Page X of Y" text at `y = A4_H - M + 6` — a y-coordinate **past** `doc.page.height -
  doc.page.margins.bottom`. PDFKit treats any `.text()` call that would land past that boundary
  as content that "doesn't fit," and silently calls `.addPage()` to continue the text there
  instead of drawing it on the current page. So every one of the 3 real pages triggered one
  extra phantom page purely to hold its own footer.
- **Fix:** Temporarily zero out `doc.page.margins.bottom` for the two footer `.text()` calls
  (restoring it immediately after) — draws inside the bottom margin band without PDFKit
  interpreting it as an overflow needing a new page.
- **Verification:** Rendered the actual PDF (not just checked byte size) before and after —
  before: 6 pages, 3 of them blank with a stray footer line. After: exactly 3 pages, each with
  real content and its own correctly-placed footer. A crude regex-based page-count check
  (`/Count N` in the raw PDF bytes) had earlier given a **false positive** of "already correct"
  — it was matching an unrelated `/Count` elsewhere in the file. `doc.bufferedPageRange().count`
  compared against a manual page counter is the only reliable page-count check for PDFKit.
- **Lesson for next time:** any manual `.text()` call meant to sit inside a PDFKit document's
  margin area (footers, watermarks, page numbers) must temporarily zero the relevant margin
  first — PDFKit's automatic pagination doesn't know "this text is decorative, don't overflow
  onto a new page for it." And never trust a regex over raw PDF bytes to answer "how many pages
  does this have" — use `bufferedPageRange()`.

### -2. PDF export: table cells overlapping/wrapping despite `lineBreak: false`

- **Symptom:** Long ledger/description cells (e.g. "Premium — FLK00359 (PENINA BHEBHE)") visibly
  wrapped onto a second line and overlapped the row below, even though the table renderer passed
  `lineBreak: false` to every cell's `.text()` call — which, in an isolated reproduction with the
  same font/width/text, correctly did NOT wrap. It only wrapped inside the real, much longer
  document (many prior `.text()`/`.rect()` calls, multiple pages).
- **Root cause:** Not fully root-caused (a PDFKit state quirk under a long real document that an
  isolated minimal repro didn't reproduce) — rather than keep chasing it, fixed it by removing
  the precondition for the bug to matter at all.
- **Fix:** Added `fitText(doc, text, maxWidth)` — measures the string against the document's
  *current* font/size via `doc.widthOfString()` and truncates with an ellipsis if it's wider than
  the column. Applied to every table cell (`drawTable`'s header row and data rows) in
  `server/financial-statement-pdf.ts`, so a cell can never overflow or wrap regardless of
  whatever is causing `lineBreak: false` to be unreliable in a long document.
- **Files:** `server/financial-statement-pdf.ts`.
- **Lesson for next time:** don't rely on a PDFKit text-fitting option ("it worked in my
  isolated test") when the real render is a long, multi-page document — measure-and-truncate
  yourself (`widthOfString` + ellipsis) is the only guarantee that survives whatever PDFKit's
  internal state does after hundreds of prior draw calls.

### -1. Daily Report showed 0 for premiums (data drift, not a display bug) and Legacy Individual policies can't actually get a custom premium via the real UI

- **Symptom:** The Daily Report's "Policies activated" list showed `USD 0.00` for 5 legacy
  individual policies created earlier the same day, even though they were created with real
  custom premiums (13, 8, 140, 30, 20).
- **Root cause (two layered bugs):**
  1. `recalculatePolicyPremiumIfNeeded()` in `server/routes.ts` (called on every policy list/detail
     fetch) recomputes `premiumAmount` from the product's own pricing via `computePolicyPremium`
     and overwrites the DB row whenever the computed value differs from what's stored — with
     **no check for `premiumOverride`**. For LEGIND/LEGGRP ("Legacy Individual"/"Legacy Group"),
     whose whole point is a manually-agreed premium, the product's own price is 0, so the very
     first time anyone loaded the policy list after creation, their real premium got silently
     zeroed.
  2. Worse: this isn't just a recompute-drift bug — `POST /api/policies` (the real issuance route)
     **always** overwrites `req.body.premiumAmount` with `computePolicyPremium(...)` before
     insert, discarding whatever premium the staff member actually typed in the create form. For
     a normal product this is intentional (system-priced premium), but it means the "Legacy
     Individual/Group: premium always entered manually at issuance" feature built earlier this
     session never actually worked end-to-end through the real UI — only a one-off direct-DB
     script (used to batch-create these 5 policies) bypassed this and set `premiumAmount`
     directly, which is exactly what made them vulnerable to bug #1 the moment anyone viewed the
     policy list.
- **Fix:**
  - `recalculatePolicyPremiumIfNeeded`: now returns the policy unchanged if `premiumOverride` is
    set — a manual override is authoritative and must never be silently recomputed away.
  - `POST /api/policies`: captures the user-submitted premium before it's overwritten; if the
    issued product's code is `LEGIND`/`LEGGRP`, persists that value as **both** `premiumAmount`
    and `premiumOverride` (with a note), so it survives future recomputes.
  - `server/daily-report.ts`: `policiesActivated` now selects `premiumOverride` and displays
    `premiumOverride ?? premiumAmount` (the "effective premium"), matching the convention already
    used elsewhere in the app for legacy premium overrides.
  - Data remediation: directly restored `premiumAmount`/`premiumOverride` for the 5 affected
    policies (FLK00355–FLK00359) to their correct amounts.
- **Files:** `server/routes.ts`, `server/daily-report.ts`.
- **Verification:** Re-ran `buildDailyReport` live after the data fix — all 8 policies (5 fixed +
  2 pre-existing legacy + 1 unrelated) now show correct premiums. Full test suite green.
- **Lesson for next time:** a "custom premium" product/policy is only actually protected once
  `premiumOverride` is set — not `premiumAmount` alone. Any code path that writes a policy's
  premium at creation or via a script must set `premiumOverride`, or it will get silently
  overwritten the next time `recalculatePolicyPremiumIfNeeded` runs (which is on nearly every
  policy read). If a policy's premium mysteriously "resets," check `premiumOverride` first.

### 0. Recording a payment on a funeral case (and creating/editing quotations) threw "Internal Server Error" (and everything else) for an isolated-tenant org — silent, sticky tenant misrouting

- **Symptom:** The new Daily Report / income statement for Falakhe (an isolated-tenant-DB org)
  displayed 0 for premium receipts even though real receipts existed for that day. No error was
  shown anywhere — the page loaded "successfully" with wrong (empty) numbers.
- **Root cause:** `getPoolForOrg()` in `server/tenant-db.ts` resolves which database an org's data
  lives in by querying the control-plane `tenant_databases` table. If that query **throws** (a
  transient control-plane blip — timeout, brief outage, etc.), it falls back to reading
  `organizations.database_url` from the shared registry DB. For Falakhe (and likely other
  isolated-tenant orgs), that registry column is **empty** — the real tenant DB URL only exists in
  the control plane. So the fallback found no URL, and the code treated this as "this org has no
  dedicated database" and cached `defaultPool` (the shared registry DB) for that org **permanently**
  (`poolCache.set(orgId, defaultPool)`), not just for the failing request. Every subsequent request
  for Falakhe's data — for the lifetime of the server process — silently queried the shared DB,
  which has no rows for Falakhe's real operational data, returning empty/zero results with no error.
  A single transient control-plane hiccup, once triggered, poisoned the tenant routing until the
  next process restart.
- **Fix:** In `server/tenant-db.ts`, when the control-plane lookup throws (as opposed to
  succeeding and legitimately reporting "no dedicated DB configured"), the resulting `defaultPool`
  fallback is **no longer cached**. The failing request still gets a best-effort answer, but the
  *next* request retries the control-plane lookup fresh instead of being stuck. Also upgraded the
  log level from `warn` to `error` for control-plane failures (this is a serious, not routine,
  event) and added a matching `error` log if the shared-DB fallback query itself also fails.
- **Files:** `server/tenant-db.ts` (`getPoolForOrg`).
- **Verification:** Reproduced live — hit the exact "Control plane lookup failed" fallback path
  once from a transient connection blip while testing, then confirmed a fresh call to
  `buildDailyReport`/`buildIncomeStatement` immediately after returned correct, non-zero figures
  (matching previously-verified totals) rather than staying stuck on empty. Full test suite green.
- **Lesson for next time:** any "this org's data is showing as empty/zero but the org definitely
  has data" report on an isolated-tenant org should immediately raise suspicion of stale/wrong
  pool routing in `tenant-db.ts`'s in-memory `poolCache` — check the server logs for a "Control
  plane lookup failed" entry around when the symptom started. A process restart is the immediate
  workaround (clears the poisoned cache entry); this fix prevents the poisoning from happening
  in the first place. More generally: **never cache a fallback decision that was reached because
  the authoritative source failed** — only cache when the authoritative source was actually
  consulted successfully, even if its answer is "nothing configured."

### 0. Recording a payment on a funeral case (and creating/editing quotations) threw "Internal Server Error"

- **Symptom:** Recording a cash-service payment against an existing funeral case failed with a
  raw 500.
- **Root cause:** Exactly the same registry/tenant user-id mismatch class as entry #1 below,
  in a different set of routes: `POST /api/funeral-cases/:id/receipts` inserted
  `issuedByUserId: user.id` (the **registry** user id) directly into `service_receipts`, whose
  `issued_by_user_id` column has a FK to the **tenant** DB's `users.id`. For a Falakhe user whose
  registry id and tenant-DB id diverge (see entry #1), this violates
  `service_receipts_issued_by_user_id_users_id_fk` and crashes. Reproduced directly against the
  Falakhe DB: inserting a row with the registry id `bafebbe0-...` fails with exactly that FK
  violation; inserting with the resolved tenant id `2f92a3a9-...` succeeds.
  The same pattern existed in three sibling routes using `createdBy: user.id` against a
  FK'd `created_by` column: `POST /api/funeral-cases/:id/quotation` (case-linked quote upsert),
  `POST /api/quotations` (standalone quote create), `PATCH /api/quotations/:id` (standalone quote
  update).
- **Fix:** Added `const effectiveUserId = await resolveOrSyncTenantUserId(user.organizationId,
  user.id);` to all four routes and used `effectiveUserId` instead of `user.id` for the
  FK'd column.
- **Files:** `server/routes.ts` (funeral quotation upsert, service-receipt creation, standalone
  quotation create/patch).
- **Verification:** Reproduced the FK violation with a direct insert against the live Falakhe
  DB using the registry id, then confirmed an identical insert succeeds using the resolved
  tenant id; both test rows cleaned up afterward. Typecheck + full test suite (179/179) green.
- **Lesson for next time:** this is the exact "not yet audited" gap flagged as an open item after
  fixing the requisition version of this bug — `resolveOrSyncTenantUserId` was only applied to
  requisition/expenditure routes at first. **Any route on an isolated-tenant-DB org that inserts
  `user.id` directly into a column with `.references(() => users.id)` in `shared/schema.ts` is
  exposed to this**, not just requisitions. When a new "Internal Server Error" report comes in
  for a write route, grep the target table's schema for `.references(() => users.id)` columns
  first — if the route sets one of those columns to `user.id` directly instead of via
  `resolveOrSyncTenantUserId`, that's very likely the cause. A full codebase-wide sweep of all
  `user.id` write sites has still not been done (see Open Items).

### 1. Requisition creation threw "Internal Server Error"

- **Symptom:** Saving a new requisition failed with a raw 500, no useful message to the user.
- **Root cause (two layered bugs):**
  1. `POST /api/requisitions` called `insertRequisitionSchema.parse(...)` **before** the route's
     `try/catch`, so any Zod validation failure crashed uncaught instead of returning a clean 400.
  2. Even after fixing (1), the insert still failed — this time with a real Postgres error:
     `insert or update on table "requisitions" violates foreign key constraint
     "requisitions_requested_by_users_id_fk" ... Key (requested_by)=(...) is not present in
     table "users"`.
     The actual cause: for tenants with an isolated database (e.g. Falakhe), a user's **registry**
     id and **tenant-DB** id can diverge if that user's email already existed in the tenant DB
     under a different id before mirroring was introduced. The existing mirror logic
     (`upsertRegistryUserIntoTenantDb`) correctly refuses to silently overwrite a different
     account on email collision — but every route that used `user.id` directly for a NOT NULL
     FK column (like `requisitions.requested_by`) had no fallback, so it just crashed.
- **Fix:**
  - Moved the `.parse()` call inside the try/catch in `POST /api/requisitions`.
  - Added `resolveOrSyncTenantUserId(orgId, userId)` in `server/tenant-db.ts`: resolves the
    correct tenant-DB user id for a given registry user id — checks if the id already exists in
    the tenant DB, then checks by email, and only falls back to mirroring a brand-new row if
    neither exists.
  - Wired it into every requisition/expenditure write path that references a user id:
    `POST /api/requisitions`, `PATCH /api/requisitions/:id` (approve/pay), `POST
    /api/requisitions/:id/payments`, `POST /api/expenditures/:id/payments`.
- **Files:** `server/routes.ts`, `server/tenant-db.ts`.
- **Verification:** Reproduced the FK violation directly against the Falakhe tenant DB first,
  then confirmed requisition creation succeeded after the fix and that the tenant user row's
  `displayName` self-corrected.
- **Lesson for next time:** if a mutation on an isolated-tenant-DB org throws a **NOT NULL FK
  violation on a `users.id`-referencing column**, suspect a registry/tenant id mismatch before
  anything else. Search for other routes still passing `user.id` directly into an insert/update
  instead of going through `resolveOrSyncTenantUserId` first — this was fixed for
  requisitions/expenditures only, not audited across the whole codebase (see open item below).

### 2. Reports page: every tab except "Income Statement" redirected back to Finance

- **Symptom:** Clicking any Reports sub-tab other than Income Statement bounced the user back
  to the Finance page instead of showing the report.
- **Root cause:** A client-side race condition in `client/src/pages/staff/reports.tsx`. The
  section/report tabs were rendered as plain `<a href=...>` tags (full page reload) instead of
  wouter `<Link>` (client-side navigation). On top of that, a `useEffect` that "corrects" the
  URL search params ran using `permissions` from `useAuth()` — but `useAuth()` loads
  asynchronously, so on first render `permissions` was still empty, the effect concluded the
  requested tab wasn't visible/permitted, and rewrote the URL back to the default (Finance-ish)
  tab before the real permissions had even loaded.
- **Fix:**
  - Changed both tab `<a href>` blocks to `<Link href>` (wouter) so navigation doesn't reload
    the page.
  - Added `authLoading` (from `useAuth()`) as a guard: the tab-fallback `useMemo` and the
    URL-correcting `useEffect` both now bail out early while `authLoading` is true, so they
    never act on an incomplete permissions list.
- **Files:** `client/src/pages/staff/reports.tsx`.
- **Lesson for next time:** any `useEffect`/`useMemo` that redirects or rewrites state based on
  `useAuth().permissions` needs to check `isLoading` first — this is the second time this
  pattern has caused a bug this quarter (see also the debugging-patterns memory). Grep for
  `permissions` usage outside of render-gating (i.e., used to *decide navigation*) as a class of
  suspect code.

### 3. Requisition/expenditure "pay" actions were not atomic

- **Symptom:** Not a reported failure yet, but flagged during a "refine per best practice" pass:
  the pay-a-requisition and pay-an-expenditure code paths did a disbursement insert and a
  status update as two separate, non-transactional writes. A crash between the two would leave
  a requisition marked unpaid with a disbursement already recorded (or vice versa) — a real
  correctness risk under any concurrent failure.
- **Fix:** Wrapped the disbursement insert + requisition/expenditure status update in a single
  `withOrgTransaction(orgId, async (txDb) => {...})` block for: the `"pay"` action in `PATCH
  /api/requisitions/:id`, and both `POST /api/requisitions/:id/payments` and `POST
  /api/expenditures/:id/payments`. Added `generateVoucherNumberInTx(tx, orgId)` in
  `server/storage.ts` so voucher numbering could happen inside the same transaction (the
  existing `generateVoucherNumber` now just opens a tx-less db handle and delegates to it).
- **Files:** `server/routes.ts`, `server/storage.ts`.
- **Lesson for next time:** any route that writes to `payment_disbursements` **and** updates a
  requisition/expenditure/policy status in the same request must use `withOrgTransaction` with
  direct Drizzle table writes, not two separate `storage.*` calls — this is the established
  ACID pattern in this codebase (see `CLAUDE.md`).

### 4. No way to delete a mistaken requisition/expenditure

- **Symptom:** User found two requisitions (REQ-00024, REQ-00026) that had disbursements
  recorded but no matching real-world spend — there was no UI or endpoint to remove them.
- **Fix:** Added `DELETE /api/requisitions/:id` and `DELETE /api/expenditures/:id`, gated on new
  `delete:requisition` / `delete:expenditure` permissions (added to `SYSTEM_PERMISSIONS` and the
  `administrator` role in `server/constants.ts`). Each deletes the requisition/expenditure and
  its matching `payment_disbursements` rows atomically inside `withOrgTransaction`, and
  audit-logs the deleted disbursements as part of the "before" state. Added Trash2 delete
  buttons + `AlertDialog` confirmations in `client/src/pages/staff/finance.tsx`.
- **Files:** `server/routes.ts`, `server/constants.ts`, `client/src/pages/staff/finance.tsx`.
- **Not a bug fix, but a related process note:** always confirm what a requisition/expenditure
  deletion cascades into (`payment_disbursements`) before deleting — a delete that doesn't clean
  up its disbursement rows would silently corrupt the income statement (expenses would still
  show even though the requisition is gone).

### 5. Legacy-issuance relaxation only covered legacy *groups*, not legacy *individuals*

- **Context:** the system already had a way to capture "legacy group" clients (real people who
  joined before the system existed) with minimal details and a custom premium — but there was
  no equivalent for a legacy *individual* walking in to pay, and no product to attach them to.
- **Fix (feature work, not a bug fix):** created two new products (`LEGIND` "Legacy Individual",
  `LEGGRP` "Legacy Group" — via `scripts/create-legacy-products.mjs`, uncapped adult/child/extended
  member counts, premium always entered manually at issuance); extended the existing
  legacy-capture relaxation in `POST /api/clients` and `client/src/pages/staff/policies.tsx` to
  also trigger off these product codes (not just an existing `legacyGroupId`); added a capacity
  check in `POST /api/policies/:id/upgrade` so a policy can only convert to a single-person
  product (Yedwana) if it currently covers exactly one person.
- **Mistake caught mid-fix:** the first version of `scripts/create-legacy-products.mjs` tried to
  auto-resolve the tenant DB URL from the registry `organizations.database_url` column, which was
  empty for Falakhe (the real URL lives in the control-plane `tenant_databases` table) — it
  silently fell back to the shared registry DB and created both products there instead of in
  Falakhe's isolated tenant DB. Caught from the script's own log output before any real damage;
  cleaned up and rewrote the script to connect directly via `FALAKHE_DATABASE_URL`, the same
  proven pattern used by every other one-off script this session.
- **Files:** `server/routes.ts`, `client/src/pages/staff/policies.tsx`,
  `scripts/create-legacy-products.mjs`.
- **Lesson for next time:** never assume `organizations.database_url` is populated for an
  isolated tenant — the source of truth for a tenant's DB connection is the control-plane
  `tenant_databases` table (checked via `orgUsesDedicatedDatabase`/`getDbForOrg` in
  `server/tenant-db.ts`), not a column on the registry `organizations` row. Any new one-off
  script targeting a specific tenant's data should read the tenant DB URL from an explicit env
  var (e.g. `FALAKHE_DATABASE_URL`), not try to derive it.

### 6. No frontend for the notification system (bell/inbox)

- **Context:** the backend for personal in-app notifications was fully built (`GET
  /api/notifications`, `/unread-count`, `PATCH .../:id/read`, `PATCH .../mark-all-read`, and an
  SSE stream at `GET /api/notifications/stream`) but nothing in the frontend ever called any of
  it — no bell icon, no dropdown, no live updates.
- **Fix (feature work):** added `client/src/components/notification-bell.tsx` — a bell icon with
  an unread-count badge in the staff header (inserted immediately before the account-avatar
  dropdown in `client/src/components/layout/staff-layout.tsx`), backed by a `useQuery` on
  `/api/notifications` (with a 60s fallback poll), a `useEffect` opening an `EventSource` against
  `/api/notifications/stream` for live delivery (toasts new notifications + invalidates the
  query), and `useMutation`s for mark-read / mark-all-read.
- **Non-obvious wire detail:** the SSE endpoint sends plain `data: {...}\n\n` frames with no
  custom `event:` field, so the client must listen on `EventSource`'s default `message` event —
  not `addEventListener("notification", ...)`.
- **Files:** `client/src/components/notification-bell.tsx` (new),
  `client/src/components/layout/staff-layout.tsx`.

---

## Open items (known, not yet fixed — flagged to user, no action requested yet)

- **`settlementAllocations` table is defined but never populated anywhere in the codebase.**
  Recording and approving a platform-fee settlement currently does nothing to reduce
  "Outstanding" or increase "Total Settled" on the Platform Fees screen. Flagged to the user;
  they have not yet asked for this to be fixed.
- **`resolveOrSyncTenantUserId` has only been wired into requisition/expenditure routes and the
  funeral-quotation/service-receipt routes (entry #0).** A grep of `server/routes.ts` for
  `: user\.id[,)]` turns up 40+ more sites passing `user.id` straight into a mutation
  (`actorId`, `approvedBy`, `preparedBy`, `dispatchedByUserId`, `verifiedByUserId`,
  `enteredByUserId`, `initiatedBy`, etc.) — each one is a potential repeat of this exact bug if
  the target column has `.references(() => users.id)` in `shared/schema.ts` and the acting user's
  registry/tenant ids diverge. Not yet audited across the full route file; fix opportunistically
  as each one is hit (per entry #0's lesson), or do a full sweep if this keeps recurring.
- **`auditLog()` silently swallows its own DB errors** (by design, to avoid crashing a mutation
  over a logging failure) — which means the registry/tenant id mismatch in entry #1 has likely
  caused this user's actions to be silently missing from the audit trail in the past, with no
  error ever surfaced. Decided not to fix centrally: doing so would require adding a DB roundtrip
  to ~100+ `auditLog()` call sites, a real cost on a hot path, for a cosmetic (not
  correctness-affecting) gap.
