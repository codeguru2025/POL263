/**
 * One-off: seeds control_plane.tenant_branding from the legacy organizations
 * branding columns (registry DB), for every tenant that doesn't already have a
 * branding row with real data in the control plane. This is the backfill that
 * makes server/storage.ts's getOrganization() control-plane overlay return the
 * same values it did before the overlay existed, for every existing tenant.
 *
 * Never overwrites a tenant_branding row that already has non-default data —
 * that would clobber a manual edit made through the (now-removed) PATCH
 * mirror. Only inserts missing rows, or updates rows that are still at
 * all-defaults (i.e. were only ever auto-created, never actually configured).
 *
 * Usage:
 *   node scripts/migrate-branding-to-control-plane.mjs           # dry run
 *   node scripts/migrate-branding-to-control-plane.mjs --apply   # write
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const APPLY = process.argv.includes("--apply");

const DEFAULT_LOGO_URL = "/assets/logo.png";
const DEFAULT_PRIMARY_COLOR = "#0d9488";
const DEFAULT_PADDING = 5;

function connect(url) {
  const parsed = parse(url);
  return new pg.Client({
    host: parsed.host, port: parseInt(parsed.port || "5432"),
    database: parsed.database, user: parsed.user, password: parsed.password,
    ssl: { rejectUnauthorized: false },
  });
}

/** True if a tenant_branding row looks like it was only ever auto-created
 *  (all-default / empty) rather than genuinely configured, and is therefore
 *  safe to overwrite with the legacy organizations values. */
function looksUnconfigured(row) {
  if (!row) return true;
  return (
    (row.logo_url === null || row.logo_url === DEFAULT_LOGO_URL) &&
    !row.signature_url &&
    (row.primary_color === null || row.primary_color === DEFAULT_PRIMARY_COLOR) &&
    !row.footer_text &&
    !row.address &&
    !row.phone &&
    !row.email &&
    !row.website &&
    !row.policy_number_prefix &&
    (row.policy_number_padding === null || row.policy_number_padding === DEFAULT_PADDING) &&
    row.is_whitelabeled === false
  );
}

async function main() {
  const reg = connect(process.env.DATABASE_URL);
  const cp = connect(process.env.CONTROL_PLANE_DATABASE_URL);
  await reg.connect();
  await cp.connect();

  const { rows: orgs } = await reg.query(`
    select id, name, logo_url, signature_url, primary_color, footer_text, address, phone,
           email, website, policy_number_prefix, policy_number_padding, is_whitelabeled
    from organizations
    where name not like '%(deleted)'
  `);

  console.log(`Found ${orgs.length} active org(s) in the registry.${APPLY ? "" : " (DRY RUN — pass --apply to write)"}`);

  for (const org of orgs) {
    const { rows: tenantRows } = await cp.query("select id from tenants where id = $1", [org.id]);
    if (tenantRows.length === 0) {
      console.log(`  ✗ ${org.name} (${org.id}) — no control_plane.tenants row yet, skipping`);
      continue;
    }

    const { rows: existing } = await cp.query("select * from tenant_branding where tenant_id = $1", [org.id]);
    const existingRow = existing[0];

    if (existingRow && !looksUnconfigured(existingRow)) {
      console.log(`  · ${org.name} (${org.id}) — tenant_branding already has real data, skipping (not overwriting)`);
      continue;
    }

    const padding = org.policy_number_padding == null ? DEFAULT_PADDING : parseInt(org.policy_number_padding, 10);

    if (!APPLY) {
      console.log(`  → would ${existingRow ? "update" : "insert"} tenant_branding for ${org.name} (${org.id})`);
      continue;
    }

    if (existingRow) {
      await cp.query(
        `update tenant_branding set
           logo_url = $1, signature_url = $2, primary_color = $3, footer_text = $4,
           address = $5, phone = $6, email = $7, website = $8,
           policy_number_prefix = $9, policy_number_padding = $10, is_whitelabeled = $11,
           updated_at = now()
         where tenant_id = $12`,
        [org.logo_url, org.signature_url, org.primary_color, org.footer_text,
         org.address, org.phone, org.email, org.website,
         org.policy_number_prefix, padding, org.is_whitelabeled, org.id]
      );
      console.log(`  ✓ updated tenant_branding for ${org.name} (${org.id})`);
    } else {
      await cp.query(
        `insert into tenant_branding
           (tenant_id, logo_url, signature_url, primary_color, footer_text,
            address, phone, email, website, policy_number_prefix, policy_number_padding, is_whitelabeled)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [org.id, org.logo_url, org.signature_url, org.primary_color, org.footer_text,
         org.address, org.phone, org.email, org.website,
         org.policy_number_prefix, padding, org.is_whitelabeled]
      );
      console.log(`  ✓ inserted tenant_branding for ${org.name} (${org.id})`);
    }
  }

  await reg.end();
  await cp.end();
  console.log(APPLY ? "Done." : "Dry run complete — re-run with --apply to write changes.");
}
main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
