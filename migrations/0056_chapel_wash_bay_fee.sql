-- Chapel & wash bay usage fee on mortuary dispatch, for partner-parlour cases
-- that use our facilities. Flat $20 fee, auto-applied when chapel_wash_bay_used
-- is set true on a dispatch tied to a partner-parlour intake (mirrors the
-- existing storage-fee pattern on mortuary_intakes).

ALTER TABLE mortuary_dispatches
  ADD COLUMN IF NOT EXISTS chapel_wash_bay_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS chapel_wash_bay_fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS chapel_wash_bay_fee_currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS chapel_wash_bay_fee_status text DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS chapel_wash_bay_fee_paid_at timestamp,
  ADD COLUMN IF NOT EXISTS chapel_wash_bay_fee_paid_by text;
