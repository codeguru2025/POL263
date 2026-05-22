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
    // 1. List all tables in public schema with row counts
    const { rows: tables } = await client.query(`
      SELECT
        t.table_name,
        COALESCE(s.n_live_tup, 0) AS row_count
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY s.n_live_tup DESC NULLS LAST, t.table_name
    `);

    console.log("\n=== TABLES IN SUPABASE ===");
    console.table(tables);

    // 2. For each table, show columns
    for (const { table_name } of tables) {
      const { rows: cols } = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table_name]);
      console.log(`\n--- ${table_name} (${cols.length} columns) ---`);
      console.table(cols.map(c => ({ column: c.column_name, type: c.data_type, nullable: c.is_nullable })));
    }

    // 3. Summary
    const total = tables.reduce((sum, t) => sum + Number(t.row_count), 0);
    console.log(`\n=== SUMMARY: ${tables.length} tables, ~${total} total rows ===`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
