import * as SQLite from "expo-sqlite";

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync("pol263_agent.db");
  await _db.execAsync("PRAGMA journal_mode = WAL;");
  await _db.execAsync("PRAGMA foreign_keys = ON;");
  await initSchema(_db);
  return _db;
}

async function initSchema(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    -- Locally captured clients (pending sync or synced)
    CREATE TABLE IF NOT EXISTS clients (
      local_id TEXT PRIMARY KEY,
      server_id TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      national_id TEXT,
      date_of_birth TEXT,
      gender TEXT,
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Locally captured policies (pending sync or synced)
    CREATE TABLE IF NOT EXISTS policies (
      local_id TEXT PRIMARY KEY,
      server_id TEXT,
      client_local_id TEXT NOT NULL,
      client_server_id TEXT,
      product_version_id TEXT NOT NULL,
      product_name TEXT,
      premium_amount TEXT,
      currency TEXT DEFAULT 'USD',
      payment_schedule TEXT DEFAULT 'monthly',
      effective_date TEXT,
      payment_method_type TEXT DEFAULT 'mobile',
      payment_provider TEXT DEFAULT 'ecocash',
      payment_mobile_number TEXT,
      policy_number TEXT,
      status TEXT DEFAULT 'pending_sync',
      add_on_ids TEXT DEFAULT '[]',
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_local_id) REFERENCES clients(local_id)
    );

    -- Dependents for policies
    CREATE TABLE IF NOT EXISTS dependents (
      local_id TEXT PRIMARY KEY,
      policy_local_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      relationship TEXT,
      national_id TEXT,
      date_of_birth TEXT,
      phone TEXT,
      synced INTEGER DEFAULT 0,
      FOREIGN KEY (policy_local_id) REFERENCES policies(local_id)
    );

    -- Sync queue for tracking operations to replay
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_local_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Cache of server data for offline browsing
    CREATE TABLE IF NOT EXISTS cache_products (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cache_product_versions (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cache_add_ons (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Synced server policies/clients for browsing
    CREATE TABLE IF NOT EXISTS cache_my_policies (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cache_my_clients (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Cached server leads
    CREATE TABLE IF NOT EXISTS cache_my_leads (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Cached commission ledger entries
    CREATE TABLE IF NOT EXISTS cache_my_commissions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Cached payment transactions
    CREATE TABLE IF NOT EXISTS cache_my_payments (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Offline document upload queue (flushed during push when online)
    CREATE TABLE IF NOT EXISTS document_upload_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_server_id TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'other',
      label TEXT,
      file_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT DEFAULT 'image/jpeg',
      status TEXT DEFAULT 'pending',
      error TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Cached client documents from server
    CREATE TABLE IF NOT EXISTS cache_client_documents (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Last sync timestamps
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}
