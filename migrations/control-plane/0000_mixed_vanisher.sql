CREATE TABLE "backup_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"status" text NOT NULL,
	"total_rows" text,
	"table_count" text,
	"error_count" text,
	"errors" jsonb,
	"triggered_by" text
);
--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly_usd" numeric NOT NULL,
	"billing_interval_months" integer DEFAULT 1 NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"grace_days" integer DEFAULT 7 NOT NULL,
	"reminder_lead_days" integer DEFAULT 3 NOT NULL,
	"module_enforcement_enabled" boolean DEFAULT false NOT NULL,
	"platform_fee_rate_percent" numeric(5, 2) DEFAULT '2.50' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_tenant_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"org_type" text,
	"product_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"distribution_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"book_status" text,
	"book_size_current" integer,
	"book_size_projected_12mo" integer,
	"staff_complement" integer,
	"admin_email" text NOT NULL,
	"admin_display_name" text,
	"admin_password_hash" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"verification_amount" numeric DEFAULT '1.00' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"payment_token" text NOT NULL,
	"merchant_reference" text,
	"paynow_poll_url" text,
	"paynow_status" text,
	"provisioned_tenant_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"type" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"logo_url" text DEFAULT '/assets/logo.png',
	"signature_url" text,
	"primary_color" text DEFAULT '#0d9488',
	"footer_text" text,
	"address" text,
	"phone" text,
	"email" text,
	"website" text,
	"policy_number_prefix" text,
	"policy_number_padding" integer DEFAULT 5,
	"is_whitelabeled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_databases" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"database_url" text,
	"database_direct_url" text,
	"migration_state" text DEFAULT 'current' NOT NULL,
	"last_migrated_at" timestamp,
	"schema_version" text
);
--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_feature_flags" (
	"tenant_id" uuid NOT NULL,
	"flag" text NOT NULL,
	"enabled" boolean NOT NULL,
	"set_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"payment_token" text NOT NULL,
	"merchant_reference" text,
	"paynow_poll_url" text,
	"paynow_status" text,
	"marked_paid_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_storage" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"bucket" text,
	"region" text,
	"endpoint" text,
	"access_key_id" text
);
--> statement-breakpoint
CREATE TABLE "tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"trial_ends_at" timestamp,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"grace_days_override" integer,
	"platform_fee_rate_override" numeric(5, 2),
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"license_status" text DEFAULT 'active' NOT NULL,
	"provisioning_state" text DEFAULT 'ready' NOT NULL,
	"domain_commissioned" boolean DEFAULT true NOT NULL,
	"domain_commissioned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"suspended_at" timestamp,
	"suspend_reason" text
);
--> statement-breakpoint
ALTER TABLE "pending_tenant_signups" ADD CONSTRAINT "pending_tenant_signups_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tenant_signups" ADD CONSTRAINT "pending_tenant_signups_provisioned_tenant_id_tenants_id_fk" FOREIGN KEY ("provisioned_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_events" ADD CONSTRAINT "tenant_billing_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_databases" ADD CONSTRAINT "tenant_databases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_subscription_id_tenant_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."tenant_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invoices" ADD CONSTRAINT "tenant_invoices_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_storage" ADD CONSTRAINT "tenant_storage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_plans_key_idx" ON "billing_plans" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_tenant_signups_token_idx" ON "pending_tenant_signups" USING btree ("payment_token");--> statement-breakpoint
CREATE INDEX "pending_tenant_signups_email_idx" ON "pending_tenant_signups" USING btree ("admin_email");--> statement-breakpoint
CREATE INDEX "tenant_billing_events_tenant_idx" ON "tenant_billing_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_domain_idx" ON "tenant_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "tenant_domains_tenant_idx" ON "tenant_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_feature_flags_unique_idx" ON "tenant_feature_flags" USING btree ("tenant_id","flag");--> statement-breakpoint
CREATE INDEX "tenant_integrations_tenant_idx" ON "tenant_integrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_integrations_provider_idx" ON "tenant_integrations" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invoices_token_idx" ON "tenant_invoices" USING btree ("payment_token");--> statement-breakpoint
CREATE INDEX "tenant_invoices_tenant_idx" ON "tenant_invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_invoices_status_due_idx" ON "tenant_invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_subscriptions_tenant_idx" ON "tenant_subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");