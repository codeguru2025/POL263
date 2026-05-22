import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.SUPABASE_HOST || "db.xbstgitpicryhkoyqzyf.supabase.co",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: process.env.SUPABASE_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log("\n=== ROW COUNTS (exact) ===");
    const results: { table: string; rows: number }[] = [];

    for (const { table_name } of tables) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${table_name}"`);
      results.push({ table: table_name, rows: rows[0].n });
    }

    results.sort((a, b) => b.rows - a.rows);
    console.table(results);

    const total = results.reduce((s, r) => s + r.rows, 0);
    const nonEmpty = results.filter(r => r.rows > 0);
    console.log(`\nTotal rows: ${total}`);
    console.log(`Tables with data: ${nonEmpty.length} / ${results.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
