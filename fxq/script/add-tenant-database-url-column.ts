/**
 * Add database_url to organizations for per-tenant database support.
 * Usage: npx tsx script/add-tenant-database-url-column.ts
 */
import "dotenv/config";
import { pool } from "../server/db";

async function run() {
  await pool.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS database_url TEXT;
  `);
  console.log("Column organizations.database_url added (or already exists).");
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
