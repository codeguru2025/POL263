-- Add signature_url to organizations (for policy documents & e-statements).
-- Run once per environment: psql $DATABASE_URL -f migrations/0001_add_organizations_signature_url.sql
-- Or use: npx tsx script/add-signature-url-column.ts
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS signature_url TEXT;
