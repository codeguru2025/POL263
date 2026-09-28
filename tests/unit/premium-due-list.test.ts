import { describe, it, expect } from "vitest";
import { computeDue, buildDueList, buildGraceList, summarizeGroups } from "../../server/premium-due-list";
import { parseReportSearchParams, isLegacyPreLapseLink } from "../../client/src/lib/staff-reports-nav";

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

describe("buildGraceList", () => {
  const rows = [
    p({ policyId: "later", status: "grace", paidUpTo: "2026-09-10", graceEndDate: "2026-10-20" }),
    p({ policyId: "soon", status: "grace", paidUpTo: "2026-08-20", graceEndDate: "2026-09-30", premiumAmount: "8.00" }),
    p({ policyId: "group", status: "grace", groupId: "g1", graceEndDate: "2026-10-05" }),
    p({ policyId: "active", paidUpTo: "2026-10-30" }),
  ];

  it("lists individual grace policies soonest lapse first, groups apart", () => {
    const { individual, groupStuck } = buildGraceList(rows, TODAY);
    expect(individual.map((r) => r.policyId)).toEqual(["soon", "later"]);
    expect(groupStuck.map((r) => r.policyId)).toEqual(["group"]);
    // Grace ends 30 Sep → lapses 1 Oct = 3 days away; due 21 Aug → 38 days overdue, 2 cycles.
    expect(individual[0]).toMatchObject({ lapseDate: "2026-10-01", daysUntilLapse: 3, daysOverdue: 38, cyclesDue: 2, amountDue: "16.00" });
  });

  it("narrows to policies lapsing within N days (the old Pre-lapse tab)", () => {
    expect(buildGraceList(rows, TODAY, 7).individual.map((r) => r.policyId)).toEqual(["soon"]);
  });
});

describe("retired Pre-lapse tab", () => {
  it("old links open the merged Overdue / grace tab, pre-filtered", () => {
    expect(parseReportSearchParams("?section=policies&tab=pre-lapse")).toEqual({ section: "policies", tab: "overdue" });
    expect(isLegacyPreLapseLink("?section=policies&tab=pre-lapse")).toBe(true);
    expect(isLegacyPreLapseLink("?section=policies&tab=overdue")).toBe(false);
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
