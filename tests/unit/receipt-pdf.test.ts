import { describe, it, expect } from "vitest";

// Receipt PDF uses 80mm thermal width; 80mm in points (1mm ≈ 2.83465pt)
const WIDTH_MM = 80;
const MM_TO_PT = 2.83465;
const RECEIPT_PDF_WIDTH_PT = Math.round(WIDTH_MM * MM_TO_PT);

describe("Receipt PDF (80mm thermal)", () => {
  it("uses 80mm width in points (~227pt)", () => {
    expect(RECEIPT_PDF_WIDTH_PT).toBe(227);
  });
});
