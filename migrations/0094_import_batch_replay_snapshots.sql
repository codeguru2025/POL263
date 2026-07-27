-- Legacy payment import now replays historical payments through the real policy-cycle engine
-- (advancePolicyCycle/applyPolicyStatusForClearedPayment) instead of just inserting inert
-- receipt rows, so an imported policy's grace/lapsed status and next-due-date are computed
-- exactly like a native one. Since replay mutates the policy's live state, rollback needs to
-- know "what did this policy look like right before/after this batch touched it" to safely
-- detect whether anything else has changed it since.

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS replay_snapshots jsonb;
