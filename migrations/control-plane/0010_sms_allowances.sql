-- Per-tenant SMS allowance granted by the platform owner (see shared/control-plane-schema.ts).
-- One credit = one SMS part. No row for a tenant = not metered.
CREATE TABLE IF NOT EXISTS tenant_sms_allocations (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  credits_allocated integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  low_balance_threshold integer NOT NULL DEFAULT 50,
  enforced boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_sms_allocation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  credits integer NOT NULL DEFAULT 0,
  balance_after integer,
  note text,
  actor_email text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_sms_allocation_events_tenant_idx ON tenant_sms_allocation_events (tenant_id, created_at);
