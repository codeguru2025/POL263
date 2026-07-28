-- vCard usage analytics: page views and quote requests, structurally modeled on payment_events
-- (append-only, org+actor scoped, jsonb payload) rather than audit_logs, which is purpose-built
-- for staff-action compliance audit trail and not designed for high-volume unauthenticated writes.

CREATE TABLE IF NOT EXISTS agent_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  agent_id uuid NOT NULL REFERENCES users(id),
  ref_code text NOT NULL,
  event_type text NOT NULL,
  payload_json jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ace_agent_created_idx ON agent_card_events (agent_id, created_at);
