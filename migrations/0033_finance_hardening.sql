-- Hardening for the finance feature:
--  • one quotation per funeral case (atomic upsert + no duplicates under concurrency)
--  • idempotency key on service receipts to dedupe accidental double-submits (money path)
-- Postgres unique indexes treat NULLs as distinct, so the optional idempotency key
-- and at most one quotation-per-case both behave correctly.

CREATE UNIQUE INDEX IF NOT EXISTS fq_org_case_idx ON funeral_quotations (organization_id, funeral_case_id);

ALTER TABLE service_receipts ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS sr_idempotency_org_idx ON service_receipts (organization_id, idempotency_key);
