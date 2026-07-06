/**
 * Record a cash funeral service that was performed but never receipted in the
 * system — creates a minimal funeral case + quotation + service receipt, all
 * dated to when the service actually happened (not today), plus its 2.5%
 * platform fee dated the same way, so monthly reports aren't distorted.
 *
 * Usage: node scripts/record-historical-service-receipt.mjs <deceasedName> <amount> <currency> <serviceDate YYYY-MM-DD> [description]
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const [,, deceasedName, amountArg, currencyArg, serviceDate, description] = process.argv;
const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179";
const THOKOZANI_ID = "e93a0b29-c830-4c74-a638-dc61ddb9be81"; // Thokozani Moyo — enters/receipts these in the system

if (!deceasedName || !amountArg || !currencyArg || !serviceDate) {
  console.error("Usage: node record-historical-service-receipt.mjs <deceasedName> <amount> <currency> <serviceDate YYYY-MM-DD> [description]");
  process.exit(1);
}

const amount = parseFloat(amountArg);
const currency = currencyArg.toUpperCase();
const desc = description || "Cash funeral service (historical entry)";

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

  // 1. Funeral case
  const caseSeq = await client.query(`
    INSERT INTO org_policy_sequences (organization_id, case_next) VALUES ($1, 1)
    ON CONFLICT (organization_id) DO UPDATE SET case_next = org_policy_sequences.case_next + 1
    RETURNING case_next
  `, [orgId]);
  const caseNumber = `FNC-${String(caseSeq.rows[0].case_next).padStart(6, "0")}`;
  const fc = await client.query(`
    INSERT INTO funeral_cases (organization_id, case_number, deceased_name, service_type, status, funeral_date, created_at)
    VALUES ($1, $2, $3, 'cash', 'completed', $4::date, $4::date + time '12:00')
    RETURNING id, case_number
  `, [orgId, caseNumber, deceasedName, serviceDate]);
  const funeralCaseId = fc.rows[0].id;

  // 2. Quotation (fully converted, single line item)
  const quoteSeq = await client.query(`
    INSERT INTO org_policy_sequences (organization_id, quotation_next) VALUES ($1, 1)
    ON CONFLICT (organization_id) DO UPDATE SET quotation_next = org_policy_sequences.quotation_next + 1
    RETURNING quotation_next
  `, [orgId]);
  const quotationNumber = `QUO-${String(quoteSeq.rows[0].quotation_next).padStart(6, "0")}`;
  const quote = await client.query(`
    INSERT INTO funeral_quotations
      (organization_id, funeral_case_id, quotation_number, currency, total, subtotal, vat_rate, vat_amount,
       discount_amount, grand_total, status, conversion_status, converted_at, quotation_date, deceased_name, created_at)
    VALUES ($1, $2, $3, $4, $5, $5, 0, 0, 0, $5, 'accepted', 'converted', $6::date + time '12:00', $6::date, $7, $6::date + time '12:00')
    RETURNING id, quotation_number
  `, [orgId, funeralCaseId, quotationNumber, currency, amount.toFixed(2), serviceDate, deceasedName]);
  const quotationId = quote.rows[0].id;

  await client.query(`
    INSERT INTO funeral_quotation_items (quotation_id, description, quantity, unit_price, line_total)
    VALUES ($1, $2, 1, $3, $3)
  `, [quotationId, desc, amount.toFixed(2)]);

  // 3. Service receipt
  const receiptSeq = await client.query(`
    INSERT INTO org_policy_sequences (organization_id, payment_receipt_next) VALUES ($1, 1)
    ON CONFLICT (organization_id) DO UPDATE SET payment_receipt_next = org_policy_sequences.payment_receipt_next + 1
    RETURNING payment_receipt_next
  `, [orgId]);
  const receiptNumber = String(receiptSeq.rows[0].payment_receipt_next);
  const receipt = await client.query(`
    INSERT INTO service_receipts
      (organization_id, funeral_case_id, quotation_id, receipt_number, amount, currency, payment_channel, issued_by_user_id, issued_at, status, notes, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'cash', $9, $7::date + time '12:00', 'issued', $8, $7::date + time '12:00')
    RETURNING id, receipt_number
  `, [orgId, funeralCaseId, quotationId, receiptNumber, amount.toFixed(2), currency, serviceDate, `Historical entry — service performed ${serviceDate}, receipted late.`, THOKOZANI_ID]);

  // 4. Platform fee (2.5%), dated to the service date like the corrected legacy-receipt fees
  const fee = (amount * 0.025).toFixed(2);
  await client.query(`
    INSERT INTO platform_receivables (organization_id, source_service_receipt_id, amount, currency, description, is_settled, created_at)
    VALUES ($1, $2, $3, $4, $5, false, $6::date + time '12:00')
  `, [orgId, receipt.rows[0].id, fee, currency, `2.5% on service receipt ${receiptNumber} (${deceasedName})`, serviceDate]);

  await client.query("COMMIT");
  console.log(`✓ Case ${caseNumber} | Quote ${quotationNumber} | Receipt ${receiptNumber} | ${currency} ${amount.toFixed(2)} | ${serviceDate} | fee ${fee}`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed, rolled back:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
