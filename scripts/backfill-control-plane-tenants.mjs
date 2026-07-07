/**
 * One-off: creates a control_plane.tenants row for any organization that predates the
 * fix wiring org creation into the control plane. Without this row, an org can't get a
 * tenant_databases or tenant_branding entry (both FK to tenants.id), which blocks the
 * dedicated-database commissioning workflow.
 *
 * licenseStatus is backfilled as "active" (not "trial") for pre-existing orgs — they're
 * already-established tenants, not new signups; "trial" is reserved for orgs created
 * after this fix, whose real status is genuinely trial.
 *
 * Usage: node scripts/backfill-control-plane-tenants.mjs
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

function connect(url) {
  const parsed = parse(url);
  return new pg.Client({
    host: parsed.host, port: parseInt(parsed.port || "5432"),
    database: parsed.database, user: parsed.user, password: parsed.password,
    ssl: { rejectUnauthorized: false },
  });
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "tenant";
}

async function main() {
  const reg = connect(process.env.DATABASE_URL);
  const cp = connect(process.env.CONTROL_PLANE_DATABASE_URL);
  await reg.connect();
  await cp.connect();

  const { rows: orgs } = await reg.query("select id, name from organizations order by created_at");
  const { rows: existingTenants } = await cp.query("select id from tenants");
  const existingIds = new Set(existingTenants.map((t) => t.id));
  const { rows: existingSlugs } = await cp.query("select slug from tenants");
  const takenSlugs = new Set(existingSlugs.map((s) => s.slug));

  const missing = orgs.filter((o) => !existingIds.has(o.id));
  if (missing.length === 0) {
    console.log("No orgs missing a control-plane tenant row.");
    await reg.end(); await cp.end();
    return;
  }

  console.log(`Backfilling ${missing.length} org(s)...`);
  for (const org of missing) {
    let slug = slugify(org.name);
    let suffix = 1;
    while (takenSlugs.has(slug)) { suffix += 1; slug = `${slugify(org.name)}-${suffix}`; }
    takenSlugs.add(slug);

    const isDeleted = org.name.trim().toLowerCase().endsWith("(deleted)");
    await cp.query(
      `insert into tenants (id, name, slug, is_active, license_status, provisioning_state)
       values ($1, $2, $3, $4, $5, 'ready')`,
      [org.id, org.name, slug, !isDeleted, isDeleted ? "suspended" : "active"]
    );
    console.log(`  ✓ ${org.name} -> slug "${slug}"${isDeleted ? " (marked suspended, name ends in (deleted))" : ""}`);
  }

  await reg.end();
  await cp.end();
  console.log("Done.");
}
main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
