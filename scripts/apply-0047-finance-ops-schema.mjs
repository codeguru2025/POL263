/**
 * Migration 0047 — Finance ops schema additions:
 *   - orgPolicySequences: add requisitionNext, disbursementNext
 *   - requisitions: add raisedDate
 *   - paymentDisbursements: add voucherNumber
 *   - parlourPersonnel: new table for partner parlour staff
 *
 * Run: $env:NODE_TLS_REJECT_UNAUTHORIZED="0"; node scripts/apply-0047-finance-ops-schema.mjs
 */
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const urls = [process.env.DATABASE_URL, process.env.DATABASE_URL_TENANT].filter(Boolean);

for (const url of urls) {
  console.log("Applying to:", url.replace(/:\/\/.*@/, "://***@"));
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  await client.query(`
    -- 1. Sequences for requisitions and disbursements
    ALTER TABLE org_policy_sequences
      ADD COLUMN IF NOT EXISTS requisition_next INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS disbursement_next INTEGER NOT NULL DEFAULT 0;

    -- 2. User-set raised date on requisitions
    ALTER TABLE requisitions
      ADD COLUMN IF NOT EXISTS raised_date DATE;

    -- 3. Voucher number on payment disbursements
    ALTER TABLE payment_disbursements
      ADD COLUMN IF NOT EXISTS voucher_number TEXT;

    -- 4. Partner parlour personnel
    CREATE TABLE IF NOT EXISTS parlour_personnel (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      parlour_id UUID NOT NULL REFERENCES partner_parlours(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT,
      phone TEXT,
      email TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS parlour_personnel_parlour_idx ON parlour_personnel(parlour_id);
  `);

  await client.end();
  console.log("Done.");
}
