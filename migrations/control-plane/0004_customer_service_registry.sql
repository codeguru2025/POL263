-- Multi-tenant WhatsApp customer service routing registry.
--
-- Tenant resolution for the shared-WhatsApp-number model happens BEFORE any tenant database
-- is known, so these three tables live in the control plane (same reasoning as tenant_domains /
-- tenant_email_domains). They are ROUTING INDEXES only — the source of truth for customers and
-- policies stays in the per-tenant `clients` / `policies` tables. organization_id / client_id /
-- policy_id are stored as plain uuid columns (no FK into tenant DBs).
--
-- Resolution is NOT authentication: /api/customer-service/verify + requireVerifiedCustomer are
-- unchanged and still enforce secret->tenant, token->client, tenant-match, client-ownership.

-- MODE B — dedicated tenant WhatsApp number registry (channel_id -> tenant).
CREATE TABLE IF NOT EXISTS customer_service_channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type text NOT NULL,
  channel_id   text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_service_channels_channel_idx
  ON customer_service_channels (channel_type, channel_id);
CREATE INDEX IF NOT EXISTS customer_service_channels_tenant_idx
  ON customer_service_channels (tenant_id);

-- MODE A — verify-driven identity index (whatsapp_number -> possible tenant/client matches).
-- whatsapp_number is the normalized last-9-digits form (storage.getClientByPhone convention).
CREATE TABLE IF NOT EXISTS customer_service_identities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  client_id        uuid NOT NULL,
  policy_id        uuid,
  whatsapp_number  text NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  last_verified_at timestamp,
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_service_identities_unique_idx
  ON customer_service_identities (organization_id, client_id, whatsapp_number);
CREATE INDEX IF NOT EXISTS customer_service_identities_number_idx
  ON customer_service_identities (whatsapp_number);

-- Phase 4 — persistent WhatsApp conversation context + FSM state + agent routing.
-- organization_id / client_id / policy_id are set only by trusted server code (resolver +
-- /verify success), never from the request body. The raw verification token is NEVER stored.
CREATE TABLE IF NOT EXISTS customer_service_conversations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type            text NOT NULL,
  channel_id              text,
  whatsapp_number         text NOT NULL,
  organization_id         uuid,
  client_id               uuid,
  policy_id               uuid,
  verification_status     text NOT NULL DEFAULT 'unresolved',
  verification_expires_at timestamp,
  current_state           text NOT NULL DEFAULT 'WELCOME',
  current_menu            text,
  assigned_agent_id       uuid,
  last_message_at         timestamp NOT NULL DEFAULT now(),
  created_at              timestamp NOT NULL DEFAULT now(),
  updated_at              timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_service_conversations_channel_number_idx
  ON customer_service_conversations (channel_id, whatsapp_number);
CREATE INDEX IF NOT EXISTS customer_service_conversations_number_idx
  ON customer_service_conversations (whatsapp_number);
CREATE INDEX IF NOT EXISTS customer_service_conversations_org_idx
  ON customer_service_conversations (organization_id);
