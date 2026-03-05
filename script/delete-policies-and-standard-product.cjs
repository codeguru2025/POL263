/**
 * Delete all policies and the product named "standard" (case-insensitive).
 * Uses DATABASE_URL. Run: node script/delete-policies-and-standard-product.cjs
 *
 * ⚠️  DESTRUCTIVE — back up first!
 */
require("dotenv").config();
const { Pool } = require("pg");

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
    await client.query("BEGIN");

    const policyDependentTables = [
      "settlement_allocations",
      "group_payment_allocations",
      "commission_ledger_entries",
      "cashups",
      "reversal_entries",
      "credit_notes",
      "policy_credit_balances",
      "payment_events",
      "payment_receipts",
      "payment_intents",
      "receipts",
      "platform_receivables",
      "payment_transactions",
      "policy_add_ons",
      "policy_status_history",
      "policy_members",
      "claim_documents",
      "claim_status_history",
      "claims",
      "funeral_tasks",
      "funeral_cases",
      "policies",
    ];

    console.log("Deleting policy-dependent rows and policies...");
    for (const table of policyDependentTables) {
      const res = await client.query(`DELETE FROM "${table}"`);
      console.log(`  ✓ ${table}: ${res.rowCount} rows deleted`);
    }

    const standardProductIds = await client.query(
      `SELECT id FROM products WHERE name ILIKE 'standard'`
    );
    if (standardProductIds.rows.length > 0) {
      const delVersions = await client.query(
        `DELETE FROM product_versions WHERE product_id IN (SELECT id FROM products WHERE name ILIKE 'standard')`
      );
      console.log(`  ✓ product_versions (for standard): ${delVersions.rowCount} rows deleted`);
      const delProducts = await client.query(
        `DELETE FROM products WHERE name ILIKE 'standard'`
      );
      console.log(`  ✓ products (standard): ${delProducts.rowCount} rows deleted`);
    } else {
      console.log("  (no product named 'standard' found)");
    }

    await client.query("COMMIT");
    console.log("\n✅ Done: all policies and product 'standard' removed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error — rolled back:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
