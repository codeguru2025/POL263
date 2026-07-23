import { describe, it, expect } from "vitest";
import {
  computePoolBalance,
  resolvePoolPayoutAmount,
  checkPoolPayoutAffordability,
  type GroupPayoutRule,
} from "../../server/pool-society";

describe("computePoolBalance", () => {
  it("sums contributions per currency with no payouts", () => {
    const balance = computePoolBalance(
      [{ amount: "100.00", currency: "USD" }, { amount: "50.00", currency: "USD" }],
      [],
    );
    expect(balance).toEqual({ USD: 150 });
  });

  it("keeps currencies separate rather than blending them", () => {
    const balance = computePoolBalance(
      [{ amount: "100.00", currency: "USD" }, { amount: "500.00", currency: "ZAR" }],
      [],
    );
    expect(balance).toEqual({ USD: 100, ZAR: 500 });
  });

  it("subtracts only paid payouts, ignoring pending/approved", () => {
    const balance = computePoolBalance(
      [{ amount: "200.00", currency: "USD" }],
      [
        { amount: "50.00", currency: "USD", status: "paid" },
        { amount: "30.00", currency: "USD", status: "pending" },
        { amount: "20.00", currency: "USD", status: "approved" },
      ],
    );
    expect(balance).toEqual({ USD: 150 });
  });

  it("returns an empty object for no contributions and no payouts", () => {
    expect(computePoolBalance([], [])).toEqual({});
  });

  it("skips non-numeric amounts rather than throwing or poisoning the total with NaN", () => {
    const balance = computePoolBalance(
      [{ amount: "not-a-number", currency: "USD" }, { amount: "50.00", currency: "USD" }],
      [],
    );
    expect(balance).toEqual({ USD: 50 });
  });

  it("can go negative if paid payouts exceed contributions", () => {
    const balance = computePoolBalance(
      [{ amount: "50.00", currency: "USD" }],
      [{ amount: "80.00", currency: "USD", status: "paid" }],
    );
    expect(balance).toEqual({ USD: -30 });
  });
});

const RULES: GroupPayoutRule[] = [
  { eventType: "member_death", label: "Member death", amount: 500, currency: "USD" },
  { eventType: "spouse_death", label: "Spouse death", amount: 300, currency: "USD" },
  { eventType: "member_death", label: "Member death (ZAR)", amount: 8000, currency: "ZAR" },
];

describe("resolvePoolPayoutAmount", () => {
  it("finds the matching rule by event type and currency", () => {
    expect(resolvePoolPayoutAmount(RULES, "member_death", "USD")).toBe(500);
    expect(resolvePoolPayoutAmount(RULES, "member_death", "ZAR")).toBe(8000);
    expect(resolvePoolPayoutAmount(RULES, "spouse_death", "USD")).toBe(300);
  });

  it("returns null when no rule matches the event type", () => {
    expect(resolvePoolPayoutAmount(RULES, "child_death", "USD")).toBeNull();
  });

  it("returns null when the event type matches but the currency doesn't", () => {
    expect(resolvePoolPayoutAmount(RULES, "spouse_death", "ZAR")).toBeNull();
  });

  it("returns null for null/undefined rules rather than throwing", () => {
    expect(resolvePoolPayoutAmount(null, "member_death", "USD")).toBeNull();
    expect(resolvePoolPayoutAmount(undefined, "member_death", "USD")).toBeNull();
  });
});

describe("checkPoolPayoutAffordability", () => {
  it("reports sufficient funds and zero shortfall when the pool can cover it", () => {
    const result = checkPoolPayoutAffordability(1000, 500);
    expect(result).toEqual({ currentBalance: 1000, requestedAmount: 500, sufficientFunds: true, shortfall: 0 });
  });

  it("reports the exact shortfall when the pool can't cover it", () => {
    const result = checkPoolPayoutAffordability(200, 500);
    expect(result).toEqual({ currentBalance: 200, requestedAmount: 500, sufficientFunds: false, shortfall: 300 });
  });

  it("treats an exact match as sufficient", () => {
    const result = checkPoolPayoutAffordability(500, 500);
    expect(result.sufficientFunds).toBe(true);
    expect(result.shortfall).toBe(0);
  });

  it("treats a negative pool balance as a shortfall equal to the full requested amount plus the deficit", () => {
    const result = checkPoolPayoutAffordability(-50, 100);
    expect(result.shortfall).toBe(150);
    expect(result.sufficientFunds).toBe(false);
  });
});
