import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { splitFuneralCosts } from "../../server/ipec-return";

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
