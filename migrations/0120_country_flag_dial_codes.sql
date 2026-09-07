-- Per-org dial codes for SMS/WhatsApp phone normalization.
--
-- server/phone.ts prepends a country code to any recipient number stored in local "0…" format.
-- That code was a single global env var (SMS_DEFAULT_COUNTRY_CODE, default "263"), which
-- misdelivers a cross-border tenant's clients — Falakhe has both Zimbabwean and South African
-- clients, and a South African "0821234567" was getting "263" prepended instead of "27".
--
-- These two columns move the choice into the existing tenant-configurable country-flag settings:
-- server/notifications.ts picks flag_country_code when the policy being notified about carries
-- the cross-border flag, home_country_code otherwise. Defaults preserve today's behavior (every
-- current tenant is Zimbabwe-based).

ALTER TABLE country_flag_settings
  ADD COLUMN IF NOT EXISTS home_country_code TEXT NOT NULL DEFAULT '263',
  ADD COLUMN IF NOT EXISTS flag_country_code TEXT NOT NULL DEFAULT '27';
