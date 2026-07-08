ALTER TABLE payment_disbursements ADD COLUMN IF NOT EXISTS entity_amount NUMERIC(12,2);
ALTER TABLE payment_disbursements ADD COLUMN IF NOT EXISTS fx_rate_applied NUMERIC(18,8);
