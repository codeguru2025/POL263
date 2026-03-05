/**
 * Repair policy status: if policy has cleared payment(s) but status is still inactive/grace/lapsed,
 * set to active and add status history. Use after EcoCash/PayNow receipt didn't update the policy.
 *
 * Run: node script/repair-policy-after-payment.cjs FLK00011
 *      node script/repair-policy-after-payment.cjs FLK00011 --force   (activate even without cleared payment)
 * ⚠️  Uses DATABASE_URL (single-tenant). For multi-tenant, use the admin API instead.
 */
require("dotenv").config();
const { Pool } = require("pg");

const policyNumber = process.argv[2]?.trim();
const force = process.argv.includes("--force");
if (!policyNumber) {
  console.error("Usage: node script/repair-policy-after-payment.cjs <policy_number> [--force]");
  process.exit(1);
}

const connStr = process.env.DATABASE_URL || "";
const acceptSelfSigned =
  process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
  connStr.includes("supabase");
const pool = new Pool({
  connectionString: connStr,
  ...(acceptSelfSigned && { ssl: { rejectUnauthorized: false } }),
});

async function main() {
  if (!connStr) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    const policyRes = await client.query(
      "SELECT id, organization_id, policy_number, status, inception_date, effective_date FROM policies WHERE policy_number = $1",
      [policyNumber]
    );
    if (policyRes.rows.length === 0) {
      console.log("Policy not found:", policyNumber);
      return;
    }
    const policy = policyRes.rows[0];
    console.log("Policy:", policy.policy_number, "status:", policy.status);

    const clearedRes = await client.query(
      "SELECT id, posted_date FROM payment_transactions WHERE policy_id = $1 AND status = $2 ORDER BY posted_date ASC LIMIT 1",
      [policy.id, "cleared"]
    );
    const hasCleared = clearedRes.rows.length > 0;
    const firstPaymentDate = hasCleared && clearedRes.rows[0].posted_date
      ? new Date(clearedRes.rows[0].posted_date).toISOString().split("T")[0]
      : null;

    if (!hasCleared && !force) {
      console.log("No cleared payment found for this policy. Nothing to repair. (Use --force to activate anyway.)");
      return;
    }

    if (policy.status === "active") {
      console.log("Policy is already active. No repair needed.");
      return;
    }

    const fromStatus = policy.status || "inactive";
    const effectiveDate = firstPaymentDate || (force ? new Date().toISOString().split("T")[0] : null);
    await client.query("BEGIN");

    if (!policy.inception_date && effectiveDate) {
      await client.query(
        "UPDATE policies SET status = $1, grace_end_date = NULL, inception_date = $2, effective_date = COALESCE(effective_date, $2) WHERE id = $3",
        ["active", effectiveDate, policy.id]
      );
    } else {
      await client.query(
        "UPDATE policies SET status = $1, grace_end_date = NULL WHERE id = $2",
        ["active", policy.id]
      );
    }

    const reason = fromStatus === "inactive"
      ? "First premium paid — conversion (repair)"
      : fromStatus === "grace"
        ? "Payment received (repair)"
        : "Reinstatement — payment received (repair)";
    await client.query(
      "INSERT INTO policy_status_history (policy_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)",
      [policy.id, fromStatus, "active", reason]
    );

    await client.query("COMMIT");
    console.log("✅ Policy updated to active. Inception/effective date set:", effectiveDate || policy.inception_date || "unchanged");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
