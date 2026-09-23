-- Durable marker for reconcileRevenueShareSettlement succeeding on a paid revenue_share/
-- subscription invoice, so the daily tenant billing sweep can find and retry any invoice whose
-- post-payment settlement never completed (process crash, transient DB error) instead of it being
-- silently lost forever — reconciliation was previously fire-and-forget with no durable record of
-- failure, which could double-bill a tenant's platform fees on the next invoice.
ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS settled_at timestamp;
