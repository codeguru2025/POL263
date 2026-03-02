-- Fix default policy status to match application logic (was 'draft', should be 'inactive')
ALTER TABLE policies ALTER COLUMN status SET DEFAULT 'inactive';

-- Update any stale 'draft' policies to 'inactive' (no valid transitions exist from 'draft')
UPDATE policies SET status = 'inactive' WHERE status = 'draft';
