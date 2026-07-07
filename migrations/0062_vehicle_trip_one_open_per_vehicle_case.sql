-- Prevents two concurrent "Start Trip" clicks from creating two open trip logs for the
-- same vehicle + funeral case (the app-level check alone has a race window).
CREATE UNIQUE INDEX IF NOT EXISTS vtl_one_open_per_vehicle_case_idx
  ON vehicle_trip_logs (vehicle_id, funeral_case_id)
  WHERE end_odometer IS NULL AND funeral_case_id IS NOT NULL;
