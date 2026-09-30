import { describe, it, expect, vi } from "vitest";

// financial-statements imports tenant-db (throws without env) and storage; stub both.
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/date-utils", () => ({
  todayForOrg: vi.fn(async () => "2026-07-31"),
  getOrgTimezone: vi.fn(async () => "Africa/Harare"),
  dayRangeForOrg: vi.fn(async (_o: string, from: string, to: string) => ({ start: new Date(from + "T00:00:00+02:00"), endExclusive: new Date(Date.parse(to + "T00:00:00+02:00") + 86_400_000) })),
}));

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
  // Postgres does the date_trunc bucketing; these tests mock the grouped queries as if already
  // bucketed — in call order: premium receipts, service receipts, society lump sums,
  // disbursements, commission earned, POL263 fees, payroll, petty cash, claims — and verify the
  // JS-side merge: income/expenses per bucket+currency, net, sorting, currencies never blended.
  type Row = { bucket: string; currency: string; total: string };
  function mockRows(q: Partial<Record<"premium" | "service" | "lump" | "disb" | "comm" | "fees" | "payroll" | "petty" | "claims", Row[]>>) {
    const order = ["premium", "service", "lump", "disb", "comm", "fees", "payroll", "petty", "claims"] as const;
    const execute = vi.fn();
    for (const k of order) execute.mockResolvedValueOnce({ rows: q[k] ?? [] });
    vi.mocked(getDbForOrg).mockResolvedValue({ execute } as any);
  }
  const r = (bucket: string, currency: string, total: string): Row => ({ bucket, currency, total });

  it("sums income and expenses per bucket, computing net", async () => {
    mockRows({ premium: [r("2026-07-01", "USD", "100.00")], service: [r("2026-07-01", "USD", "20.00")], disb: [r("2026-07-01", "USD", "30.00")] });
    const points = await buildIncomeTimeSeries("org1", { from: "2026-07-01", to: "2026-07-01" });
    expect(points).toHaveLength(1);
    expect(points[0].income).toEqual({ USD: 120 });
    expect(points[0].expenses).toEqual({ USD: 30 });
    expect(points[0].net).toEqual({ USD: 90 });
  });

  it("counts society lump sums as income, and commission, fees, payroll, petty cash and claims as costs", async () => {
    mockRows({
      premium: [r("2026-07-01", "USD", "100.00")],
      lump: [r("2026-07-01", "USD", "60.00")],
      comm: [r("2026-07-01", "USD", "5.00")],
      fees: [r("2026-07-01", "USD", "2.50")],
      payroll: [r("2026-07-01", "USD", "40.00")],
      petty: [r("2026-07-01", "USD", "1.50")],
      claims: [r("2026-07-01", "USD", "11.00")],
    });
    const [p] = await buildIncomeTimeSeries("org1", { from: "2026-07-01", to: "2026-07-01" });
    expect(p.income).toEqual({ USD: 160 });
    expect(p.expenses).toEqual({ USD: 60 });
    expect(p.net).toEqual({ USD: 100 });
  });

  it("never blends currencies — each stays its own key", async () => {
    mockRows({ premium: [r("2026-07-01", "USD", "100.00"), r("2026-07-01", "ZAR", "500.00")] });
    const points = await buildIncomeTimeSeries("org1", { from: "2026-07-01", to: "2026-07-01" });
    expect(points[0].income).toEqual({ USD: 100, ZAR: 500 });
  });

  it("sorts multiple buckets chronologically", async () => {
    mockRows({ premium: [r("2026-07-03", "USD", "10.00"), r("2026-07-01", "USD", "20.00")] });
    const points = await buildIncomeTimeSeries("org1", { from: "2026-07-01", to: "2026-07-03" });
    expect(points.map((p) => p.periodStart)).toEqual(["2026-07-01", "2026-07-03"]);
  });
});
