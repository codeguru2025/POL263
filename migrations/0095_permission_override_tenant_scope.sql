-- Bug fix (2026-07-28 audit): user_permission_overrides had no organization_id, so an override
-- granted/revoked for a user at one org silently followed them to any other org their registry
-- row is later associated with (getUserEffectivePermissions scoped roles per-org correctly but
-- always merged overrides globally by user_id alone). Backfill existing rows from the user's
-- current organization_id — the best available approximation of which org each override was
-- actually granted under, since this is the only org information that existed before this fix.

ALTER TABLE user_permission_overrides ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

UPDATE user_permission_overrides upo
SET organization_id = u.organization_id
FROM users u
WHERE upo.user_id = u.id AND upo.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS upo_user_org_idx ON user_permission_overrides (user_id, organization_id);
