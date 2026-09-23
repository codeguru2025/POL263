/**
 * Permanently delete one or more tenants and all of their resources (Phase 6).
 *
 *   npx tsx script/purge-tenant.ts --name "Kings & Queens"                 # dry run — shows the plan
 *   npx tsx script/purge-tenant.ts --id <uuid> --apply                     # one tenant (irreversible)
 *   npx tsx script/purge-tenant.ts --ids <uuid>,<uuid>,<uuid> --apply      # several at once
 *
 * --apply suspends each tenant first (locks out any live session), then runs purgeTenant():
 * object storage prefix, the database (dedicated logical DB dropped from the DO cluster, or every
 * organization_id row for a shared-DB tenant), the control-plane rows, and a "(purged)" tombstone.
 * purgeTenant reads via raw SQL, so it runs even before the 0005–0007 migrations are applied.
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

async function resolveTargets(): Promise<{ id: string; name: string }[]> {
  const ids = arg("--ids");
  const id = arg("--id");
  const name = arg("--name");
  if (ids) {
    const list = ids.split(",").map((s) => s.trim()).filter(Boolean);
    const out: { id: string; name: string }[] = [];
    for (const one of list) {
      const r: any = await cpDb.execute(sql`SELECT id, name FROM tenants WHERE id = ${one}::uuid`);
      const row = (r.rows ?? r)[0];
      if (!row) throw new Error(`no tenant with id ${one}`);
      out.push({ id: row.id, name: row.name });
    }
    return out;
  }
  const lookup: any = id
    ? await cpDb.execute(sql`SELECT id, name FROM tenants WHERE id = ${id}::uuid`)
    : name
      ? await cpDb.execute(sql`SELECT id, name FROM tenants WHERE name = ${name}`)
      : (() => { throw new Error("pass --ids <csv>, --id <uuid>, or --name \"<name>\""); })();
  const rows = (lookup.rows ?? lookup) as any[];
  if (rows.length === 0) throw new Error(`no tenant matches ${id ?? `"${name}"`}`);
  if (rows.length > 1) throw new Error(`multiple tenants match "${name}" — use --id`);
  return [{ id: rows[0].id, name: rows[0].name }];
}

async function describe(id: string): Promise<void> {
  const dbLookup: any = await cpDb.execute(sql`SELECT database_url FROM tenant_databases WHERE tenant_id = ${id}::uuid`);
  const stLookup: any = await cpDb.execute(sql`SELECT prefix FROM tenant_storage WHERE tenant_id = ${id}::uuid`);
  const dedicated = !!((dbLookup.rows ?? dbLookup) as any[])[0]?.database_url;
  const prefix = ((stLookup.rows ?? stLookup) as any[])[0]?.prefix || `tenants/${id}/`;
  console.log(`  storage : ${prefix}`);
  console.log(`  database: ${dedicated ? `dedicated logical DB "tenant_${id.replace(/-/g, "")}" (dropped from DO cluster)` : "shared — every organization_id row deleted"}`);
  if (!dedicated) {
    const db = await getDbForOrg(id);
    const tbls: any = await db.execute(sql`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema
      WHERE c.table_schema='public' AND c.column_name='organization_id' AND t.table_type='BASE TABLE'`);
    const names = ((tbls.rows ?? tbls) as any[]).map((r) => r.table_name).filter((n: string) => n !== "organizations");
    let total = 0;
    const nonEmpty: string[] = [];
    for (const t of names) {
      try {
        const c: any = await db.execute(sql.raw(`SELECT count(*)::int n FROM "${t}" WHERE organization_id = '${id}'`));
        const n = Number(((c.rows ?? c) as any[])[0]?.n ?? 0);
        total += n;
        if (n > 0) nonEmpty.push(`${t}=${n}`);
      } catch { /* skip */ }
    }
    console.log(`  rows    : ${total} — ${nonEmpty.slice(0, 30).join(", ")}${nonEmpty.length > 30 ? " …" : ""}`);
  }
}

async function main() {
  const targets = await resolveTargets();

  console.log(`\n── ${targets.length} tenant(s) targeted ──────────────────────────`);
  for (const t of targets) {
    console.log(`\n${t.name}  [${t.id}]`);
    await describe(t.id);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing changed. Re-run with --apply to delete permanently.\n");
    process.exit(0);
  }

  const { purgeTenant } = await import("../server/tenant-purge");
  const { invalidateTenantActiveCache } = await import("../server/auth");
  let allOk = true;
  for (const t of targets) {
    console.log(`\n── PURGING ${t.name} ─────────────────────────────`);
    await cpDb.update(cpTenants).set({ isActive: false, licenseStatus: "suspended", suspendedAt: new Date(), suspendReason: "Purging" }).where(eq(cpTenants.id, t.id));
    invalidateTenantActiveCache(t.id);
    const result = await purgeTenant(t.id, { actorEmail: "script/purge-tenant.ts" });
    console.log("  ", JSON.stringify(result));
    if (!result.ok) allOk = false;
  }
  console.log(allOk ? "\n✓ All purges complete.\n" : "\n⚠ Some purges finished with notes — review above.\n");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => { console.error("\n✗", err.message, "\n", err.cause ?? err.stack ?? "", "\n"); process.exit(1); });
