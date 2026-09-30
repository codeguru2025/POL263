/**
 * Policies whose policyholder has died (an approved death claim marked their member row
 * "claimed") and no new holder has been chosen yet via POST /api/policies/:id/change-policyholder.
 *
 * Until someone takes the policy over there is nobody to bill: the lapse sweep must not push it
 * into grace/lapse, and premium-due / about-to-lapse texts would go to a dead person's phone.
 * The pause ends by itself the moment a new holder is chosen (the policy's clientId moves to the
 * new holder, whose member row isn't "claimed") — any cycle that fell due meanwhile is then
 * owed by the new holder through the normal due/grace flow.
 */
import { sql } from "drizzle-orm";
import type { OrgDataDb } from "./tenant-db";

const rowsOf = <T>(r: unknown): T[] => (((r as any).rows ?? r) as T[]);

export async function getPoliciesAwaitingNewHolder(tdb: OrgDataDb, orgId: string): Promise<Set<string>> {
  const r = await tdb.execute(sql`
    SELECT DISTINCT p.id
    FROM policies p
    JOIN policy_members pm ON pm.policy_id = p.id AND pm.client_id = p.client_id
    WHERE p.organization_id = ${orgId}
      AND pm.role = 'policy_holder'
      AND pm.claim_status = 'claimed'
  `);
  return new Set(rowsOf<{ id: string }>(r).map((x) => x.id));
}

/** Clients recorded as deceased on any policy (as holder, or a former holder) — no birthday or
 *  anniversary greetings to them. */
export async function getDeceasedClientIds(tdb: OrgDataDb, orgId: string): Promise<Set<string>> {
  const r = await tdb.execute(sql`
    SELECT DISTINCT pm.client_id AS id
    FROM policy_members pm
    WHERE pm.organization_id = ${orgId}
      AND pm.client_id IS NOT NULL
      AND pm.claim_status = 'claimed'
  `);
  return new Set(rowsOf<{ id: string }>(r).map((x) => x.id));
}
