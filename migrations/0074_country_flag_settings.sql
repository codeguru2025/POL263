-- Tenant-configurable country/cross-border flagging. Generalizes Falakhe's
-- original hardcoded "South Africa" flag on policies (see 0059) into an
-- opt-in, per-org feature with custom labels.

CREATE TABLE IF NOT EXISTS country_flag_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  flag_label TEXT NOT NULL DEFAULT 'South Africa',
  home_label TEXT NOT NULL DEFAULT 'Zimbabwe',
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Falakhe Funeral Services already relies on this flag in production (policies
-- created since 2026-07-06) — keep it enabled with its existing labels so
-- nothing changes for them once the UI becomes conditional on this setting.
INSERT INTO country_flag_settings (organization_id, is_enabled, flag_label, home_label)
VALUES ('4eadab0e-c61b-40ee-b511-1243e9790179', true, 'South Africa', 'Zimbabwe')
ON CONFLICT (organization_id) DO NOTHING;
