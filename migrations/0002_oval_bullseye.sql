CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" text,
	"priority" text DEFAULT 'medium',
	"is_completed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisition_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"qty" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "platform_receivables" ADD COLUMN "source_service_receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "requisitions" ADD COLUMN "needed_by_date" date;--> statement-breakpoint
ALTER TABLE "requisitions" ADD COLUMN "approver_notes" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_items" ADD CONSTRAINT "requisition_items_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_items" ADD CONSTRAINT "requisition_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_org_idx" ON "reminders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "req_item_req_idx" ON "requisition_items" USING btree ("requisition_id");--> statement-breakpoint
ALTER TABLE "platform_receivables" ADD CONSTRAINT "platform_receivables_source_service_receipt_id_service_receipts_id_fk" FOREIGN KEY ("source_service_receipt_id") REFERENCES "public"."service_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_org_email_idx" ON "clients" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "clients_org_national_id_idx" ON "clients" USING btree ("organization_id","national_id");--> statement-breakpoint
CREATE INDEX "commission_ledger_org_agent_created_idx" ON "commission_ledger_entries" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_logs_recipient_read_idx" ON "notification_logs" USING btree ("recipient_id","read_at");--> statement-breakpoint
CREATE INDEX "payment_receipts_policy_status_issued_idx" ON "payment_receipts" USING btree ("policy_id","status","issued_at");--> statement-breakpoint
CREATE INDEX "policies_org_status_created_idx" ON "policies" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "policy_status_history_policy_to_status_idx" ON "policy_status_history" USING btree ("policy_id","to_status","created_at");