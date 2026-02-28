/**
 * One-shot migration: add commission columns to product_versions.
 * Run: node script/migrate-pv-commission.cjs
 */
require("dotenv/config");
const pg = require("pg");

let url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const ssl = { rejectUnauthorized: false };
url = url.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, "");

const pool = new pg.Pool({ connectionString: url, ssl, max: 2 });

const statements = [
  `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS commission_first_months_count integer`,
  `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS commission_first_months_rate numeric`,
  `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS commission_recurring_start_month integer`,
  `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS commission_recurring_rate numeric`,
  `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS commission_clawback_threshold integer`,
  `ALTER TABLE product_versions ADD COLUMN IF NOT EXISTS commission_funeral_incentive numeric`,
];

(async () => {
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      console.log(">>", sql.slice(0, 90) + (sql.length > 90 ? "..." : ""));
      await client.query(sql);
    }
    console.log("\nCommission columns added to product_versions successfully.");
  } catch (err) {
    console.error("Migration error:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
})();
