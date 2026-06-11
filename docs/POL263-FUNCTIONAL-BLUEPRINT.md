# POL263 — Functional Blueprint & Discovery Report

> **Scope.** Pure discovery. This document describes POL263 *as it actually is in the code* — no
> redesign, no recommendations, no renaming. Every menu, route, permission, entity, and workflow
> below was extracted directly from source (`client/src/App.tsx`, `staff-layout.tsx`,
> `server/routes.ts`, `server/constants.ts`, `shared/schema.ts`).
>
> **Headline finding to read first (§0).**

---

## 0. The Single Most Important Structural Fact

**A large share of the menu does not lead to a real screen yet.** In `client/src/App.tsx`, the
following routes all resolve to one placeholder component, `StaffComingSoon` ("under construction"):

- **All Transactions sub-pages:** `society`, `tombstone`, `credit-notes`, `invoices`, `petty-cash`,
  `bank-deposits`, `debit-orders`, `fax`
- **All `/staff/admin/*` pages:** `society`, `tombstones`, `invoice-items`, `agents`, `brokers`,
  `member-cards`, `terminals`, `branches`, `sub-groups`, `underwriters`, `undertakers`
- **Several Tools:** `easypay`, `print-policy-cards`, `statistics`, `statistical-graphs`,
  `claims-form`, `transport-companies`, `contacts`
- **Reports:** `dynamic-generic`

**Therefore there are only ~24 real, implemented staff screens** (listed in §2), even though the
navigation exposes ~60 menu entries. The rest are navigational promises. This distinction governs
every later section.

---

## 1. Menu Hierarchy (Phase 1)

Source: `client/src/components/layout/staff-layout.tsx`. Visibility is computed at runtime:
`filterNav()` shows an item only if the user holds **any** of its permission(s); `agentHidden`
items are hidden from agent-scoped users; `agentOnly` items show **only** to agents. Items with no
permission are visible to all authenticated staff. The **roles** column lists which seeded roles
hold the gating permission (derived from `ROLE_PERMISSION_MAP`; Platform Owner & `superuser` always
pass).

Legend: ✅ real screen · 🚧 `StaffComingSoon` stub.

### HOME
```
HOME
├── /staff  → StaffDashboard ✅  | perm: (none) | roles: all staff
```

### TRANSACTIONS
```
TRANSACTIONS
├── Policy Transactions   /staff/policies          → StaffPolicies ✅  | read:policy   | agentOnly
├── Funeral Files         /staff/funerals           → StaffFunerals ✅  | read:funeral_ops | exec,mgr,admin,claims,fleet,driver
├── Society Transactions  /staff/transactions/society    🚧 | (none, agentHidden)
├── Tombstone Transactions/staff/transactions/tombstone  🚧 | (none, agentHidden)
├── Quotations            /staff/leads              → StaffLeads ✅    | read:lead     | exec,mgr,admin,agent
├── Invoices              /staff/transactions/invoices   🚧 | (none, agentHidden)
├── Credit Notes          /staff/transactions/credit-notes 🚧 | (none, agentHidden)
└── Fax                   /staff/transactions/fax        🚧 | (none, agentHidden)
```

### FINANCE  *(all point to the one StaffFinance page via ?tab=)*
```
FINANCE → /staff/finance → StaffFinance ✅
├── Receipts & Payments   ?tab=payments      | read:finance OR read:commission
├── Mobile & Cash         ?tab=paynow        | read:finance OR read:commission
├── Group Receipt         ?tab=group-receipt | write:finance        | agentHidden
├── Cash-up Reconciliation?tab=cashups       | read:finance OR read:commission
├── Requisitions          ?tab=requisitions  | read:finance         | agentHidden
├── Expenditures          ?tab=expenditures  | read:finance         | agentHidden
├── Petty Cash            /staff/transactions/petty-cash   🚧 agentHidden
├── Bank Deposits         /staff/transactions/bank-deposits 🚧 agentHidden
├── Debit Orders          /staff/transactions/debit-orders  🚧 agentHidden
├── Commissions           ?tab=commissions   | read:commission
├── Payroll               /staff/payroll → StaffPayroll ✅ | read:payroll | exec,admin
├── Month-End Close       ?tab=month-end     | write:finance        | agentHidden
├── FX Rates              ?tab=fx-rates      | manage:settings      | agentHidden
└── Platform Fees         ?tab=platform      | read:finance         | agentHidden
```
Roles able to reach Finance at all: **read:finance** = exec, manager, administrator, cashier, agent,
claims_officer. **write:finance** (raise/close/group) = administrator, cashier.
**approve:finance** (approve requisitions) = administrator (+ Platform Owner).

### REPORTS
```
REPORTS
├── Dynamic Reports          /staff/reports          → StaffReports ✅ | read:report
├── Dynamic Reports (Generic)/staff/reports/dynamic-generic 🚧 agentHidden
├── Policy Reports           /staff/reports?section=policies → StaffReports ✅ | read:report
├── Transactional Reports    /staff/reports?section=finance  → StaffReports ✅ | read:report
├── Employee Reports         /staff/employee-reports → StaffEmployeeReports ✅ | read:report | agentHidden
└── System Issue Reports     /staff/diagnostics      → StaffDiagnostics ✅ | read:audit_log
```
read:report holders: exec, manager, administrator, cashier, agent, claims_officer, fleet_ops, staff.

### ADMINISTRATION
```
ADMINISTRATION
├── Policy Admin        /staff/policies   → StaffPolicies ✅ | read:policy | agentHidden
├── Claims Admin        /staff/claims     → StaffClaims ✅   | read:claim
├── Society Admin       /staff/admin/society      🚧 agentHidden
├── Tombstones Admin    /staff/admin/tombstones   🚧 agentHidden
├── Product Admin       /staff/products   → ProductBuilder ✅ | write:product
├── Price Book          /staff/pricebook  → StaffPriceBook ✅ | write:product
├── Invoice Items Admin /staff/admin/invoice-items 🚧 agentHidden
├── Clients / My Clients/staff/clients    → StaffClients ✅  | read:client
├── Employer Admin      /staff/groups     → StaffGroups ✅   | write:policy | agentHidden
├── Sub Group Admin     /staff/admin/sub-groups   🚧 agentHidden
├── Member Card Admin   /staff/admin/member-cards 🚧 agentHidden
├── Terminals + Cards   /staff/admin/terminals    🚧 agentHidden
├── Agent Admin         /staff/admin/agents       🚧 agentHidden
├── Broker Admin        /staff/admin/brokers      🚧 agentHidden
├── Underwriter Admin   /staff/admin/underwriters 🚧 agentHidden
├── Undertaker Admin    /staff/admin/undertakers  🚧 agentHidden
├── Branch Admin        /staff/admin/branches     🚧 agentHidden
├── User Admin          /staff/users      → StaffUsers ✅    | read:user
├── Approvals           /staff/approvals  → StaffApprovals ✅| manage:approvals
├── System Setup        /staff/settings   → StaffSettings ✅ | (none) agentHidden
└── Tenants             /staff/settings?tab=tenants → StaffSettings ✅ | create:tenant (Platform Owner)
```
write:product (Product/PriceBook/Terms) = manager, administrator. read:user/write:user = manager,
administrator; delete:user = administrator. manage:approvals = manager, administrator.

### TOOLS
```
TOOLS
├── Audit Trail        /staff/audit          → AuditLogs ✅ | read:audit_log (exec,mgr,admin)
├── Asset Register     /staff/tools/assets   → StaffAssetsRegister ✅ | read:audit_log
├── Statistics         /staff/tools/statistics       🚧 agentHidden
├── Statistical Graphs /staff/tools/statistical-graphs 🚧 agentHidden
├── SMS Tools          /staff/notifications  → StaffNotifications ✅ | read:notification (mgr read, admin write)
├── Print Policy Cards /staff/tools/print-policy-cards 🚧
├── Manage Online Claims Form /staff/tools/claims-form 🚧 agentHidden
├── Manage EasyPay     /staff/tools/easypay  🚧 agentHidden
├── Transport Companies/staff/tools/transport-companies 🚧 agentHidden
├── Contacts Manager   /staff/tools/contacts 🚧
├── Reminders          /staff/reminders      → StaffReminders ✅ | (none)
├── Order SMS & Prepaid/staff/order-services → StaffOrderServices ✅ | (none) agentHidden
└── Help Centre        /staff/help           → StaffHelpCenter ✅ | (none)
```

### CONTROL-PLANE MODE (Platform Owner with no tenant selected)
All tenant menus are suppressed; only **Home** (control-plane dashboard) + **Tenants** + **Settings**
are shown. Navigation is locked to `/staff` and `/staff/settings`.

---

## 2. Screen Inventory (Phase 2)

### 2a. Implemented STAFF screens (24)

| Screen (component) | Route | Purpose | Primary users | Key APIs | Permission |
|---|---|---|---|---|---|
| **StaffDashboard** | /staff | KPIs, charts, control-plane tenant list | all | dashboard/stats, covered-lives, revenue-trend, policy-status-breakdown, lead-funnel, lapse-retention, platform/dashboard | any |
| **StaffPolicies** | /staff/policies | Policy book: create/edit policies, members, add-ons, take payments, receipts | cashier, agent, mgr, admin | policies, clients, products, add-ons, agents, branches, payments, payment-intents, receipts | read:policy |
| **StaffClients** | /staff/clients | Client CRM + their policies | all client-facing | clients, clients/:id, policies | read:client |
| **StaffClaims** | /staff/claims | Claim register + adjudication/transition | claims_officer, mgr, admin | claims, claims/:id (transition, documents) | read:claim |
| **StaffFunerals** | /staff/funerals | Funeral case mgmt, tasks, fleet/driver dispatch | claims, fleet_ops, mgr | funeral-cases, funeral-tasks, fleet, policies, users | read:funeral_ops |
| **StaffFinance** | /staff/finance | 10-tab finance hub (see §2c) | cashier, finance, admin | payments, payment-intents, cashups, requisitions, expenditures, fx-rates, commission-ledger, groups, settlements, platform, month-end-run | read:finance/commission |
| **StaffReports** | /staff/reports | ~20 report types + exports + financial statements | mgr, exec, finance | reports/* (policy-details, finance, overdue, lapsed, income-statement, cash-flow, commissions-summary…) | read:report |
| **StaffEmployeeReports** | /staff/employee-reports | Employee/HR report exports | mgr, admin | reports/export/:type | read:report |
| **StaffLeads** | /staff/leads | Sales pipeline / quotations | agent, mgr | leads, leads/:id | read:lead |
| **StaffGroups** | /staff/groups | Employer / burial-society schemes + their policies | mgr, admin | groups, groups/:id, policies | write:policy |
| **ProductBuilder** | /staff/products | Products, versions, benefits, bundles, add-ons, age bands, T&Cs | mgr, admin | products, product-versions, benefit-catalog, benefit-bundles, add-ons, age-bands, terms | write:product |
| **StaffPriceBook** | /staff/pricebook | Price book items + cost sheets (funeral pricing) | mgr, admin | price-book, cost-sheets, funeral-cases | write:product |
| **StaffPayroll** | /staff/payroll | Payroll employees + runs/payslips | admin, exec | payroll/employees, payroll/runs | read/write:payroll |
| **StaffApprovals** | /staff/approvals | Maker-checker approval queue | mgr, admin | approvals, approvals/:id/resolve | manage:approvals |
| **StaffUsers** | /staff/users | User admin + role assignment | mgr, admin | users, roles, branches | read:user |
| **StaffSettings** | /staff/settings | Branding, RBAC, T&Cs, account, tenants | admin, Platform Owner | organizations, roles, permissions, terms, sync-permissions, switch-tenant | (none)/create:tenant |
| **StaffTenants** | /staff/tenants | (Tenant list page; also reached via settings?tab=tenants) | Platform Owner | — | create:tenant |
| **AuditLogs** | /staff/audit | Audit trail viewer | exec, mgr, admin | audit-logs | read:audit_log |
| **StaffDiagnostics** | /staff/diagnostics | Health, notification failures, unallocated payments, recent errors | admin | diagnostics/* | read:audit_log |
| **StaffNotifications** | /staff/notifications | SMS templates, broadcast, payment-automation settings/runs | admin | notification-templates, notifications/broadcast, payment-automation-* | read:notification |
| **StaffAssetsRegister** | /staff/tools/assets | Asset register | admin | (client-side/static) | read:audit_log |
| **StaffReminders** | /staff/reminders | Reminders | all | (client-side) | (none) |
| **StaffOrderServices** | /staff/order-services | Order SMS/prepaid services | admin | (client-side) | (none) |
| **StaffHelpCenter** | /staff/help | Help centre | all | (static) | (none) |

> `assets-register`, `reminders`, `order-services`, `tenants`, `help-center` showed no `/api/` calls
> in the scan — they are largely static/client-only or thin shells today.

### 2b. CLIENT portal screens (9) — `/client/*`
| Screen | Route | Purpose | APIs (client-auth) |
|---|---|---|---|
| ClientLogin | /client/login | Email/password or Google login | client-auth/login, me |
| ClientResetPassword | /client/reset-password | Password reset via security Qs | client-auth/reset-password |
| ClientClaim | /client/claim | Public claim submission / enrollment | client-auth/claim, enroll |
| ClientDashboard | /client | Policies, dependents, credit balance, notifications, settings | client-auth/policies, dependents, credit-balance, credit-notes, notifications, settings |
| ClientPayments | /client/payments | Pay premiums (PayNow), groups, receipts, lookup-by-phone | client-auth/payment-intents, paynow-config, my-groups, group-receipt, receipts |
| ClientClaims | /client/claims | View/track claims | client-auth/claims, policies |
| ClientDocuments | /client/documents | Policy documents list | client-auth/policies |
| ClientDocumentView | /client/documents/view/:policyId | View a policy document | client-auth/policies/:id |
| ClientFeedback | /client/feedback | Submit feedback | client-auth/feedback |

### 2c. StaffFinance internal tabs (one screen, 10 tabs)
`payments` (Payments & Receipts), `paynow` (Mobile & Cash), `cashups`, `commissions`,
`requisitions`, `fx-rates`, `expenditures`, `platform` (Platform Fees), `month-end`, `group-receipt`.
Tabs are permission/role gated inside the page (e.g. commissions needs read:commission; fx-rates
needs manage:settings; month-end & group-receipt need write:finance; agents see only commissions).

### 2d. Public / auth screens
`/` Home (landing), `/staff/login`, `/agent/login`, `/agent/download`, `/join`, `/join/register`
(public policy registration from an agent referral link).

---

## 3. Business Entity Map (Phase 3)

Entities and their **actual** FK relationships (from `shared/schema.ts`). Every domain row also
carries `organization_id` (tenant scope) and usually `branch_id`; those are omitted below for clarity.

| Entity | What it is / why | Key foreign keys (discovered) |
|---|---|---|
| **Organization** | Tenant (insurer/society). Root of all scoping. | — (root) |
| **Branch** | Office within a tenant. | → organization |
| **User** | Staff/agent account (Google OAuth). | → organization, branch |
| **Role / Permission** | RBAC. roles↔permissions via role_permissions; users↔roles via user_roles (branch-scoped); user_permission_overrides per user. | role→org; user_roles→user,role,branch; overrides→user,permission |
| **Client** | Policyholder / payer. | → organization, branch, **agent (user)**, **group**, beneficiaryDependent |
| **Dependent** | A person under a client (spouse, child…), used as beneficiary or covered life. | → client; change requests → reviewedBy(user) |
| **Product / ProductVersion** | Insurance product + versioned config (pricing, benefits). | versions → product |
| **Benefit catalog / bundles / add-ons / age bands** | Building blocks of product pricing. | bundles↔products; add-ons, age bands → product version |
| **Policy** | The core contract. | → **client**, **agent(user)**, **group**, branch, beneficiaryDependent |
| **PolicyMember** | A covered life on a policy (client or dependent). | → policy, client, dependent |
| **PolicyStatusHistory / PremiumChanges / CreditBalances / AddOns** | Policy lifecycle & money state. | → policy |
| **PaymentIntent** | A PayNow/cash collection attempt (state machine). | → policy/client/branch |
| **PaymentTransaction** | A recorded payment against a policy. | → **policy**, **client**, branch, recordedBy(user) |
| **Receipt / PaymentReceipt** | Proof of a payment. | → policy, client, paymentIntent, issuedBy(user), monthEndRun |
| **Cashup** | Daily cash reconciliation (state machine). | → branch, submittedBy/confirmedBy(user) |
| **MonthEndRun** | Batch premium collection from a bank file. | receipts → monthEndRun; runBy(user) |
| **CreditNote / ReversalEntry** | Negative/correcting financial entries. | → policy/transaction |
| **Claim** | A claim filed against a policy. | → **policy**, **client**, submittedBy/verifiedBy/approvedBy(user) |
| **FuneralCase** | Operational handling of a death event. | → **claim**, **policy**, removal/burial Vehicle(fleet), removal/burial Driver(user), attendingAgent(user) |
| **FuneralTask** | A task within a funeral case. | → funeralCase, filledBy(user) |
| **FuneralQuotation / QuotationItem** | Priced quote for funeral services. | items → quotation, priceBookItem; quotation → funeralCase |
| **ServiceReceipt** | Cash-service income receipt (funeral). | → funeralCase, funeralQuotation, issuedBy(user) |
| **PriceBookItem / CostSheet / CostLineItem** | Funeral/service pricing catalog & costing. | line items → costSheet, priceBookItem |
| **Group** | Employer scheme / burial society. | → initiatedByClient, initiatedByUser; **policies → group** |
| **GroupPaymentIntent / Allocation** | Bulk group payment + split across policies. | allocations → intent, policy |
| **Settlement / SettlementAllocation** | Settling collected group money to the org. | allocations → settlement |
| **CommissionPlan / CommissionLedgerEntry** | Agent earnings. | ledger → **policy**, **transaction (paymentTransaction)**, sourceTransaction, user(agent) |
| **PlatformReceivable** | Revenue POL263 (platform) is owed by a tenant. | → organization |
| **PayrollEmployee / PayrollRun / Payslip** | Staff payroll. | payslips → run, employee |
| **Lead** | A sales prospect (pipeline, state machine). | → **agent(user)**, **client** (on conversion) |
| **ClientFeedback** | Feedback/complaints. | → client |
| **Requisition** | Internal expenditure request (maker-checker). | → requestedBy/approvedBy/paidBy(user) |
| **Expenditure** | An operating expense. | → organization/branch |
| **NotificationTemplate / Log** | SMS/notification content + delivery log. | log → template |
| **PaymentAutomationSettings / Runs** | Automated reminder/collection runs. | runs → settings |
| **ApprovalRequest** | Generic maker-checker item. | → org, requester |
| **TermsAndConditions** | Versioned product T&Cs. | → productVersion |
| **AuditLog** | Immutable change record. | → actor(user) |
| **OutboxMessage** | Transactional outbox for async side-effects. | → org |
| **AppRelease / AppDownloadInterest** | Mobile app distribution. | → org |
| **SecurityQuestion** | Client auth recovery. | referenced by client auth |

### Discovered relationship chains (from FKs, not assumed)

**Revenue / sales chain**
```
Lead ──(converts, lead.clientId)──▶ Client ──(client.id)──▶ Policy ──(policy.id)──▶
PaymentTransaction ──(transaction.id)──▶ CommissionLedgerEntry
                          │
                          └──▶ Receipt (proof)            Policy ──▶ PaymentIntent (collection attempt)
```
Agent (User) is attached at every step: Lead.agentId, Client.agentId, Policy.agentId,
CommissionLedgerEntry.userId.

**Claim / funeral chain**
```
Policy ──▶ Claim ──▶ FuneralCase ──▶ FuneralTask
                         │
                         ├──▶ FuneralQuotation ──▶ QuotationItem ──▶ PriceBookItem
                         ├──▶ ServiceReceipt (cash-service income)
                         └──▶ Fleet Vehicle + Driver (removal & burial dispatch)
```

**Group / society chain**
```
Group ──◀── Policy (policy.groupId)        Group ──▶ GroupPaymentIntent ──▶ GroupPaymentAllocation ──▶ Policy
                                                                   │
                                                                   └──▶ Settlement ──▶ SettlementAllocation
```

**Membership chain**
```
Client ──▶ Dependent              Policy ──▶ PolicyMember ──▶ (Client | Dependent)   [covered lives]
```

---

## 4. Workflow Discovery (Phase 4)

State machines are defined as enums in `shared/schema.ts`; transition endpoints live in
`server/routes.ts`.

### 4.1 Lead → Policy (sales)
- **Stages** (`LEAD_STAGES`): captured → contacted → quote_generated → application_started →
  submitted → approved → activated → lost.
- **Screens:** StaffLeads (pipeline), StaffPolicies (conversion), public `/join/register` (agent link).
- **Roles:** agent (write:lead, write:policy), manager. **Outcome:** Lead.clientId set, Policy created.
- **APIs:** `/api/leads` (POST/PATCH), `/api/policies` (POST). **Tables:** leads, clients, policies.

### 4.2 New Policy
- **Start:** StaffPolicies "new policy" (or public registration). **Steps:** pick client → product
  version → members/dependents → add-ons → premium (auto-calc; override needs `edit:premium`) → save
  (status `inactive`) → first payment activates.
- **Status** (`POLICY_STATUSES`): inactive → active → grace → lapsed → cancelled (transition via
  `POST /api/policies/:id/transition`). **Tables:** policies, policy_members, policy_add_ons,
  policy_status_history.

### 4.3 Receipting / Payment
- **Cash/manual:** `POST /api/payments` (requireAnyPermission across receipt:* perms) → PaymentTransaction
  → Receipt generated → policy status may transition (`applyPaymentToPolicy`).
- **PayNow (mobile/card):** PaymentIntent created → initiate → OTP → poll (`PAYMENT_INTENT_STATUSES`:
  created → pending_user → pending_paynow → paid/failed/cancelled/expired) → on `paid`, receipt + policy update.
- **Roles:** cashier, agent (mobile/transfer), manager, admin. **Screens:** StaffPolicies, StaffFinance.

### 4.4 Cash-up
- **Status** (`CASHUP_STATUSES`): draft → submitted → confirmed → discrepancy. Cashier submits,
  supervisor confirms. **Screen:** StaffFinance (cashups tab). **Tables:** cashups.

### 4.5 Month-End Close
- Upload bank file → `POST /api/month-end-run` → batch receipts created against overdue policies →
  policies transition. **Permission:** write:finance. **Tables:** month_end_runs, receipts, policies.

### 4.6 Claim Registration → Settlement
- **Status** (`CLAIM_STATUSES`): submitted → verified → approved → scheduled → payable → completed →
  paid → closed (or rejected). `POST /api/claims/:id/transition`. **Approval:** approve:claim
  (manager, claims_officer, admin) = maker-checker. **Screen:** StaffClaims. **Tables:** claims,
  claim_status_history, claim_documents.

### 4.7 Funeral Case Management
- Claim spawns a FuneralCase → assign tasks, dispatch removal/burial vehicle + driver → quotation
  (FuneralQuotation + items priced from PriceBook) → service receipts for cash services → completion.
- **Roles:** claims_officer, fleet_ops (write:funeral_ops), driver (read-only). **Screen:** StaffFunerals,
  StaffPriceBook.

### 4.8 Requisition Approval (maker-checker)
- **Status** (`REQUISITION_STATUSES`): draft → submitted → approved/rejected → paid.
- Raise (write:finance) → approve/reject (**approve:finance** OR Platform Owner) → mark paid.
- **Screen:** StaffFinance (requisitions tab). **Tables:** requisitions. **API:** `/api/requisitions` (PATCH action=submit|approve|reject|pay).

### 4.9 Commission Processing
- A confirmed PaymentTransaction generates a CommissionLedgerEntry per the agent's CommissionPlan
  (links policy + transaction + agent). **Screen:** StaffFinance (commissions tab), reports
  `commissions-summary`. **Roles:** read:commission (agent sees own); write:commission (admin).

### 4.10 Group / Society Collection
- Group created → policies attached (policy.groupId) → GroupPaymentIntent collects in bulk →
  GroupPaymentAllocation splits across member policies → Settlement reconciles to the org.
- **Screens:** StaffGroups, StaffFinance (group-receipt tab), Client portal (my-groups, group-receipt).

### 4.11 Payroll
- Define PayrollEmployees → create PayrollRun → generate Payslips. **Permission:** write:payroll
  (admin). **Screen:** StaffPayroll.

### 4.12 Approvals (generic)
- ApprovalRequests surface in StaffApprovals; resolve via `/api/approvals/:id/resolve`
  (manage:approvals). Settlements also route through approval (`settlements/:id/approve`).

---

## 5. Duplicate / Overlapping Concept Analysis (Phase 5)

| Pair | Actually different? | Finding (from code) |
|---|---|---|
| **Lead vs Client** | **Different, sequential.** | `leads` is a pipeline record with `LEAD_STAGES`; on conversion `lead.clientId` points to a created `clients` row. A lead is a *prospect*; a client is a *real party with policies*. **But the UI conflates them:** "Quotations" (Transactions) and "Leads" page both = StaffLeads; the dashboard card is labelled "Leads & Clients" as one number. |
| **Client vs Policy Member** | **Different.** | `clients` are parties; `policy_members` are covered lives on a specific policy and can be a client *or* a dependent. A client can be a member of several policies. |
| **Dependent vs Beneficiary vs Member** | **Overlapping roles of one entity.** | `dependents` belong to a client. The same dependent may be a *beneficiary* (`policy.beneficiaryDependentId`) and/or a *covered life* (`policy_members.dependentId`). Three words, one underlying table used in different roles. |
| **Payment vs Receipt** | **Different.** | `payment_transactions` = the money event; `receipts`/`payment_receipts` = the document proving it. PayNow adds a third, `payment_intents` (the *attempt*, before money). Three tables in the money path. |
| **Receipts vs payment_receipts** | **Likely redundant.** | Two near-identical receipt tables exist (`receipts` and `payment_receipts`) with overlapping FKs (policy, client, paymentIntent, issuedBy, monthEndRun). Worth confirming which is authoritative. |
| **Claim vs Funeral Case** | **Different, sequential.** | `claims` is the financial/insurance claim; `funeral_cases` is the operational handling (logistics, fleet, tasks) and references the claim + policy. One claim → one funeral case. |
| **Agent vs Broker** | **Cannot confirm a code-level difference.** | "Agent" is a `users` row with the `agent` role (agentId FKs everywhere; there's a referral-link + agent app). "Broker Admin" is a **stub** (`StaffComingSoon`) with no table — broker is currently a *planned* concept, not modelled. |
| **Group vs Employer Scheme vs Burial Society vs Sub Group** | **One entity, many labels.** | All map to the `groups` table. Menus call it "Employer Admin" (Administration) and the page is StaffGroups; "Sub Group Admin" is a stub. "Society Admin/Transactions" stubs likely also mean groups. |
| **Quotations (sales) vs Funeral Quotations** | **Different.** | "Quotations" menu → StaffLeads (sales pipeline). `funeral_quotations` are priced service quotes inside a funeral case. Same word, two unrelated features. |
| **Expenditure vs Requisition** | **Different but adjacent.** | `requisitions` = a *request* to spend (maker-checker, ends in `paid`); `expenditures` = a recorded operating expense. A paid requisition is conceptually an expenditure; relationship is not enforced by FK. |
| **Transactions menu vs Finance menu** | **Overlap.** | Several "Transactions" items are financial (petty cash, bank deposits, debit orders now under Finance) and most are stubs; "Funeral Files" and "Quotations" are operational. The boundary is not entity-driven. |

---

## 6. User Journey Analysis (Phase 6)

Click counts are *navigation depth to the screen* (login → land → menu → item); in-screen task
clicks vary.

| Role | Most common daily tasks | Screens visited | Typical nav path | Code-visible friction |
|---|---|---|---|---|
| **Cashier** | Receipt payments, daily cash-up | StaffPolicies, StaffFinance | Home → Finance → Receipts/Cash-up; or Policies → take payment | Lands on analytics dashboard (no receipting action); Finance opens on Payments tab; cash-up is a sub-tab. Cannot raise/approve requisitions (no write beyond finance is limited). |
| **Agent** | New lead, new policy, take mobile payment, check commission | StaffLeads, StaffPolicies, StaffFinance(commissions) | Home → Transactions → Quotations; Home → Policies | `agentOnly`/`agentHidden` flags hide most menus; agent sees a trimmed set. Commission is buried as a Finance tab. |
| **Branch Manager** | Approve claims/requisitions, monitor collections/lapse, manage users | StaffApprovals, StaffClaims, StaffDashboard, StaffUsers, StaffReports | Home → Administration → Approvals/Users; Reports | Approvals and Requisitions live in different places (Administration vs Finance). |
| **Claims Officer** | Register/adjudicate claims, manage funeral cases | StaffClaims, StaffFunerals | Home → Administration → Claims Admin; Transactions → Funeral Files | Claims under "Administration", funerals under "Transactions" — split mental model. |
| **Finance Officer** | Requisitions, expenditures, month-end, FX, statements | StaffFinance, StaffReports | Home → Finance → (tab) | All work is tabs inside one page; no write:finance ⇒ cashier-level only unless admin. Note: there is **no seeded "finance officer" role** (see §8). |
| **Executive** | Read KPIs & reports | StaffDashboard, StaffReports | Home; Reports | Read-only everywhere; dashboard is well-suited. |
| **Administrator** | Everything: setup, RBAC, products, finance approve | All | Administration, Settings, Finance | Largest menu surface; many Administration items are stubs. |

---

## 7. Information Architecture Audit (Phase 7) — findings only

| Menu | Why it exists / business purpose | What breaks if removed | Notes |
|---|---|---|---|
| **Home** | Landing KPIs / control-plane tenant switch | Lose at-a-glance metrics & tenant entry | Real, used by exec/mgr |
| **Transactions** | Intended day-to-day operational entry | Funeral Files, Quotations would lose a home (Policies has its own) | **6 of 8 items are stubs**; only Funerals & Quotations are real |
| **Finance** | All money operations (10 tabs + payroll) | Receipting, requisitions, cash-up, commissions unreachable | Real and heavily used; everything is one page + tabs |
| **Reports** | Reporting & financial statements | Lose all reporting/exports | Real; 1 stub (dynamic-generic) |
| **Administration** | Setup + reference data + access | Products, Users, Claims, Clients, Groups, Approvals would be unreachable | **11 of 21 items are stubs**; mixes daily ops (Claims, Clients) with rare setup |
| **Tools** | Utilities | Audit, SMS, Assets, Help would be unreachable | **7 of 13 items are stubs** |

**Duplicated menu destinations (same route, ≥2 entries):**
- `/staff/policies` → "Policy Transactions" (Transactions, agentOnly) **and** "Policy Admin" (Administration, agentHidden).
- `/staff/finance` → reached from Finance (many tabs), and historically Tools/Transactions.
- `/staff/settings` → "System Setup" **and** "Tenants" (`?tab=tenants`).

**Daily-use items:** Dashboard, Policies, Clients, Finance (receipts/cash-up), Claims, Funerals,
Leads. **Configuration-only:** Products, Price Book, Users, Settings, FX Rates, Notification
templates, T&Cs. **Rarely-used / not-yet-built:** every 🚧 stub, Platform Fees, App releases,
Statistics graphs, EasyPay, Transport Companies.

---

## 8. Permission Matrix (Phase 8)

### 8.1 Role → permissions (seeded, `ROLE_PERMISSION_MAP`)
- **superuser:** `[]` in the map — **special-cased to all permissions within its tenant** (empty list is a sentinel).
- **executive:** all `read:*` across org (no writes).
- **manager:** broad read + write policy/claim/client/product/branch/user/lead/fleet; approve:claim;
  manage:settings; manage:approvals; receipts (cash/mobile/transfer/group); view:all_clients. **No** finance write/approve, **no** payroll, **no** delete, **no** commission write.
- **administrator:** superset of manager + write:finance, approve:finance, delete:policy/payment/receipt,
  edit:payment/receipt, backdate:payment, write:commission, read/write:payroll, write:role,
  manage:permissions, write:notification, write:organization, delete:user.
- **cashier:** read:policy/client/finance/report; **write:finance**; all receipt:* . (No policy write, no approve.)
- **agent:** read/write policy, read/write client (own), read:product, read/write lead, read:commission,
  read:report, read:finance, receipt:mobile/transfer. (No cash receipt, no approve, own clients only.)
- **claims_officer:** read:policy, read/write/approve claim, read:client, read/write funeral_ops, read:finance, read:report.
- **fleet_ops:** read/write fleet, read/write funeral_ops, read:report.
- **driver:** read:funeral_ops, read:fleet (read-only field role).
- **staff:** minimal read set (org, branch, policy, claim, client, product, funeral_ops, report).
- **Platform Owner** (not a role — account by email): all permissions + create:tenant, delete:tenant,
  manage:whitelabel; can switch tenants.

### 8.2 Role → permission → menu → screen → action (representative)
```
CASHIER
  read:finance  → Finance → StaffFinance → view payments/cashups
  write:finance → Finance → StaffFinance → create cash-up, (raise requisition)
  receipt:cash/mobile/transfer/group → Policies/Finance → take payment, issue receipt
  read:policy/client → Policies/Clients → look up policy/client
  ✗ cannot approve requisitions (no approve:finance), cannot edit/delete payments

CLAIMS_OFFICER
  read/write/approve:claim → Administration→Claims Admin → StaffClaims → register, transition, approve
  read/write:funeral_ops → Transactions→Funeral Files → StaffFunerals → tasks, dispatch
  read:finance → Finance → view only

AGENT
  read/write:lead → Transactions→Quotations → StaffLeads → manage pipeline
  read/write:policy(own) → Policies → new policy
  read:commission → Finance(commissions tab) → own earnings
  receipt:mobile/transfer → take mobile payment
  (agentHidden hides Administration setup, society/group, etc.)
```

### 8.3 Overlaps, conflicts, unused
- **Overlap:** manager and administrator share most read/write; the practical difference is
  **finance write/approve, payroll, deletes, commission write, RBAC management** (admin-only).
- **Receipts:** cashier, agent, manager, administrator all hold receipt permissions → multiple roles
  can receipt (expected for a collections business).
- **No seeded "Finance Officer" role** despite being a target persona — finance work today requires
  **administrator** (for write/approve) or **cashier** (limited). Gap between intended roles and seeded roles.
- **Potentially unused / under-exercised permissions:**
  - `delete:tenant`, `create:tenant` — Platform Owner only; not in any tenant role.
  - `write:commission`, `read/write:payroll` — administrator only; payroll screen is thin.
  - `manage:permissions` — only surfaced in Settings RBAC + `/api/admin/sync-permissions`.
  - `read:fleet` for **driver** has no dedicated screen in the implemented set (fleet appears inside
    StaffFunerals); driver role has no portal of its own.
- **manage:settings** gates FX rate writes and payment-automation — held by manager+admin, but the
  FX tab is `agentHidden` and buried.

---

## 9. Final Knowledge Base (Phase 9) — Index

1. **Menu hierarchy** → §1 (6 top-level menus; ~24 real screens; ~36 stub routes).
2. **Screen inventory** → §2 (24 staff + 9 client + public/auth; Finance = 1 page/10 tabs).
3. **Entity map** → §3 (43 conceptual entities over 81 tables; all org-scoped).
4. **Workflow map** → §4 (12 workflows; 6 state machines: policy, claim, lead, payment-intent,
   cashup, requisition).
5. **Role map** → §8.1 (9 seeded roles + Platform Owner; superuser = all-in-tenant sentinel).
6. **Permission map** → §8 (54 permissions, 20 categories; admin = widest tenant role).
7. **Route inventory** → §1 + the ~226 API endpoints in `server/routes.ts` (every domain section
   listed). All staff routes use `requireAuth → requireTenantScope → requirePermission/AnyPermission`.
8. **Relationship diagram** → §3 chains (revenue, claim/funeral, group, membership).
9. **Duplicate concept analysis** → §5 (11 pairs; key real duplicates: receipts vs payment_receipts;
   group vs employer/society/sub-group labels; lead/client UI conflation; dependent=beneficiary=member).
10. **Navigation dependency analysis** → §7 (duplicate destinations; stub-heavy Administration/Tools/
    Transactions; daily vs config vs not-built classification).

### Cross-cutting facts a new operator must know
- **Tenancy:** every query is scoped by `organization_id`; some tenants run on an isolated DB
  (`organizations.databaseUrl`) coordinated by a control plane. Platform Owner can switch tenants.
- **Money is idempotent & polled:** PayNow has no webhooks; intents are polled to `paid`.
- **Everything mutating is audited:** `audit_logs` stores before/after JSONB with a request id.
- **Async side-effects** go through an outbox + job queue (`outbox_messages`).
- **Maker-checker** is enforced for claims (`approve:claim`), finance/requisitions (`approve:finance`),
  and settlements (`manage:approvals`).
- **The agent has a native app** (Capacitor) + referral links + public `/join/register`.

---

*Discovery complete. No redesign proposed. Awaiting further instructions.*
