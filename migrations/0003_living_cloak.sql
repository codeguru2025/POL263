CREATE TABLE "partner_parlours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"contact_person" text,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD COLUMN "partner_parlour_id" uuid;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD COLUMN "storage_category" text;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD COLUMN "storage_fee_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD COLUMN "storage_fee_currency" text DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD COLUMN "storage_fee_status" text DEFAULT 'unpaid';--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD COLUMN "storage_fee_paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD COLUMN "storage_fee_paid_by" text;--> statement-breakpoint
ALTER TABLE "partner_parlours" ADD CONSTRAINT "partner_parlours_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD CONSTRAINT "mortuary_intakes_partner_parlour_id_partner_parlours_id_fk" FOREIGN KEY ("partner_parlour_id") REFERENCES "public"."partner_parlours"("id") ON DELETE no action ON UPDATE no action;