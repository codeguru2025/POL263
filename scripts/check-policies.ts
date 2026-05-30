/**
 * Check if clients have policies
 */
import { db } from "../server/db";

async function check() {
  const clients = [
    { id: "039d1bad-d51a-49ad-93ae-6ef1fc7d314c", name: "OLIVER MASUKU", nationalId: "73094009J73" },
    { id: "3d631a42-8828-4ead-9587-b8add51f1638", name: "THEMBELIHLE MHLANGA", nationalId: "41048426D41" },
    { id: "307309d9-c0ef-44fa-b66d-f4c4d9011efd", name: "JESTA NDLOVU", nationalId: "08332000W53" }
  ];

  for (const c of clients) {
    console.log(`\n=== ${c.name} (${c.nationalId}) ===`);
    
    const policies = await db.execute(`
      SELECT p.id, p.policy_number, p.status, p.inception_date
      FROM policies p
      WHERE p.client_id = '${c.id}'
      ORDER BY p.created_at DESC
    `);
    
    if (policies.rows.length === 0) {
      console.log("  ❌ NO POLICIES — client only, can issue new policy");
    } else {
      console.log(`  ✅ ${policies.rows.length} policy(ies):`);
      policies.rows.forEach((p: any) => {
        console.log(`     - ${p.policy_number || 'NO NUMBER'} | ${p.status} | Inception: ${p.inception_date || 'N/A'}`);
      });
    }
  }
  
  await (db as any).end?.();
}

check().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
