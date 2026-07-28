-- Shareable, persisted product recommendations (server/quote-engine.ts). quote_tokens is a
-- central-DB routing pointer (same pattern as payment_link_tokens) so the public /quote/:id page
-- can resolve which org's database holds the real quotes row before any session/tenant context
-- exists. quotes.id is generated up front by the app and used as the quote_tokens.token value —
-- there is no separate "share token" distinct from the quote's own id.

CREATE TABLE IF NOT EXISTS quote_tokens (
  token text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  agent_id uuid REFERENCES users(id),
  lead_id uuid REFERENCES leads(id),
  ref_code text,
  policyholder_name text NOT NULL,
  policyholder_date_of_birth date NOT NULL,
  dependents_json jsonb NOT NULL DEFAULT '[]',
  recommended_product_id uuid,
  recommended_product_version_id uuid,
  recommended_product_name text,
  recommended_premium numeric,
  currency text NOT NULL DEFAULT 'USD',
  payment_schedule text NOT NULL DEFAULT 'monthly',
  alternatives_json jsonb NOT NULL DEFAULT '[]',
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS quotes_org_idx ON quotes (organization_id);
CREATE INDEX IF NOT EXISTS quotes_lead_idx ON quotes (lead_id);
