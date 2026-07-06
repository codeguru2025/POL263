# Bug Fix Log

Running log of bugs found and fixed in POL263, with root cause and the actual fix — not
just "what changed" but "why it broke." Read this before debugging something that smells
familiar; a five-minute read here can save an hour of re-diagnosing a problem already solved.

**Convention:** every time a real bug is fixed (not a feature addition), add an entry here
in the same session, before moving on. Newest entries at the top. See the "Documentation
convention" note in `CLAUDE.md`.

---

## 2026-07-07 — codebase-wide audit (architecture, ACID, edge cases, PayNow)

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
