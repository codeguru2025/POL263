import "dotenv/config";
import pg from "pg";

const ssl = { rejectUnauthorized: false };
const db = new pg.Pool({
  connectionString: (process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL)!,
  ssl,
});

const client = await db.connect();
try {
  // Also fix Falakhe DB
  const falakheSsl = { rejectUnauthorized: false };
  const falakheDb = new pg.Pool({
    connectionString: (process.env.FALAKHE_DIRECT_URL || process.env.FALAKHE_DATABASE_URL)!,
    ssl: falakheSsl,
  });
  const fClient = await falakheDb.connect();

  // Reset any logo_url that starts with /uploads/ to the default
  const { rowCount: mainCount } = await client.query(`
    UPDATE organizations
    SET logo_url = '/assets/logo.png'
    WHERE logo_url LIKE '/uploads/%'
  `);
  console.log(`Main DB: reset ${mainCount} broken logo URLs`);

  const { rowCount: falakheCount } = await fClient.query(`
    UPDATE organizations
    SET logo_url = '/assets/logo.png'
    WHERE logo_url LIKE '/uploads/%'
  `);
  console.log(`Falakhe DB: reset ${falakheCount} broken logo URLs`);

  fClient.release();
  await falakheDb.end();
} finally {
  client.release();
  await db.end();
}
