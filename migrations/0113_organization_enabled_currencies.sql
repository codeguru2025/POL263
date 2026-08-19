-- Per-tenant enabled-currency subset, replacing the previously hardcoded fixed 3-currency list
-- (USD/ZAR/ZIG) offered to every tenant regardless of which currencies they actually use. The
-- value is a jsonb array of keys into the curated CURRENCY_CATALOG in shared/validation.ts (not a
-- free-text list an admin could author — same rationale as national_id_format: avoids an
-- unrecognized/junk currency code ending up in a picker).
-- Defaults every existing org to '["USD","ZAR","ZIG"]' so behavior is byte-identical to before
-- this column existed; a tenant needing a different currency mix can change it via Settings.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enabled_currencies jsonb NOT NULL DEFAULT '["USD","ZAR","ZIG"]'::jsonb;
