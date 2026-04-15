/**
 * ONE-TIME migration: copy organizations from Supabase → control plane.
 *
 * Safe to run multiple times (upsert on conflict do nothing).
 * Does NOT delete or modify the source data.
 *
 * Run this BEFORE deploying the Phase 1 code changes.
 *
 * Usage:
 *   npm run db:migrate:cp
 *   — or —
 *   tsx script/migrate-orgs-to-control-plane.ts
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import * as cpSchema from "@shared/control-plane-schema";

// Strip sslmode from URL so pg doesn't override our ssl config with strict verification.
// DigitalOcean uses self-signed certs — we must set rejectUnauthorized: false explicitly.
function buildPool(rawUrl: string, max = 3): pg.Pool {
  const url = rawUrl
    .replace(/[?&]sslmode=[^&]*/gi, "")
    .replace(/\?$/, "");
  return new pg.Pool({
    connectionString: url,
    max,
    ssl: { rejectUnauthorized: false },
  });
}

// ─── SOURCE: Supabase ─────────────────────────────────────────────────────────

const sourceUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceUrl) {
  throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL must be set (source: Supabase).");
}

const sourcePool = buildPool(sourceUrl);
const sourceDb = drizzle(sourcePool, { schema });

// ─── DESTINATION: Control plane ───────────────────────────────────────────────

const destUrl = process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL;
if (!destUrl) {
  throw new Error(
    "CONTROL_PLANE_DIRECT_URL must be set (destination: pol263-control-plane).\n" +
    "Use the DIRECT connection URL (port 25060) — poolers block DDL/sequences."
  );
}

const destPool = buildPool(destUrl);
const destDb = drizzle(destPool, { schema: cpSchema });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Migration ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== migrate-orgs-to-control-plane ===\n");
  console.log(`Source: ${sourceUrl!.replace(/:([^:@]+)@/, ":***@")}`);
  console.log(`Dest:   ${destUrl!.replace(/:([^:@]+)@/, ":***@")}\n`);

  // 1. Read all organizations from Supabase
  const orgs = await sourceDb.select().from(schema.organizations);
  console.log(`Found ${orgs.length} organization(s) in source.\n`);

  let inserted = 0;
  let skipped = 0;

  for (const org of orgs) {
    const slug = slugify(org.name);
    process.stdout.write(`  ${org.name} (${org.id}) slug="${slug}" ... `);

    try {
      // Ensure slug uniqueness: append short id suffix if needed
      const uniqueSlug = `${slug}-${org.id.slice(0, 6)}`;

      // tenants row
      await destDb
        .insert(cpSchema.tenants)
        .values({
          id: org.id,
          name: org.name,
          slug: uniqueSlug,
          isActive: true,
          licenseStatus: "active",
          provisioningState: "ready",
          createdAt: org.createdAt,
        })
        .onConflictDoNothing();

      // tenant_databases row (null databaseUrl = use shared pol263 DB)
      await destDb
        .insert(cpSchema.tenantDatabases)
        .values({
          tenantId: org.id,
          databaseUrl: org.databaseUrl ?? null,
          migrationState: "current",
        })
        .onConflictDoNothing();

      // tenant_storage row (prefix isolation even on shared bucket)
      await destDb
        .insert(cpSchema.tenantStorage)
        .values({
          tenantId: org.id,
          prefix: `tenants/${org.id}/`,
        })
        .onConflictDoNothing();

      // tenant_branding row
      await destDb
        .insert(cpSchema.tenantBranding)
        .values({
          tenantId: org.id,
          logoUrl: org.logoUrl ?? "/assets/logo.png",
          signatureUrl: org.signatureUrl ?? null,
          primaryColor: org.primaryColor ?? "#0d9488",
          footerText: org.footerText ?? null,
          address: org.address ?? null,
          phone: org.phone ?? null,
          email: org.email ?? null,
          website: org.website ?? null,
          policyNumberPrefix: org.policyNumberPrefix ?? null,
          policyNumberPadding: org.policyNumberPadding
            ? String(org.policyNumberPadding)
            : "5",
          isWhitelabeled: org.isWhitelabeled,
        })
        .onConflictDoNothing();

      console.log("✓");
      inserted++;
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped/errors.`);
  console.log("\nNext steps:");
  console.log("  1. Verify: psql $CONTROL_PLANE_DIRECT_URL -c 'SELECT id, name, slug FROM tenants;'");
  console.log("  2. Deploy Phase 1 code changes.");
  console.log("  3. Run Supabase → pol263 data migration: npm run db:migrate:supabase-to-do");

  await sourcePool.end();
  await destPool.end();
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
