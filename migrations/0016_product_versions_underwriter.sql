-- Add underwriter amount and advance months to product_versions (tenant pays underwriter per adult/child, optionally in advance).
ALTER TABLE product_versions
  ADD COLUMN IF NOT EXISTS underwriter_amount_adult numeric,
  ADD COLUMN IF NOT EXISTS underwriter_amount_child numeric,
  ADD COLUMN IF NOT EXISTS underwriter_advance_months integer NOT NULL DEFAULT 0;
