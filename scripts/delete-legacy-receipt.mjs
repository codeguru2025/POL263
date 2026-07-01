import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const [,, receiptNumber] = process.argv;
const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host, port: parseInt(parsed.port || "5432"),
  database: parsed.database, user: parsed.user, password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const r = await client.query(
  `DELETE FROM legacy_group_receipts WHERE receipt_number=$1 RETURNING group_name, currency, amount, receipt_number`,
  [receiptNumber]
);
if (r.rows[0]) console.log(`✓ DELETED ${r.rows[0].receipt_number} — ${r.rows[0].group_name} ${r.rows[0].currency} ${r.rows[0].amount}`);
else console.log("Not found: " + receiptNumber);
await client.end();
