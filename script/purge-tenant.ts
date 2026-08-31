/**
 * Permanently delete a tenant and all of its resources (Phase 6).
 *
 *   npx tsx script/purge-tenant.ts --name "Kings & Queens"          # dry run — shows the plan
 *   npx tsx script/purge-tenant.ts --id <uuid> --apply              # do it (irreversible)
 *
 * --apply suspends the tenant first (locks out any live session), then runs purgeTenant():
 * object storage prefix, the database (dedicated logical DB dropped from the DO cluster, or every
 * organization_id row for a shared-DB tenant), the control-plane rows, and a "(purged)" tombstone.
 *
 * Requires the control-plane migrations through 0006 to be applied (run `npm run db:migrate`
 * first) — the tombstone write touches tenants.view_only_grace_until.
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { cpDb } from "../server/control-plane-db";
import { tenants as cpTenants } from "@shared/control-plane-schema";
import { getDbForOrg } from "../server/tenant-db";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");

async function main() {
  const name = arg("--name");
  const id = arg("--id");
  if (!name && !id) throw new Error("pass --name \"<tenant name>\" or --id <uuid>");

  // Raw SQL (not the drizzle model) so this still works before control-plane migration 0006,
  // which adds a column the model expects.
  const lookup: any = id
    ? await cpDb.execute(sql`SELECT id, name, slug, is_active, license_status, created_at FROM tenants WHERE id = ${id}::uuid`)
    : await cpDb.execute(sql`SELECT id, name, slug, is_active, license_status, created_at FROM tenants WHERE name = ${name!}`);
  const rows = (lookup.rows ?? lookup) as any[];
  if (rows.length === 0) throw new Error(`no tenant matches ${id ?? `"${name}"`}`);
  if (rows.length > 1) throw new Error(`multiple tenants match "${name}" — use --id`);
  const tenant = { id: rows[0].id, name: rows[0].name, slug: rows[0].slug, isActive: rows[0].is_active, licenseStatus: rows[0].license_status, createdAt: rows[0].created_at };

  console.log("\n── Tenant ─────────────────────────────────────────────");
  console.log({ id: tenant.id, name: tenant.name, slug: tenant.slug, isActive: tenant.isActive, licenseStatus: tenant.licenseStatus, createdAt: tenant.createdAt });

  // Migration guard
  const col: any = await cpDb.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='view_only_grace_until'`);
  const hasCol = ((col.rows ?? col) as any[]).length > 0;
  console.log(`control-plane migration 0006 applied: ${hasCol ? "yes" : "NO — run npm run db:migrate first"}`);

  const dbLookup: any = await cpDb.execute(sql`SELECT database_url FROM tenant_databases WHERE tenant_id = ${tenant.id}`);
  const stLookup: any = await cpDb.execute(sql`SELECT prefix FROM tenant_storage WHERE tenant_id = ${tenant.id}`);
  const dedicated = !!((dbLookup.rows ?? dbLookup) as any[])[0]?.database_url;
  const prefix = ((stLookup.rows ?? stLookup) as any[])[0]?.prefix || `tenants/${tenant.id}/`;
  console.log("\n── What will be deleted ───────────────────────────────");
  console.log(`storage prefix : ${prefix}`);
  console.log(`database       : ${dedicated ? `dedicated logical DB "tenant_${tenant.id.replace(/-/g, "")}" (dropped from DO cluster)` : "shared — every organization_id row deleted"}`);

  if (!dedicated) {
    const db = await getDbForOrg(tenant.id);
    const tbls: any = await db.execute(sql`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema
      WHERE c.table_schema='public' AND c.column_name='organization_id' AND t.table_type='BASE TABLE'`);
    const names = ((tbls.rows ?? tbls) as any[]).map((r) => r.table_name).filter((n: string) => n !== "organizations");
    let total = 0;
    const nonEmpty: string[] = [];
    for (const t of names) {
      try {
        const c: any = await db.execute(sql.raw(`SELECT count(*)::int n FROM "${t}" WHERE organization_id = '${tenant.id}'`));
        const n = Number(((c.rows ?? c) as any[])[0]?.n ?? 0);
        total += n;
        if (n > 0) nonEmpty.push(`${t}=${n}`);
      } catch { /* skip */ }
    }
    console.log(`shared rows    : ${total} across ${nonEmpty.length} table(s)`);
    console.log(`  ${nonEmpty.slice(0, 40).join(", ")}${nonEmpty.length > 40 ? " …" : ""}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing changed. Re-run with --apply to delete permanently.\n");
    process.exit(0);
  }
  if (!hasCol) console.log("note: control-plane migration 0006 not applied — the tombstone still works, view_only_grace_until is just skipped.");

  console.log("\n── APPLYING ───────────────────────────────────────────");
  await cpDb.update(cpTenants).set({ isActive: false, licenseStatus: "suspended", suspendedAt: new Date(), suspendReason: "Purging" }).where(eq(cpTenants.id, tenant.id));
  const { invalidateTenantActiveCache } = await import("../server/auth");
  invalidateTenantActiveCache(tenant.id);

  const { purgeTenant } = await import("../server/tenant-purge");
  const result = await purgeTenant(tenant.id, { actorEmail: "script/purge-tenant.ts" });
  console.log("\n── Result ─────────────────────────────────────────────");
  console.log(result);
  console.log(result.ok ? "\n✓ Purge complete.\n" : "\n⚠ Purge finished with notes — review above.\n");
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => { console.error("\n✗", err.message, "\n", err.cause ?? err.stack ?? "", "\n"); process.exit(1); });
