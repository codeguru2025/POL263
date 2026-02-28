/**
 * One-shot migration: add beneficiary columns to policies + agent_id to clients.
 * Uses the app's DATABASE_URL with self-signed cert support.
 * Run: node script/migrate-add-columns.cjs
 */
require("dotenv/config");
const pg = require("pg");

let url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const ssl = { rejectUnauthorized: false };
url = url.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, "");

const pool = new pg.Pool({ connectionString: url, ssl, max: 2 });

const statements = [
  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS beneficiary_first_name text`,
  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS beneficiary_last_name text`,
  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS beneficiary_relationship text`,
  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS beneficiary_national_id text`,
  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS beneficiary_phone text`,
  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS beneficiary_dependent_id uuid REFERENCES dependents(id)`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES users(id)`,
  `CREATE INDEX IF NOT EXISTS clients_agent_idx ON clients(agent_id)`,
];

(async () => {
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      console.log(">>", sql.slice(0, 80) + (sql.length > 80 ? "..." : ""));
      await client.query(sql);
    }
    console.log("\nAll columns added successfully.");
  } catch (err) {
    console.error("Migration error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
