/**
 * Check every table referenced in shared/schema.ts against what exists in Falakhe DB.
 * Lists all missing tables.
 */
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// All tables defined in schema.ts (extracted manually)
const schemaTables = [
  "organizations","branches","users","user_roles","roles","role_permissions","permissions",
  "user_permission_overrides","sessions","audit_logs","clients","leads","client_feedback",
  "products","product_versions","product_add_ons","product_version_add_ons",
  "policies","policy_members","policy_add_ons","policy_member_add_ons","policy_status_history",
  "policy_documents","waiting_period_waivers","policy_credit_balances","policy_premium_changes",
  "payment_transactions","payment_receipts","receipts","payment_intents","payment_events",
  "payment_disbursements","requisitions","requisition_items","expenditures",
  "claims","claim_documents","funeral_cases","funeral_quotations","funeral_quotation_items",
  "partner_parlours","parlour_personnel","service_receipts",
  "groups","group_payment_intents","group_payment_allocations",
  "commission_ledger_entries","platform_receivables","fx_rates",
  "bank_accounts","bank_deposits","bank_statement_balances","balance_sheet_entries",
  "org_policy_sequences","security_questions","cashups","vehicle_trip_logs",
  "vehicles","payroll_employees","payroll_runs","payslips","attendance_logs",
  "notification_logs","receipt_adverts","approval_requests",
  "outbox_messages",
];

const existing = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' ORDER BY table_name
`);
const existingSet = new Set(existing.rows.map(r => r.table_name));

console.log("Missing tables:");
const missing = schemaTables.filter(t => !existingSet.has(t));
if (missing.length === 0) {
  console.log("  None! All tables exist.");
} else {
  for (const t of missing) console.log(`  ✗ ${t}`);
}

console.log("\nAll tables in Falakhe DB:");
console.log(existing.rows.map(r => r.table_name).join(", "));

await client.end();
