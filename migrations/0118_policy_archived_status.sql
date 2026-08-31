-- "archived" policy status (billing-model engine, Phase 1).
--
-- Cancelling a policy now auto-archives it so it stops attracting the full per-policy platform
-- fee (archived bills at the cheapest rate). `policies.status` is a plain text column with no
-- CHECK constraint or enum, so the new value needs no DDL — this migration only backfills the
-- existing `cancelled` policies to `archived`, leaving an audit trail in policy_status_history.
-- Archived policies remain fully reversible (archived -> active) if the member reinstates.

INSERT INTO policy_status_history (id, policy_id, from_status, to_status, reason, created_at)
SELECT gen_random_uuid(), id, 'cancelled', 'archived',
       'Auto-archived (billing-model migration 0118)', now()
FROM policies
WHERE status = 'cancelled';

UPDATE policies SET status = 'archived' WHERE status = 'cancelled';
