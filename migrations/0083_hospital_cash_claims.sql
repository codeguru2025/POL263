-- Hospital cash benefit engine (Phase 3b of the multi-vertical platform work). Additive/
-- nullable — irrelevant to every existing (funeral cash plan) product/claim. See
-- server/hospital-cash-claims.ts.

ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS daily_benefit_rate_usd numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS daily_benefit_rate_zar numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS max_days_per_claim integer;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS max_days_per_year integer;

ALTER TABLE claims ADD COLUMN IF NOT EXISTS admission_date date;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS discharge_date date;
