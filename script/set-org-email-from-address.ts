/**
 * Sets (or clears) an org's verified outbound sending address (organizations.emailFromAddress —
 * see shared/schema.ts, server/email-service.ts resolveFromAddress). Once set, that tenant's
 * transactional emails (notifications, quote/receipt/policy-document PDFs) send from this address
 * instead of the shared platform default — same Resend account/API key either way.
 *
 * Only run this AFTER script/check-resend-domain-status.ts shows the domain as "verified" —
 * sending from an unverified domain gets the whole message rejected by the relay, which would
 * silently break every email to that tenant's clients until corrected.
 *
 *   npm run set-org-email-from -- <organizationId> noreply@example.com
 *   npm run set-org-email-from -- <organizationId> --clear
 *
 * Requires env: DATABASE_URL.
 */
import "dotenv/config";
import { Pool } from "pg";

function stripSslMode(u: string): string {
  return u.replace(/[?&]sslmode=[^&]*/gi, "").replace(/\?$/, "");
}

async function main() {
  const orgId = process.argv[2];
  const value = process.argv[3];
  if (!orgId || !value) {
    console.error('Usage: npm run set-org-email-from -- <organizationId> <address@domain.com> | --clear');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: stripSslMode(process.env.DATABASE_URL!), ssl: { rejectUnauthorized: false } });
  const emailFromAddress = value === "--clear" ? null : value;
  const result = await pool.query(
    `update organizations set email_from_address = $1 where id = $2 returning name`,
    [emailFromAddress, orgId],
  );
  if (result.rows.length === 0) {
    console.error(`No organization found with id ${orgId}`);
    await pool.end();
    process.exit(1);
  }
  console.log(emailFromAddress
    ? `${result.rows[0].name} will now send transactional email from: ${emailFromAddress}`
    : `${result.rows[0].name} reverted to the platform default sending address.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err?.message || err);
  process.exit(1);
});
