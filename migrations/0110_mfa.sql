-- TOTP MFA, opt-in — additive/nullable, every existing user stays unenrolled (mfa_enabled
-- false) until they set it up themselves via Settings. Nothing reads mfa_secret/mfa_backup_codes
-- until mfa_enabled is true, so leaving them null is inert.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes jsonb;
