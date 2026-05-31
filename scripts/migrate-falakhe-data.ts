/**
 * Migrate Falakhe data from shared DB to dedicated DB
 * Run this BEFORE redeploying to avoid losing data
 */
import { db as sharedDb } from "../server/db";
import { getDbForOrg } from "../server/tenant-db";

const FALAKHE_ORG_ID = "4eadab0e-c61b-40ee-b511-1243e9790179";

async function migrate() {
  console.log("=== Migrating Falakhe data to dedicated DB ===\n");
  
  // Get dedicated DB connection
  const falakheDb = await getDbForOrg(FALAKHE_ORG_ID);
  
  // Check if we can connect
  const testRes = await falakheDb.execute("SELECT current_database() as db");
  console.log("Connected to Falakhe DB:", testRes.rows[0].db);
  
  // 1. Migrate clients that are in shared DB but should be in Falakhe DB
  console.log("\n--- Checking clients in shared DB ---");
  const sharedClients = await sharedDb.execute(`
    SELECT * FROM clients 
    WHERE organization_id = '${FALAKHE_ORG_ID}'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(`Found ${sharedClients.rows.length} Falakhe clients in shared DB`);
  
  // Check which ones already exist in Falakhe DB (by national_id)
  for (const client of sharedClients.rows) {
    const existing = await falakheDb.execute(`
      SELECT id, national_id FROM clients 
      WHERE national_id = '${client.national_id}'
    `);
    
    if (existing.rows.length === 0) {
      console.log(`  Migrating: ${client.first_name} ${client.last_name} (${client.national_id})`);
      // Insert into Falakhe DB
      await falakheDb.execute(`
        INSERT INTO clients (
          id, organization_id, branch_id, first_name, last_name, 
          national_id, phone, email, date_of_birth, gender,
          marital_status, address, activation_code, agent_id,
          preferred_comm_method, location, created_at, updated_at
        ) VALUES (
          '${client.id}', '${client.organization_id}', ${client.branch_id ? `'${client.branch_id}'` : 'NULL'},
          '${client.first_name}', '${client.last_name}', '${client.national_id}',
          ${client.phone ? `'${client.phone}'` : 'NULL'}, 
          ${client.email ? `'${client.email}'` : 'NULL'},
          ${client.date_of_birth ? `'${client.date_of_birth}'` : 'NULL'},
          ${client.gender ? `'${client.gender}'` : 'NULL'},
          ${client.marital_status ? `'${client.marital_status}'` : 'NULL'},
          ${client.address ? `'${client.address}'` : 'NULL'},
          ${client.activation_code ? `'${client.activation_code}'` : 'NULL'},
          ${client.agent_id ? `'${client.agent_id}'` : 'NULL'},
          ${client.preferred_comm_method ? `'${client.preferred_comm_method}'` : 'NULL'},
          ${client.location ? `'${client.location}'` : 'NULL'},
          '${client.created_at}', '${client.updated_at}'
        )
        ON CONFLICT (id) DO NOTHING
      `);
    } else {
      console.log(`  Already exists: ${client.first_name} ${client.last_name} (${client.national_id})`);
    }
  }
  
  // 2. Check policies that reference these clients
  console.log("\n--- Checking policies in shared DB ---");
  const sharedPolicies = await sharedDb.execute(`
    SELECT p.*, c.national_id 
    FROM policies p
    JOIN clients c ON p.client_id = c.id
    WHERE p.organization_id = '${FALAKHE_ORG_ID}'
    ORDER BY p.created_at DESC
    LIMIT 20
  `);
  console.log(`Found ${sharedPolicies.rows.length} Falakhe policies in shared DB`);
  
  // 3. Count totals
  const falakheClientCount = await falakheDb.execute(`SELECT COUNT(*) as count FROM clients`);
  const falakhePolicyCount = await falakheDb.execute(`SELECT COUNT(*) as count FROM policies`);
  console.log("\n--- Final counts in Falakhe DB ---");
  console.log(`Clients: ${falakheClientCount.rows[0].count}`);
  console.log(`Policies: ${falakhePolicyCount.rows[0].count}`);
  
  await (sharedDb as any).end?.();
  // Note: falakheDb uses connection pools that shouldn't be ended directly
  
  console.log("\n✅ Migration check complete!");
  console.log("\nNOTE: If clients were migrated above, they now exist in BOTH databases.");
  console.log("The shared DB copies can be deleted after you verify everything works.");
}

migrate().catch(e => {
  console.error("Error:", e.message);
  console.error(e.stack);
  process.exit(1);
});
