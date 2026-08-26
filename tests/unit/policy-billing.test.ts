import { describe, it, expect, vi } from "vitest";

// route-helpers imports `storage` and `tenant-db` (which pull in DB modules that require
// env). The helpers under test are pure and don't touch either, so stub them for import.
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/tenant-db", () => ({ resolveOrSyncTenantUserId: vi.fn((_orgId: string, userId: string) => Promise.resolve(userId)) }));

import { periodsBetween, computePolicyOutstanding } from "../../server/route-helpers";
import { monthsFromPeriod, advancePolicyCycle } from "../../server/policy-status-on-payment";

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
};
const daysAhead = (n: number) => daysAgo(-n);

describe("periodsBetween", () => {
  it("counts whole monthly periods elapsed (floor)", () => {
    expect(periodsBetween(daysAgo(61), new Date(), "monthly")).toBe(2); // 61 / 30.44 = 2.0
    expect(periodsBetween(daysAgo(90), new Date(), "monthly")).toBe(2); // 90 / 30.44 = 2.95 → 2
  });

  it("counts weekly periods", () => {
    expect(periodsBetween(daysAgo(21), new Date(), "weekly")).toBe(3);
  });

  it("returns 0 for today / future effective dates (no back-bill)", () => {
    expect(periodsBetween(new Date().toISOString().split("T")[0], new Date(), "monthly")).toBe(0);
    expect(periodsBetween(daysAhead(30), new Date(), "monthly")).toBe(0);
  });

  it("returns 0 for missing/invalid dates", () => {
    expect(periodsBetween(null, new Date(), "monthly")).toBe(0);
    expect(periodsBetween(undefined, new Date(), "monthly")).toBe(0);
  });
});

describe("computePolicyOutstanding", () => {
  const policy = (over: Record<string, any> = {}) => ({
    premiumAmount: "10",
    paymentSchedule: "monthly",
    inceptionDate: daysAgo(90), // ceil(90/30.44) = 3 periods
    ...over,
  });

  it("computes arrears when nothing is paid", () => {
    const r = computePolicyOutstanding({ policy: policy(), totalPaid: 0, walletBalance: 0 });
    expect(r.periodsElapsed).toBe(3);
    expect(r.totalDue).toBeCloseTo(30, 2);
    expect(r.balance).toBeCloseTo(-30, 2);
    expect(r.outstanding).toBeCloseTo(30, 2);
  });

  it("is up to date when fully paid", () => {
    const r = computePolicyOutstanding({ policy: policy(), totalPaid: 30, walletBalance: 0 });
    expect(r.balance).toBeCloseTo(0, 2);
    expect(r.outstanding).toBeCloseTo(0, 2);
  });

  it("a positive wallet (advance/credit) reduces what is owed", () => {
    const r = computePolicyOutstanding({ policy: policy(), totalPaid: 0, walletBalance: 15 });
    expect(r.balance).toBeCloseTo(-15, 2);
    expect(r.outstanding).toBeCloseTo(15, 2);
  });

  it("a negative wallet (arrears reconciliation) increases what is owed", () => {
    const r = computePolicyOutstanding({ policy: policy(), totalPaid: 30, walletBalance: -10 });
    expect(r.balance).toBeCloseTo(-10, 2);
    expect(r.outstanding).toBeCloseTo(10, 2);
  });

  it("shows credit (positive balance) when paid ahead", () => {
    const r = computePolicyOutstanding({ policy: policy(), totalPaid: 50, walletBalance: 0 });
    expect(r.balance).toBeCloseTo(20, 2);
    expect(r.outstanding).toBe(0);
  });

  it("no inception/effective date ⇒ nothing due", () => {
    const r = computePolicyOutstanding({ policy: policy({ inceptionDate: null, effectiveDate: null }), totalPaid: 0, walletBalance: 0 });
    expect(r.totalDue).toBe(0);
    expect(r.outstanding).toBe(0);
  });
});

// Reconciliation math (delta × periods): mirrors reconcilePremiumChange without DB.
describe("premium-change reconciliation math", () => {
  const recon = (oldP: number, newP: number, effDate: string, schedule = "monthly") =>
    Number(((newP - oldP) * periodsBetween(effDate, new Date(), schedule)).toFixed(2));

  it("upgrade effective today ⇒ no arrears", () => {
    expect(recon(10, 15, new Date().toISOString().split("T")[0])).toBe(0);
  });

  it("backdated upgrade ⇒ positive (arrears) = delta × periods", () => {
    expect(recon(10, 15, daysAgo(61))).toBeCloseTo(10, 2); // 5 × 2
  });

  it("backdated downgrade ⇒ negative (credit)", () => {
    expect(recon(15, 10, daysAgo(61))).toBeCloseTo(-10, 2); // -5 × 2
  });
});

// Regression coverage for the "months paid" bug: advancePolicyCycle anchors cycles to a fixed
// day-length, not calendar months, so a single monthly cycle routinely crosses a calendar month
// boundary (e.g. FLK00012's real period was 2026-07-27 to 2026-08-25 for one $10 payment on a
// $10/mo premium) — calendar-month-diff arithmetic overcounted that as 2 months on the receipt.
describe("monthsFromPeriod", () => {
  it("counts a single monthly cycle as 1 month even when it crosses a calendar-month boundary", () => {
    expect(monthsFromPeriod("2026-07-27", "2026-08-25", "monthly")).toBe(1);
  });

  it("counts a single monthly cycle as 1 month when it doesn't cross a boundary", () => {
    expect(monthsFromPeriod("2026-07-01", "2026-07-30", "monthly")).toBe(1);
  });

  it("counts two consecutive monthly cycles as 2 months", () => {
    expect(monthsFromPeriod("2026-07-27", "2026-09-24", "monthly")).toBe(2);
  });

  it("counts weekly and biweekly cycles by their own cycle length", () => {
    expect(monthsFromPeriod("2026-07-01", "2026-07-07", "weekly")).toBe(1);
    expect(monthsFromPeriod("2026-07-01", "2026-07-14", "biweekly")).toBe(1);
  });
});

// Regression coverage: yearly cycles previously used a flat 365-day offset, drifting a policy's
// cover period off its real calendar anniversary by a day on every leap year crossed. Fixed to
// anchor on the real calendar anniversary (advancePolicyCycle, server/policy-status-on-payment.ts).
describe("advancePolicyCycle — yearly cycle anchors to the calendar anniversary", () => {
  const mockDb = () => ({
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  });
  const policy = (over: Record<string, any> = {}) => ({
    id: "p1", organizationId: "org1", paymentSchedule: "yearly",
    productVersionId: null, currentCycleEnd: null, graceUsedDays: 0,
    ...over,
  } as any);

  it("first payment: one year later lands on the same calendar date, leap year included", async () => {
    const { periodTo, periodFrom } = await advancePolicyCycle(mockDb(), "p1", policy(), "2028-02-15");
    expect(periodFrom).toBe("2028-02-15");
    expect(periodTo).toBe("2029-02-14"); // 2028-02-15 → 2029-02-15 exclusive, not +365 days flat
  });

  it("a cycle spanning a leap day doesn't drift the anniversary", async () => {
    // Old flat-365 behavior: 2027-03-01 + 365 = 2028-02-29 (drifts a day early off the real
    // anniversary because 2028 is a leap year). Fixed: real calendar year → 2028-03-01.
    const { periodTo, periodFrom } = await advancePolicyCycle(
      mockDb(), "p1", policy({ currentCycleEnd: "2027-02-28" }), "2027-03-01"
    );
    expect(periodFrom).toBe("2027-03-01");
    expect(periodTo).toBe("2028-02-29"); // last day before the 2028-03-01 anniversary
  });

  it("a Feb-29 anniversary falls back to Feb 28 in a non-leap target year", async () => {
    // currentCycleEnd 2028-02-28 → due date (periodFrom) 2028-02-29 (2028 is a leap year, valid).
    // One calendar year later is 2029, not a leap year — Feb 29 doesn't exist, so the anniversary
    // falls back to Feb 28 rather than overflowing into March 1.
    const { periodTo, periodFrom } = await advancePolicyCycle(
      mockDb(), "p1", policy({ currentCycleEnd: "2028-02-28" }), "2028-02-29"
    );
    expect(periodFrom).toBe("2028-02-29");
    expect(periodTo).toBe("2029-02-27"); // last day before the (clamped) 2029-02-28 anniversary
  });

  it("non-yearly schedules are unaffected (still flat-day cycles)", async () => {
    const { periodTo } = await advancePolicyCycle(mockDb(), "p1", policy({ paymentSchedule: "monthly" }), "2028-01-01");
    expect(periodTo).toBe("2028-01-30"); // 30-day flat cycle, unchanged
  });
});
