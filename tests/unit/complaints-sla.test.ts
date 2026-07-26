import { describe, it, expect } from "vitest";
import { computeComplaintAgeDays, isComplaintOverdue, withComplaintAging, COMPLAINT_SLA_DAYS } from "../../server/complaints-sla";

describe("computeComplaintAgeDays", () => {
  it("computes whole days elapsed", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(computeComplaintAgeDays(new Date("2026-07-15T12:00:00.000Z"), now)).toBe(5);
  });

  it("never goes negative for a complaint created after 'now' (clock skew)", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    expect(computeComplaintAgeDays(new Date("2026-07-20T00:00:00.000Z"), now)).toBe(0);
  });
});

describe("isComplaintOverdue", () => {
  it("is not overdue within the SLA window", () => {
    expect(isComplaintOverdue("open", COMPLAINT_SLA_DAYS)).toBe(false);
  });

  it("is overdue once past the SLA window", () => {
    expect(isComplaintOverdue("open", COMPLAINT_SLA_DAYS + 1)).toBe(true);
  });

  it("terminal statuses (resolved, closed) are never overdue regardless of age", () => {
    expect(isComplaintOverdue("resolved", 100)).toBe(false);
    expect(isComplaintOverdue("closed", 100)).toBe(false);
  });

  it("in-progress statuses (open, acknowledged, in_progress) can be overdue", () => {
    for (const status of ["open", "acknowledged", "in_progress"]) {
      expect(isComplaintOverdue(status, COMPLAINT_SLA_DAYS + 1)).toBe(true);
    }
  });
});

describe("withComplaintAging", () => {
  it("enriches a complaint with ageDays and isOverdue without mutating other fields", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    const item = { id: "f1", status: "open", createdAt: new Date("2026-07-01T00:00:00.000Z") };
    const enriched = withComplaintAging(item, now);
    expect(enriched.id).toBe("f1");
    expect(enriched.ageDays).toBe(19);
    expect(enriched.isOverdue).toBe(true);
  });
});
