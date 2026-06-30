import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;

// Connect to the pooler URL (same one the app uses, per control plane config)
const url = process.env.FALAKHE_DATABASE_URL;
console.log("Target:", url.replace(/:\/\/.*@/, "://***@"));

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

// Check what columns groups currently has
const cols = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'groups'
  ORDER BY ordinal_position
`);
console.log("groups columns:", cols.rows.map(r => r.column_name).join(", "));

// Check payment_receipts columns
const prCols = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'payment_receipts'
  ORDER BY ordinal_position
`);
console.log("payment_receipts columns:", prCols.rows.map(r => r.column_name).join(", "));

// Check expenditures columns
const exCols = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'expenditures'
  ORDER BY ordinal_position
`);
console.log("expenditures columns:", exCols.rows.map(r => r.column_name).join(", "));

// Check requisitions columns
const rqCols = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'requisitions'
  ORDER BY ordinal_position
`);
console.log("requisitions columns:", rqCols.rows.map(r => r.column_name).join(", "));

// Fix groups.is_legacy + any newer group columns
const fixes = [
  ["groups.is_legacy",             `ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE`],
  ["groups.company_name",          `ALTER TABLE groups ADD COLUMN IF NOT EXISTS company_name TEXT`],
  ["groups.hr_manager_name",       `ALTER TABLE groups ADD COLUMN IF NOT EXISTS hr_manager_name TEXT`],
  ["groups.hr_manager_phone",      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS hr_manager_phone TEXT`],
  ["groups.hr_manager_email",      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS hr_manager_email TEXT`],
  ["groups.contact_person_name",   `ALTER TABLE groups ADD COLUMN IF NOT EXISTS contact_person_name TEXT`],
  ["groups.contact_person_phone",  `ALTER TABLE groups ADD COLUMN IF NOT EXISTS contact_person_phone TEXT`],
  ["groups.contact_person_email",  `ALTER TABLE groups ADD COLUMN IF NOT EXISTS contact_person_email TEXT`],
];

for (const [label, sql] of fixes) {
  try {
    await client.query(sql);
    console.log(`  ✓ ${label}`);
  } catch (e) {
    if (e.code === "42701" || e.message?.includes("already exists")) {
      console.log(`  ~ ${label} (already exists)`);
    } else {
      console.error(`  ✗ ${label}: ${e.message}`);
    }
  }
}

await client.end();
console.log("Done.");
