-- Add atomic sequence counters for credit notes and month-end runs to org_policy_sequences.
-- The existing count(*)-based approach is non-atomic under concurrent requests.
ALTER TABLE org_policy_sequences
  ADD COLUMN IF NOT EXISTS credit_note_next integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS month_end_run_next integer NOT NULL DEFAULT 0;
