CREATE TABLE IF NOT EXISTS daily_report_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  report_date DATE NOT NULL,
  note TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drn_org_date_idx ON daily_report_notes (organization_id, report_date);
