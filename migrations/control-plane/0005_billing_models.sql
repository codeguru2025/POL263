-- Billing-model engine (Phase 1).
--
-- Adds a `billing_model` dimension (flat | per_policy | revenue_share) to plans and tenant
-- subscriptions, plus a purchasable-feature catalog whose price impacts stack onto a plan's
-- base fee / per-policy rate / revenue-share percent.
--
-- 100% additive + backfilled-to-current-behaviour: every existing plan becomes 'flat' and every
-- existing subscription 'setup_fee_status = not_applicable', so nothing changes for current
-- tenants. tenant_invoices gains `kind` (default 'subscription') and `line_items`, and four
-- columns that only ever held subscription data become nullable so setup / one-off invoices fit.

-- ── billing_plans ────────────────────────────────────────────────────────────
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS billing_model          text NOT NULL DEFAULT 'flat';
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS base_fee_usd           numeric(12,2);
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS included_policy_units  integer NOT NULL DEFAULT 1000;
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS per_status_rates       jsonb;
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS revenue_share_percent  numeric(5,2);
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS monthly_minimum_usd    numeric(12,2) NOT NULL DEFAULT 250.00;
ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS setup_fee_usd          numeric(12,2);

-- ── billing_features (purchasable feature catalog) ───────────────────────────
CREATE TABLE IF NOT EXISTS billing_features (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                         text NOT NULL,
  name                        text NOT NULL,
  description                 text,
  base_fee_delta_usd          numeric(12,2) NOT NULL DEFAULT 0,
  per_policy_rate_delta_usd   numeric(8,4)  NOT NULL DEFAULT 0,
  revenue_share_percent_delta numeric(5,2)  NOT NULL DEFAULT 0,
  is_active                   boolean NOT NULL DEFAULT true,
  created_at                  timestamp NOT NULL DEFAULT now(),
  updated_at                  timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_features_key_idx ON billing_features (key);

-- Seed one row per known app module at zero delta (platform owner fills in the numbers).
INSERT INTO billing_features (key, name) VALUES
  ('claims',                'Claims'),
  ('funeral_ops',           'Funeral operations'),
  ('fleet',                 'Fleet'),
  ('payroll',               'Payroll'),
  ('whatsapp_notifications','WhatsApp'),
  ('mobile_payments',       'Payments (PayNow)'),
  ('email_notifications',   'Email notifications'),
  ('email_inbound',         'Inbound email'),
  ('sms_notifications',     'SMS'),
  ('legacy_records',        'Legacy records')
ON CONFLICT (key) DO NOTHING;

-- ── tenant_subscriptions (per-tenant overrides; null = inherit the plan) ─────
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS billing_model_override          text;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS per_status_rates_override       jsonb;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS included_policy_units_override  integer;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS monthly_minimum_override_usd    numeric(12,2);
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS base_fee_override_usd           numeric(12,2);
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS outstanding_fee_cap_usd         numeric(12,2);
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS setup_fee_override_usd          numeric(12,2);
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS setup_fee_status                text NOT NULL DEFAULT 'not_applicable';
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS last_settlement_at              timestamp;

-- ── tenant_invoices (setup / one-off invoices need the subscription columns nullable) ──
ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS kind       text NOT NULL DEFAULT 'subscription';
ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS line_items jsonb;
ALTER TABLE tenant_invoices ALTER COLUMN subscription_id DROP NOT NULL;
ALTER TABLE tenant_invoices ALTER COLUMN plan_id         DROP NOT NULL;
ALTER TABLE tenant_invoices ALTER COLUMN period_start    DROP NOT NULL;
ALTER TABLE tenant_invoices ALTER COLUMN period_end      DROP NOT NULL;

-- ── billing_settings (global defaults) ──────────────────────────────────────
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_monthly_minimum_usd    numeric(12,2) NOT NULL DEFAULT 250.00;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_outstanding_fee_cap_usd numeric(12,2);
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS deletion_grace_days            integer NOT NULL DEFAULT 30;

-- ── Backfill to current behaviour ───────────────────────────────────────────
UPDATE billing_plans          SET billing_model = 'flat'            WHERE billing_model IS NULL;
UPDATE tenant_invoices        SET kind = 'subscription'             WHERE kind IS NULL;
UPDATE tenant_subscriptions   SET setup_fee_status = 'not_applicable' WHERE setup_fee_status IS NULL;
