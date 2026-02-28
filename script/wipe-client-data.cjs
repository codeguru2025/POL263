/**
 * Wipe all client/policy/payment data while preserving:
 *   - organizations, branches
 *   - users, roles, permissions (and join tables)
 *   - products, product_versions, add_ons, benefit catalogs, age bands
 *   - commission_plans (but NOT ledger entries)
 *   - terms_and_conditions, feature_flags, notification_templates
 *   - fleet tables, price_book, cost sheets, payroll
 *   - sessions
 *
 * Run: DATABASE_URL=... node script/wipe-client-data.cjs
 *
 * ⚠️  THIS IS DESTRUCTIVE AND IRREVERSIBLE — back up first!
 */

const { Pool } = require("pg");
require("dotenv").config();

const connStr = process.env.DATABASE_URL || "";
const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.includes("sslmode=")
    ? { rejectUnauthorized: false }
    : undefined,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tables = [
      // leaf tables first (no dependents pointing at them)
      "settlement_allocations",
      "group_payment_allocations",
      "group_payment_intents",
      "approval_requests",
      "audit_logs",
      "notification_logs",
      "client_feedback",
      "leads",
      "expenditures",
      "chibikhulu_receivables",
      "settlements",
      "commission_ledger_entries",
      "cashups",
      "reversal_entries",
      "credit_notes",
      "policy_credit_balances",
      "month_end_runs",
      "payment_events",
      "payment_receipts",
      "payment_intents",
      "receipts",
      "payment_transactions",
      "policy_add_ons",
      "policy_status_history",
      "policy_members",
      "claim_documents",
      "claim_status_history",
      "claims",
      "funeral_tasks",
      "funeral_cases",
      "dependent_change_requests",
      "policies",
      "dependents",
      "client_device_tokens",
      "clients",
      "groups",
      // reset sequences so new data starts fresh
      "org_member_sequences",
      "org_policy_sequences",
    ];

    for (const table of tables) {
      const res = await client.query(`DELETE FROM "${table}"`);
      console.log(`  ✓ ${table}: ${res.rowCount} rows deleted`);
    }

    await client.query("COMMIT");
    console.log("\n✅ All client/policy/payment data wiped. Users & products preserved.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error — rolled back:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
