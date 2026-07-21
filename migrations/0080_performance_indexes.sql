-- Three missing indexes found by a performance audit:
--   1. claims.client_id — getClaimsByClient had no supporting index, only the org-level one,
--      and no row limit either, so a client's claim history got slower to load as claim volume grew.
--   2. payment_receipts.approval_status — the pending-approvals queue filters on this with only
--      the org index to fall back on. Partial index since "pending" is a small subset of all
--      receipts on a high-write table.
--   3. funeral_cases(organization_id, created_at) — the date-sorted case list had no composite
--      index for this, unlike policies (policies_org_status_created_idx) which already has the
--      equivalent.

CREATE INDEX IF NOT EXISTS claims_client_idx ON claims(client_id);

CREATE INDEX IF NOT EXISTS pr_org_pending_idx ON payment_receipts(organization_id)
  WHERE approval_status = 'pending';

CREATE INDEX IF NOT EXISTS fc_org_created_idx ON funeral_cases(organization_id, created_at);
