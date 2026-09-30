-- Walk-in commission: a payment on a policy with no agent (and not in a society) still earns
-- commission, recorded against the company "Walk-in" account instead of a person. That account is
-- simply agent_id NULL, so the column must allow it (Augustus, 2026-09-30).
ALTER TABLE commission_ledger_entries ALTER COLUMN agent_id DROP NOT NULL;
