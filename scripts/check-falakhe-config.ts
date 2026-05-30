/**
 * Check Falakhe database configuration and recent clients
 */
import { db } from "../server/db";

async function check() {
  // Check organizations table in Falakhe DB
  const res = await db.execute(`
    SELECT id, name, database_url 
    FROM organizations 
    WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  console.log("Falakhe org in Falakhe DB:", res.rows[0]);
  
  // Count clients
  const clients = await db.execute(`SELECT COUNT(*) as count FROM clients`);
  console.log("Total clients in Falakhe DB:", clients.rows[0].count);
  
  // Most recent client
  const recent = await db.execute(`
    SELECT id, first_name, last_name, national_id, created_at 
    FROM clients 
    ORDER BY created_at DESC 
    LIMIT 3
  `);
  console.log("Recent clients:", recent.rows);
  
  await (db as any).end?.();
}

check().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
