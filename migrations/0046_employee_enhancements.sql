-- Auto-generate employee numbers (separate sequence from agent codes)
ALTER TABLE org_policy_sequences
  ADD COLUMN IF NOT EXISTS employee_next INTEGER NOT NULL DEFAULT 0;

-- Employment type and contract duration
ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS employment_type       TEXT DEFAULT 'permanent',
  ADD COLUMN IF NOT EXISTS contract_start_date   DATE,
  ADD COLUMN IF NOT EXISTS contract_end_date     DATE;

-- Structured banking details (replaces/supplements jsonb bank_details)
ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS bank_name            TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch          TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number  TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_type    TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch_code     TEXT,
  ADD COLUMN IF NOT EXISTS bank_swift_code      TEXT;
