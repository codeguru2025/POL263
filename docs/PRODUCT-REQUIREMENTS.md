# POL263 – Product Requirements Document (PRD)

**Product name:** POL263 – Insurance Policy Management System  
**Version:** 1.0  
**Purpose:** Defines product scope, user roles, features, and acceptance criteria for testing and development.

---

## 1. Product overview

POL263 is a multi-tenant, web-based **insurance policy management platform**. It supports:

- **Staff/administrators** (Google SSO): full configuration, policies, claims, finance, and reporting.
- **Agents** (email/password): scoped access to their own clients, policies, commissions, and referral links.
- **Clients/policyholders** (policy number + password): view coverage, pay premiums, view documents, submit claims and feedback.

The app is **whitelabelable** per tenant (name, logo, colors). When not whitelabeled, the default brand is POL263. The system enforces **role-based access control (RBAC)** so agents see only their own data.

---

## 2. User roles and personas

| Role | Description | Auth | Scope |
|------|-------------|------|--------|
| **Platform owner** | Manages multiple tenant organizations; can switch tenants and manage tenant list. | Google | All tenants |
| **Staff** | Back-office: policies, clients, claims, finance, reports, settings. Permissions vary by role. | Google | Single tenant (or selected tenant) |
| **Agent** | Field agents: own clients, issue policies, referral links, commissions. Data restricted to own records. | Email + password | Single tenant, agent-scoped |
| **Client** | Policyholder: view policy, pay premiums, documents, claims, feedback. | Policy number + password | Own policies only |

---

## 3. Entry points and portals

- **Home (landing):** `/` – Logo, tagline, three portal cards: Staff Portal, Agent Portal, Client Portal. Theme switcher. Footer with CHIBIKHULU + “Infinite Versatility”.
- **Staff Portal:** `/staff/login` → Google sign-in → Dashboard at `/staff`.
- **Agent Portal:** `/agent/login` → Email/password → Same app at `/staff` with agent-scoped menu and data.
- **Client Portal:** `/client/login` → Policy number + password → Client dashboard at `/client`.

All portals must show the correct logo (tenant logo when whitelabeled, otherwise POL263 default).

---

## 4. Staff / Agent portal – core features

### 4.1 Authentication

- **Staff:** Google OAuth; only pre-registered emails can sign in. Redirect to `/staff` on success.
- **Agent:** Email + password (set by admin). Redirect to `/staff` on success. No Google.
- Session persistence; logout clears session and redirects to home or login.
- **Acceptance:** Invalid credentials show error; valid login lands on dashboard; logout returns to home or login.

### 4.2 Dashboard (`/staff`)

- **Metrics (RBAC):** Total policies, active policies, covered lives, clients/leads, claims, funeral cases, lead conversion, transactions, retention/lapse. For **agents**, all counts and charts are scoped to that agent’s data only.
- **Charts (when permitted):** Revenue trend, policy status breakdown, lead funnel (non-agent), lapse & retention, product performance. Filters: date range, status, branch (non-agent).
- **Referral link (agents):** Display and copy referral link for client sign-up.
- **Acceptance:** Dashboard loads without error; numbers and charts reflect correct scope (org-wide for staff, agent-only for agents).

### 4.3 Policies (`/staff/policies`)

- List policies with filters (search, status, branch, client, product). Create and edit policies; assign client, product version, premium, schedule, agent, branch.
- Policy lifecycle: inactive → active (e.g. on first payment), grace, lapsed, cancelled. Status history and reinstatement.
- Policy members (dependents/beneficiaries); add-ons. Generate policy document PDF.
- **Acceptance:** CRUD works; list respects RBAC for agents; PDF generates with tenant logo/signature when configured.

### 4.4 Leads & clients (`/staff/clients`, `/staff/leads`)

- **Clients:** List clients (agent sees only own). Create client; link to policies and leads. Search and filters.
- **Leads:** Lead pipeline with stages (lead, captured, contacted, quote_generated, application_started, submitted, approved, agreed_to_pay, activated, lost). Agent-scoped.
- **Acceptance:** Agents see only their clients and leads; staff see org-wide (subject to permissions).

### 4.5 Claims (`/staff/claims`)

- List claims; filter by status, policy. Create claim; link to policy; upload documents; status workflow.
- **Acceptance:** Claims list and create; documents upload; status updates.

### 4.6 Funeral operations (`/staff/funerals`)

- Funeral cases list; fleet vehicles and tasks. Case management and task tracking.
- **Acceptance:** Cases and tasks viewable and manageable by users with `read:funeral_ops` / `write:funeral_ops`.

### 4.7 Finance (`/staff/finance`)

- Payment transactions, receipts, allocations. Commissions for agents (agent sees own only). Cashups, price book, payroll, reports.
- **Acceptance:** Finance views and reports respect RBAC; agents see only own commissions and related payments.

### 4.8 Reports (`/staff/reports`)

- Multiple report types: policy details, finance, reinstatements, conversions, activations, active/lapsed/overdue policies, cashups, receipts, etc. Export CSV. All reports must be **agent-scoped** when user is agent.
- **Acceptance:** Report data restricted to agent’s data when logged in as agent; exports succeed and respect RBAC.

### 4.9 Configuration

- **Products (`/staff/products`):** Product builder; versions; benefit catalog; add-ons; age bands; terms.
- **Notifications (`/staff/notifications`):** Templates and notification settings.
- **Settings (`/staff/settings`):** Tenant settings, whitelabel (name, logo, primary color), branches, footer text, signature, etc. User management and roles. Tenants (platform owner).
- **Acceptance:** Settings save correctly; logo/whitelabel apply on next load; tenant switch (platform owner) works.

### 4.10 System & audit

- **Approvals** (`/staff/approvals`): Pending approval requests; approve/reject.
- **Audit logs** (`/staff/audit`): View audit trail by entity and action.
- **Diagnostics** (`/staff/diagnostics`): Health, errors, unallocated payments (agent-scoped when applicable).
- **Acceptance:** Audit and diagnostics load; diagnostics counts respect agent scope.

---

## 5. Client portal

### 5.1 Authentication

- Login with **policy number** and **password**. Forgot password flow. Redirect to `/client` on success.
- **Acceptance:** Invalid credentials show error; valid login lands on client dashboard.

### 5.2 Client dashboard (`/client`)

- Overview: policies, next payment, balances, credit notes, notifications. Navigation: Overview, Pay, Documents, Claims, Complaints & feedback.
- **Acceptance:** Client sees only own policies and payments; navigation works.

### 5.3 Payments (`/client/payments`)

- View payment history; pay premium (e.g. card, PayNow, other methods). Payment intents and status.
- **Acceptance:** Payment history loads; initiate payment flow completes or shows clear error.

### 5.4 Documents (`/client/documents`)

- List documents by policy; view document (e.g. policy PDF).
- **Acceptance:** Documents list and view work for client’s policies only.

### 5.5 Claims (`/client/claims`)

- List and submit claims; link to policy.
- **Acceptance:** Client can submit and view own claims.

### 5.6 Feedback (`/client/feedback`)

- Submit complaints/feedback.
- **Acceptance:** Submission succeeds and is stored.

### 5.7 Claim policy (`/client/claim`)

- Public flow (with optional referral): claim a policy (e.g. by activation code or registration). May require security questions.
- **Acceptance:** Claim flow completes or shows validation errors.

---

## 6. Join and registration

- **Join (`/join`):** Landing for referral or generic join; links to Client Login and Claim Policy. Optional referral code in URL.
- **Register (`/join/register`):** Full registration with product/branch selection, client details, dependents, beneficiary, payment. Referral code preserved.
- **Acceptance:** Join and register pages load; registration flow can complete with valid data; referral code is passed and stored.

---

## 7. Cross-cutting requirements

- **RBAC:** Every list, report, and dashboard metric must respect role: agents see only data tied to their user id (policies, clients, leads, claims, commissions, etc.). No cross-agent data leakage.
- **Whitelabel:** When tenant has whitelabel enabled, app shows tenant name and logo (and optional primary color) on login and in-app. Default when not whitelabeled: POL263 branding.
- **Responsive UI:** Layout works on desktop and mobile; navigation and forms are usable.
- **Errors:** API and client errors show clear messages; no uncaught exceptions that break the whole page. Error boundary does not auto-dismiss errors after a short delay.
- **Icons & branding:** Favicon and PWA icon use the configured app logo (default POL263). Footer shows CHIBIKHULU logo and “Infinite Versatility” (cursive, italic) across the app.

---

## 8. Technical context

- **Stack:** React 19, Vite, TypeScript, Express, PostgreSQL (Drizzle ORM). Optional Capacitor for native iOS/Android.
- **Auth:** Passport (Google for staff; local strategy for agent and client). Session-based; cookies.
- **API:** REST; JSON. Auth required for most endpoints; tenant and permission checks on each request.
- **Default URL:** `http://localhost:5000` in development. Single-page app with client-side routing (e.g. wouter).

---

## 9. Acceptance criteria summary

1. **Login:** Staff (Google), Agent (email/password), Client (policy + password) all authenticate and land on correct dashboard.
2. **RBAC:** Agents see only their own data everywhere (dashboard, policies, clients, leads, claims, finance, reports).
3. **Policies:** Create, edit, list, filter; status lifecycle; PDF generation; members and add-ons.
4. **Payments:** Record and display payments; client can pay premium; methods and status clear.
5. **Claims:** Create and list claims; client can submit; documents attach.
6. **Reports:** All report types return data consistent with RBAC; export works.
7. **Settings:** Tenant, whitelabel, users, branches, and app settings save and take effect.
8. **UI:** No full-page error flash that auto-recovers; lazy routes retry on chunk load failure; footer present on all main layouts.
9. **Whitelabel:** Tenant logo/name appear when enabled; otherwise POL263 default.

This PRD is intended for TestSprite and QA to generate and run frontend and backend tests against POL263.
