import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { MIN_CAPITAL_USD, PRESCRIBED_ASSET_RATIO, splitFuneralCosts } from "../../server/ipec-return";

describe("IPEC return regulatory constants", () => {
  it("uses the SI 67 of 2025 USD minimum capital thresholds", () => {
    expect(MIN_CAPITAL_USD.funeral).toBe(500_000);
    expect(MIN_CAPITAL_USD.life).toBe(2_000_000);
    expect(MIN_CAPITAL_USD.composite).toBe(2_000_000);
  });

  it("uses the 15% prescribed asset ratio", () => {
    expect(PRESCRIBED_ASSET_RATIO).toBeCloseTo(0.15, 5);
  });
});

describe("splitFuneralCosts", () => {
  it("policy funerals are claims, cash funerals are not insurance; commission and POL263 payments are skipped", () => {
    const { policy, cash } = splitFuneralCosts([
      { serviceType: "claim", category: "CASKET", description: null, currency: "USD", amount: 250 },
      { serviceType: "claim", category: "FUEL", description: null, currency: "zar", amount: 300 },
      { serviceType: "cash", category: "COFFIN", description: null, currency: "USD", amount: 100 },
      { serviceType: null, category: "GRAVE FEE", description: null, currency: "USD", amount: 20 },
      { serviceType: "claim", category: "COMMISSION", description: null, currency: "USD", amount: 40 },
      { serviceType: "claim", category: "PAYMENT", description: "2.5% PLATFORM FEE", currency: "USD", amount: 5 },
    ]);
    expect(policy).toEqual({ USD: 250, ZAR: 300 });
    expect(cash).toEqual({ USD: 120 });
  });
});
