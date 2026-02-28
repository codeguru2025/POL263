# POL263 — Comprehensive Application Specification

## 1. What This Application Is

POL263 is a **multi-tenant funeral/life insurance Policy Management System (PMS)** built as a full-stack web + mobile application. It serves insurance organizations ("tenants") that sell funeral cover and life assurance policies to clients (policyholders), manage claims when a death occurs, coordinate funeral service delivery, handle premium collections (including mobile money via PayNow), pay agent commissions, run payroll, and generate regulatory/financial reports — all from a single codebase deployed to web, Android, and iOS.

---

## 2. Architecture & Tech Stack

### Frontend
- **React 19** with **Vite 5** bundler (NOT Vite 6/7 — avoids native Rollup 4 platform binaries)
- **Tailwind CSS 3.4.x** + **PostCSS** + **autoprefixer** (classic PostCSS pipeline — do NOT use Tailwind v4, oxide, or LightningCSS)
- **shadcn/ui** component library (Radix primitives) configured for Tailwind v3 (`tailwind.config.ts` + `@tailwind` directives)
- **Wouter** for client-side routing (lightweight React Router alternative)
- **TanStack Query** (React Query) for server-state management / data fetching
- **Framer Motion** for animations
- **Recharts** for dashboard charts and report visualizations
- **Lucide React** for icons
- **react-hook-form** + **zod** for form validation
- **Capacitor** for native mobile (Android + iOS) from the same React codebase

### Backend
- **Express 5** (Node.js) HTTP server
- **TypeScript** end-to-end (shared types between client and server)
- **Drizzle ORM** with **PostgreSQL** database
- **Passport.js** — Google OAuth 2.0 for staff login; local strategy (argon2 password hashing) for client portal
- **express-session** with **connect-pg-simple** (PostgreSQL-backed sessions) or **memorystore** fallback
- **Helmet** for security headers; **express-rate-limit** for API throttling; **csurf** optional CSRF
- **PDFKit** for receipt PDF generation
- **Multer** for file uploads (claim documents, month-end bank files)
- **esbuild** for server bundle (pure-JS `esbuild-wasm` fallback if native binary unavailable); Vite 5 for client bundle

### Database
- **PostgreSQL** (Drizzle ORM)
- 50+ tables covering tenancy, identity, RBAC, clients, dependents, products, policies, payments, claims, funerals, fleet, payroll, commissions, notifications, leads, audit, approvals, and more
- Per-org sequences for policy numbers and member numbers (concurrency-safe)
- Optional per-tenant dedicated database (`databaseUrl` on organization)

### Deployment
- **DigitalOcean App Platform** (primary target)
- Build: `npm run build:do` → `npm ci --include=dev && npm run build`
- Run: `npm start` → `node dist/index.cjs`
- Port: 5000
- GitHub Actions CI for lockfile generation (Linux), web/Android/iOS builds

### Mobile
- **Capacitor 7** wraps the Vite 5-built SPA
- Android (Gradle) + iOS (Xcode/CocoaPods)
- Deep link scheme: `pol263://`
- Native payment return handling via `@capacitor/app` URL listener

---

## 3. Multi-Tenancy Model

- **Organization** = top-level tenant (e.g., "Falakhe Funeral Services")
  - Has: name, logo, signature, primary color, footer text, address, phone, email, website
  - Custom policy number prefix + padding (e.g., `FAL-00001`)
  - Optional dedicated `databaseUrl` for full data isolation
- **Branch** = sub-division of an Organization (e.g., "Harare Branch", "Head Office")
- Every major table has `organization_id`; many also have `branch_id`
- All API queries are scoped to the authenticated user's `organizationId`
- Middleware: `requireTenantScope` enforces tenant isolation on every request

---

## 4. Authentication & Authorization

### Staff Authentication (Google OAuth)
- Staff log in via **Google OAuth 2.0 / OIDC** — no passwords
- On first Google login, user is created and auto-assigned to the default organization
- `SUPERUSER_EMAIL` env var gets auto-promoted to superuser role
- Session stored in PostgreSQL (`connect-pg-simple`) or memory

### Client Authentication (Password + Security Question)
- Clients (policyholders) log in with **national ID + password**
- First-time enrollment: client receives an **activation code** (6-char), sets password + security question
- Password hashed with **argon2**
- Account lockout after 5 failed attempts (15-minute lock)
- Password reset via security question verification

### Agent Authentication
- Agents log in with **email + password** (local strategy)
- Agents are users with the "agent" role

### RBAC (Role-Based Access Control)
**9 system roles** with **41 permissions** across 14 categories:

| Role | Description |
|------|-------------|
| **superuser** | All permissions (implicit — bypasses permission checks) |
| **administrator** | Full org management, all CRUD, approvals, backdating |
| **executive** | Read-only across all modules (dashboards, reports) |
| **manager** | CRUD on policies/claims/clients, approve claims, manage staff |
| **cashier** | Read policies/clients, write finance (receipting) |
| **agent** | Write policies/clients/leads, read commissions |
| **claims_officer** | Claims adjudication, funeral ops, read finance |
| **fleet_ops** | Fleet and funeral operations management |
| **staff** | Read-only across core modules |

**Permission categories:** organization, identity, rbac, audit, policy, claims, clients, product, settings, operations, finance, fleet, commission, payroll, reports, leads, notifications, approvals, platform

**Per-user overrides:** Individual users can have specific permissions granted or revoked beyond their role.

**Platform-level:** `create:tenant` and `delete:tenant` permissions for multi-org management.

---

## 5. Portals & Pages

### 5.1 Public Pages
| Route | Page | Description |
|-------|------|-------------|
| `/` | Home | Landing page |
| `/join` | Join | Agent referral landing with org branding |
| `/join/register` | Register | Client self-registration via agent referral link |

### 5.2 Staff Portal (`/staff/*`)
| Route | Page | Permission | Description |
|-------|------|------------|-------------|
| `/staff/login` | Login | — | Google OAuth sign-in |
| `/staff` | Dashboard | — | KPI cards, charts, recent activity |
| `/staff/clients` | Clients | read:client | Client list, search, create, edit, dependents management |
| `/staff/policies` | Policies | read:policy | Policy list, create, edit, status transitions, receipting |
| `/staff/claims` | Claims | read:claim | Claims list, submit, verify, approve, reject, status workflow |
| `/staff/products` | Products | read:product | Product builder with versions, pricing, eligibility, waiting periods |
| `/staff/pricebook` | Price Book | read:product | Funeral service items catalog with versioned pricing |
| `/staff/groups` | Groups | read:policy | Group/community management, bulk receipting, group PayNow |
| `/staff/funerals` | Funerals | read:funeral_ops | Funeral case management, tasks, cost sheets, fleet dispatch |
| `/staff/finance` | Finance | read:finance | Transactions, receipts, cashups, month-end runs, credit notes, reversals, PayNow config, expenditures |
| `/staff/leads` | Leads | read:lead | CRM-lite lead pipeline (captured → contacted → quote → application → activated) |
| `/staff/reports` | Reports | read:report | Policy, financial, claims, commission reports with CSV/Excel export |
| `/staff/payroll` | Payroll | read:payroll | Employee management, payroll runs, payslips |
| `/staff/users` | Users | read:user | Staff user management, role assignment, branch assignment |
| `/staff/notifications` | Notifications | read:notification | Notification templates (event-driven, merge tags) and delivery logs |
| `/staff/approvals` | Approvals | manage:approvals | Maker-checker approval queue (claims, finance, policy changes) |
| `/staff/settings` | Settings | manage:settings | Organization branding, terms & conditions, feature flags, security questions |
| `/staff/tenants` | Tenants | create:tenant | Multi-org management (create new tenant organizations) |
| `/staff/audit` | Audit Logs | read:audit_log | Immutable audit trail viewer with filtering |
| `/staff/diagnostics` | Diagnostics | — | System health, DB connection, session info |

### 5.3 Client Portal (`/client/*`)
| Route | Page | Description |
|-------|------|-------------|
| `/client/login` | Login | National ID + password login |
| `/client/claim` | Enroll | First-time activation (activation code → set password + security question) |
| `/client/reset-password` | Reset Password | Security question verification → new password |
| `/client` | Dashboard | Policy overview, premium status, payment history, dependents, notifications, account settings |
| `/client/payments` | Payments | Make premium payments via PayNow (EcoCash, OneMoney, InnBucks, Visa/Mastercard) |
| `/client/documents` | Documents | View/download policy documents and receipts |
| `/client/documents/view/:policyId` | Document View | View specific policy document (PDF generation) |
| `/client/claims` | Claims | View claim status, submit new death claims |
| `/client/feedback` | Feedback | Submit complaints and feedback |

### 5.4 Agent Portal (`/agent/*`)
| Route | Page | Description |
|-------|------|-------------|
| `/agent/login` | Login | Email + password login for field agents |

Agents access the staff portal with agent-scoped permissions after login. They see only their own clients, policies, leads, and commissions.

---

## 6. Core Feature Modules

### 6.1 Client Management
- Full client lifecycle: capture → enroll → manage → archive
- Fields: title, name, national ID, DOB, gender, marital status, phone, email, address, location
- Sales context fields: selling point, objections faced, responses, client feedback
- Dependents with member numbers (MEM-000001 format, per-org sequence)
- Dependent change requests (add/remove/update) with maker-checker approval
- Client portal enrollment with activation codes
- Push notification preferences and device token management

### 6.2 Product Configuration
- **Products** with codes, descriptions, casket types/images, cover amounts
- **Product Versions** for temporal pricing: monthly/weekly/biweekly premiums in USD/ZAR
- Eligibility rules: min/max age, dependent max age
- Waiting periods: standard, accidental death, suicide (in days)
- Grace period configuration
- Cash-in-lieu amounts (adult/child)
- Reinstatement rules (requires arrears? new waiting period?)
- Coverage rules and exclusions (JSONB)
- **Benefit Catalog Items** with internal cost defaults
- **Benefit Bundles** linking items to product versions
- **Add-Ons** with flat or percentage pricing
- **Age Band Configs** for age-based premium tiers

### 6.3 Policy Management
- Policy lifecycle: `draft → pending → active → grace → lapsed → reinstatement_pending → cancelled`
- Auto-generated policy numbers (org prefix + padded sequence, e.g., `FAL-00001`)
- Links to: client, product version, agent, group, branch
- Premium amount, currency, payment schedule (monthly/weekly/biweekly)
- Date tracking: effective date, inception date, waiting period end, current cycle start/end, grace end
- Policy members (principal + dependents) with unique member numbers
- Policy add-ons
- Status history with reason, changed-by tracking
- Status transitions enforced by `VALID_POLICY_TRANSITIONS` map
- Automatic activation on first premium payment
- Grace period management and lapse detection

### 6.4 Payment & Finance

#### Cash Receipting
- Manual cash receipt: record payment → create transaction → issue receipt → activate/reinstate policy
- Group batch receipting: receipt multiple policies in a group at once with proportional allocation
- Cashups: daily cash reconciliation by branch, lockable

#### PayNow Integration (Zimbabwe)
- Payment methods: EcoCash, OneMoney, InnBucks, Omari, Visa/Mastercard
- Flow: Create intent → Initiate with PayNow API → Redirect/USSD push → Poll for status → Mark paid → Issue receipt
- Idempotency keys prevent duplicate charges
- Merchant references for reconciliation
- Group PayNow: pay all policies in a group in one transaction
- Client self-service payments from the client portal
- Mobile deep link return handling (`pol263://client/payments?returned=1`)

#### Month-End Processing
- Upload bank statement CSV/Excel files
- Match transactions to policies by policy number
- Auto-receipt matched payments
- Credit notes for overpayments
- Policy credit balances for underpayments (carry forward)
- Credit balance application (apply accumulated credits to current premiums)
- Reversal entries for incorrect transactions

#### Financial Records
- Payment transactions (immutable ledger)
- Payment receipts with PDF generation (thermal 80mm format)
- Receipt numbering per organization
- Expenditure tracking by category with approval workflow
- Revenue share receivables and settlement tracking

### 6.5 Claims Processing
- Claim lifecycle: `submitted → verified → approved → scheduled → payable → completed/paid → closed` (or `rejected`)
- Claim types: death claim, with deceased details (name, relationship, date/cause of death)
- Waiting period enforcement with waiver option
- Fraud flag tracking (JSONB)
- Multi-step verification: submitted by → verified by → approved by
- Approval notes and rejection reasons
- Claim documents (upload with type classification, verification tracking)
- Claim status history with audit trail
- Client-submitted claims from the client portal

### 6.6 Funeral Operations
- Funeral cases linked to claims and policies
- Case lifecycle: `open → in_progress → completed → closed`
- Fields: case number, deceased name, funeral date/location
- SLA deadline tracking
- Task management per case (task name, description, status, assignment, due date)
- Cost sheets with line items from price book
- Fleet vehicle dispatch and driver assignment
- Integration with claims and finance modules

### 6.7 Fleet Management
- Vehicle registry: registration, make, model, year, type, status, mileage
- Vehicle statuses: available, dispatched, maintenance
- Driver assignments to vehicles and funeral cases
- Fuel logs: litres, cost, mileage tracking
- Maintenance scheduling and completion tracking

### 6.8 Agent & Commission Management
- Agents are staff users with the "agent" role
- Unique referral codes for client acquisition links (`/join?ref=CODE`)
- Agent-scoped views: see only their clients, policies, leads
- Commission plans with configurable rates:
  - First N months rate (e.g., 50% for months 1-2)
  - Recurring rate (e.g., 10% from month 5+)
  - Clawback threshold (minimum payments before commission is safe)
  - Funeral service incentive
  - Versioned with effective dates
- Commission ledger entries: earned, paid, clawed-back
- Commission reports filterable by agent, period, status

### 6.9 Lead Pipeline (CRM-Lite)
- Lead stages: `captured → contacted → quote_generated → application_started → submitted → approved → activated → lost`
- Lead fields: name, phone, email, source, notes
- Agent assignment
- Loss reason tracking
- Conversion to client/policy when activated
- Pipeline visualization and reporting

### 6.10 Groups & Community Schemes
- Group management: name, type (community/corporate/family), description
- Group executive committee: chairperson, secretary, treasurer (name/phone/email)
- Group-linked policies
- Group batch receipting (pay for all group members at once)
- Group PayNow (single payment split across group policies)
- Group payment allocations (proportional split by premium amount)

### 6.11 Payroll
- Employee registry linked to users: employee number, position, department, base salary, bank details
- Payroll runs: period start/end, status (draft/approved/paid)
- Payslips: gross amount, deductions (JSONB), net amount
- Prepared by / approved by tracking

### 6.12 Notifications
- Notification templates: event-driven (e.g., policy_activated, payment_received, claim_submitted)
- Channels: in-app, SMS, email (configurable)
- Merge tags for dynamic content (e.g., `{{client_name}}`, `{{policy_number}}`)
- Versioned templates with effective dates
- Notification logs: recipient, channel, status, delivery attempts, failure reasons
- Client notification preferences (tone, push enabled/disabled)
- Device token management for mobile push

### 6.13 Maker-Checker Approvals
- Approval requests for sensitive operations
- Request types: claim approval, finance approval, policy changes, dependent changes
- Status: pending → approved/rejected
- Initiated by / approved by tracking
- Rejection reason capture
- Queue view for approvers

### 6.14 Audit & Compliance
- Immutable audit log for all create/update/delete operations
- Captures: actor (user ID + email), action, entity type, entity ID
- Before/after JSON diffs for full change tracking
- Request ID correlation
- IP address logging
- Filterable audit log viewer in staff portal
- Structured server-side logging with request IDs

### 6.15 Tenant Settings & Configuration
- Organization branding: logo, signature, primary color, footer text
- Contact details: address, phone, email, website
- Policy number format: prefix + padding
- Terms and conditions management (categorized, ordered, versioned)
- Security questions (configurable per org)
- Feature flags (per-org feature toggles)

### 6.16 Reports & Export
- Policy reports with client, product, branch, agent details
- Financial reports: transactions, receipts, revenue
- Claims reports
- Commission reports
- Filterable by date range, branch, agent, product, status
- CSV export
- Client-facing payment history and receipt downloads

### 6.17 Diagnostics
- Database connection health check (`/api/health`)
- Session diagnostics
- System information

---

## 7. Database Schema Summary (50+ tables)

### Tenancy
`organizations`, `branches`, `org_member_sequences`, `org_policy_sequences`

### Identity & RBAC
`users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permission_overrides`

### Clients
`clients`, `security_questions`, `client_device_tokens`, `dependents`, `dependent_change_requests`

### Products
`products`, `product_versions`, `benefit_catalog_items`, `benefit_bundles`, `product_benefit_bundle_links`, `add_ons`, `age_band_configs`

### Policies
`policies`, `policy_members`, `policy_status_history`, `policy_add_ons`

### Payments & Finance
`payment_transactions`, `receipts`, `payment_intents`, `payment_events`, `payment_receipts`, `month_end_runs`, `policy_credit_balances`, `credit_notes`, `reversal_entries`, `cashups`

### Claims
`claims`, `claim_documents`, `claim_status_history`

### Funeral Operations
`funeral_cases`, `funeral_tasks`

### Fleet
`fleet_vehicles`, `driver_assignments`, `fleet_fuel_logs`, `fleet_maintenance`

### Price Book & Costing
`price_book_items`, `cost_sheets`, `cost_line_items`

### Commissions
`commission_plans`, `commission_ledger_entries`

### Revenue Share
`revenue_share_receivables`, `settlements`, `settlement_allocations`

### Payroll
`payroll_employees`, `payroll_runs`, `payslips`

### Notifications
`notification_templates`, `notification_logs`

### Leads
`leads`

### Feedback
`client_feedback`

### Finance
`expenditures`

### Approvals
`approval_requests`

### Configuration
`terms_and_conditions`, `feature_flags`

### Audit
`audit_logs`

### Groups
`groups`, `group_payment_intents`, `group_payment_allocations`

### Sessions
`sessions`

---

## 8. API Structure

All API routes are under `/api/` and use Express 5 with middleware chain:
`helmet → cookieParser → requestId → json → urlencoded → [csrf] → session → passport → routes`

### Authentication Routes
- `GET /api/auth/google` — Initiate Google OAuth
- `GET /api/auth/google/callback` — Google OAuth callback
- `GET /api/auth/session` — Get current staff session
- `POST /api/auth/logout` — Staff logout
- `POST /api/agent/login` — Agent email+password login
- `POST /api/client-auth/login` — Client national ID+password login
- `POST /api/client-auth/enroll` — Client first-time activation
- `POST /api/client-auth/reset-password` — Client password reset

### Staff CRUD Routes (all require `requireAuth`, `requireTenantScope`)
- Organizations: `GET/POST /api/organizations`, `PATCH /api/organizations/:id`
- Branches: `GET/POST /api/branches`
- Users: `GET/POST /api/users`, `PATCH /api/users/:id`, `GET /api/users/me`, `GET /api/users/agents`
- Roles & Permissions: `GET /api/roles`, `POST /api/roles`, `GET /api/permissions`, role-permission management
- Clients: `GET/POST /api/clients`, `PATCH /api/clients/:id`, dependents CRUD
- Products: `GET/POST /api/products`, versions, benefits, bundles, add-ons, age bands
- Policies: `GET/POST /api/policies`, `PATCH /api/policies/:id`, members, add-ons, status transitions
- Payments: `POST /api/payments/receipt`, `GET /api/payment-transactions`, `GET /api/payment-receipts`
- PayNow: `POST /api/payment-intents`, `POST /api/payment-intents/:id/initiate`, `POST /api/payment-intents/:id/poll`
- Claims: `GET/POST /api/claims`, `PATCH /api/claims/:id`, document upload, status transitions
- Funerals: `GET/POST /api/funeral-cases`, tasks, cost sheets
- Fleet: `GET/POST /api/fleet-vehicles`, driver assignments, fuel logs, maintenance
- Groups: `GET/POST /api/groups`, group receipting, group PayNow
- Leads: `GET/POST /api/leads`, `PATCH /api/leads/:id`
- Finance: cashups, month-end runs, credit notes, reversals, expenditures, revenue share
- Commissions: plans, ledger entries
- Payroll: employees, runs, payslips
- Notifications: templates, logs
- Approvals: `GET/POST /api/approval-requests`, approve/reject
- Reports: policy/financial/claims/commission reports with CSV export
- Settings: org settings, terms, feature flags, security questions
- Audit: `GET /api/audit-logs`
- Health: `GET /api/health`

### Client Portal Routes (`/api/client-auth/*`)
- `GET /api/client-auth/session` — Client session
- `GET /api/client-auth/dashboard` — Policies, payments, dependents
- `GET /api/client-auth/notifications` — Client notifications
- `PATCH /api/client-auth/settings` — Notification preferences
- `POST /api/client-auth/change-password`
- `POST /api/client-auth/claims` — Submit claim
- `GET /api/client-auth/claims` — View claims
- `POST /api/client-auth/feedback` — Submit feedback
- `POST /api/client-auth/dependent-request` — Request dependent changes
- `POST /api/client-auth/payment-intents` — Create PayNow payment
- `POST /api/client-auth/payment-intents/:id/initiate` — Start PayNow flow
- `POST /api/client-auth/payment-intents/:id/poll` — Check payment status
- `GET /api/client-auth/policy-document/:policyId` — Download policy document PDF

### Agent Routes
- `GET /api/agent/org-info` — Organization info for referral pages
- `POST /api/agent/register-client` — Register client via referral
- Agent uses staff routes with agent-role permissions

---

## 9. Security Features

- **Helmet** security headers (CSP, HSTS, etc.)
- **Rate limiting** on auth endpoints (100 requests / 15 min window)
- **CSRF protection** (optional, cookie-based)
- **Argon2** password hashing for client/agent passwords
- **Account lockout** (5 failed attempts → 15-minute lock)
- **Tenant isolation** enforced at middleware + query level
- **RBAC permission guards** on every route
- **Audit logging** for all mutations
- **No secrets in repo** — all sensitive config via environment variables
- **Session security** — httpOnly, sameSite, secure cookies in production

---

## 10. Build & Run

```bash
# Development
npm install
npm run dev              # Full-stack dev server (Express + Vite 5 HMR)
npm run dev:client       # Client-only dev server

# Production build
npm run build            # Build client (Vite 5) + server (esbuild)
npm run build:do         # DigitalOcean build (npm ci --include=dev + build)
npm start                # Start production server

# Database
npm run db:push          # Push schema to PostgreSQL
npm run db:seed          # Seed permissions, roles, default org
npm run db:setup         # Push + seed
npm run db:migrate       # Run SQL migrations

# Mobile
npm run cap:sync         # Build + sync to Capacitor
npm run cap:android      # Open Android Studio
npm run cap:ios          # Open Xcode

# Testing
npm test                 # Run unit tests (Vitest)
npm run check            # TypeScript type check

# Lockfile
npm run lint:lock        # Verify lockfile in sync
npm run relock           # Clean regenerate lockfile
```

### Build Constraints (CRITICAL — read before adding dependencies)

The production build target is **DigitalOcean App Platform** (Linux x64, Node 20). The build must succeed with `npm ci --include=dev && npm run build` and produce a self-contained `dist/index.cjs` that runs with zero native add-ons beyond what Node ships. Follow these rules:

1. **Tailwind CSS must be v3.4.x with PostCSS** — NOT Tailwind v4.
   - Tailwind v4 pulls in `@tailwindcss/oxide` (Rust/NAPI native binary) and `lightningcss` (also native). These fail to install or run on many CI/CD images.
   - Use the classic `tailwind.config.ts` + `postcss.config.js` with `@tailwind base; @tailwind components; @tailwind utilities;` directives.
   - Required devDependencies: `tailwindcss@^3.4`, `postcss`, `autoprefixer`.
   - Do NOT install `@tailwindcss/postcss`, `@tailwindcss/cli`, `@tailwindcss/oxide`, or `lightningcss`.

2. **Vite must be v5.x** — NOT Vite 6 or 7.
   - Vite 6+ depends on Rollup 4 which ships platform-specific native binaries (`@rollup/rollup-linux-x64-gnu`, etc.). Optional-dependency resolution is fragile across lockfile re-generations and cross-platform CI.
   - Vite 5 uses Rollup 3 (pure JS) and is fully stable.

3. **esbuild** is acceptable for the server bundle because its npm package includes a postinstall that fetches the correct binary. If you hit issues, the `esbuild-wasm` package is a pure-JS fallback.

4. **No database tooling in the build step.** `npm run build` must NOT import from `drizzle-kit`, run migrations, or require `DATABASE_URL`. Database operations (`db:push`, `db:seed`, `db:migrate`) are separate npm scripts that run post-deploy or manually.

5. **shadcn/ui must be configured for Tailwind v3.** Use `components.json` with `tailwindcss: { config: "tailwind.config.ts" }` and the v3-compatible class variance authority (`class-variance-authority`) setup. Do NOT use the Tailwind v4 `@import "tailwindcss"` syntax.

6. **No other native/platform-specific binaries** unless they are optional-peer-deps that degrade gracefully. Examples to avoid as hard dependencies: `sharp`, `bcrypt` (use `argon2` which has pre-built binaries for all major platforms), `canvas`, `cpu-features`.

7. **Lockfile is generated on Linux** via GitHub Actions (`script/relock.cjs`) to ensure all `optionalDependencies` resolve for the deploy target. Never commit a lockfile generated on macOS/Windows without verifying it on Linux first.

---

## 11. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Random string for session encryption |
| `NODE_ENV` | Yes | `production` or `development` |
| `HOST` | Yes | `0.0.0.0` for production |
| `PORT` | No | Server port (default 5000) |
| `APP_BASE_URL` | Recommended | Public URL of the app |
| `SUPERUSER_EMAIL` | Recommended | Email auto-promoted to superuser |
| `GOOGLE_CLIENT_ID` | For staff login | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For staff login | Google OAuth secret |
| `GOOGLE_CALLBACK_URL` | For staff login | OAuth callback URL |
| `PAYNOW_INTEGRATION_ID` | For payments | PayNow merchant ID |
| `PAYNOW_INTEGRATION_KEY` | For payments | PayNow API key |
| `PAYNOW_MODE` | For payments | `live` or `test` |
| `PAYMENTS_PAYNOW_ENABLED` | For payments | `true` to enable PayNow |
| `PAYNOW_RETURN_URL` | For payments | Client return URL after payment |
| `PAYNOW_RESULT_URL` | For payments | Server callback for payment results |
| `VITE_APP_PUBLIC_URL` | Build time | Public URL for client-side links |
| `DB_ACCEPT_SELF_SIGNED` | Optional | Accept self-signed DB certs |
| `ENABLE_CSRF_PROTECTION` | Optional | Enable CSRF middleware |
| `JSON_BODY_LIMIT` | Optional | Request body size limit (default 1mb) |

---

## 12. User Flows & Use Cases

### 12.1 First-Time System Setup (Superuser)

**Actor:** Platform superuser (email matches `SUPERUSER_EMAIL` env var)
**Permission:** Superuser role has implicit access to all 41 permissions.

**Seed data created automatically on first `npm run db:seed`:**
- 1 organization (`name: "POL263"`, `primaryColor: "#D4AF37"`, `footerText: "For a service beyond Ubuntu"`)
- 1 branch (`name: "Head Office"`)
- 41 permissions across 14 categories: `organization`, `identity`, `rbac`, `audit`, `policy`, `claims`, `clients`, `product`, `settings`, `operations`, `finance`, `fleet`, `commission`, `payroll`, `reports`, `leads`, `notifications`, `approvals`, `platform`
- 9 roles: `superuser`, `executive`, `manager`, `administrator`, `cashier`, `agent`, `claims_officer`, `fleet_ops`, `staff`
- 5 security questions: "What was the name of your first pet?", "In what city were you born?", "What was the name of your primary school?", "What is your mother's maiden name?", "What was the make of your first car?"
- 1 superuser user record (linked to `SUPERUSER_EMAIL`)

**Flow:**
1. Superuser opens `/staff/login` → clicks "Sign in with Google".
2. Server calls `GET /api/auth/google` → redirects to Google OAuth consent → callback at `GET /api/auth/google/callback`.
3. Passport deserializes user by `googleId`. If `user.email === SUPERUSER_EMAIL` and user has no superuser role, the seed has already assigned it.
4. Session created via `express-session` + `connect-pg-simple` (stored in `sessions` table, column `sid`/`sess`/`expire`).
5. Superuser lands on `/staff` dashboard.

**Configuration steps:**
6. `/staff/settings` → `PATCH /api/organizations/:id` (requires `write:organization`):
   - `name` (text, e.g. "Falakhe Memorial")
   - `logoUrl` (text, uploaded via `POST /api/upload` → stored in `uploads/` directory)
   - `signatureUrl` (text, for policy document signatures)
   - `primaryColor` (hex, e.g. `#D4AF37`)
   - `footerText` (text, appears on PDFs)
   - `address`, `phone`, `email`, `website` (text fields)
   - `policyNumberPrefix` (text, e.g. `"FAL"` → generates policy numbers like `FAL-00001`)
   - `policyNumberPadding` (integer, default `5` → zero-pads the sequence)

7. `/staff/users` → `POST /api/users` (requires `write:user`):
   - Required: `email` (unique), `displayName`
   - Optional: `passwordHash` (for agent role; hashed with argon2), `branchId`, `organizationId` (auto-set from session), `referralCode` (auto-generated for agents, format `AGT-XXXX`)
   - After creation: assign roles via `POST /api/user-roles` → links `user_roles(userId, roleId, branchId)`
   - After creation: optionally set permission overrides via `user_permission_overrides(userId, permissionId, isGranted: boolean)`

8. `/staff/products` → `POST /api/products` (requires `write:product`):
   - Required: `name`, `code` (unique per org, e.g. `"GOLD"`)
   - Optional: `description`, `maxAdults` (default 2), `maxChildren` (default 4), `maxExtendedMembers` (default 0), `casketType`, `casketImageUrl`, `coverAmount` (numeric), `coverCurrency` (default `"USD"`)
   - Then create product version: `POST /api/products/:id/versions`:
     - `version` (integer, 1+), `effectiveFrom` (date), `effectiveTo` (date or null)
     - Premiums: `premiumMonthlyUsd`, `premiumMonthlyZar`, `premiumWeeklyUsd`, `premiumBiweeklyUsd` (all numeric)
     - Eligibility: `eligibilityMinAge` (default 18), `eligibilityMaxAge` (default 70), `dependentMaxAge` (default 20)
     - Waiting periods: `waitingPeriodDays` (default 90), `waitingPeriodAccidentalDeath` (default 0), `waitingPeriodSuicide` (default 0)
     - Grace: `gracePeriodDays` (default 30)
     - Cash in lieu: `cashInLieuAdult`, `cashInLieuChild` (numeric)
     - Reinstatement rules: `reinstatementRequiresArrears` (default true), `reinstatementNewWaitingPeriod` (default true)
     - `coverageRules` (jsonb), `exclusions` (jsonb)

---

### 12.2 Agent Onboarding & Client Acquisition

**Actors:** Administrator (`write:user` permission), Agent (`write:policy`, `write:client`, `write:lead` permissions)

**Creating an agent:**
1. Admin at `/staff/users` → `POST /api/users`:
   - `email`: agent's email (unique)
   - `displayName`: agent's full name
   - `passwordHash`: hashed via argon2 server-side (agent provides plaintext in form → server hashes)
   - `organizationId`: auto-set from admin's session
   - `branchId`: assigned branch UUID
2. Admin assigns role "agent" → `POST /api/user-roles` with `roleId` of the "agent" role.
3. System auto-generates unique `referralCode` stored on `users.referral_code` (unique column). Format: `AGT-XXXX` (4 alphanumeric chars).

**Agent login:**
4. Agent opens `/agent/login` → `POST /api/agent/login`:
   - Body: `{ email, password }`
   - Server verifies password against `users.password_hash` using argon2 (or legacy SHA-256 fallback for migrated accounts: regex check `/^[a-f0-9]{64}$/i`)
   - On success: creates session `(req.session as any).userId = user.id`
   - On failure: returns `401 "Invalid credentials"` (constant-time response with 200ms delay to prevent timing attacks)

**Agent referral registration:**
5. Agent shares link: `https://{APP_BASE_URL}/join?ref={referralCode}`.
6. Client opens link → frontend extracts `ref` from URL query params, stores in `sessionStorage("agent_referral_code")`.
7. Frontend calls `GET /api/public/registration-options?ref={referralCode}`:
   - Returns: `{ agentName, referralCode, products: [{ id, name, code, versions: [{ id, version, premiumMonthlyUsd, premiumMonthlyZar }] }], branches: [{ id, name }] }`
   - If invalid/expired ref → returns error message, form disabled.
8. Client fills registration form with fields:
   - `firstName` (required text)
   - `lastName` (required text)
   - `email` (optional text)
   - `phone` (optional text)
   - `dateOfBirth` (date picker, YYYY-MM-DD)
   - `nationalId` (text)
   - `productId` → `productVersionId` (cascading select: product → latest version)
   - `branchId` (select from available branches)
   - `premiumAmount` (auto-filled from selected product version's `premiumMonthlyUsd`)
9. Submit → `POST /api/agent/register-client`:
   - Server creates `clients` record with `activationCode` (6-char alphanumeric, e.g. `"X7K2M9"`), `isEnrolled: false`
   - Server creates `policies` record: `status: "pending"`, `policyNumber` auto-generated via `orgPolicySequences` table (atomic increment: `SELECT policy_next FROM org_policy_sequences WHERE organization_id = $1 FOR UPDATE`, then increment), formatted as `{prefix}-{padded_number}` (e.g. `FAL-00042`)
   - Server creates `policyMembers` record: `role: "policy_holder"`, `memberNumber` auto-generated via `orgMemberSequences` (format `MEM-{padded}`)
   - Server links `agentId` on the policy from the referral code lookup
10. Response: `{ policyNumber, activationCode }` displayed to client in a success card.

---

### 12.3 Client Portal Enrollment (First Login)

**Actor:** Client (unenrolled policyholder)
**API endpoint:** `POST /api/client-auth/claim` then `POST /api/client-auth/enroll`

**Step 1 — Claim account (verify identity):**
1. Client opens `/client/claim` (dedicated enrollment page, no auth required).
2. Enters `activationCode` (6-char code) + `policyNumber` (e.g. `FAL-00042`).
3. Frontend sends `POST /api/client-auth/claim`:
   - Server looks up all organizations, finds client by `activationCode` in `clients.activation_code` column
   - Cross-validates: `getPolicyByNumber(policyNumber, orgId)` must return a policy where `policy.clientId === client.id`
   - Checks `client.isEnrolled === false` (already enrolled → error: "This policy has already been claimed")
   - Returns: `{ clientId: uuid, firstName: string, securityQuestions: [{ id, question }] }`
   - All error responses return generic message "Invalid activation code or policy number" (no information leak)
   - All responses use `constantTimeResponse()` with 200ms artificial delay

**Step 2 — Set credentials:**
4. Client sees welcome message with their first name, then fills:
   - `password` (min 8 chars, validated client-side and server-side: `password.length < 8` → 400)
   - `securityQuestionId` (select from 5 questions)
   - `securityAnswer` (free text)
5. Frontend sends `POST /api/client-auth/enroll`:
   - Body: `{ clientId, password, securityQuestionId, securityAnswer, referralCode? }`
   - Server normalizes answer: `securityAnswer.trim().toLowerCase()`
   - Server hashes both: `passwordHash = argon2.hash(password, { type: argon2id })`, `securityAnswerHash = argon2.hash(normalizedAnswer, { type: argon2id })`
   - Updates client: `{ passwordHash, securityQuestionId, securityAnswerHash, isEnrolled: true, activationCode: null }`
   - If `referralCode` provided: looks up agent by `users.referral_code`, assigns `agentId` to all client's policies that have no agent yet
   - Responds: `{ message: "Enrollment successful" }`
6. Client redirected to `/client/login`.

---

### 12.4 Client Login & Session

**Actor:** Enrolled client
**API endpoint:** `POST /api/client-auth/login`

**Authentication flow:**
1. Client enters `policyNumber` + `password` on `/client/login`.
2. Server flow:
   - Looks up policy by `policyNumber` in first organization
   - Gets client by `policy.clientId`
   - Validates: `client.isEnrolled === true` AND `client.passwordHash` exists
   - **Account lockout check:** if `client.lockedUntil > now()` → 429 "Account temporarily locked. Try again later."
   - **Password verification:** `argon2.verify(storedHash, inputPassword)` — or legacy SHA-256 fallback if hash matches `/^[a-f0-9]{64}$/i`
   - **On failure:** increments `failedLoginAttempts`; if `attempts >= 5` (LOCKOUT_THRESHOLD) → sets `lockedUntil = now() + 15 minutes` (LOCKOUT_DURATION_MS)
   - **On success:** resets `failedLoginAttempts: 0, lockedUntil: null`; sets `req.session.clientId` + `req.session.clientOrgId`
   - Returns: `{ client: { id, firstName, lastName, email } }`

**Session persistence:**
3. Session stored in PostgreSQL `sessions` table via `connect-pg-simple`.
4. Cookie: `httpOnly: true`, `sameSite: "lax"`, `secure: true` in production, `maxAge: 7 days`.
5. Subsequent requests authenticated via `req.session.clientId` check.

**Client dashboard data (`GET /api/client-auth/me`):**
6. Returns full client object minus sensitive fields.
7. Frontend `/client` dashboard fetches:
   - `GET /api/client-auth/policies` → array of policies with `{ id, policyNumber, status, premiumAmount, currency, paymentSchedule, effectiveDate, inceptionDate, waitingPeriodEndDate, currentCycleStart, currentCycleEnd, graceEndDate }`
   - `GET /api/client-auth/policies/:id/payments` → array of payment transactions for each policy
   - `GET /api/client-auth/policies/:id/members` → array of `{ id, memberNumber, role, firstName, lastName, ... }`
   - `GET /api/client-auth/notifications` → `notification_logs` entries where `recipientId = clientId`
   - `GET /api/client-auth/receipts` → all payment receipts for the client
   - `GET /api/client-auth/credit-notes` → credit note records

**Sidebar navigation (client layout):**
- Dashboard (`/client`) — policy summary cards, payment history, dependents
- Payments (`/client/payments`) — make payments via PayNow
- Claims (`/client/claims`) — view and submit claims
- Documents (`/client/documents`) — policy documents and receipts
- Feedback (`/client/feedback`) — submit feedback/complaints
- Settings (inline) — change password, notification preferences

---

### 12.5 Client Makes a Premium Payment (PayNow)

**Actor:** Authenticated client via web or Capacitor mobile app
**Permission:** Client session required (`req.session.clientId` set)
**API endpoints:** `POST /api/client-auth/payment-intents` → `POST /api/client-auth/payment-intents/:id/initiate` → `GET /api/client-auth/payment-intents/:id/status`

**Payment methods (enum `PAYNOW_METHODS`):** `"ecocash"`, `"onemoney"`, `"innbucks"`, `"omari"`, `"visa_mastercard"`, `"unknown"`
**Payment purposes (enum `PAYMENT_PURPOSES`):** `"premium"`, `"arrears"`, `"reinstatement"`, `"topup"`, `"other"`
**Payment intent statuses (enum `PAYMENT_INTENT_STATUSES`):** `"created"` → `"pending_user"` → `"pending_paynow"` → `"paid"` | `"failed"` | `"cancelled"` | `"expired"`

**Step 1 — Create payment intent:**
1. Client selects policy and enters amount on `/client/payments`.
2. Frontend generates `idempotencyKey` (UUID v4, prevents duplicate payments).
3. `POST /api/client-auth/payment-intents`:
   - Body: `{ policyId, amount, purpose: "premium", idempotencyKey }`
   - **Cross-client payment:** If `policy.clientId !== session.clientId`, the client must have previously looked up the target client via `GET /api/client-auth/lookup-by-phone?phone=...` within the last 5 minutes (stored in `req.session.lookedUpClientId` + `req.session.lookedUpClientIdAt`). Otherwise → 403.
   - Server calls `createPaymentIntent()`:
     - Checks for existing intent with same `idempotencyKey` (returns existing if found → idempotent)
     - Generates `merchantReference` (unique per org, format `MR-{timestamp}-{random}`)
     - Inserts into `payment_intents` table: `status: "created"`, `currency: "USD"`, `amount: numeric(12,2)`
     - Returns: `{ intent: PaymentIntent, created: boolean }`

**Step 2 — Initiate PayNow transaction:**
4. Client selects payment method and provides phone/email.
5. `POST /api/client-auth/payment-intents/:id/initiate`:
   - Body: `{ method: "ecocash" | "onemoney" | "innbucks" | "visa_mastercard", payerPhone?, payerEmail? }`
   - Server calls `initiatePaynowPayment()`:
     - Validates intent belongs to client and is in `"created"` or `"pending_user"` status
     - Calls PayNow SDK: `paynow.send(payment)` for mobile or `paynow.sendMobile(payment, phone, method)` for USSD
     - Creates `payment_events` entry: `type: "initiated"`, `actorType: "client"`, `payloadJson: { method, phone, ... }`
     - **Mobile money result:** Intent updated to `"pending_user"` (USSD push sent to phone), returns `{ intent, pollUrl }`
     - **Card result:** Intent updated to `"pending_paynow"`, returns `{ intent, redirectUrl }` (client opens in browser → PayNow hosted page → redirected back to `PAYNOW_RETURN_URL`)

**Step 3 — Poll for status:**
6. Frontend polls every 3-5 seconds: `GET /api/client-auth/payment-intents/:id/status`
   - Server calls `pollPaynowStatus()`:
     - Fetches status from PayNow API using `paynowPollUrl`
     - Creates `payment_events` entry: `type: "polled"`, `payloadJson: { paynowStatus, pollResponse }`
     - If PayNow returns "Paid":
       - Updates intent: `status: "paid"`, `paynowReference: "..."` 
       - Creates `payment_transactions` entry: `paymentMethod: "paynow_{method}"`, `status: "cleared"`, `paynowReference`, `idempotencyKey`, `postedDate: today`, `valueDate: today`
       - Generates receipt number: `getNextPaymentReceiptNumber(orgId)` (atomic sequence from `receipts` table count + 1, formatted as `REC-{orgPrefix}-{number}`)
       - Creates `payment_receipts` entry: `paymentChannel: "paynow_ecocash" | "paynow_card" | etc.`, `printFormat: "thermal_80mm"`, `status: "issued"`
       - Generates receipt PDF: `generateReceiptPdf(receiptId)` → streams PDFKit output to file → stores path in `pdfStorageKey`
       - Creates `payment_events` entry: `type: "marked_paid"`
       - Creates `payment_events` entry: `type: "receipt_issued"`
       - **Policy activation logic:**
         - If `policy.status === "pending"`: updates to `{ status: "active", inceptionDate: today, effectiveDate: today (if not set) }`, creates `policyStatusHistory(pending → active, "First premium paid")`
         - If `policy.status === "grace"`: updates to `{ status: "active", graceEndDate: null }`, creates `policyStatusHistory(grace → active, "Payment received")`
     - If PayNow returns "Failed": updates intent `status: "failed"`, creates event `type: "marked_failed"`
   - Returns: `{ intent: PaymentIntent }` with updated status

**Mobile app deep-linking:**
7. After card payment redirect, PayNow returns client to `PAYNOW_RETURN_URL`.
8. Mobile Capacitor app uses `App.addListener("appUrlOpen")` to catch `pol263://client/payments?returned=1`.
9. Client sees payment result on payments page.

---

### 12.6 Staff Receipts a Cash Payment

**Actor:** Cashier (`write:finance` permission) or administrator
**API endpoint:** `POST /api/admin/receipts/cash`
**Middleware chain:** `requireAuth → requireTenantScope → requirePermission("write:finance")`

**Request body:**
```json
{
  "policyId": "uuid",
  "amount": 25.00,
  "currency": "USD",
  "notes": "Cash collected at branch",
  "receivedAt": "2026-02-27T10:00:00Z"
}
```

**Server processing:**
1. Validates `policyId` and `amount` are present (400 if missing).
2. Fetches policy: `storage.getPolicy(policyId, user.organizationId)` — must exist and belong to tenant (404 otherwise).
3. Creates `payment_transactions` entry:
   - `paymentMethod: "cash"`, `status: "cleared"`
   - `reference: "CASH-{timestamp}"` (e.g. `CASH-1740652800000`)
   - `receivedAt`: from body or `new Date()`
   - `postedDate`: today (`YYYY-MM-DD`), `valueDate`: today
   - `recordedBy`: current user ID
4. Generates receipt number: `storage.getNextPaymentReceiptNumber(orgId)` → atomic auto-incrementing sequence.
5. Creates `payment_receipts` entry:
   - `paymentChannel: "cash"`, `printFormat: "thermal_80mm"`, `status: "issued"`
   - `issuedByUserId`: current user ID
   - `metadataJson: { transactionId, notes }`
   - `branchId`: from policy or user's branch
6. Generates receipt PDF: `generateReceiptPdf(receipt.id)` → PDFKit thermal 80mm format → updates `pdfStorageKey`.
7. **Policy status transitions:**
   - `pending → active`: sets `inceptionDate: today`, `effectiveDate: today` (if not set). Creates `policyStatusHistory(pending → active, "First premium paid (cash)")`.
   - `grace → active`: clears `graceEndDate: null`. Creates `policyStatusHistory(grace → active, "Payment received")`.
8. Audit log: `action: "CASH_RECEIPT"`, `entityType: "PaymentReceipt"`, stores full receipt as `after` snapshot.
9. Returns: `{ transaction: PaymentTransaction, receipt: PaymentReceipt }`.

**Receipt reprint flow:**
- `POST /api/admin/receipts/reprint` (requires `read:finance`):
  - Body: `{ receiptId }`
  - Creates `payment_events` entry: `type: "reprint"`, `actorType: "admin"`, `actorId: user.id`
  - Audit log: `action: "RECEIPT_REPRINT"`

---

### 12.7 Month-End Batch Processing

**Actor:** Finance manager (`write:finance` permission)
**API endpoints:** `GET /api/month-end-run/template` → `POST /api/month-end-run`

**Step 1 — Download template:**
1. `GET /api/month-end-run/template` returns CSV with headers:
   ```
   policy_number,amount,reference,date
   ```
   Response: `Content-Type: text/csv`, `Content-Disposition: attachment; filename=month-end-run-template.csv`

**Step 2 — Upload bank file:**
2. User fills CSV with debit-order data from bank, uploads via `POST /api/month-end-run` (multipart form with `file` field, processed by `multer` in-memory).
3. Server parses CSV rows and processes each:
   - Lookup: `storage.getPolicyByNumber(policyNumber, orgId)` within the tenant
   - **Policy found, amount >= premium:** Creates transaction (`method: "bank_debit"`, `status: "cleared"`) + receipt. Activates/reinstates policy if `pending`/`grace`.
   - **Policy found, amount < premium:** Creates transaction + receipt for actual amount. Creates `credit_notes` entry: `creditNoteNumber` (auto-generated, unique per org), `amount: premium - actualAmount`, `reason: "Underpayment on month-end run"`, linked to `monthEndRunId`. Updates `policy_credit_balances`: adds shortfall to running `balance` (numeric(12,2)).
   - **Policy found, amount > premium:** Creates transaction + receipt for premium amount. Excess added to `policy_credit_balances.balance`.
   - **Policy not found:** Skipped, counted in unmatched tally.
4. Creates `month_end_runs` record:
   - `runNumber`: auto-generated (unique per org, format `MER-{YYYYMM}-{seq}`)
   - `fileName`: uploaded file name
   - `totalRows`: count of CSV rows processed
   - `receiptedCount`: policies successfully receipted
   - `creditNoteCount`: credit notes issued
   - `status: "completed"`, `runBy: user.id`
5. Returns summary JSON with all counts and created records.

**Applying credit balances:**
6. `POST /api/apply-credit-balances` (requires `write:finance`):
   - Scans all `policy_credit_balances` where `balance > 0`
   - For each: if balance >= policy premium, creates a transaction + receipt using the credit, decrements balance
   - Returns count of policies auto-paid from credit

---

### 12.8 Death Claim Submission & Processing

**Claim statuses (enum `CLAIM_STATUSES`):** `"submitted"` → `"verified"` → `"approved"` → `"scheduled"` → `"payable"` → `"completed"` → `"paid"` → `"closed"` | `"rejected"`

**Valid transitions (enforced by `VALID_CLAIM_TRANSITIONS`):**
```
submitted  → verified | rejected
verified   → approved | rejected
approved   → scheduled | payable
scheduled  → completed
payable    → paid
completed  → closed
paid       → closed
```

**Phase 1 — Client submits (via client portal):**
1. Client at `/client/claims` → `POST /api/client-auth/claims`:
   - Body validated against `insertClaimSchema` (Zod): `{ policyId, claimType: "death", deceasedName, deceasedRelationship, dateOfDeath, causeOfDeath }`
   - Server generates `claimNumber` via `storage.generateClaimNumber(orgId)` (format `CLM-{padded_seq}`)
   - Creates `claims` entry: `status: "submitted"`, `clientId` from policy
   - Creates `claim_status_history` entry: `fromStatus: null, toStatus: "submitted", reason: "Claim submitted"`
   - Returns claim object with `id` and `claimNumber`

**Phase 2 — Staff creates claim (via staff portal):**
2. Claims officer at `/staff/claims` → `POST /api/claims` (requires `write:claim`):
   - Same schema + server sets `submittedBy: user.id`
   - Audit log: `action: "CREATE_CLAIM"`

**Phase 3 — Claims officer verifies:**
3. `POST /api/claims/:id/transition` (requires `write:claim`):
   - Body: `{ toStatus: "verified", reason: "Documents verified, policy in force" }`
   - Server validates transition: checks `VALID_CLAIM_TRANSITIONS[claim.status]` includes `toStatus`
   - Sets `verifiedBy: user.id` on the claim
   - Creates `claim_status_history` entry
   - Audit log: `action: "TRANSITION_CLAIM"`, stores `before` and `after` snapshots

**Phase 4 — Manager approves:**
4. `POST /api/claims/:id/transition`:
   - Body: `{ toStatus: "approved", reason: "Approved for funeral service" }`
   - **Extra permission check:** If `toStatus` is `"approved"` or `"paid"`, server verifies the user has `approve:claim` permission (`storage.getUserEffectivePermissions(userId)`) — 403 if not
   - Sets `approvedBy: user.id` on the claim
   - Creates status history + audit log

**Claim data model (`claims` table):**
- `claimNumber` (unique per org), `claimType` ("death"), `status`
- `deceasedName`, `deceasedRelationship`, `dateOfDeath` (date), `causeOfDeath`
- `cashInLieuAmount` (numeric, for cash-in-lieu option)
- `isWaitingPeriodWaived` (boolean, default false)
- `fraudFlags` (jsonb, for suspicious indicators)
- `submittedBy`, `verifiedBy`, `approvedBy` (user UUIDs for audit chain)
- `approvalNotes` (text)

**Claim documents:**
- `claim_documents` table: `claimId`, `documentType` (e.g. "death_certificate", "id_copy"), `fileName`, `filePath`, `isVerified` (boolean), `verifiedBy`
- Uploaded via `POST /api/upload` → file stored in `uploads/` directory
- Fetched via `GET /api/claims/:id/documents` (requires `read:claim`)

**Waiting period check (on `/api/policies/:id/members`):**
- Server computes: `policyClaimable = (status === "active" || status === "grace") && (!waitingPeriodEndDate || waitingPeriodEndDate <= today)`
- Each member returned with `claimable: boolean` and `claimableReason: string`

---

### 12.9 Funeral Operations Workflow

**Actor:** Claims officer (`write:funeral_ops`), fleet ops (`write:fleet`), coordinator

**Funeral case (`funeral_cases` table):**
- Created via `POST /api/funeral-cases` (requires `write:funeral_ops`):
  - Fields: `claimId` (links to approved claim), `policyId`, `caseNumber` (auto-generated), `deceasedName`, `funeralDate` (date), `funeralLocation`, `status` (default `"open"`), `assignedTo` (user UUID), `notes`, `slaDeadline` (timestamp)
  - Audit log: `action: "CREATE_FUNERAL_CASE"`

**Funeral tasks (`funeral_tasks` table):**
- `POST /api/funeral-cases/:id/tasks` (requires `write:funeral_ops`):
  - Fields: `taskName` (e.g. "Collect body from mortuary"), `description`, `status` (default `"pending"`), `assignedTo` (user UUID), `dueDate` (timestamp)
- `PATCH /api/funeral-tasks/:id` (requires `write:funeral_ops`):
  - Update `status` to `"in_progress"` | `"completed"`, set `completedAt` timestamp

**Cost sheet (`cost_sheets` + `cost_line_items` tables):**
- `cost_sheets`: `funeralCaseId`, `claimId`, `totalAmount` (numeric, default 0), `currency`, `status` (`"draft"` | `"submitted"` | `"approved"`), `approvedBy`
- `cost_line_items`: `costSheetId`, `priceBookItemId` (optional link to price book), `description`, `quantity` (numeric), `unitPrice` (numeric), `totalPrice` (numeric)

**Fleet integration (`fleet_vehicles` + `driver_assignments` + `fleet_fuel_logs` tables):**
- `fleet_vehicles`: `registration`, `make`, `model`, `year`, `vehicleType`, `status` (`"available"` | `"in_use"` | `"maintenance"`), `currentMileage`
- `driver_assignments`: `vehicleId`, `driverId` (user UUID), `funeralCaseId`, `startDate`, `endDate`, `notes`
- `fleet_fuel_logs`: `vehicleId`, `litres` (numeric), `costAmount` (numeric), `currency`, `mileageAtFill`, `filledBy`, `filledAt`
- `fleet_maintenance`: `vehicleId`, `description`, `costAmount`, `scheduledDate`, `completedDate`, `status` (`"scheduled"` | `"completed"`)

**Expenditures (`expenditures` table):**
- Tracks all costs: `funeralCaseId`, `category` (e.g. "transport", "catering", "casket"), `description`, `amount`, `currency`, `approvedBy`, `receiptRef`, `spentAt`

---

### 12.10 Agent Lead Management

**Actor:** Agent (`read:lead`, `write:lead` permissions)
**API endpoints:** `POST /api/leads`, `PATCH /api/leads/:id`, `GET /api/leads`

**Lead stages (enum `LEAD_STAGES`):** `"captured"` → `"contacted"` → `"quote_generated"` → `"application_started"` → `"submitted"` → `"approved"` → `"activated"` | `"lost"`

**Creating a lead:**
1. `POST /api/leads` (requires `write:lead`):
   - Body: `{ firstName, lastName, phone?, email?, source, stage?, notes? }`
   - `source` values: `"walk_in"`, `"referral"`, `"cold_call"`, `"social_media"`, `"event"`
   - Server auto-sets: `organizationId`, `branchId`, `agentId: user.id`, `stage: "captured"` (default)
   - Returns created lead

**Updating a lead (stage transition):**
2. `PATCH /api/leads/:id` (requires `write:lead`):
   - Body: `{ stage: "contacted", notes: "Called client, interested in Gold plan" }`
   - Or: `{ stage: "lost", lostReason: "Client chose competitor" }`
   - Agent can only edit leads where `leads.agentId === user.id` (managers can edit any)
   - When `stage: "activated"`: agent creates client + policy manually, then links lead via `clientId`

**Lead listing:**
3. `GET /api/leads` (requires `read:lead`):
   - Query params: `?limit=100&offset=0&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD`
   - Returns leads filtered by org, sorted by creation date

---

### 12.11 Group/Community Scheme Management

**Actor:** Administrator (`write:policy`, `write:finance`), cashier (`write:finance`)

**Group data model (`groups` table):**
- `name`, `type` (`"community"` | `"corporate"` | `"family"`), `description`
- Executive committee (all text fields): `chairpersonName`, `chairpersonPhone`, `chairpersonEmail`, `secretaryName`, `secretaryPhone`, `secretaryEmail`, `treasurerName`, `treasurerPhone`, `treasurerEmail`
- `isActive` (boolean)

**Group-policy link:**
- `policies.groupId` (UUID, FK to `groups.id`, indexed) — links individual policies to a group
- Query: `GET /api/groups` returns groups with count of linked policies

**Group batch cash receipt (`POST /api/group-receipt`, requires `write:finance`):**
1. Body: `{ groupId, policyIds: [uuid, ...], totalAmount: number, currency, notes }`
2. Server fetches all specified policies, validates each belongs to org.
3. Filters to valid policies (active/pending/grace status, matching org).
4. Splits `totalAmount` proportionally: each policy gets `(policy.premiumAmount / sumOfAllPremiums) * totalAmount`.
5. For each policy: creates `payment_transactions` (method: "cash", status: "cleared") + `payment_receipts` + PDF.
6. For each policy: applies activation logic (pending→active, grace→active).
7. Returns: `{ results: [{ policyId, policyNumber, amount, receiptNumber, status }] }`.

**Group PayNow payment:**
- `POST /api/group-payment-intents` (requires `write:finance`):
  - Body: `{ groupId, policyIds, totalAmount, currency, idempotencyKey, method }`
  - Creates `group_payment_intents` entry: `status: "created"`, `merchantReference`, `idempotencyKey`
  - Creates `group_payment_allocations` entries: one per policy with proportional amounts
- `POST /api/group-payment-intents/:id/initiate` → calls PayNow for single combined payment
- `POST /api/group-payment-intents/:id/poll` → on "Paid": splits into individual receipts for each policy

---

### 12.12 Commission Calculation & Agent Payroll

**Commission plan (`commission_plans` table):**
- `name`, `description`
- `firstMonthsCount` (integer, default 2) — number of initial months at higher rate
- `firstMonthsRate` (numeric, default `"50"`) — commission percentage for first N months (e.g. 50%)
- `recurringStartMonth` (integer, default 5) — month from which recurring rate kicks in
- `recurringRate` (numeric, default `"10"`) — recurring commission percentage (e.g. 10%)
- `clawbackThresholdPayments` (integer, default 4) — minimum payments before commission is non-clawable
- `funeralServiceIncentive` (numeric, default `"50"`) — flat incentive per funeral service delivered
- `version`, `effectiveFrom`, `isActive`

**Commission ledger (`commission_ledger_entries` table):**
- `agentId`, `policyId`, `transactionId` (links to triggering payment)
- `entryType`: `"earned"` | `"clawback"` | `"incentive"` | `"adjustment"`
- `amount` (numeric, positive for earned, negative for clawback)
- `currency`, `description`
- `periodStart`, `periodEnd` (date range for the commission period)
- `status`: `"earned"` | `"paid"` | `"clawed_back"`

**Payroll integration:**
- `payroll_employees` table: `userId` (links to staff), `employeeNumber`, `firstName`, `lastName`, `position`, `department`, `baseSalary` (numeric), `bankDetails` (jsonb: `{ bankName, accountNumber, branchCode }`)
- `payroll_runs` table: `periodStart`, `periodEnd`, `status` (`"draft"` | `"approved"` | `"paid"`), `totalGross`, `totalDeductions`, `totalNet`, `preparedBy`, `approvedBy`
- `payslips` table: `payrollRunId`, `employeeId`, `grossAmount`, `deductions` (jsonb: `{ tax, pension, medical, ... }`), `netAmount`, `currency`

---

### 12.13 Staff User & Role Management (RBAC)

**41 system permissions across 14 categories:**

| Category | Permissions |
|----------|------------|
| organization | `read:organization`, `write:organization` |
| organization | `read:branch`, `write:branch` |
| identity | `read:user`, `write:user`, `delete:user` |
| rbac | `read:role`, `write:role`, `manage:permissions` |
| audit | `read:audit_log` |
| policy | `read:policy`, `write:policy`, `delete:policy` |
| claims | `read:claim`, `write:claim`, `approve:claim` |
| clients | `read:client`, `write:client` |
| product | `read:product`, `write:product` |
| settings | `manage:settings` |
| operations | `read:funeral_ops`, `write:funeral_ops` |
| finance | `read:finance`, `write:finance`, `approve:finance`, `backdate:payment` |
| fleet | `read:fleet`, `write:fleet` |
| commission | `read:commission`, `write:commission` |
| payroll | `read:payroll`, `write:payroll` |
| reports | `read:report`, `write:report` |
| leads | `read:lead`, `write:lead` |
| notifications | `read:notification`, `write:notification` |
| approvals | `manage:approvals` |
| platform | `create:tenant`, `delete:tenant` |

**9 system roles with their permissions:**

| Role | Permissions |
|------|------------|
| **superuser** | All permissions (implicit, empty mapping — checked by name) |
| **executive** | All `read:*` permissions (17 read-only permissions) |
| **administrator** | All 41 permissions except `create:tenant`, `delete:tenant` |
| **manager** | Read + write for most areas, `approve:claim`, `manage:approvals`, no `write:product`, no payroll write |
| **cashier** | `read:policy`, `read:client`, `read:finance`, `write:finance`, `read:report` |
| **agent** | `read:policy`, `write:policy`, `read:client`, `write:client`, `read:product`, `read:lead`, `write:lead`, `read:commission` |
| **claims_officer** | `read:policy`, `read:claim`, `write:claim`, `approve:claim`, `read:client`, `read/write:funeral_ops`, `read:finance`, `read:report` |
| **fleet_ops** | `read:fleet`, `write:fleet`, `read/write:funeral_ops`, `read:report` |
| **staff** | `read:organization`, `read:branch`, `read:policy`, `read:claim`, `read:client`, `read:product`, `read:funeral_ops`, `read:report` |

**Permission resolution (`storage.getUserEffectivePermissions`):**
1. Get all roles for user → collect all permissions from each role's `role_permissions`
2. If user has "superuser" role → return ALL permissions
3. Apply `user_permission_overrides`: if `isGranted: true` → add permission; if `isGranted: false` → remove permission
4. Return final set of permission names

**Agent-specific access control on policies:**
- When patching a policy, if user has role "agent", server checks `policy.agentId === user.id` — agents can only modify their own policies (403 otherwise)

---

### 12.14 Multi-Tenant Administration

**Actor:** Platform superuser (`create:tenant`, `delete:tenant` permissions)
**API endpoints:** `POST /api/organizations`, `DELETE /api/organizations/:id`

**Organization creation (`POST /api/organizations`):**
- Requires `create:tenant` permission (only superuser and administrator roles have this)
- Body: `{ name, logoUrl?, primaryColor?, footerText?, address?, phone?, email?, website?, policyNumberPrefix?, databaseUrl? }`
- Server creates organization + auto-seeds default branch ("Head Office")
- Optional: `databaseUrl` field for dedicated database-level tenant isolation

**Tenant scoping (`requireTenantScope` middleware):**
- Reads `user.organizationId` from session
- Every query in `storage.ts` filters by `organizationId` (e.g. `eq(policies.organizationId, orgId)`)
- All indexed tables have `_org_idx` index on `organizationId`
- Cross-tenant access returns 403: `"Cross-tenant access denied"` (checked by comparing `entity.organizationId !== user.organizationId`)

**Organization deletion (`DELETE /api/organizations/:id`):**
- Requires `delete:tenant` permission
- Soft-deletes or cascades depending on implementation
- Audit log: `action: "DELETE_ORGANIZATION"`

---

### 12.15 Client Password Reset

**Actor:** Client (unauthenticated)
**API endpoint:** `POST /api/client-auth/reset-password`
**Security measures:** constant-time responses (200ms delay), generic error messages, no information leakage

**Request body:** `{ policyNumber, securityAnswer, newPassword }`

**Flow:**
1. Server looks up policy by `policyNumber` → gets `client` by `policy.clientId`.
2. Validates: client exists AND `client.securityAnswerHash` is set.
3. Normalizes answer: `securityAnswer.trim().toLowerCase()`.
4. Verifies: `argon2.verify(client.securityAnswerHash, normalizedAnswer)` — or SHA-256 fallback for legacy hashes.
5. If answer correct:
   - Hashes new password: `argon2.hash(newPassword, { type: argon2id })`
   - Updates client: `{ passwordHash: newHash, failedLoginAttempts: 0, lockedUntil: null }`
   - Returns 200: `{ message: "Password reset successful" }`
6. If answer incorrect: returns 400: `{ message: "Invalid request" }` (same generic message as all other failure paths — no indication of which field was wrong).

**Change password (authenticated):**
- `POST /api/client-auth/change-password` (requires active session):
  - Body: `{ currentPassword, newPassword }`
  - Validates `newPassword.length >= 8`
  - Verifies current password → hashes new → updates client

---

### 12.16 Maker-Checker Approval Workflow

**API endpoints:** `POST /api/approvals`, `GET /api/approvals`, `POST /api/approvals/:id/resolve`

**Approval request (`approval_requests` table):**
- `requestType`: e.g. `"claim_approval"`, `"payment_reversal"`, `"policy_cancellation"`, `"dependent_change"`
- `entityType`: e.g. `"Claim"`, `"PaymentTransaction"`, `"Policy"`, `"Dependent"`
- `entityId`: UUID of the target entity
- `requestData` (jsonb): snapshot of the requested change data
- `status`: `"pending"` → `"approved"` | `"rejected"`
- `initiatedBy`: user who created the request
- `approvedBy`: user who resolved it
- `rejectionReason`: text (only if rejected)
- `resolvedAt`: timestamp

**Creating a request (`POST /api/approvals`):**
- Any authenticated staff member can create
- Server validates `entityType` and `entityId` exist

**Resolving (`POST /api/approvals/:id/resolve`, requires `manage:approvals`):**
- Body: `{ action: "approve" | "reject", reason?: string }`
- If approve: sets `status: "approved"`, `approvedBy: user.id`, `resolvedAt: now()`
- If reject: sets `status: "rejected"`, `rejectionReason: reason`, `resolvedAt: now()`
- Audit log with before/after state

---

### 12.17 Daily Cashup & Reconciliation

**Actor:** Cashier (`write:finance`), branch manager
**API endpoints:** `GET /api/cashups`, `POST /api/cashups`

**Cashup data model (`cashups` table):**
- `branchId`, `cashupDate` (date), `totalAmount` (numeric), `transactionCount` (integer)
- `isLocked` (boolean, default false), `lockedBy` (user UUID), `lockedAt` (timestamp)
- `preparedBy` (user UUID, required), `notes` (text)

**Flow:**
1. `POST /api/cashups` (requires `write:finance`):
   - Body: `{ branchId, cashupDate, totalAmount, transactionCount, notes? }`
   - `preparedBy`: auto-set from session
2. Manager reviews → locks the cashup (preventing further edits):
   - Update: `{ isLocked: true, lockedBy: user.id, lockedAt: now() }`
3. `GET /api/cashups` (requires `read:finance`):
   - Returns cashups for the org, sorted by date

---

### 12.18 Report Generation & Export

**Actor:** Manager/executive (`read:report` permission), administrator (`write:report` for generation)
**API endpoints:** Various report-specific endpoints returning JSON, with CSV export option

**Available report types:**
- **Policy Report:** All policies with joins to clients, products, branches, agents. Filterable by `status`, `branchId`, `agentId`, date range.
- **Financial Report:** Payment transactions + receipts aggregated by period, branch, product. Includes totals.
- **Claims Report:** Claims with status breakdown, processing time, linked policies.
- **Commission Report:** Agent earnings by period, grouped by `entryType` (earned/clawback/incentive). Net total per agent.

**CSV export:** Each report endpoint accepts `?format=csv` → server sets `Content-Type: text/csv`, `Content-Disposition: attachment; filename={report-type}-{date}.csv`, streams CSV rows.

**Dashboard KPIs (`GET /api/dashboard/stats`, requires auth + tenant scope):**
- Active policy count, total premium MRR, claims submitted this month, new clients this month, policy growth trend (Recharts line chart on frontend).

---

### 12.19 Client Feedback & Complaints

**Actor:** Client (authenticated)
**API endpoints:** `POST /api/client-auth/feedback`, `GET /api/client-auth/feedback`

**Data model (`client_feedback` table):**
- `clientId`, `organizationId`
- `type`: `"complaint"` | `"feedback"` (required)
- `subject`: text (required)
- `message`: text (required)
- `status`: `"open"` → `"acknowledged"` → `"closed"` (default `"open"`)
- `createdAt`, `updatedAt`

**Validation:** Body validated against `insertClientFeedbackSchema` (Zod).

---

### 12.20 Policy Document Generation

**Actor:** Client (`GET /api/client-auth/policies/:id/document`) or staff (`GET /api/receipts/:id/download`)

**PDF generation (PDFKit, streamed — no file stored permanently):**
- `streamPolicyDocumentToResponse(policyId, res)` in `server/policy-document.ts`
- Content:
  1. Organization header: logo (`logoUrl`), name, address, phone, email
  2. Policy section: `policyNumber`, `status`, `effectiveDate`, `inceptionDate`, `premiumAmount`, `paymentSchedule`, `currency`
  3. Product section: product name, code, cover amount, waiting periods, grace period, benefits
  4. Policyholder section: `firstName`, `lastName`, `nationalId`, `dateOfBirth`, address
  5. Members table: all `policyMembers` with `memberNumber`, `role`, name, relationship
  6. Terms and conditions: from `terms_and_conditions` table (filtered by org, active, sorted by `sortOrder`)
  7. Signature: `signatureUrl` image
  8. Footer: `footerText`
- Response: `Content-Type: application/pdf`, streamed directly

**Receipt PDF (`generateReceiptPdf`):**
- Thermal 80mm format (narrow width for POS printers)
- Content: org name, receipt number, date, policy number, client name, amount, payment method, cashier name
- Stored in `uploads/receipts/` with path in `payment_receipts.pdfStorageKey`

---

### 12.21 Notification System

**Templates (`notification_templates` table):**
- `name`, `eventType` (e.g. `"payment_received"`, `"claim_status_changed"`, `"policy_activated"`)
- `channel`: `"in_app"` | `"sms"` | `"email"` (default `"in_app"`)
- `subject`, `bodyTemplate` (text with merge tags like `{{client_name}}`, `{{policy_number}}`, `{{amount}}`)
- `mergeTags` (jsonb, describes available tags)
- `version`, `effectiveFrom`, `isActive`

**Delivery (`notification_logs` table):**
- `templateId`, `recipientType` (`"client"` | `"staff"`), `recipientId` (UUID)
- `channel`, `subject`, `body` (rendered from template)
- `status`: `"pending"` → `"sent"` | `"failed"`, `attempts` (integer, for retries), `failureReason`
- `sentAt` (timestamp)

**Auto-created notifications (in route handlers):**
- Policy status change → `storage.createNotificationLog(orgId, { recipientType: "client", recipientId: policy.clientId, channel: "in_app", subject: "Policy status updated", body: "Policy {number} status has been updated to {status}.", status: "sent" })`

**Client notification preferences:**
- `clients.notificationTone`: `"default"` | `"silent"` | `"high"`
- `clients.pushEnabled`: boolean (default false)
- Updated via `PATCH /api/client-auth/settings`

**Push notification device tokens (`client_device_tokens` table):**
- `clientId`, `token` (device-specific), `platform` (`"ios"` | `"android"` | `"web"`)
- Registered via `POST /api/client-auth/register-device`
- Removed via `DELETE /api/client-auth/register-device`
- Unique constraint: `(organizationId, token)` prevents duplicate registrations

---

### 12.22 POL263 Revenue Share (2.5%)

**Actor:** Finance team (system-tracked)

**Data model:**
- `revenue_share_receivables` table: For each premium payment transaction, a 2.5% receivable is tracked.
  - `sourceTransactionId` (links to `payment_transactions`), `amount`, `currency`, `isSettled` (boolean, default false)
- `settlements` table: Records bulk settlement payments.
  - `amount`, `currency`, `method` (e.g. "bank_transfer"), `reference`, `attachments` (jsonb), `status` (`"pending"` | `"completed"`), `initiatedBy`, `approvedBy`
- `settlement_allocations` table: Links individual receivables to a settlement.
  - `settlementId`, `receivableId`, `amount`

---

### 12.23 Audit Trail

**Every mutation generates an audit log (`audit_logs` table):**
- `actorId` (user UUID), `actorEmail` (text, for display)
- `action` (e.g. `"CREATE_POLICY"`, `"UPDATE_POLICY"`, `"TRANSITION_POLICY"`, `"CASH_RECEIPT"`, `"RECEIPT_REPRINT"`, `"CREATE_CLAIM"`, `"TRANSITION_CLAIM"`, `"CREATE_FUNERAL_CASE"`, `"DELETE_ORGANIZATION"`, `"SEED_COMPLETE"`)
- `entityType` (e.g. `"Policy"`, `"Claim"`, `"PaymentReceipt"`, `"User"`, `"Organization"`, `"System"`)
- `entityId` (UUID or text)
- `before` (jsonb, pre-mutation snapshot), `after` (jsonb, post-mutation snapshot)
- `requestId` (text, unique per HTTP request — added by `requestId` middleware)
- `ipAddress` (text, from `req.ip`)
- `timestamp` (auto-set)

**Viewing:** `GET /api/audit-logs` (requires `read:audit_log`), supports `?limit=&offset=&fromDate=&toDate=`

---

### 12.24 Feature Flags

**Data model (`feature_flags` table):**
- `organizationId`, `name` (e.g. `"enable_paynow"`, `"enable_sms_notifications"`, `"enable_mobile_app"`), `isEnabled` (boolean, default false), `description`
- Per-org toggles to enable/disable features dynamically without code changes

---

### 12.25 Policy Lifecycle State Machine

**Policy statuses (enum `POLICY_STATUSES`):** `"draft"`, `"pending"`, `"active"`, `"grace"`, `"lapsed"`, `"reinstatement_pending"`, `"cancelled"`

**Valid transitions (enforced server-side via `VALID_POLICY_TRANSITIONS`):**
```
draft                  → pending
pending                → active                (triggered by first premium payment)
active                 → grace | cancelled
grace                  → active | lapsed       (active = payment received; lapsed = grace period expired)
lapsed                 → reinstatement_pending | cancelled
reinstatement_pending  → active                (reinstatement approved + payment)
```

**Key dates tracked on each policy:**
- `effectiveDate`: date policy coverage starts (set on creation or first payment)
- `inceptionDate`: date first premium was received (set automatically on pending→active)
- `waitingPeriodEndDate`: `inceptionDate + waitingPeriodDays` from product version
- `currentCycleStart`, `currentCycleEnd`: current billing cycle dates
- `graceEndDate`: when grace period expires (set on active→grace, cleared on reinstatement)
- `cancelledAt`, `cancelReason`: populated when policy cancelled

**Policy number format:** `{policyNumberPrefix}-{zero-padded sequence}` (e.g. `FAL-00042`), unique per organization, generated atomically via `org_policy_sequences` table with `FOR UPDATE` row lock.

**Member number format:** `MEM-{zero-padded sequence}` (e.g. `MEM-000123`), unique per organization, generated via `org_member_sequences` table.

**Premium computation:** Premiums are always server-computed from the product version and add-ons via `computePolicyPremium(orgId, productVersionId, currency, paymentSchedule, addOnIds)`. Client-sent `premiumAmount` is ignored on create and stripped on update.
