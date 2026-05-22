import "dotenv/config";
import pg from "pg";

const ssl = { rejectUnauthorized: false };
const db = new pg.Pool({
  connectionString: (process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL)!,
  ssl,
});

const client = await db.connect();
try {
  const { rows } = await client.query(
    `SELECT id, name, logo_url FROM organizations ORDER BY name`
  );
  console.log("\nOrganization logo_urls:");
  console.table(rows.map(r => ({ name: r.name, logo_url: r.logo_url ?? "(null)" })));
} finally {
  client.release();
  await db.end();
}
