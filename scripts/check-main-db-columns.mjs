import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const cols = await client.query(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'requisitions' AND column_name IN ('raised_date','needed_by_date','approver_notes','requisition_number'))
      OR (table_name = 'expenditures' AND column_name IN ('status','amount_paid','paid_date'))
      OR (table_name = 'groups' AND column_name IN ('is_legacy'))
      OR (table_name = 'policies' AND column_name IN ('is_legacy','grace_used_days','deleted_at'))
      OR (table_name = 'payment_receipts' AND column_name IN ('approval_status','is_backdated'))
      OR (table_name = 'payment_disbursements' AND column_name IN ('voucher_number'))
    )
  ORDER BY table_name, column_name
`);
console.log("Key columns in MAIN DB:");
console.table(cols.rows);

const tables = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('payment_disbursements','requisition_items','receipt_adverts','attendance_logs','parlour_personnel','payment_events')
  ORDER BY table_name
`);
console.log("Table existence in MAIN DB:");
console.table(tables.rows);

await client.end();
