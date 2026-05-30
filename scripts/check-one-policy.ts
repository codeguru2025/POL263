/**
 * Check policies for a single client
 */
import { db } from "../server/db";

async function check() {
  const clientId = "6c2a0647-6e10-43a3-a01a-a3cd8c00331c";
  
  console.log("PHEPHELAPHI DUBE (28009510T41):");
  
  const policies = await db.execute(`
    SELECT id, policy_number, status, inception_date
    FROM policies
    WHERE client_id = '${clientId}'
    ORDER BY created_at DESC
  `);
  
  if (policies.rows.length === 0) {
    console.log("  ❌ NO POLICIES — can issue new policy");
  } else {
    console.log(`  ✅ ${policies.rows.length} policy(ies):`);
    policies.rows.forEach((p: any) => {
      console.log(`     - ${p.policy_number || 'NO NUMBER'} | ${p.status}`);
    });
  }
  
  await (db as any).end?.();
}

check().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
