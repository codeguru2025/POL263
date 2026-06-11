# POL263 — Canonical Business Model & Navigation Blueprint

> **Builds on** `docs/POL263-FUNCTIONAL-BLUEPRINT.md` (discovery). This document defines the
> canonical domain model, fixes business-language ambiguity, and proposes a job-based information
> architecture.
>
> **Hard constraints honoured throughout:** no new business concepts; no entity merges unless proven
> identical; no functionality removed; no workflow renamed without an explicit mapping. Every
> implemented screen, route, permission, workflow, and API is **preserved** — only *access paths* are
> reorganized. Stub routes (`StaffComingSoon`) are kept and placed logically, flagged 🚧.

---

## PHASE 1 — Canonical Domain Model

Twelve operational domains. Frequency = how often a typical tenant touches it; Criticality = impact
if it stops working.

| # | Domain | Purpose | Primary users | Main entities | Related entities | Workflows | Frequency | Criticality |
|---|---|---|---|---|---|---|---|---|
| 1 | **Sales & Distribution** | Acquire new business | Agent, Manager | Lead | Client, Policy, Product, User(agent) | Lead→Policy (§4.1/4.2) | Daily | High |
| 2 | **Client Management** | Maintain parties & their people | Cashier, Agent, Manager | Client, Dependent | Policy, ClientDocument, ClientFeedback, PaymentMethod | Client onboarding, dependent change | Daily | High |
| 3 | **Policy Management** | Issue & service contracts | Cashier, Agent, Manager | Policy, PolicyMember | Client, ProductVersion, AddOn, PolicyStatusHistory, CreditBalance | New policy, transition, upgrade | Daily | **Mission-critical** |
| 4 | **Collections & Receipting** | Take money in | **Cashier**, Agent | PaymentTransaction, Receipt, PaymentIntent, Cashup | Policy, Client, MonthEndRun | Receipting, PayNow, cash-up, month-end (§4.3–4.5) | **Many×/day** | **Mission-critical** |
| 5 | **Claims** | Adjudicate & pay claims | Claims Officer, Manager | Claim | Policy, Client, ClaimDocument, ClaimStatusHistory | Claim lifecycle (§4.6) | Daily | High |
| 6 | **Funeral Operations** | Deliver the funeral service | Claims Officer, Fleet Ops, Driver | FuneralCase, FuneralTask | Claim, Policy, FuneralQuotation, ServiceReceipt, FleetVehicle | Case mgmt + dispatch (§4.7) | Daily | High |
| 7 | **Group / Society Business** | Bulk schemes & settlement | Manager, Admin, Client (society head) | Group, GroupPaymentIntent | GroupPaymentAllocation, Settlement, Policy | Group collection (§4.10) | Weekly | High |
| 8 | **Finance & Accounting** | Manage money out & books | **Finance/Admin**, Manager | Requisition, Expenditure, CommissionLedgerEntry, Settlement | FxRate, PlatformReceivable, Payroll*, CostSheet | Requisition approval, commission, payroll, statements (§4.8/4.9/4.11) | Weekly→Monthly | High |
| 9 | **Product & Pricing Config** | Define what's sold & for how much | Admin, Manager | Product, ProductVersion, PriceBookItem | BenefitCatalog, BenefitBundle, AddOn, AgeBand, CostSheet, T&Cs | Product/price setup | Monthly | Medium |
| 10 | **Reporting & Analytics** | Understand the business | Exec, Manager, Finance | (read-only views) | All operational entities | ~20 report types, statements, exports | Daily(view)/Weekly | Medium |
| 11 | **Administration & Access** | Run the tenant | Administrator | User, Role, Permission, Branch | AuditLog, ApprovalRequest, NotificationTemplate, Settings | RBAC, approvals, comms, audit | Monthly/Rare | High (security) |
| 12 | **Platform Management** | Run POL263 across tenants | **Platform Owner** | Organization (tenant), AppRelease, PlatformReceivable | Control-plane registry | Tenant create/switch, releases | Rare | High (platform) |

### Domain map (relationships between domains)
```
                 ┌─────────────┐
   Sales ───────▶│   Policy    │◀────── Product & Pricing Config
  (Lead→Client)  │ Management  │
                 └──────┬──────┘
        ┌───────────────┼────────────────┐
        ▼               ▼                 ▼
  Collections       Claims ──────▶ Funeral Operations
 (money IN)            │                  │
        │              ▼                  ▼
        └────────▶  Finance & Accounting (money OUT, books, commissions)
                          ▲
        Group/Society ────┘ (bulk collection → settlement)

  Reporting reads ALL domains.   Administration & Platform Management govern ALL domains.
```

---

## PHASE 2 — Entity Hierarchy

**Parent** = owns a lifecycle. **Child** = exists only under a parent. **Shared** = attached across
many domains. **Reference** = configuration/lookup, rarely changes.

### Hierarchy A — Sales / Revenue
```
Lead (parent, pipeline)
└─▶ Client (parent)                         [lead.clientId on conversion]
     └─▶ Policy (parent)                     [+ ProductVersion ref, + Group shared]
          ├─▶ PolicyMember (child)           → Client | Dependent
          ├─▶ PolicyAddOn (child)
          ├─▶ PolicyStatusHistory (child)
          ├─▶ PolicyCreditBalance (child)
          ├─▶ PaymentIntent (child, attempt)
          └─▶ PaymentTransaction (child)     [money event]
               ├─▶ Receipt / PaymentReceipt (child, proof)
               └─▶ CommissionLedgerEntry (child) [→ policy + transaction + agent]
```

### Hierarchy B — Claims / Funeral
```
Policy (parent)
└─▶ Claim (parent)                           [claim.policyId, claim.clientId]
     ├─▶ ClaimDocument (child)
     ├─▶ ClaimStatusHistory (child)
     └─▶ FuneralCase (parent)                [funeralCase.claimId, .policyId]
          ├─▶ FuneralTask (child)
          ├─▶ FuneralQuotation (parent)
          │    └─▶ FuneralQuotationItem (child) → PriceBookItem (reference)
          ├─▶ ServiceReceipt (child)         [cash-service income]
          └─▶ Fleet dispatch: FleetVehicle (shared) + Driver/User (shared)
```

### Hierarchy C — Group / Society
```
Group (parent)                               [initiatedByClient / initiatedByUser]
├─◀ Policy (policy.groupId — policies belong to a group)
└─▶ GroupPaymentIntent (child)
     └─▶ GroupPaymentAllocation (child) → Policy
          └─▶ Settlement (parent)
               └─▶ SettlementAllocation (child)
```

### Hierarchy D — Membership (covered lives)
```
Client (parent) ─▶ Dependent (child)
   Dependent plays THREE roles on a Policy:
     • Beneficiary      (policy.beneficiaryDependentId)
     • Covered life     (policyMember.dependentId)
     • Change subject   (dependentChangeRequest)
```

### Hierarchy E — Product & Pricing (reference)
```
Product (parent)
└─▶ ProductVersion (parent, versioned)
     ├─▶ AddOn (child)
     ├─▶ AgeBandConfig (child)
     ├─▶ TermsAndConditions (child)
     └─▶ BenefitBundle ↔ BenefitCatalogItem (reference, linked)
PriceBookItem (reference) ─▶ CostSheet ─▶ CostLineItem
CommissionPlan (reference) → drives CommissionLedgerEntry
```

### Hierarchy F — Finance (money out / books)
```
Requisition (parent, maker-checker)          [requestedBy→approvedBy→paidBy]
Expenditure (parent, standalone)
PlatformReceivable (parent)                  [tenant owes platform]
PayrollEmployee (parent) ─▶ PayrollRun ─▶ Payslip (child)
FxRate (reference) — USD base for statements
```

### Hierarchy G — Access / Governance (shared + reference)
```
Organization (root, shared by EVERY entity)
└─▶ Branch (shared)
User (shared — actor on nearly every entity: agentId, recordedBy, approvedBy, …)
Role ↔ Permission (reference) ; UserRole (branch-scoped) ; UserPermissionOverride
AuditLog (cross-cutting record) ; ApprovalRequest (cross-cutting) ; OutboxMessage (infra)
NotificationTemplate (reference) ─▶ NotificationLog
SecurityQuestion (reference, client auth)
```

### Hierarchy H — Platform
```
Organization-as-Tenant (parent)
├─▶ AppRelease (child) ; AppDownloadInterest (child)
└─▶ PlatformReceivable (child)   [control-plane registry coordinates isolated tenant DBs]
```

**Shared entities** (touch many domains): `User`, `Branch`, `Organization`, `FleetVehicle`,
`PaymentTransaction`. **Reference entities** (config/lookup): `Product/ProductVersion`,
`PriceBookItem`, `CommissionPlan`, `AgeBand`, `BenefitCatalog`, `NotificationTemplate`, `FxRate`,
`SecurityQuestion`, `Role/Permission`.

---

## PHASE 3 — Business-Language Problems (terminology)

> Recommendations are **labels only** — no functionality, table, or API changes. "Internal technical
> label" = keep the existing code/table name to avoid migration risk.

| # | Conflict | Actual difference | Canonical concept | User-facing label | Internal technical label (unchanged) |
|---|---|---|---|---|---|
| 1 | Group / Employer Scheme / Burial Society / Sub Group | All one `groups` table; "sub group" stub adds nothing modelled | One concept with a *type* | **"Scheme"** (with type: Employer / Society) | `groups` |
| 2 | Quotations (sales) vs Funeral Quotations | Unrelated: sales pipeline vs priced funeral service | Two distinct concepts | Sales → **"Quotes / Pipeline"**; funeral → **"Funeral Quote"** | `leads` ; `funeral_quotations` |
| 3 | Payment vs Receipt vs Payment Intent | Intent = attempt; Transaction = money event; Receipt = proof | Three sequential concepts | **"Payment"** (the transaction), **"Receipt"** (proof), **"Collection attempt"** (intent, mostly hidden) | `payment_transactions` / `receipts` / `payment_intents` |
| 4 | `receipts` vs `payment_receipts` | Two near-identical receipt tables (overlapping FKs) | **Unproven duplicate — investigate before any merge** | "Receipt" | keep both until authoritative one confirmed |
| 5 | Claim vs Funeral Case | Claim = insurance/financial; Funeral Case = operational delivery | Two sequential concepts | **"Claim"** and **"Funeral Case"** (keep both) | `claims` / `funeral_cases` |
| 6 | Lead vs Client | Lead = prospect (pipeline); Client = real party | Two sequential concepts | **"Lead"** then **"Client"** — stop labelling a single KPI "Leads & Clients" | `leads` / `clients` |
| 7 | Dependent / Beneficiary / Member | One `dependents` entity playing 3 roles | One concept, role-by-context | **"Family member"**; show role inline ("Beneficiary", "Covered") | `dependents` / `policy_members` |
| 8 | Agent vs Broker | Agent = `users` w/ agent role (modelled); Broker = stub, **no table** | Broker is **not yet a concept** | Don't expose "Broker" as if real until modelled | `users` (role=agent); broker = unbuilt |
| 9 | Requisition vs Expenditure | Requisition = *request to spend* (approval flow); Expenditure = *recorded expense* | Two related concepts | **"Requisition"** (approval) → **"Expense"** (ledger) | `requisitions` / `expenditures` |
| 10 | "Policy Admin" vs "Policy Transactions" | Same screen (`/staff/policies`), two labels | One screen | **"Policies"** | `StaffPolicies` |
| 11 | "Billing" / "Receipts" / "Finance" | All were `/staff/finance` | One hub | **"Finance"** / **"Collections"** (split by job) | `StaffFinance` |
| 12 | Society Admin / Society Transactions (stubs) | No tables; overlap with `groups` | Fold into Scheme | "Scheme" | (stubs) |

---

## PHASE 4 — Task-Based Navigation Model (start from jobs)

Screens listed are **real, implemented** screens (from discovery §2). Tabs are noted where the job
lives inside StaffFinance.

### Cashier
| Job | Screen(s) | Route |
|---|---|---|
| Receipt a payment | StaffPolicies (take payment) / StaffFinance | /staff/policies, /staff/finance?tab=payments |
| Mobile/cash collection | StaffFinance | /staff/finance?tab=paynow |
| Daily cash-up | StaffFinance | /staff/finance?tab=cashups |
| Look up policy/client | StaffPolicies, StaffClients | /staff/policies, /staff/clients |
| (Raise requisition) | StaffFinance | /staff/finance?tab=requisitions |

### Agent
| Job | Screen | Route |
|---|---|---|
| Capture lead | StaffLeads | /staff/leads |
| Convert lead → policy | StaffLeads → StaffPolicies | /staff/leads, /staff/policies |
| Create policy / add members | StaffPolicies | /staff/policies |
| Take mobile payment | StaffPolicies / StaffFinance | /staff/finance?tab=paynow |
| Check my commission | StaffFinance | /staff/finance?tab=commissions |
| My clients | StaffClients | /staff/clients |

### Manager
| Job | Screen | Route |
|---|---|---|
| Approve claims | StaffClaims | /staff/claims |
| Approve requisitions/settlements | StaffApprovals, StaffFinance | /staff/approvals, /staff/finance?tab=requisitions |
| Monitor collections / lapse | StaffDashboard, StaffReports | /staff, /staff/reports |
| Manage users | StaffUsers | /staff/users |
| Manage schemes | StaffGroups | /staff/groups |

### Claims Officer
| Job | Screen | Route |
|---|---|---|
| Register / adjudicate claim | StaffClaims | /staff/claims |
| Manage funeral case + tasks | StaffFunerals | /staff/funerals |
| Dispatch fleet/driver | StaffFunerals | /staff/funerals |
| Funeral quote / service receipt | StaffPriceBook, StaffFunerals | /staff/pricebook, /staff/funerals |

### Finance Officer *(today requires administrator or cashier — no seeded role; see §8 of discovery)*
| Job | Screen | Route |
|---|---|---|
| Requisitions / expenses | StaffFinance | /staff/finance?tab=requisitions / expenditures |
| Month-end close | StaffFinance | /staff/finance?tab=month-end |
| Group receipt / settlement | StaffFinance | /staff/finance?tab=group-receipt |
| Commissions, FX, platform fees | StaffFinance | /staff/finance?tab=commissions/fx-rates/platform |
| Financial statements | StaffReports | /staff/reports?section=finance |
| Payroll | StaffPayroll | /staff/payroll |

### Executive
| Job | Screen | Route |
|---|---|---|
| View KPIs | StaffDashboard | /staff |
| View reports/statements | StaffReports | /staff/reports |

### Administrator
| Job | Screen | Route |
|---|---|---|
| Products & pricing | ProductBuilder, StaffPriceBook | /staff/products, /staff/pricebook |
| Users, roles, permissions | StaffUsers, StaffSettings | /staff/users, /staff/settings |
| Branches / org / branding | StaffSettings | /staff/settings |
| Notifications / automation | StaffNotifications | /staff/notifications |
| Audit / diagnostics | AuditLogs, StaffDiagnostics | /staff/audit, /staff/diagnostics |
| Finance approve | StaffFinance, StaffApprovals | /staff/finance, /staff/approvals |
| Tenants (if Platform Owner) | StaffSettings/StaffTenants | /staff/settings?tab=tenants |

---

## PHASE 5 — Screen Classification Matrix (implemented screens only)

| Screen | Daily | Weekly | Monthly (config) | Rare (admin) | Primary roles |
|---|:--:|:--:|:--:|:--:|---|
| StaffDashboard | ✅ | | | | all |
| StaffPolicies | ✅ | | | | cashier, agent, mgr |
| StaffClients | ✅ | | | | all client-facing |
| StaffFinance (payments/paynow/cashups) | ✅ | | | | cashier, agent, finance |
| StaffFinance (requisitions/expenditures) | | ✅ | | | finance, admin |
| StaffFinance (month-end/group/settlement) | | ✅ | | | finance, admin |
| StaffFinance (commissions/fx/platform) | | ✅ | | | finance, admin |
| StaffClaims | ✅ | | | | claims, mgr |
| StaffFunerals | ✅ | | | | claims, fleet |
| StaffLeads | ✅ | | | | agent, mgr |
| StaffApprovals | | ✅ | | | mgr, admin |
| StaffReports | ✅(view) | ✅ | | | exec, mgr, finance |
| StaffEmployeeReports | | ✅ | | | mgr, admin |
| StaffGroups | | ✅ | | | mgr, admin |
| StaffPayroll | | | ✅ | | admin |
| ProductBuilder | | | ✅ | | admin, mgr |
| StaffPriceBook | | ✅ | ✅ | | admin, mgr |
| StaffNotifications | | | ✅ | | admin |
| StaffUsers | | | ✅ | | mgr, admin |
| StaffSettings | | | ✅ | ✅ | admin, Platform Owner |
| AuditLogs | | | | ✅ | exec, mgr, admin |
| StaffDiagnostics | | | | ✅ | admin |
| StaffAssetsRegister | | | ✅ | | admin |
| StaffReminders | | ✅ | | | all |
| StaffOrderServices | | | | ✅ | admin |
| StaffHelpCenter | | ✅ | | | all |
| StaffTenants | | | | ✅ | Platform Owner |

---

## PHASE 6 — Duplicate Navigation Map

| Type | Item | Exposed via | Resolution principle (Phase 7) |
|---|---|---|---|
| Same route, 2 menu entries | `/staff/policies` | Transactions→"Policy Transactions" (agentOnly) **and** Administration→"Policy Admin" | Single entry under **Policies** |
| Same route, 2 entries | `/staff/settings` | Administration→"System Setup" **and** →"Tenants" (`?tab=tenants`) | One **Setup** entry; Tenants = sub-tab |
| Same entity, many menus | `clients` | Administration→"Clients" **and** (historically) Tools→"CRM Module" | Single entry under **Policies** (Clients) |
| Same hub, many doors | `/staff/finance` | 14 Finance entries + earlier Tools "Billing" / Transactions "Receipts" | Split by job: **Collections** (daily) vs **Finance** (periodic) |
| Same entity, 2 labels | `groups` | Administration→"Employer Admin"; stubs "Society Admin", "Sub Group Admin" | One **Schemes** entry |
| Same workflow, 2 starts | New policy | StaffPolicies + public `/join/register` | Keep both (staff vs public); same screen for staff |
| Same workflow, 2 starts | Approvals | StaffApprovals (generic) + Finance requisitions tab + settlements approve | Surface all in one **Approvals** queue (cross-link) |
| Same concept, 2 funeral/sales | "Quotations" | Transactions→"Quotations" = StaffLeads; funeral quotes inside StaffFunerals | Rename per Phase 3 (#2) |

---

## PHASE 7 — Proposed Final Information Architecture

> Preserves **every** implemented screen, route, permission, workflow, and API. Reorganizes access
> paths only. Stub routes retained under their logical domain, flagged 🚧 (built later).
> This **refines** the earlier interim "Work/Money/Insights/Setup" idea into domain-clear buckets
> that a new cashier/agent/admin can read without training.

### Top-level menus (7 + Home)

```
HOME            Role-based command center + work queues
SALES           Pipeline / leads / quotes; new business
POLICIES        Clients, Policies, Members, Documents (the book)
COLLECTIONS     Money IN — receipt, mobile/cash, cash-up, month-end, group receipt
CLAIMS          Claims + Funeral Operations
FINANCE         Money management — requisitions, expenses, commissions, payroll, settlements, FX, platform fees, statements
REPORTS         Reporting, statements, employee reports
SETUP           Products, pricing, users/roles, branches, notifications, partners, audit, diagnostics, tenants
```

### Submenu mapping (existing → new home; nothing dropped)

**SALES**
- Leads / Pipeline → `/staff/leads` ✅
- New Policy (entry point) → `/staff/policies` ✅
- Public registration (referral) → `/join/register` ✅

**POLICIES**
- Policies → `/staff/policies` ✅ (was "Policy Admin" + "Policy Transactions")
- Clients → `/staff/clients` ✅ (was "Clients" + "CRM Module")
- Schemes (Employer/Society) → `/staff/groups` ✅ (was "Employer Admin"; absorbs society/sub-group 🚧)

**COLLECTIONS** (StaffFinance daily tabs + collection stubs)
- Receipt a Payment → `/staff/finance?tab=payments` ✅
- Mobile & Cash → `?tab=paynow` ✅
- Cash-up → `?tab=cashups` ✅
- Group Receipt → `?tab=group-receipt` ✅
- Month-End Close → `?tab=month-end` ✅
- Debit Orders / Bank Deposits / Petty Cash → `/staff/transactions/*` 🚧

**CLAIMS**
- Claims → `/staff/claims` ✅
- Funeral Cases → `/staff/funerals` ✅
- Funeral Pricing / Cost Sheets → `/staff/pricebook` ✅
- Online Claims Form / Transport Companies → 🚧

**FINANCE** (StaffFinance periodic tabs + finance screens)
- Requisitions → `?tab=requisitions` ✅
- Expenses → `?tab=expenditures` ✅
- Commissions → `?tab=commissions` ✅
- Settlements / Platform Fees → `?tab=platform` + settlements ✅
- FX Rates → `?tab=fx-rates` ✅
- Payroll → `/staff/payroll` ✅
- Approvals → `/staff/approvals` ✅ (cross-linked here and surfaced on Home)
- Credit Notes / Invoices → `/staff/transactions/*` 🚧

**REPORTS**
- Dashboards → `/staff` ✅
- Reports (Policy / Finance / Statements) → `/staff/reports` ✅
- Employee Reports → `/staff/employee-reports` ✅
- System Issue Reports → `/staff/diagnostics` ✅ (also in Setup→Security)
- Dynamic Reports (Generic) / Statistics / Graphs → 🚧

**SETUP** (config + rare admin; grouped into sub-sections)
- *Catalog:* Products → `/staff/products` ✅ · Price Book → `/staff/pricebook` ✅ · T&Cs → (Settings) ✅
- *Access:* Users → `/staff/users` ✅ · Roles/Permissions → `/staff/settings` ✅
- *Org:* Branches 🚧 · Branding/Org → `/staff/settings` ✅
- *Comms:* Notifications/SMS → `/staff/notifications` ✅ · Reminders → `/staff/reminders` ✅ · Order Services → `/staff/order-services` ✅
- *Partners:* Agents/Brokers/Underwriters/Undertakers/Member Cards/Terminals/Invoice Items 🚧
- *Security:* Audit Trail → `/staff/audit` ✅ · Diagnostics → `/staff/diagnostics` ✅ · Asset Register → `/staff/tools/assets` ✅
- *Platform (Owner only):* Tenants → `/staff/settings?tab=tenants` ✅ · App Releases 🚧 · EasyPay 🚧
- Help Centre → `/staff/help` ✅

### Role-based visibility (top-level menus shown)
| Menu | Cashier | Agent | Claims | Manager | Finance | Exec | Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Home | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sales | | ✅ | | ✅ | | | ✅ |
| Policies | ✅(read) | ✅(own) | ✅(read) | ✅ | ✅(read) | ✅(read) | ✅ |
| Collections | ✅ | ✅(mobile) | | ✅ | ✅ | | ✅ |
| Claims | | | ✅ | ✅ | | ✅(read) | ✅ |
| Finance | | ✅(commission) | | ✅(approve) | ✅ | ✅(read) | ✅ |
| Reports | ✅(limited) | ✅(own) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Setup | | | | ✅(users) | | | ✅ |

*(Driver role: a focused view of assigned funeral cases + fleet — read-only; no full nav.)*

### Quick Actions (context "+ New" button)
Receipt Payment · New Policy · New Lead · New Claim · New Requisition · New Cash-up · Add Client.

### Command Palette (`Ctrl-K`) actions
Run-action: "Receipt payment", "New policy", "New lead", "New claim", "Raise requisition",
"Start cash-up", "Open approvals". Navigate: jump to any top-level menu/screen.

### Global Search scope
Policies (number / holder), Clients (name / phone / national ID), Family members & dependents,
Claims (number), Funeral cases, Receipts (number), Schemes/Groups.

### Dashboard architecture (role-based Home)
- **Cashier:** Receipt action + today's receipts + cash-up status + unallocated payments.
- **Agent:** New policy/lead + follow-ups due + my commission + my clients.
- **Manager:** Approvals queue + branch collections vs target + lapsing this week.
- **Claims/Funeral:** Open cases by stage + awaiting-my-approval + tasks due.
- **Finance:** Collections today + requisitions to approve + month-end status.
- **Executive:** Current KPI dashboard (kept as-is).
- **Platform Owner:** Control-plane tenant list (kept as-is).

---

## PHASE 8 — Refactoring Plan

### BEFORE (current top-level)
```
Home · Transactions · Finance · Reports · Tools · Administration
  (Transactions: 6/8 stubs · Administration: 11/21 stubs · Tools: 7/13 stubs)
```

### AFTER (proposed top-level)
```
Home · Sales · Policies · Collections · Claims · Finance · Reports · Setup
```

### Movement rationale (per change)

| Movement | Why moved | Business rationale | Affected users | Migration risk | Training impact |
|---|---|---|---|---|---|
| "Policy Transactions" + "Policy Admin" → **Policies** | Same route, two labels | One book of business; no duplication | Agent, cashier, mgr | Low (same screen) | Positive — removes confusion |
| Clients + "CRM Module" → **Policies › Clients** | Duplicate destination | Clients belong with policies | All | Low | Positive |
| Split StaffFinance: daily tabs → **Collections**, periodic tabs → **Finance** | One page served two very different jobs | Cashier collects daily; finance manages periodically | **Cashier (primary user)**, finance | Low (same page, different entry/tab) | High positive — cashier's job becomes top-level |
| "Employer Admin" + society/sub-group stubs → **Policies › Schemes** | One `groups` table, many labels | Single Scheme concept (Employer/Society type) | Mgr, admin | Low | Positive |
| Claims (was Administration) + Funerals (was Transactions) → **Claims** | Split mental model across menus | Claim → Funeral is one operational flow | Claims, fleet | Low | High positive — one journey, one menu |
| Quotations(=Leads) → **Sales › Pipeline** | Misleading label vs funeral quotes | Sales pipeline is its own domain | Agent | Low (rename label only) | Positive — disambiguates "quote" |
| FX / Audit / Diagnostics / Notifications / Products / Users / Branches / Partners → **Setup** | Config/rare items competed for daily attention | Monthly/rare work quarantined | Admin | Low | Positive — daily users stop seeing config |
| **Platform Fees & App Releases** → Setup › Platform (Owner-only) | Platform-owner data was visible to tenant staff | It's POL263's revenue, not tenant data | Admin, exec | **Low but important** (visibility correctness) | Positive — removes misleading data |
| Approvals surfaced on **Home** + kept in Finance | Approvals lived only in Administration | Maker-checker is time-sensitive | Mgr, admin | Low | High positive |
| All 🚧 stubs kept under logical domain, flagged | Preserve routes/promises | No functionality removed | — | None | Neutral (clearer expectations) |

### Migration sequencing (low-risk order)
1. Relabel duplicates (Policies, Clients) — pure label change, zero route change.
2. Introduce **Collections** vs **Finance** split (same StaffFinance page, new entry points).
3. Merge Claims+Funerals; rename Quotations→Pipeline.
4. Quarantine config into **Setup**; hide Platform-owner items from tenants.
5. Add Home work-queues, Quick Actions, `Ctrl-K`, extended global search.

### What does NOT change
Every route string, every API endpoint, every permission gate, every workflow/state machine, every
database table. `StaffFinance` remains one page; tabs are unchanged. Stub routes remain registered.
This is an **access-path reorganization and relabeling**, not a functional rewrite.

---

## Compliance with the Critical Rules
- ✅ No new business concepts (Scheme = existing `groups`; no invented entities).
- ✅ No entity merges asserted — `receipts` vs `payment_receipts` flagged as *unproven*, left intact.
- ✅ No functionality removed — all 24 screens + 36 stub routes preserved and placed.
- ✅ No workflow renamed without mapping — all renames are *labels* with the technical name retained.
- ✅ Understandable without training — top-level menus are the user's nouns/jobs (Sales, Policies,
  Collections, Claims, Finance, Reports, Setup).

*End of blueprint. Ready for your direction on which phase of the refactor to implement first.*
