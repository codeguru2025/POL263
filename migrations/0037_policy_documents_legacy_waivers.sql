-- Migration 0037: Policy documents, legacy policy flag, waiting period waivers

-- ── policies: add is_legacy flag ────────────────────────────
ALTER TABLE policies ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;

-- ── policy_documents ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  policy_id UUID NOT NULL REFERENCES policies(id),
  document_type TEXT NOT NULL,
  label TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_url TEXT NOT NULL,
  storage_key TEXT,
  file_size INTEGER,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS policy_docs_org_idx ON policy_documents(organization_id);
CREATE INDEX IF NOT EXISTS policy_docs_policy_idx ON policy_documents(policy_id);

-- ── waiting_period_waivers ──────────────────────────────────
CREATE TABLE IF NOT EXISTS waiting_period_waivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  policy_id UUID NOT NULL REFERENCES policies(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  supporting_notes TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wpw_org_idx ON waiting_period_waivers(organization_id);
CREATE INDEX IF NOT EXISTS wpw_policy_idx ON waiting_period_waivers(policy_id);
CREATE INDEX IF NOT EXISTS wpw_status_idx ON waiting_period_waivers(status);
