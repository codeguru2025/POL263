-- A funeral case and a claim can each only ever link to one of the other — same "one link per
-- case" rule already enforced for quotations (see 0036_quotation_enhancements.sql's
-- fq_org_case_partial_idx). Without this, two concurrent POST /api/claims calls for the same
-- funeralCaseId could both pass the app-level "not already linked" check and orphan one of them.

CREATE UNIQUE INDEX IF NOT EXISTS fc_org_claim_partial_idx
  ON funeral_cases(organization_id, claim_id)
  WHERE claim_id IS NOT NULL;
