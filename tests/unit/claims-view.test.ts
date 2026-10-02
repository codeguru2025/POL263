import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { claimState, repudiationByType, type ClaimRecord } from "../../server/claims-view";

describe("claimState", () => {
  it("a completed funeral settles an in-kind claim, even while the claim says approved", () => {
    expect(claimState("approved", true)).toBe("settled");
    expect(claimState("approved", false)).toBe("open");
  });
  it("paid / completed / closed settle; rejected is declined", () => {
    expect(claimState("paid", false)).toBe("settled");
    expect(claimState("closed", false)).toBe("settled");
    expect(claimState("rejected", false)).toBe("repudiated");
    expect(claimState("submitted", false)).toBe("open");
  });
});

describe("repudiationByType", () => {
  const rec = (o: Partial<ClaimRecord>): ClaimRecord => ({
    kind: "claim", reference: "C", funeralCase: "", policyNumber: "", client: "", clientPhone: "", branch: "", deceased: "", relationship: "",
    dateOfDeath: null, reported: "2026-09-01", decided: null, daysToDecide: null, status: "approved", state: "settled", decisionReason: "",
    claimType: "death", currency: "USD", cashInLieu: null, funeralCost: {}, chargedToSociety: null, daysOpen: null, overdue: false, ...o,
  });
  it("declined as a share of decided (settled + declined); open claims don't dilute the rate", () => {
    const [d] = repudiationByType([rec({}), rec({ state: "repudiated" }), rec({ state: "open" }), rec({ state: "settled" })]);
    expect(d).toMatchObject({ claimType: "death", reported: 4, settled: 2, repudiated: 1, open: 1 });
    expect(d.repudiationRate).toBe(33.3);
  });
});
