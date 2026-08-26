/**
 * Recommended/enforced image shape per receipt print format, for the receipt-advert feature
 * (server/receipt-pdf.ts draws these into the printed receipt). The two formats render adverts
 * into differently-shaped boxes — A4 gets a wide banner strip, thermal gets a near-full-width
 * column that's much less elongated — so an image sized for one looks wrong in the other (tiny/
 * letterboxed, or cropped). These ratios are derived from the actual PDFKit draw boxes:
 *   A4:      up to 180x55pt (server/receipt-pdf.ts's drawAdvertAndQr)      -> ~3.27:1
 *   Thermal: INNER-width x (INNER * 0.55)pt, same at any roll width       -> ~1.82:1
 * Both client (upload-hint text) and server (upload validation) import this so the numbers
 * shown to a staff member always match what's actually enforced.
 */
export const RECEIPT_ADVERT_IMAGE_SPECS = {
  a4: {
    label: "A4 receipt",
    recommendedWidth: 720,
    recommendedHeight: 220,
    minAspectRatio: 2.5,
    maxAspectRatio: 5.0,
    minWidthPx: 300,
    // Plain px + a short shape description — no "aspect ratio X:1" jargon in anything shown to
    // a staff member. The actual enforcement still uses minAspectRatio/maxAspectRatio above.
    hintText: "Use a short, wide image — about 720 × 220 px (roughly 6.5 × 2 cm once printed). It sits in a small strip at the bottom of the full-page A4 receipt.",
  },
  thermal: {
    label: "thermal roll receipt (48/58/80mm)",
    recommendedWidth: 480,
    recommendedHeight: 260,
    minAspectRatio: 1.2,
    maxAspectRatio: 2.4,
    minWidthPx: 200,
    hintText: "Use a wide but not-too-flat image — about 480 × 260 px. It fills the full width of the receipt paper, automatically sized down for narrower rolls (48mm) and up for wider ones (80mm).",
  },
} as const;

export type ReceiptAdvertFormat = keyof typeof RECEIPT_ADVERT_IMAGE_SPECS;

export function isReceiptAdvertFormat(v: unknown): v is ReceiptAdvertFormat {
  return v === "a4" || v === "thermal";
}
