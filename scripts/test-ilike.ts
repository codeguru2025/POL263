/**
 * Test if ilike is causing false matches with underscore
 */
import { db } from "../server/db";
import { clients } from "../shared/schema";
import { and, eq, sql, ilike } from "drizzle-orm";

async function test() {
  const testId = "73094009J73";
  const orgId = process.argv[3]; // optional org ID
  
  console.log("Testing national ID lookup methods for:", testId);
  console.log("Org filter:", orgId || "none (all orgs)");
  console.log("");

  // Method 1: ilike (current fix)
  let query1 = db.select({id: clients.id, nationalId: clients.nationalId, orgId: clients.organizationId}).from(clients);
  if (orgId) query1 = query1.where(and(eq(clients.organizationId, orgId), ilike(clients.nationalId, testId)));
  else query1 = query1.where(ilike(clients.nationalId, testId));
  const r1 = await query1.limit(5);
  console.log("1. ILIKE method:", r1.length, "results");
  r1.forEach(c => console.log("   -", c.nationalId, "(org:", c.orgId + ")"));

  // Method 2: exact case-insensitive using lower()
  let query2 = db.select({id: clients.id, nationalId: clients.nationalId, orgId: clients.organizationId}).from(clients);
  if (orgId) query2 = query2.where(and(eq(clients.organizationId, orgId), sql`LOWER(${clients.nationalId}) = LOWER(${testId})`));
  else query2 = query2.where(sql`LOWER(${clients.nationalId}) = LOWER(${testId})`);
  const r2 = await query2.limit(5);
  console.log("\n2. LOWER() exact method:", r2.length, "results");
  r2.forEach(c => console.log("   -", c.nationalId, "(org:", c.orgId + ")"));

  // Method 3: Check for similar IDs (maybe off-by-one character)
  const r3 = await db.select({id: clients.id, nationalId: clients.nationalId, orgId: clients.organizationId})
    .from(clients)
    .where(sql`${clients.nationalId} ~* '^73.*J73$' OR ${clients.nationalId} ~* '^73094009.*$'`)
    .limit(10);
  console.log("\n3. Similar IDs (regex patterns):", r3.length, "results");
  r3.forEach(c => console.log("   -", c.nationalId, "(org:", c.orgId + ")"));

  // Check if underscore is causing issues
  console.log("\n4. SQL Pattern check:");
  console.log("   In SQL, '_' is a wildcard matching ANY single character");
  console.log("   ID 73094009J73 has no wildcards, so ilike should be exact");
  
  await db.end?.();
  console.log("\nDone.");
}

test().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
