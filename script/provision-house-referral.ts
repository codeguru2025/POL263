/**
 * Provisions a "house" referral user for a tenant's own direct-to-consumer marketing site
 * (e.g. a Next.js site calling POL263's public quote/lead/registration endpoints). These
 * endpoints (/api/public/quote, /api/public/agent-vcard/:refCode/quote-lead,
 * /api/public/register-policy) are all ref-scoped — they resolve the organization from
 * storage.getUserByReferralCode(refCode), not from an org ID alone. A house user gives the
 * marketing site a stable POL263_PUBLIC_REF without attributing traffic to a real salesperson.
 *
 * Deliberately created with NO role assignment: these public endpoints don't check permissions,
 * and product commission rates (product_versions.commissionFirstMonthsRate etc.) apply to any
 * agentId on a policy regardless of role — leaving this user roleless avoids it silently
 * accruing commission once the org's products go live. If commission-based reporting ever
 * needs this traffic labeled, assign a role manually afterward.
 *
 * Usage:
 *   npx tsx script/provision-house-referral.ts <organizationId> "<Display Name>"
 */
import "dotenv/config";
import { Pool } from "pg";
import { randomUUID } from "crypto";

function stripSsl(u: string) {
  return u.replace(/[?&]sslmode=[^&]*/gi, "").replace(/\?$/, "");
}

function generateRefCode() {
  return `AGT${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

async function main() {
  const orgId = process.argv[2];
  const displayName = process.argv[3];
  if (!orgId || !displayName) {
    console.error('Usage: npx tsx script/provision-house-referral.ts <organizationId> "<Display Name>"');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: stripSsl(process.env.DATABASE_URL!), ssl: { rejectUnauthorized: false } });

  const org = await pool.query(`select id, name from organizations where id = $1`, [orgId]);
  if (org.rows.length === 0) {
    console.error(`No organization found with id ${orgId}`);
    await pool.end();
    process.exit(1);
  }

  let refCode = generateRefCode();
  for (let i = 0; i < 5; i++) {
    const collision = await pool.query(`select 1 from users where referral_code = $1`, [refCode]);
    if (collision.rows.length === 0) break;
    refCode = generateRefCode();
  }

  const email = `house-${orgId.slice(0, 8)}@pol263-house.internal`;
  const id = randomUUID();
  await pool.query(
    `insert into users (id, email, display_name, referral_code, organization_id, is_active)
     values ($1, $2, $3, $4, $5, true)`,
    [id, email, displayName, refCode, orgId]
  );

  console.log(`House referral user created for ${org.rows[0].name} (${orgId})`);
  console.log(`  user id:      ${id}`);
  console.log(`  email:        ${email} (internal placeholder, no login)`);
  console.log(`  referralCode: ${refCode}  <-- set as POL263_PUBLIC_REF`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
