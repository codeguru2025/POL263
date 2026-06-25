ALTER TABLE "organizations" ADD COLUMN "paynow_integration_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paynow_integration_key" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paynow_auth_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paynow_return_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paynow_result_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "paynow_mode" text;