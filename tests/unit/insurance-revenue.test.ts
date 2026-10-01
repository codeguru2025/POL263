import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { coveredPeriod, unearnedAt } from "../../server/insurance-revenue";

describe("coveredPeriod — receipts with no recorded covered months", () => {
  const base = { periodFrom: null, periodTo: null, paidOn: "2026-09-10", schedule: "monthly" };
  it("uses the recorded period when there is one", () => {
    expect(coveredPeriod({ ...base, periodFrom: "2026-09-01", periodTo: "2026-09-30", amount: "10", premium: "10" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("one premium covers one month from the payment date", () => {
    expect(coveredPeriod({ ...base, amount: "10", premium: "10" })).toEqual({ from: "2026-09-10", to: "2026-10-09" });
  });
  it("amount ÷ premium months, at least one, at most a year", () => {
    expect(coveredPeriod({ ...base, amount: "30", premium: "10" }).to).toBe("2026-12-09");
    expect(coveredPeriod({ ...base, amount: "4", premium: "10" }).to).toBe("2026-10-09");
    expect(coveredPeriod({ ...base, amount: "500", premium: "10" }).to).toBe("2027-09-09");
    expect(coveredPeriod({ ...base, amount: "10", premium: null }).to).toBe("2026-10-09");
  });
  it("weekly premiums cover weeks", () => {
    expect(coveredPeriod({ ...base, schedule: "weekly", amount: "6", premium: "3" })).toEqual({ from: "2026-09-10", to: "2026-09-23" });
  });
});

describe("unearnedAt and the LRC roll-forward", () => {
  const P = { from: "2026-09-01", to: "2026-09-30" }; // 30 days, USD 30 → USD 1/day
  it("nothing before it is received; the days still to come after", () => {
    expect(unearnedAt(P, "2026-09-01", 30, "2026-08-31")).toBe(0);
    expect(unearnedAt(P, "2026-09-01", 30, "2026-09-10")).toBeCloseTo(20, 6);
    expect(unearnedAt(P, "2026-09-01", 30, "2026-09-30")).toBe(0);
    expect(unearnedAt({ from: "2026-10-01", to: "2026-10-30" }, "2026-09-25", 30, "2026-09-30")).toBe(30);
  });

  it("opening + received − earned = closing, for advance, backdated and straddling receipts", () => {
    const receipts = [
      { period: { from: "2026-08-15", to: "2026-09-14" }, paidOn: "2026-08-15", amount: 31 },  // straddles the start
      { period: { from: "2026-09-20", to: "2026-10-19" }, paidOn: "2026-09-20", amount: 30 },  // straddles the end
      { period: { from: "2026-08-01", to: "2026-08-31" }, paidOn: "2026-09-05", amount: 31 },  // backdated: cover before it was paid
      { period: { from: "2026-11-01", to: "2026-11-30" }, paidOn: "2026-09-28", amount: 30 },  // paid in advance
      { period: { from: "2026-09-10", to: "2026-10-09" }, paidOn: "2026-10-02", amount: 30 },  // paid after the period — not in it
    ];
    const from = "2026-09-01", to = "2026-09-30", before = "2026-08-31";
    let opening = 0, received = 0, earned = 0, closing = 0;
    for (const r of receipts) {
      const u = (d: string) => unearnedAt(r.period, r.paidOn, r.amount, d);
      opening += u(before);
      closing += u(to);
      if (r.paidOn >= from && r.paidOn <= to) received += r.amount;
      if (r.paidOn <= to) earned += (r.paidOn <= before ? u(before) : r.amount) - u(to);
    }
    expect(opening + received - earned).toBeCloseTo(closing, 9);
  });
});
