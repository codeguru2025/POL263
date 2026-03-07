# POL263 — TestSprite Testing Document

**Product:** POL263 — Multi-Tenant Insurance Policy Management System
**Version:** 1.0.2
**Base URL:** http://localhost:5000
**Stack:** React 19, Vite 5, TypeScript, Express 5, PostgreSQL (Drizzle ORM)

---

## 1. Application Overview

POL263 is a multi-tenant funeral/life insurance policy management system with three portals:

- **Staff Portal** — back-office for managing policies, clients, claims, finance, reports, and settings
- **Agent Portal** — field agents with scoped access to their own clients, policies, leads, and commissions
- **Client Portal** — policyholders view coverage, pay premiums, download documents, and submit claims

The app enforces role-based access control (RBAC) with 9 roles and 41 permissions. Agents see only their own data everywhere. Tenants can whitelabel the app with their own name, logo, and colors.

---

## 2. Authentication Methods

### 2.1 Staff Login (Dev/Demo Mode)

**Route:** `/staff/login`
**Method:** Email-based demo login (development mode)
**How to test:**
1. Navigate to `http://localhost:5000/staff/login`
2. Enter any email in the "Email (dev login)" field (e.g. `admin@example.com`)
3. Click "Sign in (Dev)"
4. Should redirect to `/staff` (staff dashboard)

**Test IDs:**
- Email input: `data-testid="input-demo-email"`
- Sign in button: `data-testid="btn-demo-login"`
- Back to home link: `data-testid="link-back-home"`

**Expected behavior:**
- Valid email → login succeeds → redirect to `/staff`
- Empty email → button is disabled
- After login, session persists on page reload
- Auth error query param `?error=...` displays error message at top of form

### 2.2 Agent Login

**Route:** `/agent/login`
**Method:** Email + password
**How to test:**
1. Navigate to `http://localhost:5000/agent/login`
2. Enter email and password fields
3. Click "Sign in"
4. Should redirect to `/staff` (shared portal, agent-scoped)

**Test IDs:**
- Email input: `data-testid="input-agent-email"`
- Password input: `data-testid="input-agent-password"`
- Sign in button: `data-testid="button-agent-login"`
- Error message: `data-testid="text-agent-login-error"`
- Back to home: `data-testid="link-back-home"`

**Note:** Agent accounts must be pre-created by an admin. Invalid credentials show an error message.

### 2.3 Client Login

**Route:** `/client/login`
**Method:** Policy number + password
**How to test:**
1. Navigate to `http://localhost:5000/client/login`
2. Enter policy number (e.g. `FAL-00001`) and password
3. Click "Sign in"
4. Should redirect to `/client` (client dashboard)

**Note:** Client accounts are created during policy registration and activated via activation code enrollment.

---

## 3. Public Pages

### 3.1 Home / Landing Page

**Route:** `/`
**Expected elements:**
- Application title "POL263" with subtitle "Insurance Management Platform"
- Three portal cards with access buttons:
  - "Staff Portal" → navigates to `/staff/login`
  - "Agent Portal" → navigates to `/agent/login`
  - "Client Portal" → navigates to `/client/login`
- Theme toggle button (light/dark mode)

**Test scenarios:**
- All three portal buttons are visible and clickable
- Each button navigates to the correct login page
- Theme toggle switches between light and dark mode
- Page is responsive on mobile viewports

### 3.2 Join Page

**Route:** `/join` and `/join?ref={referralCode}`
**Purpose:** Agent referral landing page for client self-registration
**Expected:** Shows organization branding when referral code is valid; links to registration form

### 3.3 Registration Page

**Route:** `/join/register?ref={referralCode}`
**Purpose:** Client self-registration with product/branch selection, personal details, dependents, and payment info

---

## 4. Staff Portal

### 4.1 Dashboard (`/staff`)

**Permission:** Any authenticated staff user
**Expected elements:**
- Welcome message with user display name
- Date range filters (Date From, Date To)
- Policy status filter dropdown
- Branch filter dropdown
- KPI cards: active policies, converted, lapse rate, retention rate
- Status breakdown: Active, Grace, Lapsed, Cancelled counts
- Branch count and permissions count

**Test scenarios:**
- Dashboard loads without errors after login
- All KPI cards display numeric values (can be 0 for empty database)
- Filters are interactive (dropdowns open, date pickers work)
- Navigation sidebar is accessible via hamburger menu
- For agents: dashboard shows only agent-scoped data

### 4.2 Sidebar Navigation

**Accessible from:** Hamburger menu icon (top-left)
**Menu sections:**

**Overview:**
- Dashboard

**System & Audit:**
- Settings

**Additional navigation items (permission-dependent):**
- Clients (`/staff/clients`) — requires `read:client`
- Policies (`/staff/policies`) — requires `read:policy`
- Claims (`/staff/claims`) — requires `read:claim`
- Products (`/staff/products`) — requires `read:product`
- Price Book (`/staff/pricebook`) — requires `read:product`
- Groups (`/staff/groups`) — requires `read:policy`
- Funerals (`/staff/funerals`) — requires `read:funeral_ops`
- Finance (`/staff/finance`) — requires `read:finance`
- Leads (`/staff/leads`) — requires `read:lead`
- Reports (`/staff/reports`) — requires `read:report`
- Payroll (`/staff/payroll`) — requires `read:payroll`
- Users (`/staff/users`) — requires `read:user`
- Notifications (`/staff/notifications`) — requires `read:notification`
- Approvals (`/staff/approvals`) — requires `manage:approvals`
- Settings (`/staff/settings`) — requires `manage:settings`
- Tenants (`/staff/tenants`) — requires `create:tenant`
- Audit Logs (`/staff/audit`) — requires `read:audit_log`
- Diagnostics (`/staff/diagnostics`)

**Test scenarios:**
- Menu opens/closes properly
- Navigation links route to correct pages
- Sign out button logs out and redirects to home
- Menu items are permission-aware (only visible if user has required permissions)

### 4.3 Clients Page (`/staff/clients`)

**Permission:** `read:client`
**Features:**
- Client list with search and filters
- Create new client (name, national ID, DOB, gender, phone, email, address)
- Edit client details
- View/manage dependents per client

**Test scenarios:**
- Page loads with client list (or empty state)
- Search filters clients by name or national ID
- "New Client" button opens creation form
- Required fields are validated
- Client detail view shows dependents section

### 4.4 Policies Page (`/staff/policies`)

**Permission:** `read:policy`
**Features:**
- Policy list with search, status filter, branch filter
- Create new policy (client, product, premium, schedule, agent, branch)
- Policy detail view with tabs/sections:
  - Policy info and status
  - Members (principal + dependents)
  - Add-ons
  - Payment history
  - **Receipts** — table of payment receipts with View, Download, Print, Share actions
  - E-Statement generation with date range, Print, Share, Download
  - Policy document viewer with Print and Share buttons
- Status transitions (e.g. active → grace → lapsed → cancelled)
- In-policy payment recording (cash receipt or PayNow)

**Test scenarios:**
- Policy list loads with correct columns
- Status filter dropdown works
- Create policy form validates required fields
- Policy detail view shows all sections
- Receipts table shows receipt number, amount, channel, and issued date
- Receipt actions (View, Download, Print, Share) are functional
- E-Statement generates and can be viewed inline
- Share button triggers Web Share API or opens in new tab
- Print button opens print dialog
- Policy document can be downloaded as PDF
- Status transitions follow valid transition rules

### 4.5 Claims Page (`/staff/claims`)

**Permission:** `read:claim`
**Features:**
- Claims list with status filter
- Create new claim linked to a policy
- Claim status workflow: submitted → verified → approved → scheduled → payable → completed/paid → closed (or rejected)
- Document upload on claims
- Approval notes and rejection reasons

**Test scenarios:**
- Claims list loads
- Create claim form requires policy selection and claim details
- Status transitions are enforced (invalid transitions rejected)
- Document upload works

### 4.6 Products Page (`/staff/products`)

**Permission:** `read:product`
**Features:**
- Product list
- Create product with code, name, description
- Product versions with pricing (monthly/weekly/biweekly in USD/ZAR)
- Eligibility rules, waiting periods, grace period config
- Add-ons, benefit bundles, age band configs

**Test scenarios:**
- Product list displays products
- Create product form validates required fields (name, code)
- Product version creation with pricing fields works
- Multiple versions can exist per product

### 4.7 Groups Page (`/staff/groups`)

**Permission:** `read:policy`
**Features:**
- Group list (community/corporate/family types)
- Create group with executive committee details
- Group-linked policies
- Group batch receipting
- Group PayNow payment

**Test scenarios:**
- Group list loads
- Create group form works
- Group detail shows linked policies

### 4.8 Finance Page (`/staff/finance`)

**Permission:** `read:finance`
**Features:**
- Payment transactions list
- Payment receipts
- Cashups (daily cash reconciliation)
- Month-end processing (CSV upload and matching)
- Credit notes and reversal entries
- Expenditure tracking
- Commission plans and ledger
- Revenue share tracking

**Test scenarios:**
- All finance tabs/sections load without errors
- Transaction list shows payment details
- Cashup creation form works
- Month-end upload accepts CSV file

### 4.9 Leads Page (`/staff/leads`)

**Permission:** `read:lead`
**Features:**
- Lead pipeline with stages: captured → contacted → quote_generated → application_started → submitted → approved → activated (or lost)
- Create and update leads
- Agent assignment

**Test scenarios:**
- Lead list loads
- Create lead with required fields
- Stage transitions work
- Agents see only their own leads

### 4.10 Reports Page (`/staff/reports`)

**Permission:** `read:report`
**Features:**
- Multiple report types: policy, financial, claims, commission
- Filters: date range, branch, agent, product, status
- CSV export

**Test scenarios:**
- Report page loads with report type selection
- Filters work
- CSV export downloads a file
- Agent-scoped reports show only agent's data

### 4.11 Users Page (`/staff/users`)

**Permission:** `read:user`
**Features:**
- User list with role badges
- Create user (email, display name, password for agents)
- Assign roles and branch
- Per-user permission overrides

**Test scenarios:**
- User list loads
- Create user form validates email uniqueness
- Role assignment works
- Permission overrides can be toggled

### 4.12 Settings Page (`/staff/settings`)

**Permission:** `manage:settings`
**Features:**
- Organization branding: name, logo upload, primary color, footer text
- Contact details: address, phone, email, website
- Policy number format: prefix + padding
- Terms and conditions management
- Security questions
- Feature flags

**Test scenarios:**
- Settings page loads with current values
- Logo upload works
- Name and color changes save and apply
- Policy number prefix updates correctly

### 4.13 Notifications Page (`/staff/notifications`)

**Permission:** `read:notification`
**Features:**
- Notification templates list
- Create template: event type, channel (in-app/SMS/email), subject, body with merge tags
- Notification delivery logs

**Test scenarios:**
- Template list loads
- Create template form works
- Merge tag placeholders are shown

### 4.14 Approvals Page (`/staff/approvals`)

**Permission:** `manage:approvals`
**Features:**
- Pending approval requests queue
- Approve or reject with reason

**Test scenarios:**
- Approvals queue loads
- Approve/reject actions work with confirmation

### 4.15 Audit Logs Page (`/staff/audit`)

**Permission:** `read:audit_log`
**Features:**
- Immutable audit trail viewer
- Filter by date range
- Shows: actor, action, entity type, entity ID, timestamp

**Test scenarios:**
- Audit log list loads
- Date filters work
- Entries show before/after change details

### 4.16 Payroll Page (`/staff/payroll`)

**Permission:** `read:payroll`
**Features:**
- Employee registry
- Payroll runs (draft → approved → paid)
- Payslips with gross, deductions, net

**Test scenarios:**
- Employee list loads
- Payroll run creation works
- Payslip generation works

### 4.17 Funerals Page (`/staff/funerals`)

**Permission:** `read:funeral_ops`
**Features:**
- Funeral cases linked to claims
- Task management per case
- Cost sheets from price book
- Fleet vehicle dispatch

**Test scenarios:**
- Funeral cases list loads
- Create case from claim
- Task creation and status updates work

### 4.18 Diagnostics Page (`/staff/diagnostics`)

**Permission:** Any authenticated user
**Features:**
- Database connection health
- Session info
- System status

**Test scenarios:**
- Page loads and shows health status

---

## 5. Client Portal

### 5.1 Client Dashboard (`/client`)

**Features:**
- Policy overview cards (status, premium, next payment)
- Payment history
- Dependents list
- Notifications
- Account settings (change password, notification preferences)

**Test scenarios:**
- Dashboard loads with policy cards
- Payment history shows transactions
- Navigation works between sections

### 5.2 Client Payments (`/client/payments`)

**Features:**
- Payment history list
- Initiate premium payment (PayNow: EcoCash, OneMoney, InnBucks, Visa/Mastercard)
- Payment status polling

**Test scenarios:**
- Payment history loads
- Payment form shows available methods
- Payment flow handles success/failure states

### 5.3 Client Documents (`/client/documents`)

**Features:**
- List documents by policy
- View policy document (PDF)
- Download receipts

**Test scenarios:**
- Document list loads
- PDF viewer opens for policy documents
- Receipt downloads work

### 5.4 Client Claims (`/client/claims`)

**Features:**
- View existing claims with status
- Submit new death claim (deceased name, relationship, date/cause of death)

**Test scenarios:**
- Claims list loads
- Submit claim form validates required fields
- Submitted claim appears in list

### 5.5 Client Feedback (`/client/feedback`)

**Features:**
- Submit complaint or feedback (type, subject, message)
- View past submissions

**Test scenarios:**
- Feedback form submits successfully
- Past feedback entries are visible

### 5.6 Client Enrollment (`/client/claim`)

**Route:** `/client/claim`
**Purpose:** First-time account activation
**Flow:**
1. Enter activation code + policy number
2. System verifies identity
3. Set password and security question
4. Account is activated

**Test scenarios:**
- Invalid activation code shows error
- Valid code proceeds to password setup
- Password must be at least 8 characters
- After enrollment, client can log in

### 5.7 Client Password Reset (`/client/reset-password`)

**Flow:**
1. Enter policy number
2. Answer security question
3. Set new password

**Test scenarios:**
- Incorrect security answer shows generic error
- Correct answer allows password reset
- New password works for login

---

## 6. API Endpoints for Testing

### Authentication
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/public/auth-config` | Returns `{ demoLoginEnabled, googleConfigured }` |
| POST | `/api/auth/demo-login` | Dev login with `{ email }` |
| POST | `/api/agent-auth/login` | Agent login with `{ email, password }` |
| POST | `/api/client-auth/login` | Client login with `{ policyNumber, password }` |
| GET | `/api/auth/me` | Get current staff session (401 if not logged in) |
| POST | `/api/auth/logout` | Staff logout |

### Public
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Database health check |
| GET | `/api/public/branding` | Get org branding (name, logo, colors) |
| GET | `/api/public/auth-config` | Auth configuration for login page |

### Staff CRUD (all require auth + tenant scope)
| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/api/clients` | `read:client` | List clients |
| POST | `/api/clients` | `write:client` | Create client |
| GET | `/api/policies` | `read:policy` | List policies |
| POST | `/api/policies` | `write:policy` | Create policy |
| GET | `/api/policies/:id/receipts` | `read:finance` | Get receipts for a policy |
| GET | `/api/receipts/:id/download` | auth required | Download receipt PDF |
| GET | `/api/claims` | `read:claim` | List claims |
| POST | `/api/claims` | `write:claim` | Create claim |
| GET | `/api/products` | `read:product` | List products |
| GET | `/api/groups` | `read:policy` | List groups |
| GET | `/api/leads` | `read:lead` | List leads |
| GET | `/api/users` | `read:user` | List users |
| GET | `/api/audit-logs` | `read:audit_log` | View audit trail |

---

## 7. Key Business Rules

### Policy Lifecycle State Machine
```
draft → pending
pending → active (first premium payment)
active → grace | cancelled
grace → active (payment received) | lapsed (grace expired)
lapsed → reinstatement_pending | cancelled
reinstatement_pending → active
```

### Claim Lifecycle
```
submitted → verified | rejected
verified → approved | rejected
approved → scheduled | payable
scheduled → completed
payable → paid
completed → closed
paid → closed
```

### RBAC Enforcement
- **Superuser:** All permissions (implicit)
- **Administrator:** All permissions except `create:tenant`, `delete:tenant`
- **Agent:** Can only see their own clients, policies, leads, and commissions
- Every API endpoint checks permissions via middleware
- Cross-tenant access is denied

### Multi-Currency Support
- Supported currencies: USD, ZAR, ZIG
- Each policy, payment, claim, and cashup has a currency field
- Currency selector component available throughout the app

### National ID Validation
- Format: digits followed by one uppercase letter and two digits (e.g. `12345678A90`)
- Validated on client creation and policy enrollment

---

## 8. UI/UX Requirements

- **Responsive:** Works on desktop and mobile viewports
- **Theme:** Supports light and dark mode (toggle on home page and in-app)
- **Loading states:** Skeleton loaders and spinner animations during data fetches
- **Error handling:** API errors show toast notifications; form validation shows inline errors
- **Error boundary:** Catches render crashes and shows recovery UI (does not auto-dismiss)
- **Empty states:** Lists show "No data" messages when empty
- **Whitelabel:** Tenant logo and name appear when configured; default is POL263 branding
- **Footer:** Shows across main layouts

---

## 9. Test Data Setup

For a fresh database, the app auto-seeds:
- 1 organization ("POL263")
- 1 branch ("Head Office")
- 9 roles with 41 permissions
- 5 security questions
- 1 superuser account

To create test data after login:
1. **Create a product:** Staff → Products → New Product (name, code, then add a version with pricing)
2. **Create a client:** Staff → Clients → New Client (name, national ID, DOB)
3. **Create a policy:** Staff → Policies → New Policy (select client, product, set premium)
4. **Record a payment:** Open policy detail → Record Payment (cash receipt)

---

## 10. Known Constraints for Testing

1. **Google OAuth:** Not available in local dev; use demo login (email-only) instead
2. **PayNow payments:** Requires PayNow credentials in `.env`; payment flows will fail without them
3. **PDF generation:** Requires server to be running; PDFs are streamed on-demand
4. **File uploads:** Stored in local `uploads/` directory
5. **Rate limiting:** Auth endpoints have rate limits (100 req / 15 min)
6. **Account lockout:** Client accounts lock after 5 failed login attempts for 15 minutes

---

## 11. Critical Test Flows

### Flow 1: Staff Login → Dashboard → Navigate All Pages
1. Go to `/staff/login`
2. Enter email and sign in
3. Verify dashboard loads with KPI cards
4. Navigate to each sidebar menu item
5. Verify each page loads without errors

### Flow 2: Create Full Policy Lifecycle
1. Login as staff
2. Create a product with a version
3. Create a client
4. Create a policy for that client
5. Record a cash payment → policy should activate
6. View the receipt in the policy detail
7. Download/print the receipt

### Flow 3: Agent Scoped Access
1. Create an agent user (via staff Users page)
2. Login as the agent
3. Verify dashboard shows only agent's data
4. Verify policies list shows only agent's policies
5. Verify clients list shows only agent's clients

### Flow 4: Client Portal Journey
1. Create a client + policy as staff
2. Generate activation code
3. Client enrolls at `/client/claim`
4. Client logs in at `/client/login`
5. Client views dashboard, documents, and payment history

### Flow 5: Claims Workflow
1. Login as staff
2. Create a claim linked to an active policy
3. Transition claim through: submitted → verified → approved
4. Verify status history is recorded
5. Verify audit log entries are created

### Flow 6: Settings and Whitelabel
1. Login as staff with `manage:settings` permission
2. Navigate to Settings
3. Update organization name, upload logo, change primary color
4. Verify changes apply on next page load
5. Verify login page shows updated branding
