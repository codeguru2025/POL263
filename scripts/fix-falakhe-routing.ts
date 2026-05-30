/**
 * Fix Falakhe database routing - set database_url so it uses dedicated DB
 */
import { db } from "../server/db";

async function fix() {
  // Update Falakhe org to use dedicated database
  await db.execute(`
    UPDATE organizations 
    SET database_url = 'postgresql://doadmin:REDACTED_ROTATED_SECRET@pol263-falakhe-do-user-37599157-0.l.db.ondigitalocean.com:25061/pol263-falakhe-pool?sslmode=require'
    WHERE id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  `);
  
  console.log("✅ Falakhe database_url updated");
  
  // Also update control plane tenant_databases
  try {
    const { cpDb } = require("../server/control-plane-db");
    await cpDb.execute(`
      INSERT INTO tenant_databases (tenant_id, database_url, created_at, updated_at)
      VALUES (
        '4eadab0e-c61b-40ee-b511-1243e9790179',
        'postgresql://doadmin:REDACTED_ROTATED_SECRET@pol263-falakhe-do-user-37599157-0.l.db.ondigitalocean.com:25061/pol263-falakhe-pool?sslmode=require',
        NOW(),
        NOW()
      )
      ON CONFLICT (tenant_id) 
      DO UPDATE SET database_url = EXCLUDED.database_url, updated_at = NOW()
    `);
    console.log("✅ Control plane tenant_databases updated");
  } catch (e: any) {
    console.log("Note: Control plane update skipped (may not exist)", e?.message || e);
  }
  
  await (db as any).end?.();
}

fix().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
