/**
 * Resolves the raw foreign-key UUIDs inside audit_logs before/after JSON (removalDriverId,
 * clientId, policyId, ...) into human-readable labels for display — "Removal driver: e7e7f9d3-…"
 * reads as jargon to a non-technical reader; "Removal driver: Tendai Moyo" doesn't. Field-name-
 * rule-based (matches the existing "generic humanizer, no per-action lookup table" philosophy in
 * client/src/lib/audit-format.ts) rather than a hand-maintained per-action mapping, so a new
 * mutation route's audit log gets ID resolution for free as long as its field names follow the
 * same *Id/*By conventions the rest of the schema already uses.
 *
 * Returns a flat {uuid: label} map — collisions across different tables are exceedingly unlikely
 * within one tenant's audit log and the UI only ever does a value lookup, not a typed one, so a
 * flat map keeps both this resolver and the client-side formatter simple.
 */
import { inArray } from "drizzle-orm";
import type { OrgDataDb } from "./tenant-db";
import { users, clients, policies, branches, groups } from "@shared/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RefTable = "users" | "clients" | "policies" | "branches" | "groups";

/** Which table a before/after field name's UUID value refers to — order matters, first match wins. */
function tableForField(field: string): RefTable | null {
  if (field === "clientId") return "clients";
  if (field === "policyId") return "policies";
  if (field === "branchId") return "branches";
  if (field === "groupId") return "groups";
  // Actor-shaped fields: anyone who did/received/approved/was-assigned something is a staff user.
  // Covers removalDriverId, receivedByUserId, dispatchedByUserId, approvedBy, verifiedBy,
  // submittedBy, changedBy, recordedBy, paidByUserId, completedByUserId, takenOutByUserId,
  // receivedBackByUserId, agentId, assignedTo, userId, driverId, etc.
  if (/(By|UserId|DriverId)$/.test(field) || field === "agentId" || field === "assignedTo" || field === "userId") {
    return "users";
  }
  return null;
}

function collectRefIds(rows: { before?: unknown; after?: unknown }[]): Map<RefTable, Set<string>> {
  const byTable = new Map<RefTable, Set<string>>();
  const add = (table: RefTable, id: string) => {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(id);
  };
  for (const row of rows) {
    for (const payload of [row.before, row.after]) {
      if (!payload || typeof payload !== "object") continue;
      for (const [field, value] of Object.entries(payload as Record<string, unknown>)) {
        if (typeof value !== "string" || !UUID_RE.test(value)) continue;
        const table = tableForField(field);
        if (table) add(table, value);
      }
    }
  }
  return byTable;
}

export async function resolveAuditRefs(
  tdb: OrgDataDb,
  rows: { before?: unknown; after?: unknown }[]
): Promise<Record<string, string>> {
  const byTable = collectRefIds(rows);
  if (byTable.size === 0) return {};

  const refs: Record<string, string> = {};

  const usersIds = byTable.get("users");
  if (usersIds?.size) {
    const found = await tdb.select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users).where(inArray(users.id, Array.from(usersIds)));
    for (const u of found) refs[u.id] = u.displayName || u.email || u.id;
  }

  const clientIds = byTable.get("clients");
  if (clientIds?.size) {
    const found = await tdb.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
      .from(clients).where(inArray(clients.id, Array.from(clientIds)));
    for (const c of found) refs[c.id] = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.id;
  }

  const policyIds = byTable.get("policies");
  if (policyIds?.size) {
    const found = await tdb.select({ id: policies.id, policyNumber: policies.policyNumber })
      .from(policies).where(inArray(policies.id, Array.from(policyIds)));
    for (const p of found) refs[p.id] = p.policyNumber || p.id;
  }

  const branchIds = byTable.get("branches");
  if (branchIds?.size) {
    const found = await tdb.select({ id: branches.id, name: branches.name })
      .from(branches).where(inArray(branches.id, Array.from(branchIds)));
    for (const b of found) refs[b.id] = b.name || b.id;
  }

  const groupIds = byTable.get("groups");
  if (groupIds?.size) {
    const found = await tdb.select({ id: groups.id, name: groups.name })
      .from(groups).where(inArray(groups.id, Array.from(groupIds)));
    for (const g of found) refs[g.id] = g.name || g.id;
  }

  return refs;
}
