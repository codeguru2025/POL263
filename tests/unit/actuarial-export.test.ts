import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));

import { ageAt, ageBand, normaliseGender, monthsBetween, summarizeLives, type InForceLife } from "../../server/actuarial-export";

describe("ageAt", () => {
  it("counts whole years, birthday not yet reached", () => {
    expect(ageAt("1989-12-25", "2026-09-30")).toBe(36);
    expect(ageAt("1989-09-30", "2026-09-30")).toBe(37);
  });
  it("null when missing or born after the date", () => {
    expect(ageAt(null, "2026-09-30")).toBeNull();
    expect(ageAt("2027-01-01", "2026-09-30")).toBeNull();
  });
});

describe("ageBand", () => {
  it("5-year bands, 85+ and Unknown", () => {
    expect(ageBand(0)).toBe("0-4");
    expect(ageBand(36)).toBe("35-39");
    expect(ageBand(84)).toBe("80-84");
    expect(ageBand(95)).toBe("85+");
    expect(ageBand(null)).toBe("Unknown");
  });
});

describe("normaliseGender", () => {
  it("maps the recorded forms", () => {
    expect(normaliseGender("M")).toBe("Male");
    expect(normaliseGender("female")).toBe("Female");
    expect(normaliseGender("")).toBe("Unknown");
    expect(normaliseGender(null)).toBe("Unknown");
  });
});

describe("monthsBetween", () => {
  it("whole months from inception to death", () => {
    expect(monthsBetween("2026-08-15", "2026-09-25")).toBe(1);
    expect(monthsBetween("2026-08-15", "2026-09-14")).toBe(0);
    expect(monthsBetween(null, "2026-09-25")).toBeNull();
  });
});

describe("summarizeLives", () => {
  const life = (o: Partial<InForceLife>): InForceLife => ({
    policyNumber: "P1", product: "A", status: "active", inceptionDate: null, currency: "USD", premium: "10", frequency: "Monthly",
    isLegacy: false, memberNumber: "", role: "Dependant", relationship: "", dateOfBirth: "1990-01-01", age: 36, gender: "Male", ...o,
  });
  it("bands by product and gender, counts the gaps", () => {
    const { rows, gaps } = summarizeLives([
      life({}), life({ gender: "Female" }), life({ policyNumber: "P2", age: null, dateOfBirth: null, gender: "Unknown" }), life({ product: "B", age: 90 }),
    ]);
    expect(rows).toEqual([
      { product: "A", band: "35-39", male: 1, female: 1, unknown: 0, total: 2 },
      { product: "A", band: "Unknown", male: 0, female: 0, unknown: 1, total: 1 },
      { product: "B", band: "85+", male: 1, female: 0, unknown: 0, total: 1 },
    ]);
    expect(gaps).toEqual({ lives: 4, policies: 2, noDateOfBirth: 1, noGender: 1 });
  });
});
