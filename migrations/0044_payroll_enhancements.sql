-- Payroll enhancements: allowances, deductions, Zimbabwe statutory taxes, proration

-- payroll_employees: allowances and deduction defaults per employee
ALTER TABLE payroll_employees
  ADD COLUMN IF NOT EXISTS housing_allowance      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS transport_allowance    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS other_allowances       JSONB,
  ADD COLUMN IF NOT EXISTS funeral_policy_deduction  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS other_insurance_deduction NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS nssa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paye_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS aids_levy_enabled      BOOLEAN NOT NULL DEFAULT FALSE;

-- payslips: proration and detailed earnings/deductions breakdown
ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS days_worked        INTEGER,
  ADD COLUMN IF NOT EXISTS total_days         INTEGER,
  ADD COLUMN IF NOT EXISTS earnings           JSONB,
  ADD COLUMN IF NOT EXISTS deductions_detail  JSONB;

CREATE INDEX IF NOT EXISTS payslips_emp_run_idx ON payslips(employee_id, payroll_run_id);
