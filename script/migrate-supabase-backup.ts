import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";

async function run() {
  const url = process.env.SUPABASE_BACKUP_URL?.trim();
  if (!url) { console.error("SUPABASE_BACKUP_URL not set"); process.exit(1); }

  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await pool.query("SELECT 1");
    console.log("Connected to Supabase backup database.");

    // Ensure tracking table exists
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL)`);

    const migrationsDir = path.resolve(process.cwd(), "migrations");
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    const applied = new Set(rows.map(r => r.filename));

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      try {
        await pool.query(sql);
      } catch (e: any) {
        if (e.code === "42701" || e.code === "42P07" || e.code === "42710" || e.message?.includes("already exists")) {
          console.log(`  (skipped - already exists: ${file})`);
        } else {
          throw e;
        }
      }
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
      console.log(`  Applied ${file}`);
      ran++;
    }
    console.log(ran > 0 ? `Done — ${ran} migration(s) applied.` : `Already up to date (${files.length} files).`);
  } finally {
    await pool.end();
  }
}

run().catch(err => { console.error(err.message); process.exit(1); });
