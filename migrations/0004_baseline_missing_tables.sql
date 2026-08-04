-- Backfills 6 tables that exist in every real database (main, Falakhe) but were never captured
-- as a tracked migration — they were created via `npm run db:push` (drizzle-kit push) directly
-- against the database at some point in the past, which writes schema changes straight to the
-- DB without ever generating a migrations/ file. That's exactly the risk documented in this
-- repo's "never use db:push" convention (see CLAUDE.md / docs/BUGFIX-LOG.md) — this migration is
-- the backfill for the historical gap from before that convention existed.
--
-- Never noticed before because `npm run db:migrate` only ever runs against already-existing
-- databases (which already have these 6 tables from the old db:push) — this gap only matters
-- when building a brand-new database from migrations/ alone from empty, which is exactly what
-- per-tenant dedicated-database commissioning does (server/do-database-provisioning.ts +
-- server/tenant-data-migration.ts's applyPendingMigrations call). Discovered 2026-08-04
-- provisioning IFALAKHE FUNERAL SERVICES' dedicated database — see docs/BUGFIX-LOG.md.
--
-- Generated from a direct introspection of the live database's actual information_schema/
-- pg_catalog (columns, constraints, indexes) rather than transcribed from shared/schema.ts, so
-- this matches what's really running in production, not what the Drizzle definitions say should
-- be there (which is exactly the kind of drift this whole gap was caused by in the first place).
-- Numbered 0004 (not appended after the current highest number) because it must run before
-- 0064_disbursement_cross_currency.sql (ALTERs payment_disbursements) and
-- 0065_safes.sql (ALTERs bank_deposits) — both assume these tables already exist — and after
-- 0003_living_cloak.sql, which is where partner_parlours/safes (referenced by parlour_personnel/
-- bank_deposits below) are created.

CREATE TABLE "parlour_personnel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parlour_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "parlour_personnel_parlour_idx" ON "parlour_personnel" USING btree ("parlour_id");
--> statement-breakpoint
ALTER TABLE "parlour_personnel" ADD CONSTRAINT "parlour_personnel_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "parlour_personnel" ADD CONSTRAINT "parlour_personnel_parlour_id_partner_parlours_id_fk" FOREIGN KEY ("parlour_id") REFERENCES "public"."partner_parlours"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "payment_disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"paid_by_user_id" uuid,
	"received_by" text,
	"received_by_user_id" uuid,
	"paid_date" date NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"reference" text,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"voucher_number" text,
	"entity_amount" numeric(12, 2),
	"fx_rate_applied" numeric(18, 8)
);
--> statement-breakpoint
CREATE INDEX "disb_org_idx" ON "payment_disbursements" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "disb_entity_idx" ON "payment_disbursements" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX "disb_date_idx" ON "payment_disbursements" USING btree ("paid_date");
--> statement-breakpoint
ALTER TABLE "payment_disbursements" ADD CONSTRAINT "payment_disbursements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_disbursements" ADD CONSTRAINT "payment_disbursements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_disbursements" ADD CONSTRAINT "payment_disbursements_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_disbursements" ADD CONSTRAINT "payment_disbursements_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_disbursements" ADD CONSTRAINT "payment_disbursements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"account_name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ba_org_idx" ON "bank_accounts" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "bank_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"bank_account_id" uuid,
	"deposited_by_user_id" uuid NOT NULL,
	"verified_by_user_id" uuid,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"deposit_date" date NOT NULL,
	"reference" text,
	"notes" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"safe_id" uuid
);
--> statement-breakpoint
CREATE INDEX "bd_org_idx" ON "bank_deposits" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "bd_user_idx" ON "bank_deposits" USING btree ("deposited_by_user_id");
--> statement-breakpoint
CREATE INDEX "bd_date_idx" ON "bank_deposits" USING btree ("deposit_date");
--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_deposited_by_user_id_users_id_fk" FOREIGN KEY ("deposited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- bank_deposits.safe_id's FK to "safes" is added separately in
-- 0065_zz_bank_deposits_safe_fk.sql, not here: "safes" itself isn't created until
-- 0065_safes.sql, which must run after this file (this file must stay before
-- 0064_disbursement_cross_currency.sql, which needs payment_disbursements to already exist —
-- see the header comment above for why one insertion point can't satisfy both orderings).

CREATE TABLE "bank_statement_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"closing_balance" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"entered_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bsb_org_idx" ON "bank_statement_balances" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "bsb_account_idx" ON "bank_statement_balances" USING btree ("bank_account_id");
--> statement-breakpoint
ALTER TABLE "bank_statement_balances" ADD CONSTRAINT "bank_statement_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_balances" ADD CONSTRAINT "bank_statement_balances_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement_balances" ADD CONSTRAINT "bank_statement_balances_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "balance_sheet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"section" text NOT NULL,
	"subsection" text,
	"label" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"as_of_date" date NOT NULL,
	"notes" text,
	"entered_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bse_org_idx" ON "balance_sheet_entries" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "bse_section_idx" ON "balance_sheet_entries" USING btree ("organization_id","section");
--> statement-breakpoint
CREATE INDEX "bse_date_idx" ON "balance_sheet_entries" USING btree ("as_of_date");
--> statement-breakpoint
ALTER TABLE "balance_sheet_entries" ADD CONSTRAINT "balance_sheet_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "balance_sheet_entries" ADD CONSTRAINT "balance_sheet_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "balance_sheet_entries" ADD CONSTRAINT "balance_sheet_entries_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
