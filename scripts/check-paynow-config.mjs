import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const main = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await main.connect();

// Check organizations table columns for paynow
const orgCols = await main.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='organizations'
  ORDER BY ordinal_position
`);
console.log("organizations columns:", orgCols.rows.map(r => r.column_name).join(", "));

// Check actual paynow config for the Falakhe org
const falakheOrgId = "4eadab0e-c61b-40ee-b511-1243e9790179";
const org = await main.query(`
  SELECT id, name, paynow_integration_id, paynow_auth_email, paynow_return_url, paynow_result_url, paynow_mode
  FROM organizations WHERE id = $1
`, [falakheOrgId]);
console.log("\nFalakhe org PayNow config (KEY HIDDEN):");
if (org.rows[0]) {
  const r = org.rows[0];
  console.log(`  integrationId: ${r.paynow_integration_id || "NOT SET"}`);
  console.log(`  authEmail: ${r.paynow_auth_email || "NOT SET"}`);
  console.log(`  returnUrl: ${r.paynow_return_url || "NOT SET"}`);
  console.log(`  resultUrl: ${r.paynow_result_url || "NOT SET"}`);
  console.log(`  mode: ${r.paynow_mode || "NOT SET"}`);

  // Check if key is set (without revealing it)
  const keyCheck = await main.query(`
    SELECT (paynow_integration_key IS NOT NULL AND paynow_integration_key != '') AS has_key
    FROM organizations WHERE id = $1
  `, [falakheOrgId]);
  console.log(`  integrationKey: ${keyCheck.rows[0].has_key ? "SET" : "NOT SET"}`);
}

await main.end();
