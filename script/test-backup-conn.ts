import "dotenv/config";
import pg from "pg";

const directUrl = process.env.SUPABASE_BACKUP_DIRECT_URL;
const poolerUrl = process.env.SUPABASE_BACKUP_URL;

console.log("DIRECT URL set:", !!directUrl);
console.log("POOLER URL set:", !!poolerUrl);

if (directUrl) {
  console.log("\n--- Testing DIRECT connection (port 5432) ---");
  console.log("Host:", directUrl.replace(/:[^:@]+@/, ":***@").split("?")[0]);
  const pool = new pg.Pool({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    const r = await pool.query("SELECT current_database() as db, now() as ts");
    console.log("SUCCESS!", r.rows[0]);
  } catch (e: any) {
    console.error("FAILED:", e.message);
  }
  await pool.end();
}

if (poolerUrl) {
  console.log("\n--- Testing POOLER connection (port 6543) ---");
  console.log("Host:", poolerUrl.replace(/:[^:@]+@/, ":***@").split("?")[0]);
  const pool = new pg.Pool({
    connectionString: poolerUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    const r = await pool.query("SELECT current_database() as db, now() as ts");
    console.log("SUCCESS!", r.rows[0]);
  } catch (e: any) {
    console.error("FAILED:", e.message);
  }
  await pool.end();
}
