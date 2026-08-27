-- Monthly budget targets by category, for actual-vs-budget-vs-variance reporting on the income
-- statement and the executive report. One row per organization / month / category / currency.
-- Category is free text but the executive report reads the headline keys: 'total_income',
-- 'total_expenses', 'new_policies'.
CREATE TABLE IF NOT EXISTS budgets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id),
  period_month       DATE NOT NULL,                 -- first day of the budgeted month
  category           TEXT NOT NULL,
  amount             NUMERIC(14, 2) NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'USD',
  notes              TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS budgets_org_period_cat_cur_idx
  ON budgets(organization_id, period_month, category, currency);
CREATE INDEX IF NOT EXISTS budgets_org_idx ON budgets(organization_id);
