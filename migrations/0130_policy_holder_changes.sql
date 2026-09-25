-- Change of policyholder (e.g. the policyholder has died and a dependant or another person takes
-- the policy over). The original policyholder always stays on record:
--  * policies.original_client_id — the first-ever policyholder, set once on the first change;
--  * policy_holder_changes — every change, who from/to, why, which claim, who did it;
--  * the old holder's policy_members row is kept (role former_policy_holder), never deleted.

ALTER TABLE policies ADD COLUMN IF NOT EXISTS original_client_id uuid REFERENCES clients(id);

CREATE TABLE IF NOT EXISTS policy_holder_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  from_client_id uuid REFERENCES clients(id),
  to_client_id uuid NOT NULL REFERENCES clients(id),
  from_member_id uuid REFERENCES policy_members(id),
  to_member_id uuid REFERENCES policy_members(id),
  promoted_dependent_id uuid REFERENCES dependents(id),
  reason text NOT NULL,
  claim_id uuid REFERENCES claims(id),
  changed_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phc_policy_idx ON policy_holder_changes (policy_id);
CREATE INDEX IF NOT EXISTS phc_org_idx ON policy_holder_changes (organization_id);
