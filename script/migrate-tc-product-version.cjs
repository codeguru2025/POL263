/**
 * Migration: Add product_version_id column to terms_and_conditions table.
 * Run: node script/migrate-tc-product-version.cjs
 */
require("dotenv/config");
const pg = require("pg");

let url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const ssl = { rejectUnauthorized: false };
url = url.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, "");

const pool = new pg.Pool({ connectionString: url, ssl, max: 2 });

const statements = [
  `ALTER TABLE terms_and_conditions ADD COLUMN IF NOT EXISTS product_version_id UUID REFERENCES product_versions(id)`,
  `CREATE INDEX IF NOT EXISTS tc_pv_idx ON terms_and_conditions(product_version_id)`,
];

(async () => {
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      console.log(">>", sql.slice(0, 80) + (sql.length > 80 ? "..." : ""));
      await client.query(sql);
    }
    console.log("\nMigration complete.");
  } catch (err) {
    console.error("Migration error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
