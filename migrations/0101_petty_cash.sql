-- Petty cash float register: a cash float per branch/custodian with an atomically-maintained
-- running balance (petty_cash_floats.balance), plus an immutable ledger of every movement
-- (petty_cash_transactions) — opening, replenishment, disbursement, adjustment, or a
-- non-balance-affecting physical reconciliation count.

CREATE TABLE IF NOT EXISTS petty_cash_floats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  branch_id uuid REFERENCES branches(id),
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  balance numeric(12, 2) NOT NULL DEFAULT '0',
  custodian_user_id uuid REFERENCES users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcf_org_idx ON petty_cash_floats (organization_id);

CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  float_id uuid NOT NULL REFERENCES petty_cash_floats(id),
  type text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  balance_after numeric(12, 2) NOT NULL,
  category text,
  description text NOT NULL,
  receipt_ref text,
  counted_amount numeric(12, 2),
  discrepancy_amount numeric(12, 2),
  performed_by_user_id uuid NOT NULL REFERENCES users(id),
  transaction_date date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pct_org_idx ON petty_cash_transactions (organization_id);
CREATE INDEX IF NOT EXISTS pct_float_idx ON petty_cash_transactions (float_id);
