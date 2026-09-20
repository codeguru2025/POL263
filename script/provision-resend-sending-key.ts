/**
 * Provisions the Resend API key that lets a tenant's own verified domain actually send email
 * (organizations.emailFromAddress alone isn't enough — see server/tenant-email-sending.ts for
 * why a domain-restricted key is required). Two ways to run it:
 *
 *   npm run provision:resend-sending -- <organizationId> <domain>
 *     Creates a new "sending_access" Resend API key scoped to <domain> (which must already show
 *     "verified" via `npm run resend:check-domain -- <domain>`) and stores it encrypted.
 *
 *   npm run provision:resend-sending -- <organizationId> --key <existing-api-key>
 *     Stores an already-created key instead of making a new one (e.g. one created directly via
 *     the Resend dashboard, or during troubleshooting).
 *
 * Requires env: RESEND_MANAGEMENT_API_KEY (only for the first form), CONTROL_PLANE_DATABASE_URL
 * (or DATABASE_URL), TENANT_CONFIG_ENCRYPTION_KEY.
 *
 * Remember to also run: npm run set-org-email-from -- <organizationId> <address@domain> —
 * both the address and this key need to be set for a tenant's own domain to actually send.
 */
import "dotenv/config";
import { cpPool } from "../server/control-plane-db";
import { upsertResendSendingCredential } from "../server/tenant-email-sending";

async function main() {
  const orgId = process.argv[2];
  const second = process.argv[3];
  if (!orgId || !second) {
    console.error("Usage: npm run provision:resend-sending -- <organizationId> <domain>");
    console.error("   or: npm run provision:resend-sending -- <organizationId> --key <existing-api-key>");
    process.exit(1);
  }

  let apiKey: string;
  if (second === "--key") {
    apiKey = process.argv[4];
    if (!apiKey) {
      console.error("Provide the key after --key.");
      process.exit(1);
    }
  } else {
    const domain = second;
    const managementKey = process.env.RESEND_MANAGEMENT_API_KEY;
    if (!managementKey) {
      console.error("RESEND_MANAGEMENT_API_KEY is not set.");
      process.exit(1);
    }
    const domainsRes = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${managementKey}` } });
    if (!domainsRes.ok) {
      console.error(`Resend API request failed: ${domainsRes.status} ${await domainsRes.text()}`);
      process.exit(1);
    }
    const { data } = (await domainsRes.json()) as { data: { id: string; name: string; status: string }[] };
    const match = data.find((d) => d.name === domain);
    if (!match) {
      console.error(`No domain "${domain}" found on this Resend account.`);
      process.exit(1);
    }
    if (match.status !== "verified") {
      console.error(`"${domain}" is not verified yet (status: ${match.status}). Run npm run resend:check-domain -- ${domain} until it shows verified, then re-run this.`);
      process.exit(1);
    }
    const keyRes = await fetch("https://api.resend.com/api-keys", {
      method: "POST",
      headers: { Authorization: `Bearer ${managementKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${domain}-sending`, permission: "sending_access", domain_id: match.id }),
    });
    if (!keyRes.ok) {
      console.error(`Resend API key creation failed: ${keyRes.status} ${await keyRes.text()}`);
      process.exit(1);
    }
    const created = (await keyRes.json()) as { token: string };
    apiKey = created.token;
  }

  await upsertResendSendingCredential(orgId, apiKey);
  console.log(`Resend sending key stored for tenant ${orgId}.`);
  console.log("Now run: npm run set-org-email-from -- <organizationId> <address@domain> (if not done already).");
}

main()
  .then(() => cpPool.end())
  .catch((err) => {
    console.error("Failed:", err?.message || err);
    void cpPool.end();
    process.exit(1);
  });
