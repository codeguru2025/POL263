import { describe, it, expect, vi } from "vitest";

// financial-statements imports tenant-db (throws without env) and storage; stub both.
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { consolidateToUsd, buildIncomeTimeSeries } from "../../server/financial-statements";
import { getDbForOrg } from "../../server/tenant-db";

describe("consolidateToUsd", () => {
  const fx = { USD: 1, ZAR: 0.055, ZIG: 0.037 };

  it("sums USD at par", () => {
    const r = consolidateToUsd({ USD: 100 }, fx);
    expect(r.usd).toBeCloseTo(100, 2);
    expect(r.unconvertible).toEqual([]);
  });

  it("converts ZAR and ZIG to USD via rates", () => {
    const r = consolidateToUsd({ USD: 100, ZAR: 1000, ZIG: 500 }, fx);
    // 100 + 1000*0.055 + 500*0.037 = 100 + 55 + 18.5 = 173.5
    expect(r.usd).toBeCloseTo(173.5, 2);
  });

  it("flags currencies with no rate and excludes them", () => {
    const r = consolidateToUsd({ USD: 100, GBP: 50 }, { USD: 1 });
    expect(r.usd).toBeCloseTo(100, 2);
    expect(r.unconvertible).toContain("GBP");
  });

  it("ignores near-zero amounts", () => {
    const r = consolidateToUsd({ USD: 100, ZAR: 0 }, fx);
    expect(r.usd).toBeCloseTo(100, 2);
    expect(r.unconvertible).toEqual([]);
  });

  it("handles negatives (net deficit)", () => {
    const r = consolidateToUsd({ USD: -40, ZAR: 200 }, fx);
    // -40 + 200*0.055 = -40 + 11 = -29
    expect(r.usd).toBeCloseTo(-29, 2);
  });
});

describe("buildIncomeTimeSeries", () => {
  // Postgres does the actual date_trunc bucketing; these tests mock the four grouped queries
  // (premium receipts, service receipts, disbursements, commissions) as if already bucketed, and
  // verify the JS-side merge: income/expenses summed per bucket+currency, net computed, sorted,
  // and currencies never blended together.
  function mockRows(premium: any[], service: any[], disb: any[], comm: any[]) {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: premium })
      .mockResolvedValueOnce({ rows: service })
      .mockResolvedValueOnce({ rows: disb })
      .mockResolvedValueOnce({ rows: comm });
    vi.mocked(getDbForOrg).mockResolvedValue({ execute } as any);
  }

  it("sums income and expenses per bucket, computing net", async () => {
    mockRows(
      [{ bucket: "2026-07-01", currency: "USD", total: "100.00" }],
      [{ bucket: "2026-07-01", currency: "USD", total: "20.00" }],
      [{ bucket: "2026-07-01", currency: "USD", total: "30.00" }],
      [],
    );
    const points = await buildIncomeTimeSeries("org1", { from: "2026-07-01", to: "2026-07-01" });
    expect(points).toHaveLength(1);
    expect(points[0].income).toEqual({ USD: 120 });
    expect(points[0].expenses).toEqual({ USD: 30 });
    expect(points[0].net).toEqual({ USD: 90 });
  });

  it("never blends currencies — each stays its own key", async () => {
    mockRows(
      [{ bucket: "2026-07-01", currency: "USD", total: "100.00" }, { bucket: "2026-07-01", currency: "ZAR", total: "500.00" }],
      [],
      [],
      [],
    );
    const points = await buildIncomeTimeSeries("org1", { from: "2026-07-01", to: "2026-07-01" });
    expect(points[0].income).toEqual({ USD: 100, ZAR: 500 });
  });

  it("sorts multiple buckets chronologically", async () => {
    mockRows(
      [
        { bucket: "2026-07-03", currency: "USD", total: "10.00" },
        { bucket: "2026-07-01", currency: "USD", total: "20.00" },
      ],
      [], [], [],
    );
    const points = await buildIncomeTimeSeries("org1", { from: "2026-07-01", to: "2026-07-03" });
    expect(points.map((p) => p.periodStart)).toEqual(["2026-07-01", "2026-07-03"]);
  });
});
