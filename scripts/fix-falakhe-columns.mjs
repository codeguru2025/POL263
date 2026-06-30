/**
 * Directly apply all missing columns to the Falakhe tenant DB.
 * Bypasses schema_migrations (which already shows all applied but some SQL failed silently).
 * Run: $env:NODE_TLS_REJECT_UNAUTHORIZED="0"; node scripts/fix-falakhe-columns.mjs
 */
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const url = process.env.FALAKHE_DIRECT_URL || process.env.FALAKHE_DATABASE_URL;
if (!url) { console.error("FALAKHE_DATABASE_URL not set"); process.exit(1); }

console.log("Target:", url.replace(/:\/\/.*@/, "://***@"));
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const fixes = [
  // Requisitions
  ["requisitions.raised_date",       `ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS raised_date DATE`],
  ["requisitions.needed_by_date",    `ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS needed_by_date DATE`],
  ["requisitions.approver_notes",    `ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approver_notes TEXT`],
  ["requisitions.requisition_number",`ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS requisition_number TEXT`],
  // Expenditures
  ["expenditures.status",            `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`],
  ["expenditures.amount_paid",       `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0`],
  ["expenditures.paid_date",         `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS paid_date DATE`],
  // Payment disbursements
  ["payment_disbursements.voucher_number", `ALTER TABLE payment_disbursements ADD COLUMN IF NOT EXISTS voucher_number TEXT`],
  // Org sequences
  ["org_policy_sequences.requisition_next",  `ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS requisition_next INTEGER NOT NULL DEFAULT 0`],
  ["org_policy_sequences.disbursement_next", `ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS disbursement_next INTEGER NOT NULL DEFAULT 0`],
  ["org_policy_sequences.employee_next",     `ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS employee_next INTEGER NOT NULL DEFAULT 0`],
  // Users
  ["users.department", `ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT`],
  // Policies
  ["policies.is_legacy",       `ALTER TABLE policies ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE`],
  ["policies.grace_used_days", `ALTER TABLE policies ADD COLUMN IF NOT EXISTS grace_used_days INTEGER NOT NULL DEFAULT 0`],
  ["policies.deleted_at",      `ALTER TABLE policies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`],
  // Payment receipts
  ["payment_receipts.approval_status", `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS approval_status TEXT`],
  ["payment_receipts.approval_note",   `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS approval_note TEXT`],
  ["payment_receipts.approved_by",     `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id)`],
  ["payment_receipts.approved_at",     `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`],
  ["payment_receipts.is_backdated",    `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS is_backdated BOOLEAN NOT NULL DEFAULT FALSE`],
  ["payment_receipts.period_from",     `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS period_from DATE`],
  ["payment_receipts.period_to",       `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS period_to DATE`],
  ["payment_receipts.deleted_at",      `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`],
  // Payment transactions
  ["payment_transactions.period_from", `ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS period_from DATE`],
  ["payment_transactions.period_to",   `ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS period_to DATE`],
  ["payment_transactions.deleted_at",  `ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`],
  // Payroll
  ["payroll_employees.employment_type",     `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'permanent'`],
  ["payroll_employees.contract_start_date", `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS contract_start_date DATE`],
  ["payroll_employees.contract_end_date",   `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS contract_end_date DATE`],
  ["payroll_employees.bank_name",           `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_name TEXT`],
  ["payroll_employees.bank_account_number", `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_account_number TEXT`],
  ["payroll_employees.housing_allowance",   `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS housing_allowance NUMERIC(12,2)`],
  ["payroll_employees.transport_allowance", `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS transport_allowance NUMERIC(12,2)`],
  ["payroll_employees.nssa_enabled",        `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS nssa_enabled BOOLEAN NOT NULL DEFAULT FALSE`],
  ["payroll_employees.paye_enabled",        `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS paye_enabled BOOLEAN NOT NULL DEFAULT FALSE`],
  ["payroll_employees.aids_levy_enabled",   `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS aids_levy_enabled BOOLEAN NOT NULL DEFAULT FALSE`],
  ["payslips.days_worked",       `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS days_worked INTEGER`],
  ["payslips.earnings",          `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS earnings JSONB`],
  ["payslips.deductions_detail", `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS deductions_detail JSONB`],
  // Products
  ["products.max_additional_members",                          `ALTER TABLE products ADD COLUMN IF NOT EXISTS max_additional_members INTEGER`],
  ["product_versions.additional_member_premium_monthly_usd",   `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS additional_member_premium_monthly_usd NUMERIC`],
  ["product_versions.additional_member_premium_monthly_zar",   `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS additional_member_premium_monthly_zar NUMERIC`],
  // Clients
  ["clients.physical_address", `ALTER TABLE clients ADD COLUMN IF NOT EXISTS physical_address TEXT`],
  ["clients.postal_address",   `ALTER TABLE clients ADD COLUMN IF NOT EXISTS postal_address TEXT`],
  // Leads
  ["leads.product_interest", `ALTER TABLE leads ADD COLUMN IF NOT EXISTS product_interest TEXT`],
  // Tables
  ["table:receipt_adverts", `CREATE TABLE IF NOT EXISTS receipt_adverts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    title TEXT, body TEXT, image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`],
  ["table:attendance_logs", `CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    employee_id UUID NOT NULL REFERENCES payroll_employees(id),
    date DATE NOT NULL,
    logged_at TIMESTAMP NOT NULL DEFAULT NOW(),
    notes TEXT, status TEXT NOT NULL DEFAULT 'pending',
    approved_by UUID REFERENCES users(id), approved_at TIMESTAMP, approval_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, date)
  )`],
  ["table:parlour_personnel", `CREATE TABLE IF NOT EXISTS parlour_personnel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    parlour_id UUID NOT NULL REFERENCES partner_parlours(id) ON DELETE CASCADE,
    name TEXT NOT NULL, role TEXT, phone TEXT, email TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`],
  ["table:payment_events", `CREATE TABLE IF NOT EXISTS payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id),
    type TEXT NOT NULL, payload_json JSONB, actor_type TEXT,
    actor_id UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`],
];

let ok = 0, skip = 0;
for (const [label, sql] of fixes) {
  try {
    await client.query(sql);
    console.log(`  ✓ ${label}`);
    ok++;
  } catch (e) {
    if (e.code === "42701" || e.code === "42P07" || e.message?.includes("already exists")) {
      console.log(`  ~ ${label} (already exists)`);
      skip++;
    } else {
      console.error(`  ✗ ${label}: ${e.message}`);
    }
  }
}

// Indexes
const indexes = [
  `CREATE INDEX IF NOT EXISTS ra_org_idx ON receipt_adverts(organization_id)`,
  `CREATE INDEX IF NOT EXISTS al_org_idx ON attendance_logs(organization_id)`,
  `CREATE INDEX IF NOT EXISTS parlour_personnel_parlour_idx ON parlour_personnel(parlour_id)`,
  `CREATE INDEX IF NOT EXISTS pe_intent_idx ON payment_events(payment_intent_id)`,
  `CREATE INDEX IF NOT EXISTS pe_org_idx ON payment_events(organization_id)`,
];
for (const idx of indexes) {
  try { await client.query(idx); } catch (_) {}
}

console.log(`\nDone. ${ok} applied, ${skip} already existed.`);
await client.end();
