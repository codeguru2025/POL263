import { describe, it, expect } from "vitest";
import { REPORT_EXPORT_PERMISSIONS, csvEscape, reportExportLabel } from "../../server/report-export";

describe("csvEscape", () => {
  it("passes a plain value through unquoted", () => {
    expect(csvEscape("Tendai Moyo")).toBe("Tendai Moyo");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(null)).toBe("");
  });

  it("quotes and doubles quotes for delimiter / quote / newline", () => {
    expect(csvEscape("Moyo, Tendai")).toBe('"Moyo, Tendai"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvEscape("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("neutralises a leading formula character (Excel / Sheets injection)", () => {
    expect(csvEscape("=1+1")).toBe(`"'=1+1"`);
    expect(csvEscape("+441234567")).toBe(`"'+441234567"`);
    expect(csvEscape("-2")).toBe(`"'-2"`);
    expect(csvEscape("@SUM(A1:A9)")).toBe(`"'@SUM(A1:A9)"`);
    expect(csvEscape("\tTAB")).toBe(`"'\tTAB"`);
  });

  it("does not treat a mid-string = or - as risky", () => {
    expect(csvEscape("A=B")).toBe("A=B");
    expect(csvEscape("2026-08-27")).toBe("2026-08-27");
  });
});

describe("REPORT_EXPORT_PERMISSIONS", () => {
  it("gates payroll / commission / audit exports on their own permission, not read:policy", () => {
    expect(REPORT_EXPORT_PERMISSIONS["payroll"]).toBe("read:payroll");
    expect(REPORT_EXPORT_PERMISSIONS["irp5-reconciliation"]).toBe("read:payroll");
    expect(REPORT_EXPORT_PERMISSIONS["commissions"]).toBe("read:commission");
    expect(REPORT_EXPORT_PERMISSIONS["audit-trail"]).toBe("read:audit_log");
    expect(REPORT_EXPORT_PERMISSIONS["actuarial-balance-sheet"]).toBe("read:finance");
  });

  it("gates the new data-quality reports correctly", () => {
    expect(REPORT_EXPORT_PERMISSIONS["data-integrity"]).toBe("read:report");
    expect(REPORT_EXPORT_PERMISSIONS["collection-efficiency"]).toBe("read:finance");
  });

  it("every mapped permission is a real read:* permission", () => {
    const allowed = new Set([
      "read:policy", "read:finance", "read:commission", "read:payroll",
      "read:claim", "read:report", "read:audit_log", "read:funeral_ops",
      "read:fleet", "read:user",
    ]);
    for (const [type, perm] of Object.entries(REPORT_EXPORT_PERMISSIONS)) {
      expect(allowed.has(perm), `${type} → ${perm}`).toBe(true);
    }
  });
});

describe("reportExportLabel", () => {
  it("uses the curated label when there is one", () => {
    expect(reportExportLabel("arrears-breakdown")).toBe("Arrears Breakdown (with Aging)");
    expect(reportExportLabel("irp5-reconciliation")).toBe("Payroll Tax Reconciliation (ITF16)");
  });
  it("title-cases the slug as a fallback", () => {
    expect(reportExportLabel("some-new-report")).toBe("Some New Report");
  });
});
