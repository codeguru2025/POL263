-- Policy credit balance (for month-end run underpayments)
CREATE TABLE IF NOT EXISTS "policy_credit_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "policy_id" uuid NOT NULL REFERENCES "policies"("id"),
  "balance" numeric(12, 2) DEFAULT '0' NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "pcb_org_idx" ON "policy_credit_balances" ("organization_id");
CREATE INDEX IF NOT EXISTS "pcb_policy_idx" ON "policy_credit_balances" ("policy_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pcb_policy_org_idx" ON "policy_credit_balances" ("policy_id", "organization_id");

-- Month-end runs
CREATE TABLE IF NOT EXISTS "month_end_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "run_number" text NOT NULL,
  "file_name" text,
  "total_rows" integer DEFAULT 0,
  "receipted_count" integer DEFAULT 0,
  "credit_note_count" integer DEFAULT 0,
  "status" text DEFAULT 'completed' NOT NULL,
  "run_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mer_org_idx" ON "month_end_runs" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mer_number_org_idx" ON "month_end_runs" ("run_number", "organization_id");

-- Credit notes
CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "policy_id" uuid NOT NULL REFERENCES "policies"("id"),
  "client_id" uuid NOT NULL REFERENCES "clients"("id"),
  "credit_note_number" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "reason" text,
  "month_end_run_id" uuid REFERENCES "month_end_runs"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cn_org_idx" ON "credit_notes" ("organization_id");
CREATE INDEX IF NOT EXISTS "cn_policy_idx" ON "credit_notes" ("policy_id");
CREATE INDEX IF NOT EXISTS "cn_client_idx" ON "credit_notes" ("client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cn_number_org_idx" ON "credit_notes" ("credit_note_number", "organization_id");

-- Group payment intents (bulk PayNow for group policies)
CREATE TABLE IF NOT EXISTS "group_payment_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "group_id" uuid NOT NULL REFERENCES "groups"("id"),
  "total_amount" numeric(12, 2) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'created' NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "merchant_reference" varchar(255) NOT NULL,
  "paynow_reference" varchar(255),
  "paynow_poll_url" text,
  "paynow_redirect_url" text,
  "method_selected" text DEFAULT 'unknown',
  "initiated_by_client_id" uuid REFERENCES "clients"("id"),
  "initiated_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "gpi_org_idx" ON "group_payment_intents" ("organization_id");
CREATE INDEX IF NOT EXISTS "gpi_group_idx" ON "group_payment_intents" ("group_id");
CREATE INDEX IF NOT EXISTS "gpi_status_idx" ON "group_payment_intents" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "gpi_idempotency_org_idx" ON "group_payment_intents" ("organization_id", "idempotency_key");

-- Group payment allocations
CREATE TABLE IF NOT EXISTS "group_payment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_payment_intent_id" uuid NOT NULL REFERENCES "group_payment_intents"("id") ON DELETE CASCADE,
  "policy_id" uuid NOT NULL REFERENCES "policies"("id"),
  "amount" numeric(12, 2) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "gpa_intent_idx" ON "group_payment_allocations" ("group_payment_intent_id");
CREATE INDEX IF NOT EXISTS "gpa_policy_idx" ON "group_payment_allocations" ("policy_id");
