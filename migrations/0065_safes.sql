CREATE TABLE IF NOT EXISTS safes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safe_org_idx ON safes(organization_id);

ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS safe_id UUID REFERENCES safes(id);
