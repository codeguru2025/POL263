/**
 * One-time migration: move payment_receipts from registry DB to tenant DB for orgs
 * that have a dedicated database_url. Fixes e-statements not showing receipts that
 * were created by month-end run, group receipt, credit-apply, or group PayNow before
 * the createPaymentReceipt fix.
 *
 * Run once: npx tsx script/migrate-receipts-to-tenant-db.ts
 */
import "dotenv/config";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "../server/db";
import { getDbForOrg } from "../server/tenant-db";
import { organizations, paymentReceipts } from "../shared/schema";

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const orgsWithTenantDb = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(isNotNull(organizations.databaseUrl), ne(organizations.databaseUrl, "")));

  if (orgsWithTenantDb.length === 0) {
    console.log("No organizations with a tenant database_url found. Nothing to migrate.");
    process.exit(0);
  }

  console.log(`Found ${orgsWithTenantDb.length} org(s) with tenant DB. Checking for receipts in registry...`);

  let totalMoved = 0;
  let totalSkipped = 0;

  for (const org of orgsWithTenantDb) {
    const receiptsInRegistry = await db
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.organizationId, org.id));

    if (receiptsInRegistry.length === 0) {
      continue;
    }

    console.log(`  Org ${org.name ?? org.id}: ${receiptsInRegistry.length} receipt(s) in registry.`);

    const tdb = await getDbForOrg(org.id);

    for (const row of receiptsInRegistry) {
      try {
        await tdb
          .insert(paymentReceipts)
          .values({
            id: row.id,
            organizationId: row.organizationId,
            branchId: row.branchId,
            receiptNumber: row.receiptNumber,
            paymentIntentId: row.paymentIntentId,
            policyId: row.policyId,
            clientId: row.clientId,
            amount: row.amount,
            currency: row.currency,
            paymentChannel: row.paymentChannel,
            issuedByUserId: row.issuedByUserId,
            issuedAt: row.issuedAt,
            pdfStorageKey: row.pdfStorageKey,
            printFormat: row.printFormat,
            status: row.status,
            metadataJson: row.metadataJson,
            createdAt: row.createdAt,
          })
          .onConflictDoNothing({ target: paymentReceipts.id });
        totalMoved++;
      } catch (e: any) {
        if (e?.code === "23505") {
          totalSkipped++;
          continue;
        }
        console.error(`  Failed to insert receipt ${row.id}:`, e?.message || e);
        throw e;
      }
    }

    const ids = receiptsInRegistry.map((r) => r.id);
    await db.delete(paymentReceipts).where(inArray(paymentReceipts.id, ids));
    console.log(`  Migrated ${receiptsInRegistry.length} receipt(s) to tenant DB and removed from registry.`);
  }

  console.log(`Done. Migrated: ${totalMoved}, skipped (already in tenant): ${totalSkipped}.`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
