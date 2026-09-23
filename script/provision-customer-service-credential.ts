/**
 * Provision (or rotate) the Customer-Service (SMSALA chatbot) shared secret for one tenant.
 *
 *   npm run provision:customer-service -- <organizationId>            create or rotate the secret
 *   npm run provision:customer-service -- <organizationId> --show     print status only (no secret)
 *   npm run provision:customer-service -- <organizationId> --disable  deactivate the integration
 *
 * The new secret is printed to stdout ONCE — paste it into SMSALA's configuration immediately.
 * It is AES-256-GCM encrypted (TENANT_CONFIG_ENCRYPTION_KEY) before it touches the database and
 * is never recoverable afterwards; re-run to rotate.
 *
 * Requires env: CONTROL_PLANE_DATABASE_URL (or DATABASE_URL), TENANT_CONFIG_ENCRYPTION_KEY.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { cpDb, cpPool } from "../server/control-plane-db";
import { tenantIntegrations } from "@shared/control-plane-schema";
import {
  CUSTOMER_SERVICE_PROVIDER_KEY,
  generateSharedSecret,
  upsertCustomerServiceCredential,
  getCustomerServiceCredentialStatus,
} from "../server/customer-service-integration";

async function main() {
  const orgId = process.argv[2];
  const flags = process.argv.slice(3);
  if (!orgId) {
    console.error("Usage: npm run provision:customer-service -- <organizationId> [--show | --disable]");
    process.exit(1);
  }

  if (flags.includes("--show")) {
    const status = await getCustomerServiceCredentialStatus(orgId);
    console.log(JSON.stringify({ orgId, provider: CUSTOMER_SERVICE_PROVIDER_KEY, ...status }, null, 2));
    return;
  }

  if (flags.includes("--disable")) {
    await cpDb
      .update(tenantIntegrations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, CUSTOMER_SERVICE_PROVIDER_KEY)));
    console.log(`Customer-Service integration DISABLED for tenant ${orgId}.`);
    return;
  }

  const secret = generateSharedSecret();
  await upsertCustomerServiceCredential(orgId, secret);
  const { computeTenantRef } = await import("../server/customer-service-tenant-resolver");
  const tenantRef = computeTenantRef(orgId);

  console.log("");
  console.log(`Customer-Service credential provisioned for tenant: ${orgId}`);
  console.log("");
  console.log("Shared secret (shown once — store it in SMSALA now, then clear this output):");
  console.log("");
  console.log(`    ${secret}`);
  console.log("");
  console.log(`tenant_ref (NOT secret — the bot maps this -> the secret above in the shared-number model):`);
  console.log(`    ${tenantRef}`);
  console.log("");
  console.log("SMSALA must send it as:   Authorization: Bearer <that secret>");
  console.log("Verify:                   POST https://<tenant-host>/api/customer-service/verify");
  console.log('   body:                  { "policy_number": "...", "identity_number": "...", "phone_number": "..." }');
  console.log("Guarded calls:            Authorization: Bearer <secret> + X-Verification-Token: <token from /verify>");
  console.log("Resolve (shared number):  POST /api/customer-service/resolve  { whatsapp_number, channel_id?, policy_number? }");
  console.log("");
}

main()
  .then(() => cpPool.end())
  .catch((err) => {
    console.error("Failed:", err?.message || err);
    void cpPool.end();
    process.exit(1);
  });
