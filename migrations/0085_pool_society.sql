-- Pooled-contribution/society engine (Phase 3d of the multi-vertical platform work). Entirely
-- new tables plus one new nullable column on groups — no existing table's behavior changes.
-- See server/pool-society.ts.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS payout_rules jsonb;

CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id),
  full_name text NOT NULL,
  member_number text,
  status text NOT NULL DEFAULT 'active',
  joined_date date,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gm2_org_idx ON group_members(organization_id);
CREATE INDEX IF NOT EXISTS gm2_group_idx ON group_members(group_id);
CREATE INDEX IF NOT EXISTS gm2_client_idx ON group_members(client_id);

CREATE TABLE IF NOT EXISTS group_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  group_member_id uuid NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  contribution_date date NOT NULL,
  recorded_by uuid REFERENCES users(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gc_org_idx ON group_contributions(organization_id);
CREATE INDEX IF NOT EXISTS gc_group_idx ON group_contributions(group_id);
CREATE INDEX IF NOT EXISTS gc_member_idx ON group_contributions(group_member_id);

CREATE TABLE IF NOT EXISTS group_pool_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  group_member_id uuid NOT NULL REFERENCES group_members(id),
  event_type text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES users(id),
  approved_at timestamp,
  payout_date date,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gpp_org_idx ON group_pool_payouts(organization_id);
CREATE INDEX IF NOT EXISTS gpp_group_idx ON group_pool_payouts(group_id);
CREATE INDEX IF NOT EXISTS gpp_member_idx ON group_pool_payouts(group_member_id);
CREATE INDEX IF NOT EXISTS gpp_status_idx ON group_pool_payouts(status);
