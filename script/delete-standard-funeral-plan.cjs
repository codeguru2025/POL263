/**
 * Delete the product "Standard Funeral Plan" (code SFP-001).
 * Run: node script/delete-standard-funeral-plan.cjs
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
    const r = await client.query(
      "SELECT id, name, code FROM products WHERE code = $1 OR name ILIKE $2",
      ["SFP-001", "Standard Funeral Plan"]
    );
    if (r.rows.length === 0) {
      console.log("Product 'Standard Funeral Plan' (SFP-001) not found.");
      return;
    }
    const productId = r.rows[0].id;
    console.log("Deleting product:", r.rows[0].name, "(" + r.rows[0].code + ")");

    await client.query("BEGIN");
    const v = await client.query("DELETE FROM product_versions WHERE product_id = $1", [productId]);
    console.log("  product_versions deleted:", v.rowCount);
    await client.query("DELETE FROM products WHERE id = $1", [productId]);
    console.log("  product deleted.");
    await client.query("COMMIT");
    console.log("✅ Done.");
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
