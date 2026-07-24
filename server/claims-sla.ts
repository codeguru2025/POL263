/**
 * Claims aging/SLA visibility. IPEC's own complaints data shows delayed claims settlement as the
 * insurance industry's single largest complaint category — this surfaces how long a claim has
 * been open so staff can act before it becomes a complaint, rather than after. Deliberately a
 * visibility layer only: it never blocks or auto-changes a claim's status.
 *
 * Pure/zero-side-effecting by design (same convention as tenant-billing-math.ts, pool-society.ts)
 * so it's trivially unit-testable.
 */

/** rejected/closed are the two terminal states in CLAIM_TRANSITIONS (client/src/pages/staff/
 *  claims.tsx) — a claim in either is done, aging no longer applies to it. */
const CLAIM_TERMINAL_STATUSES = new Set(["rejected", "closed"]);

/** Calendar days, not business days — a grieving family doesn't experience weekends as a pause. */
export const CLAIM_SLA_DAYS = 5;

export function computeClaimAgeDays(createdAt: Date | string, now: Date = new Date()): number {
  const created = new Date(createdAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - created) / (24 * 60 * 60 * 1000)));
}

export function isClaimOverdue(status: string, ageDays: number, slaDays: number = CLAIM_SLA_DAYS): boolean {
  if (CLAIM_TERMINAL_STATUSES.has(status)) return false;
  return ageDays > slaDays;
}

export interface ClaimAging {
  ageDays: number;
  isOverdue: boolean;
}

/** Enriches a claim (or any object with status + createdAt) with aging fields for API responses. */
export function withClaimAging<T extends { status: string; createdAt: Date | string }>(claim: T, now: Date = new Date()): T & ClaimAging {
  const ageDays = computeClaimAgeDays(claim.createdAt, now);
  return { ...claim, ageDays, isOverdue: isClaimOverdue(claim.status, ageDays) };
}
