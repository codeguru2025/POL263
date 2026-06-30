import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;

// Check main DB for what URL the org actually uses
const main = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await main.connect();

const orgs = await main.query(`
  SELECT id, name, database_url
  FROM organizations
  WHERE database_url IS NOT NULL OR name ILIKE '%falakhe%' OR name ILIKE '%pol263%'
  ORDER BY name
`);
console.log("Orgs with database_url:", orgs.rows.length);
for (const o of orgs.rows) {
  const masked = o.database_url ? o.database_url.replace(/:\/\/.*@/, "://***@") : null;
  console.log(`  ${o.name} (${o.id}): ${masked ?? "NULL"}`);
}

// Also check all orgs to find which org has the tenant ID from logs
const all = await main.query(`SELECT id, name, database_url FROM organizations ORDER BY name`);
console.log("\nAll orgs:");
for (const o of all.rows) {
  const masked = o.database_url ? o.database_url.replace(/:\/\/.*@/, "://***@") : null;
  console.log(`  ${o.name} (${o.id}): ${masked ?? "no isolated DB"}`);
}

await main.end();

// Now connect to the Falakhe DB and check which columns still exist
const falakhe = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await falakhe.connect();

const cols = await falakhe.query(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('requisitions','expenditures','groups','payment_receipts','policies')
    AND column_name IN ('raised_date','status','is_legacy','approval_status','is_backdated')
  ORDER BY table_name, column_name
`);
console.log("\nKey columns in Falakhe DB:");
console.table(cols.rows);

// Check if tables exist
const tables = await falakhe.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('payment_disbursements','requisition_items','expenditures','groups','requisitions')
  ORDER BY table_name
`);
console.log("\nTable existence in Falakhe DB:");
console.table(tables.rows);

await falakhe.end();
