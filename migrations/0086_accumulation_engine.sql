-- Accumulation engine (Phase 3e of the multi-vertical platform work): pensions, investments,
-- education protect. Entirely new tables plus two new nullable columns on product_versions and
-- one new sequence column — no existing table's behavior changes. See server/accumulation.ts.

ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS annual_growth_rate_percent numeric;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS maturity_term_months integer;

ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS accumulation_next integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS accumulation_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  product_version_id uuid NOT NULL REFERENCES product_versions(id),
  account_number text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'active',
  start_date date NOT NULL,
  maturity_date date,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS aa_account_number_org_idx ON accumulation_accounts(organization_id, account_number);
CREATE INDEX IF NOT EXISTS aa_org_idx ON accumulation_accounts(organization_id);
CREATE INDEX IF NOT EXISTS aa_client_idx ON accumulation_accounts(client_id);

CREATE TABLE IF NOT EXISTS accumulation_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  accumulation_account_id uuid NOT NULL REFERENCES accumulation_accounts(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  contribution_date date NOT NULL,
  recorded_by uuid REFERENCES users(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acon_org_idx ON accumulation_contributions(organization_id);
CREATE INDEX IF NOT EXISTS acon_account_idx ON accumulation_contributions(accumulation_account_id);

CREATE TABLE IF NOT EXISTS accumulation_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  accumulation_account_id uuid NOT NULL REFERENCES accumulation_accounts(id) ON DELETE CASCADE,
  withdrawal_type text NOT NULL DEFAULT 'maturity',
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES users(id),
  approved_at timestamp,
  payout_date date,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS awd_org_idx ON accumulation_withdrawals(organization_id);
CREATE INDEX IF NOT EXISTS awd_account_idx ON accumulation_withdrawals(accumulation_account_id);
CREATE INDEX IF NOT EXISTS awd_status_idx ON accumulation_withdrawals(status);
