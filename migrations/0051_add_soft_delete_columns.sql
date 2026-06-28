-- Idempotent: adds soft-delete columns that exist in the ORM schema but may be
-- missing from tenant databases whose schema_migrations table was populated from
-- a snapshot rather than by running the original migration (0002_oval_bullseye).
ALTER TABLE "policies"              ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "payment_transactions"  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "payment_receipts"      ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
