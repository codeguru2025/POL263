CREATE TABLE IF NOT EXISTS mortuary_service_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  service_key TEXT NOT NULL,
  name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  category TEXT,
  pricing_type TEXT NOT NULL,
  base_amount NUMERIC(10,2) NOT NULL,
  per_km_rate NUMERIC(10,4),
  tier_group_size INTEGER,
  tier_group_price NUMERIC(10,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS msr_org_idx ON mortuary_service_rates(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS msr_org_key_clienttype_idx ON mortuary_service_rates(organization_id, service_key, client_type);

CREATE TABLE IF NOT EXISTS case_service_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  funeral_case_id UUID NOT NULL REFERENCES funeral_cases(id),
  mortuary_intake_id UUID REFERENCES mortuary_intakes(id),
  service_rate_id UUID REFERENCES mortuary_service_rates(id),
  service_key TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  distance_km NUMERIC(10,2),
  computed_amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'unpaid',
  paid_at TIMESTAMP,
  paid_by TEXT,
  paid_by_user_id UUID REFERENCES users(id),
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS csc_case_idx ON case_service_charges(funeral_case_id);

-- Seed default rate card for every existing org — 16 services x 2 client types (direct-client
-- rates are seeded equal to partner-parlour rates until the org gives real numbers; both are
-- editable afterward via the Service Rates settings tab). Safe to re-run: ON CONFLICT DO NOTHING
-- against the (organization_id, service_key, client_type) unique index.
INSERT INTO mortuary_service_rates
  (organization_id, service_key, name, client_type, category, pricing_type, base_amount, per_km_rate, tier_group_size, tier_group_price, currency)
SELECT o.id, s.service_key, s.name, ct.client_type, s.category, s.pricing_type, s.base_amount, s.per_km_rate, s.tier_group_size, s.tier_group_price, 'USD'
FROM organizations o
CROSS JOIN (VALUES ('partner_parlour'), ('direct_client')) AS ct(client_type)
CROSS JOIN (VALUES
  ('body_wash',        'Body Wash',           'mortuary',       'flat',         10.00, NULL, NULL, NULL),
  ('chapel',           'Chapel',              'mortuary',       'flat',         10.00, NULL, NULL, NULL),
  ('removal',          'Body Removal',        'mortuary',       'per_km',       40.00, 1.50, NULL, NULL),
  ('burial',           'Burial',              'mortuary',       'per_km',       40.00, 1.50, NULL, NULL),
  ('gravesite_chairs', 'Gravesite Chairs',    'event_services', 'tiered_group',  0.00, NULL,    3, 1.00),
  ('mourners_tent',    'Mourners Tent',       'event_services', 'flat',         25.00, NULL, NULL, NULL),
  ('pa_system',        'PA System',           'event_services', 'flat',         70.00, NULL, NULL, NULL),
  ('vip_tent',         'VIP Tent (50m2)',     'event_services', 'flat',         80.00, NULL, NULL, NULL),
  ('red_carpet',       'Red Carpet',          'event_services', 'flat',         20.00, NULL, NULL, NULL),
  ('green_carpet',     'Green Carpet',        'event_services', 'flat',         40.00, NULL, NULL, NULL),
  ('flowers',          'Flowers',             'event_services', 'flat',         15.00, NULL, NULL, NULL),
  ('pulpit',           'Pulpit',              'event_services', 'flat',         10.00, NULL, NULL, NULL),
  ('livestreaming',    'Livestreaming',       'event_services', 'flat',        100.00, NULL, NULL, NULL),
  ('videography',      'Videography',         'event_services', 'flat',        100.00, NULL, NULL, NULL),
  ('photography',      'Photography',         'event_services', 'flat',         50.00, NULL, NULL, NULL),
  ('kombi_13_seater',  '13-Seater Kombi',     'transport',      'per_km',       75.00, 1.50, NULL, NULL)
) AS s(service_key, name, category, pricing_type, base_amount, per_km_rate, tier_group_size, tier_group_price)
ON CONFLICT (organization_id, service_key, client_type) DO NOTHING;
