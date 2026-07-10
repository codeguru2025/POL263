-- QR-based attendance clock-in/out + vehicle GPS tracking.

-- Extend attendance_logs with QR clock-in/out fields; keep existing manual-entry
-- columns/behavior intact (source distinguishes 'manual' vs 'qr').
ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS clock_in_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS clock_out_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS hours_worked NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS clock_in_lat NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS clock_in_lng NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS clock_out_lat NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS clock_out_lng NUMERIC(9, 6);

CREATE TABLE IF NOT EXISTS attendance_qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id),
  label TEXT NOT NULL,
  token TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aqc_org_idx ON attendance_qr_codes (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS aqc_token_unique ON attendance_qr_codes (token);

CREATE TABLE IF NOT EXISTS attendance_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  employee_id UUID NOT NULL REFERENCES payroll_employees(id),
  qr_code_id UUID REFERENCES attendance_qr_codes(id),
  event_type TEXT NOT NULL,
  scanned_at TIMESTAMP NOT NULL DEFAULT now(),
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS as_org_idx ON attendance_scans (organization_id);
CREATE INDEX IF NOT EXISTS as_emp_scanned_idx ON attendance_scans (employee_id, scanned_at);

-- Vehicle GPS tracking, layered on top of the existing (previously unused) driver_assignments
-- table. This is deliberately independent of vehicle_trip_logs / funeral-case trip logging.
ALTER TABLE fleet_vehicles
  ADD COLUMN IF NOT EXISTS speed_limit_kmh INTEGER NOT NULL DEFAULT 120;

ALTER TABLE driver_assignments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- Backfill organization_id on any pre-existing driver_assignments rows via their vehicle.
UPDATE driver_assignments da
  SET organization_id = fv.organization_id
  FROM fleet_vehicles fv
  WHERE da.vehicle_id = fv.id AND da.organization_id IS NULL;

-- Prevents a vehicle from being checked out twice concurrently (app-level check has a race window).
CREATE UNIQUE INDEX IF NOT EXISTS da_one_open_per_vehicle_idx
  ON driver_assignments (vehicle_id)
  WHERE end_date IS NULL;

CREATE TABLE IF NOT EXISTS vehicle_location_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  assignment_id UUID NOT NULL REFERENCES driver_assignments(id),
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
  driver_id UUID NOT NULL REFERENCES users(id),
  latitude NUMERIC(9, 6) NOT NULL,
  longitude NUMERIC(9, 6) NOT NULL,
  speed_kmh NUMERIC(6, 2),
  recorded_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vlp_org_idx ON vehicle_location_pings (organization_id);
CREATE INDEX IF NOT EXISTS vlp_assignment_recorded_idx ON vehicle_location_pings (assignment_id, recorded_at);

CREATE TABLE IF NOT EXISTS vehicle_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  assignment_id UUID NOT NULL REFERENCES driver_assignments(id),
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
  type TEXT NOT NULL,
  triggered_at TIMESTAMP NOT NULL DEFAULT now(),
  details JSONB,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS va_org_idx ON vehicle_alerts (organization_id);
CREATE INDEX IF NOT EXISTS va_assignment_idx ON vehicle_alerts (assignment_id);
