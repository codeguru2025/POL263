-- Department classification and cost-flag tagging for requisitions, so spend
-- can be broken down by department and by special cost centers (e.g. CEO
-- personal expenses, South Africa branch operations) without a schema change
-- per new flag.

ALTER TABLE requisitions
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS cost_flag text; -- e.g. 'CEO_PERSONAL' | 'SOUTH_AFRICA'
