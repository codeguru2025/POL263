import { describe, it, expect } from "vitest";
import {
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  normalizeCurrency,
  currencySymbol,
  formatAmount,
  formatAmountWithCode,
  normalizeNationalId,
  isValidNationalId,
  toUpperTrim,
} from "@shared/validation";

describe("Currency validation", () => {
  describe("isSupportedCurrency", () => {
    it("recognizes valid currencies", () => {
      expect(isSupportedCurrency("USD")).toBe(true);
      expect(isSupportedCurrency("ZAR")).toBe(true);
      expect(isSupportedCurrency("ZIG")).toBe(true);
    });

    it("rejects invalid values", () => {
      expect(isSupportedCurrency("EUR")).toBe(false);
      expect(isSupportedCurrency("usd")).toBe(false);
      expect(isSupportedCurrency("")).toBe(false);
      expect(isSupportedCurrency(null)).toBe(false);
      expect(isSupportedCurrency(undefined)).toBe(false);
    });
  });

  describe("normalizeCurrency", () => {
    it("normalizes known currencies case-insensitively", () => {
      expect(normalizeCurrency("usd")).toBe("USD");
      expect(normalizeCurrency("zar")).toBe("ZAR");
      expect(normalizeCurrency("zig")).toBe("ZIG");
      expect(normalizeCurrency(" ZAR ")).toBe("ZAR");
    });

    it("maps legacy codes to ZIG", () => {
      expect(normalizeCurrency("ZWL")).toBe("ZIG");
      expect(normalizeCurrency("RTGS")).toBe("ZIG");
      expect(normalizeCurrency("rtgs")).toBe("ZIG");
    });

    it("defaults to USD for unknown or empty values", () => {
      expect(normalizeCurrency("EUR")).toBe("USD");
      expect(normalizeCurrency("")).toBe("USD");
      expect(normalizeCurrency(null)).toBe("USD");
      expect(normalizeCurrency(undefined)).toBe("USD");
    });
  });

  describe("currencySymbol", () => {
    it("returns correct symbols", () => {
      expect(currencySymbol("USD")).toBe("$");
      expect(currencySymbol("ZAR")).toBe("R");
      expect(currencySymbol("ZIG")).toBe("ZiG");
    });

    it("defaults to $ for unknown currencies", () => {
      expect(currencySymbol(null)).toBe("$");
      expect(currencySymbol("XYZ")).toBe("$");
    });
  });

  describe("formatAmount", () => {
    it("formats with symbol and 2 decimal places", () => {
      expect(formatAmount(1234.5, "USD")).toMatch(/^\$1,?234\.50$/);
      expect(formatAmount("99", "ZAR")).toMatch(/^R99\.00$/);
    });

    it("handles string amounts", () => {
      expect(formatAmount("0", "USD")).toMatch(/^\$0\.00$/);
      expect(formatAmount("invalid", "USD")).toMatch(/^\$0\.00$/);
    });
  });

  describe("formatAmountWithCode", () => {
    it("prefixes amount with currency code", () => {
      expect(formatAmountWithCode(100, "ZAR")).toMatch(/^ZAR 100\.00$/);
      expect(formatAmountWithCode(50.5, "ZIG")).toMatch(/^ZIG 50\.50$/);
    });
  });

  describe("SUPPORTED_CURRENCIES constant", () => {
    it("contains exactly USD, ZAR, ZIG", () => {
      expect(SUPPORTED_CURRENCIES).toEqual(["USD", "ZAR", "ZIG"]);
    });
  });
});

describe("National ID validation", () => {
  describe("normalizeNationalId", () => {
    it("uppercases and trims", () => {
      expect(normalizeNationalId("  08833089h38  ")).toBe("08833089H38");
    });

    it("returns null for empty/null/undefined", () => {
      expect(normalizeNationalId("")).toBeNull();
      expect(normalizeNationalId(null)).toBeNull();
      expect(normalizeNationalId(undefined)).toBeNull();
    });
  });

  describe("isValidNationalId", () => {
    it("accepts valid national IDs", () => {
      expect(isValidNationalId("08833089H38")).toBe(true);
      expect(isValidNationalId("123A45")).toBe(true);
      expect(isValidNationalId("1Z99")).toBe(true);
    });

    it("rejects invalid national IDs", () => {
      expect(isValidNationalId("ABC")).toBe(false);
      expect(isValidNationalId("12345")).toBe(false);
      expect(isValidNationalId("")).toBe(false);
      expect(isValidNationalId(null)).toBe(false);
    });
  });
});

describe("toUpperTrim", () => {
  it("uppercases and trims", () => {
    expect(toUpperTrim("  hello  ")).toBe("HELLO");
  });

  it("returns null for empty strings when allowEmpty is false", () => {
    expect(toUpperTrim("")).toBeNull();
    expect(toUpperTrim("  ")).toBeNull();
  });

  it("returns empty string when allowEmpty is true", () => {
    expect(toUpperTrim("", true)).toBe("");
  });

  it("returns null for null/undefined", () => {
    expect(toUpperTrim(null)).toBeNull();
    expect(toUpperTrim(undefined)).toBeNull();
  });
});
