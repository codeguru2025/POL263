/**
 * One-off: copies each org's current branding fields from the shared organizations
 * table into control_plane.tenant_branding, so the platform-owner dashboard (which
 * reads branding from tenant_branding, not organizations) reflects real, current state
 * instead of drifting stale. Going forward, PATCH /api/organizations/:id keeps these
 * two in sync on every branding write (see server/routes.ts).
 *
 * Safe to re-run — upserts (update if a tenant_branding row exists, insert otherwise).
 *
 * Usage: node scripts/backfill-tenant-branding.mjs
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

async function main() {
  const reg = connect(process.env.DATABASE_URL);
  const cp = connect(process.env.CONTROL_PLANE_DATABASE_URL);
  await reg.connect();
  await cp.connect();

  const { rows: orgs } = await reg.query(`
    select id, name, logo_url, signature_url, primary_color, footer_text, address, phone,
           email, website, policy_number_prefix, policy_number_padding, is_whitelabeled
    from organizations
  `);
  const { rows: tenantRows } = await cp.query("select id from tenants");
  const tenantIds = new Set(tenantRows.map((t) => t.id));
  const { rows: existingBranding } = await cp.query("select tenant_id from tenant_branding");
  const hasBranding = new Set(existingBranding.map((b) => b.tenant_id));

  let updated = 0, inserted = 0, skipped = 0;
  for (const org of orgs) {
    if (!tenantIds.has(org.id)) {
      console.log(`  ✗ ${org.name} (${org.id}) — no control_plane.tenants row, skipping`);
      skipped += 1;
      continue;
    }
    const values = [
      org.logo_url, org.signature_url, org.primary_color, org.footer_text, org.address,
      org.phone, org.email, org.website, org.policy_number_prefix, org.policy_number_padding,
      org.is_whitelabeled, org.id,
    ];
    if (hasBranding.has(org.id)) {
      await cp.query(
        `update tenant_branding set logo_url = $1, signature_url = $2, primary_color = $3,
           footer_text = $4, address = $5, phone = $6, email = $7, website = $8,
           policy_number_prefix = $9, policy_number_padding = $10, is_whitelabeled = $11,
           updated_at = now()
         where tenant_id = $12`,
        values
      );
      updated += 1;
    } else {
      await cp.query(
        `insert into tenant_branding (tenant_id, logo_url, signature_url, primary_color,
           footer_text, address, phone, email, website, policy_number_prefix,
           policy_number_padding, is_whitelabeled)
         values ($12, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        values
      );
      inserted += 1;
    }
    console.log(`  ✓ synced branding for ${org.name} (${org.id})`);
  }

  await reg.end();
  await cp.end();
  console.log(`Done. ${updated} updated, ${inserted} inserted, ${skipped} skipped.`);
}
main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
