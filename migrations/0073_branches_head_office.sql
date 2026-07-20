-- Default branch: flag one "Head Office" branch per org so policy/funeral-case/
-- mortuary-intake creation can fall back to it when no branch is explicitly chosen.

ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_head_office BOOLEAN NOT NULL DEFAULT false;

-- At most one head office per org.
CREATE UNIQUE INDEX IF NOT EXISTS branches_one_head_office_per_org
  ON branches (organization_id)
  WHERE is_head_office = true;

-- Backfill: flag the branch named 'Head Office' (case-insensitive) for each org,
-- picking the earliest-created one if there's more than one with that name.
WITH ranked AS (
  SELECT id, organization_id,
         ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at ASC) AS rn
  FROM branches
  WHERE lower(name) = 'head office'
)
UPDATE branches
SET is_head_office = true
FROM ranked
WHERE branches.id = ranked.id AND ranked.rn = 1;
