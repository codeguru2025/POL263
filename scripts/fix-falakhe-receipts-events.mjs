/**
 * Fix payment_receipts column name mismatch (approved_by → approved_by_user_id)
 * and add missing columns: submitter_note, backdated_date.
 * Also verify organizations table has the Falakhe org row (needed for payment_events FK).
 */
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected to Falakhe DB\n");

// 1. Show current payment_receipts columns
const prCols = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payment_receipts' ORDER BY ordinal_position
`);
console.log("payment_receipts columns:", prCols.rows.map(r => r.column_name).join(", "));

// 2. Check organizations table for Falakhe org
const falakheOrgId = "4eadab0e-c61b-40ee-b511-1243e9790179";
const orgCheck = await client.query(`SELECT id, name FROM organizations WHERE id=$1`, [falakheOrgId]);
console.log("\nFalakhe org in Falakhe DB:", orgCheck.rows[0] ? `FOUND: ${orgCheck.rows[0].name}` : "MISSING");

// 3. Check payment_events columns
const peCols = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payment_events' ORDER BY ordinal_position
`);
console.log("payment_events columns:", peCols.rows.map(r => r.column_name).join(", "));

// 4. Fix payment_receipts: add the correctly-named approved_by_user_id
// (approved_by was added with wrong name in our earlier fix)
const fixes = [
  // The schema uses approved_by_user_id but we added approved_by.
  // Add the correct column name and copy data from the wrong one.
  ["payment_receipts.approved_by_user_id", `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='payment_receipts' AND column_name='approved_by_user_id'
      ) THEN
        ALTER TABLE payment_receipts ADD COLUMN approved_by_user_id UUID REFERENCES users(id);
        -- Copy data from incorrectly-named column if it exists
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='payment_receipts' AND column_name='approved_by'
        ) THEN
          UPDATE payment_receipts SET approved_by_user_id = approved_by WHERE approved_by IS NOT NULL;
        END IF;
      END IF;
    END $$;
  `],
  ["payment_receipts.submitter_note",  `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS submitter_note TEXT`],
  ["payment_receipts.backdated_date",  `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS backdated_date DATE`],
];

for (const [label, sql] of fixes) {
  try {
    await client.query(sql.trim());
    console.log(`\n  ✓ ${label}`);
  } catch (e) {
    console.error(`  ✗ ${label}: ${e.message}`);
  }
}

// 5. Verify final state
const final = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payment_receipts' ORDER BY ordinal_position
`);
console.log("\npayment_receipts final columns:", final.rows.map(r => r.column_name).join(", "));

await client.end();
console.log("\nDone.");
