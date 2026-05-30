import { db } from "../server/db";

async function check() {
  const res = await db.execute("SELECT inet_server_addr() as host, inet_server_port() as port, current_database() as db");
  console.log("Registry DB:", res.rows[0]);
  
  await (db as any).end?.();
}

check().catch(e => console.error(e.message));
