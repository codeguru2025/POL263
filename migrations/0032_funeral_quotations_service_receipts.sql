-- Funeral quotations (cash-service pricing to the family) + service receipts
-- (actual cash-service payments, not tied to a policy). Service receipts feed the
-- income statement and daily cash-ups.

CREATE TABLE IF NOT EXISTS funeral_quotations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  funeral_case_id  uuid NOT NULL REFERENCES funeral_cases(id),
  quotation_number text NOT NULL,
  currency         text NOT NULL DEFAULT 'USD',
  total            numeric(12,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'draft',
  notes            text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fq_org_idx ON funeral_quotations (organization_id);
CREATE INDEX IF NOT EXISTS fq_case_idx ON funeral_quotations (funeral_case_id);
CREATE UNIQUE INDEX IF NOT EXISTS fq_number_org_idx ON funeral_quotations (organization_id, quotation_number);

CREATE TABLE IF NOT EXISTS funeral_quotation_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id       uuid NOT NULL REFERENCES funeral_quotations(id),
  price_book_item_id uuid REFERENCES price_book_items(id),
  description        text NOT NULL,
  quantity           numeric(12,2) NOT NULL DEFAULT 1,
  unit_price         numeric(12,2) NOT NULL,
  line_total         numeric(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS fqi_quotation_idx ON funeral_quotation_items (quotation_id);

CREATE TABLE IF NOT EXISTS service_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  branch_id         uuid REFERENCES branches(id),
  funeral_case_id   uuid REFERENCES funeral_cases(id),
  quotation_id      uuid REFERENCES funeral_quotations(id),
  receipt_number    text NOT NULL,
  amount            numeric(12,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'USD',
  payment_channel   text NOT NULL,
  issued_by_user_id uuid REFERENCES users(id),
  issued_at         timestamp NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'issued',
  notes             text,
  metadata_json     jsonb,
  created_at        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sr_org_idx ON service_receipts (organization_id);
CREATE INDEX IF NOT EXISTS sr_case_idx ON service_receipts (funeral_case_id);
CREATE UNIQUE INDEX IF NOT EXISTS sr_receipt_org_idx ON service_receipts (organization_id, receipt_number);
