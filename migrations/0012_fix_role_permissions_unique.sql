-- Remove duplicate role_permission entries before adding unique constraint
DELETE FROM role_permissions a
USING role_permissions b
WHERE a.ctid < b.ctid
  AND a.role_id = b.role_id
  AND a.permission_id = b.permission_id;

-- Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS rp_role_perm_unique_idx ON role_permissions (role_id, permission_id);
