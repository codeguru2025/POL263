-- Add white-label flag to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_whitelabeled BOOLEAN NOT NULL DEFAULT false;
