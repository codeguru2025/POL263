import { describe, it, expect } from "vitest";
import { computeClaimAgeDays, isClaimOverdue, withClaimAging, CLAIM_SLA_DAYS } from "../../server/claims-sla";

describe("computeClaimAgeDays", () => {
  it("computes whole days elapsed", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(computeClaimAgeDays(new Date("2026-07-15T12:00:00.000Z"), now)).toBe(5);
  });

  it("never goes negative for a claim created after 'now' (clock skew)", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    expect(computeClaimAgeDays(new Date("2026-07-20T00:00:00.000Z"), now)).toBe(0);
  });
});

describe("isClaimOverdue", () => {
  it("is not overdue within the SLA window", () => {
    expect(isClaimOverdue("submitted", CLAIM_SLA_DAYS)).toBe(false);
  });

  it("is overdue once past the SLA window", () => {
    expect(isClaimOverdue("submitted", CLAIM_SLA_DAYS + 1)).toBe(true);
  });

  it("terminal statuses (rejected, closed) are never overdue regardless of age", () => {
    expect(isClaimOverdue("rejected", 100)).toBe(false);
    expect(isClaimOverdue("closed", 100)).toBe(false);
  });

  it("in-progress statuses (verified, approved, scheduled, payable, completed, paid) can be overdue", () => {
    for (const status of ["verified", "approved", "scheduled", "payable", "completed", "paid"]) {
      expect(isClaimOverdue(status, CLAIM_SLA_DAYS + 1)).toBe(true);
    }
  });
});

describe("withClaimAging", () => {
  it("enriches a claim with ageDays and isOverdue without mutating other fields", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    const claim = { id: "c1", status: "submitted", createdAt: new Date("2026-07-10T00:00:00.000Z") };
    const enriched = withClaimAging(claim, now);
    expect(enriched.id).toBe("c1");
    expect(enriched.ageDays).toBe(10);
    expect(enriched.isOverdue).toBe(true);
  });
});
