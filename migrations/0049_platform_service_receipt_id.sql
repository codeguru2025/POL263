-- Track which service receipt generated each platform receivable (enables idempotent outbox retries).
ALTER TABLE platform_receivables ADD COLUMN IF NOT EXISTS source_service_receipt_id uuid REFERENCES service_receipts(id);
CREATE INDEX IF NOT EXISTS pr_recv_service_receipt_idx ON platform_receivables (source_service_receipt_id) WHERE source_service_receipt_id IS NOT NULL;
