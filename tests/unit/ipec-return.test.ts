import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { MIN_CAPITAL_USD, PRESCRIBED_ASSET_RATIO } from "../../server/ipec-return";

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
