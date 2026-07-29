import { describe, it, expect } from "vitest";
import { computeClaimAgeDays, isClaimOverdue, CLAIM_SLA_DAYS } from "../../server/claims-sla";

/**
 * executive-report.ts's quote-conversion-rate and claims-overdue-% calculations are simple
 * reductions inline in buildExecutiveReport (not extracted as standalone functions, since they're
 * one-liners over already-fetched rows) — so the actual arithmetic worth covering here is the
 * claims-sla helpers they're built on (server/claims-sla.ts), following that file's own
 * "pure/zero-side-effecting by design" convention for testability.
 */
describe("executive report — claims overdue % (via claims-sla helpers)", () => {
  it("computes an overdue percentage over a mixed set of open claims", () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    const claims = [
      { status: "submitted", createdAt: "2026-07-28T00:00:00.000Z" }, // 1 day — not overdue
      { status: "verified", createdAt: "2026-07-01T00:00:00.000Z" },  // 28 days — overdue
      { status: "approved", createdAt: "2026-06-01T00:00:00.000Z" },  // overdue
    ];
    const overdueCount = claims.filter((c) => isClaimOverdue(c.status, computeClaimAgeDays(c.createdAt, now))).length;
    const overduePercent = Number(((overdueCount / claims.length) * 100).toFixed(1));
    expect(overdueCount).toBe(2);
    expect(overduePercent).toBeCloseTo(66.7, 1);
  });

  it("excludes terminal statuses (rejected/closed) from overdue regardless of age", () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    const ancientRejected = { status: "rejected", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(isClaimOverdue(ancientRejected.status, computeClaimAgeDays(ancientRejected.createdAt, now))).toBe(false);
  });

  it("treats exactly CLAIM_SLA_DAYS old as not yet overdue (strictly greater-than)", () => {
    expect(isClaimOverdue("submitted", CLAIM_SLA_DAYS)).toBe(false);
    expect(isClaimOverdue("submitted", CLAIM_SLA_DAYS + 1)).toBe(true);
  });
});

describe("executive report — quote conversion rate arithmetic", () => {
  function conversionRate(stats: { conversionStatus: string; count: number }[]): number | null {
    const total = stats.reduce((sum, s) => sum + s.count, 0);
    const converted = stats.filter((s) => s.conversionStatus === "converted").reduce((sum, s) => sum + s.count, 0);
    return total > 0 ? Number(((converted / total) * 100).toFixed(1)) : null;
  }

  it("computes the converted share across pending/partial/converted", () => {
    const stats = [
      { conversionStatus: "pending", count: 5 },
      { conversionStatus: "partial", count: 2 },
      { conversionStatus: "converted", count: 3 },
    ];
    expect(conversionRate(stats)).toBeCloseTo(30, 1);
  });

  it("returns null (not NaN/0) when there are no quotes at all", () => {
    expect(conversionRate([])).toBeNull();
  });
});
