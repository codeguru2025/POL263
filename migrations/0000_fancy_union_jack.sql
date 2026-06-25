CREATE TABLE "add_ons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pricing_mode" text DEFAULT 'flat' NOT NULL,
	"price_amount" numeric,
	"price_monthly" numeric,
	"price_weekly" numeric,
	"price_biweekly" numeric,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "age_band_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_age" integer NOT NULL,
	"max_age" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_download_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"build_number" integer NOT NULL,
	"min_version" text DEFAULT '1.0.0' NOT NULL,
	"min_build_number" integer DEFAULT 1 NOT NULL,
	"download_url" text NOT NULL,
	"release_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"request_data" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"initiated_by" uuid NOT NULL,
	"approved_by" uuid,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "attendance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"logged_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp,
	"approval_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ip_address" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefit_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"items" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefit_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"internal_cost_default" numeric,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_wash_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"intake_id" uuid NOT NULL,
	"funeral_case_id" uuid,
	"clothes_provided" boolean DEFAULT false,
	"blanket_provided" boolean DEFAULT false,
	"wreath_provided" boolean DEFAULT false,
	"other_items" text,
	"washed_by_name" text,
	"completed_at" timestamp,
	"completed_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cashups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"cashup_date" date NOT NULL,
	"total_amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"transaction_count" integer NOT NULL,
	"amounts_by_method" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_by" uuid,
	"locked_at" timestamp,
	"prepared_by" uuid NOT NULL,
	"notes" text,
	"submitted_at" timestamp,
	"submitted_by" uuid,
	"confirmed_at" timestamp,
	"confirmed_by" uuid,
	"counted_amounts_by_method" jsonb,
	"counted_total" numeric,
	"discrepancy_amount" numeric,
	"discrepancy_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text,
	"is_verified" boolean DEFAULT false,
	"verified_by" uuid,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"policy_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"claim_type" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"deceased_name" text,
	"deceased_relationship" text,
	"date_of_death" date,
	"cause_of_death" text,
	"cash_in_lieu_amount" numeric,
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_waiting_period_waived" boolean DEFAULT false,
	"fraud_flags" jsonb,
	"submitted_by" uuid,
	"verified_by" uuid,
	"approved_by" uuid,
	"approval_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"label" text,
	"file_name" text NOT NULL,
	"mime_type" text,
	"file_url" text NOT NULL,
	"storage_key" text,
	"file_size" integer,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"method_type" text NOT NULL,
	"provider" text,
	"mobile_number" text,
	"card_last4" text,
	"card_brand" text,
	"card_expiry_month" integer,
	"card_expiry_year" integer,
	"card_token" text,
	"is_default" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"title" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"national_id" text,
	"date_of_birth" date,
	"gender" text,
	"marital_status" text,
	"phone" text,
	"email" text,
	"address" text,
	"preferred_comm_method" text,
	"location" text,
	"selling_point" text,
	"objections_faced" text,
	"response_to_objections" text,
	"client_feedback" text,
	"password_hash" text,
	"security_question_id" uuid,
	"security_answer_hash" text,
	"activation_code" text,
	"is_enrolled" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"agent_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"notification_tone" text DEFAULT 'default',
	"push_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"policy_id" uuid,
	"transaction_id" uuid,
	"entry_type" text NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"description" text,
	"period_start" date,
	"period_end" date,
	"status" text DEFAULT 'earned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"first_months_count" integer DEFAULT 2,
	"first_months_rate" numeric DEFAULT '50',
	"recurring_start_month" integer DEFAULT 5,
	"recurring_rate" numeric DEFAULT '10',
	"clawback_threshold_payments" integer DEFAULT 4,
	"funeral_service_incentive" numeric DEFAULT '50',
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cost_sheet_id" uuid NOT NULL,
	"price_book_item_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"unit_price" numeric NOT NULL,
	"total_price" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"funeral_case_id" uuid,
	"claim_id" uuid,
	"total_amount" numeric DEFAULT '0',
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"credit_note_number" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reason" text,
	"month_end_run_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debit_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"client_id" uuid,
	"policy_id" uuid,
	"mandate_reference" text NOT NULL,
	"account_name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"branch_code" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"day_of_month" integer,
	"start_date" date,
	"next_run_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deceased_belongings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"intake_id" uuid,
	"funeral_case_id" uuid,
	"item_description" text NOT NULL,
	"quantity" integer DEFAULT 1,
	"submitted_by_name" text,
	"received_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dependent_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"policy_id" uuid,
	"request_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dependents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"member_number" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"national_id" text,
	"date_of_birth" date,
	"gender" text,
	"relationship" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"alt_phone" text,
	"email" text,
	"address" text,
	"city" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"funeral_case_id" uuid,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"end_date" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "driver_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"funeral_case_id" uuid NOT NULL,
	"driver_id" uuid,
	"grave_tent" boolean DEFAULT false,
	"lowering_device" boolean DEFAULT false,
	"gloves" boolean DEFAULT false,
	"masks" boolean DEFAULT false,
	"fuel_gauge" text,
	"toll_gate_required" boolean DEFAULT false,
	"toll_gate_amount" numeric(10, 2),
	"driver_allowance" numeric(10, 2),
	"burial_order_ref" text,
	"prepared_by_user_id" uuid,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "driver_checklists_funeral_case_id_unique" UNIQUE("funeral_case_id")
);
--> statement-breakpoint
CREATE TABLE "expenditures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"funeral_case_id" uuid,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"approved_by" uuid,
	"receipt_ref" text,
	"spent_at" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_fuel_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"litres" numeric NOT NULL,
	"cost_amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"mileage_at_fill" integer,
	"filled_by" uuid,
	"filled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"description" text NOT NULL,
	"cost_amount" numeric,
	"currency" text DEFAULT 'USD',
	"scheduled_date" date,
	"completed_date" date,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"registration" text NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"vehicle_type" text,
	"status" text DEFAULT 'available' NOT NULL,
	"current_mileage" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funeral_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"claim_id" uuid,
	"policy_id" uuid,
	"case_number" text NOT NULL,
	"deceased_name" text NOT NULL,
	"deceased_dob" date,
	"deceased_gender" text,
	"deceased_national_id" text,
	"deceased_relationship" text,
	"date_of_death" date,
	"cause_of_death" text,
	"place_of_death" text,
	"informant_name" text,
	"informant_phone" text,
	"informant_relationship" text,
	"service_type" text,
	"funeral_date" date,
	"funeral_location" text,
	"removal_location" text,
	"removal_vehicle_id" uuid,
	"removal_driver_id" uuid,
	"burial_vehicle_id" uuid,
	"burial_driver_id" uuid,
	"attending_agent_id" uuid,
	"body_wash_time" timestamp,
	"burial_departure_time" timestamp,
	"memorial_service_start" timestamp,
	"memorial_service_end" timestamp,
	"body_identifier_name" text,
	"body_identifier_id_number" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"notes" text,
	"sla_deadline" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funeral_quotation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"price_book_item_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funeral_quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"funeral_case_id" uuid,
	"quotation_number" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"informant_full_names" text,
	"informant_phone" text,
	"informant_address" text,
	"deceased_name" text,
	"deceased_age" integer,
	"deceased_sex" text,
	"casket_type" text,
	"quotation_date" date,
	"subtotal" numeric(12, 2) DEFAULT '0',
	"vat_rate" numeric(5, 2) DEFAULT '15',
	"vat_amount" numeric(12, 2) DEFAULT '0',
	"discount_amount" numeric(12, 2) DEFAULT '0',
	"grand_total" numeric(12, 2) DEFAULT '0',
	"payment_type" text,
	"conversion_status" text DEFAULT 'pending',
	"converted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "funeral_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funeral_case_id" uuid NOT NULL,
	"task_name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid,
	"due_date" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"rate_to_usd" numeric(18, 8) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_payment_intent_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"merchant_reference" varchar(255) NOT NULL,
	"paynow_reference" varchar(255),
	"paynow_poll_url" text,
	"paynow_redirect_url" text,
	"method_selected" text DEFAULT 'unknown',
	"initiated_by_client_id" uuid,
	"initiated_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'community' NOT NULL,
	"description" text,
	"chairperson_name" text,
	"chairperson_phone" text,
	"chairperson_email" text,
	"secretary_name" text,
	"secretary_phone" text,
	"secretary_email" text,
	"treasurer_name" text,
	"treasurer_phone" text,
	"treasurer_email" text,
	"company_name" text,
	"hr_manager_name" text,
	"hr_manager_phone" text,
	"hr_manager_email" text,
	"contact_person_name" text,
	"contact_person_phone" text,
	"contact_person_email" text,
	"capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"agent_id" uuid,
	"client_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"email" text,
	"source" text DEFAULT 'walk_in' NOT NULL,
	"stage" text DEFAULT 'captured' NOT NULL,
	"product_interest" text,
	"lost_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "month_end_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_number" text NOT NULL,
	"file_name" text,
	"total_rows" integer DEFAULT 0,
	"receipted_count" integer DEFAULT 0,
	"credit_note_count" integer DEFAULT 0,
	"status" text DEFAULT 'completed' NOT NULL,
	"run_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortuary_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"intake_id" uuid NOT NULL,
	"funeral_case_id" uuid,
	"dispatched_by_user_id" uuid,
	"dispatched_at" timestamp,
	"collected_by_name" text,
	"collected_by_id_number" text,
	"collected_by_organization" text,
	"destination" text,
	"collector_acknowledged_name" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortuary_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"funeral_case_id" uuid,
	"intake_number" text NOT NULL,
	"service_scope" text NOT NULL,
	"status" text DEFAULT 'in_storage' NOT NULL,
	"deceased_name" text NOT NULL,
	"deceased_gender" text,
	"deceased_age" integer,
	"deceased_national_id" text,
	"date_of_death" date,
	"cause_of_death" text,
	"place_of_death" text,
	"client_organization_name" text,
	"informant_name" text,
	"informant_phone" text,
	"informant_relationship" text,
	"removal_location" text,
	"removal_date_time" timestamp,
	"removal_vehicle_id" uuid,
	"removal_driver_id" uuid,
	"received_by_user_id" uuid,
	"received_at" timestamp,
	"receiver_acknowledged_name" text,
	"receiver_acknowledged_id_number" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid,
	"recipient_type" text NOT NULL,
	"recipient_id" uuid,
	"policy_id" uuid,
	"channel" text NOT NULL,
	"subject" text,
	"body" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"read_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"subject" text,
	"body_template" text NOT NULL,
	"merge_tags" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_member_sequences" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"member_next" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_policy_sequences" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"policy_next" integer DEFAULT 1 NOT NULL,
	"receipt_next" integer DEFAULT 0 NOT NULL,
	"payment_receipt_next" integer DEFAULT 0 NOT NULL,
	"claim_next" integer DEFAULT 0 NOT NULL,
	"case_next" integer DEFAULT 0 NOT NULL,
	"mortuary_next" integer DEFAULT 0 NOT NULL,
	"quotation_next" integer DEFAULT 0 NOT NULL,
	"employee_next" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo_url" text DEFAULT '/assets/logo.png',
	"signature_url" text,
	"primary_color" text DEFAULT '#0d9488',
	"footer_text" text,
	"address" text,
	"phone" text,
	"email" text,
	"website" text,
	"policy_number_prefix" text,
	"policy_number_padding" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"database_url" text,
	"is_whitelabeled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payment_automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"client_id" uuid,
	"action_type" text NOT NULL,
	"status" text NOT NULL,
	"method_type" text,
	"message" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_automation_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"days_after_last_payment" integer DEFAULT 30 NOT NULL,
	"repeat_every_days" integer DEFAULT 30 NOT NULL,
	"send_push_notifications" boolean DEFAULT true NOT NULL,
	"auto_run_payments" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"purpose" text DEFAULT 'premium' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"merchant_reference" varchar(255) NOT NULL,
	"paynow_reference" varchar(255),
	"paynow_poll_url" text,
	"paynow_redirect_url" text,
	"method_selected" text DEFAULT 'unknown',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"receipt_number" text NOT NULL,
	"payment_intent_id" uuid,
	"policy_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_channel" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"issued_by_user_id" uuid,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"pdf_storage_key" text,
	"print_format" text DEFAULT 'thermal_80mm',
	"status" text DEFAULT 'issued' NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"policy_id" uuid,
	"client_id" uuid,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"paynow_reference" text,
	"idempotency_key" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"posted_date" date,
	"value_date" date,
	"notes" text,
	"period_from" date,
	"period_to" date,
	"recorded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payroll_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"position" text,
	"department" text,
	"base_salary" numeric,
	"housing_allowance" numeric,
	"transport_allowance" numeric,
	"other_allowances" jsonb,
	"funeral_policy_deduction" numeric,
	"other_insurance_deduction" numeric,
	"nssa_enabled" boolean DEFAULT false NOT NULL,
	"paye_enabled" boolean DEFAULT false NOT NULL,
	"aids_levy_enabled" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"employment_type" text DEFAULT 'permanent',
	"contract_start_date" date,
	"contract_end_date" date,
	"bank_name" text,
	"bank_branch" text,
	"bank_account_number" text,
	"bank_account_type" text,
	"bank_branch_code" text,
	"bank_swift_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_gross" numeric,
	"total_deductions" numeric,
	"total_net" numeric,
	"prepared_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"days_worked" integer,
	"total_days" integer,
	"earnings" jsonb,
	"deductions_detail" jsonb,
	"gross_amount" numeric NOT NULL,
	"deductions" jsonb,
	"net_amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	CONSTRAINT "permissions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "platform_receivables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_transaction_id" uuid,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"description" text,
	"is_settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"policy_number" text NOT NULL,
	"client_id" uuid NOT NULL,
	"product_version_id" uuid NOT NULL,
	"agent_id" uuid,
	"group_id" uuid,
	"status" text DEFAULT 'inactive' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"premium_amount" numeric NOT NULL,
	"payment_schedule" text DEFAULT 'monthly' NOT NULL,
	"effective_date" date,
	"inception_date" date,
	"waiting_period_end_date" date,
	"current_cycle_start" date,
	"current_cycle_end" date,
	"grace_end_date" date,
	"grace_used_days" integer DEFAULT 0 NOT NULL,
	"last_auto_payment_attempt_at" timestamp,
	"last_auto_reminder_at" timestamp,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"beneficiary_first_name" text,
	"beneficiary_last_name" text,
	"beneficiary_relationship" text,
	"beneficiary_national_id" text,
	"beneficiary_phone" text,
	"beneficiary_dependent_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"is_legacy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_add_ons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"add_on_id" uuid NOT NULL,
	"policy_member_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_credit_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"label" text,
	"file_name" text NOT NULL,
	"mime_type" text,
	"file_url" text NOT NULL,
	"storage_key" text,
	"file_size" integer,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"policy_id" uuid NOT NULL,
	"client_id" uuid,
	"dependent_id" uuid,
	"member_number" text,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_premium_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"old_premium" numeric(12, 2) NOT NULL,
	"new_premium" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"effective_date" date NOT NULL,
	"periods" integer DEFAULT 0 NOT NULL,
	"reconciliation" numeric(12, 2) DEFAULT '0' NOT NULL,
	"change_type" text NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_book_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"price_amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"category" text,
	"effective_from" date,
	"effective_to" date,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_benefit_bundle_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_version_id" uuid NOT NULL,
	"benefit_bundle_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"premium_monthly_usd" numeric,
	"premium_monthly_zar" numeric,
	"premium_weekly_usd" numeric,
	"premium_weekly_zar" numeric,
	"premium_biweekly_usd" numeric,
	"premium_biweekly_zar" numeric,
	"eligibility_min_age" integer DEFAULT 18,
	"eligibility_max_age" integer DEFAULT 70,
	"dependent_max_age" integer DEFAULT 20,
	"waiting_period_days" integer DEFAULT 90,
	"waiting_period_accidental_death" integer DEFAULT 0,
	"waiting_period_suicide" integer DEFAULT 0,
	"grace_period_days" integer DEFAULT 30,
	"cash_in_lieu_adult" numeric,
	"cash_in_lieu_child" numeric,
	"reinstatement_requires_arrears" boolean DEFAULT true,
	"reinstatement_new_waiting_period" boolean DEFAULT true,
	"coverage_rules" jsonb,
	"exclusions" jsonb,
	"commission_first_months_count" integer,
	"commission_first_months_rate" numeric,
	"commission_recurring_start_month" integer,
	"commission_recurring_rate" numeric,
	"commission_clawback_threshold" integer,
	"commission_funeral_incentive" numeric,
	"underwriter_amount_adult" numeric,
	"underwriter_amount_child" numeric,
	"underwriter_advance_months" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"max_adults" integer DEFAULT 2,
	"max_children" integer DEFAULT 4,
	"max_extended_members" integer DEFAULT 0,
	"casket_type" text,
	"casket_image_url" text,
	"cover_amount" numeric,
	"cover_currency" text DEFAULT 'USD',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_collateral" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"item_description" text NOT NULL,
	"condition" text,
	"value" numeric(12, 2),
	"due_date" date,
	"forfeiture_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_guarantors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"guarantor_name" text,
	"guarantor_phone" text,
	"guarantor_address" text,
	"guarantor_id_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_guarantors_quotation_id_unique" UNIQUE("quotation_id")
);
--> statement-breakpoint
CREATE TABLE "receipt_adverts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text,
	"body" text,
	"image_url" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"policy_id" uuid,
	"client_id" uuid,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"requisition_number" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"payee" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp,
	"rejection_reason" text,
	"paid_by" uuid,
	"paid_at" timestamp,
	"paid_date" date,
	"payment_method" text,
	"reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reversal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"original_transaction_id" uuid NOT NULL,
	"reversal_transaction_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"question" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"funeral_case_id" uuid,
	"quotation_id" uuid,
	"receipt_number" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_channel" text NOT NULL,
	"issued_by_user_id" uuid,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"idempotency_key" text,
	"notes" text,
	"metadata_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"attachments" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"initiated_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms_and_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_version_id" uuid,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"is_granted" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"google_id" text,
	"password_hash" text,
	"display_name" text,
	"avatar_url" text,
	"referral_code" text,
	"organization_id" uuid,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"address" text,
	"national_id" text,
	"date_of_birth" date,
	"gender" text,
	"marital_status" text,
	"next_of_kin_name" text,
	"next_of_kin_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "waiting_period_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"supporting_notes" text,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_band_configs" ADD CONSTRAINT "age_band_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_employee_id_payroll_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."payroll_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_bundles" ADD CONSTRAINT "benefit_bundles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_catalog_items" ADD CONSTRAINT "benefit_catalog_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_wash_requirements" ADD CONSTRAINT "body_wash_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_wash_requirements" ADD CONSTRAINT "body_wash_requirements_intake_id_mortuary_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."mortuary_intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_wash_requirements" ADD CONSTRAINT "body_wash_requirements_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_wash_requirements" ADD CONSTRAINT "body_wash_requirements_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashups" ADD CONSTRAINT "cashups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashups" ADD CONSTRAINT "cashups_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashups" ADD CONSTRAINT "cashups_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashups" ADD CONSTRAINT "cashups_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashups" ADD CONSTRAINT "cashups_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashups" ADD CONSTRAINT "cashups_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_documents" ADD CONSTRAINT "claim_documents_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_documents" ADD CONSTRAINT "claim_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_device_tokens" ADD CONSTRAINT "client_device_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_device_tokens" ADD CONSTRAINT "client_device_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payment_methods" ADD CONSTRAINT "client_payment_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payment_methods" ADD CONSTRAINT "client_payment_methods_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_security_question_id_security_questions_id_fk" FOREIGN KEY ("security_question_id") REFERENCES "public"."security_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger_entries" ADD CONSTRAINT "commission_ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger_entries" ADD CONSTRAINT "commission_ledger_entries_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger_entries" ADD CONSTRAINT "commission_ledger_entries_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger_entries" ADD CONSTRAINT "commission_ledger_entries_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_line_items" ADD CONSTRAINT "cost_line_items_cost_sheet_id_cost_sheets_id_fk" FOREIGN KEY ("cost_sheet_id") REFERENCES "public"."cost_sheets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_line_items" ADD CONSTRAINT "cost_line_items_price_book_item_id_price_book_items_id_fk" FOREIGN KEY ("price_book_item_id") REFERENCES "public"."price_book_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_month_end_run_id_month_end_runs_id_fk" FOREIGN KEY ("month_end_run_id") REFERENCES "public"."month_end_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_orders" ADD CONSTRAINT "debit_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_orders" ADD CONSTRAINT "debit_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_orders" ADD CONSTRAINT "debit_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_orders" ADD CONSTRAINT "debit_orders_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_orders" ADD CONSTRAINT "debit_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deceased_belongings" ADD CONSTRAINT "deceased_belongings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deceased_belongings" ADD CONSTRAINT "deceased_belongings_intake_id_mortuary_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."mortuary_intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deceased_belongings" ADD CONSTRAINT "deceased_belongings_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deceased_belongings" ADD CONSTRAINT "deceased_belongings_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependent_change_requests" ADD CONSTRAINT "dependent_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependent_change_requests" ADD CONSTRAINT "dependent_change_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependent_change_requests" ADD CONSTRAINT "dependent_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependents" ADD CONSTRAINT "dependents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependents" ADD CONSTRAINT "dependents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD CONSTRAINT "directory_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_checklists" ADD CONSTRAINT "driver_checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_checklists" ADD CONSTRAINT "driver_checklists_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_checklists" ADD CONSTRAINT "driver_checklists_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_checklists" ADD CONSTRAINT "driver_checklists_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_logs" ADD CONSTRAINT "fleet_fuel_logs_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_logs" ADD CONSTRAINT "fleet_fuel_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_fuel_logs" ADD CONSTRAINT "fleet_fuel_logs_filled_by_users_id_fk" FOREIGN KEY ("filled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_maintenance" ADD CONSTRAINT "fleet_maintenance_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_maintenance" ADD CONSTRAINT "fleet_maintenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_vehicles" ADD CONSTRAINT "fleet_vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_removal_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("removal_vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_removal_driver_id_users_id_fk" FOREIGN KEY ("removal_driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_burial_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("burial_vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_burial_driver_id_users_id_fk" FOREIGN KEY ("burial_driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_attending_agent_id_users_id_fk" FOREIGN KEY ("attending_agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_cases" ADD CONSTRAINT "funeral_cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_quotation_items" ADD CONSTRAINT "funeral_quotation_items_quotation_id_funeral_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."funeral_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_quotation_items" ADD CONSTRAINT "funeral_quotation_items_price_book_item_id_price_book_items_id_fk" FOREIGN KEY ("price_book_item_id") REFERENCES "public"."price_book_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_quotations" ADD CONSTRAINT "funeral_quotations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_quotations" ADD CONSTRAINT "funeral_quotations_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_quotations" ADD CONSTRAINT "funeral_quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_tasks" ADD CONSTRAINT "funeral_tasks_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funeral_tasks" ADD CONSTRAINT "funeral_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payment_allocations" ADD CONSTRAINT "group_payment_allocations_group_payment_intent_id_group_payment_intents_id_fk" FOREIGN KEY ("group_payment_intent_id") REFERENCES "public"."group_payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payment_allocations" ADD CONSTRAINT "group_payment_allocations_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payment_intents" ADD CONSTRAINT "group_payment_intents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payment_intents" ADD CONSTRAINT "group_payment_intents_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payment_intents" ADD CONSTRAINT "group_payment_intents_initiated_by_client_id_clients_id_fk" FOREIGN KEY ("initiated_by_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_payment_intents" ADD CONSTRAINT "group_payment_intents_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_end_runs" ADD CONSTRAINT "month_end_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_end_runs" ADD CONSTRAINT "month_end_runs_run_by_users_id_fk" FOREIGN KEY ("run_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_dispatches" ADD CONSTRAINT "mortuary_dispatches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_dispatches" ADD CONSTRAINT "mortuary_dispatches_intake_id_mortuary_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."mortuary_intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_dispatches" ADD CONSTRAINT "mortuary_dispatches_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_dispatches" ADD CONSTRAINT "mortuary_dispatches_dispatched_by_user_id_users_id_fk" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD CONSTRAINT "mortuary_intakes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD CONSTRAINT "mortuary_intakes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD CONSTRAINT "mortuary_intakes_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD CONSTRAINT "mortuary_intakes_removal_vehicle_id_fleet_vehicles_id_fk" FOREIGN KEY ("removal_vehicle_id") REFERENCES "public"."fleet_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD CONSTRAINT "mortuary_intakes_removal_driver_id_users_id_fk" FOREIGN KEY ("removal_driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortuary_intakes" ADD CONSTRAINT "mortuary_intakes_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_template_id_notification_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_member_sequences" ADD CONSTRAINT "org_member_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policy_sequences" ADD CONSTRAINT "org_policy_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_automation_runs" ADD CONSTRAINT "payment_automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_automation_runs" ADD CONSTRAINT "payment_automation_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_automation_settings" ADD CONSTRAINT "payment_automation_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_payroll_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."payroll_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_receivables" ADD CONSTRAINT "platform_receivables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_receivables" ADD CONSTRAINT "platform_receivables_source_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_beneficiary_dependent_id_dependents_id_fk" FOREIGN KEY ("beneficiary_dependent_id") REFERENCES "public"."dependents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_add_ons" ADD CONSTRAINT "policy_add_ons_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_add_ons" ADD CONSTRAINT "policy_add_ons_add_on_id_add_ons_id_fk" FOREIGN KEY ("add_on_id") REFERENCES "public"."add_ons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_add_ons" ADD CONSTRAINT "policy_add_ons_policy_member_id_policy_members_id_fk" FOREIGN KEY ("policy_member_id") REFERENCES "public"."policy_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_credit_balances" ADD CONSTRAINT "policy_credit_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_credit_balances" ADD CONSTRAINT "policy_credit_balances_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_members" ADD CONSTRAINT "policy_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_members" ADD CONSTRAINT "policy_members_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_members" ADD CONSTRAINT "policy_members_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_members" ADD CONSTRAINT "policy_members_dependent_id_dependents_id_fk" FOREIGN KEY ("dependent_id") REFERENCES "public"."dependents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premium_changes" ADD CONSTRAINT "policy_premium_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premium_changes" ADD CONSTRAINT "policy_premium_changes_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_premium_changes" ADD CONSTRAINT "policy_premium_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_status_history" ADD CONSTRAINT "policy_status_history_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_status_history" ADD CONSTRAINT "policy_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_benefit_bundle_links" ADD CONSTRAINT "product_benefit_bundle_links_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_benefit_bundle_links" ADD CONSTRAINT "product_benefit_bundle_links_benefit_bundle_id_benefit_bundles_id_fk" FOREIGN KEY ("benefit_bundle_id") REFERENCES "public"."benefit_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_collateral" ADD CONSTRAINT "quotation_collateral_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_collateral" ADD CONSTRAINT "quotation_collateral_quotation_id_funeral_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."funeral_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_guarantors" ADD CONSTRAINT "quotation_guarantors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_guarantors" ADD CONSTRAINT "quotation_guarantors_quotation_id_funeral_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."funeral_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_adverts" ADD CONSTRAINT "receipt_adverts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversal_entries" ADD CONSTRAINT "reversal_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversal_entries" ADD CONSTRAINT "reversal_entries_original_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("original_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversal_entries" ADD CONSTRAINT "reversal_entries_reversal_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("reversal_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reversal_entries" ADD CONSTRAINT "reversal_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_questions" ADD CONSTRAINT "security_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_receipts" ADD CONSTRAINT "service_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_receipts" ADD CONSTRAINT "service_receipts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_receipts" ADD CONSTRAINT "service_receipts_funeral_case_id_funeral_cases_id_fk" FOREIGN KEY ("funeral_case_id") REFERENCES "public"."funeral_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_receipts" ADD CONSTRAINT "service_receipts_quotation_id_funeral_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."funeral_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_receipts" ADD CONSTRAINT "service_receipts_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_receivable_id_platform_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."platform_receivables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_and_conditions" ADD CONSTRAINT "terms_and_conditions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_and_conditions" ADD CONSTRAINT "terms_and_conditions_product_version_id_product_versions_id_fk" FOREIGN KEY ("product_version_id") REFERENCES "public"."product_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_device_tokens" ADD CONSTRAINT "user_device_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_device_tokens" ADD CONSTRAINT "user_device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_period_waivers" ADD CONSTRAINT "waiting_period_waivers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_period_waivers" ADD CONSTRAINT "waiting_period_waivers_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_period_waivers" ADD CONSTRAINT "waiting_period_waivers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiting_period_waivers" ADD CONSTRAINT "waiting_period_waivers_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addons_org_idx" ON "add_ons" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "abc_org_idx" ON "age_band_configs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "app_dl_created_idx" ON "app_download_interests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_releases_active_idx" ON "app_releases" USING btree ("is_active","created_at");--> statement-breakpoint
CREATE INDEX "ar_org_idx" ON "approval_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ar_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "al_org_idx" ON "attendance_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "al_emp_date_idx" ON "attendance_logs" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "al_status_idx" ON "attendance_logs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "al_emp_date_unique" ON "attendance_logs" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_ts_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "bb_org_idx" ON "benefit_bundles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bci_org_idx" ON "benefit_catalog_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bwr_intake_idx" ON "body_wash_requirements" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX "branches_org_idx" ON "branches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cashups_org_idx" ON "cashups" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cd_claim_idx" ON "claim_documents" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "csh_claim_idx" ON "claim_status_history" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claims_org_idx" ON "claims" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "claims_policy_idx" ON "claims" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_number_org_idx" ON "claims" USING btree ("claim_number","organization_id");--> statement-breakpoint
CREATE INDEX "cdt_org_idx" ON "client_device_tokens" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cdt_client_idx" ON "client_device_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cdt_token_org_idx" ON "client_device_tokens" USING btree ("organization_id","token");--> statement-breakpoint
CREATE INDEX "client_docs_org_idx" ON "client_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "client_docs_client_idx" ON "client_documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_feedback_org_idx" ON "client_feedback" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "client_feedback_client_idx" ON "client_feedback" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "cpm_org_idx" ON "client_payment_methods" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cpm_client_idx" ON "client_payment_methods" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "clients_org_idx" ON "clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "clients_branch_idx" ON "clients" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "clients_agent_idx" ON "clients" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "cle_org_idx" ON "commission_ledger_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cle_agent_idx" ON "commission_ledger_entries" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "cle_policy_idx" ON "commission_ledger_entries" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "cp_org_idx" ON "commission_plans" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cli_sheet_idx" ON "cost_line_items" USING btree ("cost_sheet_id");--> statement-breakpoint
CREATE INDEX "cs_org_idx" ON "cost_sheets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cn_org_idx" ON "credit_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cn_policy_idx" ON "credit_notes" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "cn_client_idx" ON "credit_notes" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cn_number_org_idx" ON "credit_notes" USING btree ("credit_note_number","organization_id");--> statement-breakpoint
CREATE INDEX "debit_order_org_idx" ON "debit_orders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "debit_order_status_idx" ON "debit_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "debit_order_policy_idx" ON "debit_orders" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "debit_order_ref_org_idx" ON "debit_orders" USING btree ("organization_id","mandate_reference");--> statement-breakpoint
CREATE INDEX "db_intake_idx" ON "deceased_belongings" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX "dcr_client_idx" ON "dependent_change_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "deps_client_idx" ON "dependents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "deps_org_idx" ON "dependents" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deps_member_number_org_idx" ON "dependents" USING btree ("organization_id","member_number");--> statement-breakpoint
CREATE INDEX "directory_contacts_org_type_idx" ON "directory_contacts" USING btree ("organization_id","type");--> statement-breakpoint
CREATE INDEX "directory_contacts_org_idx" ON "directory_contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "da_vehicle_idx" ON "driver_assignments" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "dc_case_idx" ON "driver_checklists" USING btree ("funeral_case_id");--> statement-breakpoint
CREATE INDEX "exp_org_idx" ON "expenditures" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ffl_vehicle_idx" ON "fleet_fuel_logs" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fm_vehicle_idx" ON "fleet_maintenance" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fv_org_idx" ON "fleet_vehicles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fc_org_idx" ON "funeral_cases" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fc_claim_idx" ON "funeral_cases" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "fc_policy_idx" ON "funeral_cases" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "fc_status_idx" ON "funeral_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fc_assigned_idx" ON "funeral_cases" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "fqi_quotation_idx" ON "funeral_quotation_items" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "fq_org_idx" ON "funeral_quotations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fq_number_org_idx" ON "funeral_quotations" USING btree ("organization_id","quotation_number");--> statement-breakpoint
CREATE INDEX "ft_case_idx" ON "funeral_tasks" USING btree ("funeral_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_org_currency_idx" ON "fx_rates" USING btree ("organization_id","currency");--> statement-breakpoint
CREATE INDEX "gpa_intent_idx" ON "group_payment_allocations" USING btree ("group_payment_intent_id");--> statement-breakpoint
CREATE INDEX "gpa_policy_idx" ON "group_payment_allocations" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "gpi_org_idx" ON "group_payment_intents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "gpi_group_idx" ON "group_payment_intents" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "gpi_status_idx" ON "group_payment_intents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "gpi_idempotency_org_idx" ON "group_payment_intents" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "groups_org_idx" ON "groups" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leads_org_idx" ON "leads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leads_agent_idx" ON "leads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "leads_client_idx" ON "leads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "mer_org_idx" ON "month_end_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mer_number_org_idx" ON "month_end_runs" USING btree ("run_number","organization_id");--> statement-breakpoint
CREATE INDEX "md_intake_idx" ON "mortuary_dispatches" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX "mi_org_idx" ON "mortuary_intakes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "mi_case_idx" ON "mortuary_intakes" USING btree ("funeral_case_id");--> statement-breakpoint
CREATE INDEX "nl_org_idx" ON "notification_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "nl_recipient_idx" ON "notification_logs" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "nl_policy_idx" ON "notification_logs" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "nt_org_idx" ON "notification_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_org_dedupe_idx" ON "outbox_messages" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_org_status_created_idx" ON "outbox_messages" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "par_org_idx" ON "payment_automation_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "par_policy_idx" ON "payment_automation_runs" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "par_created_idx" ON "payment_automation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pas_org_unique_idx" ON "payment_automation_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pe_intent_idx" ON "payment_events" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "pe_org_idx" ON "payment_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pe_created_idx" ON "payment_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pi_org_idx" ON "payment_intents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pi_client_idx" ON "payment_intents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "pi_policy_idx" ON "payment_intents" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "pi_status_idx" ON "payment_intents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pi_idempotency_org_idx" ON "payment_intents" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pi_merchant_ref_org_idx" ON "payment_intents" USING btree ("organization_id","merchant_reference");--> statement-breakpoint
CREATE INDEX "pr_org_idx" ON "payment_receipts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pr_branch_idx" ON "payment_receipts" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "pr_intent_idx" ON "payment_receipts" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "pr_policy_idx" ON "payment_receipts" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_receipt_org_idx" ON "payment_receipts" USING btree ("receipt_number","organization_id");--> statement-breakpoint
CREATE INDEX "pt_org_idx" ON "payment_transactions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pt_policy_idx" ON "payment_transactions" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "pt_posted_idx" ON "payment_transactions" USING btree ("posted_date");--> statement-breakpoint
CREATE INDEX "pt_received_idx" ON "payment_transactions" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "pt_client_idx" ON "payment_transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "payroll_employees_org_idx" ON "payroll_employees" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_org_idx" ON "payroll_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payslips_run_idx" ON "payslips" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "payslips_emp_run_idx" ON "payslips" USING btree ("employee_id","payroll_run_id");--> statement-breakpoint
CREATE INDEX "pr_recv_org_idx" ON "platform_receivables" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_number_org_idx" ON "policies" USING btree ("policy_number","organization_id");--> statement-breakpoint
CREATE INDEX "policies_org_idx" ON "policies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "policies_client_idx" ON "policies" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "policies_agent_idx" ON "policies" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "policies_status_idx" ON "policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "policies_branch_idx" ON "policies" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "policies_group_idx" ON "policies" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "pao_policy_idx" ON "policy_add_ons" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "pao_member_idx" ON "policy_add_ons" USING btree ("policy_member_id");--> statement-breakpoint
CREATE INDEX "pcb_org_idx" ON "policy_credit_balances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pcb_policy_idx" ON "policy_credit_balances" USING btree ("policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pcb_policy_org_idx" ON "policy_credit_balances" USING btree ("policy_id","organization_id");--> statement-breakpoint
CREATE INDEX "policy_docs_org_idx" ON "policy_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "policy_docs_policy_idx" ON "policy_documents" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "pm_policy_idx" ON "policy_members" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "pm_org_idx" ON "policy_members" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_member_number_org_idx" ON "policy_members" USING btree ("organization_id","member_number");--> statement-breakpoint
CREATE INDEX "ppc_org_idx" ON "policy_premium_changes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ppc_policy_idx" ON "policy_premium_changes" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "psh_policy_idx" ON "policy_status_history" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "pbi_org_idx" ON "price_book_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pbbl_pv_idx" ON "product_benefit_bundle_links" USING btree ("product_version_id");--> statement-breakpoint
CREATE INDEX "pv_product_idx" ON "product_versions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "pv_org_idx" ON "product_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "products_org_idx" ON "products" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_code_org_idx" ON "products" USING btree ("code","organization_id");--> statement-breakpoint
CREATE INDEX "qc_quotation_idx" ON "quotation_collateral" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "qg_quotation_idx" ON "quotation_guarantors" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "ra_org_idx" ON "receipt_adverts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "receipts_org_idx" ON "receipts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_number_org_idx" ON "receipts" USING btree ("receipt_number","organization_id");--> statement-breakpoint
CREATE INDEX "req_org_idx" ON "requisitions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "req_status_idx" ON "requisitions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "req_number_org_idx" ON "requisitions" USING btree ("organization_id","requisition_number");--> statement-breakpoint
CREATE INDEX "re_org_idx" ON "reversal_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rp_role_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rp_role_perm_unique_idx" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "roles_org_idx" ON "roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sr_org_idx" ON "service_receipts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sr_case_idx" ON "service_receipts" USING btree ("funeral_case_id");--> statement-breakpoint
CREATE INDEX "sr_quot_idx" ON "service_receipts" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_receipt_org_idx" ON "service_receipts" USING btree ("organization_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_idempotency_org_idx" ON "service_receipts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "settlements_org_idx" ON "settlements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tc_org_idx" ON "terms_and_conditions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tc_pv_idx" ON "terms_and_conditions" USING btree ("product_version_id");--> statement-breakpoint
CREATE INDEX "udt_org_idx" ON "user_device_tokens" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "udt_user_idx" ON "user_device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "udt_token_unique" ON "user_device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "un_org_idx" ON "user_notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "un_recipient_idx" ON "user_notifications" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "un_read_idx" ON "user_notifications" USING btree ("recipient_id","is_read");--> statement-breakpoint
CREATE INDEX "un_created_idx" ON "user_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "upo_user_idx" ON "user_permission_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ur_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "wpw_org_idx" ON "waiting_period_waivers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "wpw_policy_idx" ON "waiting_period_waivers" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "wpw_status_idx" ON "waiting_period_waivers" USING btree ("status");