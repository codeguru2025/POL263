-- A group (society / group scheme) can have one responsible agent. Setting it moves every policy
-- in the group to that agent, and policies added to the group later pick it up. For societies
-- (ledger groups) the agent earns 10% of whatever the group pays — commission is on the group's
-- payment, not per policy (server/ledger-group-receipt.ts).
ALTER TABLE groups ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES users(id);
