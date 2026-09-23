/**
 * Checks a domain's verification status in the shared Resend account (the same account/API key
 * every tenant's outbound email already uses — see server/email-service.ts). Read-only; does not
 * activate anything. Once a domain shows "verified" here, it's safe to run
 * script/set-org-email-from-address.ts for the tenant that owns it — sending from an unverified
 * domain gets the message rejected outright.
 *
 *   npm run resend:check-domain -- diasporafuneralservices.com
 *   npm run resend:check-domain                                  lists every domain on the account
 *
 * Requires env: RESEND_MANAGEMENT_API_KEY.
 */
import "dotenv/config";

async function main() {
  const key = process.env.RESEND_MANAGEMENT_API_KEY;
  if (!key) {
    console.error("RESEND_MANAGEMENT_API_KEY is not set.");
    process.exit(1);
  }
  const target = process.argv[2];
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error(`Resend API request failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const { data } = (await res.json()) as { data: { name: string; status: string; region: string; capabilities: { sending: string; receiving: string } }[] };
  const rows = target ? data.filter((d) => d.name === target) : data;
  if (target && rows.length === 0) {
    console.log(`No domain "${target}" found on this Resend account. Has it been added in the Resend dashboard yet?`);
    return;
  }
  for (const d of rows) {
    console.log(`${d.name}  —  status: ${d.status}  (sending: ${d.capabilities.sending}, receiving: ${d.capabilities.receiving})`);
  }
}

main().catch((err) => {
  console.error("Failed:", err?.message || err);
  process.exit(1);
});
