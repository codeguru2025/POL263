import { describe, it, expect, vi } from "vitest";

// financial-statements imports tenant-db (throws without env) and storage; stub both.
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { consolidateToUsd } from "../../server/financial-statements";

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
