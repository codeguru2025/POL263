-- FX rates: USD-base conversion rates for consolidated financial statements.
-- rate_to_usd = USD value of 1 unit of currency (USD = 1).
CREATE TABLE IF NOT EXISTS fx_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  currency        text NOT NULL,
  rate_to_usd     numeric(18,8) NOT NULL,
  updated_by      uuid REFERENCES users(id),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_org_currency_idx ON fx_rates (organization_id, currency);
