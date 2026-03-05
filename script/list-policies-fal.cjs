require("dotenv").config();
const { Pool } = require("pg");
const connStr = process.env.DATABASE_URL || "";
const acceptSelfSigned = process.env.DB_ACCEPT_SELF_SIGNED === "true" || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";
const pool = new Pool({ connectionString: connStr, ...(acceptSelfSigned && { ssl: { rejectUnauthorized: false } }) });
pool.query("SELECT policy_number, status FROM policies WHERE policy_number ILIKE $1", ["%FAL%"])
  .then((r) => { console.log(r.rows); pool.end(); })
  .catch((e) => { console.error(e.message); pool.end(); process.exit(1); });
