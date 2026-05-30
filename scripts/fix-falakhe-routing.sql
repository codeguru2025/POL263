-- Fix Falakhe database routing
-- Run this against the MAIN (shared) database where organizations table lives

UPDATE organizations 
SET database_url = 'postgresql://doadmin:REDACTED_ROTATED_SECRET@pol263-falakhe-do-user-37599157-0.l.db.ondigitalocean.com:25061/pol263-falakhe-pool?sslmode=require'
WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179';

-- Verify
SELECT id, name, database_url FROM organizations WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179';
