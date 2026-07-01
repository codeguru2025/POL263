import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();
const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host, port: parseInt(parsed.port || "5432"), database: parsed.database,
  user: parsed.user, password: parsed.password, ssl: { rejectUnauthorized: false },
});
await client.connect();
const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179";

const receipts = await client.query(
  `SELECT id, receipt_number, group_name, amount, currency FROM legacy_group_receipts WHERE organization_id = $1 ORDER BY payment_date`,
  [orgId]
);

let count = 0;
const totals = {};
for (const r of receipts.rows) {
  const fee = (parseFloat(r.amount) * 0.025).toFixed(2);
  await client.query(
    `INSERT INTO platform_receivables (organization_id, amount, currency, description, is_settled)
     VALUES ($1, $2, $3, $4, false)`,
    [orgId, fee, r.currency, `2.5% on legacy group receipt ${r.receipt_number} (group ${r.group_name}) [backfilled]`]
  );
  totals[r.currency] = (totals[r.currency] || 0) + parseFloat(fee);
  count++;
}

console.log(`Backfilled ${count} platform_receivable rows.`);
console.log("Totals added:", totals);
await client.end();
