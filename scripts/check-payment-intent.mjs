import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const intentId = "fe51eae6-a575-4b88-bf8b-7c074d2a5000";
const r = await client.query(
  `SELECT id, status, amount, currency, purpose, method_selected, merchant_reference, paynow_reference, created_at, updated_at
   FROM payment_intents WHERE id=$1`,
  [intentId]
);
if (r.rows[0]) {
  console.log("Intent:", r.rows[0]);
} else {
  console.log("Intent not found in Falakhe DB");
  // Try checking by recent intents
  const recent = await client.query(
    `SELECT id, status, amount, currency, merchant_reference, created_at FROM payment_intents ORDER BY created_at DESC LIMIT 5`
  );
  console.log("Recent intents:", recent.rows);
}

await client.end();
