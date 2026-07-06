-- Post-mortem out-and-back tracking (applies to both our own bodies and
-- partner-parlour bodies) and partner-parlour vehicle usage for their own
-- removals/burials.

CREATE TABLE IF NOT EXISTS mortuary_post_mortem_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  intake_id uuid NOT NULL REFERENCES mortuary_intakes(id),
  funeral_case_id uuid REFERENCES funeral_cases(id),
  taken_out_at timestamp NOT NULL,
  taken_out_by_user_id uuid REFERENCES users(id),
  taken_to_location text,
  authorized_by text,
  collected_by_name text,
  returned_at timestamp,
  received_back_by_user_id uuid REFERENCES users(id),
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pmm_intake_idx ON mortuary_post_mortem_movements(intake_id);

CREATE TABLE IF NOT EXISTS partner_parlour_vehicle_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  partner_parlour_id uuid NOT NULL REFERENCES partner_parlours(id),
  vehicle_id uuid NOT NULL REFERENCES fleet_vehicles(id),
  driver_id uuid REFERENCES users(id),
  purpose text NOT NULL,
  deceased_name text,
  usage_date_time timestamp NOT NULL,
  destination text,
  returned_at timestamp,
  fee_amount numeric(10,2),
  fee_currency text DEFAULT 'USD',
  fee_status text DEFAULT 'unpaid',
  fee_paid_at timestamp,
  fee_paid_by text,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ppvu_org_idx ON partner_parlour_vehicle_usage(organization_id);
CREATE INDEX IF NOT EXISTS ppvu_parlour_idx ON partner_parlour_vehicle_usage(partner_parlour_id);
