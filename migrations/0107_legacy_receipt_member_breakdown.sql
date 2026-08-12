-- Optional per-member breakdown for a legacy group's lump-sum receipt (legacy_group_receipts
-- has no Drizzle schema entry — it's a raw-SQL-managed table, see server/routes.ts's
-- POST /api/groups/legacy-receipts). Array of {name, amount} — free text, since a brand-new
-- legacy group (the only case this lump-sum path is for) has no formal client/policy records
-- to reference yet.
ALTER TABLE legacy_group_receipts ADD COLUMN IF NOT EXISTS member_breakdown jsonb;
