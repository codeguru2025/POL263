import { describe, it, expect } from "vitest";
import { computeDue, buildDueList, summarizeGroups } from "../../server/premium-due-list";

const TODAY = "2026-09-28";
const p = (over: Record<string, any>) => ({ policyId: over.policyId ?? "p", status: "active", premiumAmount: "10.00", paymentSchedule: "monthly", paidUpTo: null, groupId: null, ...over });

describe("computeDue", () => {
  it("is due the day after the paid-up-to date", () => {
    expect(computeDue(p({ paidUpTo: "2026-10-02" }), TODAY)).toEqual({ dueDate: "2026-10-03", daysUntilDue: 5, cyclesDue: 1, amountDue: "10.00" });
    expect(computeDue(p({ paidUpTo: "2026-09-27" }), TODAY)!.daysUntilDue).toBe(0);
  });

  it("charges every cycle missed since the due date when overdue", () => {
    // Due 2026-07-01, today 2026-09-28: 89 days ≈ 2 full monthly periods past the first → 3 cycles.
    const d = computeDue(p({ paidUpTo: "2026-06-30", premiumAmount: "12.50" }), TODAY)!;
    expect(d.daysUntilDue).toBe(-89);
    expect(d.cyclesDue).toBe(3);
    expect(d.amountDue).toBe("37.50");
  });

  it("returns null without a paid-up-to date", () => {
    expect(computeDue(p({}), TODAY)).toBeNull();
  });
});

describe("buildDueList", () => {
  it("splits due / undated, skips group + far-ahead + lapsed policies, soonest first", () => {
    const { due, undated } = buildDueList([
      p({ policyId: "soon", paidUpTo: "2026-10-01" }),
      p({ policyId: "overdue", status: "grace", paidUpTo: "2026-09-01" }),
      p({ policyId: "far", paidUpTo: "2026-12-31" }),
      p({ policyId: "undated" }),
      p({ policyId: "group", groupId: "g1" }),
      p({ policyId: "lapsed", status: "lapsed", paidUpTo: "2026-05-01" }),
    ], TODAY, 7);
    expect(due.map((r) => r.policyId)).toEqual(["overdue", "soon"]);
    expect(undated.map((r) => r.policyId)).toEqual(["undated"]);
  });
});

describe("summarizeGroups", () => {
  it("one line per group, monthly premium per currency, oldest/no last payment first", () => {
    const latest = new Map([["g1", { date: "2026-09-20", amount: "300.00", currency: "USD" }]]);
    const groups = summarizeGroups([
      { ...p({ groupId: "g1", premiumAmount: "10.00" }), groupName: "Alpha", currency: "USD" },
      { ...p({ groupId: "g1", status: "grace", premiumAmount: "3.00", paymentSchedule: "weekly" }), groupName: "Alpha", currency: "USD" },
      { ...p({ groupId: "g2", premiumAmount: "90.00" }), groupName: "Beta", currency: "ZAR" },
    ], latest);
    expect(groups.map((g) => g.groupName)).toEqual(["Beta", "Alpha"]); // Beta has no payment → first
    expect(groups[1]).toMatchObject({ policies: 2, inGrace: 1, monthlyPremium: { USD: "23.00" }, lastPayment: { amount: "300.00" } });
    expect(groups[0].lastPayment).toBeNull();
  });
});
