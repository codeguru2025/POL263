/**
 * One-off catch-up: advance requisitions that were raised on paper, entered
 * into the system by Thokozani, but never advanced past "submitted" (or
 * "approved") even though they were, in reality, already approved and paid.
 * Also assigns a best-effort department classification and flags special
 * cost centers (CEO personal expenses, South Africa branch operations).
 *
 * Usage: node scripts/backfill-requisition-workflow.mjs
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179";
const THOKOZANI_ID = "e93a0b29-c830-4c74-a638-dc61ddb9be81";
const AUGUSTUS_ID = "246f0697-48ad-417b-9cd5-7e641f55c3d6";

function classifyDepartment(category, description, payee) {
  const text = `${category} ${description} ${payee}`.toUpperCase();
  if (text.includes("MARKETING") || text.includes("LIVE STREAMING")) return "Marketing & Client Services";
  if (payee?.toUpperCase() === "CEO" || text.includes(" CEO")) return "Executive / CEO";
  if (/FUEL|MECHANIC|\bOIL\b|BRAKE|TYRE|TIRE|WHEEL|TOLLGATE|TOLL GATE|BUS HIRE|KOMBI|TRAILER|TRANSPORT FARE|BOLT|NUT|NASH|DISHWASHING|HEARSE|BUS FARE/.test(text)) return "Transport & Fleet";
  if (/COFFIN|SUPER GLUE|FOIL|VANISH|C\/COAT|THINNER|GLOVES|\bBABY\b|MORTICIAN/.test(text)) return "Mortuary & Embalming";
  if (/SALARY|ALLOWANCE|ALLOWENCE|OVERNIGHT|\bPAY\b|WAGES/.test(text)) return "Payroll & Staff Welfare";
  if (/ZESA|ELECTRICITY/.test(text)) return "Utilities";
  if (/POLICE|COUNCIL|CERTIFICATE|LICENSE|REGISTRATION/.test(text)) return "Regulatory & Compliance";
  if (/AIRTIME|\bDATA\b|CALLS|MINUTES|\bPENS\b|STATIONERY/.test(text)) return "Administration";
  if (/LAPTOP|COMPUTER|EQUIPMENT/.test(text)) return "IT & Equipment";
  if (/\bTENT\b/.test(text)) return "Funeral Logistics";
  if (/LUNCH|MINERAL WATER|GROCERY/.test(text)) return "Welfare & Hospitality";
  return "Operations — General";
}

// Requisitions explicitly confirmed as South-Africa-related (2026-07-03) —
// more may be added once the owner shares an Excel list of the rest.
const CONFIRMED_SA_REQUISITIONS = new Set(["REQ-MR0U59J9", "REQ-00071"]);

function classifyCostFlag(requisitionNumber, category, description, payee) {
  const text = `${category} ${description} ${payee}`.toUpperCase();
  if (text.includes("MABHENA")) return "CEO_PERSONAL";
  if (CONFIRMED_SA_REQUISITIONS.has(requisitionNumber)) return "SOUTH_AFRICA";
  return null;
}

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
    SELECT id, requisition_number, category, description, payee, amount, currency, status,
           COALESCE(raised_date, created_at::date) AS effective_date
    FROM requisitions
    WHERE organization_id = $1
  `, [orgId]);

  let advanced = 0;
  let classified = 0;
  let flagged = [];

  for (const r of rows.rows) {
    const department = classifyDepartment(r.category, r.description, r.payee);
    const costFlag = classifyCostFlag(r.requisition_number, r.category, r.description, r.payee);
    if (costFlag) flagged.push({ number: r.requisition_number, costFlag, amount: r.amount, currency: r.currency, description: r.description });

    if (r.status === "submitted" || r.status === "approved") {
      await client.query(`
        UPDATE requisitions
        SET status = 'paid',
            approved_by = $2,
            approved_at = COALESCE(approved_at, $3::date + time '09:00'),
            paid_by = $4,
            paid_at = $3::date + time '17:00',
            paid_date = $3::date,
            payment_method = COALESCE(payment_method, 'cash'),
            amount_paid = amount,
            department = $5,
            cost_flag = $6
        WHERE id = $1
      `, [r.id, AUGUSTUS_ID, r.effective_date, THOKOZANI_ID, department, costFlag]);
      advanced++;
    } else {
      // Already paid — just add department/cost-flag classification, don't touch workflow fields.
      await client.query(`UPDATE requisitions SET department = $2, cost_flag = $3 WHERE id = $1`, [r.id, department, costFlag]);
    }
    classified++;
  }

  await client.query("COMMIT");
  console.log(`Advanced ${advanced} requisitions to 'paid' (approved_by=Augustus, paid_by=Thokozani).`);
  console.log(`Classified department on ${classified} requisitions total.`);
  console.log(`Cost-flagged requisitions:`, JSON.stringify(flagged, null, 2));
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed, rolled back:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
