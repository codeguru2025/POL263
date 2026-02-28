/**
 * Migration: Performance indexes + concurrency-safe sequence columns
 *
 * 1. Adds missing indexes on frequently queried columns
 * 2. Adds sequence columns for receipt/claim/case numbers (replaces COUNT-based generation)
 * 3. Adds version column to policies for optimistic concurrency control
 */
const pg = require("pg");
require("dotenv").config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase") || process.env.DB_ACCEPT_SELF_SIGNED === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

const statements = [
  // ─── Performance indexes ───────────────────────────────────

  // paymentTransactions: status lookups, paynow reference lookups
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS pt_status_idx ON payment_transactions (status)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS pt_paynow_ref_idx ON payment_transactions (paynow_reference) WHERE paynow_reference IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS pt_method_idx ON payment_transactions (payment_method)`,

  // clients: phone/email/nationalId lookups
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_phone_idx ON clients (phone) WHERE phone IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_email_idx ON clients (email) WHERE email IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_national_id_idx ON clients (national_id) WHERE national_id IS NOT NULL`,

  // policies: date range queries
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS policies_inception_idx ON policies (inception_date) WHERE inception_date IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS policies_effective_idx ON policies (effective_date) WHERE effective_date IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS policies_created_idx ON policies (created_at)`,

  // composite indexes for common query patterns
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS policies_org_status_idx ON policies (organization_id, status)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS pt_org_status_received_idx ON payment_transactions (organization_id, status, received_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS cle_agent_status_idx ON commission_ledger_entries (agent_id, status)`,

  // paymentIntents: paynow reference
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS pi_paynow_ref_idx ON payment_intents (paynow_reference) WHERE paynow_reference IS NOT NULL`,

  // commissionLedgerEntries: missing column indexes
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS cle_tx_idx ON commission_ledger_entries (transaction_id) WHERE transaction_id IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS cle_entry_type_idx ON commission_ledger_entries (entry_type)`,

  // sessions: faster session cleanup
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_expire_idx ON sessions (expire)`,

  // ─── Concurrency-safe sequences ────────────────────────────

  // Add receipt_next, claim_next, case_next, payment_receipt_next to org_policy_sequences
  `ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS receipt_next integer NOT NULL DEFAULT 0`,
  `ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS payment_receipt_next integer NOT NULL DEFAULT 0`,
  `ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS claim_next integer NOT NULL DEFAULT 0`,
  `ALTER TABLE org_policy_sequences ADD COLUMN IF NOT EXISTS case_next integer NOT NULL DEFAULT 0`,

  // ─── Optimistic concurrency control ────────────────────────

  // Version column on policies for concurrent update detection
  `ALTER TABLE policies ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`,
];

async function run() {
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      const short = stmt.substring(0, 80).replace(/\n/g, " ");
      try {
        await client.query(stmt);
        console.log(`OK: ${short}...`);
      } catch (err) {
        if (err.code === "42P07" || err.code === "42701") {
          console.log(`SKIP (already exists): ${short}...`);
        } else {
          console.error(`FAIL: ${short}...`, err.message);
        }
      }
    }

    // Backfill sequence values from current counts
    console.log("\nBackfilling sequence values...");
    await client.query(`
      UPDATE org_policy_sequences ops SET
        receipt_next = COALESCE((SELECT COUNT(*) FROM receipts r WHERE r.organization_id = ops.organization_id), 0),
        payment_receipt_next = COALESCE((SELECT COUNT(*) FROM payment_receipts pr WHERE pr.organization_id = ops.organization_id), 0),
        claim_next = COALESCE((SELECT COUNT(*) FROM claims c WHERE c.organization_id = ops.organization_id), 0),
        case_next = COALESCE((SELECT COUNT(*) FROM funeral_cases fc WHERE fc.organization_id = ops.organization_id), 0)
    `);
    console.log("OK: Backfilled sequence values from current counts");

    console.log("\nMigration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
