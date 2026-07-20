-- Shareable, unauthenticated pay-by-link URLs (/pay/:token) for a specific policy/amount/method.
-- Cash is deliberately never a valid method here; currency is USD-only (matches Paynow).

CREATE TABLE IF NOT EXISTS payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  policy_id UUID NOT NULL REFERENCES policies(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  token TEXT NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  method TEXT NOT NULL,
  payer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  payment_intent_id UUID REFERENCES payment_intents(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pl_org_idx ON payment_links (organization_id);
CREATE INDEX IF NOT EXISTS pl_policy_idx ON payment_links (policy_id);
CREATE INDEX IF NOT EXISTS pl_status_idx ON payment_links (status);

-- Central-DB-only routing pointer (token -> organization_id) so the public, session-less
-- /pay/:token page can resolve which tenant database to query, before it can reach the real
-- payment_links row. Only ever populated in the main DB (see server/storage.ts createPaymentLink) —
-- this table exists in every DB the migration runner touches for schema symmetry, same as
-- organizations/users, but stays empty outside the main DB.
CREATE TABLE IF NOT EXISTS payment_link_tokens (
  token TEXT PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
