-- Attendance geofencing: flag clock-in/out scans that land outside a kiosk's configured
-- radius. Advisory only (never blocks a scan) — a manager reviews/dismisses in Team
-- Attendance. Auto-suppressed app-side for any employee with a vehicle checkout that day
-- (drivers, morticians on body removals, and anyone else sent out on an errand).

ALTER TABLE attendance_qr_codes
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER DEFAULT 500;

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS clock_in_off_site BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clock_in_distance_meters INTEGER,
  ADD COLUMN IF NOT EXISTS clock_out_off_site BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clock_out_distance_meters INTEGER,
  ADD COLUMN IF NOT EXISTS off_site_reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS off_site_reviewed_at TIMESTAMP;
