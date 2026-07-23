-- Applicant risk assessment engine (Phase 3c of the multi-vertical platform work). Additive/
-- nullable — irrelevant to every existing product version and policy. See server/underwriting.ts.

ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS requires_underwriting boolean NOT NULL DEFAULT false;
ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS underwriting_questions jsonb;

ALTER TABLE policies ADD COLUMN IF NOT EXISTS underwriting_status text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS underwriting_answers jsonb;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS underwriting_loading_percent numeric(5, 2);
ALTER TABLE policies ADD COLUMN IF NOT EXISTS underwriting_decided_at timestamp;
