-- Extend the tenant-configurable country flag (country_flag_settings) to funeral
-- cases, not just policies.

ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS is_cross_border_flag BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS cross_border_reference TEXT;
