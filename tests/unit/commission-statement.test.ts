import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));

import { closingCents } from "../../server/commission-statement";

describe("closingCents — what an agent is still owed", () => {
  it("start + earned − clawed back − paid (clawbacks are stored negative)", () => {
    expect(closingCents({ opening: 8560, earnedPolicies: 3510, earnedSocieties: 0, clawedBack: -600, paid: 0 })).toBe(11470); // Pesuate, Sept
  });
  it("a month of clawbacks carries forward as a lower balance", () => {
    expect(closingCents({ opening: 2290, earnedPolicies: 70, earnedSocieties: 0, clawedBack: -1200, paid: 0 })).toBe(1160); // Ayanda
  });
  it("payouts reduce it, society commission adds to it", () => {
    expect(closingCents({ opening: 0, earnedPolicies: 5000, earnedSocieties: 1050, clawedBack: 0, paid: 3700 })).toBe(2350);
  });
});
