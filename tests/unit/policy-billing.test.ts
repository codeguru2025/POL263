import { describe, it, expect, vi } from "vitest";

// route-helpers imports `storage` (which pulls in DB/tenant modules that require env).
// The helpers under test are pure and don't touch storage, so stub it for import.
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { periodsBetween, computePolicyOutstanding } from "../../server/route-helpers";

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
