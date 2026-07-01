import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const parsed = parse(process.env.DATABASE_URL);
const client = new Client({
  host: parsed.host,
  port: parseInt(parsed.port || "5432"),
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const falakheOrgId = "4eadab0e-c61b-40ee-b511-1243e9790179";
const returnUrl = "https://falakhe.pol263.com/client/payments/return";
const resultUrl = `https://falakhe.pol263.com/api/payments/paynow/result?org=${falakheOrgId}`;

const res = await client.query(
  `UPDATE organizations SET paynow_return_url = $1, paynow_result_url = $2 WHERE id = $3
   RETURNING id, name, paynow_return_url, paynow_result_url`,
  [returnUrl, resultUrl, falakheOrgId]
);
console.log("Updated:", res.rows[0]);

await client.end();
