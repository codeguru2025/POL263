/**
 * Check if a client with specific national ID exists in the database
 * Run with: npx tsx scripts/check-client-id.ts 73094009j73
 */
import { db } from "../server/db";
import { clients } from "../shared/schema";
import { eq, ilike } from "drizzle-orm";

const nationalId = process.argv[2];
if (!nationalId) {
  console.log("Usage: npx tsx scripts/check-client-id.ts <national-id>");
  process.exit(1);
}

async function checkClient() {
  const normalized = nationalId.trim().toUpperCase();
  
  console.log(`Searching for national ID: "${nationalId}"`);
  console.log(`Normalized (uppercase): "${normalized}"`);
  console.log("");

  // Search case-insensitive across all orgs
  const results = await db.select().from(clients).where(
    ilike(clients.nationalId, normalized)
  );

  if (results.length === 0) {
    console.log("❌ NO CLIENT FOUND with this national ID");
    
    // Also check for partial matches (in case of typos)
    const partial = normalized.slice(0, -2); // Remove last 2 chars
    const partialResults = await db.select({
      id: clients.id,
      nationalId: clients.nationalId,
      firstName: clients.firstName,
      lastName: clients.lastName,
      organizationId: clients.organizationId,
    }).from(clients).where(
      ilike(clients.nationalId, `%${partial}%`)
    ).limit(10);
    
    if (partialResults.length > 0) {
      console.log("\n⚠️  But found similar IDs (partial matches):");
      partialResults.forEach(r => {
        console.log(`  - ${r.nationalId}: ${r.firstName} ${r.lastName} (org: ${r.organizationId})`);
      });
    }
  } else {
    console.log(`✅ FOUND ${results.length} client(s):\n`);
    results.forEach((r, i) => {
      console.log(`Client #${i + 1}:`);
      console.log(`  ID: ${r.id}`);
      console.log(`  National ID: ${r.nationalId}`);
      console.log(`  Name: ${r.firstName} ${r.lastName}`);
      console.log(`  Phone: ${r.phone}`);
      console.log(`  Email: ${r.email || "—"}`);
      console.log(`  Org ID: ${r.organizationId}`);
      console.log(`  Created: ${r.createdAt}`);
      console.log("");
    });
  }

  await db.end?.();
  process.exit(0);
}

checkClient().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
