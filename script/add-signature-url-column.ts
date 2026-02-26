/**
 * One-off migration: add signature_url to organizations (for policy docs & e-statements).
 * Usage: npx tsx script/add-signature-url-column.ts
 */
import "dotenv/config";
import { pool } from "../server/db";

async function run() {
  await pool.query(`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS signature_url TEXT;
  `);
  console.log("Column organizations.signature_url added (or already exists).");
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
