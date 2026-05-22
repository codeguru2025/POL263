/**
 * Drops all tables in the Supabase backup DB so drizzle-kit push can create them fresh.
 * Run: npx tsx script/reset-supabase-backup.ts
 */
import "dotenv/config";
import pg from "pg";

const url = process.env.SUPABASE_BACKUP_URL;
if (!url) { console.error("SUPABASE_BACKUP_URL not set"); process.exit(1); }

// Use session pooler (port 5432)
const sessionUrl = url.replace(/:6543\//, ":5432/");

const pool = new pg.Pool({
  connectionString: sessionUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

try {
  // Get all tables in public schema
  const { rows } = await pool.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);

  if (rows.length === 0) {
    console.log("No tables found — DB is already clean.");
  } else {
    console.log(`Found ${rows.length} tables to drop:`, rows.map(r => r.tablename).join(", "));

    // Drop all tables with CASCADE
    await pool.query("SET session_replication_role = replica");
    for (const { tablename } of rows) {
      await pool.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
      console.log(`  Dropped: ${tablename}`);
    }
    await pool.query("SET session_replication_role = DEFAULT");

    console.log("\nAll tables dropped. Now run: npm run db:push:backup");
  }
} catch (e: any) {
  console.error("Error:", e.message);
} finally {
  await pool.end();
}
