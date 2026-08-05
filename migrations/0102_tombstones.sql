-- Tombstone module: catalogue of tombstone products + physical-goods orders (distinct from
-- funeral policies — order → in_production → ready → delivered → installed lifecycle).

ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS tombstone_order_next integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tombstone_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  branch_id uuid REFERENCES branches(id),
  name text NOT NULL,
  material text,
  size text,
  color text,
  description text,
  price numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  default_supplier_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tci_org_idx ON tombstone_catalog_items (organization_id);

CREATE TABLE IF NOT EXISTS tombstone_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  branch_id uuid REFERENCES branches(id),
  order_number text NOT NULL,
  client_id uuid REFERENCES clients(id),
  funeral_case_id uuid REFERENCES funeral_cases(id),
  deceased_name text NOT NULL,
  catalog_item_id uuid REFERENCES tombstone_catalog_items(id),
  item_description text NOT NULL,
  material text,
  engraving_text text,
  cemetery_id uuid REFERENCES cemeteries(id),
  plot_reference text,
  supplier_name text,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  amount_paid numeric(12, 2) NOT NULL DEFAULT '0',
  status text NOT NULL DEFAULT 'ordered',
  ordered_date date NOT NULL,
  expected_delivery_date date,
  delivered_date date,
  installed_date date,
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (organization_id, order_number)
);

CREATE INDEX IF NOT EXISTS tord_org_idx ON tombstone_orders (organization_id);
CREATE INDEX IF NOT EXISTS tord_status_idx ON tombstone_orders (organization_id, status);

CREATE TABLE IF NOT EXISTS tombstone_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  order_id uuid NOT NULL REFERENCES tombstone_orders(id),
  receipt_number text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  payment_channel text NOT NULL DEFAULT 'cash',
  received_by_user_id uuid REFERENCES users(id),
  notes text,
  paid_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS top_org_idx ON tombstone_order_payments (organization_id);
CREATE INDEX IF NOT EXISTS top_order_idx ON tombstone_order_payments (order_id);
