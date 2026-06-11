-- Debit Orders: recurring bank-debit mandates used to collect policy premiums.
-- Additive only: creates one new table + indexes. No changes to existing tables.
CREATE TABLE IF NOT EXISTS debit_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  branch_id          uuid REFERENCES branches(id),
  client_id          uuid REFERENCES clients(id),
  policy_id          uuid REFERENCES policies(id),
  mandate_reference  text NOT NULL,
  account_name       text NOT NULL,
  bank_name          text NOT NULL,
  account_number     text NOT NULL,
  branch_code        text,
  amount             numeric(12,2) NOT NULL,
  currency           text NOT NULL DEFAULT 'USD',
  frequency          text NOT NULL DEFAULT 'monthly',
  day_of_month       integer,
  start_date         date,
  next_run_date      date,
  status             text NOT NULL DEFAULT 'active',
  notes              text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS debit_order_org_idx ON debit_orders (organization_id);
CREATE INDEX IF NOT EXISTS debit_order_status_idx ON debit_orders (status);
CREATE INDEX IF NOT EXISTS debit_order_policy_idx ON debit_orders (policy_id);
CREATE UNIQUE INDEX IF NOT EXISTS debit_order_ref_org_idx ON debit_orders (organization_id, mandate_reference);
