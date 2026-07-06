/**
 * Every "paid" requisition should have a matching payment_disbursements row
 * (the canonical cash-out ledger that feeds the income statement / cash flow).
 * None exist yet for Falakhe — this creates one per paid requisition that's
 * missing one, dated to the requisition's own paid_date.
 *
 * Usage: node scripts/backfill-requisition-disbursements.mjs
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179";

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host, port: parseInt(parsed.port || "5432"),
  database: parsed.database, user: parsed.user, password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  await client.query("BEGIN");

  const rows = await client.query(`
    SELECT r.id, r.requisition_number, r.branch_id, r.amount, r.currency, r.paid_by, r.paid_date,
           r.payment_method, r.reference, r.received_by, r.received_by_user_id
    FROM requisitions r
    WHERE r.organization_id = $1 AND r.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM payment_disbursements pd WHERE pd.entity_type = 'requisition' AND pd.entity_id = r.id
      )
  `, [orgId]);

  let created = 0;
  for (const r of rows.rows) {
    const voucherSeq = await client.query(`
      INSERT INTO org_policy_sequences (organization_id, disbursement_next) VALUES ($1, 1)
      ON CONFLICT (organization_id) DO UPDATE SET disbursement_next = org_policy_sequences.disbursement_next + 1
      RETURNING disbursement_next
    `, [orgId]);
    const voucherNumber = `PV-${String(voucherSeq.rows[0].disbursement_next).padStart(5, "0")}`;

    await client.query(`
      INSERT INTO payment_disbursements
        (organization_id, branch_id, entity_type, entity_id, amount, currency, paid_by_user_id,
         received_by, received_by_user_id, paid_date, payment_method, reference, voucher_number, created_by_user_id)
      VALUES ($1, $2, 'requisition', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $6)
    `, [
      orgId, r.branch_id, r.id, r.amount, r.currency, r.paid_by,
      r.received_by, r.received_by_user_id, r.paid_date, r.payment_method || "cash", r.reference, voucherNumber,
    ]);
    created++;
  }

  await client.query("COMMIT");
  console.log(`Created ${created} disbursement records for paid requisitions missing one.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed, rolled back:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
