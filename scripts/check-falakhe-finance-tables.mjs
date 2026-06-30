import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = [
  "service_receipts", "commission_ledger_entries", "platform_receivables",
  "bank_accounts", "bank_deposits", "bank_statement_balances",
  "fx_rates", "cashups", "vehicle_trip_logs",
  "approval_requests", "client_feedback",
  "requisitions", "expenditures"
];

for (const t of tables) {
  const exists = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1
    ) AS exists
  `, [t]);
  if (exists.rows[0].exists) {
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position
    `, [t]);
    console.log(`✓ ${t}: ${cols.rows.map(r => r.column_name).join(", ")}`);
  } else {
    console.log(`✗ ${t}: MISSING TABLE`);
  }
}

// Final check on requisitions
const rq = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='requisitions' ORDER BY ordinal_position
`);
console.log("\nrequisitions now:", rq.rows.map(r => r.column_name).join(", "));

const ex = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='expenditures' ORDER BY ordinal_position
`);
console.log("expenditures now:", ex.rows.map(r => r.column_name).join(", "));

await client.end();
