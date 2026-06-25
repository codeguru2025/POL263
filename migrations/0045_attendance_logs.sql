CREATE TABLE IF NOT EXISTS attendance_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id),
  employee_id      UUID NOT NULL REFERENCES payroll_employees(id),
  date             DATE NOT NULL,
  logged_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  approved_by      UUID REFERENCES users(id),
  approved_at      TIMESTAMP,
  approval_notes   TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS al_org_idx      ON attendance_logs(organization_id);
CREATE INDEX IF NOT EXISTS al_emp_date_idx ON attendance_logs(employee_id, date);
CREATE INDEX IF NOT EXISTS al_status_idx   ON attendance_logs(status);
