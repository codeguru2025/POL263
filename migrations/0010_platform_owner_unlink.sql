-- Unlink the platform owner from any tenant so they exist above all tenants.
-- The platform owner's active tenant is now tracked in the session instead.
UPDATE users
SET organization_id = NULL
WHERE email = COALESCE(current_setting('app.superuser_email', true), 'ausiziba@gmail.com')
  AND organization_id IS NOT NULL;
