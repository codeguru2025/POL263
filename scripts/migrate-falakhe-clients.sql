-- MIGRATE FALAKHE CLIENTS FROM SHARED DB TO DEDICATED DB
-- Run this in the FALAKHE dedicated DB query editor
-- Source: shared DB (pol263-pool), Target: Falakhe DB

-- 1. First, check how many Falakhe clients are in the wrong place (shared DB)
-- Run this in SHARED DB to see the problem:
-- SELECT COUNT(*) FROM clients WHERE organization_id = '4eadab0e-c61b-40ee-b511-1243e9790179';

-- 2. Copy clients from shared DB to Falakhe DB
-- Insert only clients that don't already exist in Falakhe (by national_id)
INSERT INTO clients (
  id, organization_id, branch_id, first_name, last_name, 
  national_id, phone, email, date_of_birth, gender,
  marital_status, address, activation_code, agent_id,
  preferred_comm_method, location, created_at, updated_at
)
SELECT 
  c.id, c.organization_id, c.branch_id, c.first_name, c.last_name,
  c.national_id, c.phone, c.email, c.date_of_birth, c.gender,
  c.marital_status, c.address, c.activation_code, c.agent_id,
  c.preferred_comm_method, c.location, c.created_at, c.updated_at
FROM dblink('dbname=pol263-pool host=pol263-do-user-37599157-0.l.db.ondigitalocean.com port=25061 user=doadmin password=REDACTED_ROTATED_SECRET sslmode=require',
  'SELECT * FROM clients WHERE organization_id = ''4eadab0e-c61b-40ee-b511-1243e9790179''')
AS c(id uuid, organization_id uuid, branch_id uuid, first_name text, last_name text,
     national_id text, phone text, email text, date_of_birth date, gender text,
     marital_status text, address text, activation_code text, agent_id uuid,
     preferred_comm_method text, location text, created_at timestamp, updated_at timestamp)
WHERE NOT EXISTS (
  SELECT 1 FROM clients f WHERE f.national_id = c.national_id
);

-- If dblink doesn't work, use this alternative approach:
-- Export from shared DB: \copy (SELECT * FROM clients WHERE organization_id = '4eadab0e-c61b-40ee-b511-1243e9790179') TO '/tmp/falakhe_clients.csv' CSV HEADER;
-- Import to Falakhe DB: \copy clients FROM '/tmp/falakhe_clients.csv' CSV HEADER;
