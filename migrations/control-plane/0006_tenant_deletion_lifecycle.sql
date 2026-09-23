-- Tenant deletion lifecycle (Phase 6).
--
-- A tenant suspended for non-payment enters a view-only window: its staff can still log in and
-- READ their data (every mutation is blocked) until view_only_grace_until, after which the
-- account is eligible for permanent deletion. Not retroactive — the billing sweep only stamps
-- view_only_grace_until on tenants it suspends AFTER this ships; tenants already suspended stay
-- fully locked out as before until a platform owner acts on them.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS view_only_grace_until timestamp;

-- Opt-in switch: when true the deletion sweep purges a tenant automatically once its view-only
-- window closes; when false (default) it parks the tenant at license_status='pending_deletion'
-- and notifies the platform owner to run the purge manually.
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS hard_delete_enabled boolean NOT NULL DEFAULT false;
