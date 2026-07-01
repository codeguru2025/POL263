/**
 * Fix columns added with wrong types by sync-falakhe-schema.mts
 */
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

const fixes = [
  // balance_sheet_entries.entered_by_user_id was added as TEXT, should be UUID
  ["balance_sheet_entries.entered_by_user_id TEXT→UUID", `
    ALTER TABLE balance_sheet_entries
      ALTER COLUMN entered_by_user_id TYPE UUID USING entered_by_user_id::uuid;
  `],
  // balance_sheet_entries.updated_at was added as DATE, should be TIMESTAMP
  ["balance_sheet_entries.updated_at DATE→TIMESTAMP", `
    ALTER TABLE balance_sheet_entries
      ALTER COLUMN updated_at TYPE TIMESTAMP USING updated_at::timestamp;
    ALTER TABLE balance_sheet_entries
      ALTER COLUMN updated_at SET DEFAULT NOW();
  `],
  // bank_statement_balances.entered_by_user_id — check if it exists and fix type
  ["bank_statement_balances.entered_by_user_id (ensure UUID)", `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bank_statement_balances'
          AND column_name='entered_by_user_id' AND data_type='text'
      ) THEN
        ALTER TABLE bank_statement_balances
          ALTER COLUMN entered_by_user_id TYPE UUID USING entered_by_user_id::uuid;
      END IF;
    END $$;
  `],
];

for (const [label, sql] of fixes) {
  try {
    await client.query(sql.trim());
    console.log(`  ✓ ${label}`);
  } catch (e) {
    console.error(`  ✗ ${label}: ${e.message}`);
  }
}

await client.end();
console.log("Done.");
