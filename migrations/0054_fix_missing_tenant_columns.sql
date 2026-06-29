-- Backfill columns added in early migrations that may be absent on isolated tenant DBs
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "physical_address" text;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "postal_address" text;
ALTER TABLE "product_versions" ADD COLUMN IF NOT EXISTS "additional_member_premium_monthly_usd" numeric;
ALTER TABLE "product_versions" ADD COLUMN IF NOT EXISTS "additional_member_premium_monthly_zar" numeric;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "max_additional_members" integer;
