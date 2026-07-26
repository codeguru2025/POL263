/**
 * Commissions a dedicated database for an organization currently on the shared
 * platform DB (trial-mode default — see server/tenant-db.ts: an org with no
 * control_plane.tenant_databases row, or a null databaseUrl there, uses the shared
 * DATABASE_URL automatically). This is the generalized, any-org version of the
 * one-off Falakhe migration (script/migrate-supabase-to-do.ts +
 * script/cp-set-tenant-db.ts) — same proven approach, parameterized.
 *
 * This is a deliberately manual, admin-run workflow (not automated provisioning):
 * an admin provisions the destination Postgres database by hand (e.g. a new
 * DigitalOcean managed DB), then runs this script to build its schema, copy the
 * org's data across, and flip control-plane routing.
 *
 * The actual copy/verify/cutover logic lives in server/tenant-data-migration.ts,
 * shared with server/tenant-db-commissioning.ts's automatic trial→paid provisioning
 * trigger — this script is now a thin CLI wrapper around the same functions, not a
 * second copy of the logic.
 *
 * Steps:
 *   1. Verify the org exists and isn't already on a dedicated DB.
 *   2. Build the destination schema (reuses the app's own migration runner —
 *      the same one that runs automatically on first request in production —
 *      so a fresh empty destination DB ends up on exactly the current schema).
 *   3. Copy the org's rows, table by table, in FK-dependency order.
 *   4. Print a source-vs-destination row-count verification report.
 *   5. Upsert control_plane.tenant_databases to point at the new DB (this is the
 *      cutover — the very next request for this org routes to the new DB).
 *   6. Optionally (--activate) bump control_plane.tenants.licenseStatus to "active"
 *      and provisioningState to "ready".
 *
 * Usage:
 *   TENANT_ID=<uuid> TENANT_DB_URL=<pooler_url> [TENANT_DIRECT_URL=<direct_url>] \
 *     tsx script/commission-tenant-db.ts [--activate] [--dry-run]
 *
 *   --dry-run   only counts rows on both sides, copies nothing, writes nothing.
 *   --activate  after a successful copy + cutover, sets licenseStatus="active".
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as cpSchema from "@shared/control-plane-schema";
import { migrateTenantData } from "../server/tenant-data-migration";

const DRY_RUN = process.argv.includes("--dry-run");
const ACTIVATE = process.argv.includes("--activate");

const tenantId = process.env.TENANT_ID;
if (!tenantId) throw new Error("TENANT_ID must be set — the org id to commission a dedicated database for.");

const destUrl = process.env.TENANT_DB_URL;
if (!destUrl) throw new Error("TENANT_DB_URL must be set — pooler URL for the destination database.");
const destDirectUrl = process.env.TENANT_DIRECT_URL;

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL must be set (source — the shared platform DB).");

const cpUrl = process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL;
if (!cpUrl) throw new Error("CONTROL_PLANE_DIRECT_URL (or CONTROL_PLANE_DATABASE_URL) must be set.");

function stripSslMode(url: string): string {
  return url.replace(/[?&]sslmode=[^&]*/gi, "").replace(/\?$/, "");
}

const src = new pg.Pool({ connectionString: stripSslMode(sourceUrl), max: 3, ssl: { rejectUnauthorized: false } });
const dst = new pg.Pool({ connectionString: stripSslMode(destUrl), max: 3, ssl: { rejectUnauthorized: false } });
const cpPool = new pg.Pool({ connectionString: stripSslMode(cpUrl), max: 2, ssl: { rejectUnauthorized: false } });
const cpDb = drizzle(cpPool, { schema: cpSchema });

async function main() {
  console.log("=== commission-tenant-db ===\n");
  console.log(`Tenant: ${tenantId}`);
  console.log(`Source: ${sourceUrl!.replace(/:([^:@]+)@/, ":***@")}`);
  console.log(`Dest:   ${destUrl!.replace(/:([^:@]+)@/, ":***@")}${DRY_RUN ? "  (DRY RUN)" : ""}\n`);

  const [org] = await src.query(`SELECT id, name FROM organizations WHERE id = $1`, [tenantId]).then((r) => r.rows);
  if (!org) throw new Error(`No organization found with id ${tenantId} on the source (shared) database.`);
  console.log(`Organization: ${org.name}\n`);

  const [existingRouting] = await cpDb
    .select({ databaseUrl: cpSchema.tenantDatabases.databaseUrl })
    .from(cpSchema.tenantDatabases)
    .where(eq(cpSchema.tenantDatabases.tenantId, tenantId!));
  if (existingRouting?.databaseUrl) {
    throw new Error(
      `Tenant ${tenantId} already has a dedicated database registered in the control plane ` +
      `(${existingRouting.databaseUrl.replace(/:([^:@]+)@/, ":***@")}). Refusing to overwrite — ` +
      `if this is intentional (e.g. moving to a new host), clear tenant_databases.database_url first.`
    );
  }

  try {
    const result = await migrateTenantData({
      tenantId: tenantId!,
      srcPool: src,
      destPool: dst,
      cpDbInstance: cpDb,
      dryRun: DRY_RUN,
      cutover: { databaseUrl: destUrl!, databaseDirectUrl: destDirectUrl ?? null },
      onProgress: (e) => {
        if (e.phase === "schema") console.log("── Building destination schema (applying migrations) ──────────");
        else if (e.phase === "copy" && e.message) console.log(`${DRY_RUN ? "── Row counts (dry run) " : "── Copying data "}────────────────────────────────`);
        else if (e.phase === "copy" && e.table) {
          if (e.total === 0) console.log(`  ${e.table.padEnd(40)} 0 rows — skipped`);
          else if (DRY_RUN) console.log(`  ${e.table.padEnd(40)} ${e.total} rows (dry run — would copy)`);
          else console.log(`  ${e.table.padEnd(40)} ${e.copied} / ${e.total} rows ✓`);
        } else if (e.phase === "verify") console.log("\n=== Verification (source vs destination row counts) ===\n");
        else if (e.phase === "cutover") console.log("\n── Cutover: updating control-plane routing ─────────────────────");
      },
    });

    console.log(`\n${DRY_RUN ? "✓ Dry run complete." : "✓ All tables copied."}`);

    if (DRY_RUN) {
      console.log("\nDry run only — nothing was copied and control-plane routing was not changed.");
      return;
    }

    if (!result.success) {
      console.log("\n✗ Some counts mismatched — NOT flipping control-plane routing. Investigate before retrying.");
      for (const m of result.mismatches ?? []) console.log(`  ✗ MISMATCH: ${m}`);
      process.exitCode = 1;
      return;
    }
    console.log("✓ All counts match.");
    console.log("✓ Control plane routing updated — new requests for this tenant now use the dedicated database.");

    if (ACTIVATE) {
      await cpDb.update(cpSchema.tenants).set({ licenseStatus: "active", provisioningState: "ready" }).where(eq(cpSchema.tenants.id, tenantId!));
      console.log("✓ licenseStatus set to \"active\".");
    }

    console.log("\nNote: any existing tenant pool for this org in a running app process is cached —");
    console.log("restart the app server (or wait for LRU eviction) to pick up the new routing immediately.");
  } finally {
    await src.end();
    await dst.end();
    await cpPool.end();
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
