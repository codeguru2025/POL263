-- Per-tenant IANA timezone, replacing the previously hardcoded Africa/Harare assumption used
-- throughout server/date-utils.ts for "today"/grace/lapse/notification-timing computations.
-- Defaults every existing org to Africa/Harare so behavior is byte-identical to before this
-- column existed; a tenant operating elsewhere can change it via Settings.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Harare';
