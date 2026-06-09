-- Premium change ledger: records each effective-dated premium change (product
-- upgrade/downgrade, member add/remove, manual override) and the reconciliation
-- amount posted to the signed policy_credit_balances wallet.
-- Uses IF NOT EXISTS so re-running after a db:push is safe.

CREATE TABLE IF NOT EXISTS policy_premium_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  policy_id       uuid NOT NULL REFERENCES policies(id),
  old_premium     numeric(12,2) NOT NULL,
  new_premium     numeric(12,2) NOT NULL,
  currency        text NOT NULL DEFAULT 'USD',
  effective_date  date NOT NULL,
  periods         integer NOT NULL DEFAULT 0,
  reconciliation  numeric(12,2) NOT NULL DEFAULT 0,
  change_type     text NOT NULL,
  reason          text,
  actor_id        uuid REFERENCES users(id),
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ppc_org_idx ON policy_premium_changes (organization_id);
CREATE INDEX IF NOT EXISTS ppc_policy_idx ON policy_premium_changes (policy_id);
