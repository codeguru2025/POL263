/**
 * Reports → Policies → Policies Awaiting Payments: the premium due list. Pure — no DB.
 *
 * Works from each policy's paid-up-to date (policies.currentCycleEnd), not from inception: the
 * next payment is due the day after it. Inception-based arrears (computePolicyOutstanding) would
 * count every period since a migrated policy started, even though those were paid in the old
 * system before POL263 existed.
 *
 * Buckets:
 *  - due: individual policies overdue or due within the window, soonest first.
 *  - undated: individual policies with no paid-up-to date — the lapse sweep can't see them, so
 *    they're flagged for staff (migrated policies whose date never came across, and a few paid
 *    before the old receipt path set it).
 *  - group policies are left out here — they're paid through the group's lump sums and summarised
 *    per group by the caller.
 */
import { toCents, fromCents, mulCents } from "@shared/money";
import { periodsBetween } from "./policy-outstanding";
import { monthlyToScheduleFactor } from "./policy-overview";

export interface DueListInput {
  policyId: string;
  groupId?: string | null;
  status: string;
  premiumAmount: string | number | null;
  paymentSchedule?: string | null;
  /** Last covered day, "YYYY-MM-DD" — empty/null when unknown. */
  paidUpTo?: string | null;
}

export interface DueInfo {
  /** First unpaid day, "YYYY-MM-DD". */
  dueDate: string;
  /** Negative = overdue by that many days; 0 = due today. */
  daysUntilDue: number;
  /** Premiums owed now: 1 if not yet overdue, else every cycle missed since the due date. */
  cyclesDue: number;
  amountDue: string;
}

function addDaysIso(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetweenIso(from: string, to: string): number {
  const f = Date.parse(from.slice(0, 10) + "T00:00:00Z");
  const t = Date.parse(to.slice(0, 10) + "T00:00:00Z");
  return Math.round((t - f) / 86_400_000);
}

export function computeDue(p: DueListInput, today: string): DueInfo | null {
  if (!p.paidUpTo) return null;
  const dueDate = addDaysIso(p.paidUpTo, 1);
  const daysUntilDue = daysBetweenIso(today, dueDate);
  // Overdue: the cycle that started on dueDate plus every further full cycle since.
  const cyclesDue = daysUntilDue < 0 ? 1 + periodsBetween(dueDate, today + "T00:00:00Z", p.paymentSchedule) : 1;
  return { dueDate, daysUntilDue, cyclesDue, amountDue: fromCents(mulCents(toCents(p.premiumAmount), cyclesDue)) };
}

export function buildDueList<T extends DueListInput>(
  rows: T[],
  today: string,
  withinDays: number,
): { due: (T & DueInfo)[]; undated: T[] } {
  const due: (T & DueInfo)[] = [];
  const undated: T[] = [];
  for (const r of rows) {
    if (r.groupId) continue;
    if (r.status !== "active" && r.status !== "grace") continue;
    const info = computeDue(r, today);
    if (!info) {
      undated.push(r);
      continue;
    }
    if (info.daysUntilDue <= withinDays) due.push({ ...r, ...info });
  }
  due.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return { due, undated };
}

export interface GraceInfo {
  /** The day the lapse sweep will lapse it (the day after the grace end date) — null if unknown. */
  lapseDate: string | null;
  daysUntilLapse: number | null;
  /** Days since the first unpaid day (0 if unknown). */
  daysOverdue: number;
  cyclesDue: number;
  /** What it takes to bring the policy up to date and stop the lapse. */
  amountDue: string;
}

/**
 * Reports → Policies → Overdue / grace (Pre-lapse merged in): individual policies in grace with
 * days overdue, days until lapse and the amount needed to keep them, soonest lapse first.
 * `lapseWithinDays` narrows to policies lapsing within that many days (the old Pre-lapse tab).
 * Group policies in grace are returned separately — the lapse sweep skips group policies, so one
 * in grace is stuck there until someone moves it.
 */
export function buildGraceList<T extends DueListInput & { graceEndDate?: string | null }>(
  rows: T[],
  today: string,
  lapseWithinDays?: number,
): { individual: (T & GraceInfo)[]; groupStuck: T[] } {
  const individual: (T & GraceInfo)[] = [];
  const groupStuck: T[] = [];
  for (const r of rows) {
    if (r.status !== "grace") continue;
    if (r.groupId) {
      groupStuck.push(r);
      continue;
    }
    const due = computeDue(r, today);
    const lapseDate = r.graceEndDate ? addDaysIso(r.graceEndDate, 1) : null;
    const daysUntilLapse = lapseDate ? daysBetweenIso(today, lapseDate) : null;
    if (lapseWithinDays != null && (daysUntilLapse == null || daysUntilLapse > lapseWithinDays)) continue;
    individual.push({
      ...r,
      lapseDate,
      daysUntilLapse,
      daysOverdue: due ? Math.max(0, -due.daysUntilDue) : 0,
      cyclesDue: due?.cyclesDue ?? 1,
      amountDue: due?.amountDue ?? fromCents(toCents(r.premiumAmount)),
    });
  }
  individual.sort((a, b) => (a.daysUntilLapse ?? Infinity) - (b.daysUntilLapse ?? Infinity));
  return { individual, groupStuck };
}

export interface GroupDueSummary {
  groupId: string;
  groupName: string;
  policies: number;
  inGrace: number;
  /** Monthly-equivalent premium of the group's active + grace policies, per currency. */
  monthlyPremium: Record<string, string>;
  lastPayment: { date: string; amount: string; currency: string } | null;
}

/** One line per group for the "paid through group" section, groups with the oldest (or no) last
 *  payment first — those are the ones to chase. */
export function summarizeGroups(
  rows: (DueListInput & { groupName?: string | null; currency?: string | null })[],
  latestByGroup: Map<string, { date: string; amount: string; currency: string }>,
): GroupDueSummary[] {
  const groups = new Map<string, { name: string; policies: number; inGrace: number; cents: Record<string, number> }>();
  for (const r of rows) {
    if (!r.groupId || (r.status !== "active" && r.status !== "grace")) continue;
    const g = groups.get(r.groupId) ?? { name: r.groupName || "", policies: 0, inGrace: 0, cents: {} };
    g.policies++;
    if (r.status === "grace") g.inGrace++;
    const currency = r.currency || "USD";
    g.cents[currency] = (g.cents[currency] ?? 0) + mulCents(toCents(r.premiumAmount), 1 / monthlyToScheduleFactor(r.paymentSchedule || "monthly"));
    groups.set(r.groupId, g);
  }
  return Array.from(groups, ([groupId, g]) => ({
    groupId,
    groupName: g.name,
    policies: g.policies,
    inGrace: g.inGrace,
    monthlyPremium: Object.fromEntries(Object.entries(g.cents).map(([c, v]) => [c, fromCents(v)])),
    lastPayment: latestByGroup.get(groupId) ?? null,
  })).sort((a, b) => (a.lastPayment?.date ?? "").localeCompare(b.lastPayment?.date ?? "") || a.groupName.localeCompare(b.groupName));
}
