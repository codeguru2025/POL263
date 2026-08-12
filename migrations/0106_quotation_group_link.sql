-- Marks a cash-service quotation as payable from a burial society's group ledger rather than
-- cash — the "special quotation type" for group services. See the groupId comment on
-- funeralQuotations in shared/schema.ts.

ALTER TABLE funeral_quotations ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups(id);
CREATE INDEX IF NOT EXISTS fq_group_idx ON funeral_quotations(group_id);
