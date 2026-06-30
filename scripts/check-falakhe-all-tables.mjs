import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = ["policies", "groups", "requisitions", "expenditures", "payment_receipts", "payment_intents", "payment_events", "org_policy_sequences"];
for (const t of tables) {
  const r = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position
  `, [t]);
  console.log(`\n${t}: ${r.rows.map(x => x.column_name).join(", ")}`);
}

await client.end();
