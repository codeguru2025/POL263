import { describe, it, expect } from "vitest";
import { classifyActivation, summarizeActivations } from "../../server/activations-report";
import { parseReportSearchParams, legacyActivationsTabType } from "../../client/src/lib/staff-reports-nav";

describe("classifyActivation — what a move to active actually was", () => {
  it("a new policy's first payment is the only real activation", () => {
    expect(classifyActivation("inactive", false)).toBe("first_payment");
  });
  it("an existing client captured as a legacy policy is data capture, not a new policy", () => {
    expect(classifyActivation("inactive", true)).toBe("legacy_capture");
  });
  it("separates late payers, reinstatements and reactivations", () => {
    expect(classifyActivation("grace", false)).toBe("back_from_grace");
    expect(classifyActivation("lapsed", true)).toBe("reinstated");
    expect(classifyActivation("cancelled", false)).toBe("reactivated");
    expect(classifyActivation("archived", false)).toBe("reactivated");
  });
  it("active → active or no previous status is a correction", () => {
    expect(classifyActivation("active", false)).toBe("correction");
    expect(classifyActivation(null, false)).toBe("correction");
  });
});

describe("summarizeActivations", () => {
  it("counts every type and totals only first-payment premium, per currency", () => {
    const s = summarizeActivations([
      { type: "first_payment", premium: "12.00", currency: "USD" },
      { type: "first_payment", premium: "0.10", currency: "USD" },
      { type: "first_payment", premium: "200", currency: "ZAR" },
      { type: "back_from_grace", premium: "50.00", currency: "USD" },
      { type: "legacy_capture", premium: "15.00", currency: "USD" },
    ]);
    expect(s.total).toBe(5);
    expect(s.byType).toMatchObject({ first_payment: 3, back_from_grace: 1, legacy_capture: 1, reinstated: 0, reactivated: 0, correction: 0 });
    expect(s.firstPaymentPremium).toEqual({ USD: "12.10", ZAR: "200.00" });
  });
});

describe("retired Conversions / Reinstatements tabs", () => {
  it("old links open Activations, pre-filtered", () => {
    expect(parseReportSearchParams("?section=policies&tab=conversions").tab).toBe("activations");
    expect(parseReportSearchParams("?section=policies&tab=reinstatements").tab).toBe("activations");
    expect(legacyActivationsTabType("?section=policies&tab=conversions")).toBe("first_payment");
    expect(legacyActivationsTabType("?tab=reinstatements")).toBe("reinstated");
    expect(legacyActivationsTabType("?tab=activations")).toBeUndefined();
  });

  it("the retired Payments tab opens Receipts", () => {
    expect(parseReportSearchParams("?section=finance&tab=payments").tab).toBe("receipts");
  });
});
