import pg from "pg";
import * as dotenv from "dotenv";
import { parse } from "pg-connection-string";
dotenv.config();

const { Client } = pg;
const connStr = process.env.FALAKHE_DATABASE_URL || process.env.FALAKHE_DIRECT_URL;
const parsed = parse(connStr);
const client = new Client({
  host: parsed.host,
  port: parseInt(parsed.port || "5432"),
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const tables = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
);
console.log("Tables in Falakhe DB:");
tables.rows.forEach(r => console.log("  " + r.table_name));

const schemaTables = new Set([
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
]);

const dbTables = new Set(tables.rows.map(r => r.table_name));

console.log("\nTables in DB but NOT in schema (cause drizzle-kit conflict):");
let extras = 0;
for (const t of dbTables) {
  if (!schemaTables.has(t)) { console.log("  EXTRA: " + t); extras++; }
}
if (!extras) console.log("  (none)");

console.log("\nTables in schema but NOT in DB (need to be created):");
let missing = 0;
for (const t of schemaTables) {
  if (!dbTables.has(t)) { console.log("  MISSING: " + t); missing++; }
}
if (!missing) console.log("  (none)");

await client.end();
