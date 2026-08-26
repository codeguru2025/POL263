-- Audit trail for platform-owner actions with no tenant to attach to (app-release CRUD, manual
-- backup trigger) — route-helpers.ts's auditLog() requires an organizationId and writes to a
-- tenant DB's audit_logs table, so these actions were previously invisible to any audit trail.
-- Lives in the control-plane DB since it's the one database every platform-owner request reaches
-- regardless of which tenant (if any) is currently selected.

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  request_id text,
  ip_address text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_audit_logs_created_idx ON platform_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_logs_entity_idx ON platform_audit_logs (entity_type, entity_id);
