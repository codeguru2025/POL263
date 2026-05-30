/**
 * Execute SQL against the main database
 */
import { db } from "../server/db";

async function run() {
  console.log("Connecting to main database...\n");
  
  // Check before
  const before = await db.execute(`
    SELECT id, name, database_url 
    FROM organizations 
    WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  console.log("BEFORE:", before.rows[0]);
  
  // Update
  await db.execute(`
    UPDATE organizations 
    SET database_url = 'postgresql://doadmin:REDACTED_ROTATED_SECRET@pol263-falakhe-do-user-37599157-0.l.db.ondigitalocean.com:25061/pol263-falakhe-pool?sslmode=require'
    WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  
  // Verify
  const after = await db.execute(`
    SELECT id, name, database_url 
    FROM organizations 
    WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  console.log("\nAFTER:", after.rows[0]);
  console.log("\n✅ Falakhe routing updated!");
  
  await (db as any).end?.();
}

run().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
