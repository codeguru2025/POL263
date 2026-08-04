-- Backfills payment_receipts.approval_status — another db:push-only column never captured in a
-- tracked migration (same class of gap as 0004_baseline_missing_tables.sql). Discovered because
-- 0080_performance_indexes.sql creates a partial index on this column, which fails on a schema-
-- only build (fresh tenant database) since the column never existed there to begin with. Named
-- to sort right before 0080 while staying after 0079_funeral_case_claim_unique.sql.

ALTER TABLE "payment_receipts" ADD COLUMN IF NOT EXISTS "approval_status" text;
