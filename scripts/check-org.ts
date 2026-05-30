/**
 * Check Falakhe organization database config
 */
import { db } from "../server/db";

async function check() {
  const res = await db.execute(`
    SELECT id, name, database_url 
    FROM organizations 
    WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  console.log("Falakhe org config:", res.rows[0] || "Not found");
  await (db as any).end?.();
}

check().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
