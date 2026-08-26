import { imageSize } from "image-size";
import { RECEIPT_ADVERT_IMAGE_SPECS, type ReceiptAdvertFormat } from "@shared/receipt-advert-specs";

/**
 * Enforces that an uploaded receipt-advert image roughly matches the box shape it'll actually be
 * drawn into (server/receipt-pdf.ts) — see shared/receipt-advert-specs.ts for where the aspect-
 * ratio windows come from. Catches the failure mode this feature exists to prevent: a wide A4
 * banner uploaded for the thermal slot (or vice versa) ending up tiny/letterboxed on the printed
 * receipt, discovered only after it's already printing wrong for real customers.
 */
export function validateReceiptAdvertImage(
  buffer: Buffer,
  format: ReceiptAdvertFormat
): { ok: true } | { ok: false; message: string } {
  const spec = RECEIPT_ADVERT_IMAGE_SPECS[format];
  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(buffer);
  } catch {
    return { ok: false, message: "Could not read this image's dimensions — try a different file." };
  }
  const { width, height } = dims;
  if (!width || !height) {
    return { ok: false, message: "Could not read this image's dimensions — try a different file." };
  }
  if (width < spec.minWidthPx) {
    return {
      ok: false,
      message: `Image is too small (${width}px wide) for ${spec.label} — use at least ${spec.minWidthPx}px wide.`,
    };
  }
  // "Too tall/narrow" vs "too wide/flat" — plain shape language, no ratio numbers, so a staff
  // member can tell at a glance which way to fix the image instead of decoding a ratio.
  const ratio = width / height;
  if (ratio < spec.minAspectRatio) {
    return {
      ok: false,
      message: `This image (${width}×${height}px) is too tall/narrow for ${spec.label}. ${spec.hintText}`,
    };
  }
  if (ratio > spec.maxAspectRatio) {
    return {
      ok: false,
      message: `This image (${width}×${height}px) is too wide/flat for ${spec.label}. ${spec.hintText}`,
    };
  }
  return { ok: true };
}
