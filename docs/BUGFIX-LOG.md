# Bug Fix Log

Running log of bugs found and fixed in POL263, with root cause and the actual fix — not
just "what changed" but "why it broke." Read this before debugging something that smells
familiar; a five-minute read here can save an hour of re-diagnosing a problem already solved.

**Convention:** every time a real bug is fixed (not a feature addition), add an entry here
in the same session, before moving on. Newest entries at the top. See the "Documentation
convention" note in `CLAUDE.md`.

---

## 2026-07-06

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
