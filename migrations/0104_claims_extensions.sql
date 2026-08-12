-- Claims: link to groups (for group-ledger debits, future phase), plus an explicit ex-gratia
-- flag/reason so goodwill payouts are a first-class, reportable category instead of being
-- buried in the fraud_flags jsonb column.
--
-- Cash-service quotations link to claims the other way round (funeral_quotations.claim_id, not
-- claims.quotation_id) — mirrors the existing funeral_cases.claim_id "sink" direction, since
-- claims itself referencing forward into quotations would create a circular FK chain through
-- funeral_quotations -> funeral_cases -> claims.

ALTER TABLE claims ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS is_ex_gratia boolean NOT NULL DEFAULT false;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS ex_gratia_reason text;
CREATE INDEX IF NOT EXISTS claims_group_idx ON claims(group_id);

ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES claims(id);
CREATE INDEX IF NOT EXISTS fq_claim_idx ON funeral_quotations(claim_id);
