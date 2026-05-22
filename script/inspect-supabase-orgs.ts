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
    console.log("\n=== ORGANIZATIONS ===");
    const { rows: orgs } = await client.query(`SELECT id, name, "database_url", "is_whitelabeled" FROM organizations ORDER BY name`);
    console.table(orgs);

    console.log("\n=== USERS ===");
    const { rows: users } = await client.query(`SELECT id, email, "organization_id", "is_active" FROM users ORDER BY email`);
    console.table(users);

    console.log("\n=== BRANCHES ===");
    const { rows: branches } = await client.query(`SELECT id, name, "organization_id" FROM branches ORDER BY name`);
    console.table(branches);

    console.log("\n=== POLICIES per org ===");
    const { rows: polCounts } = await client.query(`
      SELECT o.name as org, COUNT(p.id)::int as policies
      FROM organizations o
      LEFT JOIN policies p ON p.organization_id = o.id
      GROUP BY o.id, o.name ORDER BY policies DESC
    `);
    console.table(polCounts);

    console.log("\n=== CLIENTS per org ===");
    const { rows: clientCounts } = await client.query(`
      SELECT o.name as org, COUNT(c.id)::int as clients
      FROM organizations o
      LEFT JOIN clients c ON c.organization_id = o.id
      GROUP BY o.id, o.name ORDER BY clients DESC
    `);
    console.table(clientCounts);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
