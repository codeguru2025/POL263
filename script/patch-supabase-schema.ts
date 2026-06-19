/**
 * Patches the Supabase backup DB schema to match DigitalOcean.
 * Adds missing columns and creates missing tables.
 * Run: npx tsx script/patch-supabase-schema.ts
 */
import "dotenv/config";
import pg from "pg";

const url = process.env.SUPABASE_BACKUP_DIRECT_URL || process.env.SUPABASE_BACKUP_URL!;
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

await client.connect();
console.log("Connected to Supabase.\n");

// Disable FK checks for the session so we can create tables in any order
await client.query("SET session_replication_role = replica");

// ─── 1. ADD MISSING COLUMNS TO EXISTING TABLES ───────────────────────────────

console.log("Patching org_policy_sequences...");
await client.query(`
  ALTER TABLE "org_policy_sequences"
    ADD COLUMN IF NOT EXISTS "credit_note_next"   integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "month_end_run_next" integer NOT NULL DEFAULT 0;
`);
console.log("  OK");

console.log("Patching funeral_cases...");
await client.query(`
  ALTER TABLE "funeral_cases"
    ADD COLUMN IF NOT EXISTS "date_of_death"         date,
    ADD COLUMN IF NOT EXISTS "cause_of_death"        text,
    ADD COLUMN IF NOT EXISTS "place_of_death"        text,
    ADD COLUMN IF NOT EXISTS "informant_name"        text,
    ADD COLUMN IF NOT EXISTS "informant_phone"       text,
    ADD COLUMN IF NOT EXISTS "informant_relationship" text,
    ADD COLUMN IF NOT EXISTS "service_type"          text,
    ADD COLUMN IF NOT EXISTS "removal_location"      text,
    ADD COLUMN IF NOT EXISTS "removal_vehicle_id"    uuid,
    ADD COLUMN IF NOT EXISTS "removal_driver_id"     uuid,
    ADD COLUMN IF NOT EXISTS "burial_vehicle_id"     uuid,
    ADD COLUMN IF NOT EXISTS "burial_driver_id"      uuid,
    ADD COLUMN IF NOT EXISTS "attending_agent_id"    uuid,
    ADD COLUMN IF NOT EXISTS "deceased_dob"          date,
    ADD COLUMN IF NOT EXISTS "deceased_gender"       text,
    ADD COLUMN IF NOT EXISTS "deceased_national_id"  text,
    ADD COLUMN IF NOT EXISTS "deceased_relationship" text;
`);
console.log("  OK");

// ─── 2. CREATE MISSING TABLES ─────────────────────────────────────────────────

console.log("Creating funeral_quotations...");
await client.query(`
  CREATE TABLE IF NOT EXISTS "funeral_quotations" (
    "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id"  uuid        NOT NULL REFERENCES "organizations"("id"),
    "funeral_case_id"  uuid        NOT NULL REFERENCES "funeral_cases"("id"),
    "quotation_number" text        NOT NULL,
    "currency"         text        NOT NULL DEFAULT 'USD',
    "total"            numeric     NOT NULL DEFAULT 0,
    "status"           text        NOT NULL DEFAULT 'draft',
    "notes"            text,
    "created_by"       uuid,
    "created_at"       timestamp   NOT NULL DEFAULT now()
  );
`);
console.log("  OK");

console.log("Creating funeral_quotation_items...");
await client.query(`
  CREATE TABLE IF NOT EXISTS "funeral_quotation_items" (
    "id"                  uuid     PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "quotation_id"        uuid     NOT NULL REFERENCES "funeral_quotations"("id"),
    "price_book_item_id"  uuid,
    "description"         text     NOT NULL,
    "quantity"            numeric  NOT NULL DEFAULT 1,
    "unit_price"          numeric  NOT NULL,
    "line_total"          numeric  NOT NULL
  );
`);
console.log("  OK");

console.log("Creating service_receipts...");
await client.query(`
  CREATE TABLE IF NOT EXISTS "service_receipts" (
    "id"                 uuid      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id"    uuid      NOT NULL REFERENCES "organizations"("id"),
    "branch_id"          uuid,
    "funeral_case_id"    uuid,
    "quotation_id"       uuid,
    "receipt_number"     text      NOT NULL,
    "amount"             numeric   NOT NULL,
    "currency"           text      NOT NULL DEFAULT 'USD',
    "payment_channel"    text      NOT NULL,
    "issued_by_user_id"  uuid,
    "issued_at"          timestamp NOT NULL DEFAULT now(),
    "status"             text      NOT NULL DEFAULT 'issued',
    "notes"              text,
    "metadata_json"      jsonb,
    "created_at"         timestamp NOT NULL DEFAULT now(),
    "idempotency_key"    text UNIQUE
  );
`);
console.log("  OK");

console.log("Creating requisitions...");
await client.query(`
  CREATE TABLE IF NOT EXISTS "requisitions" (
    "id"                  uuid      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id"     uuid      NOT NULL REFERENCES "organizations"("id"),
    "branch_id"           uuid,
    "requisition_number"  text      NOT NULL,
    "category"            text      NOT NULL,
    "description"         text      NOT NULL,
    "payee"               text,
    "amount"              numeric   NOT NULL,
    "currency"            text      NOT NULL DEFAULT 'USD',
    "status"              text      NOT NULL DEFAULT 'draft',
    "requested_by"        uuid      NOT NULL,
    "approved_by"         uuid,
    "approved_at"         timestamp,
    "rejection_reason"    text,
    "paid_by"             uuid,
    "paid_at"             timestamp,
    "paid_date"           date,
    "payment_method"      text,
    "reference"           text,
    "notes"               text,
    "created_at"          timestamp NOT NULL DEFAULT now()
  );
`);
console.log("  OK");

console.log("Creating fx_rates...");
await client.query(`
  CREATE TABLE IF NOT EXISTS "fx_rates" (
    "id"               uuid      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id"  uuid      NOT NULL REFERENCES "organizations"("id"),
    "currency"         text      NOT NULL,
    "rate_to_usd"      numeric   NOT NULL,
    "updated_by"       uuid,
    "updated_at"       timestamp NOT NULL DEFAULT now()
  );
`);
console.log("  OK");

// Also ensure directory_contacts exists (created earlier but confirming)
console.log("Ensuring directory_contacts...");
await client.query(`
  CREATE TABLE IF NOT EXISTS "directory_contacts" (
    "id"              uuid      PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid      NOT NULL REFERENCES "organizations"("id"),
    "type"            text      NOT NULL,
    "name"            text      NOT NULL,
    "contact_person"  text,
    "phone"           text,
    "alt_phone"       text,
    "email"           text,
    "address"         text,
    "city"            text,
    "notes"           text,
    "is_active"       boolean   NOT NULL DEFAULT true,
    "created_at"      timestamp NOT NULL DEFAULT now()
  );
`);
console.log("  OK");

await client.query("SET session_replication_role = DEFAULT");
await client.end();
console.log("\nSchema patch complete.");
