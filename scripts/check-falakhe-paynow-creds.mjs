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

const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179";

// Check Falakhe org PayNow credentials (mask the key)
const org = await client.query(
  `SELECT id, name,
    paynow_integration_id,
    CASE WHEN paynow_integration_key IS NOT NULL AND paynow_integration_key != ''
         THEN '***SET***' ELSE 'NOT SET' END as paynow_key_status,
    paynow_auth_email,
    paynow_return_url,
    paynow_result_url,
    paynow_mode
   FROM organizations WHERE id = $1`,
  [orgId]
);
console.log("Falakhe org PayNow config:");
if (org.rows[0]) {
  const r = org.rows[0];
  console.log("  name:", r.name);
  console.log("  integration_id:", r.paynow_integration_id || "NOT SET");
  console.log("  integration_key:", r.paynow_key_status);
  console.log("  auth_email:", r.paynow_auth_email || "NOT SET");
  console.log("  return_url:", r.paynow_return_url || "NOT SET");
  console.log("  result_url:", r.paynow_result_url || "NOT SET");
  console.log("  mode:", r.paynow_mode || "NOT SET");
}

// Check recent payment intents
const intents = await client.query(
  `SELECT id, status, purpose, amount, method_selected, created_at
   FROM payment_intents
   WHERE organization_id = $1
   ORDER BY created_at DESC LIMIT 5`,
  [orgId]
);
console.log("\nRecent payment intents:");
for (const r of intents.rows) {
  console.log(`  ${r.id} | ${r.status} | ${r.amount} | ${r.method_selected} | ${r.created_at.toISOString().slice(0,16)}`);
}

await client.end();
