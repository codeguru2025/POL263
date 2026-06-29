ALTER TABLE "clients" ADD COLUMN "physical_address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "postal_address" text;--> statement-breakpoint
ALTER TABLE "product_versions" ADD COLUMN "additional_member_premium_monthly_usd" numeric;--> statement-breakpoint
ALTER TABLE "product_versions" ADD COLUMN "additional_member_premium_monthly_zar" numeric;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "max_additional_members" integer;