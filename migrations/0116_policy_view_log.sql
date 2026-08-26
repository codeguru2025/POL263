-- Read/view-level activity on a policy (viewing it, downloading a document, a client viewing
-- their own cover) — distinct from audit_logs, which only ever captures mutations. Feeds the
-- per-policy "Policy Logs" timeline (server/policy-activity-log.ts) alongside audit_logs.
CREATE TABLE IF NOT EXISTS policy_view_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  policy_id       UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  actor_type      TEXT NOT NULL,
  actor_id        TEXT,
  actor_label     TEXT,
  action          TEXT NOT NULL,
  detail          JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pvl_policy_idx ON policy_view_log(policy_id);
CREATE INDEX IF NOT EXISTS pvl_org_idx ON policy_view_log(organization_id);
