# Falakhe PMS - Multi-Tenant Funeral Policy & Operations Platform

## Architecture

### Tech Stack
- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + Wouter (routing) + TanStack Query
- **Backend**: Express.js + TypeScript + Passport.js (Google OAuth) + Helmet + Rate Limiting
- **Database**: PostgreSQL + Drizzle ORM (UUID primary keys, auto-push schema on startup)
- **Auth**: Google OIDC/OAuth (staff) + Policy Number/Password (clients) + Demo login (dev)
- **Session**: PostgreSQL-backed sessions via connect-pg-simple

### Portal Structure
- `/` - Landing page (portal selector)
- `/staff/*` - Internal staff portal (13 pages, requires staff authentication)
- `/client/*` - Client/policyholder portal (login, claim enrollment, dashboard)

### Database Schema (40+ tables)
**Core Identity**: organizations, branches, users, roles, permissions, userRoles, userPermissionOverrides
**Clients**: clients, dependents, dependentChangeRequests, securityQuestions
**Products**: products, productVersions, benefitCatalogItems, benefitBundles, productBenefitBundleLinks, addOns, ageBandConfigs
**Policies**: policies, policyMembers, policyStatusHistory
**Payments**: paymentTransactions (immutable), receipts (immutable), reversalEntries, cashups
**Claims**: claims, claimDocuments, claimStatusHistory
**Operations**: funeralCases, funeralTasks, fleetVehicles, driverAssignments, fleetFuelLogs, fleetMaintenance
**Finance**: priceBookItems, costSheets, costLineItems, commissionPlans, commissionLedgerEntries, chibikhuluReceivables, settlements, expenditures
**Payroll**: payrollEmployees, payrollRuns, payslips
**Notifications**: notificationTemplates, notificationLogs
**CRM**: leads
**System**: auditLogs, approvalRequests, featureFlags, sessions

### Key Backend Files
- `shared/schema.ts` - Complete Drizzle schema with 40+ tables, insert schemas, types, status machines
- `server/db.ts` - PostgreSQL pool + Drizzle instance
- `server/storage.ts` - IStorage interface + DatabaseStorage (80+ methods)
- `server/auth.ts` - Staff authentication (Google OAuth + demo login + RBAC guards)
- `server/client-auth.ts` - Client authentication (policy number + password + enrollment + security questions)
- `server/routes.ts` - All API routes (/api prefix, tenant-scoped, permission-guarded)
- `server/seed.ts` - Database seeder (41 permissions, 9 roles, default org, superuser provisioning)
- `server/logger.ts` - Structured JSON logging with request_id

### Staff Portal Pages
1. `/staff` - Dashboard with live stats (policies, clients, claims, funerals, leads, transactions)
2. `/staff/policies` - Policy management with status state machine transitions
3. `/staff/clients` - Client CRUD with search, detail view, linked policies
4. `/staff/claims` - Claim workflow (Submitted→Verified→Approved→Paid→Closed)
5. `/staff/funerals` - Funeral case management, task checklists, fleet vehicles
6. `/staff/leads` - Kanban-style lead pipeline (captured→contacted→quote→activated→lost)
7. `/staff/finance` - Payments, cashups, commissions, expenditures (tabbed view)
8. `/staff/reports` - Date-filtered reports for policies, claims, payments, funerals
9. `/staff/products` - Product builder with versions, benefits, add-ons, age bands
10. `/staff/notifications` - Notification template builder with merge tags
11. `/staff/audit` - Searchable audit log viewer with before/after diffs
12. `/staff/settings` - Tenant branding settings + RBAC permission matrix

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
