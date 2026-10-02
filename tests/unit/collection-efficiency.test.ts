import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { dueDatesInWindow, rollUp, type PolicyCollection } from "../../server/collection-efficiency";

describe("dueDatesInWindow", () => {
  it("monthly on the anniversary day, clamped to month end", () => {
    expect(dueDatesInWindow("2026-06-15", "monthly", "2026-09-01", "2026-09-30")).toEqual(["2026-09-15"]);
    expect(dueDatesInWindow("2026-01-31", "monthly", "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-31"]);
    expect(dueDatesInWindow("2026-06-15", "monthly", "2026-07-01", "2026-09-30")).toHaveLength(3);
  });
  it("weekly counts every week in the window; nothing before cover starts", () => {
    expect(dueDatesInWindow("2026-09-01", "weekly", "2026-09-01", "2026-09-30")).toEqual(["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);
    expect(dueDatesInWindow("2026-10-05", "monthly", "2026-09-01", "2026-09-30")).toEqual([]);
  });
});

describe("rollUp", () => {
  const p = (o: Partial<PolicyCollection>): PolicyCollection => ({
    policyId: "x", policyNumber: "P", client: "", phone: "", branch: "HQ", agent: "A", currency: "USD", premium: "10.00", due: 1,
    expected: "10.00", collected: "10.00", shortfall: "0.00", otherCurrency: false, ...o,
  });
  it("sums per key and currency with the collection rate", () => {
    expect(rollUp([p({}), p({ collected: "0.00" }), p({ currency: "ZAR", expected: "200.00", collected: "100.00" })], (r) => r.agent)).toEqual([
      { key: "A", currency: "USD", policies: 2, expected: "20.00", collected: "10.00", ratePct: 50 },
      { key: "A", currency: "ZAR", policies: 1, expected: "200.00", collected: "100.00", ratePct: 50 },
    ]);
  });
});
