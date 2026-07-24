-- Default/home driver per fleet vehicle — pre-fills (but doesn't constrain) the driver field
-- whenever the vehicle is picked for a specific duty (removal/burial/overnight/ad-hoc usage).
-- Additive, nullable — every existing vehicle simply has no default driver until staff set one.

ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS default_driver_id uuid REFERENCES users(id);
