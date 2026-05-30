/**
 * Update Falakhe routing in control plane
 */
import { cpDb } from "../server/control-plane-db";

async function run() {
  console.log("Connecting to control plane...\n");
  
  // Check before
  const before = await cpDb.execute(`
    SELECT tenant_id, database_url 
    FROM tenant_databases 
    WHERE tenant_id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  console.log("BEFORE:", before.rows[0] || "Not found");
  
  // Insert or update
  await cpDb.execute(`
    INSERT INTO tenant_databases (tenant_id, database_url, created_at, updated_at)
    VALUES (
      '4eadab0e-c61b-40ee-b511-1243e9790179',
      'postgresql://doadmin:REDACTED_ROTATED_SECRET@pol263-falakhe-do-user-37599157-0.l.db.ondigitalocean.com:25061/pol263-falakhe-pool?sslmode=require',
      NOW(),
      NOW()
    )
    ON CONFLICT (tenant_id) 
    DO UPDATE SET 
      database_url = EXCLUDED.database_url, 
      updated_at = NOW()
  `);
  
  // Verify
  const after = await cpDb.execute(`
    SELECT tenant_id, database_url 
    FROM tenant_databases 
    WHERE tenant_id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  console.log("\nAFTER:", after.rows[0]);
  console.log("\n✅ Control plane updated!");
  
  await (cpDb as any).end?.();
}

run().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
