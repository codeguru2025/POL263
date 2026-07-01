import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host,
  port: parseInt(parsed.port || "5432"),
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const tables = ["payment_events", "payment_receipts", "payment_intents", "policies", "organizations"];
for (const t of tables) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t]
  );
  console.log(`${t}:\n  ${r.rows.map(x => x.column_name).join(", ")}\n`);
}

// Check the status of intent 96740ab6
const intent = await client.query(
  `SELECT id, status, method_selected, created_at FROM payment_intents WHERE id LIKE '96740ab6%'`
);
if (intent.rows.length) {
  console.log("Intent 96740ab6...:", intent.rows[0]);
} else {
  console.log("Intent 96740ab6... not found in Falakhe DB");
}

await client.end();
