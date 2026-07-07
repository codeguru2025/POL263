/**
 * One-off: moves each org's Paynow credentials out of the plaintext
 * organizations.paynow_* columns (registry DB) into an encrypted row in
 * control_plane.tenant_integrations (provider "paynow"), matching the
 * encryption format produced by server/tenant-config-crypto.ts
 * (base64(iv):base64(authTag):base64(ciphertext), AES-256-GCM).
 *
 * Does NOT null out the legacy organizations columns by default — pass
 * --null-legacy (together with --apply) as a separate, deliberate step, only
 * after getOrgPaynowConfig() has been confirmed to read correctly from the
 * control plane for every migrated org. --null-legacy only touches orgs that
 * already have a matching (non-empty) tenant_integrations row, so it can
 * never delete the only copy of a credential.
 *
 * Usage:
 *   node scripts/migrate-paynow-config-to-control-plane.mjs                    # dry run
 *   node scripts/migrate-paynow-config-to-control-plane.mjs --apply            # migrate to control plane
 *   node scripts/migrate-paynow-config-to-control-plane.mjs --apply --null-legacy  # + null legacy columns
 */
import crypto from "crypto";
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const APPLY = process.argv.includes("--apply");
const NULL_LEGACY = process.argv.includes("--null-legacy");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.TENANT_CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error("TENANT_CONFIG_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("TENANT_CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters)");
  return key;
}

function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(stored) {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

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
    select id, name, paynow_integration_id, paynow_integration_key, paynow_auth_email,
           paynow_return_url, paynow_result_url, paynow_mode
    from organizations
    where paynow_integration_id is not null and paynow_integration_id != ''
       and paynow_integration_key is not null and paynow_integration_key != ''
  `);

  if (orgs.length === 0) {
    console.log("No orgs have Paynow credentials set on the organizations table. Nothing to migrate.");
    await reg.end(); await cp.end();
    return;
  }

  console.log(`Found ${orgs.length} org(s) with legacy Paynow config:${APPLY ? "" : " (DRY RUN — pass --apply to write)"}`);

  for (const org of orgs) {
    const { rows: tenantRows } = await cp.query("select id from tenants where id = $1", [org.id]);
    if (tenantRows.length === 0) {
      console.log(`  ✗ ${org.name} (${org.id}) — no control_plane.tenants row yet, skipping (run backfill-control-plane-tenants.mjs first)`);
      continue;
    }

    const { rows: existing } = await cp.query(
      "select id from tenant_integrations where tenant_id = $1 and provider = 'paynow'",
      [org.id]
    );

    const config = {
      integrationId: org.paynow_integration_id,
      integrationKey: encryptSecret(org.paynow_integration_key),
      authEmail: org.paynow_auth_email || undefined,
      returnUrl: org.paynow_return_url || undefined,
      resultUrl: org.paynow_result_url || undefined,
      mode: org.paynow_mode || undefined,
    };

    if (!APPLY) {
      console.log(`  → would ${existing.length ? "update" : "insert"} tenant_integrations for ${org.name} (${org.id}), integrationId=${org.paynow_integration_id}, mode=${org.paynow_mode}`);
      continue;
    }

    let integrationRowId = existing[0]?.id;
    if (existing.length > 0) {
      await cp.query(
        "update tenant_integrations set config = $1, is_active = true, updated_at = now() where id = $2",
        [config, existing[0].id]
      );
      console.log(`  ✓ updated tenant_integrations for ${org.name} (${org.id})`);
    } else {
      const { rows: inserted } = await cp.query(
        "insert into tenant_integrations (tenant_id, provider, is_active, config) values ($1, 'paynow', true, $2) returning id",
        [org.id, config]
      );
      integrationRowId = inserted[0].id;
      console.log(`  ✓ inserted tenant_integrations for ${org.name} (${org.id})`);
    }

    if (NULL_LEGACY) {
      // Verify the just-written row decrypts back to the exact plaintext we started
      // from before touching the only other copy of this credential.
      const { rows: verifyRows } = await cp.query("select config from tenant_integrations where id = $1", [integrationRowId]);
      const roundTripped = decryptSecret(verifyRows[0].config.integrationKey);
      if (roundTripped !== org.paynow_integration_key) {
        console.log(`  ✗ ${org.name} — round-trip verification FAILED, refusing to null legacy columns`);
        continue;
      }
      await reg.query(
        `update organizations set paynow_integration_id = null, paynow_integration_key = null,
           paynow_auth_email = null, paynow_return_url = null, paynow_result_url = null, paynow_mode = null
         where id = $1`,
        [org.id]
      );
      console.log(`  ✓ verified round-trip and nulled legacy organizations.paynow_* columns for ${org.name} (${org.id})`);
    }
  }

  await reg.end();
  await cp.end();
  console.log(APPLY ? "Done." : "Dry run complete — re-run with --apply to write changes.");
}
main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
