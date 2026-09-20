/**
 * Provision (or rotate) a tenant's public-API bearer secret — lets a trusted server-to-server
 * caller (a tenant's own marketing site) skip CSRF on POST /api/public/quote,
 * /api/public/register-policy, and /api/public/agent-vcard/:refCode/quote-lead.
 *
 *   npm run provision:public-api -- <organizationId>                 create or rotate the secret
 *   npm run provision:public-api -- <organizationId> --secret <val>  set a specific secret (e.g.
 *                                                                    migrating an already-deployed
 *                                                                    global token to this per-
 *                                                                    tenant credential unchanged)
 *   npm run provision:public-api -- <organizationId> --show          print status only (no secret)
 *   npm run provision:public-api -- <organizationId> --disable       deactivate the integration
 *
 * The secret is printed to stdout ONCE (unless supplied via --secret) — give it to the
 * integration's operator immediately. It is AES-256-GCM encrypted (TENANT_CONFIG_ENCRYPTION_KEY)
 * before it touches the database and is never recoverable afterwards; re-run to rotate.
 *
 * Requires env: CONTROL_PLANE_DATABASE_URL (or DATABASE_URL), TENANT_CONFIG_ENCRYPTION_KEY.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { cpDb, cpPool } from "../server/control-plane-db";
import { tenantIntegrations } from "@shared/control-plane-schema";
import {
  PUBLIC_API_PROVIDER_KEY,
  generatePublicApiSecret,
  upsertPublicApiCredential,
  getPublicApiCredentialStatus,
} from "../server/public-api-bearer";

async function main() {
  const orgId = process.argv[2];
  const flags = process.argv.slice(3);
  if (!orgId) {
    console.error("Usage: npm run provision:public-api -- <organizationId> [--secret <value> | --show | --disable]");
    process.exit(1);
  }

  if (flags.includes("--show")) {
    const status = await getPublicApiCredentialStatus(orgId);
    console.log(JSON.stringify({ orgId, provider: PUBLIC_API_PROVIDER_KEY, ...status }, null, 2));
    return;
  }

  if (flags.includes("--disable")) {
    await cpDb
      .update(tenantIntegrations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, PUBLIC_API_PROVIDER_KEY)));
    console.log(`Public-API integration DISABLED for tenant ${orgId}.`);
    return;
  }

  const secretFlagIndex = flags.indexOf("--secret");
  const secret = secretFlagIndex >= 0 && flags[secretFlagIndex + 1] ? flags[secretFlagIndex + 1] : generatePublicApiSecret();
  await upsertPublicApiCredential(orgId, secret);

  console.log("");
  console.log(`Public-API credential provisioned for tenant: ${orgId}`);
  console.log("");
  console.log("Secret (shown once — store it with the integration's operator now, then clear this output):");
  console.log("");
  console.log(`    ${secret}`);
  console.log("");
  console.log("The caller must send it as:  Authorization: Bearer <that secret>");
  console.log("On:  POST /api/public/quote");
  console.log("     POST /api/public/register-policy");
  console.log("     POST /api/public/agent-vcard/:refCode/quote-lead");
  console.log("");
}

main()
  .then(() => cpPool.end())
  .catch((err) => {
    console.error("Failed:", err?.message || err);
    void cpPool.end();
    process.exit(1);
  });
