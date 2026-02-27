-- Optional per-tenant database. When set, getPoolForOrg(orgId) / getDbForOrg(orgId) use this DB for that tenant.
-- Run once per environment: npx tsx script/add-tenant-database-url-column.ts
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS database_url TEXT;
