-- Migration 0035: Mortuary Register, Driver Checklists, Belongings, Body Wash Requirements
-- Adds service timing + body ID fields to funeral_cases, then creates 5 new tables.

-- ── org_policy_sequences: add mortuary counter ──────────────
ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS mortuary_next INTEGER NOT NULL DEFAULT 0;

-- ── funeral_cases additions ──────────────────────────────────
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS body_wash_time TIMESTAMP;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS burial_departure_time TIMESTAMP;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS memorial_service_start TIMESTAMP;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS memorial_service_end TIMESTAMP;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS body_identifier_name TEXT;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS body_identifier_id_number TEXT;

-- ── mortuary_intakes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mortuary_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id),
  funeral_case_id UUID REFERENCES funeral_cases(id),
  intake_number TEXT NOT NULL,
  service_scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_storage',
  deceased_name TEXT NOT NULL,
  deceased_gender TEXT,
  deceased_age INTEGER,
  deceased_national_id TEXT,
  date_of_death DATE,
  cause_of_death TEXT,
  place_of_death TEXT,
  client_organization_name TEXT,
  informant_name TEXT,
  informant_phone TEXT,
  informant_relationship TEXT,
  removal_location TEXT,
  removal_date_time TIMESTAMP,
  removal_vehicle_id UUID REFERENCES fleet_vehicles(id),
  removal_driver_id UUID REFERENCES users(id),
  received_by_user_id UUID REFERENCES users(id),
  received_at TIMESTAMP,
  receiver_acknowledged_name TEXT,
  receiver_acknowledged_id_number TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mi_org_idx ON mortuary_intakes(organization_id);
CREATE INDEX IF NOT EXISTS mi_case_idx ON mortuary_intakes(funeral_case_id);

-- ── mortuary_dispatches ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS mortuary_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  intake_id UUID NOT NULL REFERENCES mortuary_intakes(id),
  funeral_case_id UUID REFERENCES funeral_cases(id),
  dispatched_by_user_id UUID REFERENCES users(id),
  dispatched_at TIMESTAMP,
  collected_by_name TEXT,
  collected_by_id_number TEXT,
  collected_by_organization TEXT,
  destination TEXT,
  collector_acknowledged_name TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS md_intake_idx ON mortuary_dispatches(intake_id);

-- ── deceased_belongings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS deceased_belongings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  intake_id UUID REFERENCES mortuary_intakes(id),
  funeral_case_id UUID REFERENCES funeral_cases(id),
  item_description TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  submitted_by_name TEXT,
  received_by_user_id UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS db_intake_idx ON deceased_belongings(intake_id);

-- ── body_wash_requirements ───────────────────────────────────
CREATE TABLE IF NOT EXISTS body_wash_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  intake_id UUID NOT NULL REFERENCES mortuary_intakes(id),
  funeral_case_id UUID REFERENCES funeral_cases(id),
  clothes_provided BOOLEAN DEFAULT FALSE,
  blanket_provided BOOLEAN DEFAULT FALSE,
  wreath_provided BOOLEAN DEFAULT FALSE,
  other_items TEXT,
  washed_by_name TEXT,
  completed_at TIMESTAMP,
  completed_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bwr_intake_idx ON body_wash_requirements(intake_id);

-- ── driver_checklists ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  funeral_case_id UUID NOT NULL UNIQUE REFERENCES funeral_cases(id),
  driver_id UUID REFERENCES users(id),
  grave_tent BOOLEAN DEFAULT FALSE,
  lowering_device BOOLEAN DEFAULT FALSE,
  gloves BOOLEAN DEFAULT FALSE,
  masks BOOLEAN DEFAULT FALSE,
  fuel_gauge TEXT,
  toll_gate_required BOOLEAN DEFAULT FALSE,
  toll_gate_amount NUMERIC(10, 2),
  driver_allowance NUMERIC(10, 2),
  burial_order_ref TEXT,
  prepared_by_user_id UUID REFERENCES users(id),
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dc_case_idx ON driver_checklists(funeral_case_id);
