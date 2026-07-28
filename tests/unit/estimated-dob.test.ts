import { describe, it, expect } from "vitest";
import { estimatedDobFromAge, resolveDobForQuote } from "../../client/src/lib/estimated-dob";

describe("estimatedDobFromAge", () => {
  it("returns Jan 1 of the inferred birth year", () => {
    const currentYear = new Date().getFullYear();
    expect(estimatedDobFromAge(8)).toBe(`${currentYear - 8}-01-01`);
  });

  it("floors a negative or fractional age to a sane value", () => {
    const currentYear = new Date().getFullYear();
    expect(estimatedDobFromAge(0)).toBe(`${currentYear}-01-01`);
    expect(estimatedDobFromAge(-5)).toBe(`${currentYear}-01-01`);
  });
});

describe("resolveDobForQuote", () => {
  it("prefers an exact DOB over an estimated age", () => {
    expect(resolveDobForQuote("2015-06-01", "8")).toBe("2015-06-01");
  });

  it("falls back to an estimated age when DOB is empty", () => {
    const currentYear = new Date().getFullYear();
    expect(resolveDobForQuote("", "8")).toBe(`${currentYear - 8}-01-01`);
  });

  it("returns null when neither DOB nor a valid age is given", () => {
    expect(resolveDobForQuote("", "")).toBeNull();
    expect(resolveDobForQuote("", "not-a-number")).toBeNull();
  });
});
