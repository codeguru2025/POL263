-- Access profiles (Phase 7): reusable named permission bundles applied on top of a user's roles.
CREATE TABLE IF NOT EXISTS access_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name            text NOT NULL,
  description     text,
  permissions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_profiles_org_idx ON access_profiles (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS access_profiles_org_name_idx ON access_profiles (organization_id, name);
