-- Recurring commission starts straight after the first-months period on every product: months
-- 1-2 at the first-months rate, month 3 onward at the recurring rate. Some product versions were
-- set to start recurring at month 5, which left months 3-4 earning nothing (Augustus, 2026-09-29).
-- The app now always uses first_months_count + 1; this keeps the stored values honest.
UPDATE product_versions
SET commission_recurring_start_month = COALESCE(commission_first_months_count, 2) + 1
WHERE commission_recurring_start_month IS DISTINCT FROM COALESCE(commission_first_months_count, 2) + 1
  AND commission_first_months_rate IS NOT NULL;

UPDATE commission_plans
SET recurring_start_month = COALESCE(first_months_count, 2) + 1
WHERE recurring_start_month IS DISTINCT FROM COALESCE(first_months_count, 2) + 1;

ALTER TABLE commission_plans ALTER COLUMN recurring_start_month SET DEFAULT 3;
