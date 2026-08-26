-- Formalizes legacy_group_receipts as a real migrated table on every tenant DB, gated behind the
-- new "legacy_records" module flag (server/module-gate.ts) — previously this table only existed
-- on Falakhe's dedicated DB via a one-off script (scripts/setup-falakhe-legacy-groups.mjs), so any
-- other tenant hit either a crash (before the try/catch added 2026-08-19) or a silent empty result
-- when using the group-ledger legacy-import feature. Column shape exactly matches the pre-existing
-- hand-created table (including recorded_at's default), so this is a true no-op on Falakhe's DB
-- and on the shared DB (where it may already exist for the same reason) — CREATE TABLE IF NOT
-- EXISTS / CREATE INDEX IF NOT EXISTS throughout.
CREATE TABLE IF NOT EXISTS legacy_group_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  group_id        UUID NOT NULL REFERENCES groups(id),
  group_name      TEXT NOT NULL,
  receipt_number  TEXT,
  amount          NUMERIC(12,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  payment_date    DATE NOT NULL,
  notes           TEXT,
  member_breakdown JSONB,
  recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lgr_org_idx ON legacy_group_receipts(organization_id);
CREATE INDEX IF NOT EXISTS lgr_group_idx ON legacy_group_receipts(group_id);

-- Configurable prefix/padding for legacy-group receipt numbers, matching the pattern
-- policy_number_prefix/padding already established. Defaults preserve today's hardcoded
-- "LGR-YYYYMMDD-NNN" format exactly (prefix "LGR", 3-digit sequence padding).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legacy_receipt_number_prefix TEXT NOT NULL DEFAULT 'LGR';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legacy_receipt_number_padding INTEGER NOT NULL DEFAULT 3;
