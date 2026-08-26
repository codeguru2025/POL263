import { describe, it, expect, vi } from "vitest";

const mockImageSize = vi.fn();
vi.mock("image-size", () => ({ imageSize: (buf: Buffer) => mockImageSize(buf) }));

import { validateReceiptAdvertImage } from "../../server/receipt-advert-image-validation";

const buf = Buffer.from("fake-image-bytes");

describe("validateReceiptAdvertImage", () => {
  it("accepts an A4-shaped image within the recommended aspect-ratio window", () => {
    mockImageSize.mockReturnValueOnce({ width: 720, height: 220 }); // 3.27:1
    expect(validateReceiptAdvertImage(buf, "a4")).toEqual({ ok: true });
  });

  it("accepts a thermal-shaped image within its window", () => {
    mockImageSize.mockReturnValueOnce({ width: 480, height: 260 }); // 1.85:1
    expect(validateReceiptAdvertImage(buf, "thermal")).toEqual({ ok: true });
  });

  it("rejects a thermal-shaped image submitted for the A4 slot as too tall/narrow, in plain px (no ratio jargon)", () => {
    mockImageSize.mockReturnValueOnce({ width: 480, height: 260 }); // 1.85:1, below a4's 2.5 minimum
    const result = validateReceiptAdvertImage(buf, "a4");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/too tall\/narrow/);
      expect(result.message).not.toMatch(/:1/); // no "X.XX:1" ratio jargon shown to the user
    }
  });

  it("rejects an A4-shaped wide banner submitted for the thermal slot as too wide/flat, in plain px", () => {
    mockImageSize.mockReturnValueOnce({ width: 720, height: 220 }); // 3.27:1, above thermal's 2.4 maximum
    const result = validateReceiptAdvertImage(buf, "thermal");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/too wide\/flat/);
      expect(result.message).not.toMatch(/:1/);
    }
  });

  it("rejects a too-narrow (portrait) image for either format", () => {
    mockImageSize.mockReturnValueOnce({ width: 300, height: 600 }); // 0.5:1
    const result = validateReceiptAdvertImage(buf, "a4");
    expect(result.ok).toBe(false);
  });

  it("rejects an image below the minimum pixel width", () => {
    mockImageSize.mockReturnValueOnce({ width: 100, height: 30 }); // 3.33:1 ratio ok, but too small
    const result = validateReceiptAdvertImage(buf, "a4");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/too small/);
  });

  it("rejects a file image-size can't parse", () => {
    mockImageSize.mockImplementationOnce(() => { throw new Error("unsupported format"); });
    const result = validateReceiptAdvertImage(buf, "a4");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Could not read/);
  });

  it("rejects when width/height come back undefined", () => {
    mockImageSize.mockReturnValueOnce({ width: undefined, height: undefined });
    const result = validateReceiptAdvertImage(buf, "thermal");
    expect(result.ok).toBe(false);
  });
});
