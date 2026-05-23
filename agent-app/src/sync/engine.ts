import { getDb } from "../db/schema";
import { apiGet, apiPost } from "../api";
import { API_BASE } from "../config";

export interface SyncStatus {
  pendingClients: number;
  pendingPolicies: number;
  lastSync: string | null;
  syncing: boolean;
  error: string | null;
}

let _syncing = false;
let _listeners: ((s: SyncStatus) => void)[] = [];

export function onSyncStatus(cb: (s: SyncStatus) => void) {
  _listeners.push(cb);
  return () => {
    _listeners = _listeners.filter((l) => l !== cb);
  };
}

async function notifyListeners() {
  const status = await getSyncStatus();
  _listeners.forEach((cb) => cb(status));
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const db = await getDb();
  const clients = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM clients WHERE synced = 0"
  );
  const policies = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM policies WHERE synced = 0"
  );
  const lastSync = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM sync_meta WHERE key = 'last_sync'"
  );
  return {
    pendingClients: clients?.count ?? 0,
    pendingPolicies: policies?.count ?? 0,
    lastSync: lastSync?.value ?? null,
    syncing: _syncing,
    error: null,
  };
}

/**
 * POST with conflict-aware error handling.
 * Returns { data, conflict } — if conflict is true, data comes from the error body.
 */
async function apiPostWithConflict<T = any>(
  path: string,
  body: any
): Promise<{ data: T; conflict: boolean }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok) return { data: json as T, conflict: false };

  // 409 = duplicate client (national ID already exists) — server sends existingClient
  if (res.status === 409 && json.existingClient) {
    return { data: json.existingClient as T, conflict: true };
  }
  // 400 with "Duplicate policy" — client already has this product
  if (res.status === 400 && json.error === "Duplicate policy") {
    throw new DuplicatePolicyError(json.message);
  }
  throw new Error(json.message || `${path} failed (${res.status})`);
}

class DuplicatePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicatePolicyError";
  }
}

/**
 * Push locally captured clients and policies to the server.
 * Clients sync first (policies depend on server client IDs).
 *
 * Conflict handling:
 * - Client 409 (duplicate national ID): Uses existing server client ID instead of failing.
 * - Policy "Duplicate policy" 400: Resolves by fetching the matching server policy.
 * - Network errors: Skips item, retries next sync cycle.
 */
export async function pushToServer(): Promise<{ synced: number; errors: string[] }> {
  if (_syncing) return { synced: 0, errors: ["Sync already in progress"] };
  _syncing = true;
  await notifyListeners();

  const db = await getDb();
  let synced = 0;
  const errors: string[] = [];

  try {
    // ── 1. Sync unsynced clients ──────────────────────────────────
    const unsyncedClients = await db.getAllAsync<{
      local_id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      email: string | null;
      national_id: string | null;
      date_of_birth: string | null;
      gender: string | null;
    }>("SELECT * FROM clients WHERE synced = 0 ORDER BY created_at ASC");

    for (const c of unsyncedClients) {
      try {
        const { data: serverClient, conflict } = await apiPostWithConflict("/api/clients", {
          firstName: c.first_name,
          lastName: c.last_name,
          phone: c.phone || undefined,
          email: c.email || undefined,
          nationalId: c.national_id || undefined,
          dateOfBirth: c.date_of_birth || undefined,
          gender: c.gender || undefined,
        });

        // Whether newly created or matched to existing, link the server ID
        await db.runAsync(
          "UPDATE clients SET server_id = ?, synced = 1, updated_at = datetime('now') WHERE local_id = ?",
          serverClient.id, c.local_id
        );
        synced++;

        if (conflict) {
          console.log(`Client ${c.first_name} ${c.last_name}: linked to existing (national ID match)`);
        }
      } catch (e: any) {
        errors.push(`Client ${c.first_name} ${c.last_name}: ${e.message}`);
      }
    }

    // ── 2. Sync unsynced policies ─────────────────────────────────
    const unsyncedPolicies = await db.getAllAsync<{
      local_id: string;
      client_local_id: string;
      client_server_id: string | null;
      product_version_id: string;
      premium_amount: string | null;
      currency: string;
      payment_schedule: string;
      effective_date: string | null;
      payment_method_type: string;
      payment_provider: string;
      payment_mobile_number: string | null;
      add_on_ids: string;
    }>("SELECT * FROM policies WHERE synced = 0 ORDER BY created_at ASC");

    for (const p of unsyncedPolicies) {
      try {
        // Resolve client server ID
        let clientServerId = p.client_server_id;
        if (!clientServerId) {
          const client = await db.getFirstAsync<{ server_id: string | null }>(
            "SELECT server_id FROM clients WHERE local_id = ?",
            p.client_local_id
          );
          clientServerId = client?.server_id ?? null;
        }
        if (!clientServerId) {
          errors.push(`Policy for client ${p.client_local_id}: client not yet synced — will retry`);
          continue;
        }

        const addOnIds = JSON.parse(p.add_on_ids || "[]");

        // Fetch dependents for this policy
        const deps = await db.getAllAsync<{
          first_name: string;
          last_name: string;
          relationship: string | null;
          national_id: string | null;
          date_of_birth: string | null;
          phone: string | null;
        }>("SELECT * FROM dependents WHERE policy_local_id = ?", p.local_id);

        const members = deps.map((d) => ({
          firstName: d.first_name,
          lastName: d.last_name,
          relationship: d.relationship || "dependent",
          nationalId: d.national_id || undefined,
          dateOfBirth: d.date_of_birth || undefined,
          phone: d.phone || undefined,
        }));

        try {
          const serverPolicy = await apiPost("/api/policies", {
            clientId: clientServerId,
            productVersionId: p.product_version_id,
            premiumAmount: p.premium_amount,
            currency: p.currency,
            paymentSchedule: p.payment_schedule,
            effectiveDate: p.effective_date || new Date().toISOString().split("T")[0],
            paymentMethod: {
              methodType: p.payment_method_type,
              provider: p.payment_provider,
              mobileNumber: p.payment_mobile_number || undefined,
            },
            addOnIds,
            members,
          });

          await db.runAsync(
            "UPDATE policies SET server_id = ?, policy_number = ?, status = ?, client_server_id = ?, synced = 1, updated_at = datetime('now') WHERE local_id = ?",
            serverPolicy.id, serverPolicy.policyNumber, serverPolicy.status, clientServerId, p.local_id
          );
          synced++;
        } catch (e: any) {
          if (e instanceof DuplicatePolicyError) {
            // Policy already exists on server for this client+product — resolve it
            const resolved = await resolveDuplicatePolicy(db, p.local_id, clientServerId, p.product_version_id);
            if (resolved) {
              synced++;
              console.log(`Policy ${p.local_id}: resolved duplicate — linked to server policy`);
            } else {
              errors.push(`Policy ${p.local_id}: duplicate on server but could not resolve`);
            }
          } else {
            throw e;
          }
        }
      } catch (e: any) {
        errors.push(`Policy ${p.local_id}: ${e.message}`);
      }
    }

    // ── 3. Flush offline document upload queue ───────────────────
    const pendingDocs = await db.getAllAsync<{
      id: number;
      client_server_id: string;
      document_type: string;
      label: string | null;
      file_uri: string;
      file_name: string;
      mime_type: string;
      retry_count: number;
    }>("SELECT * FROM document_upload_queue WHERE status = 'pending' ORDER BY created_at ASC");

    for (const doc of pendingDocs) {
      try {
        const formData = new FormData();
        formData.append("file", { uri: doc.file_uri, type: doc.mime_type || "image/jpeg", name: doc.file_name } as any);
        formData.append("documentType", doc.document_type);
        formData.append("label", doc.label || doc.file_name);
        const res = await fetch(`${API_BASE}/api/clients/${doc.client_server_id}/documents`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (res.ok) {
          await db.runAsync("UPDATE document_upload_queue SET status = 'done' WHERE id = ?", doc.id);
          synced++;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e: any) {
        const retries = doc.retry_count + 1;
        if (retries >= 5) {
          await db.runAsync(
            "UPDATE document_upload_queue SET status = 'error', error = ?, retry_count = ? WHERE id = ?",
            e.message, retries, doc.id
          );
        } else {
          await db.runAsync(
            "UPDATE document_upload_queue SET retry_count = ?, error = ? WHERE id = ?",
            retries, e.message, doc.id
          );
        }
        errors.push(`Doc upload (${doc.file_name}): ${e.message}`);
      }
    }

    // Update last sync time
    await db.runAsync(
      "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync', datetime('now'))"
    );
  } finally {
    _syncing = false;
    await notifyListeners();
  }

  return { synced, errors };
}

/**
 * When server says "Duplicate policy" (client already has this product),
 * fetch the agent's policies and find the matching one to link locally.
 */
async function resolveDuplicatePolicy(
  db: any,
  localId: string,
  clientServerId: string,
  productVersionId: string
): Promise<boolean> {
  try {
    const serverPolicies = await apiGet<any[]>("/api/policies?limit=500");
    const match = serverPolicies.find(
      (p: any) => p.clientId === clientServerId && p.productVersionId === productVersionId && p.status !== "cancelled"
    );
    if (match) {
      await db.runAsync(
        "UPDATE policies SET server_id = ?, policy_number = ?, status = ?, client_server_id = ?, synced = 1, updated_at = datetime('now') WHERE local_id = ?",
        match.id, match.policyNumber, match.status, clientServerId, localId
      );
      return true;
    }
  } catch {
    // Could not resolve
  }
  return false;
}

/**
 * Pull latest data from server to cache for offline browsing.
 */
export async function pullFromServer(): Promise<void> {
  const db = await getDb();

  try {
    // Cache products
    const products = await apiGet<any[]>("/api/products");
    for (const p of products) {
      await db.runAsync(
        "INSERT OR REPLACE INTO cache_products (id, data, updated_at) VALUES (?, ?, datetime('now'))",
        p.id, JSON.stringify(p)
      );
    }

    // Cache product versions
    const versions = await apiGet<any[]>("/api/product-versions");
    for (const v of versions) {
      await db.runAsync(
        "INSERT OR REPLACE INTO cache_product_versions (id, product_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))",
        v.id, v.productId, JSON.stringify(v)
      );
    }

    // Cache add-ons
    const addOns = await apiGet<any[]>("/api/add-ons");
    for (const a of addOns) {
      await db.runAsync(
        "INSERT OR REPLACE INTO cache_add_ons (id, data, updated_at) VALUES (?, ?, datetime('now'))",
        a.id, JSON.stringify(a)
      );
    }

    // Cache my policies (agent-scoped by server RBAC)
    const policies = await apiGet<any[]>("/api/policies?limit=500");
    await db.runAsync("DELETE FROM cache_my_policies");
    for (const p of policies) {
      await db.runAsync(
        "INSERT OR REPLACE INTO cache_my_policies (id, data, updated_at) VALUES (?, ?, datetime('now'))",
        p.id, JSON.stringify(p)
      );
    }

    // Cache my clients (agent-scoped by server RBAC)
    const clients = await apiGet<any[]>("/api/clients?limit=500");
    await db.runAsync("DELETE FROM cache_my_clients");
    for (const c of clients) {
      await db.runAsync(
        "INSERT OR REPLACE INTO cache_my_clients (id, data, updated_at) VALUES (?, ?, datetime('now'))",
        c.id, JSON.stringify(c)
      );
    }

    // Cache my leads (agent-scoped by server RBAC)
    try {
      const leads = await apiGet<any[]>("/api/leads?limit=500");
      await db.runAsync("DELETE FROM cache_my_leads");
      for (const l of leads) {
        await db.runAsync(
          "INSERT OR REPLACE INTO cache_my_leads (id, data, updated_at) VALUES (?, ?, datetime('now'))",
          l.id, JSON.stringify(l)
        );
      }
    } catch { /* leads permission may not exist */ }

    // Cache my commissions (agent-scoped by server RBAC)
    try {
      const commissions = await apiGet<any[]>("/api/commission-ledger?limit=500");
      await db.runAsync("DELETE FROM cache_my_commissions");
      for (const c of commissions) {
        await db.runAsync(
          "INSERT OR REPLACE INTO cache_my_commissions (id, data, updated_at) VALUES (?, ?, datetime('now'))",
          c.id, JSON.stringify(c)
        );
      }
    } catch { /* commission permission may not exist */ }

    // Cache my payments (agent-scoped by server RBAC)
    try {
      const payments = await apiGet<any[]>("/api/payments?limit=500");
      await db.runAsync("DELETE FROM cache_my_payments");
      for (const p of payments) {
        await db.runAsync(
          "INSERT OR REPLACE INTO cache_my_payments (id, data, updated_at) VALUES (?, ?, datetime('now'))",
          p.id, JSON.stringify(p)
        );
      }
    } catch { /* payments permission may not exist */ }

    await db.runAsync(
      "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_pull', datetime('now'))"
    );
  } catch (e: any) {
    console.warn("Pull from server failed:", e.message);
  }
}

/**
 * Full sync: push local changes, then pull latest data.
 */
export async function fullSync(): Promise<{ synced: number; errors: string[] }> {
  const result = await pushToServer();
  await pullFromServer();
  return result;
}
