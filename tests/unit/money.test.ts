import { describe, it, expect } from "vitest";
import {
  toCents,
  tryToCents,
  fromCents,
  roundMoney,
  moneyString,
  sumMoney,
  sumCents,
  subMoney,
  mulMoney,
  percentOf,
  compareMoney,
  moneyEquals,
  splitCents,
  allocateProRata,
} from "../../shared/money";

describe("toCents", () => {
  it("parses numeric-column strings exactly", () => {
    expect(toCents("123.45")).toBe(12345);
    expect(toCents("0.10")).toBe(10);
    expect(toCents("-7.5")).toBe(-750);
    expect(toCents("25")).toBe(2500);
    expect(toCents(".5")).toBe(50);
  });

  it("rounds half-up away from zero at the third decimal", () => {
    expect(toCents("1.005")).toBe(101);
    expect(toCents("1.0049")).toBe(100);
    expect(toCents("-1.005")).toBe(-101);
    expect(toCents("1.999")).toBe(200);
  });

  it("collapses float noise on numbers", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(19.99 * 3)).toBe(5997);
  });

  it("treats junk as zero, but tryToCents reports it", () => {
    expect(toCents(null)).toBe(0);
    expect(toCents("")).toBe(0);
    expect(toCents("abc")).toBe(0);
    expect(toCents(NaN)).toBe(0);
    expect(tryToCents("abc")).toBeNull();
    expect(tryToCents(undefined)).toBeNull();
    expect(tryToCents("1e3")).toBe(100000);
  });
});

describe("formatting", () => {
  it("fromCents always gives two decimals", () => {
    expect(fromCents(12345)).toBe("123.45");
    expect(fromCents(5)).toBe("0.05");
    expect(fromCents(-5)).toBe("-0.05");
    expect(fromCents(0)).toBe("0.00");
  });

  it("roundMoney / moneyString normalise", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(moneyString("12.3")).toBe("12.30");
  });
});

describe("arithmetic", () => {
  it("sums without drift", () => {
    const tenCents = Array.from({ length: 1000 }, () => "0.10");
    expect(sumMoney(tenCents)).toBe(100);
    expect(sumCents(["19.99", "0.01", null])).toBe(2000);
    // The float version of this drifts.
    expect(Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0)).not.toBe(1);
    expect(sumMoney(Array.from({ length: 10 }, () => 0.1))).toBe(1);
  });

  it("subtracts exactly", () => {
    expect(subMoney("0.30", "0.10")).toBe(0.2);
    expect(subMoney(25, "25.00")).toBe(0);
  });

  it("multiplies and takes percentages with a single rounding", () => {
    expect(mulMoney("21.00", 12)).toBe(252);
    expect(percentOf("100.00", 2.5)).toBe(2.5);
    expect(percentOf("10.10", 5)).toBe(0.51); // 0.505 → 0.51
  });

  it("compares exactly", () => {
    expect(moneyEquals(0.1 + 0.2, "0.30")).toBe(true);
    expect(compareMoney("10.00", 9.999)).toBe(0);
    expect(compareMoney("10.01", "10.00")).toBeGreaterThan(0);
  });

  it("allocates pro rata without losing a cent", () => {
    // $100 over three equal premiums: naive rounding gives 33.33 × 3 = 99.99.
    const shares = allocateProRata(10000, [2500, 2500, 2500]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(shares).toEqual([3334, 3333, 3333]);
    expect(allocateProRata(1000, [1, 3])).toEqual([250, 750]);
    expect(allocateProRata(1001, [1, 1])).toEqual([501, 500]);
    expect(allocateProRata(900, [0, 0, 0])).toEqual([300, 300, 300]);
    const uneven = allocateProRata(12345, [21, 25, 17.5, 3]);
    expect(uneven.reduce((a, b) => a + b, 0)).toBe(12345);
  });

  it("splits totals so the shares add back up", () => {
    expect(splitCents(1000, 3)).toEqual([334, 333, 333]);
    expect(splitCents(-1000, 3)).toEqual([-334, -333, -333]);
    expect(splitCents(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
  });
});
