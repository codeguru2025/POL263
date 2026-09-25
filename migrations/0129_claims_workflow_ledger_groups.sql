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

-- Existing claims: link each to its covered member when the deceased's name matches exactly one
-- member on the claim's policy (case/spacing-insensitive). Ambiguous or unmatched claims stay
-- unlinked; staff can pick the member on the claim.
WITH member_names AS (
  SELECT pm.id AS member_id, pm.policy_id,
         lower(regexp_replace(trim(coalesce(d.first_name || ' ' || d.last_name, c.first_name || ' ' || c.last_name, '')), '\s+', ' ', 'g')) AS name
  FROM policy_members pm
  LEFT JOIN dependents d ON d.id = pm.dependent_id
  LEFT JOIN clients c ON c.id = pm.client_id
),
matches AS (
  SELECT cl.id AS claim_id, min(mn.member_id::text)::uuid AS member_id, count(*) AS n
  FROM claims cl
  JOIN member_names mn
    ON mn.policy_id = cl.policy_id
   AND mn.name = lower(regexp_replace(trim(coalesce(cl.deceased_name, '')), '\s+', ' ', 'g'))
  WHERE cl.policy_member_id IS NULL AND coalesce(trim(cl.deceased_name), '') <> ''
  GROUP BY cl.id
)
UPDATE claims SET policy_member_id = m.member_id
FROM matches m
WHERE claims.id = m.claim_id AND m.n = 1;

-- Record the claim state on each linked member (latest claim per member wins).
UPDATE policy_members pm SET
  claim_status = CASE
    WHEN x.status = 'rejected' THEN 'claim_declined'
    WHEN x.status = 'under_investigation' THEN 'under_investigation'
    WHEN x.status IN ('submitted', 'verified') THEN 'claim_pending'
    ELSE 'claimed' END,
  claim_verdict_note = 'Claim ' || x.claim_number || ' — ' || replace(x.status, '_', ' '),
  date_of_death = CASE WHEN x.status IN ('approved', 'scheduled', 'payable', 'completed', 'paid', 'closed') THEN x.date_of_death ELSE NULL END
FROM (
  SELECT DISTINCT ON (policy_member_id) policy_member_id, status, claim_number, date_of_death
  FROM claims WHERE policy_member_id IS NOT NULL
  ORDER BY policy_member_id, created_at DESC
) x
WHERE pm.id = x.policy_member_id AND pm.claim_status IS NULL;

-- Claims stuck by the old bug: the CLAIM_REVIEW request was approved/rejected in the Approvals
-- queue but the claim itself never moved. Put the request back to pending so the decision is
-- taken again through the new workflow (member verdict, ledger deduction, client SMS) instead of
-- being patched in silently here.
UPDATE approval_requests ar SET
  status = 'pending', resolved_at = NULL, approved_by = NULL,
  request_data = coalesce(ar.request_data, '{}'::jsonb) || jsonb_build_object(
    'requeuedReason', 'Was ' || ar.status || ' in the Approvals queue before claims were connected to it — please decide again so the claim, member and SMS are updated.',
    'previousRejectionReason', ar.rejection_reason),
  rejection_reason = NULL
FROM claims cl
WHERE ar.request_type = 'CLAIM_REVIEW'
  AND ar.entity_id = cl.id::text
  AND ar.status IN ('approved', 'rejected')
  AND cl.status IN ('submitted', 'verified');
