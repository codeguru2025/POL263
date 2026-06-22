-- Migration 0038: Add period_from / period_to to payment_transactions and payment_receipts

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS period_from DATE,
  ADD COLUMN IF NOT EXISTS period_to   DATE;

ALTER TABLE payment_receipts
  ADD COLUMN IF NOT EXISTS period_from DATE,
  ADD COLUMN IF NOT EXISTS period_to   DATE;
