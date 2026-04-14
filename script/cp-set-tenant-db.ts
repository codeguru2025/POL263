/**
 * Updates a tenant's databaseUrl in the control plane after their data
 * has been migrated to an isolated database.
 *
 * Usage:
 *   npm run db:cp:set-falakhe-db
 *   — or —
 *   TENANT_ID=<uuid> TENANT_DB_URL=<pooler_url> tsx script/cp-set-tenant-db.ts
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as cpSchema from "@shared/control-plane-schema";

const FALAKHE_ORG_ID = "4eadab0e-c61b-40ee-b511-1243e9790179";

const tenantId   = process.env.TENANT_ID   || FALAKHE_ORG_ID;
const dbUrl      = process.env.TENANT_DB_URL || process.env.FALAKHE_DATABASE_URL;
const directUrl  = process.env.TENANT_DIRECT_URL || process.env.FALAKHE_DIRECT_URL;

if (!dbUrl) {
  throw new Error(
    "FALAKHE_DATABASE_URL (or TENANT_DB_URL) must be set — this is the pooler URL stored in the control plane."
  );
}

function stripSslMode(url: string) {
  return url.replace(/[?&]sslmode=[^&]*/gi, "").replace(/\?$/, "");
}

// Use direct URL — pooler requires an explicitly configured pool name in DO.
// The direct connection works for both DDL and DML.
const cpUrl = process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL;
if (!cpUrl) throw new Error("CONTROL_PLANE_DIRECT_URL must be set.");

const pool = new pg.Pool({ connectionString: stripSslMode(cpUrl), max: 2, ssl: { rejectUnauthorized: false } });
const cpDb = drizzle(pool, { schema: cpSchema });

async function main() {
  console.log(`Setting tenant DB for ${tenantId}...`);
  console.log(`  pooler URL: ${dbUrl!.replace(/:([^:@]+)@/, ":***@")}`);
  if (directUrl) console.log(`  direct URL: ${directUrl.replace(/:([^:@]+)@/, ":***@")}`);

  await cpDb
    .update(cpSchema.tenantDatabases)
    .set({
      databaseUrl:       dbUrl!,
      databaseDirectUrl: directUrl ?? null,
      migrationState:    "current",
      lastMigratedAt:    new Date(),
    })
    .where(eq(cpSchema.tenantDatabases.tenantId, tenantId));

  console.log("✓ Control plane updated.");
  console.log("\nFrom this point, all requests for this tenant route to their isolated database.");
  console.log("Restart the app server to clear the tenant pool cache.");

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
