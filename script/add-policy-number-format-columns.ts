/**
 * Add policy number format columns to organizations (per-tenant format e.g. 00001).
 * Usage: npx tsx script/add-policy-number-format-columns.ts
 */
import "dotenv/config";
import { pool } from "../server/db";

async function run() {
  await pool.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS policy_number_prefix TEXT;
  `);
  await pool.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS policy_number_padding INTEGER NOT NULL DEFAULT 5;
  `);
  console.log("Columns organizations.policy_number_prefix and policy_number_padding added (or already exist).");
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
