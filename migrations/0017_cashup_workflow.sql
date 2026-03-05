-- Cashup workflow: submit -> finance confirm, amounts by payment method, discrepancy handling.
-- amounts_by_method: jsonb e.g. { "cash": "100.00", "paynow_ecocash": "50.00", "paynow_card": "30.00" }
-- counted_amounts_by_method: what finance counted (same keys).
-- status: draft (preparer) -> submitted -> confirmed | discrepancy.

ALTER TABLE cashups
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS amounts_by_method jsonb,
  ADD COLUMN IF NOT EXISTS counted_amounts_by_method jsonb,
  ADD COLUMN IF NOT EXISTS counted_total numeric,
  ADD COLUMN IF NOT EXISTS discrepancy_amount numeric,
  ADD COLUMN IF NOT EXISTS discrepancy_notes text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id);

-- Backfill: existing rows get total_amount in amounts_by_method as cash and status submitted.
UPDATE cashups
SET
  status = 'submitted',
  amounts_by_method = jsonb_build_object('cash', total_amount::text)
WHERE amounts_by_method IS NULL;

-- Ensure total_amount is consistent with amounts_by_method for new rows (app will set both).
COMMENT ON COLUMN cashups.amounts_by_method IS 'Expected amounts per payment method: cash, paynow_ecocash, paynow_card, other';
COMMENT ON COLUMN cashups.counted_amounts_by_method IS 'Counted amounts per method (finance entry)';
COMMENT ON COLUMN cashups.status IS 'draft | submitted | confirmed | discrepancy';
