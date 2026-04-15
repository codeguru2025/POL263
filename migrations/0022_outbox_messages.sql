-- 0022: Transactional outbox for post-payment side effects (matches shared/schema.ts `outboxMessages`).
-- Apply with: npm run db:migrate   |   Status: npm run db:migrate:status
CREATE TABLE IF NOT EXISTS outbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}',
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS outbox_org_dedupe_idx ON outbox_messages (organization_id, dedupe_key);
CREATE INDEX IF NOT EXISTS outbox_org_status_created_idx ON outbox_messages (organization_id, status, created_at);
