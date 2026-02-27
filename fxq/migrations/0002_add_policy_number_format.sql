-- Policy number format per tenant: prefix (optional) + zero-padded number (e.g. 00001).
-- Run once per environment.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS policy_number_prefix TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS policy_number_padding INTEGER NOT NULL DEFAULT 5;
