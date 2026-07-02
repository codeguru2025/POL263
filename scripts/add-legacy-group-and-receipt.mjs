/**
 * Create a new legacy group + record its receipt in one step.
 * Usage: node add-legacy-group-and-receipt.mjs <name> <amount> <currency> <date YYYY-MM-DD>
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const [,, groupName, amount, currency, paymentDate] = process.argv;
const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179";

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host, port: parseInt(parsed.port || "5432"),
  database: parsed.database, user: parsed.user, password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// Insert group as legacy
const grp = await client.query(
  `INSERT INTO groups (organization_id, name, type, is_legacy, is_active)
   VALUES ($1, $2, 'community', true, true)
   ON CONFLICT DO NOTHING
   RETURNING id, name`,
  [orgId, groupName.toUpperCase()]
);

let groupId, displayName;
if (grp.rows[0]) {
  groupId = grp.rows[0].id;
  displayName = grp.rows[0].name;
} else {
  // Already exists — fetch it
  const existing = await client.query(
    `SELECT id, name FROM groups WHERE organization_id=$1 AND LOWER(name)=LOWER($2)`,
    [orgId, groupName]
  );
  groupId = existing.rows[0].id;
  displayName = existing.rows[0].name;
}

// Receipt number
const count = await client.query(`SELECT COUNT(*) FROM legacy_group_receipts WHERE organization_id=$1`, [orgId]);
const receiptNum = `LGR-${paymentDate.replace(/-/g,"")}-${String(parseInt(count.rows[0].count)+1).padStart(3,"0")}`;

const ins = await client.query(
  `INSERT INTO legacy_group_receipts (organization_id, group_id, group_name, receipt_number, amount, currency, payment_date)
   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
  [orgId, groupId, displayName, receiptNum, amount, currency, paymentDate]
);

// 2.5% platform fee, matching /api/groups/legacy-receipts.
// created_at is pinned to the receipt's own payment date (not now()) so it lands
// in the right month on date-filtered platform-fee reports.
const fee = (parseFloat(amount) * 0.025).toFixed(2);
await client.query(
  `INSERT INTO platform_receivables (organization_id, amount, currency, description, is_settled, created_at)
   VALUES ($1, $2, $3, $4, false, $5::date + time '12:00')`,
  [orgId, fee, currency.toUpperCase(), `2.5% on legacy group receipt ${ins.rows[0].receipt_number} (group ${displayName})`, paymentDate]
);

console.log(`✓ ${ins.rows[0].group_name} | ${ins.rows[0].currency} ${ins.rows[0].amount} | ${ins.rows[0].payment_date} | ${ins.rows[0].receipt_number} | fee ${fee}`);
await client.end();
