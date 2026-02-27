# Tenant Databases Without Supabase

The app supports **multiple tenants** and can use **one shared database** or **per-tenant databases**. It does **not** depend on Supabase. Any PostgreSQL (Supabase, DigitalOcean Managed Database, Neon, RDS, or self-hosted) works.

---

## How it works today

1. **Default database (`DATABASE_URL`)**
   - Used for:
     - **Registry data**: `organizations`, `users`, and any table that is not tenant-scoped.
     - **Tenant data** when an organization has **no** `database_url` set.
   - So a single Postgres (e.g. one DigitalOcean Managed Database) can hold both registry and all tenants that don’t have their own DB.

2. **Per-tenant database (`organization.database_url`)**
   - In **Staff → Settings** (or via API), each organization can have an optional **Tenant database URL**.
   - When set, **all tenant-scoped data** for that org (policies, clients, claims, payments, etc.) is read/written to that database instead of the default one.
   - Registry (organizations, users) **always** stays on the default DB so the app can resolve which DB to use for each tenant.

3. **Code path**
   - `getDbForOrg(orgId)` in `server/tenant-db.ts`:
     - Loads `organization.databaseUrl` from the default DB.
     - If **no** `database_url`: returns the **default pool** (same as `DATABASE_URL`).
     - If **has** `database_url`: returns a **dedicated pool** to that URL (cached per org).
   - So “different databases per tenant” is already supported; it’s **provider-agnostic** (any Postgres URL).

---

## Option A: Single database (no Supabase, no per-tenant DBs)

**Use case:** One production Postgres (e.g. DigitalOcean Managed Database). All tenants share it; separation is by `organization_id` in every table.

**Setup:**

1. Create **one** PostgreSQL database (e.g. DigitalOcean Managed Database).
2. Set **`DATABASE_URL`** in the app to that instance’s connection string.
3. In the app, leave **Tenant database URL** empty for every organization.

**Result:**

- One DB holds registry + all tenant data.
- No Supabase required; no per-tenant URLs to manage.
- Scaling: bigger DB node and/or read replicas; app scales separately (e.g. App Platform).

---

## Option B: Some or all tenants on their own database

**Use case:** A few tenants (or all) must have their own Postgres (isolation, compliance, or different providers).

**Setup:**

1. **Default DB** (e.g. one DigitalOcean Managed Database):
   - Set **`DATABASE_URL`** to this instance.
   - Holds: `organizations`, `users`, and any tenant that does **not** have `database_url` set.

2. **Per-tenant DBs** (can be DigitalOcean, Supabase, Neon, etc.):
   - Create one Postgres per tenant (or one per “tier”).
   - Run the **same schema** in each (e.g. `npm run db:push` or your migrations).
   - In Staff → Settings for that org, set **Tenant database URL** to that instance’s connection string.

**Result:**

- Registry stays on the default DB.
- Each org with `database_url` uses its own DB; the app routes traffic via `getDbForOrg(orgId)`.
- You can mix: most tenants on the default DB, a few on dedicated DO (or other) databases.

---

## Without Supabase: summary

| Approach | Default DB | Per-tenant DB | When to use |
|----------|------------|----------------|-------------|
| **Single DB** | One Postgres (e.g. DO Managed DB) | None | Simplest; all tenants share one DB; separation by `organization_id`. |
| **Hybrid** | One Postgres (registry + shared tenants) | Optional URL per org | Some tenants on shared DB, others on dedicated DBs. |
| **Full isolation** | One small Postgres (registry only) | One Postgres per tenant | Every tenant has its own DB; set `database_url` for each. |

The app **does not** care whether the URL is Supabase, DigitalOcean, or anything else. It only needs:

- A **PostgreSQL connection string** in `DATABASE_URL` for the default/registry DB.
- Optionally, per-org **PostgreSQL connection strings** in `organization.database_url` for tenant-specific DBs.

So you can move off Supabase by pointing `DATABASE_URL` (and any tenant URLs) to DigitalOcean Managed Database or another Postgres host; no code change is required for multi-tenancy.
