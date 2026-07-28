-- Agent-editable vCard contact fields (referral link / vCard divergence feature). Agents can
-- self-edit these via PATCH /api/auth/me; the rest of the users row stays admin-only.

ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website_url text;
