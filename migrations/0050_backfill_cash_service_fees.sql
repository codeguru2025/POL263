-- Backfill platform receivables (2.5%) for historical cash payments that never got a fee entry.
-- Covers two cases:
--   1. Funeral service receipts (service_receipts table) — fee was fire-and-forget before 0049.
--   2. Cash policy payments (payment_transactions, payment_method='cash') — outbox may have failed silently.
-- Safe to re-run: both inserts are guarded by NOT EXISTS on the source foreign key.

-- 1. Funeral service receipts
INSERT INTO platform_receivables
  (id, organization_id, source_service_receipt_id, amount, currency, description, is_settled, created_at)
SELECT
  gen_random_uuid(),
  sr.organization_id,
  sr.id,
  ROUND(sr.amount::numeric * 0.025, 2),
  sr.currency,
  '2.5% on service receipt ' || sr.receipt_number || ' (' || sr.id || ') [backfill]',
  false,
  sr.issued_at
FROM service_receipts sr
WHERE sr.status = 'issued'
  AND NOT EXISTS (
    SELECT 1 FROM platform_receivables pr
    WHERE pr.source_service_receipt_id = sr.id
  );

-- 2. Cash policy premium payments
INSERT INTO platform_receivables
  (id, organization_id, source_transaction_id, amount, currency, description, is_settled, created_at)
SELECT
  gen_random_uuid(),
  pt.organization_id,
  pt.id,
  ROUND(pt.amount::numeric * 0.025, 2),
  pt.currency,
  '2.5% on cash payment ' || pt.id || ' [backfill]',
  false,
  COALESCE(pt.received_at, pt.created_at)
FROM payment_transactions pt
WHERE pt.payment_method = 'cash'
  AND pt.status = 'cleared'
  AND NOT EXISTS (
    SELECT 1 FROM platform_receivables pr
    WHERE pr.source_transaction_id = pt.id
  );
