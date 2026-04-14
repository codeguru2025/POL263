-- Payment automation settings, saved client payment methods, and policy automation timestamps.

ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS last_auto_payment_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS last_auto_reminder_at timestamp;

CREATE TABLE IF NOT EXISTS client_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  method_type text NOT NULL,
  provider text,
  mobile_number text,
  card_last4 text,
  card_brand text,
  card_expiry_month integer,
  card_expiry_year integer,
  card_token text,
  is_default boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cpm_org_idx ON client_payment_methods(organization_id);
CREATE INDEX IF NOT EXISTS cpm_client_idx ON client_payment_methods(client_id);

CREATE TABLE IF NOT EXISTS payment_automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  is_enabled boolean NOT NULL DEFAULT false,
  days_after_last_payment integer NOT NULL DEFAULT 30,
  repeat_every_days integer NOT NULL DEFAULT 30,
  send_push_notifications boolean NOT NULL DEFAULT true,
  auto_run_payments boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pas_org_unique_idx ON payment_automation_settings(organization_id);
