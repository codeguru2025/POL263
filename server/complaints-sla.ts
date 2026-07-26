/**
 * Complaint aging/SLA visibility — same purpose and shape as claims-sla.ts, for the same reason:
 * IPEC's consumer-protection expectations (and the 2026-07-26 compliance review) flag "no SLA on
 * complaints handling" as a named gap. Deliberately a visibility layer only: it never blocks or
 * auto-changes a complaint's status.
 *
 * COMPLAINT_SLA_DAYS is a sensible platform default, not a figure lifted from an IPEC filing — no
 * complaint-specific turnaround time was found published. Tenants operating under a license
 * condition that specifies a different number should treat this as adjustable, not authoritative.
 *
 * Pure/zero-side-effecting by design (same convention as claims-sla.ts) so it's trivially
 * unit-testable.
 */

/** resolved/closed are the terminal states (see client/src/pages/staff/feedback.tsx's STATUSES) —
 *  a complaint in either is done, aging no longer applies to it. */
const COMPLAINT_TERMINAL_STATUSES = new Set(["resolved", "closed"]);

export const COMPLAINT_SLA_DAYS = 14;

export function computeComplaintAgeDays(createdAt: Date | string, now: Date = new Date()): number {
  const created = new Date(createdAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - created) / (24 * 60 * 60 * 1000)));
}

export function isComplaintOverdue(status: string, ageDays: number, slaDays: number = COMPLAINT_SLA_DAYS): boolean {
  if (COMPLAINT_TERMINAL_STATUSES.has(status)) return false;
  return ageDays > slaDays;
}

export interface ComplaintAging {
  ageDays: number;
  isOverdue: boolean;
}

/** Enriches a feedback/complaint row (or any object with status + createdAt) with aging fields
 *  for API responses. */
export function withComplaintAging<T extends { status: string; createdAt: Date | string }>(item: T, now: Date = new Date()): T & ComplaintAging {
  const ageDays = computeComplaintAgeDays(item.createdAt, now);
  return { ...item, ageDays, isOverdue: isComplaintOverdue(item.status, ageDays) };
}
