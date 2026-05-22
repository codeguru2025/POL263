import "dotenv/config";
import pg from "pg";

const FALAKHE_ORG_ID = "4eadab0e-c61b-40ee-b511-1243e9790179";
const ssl = { rejectUnauthorized: false };

const mainDb = new pg.Pool({
  connectionString: (process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL)!,
  ssl,
});

const client = await mainDb.connect();
try {
  // Show what we're about to fix
  const { rows: before } = await client.query(
    `SELECT id, name, database_url FROM organizations ORDER BY name`
  );
  console.log("Before:");
  console.table(before.map(r => ({ name: r.name, database_url: r.database_url ?? "(null)" })));

  // Null out database_url for every org except Falakhe
  const { rowCount } = await client.query(
    `UPDATE organizations SET database_url = NULL WHERE id != $1`,
    [FALAKHE_ORG_ID]
  );
  console.log(`\nCleared database_url on ${rowCount} orgs (non-Falakhe).`);

  // Confirm Falakhe still has its DO URL
  const { rows: falakhe } = await client.query(
    `SELECT name, database_url FROM organizations WHERE id = $1`,
    [FALAKHE_ORG_ID]
  );
  console.log(`\nFalakhe database_url: ${falakhe[0]?.database_url ?? "(null — needs fixing!)"}`);
} finally {
  client.release();
  await mainDb.end();
}
