-- Claims a client submits (client portal, customer-service channel) now go to the Approvals queue
-- like staff-logged claims. There is no staff user behind them, so initiated_by may be empty;
-- request_data.submittedVia records where the claim came from.
ALTER TABLE approval_requests ALTER COLUMN initiated_by DROP NOT NULL;

-- Client-submitted claims already waiting for a decision were never queued — queue them now.
-- (submitted_by is null only for claims a client submitted; staff claims always record who.)
INSERT INTO approval_requests (organization_id, request_type, entity_type, entity_id, request_data, status, initiated_by)
SELECT c.organization_id, 'CLAIM_REVIEW', 'Claim', c.id::text,
       jsonb_build_object(
         'claimNumber', c.claim_number, 'claimType', c.claim_type, 'amount', c.cash_in_lieu_amount,
         'deceasedName', c.deceased_name, 'submittedVia', 'client (queued when client claims joined the approval flow)'
       ),
       'pending', NULL
FROM claims c
WHERE c.submitted_by IS NULL
  AND c.status IN ('submitted', 'verified')
  AND NOT EXISTS (
    SELECT 1 FROM approval_requests ar
    WHERE ar.request_type = 'CLAIM_REVIEW' AND ar.entity_id = c.id::text AND ar.status IN ('pending', 'on_hold')
  );
