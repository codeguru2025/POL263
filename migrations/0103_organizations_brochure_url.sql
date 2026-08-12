-- Admin-uploaded product brochure PDF, overriding the auto-generated one.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brochure_url text;
