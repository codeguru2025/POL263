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

for (const t of ["add_ons", "fleet_vehicles", "product_add_ons", "vehicles"]) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t]
  );
  if (r.rows.length) {
    console.log(`${t}: ${r.rows.map(x => x.column_name).join(", ")}`);
  } else {
    console.log(`${t}: DOES NOT EXIST`);
  }
}

await client.end();
