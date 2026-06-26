-- Requisition line items: one requisition can have multiple items.
-- The parent requisition.amount stores the computed total (sum of item totals).
CREATE TABLE IF NOT EXISTS requisition_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id   uuid NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  description      text NOT NULL,
  category         text NOT NULL,
  qty              numeric(10,2) NOT NULL DEFAULT 1,
  unit_price       numeric(12,2) NOT NULL,
  total            numeric(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS req_item_req_idx ON requisition_items (requisition_id);
