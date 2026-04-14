-- Track automation attempts and reminders for admin visibility.

CREATE TABLE IF NOT EXISTS payment_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  policy_id uuid NOT NULL,
  client_id uuid REFERENCES clients(id),
  action_type text NOT NULL,
  status text NOT NULL,
  method_type text,
  message text,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS par_org_idx ON payment_automation_runs(organization_id);
CREATE INDEX IF NOT EXISTS par_policy_idx ON payment_automation_runs(policy_id);
CREATE INDEX IF NOT EXISTS par_created_idx ON payment_automation_runs(created_at);
