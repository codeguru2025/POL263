-- Lets a tenant's own verified domain send its transactional emails (quote PDFs, receipts,
-- policy documents, notifications) instead of the shared platform address — same Resend
-- account/API key, since one account can send from any of its verified domains. Null by default
-- (platform address is the fallback); set manually once an admin confirms the domain shows
-- "verified" in Resend — see server/email-service.ts resolveFromAddress.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS email_from_address TEXT;
