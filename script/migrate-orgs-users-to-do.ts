/**
 * ONE-TIME migration: copy organizations and users from Supabase → pol263 shared DO DB.
 *
 * Run this after `npm run db:push:do` to populate the shared DO DB with registry data.
 * Falakhe (4eadab0e-...) is excluded — it has its own isolated database and its own data.
 * Safe to run multiple times (ON CONFLICT DO NOTHING).
 *
 * Usage:
 *   npm run db:migrate:shared-registry
 *   — or —
 *   tsx script/migrate-orgs-users-to-do.ts
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const FALAKHE_ORG_ID = "4eadab0e-c61b-40ee-b511-1243e9790179";

function buildPool(rawUrl: string, max = 3): pg.Pool {
  const url = rawUrl
    .replace(/[?&]sslmode=[^&]*/gi, "")
    .replace(/\?$/, "");
  return new pg.Pool({ connectionString: url, max, ssl: { rejectUnauthorized: false } });
}

const sourceUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("SUPABASE_DATABASE_URL (or DATABASE_URL) must be set.");

const destUrl = process.env.DATABASE_DIRECT_URL;
if (!destUrl) throw new Error("DATABASE_DIRECT_URL must be set (direct DO connection, not pooler).");

const sourcePool = buildPool(sourceUrl);
const destPool   = buildPool(destUrl);
const srcDb  = drizzle(sourcePool, { schema });
const destDb = drizzle(destPool,   { schema });

async function batchInsert<T extends object>(
  label: string,
  rows: T[],
  insertFn: (batch: T[]) => Promise<void>,
  batchSize = 500,
) {
  if (rows.length === 0) { console.log(`  ${label}: 0 rows — skip`); return; }
  let done = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    await insertFn(rows.slice(i, i + batchSize));
    done += Math.min(batchSize, rows.length - i);
    process.stdout.write(`\r  ${label}: ${done}/${rows.length}`);
  }
  console.log(` ✓`);
}

async function main() {
  console.log("=== migrate-orgs-users-to-do ===\n");
  console.log(`Source: ${sourceUrl!.replace(/:([^:@]+)@/, ":***@")}`);
  console.log(`Dest:   ${destUrl.replace(/:([^:@]+)@/, ":***@")}\n`);

  // 1. Organizations — all except Falakhe (which has its own isolated DB)
  const allOrgs = await srcDb.select().from(schema.organizations);
  const orgsToMigrate = allOrgs.filter((o) => o.id !== FALAKHE_ORG_ID);
  console.log(`Organizations to copy: ${orgsToMigrate.length} (Falakhe excluded)`);

  await batchInsert("organizations", orgsToMigrate, async (batch) => {
    await destDb.insert(schema.organizations).values(batch).onConflictDoNothing();
  });

  // 2. Branches — non-Falakhe (users.branch_id FKs into branches)
  const allBranches = await srcDb.select().from(schema.branches);
  const branchesToMigrate = allBranches.filter((b) => b.organizationId !== FALAKHE_ORG_ID);
  console.log(`Branches to copy:      ${branchesToMigrate.length}`);

  await batchInsert("branches", branchesToMigrate, async (batch) => {
    await destDb.insert(schema.branches).values(batch).onConflictDoNothing();
  });

  // 3. Users — non-Falakhe + null-org users (platform admins)
  const allUsers = await srcDb.select().from(schema.users);
  const usersToMigrate = allUsers.filter((u) => u.organizationId !== FALAKHE_ORG_ID);
  console.log(`Users to copy:         ${usersToMigrate.length}`);

  await batchInsert("users", usersToMigrate, async (batch) => {
    await destDb.insert(schema.users).values(batch).onConflictDoNothing();
  });

  // 4. Verify
  console.log("\n--- Verification ---");
  const orgCountResult    = await destPool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM organizations");
  const branchCountResult = await destPool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM branches");
  const userCountResult   = await destPool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users");
  console.log(`organizations in dest: ${orgCountResult.rows[0].count}`);
  console.log(`branches in dest:      ${branchCountResult.rows[0].count}`);
  console.log(`users in dest:         ${userCountResult.rows[0].count}`);

  console.log("\n✓ Done. Restart the app server to pick up the new data.");
  console.log("  Falakhe users must login via their tenant subdomain (e.g. falakhe.pol263.com/staff/login).");

  await sourcePool.end();
  await destPool.end();
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
