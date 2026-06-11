# POL263 — World-Class Transformation Plan

> **Capstone document.** The source-of-truth maps already exist and are the foundation for everything
> here:
> - `docs/POL263-FUNCTIONAL-BLUEPRINT.md` — menus, routes, screens, permissions, workflows, entities, journeys (discovery).
> - `docs/POL263-DOMAIN-AND-NAVIGATION-BLUEPRINT.md` — domain model, entity hierarchy, language, task-based nav, screen classification, duplicates, IA.
>
> This document delivers the remaining mandate items: **quantified task matrix, navigation
> evaluation, wireframes, component architecture, design-system spec, and migration / feature-flag /
> testing / rollback strategies.**
>
> **No code is changed in this document** (mandate STEP 8 — code comes only after sign-off). Hard
> rule honoured: no API, schema, route, permission, workflow, integration, report, mobile, or tenant
> config is broken. This is an **access-path + presentation** transformation.

---

## Deliverables index (mandate's 17)
| # | Deliverable | Where |
|---|---|---|
| 1 | Current-state analysis | FUNCTIONAL-BLUEPRINT §0–§9 |
| 2 | Task matrix (quantified) | **This doc, Part B** |
| 3 | User journey analysis | FUNCTIONAL-BLUEPRINT §6 + this doc Part B |
| 4 | Screen inventory | FUNCTIONAL-BLUEPRINT §2 |
| 5 | Entity map | DOMAIN-BLUEPRINT Phase 2 |
| 6 | Workflow map | FUNCTIONAL-BLUEPRINT §4 |
| 7 | Navigation redesign | **This doc Part A** + DOMAIN-BLUEPRINT Phase 7 |
| 8 | Menu redesign | **This doc Part A** |
| 9 | Dashboard redesign | **This doc Part C** |
| 10 | Search redesign | **This doc Part F.3** |
| 11 | Command-center architecture | **This doc Part C** |
| 12 | Component architecture | **This doc Part E** |
| 13 | Design-system spec | **This doc Part F** |
| 14 | Migration roadmap | **This doc Part G** |
| 15 | Feature-flag strategy | **This doc Part H** |
| 16 | Testing strategy | **This doc Part I** |
| 17 | Rollback strategy | **This doc Part J** |

---

## PART A — Navigation Model: Evaluation & Final Recommendation

### A.1 Evaluating the mandate's proposed top-level model
The mandate proposes: **HOME · SALES · CLIENTS · POLICIES · COLLECTIONS · CLAIMS · FINANCE · REPORTS · SETUP** (9).
My earlier blueprint proposed 8 (it folded Clients under Policies).

**Verdict: adopt the mandate's 9-bucket model, with refinements.** Reasoning:
- POL263 is explicitly a **Burial Society Management System** among its pillars. Schemes, Dependents
  and Beneficiaries deserve a first-class home; burying them inside "Policies" hides a core pillar.
- A dedicated **CLIENTS** menu gives the party/society domain (the agent's & society head's world) a
  clear, nameable place — improving "find without training."
- Role-based visibility means no single role sees all 9; a **Cashier sees only 4–5** (Home,
  Collections, Clients, Policies, Reports). Top-level count is a non-issue per-persona.

Refinements I recommend over the raw proposal:
1. **Move "Renewals" out of Policies' submenu label** unless a renewals screen exists — today it does
   not (no renewals route). Keep the *concept* but don't advertise an unbuilt screen as a peer.
2. **"Products / Benefits" belong in SETUP** (configuration, monthly/rare), not in POLICIES (daily).
   Keeping product config out of the daily Policies menu protects the cashier/agent.
3. **"Settlements" lives in CLAIMS *and* is cross-linked in FINANCE** (it's the payout end of a claim
   but also a finance/approval action).

### A.2 Final top-level navigation (every existing screen/route preserved)

Legend: ✅ implemented · 🚧 `StaffComingSoon` stub (kept, placed, built later).

```
HOME            → /staff (role command center) ✅

SALES           (agent, manager, admin)
  ├ Leads / Pipeline        → /staff/leads ✅          [perm read:lead]
  ├ New Policy (entry)      → /staff/policies ✅        [write:policy]
  └ Public Registration     → /join/register ✅ (referral link)

CLIENTS         (cashier, agent, manager, admin)
  ├ Clients                 → /staff/clients ✅         [read:client]
  ├ Dependents/Beneficiaries→ /staff/clients (in-screen) ✅
  ├ Schemes (Employer/Society)→ /staff/groups ✅        [write:policy]
  ├ Society Admin           → /staff/admin/society 🚧
  └ Sub Groups              → /staff/admin/sub-groups 🚧

POLICIES        (cashier, agent, manager, admin)
  ├ Policies                → /staff/policies ✅         [read:policy]
  ├ Members (covered lives) → /staff/policies (in-screen) ✅
  └ Member Cards            → /staff/admin/member-cards 🚧

COLLECTIONS     (cashier ★, agent-mobile, finance, manager)
  ├ Receipt a Payment       → /staff/finance?tab=payments ✅   [read:finance|commission]
  ├ Mobile & Cash           → /staff/finance?tab=paynow ✅
  ├ Cash-up                 → /staff/finance?tab=cashups ✅
  ├ Group Receipt           → /staff/finance?tab=group-receipt ✅ [write:finance]
  ├ Month-End Close         → /staff/finance?tab=month-end ✅     [write:finance]
  ├ Allocations (unallocated)→ /staff/diagnostics (unallocated-payments) ✅
  ├ Debit Orders / Bank Deposits / Petty Cash → /staff/transactions/* 🚧
  └ Print Policy Cards      → /staff/tools/print-policy-cards 🚧

CLAIMS          (claims officer, fleet ops, manager)
  ├ Claims                  → /staff/claims ✅            [read:claim]
  ├ Funeral Cases           → /staff/funerals ✅          [read:funeral_ops]
  ├ Funeral Services/Pricing→ /staff/pricebook ✅         [read:product]
  ├ Settlements             → /staff/finance (settlements)✅ + Approvals
  ├ Online Claims Form      → /staff/tools/claims-form 🚧
  └ Transport Companies     → /staff/tools/transport-companies 🚧

FINANCE         (finance, admin, manager-approve)
  ├ Requisitions            → /staff/finance?tab=requisitions ✅ [read/write/approve:finance]
  ├ Expenses                → /staff/finance?tab=expenditures ✅
  ├ Commissions             → /staff/finance?tab=commissions ✅  [read:commission]
  ├ Payroll                 → /staff/payroll ✅                  [read/write:payroll]
  ├ FX Rates                → /staff/finance?tab=fx-rates ✅     [manage:settings]
  ├ Platform Fees (read)    → /staff/finance?tab=platform ✅
  ├ Approvals               → /staff/approvals ✅               [manage:approvals]
  └ Credit Notes / Invoices → /staff/transactions/* 🚧

REPORTS         (exec, manager, finance)
  ├ Operational/Policy      → /staff/reports?section=policies ✅ [read:report]
  ├ Financial/Statements    → /staff/reports?section=finance ✅
  ├ Dynamic Reports         → /staff/reports ✅
  ├ Employee Reports        → /staff/employee-reports ✅
  ├ Generic / Statistics / Graphs → 🚧
  └ System Issue Reports    → /staff/diagnostics ✅

SETUP           (administrator; some Platform-Owner-only)
  ├ Products                → /staff/products ✅          [write:product]
  ├ Pricing / Price Book    → /staff/pricebook ✅
  ├ Terms & Conditions      → /staff/settings ✅
  ├ Users                   → /staff/users ✅             [read:user]
  ├ Roles & Permissions     → /staff/settings (rbac) ✅
  ├ Branches                → /staff/admin/branches 🚧
  ├ Organization / Branding → /staff/settings ✅
  ├ Notifications / SMS     → /staff/notifications ✅      [read:notification]
  ├ Reminders               → /staff/reminders ✅
  ├ Order Services          → /staff/order-services ✅
  ├ Partners (Agents/Brokers/Underwriters/Undertakers/Terminals/Invoice Items) → /staff/admin/* 🚧
  ├ Security › Audit Trail  → /staff/audit ✅             [read:audit_log]
  ├ Security › Diagnostics  → /staff/diagnostics ✅
  ├ Asset Register          → /staff/tools/assets ✅
  ├ EasyPay                 → /staff/tools/easypay 🚧
  ├ Contacts                → /staff/tools/contacts 🚧
  ├ Platform › Tenants      → /staff/settings?tab=tenants ✅ (Owner) [create:tenant]
  ├ Platform › App Releases → (App release mgmt API) 🚧 (Owner)
  └ Help Centre             → /staff/help ✅
```

**Coverage check:** all 24 implemented screens + all 36 stub routes are placed. Nothing dropped.

### A.3 Role → top-level visibility
| Menu | Cashier | Agent | Claims | Fleet | Manager | Finance | Exec | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Home | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sales | | ✅ | | | ✅ | | | ✅ |
| Clients | ✅ | ✅(own) | ✅(read) | | ✅ | ✅(read) | ✅(read) | ✅ |
| Policies | ✅(read) | ✅(own) | ✅(read) | | ✅ | ✅(read) | ✅(read) | ✅ |
| Collections | ✅★ | ✅(mobile) | | | ✅ | ✅ | | ✅ |
| Claims | | | ✅ | ✅ | ✅ | | ✅(read) | ✅ |
| Finance | | ✅(commission) | | | ✅(approve) | ✅ | ✅(read) | ✅ |
| Reports | ✅(limited) | ✅(own) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Setup | | | | | ✅(users) | | | ✅ |
**Cashier sees 5 menus. Agent sees 6. Each persona's surface is small and predictable.**

---

## PART B — Quantified Task Matrix (Top 20 tasks)

> "Current clicks" = navigation depth on today's menu (dropdown open = 1, item = 1) **+** known
> in-screen steps to reach the action; estimates from the current `staff-layout.tsx` + page code.
> "Proposed clicks" assumes the new IA + Quick Action / Command Palette. Estimates, to be validated
> by click-testing (Part I).

| # | Role | Task | Freq | Current clicks | Current screens | Proposed clicks |
|---|---|---|---|--:|---|--:|
| 1 | Cashier | Receipt a cash payment | many/day | 5–7 | Dashboard→(menu)→Finance→Payments tab→find policy→pay | **1–2** (Quick Action "Receipt Payment" / `Ctrl-K`) |
| 2 | Cashier | Print/SMS receipt | many/day | 2–3 | after payment, locate action | **1** (auto-offered post-receipt) |
| 3 | Cashier | Check policy balance | many/day | 4 | menu→Policies→search→open | **1–2** (global search → policy) |
| 4 | Cashier | Daily cash-up | daily | 4 | menu→Finance→Cashups tab→new | **2** (Collections→Cash-up, or palette) |
| 5 | Cashier | Find client by phone | many/day | 4 | menu→Clients→search | **1** (global search) |
| 6 | Agent | Capture new lead | daily | 4 | menu→Transactions→Quotations→new | **1–2** (Quick Action "New Lead") |
| 7 | Agent | Convert lead → policy | daily | 6+ | Leads→open→…→Policies→new | **2–3** (lead → "Convert" CTA) |
| 8 | Agent | Create policy | daily | 5 | menu→Policies→new→wizard | **2** (Quick Action "New Policy" wizard) |
| 9 | Agent | Take mobile payment | daily | 5 | menu→Finance→Paynow tab | **1–2** (Quick Action / from policy) |
| 10 | Agent | Check my commission | weekly | 4 | menu→Finance→Commissions tab | **2** (Finance→Commissions / Home widget) |
| 11 | Manager | Approve a claim | daily | 4 | menu→Administration→Claims→open→approve | **1–2** (Home "Approvals" widget) |
| 12 | Manager | Approve a requisition | daily | 4 | menu→Finance→Requisitions tab→approve | **1–2** (Home "Approvals" widget) |
| 13 | Manager | See lapsing policies | daily | 3 | Dashboard scroll / Reports | **1** (Home "Lapsing this week" widget) |
| 14 | Manager | Branch performance | daily | 3 | Dashboard + branch filter | **1** (Home widget) |
| 15 | Claims | Register a claim | daily | 4 | menu→Administration→Claims→new | **1–2** (Quick Action "New Claim") |
| 16 | Claims | Manage funeral case/tasks | daily | 4 | menu→Transactions→Funeral Files→open | **2** (Claims→Funeral Cases) |
| 17 | Claims | Dispatch fleet/driver | daily | 5 | inside funeral case | **3** (in-case action, unchanged depth) |
| 18 | Finance | Raise/approve requisition | weekly | 4 | menu→Finance→Requisitions | **2** (Finance→Requisitions) |
| 19 | Finance | Run month-end close | monthly | 4 | menu→Finance→Month-End tab→upload | **2** (Collections→Month-End) |
| 20 | Admin | Add user & assign role | monthly | 4 | menu→Administration→User Admin | **2** (Setup→Users) |

**Aggregate target:** top-5 cashier tasks drop from ~4–7 clicks to **1–2**; the receipt workflow
(tasks 1+2+3) lands **under 10 seconds** with Quick Action + auto receipt + global search.

---

## PART C — Role-Based Command Centers (wireframes)

> ASCII wireframes (layout intent, not visual design). All widgets read from **existing** APIs.

### Cashier Home
```
┌─────────────────────────────────────────────────────────────────────┐
│  [🔍 Search policy / client / phone…]                  [+ New ▾] [⌘K] │
├─────────────────────────────────────────────────────────────────────┤
│  PRIMARY ACTIONS                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ ▶ RECEIPT     │ │ Search Client │ │ Search Policy │ │  Cash-up    │ │
│  │   PAYMENT     │ │               │ │               │ │             │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────────┘ │
├──────────────────────────┬──────────────────────────────────────────┤
│ Today's Collections      │ Cash-up Status: ● Open (since 08:14)       │
│  USD 1,240.00 · 37 rcpts │ Expected vs counted: —                     │
├──────────────────────────┼──────────────────────────────────────────┤
│ Unallocated Payments (3) │ Recent Transactions (last 10)              │
│  • $20 0772… 09:42 →[fix]│  REC-… policy … $… time …                  │
└──────────────────────────┴──────────────────────────────────────────┘
```
APIs: `dashboard/stats`, `cashups/my-receipt-totals`, `diagnostics/unallocated-payments`, `payments`.

### Agent Home (mobile-first)
```
┌───────────────────────────┐
│ [🔍 Search]        [+ New] │
│ ▶ NEW LEAD   ▶ NEW POLICY  │
├───────────────────────────┤
│ Follow-ups due today (4)  │
│  • J. Moyo  call  →        │
├───────────────────────────┤
│ Pipeline: ▮▮▮▯▯  12 leads  │
│ Commission (MTD): $310    │
│ Target: 18/25 policies    │
└───────────────────────────┘
```
APIs: `leads`, `dashboard/lead-funnel`, `commission-ledger`.

### Manager Home
```
┌─────────────────────────────────────────────────────────────┐
│ PENDING APPROVALS (7)            │ CLAIMS REQUIRING ACTION (3)│
│  • Requisition REQ-… $… [Approve]│  • CLM-… verified →        │
│  • Claim CLM-… [Review]          │                            │
├──────────────────────────────────┼────────────────────────────┤
│ BRANCH PERFORMANCE (collections) │ LAPSING THIS WEEK (15)     │
│  Branch A 82% · B 64% · C 91%    │  policy … grace ends …     │
└──────────────────────────────────┴────────────────────────────┘
```
APIs: `approvals`, `claims`, `dashboard/*`, `reports/pre-lapse`.

### Claims Home
```
┌──────────────────────────────────────────────────────────┐
│ OPEN CLAIMS (by stage)   submitted 4 · verified 2 · payable 1│
├───────────────────────────┬──────────────────────────────┤
│ Awaiting my review (2)    │ Funeral cases (active) (5)     │
│  • CLM-… [Open]           │  • FC-… removal due 14:00      │
├───────────────────────────┴──────────────────────────────┤
│ Escalations (1)  • CLM-… > 7 days in 'verified'           │
└────────────────────────────────────────────────────────────┘
```
APIs: `claims`, `funeral-cases`, `claims/:id`.

### Finance Home
```
┌───────────────────────────────────────────────────────────┐
│ Collections today  $… │ Requisitions to approve (4)         │
│ Expenses MTD     $…   │ Month-End: ● not started / running  │
├───────────────────────┴─────────────────────────────────────┤
│ Commissions due $… · Settlements pending (2) · FX set? ⚠     │
└─────────────────────────────────────────────────────────────┘
```
APIs: `requisitions`, `expenditures`, `month-end-run`, `commission-ledger`, `settlements`, `fx-rates`.

### Executive Home
Keep the **current analytics dashboard** (revenue trend, policy status, lead funnel, lapse/retention,
covered lives) — it is well-suited and already built. APIs unchanged.

---

## PART D — Hero-Workflow Wireframes

### Cashier "Receipt Payment" (target < 10s)
```
⌘K or [▶ Receipt Payment]
  → modal: [🔍 policy # / client phone] ─ type 3 chars → live results
  → select policy → shows: holder, balance, premium due
  → amount (prefilled = due) · method [Cash▾] · [Receipt ▶]
  → success → receipt auto-renders → [Print] [SMS] (SMS prefilled to holder)
Total interactions: search, pick, confirm, (print/SMS) = ~3 taps.
```
Uses existing `POST /api/payments` (requireAnyPermission receipt:*), receipt PDF, SMS template.

### Agent "New Policy" wizard (one screen per step, autosave draft)
```
Step 1 Client   → search existing OR quick-add (name, phone, national ID)
Step 2 Product  → product version (price auto-calc) 
Step 3 Members  → add dependents/covered lives
Step 4 Add-ons  → optional
Step 5 Review   → premium summary → [Save Draft] / [Activate with first payment]
```
Uses existing `clients`, `products`, `add-ons`, `policies`, `payment-intents`. No new endpoints.

---

## PART E — Component Architecture (React)

Grounded in the **existing** `client/src/components/ds/*` kit + Radix + `cmdk` (`ui/command.tsx`).
New components are additive; existing pages keep working.

### E.1 App shell (extend, don't replace)
- `StaffLayout` → keep; replace the 6 dropdown menus with the **9-bucket nav config** (a data array,
  same `StaffNavDropdown` mechanism already in place). Pure config change.
- Add `<GlobalCommandBar>` to the header: wraps existing `PolicySearchInput` + a `cmdk` palette.

### E.2 New cross-cutting components
| Component | Built on | Purpose |
|---|---|---|
| `CommandPalette` | existing `ui/command.tsx` (cmdk) | `Ctrl-K` actions + navigate (Part F.3) |
| `GlobalSearch` | `cmdk` + new `/api/search` (aggregator over existing read endpoints) | universal entity search |
| `QuickCreateButton` | Radix dropdown | context-aware "+ New" (Lead/Client/Policy/Claim/Receipt) |
| `CommandCenter` + `Widget` | `KpiStatCard`, `CardSection`, `DataTable` | role-based Home assembly |
| `ReceiptDrawer` | Radix dialog/drawer | the <10s receipt flow |
| `PolicyWizard` | `FormSection` + steps | agent new-policy wizard |
| `EnhancedDataTable` | extend existing `DataTable` | search/sort/filter/export/column-chooser/saved-views/bulk |

### E.3 Data-fetching
- Keep TanStack Query + `queryClient` (CSRF) exactly as is.
- `GlobalSearch` needs **one new read-only aggregator endpoint** (`GET /api/search?q=`) that fans out
  to existing storage methods (policies, clients, leads, claims, funeral-cases, receipts, groups),
  org-scoped, permission-filtered. *This is additive — no existing API changes.* (If preferred,
  client-side fan-out to existing endpoints avoids any backend change for v1.)

### E.4 Home routing
`/staff` renders `<CommandCenter variant={primaryRole}>`; executive/platform-owner variants render the
**current** dashboard component unchanged.

---

## PART F — Design System Specification

### F.1 Foundations (already present — formalize)
- **Font:** Inter (already `tailwind.config.ts` `sans`). Tabular figures for money (`tabular-nums`).
- **Theme:** light + dark via `next-themes` (present). All new components theme-token driven.
- **Blend target:** 50% Linear (speed/density), 30% Stripe (financial trust), 20% Salesforce (table density).

### F.2 Tokens
- **Color:** one primary accent + neutral gray scale; semantic = success/warn/danger/info. Money
  always neutral/!color unless negative. Avoid >1 accent.
- **Spacing:** 4px base; card padding 16/24; page gutters per `APP_SHELL_MAX`.
- **Radius/elevation:** subtle (Linear) — `rounded-lg`, `shadow-sm` hover `shadow-md` (already used).
- **Layout primitives:** sticky page header, sticky table header, sticky filter bar (extend
  `FilterBar`), command-center grid.

### F.3 Global Search & Command Palette spec
- **Search scope (grouped results):** Clients (name/phone/national ID), Policies (number/holder),
  Leads, Claims (number), Funeral Cases, Receipts (number), Schemes/Groups, Dependents/Beneficiaries.
- **Palette (`Ctrl-K`) actions:** New Lead · New Client · New Policy · New Claim · New Receipt ·
  Search Client · Search Policy · Search Claim · Start Cash-up · Open Approvals · jump-to any menu.
- Available on **every** screen (mounted in `StaffLayout`). Respects permissions (hide actions the
  role lacks).

### F.4 Table standards (extend `DataTable`)
Search · column filter · multi-sort · CSV export (reuse `/api/reports/export`) · column chooser ·
saved views (localStorage v1, per-user later) · bulk actions · sticky header · empty state
(`EmptyState`) · skeleton loading (`SkeletonLoader`).

### F.5 Form standards (extend `FormSection`)
Inline validation (Zod, already shared) · draft save + autosave (localStorage v1) · keyboard nav
(tab order, Enter-to-advance in wizard) · progress indicator for multi-step · optimistic submit with
toast.

### F.6 Mobile
Agent journeys (Home, New Lead, New Policy, Mobile Payment) designed mobile-first; back-office
(Collections desk, Reports, Setup) desktop-first. One responsive codebase (Capacitor unchanged).

---

## PART G — Migration Roadmap (phased, feature-flagged, reversible)

| Phase | Scope | Risk | Reversible? |
|---|---|---|---|
| **0. Done** | Finance tab deep-link fix; interim de-dupe | — | n/a |
| **1. Nav config swap** | Replace 6-menu array with 9-bucket config in `StaffLayout` (data-only). Relabel duplicates (Policies, Clients). Hide Platform-owner items from tenants. | Low | Flag off = old menu |
| **2. Global search + `Ctrl-K`** | Mount `CommandPalette` + `GlobalSearch` (client-side fan-out v1). | Low | Flag off = hidden |
| **3. Quick Create + Receipt Drawer** | "+ New" + <10s receipt flow over existing `POST /api/payments`. | Med | Flag off = current paths |
| **4. Role command centers** | `/staff` renders role `CommandCenter`; exec/owner keep current dashboard. | Med | Flag off = current dashboard |
| **5. EnhancedDataTable + forms** | Roll table/form standards page-by-page (start Policies, Clients, Finance). | Med | Per-page flag |
| **6. Policy wizard + design polish** | Agent wizard; Linear/Stripe token pass; dark-mode QA. | Med | Flag off = current forms |
| **7. Build stubs** | Implement 🚧 screens within their domain homes (separate backlog). | Varies | Independent |

Each phase ships behind a flag, dark-launched to a pilot branch/tenant first.

---

## PART H — Feature-Flag Strategy

POL263 has no flag system today → introduce a **minimal, additive** one (no schema change required):
- **Mechanism:** a typed `flags` module read from (a) env vars for global defaults and (b) a
  per-tenant JSON field already available on `organizations` settings (no migration if an existing
  settings JSON column is reused; otherwise a single nullable `feature_flags jsonb` column — additive).
- **Client:** `useFlag('newNav')` hook (TanStack Query off `/api/app-info` or branding settings).
- **Flags:** `newNav`, `globalSearch`, `commandPalette`, `quickCreate`, `receiptDrawer`,
  `commandCenters`, `enhancedTables`, `policyWizard`.
- **Granularity:** global → tenant → role. Default **off**; opt-in pilot tenants first.
- **Kill switch:** any flag can be disabled centrally without redeploy.

---

## PART I — Testing Strategy

1. **Preserve-functionality regression (highest priority).** Vitest suites already exist; add/confirm
   coverage for the *money* and *RBAC* paths that must not break: receipting (`POST /api/payments`),
   PayNow intent lifecycle, requisition maker-checker, claim transitions, permission gates on every
   route. These test the **unchanged** backend — they must stay green through all phases.
2. **Click-count validation.** Automated UI walk (Playwright/e2e) measuring clicks for the Part B
   top-20 tasks, old vs new nav, asserting the proposed targets.
3. **<10s receipt timing test.** e2e timing assertion on the cashier receipt flow.
4. **Permission/visibility matrix test.** For each seeded role, assert which top-level menus and
   quick-actions render (Part A.3 / F.3) — guards against exposing actions a role lacks.
5. **Flag on/off parity.** Each phase: run the regression suite with the flag **off** (must equal
   pre-change behaviour) and **on**.
6. **Cross-surface.** Web + Capacitor (Android/iOS) smoke for agent mobile journeys.
7. **Accessibility & theme.** Keyboard nav for palette/wizard; dark/light contrast.
8. **Pilot UAT.** First-time cashier/agent/admin complete top tasks **without training** (the mandate's
   success bar) on a pilot tenant before GA.

## PART J — Rollback Strategy

- **Primary: flag rollback.** Every change is behind a flag (Part H); disabling reverts to prior
  behaviour instantly, no redeploy, no data change (this transformation writes no new persisted data
  beyond opt-in flags/saved-views).
- **Code rollback.** Phases are independent PRs; revert the PR to remove a phase. Because backend
  APIs/schema are untouched, frontend revert is safe and isolated.
- **Tenant-scoped rollback.** A flag can be turned off for one tenant if they report friction, leaving
  others on.
- **Data safety.** No destructive migration in any phase. The only additive DB change (optional
  `feature_flags jsonb`) is nullable and ignorable. Saved views/draft autosave default to localStorage
  (v1) — zero server state.
- **Monitoring.** `/api/diagnostics/*` (health, recent-errors, notification-failures, unallocated
  payments) already exists — watch these during each dark-launch; a spike triggers flag-off.

---

## Success Criteria (acceptance)
- ✅ First-time **cashier** receipts a payment in **< 10 seconds**.
- ✅ First-time **agent** creates a policy **without training** (wizard).
- ✅ Any user finds any major function **without asking** (global search + job-named menus).
- ✅ **Zero** existing functionality lost (regression suite green with flags on).
- ✅ POL263 reads as a premium enterprise SaaS, not a module collection.

---

## Recommended first action (on your sign-off)
**Phase 1 — nav config swap** is the lowest-risk, highest-clarity win: it is a *data-only* change to
the menu array in `StaffLayout`, fully behind a `newNav` flag, reversible instantly, and breaks
nothing. I can implement it whenever you say go.

*No code changed in this document. Awaiting direction.*
