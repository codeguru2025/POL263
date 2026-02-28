/**
 * Migration: add priceMonthly, priceWeekly, priceBiweekly columns to add_ons table.
 * Copies existing priceAmount into priceMonthly for backward compatibility.
 * Run: node script/migrate-addon-prices.cjs
 */
require("dotenv/config");
const pg = require("pg");

let url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const ssl = { rejectUnauthorized: false };
url = url.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, "");

const pool = new pg.Pool({ connectionString: url, ssl, max: 2 });

const statements = [
  `ALTER TABLE add_ons ADD COLUMN IF NOT EXISTS price_monthly numeric`,
  `ALTER TABLE add_ons ADD COLUMN IF NOT EXISTS price_weekly numeric`,
  `ALTER TABLE add_ons ADD COLUMN IF NOT EXISTS price_biweekly numeric`,
  `UPDATE add_ons SET price_monthly = price_amount WHERE price_monthly IS NULL AND price_amount IS NOT NULL`,
];

(async () => {
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      console.log(">>", sql);
      await client.query(sql);
      console.log("   OK");
    }
    console.log("\nMigration complete.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
