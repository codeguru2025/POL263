-- Requisitions: expenditure request -> approve -> pay workflow.
-- Only status='paid' rows count as expenses on the (cash-basis) income statement.
CREATE TABLE IF NOT EXISTS requisitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  branch_id          uuid REFERENCES branches(id),
  requisition_number text NOT NULL,
  category           text NOT NULL,
  description        text NOT NULL,
  payee              text,
  amount             numeric(12,2) NOT NULL,
  currency           text NOT NULL DEFAULT 'USD',
  status             text NOT NULL DEFAULT 'draft',
  requested_by       uuid NOT NULL REFERENCES users(id),
  approved_by        uuid REFERENCES users(id),
  approved_at        timestamp,
  rejection_reason   text,
  paid_by            uuid REFERENCES users(id),
  paid_at            timestamp,
  paid_date          date,
  payment_method     text,
  reference          text,
  notes              text,
  created_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS req_org_idx ON requisitions (organization_id);
CREATE INDEX IF NOT EXISTS req_status_idx ON requisitions (status);
CREATE UNIQUE INDEX IF NOT EXISTS req_number_org_idx ON requisitions (organization_id, requisition_number);
