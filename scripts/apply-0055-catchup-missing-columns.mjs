/**
 * Migration 0055 — Catch-up: apply all columns/tables that are in the Drizzle schema
 * but were missing from the live database. Covers migrations 0037-0054 plus
 * the approval_status column that was never in any migration file.
 *
 * All statements are idempotent (IF NOT EXISTS / IF EXISTS guards).
 *
 * Run: $env:NODE_TLS_REJECT_UNAUTHORIZED="0"; node scripts/apply-0055-catchup-missing-columns.mjs
 */
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const urls = [...new Set([process.env.DATABASE_URL, process.env.DATABASE_URL_TENANT].filter(Boolean))];

for (const url of urls) {
  console.log("Applying to:", url.replace(/:\/\/.*@/, "://***@"));
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // ── 0037: policy is_legacy, policy_documents, waiting_period_waivers ──────
  await client.query(`
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS policy_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      policy_id UUID NOT NULL REFERENCES policies(id),
      document_type TEXT NOT NULL,
      label TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      file_url TEXT NOT NULL,
      storage_key TEXT,
      file_size INTEGER,
      uploaded_by UUID REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS policy_docs_org_idx ON policy_documents(organization_id);
    CREATE INDEX IF NOT EXISTS policy_docs_policy_idx ON policy_documents(policy_id);

    CREATE TABLE IF NOT EXISTS waiting_period_waivers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      policy_id UUID NOT NULL REFERENCES policies(id),
      requested_by UUID NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      supporting_notes TEXT,
      resolved_by UUID REFERENCES users(id),
      resolved_at TIMESTAMP,
      rejection_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wpw_org_idx ON waiting_period_waivers(organization_id);
    CREATE INDEX IF NOT EXISTS wpw_policy_idx ON waiting_period_waivers(policy_id);
    CREATE INDEX IF NOT EXISTS wpw_status_idx ON waiting_period_waivers(status);
  `);
  console.log("  ✓ 0037");

  // ── 0038: period_from / period_to on payment_transactions and payment_receipts ─
  await client.query(`
    ALTER TABLE payment_transactions
      ADD COLUMN IF NOT EXISTS period_from DATE,
      ADD COLUMN IF NOT EXISTS period_to   DATE;
    ALTER TABLE payment_receipts
      ADD COLUMN IF NOT EXISTS period_from DATE,
      ADD COLUMN IF NOT EXISTS period_to   DATE;
  `);
  console.log("  ✓ 0038");

  // ── 0039: grace_used_days on policies ──────────────────────────────────────
  await client.query(`
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS grace_used_days INTEGER NOT NULL DEFAULT 0;
  `);
  console.log("  ✓ 0039");

  // ── 0041: product_interest on leads ────────────────────────────────────────
  await client.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS product_interest TEXT;
  `);
  console.log("  ✓ 0041");

  // ── 0042: cascade deletes on policy child tables ────────────────────────────
  await client.query(`
    ALTER TABLE policy_documents
      DROP CONSTRAINT IF EXISTS policy_documents_policy_id_policies_id_fk;
    ALTER TABLE policy_documents
      ADD CONSTRAINT policy_documents_policy_id_policies_id_fk
        FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

    ALTER TABLE waiting_period_waivers
      DROP CONSTRAINT IF EXISTS waiting_period_waivers_policy_id_policies_id_fk;
    ALTER TABLE waiting_period_waivers
      ADD CONSTRAINT waiting_period_waivers_policy_id_policies_id_fk
        FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

    ALTER TABLE policy_members
      DROP CONSTRAINT IF EXISTS policy_members_policy_id_policies_id_fk;
    ALTER TABLE policy_members
      ADD CONSTRAINT policy_members_policy_id_policies_id_fk
        FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;

    ALTER TABLE policy_status_history
      DROP CONSTRAINT IF EXISTS policy_status_history_policy_id_policies_id_fk;
    ALTER TABLE policy_status_history
      ADD CONSTRAINT policy_status_history_policy_id_policies_id_fk
        FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE;
  `);
  console.log("  ✓ 0042");

  // ── 0043: receipt_adverts ───────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS receipt_adverts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      title TEXT, body TEXT, image_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ra_org_idx ON receipt_adverts(organization_id);
  `);
  console.log("  ✓ 0043");

  // ── 0044: payroll allowances/deductions, payslip breakdown ─────────────────
  await client.query(`
    ALTER TABLE payroll_employees
      ADD COLUMN IF NOT EXISTS housing_allowance         NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS transport_allowance       NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS other_allowances          JSONB,
      ADD COLUMN IF NOT EXISTS funeral_policy_deduction  NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS other_insurance_deduction NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS nssa_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS paye_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS aids_levy_enabled         BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE payslips
      ADD COLUMN IF NOT EXISTS days_worked       INTEGER,
      ADD COLUMN IF NOT EXISTS total_days        INTEGER,
      ADD COLUMN IF NOT EXISTS earnings          JSONB,
      ADD COLUMN IF NOT EXISTS deductions_detail JSONB;
    CREATE INDEX IF NOT EXISTS payslips_emp_run_idx ON payslips(employee_id, payroll_run_id);
  `);
  console.log("  ✓ 0044");

  // ── 0045: attendance_logs ───────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  UUID NOT NULL REFERENCES organizations(id),
      employee_id      UUID NOT NULL REFERENCES payroll_employees(id),
      date             DATE NOT NULL,
      logged_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      notes            TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      approved_by      UUID REFERENCES users(id),
      approved_at      TIMESTAMP,
      approval_notes   TEXT,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (employee_id, date)
    );
    CREATE INDEX IF NOT EXISTS al_org_idx      ON attendance_logs(organization_id);
    CREATE INDEX IF NOT EXISTS al_emp_date_idx ON attendance_logs(employee_id, date);
    CREATE INDEX IF NOT EXISTS al_status_idx   ON attendance_logs(status);
  `);
  console.log("  ✓ 0045");

  // ── 0046: employee_next sequence, employment details, banking details ───────
  await client.query(`
    ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS employee_next INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE payroll_employees
      ADD COLUMN IF NOT EXISTS employment_type     TEXT DEFAULT 'permanent',
      ADD COLUMN IF NOT EXISTS contract_start_date DATE,
      ADD COLUMN IF NOT EXISTS contract_end_date   DATE,
      ADD COLUMN IF NOT EXISTS bank_name           TEXT,
      ADD COLUMN IF NOT EXISTS bank_branch         TEXT,
      ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
      ADD COLUMN IF NOT EXISTS bank_account_type   TEXT,
      ADD COLUMN IF NOT EXISTS bank_branch_code    TEXT,
      ADD COLUMN IF NOT EXISTS bank_swift_code     TEXT;
  `);
  console.log("  ✓ 0046");

  // ── 0047 (custom): requisition_next, disbursement_next, raised_date, voucher_number, parlour_personnel
  await client.query(`
    ALTER TABLE org_policy_sequences
      ADD COLUMN IF NOT EXISTS requisition_next  INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS disbursement_next INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE requisitions   ADD COLUMN IF NOT EXISTS raised_date    DATE;
    ALTER TABLE payment_disbursements ADD COLUMN IF NOT EXISTS voucher_number TEXT;
    CREATE TABLE IF NOT EXISTS parlour_personnel (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      parlour_id      UUID NOT NULL REFERENCES partner_parlours(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      role            TEXT, phone TEXT, email TEXT,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS parlour_personnel_parlour_idx ON parlour_personnel(parlour_id);
  `);
  console.log("  ✓ 0047-custom");

  // ── 0048: users.department, requisitions needed_by_date + approver_notes ───
  await client.query(`
    ALTER TABLE users         ADD COLUMN IF NOT EXISTS department     TEXT;
    ALTER TABLE requisitions  ADD COLUMN IF NOT EXISTS needed_by_date DATE;
    ALTER TABLE requisitions  ADD COLUMN IF NOT EXISTS approver_notes TEXT;
  `);
  console.log("  ✓ 0048");

  // ── 0049: platform_receivables.source_service_receipt_id ───────────────────
  await client.query(`
    ALTER TABLE platform_receivables
      ADD COLUMN IF NOT EXISTS source_service_receipt_id UUID REFERENCES service_receipts(id);
    CREATE INDEX IF NOT EXISTS pr_recv_service_receipt_idx
      ON platform_receivables (source_service_receipt_id)
      WHERE source_service_receipt_id IS NOT NULL;
  `);
  console.log("  ✓ 0049");

  // ── 0051: soft-delete columns ───────────────────────────────────────────────
  await client.query(`
    ALTER TABLE policies             ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    ALTER TABLE payment_receipts     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  `);
  console.log("  ✓ 0051");

  // ── 0052 + 0053 + 0054: additional member premium, max_additional_members, client addresses ─
  await client.query(`
    ALTER TABLE product_versions
      ADD COLUMN IF NOT EXISTS additional_member_premium_monthly_usd NUMERIC,
      ADD COLUMN IF NOT EXISTS additional_member_premium_monthly_zar NUMERIC;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS max_additional_members INTEGER;
    ALTER TABLE clients  ADD COLUMN IF NOT EXISTS physical_address TEXT;
    ALTER TABLE clients  ADD COLUMN IF NOT EXISTS postal_address   TEXT;
  `);
  console.log("  ✓ 0052-0054");

  // ── Missing from ALL migrations: approval_status on payment_receipts ────────
  await client.query(`
    ALTER TABLE payment_receipts
      ADD COLUMN IF NOT EXISTS approval_status  TEXT,
      ADD COLUMN IF NOT EXISTS approval_note    TEXT,
      ADD COLUMN IF NOT EXISTS approved_by      UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_backdated     BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  console.log("  ✓ approval_status + is_backdated on payment_receipts");

  // ── payment_events table (may be missing on isolated tenant DBs) ────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_events (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
      organization_id   UUID REFERENCES organizations(id),
      type              TEXT NOT NULL,
      payload_json      JSONB,
      actor_type        TEXT,
      actor_id          UUID REFERENCES users(id),
      created_at        TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pe_intent_idx  ON payment_events(payment_intent_id);
    CREATE INDEX IF NOT EXISTS pe_org_idx     ON payment_events(organization_id);
    CREATE INDEX IF NOT EXISTS pe_created_idx ON payment_events(created_at);
  `);
  console.log("  ✓ payment_events table (idempotent)");

  await client.end();
  console.log("Done.\n");
}
