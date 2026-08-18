-- Data-retention/privacy policy consent capture at registration. Nullable/additive — existing
-- clients stay null (consent was never captured for them); never backfilled/inferred. Set only by
-- the registration flow going forward (client/src/pages/join/register.tsx), which now requires an
-- explicit checkbox before submission.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS consented_at timestamp;
