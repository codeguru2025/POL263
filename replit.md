# POL263 - Multi-Tenant Funeral Policy & Operations Platform

## Architecture

### Tech Stack
- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + Wouter (routing) + TanStack Query + Recharts
- **Backend**: Express.js + TypeScript + Passport.js (Google OAuth) + Helmet + Rate Limiting
- **Database**: PostgreSQL + Drizzle ORM (UUID primary keys, auto-push schema on startup)
- **Auth**: Google OIDC/OAuth (staff) + Policy Number/Password (clients) + Demo login (dev)
- **Session**: PostgreSQL-backed sessions via connect-pg-simple

### Portal Structure
- `/` - Landing page (portal selector)
- `/join?ref=AGTxxxx` - Agent referral landing page
- `/staff/*` - Internal staff portal (19 pages, requires staff authentication)
- `/client/*` - Client/policyholder portal (login, claim enrollment, dashboard with tabs)

### Database Schema (45+ tables)
**Core Identity**: organizations, branches, users (with referralCode), roles, permissions, userRoles, userPermissionOverrides
**Clients**: clients, dependents, dependentChangeRequests, securityQuestions
**Products**: products, productVersions, benefitCatalogItems, benefitBundles, productBenefitBundleLinks, addOns, ageBandConfigs
**Policies**: policies (with groupId), policyMembers, policyStatusHistory
**Payments**: paymentTransactions (immutable), receipts (immutable), reversalEntries, cashups
**Claims**: claims, claimDocuments, claimStatusHistory
**Operations**: funeralCases, funeralTasks, fleetVehicles, driverAssignments, fleetFuelLogs, fleetMaintenance
**Finance**: priceBookItems, costSheets, costLineItems, commissionPlans, commissionLedgerEntries, platformReceivables, settlements, settlementAllocations, expenditures
**Payroll**: payrollEmployees, payrollRuns, payslips
**Notifications**: notificationTemplates, notificationLogs
**CRM**: leads, groups
**System**: auditLogs, approvalRequests, featureFlags, sessions

### Key Backend Files
- `shared/schema.ts` - Complete Drizzle schema with 45+ tables, insert schemas, types, status machines
- `server/db.ts` - PostgreSQL pool + Drizzle instance
- `server/storage.ts` - IStorage interface + DatabaseStorage (90+ methods)
- `server/auth.ts` - Staff authentication (Google OAuth + demo login + RBAC guards)
- `server/client-auth.ts` - Client authentication (policy number + password + enrollment + security questions + members)
- `server/routes.ts` - All API routes (100+ endpoints, /api prefix, tenant-scoped, permission-guarded)
- `server/seed.ts` - Database seeder (41 permissions, 9 roles, default org, superuser provisioning)
- `server/logger.ts` - Structured JSON logging with request_id

### Staff Portal Pages (20 pages)
1. `/staff` - Dashboard with live stats, charts (revenue trend, policy breakdown, lead funnel), filters (date, branch, status), covered lives, retention metrics, product performance
2. `/staff/policies` - Policy management with status state machine transitions
3. `/staff/clients` - Client CRUD with search, detail view, linked policies
4. `/staff/claims` - Claim workflow (Submitted→Verified→Approved→Paid→Closed)
5. `/staff/funerals` - Funeral case management, task checklists, fleet vehicles
6. `/staff/leads` - Kanban-style lead pipeline (captured→contacted→quote→activated→lost)
7. `/staff/groups` - Groups module (churches/SMEs/community), assign policies, group dashboards
8. `/staff/finance` - Payments, cashups, commissions, expenditures, POL263 2.5% revenue share (tabbed view)
9. `/staff/pricebook` - Price book items CRUD, cost sheets with itemized line items
10. `/staff/payroll` - Employee records, payroll runs, payslips
11. `/staff/reports` - 9 report types (policies, claims, payments, funerals, fleet, expenditure, payroll, commissions, platform receivables) with CSV export
12. `/staff/products` - Product builder with versions, benefits, add-ons, age bands, casket types
13. `/staff/notifications` - Notification template builder with merge tags
14. `/staff/approvals` - Approval workflow UI with pending/resolved tabs, approve/reject with reason
15. `/staff/diagnostics` - System health, DB stats, notification failures, unallocated payments, recent errors
16. `/staff/audit` - Searchable audit log viewer with before/after diffs
17. `/staff/users` - User & team management: create users, assign roles (agent/manager/etc.), deactivate, referral codes, branch assignment
18. `/staff/settings` - Tenant branding settings + RBAC permission matrix
19. `/staff/login` - Staff login page

### Client Portal Features
- Login with policy number + password
- Enrollment via activation code + policy number
- Dashboard with 4 tabs: Overview, Payments, Members, Notifications/Alerts
- Grace period warnings, lapse alerts, waiting period countdowns
- Payment history per policy with receipt references
- Covered members view per policy
- Dependent change request form (submit for admin review)
- Pay Now button placeholder (for future Paynow integration)

### RBAC System
- 9 Roles: superuser, executive, manager, administrator, cashier, agent, claims_officer, fleet_ops, staff
- 41 fine-grained permissions across 12 categories
- Superuser gets all permissions implicitly
- Maker-checker approval system for sensitive actions

### Status Machines
- **Policy**: draft → pending → active → grace → lapsed → reinstatement_pending → cancelled
- **Claim**: submitted → verified → approved → scheduled/payable → completed/paid → closed/rejected
- **Lead**: captured → contacted → quote_generated → application_started → submitted → approved → activated → lost

### Multi-Tenancy
- All tables include `organization_id`; most include `branch_id`
- API queries are tenant-scoped via authenticated user's organizationId
- Cross-tenant access denied even for superusers

### Financial Features
- Immutable payment ledger (corrections via reversals only)
- Sequential receipt numbering (RCP-000001)
- Auto POL263 2.5% receivable on every cleared payment
- Settlement workflow with maker-checker approval
- Cost sheets with itemized line items linked to price book
- Commission plans with configurable rates and clawback thresholds
- Daily cashup reconciliation with locking

### Client Authentication
- Enrollment: activation code + policy number → set password + security question
- Login: policy number + password
- Password reset: policy number + security answer
- Rate limiting + lockout after 5 failed attempts + 15min cooldown
- Anti-enumeration: constant-time responses

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned)
- `SUPERUSER_EMAIL` - Default superuser email (default: ausiziba@gmail.com)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth (optional for dev)
- `SESSION_SECRET` - Session encryption key
