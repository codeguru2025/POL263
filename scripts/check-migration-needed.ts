/**
 * Check which Falakhe clients exist in shared DB but not in dedicated DB
 */
import { db as sharedDb } from "../server/db";
import { getDbForOrg } from "../server/tenant-db";

const FALAKHE_ORG_ID = "4eadab0e-c61b-40ee-b511-1243e9790179";

async function check() {
  console.log("=== Checking for data that needs migration ===\n");
  
  // Get dedicated DB
  const falakheDb = await getDbForOrg(FALAKHE_ORG_ID);
  
  // Get recent Falakhe clients from shared DB
  const sharedClients = await sharedDb.execute(`
    SELECT id, first_name, last_name, national_id, created_at 
    FROM clients 
    WHERE organization_id = '${FALAKHE_ORG_ID}'
    ORDER BY created_at DESC
    LIMIT 50
  `);
  
  console.log(`Found ${sharedClients.rows.length} clients in SHARED DB for Falakhe:\n`);
  
  let missingInFalakhe = 0;
  for (const client of sharedClients.rows) {
    // Check if exists in Falakhe DB
    const exists = await falakheDb.execute(`
      SELECT id FROM clients WHERE national_id = '${client.national_id}'
    `);
    
    const status = exists.rows.length > 0 ? "✅ EXISTS" : "❌ MISSING";
    console.log(`${status} | ${client.first_name} ${client.last_name} | ${client.national_id} | ${client.created_at}`);
    
    if (exists.rows.length === 0) missingInFalakhe++;
  }
  
  console.log(`\n${missingInFalakhe} clients need to be migrated from shared DB to Falakhe DB`);
  
  await (sharedDb as any).end?.();
}

check().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
