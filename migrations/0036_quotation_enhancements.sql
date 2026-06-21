-- Migration 0036: Enhanced Cash Service Quotations
-- Makes funeralCaseId nullable for standalone quotes, adds extended fields,
-- creates quotation_guarantors and quotation_collateral tables.

-- ── org_policy_sequences: quotation counter ──────────────────
ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS quotation_next INTEGER NOT NULL DEFAULT 0;

-- ── funeral_quotations: make funeral_case_id nullable ────────
ALTER TABLE funeral_quotations ALTER COLUMN funeral_case_id DROP NOT NULL;

-- Drop old all-rows unique index, replace with partial (only enforced when funeral_case_id IS NOT NULL)
DROP INDEX IF EXISTS fq_org_case_idx;
CREATE UNIQUE INDEX IF NOT EXISTS fq_org_case_partial_idx
  ON funeral_quotations(organization_id, funeral_case_id)
  WHERE funeral_case_id IS NOT NULL;

-- ── funeral_quotations: add extended fields ──────────────────
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS informant_full_names TEXT;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS informant_phone TEXT;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS informant_address TEXT;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS deceased_name TEXT;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS deceased_age INTEGER;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS deceased_sex TEXT;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS casket_type TEXT;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS quotation_date DATE;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5, 2) DEFAULT 15;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS grand_total NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS conversion_status TEXT DEFAULT 'pending';
ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS converted_at TIMESTAMP;

-- ── quotation_guarantors ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotation_guarantors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  quotation_id UUID NOT NULL UNIQUE REFERENCES funeral_quotations(id),
  guarantor_name TEXT,
  guarantor_phone TEXT,
  guarantor_address TEXT,
  guarantor_id_number TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qg_quotation_idx ON quotation_guarantors(quotation_id);

-- ── quotation_collateral ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotation_collateral (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  quotation_id UUID NOT NULL REFERENCES funeral_quotations(id),
  item_description TEXT NOT NULL,
  condition TEXT,
  value NUMERIC(12, 2),
  due_date DATE,
  forfeiture_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qc_quotation_idx ON quotation_collateral(quotation_id);
