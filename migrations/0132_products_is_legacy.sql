-- A product can be marked legacy (a book migrated from a paper/old system). Agents earn only the
-- recurring 10% on every month of a legacy product — no 50% joining commission, since the old
-- system already paid that. Before this, only policies.is_legacy / groups.is_legacy could say so,
-- and policies on a legacy product without either flag were paid 50% as new business.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;

-- Existing legacy products (Falakhe: LEGACY INDIVIDUAL / LEGACY GROUP).
UPDATE products SET is_legacy = true WHERE code IN ('LEGIND', 'LEGGRP') OR name ILIKE 'legacy %';
