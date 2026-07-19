CREATE TABLE IF NOT EXISTS cemeteries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id),
  name TEXT NOT NULL,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cem_org_idx ON cemeteries(organization_id);

ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS overnight_used BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS overnight_date DATE;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS overnight_location TEXT;
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS overnight_vehicle_id UUID REFERENCES fleet_vehicles(id);
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS overnight_driver_id UUID REFERENCES users(id);
ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS cemetery_id UUID REFERENCES cemeteries(id);

CREATE TABLE IF NOT EXISTS equipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id),
  name TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eq_org_idx ON equipment_items(organization_id);

CREATE TABLE IF NOT EXISTS pitching_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id),
  funeral_case_id UUID NOT NULL REFERENCES funeral_cases(id),
  cemetery_id UUID REFERENCES cemeteries(id),
  assignment_date DATE NOT NULL,
  vehicle_id UUID REFERENCES fleet_vehicles(id),
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pa_date_idx ON pitching_assignments(organization_id, assignment_date);
CREATE INDEX IF NOT EXISTS pa_case_idx ON pitching_assignments(funeral_case_id);

CREATE TABLE IF NOT EXISTS pitching_assignment_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitching_assignment_id UUID NOT NULL REFERENCES pitching_assignments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS pas_assignment_idx ON pitching_assignment_staff(pitching_assignment_id);

CREATE TABLE IF NOT EXISTS pitching_assignment_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitching_assignment_id UUID NOT NULL REFERENCES pitching_assignments(id) ON DELETE CASCADE,
  equipment_item_id UUID NOT NULL REFERENCES equipment_items(id)
);
CREATE INDEX IF NOT EXISTS pae_assignment_idx ON pitching_assignment_equipment(pitching_assignment_id);
