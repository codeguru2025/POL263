# Falakhe PMS - Multi-Tenant Property Management System

## Architecture

### Tech Stack
- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + Wouter (routing) + TanStack Query
- **Backend**: Express.js + TypeScript + Passport.js (Google OAuth) + Helmet + Rate Limiting
- **Database**: PostgreSQL + Drizzle ORM (UUID primary keys, auto-push schema on startup)
- **Auth**: Google OIDC/OAuth (primary) + Demo login (development fallback)
- **Session**: PostgreSQL-backed sessions via connect-pg-simple

### Route Structure
- `/` - Landing page (portal selector)
- `/staff/*` - Internal staff portal (requires authentication)
- `/client/*` - Client/policyholder portal (planned: policy number + password auth)

### Key Backend Files
- `shared/schema.ts` - Drizzle schema (organizations, branches, users, roles, permissions, audit_logs, sessions)
- `server/db.ts` - PostgreSQL pool + Drizzle instance
- `server/storage.ts` - Data access layer (IStorage interface + DatabaseStorage implementation)
- `server/auth.ts` - Authentication setup (Google OAuth + demo login + session management + RBAC guards)
- `server/seed.ts` - Database seeder (permissions, roles, default org, superuser provisioning)
- `server/routes.ts` - API routes (all /api prefixed, tenant-scoped, permission-guarded)
- `server/logger.ts` - Structured JSON logging with request_id

### Multi-Tenancy
- All major tables include `organization_id`
- API queries are tenant-scoped via the authenticated user's `organizationId`
- Cross-tenant access is explicitly denied even for superusers

### RBAC System
- Roles: superuser, executive, manager, administrator, cashier, agent, staff
- 25 fine-grained permissions across 10 categories
- Superuser gets all permissions implicitly (no explicit mapping needed)
- Optional per-user permission overrides (grant or revoke specific permissions)
- Server-side guards: `requireAuth`, `requirePermission(...)`, `requireTenantScope`

### Superuser Provisioning
- Controlled by `SUPERUSER_EMAIL` environment variable (default: ausiziba@gmail.com)
- Seed script creates placeholder user and assigns superuser role
- All auto-assignments logged in audit trail

### Audit Logging
- All CUD operations generate audit log entries
- Stores: actor, action, entity type/id, before/after JSON diff, request_id, IP address
- Tenant-scoped viewer at `/staff/audit`

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned)
- `SUPERUSER_EMAIL` - Default superuser email
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth credentials (optional for dev)
- `SESSION_SECRET` - Session encryption key
