-- Inbound email inbox — mail received at a tenant's provisioned address
-- (e.g. claims@{slug}.pol263.com, gated behind the "email_inbound" module). Staff-triage
-- only: no automatic conversion into claims/feedback, so nothing here starts an SLA clock
-- on unreviewed, possibly spoofed/misrouted mail.

CREATE TABLE IF NOT EXISTS inbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  body_text text,
  body_html text,
  resend_email_id text NOT NULL,
  received_at timestamp NOT NULL,
  status text NOT NULL DEFAULT 'unread',
  linked_note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_emails_org_idx ON inbound_emails (organization_id);
CREATE INDEX IF NOT EXISTS inbound_emails_status_idx ON inbound_emails (organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_resend_id_idx ON inbound_emails (resend_email_id);
