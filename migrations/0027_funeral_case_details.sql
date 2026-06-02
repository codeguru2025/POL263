-- Funeral case detail fields: deceased info, informant, service type,
-- body removal logistics, burial logistics, attending agent.
-- Uses IF NOT EXISTS so re-running against a DB that already received
-- these columns via db:push is safe.

ALTER TABLE funeral_cases
  ADD COLUMN IF NOT EXISTS date_of_death        date,
  ADD COLUMN IF NOT EXISTS cause_of_death       text,
  ADD COLUMN IF NOT EXISTS place_of_death       text,
  ADD COLUMN IF NOT EXISTS informant_name       text,
  ADD COLUMN IF NOT EXISTS informant_phone      text,
  ADD COLUMN IF NOT EXISTS informant_relationship text,
  ADD COLUMN IF NOT EXISTS service_type         text,
  ADD COLUMN IF NOT EXISTS removal_location     text,
  ADD COLUMN IF NOT EXISTS removal_vehicle_id   uuid REFERENCES fleet_vehicles(id),
  ADD COLUMN IF NOT EXISTS removal_driver_id    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS burial_vehicle_id    uuid REFERENCES fleet_vehicles(id),
  ADD COLUMN IF NOT EXISTS burial_driver_id     uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS attending_agent_id   uuid REFERENCES users(id);
