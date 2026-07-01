import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host,
  port: parseInt(parsed.port || "5432"),
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// Check organizations columns
const cols = await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' ORDER BY ordinal_position`
);
console.log("organizations columns:\n ", cols.rows.map(r => r.column_name).join("\n  "));

// Check if paynow columns exist
const paynowCols = ["paynow_integration_id","paynow_integration_key","paynow_auth_email","paynow_return_url","paynow_result_url","paynow_mode"];
const colSet = new Set(cols.rows.map(r => r.column_name));
console.log("\nPayNow columns status:");
for (const c of paynowCols) {
  console.log(`  ${colSet.has(c) ? "✓" : "✗ MISSING"} ${c}`);
}

// Check payment_intents columns
const piCols = await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_intents' ORDER BY ordinal_position`
);
console.log("\npayment_intents columns:", piCols.rows.map(r => r.column_name).join(", "));

await client.end();
