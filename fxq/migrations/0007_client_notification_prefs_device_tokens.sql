-- Client notification preferences and device tokens for push
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "notification_tone" text DEFAULT 'default';
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "push_enabled" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "client_device_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "token" text NOT NULL,
  "platform" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cdt_org_idx" ON "client_device_tokens" ("organization_id");
CREATE INDEX IF NOT EXISTS "cdt_client_idx" ON "client_device_tokens" ("client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cdt_token_org_idx" ON "client_device_tokens" ("organization_id", "token");
