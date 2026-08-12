-- Group ledger: a running premium-in/claim-out balance per group. Distinct from the pool-society
-- tables (group_contributions, group_pool_payouts), which track voluntary member contributions
-- and stay untouched by this — see the groupLedgerEntries comment in shared/schema.ts.

CREATE TABLE IF NOT EXISTS group_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  entry_type text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  description text,
  reference_type text,
  reference_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gle_org_idx ON group_ledger_entries(organization_id);
CREATE INDEX IF NOT EXISTS gle_group_idx ON group_ledger_entries(group_id);
CREATE INDEX IF NOT EXISTS gle_type_idx ON group_ledger_entries(entry_type);
