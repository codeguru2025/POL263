-- Per-tenant, per-currency wallet that absorbs settlement overpayment beyond everything the
-- tenant currently owed the platform (mirrors policy_credit_balances). Drawn down automatically
-- the next time a platform fee is raised in the same currency (server/storage.ts
-- createPlatformReceivable). New table, no data migration needed.

CREATE TABLE IF NOT EXISTS "platform_fee_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_fee_credits" ADD CONSTRAINT "platform_fee_credits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pfc_org_idx" ON "platform_fee_credits" ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pfc_org_currency_idx" ON "platform_fee_credits" ("organization_id","currency");
