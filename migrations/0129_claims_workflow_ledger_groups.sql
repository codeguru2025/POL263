-- Claims workflow overhaul:
--  * claims.policy_member_id — which covered life the claim is for, so an approved/declined
--    verdict can be written back onto that member (policy_members.claim_status etc.).
--  * investigation_* — "further investigation required" is now a real claim status
--    (under_investigation) that records WHAT is being investigated and the NEXT STEPS, and the
--    findings once it goes back for approval.
--  * decision_* — who decided and why (approval or rejection), in one place.
--  * ledger_amount — what was actually debited from a ledger group's balance on approval.
--  * groups.has_ledger — separates ledger-keeping groups (legacy groups + burial societies) from
--    plain group policies. Backfilled for every existing legacy group, burial society, and any
--    group that already has ledger entries.

ALTER TABLE claims ADD COLUMN IF NOT EXISTS policy_member_id uuid REFERENCES policy_members(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS investigation_reason text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS investigation_next_steps text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS investigation_opened_at timestamp;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS investigation_opened_by uuid REFERENCES users(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS investigation_findings text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS investigation_closed_at timestamp;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS decided_at timestamp;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS ledger_amount numeric(12, 2);
CREATE INDEX IF NOT EXISTS claims_policy_member_idx ON claims (policy_member_id);

ALTER TABLE policy_members ADD COLUMN IF NOT EXISTS claim_status text;
ALTER TABLE policy_members ADD COLUMN IF NOT EXISTS claim_verdict_at timestamp;
ALTER TABLE policy_members ADD COLUMN IF NOT EXISTS claim_verdict_note text;
ALTER TABLE policy_members ADD COLUMN IF NOT EXISTS date_of_death date;

ALTER TABLE groups ADD COLUMN IF NOT EXISTS has_ledger boolean NOT NULL DEFAULT false;
UPDATE groups SET has_ledger = true
WHERE has_ledger = false
  AND (is_legacy = true
       OR type = 'burial_society'
       OR EXISTS (SELECT 1 FROM group_ledger_entries e WHERE e.group_id = groups.id));
