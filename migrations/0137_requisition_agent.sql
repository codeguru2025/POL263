-- A requisition that pays an agent their commission names the agent, so the payout reduces what
-- that agent is owed (Reports → Agents → Commissions). A "Commission" requisition with no agent is
-- an ordinary expense (e.g. a referral fee to someone who isn't an agent) (Augustus, 2026-10-02).
ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS req_agent_idx ON requisitions (agent_id) WHERE agent_id IS NOT NULL;
