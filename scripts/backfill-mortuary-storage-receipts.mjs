// One-time backfill: 25 mortuary storage-fee payments on Falakhe's tenant DB were recorded via
// POST /api/mortuary-intakes/:id/storage-payment before that route created a service_receipts
// row (fixed in server/routes.ts). Without a receipt, queryReceipts() in financial-statements.ts
// never counted this income, so it never appeared in the income statement / daily report.
// This script issues the missing receipts, backdated to the actual payment date, so historical
// reports become correct. Idempotent: skips any intake that already has a matching backfilled
// receipt (metadata_json->>'mortuaryIntakeId').
import { parse } from 'pg-connection-string';
import { Client } from 'pg';

const ORG_ID = '4eadab0e-c61b-40ee-b511-1243e9790179'; // Falakhe Funeral Services
const AUGUSTUS_TENANT_USER_ID = '246f0697-48ad-417b-9cd5-7e641f55c3d6';

const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host, port: parseInt(parsed.port || '5432'),
  database: parsed.database, user: parsed.user, password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const intakes = await client.query(`
  select id, deceased_name, storage_fee_amount, storage_fee_currency, storage_fee_status,
         storage_fee_paid_at, storage_fee_paid_by, funeral_case_id, branch_id
  from mortuary_intakes where storage_fee_status != 'unpaid' order by storage_fee_paid_at
`);

let created = 0, skipped = 0;
for (const intake of intakes.rows) {
  const existing = await client.query(
    `select id from service_receipts where organization_id = $1 and metadata_json->>'mortuaryIntakeId' = $2`,
    [ORG_ID, intake.id]
  );
  if (existing.rows.length) { skipped++; continue; }

  const audit = await client.query(
    `select actor_id from audit_logs where action='RECORD_STORAGE_PAYMENT' and entity_id = $1 order by timestamp desc limit 1`,
    [intake.id]
  );
  const issuedByUserId = audit.rows[0]?.actor_id ?? AUGUSTUS_TENANT_USER_ID;

  await client.query('BEGIN');
  try {
    const seq = await client.query(`
      INSERT INTO org_policy_sequences (organization_id, payment_receipt_next) VALUES ($1, 1)
      ON CONFLICT (organization_id) DO UPDATE SET payment_receipt_next = org_policy_sequences.payment_receipt_next + 1
      RETURNING payment_receipt_next
    `, [ORG_ID]);
    const receiptNumber = String(seq.rows[0].payment_receipt_next);

    const statusLabel = intake.storage_fee_status === 'paid_at_admission' ? 'paid at admission' : 'paid at collection';
    const receipt = await client.query(`
      INSERT INTO service_receipts (
        organization_id, branch_id, funeral_case_id, quotation_id, receipt_number,
        amount, currency, payment_channel, issued_by_user_id, issued_at, status,
        idempotency_key, notes, metadata_json
      ) VALUES ($1,$2,$3,NULL,$4,$5,$6,'cash',$7,$8,'issued',NULL,$9,$10)
      RETURNING id, receipt_number
    `, [
      ORG_ID, intake.branch_id, intake.funeral_case_id, receiptNumber,
      intake.storage_fee_amount, intake.storage_fee_currency || 'USD', issuedByUserId,
      intake.storage_fee_paid_at,
      `Mortuary storage fee — ${intake.deceased_name} (${statusLabel}) [backfilled]`,
      JSON.stringify({ backfill: true, mortuaryIntakeId: intake.id, backfilledAt: new Date().toISOString() }),
    ]);

    await client.query(`
      INSERT INTO audit_logs (organization_id, actor_id, actor_email, action, entity_type, entity_id, before, after)
      VALUES ($1, $2, 'system-backfill@pol263.internal', 'BACKFILL_SERVICE_RECEIPT', 'ServiceReceipt', $3, NULL, $4)
    `, [ORG_ID, issuedByUserId, receipt.rows[0].id, JSON.stringify({ receiptId: receipt.rows[0].id, mortuaryIntakeId: intake.id, amount: intake.storage_fee_amount, currency: intake.storage_fee_currency })]);

    await client.query('COMMIT');
    console.log(`Created receipt #${receipt.rows[0].receipt_number} for ${intake.deceased_name} — ${intake.storage_fee_amount} ${intake.storage_fee_currency} (${intake.storage_fee_paid_at.toISOString().slice(0,10)})`);
    created++;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`FAILED for intake ${intake.id} (${intake.deceased_name}):`, e.message);
    throw e;
  }
}

console.log(`\nDone. Created ${created} receipts, skipped ${skipped} already-backfilled.`);
await client.end();
