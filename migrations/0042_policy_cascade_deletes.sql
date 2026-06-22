-- Drop and re-add FKs with ON DELETE CASCADE for policy child tables.
-- Drizzle naming convention: {table}_{column}_{reftable}_{refcolumn}_fk

ALTER TABLE policy_documents
  DROP CONSTRAINT IF EXISTS policy_documents_policy_id_policies_id_fk,
  ADD CONSTRAINT policy_documents_policy_id_policies_id_fk
    FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

ALTER TABLE waiting_period_waivers
  DROP CONSTRAINT IF EXISTS waiting_period_waivers_policy_id_policies_id_fk,
  ADD CONSTRAINT waiting_period_waivers_policy_id_policies_id_fk
    FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

ALTER TABLE policy_members
  DROP CONSTRAINT IF EXISTS policy_members_policy_id_policies_id_fk,
  ADD CONSTRAINT policy_members_policy_id_policies_id_fk
    FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

ALTER TABLE policy_status_history
  DROP CONSTRAINT IF EXISTS policy_status_history_policy_id_policies_id_fk,
  ADD CONSTRAINT policy_status_history_policy_id_policies_id_fk
    FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;
