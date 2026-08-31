-- Phase 4b: the exact "as of" timestamp a usage-model invoice (per_policy / revenue_share) was
-- cut. reconcileRevenueShareSettlement settles the tenant's platform_receivables with
-- created_at <= this value, so a chronically-late tenant whose next invoice is generated before
-- their previous one is paid never has the new period's receivables settled early.
ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS usage_cut_at timestamp;
