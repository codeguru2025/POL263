-- Built-in roles remember which template (ROLE_PERMISSION_MAP) was last applied to them, so the
-- startup role sync applies only what changed in code and keeps permissions someone edited in the
-- role matrix. Before this, every restart wiped each role back to the template, so role edits never
-- stuck (Augustus, 2026-10-02).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS template_permissions jsonb;
