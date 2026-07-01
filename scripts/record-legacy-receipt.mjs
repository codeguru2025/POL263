/**
 * Usage: node record-legacy-receipt.mjs <group_name_substring> <amount> <currency> <date YYYY-MM-DD>
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const [,, groupSearch, amount, currency, paymentDate] = process.argv;
const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179";

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host, port: parseInt(parsed.port || "5432"),
  database: parsed.database, user: parsed.user, password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const group = await client.query(
  `SELECT id, name FROM groups WHERE organization_id=$1 AND LOWER(name) LIKE $2 LIMIT 1`,
  [orgId, `%${groupSearch.toLowerCase()}%`]
);
if (!group.rows[0]) { console.error("Group not found: " + groupSearch); process.exit(1); }

// Generate receipt number: LGR-YYYYMMDD-NNN
const count = await client.query(`SELECT COUNT(*) FROM legacy_group_receipts WHERE organization_id=$1`, [orgId]);
const receiptNum = `LGR-${paymentDate.replace(/-/g,"")}-${String(parseInt(count.rows[0].count)+1).padStart(3,"0")}`;

const ins = await client.query(
  `INSERT INTO legacy_group_receipts (organization_id, group_id, group_name, receipt_number, amount, currency, payment_date)
   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
  [orgId, group.rows[0].id, group.rows[0].name, receiptNum, amount, currency, paymentDate]
);

// 2.5% platform fee, matching /api/groups/legacy-receipts
const fee = (parseFloat(amount) * 0.025).toFixed(2);
await client.query(
  `INSERT INTO platform_receivables (organization_id, amount, currency, description, is_settled)
   VALUES ($1, $2, $3, $4, false)`,
  [orgId, fee, currency.toUpperCase(), `2.5% on legacy group receipt ${ins.rows[0].receipt_number} (group ${ins.rows[0].group_name})`]
);

console.log(`✓ ${ins.rows[0].group_name} | ${ins.rows[0].currency} ${ins.rows[0].amount} | ${ins.rows[0].payment_date} | ${ins.rows[0].receipt_number} | fee ${fee}`);
await client.end();
