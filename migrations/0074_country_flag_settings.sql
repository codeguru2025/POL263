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
--
-- Guarded with a WHERE EXISTS rather than a bare INSERT ... VALUES: this migration also runs
-- as part of building a brand-new tenant's isolated database from scratch (per-tenant dedicated-
-- database commissioning replays every migrations/ file against an empty DB) — any database
-- that isn't the shared registry or Falakhe's own doesn't have Falakhe's organization row and
-- never will, so the bare INSERT's foreign key violated immediately and broke schema-only
-- builds for every other tenant. ON CONFLICT DO NOTHING alone doesn't help here: it only
-- suppresses a conflict on the insert target, not a FK violation on a row that doesn't exist at
-- all. Discovered 2026-08-04 provisioning IFALAKHE FUNERAL SERVICES' dedicated database — see
-- docs/BUGFIX-LOG.md.
INSERT INTO country_flag_settings (organization_id, is_enabled, flag_label, home_label)
SELECT '4eadab0e-c61b-40ee-b511-1243e9790179', true, 'South Africa', 'Zimbabwe'
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179')
ON CONFLICT (organization_id) DO NOTHING;
