-- Per-tenant email domain state (Resend). One row per tenant that has opted into the
-- "email_inbound" module — subdomain, the Resend domain resource id, and verification/
-- receiving status. No secrets here (the Resend API key is a single global env var, not
-- per-tenant) — this is routing/status data only, same spirit as tenant_domains.

CREATE TABLE IF NOT EXISTS tenant_email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subdomain text NOT NULL,
  resend_domain_id text NOT NULL,
  from_address text,
  sending_verified boolean NOT NULL DEFAULT false,
  receiving_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_domains_tenant_idx ON tenant_email_domains (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_domains_subdomain_idx ON tenant_email_domains (subdomain);
