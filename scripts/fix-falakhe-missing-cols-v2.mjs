/**
 * Fix all columns still missing from Falakhe tenant DB after the first pass.
 * Compares full schema.ts definitions against actual Falakhe table columns.
 */
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected to Falakhe DB");

// First, show what's actually in the key tables
const tables = ["requisitions", "expenditures", "payment_disbursements", "funeral_cases", "policies", "clients", "users", "payroll_employees"];
for (const t of tables) {
  const r = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position
  `, [t]);
  if (r.rows.length > 0) {
    console.log(`\n${t}: ${r.rows.map(x => x.column_name).join(", ")}`);
  }
}

const fixes = [
  // ── REQUISITIONS: missing received_by, received_by_user_id, amount_paid ──
  ["requisitions.received_by",          `ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS received_by TEXT`],
  ["requisitions.received_by_user_id",  `ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS received_by_user_id UUID REFERENCES users(id)`],
  ["requisitions.amount_paid",          `ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0`],

  // ── EXPENDITURES: missing paid_by, received_by, received_by_user_id, payment_method, reference ──
  ["expenditures.paid_by",              `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id)`],
  ["expenditures.received_by",          `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS received_by TEXT`],
  ["expenditures.received_by_user_id",  `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS received_by_user_id UUID REFERENCES users(id)`],
  ["expenditures.payment_method",       `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS payment_method TEXT`],
  ["expenditures.reference",            `ALTER TABLE expenditures ADD COLUMN IF NOT EXISTS reference TEXT`],

  // ── FUNERAL CASES: check for missing columns ──
  ["funeral_cases.service_schedule_notes",  `ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS service_schedule_notes TEXT`],
  ["funeral_cases.vehicle_notes",           `ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS vehicle_notes TEXT`],
  ["funeral_cases.is_backdated",            `ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS is_backdated BOOLEAN NOT NULL DEFAULT FALSE`],
  ["funeral_cases.backdated_date",          `ALTER TABLE funeral_cases ADD COLUMN IF NOT EXISTS backdated_date DATE`],

  // ── POLICIES: check for policy_number_prefix, other newer columns ──
  ["policies.agent_id",  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES users(id)`],

  // ── USERS: slug, department columns ──
  ["users.slug",       `ALTER TABLE users ADD COLUMN IF NOT EXISTS slug TEXT`],
  ["users.department", `ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT`],

  // ── CLIENTS: newer address fields ──
  ["clients.physical_address", `ALTER TABLE clients ADD COLUMN IF NOT EXISTS physical_address TEXT`],
  ["clients.postal_address",   `ALTER TABLE clients ADD COLUMN IF NOT EXISTS postal_address TEXT`],

  // ── PAYROLL EMPLOYEES: bank_branch, bank_account_type etc ──
  ["payroll_employees.bank_branch",           `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_branch TEXT`],
  ["payroll_employees.bank_account_type",     `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_account_type TEXT`],
  ["payroll_employees.bank_branch_code",      `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_branch_code TEXT`],
  ["payroll_employees.bank_swift_code",       `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_swift_code TEXT`],
  ["payroll_employees.other_allowances",      `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS other_allowances JSONB`],
  ["payroll_employees.funeral_policy_deduction",   `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS funeral_policy_deduction NUMERIC(12,2)`],
  ["payroll_employees.other_insurance_deduction",  `ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS other_insurance_deduction NUMERIC(12,2)`],
  ["payslips.total_days",  `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS total_days INTEGER`],

  // ── PAYMENT DISBURSEMENTS ──
  ["payment_disbursements.agent_id",  `ALTER TABLE payment_disbursements ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES users(id)`],

  // ── PLATFORM RECEIVABLES: source_service_receipt_id ──
  ["platform_receivables.source_service_receipt_id", `
    ALTER TABLE platform_receivables
    ADD COLUMN IF NOT EXISTS source_service_receipt_id UUID REFERENCES service_receipts(id)
  `],
];

let ok = 0, skip = 0, err = 0;
for (const [label, sql] of fixes) {
  try {
    await client.query(sql.trim());
    console.log(`  ✓ ${label}`);
    ok++;
  } catch (e) {
    if (e.code === "42701" || e.code === "42P07" || e.code === "42710" || e.message?.includes("already exists")) {
      console.log(`  ~ ${label} (already exists)`);
      skip++;
    } else {
      console.error(`  ✗ ${label}: ${e.message}`);
      err++;
    }
  }
}

console.log(`\nDone. ${ok} applied, ${skip} already existed, ${err} errors.`);
await client.end();
